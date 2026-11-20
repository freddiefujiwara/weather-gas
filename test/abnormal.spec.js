import { describe, expect, it, vi } from "vitest";
import { buildDaySummaries, syncWeatherCalendar, weatherCodeInfo } from "../src/Code.js";

// Abnormal-case tests: the inputs from outside are the JMA and
// Open-Meteo JSON payloads. Both are fetched over the network and
// parsed with JSON.parse, so any field can be missing, null, or the
// wrong type (booleans or arrays where a number belongs, numbers where
// a string belongs, null entries inside arrays). One deformed entry
// must never kill the whole 7-day sync, and deformed numbers must
// never be "invented" into plausible-looking measurements.

const TODAY = "2026-11-20";
const TD = "2026-11-20T00:00:00+09:00";

// Weekly-only JMA pair: no short-term report, one weekly day (today).
const weeklyJma = ({ code = "100", pop = "10", min = "5", max = "15" } = {}) => [
  {},
  {
    timeSeries: [
      {
        timeDefines: [TD],
        areas: [
          {
            area: { name: "埼玉県", code: "110000" },
            weatherCodes: [code],
            pops: [pop],
            reliabilities: ["A"],
          },
        ],
      },
      {
        timeDefines: [TD],
        areas: [
          {
            area: { name: "熊谷", code: "43056" },
            tempsMin: [min],
            tempsMax: [max],
          },
        ],
      },
    ],
  },
];

const omDaily = (daily) => ({ daily, hourly: { time: [] } });

describe("invented measurements (bare Number() coercion)", () => {
  it("does not turn a boolean weekly pop into 1%", () => {
    const s = buildDaySummaries({ jma: weeklyJma({ pop: true }), openMeteo: null, todayKey: TODAY });
    expect(s[0].title).toBe("☀️ 晴れ 15°/5°");
    expect(s[0].title).not.toContain("💧");
  });

  it("does not turn array weekly temps into measurements", () => {
    const s = buildDaySummaries({
      jma: weeklyJma({ min: [65], max: [70] }),
      openMeteo: null,
      todayKey: TODAY,
    });
    expect(s[0].title).toBe("☀️ 晴れ 💧10%");
    expect(s[0].title).not.toContain("65");
    expect(s[0].description).not.toContain("気温（熊谷）");
  });

  it("does not print an 'Infinity' pop from a string value", () => {
    const s = buildDaySummaries({ jma: weeklyJma({ pop: "Infinity" }), openMeteo: null, todayKey: TODAY });
    expect(s[0].title).not.toContain("Infinity");
    expect(s[0].title).not.toContain("💧");
  });

  it("does not print a whitespace-only 6h pop as 0%", () => {
    const short = {
      timeSeries: [
        {
          timeDefines: ["2026-11-20T06:00:00+09:00"],
          areas: [{ area: { name: "南部", code: "110010" }, pops: [" "] }],
        },
      ],
    };
    const s = buildDaySummaries({ jma: [short, {}], openMeteo: null, todayKey: TODAY });
    expect(s[0].title).not.toContain("💧0%");
    expect(s[0].description).toContain("降水確率：0〜6時 —");
  });

  it("does not print an infinite Open-Meteo daily max temperature", () => {
    // JSON.parse("1e999") yields Infinity, so this shape is reachable
    // from a real (if broken) API response body.
    const om = omDaily({
      time: [TODAY],
      weather_code: [0],
      temperature_2m_max: [Infinity],
      temperature_2m_min: [5],
      precipitation_probability_max: [null],
      precipitation_sum: [0],
    });
    const s = buildDaySummaries({ jma: [], openMeteo: om, todayKey: TODAY });
    expect(s[0].title).toBe("☀️ 快晴 ?°/5°");
    expect(s[0].title).not.toContain("Infinity");
  });

  it("does not print an infinite hourly temperature", () => {
    const om = {
      daily: {},
      hourly: {
        time: ["2026-11-20T00:00"],
        temperature_2m: [Infinity],
        precipitation_probability: [10],
        precipitation: [0],
      },
    };
    const s = buildDaySummaries({ jma: [], openMeteo: om, todayKey: TODAY });
    expect(s[0].description).not.toContain("Infinity");
    expect(s[0].description).toContain("0時 —");
  });

  it("does not print an infinite daily precipitation sum", () => {
    const om = {
      daily: { time: [TODAY], weather_code: [3], precipitation_sum: [Infinity] },
      hourly: {
        time: ["2026-11-20T00:00"],
        temperature_2m: [10],
        precipitation_probability: [0],
        precipitation: [0],
      },
    };
    const s = buildDaySummaries({ jma: [], openMeteo: om, todayKey: TODAY });
    expect(s[0].description).not.toContain("Infinity");
    expect(s[0].description).not.toContain("日降水量の目安");
  });

  it("does not resolve an array Open-Meteo weather code as a real condition", () => {
    const om = omDaily({ time: [TODAY], weather_code: [[0]] });
    const s = buildDaySummaries({ jma: [], openMeteo: om, todayKey: TODAY });
    expect(s[0].title).toBe("🌡️ 天気");
  });

  it("does not resolve a boolean Open-Meteo weather code as a real condition", () => {
    const om = omDaily({ time: [TODAY], weather_code: [true] });
    const s = buildDaySummaries({ jma: [], openMeteo: om, todayKey: TODAY });
    expect(s[0].title).toBe("🌡️ 天気");
  });
});

