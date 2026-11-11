"""Receipt timestamps are displayed in the organization's configured timezone."""
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError
from django.template.defaultfilters import date as date_filter
from django.utils import timezone


def receipt_timezone(tenant=None):
    name = getattr(tenant, "timezone", "") or ""
    if name:
        try:
            return ZoneInfo(name)
        except (ZoneInfoNotFoundError, ValueError):
            pass
    return timezone.get_default_timezone()


def format_receipt_datetime(value, *, tenant=None, date_format="d M Y h:i A"):
    if value is None:
        return ""
    zone = receipt_timezone(tenant)
    if timezone.is_naive(value):
        value = timezone.make_aware(value, zone)
    return date_filter(timezone.localtime(value, zone), date_format)
