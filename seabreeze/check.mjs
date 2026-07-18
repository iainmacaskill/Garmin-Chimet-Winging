#!/usr/bin/env node
/**
 * Sea-breeze watcher for the Solent / Chichester Harbour.
 *
 * The signature of an unforecast sea breeze:
 *   1. direction swings onshore (southerly sector),
 *   2. speed climbs steadily over 30–90 minutes on the LIVE meters,
 *   3. observed wind sits well above the model forecast for the same hour,
 *   4. it's a sunny afternoon in the warm months.
 *
 * Run every ~15 min by GitHub Actions (see .github/workflows/seabreeze.yml).
 * Keeps a rolling history in a state file between runs, and sends at most one
 * "building" and one "it's happening" push per day via ntfy.sh.
 */
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";

export const CONFIG = {
  stations: [
    { name: "Chimet (Chichester Bar)", feeds: ["https://www.chimet.co.uk/chimet.txt", "https://www.chimet.co.uk/data.txt"] },
    { name: "Cambermet", feeds: ["https://www.cambermet.co.uk/camber.txt", "https://www.cambermet.co.uk/data.txt"] },
    { name: "Bramblemet", feeds: ["https://www.bramblemet.co.uk/bramble.txt", "https://www.bramblemet.co.uk/data.txt"] },
    { name: "Emsmet", feeds: ["https://www.emsmet.co.uk/emsworth.txt", "https://www.emsmet.co.uk/data.txt"] },
  ],
  // Hurst Castle sits at the Needles Channel — a building SW'ly shows here
  // first, then spreads east to the main spots. Used as an early-warning ping.
  westStation: {
    name: "Hurst Castle",
    feeds: [{ url: "https://weatherfile.com/V03/loc/GBR00002/latest", unit: "kn" },
            { url: "https://weatherfile.com/V03/loc/GBR00001/latest", unit: "kn" }],
    sector: [180, 270],                  // S–W
    minKn: 15,                           // blowing properly at Hurst...
  },
  model: { lat: 50.78, lon: -1.0 },        // mid-area reference point for "what was forecast"
  onshore: [100, 260],                     // ESE through S to WSW = sea breeze sector
  buildingMin: 12,                         // kn — "it's forming" floor
  happeningMin: 17,                        // kn — ping "it's happening" (heading for 18–25)
  riseKn: 4,                               // must have climbed this much over the last 30–120 min
  modelDeltaKn: 4,                         // observed must beat forecast by this much = "not forecast"
  maxCloud: 70,                            // % — sea breezes need sun on the land
  activeMonths: [4, 9],                    // Apr–Sep
  activeHours: [10, 19],                   // local (Europe/London)
  historyMins: 120,
  stateFile: process.env.STATE_FILE || ".seabreeze-state/state.json",
  ntfyTopic: process.env.NTFY_TOPIC || "",
};

const inSector = (deg, [a, b]) => a <= b ? deg >= a && deg <= b : deg >= a || deg <= b;
const KN = v => Math.round(v);
const CARDINALS = ["N","NNE","NE","ENE","E","ESE","SE","SSE","S","SSW","SW","WSW","W","WNW","NW","NNW"];
const cardinal = d => CARDINALS[Math.round(d / 22.5) % 16];

export function londonNow(date = new Date()) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/London", year: "numeric", month: "numeric", day: "numeric", hour: "numeric", hour12: false })
      .formatToParts(date).map(p => [p.type, p.value]));
  return { month: +parts.month, hour: +parts.hour, dateKey: `${parts.year}-${parts.month}-${parts.day}` };
}

/* --- data sources --- */
export function parseCSVMeter(text) {
  const rows = text.trim().split(/\r?\n/).map(l => l.split(",").map(c => c.trim()));
  if (rows.length < 2) return null;
  const header = rows[0].map(h => h.toUpperCase());
  const last = rows[rows.length - 1];
  const col = names => { const i = header.findIndex(h => names.some(n => h.includes(n))); return i >= 0 ? parseFloat(last[i]) : NaN; };
  const spdMs = col(["WSPD", "WIND SPEED", "SPEED"]);
  const dir = col(["WD", "DIRN", "DIRECTION"]);
  if (isNaN(spdMs)) return null;
  return { kn: spdMs * 1.94384, dir: isNaN(dir) ? null : dir };   // Solentmet reports m/s
}

