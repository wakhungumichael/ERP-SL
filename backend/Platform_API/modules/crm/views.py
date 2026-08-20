"""
CRM API views.

Plain-English endpoint names are translated at the URL layer:
  /api/crm/companies/      → Organisation CRUD
  /api/crm/people/         → Contact CRUD
  /api/crm/suppliers/      → Supplier CRUD
  /api/crm/opportunities/  → Lead CRUD + pipeline summary
  /api/crm/follow-ups/     → Activity CRUD
  /api/crm/dashboard/      → Cross-entity summary
"""

import uuid

from datetime import timedelta

from django.db.models import Q, Count, Sum
from django.utils import timezone
from rest_framework import serializers, viewsets, filters
from rest_framework.decorators import action
from rest_framework.response import Response
from rest_framework.views import APIView
from rest_framework.permissions import IsAuthenticated
from django_filters.rest_framework import DjangoFilterBackend

from Platform_API.modules.mixins import (
    apply_tenant_filter as _apply_tenant_filter,
    resolve_user_tenant as _resolve_user_tenant,
    tenant_or_403 as _tenant_or_403,
)
from SL_CRM.models import Organisation, Contact, Supplier, Lead, Activity
from SL_Sales.models import Estimate, EstimateLineItem, Product, SalesOrder, SalesOrderLineItem
from SL_Weighbridge.models import Customer


# ── Serializers ───────────────────────────────────────────────────────────────

class OrganisationSerializer(serializers.ModelSerializer):
    contact_count = serializers.SerializerMethodField()
    open_leads    = serializers.SerializerMethodField()

    class Meta:
        model  = Organisation
        fields = [
            "id", "name", "type", "industry", "website",
            "email", "phone", "address", "notes",
            "contact_count", "open_leads", "created_at", "updated_at",
        ]
        read_only_fields = ["id", "created_at", "updated_at", "contact_count", "open_leads"]

    def get_contact_count(self, obj):
        return obj.contacts.count()

    def get_open_leads(self, obj):
        return obj.leads.exclude(stage__in=["won", "lost"]).count()


class ContactSerializer(serializers.ModelSerializer):
    organisation_name = serializers.ReadOnlyField()
    full_name         = serializers.ReadOnlyField()

    class Meta:
        model  = Contact
        fields = [
            "id", "first_name", "last_name", "full_name",
            "job_title", "email", "phone",
            "organisation", "organisation_name",
            "notes", "created_at", "updated_at",
        ]
        read_only_fields = ["id", "full_name", "organisation_name", "created_at", "updated_at"]


class SupplierSerializer(serializers.ModelSerializer):
    payment_terms_display = serializers.CharField(source="get_payment_terms_display", read_only=True)

    class Meta:
        model  = Supplier
        fields = [
            "id", "name", "contact_person", "email", "phone",
            "address", "payment_terms", "payment_terms_display",
            "account_number", "notes", "created_at", "updated_at",
        ]
        read_only_fields = ["id", "payment_terms_display", "created_at", "updated_at"]


class LeadSerializer(serializers.ModelSerializer):
    organisation_name = serializers.ReadOnlyField()
    contact_name      = serializers.ReadOnlyField()
    assigned_to_name  = serializers.ReadOnlyField()
    stage_display     = serializers.CharField(source="get_stage_display", read_only=True)
    products          = serializers.PrimaryKeyRelatedField(queryset=Product.objects.none(), many=True, required=False)
    product_summary   = serializers.SerializerMethodField()

    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        request = self.context.get("request")
        if request is not None:
            self.fields["products"].queryset = _apply_tenant_filter(Product.objects.all(), request.user)

    def get_product_summary(self, obj):
        return [
            {
                "id": product.id,
                "name": product.name,
                "code": product.code,
                "product_type": product.product_type,
            }
            for product in obj.products.all().order_by("name")
        ]

    class Meta:
        model  = Lead
        fields = [
            "id", "title", "organisation", "organisation_name",
            "contact", "contact_name",
            "products", "product_summary",
            "stage", "stage_display", "value", "currency",
            "expected_close_date", "assigned_to", "assigned_to_name",
            "notes", "created_at", "updated_at",
        ]
        read_only_fields = [
            "id", "organisation_name", "contact_name",
            "assigned_to_name", "stage_display", "product_summary", "created_at", "updated_at",
        ]


