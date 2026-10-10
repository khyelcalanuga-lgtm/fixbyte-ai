import { Platform } from "react-native";
import Constants from "expo-constants";

// Native apps call the hosted API; API keys remain on the server.
// In development (Expo Go), they call the dev server the app was loaded from instead, like the web version does:
// the hosted server's Gemini calls are sometimes refused by region and fall back to slow backup models.
export async function apiFetch(path: string, options?: RequestInit) {
  const devServer = __DEV__ ? Constants.expoConfig?.hostUri : undefined; // e.g. "192.168.1.192:8081"
  const origin: string | undefined = devServer
    ? `http://${devServer}`
    : (process.env.EXPO_PUBLIC_API_URL || Constants.expoConfig?.extra?.apiUrl)?.replace(/\/+$/, "");
  if (Platform.OS !== "web" && !origin) {
    throw new Error("The app's server address is missing. Rebuild with EXPO_PUBLIC_API_URL set.");
  }
  return fetch(Platform.OS === "web" ? path : `${origin}${path}`, options);
}
