import csv
import hashlib
import hmac
import json
import urllib.error
import urllib.request
from io import StringIO

from django.contrib.auth.models import User
from django.db.models import Count, Q
from django.http import HttpResponse
from django.utils import timezone
from rest_framework.exceptions import ValidationError
from rest_framework import serializers, status
from rest_framework.permissions import AllowAny, IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from Platform_API.modules.mixins import (
    apply_tenant_filter as _apply_tenant_filter,
    resolve_user_tenant as _resolve_user_tenant,
    tenant_or_403 as _tenant_or_403,
)
from SL_Ticketing.models import (
    Ticket,
    TicketEvent,
    TicketFormSchema,
    TicketMessage,
    TicketRoutingRule,
    TicketWebhookDelivery,
    TicketingApiKey,
    TicketingInboxConfig,
    TicketingWebhookEndpoint,
)


def _scoped_user_queryset(user):
    return _apply_tenant_filter(User.objects.all(), user, filter_field="organization_memberships__tenant")


def _resolve_config(tenant):
    return TicketingInboxConfig.objects.get_or_create(tenant=tenant)[0]


def _match_rule(rule, ticket):
    conditions = rule.conditions or {}
    for field in ("category", "priority", "status", "source_page"):
        value = conditions.get(field)
        if value and getattr(ticket, field, None) != value:
            return False
    subject_contains = conditions.get("subject_contains")
    if subject_contains and subject_contains.lower() not in ticket.subject.lower():
        return False
    return True


def _apply_routing(ticket):
    rules = TicketRoutingRule.objects.filter(tenant=ticket.tenant, is_active=True).order_by("priority", "id")
    updated_fields = []
    for rule in rules:
        if not _match_rule(rule, ticket):
            continue
        if rule.assign_to_id and ticket.assigned_to_id != rule.assign_to_id:
            ticket.assigned_to = rule.assign_to
            updated_fields.append("assigned_to")
        if rule.target_status and ticket.status != rule.target_status:
            ticket.status = rule.target_status
            updated_fields.append("status")
        if updated_fields:
            ticket.save(update_fields=updated_fields + ["updated_at"])
        return rule
    return None


def _record_event(ticket, event_type, summary, payload=None, is_public=True):
    return TicketEvent.objects.create(
        ticket=ticket,
        event_type=event_type,
        summary=summary,
        payload=payload or {},
        is_public=is_public,
    )


def _ticket_payload(ticket, include_private=False):
    timeline = []
    for event in ticket.events.order_by("created_at", "id"):
        if include_private or event.is_public:
            timeline.append(
                {
                    "kind": "event",
                    "event_type": event.event_type,
                    "summary": event.summary,
                    "payload": event.payload,
                    "created_at": event.created_at,
                }
            )
    for message in ticket.messages.order_by("created_at", "id"):
        if include_private or message.is_public:
            timeline.append(
                {
                    "kind": "message",
                    "author_type": message.author_type,
                    "author_name": message.author_name,
                    "message": message.message,
                    "attachments": message.attachments,
                    "created_at": message.created_at,
                }
            )
    timeline.sort(key=lambda item: item["created_at"])
    return {
        "id": ticket.id,
        "public_id": ticket.public_id,
        "status": ticket.status,
        "priority": ticket.priority,
        "category": ticket.category,
        "subject": ticket.subject,
        "description": ticket.description,
        "requester_name": ticket.requester_name,
        "requester_email": ticket.requester_email,
        "source_page": ticket.source_page,
        "source_channel": ticket.source_channel,
        "external_reference": ticket.external_reference,
        "custom_fields": ticket.custom_fields,
        "attachments": ticket.attachments,
        "assigned_to_name": ticket.assigned_to.get_full_name() if ticket.assigned_to else "",
        "created_at": ticket.created_at,
        "updated_at": ticket.updated_at,
        "timeline": timeline,
    }


