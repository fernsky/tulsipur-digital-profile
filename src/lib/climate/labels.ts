// Proper Devanagari names, units, colors and scales for every climate variable
// in the portal. Flat, palette-bounded colors (no gradients) — matches the GIS
// portal's design language.

// Nepali digits + helper (kept local so the climate bundle is self-contained).
const NE = "०१२३४५६७८९";
export const toNe = (s: string | number) => String(s).replace(/[0-9]/g, (d) => NE[+d]);

// Gregorian month names in Nepali (ERA5 uses the Gregorian calendar).
export const MONTHS_NE = [
  "जनवरी", "फेब्रुअरी", "मार्च", "अप्रिल", "मे", "जुन",
  "जुलाई", "अगस्ट", "सेप्टेम्बर", "अक्टोबर", "नोभेम्बर", "डिसेम्बर",
];
export const MONTHS_SHORT = ["जन", "फेब", "मार्च", "अप्रि", "मे", "जुन", "जुला", "अग", "सेप", "अक्टो", "नोभे", "डिसे"];

// Seasons (Nepal monsoon framing).
export const SEASONS = [
  { id: "winter", label: "हिउँद", months: [11, 0, 1], color: "#0891b2" },     // Dec–Feb
  { id: "pre", label: "पूर्व-मनसुन", months: [2, 3, 4], color: "#dc2626" },    // Mar–May
  { id: "monsoon", label: "मनसुन", months: [5, 6, 7, 8], color: "#2563eb" },  // Jun–Sep
  { id: "post", label: "मनसुन-पश्चात्", months: [9, 10], color: "#d97706" },   // Oct–Nov
];

// A mappable / chartable climate variable.
export type ClimVar = {
  id: string;
  label: string;       // Devanagari name
  short: string;       // compact label
  unit: string;        // Devanagari unit
  annualKey?: string;  // key in annual[] record
  normalKey?: string;  // key in normals[] record
  scale: [number, string][]; // value-stop → color (ascending), for the map heatmap
  decimals: number;
  agg: "mean" | "sum"; // how a year summarizes (affects spatial value source)
  category?: string;   // grouping for the variable picker
};

// Variable-category labels (core = Open-Meteo daily; rest = Copernicus ERA5-Land).
export const CATEGORIES: Record<string, string> = {
  core: "आधारभूत मौसम",
  soil: "माटो (तापक्रम र आर्द्रता)",
  snow: "हिउँ",
  veg: "वनस्पति",
  land: "भू-सतह",
  atmos: "वायुमण्डल (थप)",
};

// Flat sequential palettes (light→dark) per category, for data-driven ramps.
export const PALETTES: Record<string, string[]> = {
  temp: ["#2c7fb8", "#7fcdbb", "#c7e9b4", "#fed976", "#fd8d3c", "#e31a1c"],
  soil: ["#2c7fb8", "#7fcdbb", "#c7e9b4", "#fed976", "#fd8d3c", "#e31a1c"],
  moisture: ["#fde68a", "#fef3c7", "#a7f3d0", "#6ee7b7", "#22d3ee", "#1d4ed8"],
  snow: ["#f1f5f9", "#e0f2fe", "#bae6fd", "#7dd3fc", "#38bdf8", "#0284c7"],
  veg: ["#fef9c3", "#d9f99d", "#86efac", "#4ade80", "#22c55e", "#15803d"],
  generic: ["#f1f5f9", "#cbd5e1", "#94a3b8", "#64748b", "#475569", "#334155"],
};

// build a 6-stop ascending ramp from a value range + palette
export function rampFromRange(min: number, max: number, palette: string[]): [number, string][] {
  const n = palette.length;
  if (!isFinite(min) || !isFinite(max) || max <= min) return palette.map((c, i) => [i, c] as [number, string]);
  const step = (max - min) / n;
  return palette.map((c, i) => [+(min + step * i).toFixed(2), c] as [number, string]);
}

// pick a palette for an ERA5-Land variable by id / category
export function paletteFor(id: string, category: string): string[] {
  if (id.startsWith("soil_m")) return PALETTES.moisture;
  if (id.startsWith("soil_t") || category === "soil") return PALETTES.soil;
  if (category === "snow") return PALETTES.snow;
  if (category === "veg") return PALETTES.veg;
  if (/temp|skin|dewpoint/.test(id)) return PALETTES.temp;
  return PALETTES.generic;
}

