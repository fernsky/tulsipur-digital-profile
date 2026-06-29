// Geospatial portal controller: boots MapLibre over pmtiles, wires the control
// panel (basemaps, layer toggles, POI clustering, multi-dimensional filters,
// search, inspection popups), the animated fly-in, and a download/loading HUD
// so the map never looks frozen or empty.
import maplibregl from "maplibre-gl";
import mlcontour from "maplibre-contour";
import { buildStyle } from "./style";
import {
  BASEMAPS, LAYERS, LAYER_GROUPS, LANDUSE, RISK_LEVEL, HAZARD_LABEL,
  POI_GROUPS, poiInfo, icon, toNe,
} from "./labels";
import {
  registerTerrainProtocols, DEM_URL, SLOPE_CLASSES, ELEV_CLASSES, ASPECT_CLASSES, rgb, fullMask,
} from "./terrain";

const TERRAIN = { exagg: 1.0 };
// Tulsipur municipality extent — terrain, DEM analysis and panning are bound to this.
const MUNI = {
  bounds: [82.2019, 27.964, 82.4307, 28.2485] as [number, number, number, number],
  center: [82.3163, 28.1063] as [number, number],
};

type Meta = {
  center: [number, number];
  bounds: [number, number, number, number];
  parcels: { count: number; areas: string[] };
  layers: Record<string, { type: string; count: number }>;
  pois: { count: number; categories: Record<string, number> };
};

const $ = (sel: string, root: Document | HTMLElement = document) => root.querySelector(sel) as HTMLElement;

// ── download with byte progress + ETA ──────────────────────────────────────
async function fetchWithProgress(url: string, onProgress: (pct: number, etaSec: number, label: string) => void) {
  const res = await fetch(url);
  const total = Number(res.headers.get("content-length")) || 0;
  if (!res.body || !total) return res.json();
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let received = 0;
  const start = performance.now();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    received += value.length;
    const pct = received / total;
    const elapsed = (performance.now() - start) / 1000;
    const speed = received / Math.max(elapsed, 0.001);
    const eta = (total - received) / Math.max(speed, 1);
    onProgress(pct, eta, `${(received / 1048576).toFixed(1)} / ${(total / 1048576).toFixed(1)} MB`);
  }
  const blob = new Blob(chunks);
  return JSON.parse(await blob.text());
}

function etaText(sec: number) {
  if (!isFinite(sec) || sec <= 0) return "";
  if (sec < 60) return `अनुमानित ${toNe(Math.ceil(sec))} सेकेन्ड`;
  return `अनुमानित ${toNe(Math.ceil(sec / 60))} मिनेट`;
}

// ── POI icon images (lucide glyph on a colored disc) ───────────────────────
function makePoiImage(map: maplibregl.Map, id: string, color: string, svgPath: string) {
  const size = 48;
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 24 24">` +
    `<circle cx="12" cy="12" r="11" fill="${color}" stroke="#ffffff" stroke-width="1.5"/>` +
    `<g transform="translate(4 4) scale(0.66)" fill="none" stroke="#ffffff" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round">${svgPath}</g></svg>`;
  const img = new Image(size, size);
  img.onload = () => { if (!map.hasImage(id)) map.addImage(id, img, { pixelRatio: 2 }); };
  img.src = "data:image/svg+xml;base64," + btoa(svg);
}

