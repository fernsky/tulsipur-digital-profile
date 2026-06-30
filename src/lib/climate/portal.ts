// Climate portal controller: boots a lean MapLibre map (basemap + ward context
// + a climate heatmap bound to the municipality) and an analysis drawer driven
// by mode. Two data sources, merged behind one variable picker:
//   • climate.json   — Open-Meteo ERA5 daily (1940–): temp/precip/humidity/
//     pressure/cloud/wind + extremes + wind rose + CMIP6 projections (3×3 grid,
//     animated by year).
//   • era5land.json  — Copernicus ERA5-Land monthly (1950–): soil temp/moisture,
//     snow, vegetation, dewpoint, sea-level pressure, 100 m wind, CAPE … at
//     0.1° (~9 km) → finer static long-term heatmap.
import maplibregl from "maplibre-gl";
import { BASEMAPS } from "../geo/labels";
import {
  VARS, EXTREMES, MODES, MONTHS_NE, SEASONS, CATEGORIES, PALETTES, rampColor, rampFromRange,
  paletteFor, cIcon, toNe, MUNI_BOUNDS, MUNI_CENTER, type ClimVar,
} from "./labels";
import { lineChart, climograph, barSeries, anomalyBars, windRose } from "./charts";
import { VAR_DESC, statInterpretation } from "./descriptions";

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
type ExtraVar = { id: string; label: string; unit: string; category: string; decimals: number; normals: (number | null)[]; annual: { year: number; v: number }[]; trend: number; grid: { lat: number; lng: number; v: number }[]; cells: { lat: number; lng: number }[]; gridYears: { year: number; v: (number | null)[] }[]; vmin: number; vmax: number };
type Extra = { area: number[]; normalPeriod: { from: number; to: number }; source: string; categories: Record<string, string>; vars: Record<string, ExtraVar> };

// unified variable descriptor used by the picker, drawer and map
type UVar = {
  id: string; label: string; short: string; unit: string; decimals: number; category: string;
  source: "core" | "extra";
  normals: () => (number | null)[];          // [12]
  annual: () => { year: number; v: number }[];
  scale: () => [number, string][];
  spatial: "grid" | "uniform" | "none";       // grid = real cells; uniform = single-cell fill
  years: () => [number, number];              // available animation range
  cellsFC: (year: number) => GeoJSON.FeatureCollection; // map features for a year
};

const $ = (s: string, r: Document | HTMLElement = document) => r.querySelector(s) as HTMLElement;
const state = { mode: "normals", varId: "temp", year: 0, playing: false, timer: 0 as number | undefined };

let DATA: Data, EXTRA: Extra | null = null, UVARS: UVar[] = [], map: maplibregl.Map;

function linreg(pts: { x: number; y: number }[]) {
  const n = pts.length; if (n < 2) return { slope: 0, intercept: 0 };
  let sx = 0, sy = 0, sxx = 0, sxy = 0;
  for (const { x, y } of pts) { sx += x; sy += y; sxx += x * x; sxy += x * y; }
  const d = n * sxx - sx * sx; const slope = d === 0 ? 0 : (n * sxy - sx * sy) / d;
  return { slope, intercept: (sy - slope * sx) / n };
}
const uvar = (id: string) => UVARS.find((v) => v.id === id)!;

// fixed 3×3 cell polygons tessellating the municipality bbox (Open-Meteo grid)
function grid3x3Polys() {
  const [w, s, e, n] = DATA.bounds;
  const lats = [...new Set(DATA.grid.map((g) => g.lat))].sort((a, b) => b - a);
  const lngs = [...new Set(DATA.grid.map((g) => g.lng))].sort((a, b) => a - b);
  const latE = [n, ...lats.slice(0, -1).map((_, i) => (lats[i] + lats[i + 1]) / 2), s];
  const lngE = [w, ...lngs.slice(0, -1).map((_, i) => (lngs[i] + lngs[i + 1]) / 2), e];
  const polys: { row: number; col: number; coords: number[][][] }[] = [];
  for (let r = 0; r < lats.length; r++) for (let c = 0; c < lngs.length; c++)
    polys.push({ row: r, col: c, coords: [[[lngE[c], latE[r]], [lngE[c + 1], latE[r]], [lngE[c + 1], latE[r + 1]], [lngE[c], latE[r + 1]], [lngE[c], latE[r]]]] });
  return polys;
}

