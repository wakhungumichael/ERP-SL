# Copyright (c) 2026 Siakora Labs Limited. Author: Michael Wakhungu.
import csv
from datetime import timedelta
from io import BytesIO
import logging
import secrets
import string
from pathlib import Path
from types import SimpleNamespace
from xml.sax.saxutils import escape

from django.contrib.auth.models import Group, Permission, User
from django.contrib.auth import logout
from django.conf import settings
from django.core.exceptions import ValidationError as DjangoValidationError
from django.core.validators import validate_email
from django.db import transaction
from django.db.models import Prefetch, Q
from django.shortcuts import get_object_or_404
from django.utils.decorators import method_decorator
from django.utils import timezone
from django.views.decorators.csrf import csrf_exempt
from django.http import FileResponse, HttpResponse, JsonResponse
from reportlab.lib import colors
from reportlab.lib.pagesizes import A4, landscape
from reportlab.lib.styles import getSampleStyleSheet
from reportlab.lib.units import inch
from reportlab.platypus import Paragraph, SimpleDocTemplate, Spacer, Table, TableStyle
from rest_framework import generics
from rest_framework.decorators import api_view, permission_classes
from rest_framework.authentication import BasicAuthentication, TokenAuthentication
from rest_framework import status
from rest_framework.permissions import AllowAny, BasePermission, IsAuthenticated
from rest_framework.parsers import FormParser, JSONParser, MultiPartParser
from rest_framework.views import APIView
from rest_framework.authtoken.models import Token
from rest_framework.exceptions import PermissionDenied, ValidationError

from Platform_Core.integrations import build_integration_health_snapshot, indicator_source_registry
from Platform_Core.email import get_tenant_smtp_connection
from Platform_Core.branch_sync import sync_tenant_branch_to_operational
from Platform_Core.platform import (
    activate_license,
    build_workspace_navigation,
    get_active_tenant_module_slugs,
    get_tenant_module_access,
    sync_plan_subscriptions,
    sync_subscription_modules,
    validate_license,
)
from Platform_Core.template_library import ensure_shared_document_template_library
from Platform_Core.documents import _safe_logo_url, render_document_template_preview
from Platform_Core.backup_service import create_backup_archive, resolve_backup_directory
from Platform_Core.audit import get_record_audit_summary, log_business_event
from Platform_Core.models import (
    AuditAccessLog,
    AuditEventLog,
    BackupPolicy,
    DocumentTemplate,
    Industry,
    IntegrationEndpoint,
    LicenseKey,
    ModuleDefinition,
    OrganizationMembership,
    PlanModule,
    PlatformBrandingSettings,
    PricingRule,
    PricingRuleType,
    SubscriptionPlan,
    SystemNotification,
    SubscriptionBillingRequest,
    Tenant,
    TenantBranch,
    TenantExportJob,
    TenantModuleActivation,
    TenantOffboardingRequest,
    TenantPurgeJob,
    TenantSettings,
    TenantSubscription,
    TenantUserProfile,
    WorkspaceMenuItem,
    WorkspaceMenuSection,
    WorkspaceRoleMenuItem,
    WorkflowDefinition,
    WorkflowEntityBinding,
    WorkflowInboxItem,
    WorkflowNodeDefinition,
    WorkflowStepDefinition,
    WorkflowTransitionDefinition,
)

from .serializers import (
    AuditAccessLogSerializer,
    AuditEventLogSerializer,
    BackupPolicySerializer,
    DocumentTemplateSerializer,
    GroupDetailSerializer,
    IndustrySerializer,
    IntegrationEndpointSerializer,
    LicenseActivationSerializer,
    LicenseKeySerializer,
    LicenseValidationSerializer,
    ModuleDefinitionSerializer,
    OrganizationMembershipSerializer,
    PermissionSummarySerializer,
    PlanModuleSerializer,
    PlatformBrandingSettingsSerializer,
    PricingRuleSerializer,
    PricingRuleTypeSerializer,
    SubscriptionModuleSyncSerializer,
    SubscriptionPlanSerializer,
    SubscriptionBillingRequestSerializer,
    TenantBranchSerializer,
    TenantExportJobSerializer,
    TenantOffboardingRequestSerializer,
    TenantPurgeJobSerializer,
    TenantSettingsSerializer,
    TenantUserProfileSerializer,
    TokenLoginSerializer,
    TenantModuleActivationSerializer,
    TenantSerializer,
    TenantSubscriptionSerializer,
    UserRoleAssignmentSerializer,
    UserProfileSerializer,
    WorkspaceMenuItemSerializer,
    WorkspaceMenuSectionSerializer,
    WorkspaceRoleMenuItemSerializer,
    WorkflowDefinitionSerializer,
    WorkflowEntityBindingSerializer,
    WorkflowInboxItemSerializer,
    WorkflowNodeDefinitionSerializer,
    WorkflowStepDefinitionSerializer,
    WorkflowTransitionDefinitionSerializer,
)
from rest_framework.permissions import BasePermission
from Platform_API.modules.shared_serializers import (
    PROTECTED_SHARED_ROLE_NAMES,
    TENANT_ASSIGNABLE_SHARED_ROLE_NAMES,
    tenant_role_prefix,
)

from Platform_API.modules.api import error_response, request_scope, success_response
from Platform_API.modules.mixins import (
    NO_TENANT_ACCESS,
    ModuleAPIViewMixin,
    TenantScopedQuerysetMixin,
    resolve_user_tenant,
)


logger = logging.getLogger(__name__)


def _gen_password(length=12):
    alphabet = string.ascii_letters + string.digits
    return ''.join(secrets.choice(alphabet) for _ in range(length))


def _smtp_delivery_error(exc):
    """Return a useful SMTP error without exposing server responses or secrets."""
    import smtplib
    import socket
    import ssl

    if isinstance(exc, smtplib.SMTPAuthenticationError):
        return "SMTP authentication failed. Check the mailbox username and password."
    if isinstance(exc, socket.gaierror):
        return "The SMTP hostname could not be resolved. Check the hostname and DNS settings."
    if isinstance(exc, (TimeoutError, socket.timeout)):
        return "The SMTP server did not respond in time. Check the port and server firewall."
    if isinstance(exc, (ConnectionRefusedError, smtplib.SMTPConnectError, smtplib.SMTPServerDisconnected)):
        return "The SMTP server refused or closed the connection. Check the host, port, and encryption setting."
    if isinstance(exc, ssl.SSLError):
        return "The SMTP server rejected the selected encryption or certificate settings."
    if isinstance(exc, (ConnectionError, OSError)):
        return "The SMTP server could not be reached. Check its host, port, and firewall."
    return "The SMTP server rejected the message."


def _frontend_url(request, path):
    configured_url = getattr(settings, "ERP_FRONTEND_URL", "").rstrip("/")
    if configured_url:
        return f"{configured_url}{path}"
    # During local Vite development the API proxy has a different Host header,
    # while Origin still points to the browser-facing application.
    if settings.DEBUG:
        browser_origin = str(request.headers.get("Origin") or "").rstrip("/")
        if browser_origin.startswith(("http://localhost:", "http://127.0.0.1:")):
            return f"{browser_origin}{path}"
    if request.get_host().split(":", 1)[0] in {"localhost", "127.0.0.1"}:
        return f"http://localhost:5173{path}"
    return request.build_absolute_uri(path)


# ── Permission helpers ─────────────────────────────────────────────────────────

def _is_superadmin(user):
    """True only for platform superusers (is_superuser=True).
    Tenant admins have is_staff=True but is_superuser=False — they are NOT superadmins."""
    return user.is_authenticated and user.is_superuser


class IsSuperAdminPermission(BasePermission):
    """DRF permission class: only platform superusers (is_superuser=True) may access."""
    message = "You must be a platform administrator to perform this action."

    def has_permission(self, request, view):
        return _is_superadmin(request.user)


def _require_superadmin(request):
    """Return an error Response if the caller is not a superadmin, else None."""
    if not _is_superadmin(request.user):
        return error_response(
            "You must be a platform administrator to perform this action.",
            status_code=status.HTTP_403_FORBIDDEN,
        )
    return None


def _require_tenant_access(request, tenant):
    """
    Return an error Response if the caller is neither a superadmin nor a
    tenant-admin whose profile is scoped to *this* tenant.  Else None.
    """
    if _is_superadmin(request.user):
        return None
    if _user_has_tenant_access(request.user, tenant, require_admin=True):
        return None
    return error_response(
        "You do not have permission to access this tenant's resources.",
        status_code=status.HTTP_403_FORBIDDEN,
    )


def _tenant_offboarding_retention_until(*, days=None):
    retention_days = 30
    if days not in (None, ""):
        try:
            retention_days = max(0, int(days))
        except (TypeError, ValueError):
            raise ValidationError({"retention_days": "retention_days must be a whole number."})
    return timezone.now() + timedelta(days=retention_days)


def _is_tenant_admin(user):
    membership = _active_organization_membership(user, require_admin=True)
    if membership:
        return True
    profile = getattr(user, "tenant_profile", None)
    return bool(profile and profile.is_tenant_admin and profile.tenant_id)


def _owner_tenant_code():
    configured = getattr(settings, "DEFAULT_TENANT_CODE", "") or ""
    return configured


def _is_owner_tenant(tenant):
    if tenant is None:
        return False
    owner_codes = {code for code in {_owner_tenant_code(), "siakora-labs"} if code}
    return tenant.code in owner_codes


def _public_site_tenant():
    owner_codes = [code for code in {_owner_tenant_code(), "siakora-labs"} if code]
    tenant = Tenant.objects.filter(code__in=owner_codes).order_by("name").first()
    if tenant:
        return tenant
    return Tenant.objects.filter(is_active=True).order_by("name").first()


def _platform_branding_settings():
    """Return the singleton public SaaS profile without using tenant state."""
    profile, _ = PlatformBrandingSettings.objects.get_or_create(pk=1)
    return profile


def _public_branding_source(tenant=None, explicit_tenant=False):
    """Resolve public branding without leaking tenant changes into the SaaS shell."""
    if explicit_tenant and tenant is not None:
        settings_obj, _ = TenantSettings.objects.get_or_create(tenant=tenant, defaults={"invoice_prefix": "INV"})
        return tenant, settings_obj, "tenant"

    platform_profile = _platform_branding_settings()
    if platform_profile.branding_mode == PlatformBrandingSettings.MODE_DEDICATED and platform_profile.dedicated_tenant_id:
        dedicated_tenant = platform_profile.dedicated_tenant
        settings_obj, _ = TenantSettings.objects.get_or_create(tenant=dedicated_tenant, defaults={"invoice_prefix": "INV"})
        return dedicated_tenant, settings_obj, "dedicated"
    return None, platform_profile, "platform"


def _resolve_saas_billing_gateway(*, tenant):
    if tenant is None:
        return None
    return IntegrationEndpoint.objects.filter(
        tenant=tenant,
        is_active=True,
        integration_type__in={"payment", "payment_gateway"},
        connection_settings__payment_scope="saas_billing",
    ).order_by("-is_primary", "name").first()


def _auto_create_subscription_billing_request(*, subscription, requested_by):
    tenant = getattr(subscription, "tenant", None)
    plan = getattr(subscription, "plan", None)
    metadata = getattr(subscription, "metadata", {}) or {}
    if tenant is None or plan is None:
        return None, False, "Subscription context is incomplete."

    if str(subscription.status or "").lower() == "trial":
        return None, False, "Trial subscriptions do not trigger billing requests."

    if not metadata.get("auto_start_billing_request"):
        return None, False, "Automatic billing prompt was left off for this subscription change."

    owner_tenant = _public_site_tenant()
    gateway = _resolve_saas_billing_gateway(tenant=owner_tenant)
    if gateway is None:
        return None, False, "No active SaaS billing gateway is configured yet."

    existing = SubscriptionBillingRequest.objects.filter(
        tenant=tenant,
        subscription=subscription,
        status__in={"draft", "initiated", "pending"},
    ).order_by("-created_at").first()
    if existing is not None:
        return existing, False, "An open billing request already exists for this subscription."

    phone_number = str(getattr(tenant, "contact_phone", "") or "").strip()
    if gateway.provider == "mpesa" and not phone_number:
        return None, False, "Add an organization contact phone number to auto-create M-Pesa billing requests."

    status_value = "pending" if gateway.provider == "mpesa" else "initiated"
    billing_request = SubscriptionBillingRequest.objects.create(
        tenant=tenant,
        subscription=subscription,
        gateway=gateway,
        requested_by=requested_by,
        payment_provider=gateway.provider or "",
        amount=subscription.amount or plan.price,
        currency=subscription.currency or plan.currency,
        phone_number=phone_number,
        status=status_value,
        external_reference=f"{tenant.code}:{subscription.id}",
        request_payload={
            "gateway_scope": gateway.connection_settings.get("payment_scope"),
            "gateway_provider": gateway.provider,
            "subscription_status": subscription.status,
            "subscription_plan": plan.code,
            "auto_created": True,
            "simulated_gateway_stage": "awaiting_customer_confirmation" if gateway.provider == "mpesa" else "awaiting_provider_execution",
        },
        response_payload={
            "message": (
                "M-Pesa sandbox request initiated automatically from subscription setup."
                if gateway.provider == "mpesa"
                else "Billing request recorded automatically from subscription setup."
            ),
            "provider": gateway.provider,
            "environment": gateway.connection_settings.get("environment") or "production",
            "auto_created": True,
        },
    )
    return billing_request, True, "Billing request created automatically."


def _default_login_page_config(tenant):
    platform_name = _platform_branding_settings().platform_name if tenant is None else "SL ERP"
    return {
        "eyebrow": platform_name,
        "title": platform_name,
        "subtitle": f"{platform_name} for small businesses, growing companies, and large enterprises.",
        "description": "A scalable business system built to support everyday operations, finance, billing, and control at every stage of growth.",
        "show_landing_page_link": True,
        "show_public_registration": True,
        "show_pricing_card": True,
    }


def _default_landing_page_config(tenant):
    platform_name = _platform_branding_settings().platform_name if tenant is None else "SL ERP"
    return {
        "eyebrow": platform_name,
        "headline": f"{platform_name} for small businesses, growing companies, and large enterprises.",
        "subheadline": "Manage finance, operations, inventory, HR, CRM, support, and approvals in one connected business system.",
        "description": (
            "Replace scattered tools with one scalable ERP built for visibility, speed, "
            "control, and better decisions across every department."
        ),
        "primary_cta_label": "Start Subscription",
        "primary_cta_url": "/login",
        "secondary_cta_label": "View Plans",
        "secondary_cta_url": "#plans",
        "highlights": [
            "Order to cash with billing and collections",
            "Procurement, approvals, and supplier control",
            "Inventory, operations, and live reporting",
        ],
        "enabled": True,
    }


def _default_support_page_config(tenant):
    tenant_name = tenant.name if tenant else _platform_branding_settings().platform_name or getattr(settings, "PLATFORM_NAME", "SL-ERP Platform")
    return {
        "eyebrow": "Customer Support",
        "headline": "How can we help today?",
        "subheadline": f"Contact {tenant_name} for support, billing, account, or service questions.",
        "description": "Share the details below and our team will guide your request to the right people.",
        "primary_cta_label": "Send Request",
        "secondary_cta_label": "Check Request Status",
        "form_title": "Send us a request",
        "form_description": "Tell us what you need and we will route it to the best team to help you.",
        "tracking_title": "Check your request status",
        "tracking_description": "Enter your request number and email address to see the latest progress.",
        "status_title": "Current update",
        "success_title": "Request received",
        "success_description": "Please keep your request number for future follow-up.",
        "highlights": [
            "Reach the right team faster",
            "Receive clear status updates",
            "Stay within your branded support experience",
        ],
    }


def _normalize_footer_menu(menu_items):
    if not isinstance(menu_items, list):
        return []
    normalized = []
    for item in menu_items:
        if not isinstance(item, dict):
            continue
        label = str(item.get("label") or "").strip()
        href = str(item.get("href") or "").strip()
        if not label or not href:
            continue
        normalized.append({"label": label, "href": href})
    return normalized


def _public_site_modules_queryset():
    internal_slugs = {"platform-core", "users-access", "workspace-admin", "tenant-admin"}
    return (
        ModuleDefinition.objects.filter(is_active=True)
        .exclude(scope="platform_admin")
        .exclude(category="core")
        .exclude(slug__in=internal_slugs)
        .order_by("category", "name")
    )


def _validate_payment_integration_scope(*, tenant, payload):
    if not tenant:
        return None

    integration_type = str(payload.get("integration_type") or "").strip().lower()
    provider = str(payload.get("provider") or "").strip().lower()
    if integration_type not in {"payment", "payment_gateway"} and provider not in {
        "mpesa", "bank", "stripe", "flutterwave", "pesapal", "manual", "cash",
    }:
        return None

    connection_settings = payload.get("connection_settings") or {}
    if not isinstance(connection_settings, dict):
        connection_settings = {}

    requested_scope = connection_settings.get("payment_scope") or "tenant_operations"
    is_owner_tenant = _is_owner_tenant(tenant)

    if requested_scope == "saas_billing" and not is_owner_tenant:
        return error_response(
            "Only the SaaS owner tenant may configure payment providers for SaaS billing.",
            status_code=status.HTTP_403_FORBIDDEN,
        )

    if requested_scope != "tenant_operations" and not is_owner_tenant:
        return error_response(
            "Non-owner tenants may only configure payment providers for tenant collections.",
            status_code=status.HTTP_403_FORBIDDEN,
        )

    return None


def _request_tenant_or_none(user):
    resolved = resolve_user_tenant(user)
    return None if resolved is NO_TENANT_ACCESS else resolved


PROTECTED_PERMISSION_APP_LABELS = {
    "Platform_Core",
    "admin",
    "auth",
    "authtoken",
    "contenttypes",
    "sessions",
}

# Platform_Core contains both SaaS-control models and tenant-scoped accounting
# models.  Only this allow-list is safe for organization administrators to put
# into their own roles.
TENANT_MANAGEABLE_PLATFORM_CORE_MODELS = {
    "account",
    "accountingperiod",
    "accountingperiodauditlog",
    "accountingpostingrule",
    "bankreconciliationsession",
    "bankstatementline",
    "documenttemplate",
    "financialyear",
    "journal",
    "journalentry",
    "journalentryline",
    "workflowdefinition",
    "workflowentitybinding",
    "workflowinboxitem",
    "workflownodedefinition",
    "workflowstepdefinition",
    "workflowtransitiondefinition",
}

# Audit evidence is tenant-scoped by default. Tenant administrators may grant
# review and export of their own organization's logs, but never cross-tenant
# (global) visibility.
TENANT_AUDIT_PERMISSION_CODENAMES = {
    "view_tenant_audit_logs",
    "view_tenant_access_logs",
    "export_audit_logs",
}

TENANT_WORKSPACE_PERMISSION_CODENAMES = {
    "can_view_workspace_dashboard",
    "can_access_finance_workspace",
    "can_view_erp_reports",
    "can_view_weighbridge_overview",
    "can_view_sales_overview",
    "can_view_inventory_overview",
    "can_view_finance_overview",
    "can_view_crm_overview",
    "can_view_ticketing_overview",
    "can_view_manufacturing_overview",
    "can_view_retail_overview",
    "can_view_services_overview",
    "can_view_procurement_overview",
    "can_view_budgeting_overview",
    "can_view_hr_overview",
}

# Permission content types use Django app labels while subscriptions use module
# slugs. This keeps tenant role management within the organization's plan.
TENANT_PERMISSION_MODULE_SLUGS = {
    "SL_Weighbridge": {"weighbridge", "commercial-weighbridge"},
    "SL_Budgeting": {"budgeting"},
    "SL_CRM": {"crm"},
    "SL_HR": {"hr-payroll"},
    "SL_Procurement": {"procurement"},
    "SL_Sales": {"sales"},
    "SL_Inventory": {"inventory"},
    "SL_Ticketing": {"ticketing"},
}


def _tenant_admin_profile(user):
    if not user.is_authenticated or user.is_superuser:
        return None
    profile = TenantUserProfile.objects.filter(user=user, is_tenant_admin=True).select_related("tenant").first()
    if profile:
        return profile
    membership = _active_organization_membership(user, require_admin=True)
    if membership:
        return SimpleNamespace(
            tenant=membership.tenant,
            tenant_id=membership.tenant_id,
            branch=membership.branch,
            branch_id=membership.branch_id,
            is_tenant_admin=True,
            membership=membership,
        )
    return None


def _organization_membership_queryset(user):
    if not user.is_authenticated:
        return OrganizationMembership.objects.none()
    return OrganizationMembership.objects.filter(user=user, is_active=True).select_related("tenant", "branch")


def _active_organization_membership(user, require_admin=False):
    memberships = _organization_membership_queryset(user)
    if require_admin:
        memberships = memberships.filter(is_org_admin=True)
    return memberships.order_by("-is_default", "tenant__name").first()


def _user_has_tenant_access(user, tenant, require_admin=False):
    if not user.is_authenticated or tenant is None:
        return False
    membership_qs = _organization_membership_queryset(user).filter(tenant=tenant)
    if require_admin:
        membership_qs = membership_qs.filter(is_org_admin=True)
    if membership_qs.exists():
        return True
    profile = getattr(user, "tenant_profile", None)
    if not profile or profile.tenant_id != tenant.pk:
        return False
    return bool(profile.is_tenant_admin) if require_admin else True


def _sync_legacy_tenant_profile(user):
    if not user or not user.is_authenticated:
        return
    membership = _active_organization_membership(user)
    profile = getattr(user, "tenant_profile", None)

    if membership is None:
        if profile:
            profile.tenant = None
            profile.branch = None
            profile.is_tenant_admin = False
            profile.job_title = ""
            profile.save(update_fields=["tenant", "branch", "is_tenant_admin", "job_title", "updated_at"])
        return

    if profile is None:
        profile = TenantUserProfile.objects.create(
            user=user,
            tenant=membership.tenant,
            branch=membership.branch,
            is_tenant_admin=membership.is_org_admin,
            job_title=membership.job_title or "",
        )
        user.tenant_profile = profile
        return

    profile.tenant = membership.tenant
    profile.branch = membership.branch
    profile.is_tenant_admin = membership.is_org_admin
    profile.job_title = membership.job_title or ""
    profile.save(update_fields=["tenant", "branch", "is_tenant_admin", "job_title", "updated_at"])


def _resolve_membership_role(role_group_name, is_org_admin):
    normalized = (role_group_name or "").strip().lower()
    if normalized == "tenant admin" or is_org_admin:
        return "system_admin"
    if normalized == "finance":
        return "finance"
    if normalized == "operator":
        return "operator"
    return "member"


def _tenant_visible_roles_queryset(user):
    if _is_superadmin(user):
        return Group.objects.all()
    profile = _tenant_admin_profile(user)
    if not profile:
        return Group.objects.none()
    return Group.objects.filter(
        Q(name__in=TENANT_ASSIGNABLE_SHARED_ROLE_NAMES)
        | Q(name__startswith=tenant_role_prefix(profile.tenant_id))
    )


def _role_belongs_to_tenant(group, tenant_id):
    return group.name.startswith(tenant_role_prefix(tenant_id))


def _tenant_manageable_permissions_queryset(tenant):
    # The permission editor is a role template, not a subscription screen.  It
    # must expose every tenant-safe ERP module so roles can be configured before
    # a module is licensed.  Subscription checks still decide whether that
    # module appears in the live workspace.
    tenant_app_labels = list(TENANT_PERMISSION_MODULE_SLUGS)
    return Permission.objects.select_related("content_type").filter(
        Q(content_type__app_label__in=tenant_app_labels)
        | Q(
            content_type__app_label="Platform_Core",
            content_type__model__in=TENANT_MANAGEABLE_PLATFORM_CORE_MODELS,
        )
        | Q(
            content_type__app_label="Platform_Core",
            content_type__model="tenantsettings",
            codename__in=TENANT_WORKSPACE_PERMISSION_CODENAMES,
        )
        | Q(
            content_type__app_label="Platform_Core",
            content_type__model__in=["auditeventlog", "auditaccesslog"],
            codename__in=TENANT_AUDIT_PERMISSION_CODENAMES,
        )
    )


def _validate_tenant_role_permissions(permission_list, *, tenant):
    allowed_ids = set(_tenant_manageable_permissions_queryset(tenant).values_list("id", flat=True))
    disallowed = [perm.id for perm in permission_list if perm.id not in allowed_ids]
    if disallowed:
        raise ValidationError(
            {"permission_ids": "Tenant administrators may only assign tenant-manageable permissions."}
        )


def _roles_with_visible_permissions_queryset(user):
    roles = _tenant_visible_roles_queryset(user)
    if _is_superadmin(user):
        return roles.prefetch_related("permissions__content_type")

    profile = _tenant_admin_profile(user)
    if not profile:
        return roles.none()
    return roles.prefetch_related(
        Prefetch(
            "permissions",
            queryset=_tenant_manageable_permissions_queryset(profile.tenant).order_by(
                "content_type__app_label", "content_type__model", "codename"
            ),
        )
    )


def _validate_tenant_role_name(name, *, tenant_id, exclude_group_id=None):
    label = str(name or "").strip()
    if not label:
        raise ValidationError({"name": "Role name is required."})
    reserved = {role_name.lower() for role_name in PROTECTED_SHARED_ROLE_NAMES | TENANT_ASSIGNABLE_SHARED_ROLE_NAMES}
    if label.lower() in reserved:
        raise ValidationError({"name": "This role name is reserved. Choose a different tenant role name."})

    internal_name = f"{tenant_role_prefix(tenant_id)}{label}"
    existing = Group.objects.filter(name__iexact=internal_name)
    if exclude_group_id:
        existing = existing.exclude(pk=exclude_group_id)
    if existing.exists():
        raise ValidationError({"name": "A role with this name already exists in your tenant."})
    return label, internal_name


def _can_view_global_audit_logs(user):
    return _request_tenant_or_none(user) is None and (
        user.is_superuser or user.has_perm("Platform_Core.view_global_audit_logs")
    )


def _can_view_tenant_audit_logs(user):
    return _can_view_global_audit_logs(user) or user.has_perm("Platform_Core.view_tenant_audit_logs")


