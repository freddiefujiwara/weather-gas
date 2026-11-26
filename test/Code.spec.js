import { afterEach, beforeEach, describe, expect, it, vi} from "vitest";
import {
buildDaySummaries,
buildRss_,
doGet,
getCalendarId,
setup,
syncWeatherCalendar,
weatherCodeInfo,
} from "../src/Code.js";

// --- Fixtures modeled on the real JMA response (2026-11-13 05:00 report) ---

const jmaFixture = [
{
publishingOffice: "熊谷地方気象台",
reportDatetime: "2026-11-13T05:00:00+09:00",
timeSeries: [
{
timeDefines: ["2026-11-13T05:00:00+09:00", "2026-11-14T00:00:00+09:00"],
areas: [
{ area: { name: "北部", code: "110020"}, weatherCodes: ["211", "101"], weathers: ["くもり", "晴れ"], winds: ["北の風"]},
{ area: { name: "南部", code: "110010"}, weatherCodes: ["201", "110"], weathers: ["くもり　昼前　から　晴れ", "晴れ　のち　くもり"], winds: ["北西の風　後　北の風", "北の風"]},
{ area: { name: "秩父地方", code: "110030"}, weatherCodes: ["200", "100"], weathers: ["くもり", "晴れ"], winds: ["北の風"]},
],
},
{
timeDefines: [
"2026-11-13T06:00:00+09:00", "2026-11-13T12:00:00+09:00", "2026-11-13T18:00:00+09:00",
"2026-11-14T00:00:00+09:00", "2026-11-14T06:00:00+09:00", "2026-11-14T12:00:00+09:00", "2026-11-14T18:00:00+09:00",
],
areas: [
{ area: { name: "南部", code: "110010"}, pops: ["10", "0", "0", "10", "10", "0", "10"]},
],
},
{
timeDefines: ["2026-11-13T09:00:00+09:00", "2026-11-13T00:00:00+09:00", "2026-11-14T00:00:00+09:00", "2026-11-14T09:00:00+09:00"],
areas: [
{ area: { name: "さいたま", code: "43241"}, temps: ["20", "9", "8", "21"]},
],
},
],
},
{
publishingOffice: "熊谷地方気象台",
reportDatetime: "2026-11-12T17:00:00+09:00",
timeSeries: [
{
timeDefines: [
"2026-11-14T00:00:00+09:00", "2026-11-15T00:00:00+09:00", "2026-11-16T00:00:00+09:00",
"2026-11-17T00:00:00+09:00", "2026-11-18T00:00:00+09:00", "2026-11-19T00:00:00+09:00", "2026-11-20T00:00:00+09:00",
],
areas: [
{
area: { name: "埼玉県", code: "110000"},
weatherCodes: ["110", "101", "200", "300", "101", "102", "100"],
pops: ["10", "10", "30", "80", "20", "40", "10"],
reliabilities: ["A", "A", "B", "", "C", "B", "A"],
},
],
},
{
timeDefines: [
"2026-11-14T00:00:00+09:00", "2026-11-15T00:00:00+09:00", "2026-11-16T00:00:00+09:00",
"2026-11-17T00:00:00+09:00", "2026-11-18T00:00:00+09:00", "2026-11-19T00:00:00+09:00", "2026-11-20T00:00:00+09:00",
],
areas: [
{
area: { name: "熊谷", code: "43056"},
tempsMin: ["8", "7", "9", "10", "8", "7", "6"],
tempsMinUpper: ["9", "8", "10", "11", "10", "9", "8"],
tempsMinLower: ["7", "6", "8", "9", "6", "5", "4"],
tempsMax: ["21", "20", "18", "16", "19", "18", "20"],
tempsMaxUpper: ["22", "21", "19", "17", "21", "20", "22"],
tempsMaxLower: ["20", "19", "16", "15", "17", "16", "18"],
},
],
},
],
},
];

const openMeteoFixture = {
timezone: "Asia/Tokyo",
hourly: {
time: [
"2026-11-13T00:00", "2026-11-13T03:00", "2026-11-13T06:00",
"2026-11-14T00:00", "2026-11-14T03:00",
],
temperature_2m: [9.1, 8.4, 8.9, 8.2, 7.6],
precipitation_probability: [10, 0, 0, 10, 10],
precipitation: [0.0, 0.0, 0.0, 0.0, 0.0],
weather_code: [3, 3, 2, 2, 1],
},
daily: {
time: ["2026-11-13", "2026-11-14"],
weather_code: [3, 1],
temperature_2m_max: [19.6, 20.8],
temperature_2m_min: [8.2, 7.9],
precipitation_probability_max: [10, 10],
precipitation_sum: [0.0, 0.0],
},
};

