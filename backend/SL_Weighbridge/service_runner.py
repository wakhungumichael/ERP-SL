import logging
import os
import socket
import time
from datetime import timedelta

from django.apps import apps
from django.db import transaction
from django.utils import timezone

logger = logging.getLogger(__name__)

SERVICE_NAME = "weighbridge-surveillance"
LEASE_SECONDS = int(os.environ.get("WEIGHBRIDGE_SERVICE_LEASE_SECONDS", "45"))
LOOP_SECONDS = int(os.environ.get("WEIGHBRIDGE_SERVICE_LOOP_SECONDS", "5"))
DEFAULT_PRESENCE_INTERVAL = int(os.environ.get("VEHICLE_PRESENCE_INTERVAL_SECONDS", "10"))
DEFAULT_SWEEP_INTERVAL = int(os.environ.get("DISCREPANCY_SWEEP_INTERVAL_SECONDS", str(10 * 60)))
_RUNNER_STATE = {
    "owner_id": None,
    "heartbeat_at": None,
    "lease_until": None,
    "last_presence_run_at": None,
    "last_presence_captured": 0,
    "last_presence_results": [],
    "last_sweep_run_at": None,
    "last_sweep_created": 0,
    "last_sweep_skipped": 0,
    "last_error_at": None,
    "last_error": None,
}


def _owner_id():
    return f"{socket.gethostname()}:{os.getpid()}"


def _get_background_service_lease_model():
    try:
        return apps.get_model("Platform_Core", "BackgroundServiceLease")
    except Exception:
        return None


def _touch_runner_state(*, owner=None, **updates):
    now = timezone.now()
    _RUNNER_STATE["owner_id"] = owner or _RUNNER_STATE.get("owner_id") or _owner_id()
    _RUNNER_STATE["heartbeat_at"] = now
    _RUNNER_STATE["lease_until"] = now + timedelta(seconds=LEASE_SECONDS)
    _RUNNER_STATE.update({key: value for key, value in updates.items() if value is not None})


def get_runner_status_snapshot():
    return dict(_RUNNER_STATE)


def acquire_or_renew_lease(service_name=SERVICE_NAME, *, owner=None, lease_seconds=LEASE_SECONDS):
    BackgroundServiceLease = _get_background_service_lease_model()
    _touch_runner_state(owner=owner or _owner_id())
    if BackgroundServiceLease is None:
        return True
    owner = owner or _owner_id()
    now = timezone.now()
    lease_until = now + timedelta(seconds=lease_seconds)

    with transaction.atomic():
        lease = (
            BackgroundServiceLease.objects.select_for_update()
            .filter(service_name=service_name)
            .first()
        )
        if lease is None:
            BackgroundServiceLease.objects.create(
                service_name=service_name,
                owner_id=owner,
                heartbeat_at=now,
                lease_until=lease_until,
                metadata={},
            )
            return True

        if lease.owner_id == owner or lease.lease_until is None or lease.lease_until <= now:
            lease.owner_id = owner
            lease.heartbeat_at = now
            lease.lease_until = lease_until
            lease.save(update_fields=["owner_id", "heartbeat_at", "lease_until", "updated_at"])
            return True

    return False


def update_lease_metadata(service_name=SERVICE_NAME, *, owner=None, **updates):
    BackgroundServiceLease = _get_background_service_lease_model()
    _touch_runner_state(owner=owner or _owner_id(), **updates)
    if BackgroundServiceLease is None:
        return
    owner = owner or _owner_id()
    lease = BackgroundServiceLease.objects.filter(service_name=service_name, owner_id=owner).first()
    if lease is None:
        return
    metadata = dict(lease.metadata or {})
    metadata.update(updates)
    lease.metadata = metadata
    lease.heartbeat_at = timezone.now()
    lease.lease_until = timezone.now() + timedelta(seconds=LEASE_SECONDS)
    lease.save(update_fields=["metadata", "heartbeat_at", "lease_until", "updated_at"])


def release_lease(service_name=SERVICE_NAME, *, owner=None):
    BackgroundServiceLease = _get_background_service_lease_model()
    _RUNNER_STATE["owner_id"] = owner or _RUNNER_STATE.get("owner_id") or _owner_id()
    _RUNNER_STATE["heartbeat_at"] = timezone.now()
    _RUNNER_STATE["lease_until"] = timezone.now()
    if BackgroundServiceLease is None:
        return
    owner = owner or _owner_id()
    now = timezone.now()
    BackgroundServiceLease.objects.filter(service_name=service_name, owner_id=owner).update(
        lease_until=now,
        heartbeat_at=now,
        updated_at=now,
    )


def run_surveillance_loop():
    owner = _owner_id()
    next_presence_at = timezone.now()
    next_sweep_at = timezone.now()
    announced = False

    while True:
        try:
            has_lease = acquire_or_renew_lease(owner=owner)
            if has_lease:
                if not announced:
                    logger.info(
                        "Weighbridge surveillance runner active as lease owner %s "
                        "(presence interval=%ss, sweep interval=%ss).",
                        owner,
                        DEFAULT_PRESENCE_INTERVAL,
                        DEFAULT_SWEEP_INTERVAL,
                    )
                    announced = True

                now = timezone.now()
                if now >= next_presence_at:
                    from SL_Weighbridge.presence_monitor import poll_all_branches_once

                    presence_results = poll_all_branches_once()
                    captured_count = sum(1 for row in presence_results if row.get("captured"))
                    update_lease_metadata(
                        owner=owner,
                        last_presence_run_at=now.isoformat(),
                        last_presence_captured=captured_count,
                        last_presence_results=presence_results[:10],
                    )
                    next_presence_at = now + timedelta(seconds=DEFAULT_PRESENCE_INTERVAL)

                if now >= next_sweep_at:
                    from SL_Weighbridge.sweep import run_sweep

                    result = run_sweep()
                    update_lease_metadata(
                        owner=owner,
                        last_sweep_run_at=now.isoformat(),
                        last_sweep_created=result["created"],
                        last_sweep_skipped=result["skipped"],
                    )
                    logger.info(
                        "Scheduled discrepancy sweep complete — %d raised, %d skipped.",
                        result["created"],
                        result["skipped"],
                    )
                    next_sweep_at = now + timedelta(seconds=DEFAULT_SWEEP_INTERVAL)
            else:
                announced = False
        except Exception:
            update_lease_metadata(
                owner=owner,
                last_error_at=timezone.now().isoformat(),
                last_error="Weighbridge surveillance runner encountered an error.",
            )
            logger.exception("Weighbridge surveillance runner encountered an error.")

        time.sleep(LOOP_SECONDS)
