// weather-gas: syncs a detailed weather forecast into a dedicated
// Google Calendar ("天気（川口）") as all-day events, one per day for the
// next 7 days.
//
// Data sources (both fetched at runtime, nothing secret is stored here):
// - Japan Meteorological Agency (JMA) official forecast JSON for Saitama
// (https://www.jma.go.jp/bosai/forecast/data/forecast/110000.json).
// Short-term report: weather text / wind / 6-hour precipitation
// probabilities for today and tomorrow (area 埼玉県南部 = 110010).
// Weekly report: weather codes, daily precipitation probability,
// reliability and temperature ranges (point: 熊谷) for the days after.
// - Open-Meteo (free, no key) pinpoint forecast for Kawaguchi City:
// daily max/min temperature and hourly temperature / precipitation
// probability / precipitation. Optional enrichment: when Open-Meteo
// cannot be reached, the calendar is still updated from JMA alone.
//
// Setup (once, in the Apps Script editor):
// - Set the script property CALENDAR_ID to the target calendar's ID.
// - Run installTrigger() once to create the 6-hour time-driven trigger,
// and syncWeatherCalendar() once for the first sync.
// The calendar ID is deliberately NOT hardcoded: this repository is
// public, and the ID belongs in script properties (same convention as
// the other *-gas projects).
//
// Weather RSS (for the owner's own reader), following the calendar-gas
// pattern:
//   GET ?action=rss&token=<RSS_TOKEN>
//     -> RSS 2.0 with this calendar's all-day forecast events, from
//        today (Asia/Tokyo) through the next 7 days, in date order.
// The feed carries the same titles and descriptions the sync wrote to
// the calendar, so it is guarded by its own RSS_TOKEN script property
// and refuses every request while the property is unset or the token
// mismatches (fail closed). Serving the feed needs a Web app
// deployment (see appsscript.json "webapp").
// Run setup() once from the editor: it generates RSS_TOKEN (only when
// unset) and logs so it can be copied from Project Settings.

const JMA_FORECAST_URL =
'https://www.jma.go.jp/bosai/forecast/data/forecast/110000.json';
const JMA_AREA_CODE = '110010'; // 埼玉県南部 (includes Kawaguchi City)

// Kawaguchi City Hall: 35.8077, 139.7243
const OPEN_METEO_URL =
'https://api.open-meteo.com/v1/forecast?latitude=35.8077&longitude=139.7243' +
'&hourly=temperature_2m,precipitation_probability,precipitation,weather_code' +
'&daily=weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max,precipitation_sum' +
'&timezone=Asia%2FTokyo&forecast_days=8';

const DAYS_TO_SYNC = 7;
const JST_OFFSET_MS = 9 * 60 * 60 * 1000;

// --- Date helpers (pure, JST-based) ---

const pad2 = (n) => String(n).padStart(2, '0');

const dateKeyFromMs = (ms) => {
const d = new Date(ms + JST_OFFSET_MS);
return `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())}`;
};

const todayKeyJst = (nowMs = Date.now()) => dateKeyFromMs(nowMs);

const addDaysToKey = (key, days) => {
const [y, m, d] = key.split('-').map(Number);
return dateKeyFromMs(Date.UTC(y, m - 1, d) - JST_OFFSET_MS + days * 24 * 60 * 60 * 1000);
};

const dateFromKey = (key) => new Date(`${key}T00:00:00+09:00`);

// --- Weather code presentation ---

