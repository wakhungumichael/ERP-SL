from django.core.management.base import CommandError
from django.shortcuts import get_object_or_404
from rest_framework import serializers
from rest_framework.exceptions import PermissionDenied, ValidationError
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView
from Platform_Core.models import OrganizationSetupImport, Tenant
from Platform_Core.organization_setup import CATALOG, import_setup, remove_optional_examples


class SetupImportView(APIView):
    permission_classes = [IsAuthenticated]

    def tenant(self, request, pk):
        from .views import _is_superadmin, _user_has_tenant_access
        tenant = get_object_or_404(Tenant, pk=pk, is_active=True)
        if not _is_superadmin(request.user) and not _user_has_tenant_access(request.user, tenant, require_admin=True):
            raise PermissionDenied('Only an organization administrator may import its setup data.')
        return tenant

    def get(self, request, pk):
        tenant = self.tenant(request, pk)
        history = list(OrganizationSetupImport.objects.filter(tenant=tenant).values('id', 'selections', 'report', 'created_at', 'examples_removed_at')[:10])
        return Response({'catalog': CATALOG, 'history': history})

    def post(self, request, pk):
        tenant = self.tenant(request, pk)
        selections = serializers.ListField(child=serializers.ChoiceField(choices=[entry['key'] for entry in CATALOG]), min_length=1).run_validation(request.data.get('selections'))
        publish = serializers.BooleanField().run_validation(request.data.get('publish', True))
        dry_run = serializers.BooleanField().run_validation(request.data.get('dry_run', False))
        try:
            result = import_setup(tenant, request.user, list(dict.fromkeys(selections)), publish=publish, dry_run=dry_run)
        except CommandError as exc:
            raise ValidationError({'setup': str(exc)})
        return Response(result)

    def delete(self, request, pk):
        return Response(remove_optional_examples(self.tenant(request, pk)))
