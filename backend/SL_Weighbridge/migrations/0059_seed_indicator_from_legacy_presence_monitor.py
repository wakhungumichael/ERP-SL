from django.db import migrations


LEGACY_PRESENCE_WEIGHT_URL = "http://172.29.45.173:5000/weight"


def seed_legacy_presence_indicator(apps, schema_editor):
    Branch = apps.get_model("SL_Weighbridge", "Branch")
    IndicatorConfig = apps.get_model("SL_Weighbridge", "IndicatorConfig")

    for branch in Branch.objects.all().order_by("id"):
        cfg = IndicatorConfig.objects.filter(branch_id=branch.id).order_by("id").first()
        if cfg:
            changed = []
            if cfg.connection_type != "HTTP":
                cfg.connection_type = "HTTP"
                changed.append("connection_type")
            if not (cfg.live_weight_url or "").strip():
                cfg.live_weight_url = LEGACY_PRESENCE_WEIGHT_URL
                changed.append("live_weight_url")
            if not (cfg.stable_weight_url or "").strip():
                cfg.stable_weight_url = LEGACY_PRESENCE_WEIGHT_URL
                changed.append("stable_weight_url")
            if not (cfg.indicator_name or "").strip():
                cfg.indicator_name = f"{branch.name} Indicator"
                changed.append("indicator_name")
            if changed:
                cfg.save(update_fields=changed)
            continue

        IndicatorConfig.objects.create(
            branch_id=branch.id,
            indicator_name=f"{branch.name} Indicator",
            connection_type="HTTP",
            live_weight_url=LEGACY_PRESENCE_WEIGHT_URL,
            stable_weight_url=LEGACY_PRESENCE_WEIGHT_URL,
            data_bits=8,
            parity="None",
            stop_bits=1,
            max_first_weight_age_days=3,
            mode=1,
            node_number=49,
        )


def noop_reverse(apps, schema_editor):
    pass


class Migration(migrations.Migration):

    dependencies = [
        ("SL_Weighbridge", "0058_vehicle_presence_surveillance_bridge"),
    ]

    operations = [
        migrations.RunPython(seed_legacy_presence_indicator, noop_reverse),
    ]
