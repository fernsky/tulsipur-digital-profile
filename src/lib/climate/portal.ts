// Climate portal controller: boots a lean MapLibre map (basemap + ward context
// + an animated 3×3 climate heatmap bound to the municipality), and an analysis
// drawer driven by mode (normals / trends / extremes / wind rose / spatial /
// projection). All data comes from one baked static JSON — zero live API calls.
import maplibregl from "maplibre-gl";
import { BASEMAPS } from "../geo/labels";
import {
  VARS, EXTREMES, MODES, MONTHS_NE, SEASONS, rampColor, cIcon, toNe,
  MUNI_BOUNDS, MUNI_CENTER, type ClimVar,
} from "./labels";
import { lineChart, climograph, barSeries, anomalyBars, windRose } from "./charts";

type Annual = Record<string, number> & { year: number };
type Data = {
  generated: string; bounds: [number, number, number, number]; center: [number, number];
  period: { start: number; end: number }; normalPeriod: { from: number; to: number };
  grid: { row: number; col: number; lat: number; lng: number }[];
  normals: any[]; monthTrend: number[]; annual: Annual[];
  windRose: { dirs: string[]; bins: number[]; calm: number; data: number[][] };
  trends: { temp: any; precip: any };
  gridAnnual: { row: number; col: number; lat: number; lng: number; years: { year: number; t: number; p: number }[] }[];
  projections: { year: number; t_mean: number; precip: number }[] | null;
};

const $ = (s: string, r: Document | HTMLElement = document) => r.querySelector(s) as HTMLElement;

const state = {
  mode: "normals",
  varId: "temp",
  mapVar: "temp" as "temp" | "precip",
  year: 0,
  playing: false,
  timer: 0 as number | undefined,
};

let DATA: Data;

// ── ordinary least squares (matches the pipeline, for drawing trend lines) ───
function linreg(pts: { x: number; y: number }[]) {
  const n = pts.length; if (n < 2) return { slope: 0, intercept: 0 };
  let sx = 0, sy = 0, sxx = 0, sxy = 0;
  for (const { x, y } of pts) { sx += x; sy += y; sxx += x * x; sxy += x * y; }
  const d = n * sxx - sx * sx;
  const slope = d === 0 ? 0 : (n * sxy - sx * sy) / d;
  return { slope, intercept: (sy - slope * sx) / n };
}

// ── 3×3 heatmap cells tessellating the municipality bbox ─────────────────────
function buildCells(): GeoJSON.FeatureCollection {
  const [w, s, e, n] = DATA.bounds;
  const lats = [...new Set(DATA.grid.map((g) => g.lat))].sort((a, b) => b - a); // north→south
  const lngs = [...new Set(DATA.grid.map((g) => g.lng))].sort((a, b) => a - b); // west→east
  const latEdges = [n, ...lats.slice(0, -1).map((_, i) => (lats[i] + lats[i + 1]) / 2), s];
  const lngEdges = [w, ...lngs.slice(0, -1).map((_, i) => (lngs[i] + lngs[i + 1]) / 2), e];
  const feats: GeoJSON.Feature[] = [];
  for (let r = 0; r < lats.length; r++)
    for (let c = 0; c < lngs.length; c++) {
      const [n1, s1, w1, e1] = [latEdges[r], latEdges[r + 1], lngEdges[c], lngEdges[c + 1]];
      feats.push({
        type: "Feature", properties: { row: r, col: c, color: "#cbd5e1", val: 0 },
        geometry: { type: "Polygon", coordinates: [[[w1, n1], [e1, n1], [e1, s1], [w1, s1], [w1, n1]]] },
      });
    }
  return { type: "FeatureCollection", features: feats };
}

// value for a grid cell (row,col) in a given year for temp/precip
function cellValue(row: number, col: number, year: number, which: "t" | "p"): number | null {
  const g = DATA.gridAnnual.find((p) => p.row === row && p.col === col);
  if (!g) return null;
  const y = g.years.find((yy) => yy.year === year);
  return y ? y[which] : null;
}

function recolorCells() {
  const v = VARS.find((x) => x.id === state.mapVar)!;
  const which = state.mapVar === "precip" ? "p" : "t";
  const fc = buildCells();
  for (const f of fc.features) {
    const val = cellValue(f.properties!.row, f.properties!.col, state.year, which);
    f.properties!.val = val ?? 0;
    f.properties!.color = rampColor(val, v.scale);
  }
  (map.getSource("clim-grid") as maplibregl.GeoJSONSource)?.setData(fc);
  const yEl = $("#cl-year-val"); if (yEl) yEl.textContent = toNe(state.year);
  buildLegend();
}

