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

from django.db.models import Q, Count, Sum
from django.utils import timezone
from rest_framework import serializers, viewsets, filters
from rest_framework.decorators import action
from rest_framework.response import Response
from rest_framework.views import APIView
from rest_framework.permissions import IsAuthenticated
from django_filters.rest_framework import DjangoFilterBackend
import datetime

from SL_CRM.models import Organisation, Contact, Supplier, Lead, Activity


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

    class Meta:
        model  = Lead
        fields = [
            "id", "title", "organisation", "organisation_name",
            "contact", "contact_name",
            "stage", "stage_display", "value", "currency",
            "expected_close_date", "assigned_to", "assigned_to_name",
            "notes", "created_at", "updated_at",
        ]
        read_only_fields = [
            "id", "organisation_name", "contact_name",
            "assigned_to_name", "stage_display", "created_at", "updated_at",
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
        qs = Organisation.objects.prefetch_related("contacts", "leads")
        type_filter = self.request.query_params.get("type")
        if type_filter:
            qs = qs.filter(type=type_filter)
        return qs


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
        qs = Contact.objects.select_related("organisation")
        org_id = self.request.query_params.get("organisation")
        if org_id:
            qs = qs.filter(organisation_id=org_id)
        return qs


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


class LeadViewSet(viewsets.ModelViewSet):
    """Sales opportunities tracked through the pipeline."""
    queryset           = Lead.objects.select_related("organisation", "contact", "assigned_to")
    serializer_class   = LeadSerializer
    permission_classes = [IsAuthenticated]
    filter_backends    = [DjangoFilterBackend, filters.SearchFilter, filters.OrderingFilter]
    filterset_fields   = ["stage", "currency", "assigned_to"]
    search_fields      = ["title", "notes"]
    ordering_fields    = ["created_at", "value", "expected_close_date"]
    ordering           = ["-created_at"]

    def get_queryset(self):
        qs = Lead.objects.select_related("organisation", "contact", "assigned_to")
        stage = self.request.query_params.get("stage")
        if stage:
            qs = qs.filter(stage=stage)
        return qs

    @action(detail=False, methods=["get"], url_path="pipeline-summary")
    def pipeline_summary(self, request):
        """Count and total value of opportunities grouped by stage."""
        from django.db.models import Count, Sum
        stages = Lead.STAGE_CHOICES
        data = []
        for stage_key, stage_label in stages:
            agg = Lead.objects.filter(stage=stage_key).aggregate(
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

    def perform_create(self, serializer):
        serializer.save(created_by=self.request.user)


# ── Dashboard ─────────────────────────────────────────────────────────────────

class CRMDashboardView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request):
        today = timezone.now().date()
        month_start = today.replace(day=1)

        # Totals
        total_companies  = Organisation.objects.count()
        total_people     = Contact.objects.count()
        total_suppliers  = Supplier.objects.count()
        active_opps      = Lead.objects.exclude(stage__in=["won", "lost"]).count()
        won_this_month   = Lead.objects.filter(stage="won", updated_at__date__gte=month_start).count()
        pipeline_value   = Lead.objects.exclude(stage__in=["won", "lost"]).aggregate(
            total=Sum("value")
        )["total"] or 0

        # Stage breakdown
        stage_data = []
        for stage_key, stage_label in Lead.STAGE_CHOICES:
            agg = Lead.objects.filter(stage=stage_key).aggregate(
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
            Activity.objects.select_related("contact", "lead", "organisation", "created_by")[:10],
            many=True,
        ).data

        # Companies by type
        companies_by_type = list(
            Organisation.objects.values("type").annotate(count=Count("id"))
        )

        return Response({
            "summary": {
                "companies":       total_companies,
                "people":          total_people,
                "suppliers":       total_suppliers,
                "open_opportunities": active_opps,
                "won_this_month":  won_this_month,
                "pipeline_value":  float(pipeline_value),
            },
            "pipeline_stages":    stage_data,
            "recent_follow_ups":  recent_activities,
            "companies_by_type":  companies_by_type,
            "period": {
                "month_start": str(month_start),
                "today":       str(today),
            },
        })