def _dispatch_webhooks(ticket, event_type):
    endpoints = TicketingWebhookEndpoint.objects.filter(
        tenant=ticket.tenant,
        is_active=True,
    )
    payload = {
        "event": event_type,
        "ticket": {
            "public_id": ticket.public_id,
            "status": ticket.status,
            "priority": ticket.priority,
            "subject": ticket.subject,
            "requester_email": ticket.requester_email,
            "category": ticket.category,
            "source_page": ticket.source_page,
            "updated_at": ticket.updated_at.isoformat(),
        },
        "tenant": {
            "id": ticket.tenant_id,
            "code": ticket.tenant.code,
            "name": ticket.tenant.name,
        },
    }
    raw_payload = json.dumps(payload).encode("utf-8")
    for endpoint in endpoints:
        subscribed = endpoint.subscribed_events or []
        if subscribed and event_type not in subscribed:
            continue
        signature = hmac.new(
            endpoint.signing_secret.encode("utf-8"),
            raw_payload,
            hashlib.sha256,
        ).hexdigest()
        delivery = TicketWebhookDelivery.objects.create(
            endpoint=endpoint,
            ticket=ticket,
            event_type=event_type,
            request_payload=payload,
        )
        request = urllib.request.Request(
            endpoint.target_url,
            data=raw_payload,
            method="POST",
            headers={
                "Content-Type": "application/json",
                "X-Ticketing-Event": event_type,
                "X-Ticketing-Signature": signature,
            },
        )
        try:
            with urllib.request.urlopen(request, timeout=3) as response:
                body = response.read(500).decode("utf-8", errors="ignore")
                delivery.status_code = response.getcode()
                delivery.response_excerpt = body
                delivery.was_successful = 200 <= response.getcode() < 300
        except (urllib.error.URLError, urllib.error.HTTPError) as exc:
            code = getattr(exc, "code", None)
            delivery.status_code = code
            delivery.response_excerpt = str(exc)[:500]
            delivery.was_successful = False
        delivery.save(update_fields=["status_code", "response_excerpt", "was_successful", "updated_at"])
        endpoint.last_delivered_at = timezone.now()
        endpoint.last_status_code = delivery.status_code
        endpoint.last_error = "" if delivery.was_successful else delivery.response_excerpt
        endpoint.save(update_fields=["last_delivered_at", "last_status_code", "last_error", "updated_at"])


def _ensure_origin_allowed(request, tenant):
    config = _resolve_config(tenant)
    origin = request.headers.get("Origin", "").strip()
    if not config.require_cors_origin or not config.allowed_domains:
        return None
    if not origin:
        raise ValidationError("Origin header is required for this tenant.")
    allowed = {entry.rstrip("/") for entry in config.allowed_domains if entry}
    if origin.rstrip("/") not in allowed:
        raise ValidationError("Origin is not allowed for this tenant.")
    return origin


def _extract_bearer_token(request):
    auth = request.headers.get("Authorization", "")
    if auth.lower().startswith("bearer "):
        return auth.split(" ", 1)[1].strip()
    return ""


def _authenticate_public_request(request, key_type):
    tenant_code = request.headers.get("X-Tenant-ID", "").strip()
    raw_token = _extract_bearer_token(request)
    if not tenant_code or not raw_token:
        raise ValidationError("X-Tenant-ID and Bearer token are required.")
    token_hash = TicketingApiKey.hash_token(raw_token)
    key = TicketingApiKey.objects.select_related("tenant").filter(
        tenant__code=tenant_code,
        token_hash=token_hash,
        key_type=key_type,
        is_active=True,
    ).first()
    if not key:
        raise ValidationError("Invalid tenant or API token.")
    _ensure_origin_allowed(request, key.tenant)
    key.mark_used()
    return key.tenant, key


def _validate_tracking_access(request, ticket):
    config = _resolve_config(ticket.tenant)
    if config.portal_access_policy == "secure_token":
        provided = request.query_params.get("token") or request.data.get("token")
        if provided != ticket.public_token:
            raise ValidationError("Valid ticket token is required.")
        return
    if config.portal_access_policy == "account_only":
        raise ValidationError("This tenant requires authenticated portal access.")
    email = request.query_params.get("email") or request.data.get("email")
    if not email or email.lower() != ticket.requester_email.lower():
        raise ValidationError("Email verification failed.")


def _validation_message(exc):
    detail = getattr(exc, "detail", None)
    if isinstance(detail, list):
        return " ".join(str(item) for item in detail)
    if isinstance(detail, dict):
        return json.dumps(detail)
    return str(detail or exc)


