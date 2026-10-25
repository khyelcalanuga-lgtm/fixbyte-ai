import { Platform, TurboModuleRegistry } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { getApp, getApps, initializeApp } from "firebase/app";
import { deleteDoc, doc, getFirestore } from "firebase/firestore";
import { deleteLibrary } from "./library";
import {
  deleteUser,
  EmailAuthProvider,
  getAuth,
  GoogleAuthProvider,
  initializeAuth,
  reauthenticateWithCredential,
  reauthenticateWithPopup,
  signInWithCredential,
  signInWithPopup,
  type Auth,
  type Persistence,
  type User,
} from "firebase/auth";

function phoneGoogle() {
  // Metro reports a missing native module as fatal before a local catch can handle the require.
  if (!TurboModuleRegistry.get("RNGoogleSignin")) return null;
  return (require("@react-native-google-signin/google-signin") as typeof import("@react-native-google-signin/google-signin")).GoogleSignin;
}

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

// Google sign-in. Web uses Firebase's popup. Phones use Google's own account picker and hand its ID token to
// Firebase; that needs the "Web client ID" Firebase creates when Google is turned on (Authentication > Sign-in
// method > Google > Web SDK configuration) and the APK's SHA-1 added to the Firebase Android app.
export async function googleSignIn() {
  const auth = firebaseAuth();
  if (Platform.OS === "web") return void (await signInWithPopup(auth, new GoogleAuthProvider()));
  const cred = await phoneGoogleCredential();
  if (cred) await signInWithCredential(auth, cred);
}

// The phone's Google account picker, as a Firebase credential; null if the picker was closed.
async function phoneGoogleCredential() {
  const webClientId = process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID;
  if (!webClientId) throw { code: "auth/operation-not-allowed" };
  const GoogleSignin = phoneGoogle();
  if (!GoogleSignin) throw { code: "auth/google-unavailable" };
  GoogleSignin.configure({ webClientId });
  await GoogleSignin.hasPlayServices();
  const res = await GoogleSignin.signIn();
  return res.type === "success" ? GoogleAuthProvider.credential(res.data.idToken) : null;
}

export const isGoogleUser = (user: User) => user.providerData.some((p) => p.providerId === "google.com");

// Deletes the account for good. Firebase only allows that right after signing in, so it first confirms who it
// is: Google accounts pick the account again, email accounts give their password. False if the picker was closed.
export async function deleteAccount(user: User, password: string, beforeDelete: () => Promise<void> = async () => {}): Promise<boolean> {
  if (!isGoogleUser(user)) {
    await reauthenticateWithCredential(user, EmailAuthProvider.credential(user.email ?? "", password));
  } else if (Platform.OS === "web") {
    await reauthenticateWithPopup(user, new GoogleAuthProvider()); // first await: the popup needs the tap's gesture
  } else {
    const GoogleSignin = phoneGoogle();
    if (!GoogleSignin) throw { code: "auth/google-unavailable" };
    await GoogleSignin.signOut().catch(() => {}); // so the picker asks instead of reusing the last account
    const cred = await phoneGoogleCredential();
    if (!cred) return false;
    await reauthenticateWithCredential(user, cred);
  }
  await beforeDelete();
  const db = getFirestore(firebaseAuth().app);
  await deleteLibrary(db, user.uid);
  await deleteDoc(doc(db, "profiles", user.uid));
  await deleteUser(user);
  return true;
}

// Forget the Google account on the phone too, so the next sign-in asks which account to use.
export function googleSignOut() {
  if (Platform.OS !== "web") phoneGoogle()?.signOut().catch(() => {});
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
  "auth/google-unavailable": "Google sign-in needs an app build that includes it. Expo Go does not include it.",
  "auth/requires-recent-login": "Sign in again, then try that once more.",
  "auth/user-mismatch": "That's a different Google account. Pick the one you're signed in with.",
  // From the phone's Google module: 10 is DEVELOPER_ERROR (SHA-1 or web client ID doesn't match Firebase).
  "10": "Google sign-in isn't set up for this version of the app.",
  PLAY_SERVICES_NOT_AVAILABLE: "Google sign-in needs Google Play services on this phone.",
};

export function authMessage(e: unknown): string {
  const code = (e as { code?: string } | null)?.code ?? "";
  return MESSAGES[code] ?? "Something went wrong. Try again.";
}
