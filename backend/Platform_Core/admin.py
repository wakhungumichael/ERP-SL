from django.contrib import admin

from .admin_mixins import AuditAdminMixin

from .models import (
    Account,
    AuditAccessLog,
    AuditEventLog,
    AccountingPeriod,
    AccountingPeriodAuditLog,
    AccountingPostingRule,
    BackupPolicy,
    DocumentTemplate,
    FinancialYear,
    Industry,
    IntegrationEndpoint,
    Journal,
    JournalEntry,
    JournalEntryLine,
    LicenseKey,
    ModuleDefinition,
    PlanModule,
    PricingRule,
    PricingRuleType,
    SubscriptionPlan,
    Tenant,
    TenantModuleActivation,
    TenantSubscription,
    WorkspaceMenuItem,
    WorkspaceMenuSection,
    WorkspaceRoleMenuItem,
)


class TenantScopedLogAdmin(admin.ModelAdmin):
    def _can_view_global(self, request):
        return request.user.is_superuser or request.user.has_perm("Platform_Core.view_global_audit_logs") or request.user.has_perm("Platform_Core.view_global_access_logs")

    def _can_view_tenant(self, request):
        return self._can_view_global(request) or request.user.has_perm("Platform_Core.view_tenant_audit_logs") or request.user.has_perm("Platform_Core.view_tenant_access_logs")

    def get_queryset(self, request):
        qs = super().get_queryset(request)
        if self._can_view_global(request):
            return qs
        if self._can_view_tenant(request):
            profile = getattr(request.user, "tenant_profile", None)
            tenant = getattr(profile, "tenant", None)
            return qs.filter(tenant=tenant) if tenant is not None else qs.none()
        return qs.none()

    def has_module_permission(self, request):
        return self._can_view_tenant(request)

    def has_view_permission(self, request, obj=None):
        return self._can_view_tenant(request)


class PlanModuleInline(admin.TabularInline):
    model = PlanModule
    extra = 0


class TenantModuleActivationInline(admin.TabularInline):
    model = TenantModuleActivation
    extra = 0


class WorkspaceMenuItemInline(admin.TabularInline):
    model = WorkspaceMenuItem
    extra = 0


class JournalEntryLineInline(admin.TabularInline):
    model = JournalEntryLine
    extra = 0


@admin.register(Tenant)
class TenantAdmin(AuditAdminMixin, admin.ModelAdmin):
    list_display = ("name", "code", "industry", "status", "primary_domain", "default_currency", "is_active")
    list_filter = ("industry", "status", "is_active", "default_currency")
    search_fields = ("name", "code", "primary_domain", "subdomain", "contact_email")
    inlines = [TenantModuleActivationInline]


@admin.register(Industry)
class IndustryAdmin(AuditAdminMixin, admin.ModelAdmin):
    list_display = ("name", "slug", "is_active")
    list_filter = ("is_active",)
    search_fields = ("name", "slug", "description")


@admin.register(WorkspaceMenuSection)
class WorkspaceMenuSectionAdmin(AuditAdminMixin, admin.ModelAdmin):
    list_display = ("title", "key", "module", "sort_order", "is_active", "is_system")
    list_filter = ("is_active", "is_system", "module")
    search_fields = ("title", "key", "description")
    inlines = [WorkspaceMenuItemInline]


@admin.register(WorkspaceMenuItem)
class WorkspaceMenuItemAdmin(AuditAdminMixin, admin.ModelAdmin):
    list_display = ("title", "key", "section", "required_module", "required_permission", "sort_order", "is_active")
    list_filter = ("section", "required_module", "is_active", "is_external")
    search_fields = ("title", "key", "route_path", "api_path", "required_permission")


@admin.register(WorkspaceRoleMenuItem)
class WorkspaceRoleMenuItemAdmin(AuditAdminMixin, admin.ModelAdmin):
    list_display = ("group", "menu_item", "can_view")
    list_filter = ("group", "can_view", "menu_item__section")
    search_fields = ("group__name", "menu_item__title", "menu_item__key")


@admin.register(ModuleDefinition)
class ModuleDefinitionAdmin(AuditAdminMixin, admin.ModelAdmin):
    list_display = ("name", "slug", "category", "is_core", "is_active")
    list_filter = ("category", "is_core", "is_active")
    search_fields = ("name", "slug", "description")
    filter_horizontal = ("industries",)


@admin.register(SubscriptionPlan)
class SubscriptionPlanAdmin(AuditAdminMixin, admin.ModelAdmin):
    list_display = ("name", "code", "billing_period", "price", "currency", "is_active")
    list_filter = ("billing_period", "currency", "is_active")
    search_fields = ("name", "code")
    inlines = [PlanModuleInline]


@admin.register(TenantSubscription)
class TenantSubscriptionAdmin(AuditAdminMixin, admin.ModelAdmin):
    list_display = ("tenant", "plan", "status", "start_date", "end_date", "auto_renew")
    list_filter = ("status", "auto_renew", "plan")
    search_fields = ("tenant__name", "plan__name")


@admin.register(LicenseKey)
class LicenseKeyAdmin(AuditAdminMixin, admin.ModelAdmin):
    list_display = ("tenant", "license_key", "status", "activation_date", "expiry_date", "seats", "device_limit")
    list_filter = ("status",)
    search_fields = ("tenant__name", "license_key")


@admin.register(TenantModuleActivation)
class TenantModuleActivationAdmin(AuditAdminMixin, admin.ModelAdmin):
    list_display = ("tenant", "module", "status", "enabled_at", "expires_at")
    list_filter = ("status", "module")
    search_fields = ("tenant__name", "module__name")