class TicketingInboxConfigSerializer(serializers.ModelSerializer):
    class Meta:
        model = TicketingInboxConfig
        fields = [
            "id",
            "allowed_domains",
            "portal_access_policy",
            "brand_settings",
            "widget_settings",
            "email_settings",
            "webhook_settings",
            "require_cors_origin",
            "allow_anonymous_tracking",
            "allow_requester_close",
        ]
        read_only_fields = ["id"]


class TicketingApiKeySerializer(serializers.ModelSerializer):
    class Meta:
        model = TicketingApiKey
        fields = [
            "id",
            "name",
            "key_type",
            "token_prefix",
            "is_active",
            "last_used_at",
            "revoked_at",
            "metadata",
            "created_at",
        ]
        read_only_fields = ["id", "token_prefix", "last_used_at", "revoked_at", "created_at"]


class TicketingApiKeyCreateSerializer(serializers.Serializer):
    name = serializers.CharField(max_length=120)
    key_type = serializers.ChoiceField(choices=["public", "secret"])
    metadata = serializers.JSONField(required=False)


class TicketFormSchemaSerializer(serializers.ModelSerializer):
    class Meta:
        model = TicketFormSchema
        fields = [
            "id",
            "name",
            "slug",
            "description",
            "schema",
            "is_default",
            "is_public",
            "allowed_mime_types",
            "max_file_size_mb",
            "created_at",
            "updated_at",
        ]
        read_only_fields = ["id", "slug", "created_at", "updated_at"]


class TicketRoutingRuleSerializer(serializers.ModelSerializer):
    assign_to_name = serializers.SerializerMethodField()

    class Meta:
        model = TicketRoutingRule
        fields = [
            "id",
            "name",
            "priority",
            "conditions",
            "assign_to",
            "assign_to_name",
            "target_status",
            "is_active",
            "created_at",
            "updated_at",
        ]
        read_only_fields = ["id", "assign_to_name", "created_at", "updated_at"]

    def get_assign_to_name(self, obj):
        if obj.assign_to:
            return obj.assign_to.get_full_name() or obj.assign_to.username
        return ""

    def validate_assign_to(self, value):
        request = self.context.get("request")
        tenant = self.context.get("tenant")
        if value and request and tenant and not value.organization_memberships.filter(tenant=tenant, is_active=True).exists():
            raise serializers.ValidationError("Assigned user must belong to the same tenant.")
        return value


class TicketingWebhookEndpointSerializer(serializers.ModelSerializer):
    class Meta:
        model = TicketingWebhookEndpoint
        fields = [
            "id",
            "name",
            "target_url",
            "signing_secret",
            "subscribed_events",
            "is_active",
            "last_delivered_at",
            "last_status_code",
            "last_error",
            "created_at",
        ]
        read_only_fields = ["id", "last_delivered_at", "last_status_code", "last_error", "created_at"]


class TicketMessageSerializer(serializers.ModelSerializer):
    class Meta:
        model = TicketMessage
        fields = ["id", "author_type", "author_name", "message", "attachments", "is_public", "created_at"]
        read_only_fields = ["id", "created_at"]


class TicketSerializer(serializers.ModelSerializer):
    messages = TicketMessageSerializer(many=True, read_only=True)
    assigned_to_name = serializers.SerializerMethodField()
    timeline = serializers.SerializerMethodField()

    class Meta:
        model = Ticket
        fields = [
            "id",
            "public_id",
            "form_schema",
            "requester_name",
            "requester_email",
            "requester_phone",
            "subject",
            "description",
            "category",
            "priority",
            "status",
            "source_page",
            "source_channel",
            "external_reference",
            "custom_fields",
            "attachments",
            "assigned_to",
            "assigned_to_name",
            "messages",
            "timeline",
            "created_at",
            "updated_at",
        ]
        read_only_fields = ["id", "public_id", "assigned_to_name", "messages", "timeline", "created_at", "updated_at"]

    def get_assigned_to_name(self, obj):
        if obj.assigned_to:
            return obj.assigned_to.get_full_name() or obj.assigned_to.username
        return ""

    def get_timeline(self, obj):
        return _ticket_payload(obj, include_private=True)["timeline"]


class PublicTicketCreateSerializer(serializers.ModelSerializer):
    message = serializers.CharField(required=False, allow_blank=True)

    class Meta:
        model = Ticket
        fields = [
            "form_schema",
            "requester_name",
            "requester_email",
            "requester_phone",
            "subject",
            "description",
            "category",
            "priority",
            "source_page",
            "source_channel",
            "external_reference",
            "custom_fields",
            "attachments",
            "message",
        ]


