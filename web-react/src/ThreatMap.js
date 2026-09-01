import { useEffect, useState } from "react";
import { MapContainer, TileLayer, CircleMarker, Popup, Polyline } from "react-leaflet";
 
const FLASK_URL = "https://soc-copilot.onrender.com";
const NZ_COORDS = [-36.8485, 174.7633]; // Auckland — your server location
// CARTO's raster basemaps now require a free API key (added their side
// this week, mid-migration to vector tiles). Read from an env var rather
// than hardcoded -- set REACT_APP_CARTO_API_KEY in Vercel's environment
// variables, then trigger a redeploy so Create React App bakes it into
// the build (these are build-time, not runtime, env vars).
const CARTO_API_KEY = process.env.REACT_APP_CARTO_API_KEY || "";
 
export default function ThreatMap() {
  const [attackers, setAttackers] = useState([]);
  const [loading, setLoading]     = useState(true);
 
  useEffect(() => {
    const fetchAttackers = async () => {
      try {
        // Was calling http://ip-api.com directly from the browser -- that
        // free endpoint doesn't support HTTPS at all, and this site runs
        // on HTTPS, so browsers silently block it as mixed content. No
        // visible error, just attackers staying empty forever. The
        // backend's /geoip/top-ips does the exact same ip-api.com lookup,
        // but server-side, where mixed-content blocking doesn't apply --
        // and it's cached there too, so repeat page loads don't re-hit
        // ip-api.com for IPs already looked up.
        const res = await fetch(`${FLASK_URL}/geoip/top-ips?limit=15`);
        const valid = await res.json();
        setAttackers(Array.isArray(valid) ? valid : []);
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
          background: "rgba(10,10,12,0.85)", fontFamily: "var(--mono)",
          fontSize: 11, color: "var(--accent)", letterSpacing: 2
        }}>
          ◈ LOADING THREAT MAP...
</div>
      )}
 
      <MapContainer
        center={[20, 0]}
        zoom={2}
        style={{ width: "100%", height: "100%", background: "#0A0A0C" }}
        zoomControl={false}
        attributionControl={true}
>
<TileLayer
          url={`https://basemaps.cartocdn.com/rastertiles/dark_all/{z}/{x}/{y}.png?key=${CARTO_API_KEY}`}
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>, &copy; <a href="https://carto.com/attributions">CARTO</a>'
        />
 
        {/* Auckland server marker */}
<CircleMarker
          center={NZ_COORDS}
          radius={10}
          pathOptions={{ color: "#4DD8E8", fillColor: "#4DD8E8", fillOpacity: 0.8, weight: 2 }}
>
<Popup>
<div style={{ fontFamily: "monospace", fontSize: 11, color: "#4DD8E8", background: "#0A0A0C", padding: 8, borderRadius: 4 }}>
<strong>SIRA SERVER</strong><br/>
              Auckland, New Zealand<br/>
              SOC Copilot
</div>
</Popup>
</CircleMarker>
 
        {/* Attacker markers + lines */}
        {attackers.map((a, i) => {
          const size      = 4 + (a.count / maxCount) * 14;
          const opacity   = 0.5 + (a.count / maxCount) * 0.5;
          const color     = a.count > maxCount * 0.7 ? "#E15554" : a.count > maxCount * 0.3 ? "#E8B84D" : "#6B7280";
 
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
        background: "rgba(10,10,12,0.92)", border: "1px solid rgba(77,216,232,0.2)",
        borderRadius: 6, padding: "10px 14px", fontFamily: "var(--mono)", fontSize: 9
      }}>
<div style={{ color: "var(--accent)", letterSpacing: 2, marginBottom: 8 }}>THREAT ORIGINS</div>
        {[
          { color: "#E15554", label: "HIGH ACTIVITY" },
          { color: "#E8B84D", label: "MEDIUM ACTIVITY" },
          { color: "#6B7280", label: "LOW ACTIVITY" },
          { color: "#4DD8E8", label: "SIRA SERVER (NZ)" },
        ].map((item, i) => (
<div key={i} style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
<div style={{ width: 7, height: 7, borderRadius: "50%", background: item.color }} />
<span style={{ color: "var(--text-dim)", letterSpacing: 1 }}>{item.label}</span>
</div>
        ))}
<div style={{ color: "var(--text-dim)", marginTop: 8, fontSize: 8 }}>{attackers.length} THREAT ACTORS MAPPED</div>
</div>
 
      {/* Attack count */}
<div style={{
        position: "absolute", top: 16, right: 16, zIndex: 1000,
        background: "rgba(10,10,12,0.92)", border: "1px solid rgba(225,85,84,0.3)",
        borderRadius: 6, padding: "10px 14px", fontFamily: "var(--mono)", textAlign: "right"
      }}>
<div style={{ fontSize: 7, color: "var(--text-dim)", letterSpacing: 2, marginBottom: 4 }}>ACTIVE THREATS</div>
<div style={{ fontSize: 24, fontWeight: 700, color: "#E15554" }}>{attackers.length}</div>
<div style={{ fontSize: 7, color: "var(--text-dim)", letterSpacing: 1 }}>UNIQUE ORIGINS</div>
</div>
</div>
  );
}