// JMA weather codes: 3-digit. First digit: 1=晴れ, 2=くもり, 3=雨, 4=雪.
// The table covers the common codes; anything else falls back by digit.
const WEATHER_CODE_TABLE = {
'100': ['☀️', '晴れ'],
'101': ['🌤️', '晴れ 時々 くもり'],
'102': ['🌦️', '晴れ 一時 雨'],
'103': ['⛅', '晴れ のち くもり'],
'104': ['🌨️', '晴れ 一時 雪'],
'105': ['🌨️', '晴れ のち 雪'],
'106': ['🌦️', '晴れ のち 雨'],
'107': ['🌦️', '晴れ のち 雨'],
'108': ['🌦️', '晴れ のち 雨'],
'110': ['⛅', '晴れ のち くもり'],
'111': ['⛅', '晴れ のち くもり'],
'112': ['🌦️', '晴れ のち 雨'],
'113': ['🌨️', '晴れ のち 雪'],
'114': ['🌨️', '晴れ のち 雪か雨'],
'115': ['🌨️', '晴れ のち 雪'],
'200': ['☁️', 'くもり'],
'201': ['🌥️', 'くもり 時々 晴れ'],
'202': ['🌧️', 'くもり 一時 雨'],
'203': ['☁️', 'くもり のち 晴れ'],
'204': ['🌧️', 'くもり 一時 雪'],
'205': ['🌧️', 'くもり のち 雪'],
'206': ['🌧️', 'くもり のち 雨'],
'207': ['🌧️', 'くもり のち 雨'],
'208': ['🌧️', 'くもり のち 雨'],
'209': ['🌫️', '霧'],
'210': ['🌥️', 'くもり のち 晴れ'],
'211': ['🌥️', 'くもり のち 晴れ'],
'212': ['🌧️', 'くもり のち 雨'],
'213': ['🌧️', 'くもり のち 雪'],
'214': ['🌧️', 'くもり のち 雨か雪'],
'215': ['🌧️', 'くもり のち 雪'],
'300': ['🌧️', '雨'],
'301': ['🌧️', '雨 時々 晴れ'],
'302': ['🌧️', '雨 時々 止む'],
'303': ['🌧️', '雨 時々 雪'],
'304': ['🌧️', '雨か雪'],
'306': ['🌧️', '大雨'],
'307': ['🌧️', '大雨'],
'308': ['🌧️', '大雨'],
'309': ['🌧️', '雨 一時 雪'],
'311': ['🌧️', '雨 のち 晴れ'],
'313': ['🌧️', '雨 のち くもり'],
'314': ['🌧️', '雨 のち 雪'],
'315': ['🌧️', '雨 のち 雪'],
'316': ['🌧️', '雨か雪 のち 晴れ'],
'317': ['🌧️', '雨か雪 のち くもり'],
'400': ['❄️', '雪'],
'401': ['❄️', '雪 時々 晴れ'],
'402': ['❄️', '雪 時々 止む'],
'403': ['❄️', '雪 時々 雨'],
'405': ['❄️', '大雪'],
'406': ['❄️', '大雪'],
'407': ['❄️', '大雪'],
'409': ['❄️', '雪 一時 雨'],
'411': ['❄️', '雪 のち 晴れ'],
'413': ['❄️', '雪 のち くもり'],
'414': ['❄️', '雪 のち 雨'],
};

export const weatherCodeInfo = (code) => {
// Only scalars can name a code; anything else (arrays, objects,
// values String() cannot convert) reads as "no code".
const key = typeof code === 'string' || typeof code === 'number'? String(code): '';
// Own-property lookup only: a plain lookup would resolve keys like
// "toString" through Object.prototype and destructure a function.
if (Object.hasOwn(WEATHER_CODE_TABLE, key)) {
const [icon, label] = WEATHER_CODE_TABLE[key];
return { icon, label};
}
const first = key.charAt(0);
if (first === '1') return { icon: '☀️', label: '晴れ'};
if (first === '2') return { icon: '☁️', label: 'くもり'};
if (first === '3') return { icon: '🌧️', label: '雨'};
if (first === '4') return { icon: '❄️', label: '雪'};
return { icon: '🌡️', label: '天気'};
};

// Open-Meteo (WMO) weather codes, used only when JMA has no code for a day.
const omCodeInfo = (code) => {
const c = toNum(code);
if (c === 0) return { icon: '☀️', label: '快晴'};
if (c === 1 || c === 2) return { icon: '🌤️', label: '晴れ'};
if (c === 3) return { icon: '☁️', label: 'くもり'};
if (c === 45 || c === 48) return { icon: '🌫️', label: '霧'};
if (c >= 51 && c <= 57) return { icon: '🌦️', label: '霧雨'};
if ((c >= 61 && c <= 67) || (c >= 80 && c <= 82)) return { icon: '🌧️', label: '雨'};
if ((c >= 71 && c <= 77) || c === 85 || c === 86) return { icon: '❄️', label: '雪'};
if (c >= 95) return { icon: '⛈️', label: '雷雨'};
return { icon: '🌡️', label: '天気'};
};

