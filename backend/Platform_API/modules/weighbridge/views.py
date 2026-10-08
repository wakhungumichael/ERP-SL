import csv
import base64
import binascii
import json as _json
import socket
import urllib.request
import urllib.error
from datetime import timedelta
from decimal import Decimal
from io import BytesIO

from django.core.files.base import ContentFile
from django.http import HttpResponse
from django.db.models import Q
from django.utils import timezone
from rest_framework import generics, serializers, status
from rest_framework.exceptions import PermissionDenied
from rest_framework.pagination import PageNumberPagination
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView
from PIL import Image, UnidentifiedImageError

from Platform_Core.documents import render_business_document, render_transaction_receipt
from Platform_Core.branch_sync import get_operational_branches_for_tenant
from Platform_Core.accounting import assert_posting_allowed, sync_transaction_posting
from Platform_Core.models import OrganizationMembership, Tenant, TenantUserProfile
from Platform_API.modules.mixins import (
    NO_TENANT_ACCESS,
    apply_tenant_filter as _shared_apply_tenant_filter,
    resolve_user_tenant as _shared_resolve_user_tenant,
)
from SL_Weighbridge.sync import (
    sync_vehicle_type_product_for_tenant,
    sync_vehicle_type_products_for_tenant,
    vehicle_type_product_code,
)
from SL_Weighbridge.models import (
    Branch, CameraConfig, Customer, IndicatorConfig, Item,
    OverweightConfig, OverweightEvent, Transaction, Vehicle, VehicleType,
    WeighingOperationType,
    WeighbridgeDiscrepancy,
)
from SL_Sales.models import Product
from SL_Weighbridge.utils import capture_hikvision_snapshot
from SL_Weighbridge.plate_recognition import (
    PlateRecognitionUnavailable,
    normalize_plate,
    recognize_plate_image,
)


# ── Pagination ────────────────────────────────────────────────────────────────

class StandardPagination(PageNumberPagination):
    page_size = 25
    page_size_query_param = "page_size"
    max_page_size = 200


# ── Serializers ───────────────────────────────────────────────────────────────

class BranchSerializer(serializers.ModelSerializer):
    class Meta:
        model = Branch
        fields = ["id", "name", "address", "email", "phone"]


class VehicleTypeSerializer(serializers.ModelSerializer):
    linked_product_id = serializers.SerializerMethodField()
    linked_product_name = serializers.SerializerMethodField()
    linked_product_code = serializers.SerializerMethodField()

    class Meta:
        model = VehicleType
        fields = [
            "id", "name", "description", "charge", "max_gross_weight", "max_tare_weight",
            "currency", "linked_product_id", "linked_product_name", "linked_product_code",
        ]

    def _get_linked_product(self, obj):
        request = self.context.get("request")
        if request is None:
            return None
        resolved = _resolve_user_tenant(request.user)
        if resolved is None or isinstance(resolved, _NoTenantProfile):
            return None
        code = vehicle_type_product_code(obj.name)
        return Product.objects.filter(tenant=resolved, code=code).only("id", "name", "code").first()

    def get_linked_product_id(self, obj):
        product = self._get_linked_product(obj)
        return product.id if product else None

    def get_linked_product_name(self, obj):
        product = self._get_linked_product(obj)
        return product.name if product else ""

    def get_linked_product_code(self, obj):
        product = self._get_linked_product(obj)
        return product.code if product else ""


def _sync_vehicle_type_product(vehicle_type, user):
    resolved = _resolve_user_tenant(user)
    if resolved is None or isinstance(resolved, _NoTenantProfile):
        return vehicle_type
    sync_vehicle_type_product_for_tenant(vehicle_type, resolved)
    return vehicle_type


def _tenant_scoped_reference_queryset(qs, user):
    resolved = _resolve_user_tenant(user)
    if isinstance(resolved, _NoTenantProfile):
        return qs.none()
    if resolved is None:
        return qs
    return qs.filter(tenant=resolved)


class ItemSerializer(serializers.ModelSerializer):
    class Meta:
        model = Item
        fields = ["id", "name", "description", "currency"]


class CustomerSerializer(serializers.ModelSerializer):
    class Meta:
        model = Customer
        fields = ["id", "name", "address", "phone_number", "email", "discounted", "charge", "is_active", "is_deleted"]


class CustomerInputSerializer(serializers.ModelSerializer):
    class Meta:
        model = Customer
        fields = ["name", "address", "phone_number", "email", "discounted", "charge", "is_active"]


class CustomerBulkActionSerializer(serializers.Serializer):
    ids = serializers.ListField(
        child=serializers.IntegerField(min_value=1),
        allow_empty=False,
    )
    action = serializers.ChoiceField(choices=["activate", "deactivate", "soft_delete"])


class VehicleSerializer(serializers.ModelSerializer):
    customer_name = serializers.CharField(source="customer.name", read_only=True)
    vehicle_type_name = serializers.SerializerMethodField()

    def get_vehicle_type_name(self, obj):
        return getattr(getattr(obj, "vehicle_type", None), "name", "")

    class Meta:
        model = Vehicle
        fields = ["id", "number_plate", "customer", "customer_name", "vehicle_type", "vehicle_type_name", "is_active"]


class TransactionSerializer(serializers.ModelSerializer):
    camera_snapshot = serializers.CharField(write_only=True, required=False, allow_blank=True)
    camera_image_url = serializers.SerializerMethodField()
    status = serializers.CharField(required=False, allow_blank=False)
    branch_name = serializers.CharField(source="branch.name", read_only=True)
    customer_name = serializers.CharField(source="customer.name", read_only=True)
    customer_email = serializers.CharField(source="customer.email", read_only=True, default=None)
    vehicle_plate = serializers.CharField(source="vehicle.number_plate", read_only=True)
    item_name = serializers.SerializerMethodField()
    vehicle_type_name = serializers.SerializerMethodField()
    operation_type_name = serializers.CharField(source="operation_type.name", read_only=True)
    operation_type_flow_kind = serializers.CharField(source="operation_type.flow_kind", read_only=True)
    auto_invoice_id = serializers.SerializerMethodField()
    actor_user_id = serializers.SerializerMethodField()
    actor_display_name = serializers.SerializerMethodField()
    actor_username = serializers.SerializerMethodField()

    def get_item_name(self, obj):
        return getattr(getattr(obj, "item", None), "name", "")

    def get_vehicle_type_name(self, obj):
        return getattr(getattr(obj, "vehicle_type", None), "name", "")

    def get_camera_image_url(self, obj):
        if not getattr(obj, "image", None):
            return None
        try:
            url = obj.image.url
            request = self.context.get("request")
            return request.build_absolute_uri(url) if request else url
        except (ValueError, OSError):
            return None

    def validate_camera_snapshot(self, value):
        if not value:
            return None
        prefix = "data:image/jpeg;base64,"
        if not value.startswith(prefix):
            raise serializers.ValidationError("Camera snapshot must be a JPEG data URL.")
        encoded = value[len(prefix):]
        if len(encoded) > 8 * 1024 * 1024:
            raise serializers.ValidationError("Camera snapshot must be smaller than 6 MB.")
        try:
            image_bytes = base64.b64decode(encoded, validate=True)
            with Image.open(BytesIO(image_bytes)) as image:
                if image.width * image.height > 40_000_000:
                    raise serializers.ValidationError("Camera snapshot dimensions are too large.")
                image.verify()
                if image.format != "JPEG":
                    raise serializers.ValidationError("Camera snapshot must contain a valid JPEG image.")
        except serializers.ValidationError:
            raise
        except (binascii.Error, ValueError, UnidentifiedImageError, OSError):
            raise serializers.ValidationError("Camera snapshot is not a valid JPEG image.")
        return image_bytes

    def _save_camera_snapshot(self, transaction, image_bytes):
        if not image_bytes:
            return
        filename = f"transaction_{transaction.pk}_{timezone.now():%Y%m%d%H%M%S}.jpg"
        transaction.image.save(filename, ContentFile(image_bytes), save=True)

    def create(self, validated_data):
        image_bytes = validated_data.pop("camera_snapshot", None)
        transaction = super().create(validated_data)
        self._save_camera_snapshot(transaction, image_bytes)
        return transaction

    def update(self, instance, validated_data):
        image_bytes = validated_data.pop("camera_snapshot", None)
        transaction = super().update(instance, validated_data)
        self._save_camera_snapshot(transaction, image_bytes)
        return transaction

    def get_auto_invoice_id(self, obj):
        return getattr(obj, "auto_invoice_id", None)

    def _get_actor(self, obj):
        return getattr(obj, "created_by", None) or getattr(obj, "last_modified_by", None)

    def get_actor_user_id(self, obj):
        actor = self._get_actor(obj)
        return actor.id if actor else None

    def get_actor_display_name(self, obj):
        actor = self._get_actor(obj)
        if not actor:
            return ""
        return actor.get_full_name() or actor.username

    def get_actor_username(self, obj):
        actor = self._get_actor(obj)
        return actor.username if actor else ""

    def validate_status(self, value):
        normalized = (value or "").strip()
        if normalized == "Pending":
            return "Draft"
        return normalized or "Draft"


    class Meta:
        model = Transaction
        fields = [
            "id", "branch", "branch_name",
            "customer", "customer_name", "customer_email",
            "vehicle", "vehicle_plate",
            "vehicle_type", "vehicle_type_name",
            "operation_type", "operation_type_name", "operation_type_flow_kind",
            "actor_user_id", "actor_display_name", "actor_username",
            "operator", "driver_name", "driver_phone", "item", "item_name",
            "gross_weight", "tare_weight", "net_weight",
            "gross_weight_date", "tare_weight_date",
            "status", "weight_type", "payment_mode", "payment_status", "payment_reference", "payment_received_at",
            "charge", "destination", "invoiced", "approval_status",
            "manual_weight_capture", "weight_reason",
            "camera_snapshot", "camera_image_url",
            "paired", "paired_first_transaction",
            "auto_invoice_id",
            "created_at", "updated_at",
        ]
        read_only_fields = ["id", "created_at", "updated_at"]


class WeighingOperationTypeSerializer(serializers.ModelSerializer):
    legacy_weight_type = serializers.SerializerMethodField()

    class Meta:
        model = WeighingOperationType
        fields = [
            "id", "code", "name", "description", "flow_kind",
            "is_active", "display_order", "is_default", "legacy_weight_type",
        ]

    def get_legacy_weight_type(self, obj):
        mapping = {
            "first": "First Weight",
            "second": "Second Weight",
            "single": "First Weight",
            "axle": "First Weight",
        }
        return mapping.get(obj.flow_kind, "First Weight")


class ReportColumnInputSerializer(serializers.Serializer):
    key = serializers.CharField()
    label = serializers.CharField()
    align = serializers.ChoiceField(choices=["left", "right", "center"], required=False, default="left")


class ReportSummaryInputSerializer(serializers.Serializer):
    label = serializers.CharField()
    value = serializers.CharField()


class ReportRenderRequestSerializer(serializers.Serializer):
    report_id = serializers.CharField(required=False, allow_blank=True)
    title = serializers.CharField()
    category = serializers.ChoiceField(choices=["operations", "financial"])
    columns = ReportColumnInputSerializer(many=True)
    rows = serializers.ListField(child=serializers.DictField(), required=False, allow_empty=True)
    filters = serializers.DictField(required=False)
    summary_items = ReportSummaryInputSerializer(many=True, required=False)


def _format_report_filter_value(value):
    if value in (None, "", "all"):
        return "All"
    if isinstance(value, bool):
        return "Yes" if value else "No"
    if isinstance(value, (int, float, Decimal)):
        return str(value)
    return str(value).replace("_", " ").strip() or "All"


def _report_context_from_payload(payload, user, tenant):
    category = payload.get("category") or "operations"
    title = payload.get("title") or "Report"
    columns = payload.get("columns") or []
    rows = payload.get("rows") or []
    filter_map = payload.get("filters") or {}
    summary_items = payload.get("summary_items") or []
    currency = getattr(tenant, "default_currency", "KES") if tenant else "KES"
    try:
        tenant_settings = tenant.settings if tenant else None
    except Exception:
        tenant_settings = None

    display_rows = []
    for raw_row in rows:
        rendered_row = []
        for column in columns:
            key = column.get("key")
            value = raw_row.get(key, "—") if key else "—"
            rendered_row.append(
                {
                    "value": "—" if value in (None, "") else str(value),
                    "align": column.get("align", "left"),
                }
            )
        display_rows.append(rendered_row)

    filter_labels = {
        "branchId": "Branch",
        "operator": "Operator",
        "status": "Status",
        "paymentStatus": "Payment",
        "weightType": "Weight Type",
        "search": "Search",
        "dateFrom": "From",
        "dateTo": "To",
    }
    visible_filters = []
    for key, label in filter_labels.items():
        value = filter_map.get(key)
        if key == "search" and not value:
            continue
        visible_filters.append({"label": label, "value": _format_report_filter_value(value)})

    prepared_by = user.get_full_name() or user.username or "System User"
    issue_date = timezone.localtime(timezone.now()).strftime("%d %b %Y %H:%M")
    date_from = _format_report_filter_value(filter_map.get("dateFrom"))
    date_to = _format_report_filter_value(filter_map.get("dateTo"))
    date_range = f"{date_from} to {date_to}" if date_from != "All" or date_to != "All" else "Current selection"
    company_name = getattr(tenant, "legal_name", "") or getattr(tenant, "name", "") or "SL-ERP"

    return {
        "branding": {
            "logo_url": "",
            "primary_color": getattr(tenant_settings, "primary_color", "") if tenant_settings else "",
            "footer_text": getattr(tenant_settings, "footer_text", "") if tenant_settings else "",
        },
        "company": {
            "name": company_name,
            "email": getattr(tenant, "contact_email", "") if tenant else "",
            "phone": getattr(tenant, "contact_phone", "") if tenant else "",
            "currency": currency,
            "prepared_by": prepared_by,
        },
        "customer": {"name": "", "email": "", "phone": ""},
        "document": {
            "number": payload.get("report_id") or f"RPT-{timezone.localtime(timezone.now()).strftime('%Y%m%d-%H%M')}",
            "status": "generated",
            "issue_date": issue_date,
            "due_date": date_range,
            "currency": currency,
            "notes": f"{title} generated from the weighbridge reporting workspace.",
            "terms": "",
        },
        "report": {
            "title": title,
            "category": category,
            "category_label": "Operations Report" if category == "operations" else "Financial Report",
            "date_range": date_range,
            "row_count": len(rows),
            "summary": summary_items,
            "filters": visible_filters,
            "columns": columns,
            "display_rows": display_rows,
        },
        "lines": [],
        "totals": {
            "subtotal": Decimal("0.00"),
            "subtotal_display": "",
            "tax": Decimal("0.00"),
            "tax_display": "",
            "discount": Decimal("0.00"),
            "discount_display": "",
            "total": Decimal("0.00"),
            "total_display": "",
        },
        "generated_at": timezone.now(),
    }


# ── Tenant isolation utilities ────────────────────────────────────────────────

_NoTenantProfile = type(NO_TENANT_ACCESS)
_NO_PROFILE = NO_TENANT_ACCESS


def _get_request_user_tenant(user):
    resolved = _shared_resolve_user_tenant(user)
    if resolved is NO_TENANT_ACCESS:
        return None
    return resolved


def _resolve_user_tenant(user):
    return _shared_resolve_user_tenant(user)


def _apply_tenant_filter(qs, user, filter_field="tenant"):
    return _shared_apply_tenant_filter(qs, user, filter_field=filter_field)