export async function initPortal() {
  const hud = $("#geo-hud");
  const hudText = $("#geo-hud-text");
  const hudBar = $("#geo-hud-bar");
  const hudSub = $("#geo-hud-sub");
  const setHud = (msg: string, pct = -1, sub = "") => {
    if (hudText) hudText.textContent = msg;
    if (hudSub) hudSub.textContent = sub;
    if (hudBar) {
      hudBar.style.width = pct < 0 ? "40%" : `${Math.round(pct * 100)}%`;
      hudBar.classList.toggle("is-indeterminate", pct < 0);
    }
    if (hud) hud.style.display = "flex";
  };
  const hideHud = () => { if (hud) hud.style.display = "none"; };

  setHud("नक्सा सुरु हुँदैछ…", -1);

  // meta + pois (with progress)
  setHud("विवरण डाउनलोड हुँदैछ…", 0);
  const meta: Meta = await fetch("/geo/meta.json").then((r) => r.json());
  const pois = await fetchWithProgress("/geo/pois.geojson", (pct, eta, lbl) =>
    setHud("बिन्दु विवरण डाउनलोड हुँदैछ…", pct, `${lbl} · ${etaText(eta)}`)
  );

  // tag each POI with group/label/color
  for (const f of pois.features) {
    const info = poiInfo(f.properties.cat);
    const grp = POI_GROUPS.find((g) => g.id === info.group) || POI_GROUPS[POI_GROUPS.length - 1];
    f.properties.g = info.group;
    f.properties.label = info.label;
    f.properties.color = grp.color;
    f.properties.icon = "poi-" + info.group;
  }

  const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
  let basemap = "esri-imagery";

  const map = new maplibregl.Map({
    container: "geo-map",
    style: buildStyle(basemap),
    center: MUNI.center,
    zoom: reduce ? 12 : 10.4,
    pitch: reduce ? 0 : 55,
    bearing: reduce ? 0 : -28,
    maxZoom: 18,
    maxBounds: [
      [MUNI.bounds[0] - 0.12, MUNI.bounds[1] - 0.12],
      [MUNI.bounds[2] + 0.12, MUNI.bounds[3] + 0.12],
    ],
    pitchWithRotate: true,
    dragRotate: true,
    touchZoomRotate: true,
    attributionControl: { compact: true },
  });
  map.addControl(new maplibregl.NavigationControl({ visualizePitch: true, showCompass: true, showZoom: true }), "top-right");
  map.addControl(new maplibregl.ScaleControl({ unit: "metric" }), "bottom-left");
  // ensure rotate + 3D tilt gestures are live (right-drag / two-finger / ctrl-drag)
  map.dragRotate.enable();
  map.touchZoomRotate.enableRotation();
  if ((map as any).touchPitch?.enable) (map as any).touchPitch.enable();
  map.keyboard.enable();
  (window as any).__geoMap = map;

  // tile-loading indicator (so panning never looks frozen)
  let loadingTimer: number | undefined;
  map.on("dataloading", () => {
    if (!map.loaded()) return;
    clearTimeout(loadingTimer);
    setHud("नक्सा टाइल लोड हुँदैछ…", -1);
  });
  const settle = () => {
    clearTimeout(loadingTimer);
    loadingTimer = window.setTimeout(() => { if (map.areTilesLoaded()) hideHud(); }, 250);
  };
  map.on("idle", settle);

  map.on("load", () => {
    // POI images
    for (const g of POI_GROUPS) makePoiImage(map, "poi-" + g.id, g.color, icon ? iconPath(g.icon) : "");

    // POI source — no clustering; render every point directly
    map.addSource("pois", { type: "geojson", data: pois as any });
    map.addLayer({
      id: "poi-point", type: "symbol", source: "pois",
      layout: {
        "icon-image": ["get", "icon"],
        "icon-size": ["interpolate", ["linear"], ["zoom"], 10, 0.36, 14, 0.5, 17, 0.62],
        "icon-allow-overlap": true,
        "text-field": ["step", ["zoom"], "", 14, ["get", "name"]],
        "text-font": ["Open Sans Regular"], "text-size": 11, "text-offset": [0, 1.2],
        "text-anchor": "top", "text-optional": true,
      },
      paint: { "text-color": "#0f172a", "text-halo-color": "#ffffff", "text-halo-width": 1.4 },
    });

    setupTerrain(map);
    wirePanel(map, meta, pois);
    wireInteractions(map);

    // animated fly-in swivel
    if (!reduce) {
      map.once("idle", () => {
        map.easeTo({ center: MUNI.center, zoom: 12.2, pitch: 50, bearing: 8, duration: 4200, easing: (t) => t * (2 - t) });
      });
    }
    settle();
  });

  // basemap switching keeps all overlays
  function setBasemap(id: string) {
    basemap = id;
    const bm = BASEMAPS.find((b) => b.id === id)!;
    if (map.getLayer("basemap"))
      map.setLayoutProperty("basemap", "visibility", id === "none" ? "none" : "visible");
    if (id === "none" || !bm.url) return;
    const src = map.getSource("basemap") as maplibregl.RasterTileSource;
    if ((src as any).setTiles) (src as any).setTiles([bm.url]);
  }
  (window as any).__setBasemap = setBasemap;
}