class ActivitySerializer(serializers.ModelSerializer):
    type_display         = serializers.CharField(source="get_type_display", read_only=True)
    contact_name         = serializers.SerializerMethodField()
    organisation_name    = serializers.SerializerMethodField()
    lead_title           = serializers.SerializerMethodField()
    created_by_name      = serializers.SerializerMethodField()

    class Meta:
        model  = Activity
        fields = [
            "id", "type", "type_display", "summary", "date",
            "contact", "contact_name",
            "lead", "lead_title",
            "organisation", "organisation_name",
            "created_by", "created_by_name",
            "created_at", "updated_at",
        ]
        read_only_fields = [
            "id", "type_display", "contact_name", "lead_title",
            "organisation_name", "created_by_name", "created_at", "updated_at",
        ]

    def get_contact_name(self, obj):
        return str(obj.contact) if obj.contact else ""

    def get_organisation_name(self, obj):
        return obj.organisation.name if obj.organisation else ""

    def get_lead_title(self, obj):
        return obj.lead.title if obj.lead else ""

    def get_created_by_name(self, obj):
        if obj.created_by:
            return obj.created_by.get_full_name() or obj.created_by.username
        return ""


class CRMDocumentLineItemSerializer(serializers.Serializer):
    product = serializers.IntegerField(required=False, allow_null=True)
    description = serializers.CharField(required=False, allow_blank=True, max_length=300)
    quantity = serializers.DecimalField(max_digits=10, decimal_places=3)
    unit_price = serializers.DecimalField(max_digits=14, decimal_places=2)
    tax_rate = serializers.DecimalField(max_digits=5, decimal_places=2, required=False, default=0)
    discount_amount = serializers.DecimalField(max_digits=14, decimal_places=2, required=False, default=0)
    sort_order = serializers.IntegerField(required=False, default=0)


class CRMOpportunityEstimateConversionSerializer(serializers.Serializer):
    issue_date = serializers.DateField(required=False)
    expiry_date = serializers.DateField(required=False, allow_null=True)
    status = serializers.ChoiceField(
        choices=[choice[0] for choice in Estimate.STATUS_CHOICES],
        required=False,
        default="draft",
    )
    discount_total = serializers.DecimalField(max_digits=14, decimal_places=2, required=False, default=0)
    notes = serializers.CharField(required=False, allow_blank=True)
    terms = serializers.CharField(required=False, allow_blank=True)
    line_items = CRMDocumentLineItemSerializer(many=True, required=False, default=list)


class CRMOpportunitySalesOrderConversionSerializer(serializers.Serializer):
    order_date = serializers.DateField(required=False)
    expected_delivery_date = serializers.DateField(required=False, allow_null=True)
    status = serializers.ChoiceField(
        choices=[choice[0] for choice in SalesOrder.STATUS_CHOICES],
        required=False,
        default="confirmed",
    )
    discount_total = serializers.DecimalField(max_digits=14, decimal_places=2, required=False, default=0)
    notes = serializers.CharField(required=False, allow_blank=True)
    terms = serializers.CharField(required=False, allow_blank=True)
    line_items = CRMDocumentLineItemSerializer(many=True, required=False, default=list)


def _tenant_scoped_customer_match(tenant, base_qs):
    if tenant is None:
        return base_qs.filter(tenant__isnull=True)
    return base_qs.filter(tenant=tenant)


def _conflicts_with_other_tenant(*, tenant, field_name, value, exclude_pk=None):
    if not value:
        return False
    qs = Customer.objects.filter(**{field_name: value})
    if exclude_pk is not None:
        qs = qs.exclude(pk=exclude_pk)
    if tenant is None:
        return qs.exclude(tenant__isnull=True).exists()
    return qs.exclude(tenant=tenant).exists()


