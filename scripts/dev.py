#!/usr/bin/env python3
"""Start the local Django and Vite servers together; Ctrl+C stops owned processes."""
import argparse
import json
import os
from pathlib import Path
import signal
import socket
import subprocess
import sys
import time
from urllib.error import URLError
from urllib.request import ProxyHandler, build_opener

ROOT = Path(__file__).resolve().parents[1]
HTTP = build_opener(ProxyHandler({}))


def listening(port):
    try:
        with socket.create_connection(("127.0.0.1", port), timeout=0.3):
            return True
    except OSError:
        return False


def ready(service):
    try:
        with HTTP.open(service["probe"], timeout=3) as response:
            body = response.read(100_000).decode("utf-8")
        if service["name"] == "Backend":
            return json.loads(body).get("status") == "ok"
        return '<title>Business Workspace</title>' in body and "/@vite/client" in body
    except (OSError, URLError, ValueError):
        return False


def stop_children(children):
    # Every child has its own process group, including reloaders and pnpm workers.
    for _, process in children:
        try:
            os.killpg(process.pid, signal.SIGINT)
        except ProcessLookupError:
            pass
    deadline = time.monotonic() + 5
    while time.monotonic() < deadline and any(p.poll() is None for _, p in children):
        time.sleep(0.1)
    for _, process in children:
        try:
            os.killpg(process.pid, signal.SIGKILL)
        except ProcessLookupError:
            pass
        process.wait()


def interrupted(_signum, _frame):
    raise KeyboardInterrupt


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--backend-port", type=int, default=8080)
    parser.add_argument("--frontend-port", type=int, default=5173)
    args = parser.parse_args()
    if not all(1 <= port <= 65535 for port in (args.backend_port, args.frontend_port)):
        parser.error("Ports must be between 1 and 65535.")
    if args.backend_port == args.frontend_port:
        parser.error("Backend and frontend must use different ports.")

    for required in ("backend/.env", "artifacts/erp-ui/node_modules"):
        if not (ROOT / required).exists():
            print(f"Missing {required}. Complete docs/LOCAL_SETUP.md first.", file=sys.stderr)
            return 1

    backend_url = f"http://127.0.0.1:{args.backend_port}"
    frontend_url = f"http://127.0.0.1:{args.frontend_port}"
    services = [
        {
            "name": "Backend", "port": args.backend_port,
            "probe": backend_url + "/api/healthz",
            "command": [sys.executable, "manage.py", "runserver", f"0.0.0.0:{args.backend_port}"],
            "cwd": ROOT / "backend",
        },
        {
            "name": "Frontend", "port": args.frontend_port, "probe": frontend_url + "/",
            "command": ["bash", str(ROOT / "scripts/dev-frontend.sh")], "cwd": ROOT,
        },
    ]
    children = []
    signal.signal(signal.SIGTERM, interrupted)
    try:
        # Validate both ports before launching anything. Never stop existing servers.
        for service in services:
            service["reuse"] = listening(service["port"])
            if service["reuse"]:
                deadline = time.monotonic() + 5
                while not ready(service):
                    if time.monotonic() >= deadline:
                        raise RuntimeError(
                            f"{service['name']} port {service['port']} is occupied by an unrecognized "
                            "or unready service. Check that terminal or choose another port."
                        )
                    time.sleep(0.25)

        if not all(service["reuse"] for service in services):
            print("Checking database connection and applied migrations...", flush=True)
            result = subprocess.run(
                [sys.executable, "manage.py", "migrate", "--check"],
                cwd=ROOT / "backend",
            )
            if result.returncode:
                raise RuntimeError(
                    "Database check failed. Make sure your development database is running. "
                    "If migrations are pending, run .venv/bin/python backend/manage.py migrate "
                    "from the project root, then start again."
                )

        env = dict(os.environ, PYTHONUNBUFFERED="1", PORT=str(args.frontend_port),
                   VITE_API_BASE_URL=backend_url)
        for service in services:
            if service["reuse"]:
                print(f"{service['name']} is already running on port {service['port']}.", flush=True)
                continue
            print(f"Starting {service['name']}...", flush=True)
            process = subprocess.Popen(
                service["command"], cwd=service["cwd"], env=env, start_new_session=True,
            )
            children.append((service["name"], process))

        deadline = time.monotonic() + 60
        while not all(ready(service) for service in services):
            for name, process in children:
                if process.poll() is not None:
                    raise RuntimeError(f"{name} exited during startup. See its output above.")
            if time.monotonic() >= deadline:
                raise RuntimeError("Startup timed out. See the server output above.")
            time.sleep(0.5)

        print(f"\nSL-ERP ready: http://localhost:{args.frontend_port}", flush=True)
        print(f"Django admin: http://localhost:{args.backend_port}/admin/", flush=True)
        if not children:
            print("Both servers were already running; no duplicate processes started.", flush=True)
            return 0
        print("Press Ctrl+C to stop the servers started by this command.", flush=True)
        while True:
            for name, process in children:
                if process.poll() is not None:
                    raise RuntimeError(f"{name} exited. Stopping the other managed server.")
            time.sleep(0.5)
    except KeyboardInterrupt:
        print("\nStopping development servers...", flush=True)
        return 0
    except (OSError, RuntimeError) as error:
        print(f"Start failed: {error}", file=sys.stderr, flush=True)
        return 1
    finally:
        stop_children(children)


if __name__ == "__main__":
    raise SystemExit(main())
