from django.db import migrations, models
import django.db.models.deletion


INDUSTRIES = [
    ("logistics-transport", "Logistics & Transport", "Fleet, dispatch, weighbridge, routing, and freight operations."),
    ("manufacturing", "Manufacturing", "Production, raw materials, warehouse, procurement, and cost control."),
    ("construction", "Construction", "Project delivery, materials, subcontracting, and equipment operations."),
    ("agriculture", "Agriculture", "Farm supply chains, produce intake, agro-processing, and field operations."),
    ("energy-mining", "Energy & Mining", "Bulk movement, extraction logistics, compliance, and asset-heavy operations."),
    ("general-trade", "General Trade", "Sales, purchasing, finance, CRM, and standard back-office workflows."),
]

MODULE_INDUSTRIES = {
    "platform-core": ["logistics-transport", "manufacturing", "construction", "agriculture", "energy-mining", "general-trade"],
    "weighbridge": ["logistics-transport", "manufacturing", "construction", "agriculture", "energy-mining"],
    "invoicing": ["logistics-transport", "manufacturing", "construction", "agriculture", "energy-mining", "general-trade"],
    "accounting": ["logistics-transport", "manufacturing", "construction", "agriculture", "energy-mining", "general-trade"],
    "crm": ["logistics-transport", "manufacturing", "construction", "agriculture", "energy-mining", "general-trade"],
    "hr-payroll": ["logistics-transport", "manufacturing", "construction", "agriculture", "energy-mining", "general-trade"],
    "procurement": ["logistics-transport", "manufacturing", "construction", "agriculture", "energy-mining", "general-trade"],
    "reporting": ["logistics-transport", "manufacturing", "construction", "agriculture", "energy-mining", "general-trade"],
    "integrations": ["logistics-transport", "manufacturing", "construction", "agriculture", "energy-mining", "general-trade"],
}

PRICING_RULE_TYPES = [
    ("customer", "Customer Based", "Applies a pricing adjustment for one customer or a customer segment.", {"supported_conditions": ["customer_id", "customer_ids", "weight_type"]}),
    ("customer-vehicle-type", "Customer + Vehicle Type", "Overrides or discounts charges for a customer and vehicle-type combination.", {"supported_conditions": ["customer_id", "vehicle_type_id", "weight_type"]}),
    ("vehicle-weight-band", "Vehicle Weight Band", "Applies pricing based on a weight range captured at the weighbridge.", {"supported_conditions": ["min_weight_kg", "max_weight_kg", "vehicle_type_id", "weight_type"]}),
]


def seed_industries_and_rule_types(apps, schema_editor):
    Industry = apps.get_model("Platform_Core", "Industry")
    ModuleDefinition = apps.get_model("Platform_Core", "ModuleDefinition")
    PricingRuleType = apps.get_model("Platform_Core", "PricingRuleType")

    for slug, name, description in INDUSTRIES:
        Industry.objects.update_or_create(
            slug=slug,
            defaults={"name": name, "description": description, "is_active": True, "metadata": {}},
        )

    industries = {industry.slug: industry for industry in Industry.objects.all()}
    modules = {module.slug: module for module in ModuleDefinition.objects.all()}
    for module_slug, industry_slugs in MODULE_INDUSTRIES.items():
        module = modules.get(module_slug)
        if not module:
            continue
        module.industries.set([industries[slug] for slug in industry_slugs if slug in industries])

    weighbridge_module = modules.get("weighbridge") or modules.get("commercial-weighbridge")
    for slug, name, description, config_schema in PRICING_RULE_TYPES:
        PricingRuleType.objects.update_or_create(
            slug=slug,
            defaults={
                "name": name,
                "description": description,
                "module": weighbridge_module,
                "config_schema": config_schema,
                "is_active": True,
            },
        )


