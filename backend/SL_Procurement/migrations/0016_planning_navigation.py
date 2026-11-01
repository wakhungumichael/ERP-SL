from django.db import migrations


def planning_menu(apps, schema_editor):
    Module=apps.get_model('Platform_Core','ModuleDefinition')
    Section=apps.get_model('Platform_Core','WorkspaceMenuSection')
    Item=apps.get_model('Platform_Core','WorkspaceMenuItem')
    alias=schema_editor.connection.alias
    for slug,title,key,item_title,route,permission in [
        ('budgeting','Budgeting','budgets','Budgets','/finance/budgets','SL_Budgeting.view_budget'),
        ('procurement','Procurement','procurement-plans','Procurement plans','/procurement/plans','SL_Procurement.view_procurementplan')]:
        module=Module.objects.using(alias).filter(slug=slug).first()
        section,_=Section.objects.using(alias).get_or_create(key=slug,defaults={'title':title,'icon':'wallet' if slug=='budgeting' else 'shopping-cart','module':module,'sort_order':51,'is_active':True})
        existing=Item.objects.using(alias).filter(route_path=route).first()
        values={'title':item_title,'route_path':route,'icon':'wallet' if slug=='budgeting' else 'clipboard-list','required_module':module,'required_permission':permission,'is_active':True}
        if existing:
            Item.objects.using(alias).filter(pk=existing.pk).update(**values)
        else:
            Item.objects.using(alias).create(section=section,key=key,sort_order=12,**values)


class Migration(migrations.Migration):
    dependencies=[('SL_Procurement','0015_procurementplan_procurementplanline')]
    operations=[migrations.RunPython(planning_menu,migrations.RunPython.noop)]
