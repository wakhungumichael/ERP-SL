"""
Platform integration helpers stub.
Provides build_integration_health_snapshot and indicator_source_registry
used by Platform_API views.
"""
from typing import List, Optional

from django.db.models import Q

from Platform_Core.models import IntegrationEndpoint


# Registry of known indicator sources (weighbridge scale integrations)
# Maps source_type → dict of metadata
indicator_source_registry: dict = {
    "rs232": {
        "name": "RS-232 Serial",
        "description": "Direct RS-232/serial connection to weighbridge indicator",
        "config_schema": {
            "port": {"type": "string", "label": "Serial port", "default": "/dev/ttyS0"},
            "baud_rate": {"type": "integer", "label": "Baud rate", "default": 9600},
            "protocol": {"type": "string", "label": "Protocol", "default": "toledo"},
        },
    },
    "tcp_ip": {
        "name": "TCP/IP",
        "description": "Network-connected weighbridge indicator",
        "config_schema": {
            "host": {"type": "string", "label": "IP address"},
            "port": {"type": "integer", "label": "TCP port", "default": 8001},
        },
    },
    "mock": {
        "name": "Mock / Simulation",
        "description": "Simulated weight readings for development",
        "config_schema": {},
    },
}


PAYMENT_PROVIDER_CATALOG: dict = {
    "manual": {
        "label": "Manual",
        "rails": ["cash", "bank_transfer"],
        "supports_callback": False,
        "supports_initiation": False,
    },
    "cash": {
        "label": "Cash",
        "rails": ["cash"],
        "supports_callback": False,
        "supports_initiation": False,
    },
    "bank": {
        "label": "Bank API",
        "rails": ["bank_transfer"],
        "supports_callback": False,
        "supports_initiation": False,
    },
    "mpesa": {
        "label": "M-Pesa",
        "rails": ["mobile_money"],
        "supports_callback": True,
        "supports_initiation": True,
    },
    "pesapal": {
        "label": "Pesapal",
        "rails": ["card", "mobile_money", "bank_transfer"],
        "supports_callback": True,
        "supports_initiation": True,
    },
    "flutterwave": {
        "label": "Flutterwave",
        "rails": ["card", "mobile_money", "bank_transfer"],
        "supports_callback": True,
        "supports_initiation": True,
    },
    "stripe": {
        "label": "Stripe",
        "rails": ["card", "bank_transfer"],
        "supports_callback": True,
        "supports_initiation": True,
    },
}


def _normalize_payment_scope(value: Optional[str]) -> str:
    return value if value in {"saas_billing", "tenant_operations"} else "tenant_operations"


def get_payment_provider_definition(provider: Optional[str]) -> dict:
    key = (provider or "").strip().lower()
    return PAYMENT_PROVIDER_CATALOG.get(
        key,
        {
            "label": provider or "Custom Gateway",
            "rails": ["custom"],
            "supports_callback": True,
            "supports_initiation": True,
        },
    )


def list_payment_gateway_capabilities(*, tenant=None, payment_scope: Optional[str] = None) -> List[dict]:
    """
    Return normalized payment gateway capabilities for a tenant.

    `payment_scope` values:
    - saas_billing: provider used to collect subscription/license payments
    - tenant_operations: provider used by the tenant inside their own workspace
    """
    queryset = IntegrationEndpoint.objects.filter(
        Q(integration_type="payment") | Q(integration_type="payment_gateway"),
        is_active=True,
    ).select_related("tenant")

    if tenant is not None:
        queryset = queryset.filter(tenant=tenant)

    normalized_scope = _normalize_payment_scope(payment_scope)
    filter_by_scope = payment_scope in {"saas_billing", "tenant_operations"}

    capabilities = []
    for endpoint in queryset.order_by("-is_primary", "name"):
        settings = endpoint.connection_settings or {}
        scope = _normalize_payment_scope(settings.get("payment_scope"))
        if filter_by_scope and scope != normalized_scope:
            continue

        definition = get_payment_provider_definition(endpoint.provider)
        enabled_rails = settings.get("enabled_rails") or definition["rails"]
        checkout_mode = settings.get("checkout_mode") or (
            "hosted" if "card" in enabled_rails else "direct"
        )

        capabilities.append(
            {
                "id": endpoint.id,
                "tenant_id": endpoint.tenant_id,
                "tenant_name": getattr(endpoint.tenant, "name", ""),
                "name": endpoint.name,
                "provider": endpoint.provider,
                "transport": endpoint.transport,
                "is_primary": endpoint.is_primary,
                "payment_scope": scope,
                "enabled_rails": enabled_rails,
                "checkout_mode": checkout_mode,
                "supports_callback": bool(definition["supports_callback"]),
                "supports_initiation": bool(definition["supports_initiation"]),
                "base_url": endpoint.base_url,
            }
        )

    return capabilities