describe("one deformed entry must not kill the whole forecast", () => {
  const validShortArea = {
    area: { name: "南部", code: "110010" },
    weatherCodes: ["300"],
    weathers: ["雨"],
    winds: ["南の風"],
  };
  const shortWith = (areas, timeDefines = ["2026-11-20T05:00:00+09:00"]) => ({
    timeSeries: [{ timeDefines, areas }],
  });

  it("survives a null entry in the short-term areas", () => {
    const s = buildDaySummaries({
      jma: [shortWith([null, validShortArea]), {}],
      openMeteo: null,
      todayKey: TODAY,
    });
    expect(s).toHaveLength(7);
    expect(s[0].title).toContain("🌧️ 雨");
  });

  it("survives an area entry whose area object is null", () => {
    const s = buildDaySummaries({
      jma: [shortWith([{ area: null, weatherCodes: ["300"] }, validShortArea]), {}],
      openMeteo: null,
      todayKey: TODAY,
    });
    expect(s).toHaveLength(7);
    expect(s[0].title).toContain("🌧️ 雨");
  });

  it("survives a short-term series without timeDefines", () => {
    const s = buildDaySummaries({
      jma: [{ timeSeries: [{ areas: [validShortArea] }] }, {}],
      openMeteo: null,
      todayKey: TODAY,
    });
    expect(s).toHaveLength(7);
  });

  it("survives a non-array timeSeries in the short-term report", () => {
    const s = buildDaySummaries({
      jma: [{ reportDatetime: "2026-11-20T05:00:00+09:00", timeSeries: {} }, {}],
      openMeteo: null,
      todayKey: TODAY,
    });
    expect(s).toHaveLength(7);
  });

  it("survives a null entry in the pops series areas", () => {
    const short = {
      timeSeries: [
        {
          timeDefines: ["2026-11-20T05:00:00+09:00"],
          areas: [{ area: { name: "北部", code: "110020" }, weatherCodes: ["100"] }],
        },
        {
          timeDefines: ["2026-11-20T06:00:00+09:00"],
          areas: [null, { area: { name: "南部", code: "110010" }, pops: ["10"] }],
        },
      ],
    };
    const s = buildDaySummaries({ jma: [short, {}], openMeteo: null, todayKey: TODAY });
    expect(s).toHaveLength(7);
    expect(s[0].description).toContain("降水確率：0〜6時 10%");
  });

  it("survives a numeric Open-Meteo hourly time entry", () => {
    const om = {
      daily: {},
      hourly: { time: [20261120], temperature_2m: [10], precipitation_probability: [0], precipitation: [0] },
    };
    const s = buildDaySummaries({ jma: weeklyJma({}), openMeteo: om, todayKey: TODAY });
    expect(s).toHaveLength(7);
    expect(s[0].title).toContain("晴れ");
  });

  it("survives an Open-Meteo hourly time given as a string, not an array", () => {
    const om = {
      daily: {},
      hourly: { time: "2026-11-20T00:00", temperature_2m: [10], precipitation_probability: [0], precipitation: [0] },
    };
    const s = buildDaySummaries({ jma: weeklyJma({}), openMeteo: om, todayKey: TODAY });
    expect(s).toHaveLength(7);
    expect(s[0].title).toContain("晴れ");
  });

  it("survives a numeric reportDatetime", () => {
    const s = buildDaySummaries({
      jma: [{ reportDatetime: 20261120, timeSeries: [] }, {}],
      openMeteo: null,
      todayKey: TODAY,
    });
    expect(s).toHaveLength(7);
    expect(s[0].description).toContain("出典：気象庁");
  });

  it("survives a numeric short-term timeDefine", () => {
    const s = buildDaySummaries({
      jma: [shortWith([validShortArea], [20261120]), {}],
      openMeteo: null,
      todayKey: TODAY,
    });
    expect(s).toHaveLength(7);
  });

  it("survives a weekly series without timeDefines", () => {
    const weekly = {
      timeSeries: [
        { areas: [{ weatherCodes: ["100"], pops: ["10"], reliabilities: ["A"] }] },
        { areas: [{ tempsMin: ["5"], tempsMax: ["15"] }] },
      ],
    };
    const s = buildDaySummaries({ jma: [{}, weekly], openMeteo: null, todayKey: TODAY });
    expect(s).toHaveLength(7);
  });

  it("still syncs 7 days when the Open-Meteo payload is deformed", () => {
    const mockCalendar = { getEvents: vi.fn().mockReturnValue([]), createAllDayEvent: vi.fn() };
    global.UrlFetchApp = {
      fetch: vi.fn((url) => ({
        getResponseCode: () => 200,
        getContentText: () =>
          JSON.stringify(
            url.includes("jma.go.jp")
              ? [{}, {}]
              : { hourly: { time: [20261120], temperature_2m: [10] } }
          ),
      })),
    };
    global.CalendarApp = { getCalendarById: vi.fn().mockReturnValue(mockCalendar) };
    global.PropertiesService = {
      getScriptProperties: () => ({ getProperty: () => "test-calendar-id" }),
    };
    global.Logger = { log: vi.fn() };
    // Open-Meteo is documented as optional enrichment: a deformed
    // payload must degrade to the JMA-only sync, not abort it.
    expect(syncWeatherCalendar()).toBe(7);
    expect(mockCalendar.createAllDayEvent).toHaveBeenCalledTimes(7);
  });
});

