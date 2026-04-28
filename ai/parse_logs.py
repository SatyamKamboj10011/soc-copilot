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