def _can_export_audit_logs(user):
    return bool(getattr(user, "is_superuser", False) or user.has_perm("Platform_Core.export_audit_logs"))


def _can_view_global_access_logs(user):
    return _request_tenant_or_none(user) is None and (
        user.is_superuser or user.has_perm("Platform_Core.view_global_access_logs")
    )


def _can_view_tenant_access_logs(user):
    return _can_view_global_access_logs(user) or user.has_perm("Platform_Core.view_tenant_access_logs")


@api_view(["GET"])
def platform_overview(request):
    return success_response(
        "Platform overview loaded successfully.",
        data={
            "scope": request_scope(request),
            "platform": {
                "name": settings.PLATFORM_NAME,
                "code": settings.PLATFORM_CODE,
                "default_tenant_code": settings.DEFAULT_TENANT_CODE,
            },
            "catalog": {
                "tenants": Tenant.objects.count(),
                "plans": SubscriptionPlan.objects.count(),
                "modules": ModuleDefinition.objects.count(),
                "subscriptions": TenantSubscription.objects.count(),
                "licenses": LicenseKey.objects.count(),
                "integrations": IntegrationEndpoint.objects.count(),
            },
            "module_routes": {
                "platform": request.build_absolute_uri("/api/platform/"),
                "payments": request.build_absolute_uri("/api/payments/"),
                "accounting": request.build_absolute_uri("/api/accounting/"),
                "commercial_weighbridge": request.build_absolute_uri("/api/commercial-weighbridge/"),
            },
            "auth_routes": {
                "status": request.build_absolute_uri("/api/platform/auth/status/"),
                "login": request.build_absolute_uri("/api/platform/auth/token/"),
                "me": request.build_absolute_uri("/api/platform/auth/me/"),
                "logout": request.build_absolute_uri("/api/platform/auth/logout/"),
            },
            "operations": {
                "module_access": request.build_absolute_uri("/api/platform/module-access/"),
                "workspace_navigation": request.build_absolute_uri("/api/platform/workspace/navigation/"),
                "workspace_menu_sections": request.build_absolute_uri("/api/platform/workspace/menu-sections/"),
                "workspace_menu_items": request.build_absolute_uri("/api/platform/workspace/menu-items/"),
                "workspace_menu_access": request.build_absolute_uri("/api/platform/workspace/menu-access/"),
                "users": request.build_absolute_uri("/api/platform/users/"),
                "roles": request.build_absolute_uri("/api/platform/roles/"),
                "permissions": request.build_absolute_uri("/api/platform/permissions/"),
                "industries": request.build_absolute_uri("/api/platform/industries/"),
                "pricing_rule_types": request.build_absolute_uri("/api/platform/pricing-rule-types/"),
                "pricing_rules": request.build_absolute_uri("/api/platform/pricing-rules/"),
                "subscription_sync_example": request.build_absolute_uri("/api/platform/subscriptions/{id}/sync-modules/"),
                "license_activate_example": request.build_absolute_uri("/api/platform/licenses/{id}/activate/"),
                "license_validate_example": request.build_absolute_uri("/api/platform/licenses/{id}/validate/"),
                "integration_health": request.build_absolute_uri("/api/platform/integrations/health/"),
                "indicator_registry": request.build_absolute_uri("/api/platform/indicators/source-registry/"),
            },
        },
    )


class AuthStatusAPIView(APIView):
    permission_classes = (AllowAny,)

    def get(self, request):
        user = request.user if request.user.is_authenticated else None
        return success_response(
            "Authentication status loaded successfully.",
            data={
                "authenticated": bool(user),
                "authentication_classes": [
                    "session",
                    "basic",
                    "token",
                ],
                "write_access_requires_authentication": True,
                "user": UserProfileSerializer(user).data if user else None,
            },
        )


class PublicSiteConfigurationAPIView(APIView):
    permission_classes = (AllowAny,)
    authentication_classes = ()

    def get(self, request):
        tenant_code = request.GET.get("tenant_code")
        tenant_id = request.GET.get("tenant_id")
        explicit_tenant = bool(tenant_code or tenant_id)
        if tenant_code:
            tenant = Tenant.objects.filter(code=tenant_code, is_active=True).first()
            if tenant is None:
                return error_response("Tenant public site not found.", status_code=status.HTTP_404_NOT_FOUND)
        elif tenant_id:
            tenant = Tenant.objects.filter(pk=tenant_id, is_active=True).first()
            if tenant is None:
                return error_response("Tenant public site not found.", status_code=status.HTTP_404_NOT_FOUND)
        else:
            tenant = None
        resolved_tenant, settings_obj, site_scope = _public_branding_source(
            tenant=tenant,
            explicit_tenant=explicit_tenant,
        )

        if site_scope == "platform":
            serialized_settings = PlatformBrandingSettingsSerializer(settings_obj, context={"request": request}).data
        else:
            serialized_settings = TenantSettingsSerializer(settings_obj, context={"request": request}).data
        login_page_config = {
            **_default_login_page_config(resolved_tenant),
            **(serialized_settings.get("login_page_config") or {}),
        }
        landing_page_config = {
            **_default_landing_page_config(resolved_tenant),
            **(serialized_settings.get("landing_page_config") or {}),
        }
        support_page_config = {
            **_default_support_page_config(resolved_tenant),
            **((serialized_settings.get("landing_page_config") or {}).get("support_page") or {}),
        }
        plans = SubscriptionPlan.objects.filter(is_active=True).prefetch_related("modules").order_by("price", "name")
        public_modules = _public_site_modules_queryset()

        return success_response(
            "Public site configuration loaded.",
            data={
                "tenant": TenantSerializer(resolved_tenant).data if resolved_tenant else None,
                "branding": {
                    "logo_url": serialized_settings.get("logo_url") or "",
                    "primary_color": serialized_settings.get("primary_color") or "#E85D26",
                    "footer_text": serialized_settings.get("footer_text")
                    or "Built for small businesses, growing companies, and large enterprises that need one reliable business system.",
                    "support_email": serialized_settings.get("support_email") or "",
                },
                "login_page": login_page_config,
                "landing_page": landing_page_config,
                "support_page": support_page_config,
                "footer_menu": _normalize_footer_menu(serialized_settings.get("footer_menu")),
                "plans": SubscriptionPlanSerializer(plans, many=True).data,
                "modules": ModuleDefinitionSerializer(public_modules, many=True).data,
                "site_scope": site_scope,
            },
        )


class PublicWebManifestAPIView(APIView):
    """Serve a tenant-branded install manifest without requiring sign-in."""
    permission_classes = (AllowAny,)
    authentication_classes = ()

    def get(self, request):
        tenant_code = request.GET.get("tenant_code", "").strip()
        tenant = Tenant.objects.filter(code=tenant_code, is_active=True).first() if tenant_code else None
        resolved_tenant, settings_obj, _ = _public_branding_source(
            tenant=tenant,
            explicit_tenant=bool(tenant_code),
        )
        name = (
            getattr(settings_obj, "workspace_name", "")
            or getattr(settings_obj, "platform_name", "")
            or getattr(resolved_tenant, "name", "")
            or "Business Workspace"
        )
        logo_url = _safe_logo_url(settings_obj, request) if settings_obj else ""
        payload = {
            "name": name,
            "short_name": name[:32],
            "start_url": "/",
            "display": "standalone",
            "background_color": "#fffaf5",
            "theme_color": getattr(settings_obj, "primary_color", "") or "#e85d26",
            "icons": [{"src": logo_url or "/favicon.svg", "sizes": "any", "type": "image/svg+xml", "purpose": "any maskable"}],
        }
        return JsonResponse(payload, content_type="application/manifest+json")


@method_decorator(csrf_exempt, name="dispatch")
class TokenLoginAPIView(APIView):
    authentication_classes = ()
    permission_classes = (AllowAny,)

    def post(self, request):
        serializer = TokenLoginSerializer(data=request.data, context={"request": request})
        serializer.is_valid(raise_exception=True)
        user = serializer.validated_data["user"]
        token, created = Token.objects.get_or_create(user=user)
        return success_response(
            "Authentication token issued successfully.",
            data={
                "token": token.key,
                "token_created": created,
                "user": UserProfileSerializer(user).data,
            },
        )


@method_decorator(csrf_exempt, name="dispatch")
class PublicRegistrationAPIView(APIView):
    authentication_classes = ()
    permission_classes = (AllowAny,)

    def post(self, request):
        tenant_code = str(request.data.get("tenant_code") or "").strip()
        if tenant_code:
            tenant = Tenant.objects.filter(code=tenant_code, is_active=True).first()
            if tenant is None:
                return error_response("Organization was not found.", status_code=status.HTTP_404_NOT_FOUND)
            tenant_settings, _ = TenantSettings.objects.get_or_create(
                tenant=tenant,
                defaults={"invoice_prefix": "INV"},
            )
            login_config = tenant_settings.login_page_config or {}
            if login_config.get("show_public_registration") is False:
                return error_response(
                    "This organization does not allow public account registration. Contact its administrator for access.",
                    status_code=status.HTTP_403_FORBIDDEN,
                )

        full_name = str(request.data.get("name") or "").strip()
        email = str(request.data.get("email") or "").strip().lower()
        password = str(request.data.get("password") or "")

        if not full_name:
            return error_response("Name is required.", status_code=status.HTTP_400_BAD_REQUEST)
        if not email:
            return error_response("Email is required.", status_code=status.HTTP_400_BAD_REQUEST)
        if not password:
            return error_response("Password is required.", status_code=status.HTTP_400_BAD_REQUEST)
        if len(password) < 8:
            return error_response(
                "Password must be at least 8 characters.",
                status_code=status.HTTP_400_BAD_REQUEST,
            )
        if User.objects.filter(email__iexact=email).exists():
            return error_response(
                "A user with this email already exists.",
                status_code=status.HTTP_400_BAD_REQUEST,
            )

        first_name, _, trailing_name = full_name.partition(" ")
        last_name = trailing_name.strip()

        with transaction.atomic():
            base_username = email.split("@")[0].lower().replace(".", "_").replace("+", "_")
            username = base_username
            counter = 1
            while User.objects.filter(username=username).exists():
                username = f"{base_username}{counter}"
                counter += 1

            new_user = User.objects.create_user(
                username=username,
                email=email,
                first_name=first_name,
                last_name=last_name,
                password=password,
                is_active=True,
                is_staff=False,
                is_superuser=False,
            )

            group, _ = Group.objects.get_or_create(name="Tenant Admin")
            new_user.groups.add(group)

            token, created = Token.objects.get_or_create(user=new_user)

        return success_response(
            "Account created successfully.",
            data={
                "token": token.key,
                "token_created": created,
                "user": UserProfileSerializer(new_user).data,
            },
            status=status.HTTP_201_CREATED,
        )


@method_decorator(csrf_exempt, name="dispatch")
class ForgotPasswordAPIView(APIView):
    authentication_classes = ()
    permission_classes = (AllowAny,)

    def post(self, request):
        identifier = str(request.data.get("identifier") or request.data.get("email") or request.data.get("username") or "").strip()
        tenant_code = str(request.data.get("tenant_code") or "").strip()
        if not identifier:
            return error_response(
                "Email or username is required.",
                status_code=status.HTTP_400_BAD_REQUEST,
            )

        tenant = None
        if tenant_code:
            tenant = Tenant.objects.filter(code=tenant_code, is_active=True).first()
            if tenant is None:
                return success_response(
                    "If the account exists, a password reset message will be sent shortly.",
                    data={"email_sent": False},
                )

        lookup = Q(email__iexact=identifier) | Q(username__iexact=identifier)
        users = list(
            User.objects.filter(lookup, is_active=True)
            .prefetch_related("organization_memberships__tenant", "tenant_profile__tenant")
            .distinct()
        )

        target_user = None
        target_tenant = tenant
        if tenant is not None:
            for candidate in users:
                membership_exists = OrganizationMembership.objects.filter(
                    user=candidate,
                    tenant=tenant,
                    is_active=True,
                ).exists()
                profile = getattr(candidate, "tenant_profile", None)
                if membership_exists or (profile and profile.tenant_id == tenant.id):
                    target_user = candidate
                    break
        elif users:
            target_user = users[0]
            membership = _active_organization_membership(target_user)
            if membership:
                target_tenant = membership.tenant
            else:
                profile = getattr(target_user, "tenant_profile", None)
                target_tenant = getattr(profile, "tenant", None)

        if target_user is None or target_tenant is None:
            return success_response(
                "If the account exists, a password reset message will be sent shortly.",
                data={"email_sent": False},
            )

        settings_obj, _ = TenantSettings.objects.get_or_create(
            tenant=target_tenant,
            defaults={"invoice_prefix": "INV"},
        )
        if not settings_obj.smtp_host or not settings_obj.smtp_user:
            return error_response(
                "Password reset email is not configured for this organization yet. Contact your administrator.",
                status_code=status.HTTP_400_BAD_REQUEST,
            )

        if not target_user.email:
            # Keep the response non-enumerating while avoiding a reset that the
            # account holder could never receive.
            return success_response(
                "If the account exists, a password reset message will be sent shortly.",
                data={"email_sent": False},
            )

        temp_password = _gen_password(12)

        try:
            from django.core.mail import EmailMessage

            connection = get_tenant_smtp_connection(settings_obj)
            login_path = f"/login/{target_tenant.code}" if target_tenant.code else "/login"
            login_url = _frontend_url(request, login_path)
            email = EmailMessage(
                subject=f"{target_tenant.name} password reset",
                body=(
                    f"Hello {target_user.first_name or target_user.username},\n\n"
                    f"A password reset was requested for your {target_tenant.name} workspace.\n\n"
                    f"Username: {target_user.username}\n"
                    f"Temporary password: {temp_password}\n"
                    f"Login URL: {login_url}\n\n"
                    "Please sign in and change your password immediately.\n"
                ),
                from_email=settings_obj.support_email or settings_obj.smtp_user,
                to=[target_user.email],
                connection=connection,
            )
            email.send()
            # Do not invalidate the current password unless delivery succeeded.
            target_user.set_password(temp_password)
            target_user.save(update_fields=["password"])
        except Exception as exc:
            return error_response(
                f"Password reset email could not be sent: {exc}",
                status_code=status.HTTP_502_BAD_GATEWAY,
            )

        return success_response(
            "Password reset email sent successfully.",
            data={"email_sent": True},
        )


class CurrentUserAPIView(APIView):
    permission_classes = (IsAuthenticated,)

    def get(self, request):
        return success_response(
            "Current user loaded successfully.",
            data=UserProfileSerializer(request.user).data,
        )

    def patch(self, request):
        """Allow every signed-in user to maintain their own account details."""
        user = request.user
        update_fields = []

        for field in ("first_name", "last_name"):
            if field in request.data:
                setattr(user, field, str(request.data.get(field) or "").strip())
                update_fields.append(field)

        if "email" in request.data:
            email = str(request.data.get("email") or "").strip()
            if email:
                try:
                    validate_email(email)
                except DjangoValidationError:
                    return error_response("Enter a valid email address.", status_code=status.HTTP_400_BAD_REQUEST)
                if User.objects.exclude(pk=user.pk).filter(email__iexact=email).exists():
                    return error_response("A user with this email already exists.", status_code=status.HTTP_400_BAD_REQUEST)
            user.email = email
            update_fields.append("email")

        if "username" in request.data:
            username = str(request.data.get("username") or "").strip()
            if not username:
                return error_response("Username cannot be blank.", status_code=status.HTTP_400_BAD_REQUEST)
            if User.objects.exclude(pk=user.pk).filter(username__iexact=username).exists():
                return error_response("A user with this username already exists.", status_code=status.HTTP_400_BAD_REQUEST)
            user.username = username
            update_fields.append("username")

        if update_fields:
            user.save(update_fields=update_fields)

        return success_response("Profile updated successfully.", data=UserProfileSerializer(user).data)


class ChangePasswordAPIView(APIView):
    permission_classes = (IsAuthenticated,)

    def post(self, request):
        current_password = str(request.data.get("current_password") or "")
        new_password = str(request.data.get("new_password") or "")
        confirmation = str(request.data.get("new_password_confirmation") or "")

        if not current_password or not new_password:
            return error_response("Enter your current password and a new password.", status_code=status.HTTP_400_BAD_REQUEST)
        if not request.user.check_password(current_password):
            return error_response("Your current password is incorrect.", status_code=status.HTTP_400_BAD_REQUEST)
        if len(new_password) < 8:
            return error_response("Your new password must be at least 8 characters long.", status_code=status.HTTP_400_BAD_REQUEST)
        if not confirmation:
            return error_response("Confirm your new password.", status_code=status.HTTP_400_BAD_REQUEST)
        if new_password != confirmation:
            return error_response("Your new password and confirmation do not match.", status_code=status.HTTP_400_BAD_REQUEST)
        if current_password == new_password:
            return error_response("Choose a new password that differs from your current password.", status_code=status.HTTP_400_BAD_REQUEST)

        request.user.set_password(new_password)
        request.user.save(update_fields=["password"])
        return success_response("Password changed successfully. You can continue using your current session.")


class SwitchOrganizationAPIView(APIView):
    permission_classes = (IsAuthenticated,)

    def post(self, request):
        if _is_superadmin(request.user):
            return error_response(
                "Platform superadmins do not use organization switching.",
                status_code=status.HTTP_400_BAD_REQUEST,
            )

        membership_id = request.data.get("membership_id")
        tenant_id = request.data.get("tenant_id")
        memberships = _organization_membership_queryset(request.user)

        membership = None
        if membership_id:
            membership = memberships.filter(pk=membership_id).first()
        elif tenant_id:
            membership = memberships.filter(tenant_id=tenant_id).order_by("-is_default", "id").first()

        if membership is None:
            return error_response(
                "Organization membership not found for this user.",
                status_code=status.HTTP_404_NOT_FOUND,
            )

        with transaction.atomic():
            memberships.update(is_default=False)
            membership.is_default = True
            membership.save(update_fields=["is_default", "updated_at"])
            _sync_legacy_tenant_profile(request.user)

        return success_response(
            "Active organization switched successfully.",
            data=UserProfileSerializer(request.user).data,
        )


class WorkspaceNavigationAPIView(APIView):
    permission_classes = (IsAuthenticated,)

    def get(self, request):
        tenant_id = request.GET.get("tenant_id")
        tenant_code = request.GET.get("tenant_code")
        tenant = None
        if tenant_id:
            tenant = Tenant.objects.filter(pk=tenant_id).first()
        elif tenant_code:
            tenant = Tenant.objects.filter(code=tenant_code).first()
        elif not _is_superadmin(request.user):
            tenant = _request_tenant_or_none(request.user)

        workspace = build_workspace_navigation(user=request.user, tenant=tenant)
        return success_response(
            "Workspace navigation loaded successfully.",
            data={
                "scope": request_scope(request),
                "tenant": TenantSerializer(tenant).data if tenant else None,
                "user": UserProfileSerializer(request.user).data,
                "workspace": workspace,
            },
        )


@method_decorator(csrf_exempt, name="dispatch")
class TokenLogoutAPIView(APIView):
    authentication_classes = (TokenAuthentication, BasicAuthentication)
    permission_classes = (IsAuthenticated,)

    def post(self, request):
        token_key = None
        if hasattr(request, "auth") and request.auth:
            token_key = getattr(request.auth, "key", None)
            if token_key:
                Token.objects.filter(key=token_key).delete()
        logout(request)
        return success_response(
            "Authentication session cleared successfully.",
            data={
                "token_revoked": bool(token_key),
            },
        )


class ActiveRoleAPIView(APIView):
    """Switch the current user's active role within their active organization."""

    permission_classes = (IsAuthenticated,)

    def post(self, request):
        try:
            role_id = int(request.data.get("role_id"))
        except (TypeError, ValueError):
            return error_response("role_id is required.", status_code=status.HTTP_400_BAD_REQUEST)

        role = request.user.groups.filter(pk=role_id).first()
        if role is None:
            return error_response("You can only switch to a role assigned to your account.", status_code=status.HTTP_403_FORBIDDEN)
        membership = (
            OrganizationMembership.objects.filter(user=request.user, is_active=True, is_default=True).first()
            or OrganizationMembership.objects.filter(user=request.user, is_active=True).order_by("tenant__name").first()
        )
        if membership is None:
            return error_response("No active organization membership was found.", status_code=status.HTTP_400_BAD_REQUEST)
        membership.active_role_group_name = role.name
        membership.save(update_fields=["active_role_group_name", "updated_at"])
        return success_response("Active role switched.", data=UserProfileSerializer(request.user).data)


class _SuperAdminRequired:
    """
    Mixin that enforces is_superuser=True on ALL DRF action methods.
    Applies to list, retrieve, create, update, partial_update, and destroy.
    """

    def _deny_if_not_superadmin(self, request):
        if not _is_superadmin(request.user):
            from rest_framework.response import Response
            return Response(
                {"message": "You must be a platform administrator to perform this action.", "status_code": 403},
                status=status.HTTP_403_FORBIDDEN,
            )
        return None

    def list(self, request, *args, **kwargs):
        resp = self._deny_if_not_superadmin(request)
        return resp or super().list(request, *args, **kwargs)

    def retrieve(self, request, *args, **kwargs):
        resp = self._deny_if_not_superadmin(request)
        return resp or super().retrieve(request, *args, **kwargs)

    def create(self, request, *args, **kwargs):
        resp = self._deny_if_not_superadmin(request)
        return resp or super().create(request, *args, **kwargs)

    def update(self, request, *args, **kwargs):
        resp = self._deny_if_not_superadmin(request)
        return resp or super().update(request, *args, **kwargs)

    def partial_update(self, request, *args, **kwargs):
        resp = self._deny_if_not_superadmin(request)
        return resp or super().partial_update(request, *args, **kwargs)

    def destroy(self, request, *args, **kwargs):
        resp = self._deny_if_not_superadmin(request)
        return resp or super().destroy(request, *args, **kwargs)


class PlatformUserListAPIView(ModuleAPIViewMixin, generics.ListAPIView):
    """
    Superadmins see all users.
    Organization admins see only users belonging to their own organization.
    All others are denied.
    """
    queryset = User.objects.prefetch_related(
        "groups",
        "user_permissions",
        "tenant_profile__tenant",
        "organization_memberships__tenant",
        "organization_memberships__branch",
    ).all()
    serializer_class = UserProfileSerializer
    search_fields = ("username", "first_name", "last_name", "email")
    ordering_fields = ("username", "date_joined", "last_login", "is_active", "is_staff")

    def list(self, request, *args, **kwargs):
        if not _is_superadmin(request.user):
            profile = _tenant_admin_profile(request.user)
            if not profile:
                return error_response(
                    "You must be a platform or organization administrator to view users.",
                    status_code=status.HTTP_403_FORBIDDEN,
                )
        return super().list(request, *args, **kwargs)

    def get_queryset(self):
        qs = super().get_queryset()
        if _is_superadmin(self.request.user):
            return qs
        # Organization admins see only users in their own organization
        profile = _tenant_admin_profile(self.request.user)
        if profile:
            return qs.filter(
                Q(tenant_profile__tenant=profile.tenant)
                | Q(organization_memberships__tenant=profile.tenant, organization_memberships__is_active=True)
            ).filter(is_superuser=False).distinct()
        return qs.none()


class PlatformUserDetailAPIView(generics.RetrieveAPIView):
    queryset = User.objects.prefetch_related(
        "groups",
        "user_permissions",
        "tenant_profile__tenant",
        "organization_memberships__tenant",
        "organization_memberships__branch",
    ).all()
    serializer_class = UserProfileSerializer

    def get_object(self):
        obj = super().get_object()
        user = self.request.user
        if _is_superadmin(user):
            return obj
        # Own profile is always accessible
        if obj.pk == user.pk:
            return obj
        # Organization admins may only see users in their own organization
        profile = getattr(user, "tenant_profile", None)
        target_profile = getattr(obj, "tenant_profile", None)
        if (
            profile and profile.is_tenant_admin
            and target_profile
            and target_profile.tenant_id == profile.tenant_id
            and not obj.is_superuser
        ):
            return obj
        from rest_framework.exceptions import PermissionDenied
        raise PermissionDenied("You do not have permission to view this user.")


class PlatformUserRoleAssignmentAPIView(APIView):
    permission_classes = (IsAuthenticated,)

    def post(self, request, pk):
        # Superadmin: full access.
        # Organization admin: may only assign non-privileged groups to users in own organization.
        # Others: forbidden.
        caller_is_superadmin = _is_superadmin(request.user)
        caller_profile = getattr(request.user, "tenant_profile", None)
        caller_is_tenant_admin = caller_profile and caller_profile.is_tenant_admin

        if not caller_is_superadmin and not caller_is_tenant_admin:
            return error_response(
                "You must be a platform or organization administrator to assign roles.",
                status_code=status.HTTP_403_FORBIDDEN,
            )

        try:
            target_user = User.objects.prefetch_related("groups").get(pk=pk)
        except User.DoesNotExist:
            return error_response("User not found.", status_code=status.HTTP_404_NOT_FOUND)

        if not caller_is_superadmin:
            # Organization admin must only act on users in their own organization —
            # use an explicit DB query to avoid OneToOneField getattr edge cases.
            target_profile = TenantUserProfile.objects.filter(user=target_user).first()
            if not target_profile or target_profile.tenant_id != caller_profile.tenant_id:
                return error_response(
                    "You may only manage users within your own organization.",
                    status_code=status.HTTP_403_FORBIDDEN,
                )
            if target_profile.is_tenant_admin or target_user.groups.filter(name__in=PROTECTED_SHARED_ROLE_NAMES).exists():
                return error_response(
                    "Only platform administrators may change a tenant administrator's roles.",
                    status_code=status.HTTP_403_FORBIDDEN,
                )

        serializer = UserRoleAssignmentSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        groups = serializer.validated_data["group_ids"]
        replace_existing = serializer.validated_data.get("replace_existing", True)

        if not caller_is_superadmin:
            # Prevent escalation: organization admins may not grant privileged groups
            for g in groups:
                if g.name in PROTECTED_SHARED_ROLE_NAMES:
                    return error_response(
                        f"You do not have permission to assign the '{g.name}' role.",
                        status_code=status.HTTP_403_FORBIDDEN,
                    )
                if g.name not in TENANT_ASSIGNABLE_SHARED_ROLE_NAMES and not _role_belongs_to_tenant(
                    g, caller_profile.tenant_id
                ):
                    return error_response(
                        f"You do not have permission to assign the '{g.name}' role.",
                        status_code=status.HTTP_403_FORBIDDEN,
                    )

        if replace_existing:
            target_user.groups.set(groups)
        else:
            target_user.groups.add(*groups)

        return success_response(
            "User roles assigned successfully.",
            data=UserProfileSerializer(target_user).data,
        )


