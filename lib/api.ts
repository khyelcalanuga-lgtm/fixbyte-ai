import { Platform } from "react-native";
import Constants from "expo-constants";

// Native apps call the hosted API; API keys remain on the server.
export async function apiFetch(path: string, options?: RequestInit) {
  const origin: string | undefined = (process.env.EXPO_PUBLIC_API_URL || Constants.expoConfig?.extra?.apiUrl)?.replace(/\/+$/, "");
  if (Platform.OS !== "web" && !origin) {
    throw new Error("The app's server address is missing. Rebuild with EXPO_PUBLIC_API_URL set.");
  }
  return fetch(Platform.OS === "web" ? path : `${origin}${path}`, options);
}
