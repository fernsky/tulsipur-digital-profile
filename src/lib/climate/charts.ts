// Lightweight, dependency-free SVG chart generators for the climate portal.
// Every function returns an SVG string sized by a viewBox so it scales fluidly
// inside the analysis drawer. Devanagari labels, flat colors, Nepali digits.
import { toNe, MONTHS_SHORT } from "./labels";

const W = 384, H = 232;
const M = { t: 16, r: 16, b: 26, l: 38 };
const iw = W - M.l - M.r, ih = H - M.t - M.b;

type Pt = { x: number; y: number };

const niceMax = (v: number) => { const p = Math.pow(10, Math.floor(Math.log10(Math.max(v, 1)))); return Math.ceil(v / p) * p; };
const fmt = (v: number, d = 0) => toNe(v.toFixed(d));

function axes(xMin: number, xMax: number, yMin: number, yMax: number, xT: number[], yT: number[], xfmt: (v: number) => string, yfmt: (v: number) => string) {
  const sx = (x: number) => M.l + ((x - xMin) / (xMax - xMin || 1)) * iw;
  const sy = (y: number) => M.t + ih - ((y - yMin) / (yMax - yMin || 1)) * ih;
  const grid = yT.map((y) =>
    `<line x1="${M.l}" y1="${sy(y).toFixed(1)}" x2="${M.l + iw}" y2="${sy(y).toFixed(1)}" stroke="#e2e8f0" stroke-width="1"/>` +
    `<text x="${M.l - 6}" y="${(sy(y) + 3).toFixed(1)}" text-anchor="end" font-size="9" fill="#94a3b8">${yfmt(y)}</text>`).join("");
  const xlab = xT.map((x) =>
    `<text x="${sx(x).toFixed(1)}" y="${H - 8}" text-anchor="middle" font-size="9" fill="#94a3b8">${xfmt(x)}</text>`).join("");
  return { sx, sy, svg: grid + xlab };
}

function ticks(min: number, max: number, n = 4): number[] {
  const step = (max - min) / n, out = [];
  for (let i = 0; i <= n; i++) out.push(+(min + step * i).toFixed(2));
  return out;
}

function wrap(inner: string, cls = "") {
  return `<svg class="cc-svg ${cls}" viewBox="0 0 ${W} ${H}" preserveAspectRatio="xMidYMid meet" role="img">${inner}</svg>`;
}

// ── line chart with optional regression trend + value dots ───────────────────
export function lineChart(series: { name: string; color: string; pts: Pt[]; dash?: boolean }[], opts: {
  yUnit?: string; xfmt?: (v: number) => string; yfmt?: (v: number) => string; trend?: { color: string; slope: number; intercept: number } | null;
} = {}) {
  const all = series.flatMap((s) => s.pts);
  if (!all.length) return wrap(`<text x="${W / 2}" y="${H / 2}" text-anchor="middle" font-size="11" fill="#94a3b8">तथ्याङ्क उपलब्ध छैन</text>`);
  const xMin = Math.min(...all.map((p) => p.x)), xMax = Math.max(...all.map((p) => p.x));
  let yMin = Math.min(...all.map((p) => p.y)), yMax = Math.max(...all.map((p) => p.y));
  const pad = (yMax - yMin) * 0.12 || 1; yMin -= pad; yMax += pad;
  const yfmt = opts.yfmt || ((v: number) => fmt(v, Math.abs(yMax) < 10 ? 1 : 0));
  const xfmt = opts.xfmt || ((v: number) => toNe(Math.round(v)));
  const { sx, sy, svg } = axes(xMin, xMax, yMin, yMax, ticks(xMin, xMax, 4), ticks(yMin, yMax, 4), xfmt, yfmt);

  const lines = series.map((s) => {
    const d = s.pts.map((p, i) => `${i ? "L" : "M"}${sx(p.x).toFixed(1)} ${sy(p.y).toFixed(1)}`).join(" ");
    return `<path d="${d}" fill="none" stroke="${s.color}" stroke-width="1.8" ${s.dash ? 'stroke-dasharray="4 3"' : ""} stroke-linejoin="round"/>`;
  }).join("");

  let trend = "";
  if (opts.trend) {
    const y0 = opts.trend.slope * xMin + opts.trend.intercept, y1 = opts.trend.slope * xMax + opts.trend.intercept;
    trend = `<line x1="${sx(xMin).toFixed(1)}" y1="${sy(y0).toFixed(1)}" x2="${sx(xMax).toFixed(1)}" y2="${sy(y1).toFixed(1)}" stroke="${opts.trend.color}" stroke-width="2.2" stroke-dasharray="6 4" opacity="0.85"/>`;
  }
  return wrap(svg + lines + trend);
}

