// In-browser terrain analysis from the open Terrarium DEM (AWS elevation-tiles).
// Registers custom MapLibre protocols that decode a DEM tile and render
// classified, mask-filterable rasters: slope, elevation band, and aspect.
// No server, no key — everything is computed on the client per tile.
import type maplibregl from "maplibre-gl";

export const DEM_URL = "https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png";
const demTile = (z: number, x: number, y: number) =>
  DEM_URL.replace("{z}", String(z)).replace("{x}", String(x)).replace("{y}", String(y));

// ── class tables (also drive the legend + filter UI) ──────────────────────
export const SLOPE_CLASSES = [
  { max: 5,        label: "० – ५° (समतल)",        color: [26, 152, 80] },
  { max: 15,       label: "५ – १५° (हल्का भिरालो)", color: [166, 217, 106] },
  { max: 30,       label: "१५ – ३०° (भिरालो)",      color: [253, 174, 97] },
  { max: 45,       label: "३० – ४५° (धेरै भिरालो)",  color: [215, 48, 39] },
  { max: Infinity, label: "४५°+ (अति भिरालो)",       color: [127, 0, 0] },
];

export const ELEV_CLASSES = [
  { max: 600,      label: "< ६०० मि",          color: [0, 104, 55] },
  { max: 800,      label: "६०० – ८०० मि",       color: [120, 198, 121] },
  { max: 1000,     label: "८०० – १००० मि",      color: [255, 255, 178] },
  { max: 1300,     label: "१००० – १३०० मि",     color: [254, 196, 79] },
  { max: 1600,     label: "१३०० – १६०० मि",     color: [217, 95, 14] },
  { max: Infinity, label: "१६००+ मि",           color: [140, 81, 10] },
];

export const ASPECT_CLASSES = [
  { label: "उत्तर (N)",       color: [228, 26, 28] },
  { label: "उत्तर-पूर्व (NE)", color: [255, 127, 0] },
  { label: "पूर्व (E)",        color: [255, 255, 51] },
  { label: "दक्षिण-पूर्व (SE)", color: [77, 175, 74] },
  { label: "दक्षिण (S)",       color: [55, 126, 184] },
  { label: "दक्षिण-पश्चिम (SW)", color: [152, 78, 163] },
  { label: "पश्चिम (W)",       color: [166, 86, 40] },
  { label: "उत्तर-पश्चिम (NW)", color: [247, 129, 191] },
];

const FILL_ALPHA = 150;

// ── helpers ────────────────────────────────────────────────────────────────
const tileLat = (y: number, z: number) => {
  const n = Math.PI - (2 * Math.PI * y) / Math.pow(2, z);
  return (180 / Math.PI) * Math.atan(0.5 * (Math.exp(n) - Math.exp(-n)));
};
const decodeElev = (r: number, g: number, b: number) => r * 256 + g + b / 256 - 32768;

async function loadDem(z: number, x: number, y: number): Promise<Float32Array> {
  const res = await fetch(demTile(z, x, y));
  const bmp = await createImageBitmap(await res.blob());
  const cv = new OffscreenCanvas(256, 256);
  const ctx = cv.getContext("2d", { willReadFrequently: true })!;
  ctx.drawImage(bmp, 0, 0);
  const d = ctx.getImageData(0, 0, 256, 256).data;
  const elev = new Float32Array(256 * 256);
  for (let i = 0; i < 256 * 256; i++) elev[i] = decodeElev(d[i * 4], d[i * 4 + 1], d[i * 4 + 2]);
  return elev;
}

async function toPng(rgba: Uint8ClampedArray): Promise<ArrayBuffer> {
  const cv = new OffscreenCanvas(256, 256);
  cv.getContext("2d")!.putImageData(new ImageData(rgba, 256, 256), 0, 0);
  const blob = await cv.convertToBlob({ type: "image/png" });
  return blob.arrayBuffer();
}