DEFAULT_WEIGHING_OPERATION_TYPES = [
    {
        "code": "FIRST_WEIGHT",
        "name": "First Weight",
        "description": "Capture gross weight and open a new weighbridge transaction.",
        "flow_kind": "first",
        "display_order": 10,
        "is_default": True,
    },
    {
        "code": "SECOND_WEIGHT",
        "name": "Second Weight",
        "description": "Capture tare weight and complete a pending first-weight transaction.",
        "flow_kind": "second",
        "display_order": 20,
        "is_default": True,
    },
    {
        "code": "SINGLE_WEIGHT",
        "name": "Single Weight",
        "description": "Capture a one-step weighing transaction without pairing.",
        "flow_kind": "single",
        "display_order": 30,
        "is_default": False,
    },
    {
        "code": "AXLE_WEIGHT",
        "name": "Axle Weight",
        "description": "Capture axle-based weighing as a configurable operational mode.",
        "flow_kind": "axle",
        "display_order": 40,
        "is_default": False,
    },
]

OPEN_TRANSACTION_STATUSES = ["Draft", "Recalled"]
REVIEWABLE_TRANSACTION_STATUSES = ["Draft", "Recalled", "Rejected"]
PENDING_FIRST_WEIGHT_STATUSES = ["Draft", "Recalled", "Completed"]


def _ensure_default_weighing_operation_types(tenant):
    if tenant is None:
        return []
    created = []
    for row in DEFAULT_WEIGHING_OPERATION_TYPES:
        obj, _ = WeighingOperationType.objects.get_or_create(
            tenant=tenant,
            code=row["code"],
            defaults=row,
        )
        created.append(obj)
    return created


def _resolve_transaction_flow(transaction):
    flow_kind = getattr(getattr(transaction, "operation_type", None), "flow_kind", None)
    if flow_kind:
        return flow_kind
    if transaction.weight_type == "Second Weight":
        return "second"
    return "first"


def _resolve_payload_flow_kind(*, operation_type=None, weight_type=""):
    flow_kind = getattr(operation_type, "flow_kind", None)
    if flow_kind:
        return flow_kind
    return "second" if weight_type == "Second Weight" else "first"


def _flow_filter_q(flow_kind):
    if flow_kind == "second":
        return Q(operation_type__flow_kind="second") | Q(weight_type="Second Weight")
    if flow_kind == "first":
        return Q(operation_type__flow_kind="first") | Q(weight_type="First Weight")
    return Q(operation_type__flow_kind=flow_kind)


def _max_first_weight_age_days(branch):
    """Return the pairing window configured for the first weight's branch."""
    try:
        cfg = IndicatorConfig.objects.filter(branch=branch).only("max_first_weight_age_days").first()
        if cfg is not None and cfg.max_first_weight_age_days is not None:
            return max(0, int(cfg.max_first_weight_age_days))
    except (TypeError, ValueError):
        pass
    return 3


def _is_pending_first_weight(transaction, *, now=None):
    """A first weight remains pairable until paired, rejected, or outside its branch window."""
    if transaction is None or _resolve_transaction_flow(transaction) != "first":
        return False
    if transaction.paired or transaction.status not in PENDING_FIRST_WEIGHT_STATUSES:
        return False
    recorded_at = transaction.created_at
    if not recorded_at:
        return False
    return recorded_at >= (now or timezone.now()) - timedelta(days=_max_first_weight_age_days(transaction.branch))


def _find_open_transaction_duplicate(*, tenant, vehicle, flow_kind, exclude_pk=None):
    qs = Transaction.objects.filter(vehicle=vehicle)
    if tenant is None:
        qs = qs.filter(tenant__isnull=True)
    else:
        qs = qs.filter(tenant=tenant)
    if exclude_pk is not None:
        qs = qs.exclude(pk=exclude_pk)
    qs = qs.select_related("operation_type", "item", "branch").order_by("-updated_at", "-created_at", "-id")

    if flow_kind == "first":
        for transaction in qs.filter(_flow_filter_q("first"), paired=False, status__in=PENDING_FIRST_WEIGHT_STATUSES):
            if _is_pending_first_weight(transaction):
                return transaction
        return None

    return qs.filter(_flow_filter_q(flow_kind), status__in=OPEN_TRANSACTION_STATUSES).first()


def _transaction_prefill_defaults(transaction):
    if not transaction:
        return None
    return {
        "transaction_id": transaction.id,
        "item_id": getattr(transaction, "item_id", None),
        "item_name": getattr(getattr(transaction, "item", None), "name", "") or "",
        "destination": getattr(transaction, "destination", "") or "",
        "driver_name": getattr(transaction, "driver_name", "") or "",
        "driver_phone": getattr(transaction, "driver_phone", "") or "",
        "vehicle_type_id": getattr(transaction, "vehicle_type_id", None),
        "payment_mode": getattr(transaction, "payment_mode", "") or "",
        "payment_status": getattr(transaction, "payment_status", "") or "",
        "flow_kind": _resolve_transaction_flow(transaction),
    }


def _finalize_transaction_workflow(transaction):
    now = timezone.now()
    flow_kind = _resolve_transaction_flow(transaction)
    requires_approval = bool(transaction.manual_weight_capture)
    finalized_status = "Draft" if requires_approval else "Completed"

    if flow_kind == "second" and transaction.paired_first_transaction_id:
        first = transaction.paired_first_transaction
        if first:
            if not transaction.gross_weight:
                transaction.gross_weight = first.gross_weight
            transaction.status = finalized_status
            transaction.approval_status = not requires_approval
            transaction.paired = True
            transaction.gross_weight_date = first.gross_weight_date or first.created_at or now
            transaction.tare_weight_date = transaction.tare_weight_date or now
            transaction.save()

            first.tare_weight = transaction.tare_weight
            first.net_weight = transaction.net_weight
            first.status = finalized_status
            first.paired = True
            first.tare_weight_date = transaction.tare_weight_date
            first.payment_mode = transaction.payment_mode or first.payment_mode
            first.payment_status = transaction.payment_status or first.payment_status
            first.approval_status = not requires_approval
            first.manual_weight_capture = transaction.manual_weight_capture
            first.save()
            return transaction, first

    if flow_kind in {"single", "axle"}:
        transaction.status = finalized_status
        transaction.approval_status = not requires_approval
        if transaction.gross_weight and transaction.tare_weight and not transaction.net_weight:
            transaction.net_weight = abs(int(transaction.gross_weight) - int(transaction.tare_weight))
        if transaction.gross_weight and not transaction.gross_weight_date:
            transaction.gross_weight_date = now
        if transaction.tare_weight and not transaction.tare_weight_date:
            transaction.tare_weight_date = now
        transaction.save()
        return transaction, transaction

    transaction.status = finalized_status
    transaction.approval_status = not requires_approval
    if transaction.gross_weight and not transaction.gross_weight_date:
        transaction.gross_weight_date = now
    transaction.save()
    return transaction, transaction


def _maybe_create_transaction_invoice(transaction):
    try:
        from Platform_API.modules.payments.views import create_draft_invoice_for_transaction
    except Exception:
        return None

    charge_tx = transaction
    if _resolve_transaction_flow(transaction) == "second" and transaction.paired_first_transaction_id:
        first = transaction.paired_first_transaction
        if first and float(first.charge or 0) > 0:
            charge_tx = first
        elif float(transaction.charge or 0) <= 0:
            charge_tx = None

    if charge_tx and charge_tx.status == "Completed" and float(charge_tx.charge or 0) > 0:
        return create_draft_invoice_for_transaction(charge_tx)
    return None


def _transaction_requires_approval(transaction):
    return transaction.status in OPEN_TRANSACTION_STATUSES and bool(transaction.manual_weight_capture)


def _approve_transaction(transaction):
    now = timezone.now()
    flow_kind = _resolve_transaction_flow(transaction)

    transaction.approval_status = True
    transaction.status = "Completed"
    transaction.manual_weight_capture = False

    if transaction.gross_weight and not transaction.gross_weight_date:
        transaction.gross_weight_date = now
    if transaction.tare_weight and not transaction.tare_weight_date:
        transaction.tare_weight_date = now
    if transaction.gross_weight and transaction.tare_weight and not transaction.net_weight:
        transaction.net_weight = abs(int(transaction.gross_weight) - int(transaction.tare_weight))

    if flow_kind == "second" and transaction.paired_first_transaction_id:
        first = transaction.paired_first_transaction
        if first:
            if not transaction.gross_weight:
                transaction.gross_weight = first.gross_weight
            transaction.paired = True
            transaction.gross_weight_date = transaction.gross_weight_date or first.gross_weight_date or first.created_at or now
            transaction.tare_weight_date = transaction.tare_weight_date or now

            first.tare_weight = transaction.tare_weight
            first.net_weight = transaction.net_weight
            first.status = "Completed"
            first.paired = True
            first.approval_status = True
            first.manual_weight_capture = False
            first.tare_weight_date = transaction.tare_weight_date
            first.payment_mode = transaction.payment_mode or first.payment_mode
            first.payment_status = transaction.payment_status or first.payment_status
            first.save()

    transaction.save()

    try:
        _maybe_record_overweight_event(transaction, getattr(transaction, "last_modified_by", None) or getattr(transaction, "created_by", None))
    except Exception:
        pass

    try:
        _maybe_create_transaction_invoice(transaction)
    except Exception:
        pass

    return transaction


def _receipt_allowed(transaction):
    payment_mode = (getattr(transaction, "payment_mode", "") or "").strip()
    payment_status = (getattr(transaction, "payment_status", "") or "").strip()
    return payment_status == "Paid" or payment_mode == "Debt"


def _get_tenant_scoped_transaction(user, pk, select_related=None):
    """
    Fetch a Transaction by PK, scoped to the requesting user's tenant.

    Raises Transaction.DoesNotExist if the PK is not in the database, belongs
    to a different tenant, or the user is a profileless non-superuser — this
    prevents cross-tenant IDOR without leaking object existence to the caller.
    """
    qs = Transaction.objects.all()
    if select_related:
        qs = qs.select_related(*select_related)
    qs = _apply_tenant_filter(qs, user)
    return qs.get(pk=pk)


def _is_weighbridge_tenant_admin(user):
    if not getattr(user, "is_authenticated", False):
        return False
    try:
        if OrganizationMembership.objects.filter(
            user=user,
            is_active=True,
            is_org_admin=True,
        ).exists():
            return True
    except Exception:
        pass
    try:
        profile = user.tenant_profile
    except TenantUserProfile.DoesNotExist:
        return False
    except Exception:
        return False
    return bool(profile and profile.is_tenant_admin and profile.tenant_id)


def _can_view_weighbridge_team_dashboard(user):
    if not getattr(user, "is_authenticated", False):
        return False
    if getattr(user, "is_superuser", False) or _is_weighbridge_tenant_admin(user):
        return True
    return any([
        user.has_perm("SL_Weighbridge.can_export_transaction"),
        user.has_perm("SL_Weighbridge.can_approve_pending_transactions"),
        user.has_perm("SL_Weighbridge.can_recall_completed_transactions"),
    ])


def _has_weighbridge_process_permission(user, codename):
    """Tenant admins retain operational access; custom roles need the named process permission."""
    return bool(
        getattr(user, "is_superuser", False)
        or getattr(user, "is_staff", False)
        or _is_weighbridge_tenant_admin(user)
        # Existing installations may have tenant users created before process
        # permissions were introduced. Keep those unassigned users operational;
        # once a role is assigned, its explicit permissions take precedence.
        or not user.groups.exists()
        or user.has_perm(f"SL_Weighbridge.{codename}")
    )


def _require_weighbridge_model_permission(user, codename):
    """Enforce record-level role assignments while retaining organization-admin access."""
    if (
        getattr(user, "is_superuser", False)
        or _is_weighbridge_tenant_admin(user)
        or user.has_perm(f"SL_Weighbridge.{codename}")
    ):
        return
    raise PermissionDenied("You do not have permission to perform this action.")


# ── Views ─────────────────────────────────────────────────────────────────────

class WeighbridgeDashboardView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request):
        today = timezone.now().date()
        month_start = today.replace(day=1)

        # ── Tenant scoping ────────────────────────────────────────────────────
        # Non-superusers only see dashboard metrics for their own tenant's
        # transactions.  Superusers see the global picture.
        # Profileless non-superusers get an empty queryset (deny-all).
        qs = _apply_tenant_filter(Transaction.objects.all(), request.user)

        if branch_id := request.query_params.get("branch_id"):
            qs = qs.filter(branch_id=branch_id)

        today_qs = qs.filter(created_at__date=today)
        month_qs = qs.filter(created_at__date__gte=month_start)
        pending_qs = qs.exclude(status="Completed")

        status_breakdown = [
            {"status": s, "count": qs.filter(status=s).count()}
            for s in ["Draft", "Recalled", "Rejected", "Completed"]
        ]

        recent = TransactionSerializer(qs.order_by("-created_at")[:10], many=True).data

        return Response({
            "totals": {
                "all_transactions": qs.count(),
                "pending_transactions": pending_qs.count(),
                "transactions_today": today_qs.count(),
                "transactions_this_month": month_qs.count(),
                "net_weight_today": float(
                    sum(t.net_weight or 0 for t in today_qs.filter(net_weight__isnull=False))
                ),
                "pending_payments": qs.filter(payment_status="Pending").count(),
                "total_charge": float(
                    sum(t.charge or 0 for t in month_qs.filter(status="Completed"))
                ),
            },
            "status_breakdown": status_breakdown,
            "recent_transactions": recent,
        })


