# Solent Wing & Foildrive Conditions

A single-page dashboard that pulls live wind, tide and swell data for five local
spots and tells you where (and when) to ride:

| Spot | Activity | What makes it "GO" |
|---|---|---|
| Meon / Hill Head | Wing | ≥ 15 kn from E–S–WSW (on/cross-shore) |
| Emsworth | Wing | ≥ 15 kn from SE–SW; best near HW (shallow harbour top) |
| Hayling Island | Wing | ≥ 15 kn from ESE–W |
| West Wittering | Wing | ≥ 15 kn from SE–W |
| **Fareham Creek** | **Foildrive** | **High water ≥ 3.8 m (Chart Datum), within ±1.5 h of HW** |

Everything below 12 kn is a no-go for the wing, 12–15 kn is flagged marginal
(big-wing), 28–35 kn is flagged as a small-wing day, and gust spreads over
12 kn knock a spot down a grade. All thresholds, direction sectors and the
Fareham tide rule live in the `CONFIG` block at the top of `index.html` —
edit them to taste, no build step required.

## Running it

It's one self-contained HTML file with no dependencies:

- **Locally:** just open `index.html` in a browser.
- **Hosted:** enable GitHub Pages on this repo (Settings → Pages → deploy from
  branch) and bookmark the URL on your phone.

It auto-refreshes every 10 minutes.

## Data sources

### Live wind meters (Solentmet network + clubs)

The [Solentmet Support Group](https://www.bramblemet.co.uk) charity runs real
anemometers across the Solent and Chichester Harbour — exactly the "online wind
meters" this tool is built around:

- [Bramblemet](https://www.bramblemet.co.uk) — Bramble Bank, mid-Solent (covers Meon / Hill Head)
- [Emsmet](https://www.emsmet.co.uk) — Emsworth itself
- [Cambermet](https://www.cambermet.co.uk) — mid Chichester Harbour (covers Hayling)
- [Chimet](https://www.chimet.co.uk) — Chichester Bar (covers West Wittering and the Hayling seafront)
- [Hill Head Sailing Club weather station](https://www.hillheadsc.org.uk/sail/weather-station-1/)

The app attempts to read each station's text data feed directly from your
browser. If a station blocks cross-origin requests (or a feed path changes),
the card silently falls back to Open-Meteo model wind and the station stays
one click away via the links at the bottom of each card — so the page always
works. The feed parser is header-driven (`WSPD`/`WD`/`GST` columns), so it
tolerates column reordering. If you find a feed isn't being picked up live,
check the feed URLs in the `meters` config for that spot.

### Tide

- **Predictions / curve / next-HW:** [Open-Meteo Marine API](https://open-meteo.com/en/docs/marine-weather-api)
  `sea_level_height_msl` (free, keyless, CORS-enabled). Heights come back
  relative to mean sea level and are converted to approximate **Chart Datum**
  with a per-spot offset (`datumOffset`, ≈ 2.9 m at Portsmouth, ≈ 2.8 m in
  Chichester Harbour). Good enough for spotting springs vs neaps and the
  3.8 m Fareham rule, but it's a model — sanity-check against official
  [EasyTide](https://easytide.admiralty.co.uk/) tables before committing to a drive out.
- **Live observed height (Fareham):** [Environment Agency Tide Gauge API](https://environment.data.gov.uk/flood-monitoring/doc/tidegauge)
  — the Portsmouth Harbour gauge, 15-minute readings, no API key. Readings on
  the AOD datum are converted to Chart Datum (+2.73 m at Portsmouth).

### Swell & model wind fallback

[Open-Meteo](https://open-meteo.com) forecast API (wind in knots, current +
hourly) and Marine API (wave height / swell). Sheltered spots (Emsworth,
Fareham Creek) may show "n/a" for swell — the marine model has no cells that
far into the harbours, which is itself the correct answer.

## How the Fareham Foildrive logic works

1. Build the 3-day predicted tide curve and find every high water peak
   (quadratic interpolation between hourly points for a better HW time).
2. Keep only peaks ≥ 3.8 m CD (`foildrive.minHW`).
3. If *now* is within ±1.5 h (`foildrive.windowHrs`) of such a peak → **GO**,
   and the card shows the open window. Otherwise it shows the next window,
   or tells you it's neaps if nothing qualifies in the next 3 days.
4. Wind over 20 kn downgrades a GO to MARGINAL (chop).

## Ideas for later

- Push notification / email when a Fareham window coincides with light wind.
- 7-day planner view (which days have both wind and a big tide).
- Store your session log against the conditions that day.