// ── climograph: precipitation bars (left axis) + temperature line (right) ────
export function climograph(normals: { t_mean: number | null; precip: number | null }[]) {
  const precs = normals.map((m) => m.precip ?? 0), temps = normals.map((m) => m.t_mean ?? 0);
  const pMax = niceMax(Math.max(...precs, 10)), tMin = Math.min(...temps) - 3, tMax = Math.max(...temps) + 3;
  const bw = iw / 12;
  const syP = (v: number) => M.t + ih - (v / pMax) * ih;
  const syT = (v: number) => M.t + ih - ((v - tMin) / (tMax - tMin || 1)) * ih;
  const sx = (i: number) => M.l + bw * i;

  const yT = ticks(0, pMax, 4);
  const grid = yT.map((y) =>
    `<line x1="${M.l}" y1="${syP(y).toFixed(1)}" x2="${M.l + iw}" y2="${syP(y).toFixed(1)}" stroke="#e2e8f0"/>` +
    `<text x="${M.l - 5}" y="${(syP(y) + 3).toFixed(1)}" text-anchor="end" font-size="8" fill="#94a3b8">${toNe(y)}</text>`).join("");
  const bars = precs.map((p, i) =>
    `<rect x="${(sx(i) + 2).toFixed(1)}" y="${syP(p).toFixed(1)}" width="${(bw - 4).toFixed(1)}" height="${(M.t + ih - syP(p)).toFixed(1)}" fill="#60a5fa" rx="1.5"/>`).join("");
  const tline = `<path d="${temps.map((t, i) => `${i ? "L" : "M"}${(sx(i) + bw / 2).toFixed(1)} ${syT(t).toFixed(1)}`).join(" ")}" fill="none" stroke="#dc2626" stroke-width="2" stroke-linejoin="round"/>`;
  const tdots = temps.map((t, i) => `<circle cx="${(sx(i) + bw / 2).toFixed(1)}" cy="${syT(t).toFixed(1)}" r="2.2" fill="#dc2626"/>`).join("");
  const mlab = MONTHS_SHORT.map((m, i) => `<text x="${(sx(i) + bw / 2).toFixed(1)}" y="${H - 8}" text-anchor="middle" font-size="8" fill="#94a3b8">${m}</text>`).join("");
  // right temp axis
  const tT = ticks(tMin, tMax, 4);
  const tAxis = tT.map((t) => `<text x="${M.l + iw + 4}" y="${(syT(t) + 3).toFixed(1)}" text-anchor="start" font-size="8" fill="#dc2626">${toNe(Math.round(t))}</text>`).join("");
  return wrap(grid + bars + tline + tdots + mlab + tAxis, "cc-climograph");
}

// ── vertical bars over years (extremes) with mean reference line ─────────────
export function barSeries(pts: Pt[], color: string, opts: { yUnit?: string; yfmt?: (v: number) => string } = {}) {
  if (!pts.length) return wrap(`<text x="${W / 2}" y="${H / 2}" text-anchor="middle" font-size="11" fill="#94a3b8">तथ्याङ्क उपलब्ध छैन</text>`);
  const xMin = Math.min(...pts.map((p) => p.x)), xMax = Math.max(...pts.map((p) => p.x));
  const yMax = niceMax(Math.max(...pts.map((p) => p.y), 1));
  const yfmt = opts.yfmt || ((v: number) => toNe(Math.round(v)));
  const { sx, sy, svg } = axes(xMin, xMax, 0, yMax, ticks(xMin, xMax, 4), ticks(0, yMax, 4), (v) => toNe(Math.round(v)), yfmt);
  const bw = Math.max(iw / (pts.length * 1.4), 1);
  const bars = pts.map((p) => `<rect x="${(sx(p.x) - bw / 2).toFixed(1)}" y="${sy(p.y).toFixed(1)}" width="${bw.toFixed(1)}" height="${(M.t + ih - sy(p.y)).toFixed(1)}" fill="${color}" opacity="0.85"/>`).join("");
  const meanV = pts.reduce((s, p) => s + p.y, 0) / pts.length;
  const meanLine = `<line x1="${M.l}" y1="${sy(meanV).toFixed(1)}" x2="${M.l + iw}" y2="${sy(meanV).toFixed(1)}" stroke="#0f172a" stroke-width="1.2" stroke-dasharray="4 3" opacity="0.6"/>`;
  return wrap(svg + bars + meanLine);
}