// ── terrain analysis (open DEM) ─────────────────────────────────────────────
function setupTerrain(map: maplibregl.Map) {
  registerTerrainProtocols(maplibregl);
  const dem = new mlcontour.DemSource({ url: DEM_URL, encoding: "terrarium", maxzoom: 13, worker: true });
  dem.setupMaplibre(maplibregl);

  map.addSource("dem", { type: "raster-dem", tiles: [dem.sharedDemProtocolUrl], encoding: "terrarium", tileSize: 256, maxzoom: 13, bounds: MUNI.bounds });
  try { map.setTerrain({ source: "dem", exaggeration: TERRAIN.exagg }); } catch {}

  const overlayBefore = map.getLayer("wards-line") ? "wards-line" : undefined;

  // hillshade (just above basemap)
  map.addLayer({
    id: "hillshade", type: "hillshade", source: "dem", layout: { visibility: "none" },
    paint: { "hillshade-exaggeration": 0.55, "hillshade-shadow-color": "#1a1a1a" },
  } as any, map.getLayer("landuse") ? "landuse" : overlayBefore);

  // classified analysis rasters (slope / elevation / aspect)
  const addAnalysis = (id: string, n: number) => {
    map.addSource(id, { type: "raster", tiles: [`${id}://{z}/{x}/{y}?m=${fullMask(n)}`], tileSize: 256, minzoom: 8, maxzoom: 13, bounds: MUNI.bounds });
    map.addLayer({
      id, type: "raster", source: id, layout: { visibility: "none" },
      paint: { "raster-opacity": 0.82, "raster-resampling": "nearest" },
    } as any, overlayBefore);
  };
  addAnalysis("slope", SLOPE_CLASSES.length);
  addAnalysis("elev", ELEV_CLASSES.length);
  addAnalysis("aspect", ASPECT_CLASSES.length);

  // contour lines + labels (generated in-browser from the DEM)
  map.addSource("contours", {
    type: "vector",
    tiles: [dem.contourProtocolUrl({
      multiplier: 1,
      thresholds: { 10: [200, 1000], 11: [100, 500], 12: [100, 500], 13: [50, 200], 14: [20, 100] },
      elevationKey: "ele", levelKey: "level", contourLayer: "contours",
    })],
    maxzoom: 15, bounds: MUNI.bounds,
  });
  map.addLayer({
    id: "contour-lines", type: "line", source: "contours", "source-layer": "contours",
    layout: { visibility: "none" },
    paint: { "line-color": "#92400e", "line-opacity": 0.5, "line-width": ["match", ["get", "level"], 1, 1.3, 0.5] as any },
  }, overlayBefore);
  map.addLayer({
    id: "contour-labels", type: "symbol", source: "contours", "source-layer": "contours",
    filter: ["==", ["get", "level"], 1], layout: {
      visibility: "none", "symbol-placement": "line", "symbol-spacing": 170, "text-max-angle": 25,
      "text-field": ["concat", ["to-string", ["get", "ele"]], " मि"],
      "text-font": ["Open Sans Regular"], "text-size": 10,
    },
    paint: { "text-color": "#7c2d12", "text-halo-color": "#ffffff", "text-halo-width": 1.4 },
  });

  // municipality mask — hides basemap + DEM analysis outside the palika boundary
  map.addSource("muni-mask", { type: "geojson", data: "/geo/mask.geojson" });
  map.addLayer({
    id: "muni-mask", type: "fill", source: "muni-mask",
    paint: { "fill-color": "#ffffff", "fill-opacity": 1 },
  }, overlayBefore);

  startReadout(map);
}

// live elevation + slope readout sampled from the DEM
function startReadout(map: maplibregl.Map) {
  const el = document.getElementById("geo-coords");
  if (!el) return;
  const trueElev = (ll: maplibregl.LngLatLike) => {
    const e = map.queryTerrainElevation(ll);
    return e == null ? null : e / Math.max(TERRAIN.exagg, 0.0001);
  };
  const slopeAt = (ll: { lng: number; lat: number }) => {
    const d = 0.00035, m = 111320;
    const eE = trueElev({ lng: ll.lng + d, lat: ll.lat }), eW = trueElev({ lng: ll.lng - d, lat: ll.lat });
    const eN = trueElev({ lng: ll.lng, lat: ll.lat + d }), eS = trueElev({ lng: ll.lng, lat: ll.lat - d });
    if ([eE, eW, eN, eS].some((v) => v == null)) return null;
    const dx = ((eE as number) - (eW as number)) / (2 * d * m * Math.cos((ll.lat * Math.PI) / 180));
    const dy = ((eN as number) - (eS as number)) / (2 * d * m);
    return (Math.atan(Math.hypot(dx, dy)) * 180) / Math.PI;
  };
  let raf = 0;
  map.on("mousemove", (e) => {
    if (raf) return;
    raf = requestAnimationFrame(() => {
      raf = 0;
      const z = trueElev(e.lngLat);
      const s = z == null ? null : slopeAt(e.lngLat);
      el.innerHTML =
        `<span>उचाइ <b>${z == null ? "—" : toNe(Math.round(z))} मि</b></span>` +
        `<span>भिरालो <b>${s == null ? "—" : toNe(s.toFixed(1)) + "°"}</b></span>` +
        `<span class="gc-ll">${toNe(e.lngLat.lat.toFixed(4))}, ${toNe(e.lngLat.lng.toFixed(4))}</span>`;
      el.style.display = "flex";
    });
  });
  map.getCanvas().addEventListener("mouseleave", () => (el.style.display = "none"));
}

