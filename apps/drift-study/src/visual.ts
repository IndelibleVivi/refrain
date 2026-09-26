import type { Moment, Work } from "./contracts";
import type { VoiceView } from "./kernel";

const colors = ["173,184,225", "215,171,130"];
const rgba = (layer: number, alpha: number) =>
  "rgba(" + colors[layer] + "," + Math.max(0, Math.min(1, alpha)) + ")";
const rotation = -0.21;
const tau = Math.PI * 2;

function geometry(width: number, height: number) {
  const rx = Math.min(width * 0.335, height * 0.64);
  return { cx: width * 0.51, cy: height * 0.54, rx, ry: rx * 0.49 };
}
function point(
  phase: number,
  layer: number,
  rx: number,
  ry: number,
  ripple = 0,
) {
  const theta = phase * tau - Math.PI / 2;
  const scale = 1 + layer * 0.055;
  return {
    x: Math.cos(theta) * rx * scale,
    y:
      Math.sin(theta) * ry * scale +
      (layer * 12 - 6) +
      Math.sin(theta * 5 + layer) * ripple,
  };
}

/** Native hit targets share the exact instrument geometry, never a second layout. */
export function notePositions(work: Work, width: number, height: number) {
  const { cx, cy, rx, ry } = geometry(width, height);
  return work.notes.map((note, index) => {
    const p = point(note.at, 0.5, rx, ry);
    return {
      index,
      x: cx + p.x * Math.cos(rotation) - p.y * Math.sin(rotation),
      y: cy + p.x * Math.sin(rotation) + p.y * Math.cos(rotation),
    };
  });
}
export function noteName(midi: number) {
  return (
    ["C", "C♯", "D", "D♯", "E", "F", "F♯", "G", "G♯", "A", "A♯", "B"][
      midi % 12
    ] +
    (Math.floor(midi / 12) - 1)
  );
}

