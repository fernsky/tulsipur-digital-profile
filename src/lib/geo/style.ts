// Builds the MapLibre style: chosen raster basemap + two pmtiles vector
// sources (thematic base + cadastral parcels) + every themed vector layer.
import { BASEMAPS, LANDUSE, RISK_LEVEL, MUNI_BOUNDS } from "./labels";
import type { StyleSpecification } from "maplibre-gl";

const BASE_SRC = "base";
const PARCEL_SRC = "parcels";

const luMatch = () => {
  const expr: any[] = ["match", ["get", "cls"]];
  for (const [k, v] of Object.entries(LANDUSE)) {
    if (k === "other") continue;
    expr.push(k, v.color);
  }
  expr.push(LANDUSE.other.color);
  return expr;
};

const riskMatch = (opacity = false) => {
  const expr: any[] = ["match", ["get", "level"]];
  for (const [k, v] of Object.entries(RISK_LEVEL)) expr.push(k, v.color);
  expr.push("#9ca3af");
  return expr;
};

export function buildStyle(basemapId: string): StyleSpecification {
  const bm = BASEMAPS.find((b) => b.id === basemapId) || BASEMAPS[0];
  // Tile requests are built inside a web worker (no document base URL), so
  // root-relative paths fail to parse — use absolute URLs against the origin.
  const origin = typeof location !== "undefined" ? location.origin : "";

  const riskLayer = (id: string) => ({
    id, type: "fill" as const, source: BASE_SRC, "source-layer": id,
    layout: { visibility: "none" as const },
    paint: {
      "fill-color": riskMatch(),
      "fill-opacity": ["match", ["get", "level"], "H", 0.55, "M", 0.4, "L", 0.28, 0.3] as any,
      "fill-outline-color": "#00000022",
    },
  });

  return {
    version: 8,
    glyphs: "https://demotiles.maplibre.org/font/{fontstack}/{range}.pbf",
    sources: {
      basemap: {
        type: "raster", tiles: bm.url ? [bm.url] : [], tileSize: 256,
        maxzoom: bm.maxzoom ?? 19, attribution: bm.attribution, bounds: MUNI_BOUNDS,
      },
      [BASE_SRC]: { type: "vector", tiles: [`${origin}/geo/base/{z}/{x}/{y}.pbf`], minzoom: 6, maxzoom: 15 },
      [PARCEL_SRC]: { type: "vector", tiles: [`${origin}/geo/parcels/{z}/{x}/{y}.pbf`], minzoom: 12, maxzoom: 16 },
    },
    layers: [
      { id: "basemap", type: "raster", source: "basemap" },

      // land use
      {
        id: "landuse", type: "fill", source: BASE_SRC, "source-layer": "landuse",
        paint: { "fill-color": luMatch() as any, "fill-opacity": 0.5, "fill-outline-color": "#ffffff33" },
      },
      {
        id: "landusezone", type: "fill", source: BASE_SRC, "source-layer": "landusezone",
        layout: { visibility: "none" },
        paint: { "fill-color": "#7c3aed", "fill-opacity": 0.35, "fill-outline-color": "#ffffff55" },
      },
      {
        id: "landcapability", type: "fill", source: BASE_SRC, "source-layer": "landcapability",
        layout: { visibility: "none" },
        paint: { "fill-color": "#0891b2", "fill-opacity": 0.35 },
      },

      // terrain
      {
        id: "geology", type: "fill", source: BASE_SRC, "source-layer": "geology",
        layout: { visibility: "none" },
        paint: { "fill-color": "#b45309", "fill-opacity": 0.4, "fill-outline-color": "#ffffff44" },
      },
      {
        id: "soil", type: "fill", source: BASE_SRC, "source-layer": "soil",
        layout: { visibility: "none" },
        paint: { "fill-color": "#a16207", "fill-opacity": 0.4 },
      },

      // risk (hidden by default)
      riskLayer("risk_flood"),
      riskLayer("risk_landslide"),
      riskLayer("risk_fire"),
      riskLayer("risk_seismic"),

      // parcels (high zoom)
      {
        id: "parcels", type: "line", source: PARCEL_SRC, "source-layer": "parcels",
        minzoom: 13, layout: { visibility: "none" },
        paint: {
          "line-color": "#f8fafc",
          "line-opacity": ["interpolate", ["linear"], ["zoom"], 13, 0.25, 16, 0.7],
          "line-width": ["interpolate", ["linear"], ["zoom"], 13, 0.3, 17, 1.1],
        },
      },
      // parcel highlight (driven by search) — filtered to nothing initially
      {
        id: "parcels-hl", type: "fill", source: PARCEL_SRC, "source-layer": "parcels",
        minzoom: 12, filter: ["==", ["get", "parcelno"], "___none___"],
        paint: { "fill-color": "#2563eb", "fill-opacity": 0.5, "fill-outline-color": "#1e3a8a" },
      },

      // infrastructure — transport master plan
      {
        id: "mtmp", type: "line", source: BASE_SRC, "source-layer": "mtmp",
        paint: {
          "line-color": "#f59e0b",
          "line-width": ["interpolate", ["linear"], ["zoom"], 9, 0.6, 15, 2.4],
          "line-opacity": 0.85,
        },
      },

      // wards
      {
        id: "wards", type: "fill", source: BASE_SRC, "source-layer": "wards",
        paint: { "fill-color": "#1e293b", "fill-opacity": 0.04 },
      },
      {
        id: "wards-dim", type: "fill", source: BASE_SRC, "source-layer": "wards",
        filter: ["==", ["get", "ward"], -1],
        paint: { "fill-color": "#0a0a0a", "fill-opacity": 0.55 },
      },
      {
        id: "wards-line", type: "line", source: BASE_SRC, "source-layer": "wards",
        paint: {
          "line-color": "#1e293b",
          "line-width": ["interpolate", ["linear"], ["zoom"], 9, 1, 14, 2.5],
          "line-opacity": 0.9,
        },
      },
      {
        id: "wards-label", type: "symbol", source: BASE_SRC, "source-layer": "wards",
        layout: {
          "text-field": ["concat", "वडा ", ["to-string", ["get", "ward"]]],
          "text-font": ["Open Sans Regular"], "text-size": 13, "symbol-placement": "point",
        },
        paint: { "text-color": "#0f172a", "text-halo-color": "#ffffff", "text-halo-width": 1.6 },
      },

      // municipality boundary
      {
        id: "municipality", type: "line", source: BASE_SRC, "source-layer": "municipality",
        paint: { "line-color": "#0f172a", "line-width": 2.5, "line-dasharray": [2, 1.5] },
      },

      // settlements
      {
        id: "settlements", type: "circle", source: BASE_SRC, "source-layer": "settlements",
        layout: { visibility: "none" },
        paint: {
          "circle-radius": 3.5, "circle-color": "#7c3aed",
          "circle-stroke-color": "#ffffff", "circle-stroke-width": 1,
        },
      },
    ],
  };
}

export { BASE_SRC, PARCEL_SRC };
