import logging
import os
import threading
import time

from django.apps import AppConfig

logger = logging.getLogger(__name__)

# How often the in-process scheduler runs the sweep (seconds).
# Override via DISCREPANCY_SWEEP_INTERVAL_SECONDS env var.
_DEFAULT_SWEEP_INTERVAL = 10 * 60  # 10 minutes


def _sweep_loop(interval: int) -> None:
    """
    Background daemon thread: run the discrepancy sweep every *interval* seconds.

    Starts with an initial delay equal to *interval* so the first sweep happens
    after the server has fully started up rather than immediately on boot.
    Exceptions inside run_sweep are caught and logged so the thread never dies.
    """
    from SL_Weighbridge.sweep import run_sweep

    logger.info(
        "Discrepancy sweep scheduler started (interval=%ds). "
        "First sweep in %ds.",
        interval,
        interval,
    )
    time.sleep(interval)  # wait for the server to settle before first run

    while True:
        try:
            result = run_sweep()
            logger.info(
                "Scheduled discrepancy sweep complete — "
                "%d raised, %d skipped.",
                result["created"],
                result["skipped"],
            )
        except Exception:
            logger.exception("Scheduled discrepancy sweep encountered an error.")

        time.sleep(interval)


class SlWeighbridgeConfig(AppConfig):
    default_auto_field = 'django.db.models.BigAutoField'
    name = 'SL_Weighbridge'

    def ready(self):
        """
        Start the background sweep scheduler when Django boots.

        Guards:
        1. Only runs in server processes (runserver, gunicorn, uvicorn, wsgi/asgi).
           Skipped for migrate, shell, collectstatic, etc.
        2. When using Django's auto-reloader (manage.py runserver), the reloader
           forks two processes and both call ready().  RUN_MAIN is set to "true"
           only in the *child* (the live server process).  We start the thread
           only in the child so it is not double-started and survives hot-reloads.
        3. In production (gunicorn/uvicorn), RUN_MAIN is never set, so we start
           unconditionally once _is_management_server() is satisfied.
        """
        if not _is_management_server():
            # Not a web-server command (e.g. migrate, shell) — skip entirely.
            return

        import sys
        argv = sys.argv
        is_runserver = len(argv) >= 2 and argv[1] == "runserver"

        if is_runserver and os.environ.get("RUN_MAIN") != "true":
            # Parent reloader process — the child will start the thread.
            return

        interval = int(
            os.environ.get("DISCREPANCY_SWEEP_INTERVAL_SECONDS", _DEFAULT_SWEEP_INTERVAL)
        )
        t = threading.Thread(
            target=_sweep_loop,
            args=(interval,),
            name="discrepancy-sweep",
            daemon=True,
        )
        t.start()


def _is_management_server():
    """
    Return True when Django is being started as a web server (runserver or
    gunicorn/uvicorn), so the sweep thread is only launched in the real server
    process and never during migrate, shell, test, etc.
    """
    import sys
    argv = sys.argv
    if not argv:
        return False
    cmd = argv[0]
    # Invoked directly: manage.py runserver
    if len(argv) >= 2 and argv[1] in ("runserver", "gunicorn", "uvicorn"):
        return True
    # Invoked as a module: python -m gunicorn / uvicorn
    if "gunicorn" in cmd or "uvicorn" in cmd:
        return True
    # WSGI/ASGI entry points (production server imported the app module)
    if "wsgi" in cmd or "asgi" in cmd:
        return True
    return False