// ── build the unified variable list (core + ERA5-Land), every var animatable ──
function buildUVars() {
  const list: UVar[] = [];
  const corePal: Record<string, string> = { rh: "moisture", et0: "moisture", srad: "temp", cloud: "generic", pressure: "generic", wind: "generic" };
  for (const v of VARS as ClimVar[]) {
    const annual = () => DATA.annual.filter((a) => a[v.annualKey!] != null).map((a) => ({ year: a.year, v: a[v.annualKey!] as number }));
    const isTP = v.id === "temp" || v.id === "precip";
    let ramp: [number, string][];
    if (v.scale.length) ramp = v.scale;
    else { const ys = annual().map((a) => a.v); ramp = rampFromRange(Math.min(...ys), Math.max(...ys), PALETTES[corePal[v.id] || "generic"]); }
    const which = v.id === "precip" ? "p" : "t";
    const annualMap = new Map(DATA.annual.map((a) => [a.year, a[v.annualKey!] as number]));
    const cellsFC = (year: number): GeoJSON.FeatureCollection => ({
      type: "FeatureCollection",
      features: grid3x3Polys().map((p) => {
        let val: number | null;
        if (isTP) { const g = DATA.gridAnnual.find((x) => x.row === p.row && x.col === p.col); const yy = g?.years.find((y) => y.year === year); val = yy ? (yy as any)[which] : null; }
        else { val = annualMap.get(year) ?? null; }
        return { type: "Feature" as const, properties: { val, color: rampColor(val, ramp) }, geometry: { type: "Polygon" as const, coordinates: p.coords } };
      }),
    });
    const yrs = annual();
    list.push({
      id: v.id, label: v.label, short: v.short, unit: v.unit, decimals: v.decimals, category: "core", source: "core",
      normals: () => DATA.normals.map((m) => m[v.normalKey!]), annual, scale: () => ramp,
      spatial: isTP ? "grid" : "uniform",
      years: () => isTP ? [DATA.period.start, DATA.period.end] : [yrs[0]?.year ?? DATA.period.start, yrs.at(-1)?.year ?? DATA.period.end],
      cellsFC,
    });
  }
  if (EXTRA) {
    for (const e of Object.values(EXTRA.vars)) {
      const ramp = rampFromRange(e.vmin, e.vmax, paletteFor(e.id, e.category));
      const lats = [...new Set(e.cells.map((c) => c.lat))].sort((a, b) => a - b);
      const lons = [...new Set(e.cells.map((c) => c.lng))].sort((a, b) => a - b);
      const hy = (lats.length > 1 ? Math.abs(lats[1] - lats[0]) : 0.1) / 2;
      const hx = (lons.length > 1 ? Math.abs(lons[1] - lons[0]) : 0.1) / 2;
      const byYear = new Map(e.gridYears.map((g) => [g.year, g.v]));
      const cellsFC = (year: number): GeoJSON.FeatureCollection => {
        const vals = byYear.get(year) || e.cells.map(() => null);
        return { type: "FeatureCollection", features: e.cells.map((c, i) => ({ type: "Feature" as const, properties: { val: vals[i], color: rampColor(vals[i], ramp) }, geometry: { type: "Polygon" as const, coordinates: [[[c.lng - hx, c.lat + hy], [c.lng + hx, c.lat + hy], [c.lng + hx, c.lat - hy], [c.lng - hx, c.lat - hy], [c.lng - hx, c.lat + hy]]] } })) };
      };
      list.push({
        id: e.id, label: e.label, short: e.label, unit: e.unit, decimals: e.decimals ?? 1, category: e.category, source: "extra",
        normals: () => e.normals, annual: () => e.annual, scale: () => ramp,
        spatial: e.gridYears.length ? "grid" : "none",
        years: () => [e.gridYears[0]?.year ?? 1950, e.gridYears.at(-1)?.year ?? DATA.period.end],
        cellsFC,
      });
    }
  }
  return list;
}

function renderMap() {
  const v = uvar(state.varId);
  const src = map.getSource("clim-grid") as maplibregl.GeoJSONSource;
  if (!src) return;
  if (v.spatial !== "none") { src.setData(v.cellsFC(state.year) as any); map.setLayoutProperty("clim-grid", "visibility", "visible"); }
  else map.setLayoutProperty("clim-grid", "visibility", "none");
  const yEl = $("#cl-year-val"); if (yEl) yEl.textContent = toNe(state.year);
  buildLegend();
}

