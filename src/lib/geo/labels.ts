// Proper names, classes, colors and icons for every dataset in the portal.
// Devanagari-first. Colors are flat, palette-bounded (no gradients).

export type Basemap = { id: string; label: string; url: string; attribution: string; maxzoom?: number };

export const BASEMAPS: Basemap[] = [
  {
    id: "esri-imagery",
    label: "उपग्रह तस्बिर",
    url: "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
    attribution: "Esri, Maxar, Earthstar Geographics",
    maxzoom: 19,
  },
  {
    id: "google-hybrid",
    label: "गुगल हाइब्रिड",
    url: "https://mt0.google.com/vt/lyrs=y&hl=ne&x={x}&y={y}&z={z}",
    attribution: "Google",
    maxzoom: 21,
  },
  {
    id: "esri-street",
    label: "सडक नक्सा",
    url: "https://server.arcgisonline.com/ArcGIS/rest/services/World_Street_Map/MapServer/tile/{z}/{y}/{x}",
    attribution: "Esri",
    maxzoom: 19,
  },
  {
    id: "osm",
    label: "ओपन स्ट्रिट म्याप",
    url: "https://tile.openstreetmap.org/{z}/{x}/{y}.png",
    attribution: "© OpenStreetMap contributors",
    maxzoom: 19,
  },
  { id: "none", label: "कुनै होइन", url: "", attribution: "" },
];

// Tulsipur municipality extent — basemap and DEM tiles are bound to this box.
export const MUNI_BOUNDS: [number, number, number, number] = [82.2019, 27.964, 82.4307, 28.2485];

// Thematic vector layers (from base.pmtiles), grouped for the control panel.
export type LayerDef = {
  id: string;            // source-layer id inside base.pmtiles
  label: string;
  kind: "fill" | "line" | "point";
  group: string;
  defaultOn?: boolean;
};

export const LAYER_GROUPS: { id: string; label: string }[] = [
  { id: "admin", label: "आधार तथा सिमाना" },
  { id: "landuse", label: "भू-उपयोग" },
  { id: "risk", label: "विपद् जोखिम" },
  { id: "infra", label: "पूर्वाधार" },
  { id: "terrain", label: "भू-धरातल" },
];

export const LAYERS: LayerDef[] = [
  { id: "parcels", label: "कित्ता नक्सा", kind: "line", group: "admin" },
  { id: "wards", label: "वडा सिमाना", kind: "fill", group: "admin", defaultOn: true },
  { id: "municipality", label: "पालिका सिमाना", kind: "line", group: "admin", defaultOn: true },
  { id: "settlements", label: "बस्ती", kind: "point", group: "admin" },
  { id: "landuse", label: "भू-उपयोग", kind: "fill", group: "landuse", defaultOn: true },
  { id: "landusezone", label: "भू-उपयोग क्षेत्र", kind: "fill", group: "landuse" },
  { id: "landcapability", label: "भूमि क्षमता", kind: "fill", group: "landuse" },
  { id: "risk_flood", label: "बाढी जोखिम", kind: "fill", group: "risk" },
  { id: "risk_landslide", label: "पहिरो जोखिम", kind: "fill", group: "risk" },
  { id: "risk_fire", label: "आगलागी जोखिम", kind: "fill", group: "risk" },
  { id: "risk_seismic", label: "भूकम्प जोखिम", kind: "fill", group: "risk" },
  { id: "mtmp", label: "यातायात गुरुयोजना (सडक)", kind: "line", group: "infra", defaultOn: true },
  { id: "geology", label: "भूगर्भ", kind: "fill", group: "terrain" },
  { id: "soil", label: "माटो", kind: "fill", group: "terrain" },
];

// Land-use classes → label + flat color.
export const LANDUSE: Record<string, { label: string; color: string }> = {
  agriculture: { label: "कृषि", color: "#fde68a" },
  forest:      { label: "वन", color: "#15803d" },
  bushes:      { label: "झाडी", color: "#86efac" },
  settlement:  { label: "बस्ती", color: "#dc2626" },
  water:       { label: "जलाशय / नदी", color: "#2563eb" },
  sand:        { label: "बालुवा", color: "#e7d8b0" },
  road:        { label: "सडक", color: "#71717a" },
  public:      { label: "सार्वजनिक", color: "#7c3aed" },
  industry:    { label: "औद्योगिक", color: "#b45309" },
  other:       { label: "अन्य", color: "#cbd5e1" },
};

