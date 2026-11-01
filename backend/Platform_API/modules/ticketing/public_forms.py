import re
import secrets
from django.http import HttpResponse
from django.shortcuts import get_object_or_404
from django.template.loader import render_to_string
from django.urls import reverse
from django.db import transaction
from rest_framework.exceptions import PermissionDenied, ValidationError
from rest_framework.permissions import AllowAny, IsAuthenticated
from rest_framework.response import Response
from rest_framework.throttling import SimpleRateThrottle
from rest_framework.views import APIView
from SL_Ticketing.intake import CORE_FIELDS, frame_origins, schema_fields
from SL_Ticketing.models import Ticket, TicketFormSchema


class PublicFormSubmissionThrottle(SimpleRateThrottle):
    rate="30/hour"
    scope="ticket_form_submit"
    def get_cache_key(self,request,view):
        return self.cache_format % {"scope":f"{self.scope}:{view.kwargs['tenant_code']}","ident":self.get_ident(request)}


class TicketFormConfigurationOptionsAPIView(APIView):
    permission_classes=[IsAuthenticated]
    def get(self,request):
        from .views import _tenant_or_403,_can_ticket_permission
        from Platform_Core.models import TenantBranch
        tenant=_tenant_or_403(request.user)
        if tenant is None:raise ValidationError("Select an organization first.")
        permissions={name:_can_ticket_permission(request.user,tenant,f"{name}_ticketformschema") for name in ["view","add","change","delete"]}
        if not any(permissions.values()):raise PermissionDenied("Your active role cannot configure intake forms.")
        return Response({"permissions":permissions,"branches":list(TenantBranch.objects.filter(tenant=tenant,is_active=True).order_by("name").values("id","name"))})


class TicketFormPublishAPIView(APIView):
    permission_classes=[IsAuthenticated]
    def get(self,request,pk):
        from .views import _tenant_or_403, _can_ticket_permission, _resolve_config
        tenant=_tenant_or_403(request.user)
        if tenant is None:raise ValidationError("Select an organization first.")
        if not any(_can_ticket_permission(request.user,tenant,permission) for permission in ["view_ticketformschema","change_ticketformschema","add_ticketformschema"]):
            raise PermissionDenied("Your active role cannot view intake form publishing settings.")
        form=get_object_or_404(TicketFormSchema,tenant=tenant,pk=pk)
        config=_resolve_config(tenant)
        path=reverse("ticketing-public-form",kwargs={"tenant_code":tenant.code,"form_slug":form.slug})
        return Response({"form_name":form.name,"is_public":form.is_public,"form_path":path if form.is_public else None,
            "allowed_domains":frame_origins(config.allowed_domains)})


class PublicTicketFormAPIView(APIView):
    permission_classes=[AllowAny]
    authentication_classes=[]

    def get_throttles(self):
        return [PublicFormSubmissionThrottle()] if self.request.method=="POST" else []

    def get_form(self,tenant_code,form_slug):
        return get_object_or_404(TicketFormSchema.objects.select_related("tenant"),tenant__code=tenant_code,
            tenant__is_active=True,slug=form_slug,is_public=True)

    def get(self,request,tenant_code,form_slug):
        from .views import _resolve_config
        form=self.get_form(tenant_code,form_slug)
        config=_resolve_config(form.tenant)
        nonce=secrets.token_urlsafe(24)
        color=str((config.brand_settings or {}).get("primary_color") or "#E85D26")
        if not re.fullmatch(r"#[0-9a-fA-F]{3}(?:[0-9a-fA-F]{3})?",color):color="#E85D26"
        html=render_to_string("SL_Ticketing/public_form.html",{"form":form,"fields":schema_fields(form.schema),
            "organization":form.tenant.name,"color":color,"nonce":nonce})
        response=HttpResponse(html,content_type="text/html; charset=utf-8")
        response.xframe_options_exempt=True
        ancestors=" ".join(["'self'",*frame_origins(config.allowed_domains)])
        response["Content-Security-Policy"]=(f"default-src 'none'; script-src 'nonce-{nonce}'; style-src 'nonce-{nonce}'; "
            f"connect-src 'self'; img-src 'self' data:; base-uri 'none'; form-action 'self'; object-src 'none'; frame-ancestors {ancestors}")
        response["Cache-Control"]="no-store"
        response["Referrer-Policy"]="strict-origin-when-cross-origin"
        response["X-Content-Type-Options"]="nosniff"
        return response

    @transaction.atomic
    def post(self,request,tenant_code,form_slug):
        from .views import PublicTicketCreateSerializer, _record_message, _record_event, _apply_routing, _dispatch_webhooks
        form=self.get_form(tenant_code,form_slug)
        payload=request.data.copy()
        payload["form_schema"]=form.pk
        payload["source_channel"]="widget"
        payload["source_page"]=request.path
        serializer=PublicTicketCreateSerializer(data=payload,context={"tenant":form.tenant,"public":True})
        serializer.is_valid(raise_exception=True)
        values=dict(serializer.validated_data)
        message=str(values.pop("message","") or "").strip()
        ticket=Ticket.objects.create(tenant=form.tenant,**values)
        if body:=ticket.description or message:
            _record_message(ticket=ticket,author_type="requester",author_name=ticket.requester_name or ticket.requester_email,
                message=body,is_public=True,channel="portal",direction="inbound",delivery_status="received")
        _record_event(ticket,"ticket.created","Ticket created from a published intake form.",{"form_id":form.pk})
        if rule:=_apply_routing(ticket):
            _record_event(ticket,"ticket.routed",f"Ticket routed by rule {rule.name}.",{"rule_id":rule.pk},is_public=False)
        transaction.on_commit(lambda: _dispatch_webhooks(ticket,"ticket.created"),robust=True)
        return Response({"ticket_id":ticket.public_id,"status":ticket.status,"tracking_token":ticket.public_token},status=201)