export function drawField(
  canvas: HTMLCanvasElement,
  moment: Moment,
  work: Work,
  active: boolean,
  voices: VoiceView[],
  highlighted?: number,
  reducedMotion = false,
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
  const { cx, cy, rx, ry } = geometry(w, h);
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
  c.rotate(rotation);
  c.lineWidth = 0.6;
  c.strokeStyle = "rgba(146,166,178,.14)";
  for (const k of [0.8, 1, 1.22]) {
    c.beginPath();
    c.ellipse(0, 0, rx * k, ry * k, 0, 0, tau);
    c.stroke();
  }
  const phases = [moment.phaseA, moment.phaseB];
  for (let layer = 0; layer < 2; layer++) {
    const audible =
      moment.layers === "both" || moment.layers === (layer === 0 ? "a" : "b");
    const softness = layer === 0 ? moment.erosion : moment.bloom;
    const alpha = audible ? 1 : 0.16;
    const passes = layer === 0 ? 4 : 9;
    for (let p = passes; p >= 0; p--) {
      c.beginPath();
      for (let i = 0; i <= 240; i++) {
        const pt = point(
          i / 240,
          layer,
          rx,
          ry,
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

    // Each luminous wake is derived from the same voice envelope as the sound.
    for (const voice of voices) {
      if (voice.layer !== (layer === 0 ? "a" : "b") || voice.level <= 0)
        continue;
      const origin = work.notes[voice.note];
      if (!origin) continue;
      const life = Math.min(1, voice.age / Math.max(0.01, voice.duration));
      const reach = Math.min(0.28, (voice.duration / work.loopSeconds) * 0.12);
      const front = reducedMotion ? 0.45 : Math.min(1, voice.age / 0.7);
      for (let strand = 0; strand < (layer === 0 ? 3 : 6); strand++) {
        c.beginPath();
        for (let i = 0; i <= 36; i++) {
          const t = i / 36;
          const p = point(origin.at + reach * front * t, layer, rx, ry);
          const spread =
            Math.sin(t * Math.PI) * (3 + softness * 13) * (strand - 2) * 0.25;
          const y = p.y + spread;
          i ? c.lineTo(p.x, y) : c.moveTo(p.x, y);
        }
        c.strokeStyle = rgba(
          layer,
          voice.level * (voice.manual ? 0.21 : 0.12) * (1 - strand * 0.1),
        );
        c.lineWidth = voice.manual ? 1.3 : 0.85;
        c.stroke();
      }
      const n = point(origin.at, layer, rx, ry);
      const glowSize = 15 + voice.level * (voice.manual ? 44 : 26);
      const glow = c.createRadialGradient(n.x, n.y, 0, n.x, n.y, glowSize);
      glow.addColorStop(
        0,
        rgba(layer, voice.level * (voice.manual ? 0.4 : 0.24)),
      );
      glow.addColorStop(1, rgba(layer, 0));
      c.fillStyle = glow;
      c.fillRect(n.x - glowSize, n.y - glowSize, glowSize * 2, glowSize * 2);
      if (voice.manual) {
        const radius = reducedMotion
          ? 13
          : 6 + Math.min(1, voice.age / 1.2) * 28;
        c.beginPath();
        c.ellipse(n.x, n.y, radius, radius * 0.66, 0, 0, tau);
        c.strokeStyle = rgba(layer, voice.level * (1 - life) * 0.75);
        c.lineWidth = 0.8;
        c.stroke();
      }
    }

    work.notes.forEach((note, index) => {
      const n = point(note.at, layer, rx, ry);
      const voice = voices.find(
        (v) => v.note === index && v.layer === (layer === 0 ? "a" : "b"),
      );
      const pulse = voice?.level ?? 0;
      const selected = highlighted === index;
      c.beginPath();
      c.arc(n.x, n.y, 2.4 + pulse * 2 + (selected ? 1 : 0), 0, tau);
      c.fillStyle = rgba(
        layer,
        alpha * (0.5 + pulse * 0.5 + (selected ? 0.3 : 0)),
      );
      c.fill();
      if (selected) {
        c.beginPath();
        c.moveTo(n.x - 5, n.y + 8);
        c.lineTo(n.x + 5, n.y + 8);
        c.strokeStyle = rgba(layer, 0.85);
        c.lineWidth = 1.2;
        c.stroke();
      }
    });
    const head = point(phases[layer], layer, rx, ry);
    const g = c.createRadialGradient(head.x, head.y, 0, head.x, head.y, 28);
    g.addColorStop(0, rgba(layer, alpha * 0.25));
    g.addColorStop(1, rgba(layer, 0));
    c.fillStyle = g;
    c.fillRect(head.x - 28, head.y - 28, 56, 56);
    c.beginPath();
    c.arc(head.x, head.y, 3.2, 0, tau);
    c.fillStyle = rgba(layer, alpha);
    c.fill();
    c.font = "italic 13px Georgia";
    c.fillText(
      layer === 0 ? "a" : "b",
      head.x + 10,
      head.y + (layer === 0 ? -10 : 17),
    );
  }
  const difference = Math.abs(moment.phaseA - moment.phaseB);
  const distance = Math.min(difference, 1 - difference);
  const meeting =
    active && moment.layers === "both" ? Math.max(0, 1 - distance / 0.1) : 0;
  if (meeting > 0) {
    const a = point(moment.phaseA, 0, rx, ry),
      b = point(moment.phaseB, 1, rx, ry);
    const light = c.createLinearGradient(a.x, a.y, b.x, b.y);
    light.addColorStop(0, rgba(0, meeting * 0.7));
    light.addColorStop(1, rgba(1, meeting * 0.7));
    c.strokeStyle = light;
    c.lineWidth = 1;
    c.beginPath();
    c.moveTo(a.x, a.y);
    c.quadraticCurveTo(
      (a.x + b.x) / 2,
      (a.y + b.y) / 2 - 16 * meeting,
      b.x,
      b.y,
    );
    c.stroke();
  }
  c.restore();
  c.textAlign = "center";
  c.font = "italic 30px Georgia";
  c.fillStyle = "rgba(211,222,221,.8)";
  c.fillText(
    moment.frozen ? "stay." : meeting > 0.65 ? "together." : "again.",
    cx,
    cy + 6,
  );
  c.font = "8px monospace";
  c.fillStyle = "rgba(177,194,196,.56)";
  const phrase =
    work.notes
      .slice(0, 6)
      .map((note) => noteName(note.midi).replace(/\d+$/, ""))
      .join("  ·  ") + (work.notes.length > 6 ? " …" : "");
  c.fillText(moment.frozen ? "THE SOUND KEEPS MOVING" : phrase, cx, cy + 27);
}