describe("weatherCodeInfo", () => {
it("maps known JMA codes", () => {
expect(weatherCodeInfo("100")).toEqual({ icon: "☀️", label: "晴れ"});
expect(weatherCodeInfo("300").icon).toBe("🌧️");
expect(weatherCodeInfo("201").label).toBe("くもり 時々 晴れ");
});

it("falls back by first digit for unknown codes", () => {
expect(weatherCodeInfo("199").icon).toBe("☀️");
expect(weatherCodeInfo("499").icon).toBe("❄️");
expect(weatherCodeInfo("").icon).toBe("🌡️");
});
});

describe("buildDaySummaries", () => {
const summaries = buildDaySummaries({
jma: jmaFixture,
openMeteo: openMeteoFixture,
todayKey: "2026-11-13",
});

it("builds 7 days starting today", () => {
expect(summaries).toHaveLength(7);
expect(summaries[0].date).toBe("2026-11-13");
expect(summaries[6].date).toBe("2026-11-19");
});

it("uses short-term JMA text, Open-Meteo temps and max 6h pop for today", () => {
expect(summaries[0].title).toBe("🌥️ くもり 昼前 から 晴れ 20°/8° 💧10%");
expect(summaries[0].description).toContain("降水確率：0〜6時 10% / 6〜12時 0% / 12〜18時 0% / 18〜24時 10%");
expect(summaries[0].description).toContain("風：北西の風 後 北の風");
expect(summaries[0].description).toContain("[時間ごと：Open-Meteo・川口]");
expect(summaries[0].description).toContain("気象庁");
});

it("falls back to weekly temps when Open-Meteo has no day", () => {
// 2026-11-15: weekly code 101, pop 10, reliability A, 熊谷 temps 7/20
expect(summaries[2].date).toBe("2026-11-15");
expect(summaries[2].title).toBe("🌤️ 晴れ 時々 くもり 20°/7° 💧10%");
expect(summaries[2].description).toContain("予報の信頼度：A");
expect(summaries[2].description).toContain("気温（熊谷）");
});

it("works without Open-Meteo at all (JMA only)", () => {
const jmaOnly = buildDaySummaries({ jma: jmaFixture, openMeteo: null, todayKey: "2026-11-13"});
expect(jmaOnly).toHaveLength(7);
expect(jmaOnly[0].description).not.toContain("時間ごと");
// Today has no weekly temps in the fixture, so no temperature segment.
expect(jmaOnly[0].title).toBe("🌥️ くもり 昼前 から 晴れ 💧10%");
expect(jmaOnly[2].title).toContain("20°/7°");
});

it("uses short-term temps for tomorrow when weekly temps have not started", () => {
// Drop the first day (2026-11-14) from both weekly series, mirroring
// an evening report whose weekly temperatures start a day later.
// Tomorrow must then fall back to the short-term temperatures
// (fixture point: min 8 / max 21) instead of showing no temperature.
const jmaShifted = JSON.parse(JSON.stringify(jmaFixture));
jmaShifted[1].timeSeries.forEach((ts) => {
ts.timeDefines = ts.timeDefines.slice(1);
ts.areas.forEach((a) => {
Object.keys(a).forEach((k) => {
if (Array.isArray(a[k])) a[k] = a[k].slice(1);
});
});
});
const shifted = buildDaySummaries({ jma: jmaShifted, openMeteo: null, todayKey: "2026-11-13"});
expect(shifted[1].date).toBe("2026-11-14");
expect(shifted[1].title).toBe("⛅ 晴れ のち くもり 21°/8° 💧10%");
expect(shifted[1].description).toContain("気温（熊谷）：最低 8℃ / 最高 21℃");
// Today's short-term pair is never used (see parseShortTemps).
expect(shifted[0].title).toBe("🌥️ くもり 昼前 から 晴れ 💧10%");
});
});

// --- GAS runtime mocks ---

