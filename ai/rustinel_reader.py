"""
Rustinel alert reader -- parses the ECS NDJSON alert files Rustinel writes
locally (logs/alerts.json.<date>) into a normalized list Flask/Hermes can
use, the same way eve.json is parsed for honeypot data.

Rustinel runs on the SAME machine as this backend (unlike the honeypot,
which needs the SFTP sync) -- it's local endpoint detection, so this just
reads a local file directly, no network transfer involved.

Confirmed real ECS field names, from Rustinel's own documented example:
    @timestamp, event.kind, event.category, event.action,
    rule.name, rule.id, edr.rule.severity, edr.rule.engine, host.os.type

Other ECS fields (host.name, process.name, etc.) are read defensively with
.get() fallbacks, since only the fields above are confirmed from Rustinel's
own docs -- everything else follows the general ECS standard but isn't
guaranteed present on every alert type.
"""

import os
import glob
import json

# Configurable since Rustinel's install location depends on where the
# person extracted/ran it -- same pattern as HONEYPOT_HOST etc. in
# honeypot_log_sync.py, overridable without editing code.
RUSTINEL_LOGS_DIR = os.getenv(
    "RUSTINEL_LOGS_DIR",
    os.path.join(os.path.dirname(__file__), "..", "rustinel", "logs"),
)

MAX_CACHED_ALERTS = 500  # bounded, matching the project's lightweight-by-default approach

_alerts_cache = {"dir_listing": None, "data": None}


def _find_alert_files():
    pattern = os.path.join(RUSTINEL_LOGS_DIR, "alerts.json.*")
    return sorted(glob.glob(pattern))


def _parse_alert_line(line):
    try:
        raw = json.loads(line)
    except (json.JSONDecodeError, ValueError):
        return None

    # IMPORTANT: Rustinel's actual ECS output uses FLAT keys that contain
    # literal dots (e.g. the real key is the single string "rule.name"),
    # NOT nested JSON objects ({"rule": {"name": ...}}). Confirmed against
    # a real captured alert -- a nested-traversal parser here would
    # silently return blank fields for everything despite the data being
    # present, since d["rule"]["name"] doesn't exist when the real key is
    # d["rule.name"]. Plain .get() on the flat key is what's actually needed.
    return {
        "timestamp": raw.get("@timestamp", ""),
        "rule_name": raw.get("rule.name", "Unknown rule"),
        "rule_id": raw.get("rule.id", ""),
        "rule_description": raw.get("rule.description", ""),
        "severity": raw.get("edr.rule.severity", "Unknown"),
        "engine": raw.get("edr.rule.engine", "Unknown"),  # Sigma / YARA / IOC
        "event_action": raw.get("event.action", ""),
        "event_category": raw.get("event.category", []),
        "host_os": raw.get("host.os.type", ""),
        "host_name": raw.get("host.name", raw.get("host.hostname", "")),
        "process_name": raw.get("process.name", ""),
        "process_pid": raw.get("process.pid", ""),
        "process_command_line": raw.get("process.command_line", ""),
        "process_parent_name": raw.get("process.parent.name", ""),
    }


def load_rustinel_alerts():
    """Returns the most recent Rustinel alerts, most-recent-first, bounded
    to MAX_CACHED_ALERTS. Cached against the alert directory's file listing
    so repeated calls between actual new alerts don't re-parse everything."""
    files = _find_alert_files()
    listing_key = tuple((f, os.path.getmtime(f)) for f in files) if files else ()

    if _alerts_cache["data"] is not None and _alerts_cache["dir_listing"] == listing_key:
        return _alerts_cache["data"]

    alerts = []
    for path in files:
        try:
            with open(path, "r") as f:
                for line in f:
                    line = line.strip()
                    if not line:
                        continue
                    parsed = _parse_alert_line(line)
                    if parsed:
                        alerts.append(parsed)
        except (FileNotFoundError, OSError):
            continue

    # Most recent alerts matter most -- same recency-over-completeness
    # approach used for eve.json.
    alerts.sort(key=lambda a: a.get("timestamp", ""), reverse=True)
    alerts = alerts[:MAX_CACHED_ALERTS]

    _alerts_cache["dir_listing"] = listing_key
    _alerts_cache["data"] = alerts
    return alerts