def resolve_indicator_for_branch(branch) -> dict:
    """
    Resolve a live weight reading for a branch.

    Resolution order:
    1. Active IntegrationEndpoint linked to branch with a resolvable URL
    2. Global settings INDICATOR_LIVE_WEIGHT_URL
    3. Offline stub — weight=None, stable=False

    Returns: {weight, stable, source, unit, meta}
    """
    import json as _json
    import urllib.request

    def _fetch(url: str, timeout: int = 5) -> dict:
        req = urllib.request.urlopen(url, timeout=timeout)  # noqa: S310
        raw = _json.loads(req.read().decode())
        weight = raw.get("value") if raw.get("value") is not None else raw.get("weight")
        stable = bool(raw.get("stable", False))
        return {"weight": float(weight) if weight is not None else None, "stable": stable}

    # 1. IntegrationEndpoint
    try:
        qs = IntegrationEndpoint.objects.filter(is_active=True)
        if branch is not None:
            qs = qs.filter(branch=branch)
        endpoint = qs.first()
        if endpoint:
            url = (
                getattr(endpoint, "live_weight_url", None)
                or getattr(endpoint, "url", None)
                or getattr(endpoint, "base_url", None)
            )
            if url:
                reading = _fetch(str(url))
                return {
                    "weight": reading["weight"],
                    "stable": reading["stable"],
                    "source": getattr(endpoint, "name", "integration"),
                    "unit": "kg",
                    "meta": {"endpoint_id": endpoint.id},
                }
    except Exception:
        pass

    # 2. Settings URL
    try:
        from django.conf import settings as _s
        url = getattr(_s, "INDICATOR_LIVE_WEIGHT_URL", None)
        timeout = getattr(_s, "INDICATOR_REQUEST_TIMEOUT", 5)
        if url:
            reading = _fetch(url, timeout=timeout)
            return {
                "weight": reading["weight"],
                "stable": reading["stable"],
                "source": getattr(_s, "INDICATOR_API_BASE_URL", url),
                "unit": "kg",
                "meta": {},
            }
    except Exception:
        pass

    # 3. Offline stub
    return {"weight": None, "stable": False, "source": "offline", "unit": "kg", "meta": {}}


def build_integration_health_snapshot(tenant=None) -> list:
    """
    Return a list of integration health status dicts for the given tenant
    (or all integrations if tenant is None).
    """
    try:
        qs = IntegrationEndpoint.objects.all()
        if tenant is not None:
            qs = qs.filter(tenant=tenant)

        snapshots = []
        for endpoint in qs:
            snapshots.append({
                "id": endpoint.id,
                "name": getattr(endpoint, "name", str(endpoint)),
                "integration_type": getattr(endpoint, "endpoint_type", ""),
                "status": getattr(endpoint, "status", "unknown"),
                "is_active": getattr(endpoint, "is_active", True),
                "last_checked_at": None,
                "health": "healthy",
                "error": None,
            })
        return snapshots
    except Exception as exc:
        return []