// ── map ──────────────────────────────────────────────────────────────────────
function leanStyle(basemapId: string): maplibregl.StyleSpecification {
  const bm = BASEMAPS.find((b) => b.id === basemapId) || BASEMAPS[0];
  const origin = typeof location !== "undefined" ? location.origin : "";
  return {
    version: 8, glyphs: "https://demotiles.maplibre.org/font/{fontstack}/{range}.pbf",
    sources: {
      basemap: { type: "raster", tiles: bm.url ? [bm.url] : [], tileSize: 256, maxzoom: bm.maxzoom ?? 19, attribution: bm.attribution, bounds: MUNI_BOUNDS },
      base: { type: "vector", tiles: [`${origin}/geo/base/{z}/{x}/{y}.pbf`], minzoom: 6, maxzoom: 15 },
    },
    layers: [{ id: "basemap", type: "raster", source: "basemap" }],
  } as maplibregl.StyleSpecification;
}

function addOverlays() {
  const origin = location.origin;
  map.addSource("clim-grid", { type: "geojson", data: { type: "FeatureCollection", features: [] } });
  map.addLayer({ id: "clim-grid", type: "fill", source: "clim-grid", paint: { "fill-color": ["get", "color"], "fill-opacity": 0.62, "fill-outline-color": "#ffffff44" } });
  map.addSource("muni-mask", { type: "geojson", data: `${origin}/geo/mask.geojson` });
  map.addLayer({ id: "muni-mask", type: "fill", source: "muni-mask", paint: { "fill-color": "#ffffff", "fill-opacity": 1 } });
  map.addLayer({ id: "wards-line", type: "line", source: "base", "source-layer": "wards", paint: { "line-color": "#1e293b", "line-width": ["interpolate", ["linear"], ["zoom"], 9, 0.8, 14, 2], "line-opacity": 0.55 } });
  map.addLayer({ id: "wards-label", type: "symbol", source: "base", "source-layer": "wards", layout: { "text-field": ["concat", "वडा ", ["to-string", ["get", "ward"]]], "text-font": ["Open Sans Regular"], "text-size": 12 }, paint: { "text-color": "#0f172a", "text-halo-color": "#ffffff", "text-halo-width": 1.6 } });
  map.addLayer({ id: "municipality", type: "line", source: "base", "source-layer": "municipality", paint: { "line-color": "#0f172a", "line-width": 2.5, "line-dasharray": [2, 1.5] } });
  renderMap();
}

export async function initClimate() {
  const hud = $("#geo-hud"), hudText = $("#geo-hud-text");
  const setHud = (m: string) => { if (hudText) hudText.textContent = m; if (hud) hud.style.display = "flex"; };
  const hideHud = () => { if (hud) hud.style.display = "none"; };
  setHud("जलवायु तथ्याङ्क लोड हुँदैछ…");

  DATA = await fetch("/climate/climate.json").then((r) => r.json());
  EXTRA = await fetch("/climate/era5land.json").then((r) => r.ok ? r.json() : null).catch(() => null);
  UVARS = buildUVars();
  state.year = DATA.period.end;

  const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
  let basemap = "esri-street";
  map = new maplibregl.Map({
    container: "geo-map", style: leanStyle(basemap), center: MUNI_CENTER,
    zoom: reduce ? 10.6 : 9.8, pitch: reduce ? 0 : 38, bearing: reduce ? 0 : -14,
    maxZoom: 14, minZoom: 8,
    maxBounds: [[MUNI_BOUNDS[0] - 0.18, MUNI_BOUNDS[1] - 0.18], [MUNI_BOUNDS[2] + 0.18, MUNI_BOUNDS[3] + 0.18]],
    pitchWithRotate: true, dragRotate: true, attributionControl: { compact: true },
  });
  map.addControl(new maplibregl.NavigationControl({ visualizePitch: true }), "top-right");
  map.addControl(new maplibregl.ScaleControl({ unit: "metric" }), "bottom-left");
  (window as any).__climMap = map;

  map.on("load", () => {
    addOverlays(); wirePanel(); wireMapInspect(); renderDrawer();
    if (!reduce) map.once("idle", () => map.easeTo({ center: MUNI_CENTER, zoom: 10.6, pitch: 36, bearing: 6, duration: 3600, easing: (t) => t * (2 - t) }));
    hideHud();
  });
  map.on("idle", () => { if (map.areTilesLoaded()) hideHud(); });

  (window as any).__setBasemap = (id: string) => {
    if (map.getLayer("basemap")) map.setLayoutProperty("basemap", "visibility", id === "none" ? "none" : "visible");
    const bm = BASEMAPS.find((b) => b.id === id);
    const src = map.getSource("basemap") as maplibregl.RasterTileSource;
    if (id !== "none" && bm?.url && (src as any).setTiles) (src as any).setTiles([bm.url]);
  };
}