class TicketReplySerializer(serializers.Serializer):
    message = serializers.CharField()
    attachments = serializers.JSONField(required=False)
    email = serializers.EmailField(required=False)
    token = serializers.CharField(required=False, allow_blank=True)


class TicketCloseSerializer(serializers.Serializer):
    email = serializers.EmailField(required=False)
    token = serializers.CharField(required=False, allow_blank=True)


class TicketingDashboardView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request):
        tenant = _tenant_or_403(request.user)
        tickets = Ticket.objects.filter(tenant=tenant)
        return Response(
            {
                "counts": {
                    "total": tickets.count(),
                    "open": tickets.filter(status__in=["new", "open", "pending"]).count(),
                    "resolved": tickets.filter(status="resolved").count(),
                    "closed": tickets.filter(status="closed").count(),
                    "high_priority": tickets.filter(priority__in=["high", "urgent"]).count(),
                    "unassigned": tickets.filter(assigned_to__isnull=True).count(),
                },
                "status_breakdown": list(
                    tickets.values("status").annotate(count=Count("id")).order_by("status")
                ),
                "recent": [
                    {
                        "public_id": ticket.public_id,
                        "subject": ticket.subject,
                        "status": ticket.status,
                        "priority": ticket.priority,
                        "requester_email": ticket.requester_email,
                        "created_at": ticket.created_at,
                    }
                    for ticket in tickets[:8]
                ],
            }
        )


class TicketingConfigAPIView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request):
        tenant = _tenant_or_403(request.user)
        config = _resolve_config(tenant)
        return Response(TicketingInboxConfigSerializer(config).data)

    def patch(self, request):
        tenant = _tenant_or_403(request.user)
        config = _resolve_config(tenant)
        serializer = TicketingInboxConfigSerializer(config, data=request.data, partial=True)
        serializer.is_valid(raise_exception=True)
        serializer.save()
        return Response(serializer.data)


class TicketingApiKeyListCreateView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request):
        tenant = _tenant_or_403(request.user)
        keys = TicketingApiKey.objects.filter(tenant=tenant).order_by("name")
        return Response(TicketingApiKeySerializer(keys, many=True).data)

    def post(self, request):
        tenant = _tenant_or_403(request.user)
        serializer = TicketingApiKeyCreateSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        key, raw_token = TicketingApiKey.issue_token(tenant=tenant, **serializer.validated_data)
        return Response(
            {
                "key": TicketingApiKeySerializer(key).data,
                "raw_token": raw_token,
            },
            status=status.HTTP_201_CREATED,
        )


class TicketingApiKeyDetailView(APIView):
    permission_classes = [IsAuthenticated]

    def patch(self, request, pk):
        tenant = _tenant_or_403(request.user)
        key = TicketingApiKey.objects.filter(tenant=tenant, pk=pk).first()
        if not key:
            return Response({"error": "Not found."}, status=status.HTTP_404_NOT_FOUND)
        if request.data.get("revoke"):
            key.revoke()
        else:
            serializer = TicketingApiKeySerializer(key, data=request.data, partial=True)
            serializer.is_valid(raise_exception=True)
            serializer.save()
        return Response(TicketingApiKeySerializer(key).data)


class _TenantScopedCrudAPIView(APIView):
    permission_classes = [IsAuthenticated]
    model = None
    serializer_class = None

    def get_queryset(self, tenant):
        return self.model.objects.filter(tenant=tenant)

    def get(self, request):
        tenant = _tenant_or_403(request.user)
        return Response(self.serializer_class(self.get_queryset(tenant), many=True).data)

    def post(self, request):
        tenant = _tenant_or_403(request.user)
        serializer = self.serializer_class(data=request.data, context={"request": request, "tenant": tenant})
        serializer.is_valid(raise_exception=True)
        instance = serializer.save(tenant=tenant)
        return Response(self.serializer_class(instance, context={"request": request, "tenant": tenant}).data, status=status.HTTP_201_CREATED)


