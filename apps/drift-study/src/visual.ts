import type { Moment, Work } from "./contracts";

export function drawField(
  canvas: HTMLCanvasElement,
  moment: Moment,
  work: Work,
  active: boolean,
) {
  const rect = canvas.getBoundingClientRect();
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const w = rect.width,
    h = rect.height;
  if (
    canvas.width !== Math.round(w * dpr) ||
    canvas.height !== Math.round(h * dpr)
  ) {
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
  }
  const c = canvas.getContext("2d")!;
  c.setTransform(dpr, 0, 0, dpr, 0, 0);
  c.clearRect(0, 0, w, h);
  const cx = w * 0.51,
    cy = h * 0.54,
    rx = Math.min(w * 0.335, h * 0.64),
    ry = rx * 0.49;
  const haze = c.createRadialGradient(cx, cy, 0, cx, cy, w * 0.65);
  haze.addColorStop(0, "#28333b");
  haze.addColorStop(1, "#172128");
  c.fillStyle = haze;
  c.fillRect(0, 0, w, h);
  c.fillStyle = "rgba(161,181,185,.12)";
  for (let x = 18; x < w; x += 25)
    for (let y = 20; y < h; y += 25) c.fillRect(x, y, 0.65, 0.65);
  c.save();
  c.translate(cx, cy);
  c.rotate(-0.21);
  c.lineWidth = 0.6;
  c.strokeStyle = "rgba(146,166,178,.14)";
  for (const k of [0.8, 1, 1.22]) {
    c.beginPath();
    c.ellipse(0, 0, rx * k, ry * k, 0, 0, Math.PI * 2);
    c.stroke();
  }
  const point = (phase: number, layer: number, ripple = 0) => {
    const theta = phase * Math.PI * 2 - Math.PI / 2;
    const scale = layer === 0 ? 1 : 1.055;
    return {
      x: Math.cos(theta) * rx * scale,
      y:
        Math.sin(theta) * ry * scale +
        (layer === 0 ? -6 : 6) +
        Math.sin(theta * 5 + layer) * ripple,
    };
  };
  const colors = ["173,184,225", "215,171,130"];
  const rgba = (layer: number, alpha: number) =>
    "rgba(" + colors[layer] + "," + alpha + ")";
  for (let layer = 0; layer < 2; layer++) {
    const audible =
      moment.layers === "both" || moment.layers === (layer === 0 ? "a" : "b");
    const phase = layer === 0 ? moment.phaseA : moment.phaseB;
    const softness = layer === 0 ? moment.erosion : moment.bloom;
    const alpha = audible ? 1 : 0.16;
    const passes = layer === 0 ? 4 : 9;
    for (let p = passes; p >= 0; p--) {
      c.beginPath();
      for (let i = 0; i <= 240; i++) {
        const pt = point(
          i / 240,
          layer,
          (layer === 0 ? 1 - softness : softness) * 4,
        );
        const yy =
          pt.y + (p - passes / 2) * (layer === 0 ? 0.7 : 1.3 + softness * 1.4);
        i ? c.lineTo(pt.x, yy) : c.moveTo(pt.x, yy);
      }
      c.strokeStyle = rgba(
        layer,
        alpha * (p === Math.round(passes / 2) ? 0.75 : 0.055),
      );
      c.lineWidth = p === Math.round(passes / 2) ? 1.2 : 0.8;
      c.stroke();
    }
    for (const note of work.notes) {
      const n = point(note.at, layer, 0);
      const distance = (((phase - note.at) % 1) + 1) % 1;
      const pulse = active && audible ? Math.max(0, 1 - distance / 0.14) : 0;
      c.beginPath();
      c.arc(n.x, n.y, 2.1 + pulse * 2, 0, Math.PI * 2);
      c.fillStyle = rgba(layer, alpha * (0.45 + pulse * 0.5));
      c.fill();
      if (pulse > 0.05) {
        c.beginPath();
        c.arc(n.x, n.y, 6 + pulse * 7, 0, Math.PI * 2);
        c.strokeStyle = rgba(layer, pulse * 0.22);
        c.stroke();
      }
    }
    const head = point(phase, layer, 0);
    const g = c.createRadialGradient(head.x, head.y, 0, head.x, head.y, 28);
    g.addColorStop(0, rgba(layer, alpha * 0.25));
    g.addColorStop(1, rgba(layer, 0));
    c.fillStyle = g;
    c.fillRect(head.x - 28, head.y - 28, 56, 56);
    c.beginPath();
    c.arc(head.x, head.y, 3.2, 0, Math.PI * 2);
    c.fillStyle = rgba(layer, alpha);
    c.fill();
    c.font = "italic 13px Georgia";
    c.fillText(
      layer === 0 ? "a" : "b",
      head.x + 10,
      head.y + (layer === 0 ? -10 : 17),
    );
  }
  c.restore();
  c.textAlign = "center";
  c.font = "italic 30px Georgia";
  c.fillStyle = "rgba(211,222,221,.8)";
  c.fillText(moment.frozen ? "stay." : "again.", cx, cy + 6);
  c.font = "8px monospace";
  c.fillStyle = "rgba(177,194,196,.56)";
  const names = [
    "C",
    "C♯",
    "D",
    "D♯",
    "E",
    "F",
    "F♯",
    "G",
    "G♯",
    "A",
    "A♯",
    "B",
  ];
  const phrase =
    work.notes
      .slice(0, 6)
      .map((note) => names[note.midi % 12])
      .join("  ·  ") + (work.notes.length > 6 ? " …" : "");
  c.fillText(moment.frozen ? "THE SOUND KEEPS MOVING" : phrase, cx, cy + 27);
}