class PlatformRoleListAPIView(ModuleAPIViewMixin, generics.ListCreateAPIView):
    queryset = Group.objects.prefetch_related("permissions__content_type").all()
    serializer_class = GroupDetailSerializer
    search_fields = ("name",)
    ordering_fields = ("name",)

    def list(self, request, *args, **kwargs):
        if not _is_superadmin(request.user) and not _tenant_admin_profile(request.user):
            return error_response(
                "You must be a platform or organization administrator to view roles.",
                status_code=status.HTTP_403_FORBIDDEN,
            )
        return super().list(request, *args, **kwargs)

    def get_queryset(self):
        return _roles_with_visible_permissions_queryset(self.request.user)

    def get_serializer_context(self):
        context = super().get_serializer_context()
        profile = _tenant_admin_profile(self.request.user)
        context.update(
            {
                "tenant_id": getattr(profile, "tenant_id", None),
                "is_superadmin": _is_superadmin(self.request.user),
            }
        )
        return context

    def create(self, request, *args, **kwargs):
        if _is_superadmin(request.user):
            return super().create(request, *args, **kwargs)
        profile = _tenant_admin_profile(request.user)
        if not profile:
            return error_response(
                "You must be an organization administrator to create roles.",
                status_code=status.HTTP_403_FORBIDDEN,
            )

        payload = request.data.copy()
        _, internal_name = _validate_tenant_role_name(payload.get("name"), tenant_id=profile.tenant_id)
        serializer = self.get_serializer(data=payload)
        serializer.is_valid(raise_exception=True)
        permissions = serializer.validated_data.get("permissions", [])
        _validate_tenant_role_permissions(permissions, tenant=profile.tenant)
        role = serializer.save(name=internal_name)
        headers = self.get_success_headers(serializer.data)
        output = self.get_serializer(role)
        from rest_framework.response import Response

        return Response(output.data, status=status.HTTP_201_CREATED, headers=headers)


class PlatformRoleDetailAPIView(generics.RetrieveUpdateDestroyAPIView):
    queryset = Group.objects.prefetch_related("permissions__content_type").all()
    serializer_class = GroupDetailSerializer

    def get_queryset(self):
        return _roles_with_visible_permissions_queryset(self.request.user)

    def get_serializer_context(self):
        context = super().get_serializer_context()
        profile = _tenant_admin_profile(self.request.user)
        context.update(
            {
                "tenant_id": getattr(profile, "tenant_id", None),
                "is_superadmin": _is_superadmin(self.request.user),
            }
        )
        return context

    def retrieve(self, request, *args, **kwargs):
        if not _is_superadmin(request.user) and not _tenant_admin_profile(request.user):
            return error_response(
                "You must be a platform or organization administrator to view roles.",
                status_code=status.HTTP_403_FORBIDDEN,
            )
        return super().retrieve(request, *args, **kwargs)

    def update(self, request, *args, **kwargs):
        if _is_superadmin(request.user):
            return super().update(request, *args, **kwargs)
        profile = _tenant_admin_profile(request.user)
        if not profile:
            return error_response(
                "You must be an organization administrator to update roles.",
                status_code=status.HTTP_403_FORBIDDEN,
            )
        instance = self.get_object()
        if not _role_belongs_to_tenant(instance, profile.tenant_id):
            return error_response(
                "Only platform administrators may modify shared or protected roles.",
                status_code=status.HTTP_403_FORBIDDEN,
            )

        payload = request.data.copy()
        save_kwargs = {}
        if "name" in payload:
            _, internal_name = _validate_tenant_role_name(
                payload.get("name"),
                tenant_id=profile.tenant_id,
                exclude_group_id=instance.pk,
            )
            save_kwargs["name"] = internal_name
        serializer = self.get_serializer(instance, data=payload, partial=kwargs.get("partial", False))
        serializer.is_valid(raise_exception=True)
        permissions = serializer.validated_data.get("permissions")
        if permissions is not None:
            _validate_tenant_role_permissions(permissions, tenant=profile.tenant)
        serializer.save(**save_kwargs)
        from rest_framework.response import Response

        return Response(self.get_serializer(instance).data)

    def partial_update(self, request, *args, **kwargs):
        kwargs["partial"] = True
        return self.update(request, *args, **kwargs)

    def destroy(self, request, *args, **kwargs):
        if _is_superadmin(request.user):
            return super().destroy(request, *args, **kwargs)
        profile = _tenant_admin_profile(request.user)
        if not profile:
            return error_response(
                "You must be an organization administrator to delete roles.",
                status_code=status.HTTP_403_FORBIDDEN,
            )
        instance = self.get_object()
        if not _role_belongs_to_tenant(instance, profile.tenant_id):
            return error_response(
                "Only platform administrators may delete shared or protected roles.",
                status_code=status.HTTP_403_FORBIDDEN,
            )
        return super().destroy(request, *args, **kwargs)


class PlatformPermissionListAPIView(ModuleAPIViewMixin, generics.ListAPIView):
    permission_classes = [IsAuthenticated]
    # Return all ~200 permissions unpaginated — the Roles UI needs the full list at once
    pagination_class = None
    queryset = Permission.objects.select_related("content_type").order_by(
        "content_type__app_label", "content_type__model", "codename"
    )
    serializer_class = PermissionSummarySerializer
    filterset_fields = {
        "content_type__app_label": ["exact", "in"],
        "content_type__model": ["exact", "in"],
    }
    search_fields = ("name", "codename", "content_type__app_label", "content_type__model")
    ordering_fields = ("content_type__app_label", "content_type__model", "codename", "name")

    def list(self, request, *args, **kwargs):
        if not _is_superadmin(request.user) and not _tenant_admin_profile(request.user):
            return error_response(
                "You must be a platform or organization administrator to view permissions.",
                status_code=status.HTTP_403_FORBIDDEN,
            )
        return super().list(request, *args, **kwargs)

    def get_queryset(self):
        qs = super().get_queryset()
        if _is_superadmin(self.request.user):
            return qs
        profile = _tenant_admin_profile(self.request.user)
        if not profile:
            return qs.none()
        return _tenant_manageable_permissions_queryset(profile.tenant)


class WorkspaceMenuSectionListCreateAPIView(ModuleAPIViewMixin, generics.ListCreateAPIView):
    permission_classes = [IsSuperAdminPermission]
    queryset = WorkspaceMenuSection.objects.select_related("module").prefetch_related("items").all()
    serializer_class = WorkspaceMenuSectionSerializer
    filterset_fields = ("module", "is_active", "is_system")
    search_fields = ("key", "title", "description")
    ordering_fields = ("sort_order", "title", "created_at", "updated_at")


class WorkspaceMenuSectionDetailAPIView(generics.RetrieveUpdateDestroyAPIView):
    permission_classes = [IsSuperAdminPermission]
    queryset = WorkspaceMenuSection.objects.select_related("module").prefetch_related("items").all()
    serializer_class = WorkspaceMenuSectionSerializer


class WorkspaceMenuItemListCreateAPIView(ModuleAPIViewMixin, generics.ListCreateAPIView):
    permission_classes = [IsSuperAdminPermission]
    queryset = WorkspaceMenuItem.objects.select_related("section", "required_module").all()
    serializer_class = WorkspaceMenuItemSerializer
    filterset_fields = ("section", "required_module", "is_active", "is_external")
    search_fields = ("key", "title", "description", "route_path", "api_path", "required_permission")
    ordering_fields = ("sort_order", "title", "created_at", "updated_at")


class WorkspaceMenuItemDetailAPIView(generics.RetrieveUpdateDestroyAPIView):
    permission_classes = [IsSuperAdminPermission]
    queryset = WorkspaceMenuItem.objects.select_related("section", "required_module").all()
    serializer_class = WorkspaceMenuItemSerializer


class WorkspaceRoleMenuAccessListCreateAPIView(ModuleAPIViewMixin, generics.ListCreateAPIView):
    permission_classes = [IsSuperAdminPermission]
    queryset = WorkspaceRoleMenuItem.objects.select_related("group", "menu_item", "menu_item__section").all()
    serializer_class = WorkspaceRoleMenuItemSerializer
    filterset_fields = ("group", "menu_item", "can_view")
    search_fields = ("group__name", "menu_item__title", "menu_item__key", "menu_item__section__title")
    ordering_fields = ("group__name", "menu_item__sort_order", "created_at", "updated_at")


class WorkspaceRoleMenuAccessDetailAPIView(generics.RetrieveUpdateDestroyAPIView):
    permission_classes = [IsSuperAdminPermission]
    queryset = WorkspaceRoleMenuItem.objects.select_related("group", "menu_item", "menu_item__section").all()
    serializer_class = WorkspaceRoleMenuItemSerializer


class IsWorkflowConfigurationPermission(BasePermission):
    """Keep workflow design rights in the role system instead of relying on hidden UI controls."""

    def has_permission(self, request, view):
        permission = {
            "GET": "view_workflowdefinition",
            "POST": "add_workflowdefinition",
            "PUT": "change_workflowdefinition",
            "PATCH": "change_workflowdefinition",
            "DELETE": "delete_workflowdefinition",
        }.get(request.method, "change_workflowdefinition")
        return _workflow_admin_allowed(request.user, permission)


class WorkflowDefinitionListCreateAPIView(ModuleAPIViewMixin, generics.ListCreateAPIView):
    permission_classes = [IsWorkflowConfigurationPermission]
    queryset = WorkflowDefinition.objects.select_related("tenant", "module").prefetch_related(
        "entity_bindings",
        "steps__approval_group",
        "nodes__approval_group",
        "nodes__assigned_user",
        "transitions__from_node",
        "transitions__to_node",
    ).all()
    serializer_class = WorkflowDefinitionSerializer
    filterset_fields = ("tenant", "module", "entity_type", "status", "is_active")
    search_fields = ("code", "name", "entity_type", "description")
    ordering_fields = ("name", "code", "created_at", "updated_at")

    def get_queryset(self):
        qs = super().get_queryset()
        if _is_superadmin(self.request.user):
            return qs
        tenant = _request_tenant_or_none(self.request.user)
        return qs.filter(tenant=tenant) if tenant else qs.none()

    def perform_create(self, serializer):
        request_tenant = _request_tenant_or_none(self.request.user)
        explicit_tenant = serializer.validated_data.get("tenant")

        if _is_superadmin(self.request.user):
            resolved_tenant = explicit_tenant or request_tenant
            if resolved_tenant is None:
                raise ValidationError(
                    {"tenant_id": "Workflow creation requires an organization. Provide tenant_id or use an organization-linked account."}
                )
            serializer.save(tenant=resolved_tenant)
            return

        if request_tenant is None:
            raise ValidationError(
                {"tenant_id": "Your account is not linked to an organization, so workflows cannot be created."}
            )

        serializer.save(tenant=request_tenant)


class WorkflowDefinitionDetailAPIView(generics.RetrieveUpdateDestroyAPIView):
    permission_classes = [IsWorkflowConfigurationPermission]
    queryset = WorkflowDefinition.objects.select_related("tenant", "module").prefetch_related(
        "entity_bindings",
        "steps__approval_group",
        "nodes__approval_group",
        "nodes__assigned_user",
        "transitions__from_node",
        "transitions__to_node",
    ).all()
    serializer_class = WorkflowDefinitionSerializer

    def get_queryset(self):
        qs = super().get_queryset()
        if _is_superadmin(self.request.user):
            return qs
        tenant = _request_tenant_or_none(self.request.user)
        return qs.filter(tenant=tenant) if tenant else qs.none()

    def update(self, request, *args, **kwargs):
        workflow = self.get_object()
        if workflow.status == "published":
            raise ValidationError({"status": "Published workflows are immutable. Create a draft revision before changing this route."})
        return super().update(request, *args, **kwargs)

    def destroy(self, request, *args, **kwargs):
        workflow = self.get_object()
        if workflow.status == "published":
            raise ValidationError({"status": "Published workflows cannot be deleted. Archive the workflow instead."})
        return super().destroy(request, *args, **kwargs)


def _workflow_admin_allowed(user, permission_codename):
    """Use the existing role model while allowing organization administrators to operate their tenant."""
    return bool(
        _is_superadmin(user)
        or _active_organization_membership(user, require_admin=True)
        or getattr(getattr(user, "tenant_profile", None), "is_tenant_admin", False)
        or user.has_perm(f"Platform_Core.{permission_codename}")
    )


def _validate_workflow_definition(workflow):
    """Return publish blockers and warnings without executing document-specific logic."""
    errors, warnings = [], []
    bindings = list(workflow.entity_bindings.filter(is_active=True))
    nodes = list(workflow.nodes.filter(is_active=True).order_by("step_order", "id"))
    transitions = list(workflow.transitions.filter(is_active=True).select_related("from_node", "to_node"))

    if not bindings:
        errors.append("Add an active ERP document binding before publishing.")
    if not nodes:
        errors.append("Add at least one active approval node before publishing.")
        return errors, warnings
    initial_nodes = [node for node in nodes if node.is_initial]
    if len(initial_nodes) != 1:
        errors.append("Exactly one active initial node is required.")
    for node in nodes:
        if node.node_type in {"approval", "review", "task"} and not (node.approval_group_id or node.assigned_user_id):
            errors.append(f"{node.name} needs an approver role, committee, or user.")
    node_ids = {node.id for node in nodes}
    for transition in transitions:
        if transition.from_node_id not in node_ids or transition.to_node_id not in node_ids:
            errors.append("Every active transition must connect active nodes in this workflow.")
        if transition.condition_operator != "always" and not transition.condition_field:
            errors.append(f"{transition.name} needs a record field before a condition can be evaluated.")
    if nodes and not any(node.node_type == "end" for node in nodes):
        warnings.append("No explicit end node is configured; the final approval node will complete the workflow.")
    if nodes and not transitions and len(nodes) > 1:
        errors.append("Connect all approval nodes with transitions before publishing.")
    return errors, warnings


class WorkflowDefinitionActionAPIView(APIView):
    """Lifecycle actions keep publication and revision creation out of generic CRUD endpoints."""

    permission_classes = [IsAuthenticated]

    def post(self, request, pk, action):
        workflow = get_object_or_404(WorkflowDefinition.objects.prefetch_related("entity_bindings", "nodes", "transitions"), pk=pk)
        if not _is_superadmin(request.user) and workflow.tenant_id != getattr(_request_tenant_or_none(request.user), "id", None):
            raise PermissionDenied("This workflow does not belong to your organization.")

        required_permission = {
            "validate": "change_workflowdefinition",
            "publish": "publish_workflowdefinition",
            "deactivate": "change_workflowdefinition",
            "archive": "archive_workflowdefinition",
            "duplicate": "duplicate_workflowdefinition",
        }.get(action)
        if not required_permission or not _workflow_admin_allowed(request.user, required_permission):
            raise PermissionDenied("You do not have permission to perform this workflow action.")

        errors, warnings = _validate_workflow_definition(workflow)
        if action == "validate":
            return success_response("Workflow validation completed.", data={"valid": not errors, "errors": errors, "warnings": warnings})
        if action == "publish":
            if errors:
                return error_response("Workflow cannot be published.", errors={"errors": errors, "warnings": warnings}, status_code=status.HTTP_400_BAD_REQUEST)
            workflow.status = "published"
            workflow.is_active = True
            workflow.published_at = timezone.now()
            workflow.archived_at = None
            workflow.save(update_fields=["status", "is_active", "published_at", "archived_at", "updated_at"])
            log_business_event(event_group="workflow", event_type="published", tenant=workflow.tenant, actor=request.user, obj=workflow, note=f"Workflow {workflow.name} v{workflow.version} published.")
            return success_response("Workflow published.", data=WorkflowDefinitionSerializer(workflow).data)
        if action == "deactivate":
            workflow.status = "inactive"
            workflow.is_active = False
            workflow.save(update_fields=["status", "is_active", "updated_at"])
            return success_response("Workflow deactivated.", data=WorkflowDefinitionSerializer(workflow).data)
        if action == "archive":
            workflow.status = "archived"
            workflow.is_active = False
            workflow.archived_at = timezone.now()
            workflow.save(update_fields=["status", "is_active", "archived_at", "updated_at"])
            log_business_event(event_group="workflow", event_type="archived", tenant=workflow.tenant, actor=request.user, obj=workflow, note=f"Workflow {workflow.name} archived.")
            return success_response("Workflow archived.", data=WorkflowDefinitionSerializer(workflow).data)

        # A revision copies configuration into a draft without modifying active instances.
        with transaction.atomic():
            revision = WorkflowDefinition.objects.create(
                tenant=workflow.tenant,
                module=workflow.module,
                code=f"{workflow.code}-v{workflow.version_major}-{workflow.version_minor + 1}"[:100],
                name=workflow.name,
                entity_type=workflow.entity_type,
                scope=workflow.scope,
                trigger_event=workflow.trigger_event,
                description=workflow.description,
                status="draft",
                version_major=workflow.version_major,
                version_minor=workflow.version_minor + 1,
                revision_of=workflow,
                effective_from=workflow.effective_from,
                is_active=False,
                allow_dashboard_quick_actions=workflow.allow_dashboard_quick_actions,
                metadata=workflow.metadata,
            )
            for binding in workflow.entity_bindings.all():
                WorkflowEntityBinding.objects.create(
                    workflow=revision, module_slug=binding.module_slug, entity_type=binding.entity_type,
                    entity_label=binding.entity_label, route_path=binding.route_path, api_base_path=binding.api_base_path,
                    trigger_events=binding.trigger_events, is_primary=binding.is_primary, is_active=binding.is_active,
                    metadata=binding.metadata,
                )
            node_map = {}
            for node in workflow.nodes.all():
                cloned = WorkflowNodeDefinition.objects.create(
                    workflow=revision, code=node.code, name=node.name, node_type=node.node_type, step_order=node.step_order,
                    is_initial=node.is_initial, approval_group=node.approval_group, approval_mode=node.approval_mode,
                    required_approvals=node.required_approvals, assigned_user=node.assigned_user, min_amount=node.min_amount,
                    max_amount=node.max_amount, cost_center=node.cost_center, entry_action=node.entry_action,
                    exit_action=node.exit_action, notify_dashboard=node.notify_dashboard,
                    allow_quick_action=node.allow_quick_action, sla_hours=node.sla_hours,
                    position_x=node.position_x, position_y=node.position_y, is_active=node.is_active, metadata=node.metadata,
                )
                node_map[node.id] = cloned
            for route in workflow.transitions.all():
                WorkflowTransitionDefinition.objects.create(
                    workflow=revision, from_node=node_map[route.from_node_id], to_node=node_map[route.to_node_id],
                    name=route.name, transition_key=route.transition_key, decision=route.decision, priority=route.priority,
                    is_default=route.is_default, condition_field=route.condition_field,
                    condition_operator=route.condition_operator, condition_value=route.condition_value,
                    is_active=route.is_active, metadata=route.metadata,
                )
        log_business_event(event_group="workflow", event_type="revision_created", tenant=workflow.tenant, actor=request.user, obj=revision, note=f"Draft revision v{revision.version} created from {workflow.name}.")
        return success_response("Draft revision created.", data=WorkflowDefinitionSerializer(revision).data, status=status.HTTP_201_CREATED)


class WorkflowStepDefinitionListCreateAPIView(ModuleAPIViewMixin, generics.ListCreateAPIView):
    permission_classes = [IsWorkflowConfigurationPermission]
    queryset = WorkflowStepDefinition.objects.select_related("workflow", "approval_group", "workflow__tenant", "workflow__module").all()
    serializer_class = WorkflowStepDefinitionSerializer
    filterset_fields = ("workflow", "approval_group", "action_type", "is_active")
    ordering_fields = ("workflow__name", "step_order", "created_at", "updated_at")
    search_fields = ("name", "workflow__name", "cost_center")

    def get_queryset(self):
        qs = super().get_queryset()
        if _is_superadmin(self.request.user):
            return qs
        tenant = _request_tenant_or_none(self.request.user)
        return qs.filter(workflow__tenant=tenant) if tenant else qs.none()


class WorkflowStepDefinitionDetailAPIView(generics.RetrieveUpdateDestroyAPIView):
    permission_classes = [IsWorkflowConfigurationPermission]
    queryset = WorkflowStepDefinition.objects.select_related("workflow", "approval_group", "workflow__tenant", "workflow__module").all()
    serializer_class = WorkflowStepDefinitionSerializer

    def get_queryset(self):
        qs = super().get_queryset()
        if _is_superadmin(self.request.user):
            return qs
        tenant = _request_tenant_or_none(self.request.user)
        return qs.filter(workflow__tenant=tenant) if tenant else qs.none()


class WorkflowEntityBindingListCreateAPIView(ModuleAPIViewMixin, generics.ListCreateAPIView):
    permission_classes = [IsWorkflowConfigurationPermission]
    queryset = WorkflowEntityBinding.objects.select_related("workflow", "workflow__tenant", "workflow__module").all()
    serializer_class = WorkflowEntityBindingSerializer
    filterset_fields = ("workflow", "module_slug", "entity_type", "is_primary", "is_active")
    ordering_fields = ("workflow__name", "entity_label", "created_at", "updated_at")
    search_fields = ("module_slug", "entity_type", "entity_label", "route_path", "api_base_path")

    def get_queryset(self):
        qs = super().get_queryset()
        if _is_superadmin(self.request.user):
            return qs
        tenant = _request_tenant_or_none(self.request.user)
        return qs.filter(workflow__tenant=tenant) if tenant else qs.none()


class WorkflowEntityBindingDetailAPIView(generics.RetrieveUpdateDestroyAPIView):
    permission_classes = [IsWorkflowConfigurationPermission]
    queryset = WorkflowEntityBinding.objects.select_related("workflow", "workflow__tenant", "workflow__module").all()
    serializer_class = WorkflowEntityBindingSerializer

    def get_queryset(self):
        qs = super().get_queryset()
        if _is_superadmin(self.request.user):
            return qs
        tenant = _request_tenant_or_none(self.request.user)
        return qs.filter(workflow__tenant=tenant) if tenant else qs.none()


class WorkflowNodeDefinitionListCreateAPIView(ModuleAPIViewMixin, generics.ListCreateAPIView):
    permission_classes = [IsWorkflowConfigurationPermission]
    queryset = WorkflowNodeDefinition.objects.select_related(
        "workflow",
        "workflow__tenant",
        "workflow__module",
        "approval_group",
        "assigned_user",
    ).all()
    serializer_class = WorkflowNodeDefinitionSerializer
    filterset_fields = ("workflow", "node_type", "approval_group", "assigned_user", "is_active", "is_initial")
    ordering_fields = ("workflow__name", "step_order", "created_at", "updated_at")
    search_fields = ("code", "name", "cost_center", "entry_action", "exit_action")

    def get_queryset(self):
        qs = super().get_queryset()
        if _is_superadmin(self.request.user):
            return qs
        tenant = _request_tenant_or_none(self.request.user)
        return qs.filter(workflow__tenant=tenant) if tenant else qs.none()


class WorkflowNodeDefinitionDetailAPIView(generics.RetrieveUpdateDestroyAPIView):
    permission_classes = [IsWorkflowConfigurationPermission]
    queryset = WorkflowNodeDefinition.objects.select_related(
        "workflow",
        "workflow__tenant",
        "workflow__module",
        "approval_group",
        "assigned_user",
    ).all()
    serializer_class = WorkflowNodeDefinitionSerializer

    def get_queryset(self):
        qs = super().get_queryset()
        if _is_superadmin(self.request.user):
            return qs
        tenant = _request_tenant_or_none(self.request.user)
        return qs.filter(workflow__tenant=tenant) if tenant else qs.none()


class WorkflowTransitionDefinitionListCreateAPIView(ModuleAPIViewMixin, generics.ListCreateAPIView):
    permission_classes = [IsWorkflowConfigurationPermission]
    queryset = WorkflowTransitionDefinition.objects.select_related(
        "workflow",
        "workflow__tenant",
        "workflow__module",
        "from_node",
        "to_node",
    ).all()
    serializer_class = WorkflowTransitionDefinitionSerializer
    filterset_fields = ("workflow", "from_node", "to_node", "transition_key", "decision", "is_active")
    ordering_fields = ("workflow__name", "priority", "created_at", "updated_at")
    search_fields = ("name", "transition_key", "condition_field", "condition_value")

    def get_queryset(self):
        qs = super().get_queryset()
        if _is_superadmin(self.request.user):
            return qs
        tenant = _request_tenant_or_none(self.request.user)
        return qs.filter(workflow__tenant=tenant) if tenant else qs.none()


class WorkflowTransitionDefinitionDetailAPIView(generics.RetrieveUpdateDestroyAPIView):
    permission_classes = [IsWorkflowConfigurationPermission]
    queryset = WorkflowTransitionDefinition.objects.select_related(
        "workflow",
        "workflow__tenant",
        "workflow__module",
        "from_node",
        "to_node",
    ).all()
    serializer_class = WorkflowTransitionDefinitionSerializer

    def get_queryset(self):
        qs = super().get_queryset()
        if _is_superadmin(self.request.user):
            return qs
        tenant = _request_tenant_or_none(self.request.user)
        return qs.filter(workflow__tenant=tenant) if tenant else qs.none()


