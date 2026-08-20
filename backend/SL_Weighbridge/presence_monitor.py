import logging
import os
import time
import traceback
from datetime import timedelta

import requests
from django.utils import timezone

from Platform_Core.platform import get_tenants_with_active_module
from .models import CameraConfig, OverweightConfig, VehiclePresence
from .surveillance import maybe_record_overweight_event_from_presence, resolve_tenant_for_branch
from .utils import (
    fetch_indicator_http_reading,
    resolve_presence_indicator_source,
    save_image_from_camera,
)

logger = logging.getLogger(__name__)

_DEFAULT_PRESENCE_INTERVAL = 10
def _presence_interval_seconds():
    return int(os.environ.get("VEHICLE_PRESENCE_INTERVAL_SECONDS", _DEFAULT_PRESENCE_INTERVAL))

def _recent_presence_exists(branch, weight, capture_interval_seconds):
    window_start = timezone.now() - timedelta(seconds=max(int(capture_interval_seconds or 0), 0))
    return VehiclePresence.objects.filter(
        branch=branch,
        detected_weight=weight,
        timestamp__gte=window_start,
    ).exists()


def _capture_camera_image(camera_config):
    if not camera_config or not camera_config.capture_on_overweight:
        return None
    if camera_config.connection_type != "IP":
        return None
    try:
        return save_image_from_camera(
            camera_config.ip_address,
            camera_config.username,
            camera_config.password,
        )
    except requests.exceptions.HTTPError as exc:
        logger.warning("Camera snapshot HTTP error for branch %s: %s", camera_config.branch_id, exc)
    except Exception as exc:
        logger.warning("Camera snapshot failed for branch %s: %s", camera_config.branch_id, exc)
    return None


def poll_branch_once(branch):
    try:
        cfg = OverweightConfig.objects.filter(branch=branch, surveillance_enabled=True).first()
        if cfg is None:
            return {"captured": False, "branch_id": branch.id, "reason": "surveillance_disabled"}

        tenant = resolve_tenant_for_branch(branch)
        if tenant is None:
            return {
                "captured": False,
                "branch_id": branch.id,
                "reason": "tenant_not_resolved",
                "branch_name": getattr(branch, "name", None),
                "company_name": getattr(getattr(branch, "company", None), "name", None),
            }

        indicator = resolve_presence_indicator_source(branch=branch)
        if not indicator.get("url"):
            return {"captured": False, "branch_id": branch.id, "reason": "no_indicator_url"}

        try:
            reading = fetch_indicator_http_reading(indicator["url"], timeout=5)
        except requests.RequestException as exc:
            return {
                "captured": False,
                "branch_id": branch.id,
                "reason": "request_error",
                "error": str(exc),
                "source": indicator.get("source", "indicator"),
            }
        except Exception as exc:
            return {
                "captured": False,
                "branch_id": branch.id,
                "reason": "invalid_indicator_response",
                "error": str(exc),
                "source": indicator.get("source", "indicator"),
            }

        captured_weight = reading.get("weight")
        if captured_weight is None:
            return {
                "captured": False,
                "branch_id": branch.id,
                "reason": "no_weight",
                "threshold": int(cfg.threshold_kg),
                "source": indicator.get("source", "indicator"),
            }

        weight = int(round(float(captured_weight)))
        threshold = int(cfg.threshold_kg)
        if weight < threshold:
            return {
                "captured": False,
                "branch_id": branch.id,
                "reason": "below_threshold",
                "weight": weight,
                "threshold": threshold,
                "source": indicator.get("source", "indicator"),
            }

        if _recent_presence_exists(branch, weight, cfg.capture_interval_seconds):
            return {
                "captured": False,
                "branch_id": branch.id,
                "reason": "duplicate_recent",
                "weight": weight,
                "threshold": threshold,
                "capture_interval_seconds": int(cfg.capture_interval_seconds or 0),
                "source": indicator.get("source", "indicator"),
            }

        camera_config = (
            CameraConfig.objects.filter(branch=branch, is_active=True)
            .order_by("-capture_on_overweight", "id")
            .first()
        )
        image = _capture_camera_image(camera_config)

        presence = VehiclePresence.objects.create(
            tenant=tenant,
            branch=branch,
            detected_weight=weight,
            capture_status=False,
            plate_number=None,
            image=image,
        )
        event = maybe_record_overweight_event_from_presence(presence, camera_config=camera_config)
        if event is None:
            return {
                "captured": False,
                "branch_id": branch.id,
                "reason": "not_promoted",
                "weight": weight,
                "threshold": threshold,
                "source": indicator.get("source", "indicator"),
            }

        logger.info(
            "Captured vehicle presence for branch %s at %s kg via %s.",
            branch.id,
            weight,
            indicator.get("source", "indicator"),
        )
        return {
            "captured": True,
            "branch_id": branch.id,
            "weight": weight,
            "threshold": threshold,
            "capture_interval_seconds": int(cfg.capture_interval_seconds or 0),
            "source": indicator.get("source", "indicator"),
        }
    except Exception as exc:
        logger.exception("Vehicle presence capture failed for branch %s.", getattr(branch, "id", None))
        return {
            "captured": False,
            "branch_id": getattr(branch, "id", None),
            "reason": "unexpected_error",
            "error": str(exc),
            "technical_error": traceback.format_exc(limit=3),
        }


def poll_all_branches_once():
    results = []
    active_tenant_ids = set(
        get_tenants_with_active_module("weighbridge").values_list("id", flat=True)
    )
    branches = [cfg.branch for cfg in OverweightConfig.objects.select_related("branch").filter(surveillance_enabled=True)]
    for branch in branches:
        if branch is None:
            continue
        tenant = resolve_tenant_for_branch(branch)
        if tenant is None:
            results.append({
                "captured": False,
                "branch_id": branch.id,
                "reason": "tenant_not_resolved",
                "branch_name": getattr(branch, "name", None),
                "company_name": getattr(getattr(branch, "company", None), "name", None),
            })
            continue
        if tenant.id not in active_tenant_ids:
            results.append({
                "captured": False,
                "branch_id": branch.id,
                "tenant_id": tenant.id,
                "tenant_name": getattr(tenant, "name", None),
                "reason": "module_not_subscribed",
            })
            continue
        try:
            results.append(poll_branch_once(branch))
        except requests.RequestException as exc:
            logger.warning("Vehicle presence monitor request failed for branch %s: %s", branch.id, exc)
            results.append({"captured": False, "branch_id": branch.id, "reason": "request_error", "error": str(exc)})
        except Exception as exc:
            logger.exception("Vehicle presence monitor failed for branch %s.", branch.id)
            results.append({
                "captured": False,
                "branch_id": branch.id,
                "reason": "unexpected_error",
                "error": str(exc),
                "technical_error": traceback.format_exc(limit=3),
            })
    return results


def run_presence_loop(interval=None):
    sleep_seconds = interval or _presence_interval_seconds()
    logger.info(
        "Vehicle presence monitor started (interval=%ds). First poll in %ds.",
        sleep_seconds,
        sleep_seconds,
    )
    time.sleep(sleep_seconds)
    while True:
        poll_all_branches_once()
        time.sleep(sleep_seconds)