def _safe_customer_contact_fields(*, tenant, email, phone, exclude_pk=None):
    safe_email = email or None
    safe_phone = phone or None

    if safe_email and _conflicts_with_other_tenant(
        tenant=tenant,
        field_name="email__iexact",
        value=safe_email,
        exclude_pk=exclude_pk,
    ):
        safe_email = None

    if safe_phone and _conflicts_with_other_tenant(
        tenant=tenant,
        field_name="phone_number",
        value=safe_phone,
        exclude_pk=exclude_pk,
    ):
        safe_phone = None

    if not safe_phone:
        safe_phone = f"CRM{uuid.uuid4().hex[:12]}".upper()[:20]

    return safe_email, safe_phone


def _validate_crm_relationships(*, tenant, organisation=None, contact=None, lead=None):
    errors = {}

    if organisation is not None and organisation.tenant_id != getattr(tenant, "id", None):
        errors["organisation"] = "Organisation must belong to the same organization."

    if contact is not None and contact.tenant_id != getattr(tenant, "id", None):
        errors["contact"] = "Contact must belong to the same organization."

    if lead is not None and lead.tenant_id != getattr(tenant, "id", None):
        errors["lead"] = "Opportunity must belong to the same organization."

    if contact is not None and organisation is not None:
        if contact.organisation_id and contact.organisation_id != organisation.id:
            errors["contact"] = "Contact must belong to the selected organisation."

    if lead is not None:
        if organisation is not None and lead.organisation_id and lead.organisation_id != organisation.id:
            errors["lead"] = "Opportunity must belong to the selected organisation."
        if contact is not None and lead.contact_id and lead.contact_id != contact.id:
            errors["lead"] = "Opportunity must belong to the selected contact."

    if errors:
        raise serializers.ValidationError(errors)


def _resolve_or_create_customer_from_organisation(organisation, tenant):
    if organisation is None:
        return None

    if organisation.weighbridge_customer_id:
        customer = organisation.weighbridge_customer
        if tenant is not None and customer.tenant_id != tenant.id:
            customer = None
        elif tenant is None and customer.tenant_id is not None:
            customer = None
        if customer is None:
            organisation.weighbridge_customer = None
            organisation.save(update_fields=["weighbridge_customer", "updated_at"])
        else:
            updates = []
            if organisation.email and customer.email != organisation.email:
                safe_email, _ = _safe_customer_contact_fields(
                    tenant=tenant,
                    email=organisation.email,
                    phone=customer.phone_number,
                    exclude_pk=customer.pk,
                )
                if safe_email and customer.email != safe_email:
                    customer.email = safe_email
                    updates.append("email")
            if organisation.phone and customer.phone_number != organisation.phone:
                _, safe_phone = _safe_customer_contact_fields(
                    tenant=tenant,
                    email=customer.email,
                    phone=organisation.phone,
                    exclude_pk=customer.pk,
                )
                if safe_phone and customer.phone_number != safe_phone:
                    customer.phone_number = safe_phone
                    updates.append("phone_number")
            if organisation.address and customer.address != organisation.address:
                customer.address = organisation.address
                updates.append("address")
            if updates:
                customer.save(update_fields=updates)
            return customer

    customer = None
    if organisation.email:
        customer = _tenant_scoped_customer_match(
            tenant,
            Customer.objects.filter(email__iexact=organisation.email),
        ).order_by("id").first()
    if customer is None and organisation.phone:
        customer = _tenant_scoped_customer_match(
            tenant,
            Customer.objects.filter(phone_number=organisation.phone),
        ).order_by("id").first()
    if customer is None:
        customer = _tenant_scoped_customer_match(
            tenant,
            Customer.objects.filter(name__iexact=organisation.name),
        ).order_by("id").first()

    if customer is None:
        safe_email, safe_phone = _safe_customer_contact_fields(
            tenant=tenant,
            email=organisation.email,
            phone=organisation.phone,
        )
        customer = Customer.objects.create(
            tenant=tenant,
            name=organisation.name,
            address=organisation.address or None,
            phone_number=safe_phone,
            email=safe_email,
        )
    else:
        updates = []
        if organisation.address and customer.address != organisation.address:
            customer.address = organisation.address
            updates.append("address")
        if organisation.email and not customer.email:
            safe_email, _ = _safe_customer_contact_fields(
                tenant=tenant,
                email=organisation.email,
                phone=customer.phone_number,
                exclude_pk=customer.pk,
            )
            if safe_email:
                customer.email = safe_email
                updates.append("email")
        if organisation.phone and not customer.phone_number:
            _, safe_phone = _safe_customer_contact_fields(
                tenant=tenant,
                email=customer.email,
                phone=organisation.phone,
                exclude_pk=customer.pk,
            )
            if safe_phone:
                customer.phone_number = safe_phone
                updates.append("phone_number")
        if updates:
            customer.save(update_fields=updates)

    organisation.weighbridge_customer = customer
    organisation.save(update_fields=["weighbridge_customer", "updated_at"])
    return customer