// ── map ──────────────────────────────────────────────────────────────────────
let map: maplibregl.Map;

function leanStyle(basemapId: string): maplibregl.StyleSpecification {
  const bm = BASEMAPS.find((b) => b.id === basemapId) || BASEMAPS[0];
  const origin = typeof location !== "undefined" ? location.origin : "";
  return {
    version: 8,
    glyphs: "https://demotiles.maplibre.org/font/{fontstack}/{range}.pbf",
    sources: {
      basemap: { type: "raster", tiles: bm.url ? [bm.url] : [], tileSize: 256, maxzoom: bm.maxzoom ?? 19, attribution: bm.attribution, bounds: MUNI_BOUNDS },
      base: { type: "vector", tiles: [`${origin}/geo/base/{z}/{x}/{y}.pbf`], minzoom: 6, maxzoom: 15 },
    },
    layers: [
      { id: "basemap", type: "raster", source: "basemap" },
    ],
  } as maplibregl.StyleSpecification;
}

function addOverlays() {
  const origin = location.origin;
  // climate heatmap grid (below ward lines)
  map.addSource("clim-grid", { type: "geojson", data: buildCells() });
  map.addLayer({
    id: "clim-grid", type: "fill", source: "clim-grid",
    paint: { "fill-color": ["get", "color"], "fill-opacity": 0.6, "fill-outline-color": "#ffffff55" },
  });
  // municipality white mask (hides the grid outside the boundary)
  map.addSource("muni-mask", { type: "geojson", data: `${origin}/geo/mask.geojson` });
  map.addLayer({ id: "muni-mask", type: "fill", source: "muni-mask", paint: { "fill-color": "#ffffff", "fill-opacity": 1 } });
  // ward + municipality context (from the GIS base tiles)
  map.addLayer({
    id: "wards-line", type: "line", source: "base", "source-layer": "wards",
    paint: { "line-color": "#1e293b", "line-width": ["interpolate", ["linear"], ["zoom"], 9, 0.8, 14, 2], "line-opacity": 0.55 },
  });
  map.addLayer({
    id: "wards-label", type: "symbol", source: "base", "source-layer": "wards",
    layout: { "text-field": ["concat", "वडा ", ["to-string", ["get", "ward"]]], "text-font": ["Open Sans Regular"], "text-size": 12 },
    paint: { "text-color": "#0f172a", "text-halo-color": "#ffffff", "text-halo-width": 1.6 },
  });
  map.addLayer({
    id: "municipality", type: "line", source: "base", "source-layer": "municipality",
    paint: { "line-color": "#0f172a", "line-width": 2.5, "line-dasharray": [2, 1.5] },
  });
  recolorCells();
}

// ── boot ──────────────────────────────────────────────────────────────────────
export async function initClimate() {
  const hud = $("#geo-hud"), hudText = $("#geo-hud-text");
  const setHud = (m: string) => { if (hudText) hudText.textContent = m; if (hud) hud.style.display = "flex"; };
  const hideHud = () => { if (hud) hud.style.display = "none"; };
  setHud("जलवायु तथ्याङ्क लोड हुँदैछ…");

  DATA = await fetch("/climate/climate.json").then((r) => r.json());
  state.year = DATA.period.end;

  const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
  let basemap = "esri-street";
  map = new maplibregl.Map({
    container: "geo-map", style: leanStyle(basemap),
    center: MUNI_CENTER, zoom: reduce ? 10.6 : 9.8, pitch: reduce ? 0 : 38, bearing: reduce ? 0 : -14,
    maxZoom: 14, minZoom: 8,
    maxBounds: [[MUNI_BOUNDS[0] - 0.18, MUNI_BOUNDS[1] - 0.18], [MUNI_BOUNDS[2] + 0.18, MUNI_BOUNDS[3] + 0.18]],
    pitchWithRotate: true, dragRotate: true, attributionControl: { compact: true },
  });
  map.addControl(new maplibregl.NavigationControl({ visualizePitch: true }), "top-right");
  map.addControl(new maplibregl.ScaleControl({ unit: "metric" }), "bottom-left");
  (window as any).__climMap = map;

  map.on("load", () => {
    addOverlays();
    wirePanel();
    wireMapInspect();
    renderDrawer();
    if (!reduce) map.once("idle", () => map.easeTo({ center: MUNI_CENTER, zoom: 10.6, pitch: 36, bearing: 6, duration: 3600, easing: (t) => t * (2 - t) }));
    hideHud();
  });
  map.on("idle", () => { if (map.areTilesLoaded()) hideHud(); });

  (window as any).__setBasemap = (id: string) => {
    basemap = id;
    if (map.getLayer("basemap")) map.setLayoutProperty("basemap", "visibility", id === "none" ? "none" : "visible");
    const bm = BASEMAPS.find((b) => b.id === id);
    const src = map.getSource("basemap") as maplibregl.RasterTileSource;
    if (id !== "none" && bm?.url && (src as any).setTiles) (src as any).setTiles([bm.url]);
  };
}