// ── decadal anomaly bars (deviation from baseline) ───────────────────────────
export function anomalyBars(decades: { decade: number; anom: number }[], unit: string) {
  if (!decades.length) return wrap("");
  const xMax = decades.length, aMax = Math.max(...decades.map((d) => Math.abs(d.anom)), 0.3);
  const bw = iw / decades.length;
  const sy = (v: number) => M.t + ih / 2 - (v / aMax) * (ih / 2);
  const zero = sy(0);
  const bars = decades.map((d, i) => {
    const y = sy(d.anom), pos = d.anom >= 0;
    return `<rect x="${(M.l + bw * i + 3).toFixed(1)}" y="${(pos ? y : zero).toFixed(1)}" width="${(bw - 6).toFixed(1)}" height="${Math.abs(zero - y).toFixed(1)}" fill="${pos ? "#dc2626" : "#2563eb"}" rx="1.5"/>` +
      `<text x="${(M.l + bw * i + bw / 2).toFixed(1)}" y="${H - 8}" text-anchor="middle" font-size="8" fill="#94a3b8">${toNe(d.decade)}</text>`;
  }).join("");
  const zl = `<line x1="${M.l}" y1="${zero.toFixed(1)}" x2="${M.l + iw}" y2="${zero.toFixed(1)}" stroke="#94a3b8" stroke-width="1"/>`;
  return wrap(zl + bars);
}

// ── wind rose: 16 sectors, stacked speed bins ────────────────────────────────
const ROSE_COLORS = ["#bfdbfe", "#93c5fd", "#60a5fa", "#3b82f6", "#1d4ed8", "#1e3a8a"];
export function windRose(rose: { dirs: string[]; bins: number[]; calm: number; data: number[][] }) {
  const cx = W / 2, cy = H / 2 + 4, R = Math.min(iw, ih) / 2 - 4;
  const maxSector = Math.max(...rose.data.map((s) => s.reduce((a, b) => a + b, 0)), 0.5);
  const scale = R / maxSector;
  const rings: string[] = [];
  for (let g = 1; g <= 3; g++) {
    const r = (R * g) / 3;
    rings.push(`<circle cx="${cx}" cy="${cy}" r="${r.toFixed(1)}" fill="none" stroke="#e2e8f0" stroke-width="1"/>`);
    rings.push(`<text x="${cx + 2}" y="${(cy - r + 9).toFixed(1)}" font-size="7.5" fill="#cbd5e1">${toNe(((maxSector * g) / 3).toFixed(1))}%</text>`);
  }
  // sector wedges, stacked from calm outward
  const wedge = (a0: number, a1: number, r0: number, r1: number, fill: string) => {
    const p = (ang: number, r: number) => [cx + r * Math.sin(ang), cy - r * Math.cos(ang)];
    const [x0, y0] = p(a0, r0), [x1, y1] = p(a1, r0), [x2, y2] = p(a1, r1), [x3, y3] = p(a0, r1);
    return `<path d="M${x0.toFixed(1)} ${y0.toFixed(1)} L${x3.toFixed(1)} ${y3.toFixed(1)} A${r1.toFixed(1)} ${r1.toFixed(1)} 0 0 1 ${x2.toFixed(1)} ${y2.toFixed(1)} L${x1.toFixed(1)} ${y1.toFixed(1)} A${r0.toFixed(1)} ${r0.toFixed(1)} 0 0 0 ${x0.toFixed(1)} ${y0.toFixed(1)} Z" fill="${fill}" stroke="#ffffff" stroke-width="0.4"/>`;
  };
  const sectors = rose.data.map((bins, s) => {
    const a0 = (s - 0.5) * (Math.PI / 8), a1 = (s + 0.5) * (Math.PI / 8);
    let r0 = 0; const segs: string[] = [];
    bins.forEach((v, bi) => { const r1 = r0 + v * scale; if (v > 0) segs.push(wedge(a0, a1, r0, r1, ROSE_COLORS[bi % ROSE_COLORS.length])); r0 = r1; });
    return segs.join("");
  }).join("");
  const labels = ["N", "E", "S", "W"].map((d, i) => {
    const ang = i * (Math.PI / 2), r = R + 9;
    const x = cx + r * Math.sin(ang), y = cy - r * Math.cos(ang) + 3;
    return `<text x="${x.toFixed(1)}" y="${y.toFixed(1)}" text-anchor="middle" font-size="9" font-weight="600" fill="#475569">${d}</text>`;
  }).join("");
  return wrap(rings.join("") + sectors + labels, "cc-rose");
}

