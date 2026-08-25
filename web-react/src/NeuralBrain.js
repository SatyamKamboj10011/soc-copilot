import { useEffect, useRef } from "react";

// Generates points inside a rough head/brain silhouette using layered ellipses
function generateBrainPoints(count, w, h) {
  const cx = w / 2, cy = h / 2;
  const pts = [];
  let attempts = 0;
  while (pts.length < count && attempts < count * 40) {
    attempts++;
    const x = (Math.random() - 0.5) * w;
    const y = (Math.random() - 0.5) * h;
    // Head silhouette: skull ellipse + jaw taper
    const skull = (x * x) / ((w * 0.34) ** 2) + (y * y) / ((h * 0.4) ** 2);
    const jawCut = y > h * 0.12 ? Math.pow((y - h * 0.12) / (h * 0.28), 2) * 2.2 : 0;
    if (skull + jawCut < 1) pts.push({ x: cx + x, y: cy + y, ox: x, oy: y, phase: Math.random() * Math.PI * 2 });
  }
  return pts;
}

export default function NeuralBrain({ width = 420, height = 460, density = 260, className = "", style = {} }) {
  const canvasRef = useRef(null);
  const pointsRef = useRef([]);
  const edgesRef = useRef([]);
  const pulsesRef = useRef([]);
  const rafRef = useRef(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = width * dpr;
    canvas.height = height * dpr;
    const ctx = canvas.getContext("2d");
    ctx.scale(dpr, dpr);

    const pts = generateBrainPoints(density, width * 0.82, height * 0.82);
    pointsRef.current = pts;

    // Build sparse edge set — connect each point to a few nearest neighbours
    const edges = [];
    for (let i = 0; i < pts.length; i++) {
      const dists = [];
      for (let j = 0; j < pts.length; j++) {
        if (i === j) continue;
        const dx = pts[i].x - pts[j].x, dy = pts[i].y - pts[j].y;
        const d = dx * dx + dy * dy;
        if (d < 900) dists.push([j, d]);
      }
      dists.sort((a, b) => a[1] - b[1]);
      dists.slice(0, 2).forEach(([j]) => edges.push([i, j]));
    }
    edgesRef.current = edges;
    pulsesRef.current = edges
      .filter(() => Math.random() < 0.12)
      .map(([a, b]) => ({ a, b, t: Math.random(), speed: 0.004 + Math.random() * 0.006 }));

    let t = 0;
    const draw = () => {
      t += 0.016;
      ctx.clearRect(0, 0, width, height);

      const pts2 = pointsRef.current;
      pts2.forEach(p => {
        p.x += Math.sin(t * 0.6 + p.phase) * 0.03;
        p.y += Math.cos(t * 0.5 + p.phase) * 0.03;
      });

      // edges
      ctx.strokeStyle = "rgba(61,41,85,0.55)"; // --line
      ctx.lineWidth = 0.6;
      edgesRef.current.forEach(([a, b]) => {
        ctx.beginPath();
        ctx.moveTo(pts2[a].x, pts2[a].y);
        ctx.lineTo(pts2[b].x, pts2[b].y);
        ctx.stroke();
      });

      // nodes
      pts2.forEach((p, i) => {
        const flicker = 0.5 + 0.5 * Math.sin(t * 1.4 + p.phase);
        ctx.beginPath();
        ctx.fillStyle = i % 5 === 0 ? `rgba(240,168,87,${0.5 + flicker * 0.4})` : `rgba(70,194,176,${0.35 + flicker * 0.3})`;
        ctx.arc(p.x, p.y, i % 5 === 0 ? 1.6 : 1.1, 0, Math.PI * 2);
        ctx.fill();
      });

      // traveling synapse pulses
      pulsesRef.current.forEach(pulse => {
        pulse.t += pulse.speed;
        if (pulse.t > 1) pulse.t = 0;
        const a = pts2[pulse.a], b = pts2[pulse.b];
        const x = a.x + (b.x - a.x) * pulse.t;
        const y = a.y + (b.y - a.y) * pulse.t;
        ctx.beginPath();
        ctx.fillStyle = "#F0A857";
        ctx.shadowColor = "#F0A857";
        ctx.shadowBlur = 6;
        ctx.arc(x, y, 2, 0, Math.PI * 2);
        ctx.fill();
        ctx.shadowBlur = 0;
      });

      rafRef.current = requestAnimationFrame(draw);
    };
    draw();
    return () => cancelAnimationFrame(rafRef.current);
  }, [width, height, density]);

  return (
    <canvas
      ref={canvasRef}
      className={className}
      style={{ width, height, display: "block", ...style }}
    />
  );
}
