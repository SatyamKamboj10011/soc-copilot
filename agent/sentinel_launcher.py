"""
SIRA Sentinel Agent -- headless endpoint monitor.

Reports process/connection telemetry to the SIRA backend every
REPORT_INTERVAL_SECONDS. Server address is a Tailscale IP (or
127.0.0.1 for same-machine setups) -- stable regardless of wifi,
so no local-subnet scanning is needed.
"""

import json
import logging
import os
import platform
import socket
import sys
import time

import psutil
import requests

CONFIG_FILE = os.path.join(os.path.dirname(os.path.abspath(__file__)), "sentinel_config.json")
REPORT_INTERVAL_SECONDS = 60
REQUEST_TIMEOUT_SECONDS = 5

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [sentinel] %(message)s",
    datefmt="%Y-%m-%d %H:%M:%S",
)
log = logging.getLogger("sentinel")


def load_config():
    config = {
        "server": os.environ.get("SIRA_SERVER", "http://127.0.0.1:5000"),
        "agent_key": os.environ.get("SIRA_AGENT_KEY", ""),
        "machine_id": os.environ.get("SIRA_MACHINE_ID", socket.gethostname()),
    }
    if os.path.exists(CONFIG_FILE):
        with open(CONFIG_FILE) as f:
            config.update({k: v for k, v in json.load(f).items() if v})
    return config


def check_server(server):
    try:
        requests.get(f"{server}/health", timeout=REQUEST_TIMEOUT_SECONDS)
        return True
    except requests.exceptions.RequestException:
        return False


def collect_snapshot():
    connections = []
    for c in psutil.net_connections(kind="inet"):
        if c.status == "ESTABLISHED" and c.raddr:
            connections.append({"local": str(c.laddr), "remote": str(c.raddr)})

    processes = []
    for p in psutil.process_iter(["pid", "name", "cpu_percent"]):
        try:
            if p.info["cpu_percent"] and p.info["cpu_percent"] > 1:
                processes.append(p.info)
        except (psutil.NoSuchProcess, psutil.AccessDenied):
            continue
    return connections, processes


def build_payload(connections, processes):
    return {
        "timestamp": time.strftime("%Y-%m-%dT%H:%M:%S"),
        "platform": platform.system(),
        "local_ip": socket.gethostbyname(socket.gethostname()),
        "connections": connections[:20],
        "processes": processes[:10],
        "connection_count": len(connections),
    }


def send_report(server, agent_key, machine_id, payload):
    headers = {"Authorization": f"Bearer {agent_key}"} if agent_key else {}
    return requests.post(
        f"{server}/ingest/{machine_id}",
        json=payload, headers=headers, timeout=REQUEST_TIMEOUT_SECONDS,
    )


def run():
    config = load_config()
    server = config["server"]
    log.info(f"Starting Sentinel agent '{config['machine_id']}' -> {server}")
    if not config["agent_key"]:
        log.warning("No SIRA_AGENT_KEY set -- reports will be unauthenticated.")

    while True:
        # Re-read config each cycle -- picks up a frontend/manual IP
        # change (e.g. moving to a new Tailscale node) without restart.
        config = load_config()
        if config["server"] != server:
            log.info(f"Config changed -- switching to {config['server']}")
            server = config["server"]

        try:
            connections, processes = collect_snapshot()
            payload = build_payload(connections, processes)
            r = send_report(server, config["agent_key"], config["machine_id"], payload)
            if r.status_code == 200:
                log.info(f"Reported {len(connections)} connections, {len(processes)} active processes")
            else:
                log.warning(f"Server responded {r.status_code}: {r.text[:200]}")
        except requests.exceptions.RequestException as exc:
            log.warning(f"Could not reach {server}: {exc}")
        except Exception as exc:
            log.error(f"Unexpected error: {exc}")

        time.sleep(REPORT_INTERVAL_SECONDS)


if __name__ == "__main__":
    try:
        run()
    except KeyboardInterrupt:
        log.info("Sentinel agent stopped")
        sys.exit(0)