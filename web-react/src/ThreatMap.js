import { useEffect, useState } from "react";
import { MapContainer, TileLayer, CircleMarker, Popup, Polyline } from "react-leaflet";

const FLASK_URL = "http://localhost:5000";
const NZ_COORDS = [-36.8485, 174.7633]; // Auckland — your server location

export default function ThreatMap() {
  const [attackers, setAttackers] = useState([]);
  const [loading, setLoading]     = useState(true);

  useEffect(() => {
    const fetchAttackers = async () => {
      try {
        const res  = await fetch(`${FLASK_URL}/top-ips?limit=15`);
        const ips  = await res.json();

        const geoResults = await Promise.allSettled(
          ips.map(async ({ ip, count }) => {
            try {
              const r    = await fetch(`http://ip-api.com/json/${ip}?fields=status,lat,lon,country,city,isp`);
              const data = await r.json();
              if (data.status === "success") {
                return { ip, count, lat: data.lat, lon: data.lon, country: data.country, city: data.city, isp: data.isp };
              }
            } catch {}
            return null;
          })
        );

        const valid = geoResults
          .filter(r => r.status === "fulfilled" && r.value)
          .map(r => r.value);

        setAttackers(valid);
      } catch {}
      setLoading(false);
    };
    fetchAttackers();
  }, []);

  const maxCount = attackers.length > 0 ? Math.max(...attackers.map(a => a.count)) : 1;

  return (
  <div style={{ width:"100%", height:"100%", position:"relative" }}
    key="threatmap">
      {loading && (
        <div style={{
          position: "absolute", inset: 0, zIndex: 1000,
          display: "flex", alignItems: "center", justifyContent: "center",
          background: "rgba(8,12,18,0.8)", fontFamily: "var(--mono)",
          fontSize: 11, color: "var(--accent)", letterSpacing: 2
        }}>
          ◈ LOADING THREAT MAP...
        </div>
      )}

      <MapContainer
        center={[20, 0]}
        zoom={2}
        style={{ width: "100%", height: "100%", background: "#080c12" }}
        zoomControl={false}
        attributionControl={false}
      >
        <TileLayer
          url="https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png"
          attribution=""
        />

        {/* Auckland server marker */}
        <CircleMarker
          center={NZ_COORDS}
          radius={10}
          pathOptions={{ color: "#00e5ff", fillColor: "#00e5ff", fillOpacity: 0.8, weight: 2 }}
        >
          <Popup>
            <div style={{ fontFamily: "monospace", fontSize: 11, color: "#00e5ff", background: "#080c12", padding: 8, borderRadius: 4 }}>
              <strong>SIRA SERVER</strong><br/>
              Auckland, New Zealand<br/>
              SOC Copilot v4
            </div>
          </Popup>
        </CircleMarker>

        {/* Attacker markers + lines */}
        {attackers.map((a, i) => {
          const size      = 4 + (a.count / maxCount) * 14;
          const opacity   = 0.5 + (a.count / maxCount) * 0.5;
          const color     = a.count > maxCount * 0.7 ? "#ff3d5a" : a.count > maxCount * 0.3 ? "#ffaa00" : "#b47cff";

          return (
            <div key={i}>
              <Polyline
                positions={[[a.lat, a.lon], NZ_COORDS]}
                pathOptions={{ color, weight: 1, opacity: 0.3, dashArray: "4 6" }}
              />
              <CircleMarker
                center={[a.lat, a.lon]}
                radius={size}
                pathOptions={{ color, fillColor: color, fillOpacity: opacity, weight: 1 }}
              >
                <Popup>
                  <div style={{ fontFamily: "monospace", fontSize: 11, background: "#080c12", color: "#e8f0fe", padding: 8, borderRadius: 4, minWidth: 160 }}>
                    <div style={{ color, fontWeight: 700, marginBottom: 4 }}>{a.ip}</div>
                    <div>{a.city}, {a.country}</div>
                    <div style={{ color: "#7a8fa6", fontSize: 10, marginTop: 4 }}>{a.isp}</div>
                    <div style={{ color, marginTop: 6, fontWeight: 700 }}>{a.count} attacks</div>
                  </div>
                </Popup>
              </CircleMarker>
            </div>
          );
        })}
      </MapContainer>

      {/* Legend */}
      <div style={{
        position: "absolute", bottom: 16, left: 16, zIndex: 1000,
        background: "rgba(8,12,18,0.9)", border: "1px solid rgba(0,229,255,0.2)",
        borderRadius: 6, padding: "10px 14px", fontFamily: "var(--mono)", fontSize: 9
      }}>
        <div style={{ color: "var(--accent)", letterSpacing: 2, marginBottom: 8 }}>THREAT ORIGINS</div>
        {[
          { color: "#ff3d5a", label: "HIGH ACTIVITY" },
          { color: "#ffaa00", label: "MEDIUM ACTIVITY" },
          { color: "#b47cff", label: "LOW ACTIVITY" },
          { color: "#00e5ff", label: "SIRA SERVER (NZ)" },
        ].map((item, i) => (
          <div key={i} style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
            <div style={{ width: 8, height: 8, borderRadius: "50%", background: item.color, boxShadow: `0 0 6px ${item.color}` }} />
            <span style={{ color: "var(--text-dim)", letterSpacing: 1 }}>{item.label}</span>
          </div>
        ))}
        <div style={{ color: "var(--text-dim)", marginTop: 8, fontSize: 8 }}>{attackers.length} THREAT ACTORS MAPPED</div>
      </div>

      {/* Attack count */}
      <div style={{
        position: "absolute", top: 16, right: 16, zIndex: 1000,
        background: "rgba(8,12,18,0.9)", border: "1px solid rgba(255,61,90,0.3)",
        borderRadius: 6, padding: "10px 14px", fontFamily: "var(--mono)", textAlign: "right"
      }}>
        <div style={{ fontSize: 7, color: "var(--text-dim)", letterSpacing: 2, marginBottom: 4 }}>ACTIVE THREATS</div>
        <div style={{ fontSize: 24, fontWeight: 700, color: "#ff3d5a" }}>{attackers.length}</div>
        <div style={{ fontSize: 7, color: "var(--text-dim)", letterSpacing: 1 }}>UNIQUE ORIGINS</div>
      </div>
    </div>
  );
}