function iconPath(key: string) {
  // pull the raw path string out of the icon() svg wrapper
  const svg = icon(key, 24);
  const m = svg.match(/aria-hidden="true">([\s\S]*)<\/svg>/);
  return m ? m[1] : "";
}

// ── control panel ───────────────────────────────────────────────────────────
function wirePanel(map: maplibregl.Map, meta: Meta, pois: any) {
  const panel = $("#geo-panel-body");
  if (!panel) return;

  const has = (id: string) => meta.layers[id] && meta.layers[id].count > 0 || id === "parcels" || id === "mtmp";

  // ── basemaps ──
  const basemapHtml = BASEMAPS.map((b, i) =>
    `<button class="geo-chip${i === 0 ? " is-on" : ""}" data-basemap="${b.id}">${b.label}</button>`
  ).join("");

  // ── layer groups ──
  const layerGroupsHtml = LAYER_GROUPS.map((grp) => {
    const items = LAYERS.filter((l) => l.group === grp.id && has(l.id));
    if (!items.length) return "";
    const rows = items.map((l) => {
      const on = l.defaultOn ? "checked" : "";
      const cnt = meta.layers[l.id]?.count ?? (l.id === "parcels" ? meta.parcels.count : 0);
      return `<label class="geo-row"><input type="checkbox" data-layer="${l.id}" ${on}/>
        <span>${l.label}</span><span class="geo-count">${cnt ? toNe(cnt.toLocaleString()) : ""}</span></label>`;
    }).join("");
    return `<div class="geo-grp"><div class="geo-grp-h">${grp.label}</div>${rows}</div>`;
  }).join("");

  // ── land-use filter (classes) ──
  const luHtml = Object.entries(LANDUSE).map(([k, v]) =>
    `<label class="geo-row"><input type="checkbox" data-lu="${k}" checked/>
      <span class="geo-sw" style="background:${v.color}"></span><span>${v.label}</span></label>`
  ).join("");

  // ── risk level filter ──
  const riskHtml = Object.entries(RISK_LEVEL).map(([k, v]) =>
    `<button class="geo-chip is-on" data-risk="${k}"><span class="geo-sw" style="background:${v.color}"></span>${v.label}</button>`
  ).join("");

  // ── ward filter ──
  const wardOpts = ['<option value="">सबै वडा</option>']
    .concat(Array.from({ length: 19 }, (_, i) => `<option value="${i + 1}">वडा ${toNe(i + 1)}</option>`))
    .join("");

  // ── terrain analysis classes ──
  const clsRows = (id: string, classes: { label: string; color: number[] }[]) =>
    `<div class="geo-sub" data-sub="${id}" style="display:none">` +
    classes.map((c, i) =>
      `<label class="geo-row"><input type="checkbox" data-cls="${id}:${i}" checked/>
        <span class="geo-sw" style="background:${rgb(c.color)}"></span><span>${c.label}</span></label>`).join("") +
    `</div>`;
  const terrainHtml = `
    <label class="geo-row geo-master"><input type="checkbox" data-tlayer="terrain3d"/><span>त्रि-आयामिक भू-धरातल (3D)</span></label>
    <label class="geo-row geo-master"><input type="checkbox" data-tlayer="hillshade"/><span>छायाँ राहत (Hillshade)</span></label>
    <label class="geo-row geo-master"><input type="checkbox" data-tlayer="contour"/><span>उचाइ रेखा (Contours)</span></label>
    <label class="geo-row geo-master"><input type="checkbox" data-tlayer="slope"/><span>भिरालोपन वर्ग (Slope)</span></label>
    ${clsRows("slope", SLOPE_CLASSES)}
    <label class="geo-row geo-master"><input type="checkbox" data-tlayer="elev"/><span>उचाइ क्षेत्र (Elevation)</span></label>
    ${clsRows("elev", ELEV_CLASSES)}
    <label class="geo-row geo-master"><input type="checkbox" data-tlayer="aspect"/><span>मोहडा दिशा (Aspect)</span></label>
    ${clsRows("aspect", ASPECT_CLASSES)}`;

  // ── POI groups ──
  const poiCounts: Record<string, number> = {};
  for (const f of pois.features) poiCounts[f.properties.g] = (poiCounts[f.properties.g] || 0) + 1;
  const poiHtml = POI_GROUPS.filter((g) => poiCounts[g.id]).map((g) =>
    `<label class="geo-row"><input type="checkbox" data-poi="${g.id}" checked/>
      <span class="geo-ic" style="color:${g.color}">${icon(g.icon, 16)}</span>
      <span>${g.label}</span><span class="geo-count">${toNe(poiCounts[g.id])}</span></label>`
  ).join("");

  panel.innerHTML = `
    <div class="geo-toolbar">
      <button id="geo-reset" class="geo-tool-btn">सबै हटाउनुहोस् / रिसेट</button>
      <button id="geo-legend-toggle" class="geo-tool-btn is-on" aria-pressed="true">${icon("compass", 14)}<span>रङ्ग-सूची</span></button>
    </div>
    <section class="geo-sec">
      <div class="geo-sec-h">${icon("layers", 15)}<span>आधार नक्सा</span></div>
      <div class="geo-chips">${basemapHtml}</div>
    </section>
    <section class="geo-sec">
      <div class="geo-sec-h"><span>बिन्दुहरू / संस्था (${toNe(pois.features.length)})</span>
        <button class="geo-mini" data-poi-all="off">सबै हटाउने</button></div>
      <div class="geo-rows">${poiHtml}</div>
    </section>
    <section class="geo-sec">
      <div class="geo-sec-h"><span>वडा केन्द्रित</span></div>
      <select id="geo-ward" class="geo-select">${wardOpts}</select>
    </section>
    <section class="geo-sec">
      <div class="geo-sec-h"><span>तह (Layers)</span></div>
      ${layerGroupsHtml}
    </section>
    <section class="geo-sec" data-when="landuse">
      <div class="geo-sec-h"><span>भू-उपयोग छनोट</span></div>
      <div class="geo-rows geo-cols">${luHtml}</div>
    </section>
    <section class="geo-sec" data-when="risk">
      <div class="geo-sec-h"><span>जोखिम स्तर</span></div>
      <div class="geo-chips">${riskHtml}</div>
    </section>
    <section class="geo-sec">
      <div class="geo-sec-h">${icon("mountain", 15)}<span>भू-धरातल विश्लेषण</span></div>
      ${terrainHtml}
    </section>`;

  // ── wire basemaps ──
  panel.querySelectorAll("[data-basemap]").forEach((el) =>
    el.addEventListener("click", () => {
      panel.querySelectorAll("[data-basemap]").forEach((b) => b.classList.remove("is-on"));
      el.classList.add("is-on");
      (window as any).__setBasemap((el as HTMLElement).dataset.basemap);
    })
  );

  // ── wire layer toggles ──
  const setVis = (id: string, on: boolean) => {
    const extra: Record<string, string[]> = {
      wards: ["wards", "wards-line", "wards-label"],
      mtmp: ["mtmp"],
    };
    const ids = extra[id] || [id];
    for (const lid of ids) if (map.getLayer(lid)) map.setLayoutProperty(lid, "visibility", on ? "visible" : "none");
  };
  panel.querySelectorAll("[data-layer]").forEach((el) => {
    const cb = el as HTMLInputElement;
    setVis(cb.dataset.layer!, cb.checked);
    cb.addEventListener("change", () => {
      setVis(cb.dataset.layer!, cb.checked);
      toggleConditional(panel, map);
    });
  });

  // ── land-use class filter ──
  const applyLu = () => {
    const on = Array.from(panel.querySelectorAll("[data-lu]:checked")).map((e) => (e as HTMLInputElement).dataset.lu);
    if (map.getLayer("landuse"))
      map.setFilter("landuse", on.length ? ["in", ["get", "cls"], ["literal", on]] as any : ["==", ["get", "cls"], "___none___"]);
  };
  panel.querySelectorAll("[data-lu]").forEach((el) => el.addEventListener("change", applyLu));

  // ── risk level filter ──
  const riskState = new Set(["H", "M", "L"]);
  const applyRisk = () => {
    const lv = [...riskState];
    for (const id of ["risk_flood", "risk_landslide", "risk_fire", "risk_seismic"]) {
      if (map.getLayer(id))
        map.setFilter(id, lv.length ? ["in", ["get", "level"], ["literal", lv]] as any : ["==", ["get", "level"], "__none__"]);
    }
  };
  panel.querySelectorAll("[data-risk]").forEach((el) =>
    el.addEventListener("click", () => {
      const k = (el as HTMLElement).dataset.risk!;
      if (riskState.has(k)) { riskState.delete(k); el.classList.remove("is-on"); }
      else { riskState.add(k); el.classList.add("is-on"); }
      applyRisk();
    })
  );

  // ── ward focus ──
  $("#geo-ward")?.addEventListener("change", (e) => {
    const v = Number((e.target as HTMLSelectElement).value);
    if (map.getLayer("wards-dim")) map.setFilter("wards-dim", v ? ["!=", ["get", "ward"], v] : ["==", ["get", "ward"], -1]);
    if (v) zoomToWard(map, v);
  });

  // ── POI group filter (re-cluster via setData) ──
  const applyPois = () => {
    const on = new Set(Array.from(panel.querySelectorAll("[data-poi]:checked")).map((e) => (e as HTMLInputElement).dataset.poi));
    const filtered = { type: "FeatureCollection", features: pois.features.filter((f: any) => on.has(f.properties.g)) };
    (map.getSource("pois") as maplibregl.GeoJSONSource)?.setData(filtered as any);
  };
  panel.querySelectorAll("[data-poi]").forEach((el) => el.addEventListener("change", applyPois));
  panel.querySelector("[data-poi-all]")?.addEventListener("click", (e) => {
    const btn = e.target as HTMLElement;
    const turnOff = btn.dataset.poiAll === "off";
    panel.querySelectorAll("[data-poi]").forEach((c) => ((c as HTMLInputElement).checked = !turnOff));
    btn.dataset.poiAll = turnOff ? "on" : "off";
    btn.textContent = turnOff ? "सबै देखाउने" : "सबै हटाउने";
    applyPois();
  });

  wireTerrain(map, panel);

  // ── legend show / hide ──
  const legendEl = document.getElementById("geo-legend");
  const legendBtn = panel.querySelector("#geo-legend-toggle") as HTMLElement;
  legendBtn?.addEventListener("click", () => {
    const on = legendBtn.classList.toggle("is-on");
    legendBtn.setAttribute("aria-pressed", on ? "true" : "false");
    if (legendEl) legendEl.style.display = on ? "" : "none";
  });

  // ── clear all selections / reset ──
  const resetAll = () => {
    (panel.querySelector("[data-basemap]") as HTMLElement)?.click();
    const ward = panel.querySelector("#geo-ward") as HTMLSelectElement;
    if (ward) { ward.value = ""; ward.dispatchEvent(new Event("change")); }
    panel.querySelectorAll("[data-layer]").forEach((el) => {
      const cb = el as HTMLInputElement;
      const def = !!LAYERS.find((l) => l.id === cb.dataset.layer)?.defaultOn;
      cb.checked = def; setVis(cb.dataset.layer!, def);
    });
    panel.querySelectorAll("[data-lu]").forEach((el) => ((el as HTMLInputElement).checked = true));
    applyLu();
    riskState.clear(); ["H", "M", "L"].forEach((k) => riskState.add(k));
    panel.querySelectorAll("[data-risk]").forEach((el) => el.classList.add("is-on"));
    applyRisk();
    panel.querySelectorAll("[data-poi]").forEach((el) => ((el as HTMLInputElement).checked = true));
    applyPois();
    const pa = panel.querySelector("[data-poi-all]") as HTMLElement;
    if (pa) { pa.dataset.poiAll = "off"; pa.textContent = "सबै हटाउने"; }
    panel.querySelectorAll("[data-tlayer]").forEach((el) => {
      const cb = el as HTMLInputElement;
      if (cb.checked) { cb.checked = false; cb.dispatchEvent(new Event("change")); }
    });
    panel.querySelectorAll("[data-cls]").forEach((el) => ((el as HTMLInputElement).checked = true));
    toggleConditional(panel, map);
    buildLegend(map);
  };
  panel.querySelector("#geo-reset")?.addEventListener("click", resetAll);

  toggleConditional(panel, map);
  buildLegend(map);
  buildSearch(map, pois);
}