# ── ViewSets ──────────────────────────────────────────────────────────────────

class OrganisationViewSet(viewsets.ModelViewSet):
    """Companies, prospects, and partner organisations."""
    queryset             = Organisation.objects.all()
    serializer_class     = OrganisationSerializer
    permission_classes   = [IsAuthenticated]
    filter_backends      = [DjangoFilterBackend, filters.SearchFilter, filters.OrderingFilter]
    filterset_fields     = ["type"]
    search_fields        = ["name", "email", "phone", "industry"]
    ordering_fields      = ["name", "created_at"]
    ordering             = ["name"]

    def get_queryset(self):
        qs = _apply_tenant_filter(
            Organisation.objects.prefetch_related("contacts", "leads"),
            self.request.user,
        )
        type_filter = self.request.query_params.get("type")
        if type_filter:
            qs = qs.filter(type=type_filter)
        return qs

    def perform_create(self, serializer):
        serializer.save(tenant=_tenant_or_403(self.request.user))


class ContactViewSet(viewsets.ModelViewSet):
    """People — individual contacts at organisations."""
    queryset           = Contact.objects.select_related("organisation")
    serializer_class   = ContactSerializer
    permission_classes = [IsAuthenticated]
    filter_backends    = [DjangoFilterBackend, filters.SearchFilter, filters.OrderingFilter]
    filterset_fields   = ["organisation"]
    search_fields      = ["first_name", "last_name", "email", "phone", "job_title"]
    ordering_fields    = ["first_name", "last_name", "created_at"]
    ordering           = ["first_name"]

    def get_queryset(self):
        qs = _apply_tenant_filter(
            Contact.objects.select_related("organisation"),
            self.request.user,
        )
        org_id = self.request.query_params.get("organisation")
        if org_id:
            qs = qs.filter(organisation_id=org_id)
        return qs

    def perform_create(self, serializer):
        tenant = _tenant_or_403(self.request.user)
        organisation = serializer.validated_data.get("organisation")
        _validate_crm_relationships(tenant=tenant, organisation=organisation)
        serializer.save(tenant=tenant)

    def perform_update(self, serializer):
        tenant = _tenant_or_403(self.request.user)
        organisation = serializer.validated_data.get("organisation", serializer.instance.organisation)
        _validate_crm_relationships(tenant=tenant, organisation=organisation)
        serializer.save()


class SupplierViewSet(viewsets.ModelViewSet):
    """Suppliers and vendors."""
    queryset           = Supplier.objects.all()
    serializer_class   = SupplierSerializer
    permission_classes = [IsAuthenticated]
    filter_backends    = [DjangoFilterBackend, filters.SearchFilter, filters.OrderingFilter]
    filterset_fields   = ["payment_terms"]
    search_fields      = ["name", "contact_person", "email", "phone"]
    ordering_fields    = ["name", "created_at"]
    ordering           = ["name"]

    def get_queryset(self):
        return _apply_tenant_filter(Supplier.objects.all(), self.request.user)

    def perform_create(self, serializer):
        serializer.save(tenant=_tenant_or_403(self.request.user))