// ── monthly pattern: 12-point line + area + dots, month-labelled ─────────────
export function monthlyChart(values: (number | null)[], color = "#1e293b") {
  const pts = values.map((v, i) => ({ i, v })).filter((p) => p.v != null) as { i: number; v: number }[];
  if (pts.length < 2) return wrap(`<text x="${W / 2}" y="${H / 2}" text-anchor="middle" font-size="11" fill="#94a3b8">तथ्याङ्क उपलब्ध छैन</text>`);
  let yMin = Math.min(...pts.map((p) => p.v)), yMax = Math.max(...pts.map((p) => p.v));
  const pad = (yMax - yMin) * 0.15 || 1; yMin -= pad; yMax += pad;
  const bw = iw / 12;
  const sx = (i: number) => M.l + bw * i + bw / 2;
  const sy = (v: number) => M.t + ih - ((v - yMin) / (yMax - yMin || 1)) * ih;
  const yT = ticks(yMin, yMax, 4);
  const grid = yT.map((y) =>
    `<line x1="${M.l}" y1="${sy(y).toFixed(1)}" x2="${M.l + iw}" y2="${sy(y).toFixed(1)}" stroke="#e2e8f0"/>` +
    `<text x="${M.l - 5}" y="${(sy(y) + 3).toFixed(1)}" text-anchor="end" font-size="8" fill="#94a3b8">${fmt(y, Math.abs(yMax) < 10 ? 1 : 0)}</text>`).join("");
  const dpath = pts.map((p, k) => `${k ? "L" : "M"}${sx(p.i).toFixed(1)} ${sy(p.v).toFixed(1)}`).join(" ");
  const area = `<path d="${dpath} L${sx(pts.at(-1)!.i).toFixed(1)} ${(M.t + ih).toFixed(1)} L${sx(pts[0].i).toFixed(1)} ${(M.t + ih).toFixed(1)} Z" fill="${color}" opacity="0.08"/>`;
  const line = `<path d="${dpath}" fill="none" stroke="${color}" stroke-width="2" stroke-linejoin="round"/>`;
  const dots = pts.map((p) => `<circle cx="${sx(p.i).toFixed(1)}" cy="${sy(p.v).toFixed(1)}" r="2.2" fill="${color}"/>`).join("");
  const mlab = MONTHS_SHORT.map((m, i) => `<text x="${sx(i).toFixed(1)}" y="${H - 8}" text-anchor="middle" font-size="8" fill="#94a3b8">${m}</text>`).join("");
  return wrap(grid + area + line + dots + mlab, "cc-monthly");
}

// ── monthly bars (for amount/accumulation indicators) ───────────────────────
export function monthlyBars(values: (number | null)[], color = "#2563eb") {
  const vals = values.map((v) => v ?? 0);
  if (!vals.some((v) => v > 0)) return wrap(`<text x="${W / 2}" y="${H / 2}" text-anchor="middle" font-size="11" fill="#94a3b8">तथ्याङ्क उपलब्ध छैन</text>`);
  const yMax = niceMax(Math.max(...vals, 1));
  const bw = iw / 12;
  const sy = (v: number) => M.t + ih - (v / yMax) * ih;
  const yT = ticks(0, yMax, 4);
  const grid = yT.map((y) =>
    `<line x1="${M.l}" y1="${sy(y).toFixed(1)}" x2="${M.l + iw}" y2="${sy(y).toFixed(1)}" stroke="#e2e8f0"/>` +
    `<text x="${M.l - 5}" y="${(sy(y) + 3).toFixed(1)}" text-anchor="end" font-size="8" fill="#94a3b8">${fmt(y, 0)}</text>`).join("");
  const bars = vals.map((v, i) => `<rect x="${(M.l + bw * i + 2).toFixed(1)}" y="${sy(v).toFixed(1)}" width="${(bw - 4).toFixed(1)}" height="${(M.t + ih - sy(v)).toFixed(1)}" fill="${color}" rx="1.5"/>`).join("");
  const mlab = MONTHS_SHORT.map((m, i) => `<text x="${(M.l + bw * i + bw / 2).toFixed(1)}" y="${H - 8}" text-anchor="middle" font-size="8" fill="#94a3b8">${m}</text>`).join("");
  return wrap(grid + bars + mlab, "cc-mbars");
}

export { W as CHART_W, H as CHART_H };
