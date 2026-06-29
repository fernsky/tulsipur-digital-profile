# Tulsipur geospatial portal — design

## goal
A robust, high-performance, fully static geospatial portal embedded in the Tulsipur
digital profile so ward-level officials can visualize and analyze every spatial dataset
the municipality holds — cadastral parcels, land use, hazard/risk, infrastructure, and
points of interest — with layer control, filtering, search, and feature inspection.

## data inventory (all in Nepal_Nagarkot_TM_81 → reprojected to EPSG:4326)
- **cadastral**: 7 area shapefiles, ~113,000 parcels (`parcelno`, `wardno`, `area`, `mapsheetno`). no owner/personal data.
- **land use gdb** (`Tulsipur.gdb`, 31 layers): LandUse (Name = कृषि/वन/…), LandUseZone, LandCapability,
  LandSystem, Flood/Fire/Landslide/Seismic risk (RiskLvl H/M/L), Geology, Soil, HydroNetwork,
  Road_Centreline, Ward_Boundary (NEW_WARD_N 1–19), Settlement, LocalLevel boundary.
- **kmz** (`tULSIPUR.kmz`, 58 categories): hospitals, schools, banks, temples, hotels, petrol pumps,
  police/army, govt/ward offices, farms, tourism, telecom, voting centres → POI layer.
- **mpk** (`Tulsipur MTMP.mpk`): municipal transport master plan road network (lines).

## architecture
Fully client-side, static-hosted (Cloudflare). No tile server.

- **build pipeline** (`scripts/build-geo.mjs`): ogr2ogr reprojects every source to WGS84 GeoJSON →
  tippecanoe packs all polygon/line layers into one `public/geo/tulsipur.pmtiles` (per-layer,
  zoom-aware simplification; parcels stay crisp at high zoom). POIs emit as
  `public/geo/pois.geojson` (points, for client-side clustering). A `public/geo/meta.json`
  records layer ids, feature counts, and value domains for the legend/filter UI.
- **render**: MapLibre GL JS + `pmtiles` protocol plugin (range requests over the static file).
  GPU vector rendering → smooth at 113k parcels.
- **page**: `/map` (`src/pages/map.astro`), full-screen, outside the chapter chrome but linked
  from the sidebar. island script `src/lib/geo/portal.ts` boots the map.

## features
- **basemaps**: Esri World Imagery, Esri World Street, Google hybrid (mt0), OpenStreetMap — switchable.
- **layers**: toggle + opacity per dataset, grouped (आधार / भूउपयोग / जोखिम / पूर्वाधार / बिन्दु).
- **pois**: clustered by category with proper Nepali names and lucide-style glyph icons; filter by category.
- **filters**: by ward (1–19), by land-use class, by risk level.
- **search**: place/ward/parcel-number search that flies to the feature.
- **inspect**: click any parcel/polygon/POI → attribute popup with Nepali labels + Nepali digits.
- **legend**: live, reflects visible layers.
- **animations**: pitched 3D fly-in + slow bearing swivel on load; eased flyTo on search/ward jump;
  respects `prefers-reduced-motion`.
- **responsive**: desktop side panel collapses to a mobile bottom-sheet; full touch/pinch/rotate.

## design language (per eShasan DESIGN.md + project tokens)
- single primary navy (`--color-primary` #1e293b); flat fills, borders for depth, no gradients/shadows-as-decoration.
- Noto Serif Devanagari everywhere; Devanagari-first strings; Nepali digits via existing `toNe`.
- lucide-style line icons only, no emojis. no uppercase, no wide tracking (enforced globally in `global.css`).
- `text-sm`-class density; full-contrast text only.

## out of scope (v1)
satellite ward PDFs (reference only), editing/drawing tools, server-side analysis.
