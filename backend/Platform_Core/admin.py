from django.contrib import admin

from .models import (
    Account,
    AccountingPostingRule,
    BackupPolicy,
    DocumentTemplate,
    IntegrationEndpoint,
    Journal,
    JournalEntry,
    JournalEntryLine,
    LicenseKey,
    ModuleDefinition,
    PlanModule,
    SubscriptionPlan,
    Tenant,
    TenantModuleActivation,
    TenantSubscription,
    WorkspaceMenuItem,
    WorkspaceMenuSection,
    WorkspaceRoleMenuItem,
)


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
class TenantAdmin(admin.ModelAdmin):
    list_display = ("name", "code", "status", "primary_domain", "default_currency", "is_active")
    list_filter = ("status", "is_active", "default_currency")
    search_fields = ("name", "code", "primary_domain", "subdomain", "contact_email")
    inlines = [TenantModuleActivationInline]


@admin.register(WorkspaceMenuSection)
class WorkspaceMenuSectionAdmin(admin.ModelAdmin):
    list_display = ("title", "key", "module", "sort_order", "is_active", "is_system")
    list_filter = ("is_active", "is_system", "module")
    search_fields = ("title", "key", "description")
    inlines = [WorkspaceMenuItemInline]


@admin.register(WorkspaceMenuItem)
class WorkspaceMenuItemAdmin(admin.ModelAdmin):
    list_display = ("title", "key", "section", "required_module", "required_permission", "sort_order", "is_active")
    list_filter = ("section", "required_module", "is_active", "is_external")
    search_fields = ("title", "key", "route_path", "api_path", "required_permission")


@admin.register(WorkspaceRoleMenuItem)
class WorkspaceRoleMenuItemAdmin(admin.ModelAdmin):
    list_display = ("group", "menu_item", "can_view")
    list_filter = ("group", "can_view", "menu_item__section")
    search_fields = ("group__name", "menu_item__title", "menu_item__key")


@admin.register(ModuleDefinition)
class ModuleDefinitionAdmin(admin.ModelAdmin):
    list_display = ("name", "slug", "category", "is_core", "is_active")
    list_filter = ("category", "is_core", "is_active")
    search_fields = ("name", "slug", "description")


@admin.register(SubscriptionPlan)
class SubscriptionPlanAdmin(admin.ModelAdmin):
    list_display = ("name", "code", "billing_period", "price", "currency", "is_active")
    list_filter = ("billing_period", "currency", "is_active")
    search_fields = ("name", "code")
    inlines = [PlanModuleInline]


@admin.register(TenantSubscription)
class TenantSubscriptionAdmin(admin.ModelAdmin):
    list_display = ("tenant", "plan", "status", "start_date", "end_date", "auto_renew")
    list_filter = ("status", "auto_renew", "plan")
    search_fields = ("tenant__name", "plan__name")


@admin.register(LicenseKey)
class LicenseKeyAdmin(admin.ModelAdmin):
    list_display = ("tenant", "license_key", "status", "activation_date", "expiry_date", "seats", "device_limit")
    list_filter = ("status",)
    search_fields = ("tenant__name", "license_key")


@admin.register(TenantModuleActivation)
class TenantModuleActivationAdmin(admin.ModelAdmin):
    list_display = ("tenant", "module", "status", "enabled_at", "expires_at")
    list_filter = ("status", "module")
    search_fields = ("tenant__name", "module__name")


@admin.register(IntegrationEndpoint)
class IntegrationEndpointAdmin(admin.ModelAdmin):
    list_display = ("tenant", "name", "integration_type", "transport", "provider", "is_primary", "is_active")
    list_filter = ("integration_type", "transport", "is_primary", "is_active")
    search_fields = ("tenant__name", "name", "provider", "base_url")


@admin.register(DocumentTemplate)
class DocumentTemplateAdmin(admin.ModelAdmin):
    list_display = ("name", "tenant", "document_type", "engine", "is_default", "is_active", "version")
    list_filter = ("document_type", "engine", "is_default", "is_active")
    search_fields = ("name", "tenant__name")


@admin.register(BackupPolicy)
class BackupPolicyAdmin(admin.ModelAdmin):
    list_display = ("tenant", "name", "frequency", "retention_days", "storage_backend", "is_active")
    list_filter = ("frequency", "storage_backend", "is_active")
    search_fields = ("tenant__name", "name", "target_path")


@admin.register(Account)
class AccountAdmin(admin.ModelAdmin):
    list_display = ("tenant", "code", "name", "account_type", "allow_posting", "is_active")
    list_filter = ("account_type", "allow_posting", "is_active")
    search_fields = ("tenant__name", "code", "name")


@admin.register(Journal)
class JournalAdmin(admin.ModelAdmin):
    list_display = ("tenant", "code", "name", "journal_type", "is_active")
    list_filter = ("journal_type", "is_active")
    search_fields = ("tenant__name", "code", "name")


@admin.register(JournalEntry)
class JournalEntryAdmin(admin.ModelAdmin):
    list_display = ("tenant", "entry_number", "journal", "entry_date", "source_type", "status")
    list_filter = ("source_type", "status", "journal")
    search_fields = ("tenant__name", "entry_number", "source_reference", "memo")
    inlines = [JournalEntryLineInline]


@admin.register(AccountingPostingRule)
class AccountingPostingRuleAdmin(admin.ModelAdmin):
    list_display = ("name", "tenant", "source_type", "payment_method_code", "journal", "is_active", "is_primary")
    list_filter = ("source_type", "is_active", "is_primary", "tenant")
    search_fields = ("name", "tenant__name", "payment_method_code", "journal__code")