class WorkflowInboxAPIView(APIView):
    permission_classes = (IsAuthenticated,)

    def get(self, request):
        qs = WorkflowInboxItem.objects.select_related(
            "tenant",
            "workflow",
            "step_definition",
            "assigned_group",
            "assigned_user",
            "acted_by",
        ).all()
        scope = request.query_params.get("scope", "assigned")
        if not _is_superadmin(request.user):
            tenant = _request_tenant_or_none(request.user)
            if tenant is None:
                qs = qs.none()
            else:
                group_ids = set(request.user.groups.values_list("id", flat=True))
                qs = qs.filter(tenant=tenant)
                if scope == "submitted":
                    qs = qs.filter(metadata__submitted_by=request.user.id)
                elif scope == "all" and _workflow_admin_allowed(request.user, "view_workflowdefinition"):
                    pass
                else:
                    qs = qs.filter(Q(assigned_user=request.user) | Q(assigned_group_id__in=group_ids))
        elif scope == "submitted":
            qs = qs.filter(metadata__submitted_by=request.user.id)
        if status_value := request.query_params.get("status"):
            if status_value == "all":
                status_value = ""
        if status_value:
            qs = qs.filter(status=status_value)
        else:
            qs = qs.filter(status="pending")
        limit = min(max(int(request.query_params.get("limit", 50)), 1), 200)
        payload = WorkflowInboxItemSerializer(qs.order_by("-created_at")[:limit], many=True).data
        return success_response(
            "Workflow inbox loaded successfully.",
            data={"results": payload, "count": len(payload), "scope": scope},
        )


class WorkflowRequirementAPIView(APIView):
    """Lets a module determine whether a configured workflow currently applies."""

    permission_classes = (IsAuthenticated,)

    def get(self, request):
        tenant = _request_tenant_or_none(request.user)
        module_slug = str(request.query_params.get("module_slug") or "").strip()
        entity_type = str(request.query_params.get("entity_type") or "").strip()
        trigger_event = str(request.query_params.get("trigger_event") or "submit").strip()
        entity_id = request.query_params.get("entity_id")
        if not tenant or not module_slug or not entity_type:
            return success_response("Workflow requirement resolved.", data={"required": False, "binding": None})
        binding = WorkflowEntityBinding.objects.select_related("workflow").filter(
            workflow__tenant=tenant, workflow__is_active=True, workflow__status="published",
            module_slug=module_slug, entity_type=entity_type, is_active=True,
        ).filter(Q(trigger_events__contains=[trigger_event]) | Q(trigger_events=[])).order_by("-is_primary", "id").first()
        active_item = None
        if binding and entity_id:
            try:
                active_item = WorkflowInboxItem.objects.select_related(
                    "node_definition", "assigned_group", "assigned_user"
                ).filter(
                    tenant=tenant,
                    workflow=binding.workflow,
                    module_slug=module_slug,
                    entity_type=entity_type,
                    entity_id=int(entity_id),
                    status__in=["pending", "deferred"],
                ).order_by("-created_at").first()
            except (TypeError, ValueError):
                pass
        return success_response(
            "Workflow requirement resolved.",
            data={
                "required": bool(binding),
                "in_progress": bool(active_item),
                "current_stage": active_item.node_definition.name if active_item and active_item.node_definition_id else None,
                "current_role": (
                    active_item.assigned_group.name if active_item and active_item.assigned_group_id else
                    ((active_item.assigned_user.get_full_name() or active_item.assigned_user.username)
                     if active_item and active_item.assigned_user_id else None)
                ),
                "binding": {"id": binding.id, "workflow_id": binding.workflow_id, "workflow_name": binding.workflow.name} if binding else None,
            },
        )


def _workflow_actor_can_action(item, user):
    if _is_superadmin(user):
        return True
    if item.assigned_user_id:
        return item.assigned_user_id == user.id
    return item.assigned_group_id in set(user.groups.values_list("id", flat=True))


def _workflow_actor_can_view(item, user):
    """Workflow roles may inspect their assigned document without module list access."""
    if _is_superadmin(user) or _workflow_actor_can_action(item, user):
        return True
    if (item.metadata or {}).get("submitted_by") == user.id:
        return True
    return _workflow_admin_allowed(user, "view_workflowdefinition")


def _workflow_subject_summary(item):
    """Provide a module-neutral review payload, with adapters for live ERP records."""
    saved_snapshot = ((item.metadata or {}).get("context") or {}).get("record_snapshot")
    if item.module_slug == "weighbridge" and item.entity_type == "weighbridge_transaction":
        from SL_Weighbridge.models import Transaction

        transaction_record = Transaction.objects.filter(pk=item.entity_id, tenant=item.tenant).select_related(
            "branch", "customer", "vehicle", "item", "vehicle_type"
        ).first()
        if transaction_record:
            return {
                "reference": getattr(transaction_record, "transaction_number", "") or item.reference,
                "fields": {
                    "Branch": getattr(transaction_record.branch, "name", ""),
                    "Customer": getattr(transaction_record.customer, "name", ""),
                    "Vehicle": getattr(transaction_record.vehicle, "plate_number", "") or getattr(transaction_record.vehicle, "vehicle_number", ""),
                    "Commodity": getattr(transaction_record.item, "name", ""),
                    "Destination": transaction_record.destination,
                    "Gross weight (kg)": transaction_record.gross_weight or 0,
                    "Tare weight (kg)": transaction_record.tare_weight or 0,
                    "Net weight (kg)": transaction_record.net_weight or 0,
                    "Charge": str(transaction_record.charge or 0),
                    "Payment status": transaction_record.payment_status,
                    "Document status": transaction_record.status,
                    "Approval status": "Approved" if transaction_record.approval_status else "Awaiting workflow approval",
                },
            }
    return {"reference": item.reference, "fields": saved_snapshot or {}}


def _workflow_entity_route(binding, entity_id):
    """Return the most useful record route for inbox users, not just a module list."""
    if binding.module_slug == "weighbridge" and binding.entity_type == "weighbridge_transaction":
        return f"/weighbridge/transactions/{entity_id}"
    return binding.route_path


def _sync_workflow_entity_state(item, decision, actor):
    """Apply final generic workflow decisions to ERP records with supported lifecycle hooks."""
    if item.module_slug != "weighbridge" or item.entity_type != "weighbridge_transaction":
        return

    # Keep generic workflows reusable, while retaining the established
    # weighbridge completion logic (paired tickets, invoices, audit fields).
    from SL_Weighbridge.models import Transaction

    transaction_record = Transaction.objects.filter(pk=item.entity_id, tenant=item.tenant).first()
    if transaction_record is None:
        return
    transaction_record.last_modified_by = actor
    if decision == "in_progress":
        transaction_record.status = "In Progress"
        transaction_record.approval_status = False
        transaction_record.save(update_fields=["status", "approval_status", "last_modified_by", "updated_at"])
        return
    if decision == "reject":
        transaction_record.status = "Rejected"
        transaction_record.approval_status = False
        if not transaction_record.weight_reason:
            transaction_record.weight_reason = "Rejected through the workflow approval process."
        transaction_record.save(update_fields=["status", "approval_status", "weight_reason", "last_modified_by", "updated_at"])
        return
    if decision == "complete":
        from Platform_API.modules.weighbridge.views import _approve_transaction

        _approve_transaction(transaction_record)


def _workflow_recipients(node, tenant):
    if node.assigned_user_id:
        return User.objects.filter(pk=node.assigned_user_id)
    if node.approval_group_id:
        return User.objects.filter(groups=node.approval_group, tenant_profile__tenant=tenant).distinct()
    return User.objects.none()


def _append_workflow_history(item, actor, action, comment=""):
    """Keep the complete request trail when an item advances to another role."""
    metadata = dict(item.metadata or {})
    history = list(metadata.get("workflow_history") or [])
    history.append({
        "action": action,
        "actor": actor.get_full_name() or actor.username,
        "actor_id": actor.id,
        "stage": item.node_definition.name if item.node_definition_id else "Workflow review",
        "role": item.assigned_group.name if item.assigned_group_id else "",
        "comment": comment.strip(),
        "at": timezone.now().isoformat(),
    })
    metadata["workflow_history"] = history
    item.metadata = metadata
    return metadata


def _notify_workflow_recipients(item, node, message):
    if not node.notify_dashboard:
        return
    notifications = [
        SystemNotification(
            tenant=item.tenant,
            recipient=user,
            category="workflow",
            title=f"Approval required: {item.reference or item.title}",
            message=message,
            route_path="/workflows/approvals",
            source_type="workflow_inbox",
            source_id=item.id,
            metadata={"workflow_id": item.workflow_id, "node_id": node.id, "entity_type": item.entity_type, "entity_id": item.entity_id},
        )
        for user in _workflow_recipients(node, item.tenant)
    ]
    if notifications:
        SystemNotification.objects.bulk_create(notifications)


def _workflow_context_value(item, field):
    value = item.metadata or {}
    for part in field.replace("__", ".").split("."):
        if not isinstance(value, dict):
            return None
        value = value.get(part)
    return value


def _workflow_transition_matches(transition, item):
    operator = transition.condition_operator or "always"
    if operator == "always":
        return True
    actual = _workflow_context_value(item, transition.condition_field)
    expected = transition.condition_value
    if operator == "is_true":
        return actual is True or str(actual).lower() in {"true", "1", "yes"}
    if operator == "is_false":
        return actual is False or str(actual).lower() in {"false", "0", "no", ""}
    if operator == "contains":
        return str(expected).lower() in str(actual or "").lower()
    if operator == "in":
        return str(actual).lower() in {value.strip().lower() for value in str(expected).split(",")}
    try:
        actual, expected = float(actual), float(expected)
    except (TypeError, ValueError):
        actual, expected = str(actual or "").lower(), str(expected).lower()
    return {
        "eq": actual == expected,
        "neq": actual != expected,
        "gt": actual > expected,
        "gte": actual >= expected,
        "lt": actual < expected,
        "lte": actual <= expected,
    }.get(operator, False)


def _workflow_first_actionable_node(workflow):
    """Resolve the configured entry node without assuming a module-specific model."""
    nodes = list(workflow.nodes.filter(is_active=True).select_related("approval_group", "assigned_user").order_by("step_order", "id"))
    if not nodes:
        return None
    current = next((node for node in nodes if node.is_initial), None) or next(
        (node for node in nodes if node.node_type == "start"), nodes[0]
    )
    visited = set()
    while current and current.id not in visited:
        visited.add(current.id)
        if current.node_type in {"approval", "review", "task"}:
            return current
        transition = workflow.transitions.filter(
            from_node=current,
            is_active=True,
        ).order_by("-is_default", "priority", "id").select_related("to_node").first()
        current = transition.to_node if transition else None
    return None


def _workflow_next_actionable_node(item):
    if not item.workflow_id or not item.node_definition_id:
        return None
    transitions = item.workflow.transitions.filter(
        from_node=item.node_definition,
        is_active=True,
    ).filter(Q(decision__in=["approve", "next", ""]) | Q(is_default=True)).order_by("is_default", "priority", "id").select_related("to_node", "to_node__approval_group", "to_node__assigned_user")
    transition = next((route for route in transitions if _workflow_transition_matches(route, item)), None)
    if not transition:
        transition = next((route for route in transitions if route.is_default), None)
    if not transition:
        return None
    current = transition.to_node
    visited = set()
    while current and current.id not in visited:
        visited.add(current.id)
        if current.node_type in {"approval", "review", "task"}:
            return current
        next_transitions = item.workflow.transitions.filter(
            from_node=current,
            is_active=True,
        ).order_by("is_default", "priority", "id").select_related("to_node")
        next_transition = next((route for route in next_transitions if _workflow_transition_matches(route, item)), None)
        if not next_transition:
            next_transition = next((route for route in next_transitions if route.is_default), None)
        current = next_transition.to_node if next_transition else None
    return None


class WorkflowForwardAPIView(APIView):
    """Create an inbox item from a tenant workflow binding for any ERP entity."""

    permission_classes = (IsAuthenticated,)

    def post(self, request):
        tenant = _request_tenant_or_none(request.user)
        if tenant is None:
            raise PermissionDenied("Your account is not linked to an organization.")

        module_slug = str(request.data.get("module_slug") or "").strip()
        entity_type = str(request.data.get("entity_type") or "").strip()
        entity_id = request.data.get("entity_id")
        trigger_event = str(request.data.get("trigger_event") or "submit").strip()
        if not module_slug or not entity_type or not entity_id:
            raise ValidationError({"detail": "module_slug, entity_type, and entity_id are required."})
        try:
            entity_id = int(entity_id)
        except (TypeError, ValueError):
            raise ValidationError({"entity_id": "Use a valid numeric record ID."})

        bindings = WorkflowEntityBinding.objects.select_related("workflow").filter(
            workflow__tenant=tenant,
            workflow__is_active=True,
            workflow__status="published",
            module_slug=module_slug,
            entity_type=entity_type,
            is_active=True,
        )
        if binding_id := request.data.get("binding_id"):
            bindings = bindings.filter(id=binding_id)
        binding = bindings.filter(Q(trigger_events__contains=[trigger_event]) | Q(trigger_events=[])).order_by(
            "-is_primary", "id"
        ).first()
        if not binding:
            raise ValidationError({"detail": "No active workflow is configured for this module record and trigger."})

        existing = WorkflowInboxItem.objects.filter(
            tenant=tenant,
            workflow=binding.workflow,
            module_slug=module_slug,
            entity_type=entity_type,
            entity_id=entity_id,
            status="pending",
        ).first()
        if existing:
            return success_response("This record is already in the approval queue.", data=WorkflowInboxItemSerializer(existing).data)

        node = _workflow_first_actionable_node(binding.workflow)
        if node is None or (node.node_type == "approval" and not node.approval_group_id and not node.assigned_user_id):
            raise ValidationError({"detail": "The configured workflow needs an active routed approval, review, or task node."})

        reference = str(request.data.get("reference") or f"{entity_type}-{entity_id}")[:80]
        title = str(request.data.get("title") or f"Approval required: {binding.entity_label}")[:200]
        detail = str(request.data.get("detail") or f"{binding.entity_label} {reference} was forwarded for {node.name}.")
        metadata = request.data.get("metadata") if isinstance(request.data.get("metadata"), dict) else {}
        metadata.update({
            "submitted_by": request.user.id,
            "trigger_event": trigger_event,
            "binding_id": binding.id,
            "workflow_history": [
                {
                    "action": "forwarded",
                    "actor": request.user.get_full_name() or request.user.username,
                    "actor_id": request.user.id,
                    "stage": node.name,
                    "role": node.approval_group.name if node.approval_group_id else "",
                    "comment": "",
                    "at": timezone.now().isoformat(),
                }
            ],
        })

        item = WorkflowInboxItem.objects.create(
            tenant=tenant,
            workflow=binding.workflow,
            node_definition=node,
            module_slug=module_slug,
            entity_type=entity_type,
            entity_id=entity_id,
            reference=reference,
            title=title,
            detail=detail,
            route_path=_workflow_entity_route(binding, entity_id),
            action_url=f"/api/platform/workflows/inbox/{{id}}/action/",
            assigned_group=node.approval_group,
            assigned_user=node.assigned_user,
            quick_actions=["approve", "reject"],
            metadata=metadata,
        )
        _sync_workflow_entity_state(item, "in_progress", request.user)
        log_business_event(
            event_group="workflow",
            event_type="forwarded",
            tenant=tenant,
            actor=request.user,
            obj=item,
            note=f"{binding.entity_label} {reference} forwarded to {node.name}.",
            metadata={"module_slug": module_slug, "entity_type": entity_type, "entity_id": entity_id, "workflow_id": binding.workflow_id},
        )
        _notify_workflow_recipients(item, node, f"{reference} was forwarded to {node.name}.")
        return success_response("Record forwarded for approval.", data=WorkflowInboxItemSerializer(item).data, status=status.HTTP_201_CREATED)


class WorkflowInboxSubjectAPIView(APIView):
    """Read a workflow subject through its approval assignment, not module navigation rules."""

    permission_classes = (IsAuthenticated,)

    def get(self, request, pk):
        item = get_object_or_404(
            WorkflowInboxItem.objects.select_related("tenant", "workflow", "node_definition", "assigned_group", "assigned_user"),
            pk=pk,
        )
        if not _is_superadmin(request.user) and item.tenant_id != getattr(_request_tenant_or_none(request.user), "id", None):
            raise PermissionDenied("This workflow request does not belong to your organization.")
        if not _workflow_actor_can_view(item, request.user):
            raise PermissionDenied("This workflow request is not assigned to your user or role.")
        return success_response(
            "Workflow review details loaded.",
            data={
                "item": WorkflowInboxItemSerializer(item).data,
                "subject": _workflow_subject_summary(item),
                "workflow_history": (item.metadata or {}).get("workflow_history") or [],
                "current_stage": item.node_definition.name if item.node_definition_id else "Workflow review",
                "current_role": item.assigned_group.name if item.assigned_group_id else (
                    item.assigned_user.get_full_name() or item.assigned_user.username if item.assigned_user_id else "Unassigned"
                ),
            },
        )


class WorkflowInboxActionAPIView(APIView):
    """Advance, reject, or complete a generic workflow inbox record."""

    permission_classes = (IsAuthenticated,)

    def post(self, request, pk):
        item = get_object_or_404(
            WorkflowInboxItem.objects.select_related("tenant", "workflow", "node_definition", "assigned_group", "assigned_user"),
            pk=pk,
        )
        if not _is_superadmin(request.user) and item.tenant_id != getattr(_request_tenant_or_none(request.user), "id", None):
            raise PermissionDenied("This approval does not belong to your organization.")
        if item.status not in {"pending", "deferred"}:
            raise ValidationError({"detail": "This workflow item has already been actioned."})
        if not _workflow_actor_can_action(item, request.user):
            raise PermissionDenied("This approval is not assigned to your user or role.")

        decision = str(request.data.get("decision") or "approve").lower()
        if decision not in {"approve", "reject", "defer", "resume", "comment"}:
            raise ValidationError({"decision": "Use approve, reject, defer, resume, or comment."})
        comment = str(request.data.get("comment") or request.data.get("reason") or "").strip()
        if decision == "comment":
            if not comment:
                raise ValidationError({"comment": "Enter a comment before posting it."})
            _append_workflow_history(item, request.user, "commented", comment)
            item.save(update_fields=["metadata", "updated_at"])
            return success_response("Workflow comment added.", data=WorkflowInboxItemSerializer(item).data)
        if decision == "defer":
            if item.status != "pending":
                raise ValidationError({"detail": "Only pending workflow items can be deferred."})
            item.status = "deferred"
            item.defer_reason = comment
            item.deferred_until = request.data.get("deferred_until") or None
            _append_workflow_history(item, request.user, "deferred", comment)
            item.save(update_fields=["status", "defer_reason", "deferred_until", "metadata", "updated_at"])
            log_business_event(event_group="workflow", event_type="deferred", tenant=item.tenant, actor=request.user, obj=item, note=f"{item.reference or item.title} deferred.")
            return success_response("Workflow item deferred.", data=WorkflowInboxItemSerializer(item).data)
        if decision == "resume":
            if item.status != "deferred":
                raise ValidationError({"detail": "Only deferred workflow items can be resumed."})
            item.status = "pending"
            item.deferred_until = None
            _append_workflow_history(item, request.user, "resumed", comment)
            item.save(update_fields=["status", "deferred_until", "metadata", "updated_at"])
            log_business_event(event_group="workflow", event_type="resumed", tenant=item.tenant, actor=request.user, obj=item, note=f"{item.reference or item.title} resumed.")
            return success_response("Workflow item returned to your approval queue.", data=WorkflowInboxItemSerializer(item).data)
        item.acted_by = request.user
        item.acted_at = timezone.now()
        if decision == "reject":
            _sync_workflow_entity_state(item, "reject", request.user)
            item.status = "rejected"
            _append_workflow_history(item, request.user, "rejected", comment)
            item.save(update_fields=["status", "acted_by", "acted_at", "metadata", "updated_at"])
            log_business_event(event_group="workflow", event_type="rejected", tenant=item.tenant, actor=request.user, obj=item, note=f"{item.reference or item.title} rejected.")
            submitter_id = (item.metadata or {}).get("submitted_by")
            if submitter_id:
                SystemNotification.objects.create(tenant=item.tenant, recipient_id=submitter_id, category="workflow", title=f"Workflow rejected: {item.reference or item.title}", message=f"{request.user.get_full_name() or request.user.username} rejected this request.", route_path=item.route_path, source_type="workflow_inbox", source_id=item.id)
            return success_response("Workflow item rejected.", data=WorkflowInboxItemSerializer(item).data)

        next_node = _workflow_next_actionable_node(item)
        if not next_node:
            _sync_workflow_entity_state(item, "complete", request.user)
        item.status = "approved" if next_node else "completed"
        _append_workflow_history(item, request.user, "approved" if next_node else "completed", comment)
        item.save(update_fields=["status", "acted_by", "acted_at", "metadata", "updated_at"])
        log_business_event(event_group="workflow", event_type="approved" if next_node else "completed", tenant=item.tenant, actor=request.user, obj=item, note=f"{item.reference or item.title} approved.")
        if next_node:
            next_item = WorkflowInboxItem.objects.create(
                tenant=item.tenant,
                workflow=item.workflow,
                node_definition=next_node,
                module_slug=item.module_slug,
                entity_type=item.entity_type,
                entity_id=item.entity_id,
                reference=item.reference,
                title=item.title,
                detail=f"{item.reference or item.title} is awaiting {next_node.name}.",
                route_path=item.route_path,
                action_url=f"/api/platform/workflows/inbox/{{id}}/action/",
                assigned_group=next_node.approval_group,
                assigned_user=next_node.assigned_user,
                quick_actions=["approve", "reject"],
                metadata={**(item.metadata or {}), "previous_inbox_item_id": item.id},
            )
            _notify_workflow_recipients(next_item, next_node, f"{item.reference or item.title} is awaiting {next_node.name}.")
            return success_response("Approval recorded and forwarded to the next step.", data=WorkflowInboxItemSerializer(next_item).data)
        submitter_id = (item.metadata or {}).get("submitted_by")
        if submitter_id:
            SystemNotification.objects.create(tenant=item.tenant, recipient_id=submitter_id, category="workflow", title=f"Workflow completed: {item.reference or item.title}", message=f"{request.user.get_full_name() or request.user.username} completed this request.", route_path=item.route_path, source_type="workflow_inbox", source_id=item.id)
        return success_response("Workflow completed.", data=WorkflowInboxItemSerializer(item).data)


class SystemNotificationAPIView(APIView):
    permission_classes = (IsAuthenticated,)

    def get(self, request):
        tenant = _request_tenant_or_none(request.user)
        qs = SystemNotification.objects.filter(recipient=request.user)
        if tenant:
            qs = qs.filter(tenant=tenant)
        else:
            qs = qs.none()
        if request.query_params.get("unread") in {"1", "true"}:
            qs = qs.filter(is_read=False)
        limit = min(max(int(request.query_params.get("limit", 50)), 1), 200)
        results = list(qs[:limit].values("id", "category", "title", "message", "route_path", "source_type", "source_id", "is_read", "read_at", "created_at", "metadata"))
        return success_response("Notifications loaded successfully.", data={"results": results, "unread_count": qs.filter(is_read=False).count()})

    def post(self, request):
        tenant = _request_tenant_or_none(request.user)
        if not tenant:
            raise PermissionDenied("Your account is not linked to an organization.")
        action = str(request.data.get("action") or "read").lower()
        qs = SystemNotification.objects.filter(tenant=tenant, recipient=request.user, is_read=False)
        if action == "read_all":
            count = qs.update(is_read=True, read_at=timezone.now())
        elif action == "read":
            count = qs.filter(pk=request.data.get("id")).update(is_read=True, read_at=timezone.now())
        else:
            raise ValidationError({"action": "Use read or read_all."})
        return success_response("Notification state updated.", data={"updated": count})


class AuditEventLogListAPIView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request):
        user = request.user
        if not _can_view_tenant_audit_logs(user):
            return error_response(
                "You do not have permission to view audit logs.",
                status_code=status.HTTP_403_FORBIDDEN,
            )

        qs = AuditEventLog.objects.select_related("tenant", "branch", "actor")
        if not _can_view_global_audit_logs(user):
            tenant = _request_tenant_or_none(user)
            if tenant is None:
                return success_response("Audit logs loaded successfully.", data=[])
            qs = qs.filter(tenant=tenant)

        tenant_code = request.query_params.get("tenant_code")
        if tenant_code:
            qs = qs.filter(tenant__code=tenant_code)
        event_group = request.query_params.get("event_group")
        if event_group:
            qs = qs.filter(event_group=event_group)
        event_type = request.query_params.get("event_type")
        if event_type:
            qs = qs.filter(event_type=event_type)
        model_label = request.query_params.get("model_label")
        if model_label:
            qs = qs.filter(model_label=model_label)
        object_pk = request.query_params.get("object_pk")
        if object_pk:
            qs = qs.filter(object_pk=str(object_pk))
        actor_id = request.query_params.get("actor_id")
        if actor_id:
            qs = qs.filter(actor_id=actor_id)
        status_value = request.query_params.get("status")
        if status_value:
            qs = qs.filter(status=status_value)
        branch_id = request.query_params.get("branch_id")
        if branch_id:
            qs = qs.filter(branch_id=branch_id)
        search = request.query_params.get("search", "").strip()
        if search:
            qs = qs.filter(
                Q(object_repr__icontains=search)
                | Q(model_label__icontains=search)
                | Q(note__icontains=search)
                | Q(actor__username__icontains=search)
                | Q(actor__first_name__icontains=search)
                | Q(actor__last_name__icontains=search)
            )
        limit = min(int(request.query_params.get("limit", 100) or 100), 500)

        serializer = AuditEventLogSerializer(qs.order_by("-created_at", "-id")[:limit], many=True)
        return success_response("Audit logs loaded successfully.", data=serializer.data)