// ── control panel ─────────────────────────────────────────────────────────────
function varOptions() {
  const order = ["core", "soil", "snow", "veg", "land", "atmos"];
  return order.map((g) => {
    const items = UVARS.filter((v) => v.category === g);
    if (!items.length) return "";
    return `<optgroup label="${CATEGORIES[g] || g}">` +
      items.map((v) => `<option value="${v.id}"${v.id === state.varId ? " selected" : ""}>${v.label}</option>`).join("") + `</optgroup>`;
  }).join("");
}

function wirePanel() {
  const panel = $("#geo-panel-body");
  if (!panel) return;
  const modeHtml = MODES.map((m) => `<button class="geo-chip${m.id === state.mode ? " is-on" : ""}" data-mode="${m.id}">${cIcon(m.icon, 14)}<span>${m.label}</span></button>`).join("");
  const basemapHtml = BASEMAPS.map((b) => `<button class="geo-chip${b.id === "esri-street" ? " is-on" : ""}" data-basemap="${b.id}">${b.label}</button>`).join("");
  const extraCount = EXTRA ? Object.keys(EXTRA.vars).length : 0;

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
      <div class="geo-sec-h">${cIcon("thermometer", 15)}<span>जलवायु चल</span><span class="geo-count">${toNe(UVARS.length)} सूचक</span></div>
      <select id="cl-var" class="geo-select">${varOptions()}</select>
      ${extraCount ? `<div class="cl-note" style="margin-top:6px">${toNe(extraCount)} थप सूचक: Copernicus ERA5-Land (०.१° · ~९ कि.मि.)</div>` : ""}
    </section>
    <section class="geo-sec" id="cl-year-sec">
      <div class="geo-sec-h">${cIcon("map", 15)}<span>नक्सा हिटम्याप · वर्ष</span></div>
      <label class="geo-row"><input type="checkbox" id="cl-grid-toggle" checked/><span>हिटम्याप देखाउनुहोस्</span></label>
      <label class="geo-row"><input type="checkbox" id="cl-ward-toggle" checked/><span>वडा सिमाना</span></label>
      <div class="cl-slider-wrap" id="cl-slider">
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

  panel.querySelectorAll("[data-mode]").forEach((el) => el.addEventListener("click", () => {
    panel.querySelectorAll("[data-mode]").forEach((b) => b.classList.remove("is-on"));
    el.classList.add("is-on"); state.mode = (el as HTMLElement).dataset.mode!; renderDrawer();
  }));
  $("#cl-var")?.addEventListener("change", (e) => { state.varId = (e.target as HTMLSelectElement).value; onVarChange(); });
  $("#cl-grid-toggle")?.addEventListener("change", (e) => map.setLayoutProperty("clim-grid", "visibility", (e.target as HTMLInputElement).checked ? "visible" : "none"));
  $("#cl-ward-toggle")?.addEventListener("change", (e) => { const v = (e.target as HTMLInputElement).checked ? "visible" : "none"; ["wards-line", "wards-label"].forEach((id) => map.getLayer(id) && map.setLayoutProperty(id, "visibility", v)); });
  $("#cl-year")?.addEventListener("input", (e) => { stopPlay(); state.year = +(e.target as HTMLInputElement).value; renderMap(); if (state.mode === "spatial") renderDrawer(); });
  $("#cl-play")?.addEventListener("click", togglePlay);
  panel.querySelectorAll("[data-basemap]").forEach((el) => el.addEventListener("click", () => { panel.querySelectorAll("[data-basemap]").forEach((b) => b.classList.remove("is-on")); el.classList.add("is-on"); (window as any).__setBasemap((el as HTMLElement).dataset.basemap); }));
  const legendEl = $("#geo-legend"), legBtn = panel.querySelector("#geo-legend-toggle") as HTMLElement;
  legBtn?.addEventListener("click", () => { const on = legBtn.classList.toggle("is-on"); legBtn.setAttribute("aria-pressed", on ? "true" : "false"); if (legendEl) legendEl.style.display = on ? "" : "none"; });
  $("#geo-reset")?.addEventListener("click", () => {
    stopPlay(); state.mode = "normals"; state.varId = "temp"; state.year = DATA.period.end;
    (panel.querySelector('[data-mode="normals"]') as HTMLElement)?.classList.add("is-on");
    panel.querySelectorAll('[data-mode]:not([data-mode="normals"])').forEach((b) => b.classList.remove("is-on"));
    ($("#cl-var") as HTMLSelectElement).value = "temp"; ($("#cl-year") as HTMLInputElement).value = String(state.year);
    onVarChange();
  });
  updateYearControl();
}