export function parseJSONMeter(text, unit = "kn") {
  let j; try { j = JSON.parse(text); } catch { return null; }
  const flat = {};
  (function walk(o) {
    for (const k in o) {
      if (o[k] && typeof o[k] === "object") walk(o[k]);
      else if (typeof o[k] === "number" || (typeof o[k] === "string" && o[k] !== "" && !isNaN(o[k]))) flat[k.toLowerCase()] = +o[k];
    }
  })(j);
  const pick = names => { for (const n of names) if (flat[n] != null) return flat[n]; return null; };
  const speed = pick(["wsa", "ws_avg", "wind_speed", "windspeed", "wspd", "ws"]);   // WeatherFile: wsa/wsh/wda
  const dir = pick(["wda", "wd_avg", "wind_direction", "winddir", "wdir", "wd"]);
  if (speed == null) return null;
  const f = unit === "ms" ? 1.94384 : 1;
  return { kn: speed * f, dir };
}

export async function readStation(st) {
  for (const feed of st.feeds) {
    const url = feed.url || feed;
    try {
      const r = await fetch(url, { signal: AbortSignal.timeout(10000) });
      if (!r.ok) continue;
      const text = await r.text();
      const parsed = text.trim().startsWith("{") ? parseJSONMeter(text, feed.unit) : parseCSVMeter(text);
      if (parsed) return { ...parsed, station: st.name };
    } catch { /* try next */ }
  }
  return null;
}

export async function readMeter(cfg = CONFIG) {
  for (const st of cfg.stations) {
    const obs = await readStation(st);
    if (obs) return obs;
  }
  return null;
}

export async function readModel(cfg = CONFIG) {
  try {
    const u = `https://api.open-meteo.com/v1/forecast?latitude=${cfg.model.lat}&longitude=${cfg.model.lon}` +
      `&current=wind_speed_10m,wind_direction_10m,cloud_cover&wind_speed_unit=kn&timezone=Europe%2FLondon`;
    const r = await fetch(u, { signal: AbortSignal.timeout(10000) });
    const j = await r.json();
    return { kn: j.current.wind_speed_10m, dir: j.current.wind_direction_10m, cloud: j.current.cloud_cover };
  } catch { return null; }
}

/* --- detection (pure) --- */
export function detect(obs, model, history, state, now, cfg = CONFIG) {
  const reasons = [];
  const onshore = obs.dir != null && inSector(obs.dir, cfg.onshore);
  reasons.push(`${KN(obs.kn)} kn ${obs.dir != null ? cardinal(obs.dir) : "?"} at ${obs.station}${onshore ? " (onshore)" : " (not onshore)"}`);

  // rising: compare to the calmest sample 30–historyMins minutes ago
  const past = history.filter(h => now - h.ts >= 30 * 60000 && now - h.ts <= cfg.historyMins * 60000);
  let rising = false;
  if (past.length >= 2) {
    const minPast = Math.min(...past.map(h => h.kn));
    rising = obs.kn - minPast >= cfg.riseKn;
    reasons.push(`${rising ? "climbed" : "only moved"} ${(obs.kn - minPast).toFixed(1)} kn from the ${KN(minPast)} kn lull`);
  } else reasons.push("not enough history yet to judge the build");

  const unforecast = model && obs.kn >= model.kn + cfg.modelDeltaKn;
  if (model) reasons.push(`model said ${KN(model.kn)} kn${unforecast ? " — this is NOT gradient wind" : ""}, cloud ${model.cloud}%`);
  const sunny = !model || model.cloud == null || model.cloud <= cfg.maxCloud;

  const builtToday = state.sentBuilding === state.dateKey;
  const building = onshore && sunny && obs.kn >= cfg.buildingMin && rising && (unforecast || !model);
  const happening = onshore && obs.kn >= cfg.happeningMin && (unforecast || !model) && (rising || builtToday);

  let phase = "none";
  if (happening && state.sentHappening !== state.dateKey) phase = "happening";
  else if (building && !builtToday && state.sentHappening !== state.dateKey) phase = "building";
  return { phase, onshore, rising, unforecast, reasons };
}