class AuditAccessLogListAPIView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request):
        user = request.user
        if not _can_view_tenant_access_logs(user):
            return error_response(
                "You do not have permission to view access logs.",
                status_code=status.HTTP_403_FORBIDDEN,
            )

        qs = AuditAccessLog.objects.select_related("tenant", "branch", "actor")
        if not _can_view_global_access_logs(user):
            tenant = _request_tenant_or_none(user)
            if tenant is None:
                return success_response("Access logs loaded successfully.", data=[])
            qs = qs.filter(tenant=tenant)

        tenant_code = request.query_params.get("tenant_code")
        if tenant_code:
            qs = qs.filter(tenant__code=tenant_code)
        event_group = request.query_params.get("event_group")
        if event_group:
            qs = qs.filter(event_group=event_group)
        event_type = request.query_params.get("event_type")
        if event_type:
            qs = qs.filter(event_type=event_type)
        actor_id = request.query_params.get("actor_id")
        if actor_id:
            qs = qs.filter(actor_id=actor_id)
        request_path = request.query_params.get("request_path")
        if request_path:
            qs = qs.filter(request_path__icontains=request_path)
        status_code = request.query_params.get("status_code")
        if status_code and status_code.isdigit():
            qs = qs.filter(status_code=int(status_code))
        search = request.query_params.get("search", "").strip()
        if search:
            qs = qs.filter(
                Q(request_path__icontains=search)
                | Q(actor__username__icontains=search)
                | Q(actor__first_name__icontains=search)
                | Q(actor__last_name__icontains=search)
            )
        limit = min(int(request.query_params.get("limit", 100) or 100), 500)

        serializer = AuditAccessLogSerializer(qs.order_by("-created_at", "-id")[:limit], many=True)
        return success_response("Access logs loaded successfully.", data=serializer.data)


class AuditExportAPIView(APIView):
    """Download the same tenant-scoped audit evidence shown in the audit workspace."""

    permission_classes = [IsAuthenticated]

    def get(self, request):
        dataset = str(request.query_params.get("dataset") or "events").lower()
        export_format = str(request.query_params.get("format") or "csv").lower()
        if dataset not in {"events", "access"}:
            raise ValidationError({"dataset": "Use events or access."})
        if export_format not in {"csv", "pdf"}:
            raise ValidationError({"format": "Use csv or pdf."})

        user = request.user
        can_view = _can_view_tenant_audit_logs(user) if dataset == "events" else _can_view_tenant_access_logs(user)
        if not can_view:
            raise PermissionDenied("You do not have permission to export audit logs.")
        if not _can_export_audit_logs(user):
            raise PermissionDenied("Your role is not allowed to export audit logs.")

        model = AuditEventLog if dataset == "events" else AuditAccessLog
        qs = model.objects.select_related("tenant", "branch", "actor")
        can_view_global = _can_view_global_audit_logs(user) if dataset == "events" else _can_view_global_access_logs(user)
        if not can_view_global:
            tenant = _request_tenant_or_none(user)
            if tenant is None:
                qs = qs.none()
            else:
                qs = qs.filter(tenant=tenant)

        tenant_code = request.query_params.get("tenant_code")
        if tenant_code:
            qs = qs.filter(tenant__code=tenant_code)
        search = (request.query_params.get("search") or "").strip()
        if dataset == "events":
            for key in ("event_group", "event_type", "status", "branch_id", "model_label", "object_pk"):
                value = request.query_params.get(key)
                if value:
                    qs = qs.filter(**{key: value})
            if search:
                qs = qs.filter(
                    Q(object_repr__icontains=search) | Q(model_label__icontains=search) | Q(note__icontains=search)
                    | Q(actor__username__icontains=search) | Q(actor__first_name__icontains=search) | Q(actor__last_name__icontains=search)
                )
        else:
            status_code = request.query_params.get("status_code")
            if status_code and status_code.isdigit():
                qs = qs.filter(status_code=int(status_code))
            if search:
                qs = qs.filter(
                    Q(request_path__icontains=search) | Q(actor__username__icontains=search)
                    | Q(actor__first_name__icontains=search) | Q(actor__last_name__icontains=search)
                )

        rows = list(qs.order_by("-created_at", "-id")[:1000])
        exported_at = timezone.localtime().strftime("%Y-%m-%d %H:%M")
        if dataset == "events":
            def changed_fields_for_export(changes):
                """Support both current structured diffs and older simple audit values."""
                fields = []
                for key, change in (changes or {}).items():
                    if key in {"id", "tenant", "tenant_id", "branch", "branch_id"}:
                        continue
                    if isinstance(change, dict):
                        before = change.get("before", "—")
                        after = change.get("after", change.get("related_ids", change.get("action", "—")))
                    else:
                        before, after = "—", change
                    fields.append(f"{key}: {before} -> {after}")
                return "; ".join(fields)

            headers = ["Timestamp", "Actor", "Tenant", "Branch", "Category", "Action", "Outcome", "Model", "Record", "Record ID", "Changed fields", "Notes", "Client IP"]
            values = [[
                timezone.localtime(row.created_at).strftime("%Y-%m-%d %H:%M:%S"),
                (row.actor.get_full_name() or row.actor.username) if row.actor else "Automated / legacy event",
                row.tenant.name if row.tenant_id else "Global", row.branch.name if row.branch_id else "",
                row.get_event_group_display(), row.event_type.replace("_", " ").title(), row.status.title(),
                row.model_label, row.object_repr, row.object_pk,
                changed_fields_for_export(row.changes),
                row.note, (row.metadata or {}).get("client_ip", ""),
            ] for row in rows]
        else:
            headers = ["Timestamp", "Actor", "Tenant", "Category", "Action", "Method", "Path", "Response status", "Client IP", "Referrer"]
            values = [[
                timezone.localtime(row.created_at).strftime("%Y-%m-%d %H:%M:%S"),
                (row.actor.get_full_name() or row.actor.username) if row.actor else "Guest / anonymous",
                row.tenant.name if row.tenant_id else "Global", row.get_event_group_display(), row.event_type.replace("_", " ").title(),
                row.request_method, row.request_path, row.status_code or "", row.remote_addr, (row.metadata or {}).get("referer", ""),
            ] for row in rows]

        filename = f"audit-{dataset}-{timezone.localdate().isoformat()}"
        if export_format == "csv":
            response = HttpResponse(content_type="text/csv; charset=utf-8")
            response["Content-Disposition"] = f'attachment; filename="{filename}.csv"'
            writer = csv.writer(response)
            writer.writerow(headers)
            writer.writerows(values)
            return response

        try:
            buffer = BytesIO()
            page_size = landscape(A4)
            document = SimpleDocTemplate(buffer, pagesize=page_size, rightMargin=22, leftMargin=22, topMargin=28, bottomMargin=28)
            styles = getSampleStyleSheet()
            cell_style = styles["BodyText"].clone("AuditExportCell", fontSize=5.5, leading=6.5, spaceAfter=0, splitLongWords=1)

            # Audit values may contain snapshots or JSON. Keeping each cell concise
            # prevents one oversized row from making an otherwise valid PDF fail.
            def pdf_cell(cell):
                text = " ".join(str(cell or "—").split())
                if len(text) > 96:
                    text = f"{text[:93]}..."
                return Paragraph(escape(text), cell_style)

            body = [Paragraph(f"Audit Log Export - {escape(dataset.title())}", styles["Title"]), Spacer(1, 6), Paragraph(f"Generated {escape(exported_at)} | {len(values)} record(s)", styles["Normal"]), Spacer(1, 12)]
            table_data = [headers] + [[pdf_cell(cell) for cell in row] for row in values]
            usable_width = page_size[0] - document.leftMargin - document.rightMargin
            table = Table(table_data, repeatRows=1, splitByRow=1, colWidths=[usable_width / len(headers)] * len(headers))
            table.setStyle(TableStyle([
                ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#1f2937")), ("TEXTCOLOR", (0, 0), (-1, 0), colors.white),
                ("FONTNAME", (0, 0), (-1, 0), "Helvetica-Bold"), ("FONTSIZE", (0, 0), (-1, -1), 6.5),
                ("LEADING", (0, 0), (-1, -1), 8), ("GRID", (0, 0), (-1, -1), 0.25, colors.HexColor("#d1d5db")),
                ("VALIGN", (0, 0), (-1, -1), "TOP"), ("ROWBACKGROUNDS", (0, 1), (-1, -1), [colors.white, colors.HexColor("#f8fafc")]),
                ("LEFTPADDING", (0, 0), (-1, -1), 3), ("RIGHTPADDING", (0, 0), (-1, -1), 3), ("TOPPADDING", (0, 0), (-1, -1), 3), ("BOTTOMPADDING", (0, 0), (-1, -1), 3),
            ]))
            body.append(table)
            document.build(body)
            response = HttpResponse(buffer.getvalue(), content_type="application/pdf")
            response["Content-Disposition"] = f'attachment; filename="{filename}.pdf"'
            return response
        except Exception:
            logger.exception("audit_pdf_export_failed", extra={"dataset": dataset, "user_id": user.id})
            return error_response(
                "We could not generate this audit PDF. Try the CSV export, or contact your administrator if the problem continues.",
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            )


class RecordAuditTrailAPIView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request):
        user = request.user
        if not _can_view_tenant_audit_logs(user):
            return error_response(
                "You do not have permission to view record audit trails.",
                status_code=status.HTTP_403_FORBIDDEN,
            )

        model_label = request.query_params.get("model_label")
        object_pk = request.query_params.get("object_pk")
        if not model_label or not object_pk:
            return error_response(
                "model_label and object_pk are required.",
                status_code=status.HTTP_400_BAD_REQUEST,
            )

        qs = AuditEventLog.objects.select_related("tenant", "branch", "actor").filter(
            model_label=model_label,
            object_pk=str(object_pk),
        )
        if not _can_view_global_audit_logs(user):
            tenant = _request_tenant_or_none(user)
            if tenant is None:
                return success_response("Record audit trail loaded successfully.", data=[])
            qs = qs.filter(tenant=tenant)
        else:
            tenant = None

        serializer = AuditEventLogSerializer(qs.order_by("-created_at", "-id")[:200], many=True)
        return success_response(
            "Record audit trail loaded successfully.",
            data={
                "summary": get_record_audit_summary(
                    model_label=model_label,
                    object_pk=object_pk,
                    tenant=tenant,
                ),
                "events": serializer.data,
            },
        )


class TenantSelfAPIView(APIView):
    """
    GET/PATCH the tenant that the authenticated user belongs to.
    Superadmins may use this if they have a TenantUserProfile (unusual but valid).
    Plain users without a tenant profile receive 403.
    This endpoint is intentionally separate from TenantDetailAPIView (superadmin-only)
    so that organization admins can manage their own organization profile without platform-admin access.
    """
    permission_classes = [IsAuthenticated]

    def _get_tenant(self, request):
        if _is_superadmin(request.user):
            # Superadmin must supply ?tenant_id= to scope to a specific tenant.
            # Without it, this endpoint has no "self" meaning for a platform superuser.
            tid = request.query_params.get("tenant_id")
            if not tid:
                return None, error_response(
                    "Platform superadmins must supply ?tenant_id= to use this endpoint.",
                    status_code=status.HTTP_400_BAD_REQUEST,
                )
            try:
                return Tenant.objects.get(pk=tid), None
            except Tenant.DoesNotExist:
                return None, error_response("Tenant not found.", status_code=status.HTTP_404_NOT_FOUND)
        tenant = _request_tenant_or_none(request.user)
        if not tenant:
            return None, error_response(
                "Your account is not linked to an organization.",
                status_code=status.HTTP_403_FORBIDDEN,
            )
        return tenant, None

    def get(self, request):
        tenant, err = self._get_tenant(request)
        if err:
            return err
        return success_response("Organization loaded.", data=TenantSerializer(tenant).data)

    def patch(self, request):
        tenant, err = self._get_tenant(request)
        if err:
            return err
        # Only organization admins (or superadmins) may update
        if not _is_superadmin(request.user):
            profile = _tenant_admin_profile(request.user)
            if not profile:
                return error_response(
                    "You must be an organization administrator to update organization information.",
                    status_code=status.HTTP_403_FORBIDDEN,
                )
        serializer = TenantSerializer(tenant, data=request.data, partial=True)
        serializer.is_valid(raise_exception=True)
        serializer.save()
        return success_response("Organization updated.", data=serializer.data)


class TenantListCreateAPIView(ModuleAPIViewMixin, generics.ListCreateAPIView):
    permission_classes = [IsAuthenticated]
    queryset = Tenant.objects.all()
    serializer_class = TenantSerializer
    filterset_fields = ("status", "is_active", "default_currency", "timezone", "industry")
    search_fields = ("name", "code", "legal_name", "subdomain", "primary_domain", "contact_email")
    ordering_fields = ("name", "code", "created_at", "updated_at")

    def get_queryset(self):
        qs = super().get_queryset()
        if _is_superadmin(self.request.user):
            return qs
        membership_tenant_ids = _organization_membership_queryset(self.request.user).values_list("tenant_id", flat=True)
        return qs.filter(pk__in=membership_tenant_ids).distinct()

    def create(self, request, *args, **kwargs):
        serializer = self.get_serializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        with transaction.atomic():
            tenant = serializer.save()
            subscription = None
            if not _is_superadmin(request.user):
                existing_default = _organization_membership_queryset(request.user).exists()
                OrganizationMembership.objects.create(
                    user=request.user,
                    tenant=tenant,
                    role="owner",
                    role_group_name="Tenant Admin",
                    is_org_admin=True,
                    is_default=not existing_default,
                    is_active=True,
                )
                _sync_legacy_tenant_profile(request.user)
                plan_id = request.data.get("plan_id")
                if plan_id:
                    try:
                        plan = SubscriptionPlan.objects.get(pk=plan_id, is_active=True)
                    except SubscriptionPlan.DoesNotExist:
                        raise ValidationError({"plan_id": "Selected plan does not exist or is inactive."})

                    demo_days_raw = request.data.get("demo_days")
                    demo_days = plan.trial_days
                    if demo_days_raw not in (None, ""):
                        try:
                            demo_days = max(0, int(demo_days_raw))
                        except (TypeError, ValueError):
                            raise ValidationError({"demo_days": "demo_days must be a whole number."})

                    start_date = timezone.localdate()
                    status_value = "trial" if demo_days > 0 else "active"
                    end_date = start_date + timedelta(days=demo_days) if demo_days > 0 else None
                    subscription = TenantSubscription.objects.create(
                        tenant=tenant,
                        plan=plan,
                        status=status_value,
                        start_date=start_date,
                        end_date=end_date,
                        amount=plan.price,
                        currency=plan.currency,
                        metadata={
                            "demo_days": demo_days,
                            "start_with_demo": bool(request.data.get("start_with_demo", False)),
                            "created_from": "self_onboarding",
                        },
                    )
                    sync_subscription_modules(subscription)
        payload = self.get_serializer(tenant).data
        if subscription is not None:
            payload["subscription"] = TenantSubscriptionSerializer(subscription).data
        return success_response("Tenant created.", data=payload, status=201)


class TenantDetailAPIView(generics.RetrieveUpdateDestroyAPIView):
    permission_classes = [IsAuthenticated]
    queryset = Tenant.objects.all()
    serializer_class = TenantSerializer

    def get_queryset(self):
        qs = super().get_queryset()
        if _is_superadmin(self.request.user):
            return qs
        membership_tenant_ids = _organization_membership_queryset(self.request.user).filter(is_org_admin=True).values_list("tenant_id", flat=True)
        return qs.filter(pk__in=membership_tenant_ids).distinct()

    def destroy(self, request, *args, **kwargs):
        return error_response(
            "Direct organization deletion is disabled until a tenant offboarding workflow with export and purge safeguards is implemented.",
            status_code=status.HTTP_405_METHOD_NOT_ALLOWED,
        )


class TenantOffboardingStatusAPIView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request, pk):
        tenant = get_object_or_404(Tenant, pk=pk)
        denied = _require_tenant_access(request, tenant)
        if denied:
            return denied

        latest_request = TenantOffboardingRequest.objects.filter(tenant=tenant).select_related(
            "tenant", "requested_by", "approved_by"
        ).order_by("-created_at", "-id").first()
        latest_export = TenantExportJob.objects.filter(tenant=tenant).select_related(
            "tenant", "requested_by", "offboarding_request"
        ).order_by("-created_at", "-id").first()
        latest_purge = TenantPurgeJob.objects.filter(tenant=tenant).select_related(
            "tenant", "requested_by", "approved_by", "offboarding_request"
        ).order_by("-created_at", "-id").first()

        return success_response(
            "Tenant offboarding status loaded.",
            data={
                "tenant": TenantSerializer(tenant).data,
                "offboarding_request": TenantOffboardingRequestSerializer(
                    latest_request, context={"request": request}
                ).data if latest_request else None,
                "latest_export_job": TenantExportJobSerializer(
                    latest_export, context={"request": request}
                ).data if latest_export else None,
                "latest_purge_job": TenantPurgeJobSerializer(
                    latest_purge, context={"request": request}
                ).data if latest_purge else None,
                "capabilities": {
                    "can_request_delete": True,
                    "can_queue_export": True,
                    "can_purge_now": False,
                    "raw_delete_blocked": True,
                },
            },
        )


class TenantOffboardingExportAPIView(APIView):
    permission_classes = [IsAuthenticated]

    def post(self, request, pk):
        tenant = get_object_or_404(Tenant, pk=pk)
        denied = _require_tenant_access(request, tenant)
        if denied:
            return denied

        active_job = TenantExportJob.objects.filter(
            tenant=tenant,
            status__in={"queued", "running"},
        ).order_by("-created_at", "-id").first()
        if active_job:
            return success_response(
                "An export job is already in progress for this organization.",
                data=TenantExportJobSerializer(active_job, context={"request": request}).data,
            )

        latest_request = TenantOffboardingRequest.objects.filter(tenant=tenant).order_by("-created_at", "-id").first()
        export_format = str(request.data.get("export_format") or "json_bundle").strip() or "json_bundle"
        if export_format not in {"json_bundle", "csv_bundle"}:
            return error_response(
                "Unsupported export_format. Use json_bundle or csv_bundle.",
                status_code=status.HTTP_400_BAD_REQUEST,
            )

        job = TenantExportJob.objects.create(
            tenant=tenant,
            offboarding_request=latest_request,
            requested_by=request.user,
            status="queued",
            export_format=export_format,
            storage_backend="local",
            metadata={
                "requested_via": "tenant_offboarding_export_api",
                "requested_at": timezone.now().isoformat(),
            },
        )
        return success_response(
            "Tenant export job queued.",
            data=TenantExportJobSerializer(job, context={"request": request}).data,
            status=status.HTTP_201_CREATED,
        )


class TenantOffboardingRequestDeleteAPIView(APIView):
    permission_classes = [IsAuthenticated]

    def post(self, request, pk):
        tenant = get_object_or_404(Tenant, pk=pk)
        denied = _require_tenant_access(request, tenant)
        if denied:
            return denied

        retention_until = _tenant_offboarding_retention_until(days=request.data.get("retention_days"))
        offboarding_request = TenantOffboardingRequest.objects.create(
            tenant=tenant,
            requested_by=request.user,
            status="deletion_requested",
            requested_at=timezone.now(),
            retention_until=retention_until,
            export_requested=bool(request.data.get("export_requested", True)),
            notes=str(request.data.get("notes") or "").strip(),
            metadata={
                "requested_via": "tenant_offboarding_request_delete_api",
                "requested_at": timezone.now().isoformat(),
            },
        )

        export_job = None
        if offboarding_request.export_requested:
            export_job = TenantExportJob.objects.create(
                tenant=tenant,
                offboarding_request=offboarding_request,
                requested_by=request.user,
                status="queued",
                export_format="json_bundle",
                storage_backend="local",
                metadata={
                    "requested_via": "tenant_offboarding_request_delete_api",
                    "auto_created_from_delete_request": True,
                },
            )

        return success_response(
            "Tenant deletion request recorded.",
            data={
                "offboarding_request": TenantOffboardingRequestSerializer(
                    offboarding_request,
                    context={"request": request},
                ).data,
                "export_job": TenantExportJobSerializer(
                    export_job,
                    context={"request": request},
                ).data if export_job else None,
            },
            status=status.HTTP_201_CREATED,
        )


# ── Tenant Provisioning ────────────────────────────────────────────────────────

@api_view(["POST"])
def provision_tenant(request):
    """
    Super-admin endpoint: create an organization plus its first organization admin in one shot.
    Returns the temporary password so the super admin can hand it off.
    """
    denied = _require_superadmin(request)
    if denied:
        return denied
    data = request.data
    required = ["name", "contact_email", "admin_first_name", "admin_last_name", "admin_email"]
    for field in required:
        if not data.get(field):
            return error_response(f"'{field}' is required.", status_code=status.HTTP_400_BAD_REQUEST)

    # Guard duplicate subdomain before entering the atomic block so that an
    # IntegrityError from the unique constraint never surfaces as a 500.
    subdomain = data.get("subdomain") or None  # treat "" the same as absent
    if subdomain and Tenant.objects.filter(subdomain=subdomain).exists():
        return error_response(
            f"The subdomain '{subdomain}' is already taken. Please choose a different one.",
            status_code=status.HTTP_400_BAD_REQUEST,
        )

    # Guard duplicate organization name so two organizations can't share the same display name.
    tenant_name = data["name"]
    if Tenant.objects.filter(name=tenant_name).exists():
        return error_response(
            f"An organization with the name '{tenant_name}' already exists.",
            status_code=status.HTTP_400_BAD_REQUEST,
        )

    # Guard duplicate admin email before entering the atomic block so that an
    # IntegrityError from the email unique constraint never surfaces as a 500.
    admin_email = data["admin_email"]
    if User.objects.filter(email=admin_email).exists():
        return error_response(
            "A user with this email already exists.",
            status_code=status.HTTP_400_BAD_REQUEST,
        )

    with transaction.atomic():
        # Create tenant
        tenant_serializer = TenantSerializer(data={
            "name": data["name"],
            "legal_name": data.get("legal_name", ""),
            "subdomain": subdomain,
            "contact_email": data["contact_email"],
            "contact_phone": data.get("contact_phone", ""),
            "industry_id": data.get("industry_id") or None,
            "status": "active",
            "is_active": True,
        })
        tenant_serializer.is_valid(raise_exception=True)
        tenant = tenant_serializer.save()

        # Create admin user
        base_username = data["admin_email"].split("@")[0].lower().replace(".", "_")
        username = base_username
        counter = 1
        while User.objects.filter(username=username).exists():
            username = f"{base_username}{counter}"
            counter += 1

        temp_password = _gen_password(12)
        admin_user = User.objects.create_user(
            username=username,
            email=data["admin_email"],
            first_name=data["admin_first_name"],
            last_name=data["admin_last_name"],
            password=temp_password,
            is_active=True,
            is_staff=False,   # Organization admins are NOT platform/django-admin staff
            is_superuser=False,
        )

        # Assign to the compatibility group used for organization admins
        group, _ = Group.objects.get_or_create(name="Tenant Admin")
        admin_user.groups.add(group)

        # Create profile
        TenantUserProfile.objects.create(
            user=admin_user,
            tenant=tenant,
            is_tenant_admin=True,
            job_title="Organization Administrator",
        )
        OrganizationMembership.objects.create(
            user=admin_user,
            tenant=tenant,
            role="system_admin",
            role_group_name="Tenant Admin",
            is_org_admin=True,
            is_default=True,
            is_active=True,
            job_title="Organization Administrator",
        )
        _sync_legacy_tenant_profile(admin_user)

        # Create default TenantSettings
        TenantSettings.objects.get_or_create(tenant=tenant, defaults={"invoice_prefix": "INV"})

        # Subscribe to plan if provided
        plan_id = data.get("plan_id")
        subscription = None
        if plan_id:
            try:
                plan = SubscriptionPlan.objects.get(pk=plan_id)
                demo_days_raw = data.get("demo_days")
                demo_days = plan.trial_days
                if demo_days_raw not in (None, ""):
                    try:
                        demo_days = max(0, int(demo_days_raw))
                    except (TypeError, ValueError):
                        return error_response(
                            "'demo_days' must be a whole number.",
                            status_code=status.HTTP_400_BAD_REQUEST,
                        )
                subscription_status = "trial" if demo_days > 0 else "active"
                start_date = timezone.localdate()
                end_date = start_date + timedelta(days=demo_days) if demo_days > 0 else None
                subscription = TenantSubscription.objects.create(
                    tenant=tenant,
                    plan=plan,
                    status=subscription_status,
                    start_date=start_date,
                    end_date=end_date,
                    metadata={"demo_days": demo_days},
                )
                sync_subscription_modules(subscription)
            except SubscriptionPlan.DoesNotExist:
                pass

    return success_response(
        "Tenant provisioned successfully.",
        data={
            "tenant": TenantSerializer(tenant).data,
            "admin_username": admin_user.username,
            "admin_email": admin_user.email,
            "admin_temp_password": temp_password,
            "subscription_id": subscription.id if subscription else None,
            "subscription_status": subscription.status if subscription else None,
            "demo_days": subscription.metadata.get("demo_days") if subscription else None,
        },
    )


@api_view(["POST"])
def suspend_tenant(request, pk):
    denied = _require_superadmin(request)
    if denied:
        return denied
    try:
        tenant = Tenant.objects.get(pk=pk)
    except Tenant.DoesNotExist:
        return error_response("Tenant not found.", status_code=status.HTTP_404_NOT_FOUND)
    tenant.status = "suspended"
    tenant.is_active = False
    tenant.save(update_fields=["status", "is_active"])
    return success_response("Tenant suspended.", data=TenantSerializer(tenant).data)


@api_view(["POST"])
def activate_tenant(request, pk):
    denied = _require_superadmin(request)
    if denied:
        return denied
    try:
        tenant = Tenant.objects.get(pk=pk)
    except Tenant.DoesNotExist:
        return error_response("Tenant not found.", status_code=status.HTTP_404_NOT_FOUND)
    tenant.status = "active"
    tenant.is_active = True
    tenant.save(update_fields=["status", "is_active"])
    return success_response("Tenant activated.", data=TenantSerializer(tenant).data)


# ── Tenant Branches ────────────────────────────────────────────────────────────

