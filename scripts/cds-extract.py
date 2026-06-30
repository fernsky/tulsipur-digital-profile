#!/usr/bin/env python3
"""
Copernicus CDS / ERA5-Land monthly extraction for the Tulsipur climate portal.

Pulls the comprehensive set of land-surface / soil / snow / atmospheric monthly
indicators that the Open-Meteo daily pipeline does NOT provide, over the
municipality bbox at ERA5-Land 0.1deg (~9 km) resolution, and bakes them into
public/climate/era5land.json — monthly normals (1991-2020), annual series,
per-decade trends, and a per-cell spatial grid for fine heatmaps.

Downloads cache to scripts/.climate-cache/cds/ (resumable). Run:
    scripts/.venv-climate/bin/python scripts/cds-extract.py
"""
import os, json, zipfile, math
import numpy as np
import xarray as xr
import cdsapi

AREA = [28.40, 82.10, 27.90, 82.50]  # N, W, S, E (padded over the municipality)
YEARS_LAND = [str(y) for y in range(1950, 2026)]   # ERA5-Land starts 1950
YEARS_SL = [str(y) for y in range(1950, 2026)]      # ERA5 single-levels
MONTHS = [f"{m:02d}" for m in range(1, 13)]
NORM_FROM, NORM_TO = 1991, 2020

CACHE = "scripts/.climate-cache/cds"
os.makedirs(CACHE, exist_ok=True)
LAND = "reanalysis-era5-land-monthly-means"
SL = "reanalysis-era5-single-levels-monthly-means"

K = 273.15
# (id, dataset, [cds_variable(s)], label, unit, kind, category)
#   kind: how to turn the raw data_var(s) into a value
SPECS = [
    ("dewpoint",   LAND, ["2m_dewpoint_temperature"], "हिमांक बिन्दु (Dewpoint)", "°से", "tempK", "atmos"),
    ("skin_temp",  LAND, ["skin_temperature"], "सतह तापक्रम (Skin)", "°से", "tempK", "land"),
    ("soil_t1",    LAND, ["soil_temperature_level_1"], "माटो तापक्रम ०–७ से.मि.", "°से", "tempK", "soil"),
    ("soil_t2",    LAND, ["soil_temperature_level_2"], "माटो तापक्रम ७–२८ से.मि.", "°से", "tempK", "soil"),
    ("soil_t3",    LAND, ["soil_temperature_level_3"], "माटो तापक्रम २८–१०० से.मि.", "°से", "tempK", "soil"),
    ("soil_t4",    LAND, ["soil_temperature_level_4"], "माटो तापक्रम १–२.५ मि.", "°से", "tempK", "soil"),
    ("soil_m1",    LAND, ["volumetric_soil_water_layer_1"], "माटो आर्द्रता ०–७ से.मि.", "%आयतन", "frac100", "soil"),
    ("soil_m2",    LAND, ["volumetric_soil_water_layer_2"], "माटो आर्द्रता ७–२८ से.मि.", "%आयतन", "frac100", "soil"),
    ("soil_m3",    LAND, ["volumetric_soil_water_layer_3"], "माटो आर्द्रता २८–१०० से.मि.", "%आयतन", "frac100", "soil"),
    ("soil_m4",    LAND, ["volumetric_soil_water_layer_4"], "माटो आर्द्रता १–२.५ मि.", "%आयतन", "frac100", "soil"),
    ("snow_depth", LAND, ["snow_depth"], "हिउँ गहिराइ (जल समतुल्य)", "से.मि.", "m_to_cm", "snow"),
    ("snow_cover", LAND, ["snow_cover"], "हिउँ आवरण", "%", "asis", "snow"),
    ("lai_high",   LAND, ["leaf_area_index_high_vegetation"], "पात क्षेत्र सूचक (उच्च वनस्पति)", "m²/m²", "asis", "veg"),
    ("lai_low",    LAND, ["leaf_area_index_low_vegetation"], "पात क्षेत्र सूचक (न्यून वनस्पति)", "m²/m²", "asis", "veg"),
    ("albedo",     LAND, ["forecast_albedo"], "सतह परावर्तन (Albedo)", "%", "frac100", "land"),
    ("msl",        SL,   ["mean_sea_level_pressure"], "समुद्र-सतह वायुचाप", "hPa", "pa_to_hpa", "atmos"),
    ("wind100",    SL,   ["100m_u_component_of_wind", "100m_v_component_of_wind"], "हावा गति १०० मि. (ऊर्जा)", "कि.मि./घ.", "wind_kmh", "atmos"),
    ("tcwv",       SL,   ["total_column_water_vapour"], "वायुस्तम्भ जलवाष्प", "kg/m²", "asis", "atmos"),
    ("cape",       SL,   ["convective_available_potential_energy"], "संवहनीय ऊर्जा (CAPE)", "J/kg", "asis", "atmos"),
]


