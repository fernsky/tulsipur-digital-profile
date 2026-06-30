// Distributed, phased climate data pipeline for the Tulsipur climate portal.
//
// Pulls ERA5 reanalysis (1940→today) and CMIP6 projections (→2050) from the
// free, key-less Open-Meteo APIs and bakes them into one static JSON
// (public/climate/climate.json) so the live site makes zero API calls.
//
// Open-Meteo throttles hard by IP (one 86-year request ≈ one IP's whole hourly
// budget), so this orchestrator SHARDS the fetch across a pool of SSH-reachable
// servers — each a fresh IP / independent budget — used as curl proxies, with
// automatic failover + per-server cooldown when one is rate-limited.
//
// Two phases so the portal can ship before every byte is in:
//   Phase A — centroid daily + all hourly + projections, via the FRESH IPs.
//             Writes a complete centroid-driven climate.json immediately.
//   Phase B — the other 8 spatial-grid daily points, via the full pool as
//             budgets reset. Rewrites the JSON with real spatial variation.
//
//   node scripts/build-climate.mjs
//
import { writeFileSync, mkdirSync, readFileSync, existsSync } from "node:fs";
import { dirname } from "node:path";
import { execFile } from "node:child_process";
import { homedir } from "node:os";

const KEY = `${homedir()}/.ssh/eshasan`;
const NOVA = `${homedir()}/.ssh/nova`;

// proxy pool — fresh IPs first so phase A lands fast
const PROXIES = [
  { id: "numa", host: "numanode", user: "root", key: KEY, port: 22, fresh: true },
  { id: "nova", host: "147.93.154.61", user: "b8b067f128ff27fd0eed294531b4", key: NOVA, port: 22, fresh: true },
  { id: "edge1", host: "167.71.235.54", user: "root", key: KEY, port: 22 },
  { id: "mvp", host: "64.227.172.123", user: "root", key: KEY, port: 22 },
  { id: "db", host: "143.110.254.143", user: "root", key: KEY, port: 22 },
  { id: "edge2", host: "143.110.247.60", user: "root", key: KEY, port: 22 },
  { id: "app3", host: "159.89.163.195", user: "root", key: KEY, port: 22 },
  { id: "app2", host: "159.65.151.149", user: "root", key: KEY, port: 22 },
  { id: "stg", host: "64.227.139.216", user: "root", key: KEY, port: 22 },
];
const cooldownUntil = new Map(); // proxy.id → ms epoch

const CACHE_DIR = "scripts/.climate-cache";
const cachePath = (id) => `${CACHE_DIR}/${id}.json`;

const BOUNDS = [82.2019, 27.964, 82.4307, 28.2485]; // [w,s,e,n]
const CENTER = [82.3163, 28.1063];
const ARCHIVE = "https://archive-api.open-meteo.com/v1/archive";
const CLIMATE = "https://climate-api.open-meteo.com/v1/climate";
const START_YEAR = 1940, HOURLY_START = 1980;
const END_YEAR = new Date().getUTCFullYear() - 1;
const START = `${START_YEAR}-01-01`, END = `${END_YEAR}-12-31`;
const NORM_FROM = 1991, NORM_TO = 2020;

const DAILY = [
  "temperature_2m_mean", "temperature_2m_max", "temperature_2m_min",
  "apparent_temperature_max", "apparent_temperature_min",
  "precipitation_sum", "rain_sum", "snowfall_sum", "precipitation_hours",
  "wind_speed_10m_max", "wind_gusts_10m_max", "wind_direction_10m_dominant",
  "shortwave_radiation_sum", "et0_fao_evapotranspiration",
];
const HOURLY = [
  "relative_humidity_2m", "surface_pressure", "pressure_msl",
  "cloud_cover", "wind_speed_10m", "wind_direction_10m",
];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function sshCurl(proxy, url) {
  return new Promise((resolve, reject) => {
    const args = ["-i", proxy.key, "-p", String(proxy.port),
      "-o", "StrictHostKeyChecking=accept-new", "-o", "BatchMode=yes", "-o", "ConnectTimeout=20",
      `${proxy.user}@${proxy.host}`, `curl -s --max-time 180 '${url}'`];
    execFile("ssh", args, { maxBuffer: 1 << 29 }, (err, stdout) => err ? reject(err) : resolve(stdout));
  });
}
function isLimit(j) { return j && j.error && /limit|minutely|hourly|daily/i.test(j.reason || ""); }