class LeadViewSet(viewsets.ModelViewSet):
    """Sales opportunities tracked through the pipeline."""
    queryset           = Lead.objects.select_related("organisation", "contact", "assigned_to").prefetch_related("products")
    serializer_class   = LeadSerializer
    permission_classes = [IsAuthenticated]
    filter_backends    = [DjangoFilterBackend, filters.SearchFilter, filters.OrderingFilter]
    filterset_fields   = ["stage", "currency", "assigned_to", "organisation", "contact"]
    search_fields      = ["title", "notes"]
    ordering_fields    = ["created_at", "value", "expected_close_date"]
    ordering           = ["-created_at"]

    def get_queryset(self):
        qs = _apply_tenant_filter(
            Lead.objects.select_related("organisation", "contact", "assigned_to").prefetch_related("products"),
            self.request.user,
        )
        stage = self.request.query_params.get("stage")
        organisation_id = self.request.query_params.get("organisation")
        contact_id = self.request.query_params.get("contact")
        if stage:
            qs = qs.filter(stage=stage)
        if organisation_id:
            qs = qs.filter(organisation_id=organisation_id)
        if contact_id:
            qs = qs.filter(contact_id=contact_id)
        return qs

    def perform_create(self, serializer):
        tenant = _tenant_or_403(self.request.user)
        organisation = serializer.validated_data.get("organisation")
        contact = serializer.validated_data.get("contact")
        _validate_crm_relationships(tenant=tenant, organisation=organisation, contact=contact)
        serializer.save(
            tenant=tenant,
            assigned_to=serializer.validated_data.get("assigned_to") or self.request.user,
        )

    def perform_update(self, serializer):
        tenant = _tenant_or_403(self.request.user)
        organisation = serializer.validated_data.get("organisation", serializer.instance.organisation)
        contact = serializer.validated_data.get("contact", serializer.instance.contact)
        _validate_crm_relationships(tenant=tenant, organisation=organisation, contact=contact)
        serializer.save()

    @action(detail=False, methods=["get"], url_path="pipeline-summary")
    def pipeline_summary(self, request):
        """Count and total value of opportunities grouped by stage."""
        scoped_leads = _apply_tenant_filter(Lead.objects.all(), request.user)
        stages = Lead.STAGE_CHOICES
        data = []
        for stage_key, stage_label in stages:
            agg = scoped_leads.filter(stage=stage_key).aggregate(
                count=Count("id"),
                total_value=Sum("value"),
            )
            data.append({
                "stage":       stage_key,
                "label":       stage_label,
                "count":       agg["count"],
                "total_value": float(agg["total_value"] or 0),
            })
        return Response({"pipeline": data})

    @action(detail=True, methods=["post"], url_path="convert-to-estimate")
    def convert_to_estimate(self, request, pk=None):
        opportunity = self.get_object()
        serializer = CRMOpportunityEstimateConversionSerializer(data=request.data or {})
        serializer.is_valid(raise_exception=True)

        customer = _resolve_or_create_customer_from_organisation(opportunity.organisation, opportunity.tenant)
        if customer is None:
            return Response(
                {"error": "Opportunity must be linked to a company before creating an estimate."},
                status=400,
            )

        payload = serializer.validated_data
        estimate = Estimate.objects.create(
            tenant=opportunity.tenant,
            customer=customer,
            customer_name=customer.name,
            issue_date=payload.get("issue_date") or timezone.now().date(),
            expiry_date=payload.get("expiry_date") or opportunity.expected_close_date,
            status=payload.get("status", "draft"),
            discount_total=payload.get("discount_total", 0),
            notes=payload.get("notes") or opportunity.notes or f"Generated from CRM opportunity #{opportunity.id}",
            terms=payload.get("terms", ""),
            created_by=request.user,
        )

        line_items = payload.get("line_items") or []
        if not line_items:
            linked_products = list(opportunity.products.filter(is_active=True).order_by("name"))
            if linked_products:
                line_items = [
                    {
                        "product": product.id,
                        "description": product.name,
                        "quantity": 1,
                        "unit_price": product.unit_price,
                        "tax_rate": product.tax_rate,
                        "discount_amount": 0,
                        "sort_order": index,
                    }
                    for index, product in enumerate(linked_products)
                ]
            else:
                default_value = opportunity.value or 0
                line_items = [{
                    "description": opportunity.title,
                    "quantity": 1,
                    "unit_price": default_value,
                    "tax_rate": 0,
                    "discount_amount": 0,
                    "sort_order": 0,
                }]

        for line in line_items:
            EstimateLineItem.objects.create(
                estimate=estimate,
                product_id=line.get("product"),
                description=line.get("description") or opportunity.title,
                quantity=line["quantity"],
                unit_price=line["unit_price"],
                tax_rate=line.get("tax_rate", 0),
                discount_amount=line.get("discount_amount", 0),
                sort_order=line.get("sort_order", 0),
            )
        estimate.recalculate()

        return Response({
            "message": "Opportunity converted to estimate.",
            "estimate_id": estimate.pk,
            "estimate_number": estimate.estimate_number,
            "opportunity_id": opportunity.pk,
        }, status=201)

    @action(detail=True, methods=["post"], url_path="convert-to-sales-order")
    def convert_to_sales_order(self, request, pk=None):
        opportunity = self.get_object()
        serializer = CRMOpportunitySalesOrderConversionSerializer(data=request.data or {})
        serializer.is_valid(raise_exception=True)

        customer = _resolve_or_create_customer_from_organisation(opportunity.organisation, opportunity.tenant)
        if customer is None:
            return Response(
                {"error": "Opportunity must be linked to a company before creating a sales order."},
                status=400,
            )

        payload = serializer.validated_data
        order = SalesOrder.objects.create(
            tenant=opportunity.tenant,
            customer=customer,
            customer_name=customer.name,
            order_date=payload.get("order_date") or timezone.now().date(),
            expected_delivery_date=payload.get("expected_delivery_date") or opportunity.expected_close_date,
            status=payload.get("status", "confirmed"),
            discount_total=payload.get("discount_total", 0),
            notes=payload.get("notes") or opportunity.notes or f"Generated from CRM opportunity #{opportunity.id}",
            terms=payload.get("terms", ""),
            created_by=request.user,
        )

        line_items = payload.get("line_items") or []
        if not line_items:
            linked_products = list(opportunity.products.filter(is_active=True).order_by("name"))
            if linked_products:
                line_items = [
                    {
                        "product": product.id,
                        "description": product.name,
                        "quantity": 1,
                        "unit_price": product.unit_price,
                        "tax_rate": product.tax_rate,
                        "discount_amount": 0,
                        "sort_order": index,
                    }
                    for index, product in enumerate(linked_products)
                ]
            else:
                default_value = opportunity.value or 0
                line_items = [{
                    "description": opportunity.title,
                    "quantity": 1,
                    "unit_price": default_value,
                    "tax_rate": 0,
                    "discount_amount": 0,
                    "sort_order": 0,
                }]

        for line in line_items:
            SalesOrderLineItem.objects.create(
                sales_order=order,
                product_id=line.get("product"),
                description=line.get("description") or opportunity.title,
                quantity=line["quantity"],
                unit_price=line["unit_price"],
                tax_rate=line.get("tax_rate", 0),
                discount_amount=line.get("discount_amount", 0),
                sort_order=line.get("sort_order", 0),
            )
        order.recalculate()

        return Response({
            "message": "Opportunity converted to sales order.",
            "sales_order_id": order.pk,
            "order_number": order.order_number,
            "opportunity_id": opportunity.pk,
        }, status=201)