// Risk levels (RiskLvl = H/M/L).
export const RISK_LEVEL: Record<string, { label: string; color: string }> = {
  H: { label: "उच्च", color: "#b91c1c" },
  M: { label: "मध्यम", color: "#d97706" },
  L: { label: "न्यून", color: "#16a34a" },
};

export const HAZARD_LABEL: Record<string, string> = {
  flood: "बाढी", landslide: "पहिरो", fire: "आगलागी", seismic: "भूकम्प",
};

// ── points of interest ────────────────────────────────────────────────────
// group id → label + flat color + icon key (lucide path in ICONS)
export const POI_GROUPS: { id: string; label: string; color: string; icon: string }[] = [
  { id: "health",    label: "स्वास्थ्य", color: "#dc2626", icon: "cross" },
  { id: "education", label: "शिक्षा", color: "#2563eb", icon: "school" },
  { id: "religion",  label: "धार्मिक", color: "#9333ea", icon: "landmark" },
  { id: "finance",   label: "वित्तीय संस्था", color: "#047857", icon: "bank" },
  { id: "farm",      label: "कृषि / फार्म", color: "#65a30d", icon: "wheat" },
  { id: "security",  label: "सुरक्षा", color: "#1e3a8a", icon: "shield" },
  { id: "govt",      label: "शासन / कार्यालय", color: "#0f766e", icon: "building" },
  { id: "tourism",   label: "पर्यटन", color: "#db2777", icon: "mountain" },
  { id: "infra",     label: "पूर्वाधार / सेवा", color: "#b45309", icon: "wrench" },
  { id: "telecom",   label: "सञ्चार", color: "#0891b2", icon: "antenna" },
  { id: "hospitality", label: "होटल / खाना", color: "#ea580c", icon: "utensils" },
  { id: "other",     label: "अन्य", color: "#64748b", icon: "dot" },
];