const mockExistingEvent = { deleteEvent: vi.fn()};
const mockCreatedEvent = { setTransparency: vi.fn()};
const mockCalendar = {
getEvents: vi.fn().mockReturnValue([mockExistingEvent]),
createAllDayEvent: vi.fn(() => mockCreatedEvent),
};

beforeEach(() => {
vi.clearAllMocks();
mockCalendar.getEvents.mockReturnValue([mockExistingEvent]);
global.UrlFetchApp = {
fetch: vi.fn((url) => ({
getResponseCode: () => 200,
getContentText: () =>
JSON.stringify(url.includes("jma.go.jp")? jmaFixture: openMeteoFixture),
})),
};
global.CalendarApp = {
EventTransparency: { TRANSPARENT: "transparent"},
getCalendarById: vi.fn().mockReturnValue(mockCalendar),
};
global.PropertiesService = {
getScriptProperties: () => ({
getProperty: (key) => (key === "CALENDAR_ID"? "test-calendar-id": null),
}),
};
global.Logger = { log: vi.fn()};
global.ContentService = {
MimeType: { XML: "text/xml", JSON: "application/json"},
createTextOutput: vi.fn((content) => ({
content,
mimeType: null,
setMimeType(mime) {
this.mimeType = mime;
return this;
},
})),
};
global.Utilities = { getUuid: vi.fn(() => "uuid-part")};
});

describe("getCalendarId", () => {
it("returns the CALENDAR_ID script property", () => {
expect(getCalendarId()).toBe("test-calendar-id");
});

it("throws when the property is missing", () => {
global.PropertiesService = {
getScriptProperties: () => ({ getProperty: () => null}),
};
expect(() => getCalendarId()).toThrow("CALENDAR_ID");
});
});

describe("syncWeatherCalendar", () => {
// syncWeatherCalendar syncs from the real "today", while the
// fixtures describe the week of 2026-11-13. Pin the clock so the
// assertions do not rot as the calendar moves. (On pristine main
// this test failed for exactly that reason: run on 2026-11-20, the
// first synced day is the weekly 晴れ day, not the fixture's くもり
// day.) The assertions themselves are unchanged.
beforeEach(() => {
vi.useFakeTimers();
vi.setSystemTime(new Date("2026-11-13T06:00:00+09:00"));
});
afterEach(() => {
vi.useRealTimers();
});

it("replaces the week's events with 7 forecast days", () => {
const count = syncWeatherCalendar();
expect(count).toBe(7);
expect(mockExistingEvent.deleteEvent).toHaveBeenCalledTimes(1);
expect(mockCalendar.createAllDayEvent).toHaveBeenCalledTimes(7);
expect(mockCreatedEvent.setTransparency).toHaveBeenCalledTimes(7);
expect(mockCreatedEvent.setTransparency).toHaveBeenCalledWith("transparent");
const [title, date, options] = mockCalendar.createAllDayEvent.mock.calls[0];
expect(title).toContain("くもり");
expect(date).toBeInstanceOf(Date);
expect(options.description).toContain("weather-gas");
});

it("continues with JMA only when Open-Meteo fails", () => {
global.UrlFetchApp.fetch = vi.fn((url) => {
if (url.includes("open-meteo")) throw new Error("network error");
return {
getResponseCode: () => 200,
getContentText: () => JSON.stringify(jmaFixture),
};
});
expect(syncWeatherCalendar()).toBe(7);
expect(mockCalendar.createAllDayEvent).toHaveBeenCalledTimes(7);
});
});

describe("buildRss_", () => {
it("renders the channel and one item per day", () => {
const xml = buildRss_([
{
date: "2026-11-24",
title: "🌥️ くもり 20°/8° 💧10%",
description: "[気象庁：埼玉県南部]\n天気：くもり",
},
]);
expect(xml).toContain("<title>天気（川口）</title>");
expect(xml).toContain("<title>🌥️ くもり 20°/8° 💧10%</title>");
expect(xml).toContain("[気象庁：埼玉県南部]\n天気：くもり");
expect(xml).toContain('<guid isPermaLink="false">weather-2026-11-24</guid>');
// pubDate is the day's JST midnight in RFC 822 (GMT) form.
expect(xml).toContain("<pubDate>Mon, 23 Nov 2026 15:00:00 GMT</pubDate>");
expect(xml).toContain("<link>https://www.jma.go.jp/bosai/forecast/</link>");
});

it("escapes XML special characters in titles and descriptions", () => {
const xml = buildRss_([
{ date: "2026-11-24", title: `a & b <c> "d" 'e'`, description: "x < y & z > w"},
]);
expect(xml).toContain("a &amp; b &lt;c&gt; &quot;d&quot; &apos;e&apos;");
expect(xml).toContain("x &lt; y &amp; z &gt; w");
expect(xml).not.toContain("a & b");
});

it("renders a valid feed with no items", () => {
const xml = buildRss_([]);
expect(xml).toContain("<channel>");
expect(xml).not.toContain("<item>");
expect(xml.trim().endsWith("</rss>")).toBe(true);
});
});