// when the variable changes: clamp the year to the var's range, update everything
function onVarChange() { updateYearControl(); renderMap(); renderDrawer(); }

// every indicator is animatable; show the slider and fit it to the var's years
function updateYearControl() {
  const v = uvar(state.varId);
  const slider = $("#cl-slider");
  if (v.spatial === "none") { if (slider) slider.style.display = "none"; return; }
  if (slider) slider.style.display = "";
  const [y0, y1] = v.years();
  const input = $("#cl-year") as HTMLInputElement;
  if (input) {
    input.min = String(y0); input.max = String(y1);
    if (state.year < y0) state.year = y0; if (state.year > y1) state.year = y1;
    input.value = String(state.year);
  }
  const yEl = $("#cl-year-val"); if (yEl) yEl.textContent = toNe(state.year);
  const ends = document.querySelectorAll(".cl-slider-ends span");
  if (ends.length === 2) { ends[0].textContent = toNe(y0); ends[1].textContent = toNe(y1); }
}

function togglePlay() { state.playing ? stopPlay() : startPlay(); }
function startPlay() {
  const v = uvar(state.varId); if (v.spatial === "none") return;
  const [y0, y1] = v.years();
  state.playing = true; const btn = $("#cl-play"); if (btn) btn.innerHTML = cIcon("pause", 15);
  if (state.year >= y1) state.year = y0;
  state.timer = window.setInterval(() => {
    state.year++; if (state.year > y1) { state.year = y1; stopPlay(); }
    ($("#cl-year") as HTMLInputElement).value = String(state.year);
    renderMap(); if (state.mode === "spatial") renderDrawer();
  }, 360);
}
function stopPlay() { state.playing = false; if (state.timer) clearInterval(state.timer); const btn = $("#cl-play"); if (btn) btn.innerHTML = cIcon("play", 15); }

// ── analysis drawer ────────────────────────────────────────────────────────────
const period = () => `${toNe(DATA.normalPeriod.from)}–${toNe(DATA.normalPeriod.to)}`;
const recordSpan = (v?: UVar) => { const a = (v || uvar(state.varId)).annual(); const s = a[0]?.year ?? DATA.period.start, e = a.at(-1)?.year ?? DATA.period.end; return `${toNe(s)}–${toNe(e)}`; };
const head = (t: string, s: string) => `<div class="cl-card-h"><b>${t}</b><span>${s}</span></div>`;
const card = (inner: string) => `<div class="cl-card">${inner}</div>`;
function statRow(items: [string, string][]) { return `<div class="cl-stats">${items.map(([k, val]) => `<div class="cl-stat"><b>${val}</b><span>${k}</span></div>`).join("")}</div>`; }

function renderDrawer() {
  const d = $("#cl-drawer-body"); if (!d) return;
  let html = "";
  if (state.mode === "normals") html = drawNormals();
  else if (state.mode === "trends") html = drawTrends();
  else if (state.mode === "extremes") html = drawExtremes();
  else if (state.mode === "wind") html = drawWind();
  else if (state.mode === "spatial") html = drawSpatial();
  else if (state.mode === "projection") html = drawProjection();
  d.innerHTML = html;
  const dh = $("#cl-drawer-head-t"); if (dh) dh.textContent = MODES.find((m) => m.id === state.mode)!.label;
}