// raw KMZ category → { group, label }
export const POI_TAXONOMY: Record<string, { group: string; label: string }> = {
  "A. CLILIC/PHARMACY":        { group: "health", label: "क्लिनिक / फार्मेसी" },
  "B. HOSPITALS":              { group: "health", label: "अस्पताल" },
  "C. HEALTHPOST":             { group: "health", label: "स्वास्थ्य चौकी" },
  "D. KHOP KENDRA":            { group: "health", label: "खोप केन्द्र" },
  "D. MEDICAL STORE":          { group: "health", label: "औषधि पसल" },
  "F. SURGICAL HOUSE":         { group: "health", label: "सर्जिकल हाउस" },
  "HOSPITALS/HEALTH INSTITUTES": { group: "health", label: "स्वास्थ्य संस्था" },
  "A. PRA.BI":                 { group: "education", label: "प्राथमिक विद्यालय" },
  "B.AA.BI":                   { group: "education", label: "आधारभूत विद्यालय" },
  "F. MAA.BI":                 { group: "education", label: "माध्यमिक विद्यालय" },
  "C.  BOARDING SCHOOL":       { group: "education", label: "बोर्डिङ विद्यालय" },
  "E. COLLAGES":               { group: "education", label: "क्याम्पस / कलेज" },
  "UNIVERSITY":                { group: "education", label: "विश्वविद्यालय" },
  "SCHOOLS/COLLAGES/EDU INSTITUTE": { group: "education", label: "शैक्षिक संस्था" },
  "B. TEMPLES/CHURCH/MASGID":  { group: "religion", label: "मन्दिर / चर्च / मस्जिद" },
  "A. GHAT":                   { group: "religion", label: "घाट" },
  "A. Banks":                  { group: "finance", label: "बैंक" },
  "B. लघुबित्त":               { group: "finance", label: "लघुवित्त" },
  "C. SAHAKARI SANSTHA":       { group: "finance", label: "सहकारी संस्था" },
  "POULTARY FARM":             { group: "farm", label: "कुखुरा फार्म" },
  "ANIMAL FARM":               { group: "farm", label: "पशु फार्म" },
  "FISH FARM":                 { group: "farm", label: "माछा फार्म" },
  "BEE FARM":                  { group: "farm", label: "मौरी फार्म" },
  "AGRICULTURE FARMS/ANIMAL FARM": { group: "farm", label: "कृषि / पशु फार्म" },
  "TARKARI TATHA FALFUL":      { group: "farm", label: "तरकारी तथा फलफूल" },
  "Police station":            { group: "security", label: "प्रहरी कार्यालय" },
  "Temporary police station":  { group: "security", label: "अस्थायी प्रहरी चौकी" },
  "Ilaka prahari":             { group: "security", label: "इलाका प्रहरी" },
  "Army barack":               { group: "security", label: "सेना ब्यारेक" },
  "शान्ति सुरक्षा":            { group: "security", label: "शान्ति सुरक्षा" },
  "Gov offices":               { group: "govt", label: "सरकारी कार्यालय" },
  "WARD OFFICES":              { group: "govt", label: "वडा कार्यालय" },
  "SUB-METROPOILTIAN CITY":    { group: "govt", label: "उपमहानगरपालिका" },
  "DURBAR":                    { group: "govt", label: "दरबार" },
  "LAKES/DAMS":                { group: "tourism", label: "ताल / बाँध" },
  "View Tower/Danda":          { group: "tourism", label: "भ्यू टावर / डाँडा" },
  "PARK":                      { group: "tourism", label: "पार्क" },
  "CAVES":                     { group: "tourism", label: "गुफा" },
  "TOURISMS":                  { group: "tourism", label: "पर्यटकीय स्थल" },
  "PETROL PUMPS":              { group: "infra", label: "पेट्रोल पम्प" },
  "A. SAMUDAYIK BHAWAN":       { group: "infra", label: "सामुदायिक भवन" },
  "B.PRATIKSHAYALA/GATE/basti": { group: "infra", label: "प्रतीक्षालय / गेट" },
  "बस्ती, आवास, भवन तथा सार्वजनिक निर्माण": { group: "infra", label: "आवास तथा सार्वजनिक निर्माण" },
  "सडक, पुल तथा यातायात":      { group: "infra", label: "सडक, पुल तथा यातायात" },
  "खानेपानी तथा सरसफाई":       { group: "infra", label: "खानेपानी तथा सरसफाई" },
  "उद्योग, व्यापार, व्यवसाय तथा आपूर्ति": { group: "infra", label: "उद्योग, व्यापार तथा आपूर्ति" },
  "NAMESTA":                   { group: "telecom", label: "नमस्ते (NTC)" },
  "NCELL":                     { group: "telecom", label: "एनसेल" },
  "RADIO":                     { group: "telecom", label: "रेडियो" },
  "सूचना, सञ्चार तथा प्रविधि":  { group: "telecom", label: "सूचना तथा सञ्चार" },
  "HOTELS.CAFE.RESTURANTS":    { group: "hospitality", label: "होटल / क्याफे / रेस्टुरेन्ट" },
  "VOTING CENTRE":             { group: "other", label: "मतदान केन्द्र" },
  "खेलकुद तथा नवप्रवर्तन":      { group: "other", label: "खेलकुद तथा नवप्रवर्तन" },
  "बन तथा जैविक विविधता":      { group: "other", label: "वन तथा जैविक विविधता" },
  "RISK AREA":                 { group: "other", label: "जोखिम क्षेत्र" },
};

export function poiInfo(rawCat: string): { group: string; label: string } {
  return POI_TAXONOMY[rawCat] || { group: "other", label: rawCat };
}