class TenantBranchListCreateAPIView(APIView):
    permission_classes = [IsAuthenticated]

    def _resolve_tenant(self, pk):
        try:
            return Tenant.objects.get(pk=pk)
        except Tenant.DoesNotExist:
            return None

    def get(self, request, pk):
        tenant = self._resolve_tenant(pk)
        if not tenant:
            return error_response("Tenant not found.", status_code=status.HTTP_404_NOT_FOUND)
        denied = _require_tenant_access(request, tenant)
        if denied:
            return denied
        branches = TenantBranch.objects.filter(tenant=tenant)
        return success_response("Branches loaded.", data={
            "tenant_id": tenant.id,
            "branches": TenantBranchSerializer(branches, many=True).data,
        })

    def post(self, request, pk):
        tenant = self._resolve_tenant(pk)
        if not tenant:
            return error_response("Tenant not found.", status_code=status.HTTP_404_NOT_FOUND)
        denied = _require_tenant_access(request, tenant)
        if denied:
            return denied
        serializer = TenantBranchSerializer(data={**request.data, "tenant": tenant.id})
        serializer.is_valid(raise_exception=True)
        branch = serializer.save(tenant=tenant)
        sync_tenant_branch_to_operational(branch)
        return success_response("Branch created.", data=TenantBranchSerializer(branch).data)


class TenantBranchDetailAPIView(APIView):
    permission_classes = [IsAuthenticated]

    def _get_branch(self, pk):
        try:
            return TenantBranch.objects.select_related("tenant").get(pk=pk)
        except TenantBranch.DoesNotExist:
            return None

    def get(self, request, pk):
        b = self._get_branch(pk)
        if not b:
            return error_response("Branch not found.", status_code=status.HTTP_404_NOT_FOUND)
        denied = _require_tenant_access(request, b.tenant)
        if denied:
            return denied
        return success_response("Branch loaded.", data=TenantBranchSerializer(b).data)

    def patch(self, request, pk):
        b = self._get_branch(pk)
        if not b:
            return error_response("Branch not found.", status_code=status.HTTP_404_NOT_FOUND)
        denied = _require_tenant_access(request, b.tenant)
        if denied:
            return denied
        s = TenantBranchSerializer(b, data=request.data, partial=True)
        s.is_valid(raise_exception=True)
        branch = s.save()
        sync_tenant_branch_to_operational(branch)
        return success_response("Branch updated.", data=s.data)

    def put(self, request, pk):
        return self.patch(request, pk)


# ── Tenant Users & Invite ──────────────────────────────────────────────────────

class TenantUserListAPIView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request, pk):
        try:
            tenant = Tenant.objects.get(pk=pk)
        except Tenant.DoesNotExist:
            return error_response("Tenant not found.", status_code=status.HTTP_404_NOT_FOUND)
        denied = _require_tenant_access(request, tenant)
        if denied:
            return denied
        users = list(
            User.objects.filter(
                Q(tenant_profile__tenant=tenant) |
                Q(organization_memberships__tenant=tenant, organization_memberships__is_active=True),
                is_superuser=False,
            )
            .prefetch_related(
                "groups",
                "user_permissions",
                "tenant_profile__tenant",
                "organization_memberships__tenant",
                "organization_memberships__branch",
            )
            .distinct()
        )
        return success_response("Users loaded.", data={
            "tenant_id": tenant.id,
            "users": UserProfileSerializer(users, many=True).data,
        })


class TenantUserInviteAPIView(APIView):
    permission_classes = [IsAuthenticated]

    def post(self, request, pk):
        try:
            tenant = Tenant.objects.get(pk=pk)
        except Tenant.DoesNotExist:
            return error_response("Tenant not found.", status_code=status.HTTP_404_NOT_FOUND)
        denied = _require_tenant_access(request, tenant)
        if denied:
            return denied

        data = request.data
        if not data.get("email") or not data.get("first_name"):
            return error_response("'email' and 'first_name' are required.", status_code=status.HTTP_400_BAD_REQUEST)

        supplied_password = str(data.get("password") or "").strip()
        if supplied_password and len(supplied_password) < 8:
            return error_response(
                "Password must be at least 8 characters long.",
                status_code=status.HTTP_400_BAD_REQUEST,
            )

        # Resolve the requested role before creating the user.  Role names are
        # tenant scoped internally (tenant:<id>:<label>), so silently creating a
        # global Django group here would make a role selected in the UI differ
        # from the role that was actually assigned.
        role_group = None
        role_group_id = data.get("role_group_id")
        role_group_name = str(data.get("role_group") or "").strip()
        if role_group_id:
            role_group = Group.objects.filter(pk=role_group_id).first()
        elif role_group_name:
            role_group = Group.objects.filter(name=role_group_name).first()

        if role_group is None:
            return error_response("Select a valid role.", status_code=status.HTTP_400_BAD_REQUEST)

        role_is_for_tenant = _role_belongs_to_tenant(role_group, tenant.id)
        role_is_shared = role_group.name in (TENANT_ASSIGNABLE_SHARED_ROLE_NAMES | {"Tenant Admin"})
        if not role_is_for_tenant and not role_is_shared:
            return error_response(
                "The selected role is not available to this organization.",
                status_code=status.HTTP_400_BAD_REQUEST,
            )

        # Build unique username
        base_un = (data.get("username") or data["email"].split("@")[0]).lower().replace(".", "_")
        username = base_un
        counter = 1
        while User.objects.filter(username=username).exists():
            username = f"{base_un}{counter}"
            counter += 1

        temp_password = supplied_password or _gen_password(12)
        with transaction.atomic():
            new_user = User.objects.create_user(
                username=username,
                email=data["email"],
                first_name=data.get("first_name", ""),
                last_name=data.get("last_name", ""),
                password=temp_password,
                is_active=True,
            )
            new_user.groups.add(role_group)

            # Resolve branch
            branch = None
            branch_id = data.get("branch_id")
            if branch_id:
                branch = TenantBranch.objects.filter(pk=branch_id, tenant=tenant).first()

            is_org_admin = role_group.name == "Tenant Admin"
            TenantUserProfile.objects.create(
                user=new_user,
                tenant=tenant,
                branch=branch,
                is_tenant_admin=is_org_admin,
                job_title=data.get("job_title", ""),
            )
            OrganizationMembership.objects.update_or_create(
                user=new_user,
                tenant=tenant,
                defaults={
                    "branch": branch,
                    "role": _resolve_membership_role(role_group.name, is_org_admin),
                    "role_group_name": role_group.name,
                    "is_org_admin": is_org_admin,
                    "is_default": not OrganizationMembership.objects.filter(user=new_user, is_active=True).exists(),
                    "is_active": True,
                    "job_title": data.get("job_title", ""),
                },
            )
            _sync_legacy_tenant_profile(new_user)

        email_sent = False
        email_error = ""
        settings_obj = TenantSettings.objects.filter(tenant=tenant).first()
        if not settings_obj or not settings_obj.smtp_host or not settings_obj.smtp_user or not settings_obj.smtp_password:
            email_error = "Tenant SMTP settings are incomplete. Share the temporary password manually."
        else:
            try:
                from django.core.mail import EmailMessage

                login_path = f"/login/{tenant.code}" if tenant.code else "/login"
                login_url = _frontend_url(request, login_path)
                recipient_name = new_user.first_name or new_user.username
                connection = get_tenant_smtp_connection(settings_obj)
                email = EmailMessage(
                    subject=f"Your {tenant.name} ERP account",
                    body=(
                        f"Hello {recipient_name},\n\n"
                        f"An account has been created for you in the {tenant.name} ERP workspace.\n\n"
                        f"Username: {new_user.username}\n"
                        f"Temporary password: {temp_password}\n"
                        f"Login URL: {login_url}\n\n"
                        "Please sign in and change your password immediately.\n"
                    ),
                    from_email=settings_obj.support_email or settings_obj.smtp_user,
                    to=[new_user.email],
                    connection=connection,
                )
                email.send(fail_silently=False)
                email_sent = True
            except Exception as exc:
                email_error = _smtp_delivery_error(exc)

        return success_response(
            "User invited and email sent successfully." if email_sent else "User created, but the invitation email was not sent.",
            data={
                "user": UserProfileSerializer(new_user).data,
                "temp_password": temp_password,
                "email_sent": email_sent,
                "email_error": email_error,
            },
        )


# ── Tenant Settings ────────────────────────────────────────────────────────────

class PlatformBrandingSettingsAPIView(APIView):
    """Platform-wide SaaS shell configuration; never writable by tenant admins."""

    permission_classes = [IsAuthenticated, IsSuperAdminPermission]
    parser_classes = [JSONParser, MultiPartParser, FormParser]

    def get(self, request):
        profile = _platform_branding_settings()
        return success_response(
            "Platform branding loaded.",
            data=PlatformBrandingSettingsSerializer(profile, context={"request": request}).data,
        )

    def put(self, request):
        profile = _platform_branding_settings()
        serializer = PlatformBrandingSettingsSerializer(
            profile,
            data=request.data,
            partial=True,
            context={"request": request},
        )
        serializer.is_valid(raise_exception=True)
        serializer.save()
        return success_response(
            "Platform branding saved.",
            data=PlatformBrandingSettingsSerializer(profile, context={"request": request}).data,
        )

    def patch(self, request):
        return self.put(request)

class TenantSettingsAPIView(APIView):
    permission_classes = [IsAuthenticated]
    parser_classes = [JSONParser, MultiPartParser, FormParser]

    def _get_settings(self, pk):
        try:
            tenant = Tenant.objects.get(pk=pk)
        except Tenant.DoesNotExist:
            return None, None
        settings_obj, _ = TenantSettings.objects.get_or_create(tenant=tenant)
        return tenant, settings_obj

    def get(self, request, pk):
        tenant, settings_obj = self._get_settings(pk)
        if settings_obj is None:
            return error_response("Tenant not found.", status_code=status.HTTP_404_NOT_FOUND)
        is_admin = _is_superadmin(request.user) or _user_has_tenant_access(
            request.user, tenant, require_admin=True
        )
        if not is_admin and not _user_has_tenant_access(request.user, tenant):
            return error_response(
                "You do not have permission to access this organization's settings.",
                status_code=status.HTTP_403_FORBIDDEN,
            )
        if is_admin:
            ensure_shared_document_template_library()
            return success_response(
                "Settings loaded.",
                data=TenantSettingsSerializer(settings_obj, context={"request": request}).data,
            )

        # Workspace members need their organization identity at login, but
        # must never receive administrative configuration or SMTP details.
        safe_fields = {
            "id", "tenant", "logo_url", "primary_color", "workspace_name",
            "support_email", "footer_text", "invoice_prefix",
        }
        serialized = TenantSettingsSerializer(settings_obj, context={"request": request}).data
        return success_response(
            "Workspace branding loaded.",
            data={key: value for key, value in serialized.items() if key in safe_fields},
        )

    def put(self, request, pk):
        tenant, settings_obj = self._get_settings(pk)
        if settings_obj is None:
            return error_response("Tenant not found.", status_code=status.HTTP_404_NOT_FOUND)
        denied = _require_tenant_access(request, tenant)
        if denied:
            return denied

        s = TenantSettingsSerializer(settings_obj, data=request.data, partial=True, context={"request": request})
        s.is_valid(raise_exception=True)
        for field_name, document_type in (
            ("invoice_template", "invoice"),
            ("estimate_template", "quotation"),
            ("receipt_template", "receipt"),
            ("statement_template", "statement"),
            ("purchase_order_template", "purchase_order"),
        ):
            template = s.validated_data.get(field_name)
            if not template:
                continue
            if template.document_type != document_type:
                return error_response(
                    f"{field_name} must reference a {document_type} template.",
                    status_code=status.HTTP_400_BAD_REQUEST,
                )
            if template.tenant_id not in (None, tenant.id):
                return error_response(
                    f"{field_name} must belong to your tenant or be a shared template.",
                    status_code=status.HTTP_400_BAD_REQUEST,
                )
        s.save()
        return success_response("Settings saved.", data=TenantSettingsSerializer(settings_obj, context={"request": request}).data)

    def patch(self, request, pk):
        return self.put(request, pk)


@api_view(["POST"])
def test_tenant_smtp(request, pk):
    try:
        tenant = Tenant.objects.get(pk=pk)
        ts = TenantSettings.objects.get(tenant=tenant)
    except (Tenant.DoesNotExist, TenantSettings.DoesNotExist):
        return error_response("Tenant or settings not found.", status_code=status.HTTP_404_NOT_FOUND)
    denied = _require_tenant_access(request, tenant)
    if denied:
        return denied

    if not ts.smtp_host or not ts.smtp_user or not ts.smtp_password:
        return error_response(
            "SMTP host, username, and password must be configured before sending a test email.",
            status_code=status.HTTP_400_BAD_REQUEST,
        )
    recipient = (ts.support_email or ts.smtp_user or "").strip()
    if not recipient:
        return error_response(
            "Configure a support email or SMTP username to receive the test message.",
            status_code=status.HTTP_400_BAD_REQUEST,
        )

    try:
        from django.core.mail import EmailMessage
        conn = get_tenant_smtp_connection(ts)
        email = EmailMessage(
            subject=f"SL-ERP SMTP test — {tenant.name}",
            body="This is a test email from your SL-ERP configuration.",
            from_email=ts.support_email or ts.smtp_user,
            to=[recipient],
            connection=conn,
        )
        email.send()
        return success_response("Test email sent successfully.", data={"message": f"Test email sent to {recipient}"})
    except Exception as exc:
        # Retain the original exception in protected server logs. The response
        # remains safe to show to users and never exposes SMTP credentials.
        logger.exception(
            "Tenant SMTP test failed for tenant=%s host=%s port=%s ssl=%s starttls=%s",
            tenant.id,
            ts.smtp_host,
            ts.smtp_port,
            ts.smtp_use_ssl,
            ts.smtp_use_tls,
        )
        message = _smtp_delivery_error(exc)
        return error_response(f"SMTP test failed: {message}", status_code=status.HTTP_502_BAD_GATEWAY)


# ── User update (deactivate/reactivate) ───────────────────────────────────────

class PlatformUserUpdateAPIView(APIView):
    permission_classes = [IsAuthenticated]

    def patch(self, request, pk):
        try:
            user = User.objects.get(pk=pk)
        except User.DoesNotExist:
            return error_response("User not found.", status_code=status.HTTP_404_NOT_FOUND)

        is_self_update = request.user.pk == user.pk
        if is_self_update:
            protected_fields = {"is_active", "is_tenant_admin", "branch_id", "job_title"}
            attempted_protected_fields = protected_fields.intersection(request.data.keys())
            if attempted_protected_fields:
                return error_response(
                    "Use your Profile to update personal details. Organization access can only be changed by another administrator.",
                    status_code=status.HTTP_400_BAD_REQUEST,
                )

        # Superadmin can update anyone. Tenant-admin can only update users within
        # their own tenant. A user can always update themselves.
        if request.user.pk != user.pk:
            if _is_superadmin(request.user):
                pass  # allowed
            else:
                requesting_tenant = _request_tenant_or_none(request.user)
                if not requesting_tenant or not _user_has_tenant_access(request.user, requesting_tenant, require_admin=True):
                    return error_response(
                        "You do not have permission to update this user.",
                        status_code=status.HTTP_403_FORBIDDEN,
                    )
                target_has_access = OrganizationMembership.objects.filter(
                    user=user,
                    tenant=requesting_tenant,
                    is_active=True,
                ).exists()
                target_profile = getattr(user, "tenant_profile", None)
                if not target_has_access and not (target_profile and target_profile.tenant_id == requesting_tenant.id):
                    return error_response(
                        "You do not have permission to update this user.",
                        status_code=status.HTTP_403_FORBIDDEN,
                    )

        with transaction.atomic():
            email = request.data.get("email")
            if email is not None:
                email = str(email).strip()
                if email and User.objects.exclude(pk=user.pk).filter(email__iexact=email).exists():
                    return error_response(
                        "A user with this email already exists.",
                        status_code=status.HTTP_400_BAD_REQUEST,
                    )
                user.email = email

            username = request.data.get("username")
            if username is not None:
                username = str(username).strip()
                if not username:
                    return error_response(
                        "Username cannot be blank.",
                        status_code=status.HTTP_400_BAD_REQUEST,
                    )
                if User.objects.exclude(pk=user.pk).filter(username__iexact=username).exists():
                    return error_response(
                        "A user with this username already exists.",
                        status_code=status.HTTP_400_BAD_REQUEST,
                    )
                user.username = username

            if "is_active" in request.data:
                user.is_active = bool(request.data["is_active"])

            if "first_name" in request.data:
                user.first_name = request.data["first_name"]
            if "last_name" in request.data:
                user.last_name = request.data["last_name"]

            password = request.data.get("password")
            if password is not None:
                password = str(password)
                if password.strip():
                    if is_self_update and not request.user.check_password(str(request.data.get("current_password") or "")):
                        return error_response(
                            "Enter your current password to change it. You can do this from the Profile menu.",
                            status_code=status.HTTP_400_BAD_REQUEST,
                        )
                    if len(password) < 8:
                        return error_response(
                            "Password must be at least 8 characters long.",
                            status_code=status.HTTP_400_BAD_REQUEST,
                        )
                    user.set_password(password)

            update_fields = set()
            for field in ("is_active", "first_name", "last_name", "email", "username", "password"):
                if field in request.data:
                    if field == "password":
                        update_fields.add("password")
                    else:
                        update_fields.add(field)
            if update_fields:
                user.save()

            profile = getattr(user, "tenant_profile", None)
            active_membership = _active_organization_membership(user)
            if profile:
                if "is_tenant_admin" in request.data and not _is_superadmin(request.user):
                    return error_response(
                        "Only platform administrators may change organization admin status.",
                        status_code=status.HTTP_403_FORBIDDEN,
                    )
                if "job_title" in request.data:
                    profile.job_title = request.data.get("job_title") or ""
                if "branch_id" in request.data:
                    branch_id = request.data.get("branch_id")
                    if branch_id in ("", None):
                        profile.branch = None
                    else:
                        branch = TenantBranch.objects.filter(pk=branch_id, tenant=profile.tenant).first()
                        if not branch:
                            return error_response(
                                "Branch not found for this tenant.",
                                status_code=status.HTTP_400_BAD_REQUEST,
                            )
                        profile.branch = branch
                if "is_tenant_admin" in request.data:
                    is_tenant_admin = bool(request.data["is_tenant_admin"])
                    profile.is_tenant_admin = is_tenant_admin
                    tenant_admin_group, _ = Group.objects.get_or_create(name="Tenant Admin")
                    if is_tenant_admin:
                        user.groups.add(tenant_admin_group)
                    else:
                        user.groups.remove(tenant_admin_group)
                if any(key in request.data for key in ("job_title", "branch_id", "is_tenant_admin")):
                    profile.save()

            membership = active_membership
            if membership and profile and membership.tenant_id != profile.tenant_id:
                membership = OrganizationMembership.objects.filter(
                    user=user,
                    tenant=profile.tenant,
                    is_active=True,
                ).order_by("-is_default", "id").first() or membership

            if membership:
                membership_changed = False
                if "job_title" in request.data:
                    membership.job_title = request.data.get("job_title") or ""
                    membership_changed = True
                if "branch_id" in request.data:
                    branch_id = request.data.get("branch_id")
                    if branch_id in ("", None):
                        membership.branch = None
                    else:
                        branch = TenantBranch.objects.filter(pk=branch_id, tenant=membership.tenant).first()
                        if not branch:
                            return error_response(
                                "Branch not found for this organization.",
                                status_code=status.HTTP_400_BAD_REQUEST,
                            )
                        membership.branch = branch
                    membership_changed = True
                if "is_tenant_admin" in request.data:
                    membership.is_org_admin = bool(request.data["is_tenant_admin"])
                    membership.role = "system_admin" if membership.is_org_admin else (membership.role if membership.role != "system_admin" else "member")
                    membership.role_group_name = "Tenant Admin" if membership.is_org_admin else membership.role_group_name
                    membership_changed = True
                if membership_changed:
                    membership.save()

            _sync_legacy_tenant_profile(user)

        return success_response("User updated.", data=UserProfileSerializer(user).data)


class PlatformUserMembershipListCreateAPIView(APIView):
    permission_classes = [IsAuthenticated]

    def _get_target_user(self, pk):
        try:
            return User.objects.get(pk=pk)
        except User.DoesNotExist:
            return None

    def get(self, request, pk):
        target_user = self._get_target_user(pk)
        if not target_user:
            return error_response("User not found.", status_code=status.HTTP_404_NOT_FOUND)

        if not _is_superadmin(request.user) and request.user.pk != target_user.pk:
            caller_profile = _tenant_admin_profile(request.user)
            if not caller_profile:
                return error_response(
                    "You do not have permission to view organization memberships for this user.",
                    status_code=status.HTTP_403_FORBIDDEN,
                )
            manageable_ids = set(
                _organization_membership_queryset(request.user).filter(is_org_admin=True).values_list("tenant_id", flat=True)
            )
            target_ids = set(
                OrganizationMembership.objects.filter(user=target_user, is_active=True).values_list("tenant_id", flat=True)
            )
            if manageable_ids.isdisjoint(target_ids):
                return error_response(
                    "You do not have permission to view organization memberships for this user.",
                    status_code=status.HTTP_403_FORBIDDEN,
                )

        memberships = OrganizationMembership.objects.filter(user=target_user).select_related("tenant", "branch").order_by("-is_default", "tenant__name")
        return success_response(
            "Organization memberships loaded.",
            data={"memberships": OrganizationMembershipSerializer(memberships, many=True).data},
        )

    def post(self, request, pk):
        target_user = self._get_target_user(pk)
        if not target_user:
            return error_response("User not found.", status_code=status.HTTP_404_NOT_FOUND)

        tenant_id = request.data.get("tenant_id") or request.data.get("tenant")
        if not tenant_id:
            return error_response("tenant_id is required.", status_code=status.HTTP_400_BAD_REQUEST)
        tenant = Tenant.objects.filter(pk=tenant_id).first()
        if not tenant:
            return error_response("Tenant not found.", status_code=status.HTTP_404_NOT_FOUND)

        if not _is_superadmin(request.user) and not _user_has_tenant_access(request.user, tenant, require_admin=True):
            return error_response(
                "You do not have permission to assign users to this organization.",
                status_code=status.HTTP_403_FORBIDDEN,
            )

        branch = None
        branch_id = request.data.get("branch_id")
        if branch_id:
            branch = TenantBranch.objects.filter(pk=branch_id, tenant=tenant).first()
            if not branch:
                return error_response("Branch not found for this organization.", status_code=status.HTTP_400_BAD_REQUEST)
        branch_ids = request.data.get("branch_ids")
        if branch_ids is not None:
            if not isinstance(branch_ids, list):
                return error_response("branch_ids must be a list.", status_code=status.HTTP_400_BAD_REQUEST)
            assigned_branches = list(TenantBranch.objects.filter(tenant=tenant, pk__in=branch_ids, is_active=True))
            if len(assigned_branches) != len({str(value) for value in branch_ids}):
                return error_response("One or more assigned branches do not belong to this organization.", status_code=status.HTTP_400_BAD_REQUEST)
            if branch is None and assigned_branches:
                branch = assigned_branches[0]
        else:
            assigned_branches = [branch] if branch else []

        role_group_name = str(request.data.get("role_group_name") or request.data.get("role_group") or "").strip()
        is_org_admin = bool(request.data.get("is_org_admin")) or role_group_name == "Tenant Admin"
        role = str(request.data.get("role") or _resolve_membership_role(role_group_name, is_org_admin)).strip() or "member"
        is_default = bool(request.data.get("is_default"))

        with transaction.atomic():
            membership, created = OrganizationMembership.objects.update_or_create(
                user=target_user,
                tenant=tenant,
                defaults={
                    "branch": branch,
                    "role": role,
                    "role_group_name": role_group_name,
                    "is_org_admin": is_org_admin,
                    "is_active": bool(request.data.get("is_active", True)),
                    "job_title": str(request.data.get("job_title") or "").strip(),
                },
            )
            membership.branches.set(assigned_branches)
            if is_default or not OrganizationMembership.objects.filter(user=target_user, is_default=True, is_active=True).exclude(pk=membership.pk).exists():
                OrganizationMembership.objects.filter(user=target_user).exclude(pk=membership.pk).update(is_default=False)
                membership.is_default = True
                membership.save(update_fields=["is_default", "updated_at"])
            _sync_legacy_tenant_profile(target_user)

        status_code = status.HTTP_201_CREATED if created else status.HTTP_200_OK
        message = "Organization membership created." if created else "Organization membership updated."
        return success_response(message, data=OrganizationMembershipSerializer(membership).data, status=status_code)