// first-principles explanation + plain-language statistical reading per indicator
function interpCard(v: UVar) {
  const nrm = v.normals();
  const valid = nrm.map((val, i) => ({ val, i })).filter((o) => o.val != null) as { val: number; i: number }[];
  if (!valid.length) return "";
  const warm = valid.reduce((a, b) => (b.val > a.val ? b : a));
  const cold = valid.reduce((a, b) => (b.val < a.val ? b : a));
  const pts = v.annual().map((a) => ({ x: a.year, y: a.v }));
  const reg = linreg(pts);
  const base = pts.filter((p) => p.x >= DATA.normalPeriod.from && p.x <= DATA.normalPeriod.to);
  const baseMean = base.length ? base.reduce((s, p) => s + p.y, 0) / base.length : null;
  const s = {
    unit: v.unit, decimals: v.decimals, baseMean, perDecade: reg.slope * 10,
    totalChange: (pts.at(-1)?.y ?? 0) - (pts[0]?.y ?? 0),
    warmIdx: warm.i, warmVal: warm.val, coldIdx: cold.i, coldVal: cold.val,
    y0: pts[0]?.x ?? DATA.period.start, y1: pts.at(-1)?.x ?? DATA.period.end, agg: "mean" as const,
  };
  const d = VAR_DESC[v.id];
  const intro = d ? `<p class="cl-prose">${d.what}</p><p class="cl-prose">${d.why}</p>` : "";
  return card(head(`${v.label} — व्याख्या र विश्लेषण`, v.source === "extra" ? "ERA5-Land" : "ERA5") +
    intro + `<p class="cl-prose cl-prose-stat">${statInterpretation(v.id, s)}</p>`);
}

function drawNormals() {
  const v = uvar(state.varId); const nrm = v.normals();
  const climo = (v.id === "temp" || v.id === "precip")
    ? card(head("जलवायु आरेख (Climograph)", period()) + climograph(DATA.normals) + `<div class="cl-note">नीलो स्तम्भ — वर्षा (मि.मि.) · रातो रेखा — औसत तापक्रम (°से)</div>`)
    : "";
  const seasons = SEASONS.map((s) => {
    const vals = s.months.map((mo) => nrm[mo]).filter((x) => x != null) as number[];
    return { ...s, avg: vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : null };
  });
  const seasonal = card(head(`${v.label} — मौसमी सामान्य`, v.unit) +
    `<div class="cl-season">${seasons.map((s) => `<div class="cl-season-i" style="border-color:${s.color}"><span class="cl-dot" style="background:${s.color}"></span><div><b>${s.avg == null ? "—" : toNe(s.avg.toFixed(v.decimals))}</b><span>${s.label}</span></div></div>`).join("")}</div>`);
  const monthly = card(head(`${v.label} — मासिक सामान्य`, `${v.unit} · ${period()}`) +
    `<table class="cl-table"><thead><tr><th>महिना</th><th>${v.short}</th></tr></thead><tbody>` +
    nrm.map((m, i) => `<tr><td>${MONTHS_NE[i]}</td><td>${m == null ? "—" : toNe(Number(m).toFixed(v.decimals))}</td></tr>`).join("") + `</tbody></table>`);
  return interpCard(v) + climo + seasonal + monthly;
}

function drawTrends() {
  const v = uvar(state.varId);
  const pts = v.annual().map((a) => ({ x: a.year, y: a.v }));
  const reg = linreg(pts); const perDecade = reg.slope * 10;
  const first = pts[0]?.y, last = pts.at(-1)?.y; const change = last != null && first != null ? last - first : 0;
  const trendCard = card(head(`${v.label} — वार्षिक प्रवृत्ति`, recordSpan(v)) +
    lineChart([{ name: v.label, color: "#1e293b", pts }], { trend: { color: "#dc2626", slope: reg.slope, intercept: reg.intercept }, yfmt: (x) => toNe(x.toFixed(v.decimals)) }) +
    `<div class="cl-note">रातो धर्के रेखा — दीर्घकालीन रैखिक प्रवृत्ति${v.source === "extra" ? " · स्रोत ERA5-Land" : ""}</div>` +
    statRow([[`प्रति दशक परिवर्तन`, `${perDecade >= 0 ? "+" : ""}${toNe(perDecade.toFixed(2))} ${v.unit}`], [`कुल परिवर्तन`, `${change >= 0 ? "+" : ""}${toNe(change.toFixed(v.decimals))} ${v.unit}`]]));
  const base = pts.filter((p) => p.x >= DATA.normalPeriod.from && p.x <= DATA.normalPeriod.to);
  const baseMean = base.length ? base.reduce((s, p) => s + p.y, 0) / base.length : 0;
  const decMap: Record<number, number[]> = {};
  for (const p of pts) { const dec = Math.floor(p.x / 10) * 10; (decMap[dec] ||= []).push(p.y); }
  const decades = Object.keys(decMap).map(Number).sort((a, b) => a - b).map((dec) => ({ decade: dec, anom: decMap[dec].reduce((s, x) => s + x, 0) / decMap[dec].length - baseMean }));
  const anomCard = card(head("दशकीय विचलन", `${period()} औसतबाट`) + anomalyBars(decades, v.unit) + `<div class="cl-note">रातो — सामान्यभन्दा बढी · नीलो — कम</div>`);
  return interpCard(v) + trendCard + anomCard;
}