// ── control panel ─────────────────────────────────────────────────────────────
function wirePanel() {
  const panel = $("#geo-panel-body");
  if (!panel) return;

  const modeHtml = MODES.map((m) =>
    `<button class="geo-chip${m.id === state.mode ? " is-on" : ""}" data-mode="${m.id}">${cIcon(m.icon, 14)}<span>${m.label}</span></button>`).join("");
  const varHtml = VARS.map((v) => `<option value="${v.id}"${v.id === state.varId ? " selected" : ""}>${v.label}</option>`).join("");
  const basemapHtml = BASEMAPS.map((b, i) => `<button class="geo-chip${b.id === "esri-street" ? " is-on" : ""}" data-basemap="${b.id}">${b.label}</button>`).join("");

  panel.innerHTML = `
    <div class="geo-toolbar">
      <button id="geo-reset" class="geo-tool-btn">रिसेट</button>
      <button id="geo-legend-toggle" class="geo-tool-btn is-on" aria-pressed="true">${cIcon("compass", 14)}<span>रङ्ग-सूची</span></button>
    </div>
    <section class="geo-sec">
      <div class="geo-sec-h">${cIcon("trend", 15)}<span>विश्लेषण प्रकार</span></div>
      <div class="geo-chips cl-modes">${modeHtml}</div>
    </section>
    <section class="geo-sec">
      <div class="geo-sec-h">${cIcon("thermometer", 15)}<span>जलवायु चल</span></div>
      <select id="cl-var" class="geo-select">${varHtml}</select>
    </section>
    <section class="geo-sec">
      <div class="geo-sec-h">${cIcon("map", 15)}<span>नक्सा हिटम्याप</span></div>
      <div class="geo-chips" style="margin-bottom:8px">
        <button class="geo-chip is-on" data-mapvar="temp">${cIcon("thermometer", 13)}तापक्रम</button>
        <button class="geo-chip" data-mapvar="precip">${cIcon("drop", 13)}वर्षा</button>
      </div>
      <label class="geo-row"><input type="checkbox" id="cl-grid-toggle" checked/><span>हिटम्याप देखाउनुहोस्</span></label>
      <label class="geo-row"><input type="checkbox" id="cl-ward-toggle" checked/><span>वडा सिमाना</span></label>
      <div class="cl-slider-wrap">
        <div class="cl-slider-top"><span>वर्ष</span><b id="cl-year-val">${toNe(state.year)}</b>
          <button id="cl-play" class="cl-play" aria-label="चलाउनुहोस्">${cIcon("play", 15)}</button></div>
        <input type="range" id="cl-year" min="${DATA.period.start}" max="${DATA.period.end}" value="${state.year}" step="1"/>
        <div class="cl-slider-ends"><span>${toNe(DATA.period.start)}</span><span>${toNe(DATA.period.end)}</span></div>
      </div>
    </section>
    <section class="geo-sec">
      <div class="geo-sec-h">${cIcon("layers", 15)}<span>आधार नक्सा</span></div>
      <div class="geo-chips">${basemapHtml}</div>
    </section>`;

  // modes
  panel.querySelectorAll("[data-mode]").forEach((el) => el.addEventListener("click", () => {
    panel.querySelectorAll("[data-mode]").forEach((b) => b.classList.remove("is-on"));
    el.classList.add("is-on"); state.mode = (el as HTMLElement).dataset.mode!; renderDrawer();
  }));
  // variable
  $("#cl-var")?.addEventListener("change", (e) => { state.varId = (e.target as HTMLSelectElement).value; renderDrawer(); });
  // map variable
  panel.querySelectorAll("[data-mapvar]").forEach((el) => el.addEventListener("click", () => {
    panel.querySelectorAll("[data-mapvar]").forEach((b) => b.classList.remove("is-on"));
    el.classList.add("is-on"); state.mapVar = (el as HTMLElement).dataset.mapvar as any; recolorCells();
  }));
  // grid + ward toggles
  $("#cl-grid-toggle")?.addEventListener("change", (e) =>
    map.setLayoutProperty("clim-grid", "visibility", (e.target as HTMLInputElement).checked ? "visible" : "none"));
  $("#cl-ward-toggle")?.addEventListener("change", (e) => {
    const v = (e.target as HTMLInputElement).checked ? "visible" : "none";
    ["wards-line", "wards-label"].forEach((id) => map.getLayer(id) && map.setLayoutProperty(id, "visibility", v));
  });
  // year slider
  $("#cl-year")?.addEventListener("input", (e) => { stopPlay(); state.year = +(e.target as HTMLInputElement).value; recolorCells(); if (state.mode === "spatial") renderDrawer(); });
  $("#cl-play")?.addEventListener("click", togglePlay);
  // basemap
  panel.querySelectorAll("[data-basemap]").forEach((el) => el.addEventListener("click", () => {
    panel.querySelectorAll("[data-basemap]").forEach((b) => b.classList.remove("is-on"));
    el.classList.add("is-on"); (window as any).__setBasemap((el as HTMLElement).dataset.basemap);
  }));
  // legend toggle
  const legendEl = $("#geo-legend"), legBtn = panel.querySelector("#geo-legend-toggle") as HTMLElement;
  legBtn?.addEventListener("click", () => { const on = legBtn.classList.toggle("is-on"); legBtn.setAttribute("aria-pressed", on ? "true" : "false"); if (legendEl) legendEl.style.display = on ? "" : "none"; });
  // reset
  $("#geo-reset")?.addEventListener("click", () => {
    stopPlay(); state.mode = "normals"; state.varId = "temp"; state.mapVar = "temp"; state.year = DATA.period.end;
    (panel.querySelector('[data-mode="normals"]') as HTMLElement)?.classList.add("is-on");
    panel.querySelectorAll('[data-mode]:not([data-mode="normals"])').forEach((b) => b.classList.remove("is-on"));
    (panel.querySelector('[data-mapvar="temp"]') as HTMLElement)?.click();
    ($("#cl-var") as HTMLSelectElement).value = "temp";
    ($("#cl-year") as HTMLInputElement).value = String(state.year);
    recolorCells(); renderDrawer();
  });
}