@admin.register(IntegrationEndpoint)
class IntegrationEndpointAdmin(AuditAdminMixin, admin.ModelAdmin):
    list_display = ("tenant", "name", "integration_type", "transport", "provider", "is_primary", "is_active")
    list_filter = ("integration_type", "transport", "is_primary", "is_active")
    search_fields = ("tenant__name", "name", "provider", "base_url")


@admin.register(PricingRuleType)
class PricingRuleTypeAdmin(AuditAdminMixin, admin.ModelAdmin):
    list_display = ("name", "slug", "module", "is_active")
    list_filter = ("module", "is_active")
    search_fields = ("name", "slug", "description")


@admin.register(PricingRule)
class PricingRuleAdmin(AuditAdminMixin, admin.ModelAdmin):
    list_display = ("name", "tenant", "module", "rule_type", "adjustment_mode", "amount", "priority", "is_active")
    list_filter = ("module", "rule_type", "adjustment_mode", "is_active")
    search_fields = ("name", "tenant__name")


@admin.register(DocumentTemplate)
class DocumentTemplateAdmin(AuditAdminMixin, admin.ModelAdmin):
    list_display = ("name", "tenant", "document_type", "engine", "is_default", "is_active", "version")
    list_filter = ("document_type", "engine", "is_default", "is_active")
    search_fields = ("name", "tenant__name")


@admin.register(BackupPolicy)
class BackupPolicyAdmin(AuditAdminMixin, admin.ModelAdmin):
    list_display = ("tenant", "name", "frequency", "retention_days", "storage_backend", "last_successful_backup", "is_active")
    list_filter = ("frequency", "storage_backend", "is_active")
    search_fields = ("tenant__name", "name", "target_path", "last_backup_file")


@admin.register(Account)
class AccountAdmin(AuditAdminMixin, admin.ModelAdmin):
    list_display = ("tenant", "code", "name", "account_type", "allow_posting", "is_active")
    list_filter = ("account_type", "allow_posting", "is_active")
    search_fields = ("tenant__name", "code", "name")


@admin.register(Journal)
class JournalAdmin(AuditAdminMixin, admin.ModelAdmin):
    list_display = ("tenant", "code", "name", "journal_type", "is_active")
    list_filter = ("journal_type", "is_active")
    search_fields = ("tenant__name", "code", "name")


@admin.register(JournalEntry)
class JournalEntryAdmin(AuditAdminMixin, admin.ModelAdmin):
    list_display = ("tenant", "entry_number", "journal", "entry_date", "source_type", "status")
    list_filter = ("source_type", "status", "journal")
    search_fields = ("tenant__name", "entry_number", "source_reference", "memo")
    inlines = [JournalEntryLineInline]


@admin.register(AccountingPostingRule)
class AccountingPostingRuleAdmin(AuditAdminMixin, admin.ModelAdmin):
    list_display = ("name", "tenant", "source_type", "payment_method_code", "journal", "is_active", "is_primary")
    list_filter = ("source_type", "is_active", "is_primary", "tenant")
    search_fields = ("name", "tenant__name", "payment_method_code", "journal__code")


@admin.register(FinancialYear)
class FinancialYearAdmin(AuditAdminMixin, admin.ModelAdmin):
    list_display = ("tenant", "code", "name", "start_date", "end_date", "status", "is_active")
    list_filter = ("status", "is_active", "tenant")
    search_fields = ("tenant__name", "code", "name")


@admin.register(AccountingPeriod)
class AccountingPeriodAdmin(AuditAdminMixin, admin.ModelAdmin):
    list_display = ("tenant", "code", "name", "financial_year", "start_date", "end_date", "status", "period_type")
    list_filter = ("status", "period_type", "is_adjustment", "tenant")
    search_fields = ("tenant__name", "code", "name", "financial_year__name")


@admin.register(AccountingPeriodAuditLog)
class AccountingPeriodAuditLogAdmin(admin.ModelAdmin):
    list_display = ("tenant", "action", "financial_year", "period", "performed_by", "created_at")
    list_filter = ("action", "tenant")
    search_fields = ("tenant__name", "financial_year__name", "period__name", "performed_by__username", "note")


@admin.register(AuditEventLog)
class AuditEventLogAdmin(TenantScopedLogAdmin):
    list_display = ("created_at", "tenant", "event_group", "event_type", "actor", "model_label", "object_repr", "status")
    list_filter = ("event_group", "event_type", "status", "tenant")
    search_fields = ("tenant__name", "actor__username", "model_label", "object_repr", "note", "object_pk")
    readonly_fields = (
        "tenant", "branch", "actor", "event_group", "event_type", "status",
        "content_type", "object_id", "model_label", "object_pk", "object_repr",
        "changes", "previous_values", "current_values", "note", "metadata",
        "created_at", "updated_at",
    )


@admin.register(AuditAccessLog)
class AuditAccessLogAdmin(TenantScopedLogAdmin):
    list_display = ("created_at", "tenant", "actor", "event_group", "event_type", "request_method", "request_path", "status_code")
    list_filter = ("event_group", "event_type", "tenant", "request_method", "status_code")
    search_fields = ("tenant__name", "actor__username", "request_path", "remote_addr", "user_agent")
    readonly_fields = (
        "tenant", "branch", "actor", "event_group", "event_type", "request_method",
        "request_path", "query_params", "status_code", "remote_addr", "user_agent",
        "metadata", "created_at", "updated_at",
    )