def backfill_weighbridge_pricing_rules(apps, schema_editor):
    ModuleDefinition = apps.get_model("Platform_Core", "ModuleDefinition")
    PricingRule = apps.get_model("Platform_Core", "PricingRule")
    PricingRuleType = apps.get_model("Platform_Core", "PricingRuleType")
    Customer = apps.get_model("SL_Weighbridge", "Customer")
    CustomerVehicleTypeDiscount = apps.get_model("SL_Weighbridge", "CustomerVehicleTypeDiscount")
    Transaction = apps.get_model("SL_Weighbridge", "Transaction")

    module = (
        ModuleDefinition.objects.filter(slug="weighbridge").first()
        or ModuleDefinition.objects.filter(slug="commercial-weighbridge").first()
    )
    if not module:
        return

    customer_type = PricingRuleType.objects.filter(slug="customer").first()
    customer_vehicle_type = PricingRuleType.objects.filter(slug="customer-vehicle-type").first()
    if not customer_type or not customer_vehicle_type:
        return

    def infer_tenant_ids_for_customer(customer_id):
        tenant_ids = list(
            Transaction.objects.filter(customer_id=customer_id, tenant_id__isnull=False)
            .values_list("tenant_id", flat=True)
            .distinct()
        )
        return tenant_ids

    for discount in CustomerVehicleTypeDiscount.objects.all():
        tenant_ids = infer_tenant_ids_for_customer(discount.customer_id)
        if len(tenant_ids) != 1:
            continue
        PricingRule.objects.get_or_create(
            tenant_id=tenant_ids[0],
            module_id=module.id,
            rule_type_id=customer_vehicle_type.id,
            name=f"Legacy discount - customer {discount.customer_id} vehicle type {discount.vehicle_type_id}",
            defaults={
                "priority": 300,
                "is_active": True,
                "adjustment_mode": "override",
                "amount": discount.discounted_charge,
                "conditions": {
                    "customer_id": discount.customer_id,
                    "vehicle_type_id": discount.vehicle_type_id,
                    "weight_type": "First Weight",
                },
                "metadata": {"source": "legacy_customer_vehicle_type_discount"},
            },
        )

    for customer in Customer.objects.filter(discounted=True):
        tenant_ids = infer_tenant_ids_for_customer(customer.id)
        if len(tenant_ids) != 1:
            continue
        PricingRule.objects.get_or_create(
            tenant_id=tenant_ids[0],
            module_id=module.id,
            rule_type_id=customer_type.id,
            name=f"Legacy customer default charge - {customer.name}",
            defaults={
                "priority": 200,
                "is_active": True,
                "adjustment_mode": "override",
                "amount": customer.charge,
                "conditions": {
                    "customer_id": customer.id,
                    "weight_type": "First Weight",
                },
                "metadata": {"source": "legacy_customer_charge"},
            },
        )


class Migration(migrations.Migration):

    dependencies = [
        ("Platform_Core", "0008_purchase_order_templates"),
        ("SL_Weighbridge", "0052_overweightconfig_notify_email_notify_on_overweight"),
    ]

    operations = [
        migrations.CreateModel(
            name="Industry",
            fields=[
                ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                ("created_at", models.DateTimeField(auto_now_add=True)),
                ("updated_at", models.DateTimeField(auto_now=True)),
                ("slug", models.SlugField(max_length=100, unique=True)),
                ("name", models.CharField(max_length=150)),
                ("description", models.TextField(blank=True)),
                ("is_active", models.BooleanField(default=True)),
                ("metadata", models.JSONField(blank=True, default=dict)),
            ],
            options={"ordering": ["name"]},
        ),
        migrations.AddField(
            model_name="tenant",
            name="industry",
            field=models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.SET_NULL, related_name="tenants", to="Platform_Core.industry"),
        ),
        migrations.AddField(
            model_name="moduledefinition",
            name="industries",
            field=models.ManyToManyField(blank=True, related_name="modules", to="Platform_Core.industry"),
        ),
        migrations.CreateModel(
            name="PricingRuleType",
            fields=[
                ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                ("created_at", models.DateTimeField(auto_now_add=True)),
                ("updated_at", models.DateTimeField(auto_now=True)),
                ("slug", models.SlugField(max_length=100, unique=True)),
                ("name", models.CharField(max_length=150)),
                ("description", models.TextField(blank=True)),
                ("config_schema", models.JSONField(blank=True, default=dict)),
                ("is_active", models.BooleanField(default=True)),
                ("module", models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.SET_NULL, related_name="pricing_rule_types", to="Platform_Core.moduledefinition")),
            ],
            options={"ordering": ["name"]},
        ),
        migrations.CreateModel(
            name="PricingRule",
            fields=[
                ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                ("created_at", models.DateTimeField(auto_now_add=True)),
                ("updated_at", models.DateTimeField(auto_now=True)),
                ("name", models.CharField(max_length=180)),
                ("priority", models.IntegerField(default=100)),
                ("is_active", models.BooleanField(default=True)),
                ("adjustment_mode", models.CharField(choices=[("override", "Override Charge"), ("fixed_discount", "Fixed Discount"), ("percentage_discount", "Percentage Discount")], default="override", max_length=30)),
                ("amount", models.DecimalField(decimal_places=2, default=0, max_digits=12)),
                ("conditions", models.JSONField(blank=True, default=dict)),
                ("metadata", models.JSONField(blank=True, default=dict)),
                ("module", models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name="pricing_rules", to="Platform_Core.moduledefinition")),
                ("rule_type", models.ForeignKey(on_delete=django.db.models.deletion.PROTECT, related_name="rules", to="Platform_Core.pricingruletype")),
                ("tenant", models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name="pricing_rules", to="Platform_Core.tenant")),
            ],
            options={"ordering": ["tenant__name", "-priority", "name"]},
        ),
        migrations.RunPython(seed_industries_and_rule_types, migrations.RunPython.noop),
        migrations.RunPython(backfill_weighbridge_pricing_rules, migrations.RunPython.noop),
    ]