class _TenantScopedDetailAPIView(APIView):
    permission_classes = [IsAuthenticated]
    model = None
    serializer_class = None

    def patch(self, request, pk):
        tenant = _tenant_or_403(request.user)
        instance = self.model.objects.filter(tenant=tenant, pk=pk).first()
        if not instance:
            return Response({"error": "Not found."}, status=status.HTTP_404_NOT_FOUND)
        serializer = self.serializer_class(instance, data=request.data, partial=True, context={"request": request, "tenant": tenant})
        serializer.is_valid(raise_exception=True)
        serializer.save()
        return Response(self.serializer_class(instance, context={"request": request, "tenant": tenant}).data)

    def delete(self, request, pk):
        tenant = _tenant_or_403(request.user)
        deleted, _ = self.model.objects.filter(tenant=tenant, pk=pk).delete()
        if not deleted:
            return Response({"error": "Not found."}, status=status.HTTP_404_NOT_FOUND)
        return Response(status=status.HTTP_204_NO_CONTENT)


class TicketFormSchemaListCreateView(_TenantScopedCrudAPIView):
    model = TicketFormSchema
    serializer_class = TicketFormSchemaSerializer


class TicketFormSchemaDetailView(_TenantScopedDetailAPIView):
    model = TicketFormSchema
    serializer_class = TicketFormSchemaSerializer


class TicketRoutingRuleListCreateView(_TenantScopedCrudAPIView):
    model = TicketRoutingRule
    serializer_class = TicketRoutingRuleSerializer


class TicketRoutingRuleDetailView(_TenantScopedDetailAPIView):
    model = TicketRoutingRule
    serializer_class = TicketRoutingRuleSerializer


class TicketWebhookEndpointListCreateView(_TenantScopedCrudAPIView):
    model = TicketingWebhookEndpoint
    serializer_class = TicketingWebhookEndpointSerializer


class TicketWebhookEndpointDetailView(_TenantScopedDetailAPIView):
    model = TicketingWebhookEndpoint
    serializer_class = TicketingWebhookEndpointSerializer


class AgentTicketListCreateView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request):
        tenant = _tenant_or_403(request.user)
        qs = Ticket.objects.filter(tenant=tenant).select_related("assigned_to", "form_schema")
        if status_filter := request.query_params.get("status"):
            qs = qs.filter(status=status_filter)
        if priority_filter := request.query_params.get("priority"):
            qs = qs.filter(priority=priority_filter)
        if assignee_filter := request.query_params.get("assignee"):
            if assignee_filter == "unassigned":
                qs = qs.filter(assigned_to__isnull=True)
            else:
                qs = qs.filter(assigned_to_id=assignee_filter)
        if search := request.query_params.get("search"):
            qs = qs.filter(
                Q(public_id__icontains=search)
                | Q(subject__icontains=search)
                | Q(requester_email__icontains=search)
                | Q(requester_name__icontains=search)
            )
        return Response(TicketSerializer(qs[:200], many=True).data)

    def post(self, request):
        tenant = _tenant_or_403(request.user)
        serializer = PublicTicketCreateSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        ticket = Ticket.objects.create(tenant=tenant, **serializer.validated_data)
        if ticket.description:
            TicketMessage.objects.create(
                ticket=ticket,
                author_type="requester",
                author_name=ticket.requester_name or ticket.requester_email,
                message=ticket.description,
                attachments=ticket.attachments,
                is_public=True,
            )
        _record_event(ticket, "ticket.created", "Ticket created by internal agent.", {"source": "erp"})
        _apply_routing(ticket)
        return Response(TicketSerializer(ticket).data, status=status.HTTP_201_CREATED)


class AgentTicketDetailView(APIView):
    permission_classes = [IsAuthenticated]

    def _get_ticket(self, user, pk):
        tenant = _tenant_or_403(user)
        return Ticket.objects.filter(tenant=tenant, pk=pk).select_related("assigned_to", "tenant").first()

    def get(self, request, pk):
        ticket = self._get_ticket(request.user, pk)
        if not ticket:
            return Response({"error": "Not found."}, status=status.HTTP_404_NOT_FOUND)
        return Response(TicketSerializer(ticket).data)

    def patch(self, request, pk):
        ticket = self._get_ticket(request.user, pk)
        if not ticket:
            return Response({"error": "Not found."}, status=status.HTTP_404_NOT_FOUND)
        previous_status = ticket.status
        serializer = TicketSerializer(ticket, data=request.data, partial=True)
        serializer.is_valid(raise_exception=True)
        serializer.save()
        if ticket.status != previous_status:
            _record_event(ticket, "ticket.status_changed", f"Status changed from {previous_status} to {ticket.status}.", {"from": previous_status, "to": ticket.status})
            _dispatch_webhooks(ticket, "ticket.status_changed")
        return Response(TicketSerializer(ticket).data)


