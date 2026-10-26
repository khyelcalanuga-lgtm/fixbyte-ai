import { Platform } from "react-native";
import { File, Paths } from "expo-file-system";

// Small values kept on the device: localStorage on web, a file in the app's documents folder on phones.
// Wrapped in try: storage can be missing (web server render, private browsing); then reads give null.
export function load(key: string): string | null {
  try {
    if (Platform.OS === "web") return localStorage.getItem(key);
    const f = new File(Paths.document, key);
    return f.exists ? f.textSync() : null;
  } catch {
    return null;
  }
}

export function save(key: string, text: string) {
  try {
    if (Platform.OS === "web") return localStorage.setItem(key, text);
    const f = new File(Paths.document, key);
    if (!f.exists) f.create();
    f.writeSync(text); // since expo-file-system 58, write() is async: a read right after it got the old contents
  } catch {}
}
