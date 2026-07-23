# Solent Wing & Foildrive Conditions

A single-page dashboard that pulls live wind, tide and swell data for seven local
spots and tells you where (and when) to ride:

| Spot | Activity | What makes it "GO" |
|---|---|---|
| Meon / Hill Head | Wing | ≥ 15 kn from E–S–WSW (on/cross-shore) |
| Emsworth | Wing | ≥ 15 kn from SE–SW; best near HW (shallow harbour top) |
| Hayling Island | Wing | ≥ 15 kn from ESE–W |
| West Wittering | Wing | ≥ 15 kn from SE–W |
| Hurst Castle / Milford | Wing | ≥ 15 kn from S–W (the SW funnels through the Needles Channel) |
| Calshot Spit | Wing | ≥ 15 kn from S–W; flat behind the spit low-mid tide, open swell at HW |
| Lepe | Wing | ≥ 15 kn from SE–W |
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

Plus, at the western end, two OceanWise WeatherFile stations (JSON feeds —
the meter reader handles both formats):

- [Hurst Castle](https://weatherfile.com/location?loc_id=GBR00002) — on the castle itself
- [Lymington Starting Platform](https://weatherfile.com/location?loc_id=GBR00001)
- [Calshot Activities Centre](https://weatherfile.com/location?loc_id=GBR00065) — right at Calshot Spit

Sotonmet (Southampton Bar/Dockhead) is wired in as a fallback for Calshot — it's
the same Solentmet-family network as Bramblemet/Chimet/Cambermet/Emsmet, run by
ABP Southampton a few miles up the water.

**Lepe has no confirmed live meter.** NCI Stone Point, in Lepe Country Park,
runs a Davis Weatherlink anemometer, but Weatherlink station pages use an
opaque per-station ID we couldn't locate publicly — so rather than guess a
URL, Lepe's card is bracketed with the two nearest confirmed live stations
(Hurst Castle to the west, Calshot to the east) and falls back to model wind
like any other spot when neither is close enough to be representative. If you
find Stone Point's public Weatherlink page, its ID slots straight into the
`meters` array for the `lepe` spot in `CONFIG`.

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

## 7-day planner

Below the live cards there's a day-by-day table covering the week ahead:

- **Wing columns** — for each spot, the longest daylight run of rideable hours
  (≥ 12 kn, right direction, under the 35 kn cap), shown as e.g.
  `12–19h · 18kn SSW`. Green = at least 2 hours ≥ 15 kn, amber = marginal,
  grey = the day's peak wind for reference. Daylight bounds come from
  Open-Meteo's sunrise/sunset for that day.
- **Fareham column** — every predicted high water ≥ 3.8 m that day with its
  time and height (🌙 marks high waters outside daylight), or `HW 3.6m — low`
  on neap days so you can see how close it was.
- **⭐ on the day** — a jackpot day: winnable wing wind *and* a Foildrive-able
  tide on the same day.

## Sea-breeze watcher 🌤️→🚨

The Solent sea breeze — sunny day, light gradient wind, then an unforecast
18–25 kn southerly fills in after lunch — is detectable before it peaks. The
watcher looks for the full signature on the **live meters**:

1. **Onshore swing** — direction into the ESE–WSW sector,
2. **Steady build** — ≥ 4 kn climb over the last 30–120 min of readings,
3. **Not in the forecast** — observed wind ≥ 4 kn above the model's number
   for the same hour (that delta is what makes it a sea breeze, not a front),
4. **Sun on the land** — cloud cover under 70%.

It pings (once each per day):

- **🌬️ "SW filling in down west"** — ≥ 15 kn S–W at Hurst Castle while the
  main spots are still light. A building SW'ly shows at the Needles Channel
  first and usually spreads east — this is your earliest heads-up.
- **🌤️ "Sea breeze building"** — onshore, ≥ 12 kn and climbing. Load the van.
- **🚨 "IT'S HAPPENING"** — ≥ 17 kn and still building. Go.

### Phone notifications (GitHub Actions + ntfy)

`.github/workflows/seabreeze.yml` runs `seabreeze/check.mjs` every 15 minutes
(daytime, April–September) on GitHub's servers, so it works with the dashboard
closed. Setup is three steps, no accounts or API keys:

1. Install the free [ntfy](https://ntfy.sh) app (iOS/Android) and subscribe to
   a topic with an unguessable name, e.g. `iain-seabreeze-x7k2q`.
   (Anyone who knows the topic name can see the pings — that's the whole
   auth model, hence unguessable.)
2. In this repo: Settings → Secrets and variables → Actions → **Variables** →
   new variable `NTFY_TOPIC` with that topic name.
3. Test it: Actions → "Sea breeze watcher" → Run workflow → tick "Send a test
   notification". A 🧪 test ping should hit your phone in seconds.

The watcher keeps a rolling 2-hour wind history between runs (Actions cache),
which is how it sees "climbing" rather than a single gusty reading. Without a
reachable live meter it stays silent — a model can't tell you about wind the
model didn't forecast. Thresholds live in the `CONFIG` block at the top of
`seabreeze/check.mjs`.

### In the dashboard too

The same detector runs inside `index.html` while the page is open (it already
refreshes every 10 minutes): a banner appears at the top, and the
**🔔 enable alerts** button turns on browser notifications for it.

## Ideas for later

- Ping when a Fareham Foildrive window coincides with light wind.
- Store your session log against the conditions that day.