// flat sequential ramps (discrete stops, no CSS gradients)
const TEMP_RAMP: [number, string][] = [
  [18, "#2c7fb8"], [21, "#7fcdbb"], [24, "#c7e9b4"], [26, "#fed976"], [28, "#fd8d3c"], [30, "#e31a1c"],
];
const PRECIP_RAMP: [number, string][] = [
  [800, "#fde68a"], [1100, "#a7f3d0"], [1400, "#6ee7b7"], [1700, "#34d399"], [2000, "#0ea5e9"], [2400, "#1d4ed8"],
];
const RH_RAMP: [number, string][] = [
  [50, "#fde68a"], [60, "#a7f3d0"], [68, "#6ee7b7"], [74, "#22d3ee"], [80, "#0ea5e9"], [86, "#1d4ed8"],
];
const CLOUD_RAMP: [number, string][] = [
  [30, "#f1f5f9"], [42, "#cbd5e1"], [52, "#94a3b8"], [62, "#64748b"], [72, "#475569"], [82, "#334155"],
];

export const VARS: ClimVar[] = [
  { id: "temp", label: "तापक्रम (औसत)", short: "तापक्रम", unit: "°से", annualKey: "t_mean", normalKey: "t_mean", scale: TEMP_RAMP, decimals: 1, agg: "mean", category: "core" },
  { id: "tmax", label: "उच्चतम तापक्रम", short: "उच्च ताप", unit: "°से", annualKey: "t_max", normalKey: "t_max", scale: TEMP_RAMP, decimals: 1, agg: "mean", category: "core" },
  { id: "tmin", label: "न्यूनतम तापक्रम", short: "न्यून ताप", unit: "°से", annualKey: "t_min", normalKey: "t_min", scale: TEMP_RAMP, decimals: 1, agg: "mean", category: "core" },
  { id: "precip", label: "वर्षा (कुल)", short: "वर्षा", unit: "मि.मि.", annualKey: "precip", normalKey: "precip", scale: PRECIP_RAMP, decimals: 0, agg: "sum", category: "core" },
  { id: "rh", label: "सापेक्षिक आर्द्रता", short: "आर्द्रता", unit: "%", annualKey: "rh", normalKey: "rh", scale: RH_RAMP, decimals: 0, agg: "mean", category: "core" },
  { id: "pressure", label: "वायुमण्डलीय चाप", short: "वायु चाप", unit: "hPa", annualKey: "pressure", normalKey: "pressure", scale: [], decimals: 0, agg: "mean", category: "core" },
  { id: "cloud", label: "बादल आवरण", short: "बादल", unit: "%", annualKey: "cloud", normalKey: "cloud", scale: CLOUD_RAMP, decimals: 0, agg: "mean", category: "core" },
  { id: "wind", label: "हावाको गति", short: "हावा", unit: "कि.मि./घ.", annualKey: "wind", normalKey: "wind", scale: [], decimals: 1, agg: "mean", category: "core" },
  { id: "srad", label: "सौर्य विकिरण", short: "विकिरण", unit: "MJ/m²", annualKey: "srad", normalKey: "srad", scale: [], decimals: 1, agg: "mean", category: "core" },
  { id: "et0", label: "वाष्पीकरण (ET₀)", short: "वाष्पीकरण", unit: "मि.मि.", annualKey: "et0", normalKey: "et0", scale: [], decimals: 0, agg: "sum", category: "core" },
];

// Extreme-climate indices (annual counts derived in the pipeline).
export const EXTREMES: { id: string; label: string; desc: string; unit: string; color: string }[] = [
  { id: "hot35", label: "तातो दिन (≥३५°)", desc: "उच्चतम तापक्रम ३५° से माथि भएका दिन", unit: "दिन", color: "#ea580c" },
  { id: "hot40", label: "अति-तातो दिन (≥४०°)", desc: "उच्चतम तापक्रम ४०° से माथि भएका दिन", unit: "दिन", color: "#b91c1c" },
  { id: "cold5", label: "चिसो दिन (≤५°)", desc: "न्यूनतम तापक्रम ५° से तल भएका दिन", unit: "दिन", color: "#0284c7" },
  { id: "heavy50", label: "भारी वर्षा (≥५०मि.मि.)", desc: "एक दिनमा ५० मि.मि. भन्दा बढी वर्षा", unit: "दिन", color: "#1d4ed8" },
  { id: "max1", label: "अधिकतम १-दिने वर्षा", desc: "वर्षको सबैभन्दा ठूलो एक-दिने वर्षा", unit: "मि.मि.", color: "#7c3aed" },
  { id: "wet1", label: "वर्षा भएका दिन", desc: "१ मि.मि. भन्दा बढी वर्षा भएका दिन", unit: "दिन", color: "#0891b2" },
  { id: "cdd", label: "लगातार सुक्खा दिन", desc: "वर्षभरिको सबैभन्दा लामो सुक्खा अवधि", unit: "दिन", color: "#d97706" },
];