function togglePlay() { state.playing ? stopPlay() : startPlay(); }
function startPlay() {
  state.playing = true;
  const btn = $("#cl-play"); if (btn) btn.innerHTML = cIcon("pause", 15);
  if (state.year >= DATA.period.end) state.year = DATA.period.start;
  state.timer = window.setInterval(() => {
    state.year++;
    if (state.year > DATA.period.end) { state.year = DATA.period.end; stopPlay(); }
    ($("#cl-year") as HTMLInputElement).value = String(state.year);
    recolorCells(); if (state.mode === "spatial") renderDrawer();
  }, 360);
}
function stopPlay() { state.playing = false; if (state.timer) clearInterval(state.timer); const btn = $("#cl-play"); if (btn) btn.innerHTML = cIcon("play", 15); }

// ── analysis drawer ────────────────────────────────────────────────────────────
function renderDrawer() {
  const d = $("#cl-drawer-body");
  if (!d) return;
  const v = VARS.find((x) => x.id === state.varId)!;
  const head = (t: string, s: string) => `<div class="cl-card-h"><b>${t}</b><span>${s}</span></div>`;
  const card = (inner: string) => `<div class="cl-card">${inner}</div>`;
  let html = "";

  if (state.mode === "normals") html = drawNormals(v, head, card);
  else if (state.mode === "trends") html = drawTrends(v, head, card);
  else if (state.mode === "extremes") html = drawExtremes(head, card);
  else if (state.mode === "wind") html = drawWind(head, card);
  else if (state.mode === "spatial") html = drawSpatial(head, card);
  else if (state.mode === "projection") html = drawProjection(head, card);

  d.innerHTML = html;
  const dh = $("#cl-drawer-head-t"); if (dh) dh.textContent = MODES.find((m) => m.id === state.mode)!.label;
}

