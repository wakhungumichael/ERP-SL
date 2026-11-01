import hashlib
import unicodedata
from django.db import migrations


def copy_names(apps,schema_editor):
    Ticket=apps.get_model("SL_Ticketing","Ticket")
    alias=schema_editor.connection.alias
    for ticket in Ticket.objects.using(alias).filter(project_name="").only("pk","custom_fields").iterator():
        custom=ticket.custom_fields
        value=custom.get("project_name") if isinstance(custom,dict) else None
        if not isinstance(value,str):continue
        entered=" ".join(value.split())
        if not entered or len(entered)>180:continue
        normalized=" ".join(unicodedata.normalize("NFKC",entered).split()).casefold()
        Ticket.objects.using(alias).filter(pk=ticket.pk).update(project_name=entered,submitted_project_name=entered,
            project_name_key=hashlib.sha256(normalized.encode("utf-8")).hexdigest())


class Migration(migrations.Migration):
    dependencies=[("SL_Ticketing","0004_intake_project_branch")]
    operations=[migrations.RunPython(copy_names,migrations.RunPython.noop)]
