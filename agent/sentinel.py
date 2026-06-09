import psutil
import socket
import json
import time
import requests
import platform
import subprocess
from datetime import datetime

SIRA_SERVER = "http://10.134.30.240"  # change to your machine IP e.g. http://192.168.1.5:5000
MACHINE_ID  = socket.gethostname()
INTERVAL    = 60  # seconds between sends

def get_local_ip():
    try:
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        s.connect(("8.8.8.8", 80))
        ip = s.getsockname()[0]
        s.close()
        return ip
    except:
        return "unknown"

def collect_network_connections():
    connections = []
    try:
        for conn in psutil.net_connections(kind='inet'):
            try:
                if conn.raddr:
                    connections.append({
                        "src_ip":    conn.laddr.ip if conn.laddr else "",
                        "src_port":  conn.laddr.port if conn.laddr else 0,
                        "dest_ip":   conn.raddr.ip,
                        "dest_port": conn.raddr.port,
                        "status":    conn.status,
                        "pid":       conn.pid
                    })
            except:
                pass
    except Exception as e:
        print(f"Network error: {e}")
    return connections

def collect_processes():
    procs = []
    try:
        for p in psutil.process_iter(['pid', 'name', 'cpu_percent', 'memory_percent']):
            try:
                procs.append({
                    "pid":    p.info['pid'],
                    "name":   p.info['name'],
                    "cpu":    p.info['cpu_percent'],
                    "memory": p.info['memory_percent']
                })
            except:
                pass
    except Exception as e:
        print(f"Process error: {e}")
    return procs[:50]  # top 50 only

def collect_windows_events():
    events = []
    if platform.system() != "Windows":
        return events
    try:
        result = subprocess.run(
            ['wevtutil', 'qe', 'Security', '/c:20', '/rd:true', '/f:text'],
            capture_output=True, text=True, timeout=10
        )
        lines = result.stdout.split('\n')
        current = {}
        for line in lines:
            line = line.strip()
            if 'Event ID' in line:
                if current:
                    events.append(current)
                current = {"event_id": line}
            elif 'Account Name' in line:
                current["account"] = line
            elif 'Source Network Address' in line:
                current["src_ip"] = line
            elif 'Logon Type' in line:
                current["logon_type"] = line
        if current:
            events.append(current)
    except Exception as e:
        print(f"Event log error: {e}")
    return events[:20]

def check_suspicious(connections):
    suspicious_ports = [22, 23, 3389, 445, 1433, 3306, 4444, 5900]
    suspicious = []
    for conn in connections:
        if conn.get("dest_port") in suspicious_ports:
            suspicious.append(conn)
    return suspicious

def block_ip(ip):
    """Block an IP using Windows Firewall"""
    try:
        subprocess.run([
            'netsh', 'advfirewall', 'firewall', 'add', 'rule',
            f'name=SIRA_BLOCK_{ip}',
            'dir=in', 'action=block',
            f'remoteip={ip}'
        ], capture_output=True, timeout=10)
        print(f"[SENTINEL] Blocked IP: {ip}")
    except Exception as e:
        print(f"[SENTINEL] Block failed: {e}")

def send_to_sira(data):
    try:
        res = requests.post(
            f"{SIRA_SERVER}/ingest/{MACHINE_ID}",
            json=data,
            timeout=10
        )
        response = res.json()

        # Execute any commands sent back from SIRA
        commands = response.get("commands", [])
        for cmd in commands:
            if cmd["action"] == "block_ip":
                block_ip(cmd["ip"])
            elif cmd["action"] == "alert":
                print(f"[SIRA ALERT] {cmd['message']}")

        print(f"[{datetime.now().strftime('%H:%M:%S')}] Sent to SIRA — {len(data['connections'])} connections, {len(data['processes'])} processes")

    except requests.exceptions.ConnectionError:
        print(f"[{datetime.now().strftime('%H:%M:%S')}] Cannot reach SIRA server at {SIRA_SERVER}")
    except Exception as e:
        print(f"[{datetime.now().strftime('%H:%M:%S')}] Error: {e}")

def run():
    print("=" * 50)
    print("  SIRA SENTINEL AGENT")
    print(f"  Machine: {MACHINE_ID}")
    print(f"  Local IP: {get_local_ip()}")
    print(f"  Server: {SIRA_SERVER}")
    print(f"  Interval: {INTERVAL}s")
    print("=" * 50)

    while True:
        connections = collect_network_connections()
        suspicious  = check_suspicious(connections)

        data = {
            "machine_id":  MACHINE_ID,
            "platform":    platform.system(),
            "local_ip":    get_local_ip(),
            "timestamp":   datetime.utcnow().isoformat(),
            "connections": connections,
            "processes":   collect_processes(),
            "events":      collect_windows_events(),
            "suspicious":  suspicious,
            "alert":       len(suspicious) > 0
        }

        send_to_sira(data)
        time.sleep(INTERVAL)

if __name__ == "__main__":
    run()