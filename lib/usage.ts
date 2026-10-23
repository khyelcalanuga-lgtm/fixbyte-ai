import { load, save } from "./store";

// Free diagnoses per day, counted per account on the device.
// ponytail: counted on the device; reinstalling, clearing app data or a new account resets it. Count on the server if that gets abused.
export const DAILY_LIMIT = 3;

const key = (uid: string) => `usage-2-${uid}.json`; // renaming this resets every count (old files are just ignored)
const today = () => new Date().toDateString(); // local day, so it resets at the user's midnight

// A missing or unreadable count starts from 0.
export function usedToday(uid: string): number {
  try {
    const u: { day: string; used: number } | null = JSON.parse(load(key(uid)) ?? "null");
    return u?.day === today() ? u.used : 0;
  } catch {
    return 0;
  }
}

export function recordUse(uid: string): number {
  const used = usedToday(uid) + 1;
  save(key(uid), JSON.stringify({ day: today(), used }));
  return used;
}

// Erase data (Profile → Password and security) starts the count over.
export function resetUsage(uid: string) {
  save(key(uid), "");
}