class PlatformUserMembershipDetailAPIView(APIView):
    permission_classes = [IsAuthenticated]

    def _get_membership(self, pk):
        return OrganizationMembership.objects.select_related("user", "tenant", "branch").filter(pk=pk).first()

    def patch(self, request, pk):
        membership = self._get_membership(pk)
        if not membership:
            return error_response("Organization membership not found.", status_code=status.HTTP_404_NOT_FOUND)
        if not _is_superadmin(request.user) and not _user_has_tenant_access(request.user, membership.tenant, require_admin=True):
            return error_response(
                "You do not have permission to manage this organization membership.",
                status_code=status.HTTP_403_FORBIDDEN,
            )

        if "branch_id" in request.data:
            branch_id = request.data.get("branch_id")
            if branch_id in ("", None):
                membership.branch = None
            else:
                branch = TenantBranch.objects.filter(pk=branch_id, tenant=membership.tenant).first()
                if not branch:
                    return error_response("Branch not found for this organization.", status_code=status.HTTP_400_BAD_REQUEST)
                membership.branch = branch

        assigned_branches = None
        if "branch_ids" in request.data:
            branch_ids = request.data.get("branch_ids")
            if not isinstance(branch_ids, list):
                return error_response("branch_ids must be a list.", status_code=status.HTTP_400_BAD_REQUEST)
            assigned_branches = list(TenantBranch.objects.filter(tenant=membership.tenant, pk__in=branch_ids, is_active=True))
            if len(assigned_branches) != len({str(value) for value in branch_ids}):
                return error_response("One or more assigned branches do not belong to this organization.", status_code=status.HTTP_400_BAD_REQUEST)
            if membership.branch_id is None and assigned_branches:
                membership.branch = assigned_branches[0]

        if "role" in request.data:
            membership.role = str(request.data.get("role") or "member")
        if "role_group_name" in request.data:
            membership.role_group_name = str(request.data.get("role_group_name") or "")
        if "is_org_admin" in request.data:
            membership.is_org_admin = bool(request.data.get("is_org_admin"))
        if "is_active" in request.data:
            membership.is_active = bool(request.data.get("is_active"))
        if "job_title" in request.data:
            membership.job_title = str(request.data.get("job_title") or "")

        with transaction.atomic():
            membership.save()
            if assigned_branches is not None:
                membership.branches.set(assigned_branches)
            if bool(request.data.get("is_default")):
                OrganizationMembership.objects.filter(user=membership.user).exclude(pk=membership.pk).update(is_default=False)
                membership.is_default = True
                membership.save(update_fields=["is_default", "updated_at"])
            _sync_legacy_tenant_profile(membership.user)

        return success_response("Organization membership updated.", data=OrganizationMembershipSerializer(membership).data)

    def delete(self, request, pk):
        membership = self._get_membership(pk)
        if not membership:
            return error_response("Organization membership not found.", status_code=status.HTTP_404_NOT_FOUND)
        if not _is_superadmin(request.user) and not _user_has_tenant_access(request.user, membership.tenant, require_admin=True):
            return error_response(
                "You do not have permission to remove this organization membership.",
                status_code=status.HTTP_403_FORBIDDEN,
            )

        user = membership.user
        was_default = membership.is_default
        with transaction.atomic():
            membership.delete()
            if was_default:
                replacement = OrganizationMembership.objects.filter(user=user, is_active=True).order_by("tenant__name", "id").first()
                if replacement:
                    replacement.is_default = True
                    replacement.save(update_fields=["is_default", "updated_at"])
            _sync_legacy_tenant_profile(user)
        return success_response("Organization membership removed.", data={})


# ── Module toggle (super admin) ───────────────────────────────────────────────

class ModuleDefinitionListCreateAPIView(ModuleAPIViewMixin, generics.ListCreateAPIView):
    permission_classes = [IsSuperAdminPermission]
    queryset = ModuleDefinition.objects.all()
    serializer_class = ModuleDefinitionSerializer
    filterset_fields = ("category", "is_core", "is_active")
    search_fields = ("slug", "name", "description")
    ordering_fields = ("category", "name", "created_at", "updated_at")

    def get_queryset(self):
        qs = super().get_queryset().prefetch_related("industries")
        industry_id = self.request.query_params.get("industry_id")
        if industry_id:
            qs = qs.filter(Q(industries__id=industry_id) | Q(industries__isnull=True)).distinct()
        return qs


ModuleDefinitionListAPIView = ModuleDefinitionListCreateAPIView


class ModuleDefinitionDetailAPIView(generics.RetrieveUpdateDestroyAPIView):
    permission_classes = [IsSuperAdminPermission]
    queryset = ModuleDefinition.objects.prefetch_related("industries").all()
    serializer_class = ModuleDefinitionSerializer


class IndustryListCreateAPIView(ModuleAPIViewMixin, generics.ListCreateAPIView):
    permission_classes = [AllowAny]
    queryset = Industry.objects.all()
    serializer_class = IndustrySerializer
    filterset_fields = ("is_active",)
    search_fields = ("slug", "name", "description")
    ordering_fields = ("name", "created_at", "updated_at")

    def get_queryset(self):
        qs = super().get_queryset()
        if self.request.method == "GET":
            return qs.filter(is_active=True)
        return qs

    def get_permissions(self):
        if self.request.method == "GET":
            return [AllowAny()]
        return [IsSuperAdminPermission()]


class IndustryDetailAPIView(generics.RetrieveUpdateDestroyAPIView):
    permission_classes = [IsSuperAdminPermission]
    queryset = Industry.objects.all()
    serializer_class = IndustrySerializer


class PricingRuleTypeListCreateAPIView(ModuleAPIViewMixin, generics.ListCreateAPIView):
    permission_classes = [IsAuthenticated]
    serializer_class = PricingRuleTypeSerializer

    def get_queryset(self):
        qs = PricingRuleType.objects.select_related("module").all()
        if module_slug := self.request.query_params.get("module_slug"):
            qs = qs.filter(Q(module__slug=module_slug) | Q(module__isnull=True))
        return qs

    def get_permissions(self):
        if self.request.method != "GET":
            return [IsSuperAdminPermission()]
        return [permission() for permission in self.permission_classes]


class PricingRuleTypeDetailAPIView(generics.RetrieveUpdateDestroyAPIView):
    permission_classes = [IsSuperAdminPermission]
    queryset = PricingRuleType.objects.select_related("module").all()
    serializer_class = PricingRuleTypeSerializer


class PricingRuleListCreateAPIView(ModuleAPIViewMixin, generics.ListCreateAPIView):
    permission_classes = [IsAuthenticated]
    serializer_class = PricingRuleSerializer

    def get_queryset(self):
        qs = PricingRule.objects.select_related("tenant", "module", "rule_type", "rule_type__module")
        tenant = _request_tenant_or_none(self.request.user)
        if tenant is not None:
            qs = qs.filter(tenant=tenant)
        elif tenant_id := self.request.query_params.get("tenant_id"):
            qs = qs.filter(tenant_id=tenant_id)
        if module_slug := self.request.query_params.get("module_slug"):
            if module_slug == "weighbridge":
                qs = qs.filter(Q(module__slug="weighbridge") | Q(module__slug="commercial-weighbridge"))
            else:
                qs = qs.filter(module__slug=module_slug)
        return qs

    def perform_create(self, serializer):
        tenant = _request_tenant_or_none(self.request.user)
        if tenant is not None:
            serializer.save(tenant=tenant)
            return
        tenant_id = self.request.data.get("tenant_id")
        tenant_obj = get_object_or_404(Tenant, pk=tenant_id)
        serializer.save(tenant=tenant_obj)


class PricingRuleDetailAPIView(generics.RetrieveUpdateDestroyAPIView):
    permission_classes = [IsAuthenticated]
    serializer_class = PricingRuleSerializer

    def get_queryset(self):
        qs = PricingRule.objects.select_related("tenant", "module", "rule_type", "rule_type__module")
        tenant = _request_tenant_or_none(self.request.user)
        if tenant is not None:
            return qs.filter(tenant=tenant)
        return qs


class PlanModuleListCreateAPIView(ModuleAPIViewMixin, generics.ListCreateAPIView):
    """List/add modules included in a specific subscription plan."""
    permission_classes = [IsSuperAdminPermission]
    serializer_class = PlanModuleSerializer

    def get_queryset(self):
        return PlanModule.objects.filter(
            plan_id=self.kwargs["plan_pk"]
        ).select_related("module")

    def perform_create(self, serializer):
        from django.shortcuts import get_object_or_404
        plan = get_object_or_404(SubscriptionPlan, pk=self.kwargs["plan_pk"])
        serializer.save(plan=plan)
        sync_plan_subscriptions(plan)

    def perform_update(self, serializer):
        plan = get_object_or_404(SubscriptionPlan, pk=self.kwargs["plan_pk"])
        serializer.save()
        sync_plan_subscriptions(plan)

    def perform_destroy(self, instance):
        plan = instance.plan
        instance.delete()
        sync_plan_subscriptions(plan)


class PlanModuleDetailAPIView(generics.RetrieveUpdateDestroyAPIView):
    """Retrieve/update/remove a single PlanModule assignment."""
    permission_classes = [IsSuperAdminPermission]
    serializer_class = PlanModuleSerializer

    def get_queryset(self):
        return PlanModule.objects.filter(
            plan_id=self.kwargs["plan_pk"]
        ).select_related("module")

    def perform_update(self, serializer):
        plan = get_object_or_404(SubscriptionPlan, pk=self.kwargs["plan_pk"])
        serializer.save()
        sync_plan_subscriptions(plan)

    def perform_destroy(self, instance):
        plan = instance.plan
        instance.delete()
        sync_plan_subscriptions(plan)


class SubscriptionPlanListCreateAPIView(ModuleAPIViewMixin, generics.ListCreateAPIView):
    permission_classes = [IsAuthenticated]
    queryset = SubscriptionPlan.objects.prefetch_related("modules__module").all()
    serializer_class = SubscriptionPlanSerializer
    filterset_fields = ("billing_period", "currency", "is_active")
    search_fields = ("code", "name")
    ordering_fields = ("name", "price", "trial_days", "created_at", "updated_at")

    def get_queryset(self):
        qs = super().get_queryset()
        if _is_superadmin(self.request.user):
            return qs
        return qs.filter(is_active=True)

    def get_permissions(self):
        if self.request.method == "GET":
            return [IsAuthenticated()]
        return [IsSuperAdminPermission()]


class SubscriptionPlanDetailAPIView(generics.RetrieveUpdateDestroyAPIView):
    permission_classes = [IsAuthenticated]
    queryset = SubscriptionPlan.objects.prefetch_related("modules__module").all()
    serializer_class = SubscriptionPlanSerializer

    def get_queryset(self):
        qs = super().get_queryset()
        if _is_superadmin(self.request.user):
            return qs
        return qs.filter(is_active=True)

    def get_permissions(self):
        if self.request.method == "GET":
            return [IsAuthenticated()]
        return [IsSuperAdminPermission()]


class TenantSubscriptionListCreateAPIView(ModuleAPIViewMixin, TenantScopedQuerysetMixin, generics.ListCreateAPIView):
    permission_classes = [IsAuthenticated]
    queryset = TenantSubscription.objects.select_related("tenant", "plan").all()
    serializer_class = TenantSubscriptionSerializer
    filterset_fields = ("tenant", "plan", "status", "auto_renew", "start_date", "end_date")
    search_fields = ("tenant__name", "tenant__code", "plan__name", "plan__code")
    ordering_fields = ("start_date", "end_date", "amount", "created_at", "updated_at")

    def list(self, request, *args, **kwargs):
        if not _is_superadmin(request.user) and not _tenant_admin_profile(request.user):
            return error_response(
                "You must be an organization administrator to manage subscriptions.",
                status_code=status.HTTP_403_FORBIDDEN,
            )
        return super().list(request, *args, **kwargs)

    def get_queryset(self):
        qs = super().get_queryset()
        if _is_superadmin(self.request.user):
            return qs
        tenant = _request_tenant_or_none(self.request.user)
        if tenant is None:
            return qs.none()
        return qs.filter(tenant=tenant)

    def create(self, request, *args, **kwargs):
        if _is_superadmin(request.user):
            return super().create(request, *args, **kwargs)
        profile = _tenant_admin_profile(request.user)
        if not profile:
            return error_response(
                "You must be an organization administrator to manage subscriptions.",
                status_code=status.HTTP_403_FORBIDDEN,
            )

        payload = request.data.copy()
        payload["tenant_id"] = profile.tenant_id
        serializer = self.get_serializer(data=payload)
        serializer.is_valid(raise_exception=True)
        self.perform_create(serializer)
        subscription = TenantSubscription.objects.select_related("tenant", "plan").get(pk=serializer.instance.pk)
        billing_request, auto_created, billing_message = _auto_create_subscription_billing_request(
            subscription=subscription,
            requested_by=request.user,
        )
        return success_response(
            "Subscription created.",
            data={
                "subscription": self.get_serializer(subscription).data,
                "billing_request": (
                    SubscriptionBillingRequestSerializer(billing_request, context={"request": request}).data
                    if billing_request else None
                ),
                "billing_request_auto_created": auto_created,
                "billing_request_message": billing_message,
            },
            status=201,
        )


class TenantSubscriptionDetailAPIView(TenantScopedQuerysetMixin, generics.RetrieveUpdateDestroyAPIView):
    permission_classes = [IsAuthenticated]
    queryset = TenantSubscription.objects.select_related("tenant", "plan").all()
    serializer_class = TenantSubscriptionSerializer

    def get_queryset(self):
        qs = super().get_queryset()
        if _is_superadmin(self.request.user):
            return qs
        tenant = _request_tenant_or_none(self.request.user)
        if tenant is None:
            return qs.none()
        return qs.filter(tenant=tenant)

    def update(self, request, *args, **kwargs):
        if _is_superadmin(request.user):
            return super().update(request, *args, **kwargs)
        profile = _tenant_admin_profile(request.user)
        if not profile:
            return error_response(
                "You must be an organization administrator to manage subscriptions.",
                status_code=status.HTTP_403_FORBIDDEN,
            )

        partial = kwargs.pop("partial", False)
        instance = self.get_object()
        serializer = self.get_serializer(instance, data=request.data, partial=partial)
        serializer.is_valid(raise_exception=True)
        self.perform_update(serializer)
        subscription = TenantSubscription.objects.select_related("tenant", "plan").get(pk=serializer.instance.pk)
        billing_request, auto_created, billing_message = _auto_create_subscription_billing_request(
            subscription=subscription,
            requested_by=request.user,
        )
        return success_response(
            "Subscription updated.",
            data={
                "subscription": self.get_serializer(subscription).data,
                "billing_request": (
                    SubscriptionBillingRequestSerializer(billing_request, context={"request": request}).data
                    if billing_request else None
                ),
                "billing_request_auto_created": auto_created,
                "billing_request_message": billing_message,
            },
        )

    def partial_update(self, request, *args, **kwargs):
        kwargs["partial"] = True
        return self.update(request, *args, **kwargs)


class SubscriptionBillingRequestListCreateAPIView(ModuleAPIViewMixin, generics.ListCreateAPIView):
    permission_classes = [IsAuthenticated]
    serializer_class = SubscriptionBillingRequestSerializer

    def get_queryset(self):
        qs = SubscriptionBillingRequest.objects.select_related("tenant", "subscription", "subscription__plan", "gateway")
        if _is_superadmin(self.request.user):
            if tenant_id := self.request.query_params.get("tenant_id"):
                qs = qs.filter(tenant_id=tenant_id)
            return qs
        tenant = _request_tenant_or_none(self.request.user)
        if tenant is None:
            return qs.none()
        return qs.filter(tenant=tenant)

    def create(self, request, *args, **kwargs):
        payload = request.data.copy()
        request_tenant = _request_tenant_or_none(request.user)

        if _is_superadmin(request.user):
            tenant_id = payload.get("tenant_id")
            if not tenant_id:
                return error_response(
                    "tenant_id is required for platform billing requests.",
                    status_code=status.HTTP_400_BAD_REQUEST,
                )
            tenant = get_object_or_404(Tenant, pk=tenant_id)
        else:
            profile = _tenant_admin_profile(request.user)
            if not profile:
                return error_response(
                    "You must be an organization administrator to request subscription billing.",
                    status_code=status.HTTP_403_FORBIDDEN,
                )
            tenant = request_tenant
            payload["tenant_id"] = tenant.id

        subscription_id = payload.get("subscription_id")
        subscription = None
        if subscription_id:
            subscription = get_object_or_404(
                TenantSubscription.objects.select_related("tenant", "plan"),
                pk=subscription_id,
                tenant=tenant,
            )
        else:
            subscription = tenant.subscriptions.select_related("plan").order_by("-created_at").first()

        if subscription is None:
            return error_response(
                "No subscription was found for this tenant.",
                status_code=status.HTTP_400_BAD_REQUEST,
            )

        existing = SubscriptionBillingRequest.objects.select_related(
            "tenant", "subscription", "subscription__plan", "gateway"
        ).filter(
            tenant=tenant,
            subscription=subscription,
            status__in={"draft", "initiated", "pending"},
        ).order_by("-created_at").first()
        if existing is not None:
            return success_response(
                "An open billing request already exists.",
                data=self.get_serializer(existing).data,
            )

        owner_tenant = _public_site_tenant()
        gateway = _resolve_saas_billing_gateway(tenant=owner_tenant)
        if gateway is None:
            return error_response(
                "No active SaaS billing gateway is configured yet.",
                status_code=status.HTTP_400_BAD_REQUEST,
            )

        amount = payload.get("amount") or subscription.amount or subscription.plan.price
        phone_number = str(payload.get("phone_number") or "").strip()
        if gateway.provider == "mpesa" and not phone_number:
            return error_response(
                "Phone number is required for M-Pesa billing requests.",
                status_code=status.HTTP_400_BAD_REQUEST,
            )

        serializer = self.get_serializer(data={
            **payload,
            "tenant_id": tenant.id,
            "subscription_id": subscription.id,
            "gateway_id": gateway.id,
            "amount": amount,
            "currency": payload.get("currency") or subscription.currency or subscription.plan.currency,
            "phone_number": phone_number,
            "status": "pending" if gateway.provider == "mpesa" else "initiated",
            "notes": payload.get("notes") or "",
        })
        serializer.is_valid(raise_exception=True)
        billing_request = serializer.save(
            requested_by=request.user,
            payment_provider=gateway.provider or "",
            external_reference=f"{tenant.code}:{subscription.id}",
            request_payload={
                "gateway_scope": gateway.connection_settings.get("payment_scope"),
                "gateway_provider": gateway.provider,
                "subscription_status": subscription.status,
                "subscription_plan": subscription.plan.code,
                "simulated_gateway_stage": "awaiting_customer_confirmation" if gateway.provider == "mpesa" else "awaiting_provider_execution",
            },
            response_payload={
                "message": (
                    "Billing request recorded."
                    if gateway.provider != "mpesa"
                    else "M-Pesa sandbox request initiated. Complete the simulated approval flow from the customer handset step."
                ),
                "provider": gateway.provider,
                "environment": gateway.connection_settings.get("environment") or "production",
            },
        )
        return success_response(
            "Subscription billing request created.",
            data=self.get_serializer(billing_request).data,
            status=status.HTTP_201_CREATED,
        )


class SubscriptionBillingSummaryAPIView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request):
        request_tenant = _request_tenant_or_none(request.user)
        tenant_id = request.query_params.get("tenant_id")

        queryset = SubscriptionBillingRequest.objects.select_related(
            "tenant", "subscription", "subscription__plan", "gateway"
        ).order_by("-created_at")

        if _is_superadmin(request.user):
            if tenant_id:
                queryset = queryset.filter(tenant_id=tenant_id)
        else:
            profile = _tenant_admin_profile(request.user)
            if not profile or request_tenant is None:
                return error_response(
                    "You must be an organization administrator to view subscription billing.",
                    status_code=status.HTTP_403_FORBIDDEN,
                )
            queryset = queryset.filter(tenant=request_tenant)

        requests = list(queryset[:200])
        total_requested = sum(float(item.amount or 0) for item in requests)
        total_received = sum(float(item.amount or 0) for item in requests if item.status == "succeeded")
        pending_count = sum(1 for item in requests if item.status in {"initiated", "pending"})
        failed_count = sum(1 for item in requests if item.status == "failed")
        cancelled_count = sum(1 for item in requests if item.status == "cancelled")

        by_status = []
        for status_key in ("draft", "initiated", "pending", "succeeded", "failed", "cancelled"):
            matching = [item for item in requests if item.status == status_key]
            by_status.append({
                "status": status_key,
                "count": len(matching),
                "total": sum(float(item.amount or 0) for item in matching),
            })

        gateway_rows = {}
        for item in requests:
            provider = item.payment_provider or getattr(item.gateway, "provider", "") or "custom"
            row = gateway_rows.setdefault(provider, {
                "provider": provider,
                "count": 0,
                "total": 0.0,
                "succeeded_total": 0.0,
            })
            row["count"] += 1
            row["total"] += float(item.amount or 0)
            if item.status == "succeeded":
                row["succeeded_total"] += float(item.amount or 0)

        latest_request = requests[0] if requests else None

        return success_response(
            "Subscription billing summary loaded.",
            data={
                "total_requested": total_requested,
                "total_received": total_received,
                "outstanding": max(total_requested - total_received, 0.0),
                "pending_count": pending_count,
                "failed_count": failed_count,
                "cancelled_count": cancelled_count,
                "by_status": by_status,
                "gateways": list(gateway_rows.values()),
                "latest_request": (
                    SubscriptionBillingRequestSerializer(latest_request, context={"request": request}).data
                    if latest_request else None
                ),
            },
        )


class SubscriptionBillingRequestDetailAPIView(generics.RetrieveUpdateDestroyAPIView):
    permission_classes = [IsAuthenticated]
    serializer_class = SubscriptionBillingRequestSerializer

    def get_queryset(self):
        qs = SubscriptionBillingRequest.objects.select_related("tenant", "subscription", "subscription__plan", "gateway")
        if _is_superadmin(self.request.user):
            return qs
        tenant = _request_tenant_or_none(self.request.user)
        if tenant is None:
            return qs.none()
        return qs.filter(tenant=tenant)


class SubscriptionBillingRequestSimulateCompleteAPIView(APIView):
    permission_classes = [IsAuthenticated]

    def post(self, request, pk):
        queryset = SubscriptionBillingRequest.objects.select_related(
            "tenant", "subscription", "subscription__plan", "gateway"
        )
        billing_request = get_object_or_404(queryset, pk=pk)

        if _is_superadmin(request.user):
            pass
        else:
            tenant = _request_tenant_or_none(request.user)
            profile = _tenant_admin_profile(request.user)
            if not profile or tenant is None or billing_request.tenant_id != tenant.id:
                return error_response(
                    "You do not have permission to confirm this billing request.",
                    status_code=status.HTTP_403_FORBIDDEN,
                )

        gateway = getattr(billing_request, "gateway", None)
        gateway_settings = getattr(gateway, "connection_settings", {}) or {}
        if not gateway_settings.get("sandbox") and gateway_settings.get("environment") != "sandbox":
            return error_response(
                "Only sandbox billing requests can be simulated from this action.",
                status_code=status.HTTP_400_BAD_REQUEST,
            )

        if billing_request.status == "succeeded":
            return success_response(
                "Billing request already completed.",
                data=SubscriptionBillingRequestSerializer(billing_request, context={"request": request}).data,
            )

        if billing_request.status in {"failed", "cancelled"}:
            return error_response(
                "Only pending or initiated billing requests can be completed.",
                status_code=status.HTTP_400_BAD_REQUEST,
            )

        response_payload = dict(billing_request.response_payload or {})
        response_payload.update({
            "message": "Sandbox payment confirmed successfully.",
            "provider": billing_request.payment_provider,
            "environment": gateway_settings.get("environment") or "sandbox",
            "simulated_result": "success",
            "confirmed_at": timezone.now().isoformat(),
        })
        request_payload = dict(billing_request.request_payload or {})
        request_payload["simulated_gateway_stage"] = "payment_confirmed"

        billing_request.status = "succeeded"
        billing_request.processed_at = timezone.now()
        billing_request.response_payload = response_payload
        billing_request.request_payload = request_payload
        billing_request.save(update_fields=["status", "processed_at", "response_payload", "request_payload", "updated_at"])

        return success_response(
            "Sandbox billing request confirmed.",
            data=SubscriptionBillingRequestSerializer(billing_request, context={"request": request}).data,
        )


def _simulate_subscription_billing_request(request, *, pk, target_status, success_message, denied_message):
    queryset = SubscriptionBillingRequest.objects.select_related(
        "tenant", "subscription", "subscription__plan", "gateway"
    )
    billing_request = get_object_or_404(queryset, pk=pk)

    if _is_superadmin(request.user):
        pass
    else:
        tenant = _request_tenant_or_none(request.user)
        profile = _tenant_admin_profile(request.user)
        if not profile or tenant is None or billing_request.tenant_id != tenant.id:
            return error_response(
                denied_message,
                status_code=status.HTTP_403_FORBIDDEN,
            )

    gateway = getattr(billing_request, "gateway", None)
    gateway_settings = getattr(gateway, "connection_settings", {}) or {}
    if not gateway_settings.get("sandbox") and gateway_settings.get("environment") != "sandbox":
        return error_response(
            "Only sandbox billing requests can be simulated from this action.",
            status_code=status.HTTP_400_BAD_REQUEST,
        )

    if billing_request.status == target_status:
        return success_response(
            f"Billing request already marked {target_status}.",
            data=SubscriptionBillingRequestSerializer(billing_request, context={"request": request}).data,
        )

    if billing_request.status not in {"initiated", "pending"}:
        return error_response(
            "Only pending or initiated billing requests can be updated from the sandbox flow.",
            status_code=status.HTTP_400_BAD_REQUEST,
        )

    response_payload = dict(billing_request.response_payload or {})
    request_payload = dict(billing_request.request_payload or {})
    now_iso = timezone.now().isoformat()

    if target_status == "failed":
        response_payload.update({
            "message": "Sandbox payment marked as failed.",
            "provider": billing_request.payment_provider,
            "environment": gateway_settings.get("environment") or "sandbox",
            "simulated_result": "failed",
            "failed_at": now_iso,
        })
        request_payload["simulated_gateway_stage"] = "payment_failed"
    elif target_status == "cancelled":
        response_payload.update({
            "message": "Sandbox payment marked as cancelled.",
            "provider": billing_request.payment_provider,
            "environment": gateway_settings.get("environment") or "sandbox",
            "simulated_result": "cancelled",
            "cancelled_at": now_iso,
        })
        request_payload["simulated_gateway_stage"] = "payment_cancelled"
    else:
        return error_response("Unsupported simulation target.", status_code=status.HTTP_400_BAD_REQUEST)

    billing_request.status = target_status
    billing_request.processed_at = timezone.now()
    billing_request.response_payload = response_payload
    billing_request.request_payload = request_payload
    billing_request.save(update_fields=["status", "processed_at", "response_payload", "request_payload", "updated_at"])

    return success_response(
        success_message,
        data=SubscriptionBillingRequestSerializer(billing_request, context={"request": request}).data,
    )


class SubscriptionBillingRequestSimulateFailAPIView(APIView):
    permission_classes = [IsAuthenticated]

    def post(self, request, pk):
        return _simulate_subscription_billing_request(
            request,
            pk=pk,
            target_status="failed",
            success_message="Sandbox billing request marked failed.",
            denied_message="You do not have permission to fail this billing request.",
        )


class SubscriptionBillingRequestSimulateCancelAPIView(APIView):
    permission_classes = [IsAuthenticated]

    def post(self, request, pk):
        return _simulate_subscription_billing_request(
            request,
            pk=pk,
            target_status="cancelled",
            success_message="Sandbox billing request cancelled.",
            denied_message="You do not have permission to cancel this billing request.",
        )