// ── terrain analysis controls ───────────────────────────────────────────────
function wireTerrain(map: maplibregl.Map, panel: HTMLElement) {
  const setVis = (ids: string[], on: boolean) =>
    ids.forEach((id) => map.getLayer(id) && map.setLayoutProperty(id, "visibility", on ? "visible" : "none"));

  // master toggles
  panel.querySelectorAll("[data-tlayer]").forEach((el) => {
    const cb = el as HTMLInputElement;
    cb.addEventListener("change", () => {
      const k = cb.dataset.tlayer!;
      if (k === "terrain3d") {
        TERRAIN.exagg = cb.checked ? 1.7 : 1.0;
        try { map.setTerrain({ source: "dem", exaggeration: TERRAIN.exagg }); } catch {}
      } else if (k === "hillshade") setVis(["hillshade"], cb.checked);
      else if (k === "contour") setVis(["contour-lines", "contour-labels"], cb.checked);
      else { // slope / elev / aspect raster
        setVis([k], cb.checked);
        const sub = panel.querySelector(`[data-sub="${k}"]`) as HTMLElement;
        if (sub) sub.style.display = cb.checked ? "" : "none";
      }
      buildLegend(map);
    });
  });

  // class filters → rebuild the raster mask
  const applyMask = (id: string) => {
    const boxes = Array.from(panel.querySelectorAll(`[data-cls^="${id}:"]`)) as HTMLInputElement[];
    let mask = 0;
    boxes.forEach((b) => { if (b.checked) mask |= 1 << Number(b.dataset.cls!.split(":")[1]); });
    const src = map.getSource(id) as maplibregl.RasterTileSource | undefined;
    (src as any)?.setTiles?.([`${id}://{z}/{x}/{y}?m=${mask}`]);
  };
  panel.querySelectorAll("[data-cls]").forEach((el) =>
    el.addEventListener("change", () => applyMask((el as HTMLElement).dataset.cls!.split(":")[0]))
  );

  // deep-link: ?t=slope|elev|aspect|hillshade|contour auto-enables a view
  const want = new URLSearchParams(location.search).get("t");
  if (want) {
    const cb = panel.querySelector(`[data-tlayer="${want}"]`) as HTMLInputElement;
    if (cb && !cb.checked) { cb.checked = true; cb.dispatchEvent(new Event("change")); }
  }
}