def fetch(spec):
    sid, dataset, variables = spec[0], spec[1], spec[2]
    out = f"{CACHE}/{sid}.nc"
    if os.path.exists(out) and os.path.getsize(out) > 1000:
        return out
    years = YEARS_LAND if dataset == LAND else YEARS_SL
    req = {
        "product_type": "monthly_averaged_reanalysis",
        "variable": variables, "year": years, "month": MONTHS,
        "time": "00:00", "area": AREA, "data_format": "netcdf",
    }
    print(f"  · fetching {sid} ({dataset.split('-')[1]}) …", flush=True)
    cdsapi.Client().retrieve(dataset, req, out)
    return out


def open_nc(path):
    if zipfile.is_zipfile(path):
        z = zipfile.ZipFile(path)
        member = [n for n in z.namelist() if n.endswith(".nc")][0]
        z.extract(member, CACHE)
        return xr.open_dataset(f"{CACHE}/{member}")
    return xr.open_dataset(path)


def convert(kind, dvars):
    """dvars: list of xr.DataArray. Returns a single DataArray in target units."""
    if kind == "tempK":
        return dvars[0] - K
    if kind == "frac100":
        return dvars[0] * 100.0
    if kind == "m_to_cm":
        return dvars[0] * 100.0
    if kind == "pa_to_hpa":
        return dvars[0] / 100.0
    if kind == "wind_kmh":
        return np.hypot(dvars[0], dvars[1]) * 3.6
    return dvars[0]  # asis


def linreg(xs, ys):
    n = len(xs)
    if n < 2:
        return 0.0
    xs = np.array(xs, float); ys = np.array(ys, float)
    sx, sy = xs.sum(), ys.sum()
    d = n * (xs * xs).sum() - sx * sx
    return 0.0 if d == 0 else (n * (xs * ys).sum() - sx * sy) / d


def time_coord(da):
    for c in ("valid_time", "time", "forecast_reference_time"):
        if c in da.coords:
            return c
    raise KeyError("no time coord")