async function fetchViaPool(url, pool, start, label) {
  const order = pool.map((_, k) => (start + k) % pool.length);
  const backoff = [15, 60, 300, 900, 2400, 3900];
  for (let round = 0; round < backoff.length; round++) {
    for (const idx of order) {
      const p = pool[idx];
      if (Date.now() < (cooldownUntil.get(p.id) || 0)) continue;
      try {
        const txt = await sshCurl(p, url);
        let j; try { j = JSON.parse(txt); } catch { continue; }
        if (isLimit(j)) { cooldownUntil.set(p.id, Date.now() + 3600_000); continue; }
        if (j && j.error) throw new Error(j.reason || "api error");
        return { j, server: p.id };
      } catch { /* next server */ }
    }
    process.stdout.write(`  [${label}] pool busy — waiting ${backoff[round]}s\n`);
    await sleep(backoff[round] * 1000);
  }
  throw new Error("pool exhausted for " + label);
}

async function runJobs(jobs, pool) {
  const N = pool.length;
  const queues = Array.from({ length: N }, () => []);
  jobs.forEach((job, i) => queues[i % N].push({ ...job, start: i % N }));
  const out = {};
  mkdirSync(CACHE_DIR, { recursive: true });
  await Promise.all(queues.map(async (q) => {
    for (const job of q) {
      if (existsSync(cachePath(job.id))) {
        out[job.id] = JSON.parse(readFileSync(cachePath(job.id), "utf8"));
        console.log(`  • ${job.id} (cached)`); continue;
      }
      try {
        const { j, server } = await fetchViaPool(job.url, pool, job.start, job.id);
        out[job.id] = j; writeFileSync(cachePath(job.id), JSON.stringify(j));
        console.log(`  ✓ ${job.id} via ${server}`);
      } catch (e) { out[job.id] = null; console.log(`  ✗ ${job.id}: ${e.message}`); }
      await sleep(600);
    }
  }));
  return out;
}

// ── job URLs ─────────────────────────────────────────────────────────────────
const dailyUrl = (lat, lng) => `${ARCHIVE}?` + new URLSearchParams({ latitude: lat, longitude: lng, start_date: START, end_date: END, daily: DAILY.join(","), timezone: "auto" });
const hourlyUrl = (lat, lng, y0, y1) => `${ARCHIVE}?` + new URLSearchParams({ latitude: lat, longitude: lng, start_date: `${y0}-01-01`, end_date: `${y1}-12-31`, hourly: HOURLY.join(","), timezone: "auto" });
const projUrl = (lat, lng) => `${CLIMATE}?` + new URLSearchParams({ latitude: lat, longitude: lng, start_date: "1950-01-01", end_date: "2050-12-31", models: "MRI_AGCM3_2_S", daily: "temperature_2m_mean,precipitation_sum" });

// ── grid + math ───────────────────────────────────────────────────────────────
function buildGrid() {
  const [w, s, e, n] = BOUNDS, pad = 0.12;
  const xs = [w + (e - w) * pad, (w + e) / 2, e - (e - w) * pad];
  const ys = [n - (n - s) * pad, (s + n) / 2, s + (n - s) * pad];
  const pts = [];
  for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) pts.push({ row: r, col: c, lat: +ys[r].toFixed(4), lng: +xs[c].toFixed(4) });
  return pts;
}
const mean = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : null);
const round = (v, p = 1) => (v == null ? null : +v.toFixed(p));
function linreg(pts) {
  const n = pts.length; if (n < 2) return { slope: 0, intercept: 0, r2: 0 };
  let sx = 0, sy = 0, sxx = 0, sxy = 0, syy = 0;
  for (const { x, y } of pts) { sx += x; sy += y; sxx += x * x; sxy += x * y; syy += y * y; }
  const d = n * sxx - sx * sx, slope = d === 0 ? 0 : (n * sxy - sx * sy) / d;
  const r = (n * sxy - sx * sy) / Math.sqrt(Math.max((n * sxx - sx * sx) * (n * syy - sy * sy), 1e-9));
  return { slope, intercept: (sy - slope * sx) / n, r2: +(r * r).toFixed(3) };
}

