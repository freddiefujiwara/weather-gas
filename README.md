# weather-gas

Google Apps Script that keeps a detailed weather forecast in a dedicated
Google Calendar (「天気（川口）」) as all-day events — one per day for the
next 7 days — so the forecast sits right next to the day's schedule.

## What each day shows

- Title: weather icon + condition, max/min temperature, max precipitation
  probability (e.g. `🌥️ くもり 昼前 から 晴れ 20°/8° 💧10%`)
- Description:
  - JMA (気象庁） details for 埼玉県南部: weather text, wind, and 6-hour
    precipitation probabilities for today/tomorrow; for later days the
    weekly forecast's probability, reliability (A/B/C) and the 熊谷
    temperature ranges
  - Hourly table (every 3 hours: temperature / precipitation probability /
    precipitation) from Open-Meteo pinpointed at Kawaguchi City

## Data sources

- JMA official forecast JSON (Saitama, 110000):
  `https://www.jma.go.jp/bosai/forecast/data/forecast/110000.json`
- Open-Meteo forecast API (free, no key), Kawaguchi City coordinates.
  Open-Meteo is an optional enrichment — if it is unreachable, the sync
  proceeds with JMA data only.

## Setup

1. Create a Google Calendar to hold the forecast.
2. In the Apps Script editor, set the script property `CALENDAR_ID` to
   that calendar's ID. (The ID is kept out of this public repository.)
3. Run `installTrigger()` once — creates a time-driven trigger that runs
   `syncWeatherCalendar()` every 6 hours (JMA updates at 05:00, 11:00 and
   17:00 JST).
4. Run `syncWeatherCalendar()` once for the first sync.

## Operations

- The sync deletes the target calendar's events for the next 7 days and
  recreates them, so the calendar must be dedicated to this forecast.
- Staging uses a separate Apps Script project (`STAGING_SCRIPT_ID`) and
  should point at a separate calendar via its own `CALENDAR_ID` property.

## Development

- `npm test` — vitest (fixtures mirror the real JMA response shape)
- `npm run build` — strips ESM exports into `dist/Code.gs` for clasp
- CI: tests on push; deploys to the staging project from non-main
  branches and to production from `main` (PR-based, like the other
  *-gas projects).