function drawExtremes() {
  const recent = DATA.annual.filter((a) => a.year >= DATA.period.end - 9);
  return EXTREMES.map((ex) => {
    const pts = DATA.annual.filter((a) => a[ex.id] != null).map((a) => ({ x: a.year, y: a[ex.id] as number }));
    const reg = linreg(pts);
    const recentAvg = recent.map((a) => a[ex.id]).filter((x) => x != null).reduce((s, x) => s + (x as number), 0) / Math.max(recent.length, 1);
    return card(head(ex.label, ex.unit) + `<div class="cl-note">${ex.desc}</div>` + barSeries(pts, ex.color) +
      statRow([["हालको १० वर्ष औसत", `${toNe(recentAvg.toFixed(0))} ${ex.unit}`], ["प्रति दशक", `${reg.slope * 10 >= 0 ? "+" : ""}${toNe((reg.slope * 10).toFixed(1))}`]]));
  }).join("");
}

function drawWind() {
  const rose = DATA.windRose;
  const totals = rose.data.map((s) => s.reduce((a, b) => a + b, 0));
  const dom = rose.dirs[totals.indexOf(Math.max(...totals))];
  const dirNe: Record<string, string> = { N: "उत्तर", NE: "उत्तर-पूर्व", E: "पूर्व", SE: "दक्षिण-पूर्व", S: "दक्षिण", SW: "दक्षिण-पश्चिम", W: "पश्चिम", NW: "उत्तर-पश्चिम" };
  const meanWind = DATA.normals.map((m) => m.wind).filter((x) => x != null);
  const avgWind = meanWind.reduce((a, b) => a + b, 0) / Math.max(meanWind.length, 1);
  return card(head("हावा गुलाब (Wind Rose)", period()) + windRose(rose) +
    `<div class="cl-rose-legend">${rose.bins.map((b, i) => `<span class="cl-rl"><span class="cl-rl-sw" style="background:${["#bfdbfe", "#93c5fd", "#60a5fa", "#3b82f6", "#1d4ed8", "#1e3a8a"][i]}"></span>${toNe(b)}${i === rose.bins.length - 1 ? "+" : ""}</span>`).join("")}<span class="cl-rl-unit">कि.मि./घ.</span></div>` +
    statRow([["प्रमुख दिशा", dirNe[dom] || dom], ["औसत गति", `${toNe(avgWind.toFixed(1))} कि.मि./घ.`], ["शान्त समय", `${toNe(rose.calm)}%`]]));
}

function drawSpatial() {
  const v = uvar(state.varId);
  if (v.spatial === "none")
    return card(head(`${v.label} — स्थानिक`, "") + `<div class="cl-note">यस सूचकको स्थानिक तह उपलब्ध छैन ।</div>`);
  const fc = v.cellsFC(state.year);
  const vals = fc.features.map((f) => f.properties!.val).filter((x) => x != null) as number[];
  const lo = vals.length ? Math.min(...vals) : 0, hi = vals.length ? Math.max(...vals) : 0;
  const mean = vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : 0;
  const srcNote = v.source === "extra"
    ? `Copernicus ERA5-Land ०.१° (~९ कि.मि.) · ${toNe(fc.features.length)} कक्ष`
    : v.spatial === "grid" ? `ERA5 (~२८ कि.मि.) ३×३ कक्षमा प्रक्षेपित` : `ERA5 एकल कक्ष — स्थानिक रूपमा एकसमान`;
  const gridCard = card(head(`${v.label} — ${toNe(state.year)}`, v.unit) +
    `<div class="cl-note">वर्ष स्लाइडर वा ▶ ले ${recordSpan(v)} सम्मको परिवर्तन हेर्नुहोस् । ${srcNote} ।</div>` +
    statRow([["न्यूनतम", toNe(lo.toFixed(v.decimals))], ["औसत", toNe(mean.toFixed(v.decimals))], ["अधिकतम", toNe(hi.toFixed(v.decimals))]]));
  const pts = v.annual().map((a) => ({ x: a.year, y: a.v })); const reg = linreg(pts);
  const trendCard = card(head(`वार्षिक ${v.short} (समय-श्रृंखला)`, recordSpan(v)) + lineChart([{ name: v.label, color: "#1e293b", pts }], { trend: { color: "#dc2626", slope: reg.slope, intercept: reg.intercept }, yfmt: (x) => toNe(x.toFixed(v.decimals)) }));
  return interpCard(v) + gridCard + trendCard;
}

