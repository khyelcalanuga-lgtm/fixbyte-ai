import { load, save } from "./store";

// Free diagnoses per day, counted on the device.
// ponytail: a per-device count; reinstalling or clearing app data resets it. Count on the server per account if that gets abused.
export const DAILY_LIMIT = 3;

const KEY = "usage-2.json"; // renaming this resets every device's count (the old file is just ignored)
const today = () => new Date().toDateString(); // local day, so it resets at the user's midnight

// A missing or unreadable count starts from 0.
export function usedToday(): number {
  try {
    const u: { day: string; used: number } | null = JSON.parse(load(KEY) ?? "null");
    return u?.day === today() ? u.used : 0;
  } catch {
    return 0;
  }
}

export function recordUse(): number {
  const used = usedToday() + 1;
  save(KEY, JSON.stringify({ day: today(), used }));
  return used;
}

// Erase data (Profile → Password and security) starts the count over.
export function resetUsage() {
  save(KEY, "");
}