class LicenseKeyListCreateAPIView(ModuleAPIViewMixin, TenantScopedQuerysetMixin, generics.ListCreateAPIView):
    permission_classes = [IsSuperAdminPermission]
    queryset = LicenseKey.objects.select_related("tenant", "subscription").all()
    serializer_class = LicenseKeySerializer
    filterset_fields = ("tenant", "subscription", "status")
    search_fields = ("license_key", "tenant__name", "tenant__code", "notes")
    ordering_fields = ("activation_date", "expiry_date", "created_at", "updated_at")


class LicenseKeyDetailAPIView(TenantScopedQuerysetMixin, generics.RetrieveUpdateDestroyAPIView):
    permission_classes = [IsSuperAdminPermission]
    queryset = LicenseKey.objects.select_related("tenant", "subscription").all()
    serializer_class = LicenseKeySerializer


class TenantModuleActivationListCreateAPIView(ModuleAPIViewMixin, TenantScopedQuerysetMixin, generics.ListCreateAPIView):
    permission_classes = [IsSuperAdminPermission]
    queryset = TenantModuleActivation.objects.select_related("tenant", "module", "subscription").all()
    serializer_class = TenantModuleActivationSerializer
    filterset_fields = ("tenant", "module", "subscription", "status")
    search_fields = ("tenant__name", "tenant__code", "module__name", "module__slug")
    ordering_fields = ("enabled_at", "expires_at", "created_at", "updated_at")


class TenantModuleActivationDetailAPIView(TenantScopedQuerysetMixin, generics.RetrieveUpdateDestroyAPIView):
    permission_classes = [IsSuperAdminPermission]
    queryset = TenantModuleActivation.objects.select_related("tenant", "module", "subscription").all()
    serializer_class = TenantModuleActivationSerializer


class IntegrationEndpointListCreateAPIView(ModuleAPIViewMixin, TenantScopedQuerysetMixin, generics.ListCreateAPIView):
    """
    Superadmins can list/create across all tenants.
    Organization admins can list their own organization's integrations and create for their own organization only.
    """
    queryset = IntegrationEndpoint.objects.select_related("tenant").all()
    serializer_class = IntegrationEndpointSerializer
    filterset_fields = ("tenant", "integration_type", "transport", "is_active", "is_primary")
    search_fields = ("name", "provider", "base_url", "healthcheck_path")
    ordering_fields = ("name", "timeout_seconds", "created_at", "updated_at")

    def _check_caller(self, request):
        """Return (is_super, profile) or raise a 403 Response for plain users."""
        if _is_superadmin(request.user):
            return True, None
        profile = _tenant_admin_profile(request.user)
        if not profile:
            return None, error_response(
                "You must be a platform or organization administrator to manage integrations.",
                status_code=status.HTTP_403_FORBIDDEN,
            )
        return False, profile

    def get_queryset(self):
        ensure_shared_document_template_library()
        qs = super().get_queryset()
        if _is_superadmin(self.request.user):
            return qs
        profile = _tenant_admin_profile(self.request.user)
        if profile:
            return qs.filter(tenant=profile.tenant)
        return qs.none()

    def list(self, request, *args, **kwargs):
        is_super, profile_or_response = self._check_caller(request)
        if is_super is None:
            return profile_or_response  # 403
        return super().list(request, *args, **kwargs)

    def create(self, request, *args, **kwargs):
        is_super, profile_or_response = self._check_caller(request)
        if is_super is None:
            return profile_or_response  # 403
        target_tenant = None
        if not is_super:
            profile = profile_or_response
            # Organization admin: enforce organization ownership
            requested_tenant_id = request.data.get("tenant_id") or request.data.get("tenant")
            if requested_tenant_id and str(profile.tenant_id) != str(requested_tenant_id):
                return error_response(
                    "You may only create integrations for your own organization.",
                    status_code=status.HTTP_403_FORBIDDEN,
                )
            if not requested_tenant_id:
                request.data["tenant"] = profile.tenant_id  # type: ignore[index]
            target_tenant = profile.tenant
        else:
            requested_tenant_id = request.data.get("tenant_id") or request.data.get("tenant")
            if requested_tenant_id:
                target_tenant = Tenant.objects.filter(pk=requested_tenant_id).first()

        denied = _validate_payment_integration_scope(
            tenant=target_tenant,
            payload=request.data,
        )
        if denied:
            return denied
        return super().create(request, *args, **kwargs)


class IntegrationEndpointDetailAPIView(TenantScopedQuerysetMixin, generics.RetrieveUpdateDestroyAPIView):
    """
    Superadmins can manage any integration.
    Organization admins can only manage integrations belonging to their own organization.
    Plain users are denied.
    """
    queryset = IntegrationEndpoint.objects.select_related("tenant").all()
    serializer_class = IntegrationEndpointSerializer

    def _check_permission(self, request):
        if _is_superadmin(request.user):
            return None
        profile = _tenant_admin_profile(request.user)
        if not profile:
            return error_response(
                "You must be a platform or organization administrator to manage integrations.",
                status_code=status.HTTP_403_FORBIDDEN,
            )
        return None

    def get_queryset(self):
        qs = super().get_queryset()
        if _is_superadmin(self.request.user):
            return qs
        profile = _tenant_admin_profile(self.request.user)
        if profile:
            return qs.filter(tenant=profile.tenant)
        return qs.none()

    def retrieve(self, request, *args, **kwargs):
        denied = self._check_permission(request)
        return denied or super().retrieve(request, *args, **kwargs)

    def update(self, request, *args, **kwargs):
        denied = self._check_permission(request)
        if denied:
            return denied
        if not _is_superadmin(request.user) and ("tenant_id" in request.data or "tenant" in request.data):
            return error_response(
                "Organization administrators cannot reassign integrations to another organization.",
                status_code=status.HTTP_400_BAD_REQUEST,
            )
        instance = self.get_object()
        payload = {
            "integration_type": request.data.get("integration_type", instance.integration_type),
            "provider": request.data.get("provider", instance.provider),
            "connection_settings": request.data.get("connection_settings", instance.connection_settings),
        }
        denied = _validate_payment_integration_scope(
            tenant=instance.tenant,
            payload=payload,
        )
        return denied or super().update(request, *args, **kwargs)

    def partial_update(self, request, *args, **kwargs):
        denied = self._check_permission(request)
        if denied:
            return denied
        if not _is_superadmin(request.user) and ("tenant_id" in request.data or "tenant" in request.data):
            return error_response(
                "Organization administrators cannot reassign integrations to another organization.",
                status_code=status.HTTP_400_BAD_REQUEST,
            )
        instance = self.get_object()
        payload = {
            "integration_type": request.data.get("integration_type", instance.integration_type),
            "provider": request.data.get("provider", instance.provider),
            "connection_settings": request.data.get("connection_settings", instance.connection_settings),
        }
        denied = _validate_payment_integration_scope(
            tenant=instance.tenant,
            payload=payload,
        )
        return denied or super().partial_update(request, *args, **kwargs)

    def destroy(self, request, *args, **kwargs):
        denied = self._check_permission(request)
        return denied or super().destroy(request, *args, **kwargs)


class DocumentTemplateListCreateAPIView(ModuleAPIViewMixin, TenantScopedQuerysetMixin, generics.ListCreateAPIView):
    permission_classes = [IsAuthenticated]
    queryset = DocumentTemplate.objects.select_related("tenant").all()
    serializer_class = DocumentTemplateSerializer
    filterset_fields = ("tenant", "document_type", "engine", "is_default", "is_active")
    search_fields = ("name", "subject_template", "version")
    ordering_fields = ("name", "document_type", "created_at", "updated_at")

    def get_queryset(self):
        ensure_shared_document_template_library()
        qs = self.queryset
        if _is_superadmin(self.request.user):
            return qs
        profile = _tenant_admin_profile(self.request.user)
        if not profile or not profile.tenant_id:
            return qs.none()
        return qs.filter(Q(tenant=profile.tenant) | Q(tenant__isnull=True))

    def create(self, request, *args, **kwargs):
        if _is_superadmin(request.user):
            return super().create(request, *args, **kwargs)
        profile = _tenant_admin_profile(request.user)
        if not profile or not profile.tenant_id:
            return error_response(
                "You must be an organization administrator to create document templates.",
                status_code=status.HTTP_403_FORBIDDEN,
            )
        mutable = request.data.copy()
        mutable["tenant_id"] = profile.tenant_id
        serializer = self.get_serializer(data=mutable)
        serializer.is_valid(raise_exception=True)
        self.perform_create(serializer)
        headers = self.get_success_headers(serializer.data)
        from rest_framework.response import Response
        return Response(serializer.data, status=status.HTTP_201_CREATED, headers=headers)


class DocumentTemplateDetailAPIView(TenantScopedQuerysetMixin, generics.RetrieveUpdateDestroyAPIView):
    permission_classes = [IsAuthenticated]
    queryset = DocumentTemplate.objects.select_related("tenant").all()
    serializer_class = DocumentTemplateSerializer

    def get_queryset(self):
        ensure_shared_document_template_library()
        qs = self.queryset
        if _is_superadmin(self.request.user):
            return qs
        profile = _tenant_admin_profile(self.request.user)
        if not profile or not profile.tenant_id:
            return qs.none()
        return qs.filter(tenant=profile.tenant)

    def update(self, request, *args, **kwargs):
        if not _is_superadmin(request.user) and "tenant_id" in request.data:
            return error_response(
                "Organization administrators cannot reassign document templates to another organization.",
                status_code=status.HTTP_400_BAD_REQUEST,
            )
        return super().update(request, *args, **kwargs)


class DocumentTemplatePreviewAPIView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request, pk):
        if _is_superadmin(request.user):
            template = DocumentTemplate.objects.select_related("tenant").filter(pk=pk).first()
            tenant = None
            tenant_id = request.query_params.get("tenant_id")
            if tenant_id:
                tenant = Tenant.objects.filter(pk=tenant_id).first()
        else:
            profile = _tenant_admin_profile(request.user)
            if not profile or not profile.tenant_id:
                return error_response(
                    "You must be an organization administrator to preview document templates.",
                    status_code=status.HTTP_403_FORBIDDEN,
                )
            template = DocumentTemplate.objects.select_related("tenant").filter(
                pk=pk,
            ).filter(Q(tenant=profile.tenant) | Q(tenant__isnull=True)).first()
            tenant = profile.tenant

        if not template:
            return error_response("Document template not found.", status_code=status.HTTP_404_NOT_FOUND)

        rendered = render_document_template_preview(template, tenant=tenant, request=request)
        return HttpResponse(rendered.html, content_type="text/html; charset=utf-8")


class BackupPolicyAccessMixin:
    queryset = BackupPolicy.objects.select_related("tenant").all()
    serializer_class = BackupPolicySerializer
    filterset_fields = ("tenant", "frequency", "storage_backend", "is_active")
    search_fields = ("name", "target_path")
    ordering_fields = ("name", "retention_days", "created_at", "updated_at")

    def _tenant_profile(self):
        return _tenant_admin_profile(self.request.user)

    def get_queryset(self):
        qs = self.queryset.all()
        if _is_superadmin(self.request.user):
            is_global = self.request.query_params.get("is_global")
            if is_global is not None:
                qs = qs.filter(tenant__isnull=(is_global.lower() == "true"))
            return qs
        profile = self._tenant_profile()
        if not profile or not profile.tenant_id:
            return qs.none()
        return qs.filter(tenant=profile.tenant)

    def perform_create(self, serializer):
        if _is_superadmin(self.request.user):
            tenant = serializer.validated_data.get("tenant")
            serializer.save(tenant=tenant)
            return
        profile = self._tenant_profile()
        if not profile or not profile.tenant_id:
            raise ValidationError({"tenant_id": "Organization admin access is required to create backup policies."})
        serializer.save(tenant=profile.tenant)

    def _can_manage_policy(self, policy: BackupPolicy) -> bool:
        if _is_superadmin(self.request.user):
            return True
        profile = self._tenant_profile()
        return bool(profile and profile.tenant_id and policy.tenant_id == profile.tenant_id)


class BackupPolicyListCreateAPIView(BackupPolicyAccessMixin, ModuleAPIViewMixin, generics.ListCreateAPIView):
    permission_classes = [IsAuthenticated]

    def create(self, request, *args, **kwargs):
        try:
            return super().create(request, *args, **kwargs)
        except ValidationError as exc:
            return error_response("Could not save backup policy.", errors=getattr(exc, "detail", None), status_code=status.HTTP_400_BAD_REQUEST)
        except Exception as exc:
            return error_response(
                "Could not save backup policy.",
                errors={"non_field_errors": [str(exc)]},
                status_code=status.HTTP_400_BAD_REQUEST,
            )


class BackupPolicyDetailAPIView(BackupPolicyAccessMixin, generics.RetrieveUpdateDestroyAPIView):
    permission_classes = [IsAuthenticated]

    def get_object(self):
        obj = super().get_object()
        if not self._can_manage_policy(obj):
            raise PermissionDenied("You do not have permission to access this backup policy.")
        return obj

    def update(self, request, *args, **kwargs):
        try:
            return super().update(request, *args, **kwargs)
        except ValidationError as exc:
            return error_response("Could not update backup policy.", errors=getattr(exc, "detail", None), status_code=status.HTTP_400_BAD_REQUEST)
        except Exception as exc:
            return error_response(
                "Could not update backup policy.",
                errors={"non_field_errors": [str(exc)]},
                status_code=status.HTTP_400_BAD_REQUEST,
            )


class BackupPolicyRunAPIView(BackupPolicyAccessMixin, APIView):
    permission_classes = [IsAuthenticated]

    def post(self, request, pk):
        policy = self.queryset.select_related("tenant").filter(pk=pk).first()
        if policy and not self._can_manage_policy(policy):
            return error_response("You do not have permission to run this backup policy.", status_code=status.HTTP_403_FORBIDDEN)
        if not policy:
            return error_response("Backup policy not found.", status_code=status.HTTP_404_NOT_FOUND)
        if not _is_superadmin(request.user) and not policy.tenant_id:
            return error_response(
                "General backup policies can only be run by platform administrators.",
                status_code=status.HTTP_403_FORBIDDEN,
            )
        try:
            backup_file = create_backup_archive(policy)
        except Exception as exc:
            return error_response(
                "Backup could not be generated.",
                errors={"detail": [str(exc)]},
                status_code=status.HTTP_400_BAD_REQUEST,
            )

        policy.last_successful_backup = timezone.now()
        policy.last_backup_file = str(backup_file)
        policy.last_backup_size_bytes = backup_file.stat().st_size if backup_file.exists() else 0
        options = dict(policy.options or {})
        options["last_backup_file"] = policy.last_backup_file
        options["last_backup_size_bytes"] = policy.last_backup_size_bytes
        policy.options = options
        policy.save(update_fields=["last_successful_backup", "last_backup_file", "last_backup_size_bytes", "options", "updated_at"])

        return success_response(
            "Backup generated successfully.",
            data={
                "id": policy.id,
                "backup_file": policy.last_backup_file,
                "backup_size_bytes": policy.last_backup_size_bytes,
                "last_successful_backup": policy.last_successful_backup,
            },
        )


class BackupPolicyDownloadAPIView(BackupPolicyAccessMixin, APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request, pk):
        policy = self.queryset.select_related("tenant").filter(pk=pk).first()
        if policy and not self._can_manage_policy(policy):
            return error_response("You do not have permission to download this backup.", status_code=status.HTTP_403_FORBIDDEN)
        if not policy:
            return error_response("Backup policy not found.", status_code=status.HTTP_404_NOT_FOUND)
        if not _is_superadmin(request.user) and not policy.tenant_id:
            return error_response(
                "General backup downloads are only available to platform administrators.",
                status_code=status.HTTP_403_FORBIDDEN,
            )

        backup_path = Path(policy.last_backup_file) if policy.last_backup_file else None
        if not backup_path or not backup_path.exists() or not backup_path.is_file():
            try:
                backup_path = create_backup_archive(policy)
            except Exception as exc:
                return error_response(
                    "Backup could not be generated.",
                    errors={"detail": [str(exc)]},
                    status_code=status.HTTP_400_BAD_REQUEST,
                )

            policy.last_successful_backup = timezone.now()
            policy.last_backup_file = str(backup_path)
            policy.last_backup_size_bytes = backup_path.stat().st_size if backup_path.exists() else 0
            options = dict(policy.options or {})
            options["last_backup_file"] = policy.last_backup_file
            options["last_backup_size_bytes"] = policy.last_backup_size_bytes
            policy.options = options
            policy.save(update_fields=["last_successful_backup", "last_backup_file", "last_backup_size_bytes", "options", "updated_at"])

        if not backup_path.exists():
            return error_response("Backup file not found.", status_code=status.HTTP_404_NOT_FOUND)

        return FileResponse(
            open(backup_path, "rb"),
            as_attachment=True,
            filename=backup_path.name,
        )


@api_view(["GET"])
@permission_classes([IsSuperAdminPermission])
def tenant_module_access_overview(request):
    tenant_id = request.GET.get("tenant_id")
    tenant_code = request.GET.get("tenant_code")

    tenant = None
    if tenant_id:
        tenant = Tenant.objects.prefetch_related(
            "subscriptions__plan__modules__module",
            "module_activations__module",
            "module_activations__subscription",
            "licenses__subscription",
        ).filter(pk=tenant_id).first()
    elif tenant_code:
        tenant = Tenant.objects.prefetch_related(
            "subscriptions__plan__modules__module",
            "module_activations__module",
            "module_activations__subscription",
            "licenses__subscription",
        ).filter(code=tenant_code).first()

    if tenant is None:
        return error_response(
            "Provide a valid tenant_id or tenant_code to inspect module access.",
            status_code=status.HTTP_400_BAD_REQUEST,
        )

    access = get_tenant_module_access(tenant)
    return success_response(
        "Tenant module access loaded successfully.",
        data={
            "scope": request_scope(request),
            "tenant": TenantSerializer(tenant).data,
            "summary": {
                "subscriptions": access["subscriptions"].count(),
                "licenses": access["licenses"].count(),
                "modules": len(access["modules"]),
                "enabled_modules": sum(1 for row in access["modules"] if row["activation_status"] == "enabled"),
                "trial_modules": sum(1 for row in access["modules"] if row["activation_status"] == "trial"),
                "suspended_modules": sum(1 for row in access["modules"] if row["activation_status"] == "suspended"),
            },
            "modules": access["modules"],
        },
    )


@api_view(["POST"])
@permission_classes([IsSuperAdminPermission])
def subscription_sync_modules_action(request, pk):
    try:
        subscription = TenantSubscription.objects.select_related("tenant", "plan").prefetch_related(
            "plan__modules__module"
        ).get(pk=pk)
    except TenantSubscription.DoesNotExist:
        return error_response("Subscription not found.", status_code=status.HTTP_404_NOT_FOUND)

    serializer = SubscriptionModuleSyncSerializer(data=request.data or {})
    serializer.is_valid(raise_exception=True)

    sync_result = sync_subscription_modules(subscription)
    return success_response(
        "Subscription modules synchronized successfully.",
        data={
            "subscription_id": subscription.id,
            "tenant_id": subscription.tenant_id,
            "plan_id": subscription.plan_id,
            "status": sync_result["status"],
            "created": sync_result["created"],
            "updated": sync_result["updated"],
            "disabled": sync_result.get("disabled", 0),
            "modules": [
                {
                    "id": activation.id,
                    "module_id": activation.module_id,
                    "module_name": activation.module.name,
                    "module_slug": activation.module.slug,
                    "status": activation.status,
                    "expires_at": activation.expires_at,
                }
                for activation in sync_result["modules"]
            ],
        },
    )


@api_view(["POST"])
@permission_classes([IsSuperAdminPermission])
def generate_license_action(request):
    """POST /licenses/generate/ — auto-generate a new license key for an organization."""
    tenant_id = request.data.get("tenant_id")
    if not tenant_id:
        return error_response("organization_id is required.", status_code=status.HTTP_400_BAD_REQUEST)
    try:
        tenant = Tenant.objects.get(pk=tenant_id)
    except Tenant.DoesNotExist:
        return error_response("Organization not found.", status_code=status.HTTP_404_NOT_FOUND)

    subscription_id = request.data.get("subscription_id")
    subscription = None
    if subscription_id:
        try:
            subscription = TenantSubscription.objects.get(pk=subscription_id, tenant=tenant)
        except TenantSubscription.DoesNotExist:
            return error_response(
                "Subscription not found for this organization.", status_code=status.HTTP_400_BAD_REQUEST
            )

    key = f"SL-{secrets.token_hex(4).upper()}-{secrets.token_hex(4).upper()}-{secrets.token_hex(4).upper()}"
    while LicenseKey.objects.filter(license_key=key).exists():
        key = f"SL-{secrets.token_hex(4).upper()}-{secrets.token_hex(4).upper()}-{secrets.token_hex(4).upper()}"

    license_key = LicenseKey.objects.create(
        tenant=tenant,
        subscription=subscription,
        license_key=key,
        seats=int(request.data.get("seats", 1)),
        device_limit=int(request.data.get("device_limit", 1)),
        offline_grace_days=int(request.data.get("offline_grace_days", 3)),
        notes=request.data.get("notes", ""),
        status="pending",
    )
    return success_response(
        "License key generated.",
        data=LicenseKeySerializer(license_key).data,
    )


@api_view(["POST"])
@permission_classes([IsSuperAdminPermission])
def revoke_license_action(request, pk):
    """POST /licenses/<pk>/revoke/ — immediately revoke an active or pending license."""
    try:
        license_key = LicenseKey.objects.select_related("tenant", "subscription").get(pk=pk)
    except LicenseKey.DoesNotExist:
        return error_response("License not found.", status_code=status.HTTP_404_NOT_FOUND)
    license_key.status = "revoked"
    license_key.save(update_fields=["status", "updated_at"])
    return success_response("License revoked.", data=LicenseKeySerializer(license_key).data)


@api_view(["POST"])
@permission_classes([IsSuperAdminPermission])
def activate_license_action(request, pk):
    try:
        license_key = LicenseKey.objects.select_related("tenant", "subscription").get(pk=pk)
    except LicenseKey.DoesNotExist:
        return error_response("License not found.", status_code=status.HTTP_404_NOT_FOUND)

    serializer = LicenseActivationSerializer(data=request.data or {})
    serializer.is_valid(raise_exception=True)
    validated = serializer.validated_data

    subscription = validated.get("subscription") or license_key.subscription
    if subscription and subscription.tenant_id != license_key.tenant_id:
        return error_response(
            "The selected subscription belongs to a different tenant.",
            status_code=status.HTTP_400_BAD_REQUEST,
        )

    activate_license(
        license_key,
        subscription=subscription,
        expiry_date=validated.get("expiry_date"),
        seats=validated.get("seats"),
        device_limit=validated.get("device_limit"),
        notes=validated.get("notes"),
    )

    return success_response(
        "License activated successfully.",
        data=LicenseKeySerializer(license_key).data,
    )


@api_view(["POST"])
@permission_classes([IsSuperAdminPermission])
def validate_license_action(request, pk):
    try:
        license_key = LicenseKey.objects.select_related("tenant", "subscription").get(pk=pk)
    except LicenseKey.DoesNotExist:
        return error_response("License not found.", status_code=status.HTTP_404_NOT_FOUND)

    serializer = LicenseValidationSerializer(data=request.data or {})
    serializer.is_valid(raise_exception=True)
    validation = validate_license(
        license_key,
        mark_validated=serializer.validated_data["mark_validated"],
    )

    return success_response(
        "License validation completed successfully.",
        data={
            "license": LicenseKeySerializer(license_key).data,
            "validation": validation,
        },
    )


@api_view(["GET"])
@permission_classes([IsSuperAdminPermission])
def integration_health_overview(request):
    tenant_id = request.GET.get("tenant_id")
    tenant_code = request.GET.get("tenant_code")
    include_runtime = request.GET.get("include_runtime", "").lower() in {"1", "true", "yes"}

    queryset = IntegrationEndpoint.objects.select_related("tenant").all()
    if tenant_id:
        queryset = queryset.filter(tenant_id=tenant_id)
    elif tenant_code:
        queryset = queryset.filter(tenant__code=tenant_code)

    snapshots = [
        build_integration_health_snapshot(integration, include_runtime=include_runtime)
        for integration in queryset.order_by("tenant__name", "integration_type", "-is_primary", "name")
    ]

    return success_response(
        "Integration health overview loaded successfully.",
        data={
            "scope": request_scope(request),
            "include_runtime": include_runtime,
            "summary": {
                "integrations": len(snapshots),
                "active_integrations": sum(1 for row in snapshots if row["is_active"]),
                "primary_integrations": sum(1 for row in snapshots if row["is_primary"]),
                "healthy_integrations": sum(
                    1
                    for row in snapshots
                    if row["runtime"].get("checked") and row["runtime"].get("healthy")
                ),
            },
            "results": snapshots,
        },
    )


@api_view(["GET"])
@permission_classes([IsSuperAdminPermission])
def indicator_source_registry_overview(request):
    tenant_id = request.GET.get("tenant_id")
    tenant_code = request.GET.get("tenant_code")
    branch_id = request.GET.get("branch_id")

    tenant = None
    if tenant_id:
        tenant = Tenant.objects.filter(pk=tenant_id).first()
    elif tenant_code:
        tenant = Tenant.objects.filter(code=tenant_code).first()

    branch = None
    if branch_id:
        from SL_Weighbridge.models import Branch

        branch = Branch.objects.select_related("tenant", "company", "company__tenant").filter(pk=branch_id).first()

    registry = indicator_source_registry(tenant=tenant, branch=branch)
    return success_response(
        "Indicator source registry loaded successfully.",
        data={
            "scope": {
                **request_scope(request),
                "branch_id": branch_id,
            },
            "summary": {
                "sources": len(registry),
                "active_sources": sum(1 for row in registry if row["is_active"]),
                "primary_sources": sum(1 for row in registry if row["is_primary"]),
                "transports": sorted({row["transport"] for row in registry if row["transport"]}),
            },
            "results": registry,
        },
    )
