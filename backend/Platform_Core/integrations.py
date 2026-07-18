"""
Platform integration helpers stub.
Provides build_integration_health_snapshot and indicator_source_registry
used by Platform_API views.
"""
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