// lucide-style icon paths (stroke, 24×24 viewBox) — no emojis.
export const ICONS: Record<string, string> = {
  cross: '<path d="M11 2h2a1 1 0 0 1 1 1v6h6a1 1 0 0 1 1 1v2a1 1 0 0 1-1 1h-6v6a1 1 0 0 1-1 1h-2a1 1 0 0 1-1-1v-6H3a1 1 0 0 1-1-1v-2a1 1 0 0 1 1-1h6V3a1 1 0 0 1 1-1z"/>',
  school: '<path d="M14 22v-4a2 2 0 0 0-4 0v4"/><path d="m18 10 4 2v8a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2v-8l4-2"/><path d="M18 5v17"/><path d="m4 6 8-4 8 4"/><path d="M6 5v17"/><circle cx="12" cy="9" r="2"/>',
  landmark: '<path d="M3 22h18"/><path d="M6 18v-7"/><path d="M10 18v-7"/><path d="M14 18v-7"/><path d="M18 18v-7"/><path d="M4 11h16"/><path d="m12 2 8 6H4z"/>',
  bank: '<path d="m3 10 9-7 9 7"/><path d="M5 10v9"/><path d="M19 10v9"/><path d="M9 10v9"/><path d="M15 10v9"/><path d="M3 22h18"/>',
  wheat: '<path d="M2 22 16 8"/><path d="M3.47 12.53 5 11l1.53 1.53a3.5 3.5 0 0 1 0 4.94L5 19l-1.53-1.53a3.5 3.5 0 0 1 0-4.94Z"/><path d="M7.47 8.53 9 7l1.53 1.53a3.5 3.5 0 0 1 0 4.94L9 15l-1.53-1.53a3.5 3.5 0 0 1 0-4.94Z"/><path d="M11.47 4.53 13 3l1.53 1.53a3.5 3.5 0 0 1 0 4.94L13 11l-1.53-1.53a3.5 3.5 0 0 1 0-4.94Z"/>',
  shield: '<path d="M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z"/>',
  building: '<rect width="16" height="20" x="4" y="2" rx="2"/><path d="M9 22v-4h6v4"/><path d="M8 6h.01"/><path d="M16 6h.01"/><path d="M12 6h.01"/><path d="M12 10h.01"/><path d="M12 14h.01"/><path d="M16 10h.01"/><path d="M16 14h.01"/><path d="M8 10h.01"/><path d="M8 14h.01"/>',
  mountain: '<path d="m8 3 4 8 5-5 5 15H2L8 3z"/>',
  wrench: '<path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z"/>',
  antenna: '<path d="M2 12 7 2"/><path d="m7 12 5-10"/><path d="m12 12 5-10"/><path d="m17 12 5-10"/><path d="M4.5 7h15"/><path d="M12 16v6"/>',
  utensils: '<path d="M3 2v7c0 1.1.9 2 2 2h4a2 2 0 0 0 2-2V2"/><path d="M7 2v20"/><path d="M21 15V2a5 5 0 0 0-5 5v6c0 1.1.9 2 2 2h3Zm0 0v7"/>',
  dot: '<circle cx="12" cy="12" r="4"/>',
  search: '<circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/>',
  layers: '<path d="m12.83 2.18a2 2 0 0 0-1.66 0L2.6 6.08a1 1 0 0 0 0 1.83l8.58 3.91a2 2 0 0 0 1.66 0l8.58-3.9a1 1 0 0 0 0-1.83Z"/><path d="m22 17.65-9.17 4.16a2 2 0 0 1-1.66 0L2 17.65"/><path d="m22 12.65-9.17 4.16a2 2 0 0 1-1.66 0L2 12.65"/>',
  close: '<path d="M18 6 6 18"/><path d="m6 6 12 12"/>',
  back: '<path d="m12 19-7-7 7-7"/><path d="M19 12H5"/>',
  compass: '<circle cx="12" cy="12" r="10"/><polygon points="16.24 7.76 14.12 14.12 7.76 16.24 9.88 9.88 16.24 7.76"/>',
};

export function icon(key: string, size = 18, cls = ""): string {
  const path = ICONS[key] || ICONS.dot;
  return `<svg class="${cls}" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${path}</svg>`;
}

// Nepali digits.
const NE = "०१२३४५६७८९";
export const toNe = (s: string | number) => String(s).replace(/[0-9]/g, (d) => NE[+d]);