function drawProjection() {
  if (!DATA.projections || !DATA.projections.length) return card(head("भविष्य प्रक्षेपण", "") + `<div class="cl-note">प्रक्षेपण तथ्याङ्क उपलब्ध छैन ।</div>`);
  const histT = DATA.annual.filter((a) => a.t_mean != null).map((a) => ({ x: a.year, y: a.t_mean as number }));
  const projT = DATA.projections.map((p) => ({ x: p.year, y: p.t_mean }));
  const histP = DATA.annual.filter((a) => a.precip != null).map((a) => ({ x: a.year, y: a.precip as number }));
  const projP = DATA.projections.map((p) => ({ x: p.year, y: p.precip }));
  const lastHist = histT.at(-1)?.y, end = projT.at(-1)?.y;
  const tempCard = card(head("तापक्रम प्रक्षेपण (→ २०५०)", "°से · CMIP6") +
    lineChart([{ name: "ऐतिहासिक", color: "#1e293b", pts: histT }, { name: "प्रक्षेपण", color: "#dc2626", pts: projT, dash: true }], { yfmt: (x) => toNe(x.toFixed(1)) }) +
    `<div class="cl-note">कालो — ऐतिहासिक (ERA5) · रातो धर्के — CMIP6 (MRI-AGCM3)</div>` +
    statRow([["२०५० सम्म औसत", `${toNe((end ?? 0).toFixed(1))} °से`], ["हालबाट", `${end != null && lastHist != null ? (end - lastHist >= 0 ? "+" : "") + toNe((end - lastHist).toFixed(1)) : "—"} °से`]]));
  const precCard = card(head("वर्षा प्रक्षेपण (→ २०५०)", "मि.मि. · CMIP6") + lineChart([{ name: "ऐतिहासिक", color: "#1e293b", pts: histP }, { name: "प्रक्षेपण", color: "#2563eb", pts: projP, dash: true }], { yfmt: (x) => toNe(Math.round(x)) }));
  return tempCard + precCard;
}

function wireMapInspect() {
  const popup = new maplibregl.Popup({ closeButton: true, maxWidth: "240px", className: "geo-popup" });
  map.on("click", "clim-grid", (e) => {
    const f = e.features![0]; const v = uvar(state.varId); const val = f.properties!.val;
    const when = toNe(state.year);
    popup.setLngLat(e.lngLat).setHTML(`<div class="gp-cat">${v.label} · ${when}</div><div class="gp-name">${val == null ? "—" : toNe(Number(val).toFixed(v.decimals))} ${v.unit}</div>`).addTo(map);
  });
  map.on("mouseenter", "clim-grid", () => (map.getCanvas().style.cursor = "pointer"));
  map.on("mouseleave", "clim-grid", () => (map.getCanvas().style.cursor = ""));
}

function buildLegend() {
  const el = $("#geo-legend-body"); if (!el) return;
  const v = uvar(state.varId); const stops = v.scale();
  if (v.spatial === "none") { el.innerHTML = `<div class="lg-row geo-muted">${v.label}: स्थानिक तह छैन</div>`; return; }
  const when = `वर्ष ${toNe(state.year)}`;
  el.innerHTML = `<div class="lg-grp">${v.label} (${v.unit})</div>` +
    stops.map((s, i) => `<div class="lg-row"><span class="geo-sw" style="background:${s[1]}"></span>${i === 0 ? "<" : "≥"} ${toNe(Number(s[0]).toFixed(v.decimals))}</div>`).join("") +
    `<div class="lg-grp" style="margin-top:8px">${when}</div>`;
}