// show land-use / risk filter sections only when their layer is on
function toggleConditional(panel: HTMLElement, map: maplibregl.Map) {
  const vis = (id: string) => map.getLayer(id) && map.getLayoutProperty(id, "visibility") !== "none";
  const luSec = panel.querySelector('[data-when="landuse"]') as HTMLElement;
  const riskOn = ["risk_flood", "risk_landslide", "risk_fire", "risk_seismic"].some(vis);
  const riskSec = panel.querySelector('[data-when="risk"]') as HTMLElement;
  if (luSec) luSec.style.display = vis("landuse") ? "" : "none";
  if (riskSec) riskSec.style.display = riskOn ? "" : "none";
}

function zoomToWard(map: maplibregl.Map, ward: number) {
  const feats = map.querySourceFeatures("base", { sourceLayer: "wards", filter: ["==", ["get", "ward"], ward] });
  if (!feats.length) return;
  const b = new maplibregl.LngLatBounds();
  for (const f of feats) {
    const g = f.geometry as any;
    const rings = g.type === "MultiPolygon" ? g.coordinates.flat() : g.coordinates;
    for (const ring of rings) for (const c of ring) b.extend(c);
  }
  if (!b.isEmpty()) map.fitBounds(b, { padding: 60, pitch: 40, duration: 1600 });
}