function aggregateDaily(d) {
  const t = d.time, get = (k) => d[k] || [];
  const tmean = get("temperature_2m_mean"), tmax = get("temperature_2m_max"), tmin = get("temperature_2m_min");
  const atmax = get("apparent_temperature_max"), atmin = get("apparent_temperature_min");
  const pr = get("precipitation_sum"), rain = get("rain_sum"), snow = get("snowfall_sum");
  const wmax = get("wind_speed_10m_max"), gust = get("wind_gusts_10m_max");
  const srad = get("shortwave_radiation_sum"), et0 = get("et0_fao_evapotranspiration");
  const years = {}, monthsN = Array.from({ length: 12 }, () => ({ t: [], tx: [], tn: [], p: 0, pdays: 0, snow: 0, wind: [], srad: [], et0: 0 })), ymTemp = {};
  for (let i = 0; i < t.length; i++) {
    const yr = +t[i].slice(0, 4), mo = +t[i].slice(5, 7) - 1, Tm = tmean[i], Tx = tmax[i], Tn = tmin[i], P = pr[i] ?? 0;
    if (!years[yr]) years[yr] = { t: [], tx: [], tn: [], atx: [], atn: [], p: 0, rain: 0, snow: 0, et0: 0, srad: [], wind: [], gust: 0, hot35: 0, hot40: 0, cold5: 0, frost: 0, wet1: 0, heavy50: 0, max1: 0, run: 0, cdd: 0, days: 0 };
    const Y = years[yr];
    if (Tm != null) Y.t.push(Tm);
    if (Tx != null) { Y.tx.push(Tx); if (Tx >= 35) Y.hot35++; if (Tx >= 40) Y.hot40++; }
    if (Tn != null) { Y.tn.push(Tn); if (Tn <= 5) Y.cold5++; if (Tn <= 0) Y.frost++; }
    if (atmax[i] != null) Y.atx.push(atmax[i]); if (atmin[i] != null) Y.atn.push(atmin[i]);
    Y.p += P; Y.rain += rain[i] ?? 0; Y.snow += snow[i] ?? 0; Y.et0 += et0[i] ?? 0;
    if (srad[i] != null) Y.srad.push(srad[i]); if (wmax[i] != null) Y.wind.push(wmax[i]);
    if (gust[i] != null && gust[i] > Y.gust) Y.gust = gust[i];
    if (P >= 1) Y.wet1++; if (P >= 50) Y.heavy50++; if (P > Y.max1) Y.max1 = P;
    if (P < 1) { Y.run++; if (Y.run > Y.cdd) Y.cdd = Y.run; } else Y.run = 0;
    Y.days++;
    if (yr >= NORM_FROM && yr <= NORM_TO) {
      const Mo = monthsN[mo];
      if (Tm != null) Mo.t.push(Tm); if (Tx != null) Mo.tx.push(Tx); if (Tn != null) Mo.tn.push(Tn);
      Mo.p += P; if (P >= 1) Mo.pdays++; Mo.snow += snow[i] ?? 0;
      if (wmax[i] != null) Mo.wind.push(wmax[i]); if (srad[i] != null) Mo.srad.push(srad[i]); Mo.et0 += et0[i] ?? 0;
    }
    if (!ymTemp[yr]) ymTemp[yr] = Array.from({ length: 12 }, () => []);
    if (Tm != null) ymTemp[yr][mo].push(Tm);
  }
  const annual = Object.keys(years).map(Number).sort((a, b) => a - b).map((yr) => {
    const Y = years[yr]; if (Y.days < 300) return null;
    return { year: yr, t_mean: round(mean(Y.t)), t_max: round(mean(Y.tx)), t_min: round(mean(Y.tn)), at_max: round(mean(Y.atx)), at_min: round(mean(Y.atn)),
      precip: Math.round(Y.p), rain: Math.round(Y.rain), snow: round(Y.snow), et0: Math.round(Y.et0), srad: round(mean(Y.srad)), wind: round(mean(Y.wind)), gust: round(Y.gust),
      hot35: Y.hot35, hot40: Y.hot40, cold5: Y.cold5, frost: Y.frost, wet1: Y.wet1, heavy50: Y.heavy50, max1: round(Y.max1), cdd: Y.cdd };
  }).filter(Boolean);
  const nY = NORM_TO - NORM_FROM + 1;
  const normals = monthsN.map((M) => ({ t_mean: round(mean(M.t)), t_max: round(mean(M.tx)), t_min: round(mean(M.tn)), precip: Math.round(M.p / nY), rain_days: Math.round(M.pdays / nY), snow: round(M.snow / nY), wind: round(mean(M.wind)), srad: round(mean(M.srad)), et0: Math.round(M.et0 / nY) }));
  const monthTrend = Array.from({ length: 12 }, (_, mo) => {
    const series = Object.keys(ymTemp).map(Number).sort((a, b) => a - b).map((yr) => ({ x: yr, y: mean(ymTemp[yr][mo]) })).filter((p) => p.y != null);
    return round(linreg(series).slope * 10, 3);
  });
  return { annual, normals, monthTrend };
}