describe("weatherCodeInfo with deformed codes", () => {
  it("does not throw on an unstringifiable code", () => {
    expect(weatherCodeInfo({ toString: [] })).toEqual({ icon: "🌡️", label: "天気" });
    expect(weatherCodeInfo(Object.create(null))).toEqual({ icon: "🌡️", label: "天気" });
  });

  it("does not resolve an array code as a real condition", () => {
    expect(weatherCodeInfo(["100"])).toEqual({ icon: "🌡️", label: "天気" });
  });

  it("does not resolve prototype-chain keys as table entries", () => {
    // A plain WEATHER_CODE_TABLE[key] lookup inherits from
    // Object.prototype: "toString" yields a function and the
    // destructure throws. (Found by the property suite.)
    for (const key of ["toString", "constructor", "valueOf", "hasOwnProperty", "__proto__"]) {
      expect(weatherCodeInfo(key)).toEqual({ icon: "🌡️", label: "天気" });
    }
  });

  it("falls back for null / object / boolean codes (already correct)", () => {
    expect(weatherCodeInfo(null)).toEqual({ icon: "🌡️", label: "天気" });
    expect(weatherCodeInfo({})).toEqual({ icon: "🌡️", label: "天気" });
    expect(weatherCodeInfo(true)).toEqual({ icon: "🌡️", label: "天気" });
  });
});

describe("text and empty-input robustness (pins)", () => {
  it("passes a lone surrogate in weather text through without throwing", () => {
    // The summaries go to calendar events; nothing in this codebase
    // URL-encodes them, so the text is carried as-is.
    const short = {
      timeSeries: [
        {
          timeDefines: ["2026-11-20T05:00:00+09:00"],
          areas: [
            {
              area: { name: "南部", code: "110010" },
              weatherCodes: ["300"],
              weathers: ["雨\uD800です"],
              winds: ["南の風"],
            },
          ],
        },
      ],
    };
    const s = buildDaySummaries({ jma: [short, {}], openMeteo: null, todayKey: TODAY });
    expect(s).toHaveLength(7);
    expect(s[0].title).toContain("雨");
  });

  it("does not leak an array weather text as comma-joined prose", () => {
    const short = {
      timeSeries: [
        {
          timeDefines: ["2026-11-20T05:00:00+09:00"],
          areas: [
            {
              area: { name: "南部", code: "110010" },
              weatherCodes: ["300"],
              weathers: [["雨", "雪"]],
              winds: ["南の風"],
            },
          ],
        },
      ],
    };
    const s = buildDaySummaries({ jma: [short, {}], openMeteo: null, todayKey: TODAY });
    expect(s[0].title).toBe("🌧️ 雨");
    expect(s[0].title).not.toContain("、");
  });

  it("builds 7 default days from empty inputs", () => {
    const s = buildDaySummaries({ jma: [], openMeteo: null, todayKey: TODAY });
    expect(s).toHaveLength(7);
    expect(s[0].title).toBe("🌡️ 天気");
  });

  it("builds 7 default days from null reports and an empty Open-Meteo object", () => {
    const s = buildDaySummaries({ jma: [null, null], openMeteo: {}, todayKey: TODAY });
    expect(s).toHaveLength(7);
    expect(s[6].date).toBe("2026-11-26");
  });
});