// Text from the APIs: strings pass through and scalars keep their
// String() rendering, but anything else (arrays, objects, values
// String() cannot convert) reads as empty instead of leaking a
// comma-joined or "[object Object]" rendering into the calendar.
const normalizeText = (text) => {
const s =
typeof text === 'string'
? text
: typeof text === 'number' || typeof text === 'boolean'
? String(text || '')
: '';
return s.replace(/　/g, ' ').replace(/\s+/g, ' ').trim();
};

// Only finite numbers and non-blank numeric strings carry a
// measurement. Bare Number() would invent values (true -> 1,
// [65] -> 65, [] -> 0, " " -> 0) and let Infinity (which JSON.parse
// produces from e.g. 1e999) flow into the formatted output; all of
// those read as "no data" here.
const toNum = (v) => {
if (typeof v === 'number') return Number.isFinite(v)? v: null;
if (typeof v === 'string' && v.trim()!== '') {
const n = Number(v);
return Number.isFinite(n)? n: null;
}
return null;
};

const roundOrNull = (v) => {
const n = toNum(v);
return n === null? null: Math.round(n);
};

// --- JMA parsing ---

// Returns Map<dateKey, {code, text, wind}> from the short-term report.
const parseShortWeather = (report) => {
const map = new Map();
const ts = (report.timeSeries || [])[0];
if (!ts) return map;
const areas = Array.isArray(ts.areas)? ts.areas: [];
const area = areas.find((a) => a && a.area && a.area.code === JMA_AREA_CODE);
if (!area) return map;
if (!Array.isArray(ts.timeDefines)) return map;
ts.timeDefines.forEach((td, i) => {
if (typeof td!== 'string') return;
map.set(td.slice(0, 10), {
code: area.weatherCodes? area.weatherCodes[i]: null,
text: area.weathers? normalizeText(area.weathers[i]): '',
wind: area.winds? normalizeText(area.winds[i]): '',
});
});
return map;
};

// JMA pops: each value is the probability for the 6-hour block ENDING at
// its timeDefine. Returns Map<dateKey, [{label, pop}]> keyed by the date
// the block starts on.
const parseShortPops = (report) => {
const map = new Map();
// The weather timeSeries also contains this area code, so select the
// series whose matching area actually carries pops.
let ts = null;
let area = null;
const series = Array.isArray(report.timeSeries)? report.timeSeries: [];
for (const candidate of series) {
if (!candidate) continue;
const found = (Array.isArray(candidate.areas)? candidate.areas: []).find(
(a) => a && a.area && a.area.code === JMA_AREA_CODE
);
if (found && found.pops) {
ts = candidate;
area = found;
break;
}
}
if (!ts || !area) return map;
if (!Array.isArray(ts.timeDefines)) return map;
const labelByEndHour = { '06': '0〜6時', '12': '6〜12時', '18': '12〜18時', '00': '18〜24時'};
ts.timeDefines.forEach((td, i) => {
if (typeof td!== 'string') return;
const endMs = new Date(td).getTime();
if (Number.isNaN(endMs)) return;
const startKey = dateKeyFromMs(endMs - 6 * 60 * 60 * 1000);
const label = labelByEndHour[td.slice(11, 13)] || '';
const pop = toNum(area.pops[i]);
if (!map.has(startKey)) map.set(startKey, []);
map.get(startKey).push({ label, pop});
});
return map;
};

// Weekly report: Map<dateKey, {code, pop, reliability}> and
// Map<dateKey, {min, max, minLower, minUpper, maxLower, maxUpper}> (熊谷).
const parseWeekly = (report) => {
const weather = new Map();
const temps = new Map();
const ts0 = (report.timeSeries || [])[0];
if (ts0 && ts0.areas && ts0.areas[0] && Array.isArray(ts0.timeDefines)) {
const area = ts0.areas[0];
ts0.timeDefines.forEach((td, i) => {
if (typeof td!== 'string') return;
weather.set(td.slice(0, 10), {
code: area.weatherCodes? area.weatherCodes[i]: null,
pop: area.pops? toNum(area.pops[i]): null,
reliability: area.reliabilities? area.reliabilities[i] || '': '',
});
});
}
const ts1 = (report.timeSeries || [])[1];
if (ts1 && ts1.areas && ts1.areas[0] && Array.isArray(ts1.timeDefines)) {
const area = ts1.areas[0];
ts1.timeDefines.forEach((td, i) => {
if (typeof td!== 'string') return;
temps.set(td.slice(0, 10), {
min: toNum(area.tempsMin && area.tempsMin[i]),
max: toNum(area.tempsMax && area.tempsMax[i]),
minLower: toNum(area.tempsMinLower && area.tempsMinLower[i]),
minUpper: toNum(area.tempsMinUpper && area.tempsMinUpper[i]),
maxLower: toNum(area.tempsMaxLower && area.tempsMaxLower[i]),
maxUpper: toNum(area.tempsMaxUpper && area.tempsMaxUpper[i]),
});
});
}
return { weather, temps};
};

