#!/usr/bin/env node
// Builds the geospatial portal data:
//   public/geo/base.pmtiles    — thematic polygon/line layers (wards, land use, risk, roads, rivers, …)
//   public/geo/parcels.pmtiles — ~113k cadastral parcels (high-zoom only)
//   public/geo/pois.geojson    — points of interest, for client-side clustering
//   public/geo/meta.json       — layer ids, counts, value domains (drives legend + filters)
//
// All sources are in Nepal_Nagarkot_TM_81; everything is reprojected to EPSG:4326.
// Requires: gdal (ogr2ogr/ogrinfo), tippecanoe, unrar/bsdtar.
//
// Usage:  node scripts/build-geo.mjs   [GEO_SRC=~/Downloads]

import { execSync, execFileSync } from "node:child_process";
import { mkdirSync, rmSync, existsSync, writeFileSync, readFileSync, readdirSync } from "node:fs";
import { homedir } from "node:os";
import { join, basename } from "node:path";

const SRC = process.env.GEO_SRC || join(homedir(), "Downloads");
const ROOT = process.cwd();
const WORK = "/tmp/tulsipur-geo";
const GJ = join(WORK, "geojson");
const OUT = join(ROOT, "public", "geo");

const GDB = join(SRC, "Landuse_data_Tulsipur/Geodatabase/Tulsipur.gdb");
const KMZ = join(SRC, "tULSIPUR.kmz");
const CAD_RAR = join(SRC, "Cadastral_Tulsipur.rar");
const MPK = join(SRC, "Tulsipur MTMP.mpk");

const sh = (cmd, opts = {}) => execSync(cmd, { stdio: "pipe", encoding: "utf8", ...opts });
const log = (...a) => console.log("·", ...a);
const ok = (...a) => console.log("✓", ...a);

function reset() {
  rmSync(WORK, { recursive: true, force: true });
  mkdirSync(GJ, { recursive: true });
  mkdirSync(OUT, { recursive: true });
}

// ── 1. probe the Nepal CRS from the gdb (cadastral shapefiles carry no .prj) ──
function probeCRS() {
  const probe = join(WORK, "crs_probe");
  rmSync(probe, { recursive: true, force: true });
  execFileSync("ogr2ogr", ["-f", "ESRI Shapefile", probe, GDB, "Ward_Boundary", "-limit", "1"]);
  const prj = join(probe, "Ward_Boundary.prj");
  const wkt = readFileSync(prj, "utf8");
  const target = join(WORK, "nepal.prj");
  writeFileSync(target, wkt);
  ok("probed source CRS:", wkt.slice(0, 40).replace(/\n/g, "") + "…");
  return target;
}

// ── 2. cadastral parcels ──────────────────────────────────────────────────
const CAD_AREAS = ["Duruwa", "Fulbari", "Halwar", "Manpur", "Tarigaun", "Tulsipur", "Urahipur"];
function buildCadastral(srcPrj) {
  log("extracting cadastral archive…");
  const cad = join(WORK, "cadastral");
  mkdirSync(cad, { recursive: true });
  execFileSync("unrar", ["x", "-o+", "-idq", CAD_RAR, cad + "/"]);
  const dir = join(cad, "Cadastral_Tulsipur");
  const files = [];
  let total = 0;
  for (const a of CAD_AREAS) {
    const shp = join(dir, `${a}_1_9.shp`);
    if (!existsSync(shp)) { log(`  (skip ${a} — not found)`); continue; }
    const out = join(GJ, `parcels_${a}.geojson`);
    // assign source CRS, reproject, tag area name, keep only useful fields
    execFileSync("ogr2ogr", [
      "-f", "GeoJSON", out,
      "-s_srs", srcPrj, "-t_srs", "EPSG:4326",
      "-sql", `SELECT parcelno, wardno, mapsheetno, area, '${a}' AS area_name FROM "${a}_1_9"`,
      shp,
    ]);
    const n = JSON.parse(readFileSync(out, "utf8")).features.length;
    total += n;
    files.push(out);
    ok(`  parcels ${a}: ${n.toLocaleString()}`);
  }
  return { files, total };
}

