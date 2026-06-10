import tkinter as tk
from tkinter import ttk
import json, os, threading, requests, time, subprocess, sys

CONFIG_FILE = os.path.join(os.path.dirname(__file__), "sentinel_config.json")

def load_config():
    if os.path.exists(CONFIG_FILE):
        with open(CONFIG_FILE) as f:
            return json.load(f)
    return {"server": "http://10.33.4.64:5000"}

def save_config(server):
    with open(CONFIG_FILE, "w") as f:
        json.dump({"server": server}, f)

class SentinelLauncher:
    def __init__(self, root):
        self.root = root
        self.root.title("SIRA Sentinel")
        self.root.geometry("420x420")
        self.root.configure(bg="#080c12")
        self.root.resizable(False, False)
        self.running = False
        self.sentinel_thread = None
        self.config = load_config()
        self.build_ui()

    def build_ui(self):
        # Header
        header = tk.Frame(self.root, bg="#0f1520", pady=12)
        header.pack(fill="x")
        tk.Label(header, text="⬡  SIRA SENTINEL", font=("Courier", 13, "bold"),
                 bg="#0f1520", fg="#00e5ff").pack()
        tk.Label(header, text="Endpoint Detection Agent", font=("Courier", 8),
                 bg="#0f1520", fg="#3d4f63").pack()

        # Status indicator
        self.status_frame = tk.Frame(self.root, bg="#080c12", pady=8)
        self.status_frame.pack(fill="x", padx=20)
        self.status_dot = tk.Label(self.status_frame, text="●", font=("Courier", 14),
                                    bg="#080c12", fg="#3d4f63")
        self.status_dot.pack(side="left")
        self.status_label = tk.Label(self.status_frame, text="OFFLINE",
                                      font=("Courier", 9, "bold"),
                                      bg="#080c12", fg="#3d4f63")
        self.status_label.pack(side="left", padx=6)

        # Server URL
        url_frame = tk.Frame(self.root, bg="#080c12")
        url_frame.pack(fill="x", padx=20, pady=4)
        tk.Label(url_frame, text="SIRA SERVER URL", font=("Courier", 8),
                 bg="#080c12", fg="#3d4f63").pack(anchor="w")
        self.url_var = tk.StringVar(value=self.config.get("server",""))
        url_entry = tk.Entry(url_frame, textvariable=self.url_var,
                             font=("Courier", 10), bg="#0f1520", fg="#00e5ff",
                             insertbackground="#00e5ff", relief="flat",
                             highlightthickness=1, highlightcolor="#00e5ff",
                             highlightbackground="#1a2535")
        url_entry.pack(fill="x", ipady=6)

        # Machine ID
        mid_frame = tk.Frame(self.root, bg="#080c12")
        mid_frame.pack(fill="x", padx=20, pady=4)
        tk.Label(mid_frame, text="MACHINE ID", font=("Courier", 8),
                 bg="#080c12", fg="#3d4f63").pack(anchor="w")
        import socket
        self.mid_var = tk.StringVar(value=socket.gethostname())
        mid_entry = tk.Entry(mid_frame, textvariable=self.mid_var,
                             font=("Courier", 10), bg="#0f1520", fg="#7a8fa6",
                             insertbackground="#00e5ff", relief="flat",
                             highlightthickness=1, highlightcolor="#00e5ff",
                             highlightbackground="#1a2535")
        mid_entry.pack(fill="x", ipady=6)

        # Log box
        log_frame = tk.Frame(self.root, bg="#080c12")
        log_frame.pack(fill="x", padx=20, pady=8)
        self.log = tk.Text(log_frame, height=4, font=("Courier", 8),
                           bg="#0a0f18", fg="#3d4f63", relief="flat",
                           state="disabled", wrap="word")
        self.log.pack(fill="x")

        # Buttons
        btn_frame = tk.Frame(self.root, bg="#080c12")
        btn_frame.pack(fill="x", padx=20, pady=6)
        self.start_btn = tk.Button(btn_frame, text="▶  START SENTINEL",
                                    font=("Courier", 9, "bold"),
                                    bg="#00e5ff", fg="#080c12",
                                    relief="flat", padx=12, pady=6,
                                    cursor="hand2", command=self.toggle)
        self.start_btn.pack(side="left", fill="x", expand=True, padx=(0,4))
        tk.Button(btn_frame, text="SAVE URL",
                  font=("Courier", 9), bg="#0f1520", fg="#7a8fa6",
                  relief="flat", padx=12, pady=6, cursor="hand2",
                  command=self.save_url).pack(side="left")

    def log_msg(self, msg, color="#7a8fa6"):
        self.log.configure(state="normal")
        self.log.insert("end", f"▸ {msg}\n")
        self.log.configure(state="disabled")
        self.log.see("end")

    def save_url(self):
        save_config(self.url_var.get().strip())
        self.log_msg("Config saved", "#00ff9d")

    def toggle(self):
        if self.running:
            self.running = False
            self.status_dot.config(fg="#3d4f63")
            self.status_label.config(text="OFFLINE", fg="#3d4f63")
            self.start_btn.config(text="▶  START SENTINEL", bg="#00e5ff", fg="#080c12")
            self.log_msg("Sentinel stopped", "#ff3d5a")
        else:
            save_config(self.url_var.get().strip())
            self.running = True
            self.status_dot.config(fg="#00ff9d")
            self.status_label.config(text="ONLINE — MONITORING", fg="#00ff9d")
            self.start_btn.config(text="■  STOP SENTINEL", bg="#ff3d5a", fg="white")
            self.log_msg("Sentinel started", "#00ff9d")
            self.log_msg(f"Reporting to {self.url_var.get()}", "#00e5ff")
            self.sentinel_thread = threading.Thread(target=self.run_sentinel, daemon=True)
            self.sentinel_thread.start()

    def run_sentinel(self):
        import platform, psutil, socket
        machine_id = self.mid_var.get().strip()
        server = self.url_var.get().strip()
        while self.running:
            try:
                connections = []
                for c in psutil.net_connections(kind="inet"):
                    if c.status == "ESTABLISHED" and c.raddr:
                        connections.append({"local":str(c.laddr),"remote":str(c.raddr)})

                processes = []
                for p in psutil.process_iter(["pid","name","cpu_percent"]):
                    try:
                        if p.info["cpu_percent"] > 1:
                            processes.append(p.info)
                    except: pass

                suspicious = [c for c in connections if c["remote"].split(":")[0] not in
                              ["127.0.0.1","0.0.0.0","::1"]]

                payload = {
                    "secret": "sira-sentinel-2026",
                    "timestamp": time.strftime("%Y-%m-%dT%H:%M:%S"),
                    "platform": platform.system(),
                    "local_ip": socket.gethostbyname(socket.gethostname()),
                    "connections": connections[:20],
                    "processes": processes[:10],
                    "suspicious": suspicious[:10],
                    "alert": len(suspicious) > 5
                }

                r = requests.post(f"{server}/ingest/{machine_id}",
                                  json=payload, timeout=5)
                if r.status_code == 200:
                    self.root.after(0, self.log_msg,
                                   f"Sent {len(connections)} connections", "#00e5ff")
                else:
                    self.root.after(0, self.log_msg, f"Server error {r.status_code}", "#ff3d5a")
            except Exception as e:
                self.root.after(0, self.log_msg, f"Error: {str(e)[:40]}", "#ff3d5a")
            time.sleep(60)

if __name__ == "__main__":
    root = tk.Tk()
    app = SentinelLauncher(root)
    root.mainloop()