class TransactionListCreateView(generics.ListCreateAPIView):
    serializer_class = TransactionSerializer
    permission_classes = [IsAuthenticated]
    pagination_class = StandardPagination

    def get_queryset(self):
        from django.db.models import Q
        qs = Transaction.objects.select_related(
            "branch", "customer", "vehicle", "item", "vehicle_type", "created_by", "last_modified_by"
        ).order_by("-created_at")
        params = self.request.query_params

        # ── Default tenant scoping ──────────────────────────────────────────
        # - Superusers: unfiltered global access
        # - Profiled non-superusers: scoped to their tenant + param checked
        # - Profileless non-superusers: deny-all (qs.none())
        resolved = _resolve_user_tenant(self.request.user)
        if isinstance(resolved, _NoTenantProfile):
            return qs.none()
        if resolved is not None:   # Tenant object → scoped
            tenant_code_param = params.get("tenant_code")
            if tenant_code_param and tenant_code_param != resolved.code:
                return qs.none()
            qs = qs.filter(tenant=resolved)

        if branch_id := params.get("branch_id"):
            # For non-superusers, verify the requested branch is associated
            # with the user's own tenant before applying the filter.  Since
            # Branch has no direct tenant FK we confirm membership via the
            # already tenant-scoped transaction history.  An unknown or
            # cross-tenant branch_id returns an empty result set rather than
            # leaking the existence of that branch to the caller.
            if resolved is not None:  # Tenant object — non-superuser
                if not Transaction.objects.filter(
                    tenant=resolved, branch_id=branch_id
                ).exists():
                    return qs.none()
            qs = qs.filter(branch_id=branch_id)
        if s := params.get("status"):
            qs = qs.filter(status=s)
        if ps := params.get("payment_status"):
            qs = qs.filter(payment_status=ps)
        if customer_id := params.get("customer_id"):
            qs = qs.filter(customer_id=customer_id)
        if actor_user_id := params.get("actor_user_id"):
            qs = qs.filter(Q(created_by_id=actor_user_id) | Q(last_modified_by_id=actor_user_id))
        if weight_type := params.get("weight_type"):
            qs = qs.filter(weight_type=weight_type)
        if search := params.get("search"):
            qs = qs.filter(
                Q(vehicle__number_plate__icontains=search) |
                Q(customer__name__icontains=search) |
                Q(operator__icontains=search) |
                Q(driver_name__icontains=search) |
                Q(driver_phone__icontains=search)
            )

        # ── Date / time range filter ────────────────────────────────────────
        # date_field choices: created_at | gross_weight_date | tare_weight_date | updated_at
        VALID_DATE_FIELDS = {
            "created_at":       "created_at",
            "gross_weight_date": "gross_weight_date",
            "tare_weight_date":  "tare_weight_date",
            "updated_at":        "updated_at",
        }
        db_field = VALID_DATE_FIELDS.get(params.get("date_field", ""), "created_at")
        date_from = params.get("date_from")
        date_to   = params.get("date_to")
        time_from = params.get("time_from") or "00:00"
        time_to   = params.get("time_to")   or "23:59"

        if date_from:
            try:
                from django.utils.dateparse import parse_datetime
                from django.utils.timezone import make_aware, is_naive
                dt = parse_datetime(f"{date_from}T{time_from}:00")
                if dt:
                    if is_naive(dt):
                        dt = make_aware(dt)
                    qs = qs.filter(**{f"{db_field}__gte": dt})
            except Exception:
                pass
        if date_to:
            try:
                from django.utils.dateparse import parse_datetime
                from django.utils.timezone import make_aware, is_naive
                dt = parse_datetime(f"{date_to}T{time_to}:59")
                if dt:
                    if is_naive(dt):
                        dt = make_aware(dt)
                    qs = qs.filter(**{f"{db_field}__lte": dt})
            except Exception:
                pass

        return qs

    def perform_create(self, serializer):
        user_tenant = _get_request_user_tenant(self.request.user)
        validated = serializer.validated_data
        vehicle = validated.get("vehicle")
        operation_type = validated.get("operation_type")
        weight_type = validated.get("weight_type") or ""
        flow_kind = _resolve_payload_flow_kind(operation_type=operation_type, weight_type=weight_type)

        if not _has_weighbridge_process_permission(self.request.user, "can_access_weighment_entry"):
            raise PermissionDenied("You do not have access to Weighment Entry.")
        capture_permission = "can_capture_second_weight" if weight_type == "Second Weight" else "can_capture_first_weight"
        if not _has_weighbridge_process_permission(self.request.user, capture_permission):
            raise PermissionDenied("You do not have permission for this weight-capture step.")

        if flow_kind == "second":
            first_weight = validated.get("paired_first_transaction")
            if not first_weight or first_weight.vehicle_id != vehicle.id or not _is_pending_first_weight(first_weight):
                raise serializers.ValidationError({
                    "paired_first_transaction": (
                        "Select an unpaired first weight for this vehicle that is within the branch's maximum first-weight age."
                    )
                })

        duplicate = _find_open_transaction_duplicate(
            tenant=user_tenant,
            vehicle=vehicle,
            flow_kind=flow_kind,
        )
        if duplicate:
            flow_label = (getattr(getattr(duplicate, "operation_type", None), "name", None) or duplicate.weight_type or flow_kind).strip()
            if flow_kind == "first":
                message = (
                    f"Vehicle {vehicle.number_plate} already has a pending {flow_label} "
                    f"(TX-{duplicate.id:05d}). Capture its second weight before recording another first weight."
                )
            else:
                message = (
                    f"Vehicle {vehicle.number_plate} already has an active open {flow_label} transaction "
                    f"(TX-{duplicate.id:05d}) in {duplicate.status}. Complete, recall, or deactivate that record before creating another one."
                )
            raise serializers.ValidationError(
                {"vehicle": message}
            )

        try:
            tx = serializer.save(
                tenant=user_tenant,
                vehicle_type=vehicle.vehicle_type,
                created_by=self.request.user,
                last_modified_by=self.request.user,
            )
            _, invoice_target = _finalize_transaction_workflow(tx)
            _maybe_create_transaction_invoice(invoice_target)
        except ValueError as exc:
            raise serializers.ValidationError({"gross_weight": str(exc)}) from exc


class TransactionDetailView(generics.RetrieveUpdateAPIView):
    """
    Retrieve or update a single transaction.

    Non-superusers are scoped to their own tenant — DRF returns 404
    automatically when the object is not in the scoped queryset, which
    prevents cross-tenant IDOR without leaking object existence.
    """
    serializer_class = TransactionSerializer
    permission_classes = [IsAuthenticated]

    def get_queryset(self):
        qs = Transaction.objects.select_related("branch", "customer", "vehicle", "item", "vehicle_type", "created_by", "last_modified_by")
        return _apply_tenant_filter(qs, self.request.user)

    def perform_update(self, serializer):
        current = self.get_object()
        if current.status == "Completed":
            raise serializers.ValidationError("Completed transactions are locked. Recall the transaction before editing.")
        try:
            tx = serializer.save(last_modified_by=self.request.user)
            if tx.status not in REVIEWABLE_TRANSACTION_STATUSES:
                tx.status = "Draft"
                tx.save(update_fields=["status", "updated_at"])
            _, invoice_target = _finalize_transaction_workflow(tx)
            _maybe_create_transaction_invoice(invoice_target)
        except ValueError as exc:
            raise serializers.ValidationError({"gross_weight": str(exc)}) from exc