const period = () => `${toNe(DATA.normalPeriod.from)}–${toNe(DATA.normalPeriod.to)}`;
const recordSpan = () => `${toNe(DATA.period.start)}–${toNe(DATA.period.end)}`;

function statRow(items: [string, string][]) {
  return `<div class="cl-stats">${items.map(([k, val]) => `<div class="cl-stat"><b>${val}</b><span>${k}</span></div>`).join("")}</div>`;
}

function drawNormals(v: ClimVar, head: any, card: any) {
  const nk = v.normalKey!;
  const monthVals = DATA.normals.map((m) => m[nk]);
  // seasonal averages
  const seasons = SEASONS.map((s) => {
    const vals = s.months.map((mo) => DATA.normals[mo][nk]).filter((x) => x != null);
    const avg = v.agg === "sum" ? vals.reduce((a, b) => a + b, 0) : vals.reduce((a, b) => a + b, 0) / Math.max(vals.length, 1);
    return { ...s, avg };
  });
  const climo = card(head("जलवायु आरेख (Climograph)", period()) +
    climograph(DATA.normals) + `<div class="cl-note">नीलो स्तम्भ — वर्षा (मि.मि.) · रातो रेखा — औसत तापक्रम (°से)</div>`);
  const monthly = card(head(`${v.label} — मासिक सामान्य`, v.unit) +
    `<table class="cl-table"><thead><tr><th>महिना</th><th>${v.short}</th></tr></thead><tbody>` +
    DATA.normals.map((m, i) => `<tr><td>${MONTHS_NE[i]}</td><td>${m[nk] == null ? "—" : toNe(Number(m[nk]).toFixed(v.decimals))}</td></tr>`).join("") +
    `</tbody></table>`);
  const seasonal = card(head("मौसमी सारांश", v.unit) +
    `<div class="cl-season">${seasons.map((s) => `<div class="cl-season-i" style="border-color:${s.color}"><span class="cl-dot" style="background:${s.color}"></span><div><b>${toNe(s.avg.toFixed(v.decimals))}</b><span>${s.label}</span></div></div>`).join("")}</div>`);
  return climo + seasonal + monthly;
}

function drawTrends(v: ClimVar, head: any, card: any) {
  const ak = v.annualKey!;
  const pts = DATA.annual.filter((a) => a[ak] != null).map((a) => ({ x: a.year, y: a[ak] as number }));
  const reg = linreg(pts);
  const perDecade = reg.slope * 10;
  const first = pts[0]?.y, last = pts[pts.length - 1]?.y;
  const change = last != null && first != null ? last - first : 0;
  const trendCard = card(head(`${v.label} — वार्षिक प्रवृत्ति`, recordSpan()) +
    lineChart([{ name: v.label, color: "#1e293b", pts }], { trend: { color: "#dc2626", slope: reg.slope, intercept: reg.intercept }, yfmt: (x) => toNe(x.toFixed(v.decimals)) }) +
    `<div class="cl-note">रातो धर्के रेखा — दीर्घकालीन रैखिक प्रवृत्ति</div>` +
    statRow([
      [`प्रति दशक परिवर्तन`, `${perDecade >= 0 ? "+" : ""}${toNe(perDecade.toFixed(2))} ${v.unit}`],
      [`${recordSpan()} कुल`, `${change >= 0 ? "+" : ""}${toNe(change.toFixed(v.decimals))} ${v.unit}`],
    ]));
  // decadal anomalies vs normal-period mean
  const base = pts.filter((p) => p.x >= DATA.normalPeriod.from && p.x <= DATA.normalPeriod.to);
  const baseMean = base.reduce((s, p) => s + p.y, 0) / Math.max(base.length, 1);
  const decMap: Record<number, number[]> = {};
  for (const p of pts) { const dec = Math.floor(p.x / 10) * 10; (decMap[dec] ||= []).push(p.y); }
  const decades = Object.keys(decMap).map(Number).sort((a, b) => a - b).map((dec) => ({ decade: dec, anom: decMap[dec].reduce((s, x) => s + x, 0) / decMap[dec].length - baseMean }));
  const anomCard = card(head("दशकीय विचलन", `${period()} औसतबाट`) + anomalyBars(decades, v.unit) +
    `<div class="cl-note">रातो — सामान्यभन्दा बढी · नीलो — सामान्यभन्दा कम</div>`);
  return trendCard + anomCard;
}