class ActivityViewSet(viewsets.ModelViewSet):
    """Follow-ups — calls, emails, meetings, and notes."""
    queryset           = Activity.objects.select_related("contact", "lead", "organisation", "created_by")
    serializer_class   = ActivitySerializer
    permission_classes = [IsAuthenticated]
    filter_backends    = [DjangoFilterBackend, filters.SearchFilter, filters.OrderingFilter]
    filterset_fields   = ["type", "contact", "lead", "organisation"]
    search_fields      = ["summary"]
    ordering_fields    = ["date", "created_at"]
    ordering           = ["-date"]

    def get_queryset(self):
        return _apply_tenant_filter(
            Activity.objects.select_related("contact", "lead", "organisation", "created_by"),
            self.request.user,
        )

    def perform_create(self, serializer):
        tenant = _tenant_or_403(self.request.user)
        organisation = serializer.validated_data.get("organisation")
        contact = serializer.validated_data.get("contact")
        lead = serializer.validated_data.get("lead")
        _validate_crm_relationships(
            tenant=tenant,
            organisation=organisation,
            contact=contact,
            lead=lead,
        )
        serializer.save(
            created_by=self.request.user,
            tenant=tenant,
        )

    def perform_update(self, serializer):
        tenant = _tenant_or_403(self.request.user)
        organisation = serializer.validated_data.get("organisation", serializer.instance.organisation)
        contact = serializer.validated_data.get("contact", serializer.instance.contact)
        lead = serializer.validated_data.get("lead", serializer.instance.lead)
        _validate_crm_relationships(
            tenant=tenant,
            organisation=organisation,
            contact=contact,
            lead=lead,
        )
        serializer.save()


