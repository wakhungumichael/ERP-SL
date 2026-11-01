"""Public intake schema validation and organization-bound project matching."""
import hashlib
import re
import unicodedata
import uuid
from django.db import transaction
from urllib.parse import urlsplit
from rest_framework.exceptions import ValidationError

CORE_FIELDS = {
    "requester_name": {"key":"requester_name","label":"Full name","type":"text","required":False},
    "requester_email": {"key":"requester_email","label":"Email address","type":"email","required":True},
    "requester_phone": {"key":"requester_phone","label":"Phone","type":"phone","required":False},
    "project_name": {"key":"project_name","label":"Project name","type":"text","required":False},
    "subject": {"key":"subject","label":"Subject","type":"text","required":True},
    "description": {"key":"description","label":"Description","type":"textarea","required":True},
    "category": {"key":"category","label":"Category","type":"text","required":False},
    "priority": {"key":"priority","label":"Priority","type":"select","required":False,"options":["low","normal","high","urgent"]},
}
REQUIRED_CORE = {"requester_email", "subject", "description"}


def normalize_project_name(value):
    return " ".join(unicodedata.normalize("NFKC", str(value or "")).split()).casefold()


@transaction.atomic
def project_values(tenant, entered, branch=None, actor=None):
    from SL_Projects.models import Project
    from Platform_Core.models import Tenant, TenantBranch
    from .models import Ticket
    entered=" ".join(str(entered or "").split())
    if len(entered)>180:raise ValidationError({"project_name":"Use a project name of 180 characters or fewer."})
    if not entered:return {"project":None,"project_name":"","submitted_project_name":"","project_name_key":""}
    Tenant.objects.select_for_update().get(pk=tenant.pk)
    normalized=normalize_project_name(entered)
    key=hashlib.sha256(normalized.encode("utf-8")).hexdigest()
    name_matches,code_matches=[],[]
    for project in Project.objects.filter(tenant=tenant).exclude(status__in=["archived","cancelled","completed"]).only("id","name","code").order_by("pk").iterator():
        if normalized==normalize_project_name(project.code):code_matches.append(project)
        if normalized==normalize_project_name(project.name):name_matches.append(project)
    matches=code_matches or name_matches
    if len(matches)>1:raise ValidationError({"project_name":"Several projects share this name. Enter the project code to choose the correct one."})
    project=matches[0] if matches else None
    saved=Ticket.objects.filter(tenant=tenant,project_name_key=key).exclude(project_name="").order_by("pk").values_list("project_name",flat=True).first()
    if project is None:
        if branch is not None and (branch.tenant_id!=tenant.pk or not branch.is_active):
            raise ValidationError({"project_name":"Choose an active project branch belonging to this organization."})
        if branch is None:branch=TenantBranch.objects.filter(tenant=tenant,is_active=True).order_by("pk").first()
        if branch is None:
            if TenantBranch.objects.filter(tenant=tenant).exists():raise ValidationError({"project_name":"An administrator must enable a project branch before this project can be created."})
            branch=TenantBranch.objects.create(tenant=tenant,name="Main")
        project=Project.objects.create(tenant=tenant,branch=branch,name=saved or entered,code=f"PRJ-{uuid.uuid4().hex[:12].upper()}",
            status="draft",description="Created automatically from a ticket intake request.",created_by=actor,updated_by=actor)
    return {"project":project,"project_name":project.name,"submitted_project_name":entered,"project_name_key":key}


def schema_fields(schema):
    if not isinstance(schema,dict) or not isinstance(schema.get("fields",[]),list):
        raise ValidationError({"schema":"Use a fields list for the intake form."})
    configured = schema.get("fields",[])
    if len(configured)>100:
        raise ValidationError({"schema":"Use at most 100 fields."})
    result, seen = [], set()
    for raw in configured:
        if not isinstance(raw,dict):
            raise ValidationError({"schema":"Each field needs a key, name, and type."})
        key = str(raw.get("key") or "").strip()
        kind = raw.get("type","text")
        if not re.fullmatch(r"[a-z][a-z0-9_]{0,79}",key) or key in seen or key in {"constructor","prototype"}:
            raise ValidationError({"schema":"Field keys must be unique lowercase names using letters, numbers, and underscores."})
        if kind not in {"text","email","phone","tel","textarea","select"}:
            raise ValidationError({"schema":"Choose a supported field type."})
        label = str(raw.get("label") or key).strip()
        if not 1<=len(label)<=150:
            raise ValidationError({"schema":"Field labels need 1 to 150 characters."})
        options = raw.get("options",[])
        if not isinstance(options,list) or any(not isinstance(option,str) or not option.strip() or len(option)>180 for option in options) or len(options)>100:
            raise ValidationError({"schema":"Dropdown options must be a list of up to 100 short labels."})
        if kind=="select" and not options:
            raise ValidationError({"schema":f"Add dropdown choices for {label}."})
        if key=="priority" and kind=="select":
            options=[value.lower() for value in options]
            if any(value not in {"low","normal","high","urgent"} for value in options):raise ValidationError({"schema":"Priority choices must be low, normal, high, or urgent."})
        seen.add(key)
        result.append({"key":key,"label":label,"type":"phone" if kind=="tel" else kind,
                       "required":True if key in REQUIRED_CORE else bool(raw.get("required",False)),"options":options})
    for key in ["requester_email","project_name","subject","description"]:
        if key not in seen:
            result.append(dict(CORE_FIELDS[key]))
    return result


def validate_intake_values(form, attrs):
    custom = attrs.get("custom_fields") or {}
    if not isinstance(custom,dict):
        raise ValidationError({"custom_fields":"Use named values for custom form fields."})
    errors = {}
    for field in schema_fields(form.schema):
        key=field["key"]
        value=attrs.get(key,"") if key in CORE_FIELDS else custom.get(key,"")
        if not isinstance(value,(str,int,float,bool)):
            errors[key]="Enter a text value.";continue
        value=str(value).strip()
        if field["required"] and not value:
            errors[key]=f"{field['label']} is required."
        elif value and field["type"]=="select" and value not in field["options"]:
            errors[key]="Choose an available option."
        elif len(value)>10000:
            errors[key]="Use 10,000 characters or fewer."
        elif value and field["type"]=="email":
            from django.core.validators import validate_email
            from django.core.exceptions import ValidationError as DjangoValidationError
            try:validate_email(value)
            except DjangoValidationError:errors[key]="Enter a valid email address."
    if errors:raise ValidationError(errors)


def frame_origins(domains):
    origins=[]
    for domain in domains or []:
        if not isinstance(domain,str):continue
        try:
            parsed=urlsplit(domain.strip())
            parsed.port
        except ValueError:continue
        if parsed.scheme in {"http","https"} and re.fullmatch(r"[A-Za-z0-9.\-\[\]:]+",parsed.netloc or ""):
            origin=f"{parsed.scheme}://{parsed.netloc}"
            if origin not in origins:origins.append(origin)
    return origins
