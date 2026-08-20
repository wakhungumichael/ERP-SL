import logging
import os
import threading
from django.apps import AppConfig

logger = logging.getLogger(__name__)


class SlWeighbridgeConfig(AppConfig):
    default_auto_field = 'django.db.models.BigAutoField'
    name = 'SL_Weighbridge'
    sl_module_definition = {
        "slug": "weighbridge",
        "name": "Commercial Weighbridge",
        "category": "vertical",
        "is_core": True,
        "description": "Weight ticket capture, transaction management, and live scale integration.",
    }

    def ready(self):
        """
        Start the coordinated weighbridge surveillance runner when Django boots.

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

        t = threading.Thread(
            target=_start_surveillance_runner,
            name="weighbridge-surveillance",
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


def _start_surveillance_runner():
    from SL_Weighbridge.service_runner import run_surveillance_loop

    run_surveillance_loop()