/* --- state + notify --- */
export function loadState(file) {
  try { return JSON.parse(readFileSync(file, "utf8")); } catch { return { history: [] }; }
}
export function saveState(file, state) {
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, JSON.stringify(state));
}

export async function notify(topic, title, message, priority = "default") {
  if (!topic) { console.log(`[no NTFY_TOPIC set] ${title}: ${message}`); return false; }
  const r = await fetch(`https://ntfy.sh/${encodeURIComponent(topic)}`, {
    method: "POST", body: message,
    headers: { Title: title, Priority: priority, Tags: "wind_face,ocean" },
  });
  console.log(`ntfy → ${r.status}: ${title}`);
  return r.ok;
}

/* --- main --- */
async function main() {
  const cfg = CONFIG;
  const t = londonNow();

  if (process.env.TEST_PING === "true") {
    await notify(cfg.ntfyTopic, "🧪 Sea-breeze watcher test", "If you can read this on your phone, the pipeline works.");
    return;
  }
  if (t.month < cfg.activeMonths[0] || t.month > cfg.activeMonths[1]) { console.log("outside season, exit"); return; }
  if (t.hour < cfg.activeHours[0] || t.hour >= cfg.activeHours[1]) { console.log("outside daytime window, exit"); return; }

  const obs = await readMeter(cfg);
  if (!obs) { console.log("no live meter reachable — cannot detect an unforecast breeze, exit"); return; }
  const model = await readModel(cfg);

  const state = loadState(cfg.stateFile);
  state.dateKey = t.dateKey;
  const now = Date.now();
  state.history = (state.history || []).filter(h => now - h.ts <= cfg.historyMins * 60000);

  const verdict = detect(obs, model, state.history, state, now, cfg);
  console.log(`phase=${verdict.phase} | ${verdict.reasons.join(" | ")}`);

  // Early warning: a SW'ly blowing at Hurst Castle before it reaches the
  // main spots usually spreads east within the hour.
  if (verdict.phase === "none" && cfg.westStation && obs.kn < cfg.buildingMin && state.sentWest !== t.dateKey) {
    const west = await readStation(cfg.westStation);
    if (west && west.dir != null && inSector(west.dir, cfg.westStation.sector) && west.kn >= cfg.westStation.minKn) {
      await notify(cfg.ntfyTopic, "🌬️ SW filling in down west",
        `${KN(west.kn)} kn ${cardinal(west.dir)} at ${west.station} while it's still ${KN(obs.kn)} kn at ${obs.station} — usually spreads east. Watch the meters.`);
      state.sentWest = t.dateKey;
    }
  }

  if (verdict.phase === "happening") {
    await notify(cfg.ntfyTopic, "🚨 IT'S HAPPENING — sea breeze is in",
      `${KN(obs.kn)} kn ${cardinal(obs.dir)} at ${obs.station} and building. ${verdict.reasons.join(". ")}. Go go go.`,
      "high");
    state.sentHappening = t.dateKey;
  } else if (verdict.phase === "building") {
    await notify(cfg.ntfyTopic, "🌤️ Sea breeze building",
      `${KN(obs.kn)} kn ${cardinal(obs.dir)} at ${obs.station}, climbing and not in the forecast. Start getting ready.`);
    state.sentBuilding = t.dateKey;
  }

  state.history.push({ ts: now, kn: obs.kn, dir: obs.dir });
  saveState(cfg.stateFile, state);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch(e => { console.error(e); process.exit(1); });
}