// ── inspection popups ───────────────────────────────────────────────────────
function wireInteractions(map: maplibregl.Map) {
  const popup = new maplibregl.Popup({ closeButton: true, maxWidth: "280px", className: "geo-popup" });

  map.on("click", "poi-point", (e) => {
    const p = e.features![0].properties!;
    popup.setLngLat((e.features![0].geometry as any).coordinates)
      .setHTML(`<div class="gp-cat">${p.label}</div><div class="gp-name">${p.name || "—"}</div>`)
      .addTo(map);
  });

  // parcel + thematic inspection
  const inspect = (layers: string[]) => (e: any) => {
    const f = map.queryRenderedFeatures(e.point, { layers: layers.filter((l) => map.getLayer(l)) })[0];
    if (!f) return;
    popup.setLngLat(e.lngLat).setHTML(describe(f)).addTo(map);
  };
  map.on("click", inspect(["parcels-hl", "parcels", "landuse", "risk_flood", "risk_landslide", "risk_fire", "risk_seismic", "wards"]));

  // hover tooltip
  const tip = new maplibregl.Popup({ closeButton: false, closeOnClick: false, offset: 12, className: "geo-tip" });
  map.on("mousemove", "poi-point", (e) => {
    map.getCanvas().style.cursor = "pointer";
    const p = e.features![0].properties!;
    tip.setLngLat((e.features![0].geometry as any).coordinates)
      .setHTML(`<span class="gt-name">${p.name || p.label}</span><span class="gt-cat">${p.label}</span>`)
      .addTo(map);
  });
  map.on("mouseleave", "poi-point", () => { map.getCanvas().style.cursor = ""; tip.remove(); });
}

