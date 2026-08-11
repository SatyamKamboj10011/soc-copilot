"""
Honeypot log sync -- pulls eve.json (Suricata) and conn.log (Zeek) from the
public-facing Azure honeypot VM via SFTP, polling every 15 seconds. Only
downloads when the remote file's size has changed since the last poll, so
idle periods don't cause constant re-transfer of an unchanged file.

Designed to run as a background daemon thread started once from app.py at
Flask startup (see start_background_sync()), but can also be run standalone
for testing:

    python ai/honeypot_log_sync.py

Connection details default to the values used throughout this project's
setup, but can be overridden via environment variables without editing code:

    HONEYPOT_HOST      (default: 13.70.108.223)
    HONEYPOT_USER      (default: sirauser)
    HONEYPOT_KEY_PATH  (default: ~/.ssh/sira_honeypot)
"""

import os
import time
import threading

import paramiko

HONEYPOT_HOST = os.getenv("HONEYPOT_HOST", "13.70.108.223")
HONEYPOT_USER = os.getenv("HONEYPOT_USER", "sirauser")
HONEYPOT_KEY_PATH = os.getenv("HONEYPOT_KEY_PATH", os.path.expanduser("~/.ssh/sira_honeypot"))

# Suricata's eve.json lives at the standard system path; Zeek (installed via
# the openSUSE OBS package) writes conn.log under its own spool directory.
REMOTE_EVE_JSON = "/var/log/suricata/eve.json"
REMOTE_CONN_LOG = "/opt/zeek/spool/zeek/conn.log"

LOCAL_LOGS_DIR = os.path.join(os.path.dirname(__file__), "..", "logs")
LOCAL_EVE_JSON = os.path.join(LOCAL_LOGS_DIR, "eve.json")
LOCAL_CONN_LOG = os.path.join(LOCAL_LOGS_DIR, "conn.log")

POLL_INTERVAL_SECONDS = 15

# Tracks the last-seen remote file size per path, across polls, so we can
# skip re-downloading a file that hasn't changed.
_last_sizes = {}


def _connect():
    client = paramiko.SSHClient()
    client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    client.connect(
        hostname=HONEYPOT_HOST,
        username=HONEYPOT_USER,
        key_filename=HONEYPOT_KEY_PATH,
        timeout=10,
    )
    return client


def _sync_once(sftp):
    os.makedirs(LOCAL_LOGS_DIR, exist_ok=True)

    for remote_path, local_path in (
        (REMOTE_EVE_JSON, LOCAL_EVE_JSON),
        (REMOTE_CONN_LOG, LOCAL_CONN_LOG),
    ):
        try:
            remote_size = sftp.stat(remote_path).st_size
        except FileNotFoundError:
            print(f"[honeypot_log_sync] remote file not found yet: {remote_path}")
            continue
        except Exception as e:
            print(f"[honeypot_log_sync] stat failed for {remote_path}: {e}")
            continue

        if _last_sizes.get(remote_path) == remote_size:
            continue  # unchanged since last poll -- skip transfer

        try:
            sftp.get(remote_path, local_path)
            _last_sizes[remote_path] = remote_size
            print(f"[honeypot_log_sync] pulled {os.path.basename(remote_path)} ({remote_size} bytes)")
        except Exception as e:
            print(f"[honeypot_log_sync] transfer failed for {remote_path}: {e}")


def _run_loop():
    client = None
    sftp = None
    while True:
        try:
            if client is None:
                client = _connect()
                sftp = client.open_sftp()
                print(f"[honeypot_log_sync] connected to {HONEYPOT_HOST}")
            _sync_once(sftp)
        except Exception as e:
            print(f"[honeypot_log_sync] connection error: {e} -- reconnecting next cycle")
            try:
                if client:
                    client.close()
            except Exception:
                pass
            client = None
            sftp = None
        time.sleep(POLL_INTERVAL_SECONDS)


def start_background_sync():
    """Call once from app.py at Flask startup to run the sync as a daemon thread."""
    thread = threading.Thread(target=_run_loop, daemon=True, name="honeypot-log-sync")
    thread.start()
    print(f"[honeypot_log_sync] started -- polling {HONEYPOT_HOST} every {POLL_INTERVAL_SECONDS}s")
    return thread


if __name__ == "__main__":
    # Standalone test mode: run the loop directly (blocking) so you can watch
    # it work before wiring it into Flask.
    print("[honeypot_log_sync] standalone mode -- Ctrl+C to stop")
    _run_loop()