// --- Open-Meteo parsing ---

const parseOpenMeteo = (om) => {
const daily = new Map();
const hourly = new Map();
if (!om) return { daily, hourly};
const d = om.daily || {};
(Array.isArray(d.time)? d.time: []).forEach((date, i) => {
if (typeof date!== 'string') return;
daily.set(date, {
code: d.weather_code? d.weather_code[i]: null,
max: roundOrNull(d.temperature_2m_max && d.temperature_2m_max[i]),
min: roundOrNull(d.temperature_2m_min && d.temperature_2m_min[i]),
popMax: roundOrNull(d.precipitation_probability_max && d.precipitation_probability_max[i]),
precipSum: d.precipitation_sum? toNum(d.precipitation_sum[i]): null,
});
});
const h = om.hourly || {};
(Array.isArray(h.time)? h.time: []).forEach((t, i) => {
if (typeof t!== 'string') return;
const date = t.slice(0, 10);
if (!hourly.has(date)) hourly.set(date, []);
hourly.get(date).push({
hour: Number(t.slice(11, 13)),
temp: h.temperature_2m? toNum(h.temperature_2m[i]): null,
pop: h.precipitation_probability? toNum(h.precipitation_probability[i]): null,
precip: h.precipitation? toNum(h.precipitation[i]): null,
});
});
return { daily, hourly};
};

// --- Summary composition ---