class AgentTicketReplyAPIView(APIView):
    permission_classes = [IsAuthenticated]

    def post(self, request, pk):
        tenant = _tenant_or_403(request.user)
        ticket = Ticket.objects.filter(tenant=tenant, pk=pk).select_related("tenant").first()
        if not ticket:
            return Response({"error": "Not found."}, status=status.HTTP_404_NOT_FOUND)
        serializer = TicketReplySerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        TicketMessage.objects.create(
            ticket=ticket,
            author_type="agent",
            author_user=request.user,
            author_name=request.user.get_full_name() or request.user.username,
            message=serializer.validated_data["message"],
            attachments=serializer.validated_data.get("attachments", []),
            is_public=request.data.get("is_public", True),
        )
        if not ticket.first_response_at:
            ticket.first_response_at = timezone.now()
            ticket.save(update_fields=["first_response_at", "updated_at"])
        _record_event(ticket, "ticket.replied", "Agent replied to the requester.", {"agent_id": request.user.id})
        _dispatch_webhooks(ticket, "ticket.status_changed")
        return Response(TicketSerializer(ticket).data, status=status.HTTP_201_CREATED)


class PublicTicketCreateListExportAPIView(APIView):
    permission_classes = [AllowAny]

    def post(self, request):
        tenant, _ = _authenticate_public_request(request, "public")
        serializer = PublicTicketCreateSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        ticket = Ticket.objects.create(tenant=tenant, **serializer.validated_data)
        if ticket.description:
            TicketMessage.objects.create(
                ticket=ticket,
                author_type="requester",
                author_name=ticket.requester_name or ticket.requester_email,
                message=ticket.description,
                attachments=ticket.attachments,
                is_public=True,
            )
        _record_event(ticket, "ticket.created", "Ticket created from public API.", {"source_page": ticket.source_page})
        matched_rule = _apply_routing(ticket)
        if matched_rule:
            _record_event(ticket, "ticket.routed", f"Ticket routed by rule {matched_rule.name}.", {"rule_id": matched_rule.id}, is_public=False)
        _dispatch_webhooks(ticket, "ticket.created")
        return Response(
            {
                "ticket_id": ticket.public_id,
                "status": ticket.status,
                "tracking_token": ticket.public_token,
            },
            status=status.HTTP_201_CREATED,
        )

    def get(self, request):
        tenant, _ = _authenticate_public_request(request, "secret")
        qs = Ticket.objects.filter(tenant=tenant)
        if status_filter := request.query_params.get("status"):
            qs = qs.filter(status=status_filter)
        if search := request.query_params.get("search"):
            qs = qs.filter(Q(subject__icontains=search) | Q(description__icontains=search) | Q(category__icontains=search))
        if start_date := request.query_params.get("start_date"):
            qs = qs.filter(created_at__date__gte=start_date)
        if end_date := request.query_params.get("end_date"):
            qs = qs.filter(created_at__date__lte=end_date)
        return Response([_ticket_payload(ticket, include_private=True) for ticket in qs[:200]])


class PublicTicketExportAPIView(APIView):
    permission_classes = [AllowAny]

    def get(self, request):
        tenant, _ = _authenticate_public_request(request, "secret")
        export_format = request.query_params.get("format", "csv")
        qs = Ticket.objects.filter(tenant=tenant).order_by("-created_at")
        if status_filter := request.query_params.get("status"):
            qs = qs.filter(status=status_filter)

        if export_format != "csv":
            return Response({"error": "Only csv export is available in this version."}, status=status.HTTP_400_BAD_REQUEST)

        output = StringIO()
        writer = csv.writer(output)
        writer.writerow(["ticket_id", "subject", "status", "priority", "category", "requester_email", "created_at"])
        for ticket in qs[:1000]:
            writer.writerow(
                [
                    ticket.public_id,
                    ticket.subject,
                    ticket.status,
                    ticket.priority,
                    ticket.category,
                    ticket.requester_email,
                    ticket.created_at.isoformat(),
                ]
            )
        response = HttpResponse(output.getvalue(), content_type="text/csv")
        response["Content-Disposition"] = f'attachment; filename="{tenant.code}-tickets.csv"'
        return response


