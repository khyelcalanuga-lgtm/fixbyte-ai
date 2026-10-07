// Self-check for the opening-hours parser. Run: node --no-warnings lib/hours.check.mts
import { hoursState } from "./hours.ts";

const eq = (a: unknown, b: unknown, what: string) => {
  if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error(`${what}: got ${JSON.stringify(a)}, want ${JSON.stringify(b)}`);
};
const local = (y: number, mo: number, d: number, h: number, mi = 0) => new Date(y, mo - 1, d, h, mi);
const iso = (y: number, mo: number, d: number, h: number, mi = 0) => local(y, mo, d, h, mi).toISOString();

// 2026-10-07 is a Wednesday.
const wedNoon = local(2026, 10, 7, 12);
eq(hoursState("Mo-Fr 09:00-18:00", wedNoon), { openNow: true, closes: iso(2026, 10, 7, 18) }, "open weekday");
eq(hoursState("Mo-Fr 09:00-18:00", local(2026, 10, 7, 20)), { openNow: false, opens: iso(2026, 10, 8, 9) }, "closed, opens tomorrow");
eq(hoursState("Mo-Fr 09:00-18:00", local(2026, 10, 10, 12)), { openNow: false, opens: iso(2026, 10, 12, 9) }, "weekend, opens Monday");
eq(hoursState("Mo-Su 08:00-12:00,13:00-17:00", local(2026, 10, 7, 12, 30)), { openNow: false, opens: iso(2026, 10, 7, 13) }, "lunch break");
eq(hoursState("Mo-Sa 09:00-18:00; We off", wedNoon), { openNow: false, opens: iso(2026, 10, 8, 9) }, "later rule overrides");
eq(hoursState("Fr-Sa 20:00-02:00", local(2026, 10, 10, 1)), { openNow: true, closes: iso(2026, 10, 10, 2) }, "past midnight");
eq(hoursState("24/7", wedNoon), { openNow: true, closes: undefined }, "24/7");
eq(hoursState("Mo-Fr 09:00-18:00; PH off", wedNoon), { openNow: true, closes: iso(2026, 10, 7, 18) }, "holiday rule skipped");
eq(hoursState("Jan-Mar Mo-Fr 09:00-17:00", wedNoon), null, "unsupported syntax");
eq(hoursState(undefined, wedNoon), null, "missing");
console.log("hours.check: all passed");
