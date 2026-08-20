from django.conf import settings
from django.db import migrations


LEGACY_PRESENCE_WEIGHT_URL = "http://172.29.45.173:5000/weight"


def seed_legacy_live_stable_urls(apps, schema_editor):
    IndicatorConfig = apps.get_model("SL_Weighbridge", "IndicatorConfig")

    legacy_live = (getattr(settings, "INDICATOR_LIVE_WEIGHT_URL", "") or "").strip()
    legacy_stable = (getattr(settings, "INDICATOR_STABLE_WEIGHT_URL", "") or "").strip() or legacy_live
    if not legacy_live and not legacy_stable:
        return

    for cfg in IndicatorConfig.objects.all().order_by("id"):
        changed = []
        if cfg.connection_type != "HTTP":
            cfg.connection_type = "HTTP"
            changed.append("connection_type")

        current_live = (cfg.live_weight_url or "").strip()
        current_stable = (cfg.stable_weight_url or "").strip()

        if legacy_live and (not current_live or current_live == LEGACY_PRESENCE_WEIGHT_URL):
            cfg.live_weight_url = legacy_live
            changed.append("live_weight_url")

        if legacy_stable and (not current_stable or current_stable == LEGACY_PRESENCE_WEIGHT_URL):
            cfg.stable_weight_url = legacy_stable
            changed.append("stable_weight_url")

        if changed:
            cfg.save(update_fields=changed)


def noop_reverse(apps, schema_editor):
    pass


class Migration(migrations.Migration):

    dependencies = [
        ("SL_Weighbridge", "0059_seed_indicator_from_legacy_presence_monitor"),
    ]

    operations = [
        migrations.RunPython(seed_legacy_live_stable_urls, noop_reverse),
    ]