# ── Dashboard ─────────────────────────────────────────────────────────────────

class CRMDashboardView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request):
        now = timezone.now()
        today = now.date()
        month_start = today.replace(day=1)
        week_end = today + timedelta(days=7)
        stale_cutoff = now - timedelta(days=14)
        organisations = _apply_tenant_filter(Organisation.objects.all(), request.user)
        contacts = _apply_tenant_filter(Contact.objects.all(), request.user)
        suppliers = _apply_tenant_filter(Supplier.objects.all(), request.user)
        leads = _apply_tenant_filter(Lead.objects.all(), request.user)
        activities = _apply_tenant_filter(
            Activity.objects.select_related("contact", "lead", "organisation", "created_by"),
            request.user,
        )

        # Totals
        total_companies  = organisations.count()
        total_people     = contacts.count()
        total_suppliers  = suppliers.count()
        active_opps      = leads.exclude(stage__in=["won", "lost"]).count()
        won_this_month   = leads.filter(stage="won", updated_at__date__gte=month_start).count()
        stale_opps_count = leads.exclude(stage__in=["won", "lost"]).filter(updated_at__lt=stale_cutoff).count()
        overdue_follow_ups_count = activities.filter(date__lt=now).count()
        upcoming_follow_ups_count = activities.filter(date__gte=now, date__date__lte=week_end).count()
        pipeline_value   = leads.exclude(stage__in=["won", "lost"]).aggregate(
            total=Sum("value")
        )["total"] or 0

        # Stage breakdown
        stage_data = []
        for stage_key, stage_label in Lead.STAGE_CHOICES:
            agg = leads.filter(stage=stage_key).aggregate(
                count=Count("id"), total=Sum("value")
            )
            stage_data.append({
                "stage": stage_key,
                "label": stage_label,
                "count": agg["count"],
                "value": float(agg["total"] or 0),
            })

        # Recent follow-ups
        recent_activities = ActivitySerializer(
            activities[:10],
            many=True,
        ).data

        overdue_follow_ups = ActivitySerializer(
            activities.filter(date__lt=now)[:6],
            many=True,
        ).data
        upcoming_follow_ups = ActivitySerializer(
            activities.filter(date__gte=now, date__date__lte=week_end)[:6],
            many=True,
        ).data

        stale_opportunities = LeadSerializer(
            leads.exclude(stage__in=["won", "lost"]).filter(updated_at__lt=stale_cutoff).order_by("updated_at")[:6],
            many=True,
        ).data
        closing_soon = LeadSerializer(
            leads.exclude(stage__in=["won", "lost"])
            .filter(expected_close_date__isnull=False, expected_close_date__lte=week_end)
            .order_by("expected_close_date", "-value")[:6],
            many=True,
        ).data

        # Companies by type
        companies_by_type = list(
            organisations.values("type").annotate(count=Count("id"))
        )

        return Response({
            "summary": {
                "companies":       total_companies,
                "people":          total_people,
                "suppliers":       total_suppliers,
                "open_opportunities": active_opps,
                "won_this_month":  won_this_month,
                "pipeline_value":  float(pipeline_value),
                "stale_opportunities": stale_opps_count,
                "overdue_follow_ups": overdue_follow_ups_count,
                "upcoming_follow_ups": upcoming_follow_ups_count,
            },
            "pipeline_stages":    stage_data,
            "recent_follow_ups":  recent_activities,
            "priority_queues": {
                "overdue_follow_ups": overdue_follow_ups,
                "upcoming_follow_ups": upcoming_follow_ups,
                "stale_opportunities": stale_opportunities,
                "closing_soon": closing_soon,
            },
            "companies_by_type":  companies_by_type,
            "period": {
                "month_start": str(month_start),
                "today":       str(today),
                "week_end":    str(week_end),
                "stale_cutoff": stale_cutoff.date().isoformat(),
            },
        })
