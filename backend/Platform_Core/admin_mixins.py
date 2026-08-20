from django.contrib import admin


class AuditAdminMixin(admin.ModelAdmin):
    audit_readonly_fields = (
        "audit_created_by_display",
        "audit_created_on_display",
        "audit_updated_by_display",
        "audit_updated_on_display",
        "audit_deleted_by_display",
        "audit_deleted_on_display",
    )

    def _format_user(self, user):
        if user is None:
            return "-"
        return user.get_full_name() or user.username

    def audit_created_by_display(self, obj):
        return self._format_user(getattr(obj, "created_by_user", None))

    audit_created_by_display.short_description = "Created by"

    def audit_created_on_display(self, obj):
        return getattr(obj, "created_at", None) or "-"

    audit_created_on_display.short_description = "Created on"

    def audit_updated_by_display(self, obj):
        return self._format_user(getattr(obj, "updated_by_user", None))

    audit_updated_by_display.short_description = "Updated by"

    def audit_updated_on_display(self, obj):
        return getattr(obj, "updated_at", None) or "-"

    audit_updated_on_display.short_description = "Updated on"

    def audit_deleted_by_display(self, obj):
        return self._format_user(getattr(obj, "deleted_by_user", None))

    audit_deleted_by_display.short_description = "Deleted by"

    def audit_deleted_on_display(self, obj):
        return getattr(obj, "deleted_on", None) or "-"

    audit_deleted_on_display.short_description = "Deleted on"

    def get_readonly_fields(self, request, obj=None):
        readonly = list(super().get_readonly_fields(request, obj))
        if obj is not None:
            readonly.extend(field for field in self.audit_readonly_fields if field not in readonly)
        return tuple(readonly)

    def get_fields(self, request, obj=None):
        fields = list(super().get_fields(request, obj))
        if obj is not None:
            for field in self.audit_readonly_fields:
                if field not in fields:
                    fields.append(field)
        return fields
