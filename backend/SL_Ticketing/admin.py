from django.contrib import admin

from .models import (
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


class TicketMessageInline(admin.TabularInline):
    model = TicketMessage
    extra = 0
    readonly_fields = ["author_type", "author_user", "author_name", "message", "attachments", "is_public", "created_at"]
    can_delete = False


class TicketEventInline(admin.TabularInline):
    model = TicketEvent
    extra = 0
    readonly_fields = ["event_type", "summary", "payload", "is_public", "created_at"]
    can_delete = False


@admin.register(TicketingInboxConfig)
class TicketingInboxConfigAdmin(admin.ModelAdmin):
    list_display = ["tenant", "portal_access_policy", "require_cors_origin", "allow_requester_close"]
    search_fields = ["tenant__name", "tenant__code"]


@admin.register(TicketingApiKey)
class TicketingApiKeyAdmin(admin.ModelAdmin):
    list_display = ["tenant", "name", "key_type", "token_prefix", "is_active", "last_used_at", "revoked_at"]
    list_filter = ["key_type", "is_active", "tenant"]
    search_fields = ["tenant__name", "name", "token_prefix"]
    readonly_fields = ["token_hash"]


@admin.register(TicketingWebhookEndpoint)
class TicketingWebhookEndpointAdmin(admin.ModelAdmin):
    list_display = ["tenant", "name", "target_url", "is_active", "last_status_code", "last_delivered_at"]
    list_filter = ["tenant", "is_active"]
    search_fields = ["tenant__name", "name", "target_url"]


@admin.register(TicketFormSchema)
class TicketFormSchemaAdmin(admin.ModelAdmin):
    list_display = ["tenant", "name", "slug", "is_default", "is_public"]
    list_filter = ["tenant", "is_default", "is_public"]
    search_fields = ["tenant__name", "name", "slug"]


@admin.register(TicketRoutingRule)
class TicketRoutingRuleAdmin(admin.ModelAdmin):
    list_display = ["tenant", "name", "priority", "assign_to", "target_status", "is_active"]
    list_filter = ["tenant", "is_active"]
    search_fields = ["tenant__name", "name"]


@admin.register(Ticket)
class TicketAdmin(admin.ModelAdmin):
    list_display = ["public_id", "tenant", "subject", "status", "priority", "requester_email", "assigned_to", "created_at"]
    list_filter = ["tenant", "status", "priority", "category"]
    search_fields = ["public_id", "subject", "requester_email", "requester_name", "external_reference"]
    inlines = [TicketMessageInline, TicketEventInline]


@admin.register(TicketWebhookDelivery)
class TicketWebhookDeliveryAdmin(admin.ModelAdmin):
    list_display = ["endpoint", "ticket", "event_type", "status_code", "was_successful", "attempted_at"]
    list_filter = ["event_type", "was_successful"]
    search_fields = ["ticket__public_id", "endpoint__name"]