// ── 3. gdb thematic layers ────────────────────────────────────────────────
// id → { layer, type, sql? }   (sql lets us slim/rename fields)
const GDB_LAYERS = {
  wards:        { layer: "Ward_Boundary", type: "fill",
                  sql: `SELECT NEW_WARD_N AS ward, GaPa_NaPa AS palika FROM Ward_Boundary` },
  municipality: { layer: "LocalLevel", type: "line" },
  landuse:      { layer: "LandUse", type: "fill",
                  sql: `SELECT Name AS lu, Map_Legend AS legend, AREA_H AS area_h FROM LandUse` },
  landusezone:  { layer: "LandUseZone", type: "fill",
                  sql: `SELECT ZoneType AS zone, ZSubtypes AS subzone, Map_Legend AS legend FROM LandUseZone` },
  landcapability:{ layer: "LandCapability", type: "fill" },
  roads:        { layer: "Road_Centreline", type: "line",
                  sql: `SELECT ROAD_NAME AS name, ROAD_WIDTH AS width, SUR_TYPE AS surface FROM Road_Centreline` },
  rivers:       { layer: "HydroNetwork", type: "line",
                  sql: `SELECT Name AS name, Type AS type, Order_Des AS order_d FROM HydroNetwork` },
  geology:      { layer: "Gelology", type: "fill",
                  sql: `SELECT Zone AS zone, Formation AS formation, Rocktypes AS rocktype FROM Gelology` },
  soil:         { layer: "Soil_Polygon", type: "fill",
                  sql: `SELECT PHY_UNIT AS unit, WARD_NO AS ward FROM Soil_Polygon` },
  settlements:  { layer: "Settlement", type: "point",
                  sql: `SELECT SETTL_NAME AS name, VIL_Name AS village FROM Settlement` },
  risk_flood:     { layer: "Flood", type: "fill",     sql: `SELECT RiskLvl AS level, 'flood' AS hazard FROM Flood` },
  risk_landslide: { layer: "Landslide", type: "fill", sql: `SELECT RiskLvl AS level, 'landslide' AS hazard FROM Landslide` },
  risk_fire:      { layer: "Fire", type: "fill",      sql: `SELECT RiskLvl AS level, 'fire' AS hazard FROM Fire` },
  risk_seismic:   { layer: "Seismc", type: "fill",    sql: `SELECT RiskLvl AS level, 'seismic' AS hazard FROM Seismc` },
};

function buildGdbLayers() {
  const built = {};
  for (const [id, cfg] of Object.entries(GDB_LAYERS)) {
    const out = join(GJ, `${id}.geojson`);
    const args = ["-f", "GeoJSON", out, "-t_srs", "EPSG:4326", "-skipfailures"];
    if (cfg.sql) args.push("-sql", cfg.sql, GDB);
    else args.push(GDB, cfg.layer);
    try {
      execFileSync("ogr2ogr", args);
      const n = JSON.parse(readFileSync(out, "utf8")).features.length;
      built[id] = { file: out, type: cfg.type, count: n };
      ok(`  ${id} (${cfg.layer}): ${n.toLocaleString()}`);
    } catch (e) {
      log(`  (skip ${id} — ${String(e.message).split("\n")[0]})`);
    }
  }
  return built;
}

// ── 4. mpk transport master plan (lines) ──────────────────────────────────
function buildMtmp(srcPrj) {
  try {
    const mp = join(WORK, "mpk");
    mkdirSync(mp, { recursive: true });
    execFileSync("bsdtar", ["-xf", MPK, "-C", mp]);
    const shp = sh(`find ${JSON.stringify(mp)} -name '*.shp' | head -1`).trim();
    if (!shp) return null;
    const out = join(GJ, "mtmp.geojson");
    // this shapefile DOES carry a .prj; fall back to probed CRS if needed
    execFileSync("ogr2ogr", ["-f", "GeoJSON", out, "-t_srs", "EPSG:4326", shp]);
    const n = JSON.parse(readFileSync(out, "utf8")).features.length;
    ok(`  mtmp transport plan: ${n.toLocaleString()}`);
    return { file: out, type: "line", count: n };
  } catch (e) {
    log(`  (skip mtmp — ${String(e.message).split("\n")[0]})`);
    return null;
  }
}

// ── 5. kmz points of interest → single geojson with a `cat` field ─────────
function buildPois() {
  // list layers
  const info = sh(`ogrinfo -q ${JSON.stringify(KMZ)}`);
  const layers = info.split("\n")
    .map((l) => l.match(/^\d+:\s+(.+?)(\s+\([^)]+\))?$/))
    .filter(Boolean)
    .map((m) => m[1].trim())
    .filter((n) => n && n.toLowerCase() !== "tulsipur");
  const features = [];
  for (const lyr of layers) {
    const tmp = join(WORK, "poi_tmp.geojson");
    rmSync(tmp, { force: true });
    try {
      execFileSync("ogr2ogr", ["-f", "GeoJSON", tmp, "-t_srs", "EPSG:4326",
        "-nlt", "POINT", "-skipfailures", KMZ, lyr]);
      const gj = JSON.parse(readFileSync(tmp, "utf8"));
      for (const f of gj.features) {
        if (!f.geometry || f.geometry.type !== "Point") continue;
        features.push({
          type: "Feature",
          geometry: f.geometry,
          properties: { cat: lyr, name: f.properties?.Name || f.properties?.name || "" },
        });
      }
    } catch { /* skip non-point layers */ }
  }
  const out = join(OUT, "pois.geojson");
  writeFileSync(out, JSON.stringify({ type: "FeatureCollection", features }));
  ok(`  pois: ${features.length.toLocaleString()} across ${layers.length} categories`);
  // category counts for the filter UI
  const catCounts = {};
  for (const f of features) catCounts[f.properties.cat] = (catCounts[f.properties.cat] || 0) + 1;
  return { count: features.length, categories: catCounts };
}