export const buildDaySummaries = ({ jma, openMeteo, todayKey, days = DAYS_TO_SYNC}) => {
const shortReport = (jma || [])[0] || {};
const weeklyReport = (jma || [])[1] || {};
const shortWeather = parseShortWeather(shortReport);
const shortPops = parseShortPops(shortReport);
const weekly = parseWeekly(weeklyReport);
const om = parseOpenMeteo(openMeteo);
const reportDatetimeRaw = shortReport.reportDatetime || weeklyReport.reportDatetime || '';
const reportDatetime = typeof reportDatetimeRaw === 'string'? reportDatetimeRaw: '';

const summaries = [];
for (let i = 0; i < days; i++) {
const date = addDaysToKey(todayKey, i);
const sw = shortWeather.get(date);
const wk = weekly.weather.get(date);
const wt = weekly.temps.get(date);
const omDay = om.daily.get(date);

let info;
let detailText = '';
let wind = '';
if (sw && sw.code) {
info = weatherCodeInfo(sw.code);
detailText = sw.text;
wind = sw.wind;
} else if (wk && wk.code) {
info = weatherCodeInfo(wk.code);
} else if (omDay && omDay.code!== null) {
info = omCodeInfo(omDay.code);
} else {
info = { icon: '🌡️', label: '天気'};
}
const label = detailText || info.label;

const blocks = shortPops.get(date) || [];
let maxPop = null;
if (blocks.length) {
maxPop = Math.max(...blocks.map((b) => (b.pop === null? -1: b.pop)));
if (maxPop < 0) maxPop = null;
} else if (wk && wk.pop!== null) {
maxPop = wk.pop;
} else if (omDay && omDay.popMax!== null) {
maxPop = omDay.popMax;
}

let maxTemp = omDay? omDay.max: null;
let minTemp = omDay? omDay.min: null;
if (maxTemp === null && wt) maxTemp = wt.max;
if (minTemp === null && wt) minTemp = wt.min;

const titleParts = [`${info.icon} ${label}`];
if (maxTemp!== null || minTemp!== null) {
titleParts.push(`${maxTemp === null? '?': maxTemp}°/${minTemp === null? '?': minTemp}°`);
}
if (maxPop!== null) titleParts.push(`💧${maxPop}%`);
const title = titleParts.join(' ');

const lines = [];
lines.push('[気象庁：埼玉県南部]');
if (detailText) lines.push(`天気：${detailText}`);
else lines.push(`天気：${info.label}（週間予報）`);
if (wind) lines.push(`風：${wind}`);
if (blocks.length) {
lines.push(
`降水確率：${blocks.map((b) => `${b.label} ${b.pop === null? '—': b.pop + '%'}`).join(' / ')}`
);
} else if (wk) {
if (wk.pop!== null) lines.push(`降水確率：${wk.pop}%`);
if (wk.reliability) lines.push(`予報の信頼度：${wk.reliability}`);
}
if (wt && (wt.min!== null || wt.max!== null)) {
const range = (lo, hi) =>
lo!== null && hi!== null && (lo!== hi)? `（${lo}〜${hi}℃）`: '';
lines.push(
`気温（熊谷）：最低 ${wt.min === null? '—': wt.min + '℃'}${range(wt.minLower, wt.minUpper)} / 最高 ${wt.max === null? '—': wt.max + '℃'}${range(wt.maxLower, wt.maxUpper)}`
);
}
const hours = (om.hourly.get(date) || []).filter((r) => r.hour % 3 === 0);
if (hours.length) {
lines.push('');
lines.push('[時間ごと：Open-Meteo・川口]');
hours.forEach((r) => {
const temp = r.temp === null? '—': `${Math.round(r.temp)}℃`;
const pop = r.pop === null? '—': `${Math.round(r.pop)}%`;
const precip = r.precip === null? '—': `${r.precip.toFixed(1)}mm`;
lines.push(`${r.hour}時 ${temp} 💧${pop} ${precip}`);
});
if (omDay && omDay.precipSum!== null) {
lines.push(`日降水量の目安：${omDay.precipSum.toFixed(1)}mm`);
}
}
lines.push('');
lines.push(
`出典：気象庁（熊谷地方気象台${reportDatetime? ` ${normalizeText(reportDatetime.replace('T', ' ').slice(0, 16))}発表`: ''}） / Open-Meteo（川口市）`
);
lines.push('weather-gas による自動更新');

summaries.push({ date, title, description: lines.join('\n')});
}
return summaries;
};

// --- GAS runtime ---

const fetchJson_ = (url) => {
const res = UrlFetchApp.fetch(url, { muteHttpExceptions: true});
if (res.getResponseCode()!== 200) {
throw new Error(`Fetch failed (${res.getResponseCode()}): ${url}`);
}
return JSON.parse(res.getContentText());
};

export const getCalendarId = () => {
const id = PropertiesService.getScriptProperties().getProperty('CALENDAR_ID');
if (!id) {
throw new Error('Script property CALENDAR_ID is not set.');
}
return id;
};

export const syncWeatherCalendar = () => {
const jma = fetchJson_(JMA_FORECAST_URL);
let openMeteo = null;
try {
openMeteo = fetchJson_(OPEN_METEO_URL);
} catch (e) {
Logger.log(`Open-Meteo fetch failed, continuing with JMA only: ${e.message}`);
}
const todayKey = todayKeyJst();
const summaries = buildDaySummaries({ jma, openMeteo, todayKey});

const calendar = CalendarApp.getCalendarById(getCalendarId());
if (!calendar) throw new Error('Target calendar not found.');

const start = dateFromKey(todayKey);
const end = dateFromKey(addDaysToKey(todayKey, DAYS_TO_SYNC));
calendar.getEvents(start, end).forEach((event) => event.deleteEvent());
summaries.forEach(({ date, title, description}) => {
calendar.createAllDayEvent(title, dateFromKey(date), { description});
});
Logger.log(`Synced ${summaries.length} days (${summaries[0].date}.. ${summaries[summaries.length - 1].date})`);
return summaries.length;
};

// --- Weather RSS ---

const RSS_CHANNEL_ = {
title: '天気（川口）',
link: 'https://www.jma.go.jp/bosai/forecast/',
description: '川口市の天気予報（当日〜7日分、気象庁／Open-Meteo）',
};