function drawExtremes(head: any, card: any) {
  const recent = DATA.annual.filter((a) => a.year >= DATA.period.end - 9);
  const cards = EXTREMES.map((ex) => {
    const pts = DATA.annual.filter((a) => a[ex.id] != null).map((a) => ({ x: a.year, y: a[ex.id] as number }));
    const reg = linreg(pts);
    const recentAvg = recent.map((a) => a[ex.id]).filter((x) => x != null).reduce((s, x) => s + (x as number), 0) / Math.max(recent.length, 1);
    return card(head(ex.label, ex.unit) +
      `<div class="cl-note">${ex.desc}</div>` + barSeries(pts, ex.color) +
      statRow([["हालको १० वर्ष औसत", `${toNe(recentAvg.toFixed(ex.id === "max1" ? 0 : 0))} ${ex.unit}`], ["प्रति दशक", `${reg.slope * 10 >= 0 ? "+" : ""}${toNe((reg.slope * 10).toFixed(1))}`]]));
  });
  return cards.join("");
}

function drawWind(head: any, card: any) {
  const rose = DATA.windRose;
  // dominant direction = sector with most total share
  const totals = rose.data.map((s) => s.reduce((a, b) => a + b, 0));
  const domIdx = totals.indexOf(Math.max(...totals));
  const dirNe: Record<string, string> = { N: "उत्तर", NE: "उत्तर-पूर्व", E: "पूर्व", SE: "दक्षिण-पूर्व", S: "दक्षिण", SW: "दक्षिण-पश्चिम", W: "पश्चिम", NW: "उत्तर-पश्चिम" };
  const dom = rose.dirs[domIdx];
  const domLabel = dirNe[dom] || dom;
  const meanWind = DATA.normals.map((m) => m.wind).filter((x) => x != null);
  const avgWind = meanWind.reduce((a, b) => a + b, 0) / Math.max(meanWind.length, 1);
  const roseCard = card(head("हावा गुलाब (Wind Rose)", period()) + windRose(rose) +
    `<div class="cl-rose-legend">${rose.bins.map((b, i) => `<span class="cl-rl"><span class="cl-rl-sw" style="background:${["#bfdbfe", "#93c5fd", "#60a5fa", "#3b82f6", "#1d4ed8", "#1e3a8a"][i]}"></span>${toNe(b)}${i === rose.bins.length - 1 ? "+" : ""}</span>`).join("")}<span class="cl-rl-unit">कि.मि./घ.</span></div>` +
    statRow([["प्रमुख दिशा", domLabel], ["औसत गति", `${toNe(avgWind.toFixed(1))} कि.मि./घ.`], ["शान्त समय", `${toNe(rose.calm)}%`]]));
  return roseCard;
}

function drawSpatial(head: any, card: any) {
  const which = state.mapVar === "precip" ? "p" : "t";
  const v = VARS.find((x) => x.id === state.mapVar)!;
  const rows = DATA.gridAnnual.map((g) => {
    const y = g.years.find((yy) => yy.year === state.year);
    return { row: g.row, col: g.col, val: y ? y[which] : null };
  });
  const vals = rows.map((r) => r.val).filter((x) => x != null) as number[];
  const lo = Math.min(...vals), hi = Math.max(...vals), mean = vals.reduce((a, b) => a + b, 0) / Math.max(vals.length, 1);
  const gridCard = card(head(`${v.label} — ${toNe(state.year)}`, v.unit) +
    `<div class="cl-note">वर्ष स्लाइडर चलाएर वा ▶ थिचेर ${recordSpan()} सम्मको परिवर्तन हेर्नुहोस् । ERA5 पुनर्विश्लेषण (~९ कि.मि. ग्रिड), तुलसीपुरभित्र ३×३ कक्षमा प्रक्षेपित ।</div>` +
    statRow([["न्यूनतम", `${toNe(lo.toFixed(v.decimals))}`], ["औसत", `${toNe(mean.toFixed(v.decimals))}`], ["अधिकतम", `${toNe(hi.toFixed(v.decimals))}`]]));
  // also show the centroid annual line for context
  const ak = state.mapVar === "precip" ? "precip" : "t_mean";
  const pts = DATA.annual.filter((a) => a[ak] != null).map((a) => ({ x: a.year, y: a[ak] as number }));
  const reg = linreg(pts);
  const trendCard = card(head(`केन्द्रबिन्दु वार्षिक ${v.short}`, recordSpan()) +
    lineChart([{ name: v.label, color: "#1e293b", pts }], { trend: { color: "#dc2626", slope: reg.slope, intercept: reg.intercept }, yfmt: (x) => toNe(x.toFixed(v.decimals)) }));
  return gridCard + trendCard;
}