// Analysis modes shown in the left panel.
export const MODES: { id: string; label: string; icon: string }[] = [
  { id: "normals", label: "जलवायु सामान्य", icon: "calendar" },
  { id: "trends", label: "दीर्घकालीन प्रवृत्ति", icon: "trend" },
  { id: "extremes", label: "चरम घटना सूचक", icon: "alert" },
  { id: "wind", label: "हावा गुलाब", icon: "wind" },
  { id: "spatial", label: "स्थानिक नक्सा", icon: "map" },
  { id: "projection", label: "भविष्य प्रक्षेपण", icon: "forward" },
];

// value → color from a discrete ascending ramp
export function rampColor(v: number | null, ramp: [number, string][]): string {
  if (v == null || !ramp.length) return "#cbd5e1";
  let c = ramp[0][1];
  for (const [stop, col] of ramp) { if (v >= stop) c = col; else break; }
  return c;
}

// lucide-style icons used by the climate panel (no emojis)
export const C_ICONS: Record<string, string> = {
  calendar: '<rect width="18" height="18" x="3" y="4" rx="2"/><path d="M3 10h18M8 2v4M16 2v4"/>',
  trend: '<path d="M3 17 9 11l4 4 8-8"/><path d="M14 7h7v7"/>',
  alert: '<path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3z"/><path d="M12 9v4M12 17h.01"/>',
  wind: '<path d="M12.8 19.6A2 2 0 1 0 14 16H2M17.5 8a2.5 2.5 0 1 1 2 4H2M9.8 4.4A2 2 0 1 1 11 8H2"/>',
  map: '<path d="m3 6 6-2 6 2 6-2v14l-6 2-6-2-6 2z"/><path d="M9 4v16M15 6v16"/>',
  forward: '<path d="m6 17 5-5-5-5M13 17l5-5-5-5"/>',
  thermometer: '<path d="M14 4v10.54a4 4 0 1 1-4 0V4a2 2 0 0 1 4 0Z"/>',
  drop: '<path d="M12 22a7 7 0 0 0 7-7c0-2-1-3.9-3-5.5s-3.5-4-4-6.5c-.5 2.5-2 4.9-4 6.5C6 11.1 5 13 5 15a7 7 0 0 0 7 7z"/>',
  gauge: '<path d="m12 14 4-4"/><path d="M3.34 19a10 10 0 1 1 17.32 0"/>',
  cloud: '<path d="M17.5 19a4.5 4.5 0 1 0 0-9h-1.8A7 7 0 1 0 4 15.3"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M6.3 17.7l-1.4 1.4M19.1 4.9l-1.4 1.4"/>',
  search: '<circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/>',
  layers: '<path d="m12.83 2.18a2 2 0 0 0-1.66 0L2.6 6.08a1 1 0 0 0 0 1.83l8.58 3.91a2 2 0 0 0 1.66 0l8.58-3.9a1 1 0 0 0 0-1.83Z"/><path d="m22 17.65-9.17 4.16a2 2 0 0 1-1.66 0L2 17.65"/><path d="m22 12.65-9.17 4.16a2 2 0 0 1-1.66 0L2 12.65"/>',
  close: '<path d="M18 6 6 18M6 6l12 12"/>',
  back: '<path d="m12 19-7-7 7-7"/><path d="M19 12H5"/>',
  compass: '<circle cx="12" cy="12" r="10"/><polygon points="16.24 7.76 14.12 14.12 7.76 16.24 9.88 9.88 16.24 7.76"/>',
  play: '<polygon points="6 3 20 12 6 21 6 3"/>',
  pause: '<rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/>',
};

export function cIcon(key: string, size = 18, cls = ""): string {
  const path = C_ICONS[key] || C_ICONS.compass;
  return `<svg class="${cls}" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${path}</svg>`;
}

// shared municipality extent (matches the GIS portal)
export const MUNI_BOUNDS: [number, number, number, number] = [82.2019, 27.964, 82.4307, 28.2485];
export const MUNI_CENTER: [number, number] = [82.3163, 28.1063];