function describe(f: maplibregl.MapGeoJSONFeature): string {
  const p = f.properties || {};
  const sl = (f as any).sourceLayer;
  const row = (k: string, v: any) => v != null && v !== "" ? `<div class="gp-row"><span>${k}</span><b>${v}</b></div>` : "";
  if (sl === "parcels")
    return `<div class="gp-cat">कित्ता</div>` +
      row("कित्ता नं.", toNe(p.parcelno)) + row("वडा", p.wardno ? toNe(p.wardno) : "") +
      row("क्षेत्रफल", p.area) + row("नापी क्षेत्र", p.area_name) + row("सिट नं.", p.mapsheetno ? toNe(p.mapsheetno) : "");
  if (sl === "landuse")
    return `<div class="gp-cat">भू-उपयोग</div>` + row("प्रकार", LANDUSE[p.cls]?.label || p.lu) +
      row("विवरण", p.lu) + row("क्षेत्रफल (हे.)", p.area_h ? toNe(Number(p.area_h).toFixed(2)) : "");
  if (sl?.startsWith("risk_"))
    return `<div class="gp-cat">${HAZARD_LABEL[p.hazard] || "जोखिम"} जोखिम</div>` + row("स्तर", RISK_LEVEL[p.level]?.label || p.level);
  if (sl === "wards")
    return `<div class="gp-cat">वडा ${toNe(p.ward)}</div>` + row("पालिका", p.palika);
  return `<div class="gp-cat">विवरण</div>` + Object.entries(p).slice(0, 6).map(([k, v]) => row(k, v)).join("");
}

// ── legend ──────────────────────────────────────────────────────────────────
function buildLegend(map: maplibregl.Map) {
  const el = $("#geo-legend-body");
  if (!el) return;
  const render = () => {
    const vis = (id: string) => map.getLayer(id) && map.getLayoutProperty(id, "visibility") !== "none";
    const parts: string[] = [];
    if (vis("landuse"))
      parts.push(`<div class="lg-grp">भू-उपयोग</div>` + Object.values(LANDUSE).map((v) =>
        `<div class="lg-row"><span class="geo-sw" style="background:${v.color}"></span>${v.label}</div>`).join(""));
    if (["risk_flood", "risk_landslide", "risk_fire", "risk_seismic"].some(vis))
      parts.push(`<div class="lg-grp">जोखिम स्तर</div>` + Object.values(RISK_LEVEL).map((v) =>
        `<div class="lg-row"><span class="geo-sw" style="background:${v.color}"></span>${v.label}</div>`).join(""));
    const clsLegend = (id: string, grp: string, classes: { label: string; color: number[] }[]) => {
      if (!vis(id)) return;
      parts.push(`<div class="lg-grp">${grp}</div>` + classes.map((c) =>
        `<div class="lg-row"><span class="geo-sw" style="background:${rgb(c.color)}"></span>${c.label}</div>`).join(""));
    };
    clsLegend("slope", "भिरालोपन (Slope)", SLOPE_CLASSES);
    clsLegend("elev", "उचाइ क्षेत्र", ELEV_CLASSES);
    clsLegend("aspect", "मोहडा दिशा", ASPECT_CLASSES);
    el.innerHTML = parts.join("") || `<div class="lg-row geo-muted">कुनै रङ्ग-सूची सक्रिय छैन</div>`;
  };
  map.on("idle", render);
  render();
}

// ── search ──────────────────────────────────────────────────────────────────
function buildSearch(map: maplibregl.Map, pois: any) {
  const input = $("#geo-search") as HTMLInputElement;
  const out = $("#geo-search-results");
  if (!input || !out) return;
  const index = pois.features.map((f: any) => ({
    name: (f.properties.name || "").toString(),
    label: f.properties.label,
    coord: (f.geometry as any).coordinates,
  }));
  const run = () => {
    const q = input.value.trim().toLowerCase();
    if (q.length < 2) { out.innerHTML = ""; out.style.display = "none"; return; }
    const hits = index.filter((it: any) =>
      it.name.toLowerCase().includes(q) || it.label.toLowerCase().includes(q)).slice(0, 8);
    if (!hits.length) { out.innerHTML = `<div class="gsr-empty">कुनै नतिजा भेटिएन</div>`; out.style.display = "block"; return; }
    out.innerHTML = hits.map((h: any, i: number) =>
      `<button class="gsr" data-i="${i}"><b>${h.name || h.label}</b><span>${h.label}</span></button>`).join("");
    out.style.display = "block";
    out.querySelectorAll(".gsr").forEach((b) => b.addEventListener("click", () => {
      const h = hits[Number((b as HTMLElement).dataset.i)];
      map.easeTo({ center: h.coord, zoom: 16, pitch: 45, duration: 1400 });
      out.style.display = "none"; input.value = h.name || h.label;
    }));
  };
  let t: number;
  input.addEventListener("input", () => { clearTimeout(t); t = window.setTimeout(run, 140); });
  input.addEventListener("focus", run);
  document.addEventListener("click", (e) => { if (!out.contains(e.target as Node) && e.target !== input) out.style.display = "none"; });
}