const parse = (url: string) => {
  // mode://z/x/y?m=bitmask
  const m = url.replace(/^[a-z]+:\/\//, "").match(/(\d+)\/(\d+)\/(\d+)(?:\?m=(\d+))?/)!;
  return { z: +m[1], x: +m[2], y: +m[3], mask: m[4] ? parseInt(m[4], 10) : -1 };
};
const inMask = (mask: number, i: number) => mask < 0 || (mask & (1 << i)) !== 0;

// ── renderers ───────────────────────────────────────────────────────────────
function slopeAspect(elev: Float32Array, z: number, y: number, mode: "slope" | "aspect", mask: number) {
  const lat = (tileLat(y, z) * Math.PI) / 180;
  const res = (156543.03392 * Math.cos(lat)) / Math.pow(2, z); // m/px at this tile
  const out = new Uint8ClampedArray(256 * 256 * 4);
  const at = (px: number, py: number) => elev[Math.min(255, Math.max(0, py)) * 256 + Math.min(255, Math.max(0, px))];
  for (let py = 0; py < 256; py++) {
    for (let px = 0; px < 256; px++) {
      const z1 = at(px - 1, py - 1), z2 = at(px, py - 1), z3 = at(px + 1, py - 1);
      const z4 = at(px - 1, py),                            z6 = at(px + 1, py);
      const z7 = at(px - 1, py + 1), z8 = at(px, py + 1), z9 = at(px + 1, py + 1);
      const dzdx = (z3 + 2 * z6 + z9 - (z1 + 2 * z4 + z7)) / (8 * res);
      const dzdy = (z7 + 2 * z8 + z9 - (z1 + 2 * z2 + z3)) / (8 * res);
      const o = (py * 256 + px) * 4;
      if (mode === "slope") {
        const deg = Math.atan(Math.hypot(dzdx, dzdy)) * (180 / Math.PI);
        const ci = SLOPE_CLASSES.findIndex((c) => deg < c.max);
        if (inMask(mask, ci)) { const c = SLOPE_CLASSES[ci].color; out[o] = c[0]; out[o + 1] = c[1]; out[o + 2] = c[2]; out[o + 3] = FILL_ALPHA; }
      } else {
        let a = Math.atan2(dzdy, -dzdx) * (180 / Math.PI); // 0 = east
        a = (90 - a + 360) % 360; // 0 = north, clockwise
        const ci = Math.round(a / 45) % 8;
        if (inMask(mask, ci)) { const c = ASPECT_CLASSES[ci].color; out[o] = c[0]; out[o + 1] = c[1]; out[o + 2] = c[2]; out[o + 3] = FILL_ALPHA; }
      }
    }
  }
  return out;
}

function elevBands(elev: Float32Array, mask: number) {
  const out = new Uint8ClampedArray(256 * 256 * 4);
  for (let i = 0; i < 256 * 256; i++) {
    const ci = ELEV_CLASSES.findIndex((c) => elev[i] < c.max);
    if (inMask(mask, ci)) { const c = ELEV_CLASSES[ci].color; const o = i * 4; out[o] = c[0]; out[o + 1] = c[1]; out[o + 2] = c[2]; out[o + 3] = FILL_ALPHA; }
  }
  return out;
}

// ── register ────────────────────────────────────────────────────────────────
export function registerTerrainProtocols(gl: typeof maplibregl) {
  const handler = (mode: "slope" | "aspect" | "elev") => async (params: { url: string }) => {
    const { z, x, y, mask } = parse(params.url);
    try {
      const elev = await loadDem(z, x, y);
      const rgba = mode === "elev" ? elevBands(elev, mask) : slopeAspect(elev, z, y, mode, mask);
      return { data: await toPng(rgba) };
    } catch {
      return { data: await toPng(new Uint8ClampedArray(256 * 256 * 4)) };
    }
  };
  gl.addProtocol("slope", handler("slope") as any);
  gl.addProtocol("aspect", handler("aspect") as any);
  gl.addProtocol("elev", handler("elev") as any);
}

export const rgb = (c: number[]) => `rgb(${c[0]},${c[1]},${c[2]})`;
export const fullMask = (n: number) => (1 << n) - 1;