class WorkflowContextView(APIView):
    """
    GET /api/commercial-weighbridge/transactions/workflow-context/?vehicle_id=<id>

    Returns workflow context for a vehicle:
    - whether it has a valid pending First Weight awaiting a Second Weight
    - the First Weight transaction details needed for pairing
    - recommended next action (first_weight or second_weight)
    """
    permission_classes = [IsAuthenticated]

    def get(self, request):
        vehicle_id = request.query_params.get("vehicle_id")
        if not vehicle_id:
            return Response(
                {"error": "vehicle_id query parameter is required."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        try:
            vehicle = Vehicle.objects.select_related("customer", "vehicle_type").get(pk=vehicle_id)
        except Vehicle.DoesNotExist:
            return Response({"error": f"Vehicle {vehicle_id} not found."}, status=status.HTTP_404_NOT_FOUND)

        # ── Tenant isolation for vehicle and transaction lookup ───────────────
        # After resolving the vehicle, we verify it has at least one transaction
        # belonging to the requesting user's tenant — this prevents cross-tenant
        # vehicle/customer metadata disclosure even when no transaction is found.
        tx_qs = _apply_tenant_filter(
            Transaction.objects.select_related("branch", "customer", "vehicle", "item", "vehicle_type"),
            request.user,
        )
        # Deny access to vehicles that have no transactions in the user's tenant
        if not tx_qs.filter(vehicle=vehicle).exists():
            # Return "not found" to avoid disclosing that a cross-tenant vehicle
            # exists; a superuser can see any vehicle so this only applies to
            # tenant-scoped users (including profileless non-superusers).
            if not request.user.is_superuser:
                return Response({"error": f"Vehicle {vehicle_id} not found."}, status=status.HTTP_404_NOT_FOUND)
        pending_first_weights = (
            tx_qs
            .filter(
                Q(operation_type__flow_kind="first") | Q(weight_type="First Weight"),
                vehicle=vehicle,
                status__in=PENDING_FIRST_WEIGHT_STATUSES,
                paired=False,
            )
            .select_related("branch")
            .order_by("-created_at")
        )
        first_weight_tx = next((tx for tx in pending_first_weights if _is_pending_first_weight(tx)), None)
        max_age_days = _max_first_weight_age_days(first_weight_tx.branch) if first_weight_tx else 3

        latest_tx = (
            tx_qs
            .filter(vehicle=vehicle)
            .order_by("-updated_at", "-created_at", "-id")
            .first()
        )

        open_transactions = [
            {
                "id": tx.id,
                "status": tx.status,
                "flow_kind": _resolve_transaction_flow(tx),
                "weight_type": tx.weight_type,
                "operation_type_name": getattr(getattr(tx, "operation_type", None), "name", "") or "",
            }
            for tx in tx_qs.filter(vehicle=vehicle, status__in=OPEN_TRANSACTION_STATUSES).order_by("-updated_at", "-created_at", "-id")[:10]
        ]

        has_pending = first_weight_tx is not None

        return Response({
            "vehicle_id": vehicle.id,
            "vehicle_plate": vehicle.number_plate,
            "customer_id": vehicle.customer_id,
            "customer_name": vehicle.customer.name if vehicle.customer else "",
            "vehicle_type_id": vehicle.vehicle_type_id,
            "vehicle_type_name": getattr(vehicle.vehicle_type, "name", ""),
            "has_pending_first_weight": has_pending,
            "workflow_recommendation": "second_weight" if has_pending else "first_weight",
            "first_weight_transaction": TransactionSerializer(first_weight_tx).data if has_pending else None,
            "latest_transaction_defaults": _transaction_prefill_defaults(latest_tx),
            "open_transactions": open_transactions,
            "max_first_weight_age_days": max_age_days,
            "message": (
                f"Vehicle {vehicle.number_plate} has a pending first weight of "
                f"{first_weight_tx.gross_weight} kg (TX-{first_weight_tx.id:05d}). "
                "Proceed to capture second weight to complete the transaction."
                if has_pending else
                f"No pending first weight found for {vehicle.number_plate} within the last {max_age_days} days. "
                "Start a new first weight transaction."
            ),
        })


def _maybe_record_overweight_event(tx, user):
    """
    Create an OverweightEvent when tx's weight meets or exceeds the branch threshold.

    Called synchronously after tx.save() inside CaptureWeightView.post().
    All exceptions are caught by the caller — a surveillance failure must
    never block the weighbridge flow.
    """
    from django.core.files.base import ContentFile
    from django.utils import timezone as tz
    from SL_Weighbridge.utils import capture_hikvision_snapshot

    branch = getattr(tx, "branch", None)
    if not branch:
        return

    try:
        cfg = OverweightConfig.objects.get(branch=branch)
    except OverweightConfig.DoesNotExist:
        return

    if not cfg.surveillance_enabled:
        return

    gross = int(tx.gross_weight or 0)
    tare  = int(tx.tare_weight  or 0)

    if tx.weight_type == "Second Weight":
        weight_to_check = abs(gross - tare)
    else:
        weight_to_check = gross  # First Weight — compare raw gross

    threshold = int(cfg.threshold_kg)
    if weight_to_check < threshold:
        return

    event = OverweightEvent(
        tenant=getattr(tx, "tenant", None),
        branch=branch,
        vehicle_plate=tx.vehicle.number_plate if tx.vehicle else "",
        gross_weight=gross or None,
        tare_weight=tare or None,
        net_weight=weight_to_check,
        threshold_at_capture=threshold,
        operator=user if user.is_authenticated else None,
        linked_transaction=tx,
        capture_source="transaction",
        discrepancy_raised=False,
    )
    event.save()

    # Attempt camera snapshot for any active camera attached to this branch
    img_bytes = None
    try:
        cam = CameraConfig.objects.filter(
            branch=branch,
            capture_on_overweight=True,
            is_active=True,
        ).first()
        if cam:
            img_bytes = capture_hikvision_snapshot(cam)
            if img_bytes:
                fname = f"ow_{event.id}_{tz.now().strftime('%Y%m%d_%H%M%S')}.jpg"
                event.camera_image.save(fname, ContentFile(img_bytes), save=True)
    except Exception:
        pass

    # ── Email alert ───────────────────────────────────────────────────────────
    # Silenced entirely — an email failure must never block the weighbridge flow.
    try:
        if not cfg.notify_on_overweight:
            return

        # Resolve recipient(s)
        recipients = []
        if cfg.notify_email:
            recipients.append(cfg.notify_email)
        else:
            # Fall back to the branch email, then tenant admin users
            branch_email = getattr(branch, "email", None)
            if branch_email:
                recipients.append(branch_email)
            tenant = getattr(tx, "tenant", None)
            if tenant:
                try:
                    org_admin_memberships = OrganizationMembership.objects.filter(
                        tenant=tenant,
                        is_active=True,
                        is_org_admin=True,
                    ).select_related("user")
                    for membership in org_admin_memberships:
                        email = getattr(membership.user, "email", None)
                        if email and email not in recipients:
                            recipients.append(email)
                    from Platform_Core.models import TenantUserProfile
                    admin_profiles = TenantUserProfile.objects.filter(
                        tenant=tenant, is_tenant_admin=True
                    ).select_related("user")
                    for p in admin_profiles:
                        email = getattr(p.user, "email", None)
                        if email and email not in recipients:
                            recipients.append(email)
                except Exception:
                    pass

        if not recipients:
            return

        # Build alert content
        plate = event.vehicle_plate or "—"
        operator_name = (
            f"{user.get_full_name() or user.username}" if user and user.is_authenticated else "—"
        )
        recorded_at_str = event.recorded_at.strftime("%d %b %Y %H:%M:%S") if event.recorded_at else "—"
        branch_name = branch.name if branch else "—"

        subject = f"⚠️ Overweight Alert — {plate} at {branch_name}"

        plain_body = (
            f"OVERWEIGHT VEHICLE ALERT\n"
            f"{'=' * 40}\n"
            f"Branch:     {branch_name}\n"
            f"Plate:      {plate}\n"
            f"Net Weight: {event.net_weight:,} kg\n"
            f"Threshold:  {event.threshold_at_capture:,} kg\n"
            f"Operator:   {operator_name}\n"
            f"Time:       {recorded_at_str}\n"
            f"{'=' * 40}\n"
            f"Please review this incident in the SL-ERP weighbridge module.\n"
        )

        html_body = f"""<!DOCTYPE html>
<html><body style="margin:0;padding:20px;background:#f9fafb;font-family:Arial,sans-serif;">
<div style="max-width:480px;margin:0 auto;background:#fff;border:2px solid #dc2626;border-radius:6px;overflow:hidden;">
  <div style="background:#dc2626;color:#fff;padding:16px 20px;">
    <div style="font-size:20px;font-weight:bold;">⚠️ Overweight Vehicle Alert</div>
    <div style="font-size:13px;margin-top:4px;opacity:0.9;">{branch_name}</div>
  </div>
  <div style="padding:20px;">
    <table style="width:100%;font-size:14px;border-collapse:collapse;">
      <tr style="background:#fef2f2;"><td style="padding:8px 10px;color:#555;width:40%;">Plate Number</td><td style="padding:8px 10px;font-weight:bold;">{plate}</td></tr>
      <tr><td style="padding:8px 10px;color:#555;">Net Weight</td><td style="padding:8px 10px;font-weight:bold;color:#dc2626;">{event.net_weight:,} kg</td></tr>
      <tr style="background:#fef2f2;"><td style="padding:8px 10px;color:#555;">Threshold</td><td style="padding:8px 10px;font-weight:bold;">{event.threshold_at_capture:,} kg</td></tr>
      <tr><td style="padding:8px 10px;color:#555;">Operator</td><td style="padding:8px 10px;">{operator_name}</td></tr>
      <tr style="background:#fef2f2;"><td style="padding:8px 10px;color:#555;">Time</td><td style="padding:8px 10px;">{recorded_at_str}</td></tr>
    </table>
    <p style="margin-top:16px;font-size:13px;color:#555;">
      Please review this incident in the SL-ERP weighbridge module.
    </p>
  </div>
</div>
</body></html>"""

        from django.core.mail import EmailMultiAlternatives
        from django.conf import settings as dj_settings
        from_email = getattr(dj_settings, "DEFAULT_FROM_EMAIL", "noreply@sl-erp.com")
        msg = EmailMultiAlternatives(
            subject=subject,
            body=plain_body,
            from_email=from_email,
            to=recipients,
        )
        msg.attach_alternative(html_body, "text/html")

        # Attach camera snapshot if available
        if img_bytes:
            snap_fname = f"overweight_{plate}_{tz.now().strftime('%Y%m%d_%H%M%S')}.jpg"
            msg.attach(snap_fname, img_bytes, "image/jpeg")

        msg.send(fail_silently=True)
    except Exception:
        pass


class CaptureWeightView(APIView):
    """
    POST /api/commercial-weighbridge/transactions/capture-weight/

    Captures stable weight from the branch indicator integration.
    Flow: Frontend → this endpoint → backend integration resolution → indicator source.

    Request body:
      branch_id         (int, optional if transaction_id given)
      transaction_id    (int, optional) — reads branch from this transaction
      apply_weight      (bool, default false) — if true AND stable, persist weight to transaction

    Response includes the live reading plus whether it was applied to the transaction.
    """
    permission_classes = [IsAuthenticated]

    def post(self, request):
        branch_id = request.data.get("branch_id")
        transaction_id = request.data.get("transaction_id")
        apply_weight = bool(request.data.get("apply_weight", False))

        tx = None
        branch = None

        # Resolve transaction (tenant-scoped to prevent cross-tenant IDOR)
        if transaction_id:
            try:
                tx = _get_tenant_scoped_transaction(request.user, transaction_id, select_related=["branch"])
                branch = tx.branch
            except Transaction.DoesNotExist:
                return Response(
                    {"error": f"Transaction {transaction_id} not found."},
                    status=status.HTTP_404_NOT_FOUND,
                )

        if not _has_weighbridge_process_permission(request.user, "can_access_weighment_entry"):
            return Response({"error": "You do not have access to Weighment Entry."}, status=status.HTTP_403_FORBIDDEN)
        if tx:
            capture_permission = "can_capture_second_weight" if tx.weight_type == "Second Weight" else "can_capture_first_weight"
            if not _has_weighbridge_process_permission(request.user, capture_permission):
                return Response({"error": "You do not have permission for this weight-capture step."}, status=status.HTTP_403_FORBIDDEN)

        # Resolve branch directly if not already resolved via transaction
        if not branch and branch_id:
            try:
                branch = Branch.objects.get(pk=branch_id, id__in=_allowed_branch_ids(request.user))
            except Branch.DoesNotExist:
                return Response(
                    {"error": f"Branch {branch_id} not found."},
                    status=status.HTTP_404_NOT_FOUND,
                )

        # ── Attempt real indicator read ───────────────────────────────────────
        captured_weight = None
        stable = False
        source = "stub"
        indicator_meta = {}
        cfg = None

        # 1. Local IndicatorConfig HTTP URL (stable_weight_url first, then live_weight_url)
        try:
            cfg = IndicatorConfig.objects.filter(branch=branch).first() if branch else None
            if cfg:
                source = cfg.indicator_name
            if cfg and cfg.connection_type == "HTTP":
                url = (cfg.stable_weight_url or cfg.live_weight_url or "").strip()
                if url:
                    reading = _fetch_indicator_url(url)
                    captured_weight = reading["weight"]
                    stable = reading["stable"]
                    source = cfg.indicator_name
        except Exception:
            pass

        # A tenant branch must be configured explicitly; never fall back to a
        # deployment-wide or another branch's indicator.
        if cfg is None:
            return Response({
                "captured_weight": None,
                "unit": "kg",
                "stable": False,
                "source": "unconfigured",
                "configured": False,
                "connected": False,
                "status": "not_configured",
                "branch_id": branch.id if branch else None,
                "transaction_id": tx.id if tx else None,
                "applied": False,
                "transaction": None,
                "indicator_meta": {},
                "timestamp": timezone.now().isoformat(),
            })
        if captured_weight is None:
            return Response({
                "captured_weight": None,
                "unit": "kg",
                "stable": False,
                "source": cfg.indicator_name,
                "configured": True,
                "connected": False,
                "status": "offline",
                "branch_id": branch.id if branch else None,
                "transaction_id": tx.id if tx else None,
                "applied": False,
                "transaction": None,
                "indicator_meta": {},
                "timestamp": timezone.now().isoformat(),
            })

        # ── Optionally apply stable weight to transaction ─────────────────────
        updated_transaction = None
        if apply_weight and stable and captured_weight is not None and tx:
            if tx.weight_type == "Second Weight":
                tx.tare_weight = int(captured_weight)
                if tx.gross_weight:
                    tx.net_weight = abs(int(tx.gross_weight) - int(captured_weight))
                if tx.paired_first_transaction_id:
                    paired = tx.paired_first_transaction
                    if paired:
                        paired.tare_weight = int(captured_weight)
                        paired.net_weight = tx.net_weight
                        paired.status = "Completed"
                        paired.paired = True
                        paired.save(update_fields=["tare_weight", "net_weight", "status", "paired", "updated_at"])
                tx.status = "Completed"
                tx.paired = True
            else:
                tx.gross_weight = int(captured_weight)

            tx.manual_weight_capture = False
            tx.save()

            # ── Overweight surveillance hook ───────────────────────────────────
            try:
                _maybe_record_overweight_event(tx, request.user)
            except Exception:
                pass

            # ── Auto-create draft invoice when a charge-bearing transaction completes ──
            # Only invoice the transaction that carries the actual charge (charge > 0).
            # In a paired First/Second Weight workflow the charge lives on the First Weight
            # record; the Second Weight record has charge=0 and should not generate its
            # own invoice.
            if tx.status == "Completed":
                try:
                    from Platform_API.modules.payments.views import create_draft_invoice_for_transaction
                    charge_tx = tx
                    if tx.weight_type == "Second Weight" and tx.paired_first_transaction_id:
                        # The charge is on the first-weight record
                        first = tx.paired_first_transaction
                        if first and float(first.charge or 0) > 0:
                            charge_tx = first
                        elif float(tx.charge or 0) <= 0:
                            charge_tx = None  # nothing to invoice
                    # Only create if the chosen transaction actually has a charge
                    if charge_tx and float(charge_tx.charge or 0) > 0:
                        create_draft_invoice_for_transaction(charge_tx)
                except Exception:
                    pass

            updated_transaction = TransactionSerializer(tx).data

        return Response({
            "captured_weight": captured_weight,
            "unit": "kg",
            "stable": stable,
            "source": source,
            "configured": True,
            "connected": True,
            "status": "connected",
            "branch_id": branch.id if branch else None,
            "transaction_id": tx.id if tx else None,
            "applied": updated_transaction is not None,
            "transaction": updated_transaction,
            "indicator_meta": indicator_meta,
            "timestamp": timezone.now().isoformat(),
        })


class TransactionApproveView(APIView):
    """
    POST /api/commercial-weighbridge/transactions/<pk>/approve/

    Marks a manual or recalled transaction as approved and returns it to
    Completed status.
    Requires: superadmin, tenant_admin, or the Django permission
    SL_Weighbridge.can_approve_pending_transactions.
    """
    permission_classes = [IsAuthenticated]

    def post(self, request, pk):
        try:
            tx = _get_tenant_scoped_transaction(request.user, pk)
        except Transaction.DoesNotExist:
            return Response({"error": f"Transaction {pk} not found."}, status=status.HTTP_404_NOT_FOUND)

        if not (
            request.user.is_superuser
            or request.user.is_staff
            or _is_weighbridge_tenant_admin(request.user)
            or request.user.has_perm("SL_Weighbridge.can_approve_pending_transactions")
        ):
            return Response({"error": "Permission denied."}, status=status.HTTP_403_FORBIDDEN)

        if tx.approval_status:
            return Response({"error": "Transaction is already approved.", "transaction": TransactionSerializer(tx).data}, status=status.HTTP_400_BAD_REQUEST)

        if not _transaction_requires_approval(tx):
            return Response(
                {"error": "Only recalled or manual draft transactions can be approved."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        tx.last_modified_by = request.user
        _approve_transaction(tx)
        return Response({"message": "Transaction approved and completed.", "transaction": TransactionSerializer(tx).data})


class TransactionRecallView(APIView):
    """
    POST /api/commercial-weighbridge/transactions/<pk>/recall/

    Recalls a Completed transaction back to Recalled, clearing tare/net weights
    and unpairing the first-weight record so it can be re-weighed.
    Requires: superadmin, tenant_admin, or the Django permission
    SL_Weighbridge.can_recall_completed_transactions.
    """
    permission_classes = [IsAuthenticated]

    def post(self, request, pk):
        try:
            tx = _get_tenant_scoped_transaction(request.user, pk)
        except Transaction.DoesNotExist:
            return Response({"error": f"Transaction {pk} not found."}, status=status.HTTP_404_NOT_FOUND)

        if not (
            request.user.is_superuser
            or request.user.is_staff
            or _is_weighbridge_tenant_admin(request.user)
            or request.user.has_perm("SL_Weighbridge.can_recall_completed_transactions")
        ):
            return Response({"error": "Permission denied."}, status=status.HTTP_403_FORBIDDEN)

        if tx.status != "Completed":
            return Response(
                {"error": "Only Completed transactions can be recalled."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        # ── Void any auto-generated draft invoice ────────────────────────────
        # Un-pair the associated first-weight transaction if this is a second weight.
        # The charge (and therefore the auto_invoice) lives on the first-weight record
        # for paired transactions, so we must void that record's invoice too.
        def _void_auto_invoice(record):
            """Void the auto_invoice on `record` and clear the FK."""
            try:
                inv = getattr(record, "auto_invoice", None)
                if inv is None and record.auto_invoice_id:
                    from SL_Weighbridge.models import Invoice as _Inv
                    inv = _Inv.objects.filter(pk=record.auto_invoice_id).first()
                if inv:
                    inv.status = "void"
                    inv.save(update_fields=["status"])
                record.auto_invoice = None
                record.invoiced = False
                record.save(update_fields=["auto_invoice", "invoiced", "updated_at"])
            except Exception:
                pass

        if tx.weight_type == "Second Weight" and tx.paired_first_transaction_id:
            try:
                first = tx.paired_first_transaction
                _void_auto_invoice(first)
                first.status = "Recalled"
                first.tare_weight = None
                first.net_weight = None
                first.paired = False
                first.approval_status = False
                first.save(update_fields=["status", "tare_weight", "net_weight", "paired", "approval_status", "updated_at"])
            except Exception:
                pass

        # Void the invoice on the recalled transaction itself (covers single-weight flow)
        _void_auto_invoice(tx)

        tx.status = "Recalled"
        tx.approval_status = False
        tx.manual_weight_capture = True
        tx.tare_weight = None
        tx.net_weight = None
        tx.tare_weight_date = None
        tx.paired = False
        if not tx.weight_reason:
            tx.weight_reason = "Transaction recalled for review and re-approval."
        tx.save()
        return Response({"message": "Transaction recalled for editing.", "transaction": TransactionSerializer(tx).data})


class TransactionRejectView(APIView):
    permission_classes = [IsAuthenticated]

    def post(self, request, pk):
        try:
            tx = _get_tenant_scoped_transaction(request.user, pk)
        except Transaction.DoesNotExist:
            return Response({"error": f"Transaction {pk} not found."}, status=status.HTTP_404_NOT_FOUND)

        if not (
            request.user.is_superuser
            or request.user.is_staff
            or _is_weighbridge_tenant_admin(request.user)
            or request.user.has_perm("SL_Weighbridge.can_approve_pending_transactions")
        ):
            return Response({"error": "Permission denied."}, status=status.HTTP_403_FORBIDDEN)

        if tx.status == "Completed":
            return Response({"error": "Completed transactions cannot be rejected."}, status=status.HTTP_400_BAD_REQUEST)

        tx.status = "Rejected"
        tx.approval_status = False
        if not tx.weight_reason:
            tx.weight_reason = "Transaction rejected during weighbridge review."
        tx.last_modified_by = request.user
        tx.save(update_fields=["status", "approval_status", "weight_reason", "last_modified_by", "updated_at"])
        return Response({"message": "Transaction rejected.", "transaction": TransactionSerializer(tx).data})


class TransactionEmailReceiptView(APIView):
    """
    POST /api/commercial-weighbridge/transactions/<pk>/email-receipt/

    Sends a weighbridge receipt email for the given transaction.
    Body (optional): { "email": "override@example.com" }
    Falls back to the customer's email if no override is provided.
    """
    permission_classes = [IsAuthenticated]

    def post(self, request, pk):
        try:
            tx = _get_tenant_scoped_transaction(
                request.user, pk,
                select_related=["branch", "customer", "vehicle", "item", "vehicle_type"],
            )
        except Transaction.DoesNotExist:
            return Response({"error": f"Transaction {pk} not found."}, status=status.HTTP_404_NOT_FOUND)

        if not _receipt_allowed(tx):
            return Response(
                {"error": "Receipt is available only after payment is received, unless the transaction is on debt terms."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        # Resolve recipient
        recipient = (request.data.get("email") or "").strip()
        if not recipient and tx.customer:
            recipient = (tx.customer.email or "").strip()
        if not recipient:
            return Response(
                {"error": "No email address available. Provide one or update the customer record."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        tx_num = str(tx.id).zfill(5)
        branch_name = tx.branch.name if tx.branch else ""
        plate = tx.vehicle.number_plate if tx.vehicle else "—"
        customer_name = tx.customer.name if tx.customer else "—"
        item_name = tx.item.name if tx.item else "—"
        vtype = tx.vehicle_type.name if tx.vehicle_type else "—"

        def _kg(v):
            if v is None:
                return "—"
            return f"{v:,} kg"

        def _kes(v):
            if v is None:
                return "—"
            try:
                return f"KES {float(v):,.2f}"
            except Exception:
                return str(v)

        def _dt(v):
            if not v:
                return "—"
            return v.strftime("%d %b %Y %H:%M") if hasattr(v, "strftime") else str(v)

        is_completed = tx.status == "Completed"
        status_color = "#16a34a" if is_completed else "#d97706"

        subject = f"Weighbridge Receipt — TX#{tx_num}"

        # Plain text
        sep = "=" * 44
        body = "\n".join([
            sep, f"  SL-ERP  WEIGHBRIDGE RECEIPT", f"  {branch_name}", sep,
            f"Transaction #:  {tx_num}",
            f"Status:         {tx.status}",
            "",
            "--- VEHICLE & CUSTOMER ---",
            f"Plate:          {plate}",
            f"Vehicle Type:   {vtype}",
            f"Customer:       {customer_name}",
            f"Item:           {item_name}",
            f"Destination:    {tx.destination or '—'}",
            f"Operator:       {tx.operator or '—'}",
            "",
            "--- WEIGHTS ---",
            f"Gross Weight:   {_kg(tx.gross_weight)}",
            f"Tare Weight:    {_kg(tx.tare_weight)}",
            f"Net Weight:     {_kg(tx.net_weight)}",
            "",
            "--- PAYMENT ---",
            f"Mode:           {tx.payment_mode or '—'}",
            f"Payment Status: {tx.payment_status or '—'}",
            f"CHARGE:         {_kes(tx.charge)}",
            "",
            "--- TIMESTAMPS ---",
            f"First Weight:   {_dt(tx.gross_weight_date or tx.created_at)}",
            f"Second Weight:  {_dt(tx.tare_weight_date)}",
            "",
            sep,
            "Thank you for using our weighbridge.",
            "SL-ERP OPERATIONS PLATFORM",
            sep,
        ])

        # HTML
        html_body = f"""<!DOCTYPE html>
<html><body style="margin:0;padding:20px;background:#f9fafb;font-family:'Courier New',monospace;">
<div style="max-width:480px;margin:0 auto;background:#fff;border:2px solid #000;padding:24px;">
  <div style="text-align:center;border-bottom:2px dashed #000;padding-bottom:12px;margin-bottom:16px;">
    <div style="font-size:22px;font-weight:bold;letter-spacing:3px;">SL-ERP</div>
    <div style="font-size:14px;margin-top:2px;">WEIGHBRIDGE TICKET</div>
    <div style="font-size:11px;color:#666;margin-top:3px;">{branch_name}</div>
  </div>
  <div style="text-align:center;font-size:28px;font-weight:bold;letter-spacing:6px;margin:10px 0;">#{tx_num}</div>
  <div style="text-align:center;margin-bottom:16px;">
    <span style="border:2px solid {status_color};color:{status_color};padding:3px 16px;font-weight:bold;font-size:12px;letter-spacing:2px;text-transform:uppercase;">{tx.status}</span>
  </div>
  <table style="width:100%;font-size:12px;border-collapse:collapse;margin-bottom:14px;">
    <tr><td style="color:#555;padding:3px 0;">Plate Number</td><td style="font-weight:bold;text-align:right;">{plate}</td></tr>
    <tr><td style="color:#555;padding:3px 0;">Vehicle Type</td><td style="font-weight:bold;text-align:right;">{vtype}</td></tr>
    <tr><td style="color:#555;padding:3px 0;">Customer</td><td style="font-weight:bold;text-align:right;">{customer_name}</td></tr>
    <tr><td style="color:#555;padding:3px 0;">Item / Commodity</td><td style="font-weight:bold;text-align:right;">{item_name}</td></tr>
    <tr><td style="color:#555;padding:3px 0;">Destination</td><td style="font-weight:bold;text-align:right;">{tx.destination or '—'}</td></tr>
    <tr><td style="color:#555;padding:3px 0;">Operator</td><td style="font-weight:bold;text-align:right;">{tx.operator or '—'}</td></tr>
  </table>
  <div style="background:#f5f5f5;border:1px solid #000;padding:12px;margin:12px 0;text-align:center;">
    <div style="display:flex;justify-content:space-around;margin-bottom:10px;">
      <div><div style="font-size:10px;color:#666;text-transform:uppercase;">Gross</div><div style="font-weight:bold;font-size:15px;">{_kg(tx.gross_weight)}</div><div style="font-size:9px;color:#999;">{_dt(tx.gross_weight_date)}</div></div>
      <div style="font-size:20px;font-weight:bold;display:flex;align-items:center;">−</div>
      <div><div style="font-size:10px;color:#666;text-transform:uppercase;">Tare</div><div style="font-weight:bold;font-size:15px;">{_kg(tx.tare_weight)}</div><div style="font-size:9px;color:#999;">{_dt(tx.tare_weight_date)}</div></div>
    </div>
    <div style="border-top:1px solid #000;padding-top:8px;">
      <div style="font-size:10px;text-transform:uppercase;letter-spacing:2px;color:#555;">NET WEIGHT</div>
      <div style="font-size:26px;font-weight:bold;">{_kg(tx.net_weight)}</div>
    </div>
  </div>
  <div style="border-top:2px solid #000;padding-top:10px;margin-top:10px;font-size:15px;font-weight:bold;display:flex;justify-content:space-between;">
    <span>CHARGE</span><span>{_kes(tx.charge)}</span>
  </div>
  <div style="font-size:12px;color:#555;margin-top:4px;display:flex;justify-content:space-between;">
    <span>Mode</span><span>{tx.payment_mode or '—'}</span>
  </div>
  <div style="text-align:center;font-size:10px;margin-top:16px;color:#666;border-top:1px dashed #000;padding-top:10px;">
    <div>Thank you for using our weighbridge</div>
    <div style="font-weight:bold;letter-spacing:1px;margin-top:4px;">SL-ERP OPERATIONS PLATFORM</div>
  </div>
</div>
</body></html>"""

        try:
            from django.core.mail import EmailMultiAlternatives
            from django.conf import settings as dj_settings
            from_email = getattr(dj_settings, "DEFAULT_FROM_EMAIL", "noreply@sl-erp.com")
            msg = EmailMultiAlternatives(subject=subject, body=body, from_email=from_email, to=[recipient])
            msg.attach_alternative(html_body, "text/html")
            msg.send(fail_silently=False)
            return Response({"message": f"Receipt sent to {recipient}."})
        except Exception as exc:
            return Response({"error": f"Could not send email: {exc}"}, status=status.HTTP_500_INTERNAL_SERVER_ERROR)


class TransactionReceiptDocumentView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request, pk):
        try:
            tx = _get_tenant_scoped_transaction(
                request.user,
                pk,
                select_related=["branch", "customer", "vehicle", "item", "vehicle_type"],
            )
        except Transaction.DoesNotExist:
            return Response({"error": f"Transaction {pk} not found."}, status=status.HTTP_404_NOT_FOUND)

        if not _receipt_allowed(tx):
            return Response(
                {"error": "Receipt is available only after payment is received, unless the transaction is on debt terms."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        rendered = render_transaction_receipt(tx, request=request)
        return HttpResponse(rendered.html, content_type="text/html; charset=utf-8")


class TransactionExportCSVView(APIView):
    """
    GET /api/commercial-weighbridge/transactions/export/csv/

    Exports transactions matching the current filter params as a CSV file.
    Accepts the same query params as TransactionListCreateView.
    Capped at 10 000 rows.
    """
    permission_classes = [IsAuthenticated]

    def get(self, request):
        if not (
            _has_weighbridge_process_permission(request.user, "can_manage_weighbridge_reports")
            or request.user.has_perm("SL_Weighbridge.can_export_transaction")
        ):
            return Response({"error": "You do not have permission to export weighbridge reports."}, status=status.HTTP_403_FORBIDDEN)
        qs = Transaction.objects.select_related(
            "branch", "customer", "vehicle", "item", "vehicle_type", "created_by", "last_modified_by"
        ).order_by("-created_at")

        # ── Tenant scoping ────────────────────────────────────────────────────
        # CSV exports are scoped identically to the list view:
        # - Superusers export globally
        # - Profiled non-superusers export only their tenant's transactions
        # - Profileless non-superusers export nothing (deny-all)
        qs = _apply_tenant_filter(qs, request.user)

        params = request.query_params
        from django.db.models import Q

        if branch_id := params.get("branch_id"):
            qs = qs.filter(branch_id=branch_id)
        if s := params.get("status"):
            qs = qs.filter(status=s)
        if ps := params.get("payment_status"):
            qs = qs.filter(payment_status=ps)
        if wt := params.get("weight_type"):
            qs = qs.filter(weight_type=wt)
        if cid := params.get("customer_id"):
            qs = qs.filter(customer_id=cid)
        if actor_user_id := params.get("actor_user_id"):
            qs = qs.filter(Q(created_by_id=actor_user_id) | Q(last_modified_by_id=actor_user_id))
        if search := params.get("search"):
            qs = qs.filter(
                Q(vehicle__number_plate__icontains=search)
                | Q(customer__name__icontains=search)
                | Q(operator__icontains=search)
                | Q(driver_name__icontains=search)
                | Q(driver_phone__icontains=search)
            )

        # Date / time range (same logic as list view)
        VALID_DATE_FIELDS = {
            "created_at": "created_at",
            "gross_weight_date": "gross_weight_date",
            "tare_weight_date": "tare_weight_date",
            "updated_at": "updated_at",
        }
        db_field = VALID_DATE_FIELDS.get(params.get("date_field", ""), "created_at")
        date_from = params.get("date_from")
        date_to   = params.get("date_to")
        time_from = params.get("time_from") or "00:00"
        time_to   = params.get("time_to")   or "23:59"

        if date_from:
            try:
                from django.utils.dateparse import parse_datetime
                from django.utils.timezone import make_aware, is_naive
                dt = parse_datetime(f"{date_from}T{time_from}:00")
                if dt and is_naive(dt):
                    dt = make_aware(dt)
                if dt:
                    qs = qs.filter(**{f"{db_field}__gte": dt})
            except Exception:
                pass
        if date_to:
            try:
                from django.utils.dateparse import parse_datetime
                from django.utils.timezone import make_aware, is_naive
                dt = parse_datetime(f"{date_to}T{time_to}:59")
                if dt and is_naive(dt):
                    dt = make_aware(dt)
                if dt:
                    qs = qs.filter(**{f"{db_field}__lte": dt})
            except Exception:
                pass

        response = HttpResponse(content_type="text/csv")
        response["Content-Disposition"] = 'attachment; filename="transactions.csv"'

        writer = csv.writer(response)
        writer.writerow([
            "TX ID", "Vehicle Plate", "Customer", "Branch", "Item", "Vehicle Type",
            "Weight Type", "Actor", "Actor Username", "Gross Weight (kg)", "Tare Weight (kg)", "Net Weight (kg)",
            "Charge (KES)", "Destination", "Operator",
            "Payment Mode", "Payment Status", "Status", "Approved",
            "Manual Capture", "Weight Reason",
            "Gross Weight Date", "Tare Weight Date", "Created At", "Updated At",
        ])

        for tx in qs[:10_000]:
            writer.writerow([
                tx.id,
                tx.vehicle.number_plate if tx.vehicle else "",
                tx.customer.name if tx.customer else "",
                tx.branch.name if tx.branch else "",
                tx.item.name if tx.item else "",
                tx.vehicle_type.name if tx.vehicle_type else "",
                tx.weight_type,
                (tx.created_by.get_full_name() or tx.created_by.username) if tx.created_by else ((tx.last_modified_by.get_full_name() or tx.last_modified_by.username) if tx.last_modified_by else ""),
                tx.created_by.username if tx.created_by else (tx.last_modified_by.username if tx.last_modified_by else ""),
                tx.gross_weight or "",
                tx.tare_weight or "",
                tx.net_weight or "",
                tx.charge or "",
                tx.destination or "",
                tx.operator or "",
                tx.payment_mode or "",
                tx.payment_status or "",
                tx.status,
                "Yes" if tx.approval_status else "No",
                "Yes" if tx.manual_weight_capture else "No",
                tx.weight_reason or "",
                tx.gross_weight_date.isoformat() if tx.gross_weight_date else "",
                tx.tare_weight_date.isoformat() if tx.tare_weight_date else "",
                tx.created_at.isoformat() if tx.created_at else "",
                tx.updated_at.isoformat() if tx.updated_at else "",
            ])

        return response


class WeighbridgeReportDocumentView(APIView):
    permission_classes = [IsAuthenticated]

    def post(self, request):
        if not _has_weighbridge_process_permission(request.user, "can_manage_weighbridge_reports"):
            return Response({"error": "You do not have permission to generate weighbridge reports."}, status=status.HTTP_403_FORBIDDEN)
        serializer = ReportRenderRequestSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)

        tenant = _resolve_user_tenant(request.user)
        if isinstance(tenant, _NoTenantProfile):
            return Response({"error": "No tenant is assigned to your account."}, status=status.HTTP_403_FORBIDDEN)

        context = _report_context_from_payload(serializer.validated_data, request.user, tenant)
        rendered = render_business_document(
            tenant=None if request.user.is_superuser else tenant,
            document_type="report",
            context=context,
            request=request,
        )
        return HttpResponse(rendered.html, content_type="text/html; charset=utf-8")


class BranchListView(generics.ListAPIView):
    serializer_class = BranchSerializer
    permission_classes = [IsAuthenticated]

    def get_queryset(self):
        resolved = _resolve_user_tenant(self.request.user)
        if isinstance(resolved, _NoTenantProfile):
            return Branch.objects.none()
        requested_tenant_id = self.request.query_params.get("tenant_id")
        if requested_tenant_id:
            if resolved is None and self.request.user.is_superuser:
                requested_tenant = Tenant.objects.filter(pk=requested_tenant_id).first()
                if requested_tenant is None:
                    return Branch.objects.none()
                return get_operational_branches_for_tenant(requested_tenant)
            if resolved is None or str(resolved.pk) != str(requested_tenant_id):
                return Branch.objects.none()
        if resolved is None:
            return Branch.objects.all().order_by("name")
        return get_operational_branches_for_tenant(resolved)


# ── Settings / configuration CRUD ────────────────────────────────────────────

class IndicatorConfigSerializer(serializers.ModelSerializer):
    branch_name = serializers.CharField(source="branch.name", read_only=True)

    class Meta:
        model = IndicatorConfig
        fields = [
            "id", "branch", "branch_name", "indicator_name", "connection_type",
            "port", "baud_rate", "data_bits", "parity", "stop_bits",
            "live_weight_url", "stable_weight_url",
            "max_first_weight_age_days", "mode", "node_number",
        ]


class IndicatorConfigListCreateView(generics.ListCreateAPIView):
    serializer_class = IndicatorConfigSerializer
    permission_classes = [IsAuthenticated]
    queryset = IndicatorConfig.objects.select_related("branch").order_by("branch__name")

    def get_queryset(self):
        allowed = _allowed_branch_ids(self.request.user)
        return self.queryset.filter(branch_id__in=allowed)

    def perform_create(self, serializer):
        branch = serializer.validated_data.get("branch")
        allowed = _allowed_branch_ids(self.request.user)
        if not branch or not Branch.objects.filter(pk=branch.pk, id__in=allowed).exists():
            raise PermissionDenied("You do not have permission to configure this branch.")
        serializer.save()


class IndicatorConfigDetailView(generics.RetrieveUpdateDestroyAPIView):
    serializer_class = IndicatorConfigSerializer
    permission_classes = [IsAuthenticated]
    queryset = IndicatorConfig.objects.select_related("branch")

    def get_queryset(self):
        allowed = _allowed_branch_ids(self.request.user)
        return self.queryset.filter(branch_id__in=allowed)


class IndicatorConfigTestConnectionView(APIView):
    permission_classes = [IsAuthenticated]

    def post(self, request, pk):
        try:
            cfg = IndicatorConfig.objects.select_related("branch").get(pk=pk)
        except IndicatorConfig.DoesNotExist:
            return Response({"error": "Indicator config not found."}, status=status.HTTP_404_NOT_FOUND)

        allowed = _allowed_branch_ids(request.user)
        if cfg.branch_id and not Branch.objects.filter(pk=cfg.branch_id, id__in=allowed).exists():
            return Response({"error": "Branch not found or access denied."}, status=status.HTTP_404_NOT_FOUND)

        if cfg.connection_type != "HTTP":
            return Response(
                {
                    "ok": False,
                    "message": "Connection test is currently supported for HTTP indicator configs only.",
                    "connection_type": cfg.connection_type,
                },
                status=status.HTTP_400_BAD_REQUEST,
            )

        def _friendly_indicator_error(exc):
            if isinstance(exc, urllib.error.HTTPError):
                return (
                    f"Endpoint returned HTTP {exc.code}. "
                    "Please confirm the URL is correct and the indicator service is available."
                )
            if isinstance(exc, urllib.error.URLError):
                reason = getattr(exc, "reason", None)
                if isinstance(reason, socket.timeout):
                    return "Connection timed out. Please confirm the indicator device is online and reachable."
                return "Could not reach the indicator endpoint. Please check the URL, network, or DNS settings."
            if isinstance(exc, TimeoutError):
                return "Connection timed out. Please confirm the indicator device is online and reachable."
            if isinstance(exc, _json.JSONDecodeError):
                return "Endpoint responded with invalid data. Please confirm the indicator URL returns JSON weight data."

            text = str(exc) or ""
            if "did not return a valid weight" in text:
                return "Endpoint responded, but no valid weight reading was returned."
            return "Connection test failed due to an unexpected response from the indicator."

        live_url = (cfg.live_weight_url or "").strip()
        stable_url = (cfg.stable_weight_url or "").strip()
        if not live_url and not stable_url:
            return Response(
                {
                    "ok": False,
                    "message": "No live or stable URL is configured for this indicator.",
                },
                status=status.HTTP_400_BAD_REQUEST,
            )

        def _test_endpoint(label, url):
            if not url:
                return None
            try:
                reading = _fetch_indicator_url(url)
                if reading.get("weight") is None:
                    raise ValueError("Endpoint responded but did not return a valid weight.")
                return {
                    "label": label,
                    "url": url,
                    "reachable": True,
                    "weight": reading.get("weight"),
                    "stable": reading.get("stable", False),
                }
            except Exception as exc:
                return {
                    "label": label,
                    "url": url,
                    "reachable": False,
                    "error": _friendly_indicator_error(exc),
                    "technical_error": str(exc),
                }

        live_result = _test_endpoint("live", live_url)
        stable_result = _test_endpoint("stable", stable_url)
        results = [row for row in [live_result, stable_result] if row is not None]
        configured_results = [row for row in results if row.get("url")]
        ok = bool(configured_results) and all(row.get("reachable") for row in configured_results)
        partial = any(row.get("reachable") for row in configured_results) and not ok

        if ok:
            message = "Indicator responded successfully."
        elif partial:
            message = "Some configured indicator endpoints failed."
        else:
            message = "Indicator test failed."

        return Response(
            {
                "ok": ok,
                "partial": partial,
                "indicator_config_id": cfg.id,
                "indicator_name": cfg.indicator_name,
                "branch_id": cfg.branch_id,
                "branch_name": cfg.branch.name if cfg.branch else None,
                "message": message,
                "results": results,
            },
            status=status.HTTP_200_OK if ok else status.HTTP_502_BAD_GATEWAY,
        )


class WeighingOperationTypeListCreateView(generics.ListCreateAPIView):
    serializer_class = WeighingOperationTypeSerializer
    permission_classes = [IsAuthenticated]

    def get_queryset(self):
        resolved = _resolve_user_tenant(self.request.user)
        if isinstance(resolved, _NoTenantProfile):
            return WeighingOperationType.objects.none()
        if resolved is not None:
            _ensure_default_weighing_operation_types(resolved)
            return WeighingOperationType.objects.filter(tenant=resolved).order_by("display_order", "name")
        return WeighingOperationType.objects.all().order_by("display_order", "name")

    def perform_create(self, serializer):
        user_tenant = _get_request_user_tenant(self.request.user)
        serializer.save(tenant=user_tenant)


class WeighingOperationTypeDetailView(generics.RetrieveUpdateDestroyAPIView):
    serializer_class = WeighingOperationTypeSerializer
    permission_classes = [IsAuthenticated]

    def get_queryset(self):
        resolved = _resolve_user_tenant(self.request.user)
        if isinstance(resolved, _NoTenantProfile):
            return WeighingOperationType.objects.none()
        if resolved is not None:
            return WeighingOperationType.objects.filter(tenant=resolved)
        return WeighingOperationType.objects.all()

    def perform_update(self, serializer):
        instance = self.get_object()
        if instance.is_default:
            allowed_fields = {"is_active", "display_order"}
            if set(serializer.validated_data.keys()) - allowed_fields:
                raise serializers.ValidationError(
                    {
                        "detail": (
                            "Default operation types are shared workflow definitions. "
                            "Organizations may only activate, deactivate, or reorder them."
                        )
                    }
                )
        serializer.save()

    def perform_destroy(self, instance):
        if instance.is_default:
            raise PermissionDenied(
                "Default operation types cannot be deleted. Deactivate them instead."
            )
        instance.delete()


class VehicleTypeCreateUpdateDeleteView(generics.RetrieveUpdateDestroyAPIView):
    serializer_class = VehicleTypeSerializer
    permission_classes = [IsAuthenticated]
    queryset = VehicleType.objects.all()

    def get_queryset(self):
        return _tenant_scoped_reference_queryset(self.queryset, self.request.user)

    def perform_update(self, serializer):
        _require_reference_write_access(self.request.user)
        instance = serializer.save()
        _sync_vehicle_type_product(instance, self.request.user)

    def perform_destroy(self, instance):
        _require_reference_write_access(self.request.user)
        instance.delete()


class VehicleTypeListView(generics.ListCreateAPIView):
    serializer_class = VehicleTypeSerializer
    permission_classes = [IsAuthenticated]
    queryset = VehicleType.objects.all().order_by("name")

    def get_queryset(self):
        resolved = _resolve_user_tenant(self.request.user)
        if resolved is not None and not isinstance(resolved, _NoTenantProfile):
            sync_vehicle_type_products_for_tenant(resolved)
        return _tenant_scoped_reference_queryset(super().get_queryset(), self.request.user)

    def perform_create(self, serializer):
        _require_reference_write_access(self.request.user)
        instance = serializer.save(tenant=_get_request_user_tenant(self.request.user))
        _sync_vehicle_type_product(instance, self.request.user)


class ItemListCreateView(generics.ListCreateAPIView):
    serializer_class = ItemSerializer
    permission_classes = [IsAuthenticated]
    queryset = Item.objects.all().order_by("name")

    def get_queryset(self):
        return _tenant_scoped_reference_queryset(self.queryset, self.request.user)

    def perform_create(self, serializer):
        _require_reference_write_access(self.request.user)
        serializer.save(tenant=_get_request_user_tenant(self.request.user))


class ItemDetailView(generics.RetrieveUpdateDestroyAPIView):
    serializer_class = ItemSerializer
    permission_classes = [IsAuthenticated]
    queryset = Item.objects.all()

    def get_queryset(self):
        return _tenant_scoped_reference_queryset(self.queryset, self.request.user)

    def perform_update(self, serializer):
        _require_reference_write_access(self.request.user)
        serializer.save()

    def perform_destroy(self, instance):
        _require_reference_write_access(self.request.user)
        instance.delete()


# ── CustomerVehicleTypeDiscount CRUD ─────────────────────────────────────────

class CustomerVehicleTypeDiscountSerializer(serializers.ModelSerializer):
    customer_name    = serializers.CharField(source="customer.name", read_only=True)
    vehicle_type_name = serializers.CharField(source="vehicle_type.name", read_only=True)

    class Meta:
        from SL_Weighbridge.models import CustomerVehicleTypeDiscount
        model = CustomerVehicleTypeDiscount
        fields = ["id", "customer", "customer_name", "vehicle_type", "vehicle_type_name", "discounted_charge"]


class CustomerVehicleTypeDiscountListCreateView(generics.ListCreateAPIView):
    permission_classes = [IsAuthenticated]

    def get_serializer_class(self):
        from SL_Weighbridge.models import CustomerVehicleTypeDiscount

        class _Ser(serializers.ModelSerializer):
            customer_name    = serializers.CharField(source="customer.name", read_only=True)
            vehicle_type_name = serializers.CharField(source="vehicle_type.name", read_only=True)
            class Meta:
                model = CustomerVehicleTypeDiscount
                fields = ["id", "customer", "customer_name", "vehicle_type", "vehicle_type_name", "discounted_charge"]
        return _Ser

    def get_queryset(self):
        from SL_Weighbridge.models import CustomerVehicleTypeDiscount
        qs = CustomerVehicleTypeDiscount.objects.select_related("customer", "vehicle_type").order_by("customer__name")
        if cid := self.request.query_params.get("customer_id"):
            qs = qs.filter(customer_id=cid)
        return qs


class CustomerVehicleTypeDiscountDetailView(generics.RetrieveUpdateDestroyAPIView):
    permission_classes = [IsAuthenticated]

    def get_serializer_class(self):
        from SL_Weighbridge.models import CustomerVehicleTypeDiscount

        class _Ser(serializers.ModelSerializer):
            customer_name    = serializers.CharField(source="customer.name", read_only=True)
            vehicle_type_name = serializers.CharField(source="vehicle_type.name", read_only=True)
            class Meta:
                model = CustomerVehicleTypeDiscount
                fields = ["id", "customer", "customer_name", "vehicle_type", "vehicle_type_name", "discounted_charge"]
        return _Ser

    def get_queryset(self):
        from SL_Weighbridge.models import CustomerVehicleTypeDiscount
        return CustomerVehicleTypeDiscount.objects.select_related("customer", "vehicle_type")


# ── Item list (legacy read-only alias kept for backward compat) ───────────────
class ItemListView(ItemListCreateView):
    pass


class CustomerListCreateView(generics.ListCreateAPIView):
    permission_classes = [IsAuthenticated]
    pagination_class = StandardPagination

    def get_serializer_class(self):
        if self.request.method == "POST":
            return CustomerInputSerializer
        return CustomerSerializer

    def list(self, request, *args, **kwargs):
        _require_weighbridge_model_permission(request.user, "view_customer")
        return super().list(request, *args, **kwargs)

    def create(self, request, *args, **kwargs):
        _require_weighbridge_model_permission(request.user, "add_customer")
        return super().create(request, *args, **kwargs)

    def get_queryset(self):
        qs = Customer.objects.all().order_by("name")

        # ── Tenant scoping ────────────────────────────────────────────────────
        # Customer has no direct tenant FK.  We scope by the set of customers
        # that appear in at least one Transaction belonging to the requesting
        # user's tenant — mirroring the pattern used in InvoiceListView.
        # - Superusers: unfiltered global access
        # - Profiled non-superusers: scoped to customers in their tenant's txns
        # - Profileless non-superusers: deny-all (qs.none())
        resolved = _resolve_user_tenant(self.request.user)
        if isinstance(resolved, _NoTenantProfile):
            return qs.none()
        if resolved is not None:  # Tenant object — non-superuser
            qs = qs.filter(
                Q(tenant=resolved) | Q(tenant__isnull=True, transaction__tenant=resolved)
            ).distinct()

        include_deleted = self.request.query_params.get("include_deleted", "false").lower() == "true"
        if not include_deleted:
            qs = qs.filter(is_deleted=False)

        if (is_deleted := self.request.query_params.get("is_deleted")) is not None:
            lowered = is_deleted.lower()
            if lowered in {"true", "false"}:
                qs = qs.filter(is_deleted=(lowered == "true"))

        if (is_active := self.request.query_params.get("is_active")) is not None:
            lowered = is_active.lower()
            if lowered in {"true", "false"}:
                qs = qs.filter(is_active=(lowered == "true"))

        if (discounted := self.request.query_params.get("discounted")) is not None:
            lowered = discounted.lower()
            if lowered in {"true", "false"}:
                qs = qs.filter(discounted=(lowered == "true"))

        if search := self.request.query_params.get("search"):
            qs = qs.filter(
                Q(name__icontains=search) |
                Q(phone_number__icontains=search) |
                Q(email__icontains=search)
            )
        return qs

    def perform_create(self, serializer):
        user_tenant = _get_request_user_tenant(self.request.user)
        serializer.save(tenant=user_tenant)


class CustomerDetailView(generics.RetrieveUpdateDestroyAPIView):
    serializer_class = CustomerSerializer
    permission_classes = [IsAuthenticated]

    def retrieve(self, request, *args, **kwargs):
        _require_weighbridge_model_permission(request.user, "view_customer")
        return super().retrieve(request, *args, **kwargs)

    def update(self, request, *args, **kwargs):
        _require_weighbridge_model_permission(request.user, "change_customer")
        return super().update(request, *args, **kwargs)

    def get_queryset(self):
        qs = Customer.objects.all()
        # ── Tenant scoping ────────────────────────────────────────────────────
        resolved = _resolve_user_tenant(self.request.user)
        if isinstance(resolved, _NoTenantProfile):
            return qs.none()
        if resolved is not None:  # Tenant object — non-superuser
            qs = qs.filter(
                Q(tenant=resolved) | Q(tenant__isnull=True, transaction__tenant=resolved)
            ).distinct()
        return qs

    def destroy(self, request, *args, **kwargs):
        _require_weighbridge_model_permission(request.user, "delete_customer")
        instance = self.get_object()
        instance.is_active = False
        instance.is_deleted = True
        instance.save(update_fields=["is_active", "is_deleted"])
        return Response(status=status.HTTP_204_NO_CONTENT)


class CustomerBulkActionView(APIView):
    permission_classes = [IsAuthenticated]

    def post(self, request):
        serializer = CustomerBulkActionSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)

        ids = serializer.validated_data["ids"]
        action = serializer.validated_data["action"]
        permission = "delete_customer" if action == "soft_delete" else "change_customer"
        _require_weighbridge_model_permission(request.user, permission)

        qs = Customer.objects.filter(id__in=ids)
        resolved = _resolve_user_tenant(request.user)
        if isinstance(resolved, _NoTenantProfile):
            qs = qs.none()
        elif resolved is not None:
            qs = qs.filter(
                Q(tenant=resolved) | Q(tenant__isnull=True, transaction__tenant=resolved)
            ).distinct()

        if action == "activate":
            updated = qs.update(is_active=True, is_deleted=False)
        elif action == "deactivate":
            updated = qs.update(is_active=False)
        else:
            updated = qs.update(is_active=False, is_deleted=True)

        return Response({"updated": updated, "action": action})


class VehicleListCreateView(generics.ListCreateAPIView):
    serializer_class = VehicleSerializer
    permission_classes = [IsAuthenticated]
    pagination_class = StandardPagination

    def list(self, request, *args, **kwargs):
        _require_weighbridge_model_permission(request.user, "view_vehicle")
        return super().list(request, *args, **kwargs)

    def create(self, request, *args, **kwargs):
        _require_weighbridge_model_permission(request.user, "add_vehicle")
        return super().create(request, *args, **kwargs)

    def get_queryset(self):
        qs = Vehicle.objects.select_related("customer", "vehicle_type").order_by("number_plate")

        # ── Tenant scoping ────────────────────────────────────────────────────
        # Vehicle has no direct tenant FK.  We scope by the set of vehicles
        # that appear in at least one Transaction belonging to the requesting
        # user's tenant.
        # - Superusers: unfiltered global access
        # - Profiled non-superusers: scoped to vehicles in their tenant's txns
        # - Profileless non-superusers: deny-all (qs.none())
        resolved = _resolve_user_tenant(self.request.user)
        if isinstance(resolved, _NoTenantProfile):
            return qs.none()
        if resolved is not None:  # Tenant object — non-superuser
            qs = qs.filter(
                Q(tenant=resolved) | Q(tenant__isnull=True, transaction__tenant=resolved)
            ).distinct()

        params = self.request.query_params
        if customer_id := params.get("customer_id"):
            qs = qs.filter(customer_id=customer_id)
        if vehicle_type_id := params.get("vehicle_type_id"):
            qs = qs.filter(vehicle_type_id=vehicle_type_id)
        if is_active := params.get("is_active"):
            qs = qs.filter(is_active=is_active.lower() == "true")
        if search := params.get("search"):
            qs = qs.filter(
                Q(number_plate__icontains=search)
                | Q(customer__name__icontains=search)
                | Q(vehicle_type__name__icontains=search)
            )
        return qs

    def perform_create(self, serializer):
        user_tenant = _get_request_user_tenant(self.request.user)
        customer = serializer.validated_data.get("customer")
        serializer.save(tenant=user_tenant or getattr(customer, "tenant", None))


class VehicleDetailView(generics.RetrieveUpdateDestroyAPIView):
    serializer_class = VehicleSerializer
    permission_classes = [IsAuthenticated]

    def retrieve(self, request, *args, **kwargs):
        _require_weighbridge_model_permission(request.user, "view_vehicle")
        return super().retrieve(request, *args, **kwargs)

    def update(self, request, *args, **kwargs):
        _require_weighbridge_model_permission(request.user, "change_vehicle")
        return super().update(request, *args, **kwargs)

    def destroy(self, request, *args, **kwargs):
        _require_weighbridge_model_permission(request.user, "delete_vehicle")
        return super().destroy(request, *args, **kwargs)

    def get_queryset(self):
        qs = Vehicle.objects.select_related("customer", "vehicle_type")
        # ── Tenant scoping ────────────────────────────────────────────────────
        resolved = _resolve_user_tenant(self.request.user)
        if isinstance(resolved, _NoTenantProfile):
            return qs.none()
        if resolved is not None:  # Tenant object — non-superuser
            qs = qs.filter(
                Q(tenant=resolved) | Q(tenant__isnull=True, transaction__tenant=resolved)
            ).distinct()
        return qs


def _fetch_indicator_url(url: str, timeout: int = 3) -> dict:
    """Fetch a weight indicator HTTP endpoint and normalise the response."""
    req = urllib.request.urlopen(url, timeout=timeout)  # noqa: S310
    raw = _json.loads(req.read().decode())
    # Support both {value, stable} and {weight, stable} shapes
    weight = raw.get("value") if raw.get("value") is not None else raw.get("weight")
    stable = bool(raw.get("stable", False))
    return {"weight": float(weight) if weight is not None else None, "stable": stable}


class LiveWeightView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request):
        if not _has_weighbridge_process_permission(request.user, "can_view_live_weight"):
            return Response({"error": "You do not have permission to view live weight."}, status=status.HTTP_403_FORBIDDEN)
        branch_id = request.query_params.get("branch_id")
        branch = None
        if branch_id:
            try:
                branch = Branch.objects.get(pk=branch_id, id__in=_allowed_branch_ids(request.user))
            except Branch.DoesNotExist:
                pass

        cfg = IndicatorConfig.objects.filter(branch=branch).first() if branch else None

        # Tenant readings are strictly branch-scoped. Never borrow another
        # branch's config or a deployment-wide indicator URL.
        try:
            if cfg and cfg.connection_type == "HTTP" and cfg.live_weight_url:
                reading = _fetch_indicator_url(cfg.live_weight_url)
                return Response({
                    "weight": reading["weight"],
                    "unit": "kg",
                    "stable": reading["stable"],
                    "source": cfg.indicator_name,
                    "configured": True,
                    "connected": True,
                    "status": "connected",
                    "branch_id": branch.id if branch else None,
                    "timestamp": timezone.now().isoformat(),
                })
        except Exception:
            pass

        return Response({
            "weight": None,
            "unit": "kg",
            "stable": False,
            "source": cfg.indicator_name if cfg else "unconfigured",
            "configured": cfg is not None,
            "connected": False,
            "status": "offline" if cfg else "not_configured",
            "branch_id": branch.id if branch else None,
            "timestamp": timezone.now().isoformat(),
        })

class TransactionReceivePaymentView(APIView):
    """
    POST /api/commercial-weighbridge/transactions/<pk>/receive-payment/
    Body: { method: str, reference: str }
    Records a payment decision against a transaction and keeps any linked
    auto-generated invoice in sync. Debt remains outstanding until settled
    through invoice payment or consolidation.
    """
    permission_classes = [IsAuthenticated]

    def post(self, request, pk):
        try:
            tx = _get_tenant_scoped_transaction(
                request.user, pk,
                select_related=["customer", "vehicle", "vehicle_type", "auto_invoice"],
            )
        except Transaction.DoesNotExist:
            return Response({"error": f"Transaction {pk} not found."}, status=status.HTTP_404_NOT_FOUND)

        if tx.payment_status == "Paid":
            return Response(
                {
                    "error": "Payment has already been recorded for this transaction.",
                    "transaction_id": tx.id,
                    "payment_status": tx.payment_status,
                },
                status=status.HTTP_400_BAD_REQUEST,
            )

        method    = (request.data.get("method") or "Cash").strip() or "Cash"
        reference = request.data.get("reference", "")
        is_debt   = method == "Debt"
        next_payment_status = "Pending" if is_debt else "Paid"

        if not is_debt and assert_posting_allowed is not None:
            try:
                assert_posting_allowed(
                    tenant=getattr(tx, "tenant", None),
                    posting_date=timezone.now(),
                    source_label="weighbridge cash sale",
                )
            except ValueError as exc:
                return Response({"error": str(exc)}, status=status.HTTP_400_BAD_REQUEST)

        # Debt should stay outstanding; only settled methods mark the
        # transaction paid immediately.
        payment_received_at = timezone.now() if not is_debt else None

        tx.payment_mode = method
        tx.payment_status = next_payment_status
        tx.payment_reference = reference
        tx.payment_received_at = payment_received_at
        tx.save(update_fields=["payment_mode", "payment_status", "payment_reference", "payment_received_at", "updated_at"])

        try:
            sync_transaction_posting(tx)
        except Exception:
            pass

        invoice_id = None
        invoice_status = None
        invoice_paid_amount = None
        invoice_balance_amount = None
        try:
            auto_inv = tx.auto_invoice
            if auto_inv:
                from Platform_API.modules.payments.views import reconcile_invoice_payment_state
                invoice_id = auto_inv.id
                if is_debt and auto_inv.status == "draft":
                    auto_inv.status = "issued"
                    auto_inv.issued_at = auto_inv.issued_at or timezone.now()
                    auto_inv.save(update_fields=["status", "issued_at"])
                reconciliation = reconcile_invoice_payment_state(auto_inv, persist=True)
                if not is_debt and reconciliation["status"] == "paid":
                    auto_inv.transactions.filter(payment_status="Pending").update(
                        payment_status="Paid",
                        payment_mode=method,
                    )
                    reconciliation = reconcile_invoice_payment_state(auto_inv, persist=True)
                invoice_status = reconciliation["status"]
                invoice_paid_amount = float(reconciliation["paid_amount"])
                invoice_balance_amount = float(reconciliation["balance_amount"])
        except Exception:
            pass

        return Response({
            "success":        True,
            "message":        (
                "Transaction flagged as debt. Linked invoice remains outstanding."
                if is_debt
                else "Payment recorded. Transaction marked as paid."
            ),
            "transaction_id": tx.id,
            "payment_mode":   tx.payment_mode,
            "payment_status": tx.payment_status,
            "reference":      reference,
            "payment_received_at": tx.payment_received_at,
            "invoice_id":     invoice_id,
            "invoice_status": invoice_status,
            "invoice_paid_amount": invoice_paid_amount,
            "invoice_balance_amount": invoice_balance_amount,
            "transaction":    TransactionSerializer(tx).data,
        })


# ── Overweight Surveillance ───────────────────────────────────────────────────


class _OverweightEventSerializer(serializers.ModelSerializer):
    operator_name    = serializers.SerializerMethodField()
    branch_name      = serializers.SerializerMethodField()
    has_discrepancy  = serializers.SerializerMethodField()
    discrepancy_id   = serializers.SerializerMethodField()

    class Meta:
        model = OverweightEvent
        fields = [
            "id", "tenant", "branch", "branch_name",
            "vehicle_plate", "gross_weight", "tare_weight", "net_weight",
            "threshold_at_capture", "recorded_at",
            "operator", "operator_name",
            "linked_transaction", "camera_image",
            "discrepancy_raised", "has_discrepancy", "discrepancy_id",
        ]

    def get_operator_name(self, obj):
        return obj.operator.get_full_name() or obj.operator.username if obj.operator else None

    def get_branch_name(self, obj):
        return obj.branch.name if obj.branch else None

    def get_has_discrepancy(self, obj):
        return hasattr(obj, "discrepancy")

    def get_discrepancy_id(self, obj):
        return obj.discrepancy.id if hasattr(obj, "discrepancy") else None


class _WeighbridgeDiscrepancySerializer(serializers.ModelSerializer):
    resolved_by_name  = serializers.SerializerMethodField()
    branch_name       = serializers.SerializerMethodField()
    vehicle_plate     = serializers.SerializerMethodField()
    net_weight        = serializers.SerializerMethodField()
    recorded_at       = serializers.SerializerMethodField()
    camera_image      = serializers.SerializerMethodField()
    linked_transaction= serializers.SerializerMethodField()

    class Meta:
        model = WeighbridgeDiscrepancy
        fields = [
            "id", "overweight_event", "tenant", "branch", "branch_name",
            "vehicle_plate", "net_weight", "recorded_at", "camera_image",
            "linked_transaction",
            "resolution_status", "resolution_note",
            "resolved_by", "resolved_by_name", "resolved_at",
            "created_at", "updated_at",
        ]
        read_only_fields = [
            "id", "overweight_event", "tenant", "branch",
            "vehicle_plate", "net_weight", "recorded_at", "camera_image",
            "linked_transaction", "resolved_by", "resolved_at",
            "created_at", "updated_at",
        ]

    def get_resolved_by_name(self, obj):
        return obj.resolved_by.get_full_name() or obj.resolved_by.username if obj.resolved_by else None

    def get_branch_name(self, obj):
        return obj.branch.name if obj.branch else None

    def get_vehicle_plate(self, obj):
        return obj.overweight_event.vehicle_plate if obj.overweight_event else None

    def get_net_weight(self, obj):
        return obj.overweight_event.net_weight if obj.overweight_event else None

    def get_recorded_at(self, obj):
        return obj.overweight_event.recorded_at.isoformat() if obj.overweight_event else None

    def get_camera_image(self, obj):
        try:
            req = self.context.get("request")
            img = obj.overweight_event.camera_image
            if img and req:
                return req.build_absolute_uri(img.url)
            return img.url if img else None
        except Exception:
            return None

    def get_linked_transaction(self, obj):
        return obj.overweight_event.linked_transaction_id if obj.overweight_event else None


class _OverweightConfigSerializer(serializers.ModelSerializer):
    class Meta:
        model = OverweightConfig
        fields = [
            "id",
            "branch",
            "threshold_kg",
            "grace_window_minutes",
            "capture_interval_seconds",
            "surveillance_enabled",
        ]


class _CameraConfigSerializer(serializers.ModelSerializer):
    class Meta:
        model = CameraConfig
        fields = [
            "id", "branch", "name", "connection_type", "camera_type",
            "ip_address", "port", "hikvision_channel",
            "username", "other_parameters",
            "capture_on_overweight", "is_active",
        ]
        extra_kwargs = {"password": {"write_only": True}}


def _allowed_branch_ids(user):
    """
    Return a list of Branch PKs that *user* is permitted to access.

    - Superuser          → all branch IDs (None signals global; we return a QS)
    - Tenant user        → only branches belonging to their tenant
    - No-profile user    → empty list (deny-all)

    Returns a QuerySet of Branch PKs (safe to pass to __in= filters).
    """
    resolved = _resolve_user_tenant(user)
    if isinstance(resolved, _NoTenantProfile):
        return Branch.objects.none().values_list("id", flat=True)
    if resolved is None:
        return Branch.objects.all().values_list("id", flat=True)
    return get_operational_branches_for_tenant(resolved).values_list("id", flat=True)


def _require_reference_write_access(user):
    if getattr(user, "is_superuser", False) or _is_weighbridge_tenant_admin(user):
        return
    raise PermissionDenied(
        "Only organization administrators can modify organization reference data."
    )


class OverweightEventListView(generics.ListAPIView):
    """
    GET /api/commercial-weighbridge/overweight-events/
    Query params: branch_id, date_from, date_to, discrepancy_raised, search
    """
    serializer_class = _OverweightEventSerializer
    permission_classes = [IsAuthenticated]
    pagination_class = StandardPagination

    def get_queryset(self):
        qs = OverweightEvent.objects.select_related(
            "branch", "operator", "linked_transaction",
        ).prefetch_related("discrepancy").order_by("-recorded_at")

        # Tenant isolation — use _apply_tenant_filter (handles _NO_PROFILE → none())
        qs = _apply_tenant_filter(qs, self.request.user)

        p = self.request.query_params
        if bid := p.get("branch_id"):
            qs = qs.filter(branch_id=bid)
        if df := p.get("date_from"):
            qs = qs.filter(recorded_at__date__gte=df)
        if dt := p.get("date_to"):
            qs = qs.filter(recorded_at__date__lte=dt)
        if (dr := p.get("discrepancy_raised")) is not None:
            qs = qs.filter(discrepancy_raised=(dr.lower() == "true"))
        if search := (p.get("search") or "").strip():
            qs = qs.filter(
                Q(vehicle_plate__icontains=search)
                | Q(branch__name__icontains=search)
                | Q(operator__username__icontains=search)
                | Q(operator__first_name__icontains=search)
                | Q(operator__last_name__icontains=search)
            )
        return qs


class OverweightEventExportCSVView(APIView):
    """
    GET /api/commercial-weighbridge/overweight-events/export/csv/

    Returns a downloadable CSV of all overweight events matching the same
    date/branch filters as the list view.  Applies the same tenant isolation.

    Query params: branch_id, date_from, date_to, discrepancy_raised, search
    """
    permission_classes = [IsAuthenticated]

    def get(self, request):
        qs = OverweightEvent.objects.select_related(
            "branch", "operator", "linked_transaction",
        ).order_by("-recorded_at")

        # Tenant isolation — same as OverweightEventListView
        qs = _apply_tenant_filter(qs, request.user)

        p = request.query_params
        if bid := p.get("branch_id"):
            qs = qs.filter(branch_id=bid)
        if df := p.get("date_from"):
            qs = qs.filter(recorded_at__date__gte=df)
        if dt := p.get("date_to"):
            qs = qs.filter(recorded_at__date__lte=dt)
        if (dr := p.get("discrepancy_raised")) is not None:
            qs = qs.filter(discrepancy_raised=(dr.lower() == "true"))
        if search := (p.get("search") or "").strip():
            qs = qs.filter(
                Q(vehicle_plate__icontains=search)
                | Q(branch__name__icontains=search)
                | Q(operator__username__icontains=search)
                | Q(operator__first_name__icontains=search)
                | Q(operator__last_name__icontains=search)
            )

        response = HttpResponse(content_type="text/csv")
        response["Content-Disposition"] = 'attachment; filename="overweight_events.csv"'

        writer = csv.writer(response)
        writer.writerow([
            "ID",
            "Date/Time",
            "Vehicle Plate",
            "Branch",
            "Gross Weight (kg)",
            "Tare Weight (kg)",
            "Net Weight (kg)",
            "Threshold (kg)",
            "Excess (kg)",
            "Discrepancy Raised",
            "Linked Transaction",
            "Operator",
        ])

        for ev in qs:
            branch_name = ev.branch.name if ev.branch else ""
            operator_name = (
                ev.operator.get_full_name() or ev.operator.username
                if ev.operator else ""
            )
            gross = ev.gross_weight if ev.gross_weight is not None else ""
            tare  = ev.tare_weight  if ev.tare_weight  is not None else ""
            net   = ev.net_weight
            threshold = ev.threshold_at_capture
            try:
                excess = int(net) - int(threshold)
            except (TypeError, ValueError):
                excess = ""
            linked_tx = (
                f"TX-{ev.linked_transaction_id:05d}"
                if ev.linked_transaction_id else ""
            )
            recorded_at = (
                ev.recorded_at.strftime("%Y-%m-%d %H:%M:%S")
                if ev.recorded_at else ""
            )
            writer.writerow([
                ev.id,
                recorded_at,
                ev.vehicle_plate or "",
                branch_name,
                gross,
                tare,
                net,
                threshold,
                excess,
                "Yes" if ev.discrepancy_raised else "No",
                linked_tx,
                operator_name,
            ])

        return response


class OverweightConfigView(generics.RetrieveUpdateAPIView):
    """
    GET / PUT  /api/commercial-weighbridge/overweight-config/<branch_pk>/
    Creates the config automatically on first GET if it doesn't exist.
    Enforces branch-ownership: tenant users may only access branches in their tenant.
    """
    serializer_class = _OverweightConfigSerializer
    permission_classes = [IsAuthenticated]

    def get_object(self):
        from rest_framework.exceptions import NotFound
        branch_pk = self.kwargs["branch_pk"]

        # Validate that the branch belongs to this user's tenant
        allowed = _allowed_branch_ids(self.request.user)
        if not Branch.objects.filter(pk=branch_pk, id__in=allowed).exists():
            raise NotFound("Branch not found or access denied.")

        obj, _ = OverweightConfig.objects.get_or_create(
            branch_id=branch_pk,
            defaults={
                "threshold_kg": 1000,
                "grace_window_minutes": 30,
                "capture_interval_seconds": 45,
                "surveillance_enabled": True,
            },
        )
        return obj


class CameraConfigListCreateView(generics.ListCreateAPIView):
    """
    GET / POST  /api/commercial-weighbridge/camera-configs/
    Supports ?branch_id= filter.
    Tenant-scoped: only cameras attached to branches in the user's tenant are visible.
    """
    serializer_class = _CameraConfigSerializer
    permission_classes = [IsAuthenticated]

    def get_queryset(self):
        allowed = _allowed_branch_ids(self.request.user)
        qs = CameraConfig.objects.select_related("branch").filter(
            branch_id__in=allowed,
        ).order_by("id")
        if bid := self.request.query_params.get("branch_id"):
            # Further narrow to requested branch (already restricted to allowed set)
            qs = qs.filter(branch_id=bid)
        return qs

    def perform_create(self, serializer):
        from rest_framework.exceptions import PermissionDenied
        branch = serializer.validated_data.get("branch")
        if branch:
            allowed = _allowed_branch_ids(self.request.user)
            if not Branch.objects.filter(pk=branch.pk, id__in=allowed).exists():
                raise PermissionDenied("Branch not found or access denied.")
        serializer.save()


class CameraConfigDetailView(generics.RetrieveUpdateDestroyAPIView):
    """
    GET / PATCH / DELETE  /api/commercial-weighbridge/camera-configs/<pk>/
    Tenant-scoped: users may only touch cameras for branches in their tenant.
    """
    serializer_class = _CameraConfigSerializer
    permission_classes = [IsAuthenticated]

    def get_queryset(self):
        allowed = _allowed_branch_ids(self.request.user)
        return CameraConfig.objects.filter(branch_id__in=allowed)


class CameraConfigPreviewView(APIView):
    """
    GET /api/commercial-weighbridge/camera-configs/preview/?branch_id=<id>

    Returns lightweight preview payloads for the active cameras on a branch.
    The image is proxied through the backend so camera credentials stay server-side.
    """
    permission_classes = [IsAuthenticated]

    def get(self, request):
        branch_id = request.query_params.get("branch_id")
        if not branch_id:
            return Response({"error": "branch_id query parameter is required."}, status=status.HTTP_400_BAD_REQUEST)

        allowed = _allowed_branch_ids(request.user)
        if not Branch.objects.filter(pk=branch_id, id__in=allowed).exists():
            return Response({"error": "Branch not found or access denied."}, status=status.HTTP_404_NOT_FOUND)

        previews = []
        cameras = (
            CameraConfig.objects
            .filter(branch_id=branch_id, is_active=True)
            .order_by("id")[:4]
        )

        for cam in cameras:
            img_bytes = capture_hikvision_snapshot(cam) if cam.camera_type == "hikvision" else None
            previews.append({
                "id": cam.id,
                "name": cam.name or f"Camera {cam.id}",
                "camera_type": cam.camera_type,
                "available": bool(img_bytes),
                "image_data_url": (
                    f"data:image/jpeg;base64,{base64.b64encode(img_bytes).decode('ascii')}"
                    if img_bytes else None
                ),
            })

        return Response({
            "branch_id": int(branch_id),
            "camera_count": len(previews),
            "results": previews,
        })


class CameraPlateRecognitionView(APIView):
    """Recognize a plate from a captured camera image and find its tenant vehicle."""
    permission_classes = [IsAuthenticated]

    def post(self, request):
        _require_weighbridge_model_permission(request.user, "view_vehicle")
        snapshot_serializer = TransactionSerializer(
            data={"camera_snapshot": request.data.get("image")},
            partial=True,
        )
        if not snapshot_serializer.is_valid():
            return Response(
                {"image": snapshot_serializer.errors.get("camera_snapshot", ["A valid camera image is required."])},
                status=status.HTTP_400_BAD_REQUEST,
            )
        image_bytes = snapshot_serializer.validated_data["camera_snapshot"]
        if not image_bytes:
            return Response(
                {"image": ["A valid camera image is required."]},
                status=status.HTTP_400_BAD_REQUEST,
            )

        branch_id = request.data.get("branch_id")
        if branch_id and not Branch.objects.filter(
            pk=branch_id,
            id__in=_allowed_branch_ids(request.user),
        ).exists():
            return Response(
                {"branch_id": "Branch not found or access denied."},
                status=status.HTTP_404_NOT_FOUND,
            )

        try:
            recognition = recognize_plate_image(image_bytes)
        except PlateRecognitionUnavailable as exc:
            return Response({"error": str(exc)}, status=status.HTTP_503_SERVICE_UNAVAILABLE)

        if recognition is None:
            return Response({
                "detected": False,
                "plate": "",
                "confidence": 0,
                "matched": False,
                "vehicle": None,
                "message": "No number plate could be read. Enter it manually or retake the image.",
            })

        vehicles = Vehicle.objects.select_related("customer", "vehicle_type")
        resolved = _resolve_user_tenant(request.user)
        if isinstance(resolved, _NoTenantProfile):
            vehicles = vehicles.none()
        elif resolved is not None:
            vehicles = vehicles.filter(
                Q(tenant=resolved) | Q(tenant__isnull=True, transaction__tenant=resolved)
            ).distinct()

        vehicle = next(
            (
                candidate
                for candidate in vehicles.iterator()
                if normalize_plate(candidate.number_plate) == recognition.plate
            ),
            None,
        )
        return Response({
            "detected": True,
            "plate": recognition.plate,
            "confidence": recognition.confidence,
            "matched": vehicle is not None,
            "vehicle": VehicleSerializer(vehicle, context={"request": request}).data if vehicle else None,
            "message": (
                "Registered vehicle found. Review the populated details before continuing."
                if vehicle
                else "Plate detected but no registered vehicle was found. Correct it or add a vehicle."
            ),
        })


class WeighbridgeDiscrepancyListView(generics.ListAPIView):
    """
    GET /api/commercial-weighbridge/surveillance-discrepancies/
    Query params: branch_id, resolution_status, date_from, date_to, search
    """
    serializer_class = _WeighbridgeDiscrepancySerializer
    permission_classes = [IsAuthenticated]
    pagination_class = StandardPagination

    def get_queryset(self):
        qs = WeighbridgeDiscrepancy.objects.select_related(
            "overweight_event__operator", "branch", "resolved_by",
        ).order_by("-created_at")

        # Tenant isolation — _apply_tenant_filter handles _NO_PROFILE → none()
        qs = _apply_tenant_filter(qs, self.request.user)

        p = self.request.query_params
        if bid := p.get("branch_id"):
            qs = qs.filter(branch_id=bid)
        if rs := p.get("resolution_status"):
            qs = qs.filter(resolution_status=rs)
        if df := p.get("date_from"):
            qs = qs.filter(created_at__date__gte=df)
        if dt := p.get("date_to"):
            qs = qs.filter(created_at__date__lte=dt)
        if search := (p.get("search") or "").strip():
            qs = qs.filter(
                Q(overweight_event__vehicle_plate__icontains=search)
                | Q(branch__name__icontains=search)
                | Q(resolution_note__icontains=search)
                | Q(resolved_by__username__icontains=search)
                | Q(resolved_by__first_name__icontains=search)
                | Q(resolved_by__last_name__icontains=search)
                | Q(overweight_event__operator__username__icontains=search)
                | Q(overweight_event__operator__first_name__icontains=search)
                | Q(overweight_event__operator__last_name__icontains=search)
            )
        return qs


class WeighbridgeDiscrepancyDetailView(APIView):
    """
    GET / PATCH /api/commercial-weighbridge/surveillance-discrepancies/<pk>/
    Body (PATCH): { resolution_status, resolution_note }
    Resolving (status=resolved) stamps resolved_by and resolved_at.
    """
    permission_classes = [IsAuthenticated]

    def _get_obj(self, pk, user):
        qs = WeighbridgeDiscrepancy.objects.select_related("overweight_event", "branch", "resolved_by")
        qs = _apply_tenant_filter(qs, user)
        try:
            return qs.get(pk=pk)
        except WeighbridgeDiscrepancy.DoesNotExist:
            return None

    def get(self, request, pk):
        obj = self._get_obj(pk, request.user)
        if not obj:
            return Response({"error": "Not found."}, status=status.HTTP_404_NOT_FOUND)
        return Response(_WeighbridgeDiscrepancySerializer(obj, context={"request": request}).data)

    def patch(self, request, pk):
        obj = self._get_obj(pk, request.user)
        if not obj:
            return Response({"error": "Not found."}, status=status.HTTP_404_NOT_FOUND)

        new_status = request.data.get("resolution_status", obj.resolution_status)
        note       = request.data.get("resolution_note", obj.resolution_note)

        if new_status not in ("unresolved", "reviewed", "resolved"):
            return Response({"error": "Invalid resolution_status."}, status=status.HTTP_400_BAD_REQUEST)

        obj.resolution_status = new_status
        obj.resolution_note   = note

        if new_status == "resolved" and not obj.resolved_at:
            obj.resolved_by = request.user
            obj.resolved_at = timezone.now()

        obj.save()
        return Response(_WeighbridgeDiscrepancySerializer(obj, context={"request": request}).data)


class CheckDiscrepanciesView(APIView):
    """
    POST /api/commercial-weighbridge/surveillance-discrepancies/check/

    On-demand manual trigger for the discrepancy sweep.
    Runs the same logic as the automated background scheduler but scoped to the
    requesting user's tenant (superusers sweep all tenants).

    Returns { discrepancies_raised: <int> }.
    """
    permission_classes = [IsAuthenticated]

    def post(self, request):
        from SL_Weighbridge.sweep import run_sweep

        # Resolve tenant scope:
        #   - superuser        → tenant=None (global sweep across all tenants)
        #   - profiled user    → tenant=<Tenant> (scoped to their tenant only)
        #   - profileless user → deny-all; return 0 raised
        resolved = _resolve_user_tenant(request.user)
        if isinstance(resolved, _NoTenantProfile):
            return Response({"discrepancies_raised": 0})

        # resolved is either None (superuser → global) or a Tenant object (scoped)
        result = run_sweep(tenant=resolved)
        return Response({"discrepancies_raised": result["created"]})


class SurveillanceMonitorStatusView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request):
        from Platform_Core.platform import get_active_tenant_module_slugs
        from SL_Weighbridge.service_runner import (
            DEFAULT_PRESENCE_INTERVAL,
            DEFAULT_SWEEP_INTERVAL,
            LEASE_SECONDS,
            SERVICE_NAME,
            _get_background_service_lease_model,
            get_runner_status_snapshot,
        )
        from SL_Weighbridge.surveillance import resolve_tenant_for_branch

        branch_id = request.query_params.get("branch_id")
        branch = None
        if branch_id:
            allowed = _allowed_branch_ids(request.user)
            if not Branch.objects.filter(pk=branch_id, id__in=allowed).exists():
                return Response({"error": "Branch not found or access denied."}, status=status.HTTP_404_NOT_FOUND)
            branch = Branch.objects.select_related("company").filter(pk=branch_id).first()

        resolved = resolve_tenant_for_branch(branch) if branch is not None else _resolve_user_tenant(request.user)
        active_module_slugs = []
        tenant_payload = None
        if not isinstance(resolved, _NoTenantProfile) and resolved is not None:
            active_module_slugs = sorted(get_active_tenant_module_slugs(resolved))
            tenant_payload = {
                "id": resolved.id,
                "name": resolved.name,
                "code": resolved.code,
            }

        BackgroundServiceLease = _get_background_service_lease_model()
        lease = BackgroundServiceLease.objects.filter(service_name=SERVICE_NAME).first() if BackgroundServiceLease else None
        fallback_state = get_runner_status_snapshot()
        now = timezone.now()
        metadata = dict(getattr(lease, "metadata", {}) or {})
        if not lease:
            metadata = {
                "last_presence_run_at": fallback_state.get("last_presence_run_at"),
                "last_presence_captured": fallback_state.get("last_presence_captured", 0),
                "last_presence_results": fallback_state.get("last_presence_results", []),
                "last_sweep_run_at": fallback_state.get("last_sweep_run_at"),
                "last_sweep_created": fallback_state.get("last_sweep_created", 0),
                "last_sweep_skipped": fallback_state.get("last_sweep_skipped", 0),
                "last_error_at": fallback_state.get("last_error_at"),
                "last_error": fallback_state.get("last_error"),
            }

        def _row_matches_scope(row):
            if branch is None:
                return True
            if not isinstance(row, dict):
                return False
            row_branch_id = row.get("branch_id")
            if row_branch_id is None:
                return False
            try:
                return int(row_branch_id) == int(branch.id)
            except (TypeError, ValueError):
                return False

        scoped_presence_results = [
            row for row in (metadata.get("last_presence_results", []) or [])
            if _row_matches_scope(row)
        ]
        lease_until = getattr(lease, "lease_until", None) or fallback_state.get("lease_until")
        heartbeat_at = getattr(lease, "heartbeat_at", None) or fallback_state.get("heartbeat_at")
        owner_id = getattr(lease, "owner_id", "") or fallback_state.get("owner_id") or None
        is_running = bool(lease_until and lease_until > now)

        return Response({
            "service_name": SERVICE_NAME,
            "running": is_running,
            "owner_id": owner_id,
            "heartbeat_at": heartbeat_at,
            "lease_until": lease_until,
            "lease_seconds": LEASE_SECONDS,
            "presence_interval_seconds": DEFAULT_PRESENCE_INTERVAL,
            "sweep_interval_seconds": DEFAULT_SWEEP_INTERVAL,
            "last_presence_run_at": metadata.get("last_presence_run_at"),
            "last_presence_captured": sum(1 for row in scoped_presence_results if row.get("captured")),
            "last_presence_results": scoped_presence_results,
            "last_sweep_run_at": metadata.get("last_sweep_run_at"),
            "last_sweep_created": metadata.get("last_sweep_created", 0),
            "last_sweep_skipped": metadata.get("last_sweep_skipped", 0),
            "last_error_at": metadata.get("last_error_at"),
            "last_error": metadata.get("last_error"),
            "tenant": tenant_payload,
            "branch": {
                "id": getattr(branch, "id", None),
                "name": getattr(branch, "name", None),
                "company_name": getattr(getattr(branch, "company", None), "name", None),
            } if branch is not None else None,
            "tenant_has_weighbridge": "weighbridge" in active_module_slugs or "commercial-weighbridge" in active_module_slugs,
            "active_module_slugs": active_module_slugs,
        })


class SurveillanceMonitorTestView(APIView):
    permission_classes = [IsAuthenticated]

    def post(self, request):
        from SL_Weighbridge.presence_monitor import poll_branch_once

        branch_id = request.data.get("branch_id") or request.query_params.get("branch_id")
        if not branch_id:
            return Response({"error": "branch_id is required."}, status=status.HTTP_400_BAD_REQUEST)

        allowed = _allowed_branch_ids(request.user)
        if not Branch.objects.filter(pk=branch_id, id__in=allowed).exists():
            return Response({"error": "Branch not found or access denied."}, status=status.HTTP_404_NOT_FOUND)

        branch = Branch.objects.select_related("company").filter(pk=branch_id).first()
        if branch is None:
            return Response({"error": "Branch not found."}, status=status.HTTP_404_NOT_FOUND)

        result = poll_branch_once(branch)
        return Response(result)