const DIR16 = ["N", "NNE", "NE", "ENE", "E", "ESE", "SE", "SSE", "S", "SSW", "SW", "WSW", "W", "WNW", "NW", "NNW"];
const SPEED_BINS = [1, 5, 12, 20, 28, 38];
function aggregateHourly(responses) {
  const monthsN = Array.from({ length: 12 }, () => ({ rh: [], sp: [], msl: [], cc: [] })), yrAcc = {};
  const rose = Array.from({ length: 16 }, () => new Array(SPEED_BINS.length).fill(0));
  let calm = 0, roseTotal = 0;
  for (const h of responses) {
    if (!h?.time) continue;
    const T = h.time, RH = h.relative_humidity_2m, SP = h.surface_pressure, MSL = h.pressure_msl, CC = h.cloud_cover, WS = h.wind_speed_10m, WD = h.wind_direction_10m;
    for (let i = 0; i < T.length; i++) {
      const yr = +T[i].slice(0, 4), mo = +T[i].slice(5, 7) - 1;
      if (!yrAcc[yr]) yrAcc[yr] = { rh: [], sp: [], cc: [] };
      const A = yrAcc[yr];
      if (RH?.[i] != null) A.rh.push(RH[i]); if (SP?.[i] != null) A.sp.push(SP[i]); if (CC?.[i] != null) A.cc.push(CC[i]);
      if (yr >= NORM_FROM && yr <= NORM_TO) {
        const M = monthsN[mo];
        if (RH?.[i] != null) M.rh.push(RH[i]); if (SP?.[i] != null) M.sp.push(SP[i]); if (MSL?.[i] != null) M.msl.push(MSL[i]); if (CC?.[i] != null) M.cc.push(CC[i]);
        if (WS?.[i] != null && WD?.[i] != null) {
          roseTotal++;
          if (WS[i] < 1) calm++;
          else { const sec = Math.round(WD[i] / 22.5) % 16; let bin = SPEED_BINS.length - 1; for (let b = 1; b < SPEED_BINS.length; b++) { if (WS[i] < SPEED_BINS[b]) { bin = b - 1; break; } } rose[sec][bin]++; }
        }
      }
    }
  }
  const normals = monthsN.map((M) => ({ rh: round(mean(M.rh)), pressure: round(mean(M.sp)), msl: round(mean(M.msl)), cloud: round(mean(M.cc)) }));
  const annual = Object.keys(yrAcc).map(Number).sort((a, b) => a - b).map((yr) => {
    const A = yrAcc[yr]; if (A.rh.length < 7000) return null;
    return { year: yr, rh: round(mean(A.rh)), pressure: round(mean(A.sp)), cloud: round(mean(A.cc)) };
  }).filter(Boolean);
  const rosePct = rose.map((s) => s.map((c) => +(100 * c / Math.max(roseTotal, 1)).toFixed(3)));
  return { normals, annual, rose: { dirs: DIR16, bins: SPEED_BINS, calm: +(100 * calm / Math.max(roseTotal, 1)).toFixed(2), data: rosePct } };
}

function aggregateProjection(j) {
  if (!j?.daily?.time) return null;
  const t = j.daily.time, tm = j.daily.temperature_2m_mean, pr = j.daily.precipitation_sum, years = {};
  for (let i = 0; i < t.length; i++) { const yr = +t[i].slice(0, 4); if (!years[yr]) years[yr] = { t: [], p: 0, days: 0 }; if (tm[i] != null) years[yr].t.push(tm[i]); years[yr].p += pr[i] ?? 0; years[yr].days++; }
  return Object.keys(years).map(Number).sort((a, b) => a - b).map((yr) => { const Y = years[yr]; if (Y.days < 300) return null; return { year: yr, t_mean: round(mean(Y.t)), precip: Math.round(Y.p) }; }).filter(Boolean);
}

