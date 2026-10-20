import { Platform } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { getApp, getApps, initializeApp } from "firebase/app";
import { getAuth, initializeAuth, type Auth, type Persistence } from "firebase/auth";

// Firebase sign-in. The config comes from .env (EXPO_PUBLIC_FIREBASE_*): these values identify the Firebase
// project and are meant to ship inside the app; Firebase's own rules protect the accounts.
// Each variable is read by name because Expo only builds in env values referenced that way.
const config = {
  apiKey: process.env.EXPO_PUBLIC_FIREBASE_API_KEY,
  authDomain: process.env.EXPO_PUBLIC_FIREBASE_AUTH_DOMAIN,
  projectId: process.env.EXPO_PUBLIC_FIREBASE_PROJECT_ID,
  appId: process.env.EXPO_PUBLIC_FIREBASE_APP_ID,
};

// Until the config is in .env, the app keeps its old offline sign-in so it stays usable.
export const firebaseReady = !!(config.apiKey && config.authDomain && config.projectId && config.appId);

// getReactNativePersistence only exists in firebase/auth's React Native build, which TypeScript's (web) types
// don't describe. It keeps users signed in between app launches on phones.
const { getReactNativePersistence } = require("firebase/auth") as {
  getReactNativePersistence?: (storage: typeof AsyncStorage) => Persistence;
};

let auth: Auth | null = null;
export function firebaseAuth(): Auth {
  if (auth) return auth;
  const app = getApps().length ? getApp() : initializeApp(config);
  if (Platform.OS === "web" || !getReactNativePersistence) {
    auth = getAuth(app);
  } else {
    try {
      auth = initializeAuth(app, { persistence: getReactNativePersistence(AsyncStorage) });
    } catch {
      auth = getAuth(app); // already initialized (after a hot reload)
    }
  }
  return auth;
}

// Firebase error codes in plain words.
const MESSAGES: Record<string, string> = {
  "auth/invalid-email": "Enter a valid email address.",
  "auth/missing-email": "Enter your email address.",
  "auth/missing-password": "Enter your password.",
  "auth/weak-password": "Use a password with at least 6 characters.",
  "auth/email-already-in-use": "There's already an account with this email. Sign in instead.",
  "auth/invalid-credential": "Wrong email or password.",
  "auth/user-not-found": "There's no account with this email. Create one instead.",
  "auth/wrong-password": "Wrong email or password.",
  "auth/user-disabled": "This account has been turned off.",
  "auth/too-many-requests": "Too many tries. Wait a moment, then try again.",
  "auth/network-request-failed": "No internet connection. Check it and try again.",
  "auth/popup-closed-by-user": "Google sign-in was closed before it finished.",
  "auth/popup-blocked": "Your browser blocked the Google sign-in window. Allow pop-ups and try again.",
  "auth/operation-not-allowed": "This sign-in method isn't turned on in Firebase yet.",
  "auth/requires-recent-login": "Sign in again, then try that once more.",
};

export function authMessage(e: unknown): string {
  const code = (e as { code?: string } | null)?.code ?? "";
  return MESSAGES[code] ?? "Something went wrong. Try again.";
}