def aggregate(spec, ds):
    sid, kind, decimals = spec[0], spec[5], 2
    short = list(ds.data_vars)
    dvars = [ds[v] for v in short]
    da = convert(kind, dvars)
    tc = time_coord(dvars[0])
    da = da.assign_coords({tc: dvars[0][tc]})
    # collapse the expver/number singleton dims if present
    for extra in ("number", "expver"):
        if extra in da.dims:
            da = da.isel({extra: 0}, drop=True)
    latn = "latitude" if "latitude" in da.dims else "lat"
    lonn = "longitude" if "longitude" in da.dims else "lon"

    # spatial mean → monthly series
    series = da.mean(dim=[latn, lonn], skipna=True)
    times = np.array(series[tc].values)
    years = np.array([int(str(t)[:4]) for t in times])
    months = np.array([int(str(t)[5:7]) for t in times])
    vals = np.array(series.values, float)

    # monthly normals 1991-2020
    normals = []
    for m in range(1, 13):
        sel = vals[(months == m) & (years >= NORM_FROM) & (years <= NORM_TO)]
        normals.append(None if sel.size == 0 else round(float(np.nanmean(sel)), decimals))
    # annual means
    annual = []
    for y in sorted(set(years.tolist())):
        sel = vals[years == y]
        if sel.size >= 10:
            annual.append({"year": int(y), "v": round(float(np.nanmean(sel)), decimals)})
    # per-decade trend
    trend = round(linreg([a["year"] for a in annual], [a["v"] for a in annual]) * 10, 3)
    # per-cell long-term mean grid (full record)
    cellmean = da.mean(dim=tc, skipna=True)
    lats = [float(x) for x in cellmean[latn].values]
    lons = [float(x) for x in cellmean[lonn].values]
    cells = [{"lat": round(la, 3), "lng": round(lo, 3)} for la in lats for lo in lons]
    grid = []
    arr = np.array(cellmean.values, float)
    for i, la in enumerate(lats):
        for j, lo in enumerate(lons):
            v = arr[i, j]
            if not math.isnan(v):
                grid.append({"lat": round(la, 3), "lng": round(lo, 3), "v": round(float(v), decimals)})

    # per-year, per-cell grids → year-wise map animation (cells in `cells` order)
    da2 = da.transpose(tc, latn, lonn)
    v3 = np.array(da2.values, float)  # (time, lat, lon)
    grid_years, allvals = [], []
    for y in sorted(set(years.tolist())):
        m = years == y
        if m.sum() < 6:
            continue
        a2 = np.nanmean(v3[m], axis=0)  # (lat, lon)
        flat = [None if math.isnan(x) else round(float(x), decimals) for x in a2.flatten()]
        grid_years.append({"year": int(y), "v": flat})
        allvals += [float(x) for x in a2.flatten() if not math.isnan(x)]
    vmin = round(float(np.nanmin(allvals)), decimals) if allvals else 0.0
    vmax = round(float(np.nanmax(allvals)), decimals) if allvals else 1.0

    return {
        "id": sid, "label": spec[3], "unit": spec[4], "category": spec[6], "decimals": decimals,
        "normals": normals, "annual": annual, "trend": trend, "grid": grid,
        "cells": cells, "gridYears": grid_years, "vmin": vmin, "vmax": vmax,
    }


def main():
    out_vars = {}
    for spec in SPECS:
        try:
            path = fetch(spec)
            ds = open_nc(path)
            out_vars[spec[0]] = aggregate(spec, ds)
            ds.close()
            n = len(out_vars[spec[0]]["annual"])
            print(f"    ✓ {spec[0]}: {n} yrs, trend {out_vars[spec[0]]['trend']}/decade", flush=True)
        except Exception as e:
            print(f"    ✗ {spec[0]}: {e}", flush=True)

    out = {
        "generated": "",  # stamped by caller / left blank (no Date in offline build determinism)
        "area": AREA, "normalPeriod": {"from": NORM_FROM, "to": NORM_TO},
        "source": "ERA5-Land + ERA5 monthly-averaged reanalysis (Copernicus CDS)",
        "categories": {
            "soil": "माटो (तापक्रम र आर्द्रता)", "snow": "हिउँ", "veg": "वनस्पति",
            "land": "भू-सतह", "atmos": "वायुमण्डल",
        },
        "vars": out_vars,
    }
    dest = "public/climate/era5land.json"
    os.makedirs(os.path.dirname(dest), exist_ok=True)
    with open(dest, "w") as f:
        json.dump(out, f, ensure_ascii=False)
    kb = os.path.getsize(dest) / 1024
    print(f"\n✓ wrote {dest} ({kb:.0f} KB) — {len(out_vars)} indicators")


if __name__ == "__main__":
    main()