// ── assemble climate.json from whatever raw responses are available ──────────
function buildOutput(raw, grid, hourlyIds) {
  const cId = "daily-r1c1"; // centroid (row 1, col 1)
  const centroidRaw = raw[cId];
  if (!centroidRaw?.daily) throw new Error("centroid daily missing — cannot build");
  // per-point: fall back to centroid for points not yet fetched (uniform fill)
  const perPoint = grid.map((p) => {
    const r = raw[`daily-r${p.row}c${p.col}`]?.daily ? raw[`daily-r${p.row}c${p.col}`] : centroidRaw;
    return { ...p, ...aggregateDaily(r.daily), real: !!raw[`daily-r${p.row}c${p.col}`]?.daily };
  });
  const centroid = perPoint[4];
  const hourly = aggregateHourly(hourlyIds.map((id) => raw[id]?.hourly).filter(Boolean));
  const projections = aggregateProjection(raw["proj"]);

  const hourlyByYear = Object.fromEntries(hourly.annual.map((a) => [a.year, a]));
  const annual = centroid.annual.map((a) => ({ ...a, ...(hourlyByYear[a.year] || {}) }));
  const normals = centroid.normals.map((m, i) => ({ ...m, ...hourly.normals[i] }));
  const tempReg = linreg(annual.map((a) => ({ x: a.year, y: a.t_mean })));
  const precReg = linreg(annual.map((a) => ({ x: a.year, y: a.precip })));
  const recent = annual.filter((a) => a.year >= NORM_FROM && a.year <= NORM_TO);
  const gridAnnual = perPoint.map((p) => ({ row: p.row, col: p.col, lat: p.lat, lng: p.lng, years: p.annual.map((a) => ({ year: a.year, t: a.t_mean, p: a.precip })) }));
  const spatialReady = perPoint.filter((p) => p.real).length;

  return {
    generated: new Date().toISOString().slice(0, 10), bounds: BOUNDS, center: CENTER,
    period: { start: START_YEAR, end: END_YEAR }, normalPeriod: { from: NORM_FROM, to: NORM_TO },
    spatialReady, // how many of the 9 grid cells hold their own (vs centroid) data
    grid: grid.map(({ row, col, lat, lng }) => ({ row, col, lat, lng })),
    normals, monthTrend: centroid.monthTrend, annual, windRose: hourly.rose,
    trends: { temp: { perDecade: round(tempReg.slope * 10, 3), r2: tempReg.r2, base: round(mean(recent.map((a) => a.t_mean))) }, precip: { perDecade: round(precReg.slope * 10, 1), r2: precReg.r2, base: Math.round(mean(recent.map((a) => a.precip)) || 0) } },
    gridAnnual, projections,
  };
}

function writeOut(out, tag) {
  const dest = "public/climate/climate.json";
  mkdirSync(dirname(dest), { recursive: true });
  writeFileSync(dest, JSON.stringify(out));
  const kb = (JSON.stringify(out).length / 1024).toFixed(0);
  console.log(`\n→ [${tag}] wrote ${dest} (${kb} KB) — ${out.annual.length} yrs · spatial ${out.spatialReady}/9 cells · warming ${out.trends.temp.perDecade}°C/decade\n`);
}

// ── main (phased) ─────────────────────────────────────────────────────────────
async function main() {
  const grid = buildGrid();
  const FRESH = PROXIES.filter((p) => p.fresh);
  const centroid = grid[4];
  const hourlyIds = [];
  const hourlyJobs = [];
  for (let y0 = HOURLY_START; y0 <= END_YEAR; y0 += 5) {
    const y1 = Math.min(y0 + 4, END_YEAR), id = `hourly-${y0}`;
    hourlyJobs.push({ id, url: hourlyUrl(CENTER[1], CENTER[0], y0, y1) }); hourlyIds.push(id);
  }

  // ── Phase A: essentials via fresh IPs → ship a complete centroid-driven portal
  console.log(`Phase A — centroid daily + ${hourlyJobs.length} hourly + projection via ${FRESH.length} fresh IPs…`);
  const essential = [
    { id: "daily-r1c1", url: dailyUrl(centroid.lat, centroid.lng) },
    ...hourlyJobs,
    { id: "proj", url: projUrl(CENTER[1], CENTER[0]) },
  ];
  const raw = await runJobs(essential, FRESH);
  writeOut(buildOutput(raw, grid, hourlyIds), "phase-A · ship-now");

  // ── Phase B: the other 8 spatial-grid daily points via the full pool
  console.log(`Phase B — 8 spatial-grid daily points via full pool (budgets reset over ~45 min)…`);
  const rest = grid.filter((_, i) => i !== 4).map((p) => ({ id: `daily-r${p.row}c${p.col}`, url: dailyUrl(p.lat, p.lng) }));
  Object.assign(raw, await runJobs(rest, PROXIES));
  writeOut(buildOutput(raw, grid, hourlyIds), "phase-B · full");
  console.log("✓ complete.");
}

main().catch((e) => { console.error(e); process.exit(1); });
