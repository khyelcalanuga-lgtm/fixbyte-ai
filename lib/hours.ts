// Reads OpenStreetMap opening_hours like "Mo-Fr 09:00-18:00; Sa 10:00-16:00; Su off" or "24/7".
// ponytail: covers the common day/time-range forms only; anything fancier (months, weeks, sunrise) returns null,
// which the app shows as "Hours not listed". Swap in the opening_hours npm package if that shows up a lot.

const DAYS = ["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"]; // Date#getDay() order
type Range = [number, number]; // minutes from midnight, end exclusive

function days(spec: string): number[] | null {
  const out: number[] = [];
  for (const part of spec.split(",")) {
    const [a, b = a] = part.split("-").map((d) => DAYS.indexOf(d.trim()));
    if (a < 0 || b < 0) return null;
    for (let d = a; ; d = (d + 1) % 7) {
      out.push(d);
      if (d === b) break; // wraps, so "Sa-Mo" works
    }
  }
  return out;
}

const minutes = (t: string) => {
  const m = /^(\d{1,2}):(\d{2})$/.exec(t.trim());
  return m ? Number(m[1]) * 60 + Number(m[2]) : NaN;
};

// The week as 7 lists of open ranges, or null if the value isn't in a form we understand.
function week(value: string): Range[][] | null {
  const v = value.trim();
  if (v === "24/7") return Array.from({ length: 7 }, () => [[0, 1440]]);
  const w: Range[][] = Array.from({ length: 7 }, () => []);
  const spill: [number, Range][] = []; // past-midnight parts, added to the next day at the end
  for (const rule of v.split(";").map((r) => r.trim()).filter(Boolean)) {
    if (/^PH\b/.test(rule)) continue; // public-holiday exceptions: we don't know the holidays, so use the normal week
    const m = /^((?:[A-Z][a-z](?:-[A-Z][a-z])?)(?:,(?:[A-Z][a-z](?:-[A-Z][a-z])?))*)?\s*(.*)$/.exec(rule);
    if (!m) return null;
    const ds = m[1] ? days(m[1]) : [0, 1, 2, 3, 4, 5, 6];
    if (!ds) return null;
    const times = m[2].trim();
    const ranges: Range[] = [];
    if (!/^(off|closed)$/i.test(times)) {
      for (const span of times.split(",")) {
        const [a, b] = span.split("-").map(minutes);
        if (Number.isNaN(a) || Number.isNaN(b)) return null;
        ranges.push([a, b > a ? b : 1440]);
        if (b <= a && b > 0) ds.forEach((d) => spill.push([(d + 1) % 7, [0, b]]));
      }
    }
    ds.forEach((d) => (w[d] = ranges)); // later rules override earlier ones for the days they name
  }
  spill.forEach(([d, r]) => w[d].push(r));
  return w;
}

const at = (base: Date, dayOffset: number, mins: number) => {
  const d = new Date(base);
  d.setDate(d.getDate() + dayOffset);
  d.setHours(0, mins, 0, 0);
  return d;
};

// Same shape as the app's shop hours: open now, and when that changes.
export function hoursState(
  value: string | undefined,
  now = new Date(),
): { openNow: boolean; closes?: string; opens?: string } | null {
  const w = value ? week(value) : null;
  if (!w) return null;
  const today = now.getDay();
  const mins = now.getHours() * 60 + now.getMinutes();
  const current = w[today].find(([a, b]) => a <= mins && mins < b);
  if (current) return { openNow: true, closes: current[1] >= 1440 ? undefined : at(now, 0, current[1]).toISOString() };
  for (let off = 0; off < 7; off++) {
    const next = w[(today + off) % 7].filter(([a]) => off > 0 || a > mins).sort((x, y) => x[0] - y[0])[0];
    if (next) return { openNow: false, opens: at(now, off, next[0]).toISOString() };
  }
  return { openNow: false };
}