// ── 5b. derive a clean land-use class from the messy Name field ───────────
// Name mixes class words ("Forest", "Agriculture") with proper names
// ("Saraswoti Community Forest"); style expressions can't substring-match,
// so we precompute `cls` here by keyword.
function classifyLanduse(gdb) {
  const info = gdb.landuse;
  if (!info) return;
  const gj = JSON.parse(readFileSync(info.file, "utf8"));
  const classify = (name) => {
    const s = (name || "").toLowerCase();
    if (/forest|jungle|बन|वन/.test(s)) return "forest";
    if (/bush|shrub|झाडी/.test(s)) return "bushes";
    if (/agri|farm|खेत|कृषि/.test(s)) return "agriculture";
    if (/settle|built|बस्ती|घर/.test(s)) return "settlement";
    if (/river|kulo|pond|lake|water|stream|नदी|कुलो|पोखरी/.test(s)) return "water";
    if (/sand|gravel|बालुवा/.test(s)) return "sand";
    if (/road|trail|सडक|बाटो/.test(s)) return "road";
    if (/public|institut|सार्वजनिक/.test(s)) return "public";
    if (/industr|उद्योग/.test(s)) return "industry";
    return "other";
  };
  for (const f of gj.features) f.properties.cls = classify(f.properties.lu);
  writeFileSync(info.file, JSON.stringify(gj));
  ok("  land-use classified into cls field");
}

// ── 5c. municipality mask (outer rect with the palika as a hole) ──────────
// Lets the portal clip the basemap + DEM analysis to the exact municipality shape.
function buildMask(gdb) {
  const m = gdb.municipality;
  if (!m) return;
  const gj = JSON.parse(readFileSync(m.file, "utf8"));
  const holes = [];
  for (const f of gj.features) {
    const g = f.geometry;
    const polys = g.type === "MultiPolygon" ? g.coordinates : [g.coordinates];
    for (const p of polys) holes.push(p[0]);
  }
  const outer = [[81.9, 27.7], [82.7, 27.7], [82.7, 28.5], [81.9, 28.5], [81.9, 27.7]];
  const mask = { type: "FeatureCollection", features: [{ type: "Feature", properties: {}, geometry: { type: "Polygon", coordinates: [outer, ...holes] } }] };
  writeFileSync(join(OUT, "mask.geojson"), JSON.stringify(mask));
  ok(`  municipality mask written (${holes.length} hole)`);
}

// ── 6. tippecanoe → pmtiles ───────────────────────────────────────────────
const CLIP = "82.10,27.92,82.55,28.35"; // Tulsipur envelope — drops reprojection strays
function packBase(gdb, mtmp) {
  const args = ["-o", join(OUT, "base.pmtiles"), "--force",
    "-Z6", "-z15", "--simplification=4", `--clip-bounding-box=${CLIP}`,
    "--drop-densest-as-needed", "--extend-zooms-if-still-dropping",
    "--no-tile-size-limit"];
  for (const [id, info] of Object.entries(gdb)) args.push("-L", `${id}:${info.file}`);
  if (mtmp) args.push("-L", `mtmp:${mtmp.file}`);
  execFileSync("tippecanoe", args, { stdio: "pipe" });
  ok("base.pmtiles written");
}

function packParcels(files) {
  const args = ["-o", join(OUT, "parcels.pmtiles"), "--force",
    "-Z12", "-z16", "-l", "parcels", `--clip-bounding-box=${CLIP}`,
    "--drop-densest-as-needed", "--extend-zooms-if-still-dropping",
    "--no-tile-size-limit", "--simplification=2", ...files];
  execFileSync("tippecanoe", args, { stdio: "pipe" });
  ok("parcels.pmtiles written");
}

// ── main ──────────────────────────────────────────────────────────────────
console.log("\nbuilding tulsipur geospatial data\n" + "─".repeat(40));
reset();
const srcPrj = probeCRS();

console.log("\n[1/5] cadastral parcels");
const cad = buildCadastral(srcPrj);

console.log("\n[2/5] gdb thematic layers");
const gdb = buildGdbLayers();

console.log("\n[3/5] transport master plan");
const mtmp = buildMtmp(srcPrj);

console.log("\n[4/5] points of interest");
const pois = buildPois();

console.log("\n[5/5] packing vector tiles");
classifyLanduse(gdb);
buildMask(gdb);
packBase(gdb, mtmp);
packParcels(cad.files);

// meta.json — drives the legend + filter UI
const meta = {
  generated: new Date().toISOString(),
  bounds: [82.18, 27.95, 82.50, 28.30],
  center: [82.30, 28.13],
  parcels: { count: cad.total, areas: CAD_AREAS },
  layers: Object.fromEntries(Object.entries(gdb).map(([id, i]) => [id, { type: i.type, count: i.count }])),
  mtmp: mtmp ? { count: mtmp.count } : null,
  pois,
};
writeFileSync(join(OUT, "meta.json"), JSON.stringify(meta, null, 2));
ok("meta.json written");

console.log("\n" + "─".repeat(40));
console.log(`done — ${cad.total.toLocaleString()} parcels, ${Object.keys(gdb).length} thematic layers, ${pois.count.toLocaleString()} pois`);
