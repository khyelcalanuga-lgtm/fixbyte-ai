import { Platform } from "react-native";
import { File, Paths } from "expo-file-system";

// Free diagnoses per day, counted on the device.
// ponytail: a per-device count; reinstalling or clearing app data resets it. Count on the server per account if that gets abused.
export const DAILY_LIMIT = 3;

const KEY = "usage-2.json"; // renaming this resets every device's count (the old file is just ignored)
const today = () => new Date().toDateString(); // local day, so it resets at the user's midnight

function read(): string | null {
  if (Platform.OS === "web") return localStorage.getItem(KEY);
  const f = new File(Paths.document, KEY);
  return f.exists ? f.textSync() : null;
}

function write(text: string) {
  if (Platform.OS === "web") return localStorage.setItem(KEY, text);
  const f = new File(Paths.document, KEY);
  if (!f.exists) f.create();
  f.write(text);
}

// Wrapped in try: storage can be missing (web server render, private browsing); then the count starts from 0.
export function usedToday(): number {
  try {
    const u: { day: string; used: number } | null = JSON.parse(read() ?? "null");
    return u?.day === today() ? u.used : 0;
  } catch {
    return 0;
  }
}

export function recordUse(): number {
  const used = usedToday() + 1;
  try {
    write(JSON.stringify({ day: today(), used }));
  } catch {}
  return used;
}