// --- RSS serving (doGet) ---

const rssStore = { CALENDAR_ID: "test-calendar-id", RSS_TOKEN: "test-rss-token"};

const setRssProperties = (store) => {
global.PropertiesService = {
getScriptProperties: () => ({
getProperty: (key) => (key in store? store[key]: null),
setProperty: (key, value) => {
store[key] = value;
},
}),
};
};

const allDayEvent = (dateKey, title, description) => ({
getTitle: () => title,
getDescription: () => description,
getStartTime: () => new Date(`${dateKey}T00:00:00+09:00`),
isAllDayEvent: () => true,
});

describe("doGet RSS", () => {
beforeEach(() => {
vi.useFakeTimers();
vi.setSystemTime(new Date("2026-11-24T06:00:00+09:00"));
setRssProperties({ ...rssStore});
});
afterEach(() => {
vi.useRealTimers();
});

it("rejects non-rss actions with a JSON error", () => {
const res = doGet({ parameter: { action: "other"}});
expect(res.mimeType).toBe("application/json");
expect(JSON.parse(res.content)).toEqual({ ok: false, error: "Unknown action."});
const bare = doGet({});
expect(JSON.parse(bare.content).ok).toBe(false);
});

it("fails closed when RSS_TOKEN is unset, even with a token supplied", () => {
setRssProperties({ CALENDAR_ID: "test-calendar-id"});
const res = doGet({ parameter: { action: "rss", token: "anything"}});
expect(res.mimeType).toBe("application/json");
expect(JSON.parse(res.content)).toEqual({ ok: false, error: "Unauthorized."});
});

it("rejects a mismatched or missing token", () => {
expect(JSON.parse(doGet({ parameter: { action: "rss", token: "wrong"}}).content).error).toBe("Unauthorized.");
expect(JSON.parse(doGet({ parameter: { action: "rss"}}).content).error).toBe("Unauthorized.");
});

it("reports Not configured when CALENDAR_ID is missing", () => {
setRssProperties({ RSS_TOKEN: "test-rss-token"});
const res = doGet({ parameter: { action: "rss", token: "test-rss-token"}});
expect(JSON.parse(res.content)).toEqual({ ok: false, error: "Not configured."});
});

it("serves the week's all-day events in date order", () => {
mockCalendar.getEvents.mockReturnValue([
allDayEvent("2026-11-25", "☀️ 晴れ 21°/9° 💧0%", "明日の説明"),
allDayEvent("2026-11-24", "🌥️ くもり 20°/8° 💧10%", "今日の説明"),
{ // timed events are not forecast days and are dropped
getTitle: () => "timed",
getDescription: () => "nope",
getStartTime: () => new Date("2026-11-24T10:00:00+09:00"),
isAllDayEvent: () => false,
},
]);
const res = doGet({ parameter: { action: "rss", token: "test-rss-token"}});
expect(res.mimeType).toBe("text/xml");
expect(res.content).toContain("weather-2026-11-24");
expect(res.content).toContain("weather-2026-11-25");
expect(res.content.indexOf("weather-2026-11-24")).toBeLessThan(
res.content.indexOf("weather-2026-11-25")
);
expect(res.content).toContain("今日の説明");
expect(res.content).not.toContain("timed");
});
});

describe("setup", () => {
it("generates RSS_TOKEN only when unset", () => {
const store = {};
setRssProperties(store);
vi.spyOn(console, "log").mockImplementation(() => {});
setup();
expect(store.RSS_TOKEN).toBe("uuid-partuuid-part");
setup();
expect(store.RSS_TOKEN).toBe("uuid-partuuid-part");
expect(global.Utilities.getUuid).toHaveBeenCalledTimes(2);
});
});