class PublicTicketTrackAPIView(APIView):
    permission_classes = [AllowAny]

    def get(self, request):
        public_id = request.query_params.get("ticket_id")
        if not public_id:
            return Response({"error": "ticket_id is required."}, status=status.HTTP_400_BAD_REQUEST)
        ticket = Ticket.objects.filter(public_id=public_id).select_related("tenant", "assigned_to").first()
        if not ticket:
            return Response({"error": "Not found."}, status=status.HTTP_404_NOT_FOUND)
        try:
            _validate_tracking_access(request, ticket)
        except ValidationError as exc:
            return Response({"error": _validation_message(exc)}, status=status.HTTP_403_FORBIDDEN)
        return Response(_ticket_payload(ticket))


class PublicTicketStatusAPIView(APIView):
    permission_classes = [AllowAny]

    def get(self, request, public_id):
        ticket = Ticket.objects.filter(public_id=public_id).select_related("tenant").first()
        if not ticket:
            return Response({"error": "Not found."}, status=status.HTTP_404_NOT_FOUND)
        try:
            _validate_tracking_access(request, ticket)
        except ValidationError as exc:
            return Response({"error": _validation_message(exc)}, status=status.HTTP_403_FORBIDDEN)
        return Response(
            {
                "ticket_id": ticket.public_id,
                "status": ticket.status,
                "priority": ticket.priority,
                "updated_at": ticket.updated_at,
            }
        )


class PublicTicketTimelineAPIView(APIView):
    permission_classes = [AllowAny]

    def get(self, request, public_id):
        ticket = Ticket.objects.filter(public_id=public_id).select_related("tenant", "assigned_to").first()
        if not ticket:
            return Response({"error": "Not found."}, status=status.HTTP_404_NOT_FOUND)
        try:
            _validate_tracking_access(request, ticket)
        except ValidationError as exc:
            return Response({"error": _validation_message(exc)}, status=status.HTTP_403_FORBIDDEN)
        return Response({"ticket_id": ticket.public_id, "timeline": _ticket_payload(ticket)["timeline"]})


class PublicTicketReplyAPIView(APIView):
    permission_classes = [AllowAny]

    def post(self, request, public_id):
        ticket = Ticket.objects.filter(public_id=public_id).select_related("tenant", "assigned_to").first()
        if not ticket:
            return Response({"error": "Not found."}, status=status.HTTP_404_NOT_FOUND)
        serializer = TicketReplySerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        try:
            _validate_tracking_access(request, ticket)
        except ValidationError as exc:
            return Response({"error": _validation_message(exc)}, status=status.HTTP_403_FORBIDDEN)
        TicketMessage.objects.create(
            ticket=ticket,
            author_type="requester",
            author_name=ticket.requester_name or ticket.requester_email,
            message=serializer.validated_data["message"],
            attachments=serializer.validated_data.get("attachments", []),
            is_public=True,
        )
        _record_event(ticket, "ticket.replied", "Requester replied via external portal.")
        _dispatch_webhooks(ticket, "ticket.status_changed")
        return Response({"ticket_id": ticket.public_id, "status": ticket.status}, status=status.HTTP_201_CREATED)


class PublicTicketCloseAPIView(APIView):
    permission_classes = [AllowAny]

    def patch(self, request, public_id):
        ticket = Ticket.objects.filter(public_id=public_id).select_related("tenant").first()
        if not ticket:
            return Response({"error": "Not found."}, status=status.HTTP_404_NOT_FOUND)
        try:
            _validate_tracking_access(request, ticket)
        except ValidationError as exc:
            return Response({"error": _validation_message(exc)}, status=status.HTTP_403_FORBIDDEN)
        config = _resolve_config(ticket.tenant)
        if not config.allow_requester_close:
            return Response({"error": "Requester closing is disabled for this tenant."}, status=status.HTTP_403_FORBIDDEN)
        previous_status = ticket.status
        ticket.status = "closed"
        ticket.save(update_fields=["status", "closed_at", "updated_at"])
        _record_event(ticket, "ticket.closed", f"Requester closed the ticket from {previous_status}.", {"from": previous_status, "to": "closed"})
        _dispatch_webhooks(ticket, "ticket.status_changed")
        return Response({"ticket_id": ticket.public_id, "status": ticket.status})