function drawProjection(head: any, card: any) {
  if (!DATA.projections || !DATA.projections.length)
    return card(head("भविष्य प्रक्षेपण", "") + `<div class="cl-note">प्रक्षेपण तथ्याङ्क उपलब्ध छैन ।</div>`);
  const histT = DATA.annual.filter((a) => a.t_mean != null).map((a) => ({ x: a.year, y: a.t_mean as number }));
  const projT = DATA.projections.map((p) => ({ x: p.year, y: p.t_mean }));
  const histP = DATA.annual.filter((a) => a.precip != null).map((a) => ({ x: a.year, y: a.precip as number }));
  const projP = DATA.projections.map((p) => ({ x: p.year, y: p.precip }));
  const lastHist = histT[histT.length - 1]?.y, end = projT[projT.length - 1]?.y;
  const tempCard = card(head("तापक्रम प्रक्षेपण (→ २०५०)", "°से · CMIP6") +
    lineChart([{ name: "ऐतिहासिक", color: "#1e293b", pts: histT }, { name: "प्रक्षेपण", color: "#dc2626", pts: projT, dash: true }], { yfmt: (x) => toNe(x.toFixed(1)) }) +
    `<div class="cl-note">कालो — ऐतिहासिक (ERA5) · रातो धर्के — CMIP6 प्रक्षेपण (MRI-AGCM3)</div>` +
    statRow([["२०५० सम्म औसत", `${toNe((end ?? 0).toFixed(1))} °से`], ["हालको स्तरबाट", `${end != null && lastHist != null ? (end - lastHist >= 0 ? "+" : "") + toNe((end - lastHist).toFixed(1)) : "—"} °से`]]));
  const precCard = card(head("वर्षा प्रक्षेपण (→ २०५०)", "मि.मि. · CMIP6") +
    lineChart([{ name: "ऐतिहासिक", color: "#1e293b", pts: histP }, { name: "प्रक्षेपण", color: "#2563eb", pts: projP, dash: true }], { yfmt: (x) => toNe(Math.round(x)) }));
  return tempCard + precCard;
}

// ── map click → cell value popup ───────────────────────────────────────────────
function wireMapInspect() {
  const popup = new maplibregl.Popup({ closeButton: true, maxWidth: "240px", className: "geo-popup" });
  map.on("click", "clim-grid", (e) => {
    const f = e.features![0]; const v = VARS.find((x) => x.id === state.mapVar)!;
    const val = f.properties!.val;
    popup.setLngLat(e.lngLat).setHTML(`<div class="gp-cat">${v.label} · ${toNe(state.year)}</div><div class="gp-name">${val == null ? "—" : toNe(Number(val).toFixed(v.decimals))} ${v.unit}</div>`).addTo(map);
  });
  map.on("mouseenter", "clim-grid", () => (map.getCanvas().style.cursor = "pointer"));
  map.on("mouseleave", "clim-grid", () => (map.getCanvas().style.cursor = ""));
}

// ── legend ─────────────────────────────────────────────────────────────────────
function buildLegend() {
  const el = $("#geo-legend-body");
  if (!el) return;
  const v = VARS.find((x) => x.id === state.mapVar)!;
  const stops = v.scale;
  el.innerHTML = `<div class="lg-grp">${v.label} (${v.unit})</div>` +
    stops.map((s, i) => `<div class="lg-row"><span class="geo-sw" style="background:${s[1]}"></span>${i === 0 ? "<" : "≥"} ${toNe(s[0])}</div>`).join("") +
    `<div class="lg-grp" style="margin-top:8px">वर्ष: ${toNe(state.year)}</div>`;
}
