import re
from django.db import transaction
from django.utils.dateparse import parse_datetime
from rest_framework import serializers
from rest_framework.exceptions import ValidationError
from rest_framework.response import Response
from rest_framework.views import APIView
from rest_framework.permissions import IsAuthenticated
from SL_Projects.models import ProjectModuleSettings, ProjectTask
from SL_Projects.configuration import get_project_settings


class ProjectModuleSettingsSerializer(serializers.ModelSerializer):
    class Meta:
        model = ProjectModuleSettings
        exclude = ("id", "tenant")
        read_only_fields = ("updated_at", "updated_by")

    def validate_task_types(self, rows):
        if not isinstance(rows, list) or not 1 <= len(rows) <= 200:
            raise serializers.ValidationError("Configure between 1 and 200 task types.")
        cleaned, identifiers, labels = [], set(), set()
        for row in rows:
            if not isinstance(row, dict):
                raise serializers.ValidationError("Each task type needs a code, name, and category.")
            value, label, category = (str(row.get(key) or "").strip() for key in ("value", "label", "category"))
            if not re.fullmatch(r"[a-z][a-z0-9_]{0,99}", value) or value in {"all", "other"}:
                raise serializers.ValidationError("Type codes use lowercase letters, numbers, and underscores; all and other are reserved.")
            if not label or len(label) > 100 or not category or len(category) > 100:
                raise serializers.ValidationError("Type names and categories need 1 to 100 characters.")
            if value in identifiers or label.casefold() in labels:
                raise serializers.ValidationError("Task type codes and names must be unique.")
            active = row.get("is_active", True)
            if not isinstance(active, bool):
                raise serializers.ValidationError("Task type active flags must be true or false.")
            identifiers.add(value); labels.add(label.casefold())
            cleaned.append({"value": value, "label": label, "category": category, "is_active": active})
        return cleaned

    def validate(self, attrs):
        config = self.instance
        rows = attrs.get("task_types", config.task_types)
        active = {row["value"] for row in rows if row.get("is_active", True)}
        if attrs.get("default_task_type", config.default_task_type) not in active:
            raise serializers.ValidationError({"default_task_type": "Choose an active task type as the default."})
        statuses = attrs.get("enabled_task_statuses", config.enabled_task_statuses)
        if not isinstance(statuses, list) or any(not isinstance(value, str) for value in statuses):
            raise serializers.ValidationError({"enabled_task_statuses": "Choose valid task statuses."})
        valid = set(dict(ProjectTask.STATUS_CHOICES))
        if len(statuses) != len(set(statuses)) or not set(statuses) <= valid or not {"todo", "in_progress", "completed"} <= set(statuses):
            raise serializers.ValidationError({"enabled_task_statuses": "Keep To do, In progress, and Completed enabled; choose only supported statuses."})
        if attrs.get("default_task_status", config.default_task_status) not in {"draft", "todo"} & set(statuses):
            raise serializers.ValidationError({"default_task_status": "Enable Draft or To do and choose it as the default."})
        if attrs.get("default_page_size", config.default_page_size) not in {10, 25, 50, 100}:
            raise serializers.ValidationError({"default_page_size": "Choose 10, 25, 50, or 100 rows."})
        for field in ("default_due_days", "default_follow_up_days"):
            value = attrs.get(field, getattr(config, field))
            if value is not None and not 0 <= value <= 3650:
                raise serializers.ValidationError({field: "Enter a number of days from 0 to 3650."})
        return attrs


class ProjectModuleSettingsAPIView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request):
        from .views import _tenant_and_activation, _require, _has_permission
        tenant = _tenant_and_activation(request)
        # Task forms read these non-secret defaults; opening or changing the
        # settings page still requires its separate management permission.
        if not (_has_permission(request.user, "view_project") or _has_permission(request.user, "change_projectmodulesettings")):
            _require(request.user, "view_projecttask")
        if tenant is None:
            raise ValidationError("Select an organization to configure Projects.")
        return Response({**ProjectModuleSettingsSerializer(get_project_settings(tenant)).data,
            "can_manage": _has_permission(request.user, "change_projectmodulesettings")})

    @transaction.atomic
    def patch(self, request):
        from .views import _tenant_and_activation, _require
        from Platform_Core.models import Tenant
        from Platform_Core.audit import log_business_event
        tenant = _tenant_and_activation(request)
        _require(request.user, "change_projectmodulesettings")
        if tenant is None:
            raise ValidationError("Select an organization to configure Projects.")
        Tenant.objects.select_for_update().get(pk=tenant.pk)
        config = get_project_settings(tenant)
        if request.data.get("version") and config.pk and parse_datetime(str(request.data["version"])) != config.updated_at:
            from rest_framework.exceptions import APIException
            error = APIException("Settings were changed by another user. Reload before saving.")
            error.status_code = 409
            raise error
        serializer = ProjectModuleSettingsSerializer(config, data=request.data, partial=True)
        serializer.is_valid(raise_exception=True)
        config = serializer.save(updated_by=request.user)
        log_business_event(event_group="data_lifecycle", event_type="update", tenant=tenant, actor=request.user,
            obj=config, note="Project module settings updated.")
        return Response({**ProjectModuleSettingsSerializer(config).data, "can_manage": True})