export function doGet(e) {
const params = (e && e.parameter) || {};
if (params.action === 'rss') {
return serveRss_(params);
}
return createJsonResponse_({ ok: false, error: 'Unknown action.' });
}

// Serves action=rss. The token check comes first and fails closed:
// an unset RSS_TOKEN refuses every request, and a mismatch answers
// a JSON refusal — never the feed.
const serveRss_ = (params) => {
const expected = PropertiesService.getScriptProperties().getProperty('RSS_TOKEN');
if (!expected || typeof params.token!== 'string' || params.token!== expected) {
return createJsonResponse_({ ok: false, error: 'Unauthorized.' });
}
const calendarId = PropertiesService.getScriptProperties().getProperty('CALENDAR_ID');
if (!calendarId) {
return createJsonResponse_({ ok: false, error: 'Not configured.' });
}
const calendar = CalendarApp.getCalendarById(calendarId);
if (!calendar) {
return createJsonResponse_({ ok: false, error: 'Not configured.' });
}
const todayKey = todayKeyJst();
const start = dateFromKey(todayKey);
const end = dateFromKey(addDaysToKey(todayKey, DAYS_TO_SYNC));
const items = calendar
.getEvents(start, end)
.map((ev) => normalizeFeedEvent_(ev))
.filter((item) => item!== null)
.sort((a, b) => (a.date < b.date? -1: a.date > b.date? 1: 0));
return createXmlResponse_(buildRss_(items));
};

// Keeps only all-day events (the forecast events are all-day; a timed
// event on this dedicated calendar is not a forecast day). Returns
// null for anything that is not a usable forecast item.
const normalizeFeedEvent_ = (ev) => {
if (typeof ev.isAllDayEvent === 'function' && !ev.isAllDayEvent()) return null;
if (typeof ev.getStartTime!== 'function') return null;
const start = ev.getStartTime();
if (!(start instanceof Date) || Number.isNaN(start.getTime())) return null;
return {
date: dateKeyFromMs(start.getTime()),
title: typeof ev.getTitle === 'function'? ev.getTitle(): '',
description: typeof ev.getDescription === 'function'? ev.getDescription(): '',
};
};

export function buildRss_(items) {
const lines = [
'<?xml version="1.0" encoding="UTF-8"?>',
'<rss version="2.0">',
'<channel>',
'<title>' + escapeXml_(RSS_CHANNEL_.title) + '</title>',
'<link>' + escapeXml_(RSS_CHANNEL_.link) + '</link>',
'<description>' + escapeXml_(RSS_CHANNEL_.description) + '</description>',
];
for (const item of items || []) {
lines.push(
'<item>',
'<title>' + escapeXml_(item.title || '(no title)') + '</title>',
'<link>' + escapeXml_(RSS_CHANNEL_.link) + '</link>',
'<guid isPermaLink="false">' + escapeXml_(`weather-${item.date}`) + '</guid>',
'<pubDate>' + dateFromKey(item.date).toUTCString() + '</pubDate>',
'<description>' + escapeXml_(item.description || '') + '</description>',
'</item>'
);
}
lines.push('</channel>', '</rss>');
return lines.join('\n');
}

const escapeXml_ = (text) => {
return String(text)
.replace(/&/g, '&amp;')
.replace(/</g, '&lt;')
.replace(/>/g, '&gt;')
.replace(/"/g, '&quot;')
.replace(/'/g, '&apos;');
};

const createXmlResponse_ = (xml) => {
return ContentService.createTextOutput(xml).setMimeType(ContentService.MimeType.XML);
};

const createJsonResponse_ = (obj) => {
return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
};

export function setup() {
const props = PropertiesService.getScriptProperties();
if (!props.getProperty('RSS_TOKEN')) {
props.setProperty('RSS_TOKEN', Utilities.getUuid() + Utilities.getUuid());
}
console.log('RSS_TOKEN has been set. Copy it from Project Settings > Script Properties.');
}

export const installTrigger = () => {
ScriptApp.getProjectTriggers()
.filter((t) => t.getHandlerFunction() === 'syncWeatherCalendar')
.forEach((t) => ScriptApp.deleteTrigger(t));
ScriptApp.newTrigger('syncWeatherCalendar').timeBased().everyHours(6).create();
Logger.log('Trigger installed: syncWeatherCalendar every 6 hours.');
};
