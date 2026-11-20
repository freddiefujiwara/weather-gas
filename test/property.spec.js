import * as fc from "fast-check";
import { describe, expect, it } from "vitest";
import { buildDaySummaries, weatherCodeInfo } from "../src/Code.js";

// Property-based tests over the two outside inputs (JMA / Open-Meteo
// JSON) and the weather-code presentation. The parsers run on whatever
// the network returned, so the core invariants are: never throw,
// always produce the requested number of day summaries on consecutive
// dates, and never format a deformed number into the output as
// "NaN" / "Infinity".

const dateKeyArb = fc
  .date({ min: new Date("2023-01-01T00:00:00Z"), max: new Date("2027-12-31T00:00:00Z"), noInvalidDate: true })
  .map((d) => d.toISOString().slice(0, 10));

const keyToMs = (key) => {
  const [y, m, d] = key.split("-").map(Number);
  return Date.UTC(y, m - 1, d);
};

describe("weatherCodeInfo", () => {
  it("never throws and always returns a non-empty icon/label pair", () => {
    fc.assert(
      fc.property(
        fc.oneof(
          fc.jsonValue(),
          fc.string(),
          // Not producible by JSON.parse, but a legitimate member of
          // the unit-level domain: String() throws on it, and the
          // presentation helper must stay total regardless.
          fc.constant({ toString: [] }),
          fc.constant(Object.create(null))
        ),
        (code) => {
          const info = weatherCodeInfo(code);
          expect(typeof info.icon).toBe("string");
          expect(info.icon.length).toBeGreaterThan(0);
          expect(typeof info.label).toBe("string");
          expect(info.label.length).toBeGreaterThan(0);
        }
      ),
      { numRuns: 100 }
    );
  });
});

describe("buildDaySummaries totality", () => {
  it("never throws on arbitrary JSON inputs and returns consecutive days", () => {
    fc.assert(
      fc.property(fc.jsonValue(), fc.jsonValue(), dateKeyArb, (jma, openMeteo, todayKey) => {
        const s = buildDaySummaries({ jma, openMeteo, todayKey });
        expect(s).toHaveLength(7);
        s.forEach((day, i) => {
          expect(day.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
          expect(keyToMs(day.date) - keyToMs(todayKey)).toBe(i * 24 * 60 * 60 * 1000);
          expect(typeof day.title).toBe("string");
          expect(day.description).toContain("weather-gas による自動更新");
        });
      }),
      { numRuns: 100 }
    );
  });

  it("returns exactly `days` summaries on consecutive dates", () => {
    fc.assert(
      fc.property(dateKeyArb, fc.integer({ min: 0, max: 14 }), (todayKey, days) => {
        const s = buildDaySummaries({ jma: [], openMeteo: null, todayKey, days });
        expect(s).toHaveLength(days);
        s.forEach((day, i) => {
          expect(keyToMs(day.date) - keyToMs(todayKey)).toBe(i * 24 * 60 * 60 * 1000);
        });
      }),
      { numRuns: 100 }
    );
  });
});

// Numeric slots filled with every JSON-representable shape (plus NaN /
// Infinity, which JSON.parse produces from literals like 1e999), text
// slots held to realistic weather strings: any "NaN" / "Infinity" in
// the output must then have come from number formatting, which is
// exactly the leak being pinned down.
const numericSlotArb = fc.oneof(
  fc.double(),
  // Explicit members: JSON.parse("1e999") yields Infinity, so the
  // non-finite shapes are real members of this domain, not exotica.
  fc.constant(Infinity),
  fc.constant(-Infinity),
  fc.integer(),
  fc.constant(null),
  fc.constant(true),
  fc.constant(false),
  fc.array(fc.integer(), { maxLength: 2 }),
  fc.stringMatching(/^-?\d{1,3}$/)
);

describe("buildDaySummaries formatting", () => {
  it("never formats a deformed number as NaN/Infinity", () => {
    const payloadArb = fc.record({
      pop: numericSlotArb,
      min: numericSlotArb,
      max: numericSlotArb,
      omMax: numericSlotArb,
      omMin: numericSlotArb,
      omPop: numericSlotArb,
      omSum: numericSlotArb,
      hourTemp: numericSlotArb,
      hourPop: numericSlotArb,
      hourPrecip: numericSlotArb,
    });
    fc.assert(
      fc.property(payloadArb, (p) => {
        const jma = [
          {},
          {
            timeSeries: [
              {
                timeDefines: ["2026-11-20T00:00:00+09:00"],
                areas: [
                  {
                    area: { name: "埼玉県", code: "110000" },
                    weatherCodes: ["100"],
                    pops: [p.pop],
                    reliabilities: ["A"],
                  },
                ],
              },
              {
                timeDefines: ["2026-11-20T00:00:00+09:00"],
                areas: [
                  {
                    area: { name: "熊谷", code: "43056" },
                    tempsMin: [p.min],
                    tempsMax: [p.max],
                  },
                ],
              },
            ],
          },
        ];
        const openMeteo = {
          daily: {
            time: ["2026-11-20"],
            weather_code: [0],
            temperature_2m_max: [p.omMax],
            temperature_2m_min: [p.omMin],
            precipitation_probability_max: [p.omPop],
            precipitation_sum: [p.omSum],
          },
          hourly: {
            time: ["2026-11-20T00:00"],
            temperature_2m: [p.hourTemp],
            precipitation_probability: [p.hourPop],
            precipitation: [p.hourPrecip],
          },
        };
        const s = buildDaySummaries({ jma, openMeteo, todayKey: "2026-11-20" });
        expect(s).toHaveLength(7);
        for (const day of s) {
          expect(day.title).not.toContain("NaN");
          expect(day.title).not.toContain("Infinity");
          expect(day.description).not.toContain("NaN");
          expect(day.description).not.toContain("Infinity");
        }
      }),
      { numRuns: 100 }
    );
  });

  it("carries well-formed Open-Meteo temperatures into the title verbatim", () => {
    const tempArb = fc.double({ min: -50, max: 60, noNaN: true });
    fc.assert(
      fc.property(tempArb, tempArb, dateKeyArb, (max, min, todayKey) => {
        const openMeteo = {
          daily: {
            time: [todayKey],
            weather_code: [0],
            temperature_2m_max: [max],
            temperature_2m_min: [min],
          },
          hourly: { time: [] },
        };
        const s = buildDaySummaries({ jma: [], openMeteo, todayKey });
        expect(s[0].title).toContain(`${Math.round(max)}°/${Math.round(min)}°`);
      }),
      { numRuns: 100 }
    );
  });
});
