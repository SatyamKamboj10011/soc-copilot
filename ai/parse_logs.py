import json
import pandas as pd

#Reading the Suricata Log file 
logs = []
with open('logs/eve.json', 'r') as f:
    for line in f:
        try:
            log = json.loads(line)
            logs.append({
                'time': log.get('timestamp'),
                'event': log.get('event_type'),
                'src_ip': log.get('src_ip'),
                'dst_ip' : log.get('dest_ip'),
                'alert': log.get('alert', {}).get('signature', 'N/A')

            })
        except:
            pass

#Showing the results
df = pd.DataFrame(logs)
print(df.head(20))
print(f'Total events: {len(df)}')

# Show event type breakdown
print("\nEvent Types:")
print(df['event'].value_counts())

# Show unique IPs
print("\nUnique Source IPs:")
print(df['src_ip'].value_counts().head(10))

# Reading Zeek conn.log
zeek_logs = []
try:
    with open('../logs/conn.log', 'r') as f:
        for line in f:
            if line.startswith("#"):
                continue
            parts = line.strip().split("\t")
            if len(parts) < 10:
                continue
            zeek_logs.append({
                'time':     parts[0],
                'src_ip':   parts[2] if len(parts) > 2 else 'N/A',
                'src_port': parts[3] if len(parts) > 3 else 'N/A',
                'dst_ip':   parts[4] if len(parts) > 4 else 'N/A',
                'dst_port': parts[5] if len(parts) > 5 else 'N/A',
                'proto':    parts[6] if len(parts) > 6 else 'N/A',
                'duration': parts[8] if len(parts) > 8 else 'N/A',
                'bytes':    parts[9] if len(parts) > 9 else 'N/A',
            })
except FileNotFoundError:
    print("conn.log not found")

zeek_df = pd.DataFrame(zeek_logs)
print("\n=== ZEEK CONNECTION LOGS ===")
print(zeek_df.head(20))
print(f"Total Zeek connections: {len(zeek_df)}")
print("\nTop source IPs in Zeek:")
print(zeek_df['src_ip'].value_counts().head(10))