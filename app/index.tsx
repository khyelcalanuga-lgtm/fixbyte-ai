import { forwardRef, useEffect, useId, useRef, useState, type ComponentProps, type ComponentRef, type ReactNode, type RefObject } from "react";
import {
  AccessibilityInfo,
  Animated,
  AppState,
  Easing,
  Image,
  Keyboard,
  Linking,
  PanResponder,
  Platform,
  Pressable as RNPressable,
  type PressableProps,
  type LayoutChangeEvent,
  type StyleProp,
  type ViewStyle,
  ScrollView,
  Share,
  StyleSheet,
  useColorScheme,
  Text,
  TextInput,
  View,
  useWindowDimensions,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
// Moves with the keyboard as it slides on phones (see lib/keyboard.tsx).
import { KeyboardAvoidingView } from "../lib/keyboard";
import { BlurTargetView, BlurView } from "expo-blur";
import { lensStyle } from "../lib/refraction";
import { GlassView, isGlassEffectAPIAvailable, isLiquidGlassAvailable } from "expo-glass-effect";
import { StatusBar } from "expo-status-bar";
import * as SystemUI from "expo-system-ui";
import * as ImagePicker from "expo-image-picker";
import { Feather as FeatherOutline, Ionicons, MaterialCommunityIcons } from "@expo/vector-icons";
import * as Location from "expo-location";
import Svg, { Circle, Defs, LinearGradient, Mask, Path, Pattern, Polyline, RadialGradient, Rect, Stop, type CircleProps } from "react-native-svg";
import { useFonts } from "expo-font";
// Per-weight imports: the package root pulls in all 18 Poppins files.
import { Poppins_400Regular } from "@expo-google-fonts/poppins/400Regular";
import { Poppins_500Medium } from "@expo-google-fonts/poppins/500Medium";
import { Poppins_600SemiBold } from "@expo-google-fonts/poppins/600SemiBold";
import { apiFetch } from "../lib/api";
import { DAILY_LIMIT, LIMIT_MESSAGE, SYNC_MESSAGE, recordSharedUse, recordUse, resetUsage, usedToday, watchSharedUsage } from "../lib/usage";
import { load, save } from "../lib/store";
import { saveConversations, type Conversation, type Diagnosis, type Question, type Turn } from "../lib/conversations";
import { clearLibraryCache, newLibraryId, openLibraryList, type LibraryList, type Gadget, type Check, type CheckStatus } from "../lib/library";
import { getFirestore } from "firebase/firestore";
import { AVATAR_COLORS, loadAvatarColor, resetAvatarColorCache, saveAvatarColor, watchAvatarColor } from "../lib/profile";
import { allowReminders, cancelReminders, remindLater } from "../lib/reminders";
import { authMessage, deleteAccount, firebaseAuth, firebaseReady, googleSignIn, googleSignOut, isGoogleUser } from "../lib/auth";
import {
  createUserWithEmailAndPassword,
  onAuthStateChanged,
  sendPasswordResetEmail,
  signInWithEmailAndPassword,
  signOut,
  updateProfile,
  type User,
} from "firebase/auth";
import Constants from "expo-constants";

type FeatherName = keyof typeof FeatherOutline.glyphMap;

// Every icon is drawn solid with rounded corners: the app names icons the Feather way, and each one is drawn
// with its filled, rounded twin from Ionicons. A name missing here falls back to Feather's outline.
const SOLID: Partial<Record<FeatherName, keyof typeof Ionicons.glyphMap>> = {
  "alert-circle": "alert-circle",
  "alert-triangle": "warning",
  "arrow-left": "arrow-back",
  "arrow-right": "arrow-forward",
  "arrow-up": "arrow-up",
  battery: "battery-full",
  bell: "notifications",
  bookmark: "bookmark",
  box: "cube",
  camera: "camera",
  check: "checkmark",
  "check-circle": "checkmark-circle",
  "chevron-left": "chevron-back",
  "chevron-right": "chevron-forward",
  clock: "time",
  code: "code-slash",
  "corner-up-left": "arrow-undo",
  "corner-up-right": "arrow-redo",
  cpu: "hardware-chip",
  crosshair: "locate",
  droplet: "water",
  edit: "create",
  "edit-2": "pencil",
  eye: "eye",
  "eye-off": "eye-off",
  "file-text": "document-text",
  flag: "flag",
  globe: "globe",
  "hard-drive": "server",
  headphones: "headset",
  "help-circle": "help-circle",
  home: "home",
  image: "image",
  info: "information-circle",
  key: "key",
  layers: "layers",
  lock: "lock-closed",
  "log-out": "log-out",
  "map-pin": "location",
  "message-square": "chatbox",
  minus: "remove",
  monitor: "desktop",
  moon: "moon",
  "more-horizontal": "ellipsis-horizontal",
  navigation: "navigate",
  paperclip: "attach",
  phone: "call",
  plus: "add",
  power: "power",
  printer: "print",
  "rotate-ccw": "refresh-circle",
  "rotate-cw": "sync-circle",
  save: "save",
  search: "search",
  settings: "settings",
  share: "share",
  shield: "shield",
  slash: "ban",
  smartphone: "phone-portrait",
  speaker: "volume-high",
  tablet: "tablet-portrait",
  thermometer: "thermometer",
  tool: "construct",
  "trash-2": "trash",
  tv: "tv",
  "upload-cloud": "cloud-upload",
  user: "person",
  "user-x": "person-remove",
  watch: "watch",
  wind: "cloudy",
  x: "close",
  "x-octagon": "close-circle",
  "zap-off": "flash-off",
};

function Feather({ name, ...props }: ComponentProps<typeof FeatherOutline>) {
  const solid = SOLID[name as FeatherName];
  return solid ? <Ionicons name={solid} {...props} /> : <FeatherOutline name={name} {...props} />;
}
type Part = { type: "text"; text: string } | { type: "image_url"; image_url: { url: string } };
// Diagnosing screen state. stage = the 1-based checklist row in progress; 5 = all done.
type Diag = { photo: boolean; device?: string; finding?: string; software?: string; stage: number };

const TYPES = ["image/png", "image/jpeg", "image/gif", "image/webp"];
const GREEN = "#7CEB5A";
const AMBER = "#F5A524"; // "Needs a pro": a warning, kept apart from green's "fixed"

// Dark mode. Colours go through two functions by role:
// - surface(): backgrounds. White cards turn dark grey; black surfaces (buttons, hero cards, selected chips) stay
//   dark, lifted one step so they read as raised; light greys deepen. Layered greys, never pure black.
// - tone(): ink (text, icons, outlines). Black ink turns soft off-white, not pure white, which is easier on the eyes;
//   white ink (it sits on black surfaces, which stay dark) is unchanged.
// In light mode both return the colour unchanged. GREEN, reds, ON_ACCENT (black on green) and WHITE stay as they are.
let DARK = false;
const ON_ACCENT = "#000";
const WHITE = "#fff";
const INK = "230,230,232"; // dark-mode text, as rgb for tints
const DARK_SURFACES: Record<string, string> = {
  "#fff": "#1C1C1F", // cards
  "#000": "#2E2E33", // buttons, hero cards, selected chips: a step above the cards
  "#F3F3F3": "#2A2A2E", // soft fills inside cards
  "#F2F2F2": "#2A2A2E",
  "#E8E8E8": "#2A2A2E",
  "#EDEDED": "#38383D",
  "#E3E3E3": "#38383D",
  "#DDDDDD": "#38383D",
  "#ddd": "#38383D",
  "#D9D9D9": "#38383D",
  "#CFCFCF": "#48484D", // switch, off
  "#2D2D2D": GREEN, // switch, on
  "#2A2A2A": "#3A3A40",
  "#EAF7E5": "#1F2A1C",
  "#D5E2D5": "#33402F",
  "#FFD9D2": "#43282A",
  "#FDECEC": "#3A2224",
  "#FFF1D6": "#3A2E17", // amber tint
};
const DARK_INK: Record<string, string> = {
  "#000": `rgb(${INK})`,
  "#A35F00": AMBER, // amber ink, readable on the tint in both themes
  "#E3E3E3": "#38383D", // the progress ring's track
  "#D5E2D5": "#33402F",
  "#CFCFCF": "#48484D",
  "#2D2D2D": GREEN,
};
function surface(col: string): string {
  if (!DARK) return col;
  if (DARK_SURFACES[col]) return DARK_SURFACES[col];
  const m = /^rgba\(0,0,0,([\d.]+)\)$/.exec(col); // black overlays (dividers, the tab lens) turn light
  return m ? `rgba(${INK},${m[1]})` : col;
}
function tone(col: string): string {
  if (!DARK) return col;
  if (DARK_INK[col]) return DARK_INK[col];
  const m = /^rgba\(0,0,0,([\d.]+)\)$/.exec(col); // secondary text keeps its transparency
  return m ? `rgba(${INK},${m[1]})` : col;
}
const PAGE_BG = () => (DARK ? "#111113" : "#F3F3F3"); // the page, below the cards
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
const NATIVE = Platform.OS !== "web"; // Animated's native driver doesn't exist on web
const STAGGER_MS = 100; // gap between two chat bubbles arriving in the same turn
const STEP_MS = 900; // time each already-known checklist row spends "in progress"
const MIN_DIAG_MS = 3000; // shortest time the Diagnosing screen stays up, so row 3 is visibly in progress too
const RING_PAD = 6; // inset of the progress arc, so its 10pt dot isn't clipped
// Animated adds collapsable={false}, which react-native-svg's web build forwards to the DOM <circle> (console error).
const AnimatedCircle = Animated.createAnimatedComponent(
  forwardRef<Circle, CircleProps & { collapsable?: boolean }>(function ArcCircle({ collapsable: _, ...props }, ref) {
    return <Circle ref={ref} {...props} />;
  }),
);

function toApi(turns: Turn[]) {
  return turns.map((t) => {
    if (t.role === "assistant") {
      const qs = t.questions.map((q) => `${q.question} (${q.options.join(" / ")})`);
      return { role: "assistant", content: [t.text, ...qs].join("\n") };
    }
    const content: Part[] = [];
    if (t.image) content.push({ type: "image_url", image_url: { url: t.image } });
    const text = [t.answers, t.text].filter(Boolean).join("\n\n");
    if (text) content.push({ type: "text", text });
    return { role: "user", content };
  });
}

export default function App() {
  const [fontsLoaded] = useFonts({ Poppins_400Regular, Poppins_500Medium, Poppins_600SemiBold });
  const [start, setStart] = useState(true); // the start page, until it has faded out
  const [settings, setSettings] = useState(loadSettings); // name, email and preferences, saved on the device
  const [avatarColor, setAvatarColor] = useState(() => loadAvatarColor(null));
  const [profileError, setProfileError] = useState("");
  const scheme = useColorScheme();
  const [mounted, setMounted] = useState(Platform.OS !== "web");
  useEffect(() => setMounted(true), []);
  // Set before anything below renders: every component reads `s`, tone() and surface() from it.
  const dark = mounted && (settings.theme === "dark" || (settings.theme === "system" && scheme === "dark"));
  applyTheme(dark);
  useEffect(() => {
    SystemUI.setBackgroundColorAsync(dark ? "#111113" : "#F3F3F3");
  }, [dark]);
  const updateSettings = (patch: Partial<Settings>) =>
    setSettings((cur) => {
      const next = { ...cur, ...patch };
      save(SETTINGS_KEY, JSON.stringify(next));
      return next;
    });
  const [tab, setTab] = useState<Tab>("home");
  const glassTarget = useRef<ComponentRef<typeof View>>(null); // the page under the glass tab bar (Android blurs this view) // My gadgets opens from Home's phone button; the tab bar does the rest
  const [welcomed, setWelcomed] = useState(() => load(WELCOMED) === "yes"); // offline sign-in, used until Firebase is set up
  // The Firebase account; undefined while Firebase is still restoring a saved sign-in.
  const [user, setUser] = useState<User | null | undefined>(firebaseReady ? undefined : null);
  const signedIn = firebaseReady ? !!user : welcomed;
  const uid = user?.uid ?? "offline";
  const [gadgets, setGadgets] = useState<Gadget[]>([]);
  const [history, setHistory] = useState<Check[]>([]);
  const [libraryErrors, setLibraryErrors] = useState({ gadgets: "", history: "" });
  const [libraryVersion, setLibraryVersion] = useState(0);
  const library = useRef<{ uid: string; gadgets: LibraryList<Gadget>; history: LibraryList<Check>; conversations: LibraryList<Conversation> } | null>(null);
  useEffect(() => {
    setLibraryErrors({ gadgets: "", history: "" });
    setConversationError("");
    const db = user ? getFirestore(firebaseAuth().app) : null;
    const current = {
      uid,
      gadgets: openLibraryList(db, uid, "gadgets", setGadgets, message => setLibraryErrors(errors => ({ ...errors, gadgets: message }))),
      history: openLibraryList(db, uid, "history", setHistory, message => setLibraryErrors(errors => ({ ...errors, history: message }))),
      conversations: openLibraryList(db, uid, "conversations", items => setConversationState({ uid, items }), setConversationError),
    };
    library.current = current;
    return () => { void current.gadgets.stop(); void current.history.stop(); void current.conversations.stop(); };
  }, [uid, libraryVersion]);
  const saveGadgets = (list: Gadget[]) => { if (library.current?.uid === uid) library.current.gadgets.save(gadgets, list); };
  const saveHistory = (list: Check[]) => { if (library.current?.uid === uid) library.current.history.save(history, list); };
  const stopLibrary = async () => { await Promise.all([library.current?.gadgets.stop(), library.current?.history.stop(), library.current?.conversations.stop()]); };
  const [forGadget, setForGadget] = useState<Gadget | null>(null); // "Check this gadget": the chat is about this one
  // A saved diagnosis that matched no gadget, waiting for "Which gadget is this?".
  const [filing, setFiling] = useState<{ turn: number; id: string; device?: string; kind: string } | null>(null);
  const [askFixed, setAskFixed] = useState<string | null>(null); // check id for "Did the repair work?"
  const [authMode, setAuthMode] = useState<AuthMode | null>(null); // Sign in / Create account, opened from Welcome
  const [setup, setSetup] = useState(false); // the new-account questions, shown once after Create account
  const [turns, setTurns] = useState<Turn[]>([]);
  const [conversationId, setConversationId] = useState(newLibraryId);
  const [conversationState, setConversationState] = useState<{ uid: string; items: Conversation[] }>({ uid: "", items: [] });
  const [conversationError, setConversationError] = useState("");
  const [showConversations, setShowConversations] = useState(false);
  const [text, setText] = useState("");
  const [image, setImage] = useState<string | null>(null); // data URL
  const [attachOpen, setAttachOpen] = useState(false); // the plus button's camera / gallery menu
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [startedAt, setStartedAt] = useState<Date | null>(null);
  const [diag, setDiag] = useState<Diag | null>(null);
  const [resultIdx, setResultIdx] = useState<number | null>(null); // turn shown on the Diagnosis page
  const [guideStep, setGuideStep] = useState<number | null>(null); // Repair Guide step on screen, null = closed
  const [showShops, setShowShops] = useState(false); // Repair Shops page, opened from "Find a repair shop"
  const [used, setUsed] = useState<number | null>(null); // null until a signed-in account's shared count loads
  const [usageError, setUsageError] = useState(false);
  const scroll = useRef<ComponentRef<typeof ScrollView>>(null);
  const input = useRef<ComponentRef<typeof TextInput>>(null);
  const run = useRef(0); // bumped by cancel() so a late reply from a cancelled request is ignored
  const abort = useRef<AbortController | null>(null);

  useEffect(() => {
    reset();
    setTab("home");
  }, [uid]);

  // Only message changes save a snapshot; updating the saved list must not trigger another save.
  useEffect(() => {
    if (conversationState.uid !== uid || library.current?.uid !== uid || busy || !turns.length) return;
    const previous = conversationState.items.find(item => item.id === conversationId);
    if (previous?.gadget === (forGadget?.id ?? null) && JSON.stringify(previous.turns) === JSON.stringify(turns)) return;
    const now = new Date().toISOString();
    const conversation: Conversation = { id: conversationId, startedAt: startedAt?.toISOString() ?? now, updatedAt: now, gadget: forGadget?.id ?? null, turns };
    const items = [conversation, ...conversationState.items.filter(item => item.id !== conversationId)];
    try {
      library.current.conversations.save(conversationState.items, items);
    } catch (error) {
      setConversationError(error instanceof Error ? error.message : "Conversation could not be saved.");
    }
  }, [uid, conversationId, turns, busy, startedAt, forGadget?.id]);

  const last = turns[turns.length - 1];
  const pending = last?.role === "assistant" && last.questions.length > 0 && !busy ? last : null;

  useEffect(() => {
    setProfileError("");
    setAvatarColor(loadAvatarColor(user ?? null));
    if (!user) return;
    return watchAvatarColor(user.uid, (color) => {
      setAvatarColor(color);
      setProfileError("");
    }, () => setProfileError("Your avatar color could not sync. Check your connection and try again."));
  }, [uid]);

  // Read after mount: the web build also renders on the server, where there's no stored count.
  useEffect(() => {
    setUsageError(false);
    if (!user) return void setUsed(usedToday(uid));
    setUsed(null);
    return watchSharedUsage(uid, (count) => {
      setUsed(count);
      setUsageError(false);
    }, () => {
      setUsed(null);
      setUsageError(true);
      setError(SYNC_MESSAGE);
    });
  }, [uid]);

  // A new diagnosis takes one of today's free uses; its questions and follow-ups don't count.
  function limitReached() {
    const n = user ? used : usedToday(uid); // shared account count updates live; offline count resets at local midnight
    if (!user) setUsed(n);
    if (n === null) {
      setError(SYNC_MESSAGE);
      return true;
    }
    if (n < DAILY_LIMIT) return false;
    setError(LIMIT_MESSAGE);
    return true;
  }

  async function pick(camera: boolean) {
    const perm = camera
      ? await ImagePicker.requestCameraPermissionsAsync()
      : await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) {
      setError(`${camera ? "Camera" : "Photo"} permission denied.`);
      return null;
    }
    // quality < 1 re-encodes to JPEG (also converts iOS HEIC) and keeps uploads small.
    const opts: ImagePicker.ImagePickerOptions = { mediaTypes: ["images"], base64: true, quality: 0.7 };
    const r = camera ? await ImagePicker.launchCameraAsync(opts) : await ImagePicker.launchImageLibraryAsync(opts);
    const a = r.assets?.[0];
    if (r.canceled || !a?.base64) return null;
    const mime = a.mimeType && TYPES.includes(a.mimeType) ? a.mimeType : "image/jpeg";
    return `data:${mime};base64,${a.base64}`;
  }

  // "Scan a photo": straight to the camera, then attach it so the user can describe what happened before sending.
  // Web has no camera UI, so it opens the file picker.
  async function scan() {
    if (limitReached()) return;
    const url = await pick(Platform.OS !== "web");
    if (!url) return;
    setImage(url);
    input.current?.focus();
  }

  // The input bar's camera and image buttons. Web has no camera UI, so both open the file picker there.
  async function attach(camera: boolean) {
    setAttachOpen(false);
    const url = await pick(camera && Platform.OS !== "web");
    if (url) setImage(url);
  }

  // Save every finished diagnosis, even before its gadget is chosen, so a skipped prompt does not lose the check.
  function fileCheck(turn: number, gadget: string, check: Omit<Check, "id" | "gadget">) {
    const id = newLibraryId();
    saveHistory([...history, { id, gadget, ...check }]);
    setTurns((ts) => ts.map((t, i) => (i === turn && t.role === "assistant" ? { ...t, check: id } : t)));
    return id;
  }

  function attachCheck(id: string, gadget: string) {
    if (!history.some((c) => c.id === id)) throw new Error("Cannot attach a gadget to a missing history check");
    saveHistory(history.map((c) => (c.id === id ? { ...c, gadget } : c)));
    setFiling(null);
  }

  function reset() {
    run.current++;
    abort.current?.abort();
    setBusy(false);
    setDiag(null);
    setConversationId(newLibraryId());
    setShowConversations(false);
    setAttachOpen(false);
    setGuideStep(null);
    setShowShops(false);
    setForGadget(null);
    setFiling(null);
    setAskFixed(null);
    setTurns([]);
    setImage(null);
    setText("");
    setError("");
    setStartedAt(null);
    setResultIdx(null);
  }

  function openResult(i: number) {
    setGuideStep(null);
    setShowShops(false);
    setResultIdx(i);
  }

  // Follows Firebase's signed-in account. The profile shows the account's email and name (when it has one).
  useEffect(() => {
    if (!firebaseReady) return;
    return onAuthStateChanged(firebaseAuth(), (u) => {
      setUser(u);
      if (!u) return;
      updateSettings({ email: u.email ?? "", name: u.displayName ?? "" });
      // A brand-new account (first sign-in = creation) that hasn't answered the questions yet. Closing the app
      // halfway brings them back next time, since the session is restored rather than signed in again.
      const created = Date.parse(u.metadata.creationTime ?? "");
      const lastIn = Date.parse(u.metadata.lastSignInTime ?? "");
      if (Math.abs(lastIn - created) < 60_000 && load(`${SETUP_KEY}-${u.uid}`) !== "done") setSetup(true);
    });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps -- subscribe once

  // Sign out: ends the Firebase session (or the offline sign-in) and returns to the Welcome page.
  function leave() {
    if (firebaseReady) signOut(firebaseAuth()).catch(() => {});
    googleSignOut();
    save(WELCOMED, "no");
    setWelcomed(false);
    setAuthMode(null);
    setTab("home");
  }

  function toggleSaved(i: number) {
    setTurns((ts) => ts.map((t, j) => (j === i && t.role === "assistant" ? { ...t, saved: !t.saved } : t)));
  }

  function openConversations() {
    Keyboard.dismiss();
    setAttachOpen(false);
    setShowConversations(true);
  }

  function openConversation(conversation: Conversation, savedOnly = false) {
    reset();
    setConversationId(conversation.id);
    setTurns(conversation.turns);
    setStartedAt(new Date(conversation.startedAt));
    setForGadget(gadgets.find(gadget => gadget.id === conversation.gadget) ?? null);
    if (savedOnly) {
      const index = conversation.turns.findLastIndex(turn => turn.role === "assistant" && turn.diagnosis && turn.saved);
      if (index >= 0) setResultIdx(index);
    }
    setTab("home");
  }

  function choose(qi: number, option: string) {
    setTurns((ts) =>
      ts.map((t, i) =>
        i === ts.length - 1 && t.role === "assistant"
          ? { ...t, picked: t.picked.map((p, j) => (j === qi ? option : p)) }
          : t,
      ),
    );
  }

  async function send() {
    const answers = pending
      ?.questions.flatMap((q, i) => (pending.picked[i] ? [`${q.question} ${pending.picked[i]}`] : []))
      .join("\n");
    if (busy || (!text.trim() && !image && !answers)) return;
    if (!turns.length && limitReached()) return;

    const next: Turn[] = [...turns, { id: newLibraryId(), role: "user", image: image ?? undefined, text: text.trim() || undefined, answers }];
    setTurns(next);
    setResultIdx(null); // a follow-up from the Diagnosis page continues in the chat
    setStartedAt((d) => d ?? new Date());
    setText("");
    setImage(null);
    setError("");
    setBusy(true);
    const id = ++run.current;
    const sentAt = Date.now();
    const ctrl = new AbortController();
    abort.current = ctrl;
    // Answering the clarifying questions gets the final diagnosis: show the Diagnosing screen meanwhile.
    // Device and finding were already worked out in the question turn, so rows 1-2 just step through
    // "in progress" to done on a timer; row 3 then waits on the real request.
    if (pending && answers) {
      const photo = next.some((t) => t.role === "user" && !!t.image);
      setDiag({ photo, device: pending.device, finding: pending.finding, stage: 1 });
      (async () => {
        for (const stage of [2, 3]) {
          await wait(STEP_MS);
          if (id !== run.current) return;
          setDiag((d) => (d && d.stage < stage ? { ...d, stage } : d));
        }
      })();
    }
    try {
      const r = await apiFetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          messages: toApi(next),
          language: settings.language,
          profile: {
            skill: settings.skill,
            devices: settings.devices,
            gadget: forGadget ? { name: forGadget.name, kind: forGadget.kind } : undefined,
          },
        }),
        signal: ctrl.signal,
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error);
      if (id !== run.current) return;
      if (!turns.length) setUsed(user ? await recordSharedUse(uid) : recordUse(uid)); // failed replies do not cost a use
      if (id !== run.current) return;
      const seconds = Math.max(1, Math.round((Date.now() - sentAt) / 1000));
      if (pending && answers) {
        // Fast replies (~1.5s) would flash the screen by before its checklist animation plays.
        await wait(MIN_DIAG_MS - (Date.now() - sentAt));
        if (id !== run.current) return;
        // Tick off the last rows before revealing the answer.
        setDiag((d) => d && { ...d, software: data.software, stage: 4 });
        await wait(700);
        if (id !== run.current) return;
        setDiag((d) => d && { ...d, stage: 5 });
        await wait(500);
        if (id !== run.current) return;
      }
      const questions: Question[] = data.questions ?? [];
      setTurns([
        ...next,
        {
          id: newLibraryId(),
          role: "assistant",
          text: data.text,
          questions,
          picked: questions.map(() => undefined),
          device: data.device,
          deviceType: data.deviceType,
          finding: data.finding,
          diagnosis: data.diagnosis,
          seconds,
        },
      ]);
      if (data.diagnosis) {
        openResult(next.length);
        if (settings.reminders) remindLater(data.device, data.diagnosis.summary);
        const check = {
          date: todayYmd(),
          title: data.diagnosis.summary,
          detail: data.diagnosis.title,
          status: (data.diagnosis.difficulty === "Pro repair" ? "pro" : "checked") as CheckStatus,
        };
        // The gadget picked with "Check this gadget", else the one the AI's device name matches; otherwise ask.
        const target = forGadget ?? matchGadget(gadgets, data.device);
        const checkId = fileCheck(next.length, target?.id ?? "", check);
        if (!target) setFiling({ turn: next.length, id: checkId, device: data.device, kind: KIND_FROM_AI[data.deviceType ?? ""] ?? "Phone" });
      }
    } catch (err) {
      if (id !== run.current) return; // cancelled; cancel() already restored the screen
      setTurns(turns); // roll back so history stays valid (keeps any picked answers)
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      if (id === run.current) {
        setBusy(false);
        setDiag(null);
      }
    }
  }

  // Back to the questions with answers still picked, and any typed text or photo restored.
  function cancel() {
    run.current++;
    abort.current?.abort();
    const u = turns[turns.length - 1];
    if (u?.role === "user") {
      setText(u.text ?? "");
      if (u.image) setImage(u.image);
    }
    setTurns((ts) => ts.slice(0, -1));
    setDiag(null);
    setBusy(false);
  }

  // Firebase restores a saved sign-in in a moment; the start page covers it, so Welcome never flashes by.
  if (!mounted || !fontsLoaded || user === undefined || conversationState.uid !== uid) return <StartPage />;

  const home = turns.length === 0 && !busy;
  const out = home && used !== null && used >= DAILY_LIMIT;
  const time = startedAt?.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }).toUpperCase();
  const shown = resultIdx === null ? undefined : turns[resultIdx];
  const result = shown?.role === "assistant" && shown.diagnosis ? shown : undefined;

  return (
    <SafeAreaView style={s.screen} edges={["top", "left", "right"]}>
      <StatusBar style={DARK ? "light" : "dark"} />
      <BlurTargetView ref={glassTarget} style={s.flex}>
        {!signedIn ? (
          authMode ? (
            <Auth
              key={authMode}
              initial={authMode}
              onBack={() => setAuthMode(null)}
              onDone={(created) => {
                save(WELCOMED, "yes");
                setWelcomed(true);
                if (created) setSetup(true); // offline sign-in: Firebase's listener handles this otherwise
              }}
            />
          ) : (
            <Welcome onStart={() => setAuthMode("register")} onSignIn={() => setAuthMode("signin")} />
          )
        ) : setup ? (
          <Setup
            settings={settings}
            onFinish={(patch) => {
              updateSettings(patch);
              if (user && patch.name !== undefined) updateProfile(user, { displayName: patch.name }).catch(() => {});
              save(`${SETUP_KEY}-${user?.uid ?? "offline"}`, "done");
              setSetup(false);
              setTab("home");
            }}
          />
        ) : showConversations ? (
          <Conversations
            items={conversationState.uid === uid ? conversationState.items : []}
            error={conversationError}
            synced={!!user}
            onBack={() => setShowConversations(false)}
            onOpen={openConversation}
            onNew={() => { reset(); setTab("home"); }}
          />
        ) : tab === "gadgets" ? (
          <Gadgets
            gadgets={gadgets}
            history={history}
            syncError={libraryErrors.gadgets || libraryErrors.history}
            onChange={(list) => {
              saveGadgets(list);
              const removed = new Set(gadgets.filter(g => !list.some(next => next.id === g.id)).map(g => g.id));
              saveHistory(history.filter(c => !removed.has(c.gadget)));
            }}
            onCheck={(g) => {
              reset();
              setForGadget(g);
              setTab("home");
            }}
          />
        ) : tab === "history" ? (
          <History gadgets={gadgets} history={history} syncError={libraryErrors.history || libraryErrors.gadgets} onChange={saveHistory} onDiagnose={() => { reset(); setTab("home"); }} onConversations={openConversations} />
        ) : tab === "profile" ? (
          <Profile
            key={uid}
            gadgetCount={gadgets.length}
            checkCount={history.length}
            fixedCount={history.filter((c) => c.status === "fixed").length}
            settings={settings}
            onChange={updateSettings}
            avatarColor={avatarColor}
            profileError={profileError}
            onColorChange={async (color) => {
              await saveAvatarColor(user ?? null, color);
              if (user && firebaseAuth().currentUser?.uid !== user.uid) return;
              setAvatarColor(color);
              setProfileError("");
            }}
            user={user ?? null}
            onSignOut={leave}
            onDeleteAccount={async password => {
              if (!user) return false;
              try { return await deleteAccount(user, password, stopLibrary); }
              finally { if (firebaseAuth().currentUser) setLibraryVersion(version => version + 1); }
            }}
            onErase={async () => {
              saveConversations(uid, []);
              // Account deletion may already have loaded the signed-out session.
              setConversationState(current => current.uid === uid ? { uid, items: [] } : current);
              reset();
              void stopLibrary();
              clearLibraryCache(uid);
              resetAvatarColorCache(user ?? null);
              setAvatarColor(AVATAR_COLORS[0].value);
              cancelReminders();
              resetUsage(uid);
              if (!user) setUsed(0);
              save(SETTINGS_KEY, "{}");
              setSettings(DEFAULT_SETTINGS);
              setGadgets([]);
              setHistory([]);
              leave();
              if (!user) setLibraryVersion(version => version + 1);
            }}
          />
        ) : diag ? (
          <Diagnosing d={diag} onCancel={cancel} />
        ) : result && guideStep !== null ? (
          <Guide
            d={result.diagnosis!}
            step={guideStep}
            onStep={setGuideStep}
            onClose={(finished) => {
              setGuideStep(null);
              const c = history.find((h) => h.id === result.check);
              if (finished && c && c.status !== "fixed") setAskFixed(c.id);
            }}
          />
        ) : result && showShops ? (
          <Shops t={result} region={settings.region} onBack={() => setShowShops(false)} onGadgets={() => setTab("gadgets")} />
        ) : (
          <KeyboardAvoidingView style={s.flex} behavior="padding">
            {home && !result && <DotGlow />}
            {result ? (
              <Result
                t={result}
                onBack={() => setResultIdx(null)}
                onGadgets={() => setTab("gadgets")}
                top={
                  <>
                    {!!conversationError && <Text style={s.error} accessibilityRole="alert">{conversationError}</Text>}
                    {filing && filing.turn === resultIdx ? (
                      <FileCheck
                        device={filing.device}
                        gadgets={gadgets}
                        onPick={(g) => attachCheck(filing.id, g.id)}
                        onAdd={() => {
                          const g = newGadget(filing.device || "My device", filing.kind);
                          attachCheck(filing.id, g.id);
                          saveGadgets([g, ...gadgets]);
                        }}
                        onSkip={() => setFiling(null)}
                      />
                    ) : askFixed && askFixed === result.check ? (
                      <AskFixed
                        gadget={gadgets.find((g) => g.id === history.find((c) => c.id === askFixed)?.gadget)?.name}
                        onAnswer={(fixed) => {
                          if (fixed) saveHistory(history.map((c) => (c.id === askFixed ? { ...c, status: "fixed" } : c)));
                          setAskFixed(null);
                        }}
                      />
                    ) : undefined}
                  </>
                }
              />
            ) : home ? (
              <>
                <View style={s.header}>
                  <Pressable onPress={() => setTab("gadgets")} style={s.circle} accessibilityLabel="My gadgets">
                    <View style={s.headerPhone} />
                  </Pressable>
                  <Text style={s.title}>FixByte AI</Text>
                  <Pressable onPress={() => setTab("profile")} style={s.circle} accessibilityLabel="Profile">
                    <Avatar settings={settings} color={avatarColor} size={45} />
                  </Pressable>
                </View>
                <ScrollView style={s.flex} contentContainerStyle={s.home} keyboardShouldPersistTaps="handled" keyboardDismissMode="on-drag">
                  <Logo />
                  <Text style={s.greeting}>
                    {settings.name.trim() ? `${greeting()}, ${settings.name.trim().split(/\s+/)[0]}` : greeting()}
                  </Text>
                  <View style={s.cards}>
                    <Card icon="camera" title="Scan a photo" subtitle="AI spots the damage" onPress={scan} />
                    <Card icon="message-square" title="Describe it" subtitle="Type the symptoms" onPress={() => input.current?.focus()} />
                  </View>
                  <Pressable onPress={openConversations} style={s.conversationLink} accessibilityRole="button" accessibilityLabel="Previous conversations">
                    <Feather name="clock" size={15} color={tone("rgba(0,0,0,0.6)")} />
                    <Text style={s.usageUpgradeText}>Previous conversations</Text>
                    <Feather name="chevron-right" size={15} color={tone("rgba(0,0,0,0.6)")} />
                  </Pressable>
                  {!!(error || conversationError) && <Text style={s.error} accessibilityRole="alert">{error || conversationError}</Text>}
                </ScrollView>
              </>
            ) : (
              <>
                <View style={s.header}>
                  <Pressable onPress={reset} style={s.circle} accessibilityLabel="Back">
                    <Feather name="arrow-left" size={20} color={tone("#000")} />
                  </Pressable>
                  <Text style={s.title}>Diagnosis chat</Text>
                  <Pressable onPress={openConversations} disabled={busy} style={[s.circle, busy && s.disabled]} accessibilityLabel="Previous conversations" accessibilityRole="button">
                    <Feather name="clock" size={20} color={tone("#000")} />
                  </Pressable>
                </View>
                {time && <Text style={s.time}>TODAY, {time}</Text>}
                <ScrollView
                  ref={scroll}
                  style={s.flex}
                  contentContainerStyle={s.log}
                  onContentSizeChange={() => scroll.current?.scrollToEnd()}
                >
                  {turns.map((t, i) =>
                    t.role === "user" ? (
                      // Each bubble pops in on its own, one after the other.
                      <View key={i} style={s.userTurn}>
                        {t.image && (
                          <Pop from="right" style={s.photo}>
                            <Image source={{ uri: t.image }} style={s.photoImg} accessibilityLabel="Your photo" />
                          </Pop>
                        )}
                        {t.text && (
                          <Pop from="right" delay={t.image ? STAGGER_MS : 0} style={[s.bubble, s.user]}>
                            <Text selectable style={[s.msgText, s.userText]}>{t.text}</Text>
                          </Pop>
                        )}
                      </View>
                    ) : t.diagnosis ? (
                      // The verdict lives on the Diagnosis page; the chat keeps a card that reopens it.
                      <Pop key={i} from="left">
                        <Pressable onPress={() => openResult(i)} style={[s.bubble, s.assistant, s.verdictCard]}>
                          <Text style={s.verdictLabel}>DIAGNOSIS</Text>
                          <Text style={s.verdictTitle}>{t.diagnosis.title}</Text>
                          <View style={s.verdictLink}>
                            <Text style={[s.msgText, s.dim]}>View diagnosis</Text>
                            <Feather name="chevron-right" size={16} color={tone("rgba(0,0,0,0.5)")} />
                          </View>
                        </Pressable>
                      </Pop>
                    ) : (
                      <View key={i} style={s.assistantTurn}>
                        <Pop from="left" style={[s.bubble, s.assistant]}>
                          <Text selectable style={s.msgText}>{t.text}</Text>
                        </Pop>
                        {t.questions.length > 0 && (
                          <Pop from="left" delay={STAGGER_MS} style={[s.bubble, s.assistant, s.qCard]}>
                              {t.questions.map((q, qi) => (
                                <View key={qi}>
                                  <Text style={s.msgText}>{q.question}</Text>
                                  <View style={s.chips}>
                                    {q.options.map((o) => {
                                      const on = t.picked[qi] === o;
                                      return (
                                        <Pressable
                                          key={o}
                                          disabled={t !== pending}
                                          onPress={() => choose(qi, o)}
                                          style={[s.chip, on && s.chipOn]}
                                          accessibilityRole="radio"
                                          accessibilityState={{ selected: on }}
                                        >
                                          <Text style={[s.chipText, on && s.chipTextOn]}>{o}</Text>
                                        </Pressable>
                                      );
                                    })}
                                  </View>
                                </View>
                              ))}
                          </Pop>
                        )}
                      </View>
                    ),
                  )}
                  {busy && (
                    <Pop from="left" delay={STAGGER_MS}>
                      <Typing />
                    </Pop>
                  )}
                  {!!(error || conversationError) && <Text style={s.error} accessibilityRole="alert">{error || conversationError}</Text>}
                </ScrollView>
              </>
            )}

            <View style={s.footer}>
              {result?.diagnosis?.difficulty === "Pro repair" ? (
                // The professional page has no follow-up bar: its job is getting the device to a shop.
                <>
                  <Text style={s.disclaimer}>FixByte AI gives guidance only. It can't inspect your device in person.</Text>
                  <View style={s.actions}>
                    <Pressable onPress={() => setShowShops(true)} style={[s.guideBtn, s.shopBtn]} accessibilityRole="button">
                      <Text style={s.shopText}>Find a repair shop</Text>
                    </Pressable>
                    <Bookmark saved={!!result.saved} big onPress={() => toggleSaved(resultIdx!)} />
                  </View>
                </>
              ) : (
                <>
                  {!result && <Usage used={used} error={usageError} upgrade={home} />}
                  {forGadget && !result && (
                    <View style={s.forTag}>
                      <Feather name={kindIcon(forGadget.kind)} size={16} color={tone("#000")} />
                      <Text style={s.forTagText} numberOfLines={1}>
                        Checking your {forGadget.name}
                      </Text>
                      <Pressable onPress={() => setForGadget(null)} hitSlop={10} accessibilityLabel="Stop checking this gadget">
                        <Feather name="x" size={16} color={tone("rgba(0,0,0,0.5)")} />
                      </Pressable>
                    </View>
                  )}
                  {result ? (
                    <View style={[s.actions, s.actionsGap]}>
                      <Pressable onPress={() => setGuideStep(0)} style={s.guideBtn} accessibilityRole="button">
                        <Feather name="tool" size={18} color={GREEN} />
                        <Text style={s.guideText}>Start repair guide</Text>
                      </Pressable>
                      <Bookmark saved={!!result.saved} onPress={() => toggleSaved(resultIdx!)} />
                    </View>
                  ) : (
                    !home && !image && <Text style={s.hint}>Add another photo for a sharper result</Text>
                  )}
                  {image && (
                    <View style={s.preview}>
                      <Image source={{ uri: image }} style={s.thumb} />
                      <Pressable onPress={() => setImage(null)} style={s.remove} accessibilityLabel="Remove photo">
                      <Feather name="x" size={14} color={tone("#fff")} />
                      </Pressable>
                    </View>
                  )}
                  <View style={s.bar}>
                    <Pressable
                      onPress={() => {
                        Keyboard.dismiss(); // otherwise the open keyboard covers the menu
                        setAttachOpen((o) => !o);
                      }}
                      hitSlop={12}
                      accessibilityLabel={attachOpen ? "Close attach menu" : "Attach a photo"}
                      accessibilityRole="button"
                      accessibilityState={{ expanded: attachOpen }}
                      aria-expanded={attachOpen}
                    >
                      <Feather name={attachOpen ? "x" : "plus"} size={22} color={tone("#000")} />
                    </Pressable>
                    <TextInput
                      ref={input}
                      onFocus={() => setAttachOpen(false)}
                      value={text}
                      onChangeText={setText}
                      onSubmitEditing={() => send()}
                      placeholder={home ? "Describe the problem..." : result ? "Ask a follow-up..." : "Add more details..."}
                      placeholderTextColor={tone("rgba(0,0,0,0.2)")}
                      accessibilityLabel="Message"
                      style={s.input}
                    />
                    <Pressable onPress={() => send()} disabled={busy || out} style={[s.send, (busy || out) && s.disabled]} accessibilityLabel="Send">
                      <Feather name="arrow-up" size={18} color={tone("#fff")} />
                    </Pressable>
                  </View>
                </>
              )}
            </View>
            {/* Floats over the page just above the message bar, so nothing else moves. It's a child of this
                full-screen view rather than the footer: Android ignores taps outside a parent's bounds. */}
            {attachOpen && (
              <Pop from="left" style={s.attachMenu}>
                <Pressable onPress={() => attach(true)} style={s.attachItem} accessibilityRole="button">
                  <Feather name="camera" size={17} color={tone("#000")} />
                  <Text style={s.attachText}>Take a photo</Text>
                </Pressable>
                <Pressable onPress={() => attach(false)} style={s.attachItem} accessibilityRole="button">
                  <Feather name="image" size={17} color={tone("#000")} />
                  <Text style={s.attachText}>Choose from gallery</Text>
                </Pressable>
              </Pop>
            )}
          </KeyboardAvoidingView>
        )}
      </BlurTargetView>
      {/* One bar for all three tabs, so its pill can morph from tab to tab instead of being redrawn. */}
      {signedIn && !setup && !showConversations && tab !== "home" && <TabBar active={tab} onTab={setTab} target={glassTarget} />}
      {start && <StartPage onDone={() => setStart(false)} />}
    </SafeAreaView>
  );
}

const TAGS = {
  category: {
    Hardware: { icon: "hard-drive", label: "Hardware" },
    Software: { icon: "code", label: "Software" },
    Both: { icon: "layers", label: "Hardware + software" },
  },
  difficulty: {
    "Beginner-safe": { icon: "shield", style: "tagGreen" },
    "Some skill": { icon: "tool", style: "tagWhite" },
    "Pro repair": { icon: "alert-triangle", style: "tagWarn" },
  },
} as const;

const DEVICE_ICONS: Record<string, FeatherName> = {
  phone: "smartphone",
  tablet: "tablet",
  laptop: "monitor", // Feather has no laptop icon
  desktop: "monitor",
  tv: "tv",
  watch: "watch",
  headphones: "headphones",
  printer: "printer",
};
const MONO = Platform.select({ ios: "Menlo", default: "monospace" });
const SERIF = Platform.select({ android: "serif", default: "Georgia" }); // system serif, no font package needed

function greeting(hour = new Date().getHours()) {
  if (hour >= 5 && hour < 12) return "Good Morning";
  if (hour >= 12 && hour < 18) return "Good Afternoon";
  return "Good Evening";
}

// Home background: a circle of black dots behind the message bar, fading out toward its edge.
// One repeated pattern avoids mounting thousands of native SVG nodes when returning to Home.
const GLOW_R = 450; // circle radius
const GLOW_Y = 90; // circle center's height above the bottom edge
const GLOW_GAP = 16; // dot spacing

// The circle is wider than the screen, so it sits in a screen-sized clipped layer: nothing extends past the edges
// (unclipped, a browser scrolled the whole page sideways to reach the focused message box).
function DotGlow() {
  const id = useId();
  const drift = useRef(new Animated.Value(0)).current;
  const [canAnimate, setCanAnimate] = useState(false);
  useEffect(() => {
    let mounted = true;
    let allowed = false;
    const update = (state = AppState.currentState) => {
      if (mounted) setCanAnimate(allowed && state === "active");
    };
    const setReducedMotion = (reduced: boolean) => { allowed = !reduced; update(); };
    const motion = AccessibilityInfo.addEventListener("reduceMotionChanged", setReducedMotion);
    const activity = AppState.addEventListener("change", update);
    AccessibilityInfo.isReduceMotionEnabled().then(setReducedMotion).catch(() => {});
    return () => { mounted = false; motion.remove(); activity.remove(); };
  }, []);
  useEffect(() => {
    if (!canAnimate) { drift.setValue(0); return; }
    const animation = Animated.loop(Animated.sequence([
      Animated.timing(drift, { toValue: 1, duration: 12000, easing: Easing.inOut(Easing.quad), useNativeDriver: NATIVE }),
      Animated.timing(drift, { toValue: 0, duration: 12000, easing: Easing.inOut(Easing.quad), useNativeDriver: NATIVE }),
    ]));
    animation.start();
    return () => animation.stop();
  }, [canAnimate, drift]);
  return (
    <View style={s.glowClip} pointerEvents="none">
      <Animated.View style={[s.flex, {
        opacity: drift.interpolate({ inputRange: [0, 1], outputRange: [1, 0.9] }),
        transform: [
          { translateX: drift.interpolate({ inputRange: [0, 1], outputRange: [0, 4] }) },
          { translateY: drift.interpolate({ inputRange: [0, 1], outputRange: [0, -6] }) },
        ],
      }]}>
      <Svg width={GLOW_R * 2} height={GLOW_R * 2} style={s.glow}>
        <Defs>
          <Pattern id={`${id}-dots`} x={-GLOW_GAP / 2} y={-GLOW_GAP / 2} width={GLOW_GAP} height={GLOW_GAP} patternUnits="userSpaceOnUse">
            <Circle cx={GLOW_GAP / 2} cy={GLOW_GAP / 2} r={1.5} fill={tone("#000")} />
          </Pattern>
          <RadialGradient id={`${id}-fade`} cx={GLOW_R} cy={GLOW_R} r={GLOW_R} gradientUnits="userSpaceOnUse">
            <Stop offset={0} stopColor="#fff" stopOpacity={0.1} />
            <Stop offset={0.25} stopColor="#fff" stopOpacity={0.065} />
            <Stop offset={0.5} stopColor="#fff" stopOpacity={0.035} />
            <Stop offset={0.75} stopColor="#fff" stopOpacity={0.0125} />
            <Stop offset={1} stopColor="#fff" stopOpacity={0} />
          </RadialGradient>
          <Mask id={`${id}-mask`} x={0} y={0} width={GLOW_R * 2} height={GLOW_R * 2} maskUnits="userSpaceOnUse">
            <Rect width={GLOW_R * 2} height={GLOW_R * 2} fill={`url(#${id}-fade)`} />
          </Mask>
        </Defs>
        <Rect width={GLOW_R * 2} height={GLOW_R * 2} fill={`url(#${id}-dots)`} mask={`url(#${id}-mask)`} />
      </Svg>
      </Animated.View>
    </View>
  );
}

// Start page: the logo on white while the app loads, then a short fade into Home.
// Without onDone it just holds (shown while fonts load); with it, it fades out and calls onDone.
const START_MS = 900; // how long the logo stays before fading
function StartPage({ onDone }: { onDone?: () => void }) {
  const fade = useRef(new Animated.Value(1)).current;
  useEffect(() => {
    if (!onDone) return;
    const anim = Animated.sequence([
      Animated.delay(START_MS),
      Animated.timing(fade, { toValue: 0, duration: 350, easing: Easing.out(Easing.quad), useNativeDriver: NATIVE }),
    ]);
    anim.start(({ finished }) => finished && onDone());
    return () => anim.stop();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps -- runs once; onDone only clears state
  return (
    <Animated.View style={[s.start, { opacity: fade }]} accessibilityLabel="FixByte AI">
      <View style={s.startLogo}>
        <Logo />
      </View>
    </Animated.View>
  );
}

// Welcome page: shown after the start page until the user gets through Sign in or Create account
// (remembered on the device). "Get started" opens Create account; "I already have an account" opens Sign in.
const WELCOMED = "signed-in"; // renaming this shows Welcome and Sign in again on every device
function Welcome({ onStart, onSignIn }: { onStart: () => void; onSignIn: () => void }) {
  return (
    <View style={s.welcome}>
      <View style={s.welcomeTop}>
        <View style={s.startLogo}>
          <Logo />
        </View>
      </View>
      <Text style={s.welcomeTitle}>Know what’s broken</Text>
      <Text style={s.welcomeSub}>before you pay to fix it.</Text>
      <Text style={s.welcomeBody}>
        {"Snap a photo or describe the symptoms.\n"}
        FixByte AI finds the likely problem and shows you how to fix it safely.
      </Text>
      <View style={s.welcomeGap} />
      <Pressable onPress={onStart} style={s.welcomeBtn} accessibilityRole="button">
        <Text style={s.welcomeBtnText}>Get started</Text>
      </Pressable>
      <Pressable onPress={onSignIn} hitSlop={10} accessibilityRole="button">
        <Text style={s.welcomeLink}>I already have an account</Text>
      </Pressable>
    </View>
  );
}

// My gadgets: the devices the user owns, synced per account with a device cache.
// With no gadgets the page is one focused empty state; search and filters appear once there's something to find.
// A gadget's checks live in History; its card shows the latest one (issue, status) and the count.
const kindIcon = (kind: string): FeatherName => DEVICE_KINDS.find((k) => k.label === kind)?.icon ?? "box";
// Date-only strings are read as local dates (new Date("2026-10-20") would be UTC midnight).
const shortDate = (iso: string) =>
  new Date(iso.length === 10 ? `${iso}T00:00:00` : iso).toLocaleDateString([], { month: "short", day: "numeric" });
const todayYmd = () => {
  const d = new Date();
  return ymd(d.getFullYear(), d.getMonth(), d.getDate());
};
// The AI's deviceType, as one of the gadget types.
const KIND_FROM_AI: Record<string, string> = {
  phone: "Phone",
  tablet: "Tablet",
  laptop: "Laptop",
  desktop: "Desktop PC",
  tv: "TV",
  watch: "Smartwatch",
  headphones: "Headphones",
};
// The gadget the AI's device name points to: one whose name contains it or is contained in it, if exactly one does.
function matchGadget(gadgets: Gadget[], device?: string): Gadget | undefined {
  const norm = (t: string) => t.toLowerCase().replace(/[^a-z0-9]/g, "");
  const d = norm(device ?? "");
  if (d.length < 3) return undefined;
  const exact = gadgets.filter((g) => norm(g.name) === d);
  if (exact.length === 1) return exact[0]; // "iPhone 13 Pro" beats "iPhone 13"
  const hits = gadgets.filter((g) => {
    const n = norm(g.name);
    return n.length >= 3 && (n.includes(d) || d.includes(n));
  });
  return hits.length === 1 ? hits[0] : undefined;
}
const newGadget = (name: string, kind: string): Gadget => ({
  id: newLibraryId(),
  name,
  kind,
  added: new Date().toISOString(),
});

// Status colours carry meaning: green = fixed, amber = needs a pro, grey = checked or new.
// Raw light-mode colours, themed where drawn (this table is built once, at load). fg on green stays black.
const STATUS_PILL: Record<CheckStatus | "new", { label: string; icon?: FeatherName; bg: string; fg: string }> = {
  fixed: { label: "Fixed", icon: "check", bg: GREEN, fg: ON_ACCENT },
  checked: { label: "Checked", bg: "#EDEDED", fg: "#000" },
  pro: { label: "Needs a pro", icon: "alert-triangle", bg: "#FFF1D6", fg: "#A35F00" },
  new: { label: "New", bg: "#F3F3F3", fg: "rgba(0,0,0,0.55)" },
};

function Gadgets({
  gadgets,
  history,
  syncError,
  onChange,
  onCheck,
}: {
  gadgets: Gadget[];
  history: Check[];
  syncError: string;
  onChange: (list: Gadget[]) => void;
  onCheck: (g: Gadget) => void;
}) {
  // Each gadget's checks, oldest first; the last one is the gadget's current issue and status.
  const checksOf = (id: string) => history.filter((c) => c.gadget === id).sort((a, b) => a.date.localeCompare(b.date));
  const latest = (id: string) => checksOf(id).at(-1);
  const [query, setQuery] = useState("");
  const [kind, setKind] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [open, setOpen] = useState<string | null>(null); // card showing its Remove action
  const [confirm, setConfirm] = useState(false);
  const q = query.trim().toLowerCase();
  const kinds = DEVICE_KINDS.filter((k) => gadgets.some((g) => g.kind === k.label));
  const shown = gadgets.filter(
    (g) => (!kind || g.kind === kind) && (!q || `${g.name} ${g.kind} ${latest(g.id)?.title ?? ""}`.toLowerCase().includes(q)),
  );
  const pro = gadgets.filter((g) => latest(g.id)?.status === "pro").length;
  const summary = !gadgets.length
    ? "Every device you own, in one place"
    : `${gadgets.length} gadget${gadgets.length === 1 ? "" : "s"}${pro ? ` · ${pro} need${pro === 1 ? "s" : ""} a pro` : ""}`;

  const toggle = (id: string) => {
    setOpen(open === id ? null : id);
    setConfirm(false);
  };
  const remove = (id: string) => {
    onChange(gadgets.filter((g) => g.id !== id));
    setOpen(null);
    setConfirm(false);
    if (kind && !gadgets.some((g) => g.id !== id && g.kind === kind)) setKind(null);
  };

  return (
    <View style={s.flex}>
      <View style={s.gHeader}>
        <View style={s.flex}>
          <Text style={s.gTitle}>My gadgets</Text>
          <Text style={s.gCount}>{summary}</Text>
        </View>
        {gadgets.length > 0 && (
          <Pressable onPress={() => setAdding(true)} style={[s.circle, s.gAdd]} accessibilityLabel="Add a gadget">
            <Feather name="plus" size={22} color={GREEN} />
          </Pressable>
        )}
      </View>

      <ScrollView style={s.flex} contentContainerStyle={s.gList} keyboardShouldPersistTaps="handled">
        {!!syncError && <Text style={s.error} accessibilityRole="alert">{syncError}</Text>}
        {adding && (
          <AddGadget
            onCancel={() => setAdding(false)}
            onAdd={(g) => {
              onChange([g, ...gadgets]);
              setAdding(false);
            }}
          />
        )}

        {!gadgets.length && !adding && (
          <View style={s.gEmptyCard}>
            {/* A small cluster of devices: the one image on an otherwise quiet page. */}
            <View style={s.gHero}>
              <View style={[s.gHeroIcon, s.gHeroSide]}>
                <Feather name="watch" size={22} color={tone("#000")} />
              </View>
              <View style={[s.gHeroIcon, s.gHeroMain]}>
                <Feather name="smartphone" size={30} color={GREEN} />
              </View>
              <View style={[s.gHeroIcon, s.gHeroSide]}>
                <Feather name="monitor" size={22} color={tone("#000")} />
              </View>
            </View>
            <Text style={s.gEmptyTitle}>No gadgets yet</Text>
            <Text style={s.gEmptyBody}>Add the phones, laptops and other devices you own, so their repairs stay organised.</Text>
            <Pressable onPress={() => setAdding(true)} style={[s.welcomeBtn, s.gEmptyBtn]} accessibilityRole="button">
              <Feather name="plus" size={20} color={GREEN} />
              <Text style={s.welcomeBtnText}>Add your first gadget</Text>
            </Pressable>
          </View>
        )}

        {gadgets.length > 0 && (
          <>
            <View style={s.gSearch}>
              <Feather name="search" size={19} color={tone("rgba(0,0,0,0.45)")} />
              <TextInput
                value={query}
                onChangeText={setQuery}
                placeholder="Search your gadgets"
                placeholderTextColor={tone("rgba(0,0,0,0.3)")}
                accessibilityLabel="Search your gadgets"
                style={s.gSearchInput}
              />
              {!!query && (
                <Pressable onPress={() => setQuery("")} hitSlop={10} accessibilityLabel="Clear search">
                  <Feather name="x" size={18} color={tone("rgba(0,0,0,0.45)")} />
                </Pressable>
              )}
            </View>

            {kinds.length > 1 && (
              <ScrollView horizontal showsHorizontalScrollIndicator={false} style={s.gFilters} contentContainerStyle={s.gFilterRow}>
                {[{ label: "All", n: gadgets.length, value: null as string | null }, ...kinds.map((k) => ({ label: k.label, n: gadgets.filter((g) => g.kind === k.label).length, value: k.label }))].map(
                  (f) => {
                    const on = kind === f.value;
                    return (
                      <Pressable key={f.label} onPress={() => setKind(f.value)} style={[s.gChip, on && s.filterOn]} accessibilityState={{ selected: on }}>
                        <Text style={[s.gChipText, on && s.tagTextLight]}>{f.label}</Text>
                        <View style={[s.gChipCount, on && s.gChipCountOn]}>
                          <Text style={[s.gChipCountText, on && s.gChipCountTextOn]}>{f.n}</Text>
                        </View>
                      </Pressable>
                    );
                  },
                )}
              </ScrollView>
            )}

            {shown.map((g) => {
              const checks = checksOf(g.id);
              const last = checks.at(-1);
              const pill = STATUS_PILL[last?.status ?? "new"];
              const isOpen = open === g.id;
              return (
                <Pressable key={g.id} onPress={() => toggle(g.id)} style={s.gCard} accessibilityRole="button" accessibilityState={{ expanded: isOpen }}>
                  <View style={s.gTop}>
                    <View style={s.gIcon}>
                      <Feather name={kindIcon(g.kind)} size={24} color={tone("#000")} />
                    </View>
                    <View style={s.gText}>
                      <Text style={s.gName} numberOfLines={1}>
                        {g.name}
                      </Text>
                      <Text style={s.gKind}>{g.kind}</Text>
                    </View>
                    <View style={[s.gStatus, { backgroundColor: surface(pill.bg) }]}>
                      {pill.icon && <Feather name={pill.icon} size={13} color={tone(pill.fg)} />}
                      <Text style={[s.gStatusText, { color: tone(pill.fg) }]}>{pill.label}</Text>
                    </View>
                  </View>
                  <View style={s.gDivider} />
                  <View style={s.gFoot}>
                    <Text style={s.gIssue} numberOfLines={1}>
                      {last?.title ?? "No checks yet"}
                    </Text>
                    <Text style={s.gMeta}>
                      {last ? `${checks.length} check${checks.length === 1 ? "" : "s"} · ${shortDate(last.date)}` : `Added ${shortDate(g.added)}`}
                    </Text>
                  </View>
                  {isOpen && (
                    <>
                      <Pressable onPress={() => onCheck(g)} style={[s.welcomeBtn, s.gCheckBtn]} accessibilityRole="button">
                        <Feather name="search" size={18} color={GREEN} />
                        <Text style={s.welcomeBtnText}>Check this gadget</Text>
                      </Pressable>
                      {/* Two taps instead of a dialog: Alert has no buttons on web. */}
                      <Pressable onPress={() => (confirm ? remove(g.id) : setConfirm(true))} style={s.gRemove} accessibilityRole="button">
                        <Feather name="trash-2" size={17} color="#dc2626" />
                        <Text style={s.gRemoveText}>{confirm ? "Tap again to remove it and its checks" : `Remove ${g.name}`}</Text>
                      </Pressable>
                    </>
                  )}
                </Pressable>
              );
            })}
            {!shown.length && <Text style={[s.msgText, s.dim, s.gNoMatch]}>No gadgets match "{query || kind}".</Text>}
          </>
        )}
      </ScrollView>
    </View>
  );
}

// The add form, inline at the top of My gadgets: a name and one of the device types.
function AddGadget({ onAdd, onCancel }: { onAdd: (g: Gadget) => void; onCancel: () => void }) {
  const [name, setName] = useState("");
  const [kind, setKind] = useState(DEVICE_KINDS[0].label);
  const [error, setError] = useState("");
  function add() {
    if (!name.trim()) return setError("Give it a name, like \"iPhone 13\".");
    onAdd(newGadget(name.trim(), kind));
  }
  return (
    <Pop from="left" style={s.gAddCard}>
      <Text style={s.gAddTitle}>Add a gadget</Text>
      <TextInput
        value={name}
        onChangeText={(t) => {
          setName(t);
          setError("");
        }}
        placeholder="Name, e.g. iPhone 13"
        placeholderTextColor={tone("rgba(0,0,0,0.3)")}
        autoFocus
        returnKeyType="done"
        onSubmitEditing={add}
        accessibilityLabel="Gadget name"
        style={[s.authInput, s.gAddInput]}
      />
      <Text style={s.gAddLabel}>Type</Text>
      <View style={s.gKinds}>
        {DEVICE_KINDS.map((k) => {
          const on = kind === k.label;
          return (
            <Pressable key={k.label} onPress={() => setKind(k.label)} style={[s.gKindTile, on && s.setupOn]} accessibilityRole="radio" accessibilityState={{ checked: on }}>
              <Feather name={k.icon} size={20} color={on ? tone("#fff") : tone("#000")} />
              <Text style={[s.gKindText, on && s.tagTextLight]} numberOfLines={1}>
                {k.label}
              </Text>
            </Pressable>
          );
        })}
      </View>
      {!!error && <Text style={s.error}>{error}</Text>}
      <View style={s.gAddActions}>
        <Pressable onPress={onCancel} style={[s.googleBtn, s.gAddBtn]} accessibilityRole="button">
          <Text style={s.googleText}>Cancel</Text>
        </Pressable>
        <Pressable onPress={add} style={[s.welcomeBtn, s.gAddBtn]} accessibilityRole="button">
          <Text style={s.welcomeBtnText}>Add gadget</Text>
        </Pressable>
      </View>
    </Pop>
  );
}

// Bottom bar: Home on its own, then a black pill with My gadgets, History and Profile; the current one is white.
type Tab = "home" | "gadgets" | "history" | "profile";
// Solid icons, all from Material Community Icons so they share one style (Feather, used elsewhere in the app, only
// has outlines; Ionicons' phone is an outline and its house a different shape from its clock and person).
// "solid-phone" is drawn in code: every phone icon in the installed sets has a cut-out screen.
const TABS: { tab: Tab; icon: keyof typeof MaterialCommunityIcons.glyphMap | "solid-phone"; label: string; short: string }[] = [
  { tab: "gadgets", icon: "solid-phone", label: "My gadgets", short: "Gadgets" },
  { tab: "history", icon: "clock", label: "History", short: "History" },
  { tab: "profile", icon: "account", label: "Profile", short: "Profile" },
];

// Apple's own Liquid Glass material exists on iOS 26+ (the second check guards betas that lack the API and crash).
const NATIVE_GLASS = Platform.OS === "ios" && isLiquidGlassAvailable() && isGlassEffectAPIAvailable();

// One piece of Liquid Glass. On iOS 26 it uses Apple's real material.
// Elsewhere: a flat blur of the page behind (Android reads it from `target`, the page wrapped in a BlurTargetView)
// with almost no tint; on the web the backdrop is also refracted (lib/refraction.web.ts). Both get a hairline along the top and bottom edges that fades out toward the ends.
function Glass({ target, style, children, onLayout }: { target: RefObject<ComponentRef<typeof View> | null>; style?: ComponentProps<typeof View>["style"]; children: ReactNode; onLayout?: ComponentProps<typeof View>["onLayout"] }) {
  const [box, setBox] = useState({ w: 0, h: 0 }); // the web lens is shaped to this exact size
  const measure = (e: LayoutChangeEvent) => {
    setBox({ w: e.nativeEvent.layout.width, h: e.nativeEvent.layout.height });
    onLayout?.(e);
  };
  if (NATIVE_GLASS) {
    return (
      <GlassView glassEffectStyle="regular" isInteractive={false} colorScheme={DARK ? "dark" : "light"} style={[s.glassNative, style]} onLayout={measure}>
        <GlassEdges width={box.w} height={box.h} />
        {children}
      </GlassView>
    );
  }
  return (
    <View
      style={[s.glass, style]}
      onLayout={measure}
    >
      {Platform.OS === "web" ? (
        // Web: the backdrop bends along the glass's outline (refraction), in Chromium browsers.
        <View pointerEvents="none" style={[StyleSheet.absoluteFill, lensStyle(box.w, box.h)]} />
      ) : (
        <BlurView intensity={28} tint={DARK ? "dark" : "light"} blurTarget={target} blurMethod="dimezisBlurViewSdk31Plus" style={StyleSheet.absoluteFill} />
      )}
      <GlassEdges width={box.w} height={box.h} />
      {children}
    </View>
  );
}

// Inset the stroke so the longer fade stays inside the glass.
function GlassEdges({ width, height }: { width: number; height: number }) {
  const gradient = useId();
  if (!width || !height) return null;
  const fade = Math.min(height, width / 2) / width;
  return (
    <Svg pointerEvents="none" width={width} height={height} style={StyleSheet.absoluteFill}>
      <Defs>
        <LinearGradient id={gradient} x1="0%" y1="0%" x2="100%" y2="0%">
          <Stop offset={0} stopColor="#fff" stopOpacity={0} />
          <Stop offset={fade} stopColor="#fff" stopOpacity={1} />
          <Stop offset={1 - fade} stopColor="#fff" stopOpacity={1} />
          <Stop offset={1} stopColor="#fff" stopOpacity={0} />
        </LinearGradient>
      </Defs>
      <Rect x={0.5} y={0.5} width={width - 1} height={height - 1} rx={(height - 1) / 2} fill="none" stroke={`url(#${gradient})`} strokeWidth={1} strokeOpacity={DARK ? 0.22 : 0.95} />
    </Svg>
  );
}

// Bottom bar, floating over the page in glass: Home on its own, then My gadgets, History and Profile. The current
// tab sits under a fixed-width glass lens that slides smoothly between tabs.
function TabBar({ active, onTab, target }: { active: Tab; onTab: (t: Tab) => void; target: RefObject<ComponentRef<typeof View> | null> }) {
  const [w, setW] = useState(0); // the tab pill's width
  const position = useRef(new Animated.Value(0)).current;
  const placed = useRef(false);
  const i = TABS.findIndex((t) => t.tab === active);
  const slot = (w - 12) / TABS.length;

  useEffect(() => {
    if (slot <= 0) return;
    if (!placed.current) {
      position.setValue(i * slot);
      placed.current = true;
      return;
    }
    const animation = Animated.timing(position, { toValue: i * slot, duration: 180, easing: Easing.out(Easing.cubic), useNativeDriver: NATIVE });
    animation.start();
    return () => animation.stop();
  }, [slot, i, position]);

  return (
    <View style={s.tabBar} pointerEvents="box-none">
      <Pressable onPress={() => onTab("home")} style={s.glassShadow} accessibilityLabel="Home" accessibilityRole="button">
        <Glass target={target} style={s.tabHome}>
          {/* Positioned like the Views around it, so on the web it paints above the glass's absolute lens instead of being blurred by it. */}
          <Svg width={26} height={26} viewBox="0 0 24 24" pointerEvents="none" style={{ position: "relative" }}>
            {/* A house with every corner rounded (each Q curves through the corner it replaces), door included. */}
            <Path d="M4 19V12Q4 10 5.51 8.68L10.49 4.32Q12 3 13.51 4.32L18.49 8.68Q20 10 20 12V19Q20 21 18 21H15.5Q14.5 21 14.5 20V17.5Q14.5 16 13 16H11Q9.5 16 9.5 17.5V20Q9.5 21 8.5 21H6Q4 21 4 19Z" fill={tone("#000")} />
          </Svg>
        </Glass>
      </Pressable>
      <View style={[s.glassShadow, s.flex]} accessibilityRole="tablist" accessibilityLabel="Sections">
        <Glass target={target} style={s.tabPill} onLayout={(e) => setW(e.nativeEvent.layout.width)}>
          {w > 0 && <Animated.View style={[s.tabMorph, { width: slot - 4, transform: [{ translateX: position }] }]} />}
          {TABS.map(({ tab, icon, label, short }) => {
            const on = tab === active;
            return (
              <Pressable key={label} onPress={() => onTab(tab)} style={s.tabItem} accessibilityLabel={label} accessibilityRole="tab" accessibilityState={{ selected: on }} aria-selected={on}>
                {/* The active tab's icon and label use the same accent. */}
                {icon === "solid-phone" ? (
                  <View style={s.tabIconBox}>
                    <View style={[s.solidPhone, { backgroundColor: on ? GREEN : tone("rgba(0,0,0,0.7)") }]} />
                  </View>
                ) : (
                  <MaterialCommunityIcons name={icon} size={24} color={on ? GREEN : tone("rgba(0,0,0,0.7)")} />
                )}
                <Text style={[s.tabLabel, on && s.tabLabelOn]}>{short}</Text>
              </Pressable>
            );
          })}
        </Glass>
      </View>
    </View>
  );
}

// Profile and settings, kept on the device. Erase data (Password and security) puts back these defaults.
type Settings = {
  name: string;
  email: string;
  reminders: boolean;
  language: string;
  region: string;
  theme: "system" | "light" | "dark";
  devices: string[]; // gadget kinds from the new-account questions, passed to the AI as a hint
  skill: string; // repair experience from the new-account questions; the AI pitches its guides to it
};
const SETTINGS_KEY = "settings";
const DEFAULT_SETTINGS: Settings = {
  name: "",
  email: "",
  reminders: true,
  language: "English",
  region: "Metro Manila",
  theme: "system",
  devices: [],
  skill: "",
};
function loadSettings(): Settings {
  try {
    return { ...DEFAULT_SETTINGS, ...JSON.parse(load(SETTINGS_KEY) ?? "{}") };
  } catch {
    return DEFAULT_SETTINGS;
  }
}
// Language sets the language the AI replies in (the app's own labels stay English).
const LANGUAGES = ["English", "Filipino", "Cebuano", "Spanish", "Japanese"];
// Region is where shop search looks when location is off.
const REGIONS = ["Metro Manila", "Cebu City", "Davao City", "Baguio", "Iloilo City", "Cagayan de Oro"];
const SUPPORT_EMAIL = "contact@khyelcalanuga.dev";
// The avatar letter: the name's first letter, else the email's.
const initial = (st: Settings) => (st.name.trim()[0] ?? st.email.trim()[0] ?? "?").toUpperCase();

function Avatar({ settings, color, size = 56 }: { settings: Settings; color: string; size?: number }) {
  return (
    <View style={[s.avatar, { width: size, height: size, borderRadius: size / 2, backgroundColor: color }]}>
      <Text style={[s.avatarText, { fontSize: Math.round(size * 0.4), lineHeight: Math.round(size * 0.55) }]}>{initial(settings)}</Text>
    </View>
  );
}
const VERSION = Constants.expoConfig?.version ?? "1.0";

type Doc = { heading: string; body: string }[];
const HELP: Doc = [
  { heading: "How does FixByte AI diagnose a problem?", body: "Send a photo or describe what happened. The AI asks 1-3 quick questions, then gives the likely cause, how hard the fix is, and step-by-step repair guidance." },
  { heading: "Is the diagnosis always right?", body: "No. It's a best guess from what you share. For anything risky, like a swollen battery, mains power or water damage, stop and see a professional." },
  { heading: "Why is there a daily limit?", body: `You get ${DAILY_LIMIT} free diagnoses a day. Signed-in accounts share one count across devices, resetting at midnight UTC.` },
  { heading: "How are repair shops found?", body: "From OpenStreetMap, within 8 km of you, or of your Region when location is off. Opening hours and phone numbers come from OpenStreetMap and can be missing or out of date." },
  { heading: "What do repair reminders do?", body: "Two days after a diagnosis, your phone reminds you to check how the repair went. Turn them off anytime with the Repair reminders switch." },
  { heading: "What does Language change?", body: "The language the AI writes its answers in. The app's own buttons and labels stay in English." },
];
const PRIVACY: Doc = [
  { heading: "What you send", body: "Photos and descriptions you send go through FixByte's server to an AI provider (Google Gemini, Groq, Mistral or OpenRouter) to produce your diagnosis. FixByte's server doesn't keep them; each provider handles them under its own privacy policy." },
  { heading: "Your location", body: "Used only to find nearby repair shops and directions. Shop searches go through FixByte's server to OpenStreetMap services, and directions come from OpenStreetMap's routing service. Your location isn't stored." },
  { heading: "Saved data", body: "Settings stay on this device. When signed in, your full conversations and attached photos, saved diagnoses, gadgets, diagnosis history, avatar color and daily diagnosis count are saved in Firebase and synced across devices. An offline copy stays on this device." },
  { heading: "What we don't do", body: "No ads, no tracking, and your data isn't sold." },
  { heading: "Contact", body: `Questions about your privacy: ${SUPPORT_EMAIL}` },
];
const TERMS: Doc = [
  { heading: "Guidance only", body: "FixByte AI gives repair guidance based on what you share. It can't inspect your device in person and can be wrong." },
  { heading: "Your safety", body: "Follow the warnings in each repair guide. Stop and see a professional for swollen batteries, mains power, water damage, or anything you're unsure about." },
  { heading: "Your responsibility", body: "You decide whether to attempt a repair. FixByte AI isn't responsible for damage, data loss or injury from repairs you carry out." },
  { heading: "Fair use", body: `The free plan includes ${DAILY_LIMIT} diagnoses a day. Don't misuse the service or try to get around the limit.` },
  { heading: "Changes", body: "These terms may change as the app grows. The latest version is always here." },
];

type ProfilePage = "edit" | "appearance" | "language" | "region" | "security" | "help" | "privacy" | "terms" | "about";
const THEMES: { value: Settings["theme"]; label: string; short: string }[] = [
  { value: "system", label: "Same as my phone", short: "System" },
  { value: "light", label: "Light", short: "Light" },
  { value: "dark", label: "Dark", short: "Dark" },
];
type Row = { icon: FeatherName; label: string; value?: string; onPress: () => void; line?: boolean }; // line: divider above

// Profile: who's signed in, totals from the gadgets and history, settings and support pages.
function Profile({
  gadgetCount,
  checkCount,
  fixedCount,
  settings,
  user,
  onChange,
  avatarColor,
  profileError,
  onColorChange,
  onSignOut,
  onDeleteAccount,
  onErase,
}: {
  gadgetCount: number;
  checkCount: number;
  fixedCount: number;
  settings: Settings;
  user: User | null;
  onChange: (patch: Partial<Settings>) => void;
  avatarColor: string;
  profileError: string;
  onColorChange: (color: string) => Promise<void>;
  onSignOut: () => void;
  onDeleteAccount: (password: string) => Promise<boolean>;
  onErase: () => Promise<void>;
}) {
  const [page, setPage] = useState<ProfilePage | null>(null);
  const [note, setNote] = useState("");
  const [confirmErase, setConfirmErase] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [delPassword, setDelPassword] = useState("");
  const [delError, setDelError] = useState("");
  const back = () => {
    setPage(null);
    setConfirmErase(false);
    setConfirmDelete(false);
    setDelPassword("");
    setDelError("");
    setNote("");
  };

  // Remove shared records before deleting the account, then clear this device's cache.
  async function removeAccount() {
    if (!user) return;
    setDelError("");
    setDeleting(true);
    try {
      if (await onDeleteAccount(delPassword)) { await onErase(); return; }
    } catch (e) {
      setDelError(authMessage(e));
    }
    setDeleting(false);
  }
  const stats = [
    { n: gadgetCount, label: "Gadgets" },
    { n: checkCount, label: "Checks" },
    { n: fixedCount, label: "Fixed yourself" },
  ];

  async function setReminders(on: boolean) {
    setNote("");
    onChange({ reminders: on });
    if (!on) return cancelReminders();
    if (!(await allowReminders())) {
      setNote(
        Platform.OS === "web"
          ? "Reminders show up in the phone app, not in the browser."
          : "Allow notifications for FixByte AI in your phone's settings to get reminders.",
      );
    }
  }

  function feedback() {
    const url = `mailto:${SUPPORT_EMAIL}?subject=${encodeURIComponent(`FixByte AI feedback (v${VERSION})`)}`;
    Linking.openURL(url).catch(() => setNote(`No email app found. Send feedback to ${SUPPORT_EMAIL}.`));
  }

  if (page === "edit") {
    return (
      <SubPage title="Edit profile" onBack={back}>
        <EditProfile
          settings={settings}
          avatarColor={avatarColor}
          profileError={profileError}
          onColorChange={onColorChange}
          emailLocked={!!user}
          onSave={async (patch) => {
            if (user && patch.name !== settings.name) await updateProfile(user, { displayName: patch.name });
            onChange({ name: patch.name, email: patch.email });
            back();
          }}
        />
      </SubPage>
    );
  }
  if (page === "appearance") {
    return (
      <SubPage title="Appearance" onBack={back}>
        <Text style={[s.msgText, s.dim, s.pHint]}>Light, dark, or follow your phone's setting.</Text>
        <View style={s.pSettings}>
          {THEMES.map((t) => {
            const on = settings.theme === t.value;
            return (
              <Pressable key={t.value} onPress={() => onChange({ theme: t.value })} style={s.pRow} accessibilityRole="radio" accessibilityState={{ checked: on }}>
                <Text style={s.pRowLabel}>{t.label}</Text>
                {on && <Feather name="check" size={20} color={tone("#000")} />}
              </Pressable>
            );
          })}
        </View>
      </SubPage>
    );
  }
  if (page === "language" || page === "region") {
    const key = page;
    return (
      <SubPage title={page === "language" ? "Language" : "Region"} onBack={back}>
        <Text style={[s.msgText, s.dim, s.pHint]}>
          {page === "language"
            ? "The language FixByte AI writes its answers in."
            : "Where repair-shop search looks when location is off."}
        </Text>
        <View style={s.pSettings}>
          {(page === "language" ? LANGUAGES : REGIONS).map((o) => {
            const on = settings[key] === o;
            return (
              <Pressable
                key={o}
                onPress={() => {
                  onChange({ [key]: o });
                  back();
                }}
                style={s.pRow}
                accessibilityRole="radio"
                accessibilityState={{ checked: on }}
              >
                <Text style={s.pRowLabel}>{o}</Text>
                {on && <Feather name="check" size={18} color={tone("#000")} />}
              </Pressable>
            );
          })}
        </View>
      </SubPage>
    );
  }
  if (page === "security") {
    return (
      <SubPage title="Password and security" onBack={back}>
        <View style={[s.pSettings, s.pDoc]}>
          <Text style={s.pDocHeading}>Password</Text>
          <Text style={s.pDocBody}>
            {user?.email
              ? `To change your password, we'll email a reset link to ${user.email}.`
              : "Sign-in isn't connected to Firebase yet, so there's no password to change."}
          </Text>
        </View>
        {user?.email && (
          <Pressable
            onPress={() =>
              sendPasswordResetEmail(firebaseAuth(), user.email!)
                .then(() => setNote(`Reset link sent to ${user.email}. Check your inbox.`))
                .catch((e) => setNote(authMessage(e)))
            }
            style={[s.googleBtn, s.pSignOut]}
            accessibilityRole="button"
          >
            <Feather name="key" size={18} color={tone("#000")} />
            <Text style={s.googleText}>Email me a reset link</Text>
          </Pressable>
        )}
        {!!note && <Text style={[s.msgText, s.dim, s.pHint]}>{note}</Text>}
        <Pressable onPress={onSignOut} style={[s.googleBtn, s.pSignOut]} accessibilityRole="button">
          <Feather name="log-out" size={18} color={tone("#000")} />
          <Text style={s.googleText}>Sign out</Text>
        </Pressable>
        {/* Two taps instead of a dialog: Alert has no buttons on web. */}
        <Pressable
          onPress={async () => {
            if (!confirmErase) return setConfirmErase(true);
            try { await onErase(); } catch (e) { setNote(e instanceof Error ? e.message : "Your data could not be erased. Try again."); }
          }}
          style={[s.googleBtn, s.pSignOut]}
          accessibilityRole="button"
        >
          <Feather name="trash-2" size={18} color="#dc2626" />
          <Text style={[s.googleText, s.pSignOutText]}>{confirmErase ? "Tap again to erase" : "Erase data on this device"}</Text>
        </Pressable>
        <Text style={[s.msgText, s.dim, s.pHint]}>
          Erasing removes saved data from this device and signs you out. Your account, synced conversations, gadgets and history, avatar color, and daily count stay.
        </Text>
        {user && (
          <>
            {confirmDelete && !isGoogleUser(user) && (
              <Field
                label="Type your password to confirm"
                value={delPassword}
                onChangeText={setDelPassword}
                placeholder="Your password"
                secureTextEntry
                autoComplete="current-password"
                textContentType="password"
                onSubmitEditing={removeAccount}
              />
            )}
            <Pressable
              onPress={() => (confirmDelete ? removeAccount() : setConfirmDelete(true))}
              disabled={deleting}
              style={[s.googleBtn, s.pSignOut, deleting && s.disabled]}
              accessibilityRole="button"
            >
              <Feather name="user-x" size={18} color="#dc2626" />
              <Text style={[s.googleText, s.pSignOutText]}>
                {deleting ? "Deleting account…" : confirmDelete ? "Delete my account for good" : "Delete account"}
              </Text>
            </Pressable>
            {!!delError && <Text style={s.error}>{delError}</Text>}
            <Text style={[s.msgText, s.dim, s.pHint]}>
              {confirmDelete && isGoogleUser(user)
                ? "Google will ask you to pick your account once more to confirm it's you. "
                : ""}
              Deleting removes your account{user.email ? ` (${user.email})` : ""}, synced gadgets and history, and saved data on this device. It can't be undone.
            </Text>
          </>
        )}
      </SubPage>
    );
  }
  if (page === "help" || page === "privacy" || page === "terms") {
    const doc = page === "help" ? HELP : page === "privacy" ? PRIVACY : TERMS;
    return (
      <SubPage title={page === "help" ? "Help & FAQ" : page === "privacy" ? "Privacy policy" : "Terms of service"} onBack={back}>
        <View style={[s.pSettings, s.pDoc]}>
          {doc.map((d) => (
            <View key={d.heading} style={s.pDocItem}>
              <Text style={s.pDocHeading}>{d.heading}</Text>
              <Text style={s.pDocBody}>{d.body}</Text>
            </View>
          ))}
        </View>
      </SubPage>
    );
  }
  if (page === "about") {
    return (
      <SubPage title="About" onBack={back}>
        <View style={[s.pSettings, s.pAbout]}>
          <Logo />
          <Text style={[s.pName, s.pAboutName]}>FixByte AI</Text>
          <Text style={s.pDocBody}>Version {VERSION}</Text>
          <Text style={[s.pDocBody, s.pAboutText]}>
            An AI tech-repair assistant. Diagnose a device from a photo or description, follow a repair guide, or find a
            nearby repair shop.
          </Text>
        </View>
        <View style={[s.pSettings, s.pDoc]}>
          <Text style={s.pDocHeading}>Credits</Text>
          <Text style={s.pDocBody}>
            Maps © OpenStreetMap contributors, tiles by Esri. Directions by OpenStreetMap routing (FOSSGIS). AI by Google
            Gemini, Groq, Mistral and OpenRouter.
          </Text>
        </View>
      </SubPage>
    );
  }

  const settingRows: Row[] = [
    { icon: "moon", label: "Appearance", value: THEMES.find((t) => t.value === settings.theme)?.short, onPress: () => setPage("appearance") },
    { icon: "globe", label: "Language", value: settings.language, onPress: () => setPage("language") },
    { icon: "map-pin", label: "Region", value: settings.region, onPress: () => setPage("region") },
  ];
  const supportRows: Row[] = [
    { icon: "help-circle", label: "Help & FAQ", onPress: () => setPage("help") },
    { icon: "message-square", label: "Send feedback", onPress: feedback },
    { icon: "shield", label: "Privacy policy", onPress: () => setPage("privacy") },
    { icon: "file-text", label: "Terms of service", onPress: () => setPage("terms") },
    { icon: "info", label: "About", value: `v${VERSION}`, onPress: () => setPage("about") },
  ];
  const how = !user ? "Saved on this device" : isGoogleUser(user) ? "Signed in with Google" : "Signed in with email";

  return (
    <View style={s.flex}>
      <View style={s.gHeader}>
        <View style={s.flex}>
          <Text style={s.gTitle}>Profile</Text>
          <Text style={s.gCount}>{how}</Text>
        </View>
      </View>

      <ScrollView style={s.flex} contentContainerStyle={s.gList}>
        {/* Who you are (tap to edit), then what you've done. */}
        <View style={s.pCard}>
          <Pressable onPress={() => setPage("edit")} style={s.gTop} accessibilityRole="button" accessibilityLabel="Edit profile">
            <Avatar settings={settings} color={avatarColor} />
            <View style={s.gText}>
              <Text style={[s.pName, !settings.name.trim() && s.dim]} numberOfLines={1}>
                {settings.name.trim() || "Add your name"}
              </Text>
              <Text style={s.pEmail} numberOfLines={1}>
                {settings.email || "No email yet"}
              </Text>
            </View>
            <View style={s.pEdit}>
              <Text style={s.pEditText}>Edit</Text>
            </View>
          </Pressable>
          <View style={s.pStats}>
            {stats.map((st, i) => (
              <View key={st.label} style={[s.pStat, i > 0 && s.pStatLine]}>
                <Text style={s.pStatNum}>{st.n}</Text>
                <Text style={s.pStatLabel} numberOfLines={1}>
                  {st.label}
                </Text>
              </View>
            ))}
          </View>
        </View>

        {!!profileError && <Text style={s.error}>{profileError}</Text>}
        <Text style={[s.monoLabel, s.pSection]}>PREFERENCES</Text>
        <View style={s.pSettings}>
          <View style={s.pRow}>
            <View style={s.pIcon}>
              <Feather name="bell" size={17} color={tone("#000")} />
            </View>
            <View style={s.flex}>
              <Text style={s.pRowLabel}>Repair reminders</Text>
              <Text style={s.pRowSub}>A check-in 2 days after each diagnosis</Text>
            </View>
            <Toggle on={settings.reminders} onChange={setReminders} label="Repair reminders" />
          </View>
          {settingRows.map((row) => (
            <SettingRow key={row.label} {...row} line />
          ))}
        </View>
        {!!note && <Text style={[s.msgText, s.dim, s.pHint]}>{note}</Text>}

        <Text style={[s.monoLabel, s.pSection]}>ACCOUNT</Text>
        <View style={s.pSettings}>
          <SettingRow icon="lock" label="Password and security" onPress={() => setPage("security")} />
          <Pressable onPress={onSignOut} style={[s.pRow, s.pLine]} accessibilityRole="button">
            <View style={s.pIcon}>
              <Feather name="log-out" size={17} color="#dc2626" />
            </View>
            <Text style={[s.pRowLabel, s.pSignOutText]}>Sign out</Text>
          </Pressable>
        </View>

        <Text style={[s.monoLabel, s.pSection]}>SUPPORT</Text>
        <View style={s.pSettings}>
          {supportRows.map((row, i) => (
            <SettingRow key={row.label} {...row} line={i > 0} />
          ))}
        </View>
      </ScrollView>
    </View>
  );
}

// A Profile sub-page: back button and title over scrolling content (the tab bar stays below).
function SubPage({ title, onBack, children }: { title: string; onBack: () => void; children: ReactNode }) {
  return (
    <View style={s.flex}>
      <View style={s.header}>
        <Pressable onPress={onBack} style={s.circle} accessibilityLabel="Back">
          <Feather name="arrow-left" size={20} color={tone("#000")} />
        </Pressable>
        <Text style={s.title}>{title}</Text>
        <View style={s.headerSpacer} />
      </View>
      <ScrollView style={s.flex} contentContainerStyle={s.gList} keyboardShouldPersistTaps="handled">
        {children}
      </ScrollView>
    </View>
  );
}

// With a Firebase account the email is the sign-in email, so it's shown but not editable here.
function EditProfile({
  settings,
  avatarColor,
  profileError,
  onColorChange,
  emailLocked,
  onSave,
}: {
  settings: Settings;
  avatarColor: string;
  profileError: string;
  onColorChange: (color: string) => Promise<void>;
  emailLocked: boolean;
  onSave: (patch: Pick<Settings, "name" | "email">) => Promise<void>;
}) {
  const [name, setName] = useState(settings.name);
  const [email, setEmail] = useState(settings.email);
  const [pendingColor, setPendingColor] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function chooseColor(color: string) {
    if (busy) return;
    setBusy(true);
    setError("");
    setPendingColor(color);
    try {
      await onColorChange(color);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Your avatar color could not be saved. Try again.");
    } finally {
      setPendingColor(null);
      setBusy(false);
    }
  }

  async function save() {
    if (busy) return;
    if (!name.trim()) return setError("Enter your name.");
    if (!/^\S+@\S+\.\S+$/.test(email.trim())) return setError("Enter a valid email address.");
    setError("");
    setBusy(true);
    try {
      await onSave({ name: name.trim(), email: email.trim() });
    } catch (e) {
      setError(e instanceof Error && !("code" in e) ? e.message : authMessage(e));
    } finally { setBusy(false); }
  }
  return (
    <>
      <View style={s.avatarPreview}>
        <Avatar settings={{ ...settings, name, email }} color={pendingColor ?? avatarColor} size={96} />
      </View>
      <Text style={s.authLabel}>Avatar color</Text>
      <View style={s.avatarColors} accessibilityRole="radiogroup" accessibilityLabel="Avatar color">
        {AVATAR_COLORS.map(({ label, value }) => (
          <Pressable
            key={value}
            onPress={() => chooseColor(value)}
            disabled={busy}
            style={[s.avatarSwatch, { backgroundColor: value }]}
            accessibilityRole="radio"
            accessibilityLabel={label}
            accessibilityState={{ checked: (pendingColor ?? avatarColor) === value, disabled: busy }}
          >
            {(pendingColor ?? avatarColor) === value && <Feather name="check" size={22} color={ON_ACCENT} />}
          </Pressable>
        ))}
      </View>
      {!!profileError && <Text style={s.error}>{profileError}</Text>}
      <Field label="Name" value={name} onChangeText={setName} placeholder="Your name" autoComplete="name" textContentType="name" />
      <Field
        label="Email"
        value={email}
        onChangeText={setEmail}
        placeholder="you@example.com"
        keyboardType="email-address"
        autoCapitalize="none"
        autoComplete="email"
        textContentType="emailAddress"
        onSubmitEditing={save}
        editable={!emailLocked}
      />
      {emailLocked && <Text style={[s.msgText, s.dim, s.pHint]}>This is the email you sign in with.</Text>}
      {!!error && <Text style={s.error}>{error}</Text>}
      <Pressable onPress={save} disabled={busy} style={[s.welcomeBtn, s.authBtn, busy && s.disabled]} accessibilityRole="button">
        <Text style={s.welcomeBtnText}>{busy ? "Please wait…" : "Save"}</Text>
      </Pressable>
    </>
  );
}

function SettingRow({ icon, label, value, onPress, line }: Row) {
  return (
    <Pressable onPress={onPress} style={[s.pRow, line && s.pLine]} accessibilityRole="button">
      <View style={s.pIcon}>
        <Feather name={icon} size={17} color={tone("#000")} />
      </View>
      <Text style={s.pRowLabel}>{label}</Text>
      {value && (
        <Text style={s.pRowValue} numberOfLines={1}>
          {value}
        </Text>
      )}
      <Feather name="chevron-right" size={18} color={tone("rgba(0,0,0,0.35)")} />
    </Pressable>
  );
}

// On/off switch drawn to the mockup (dark when on), with the knob sliding across.
function Toggle({ on, onChange, label }: { on: boolean; onChange: (on: boolean) => void; label: string }) {
  const v = useRef(new Animated.Value(on ? 1 : 0)).current;
  useEffect(() => {
    // Not the native driver: it can't animate the background colour.
    const animation = Animated.timing(v, { toValue: on ? 1 : 0, duration: 160, easing: Easing.out(Easing.quad), useNativeDriver: false });
    animation.start();
    return () => animation.stop();
  }, [on, v]);
  return (
    <RNPressable onPress={() => onChange(!on)} hitSlop={8} accessibilityRole="switch" accessibilityState={{ checked: on }} accessibilityLabel={label}>
      <Animated.View style={[s.toggle, { backgroundColor: v.interpolate({ inputRange: [0, 1], outputRange: [tone("#CFCFCF"), tone("#2D2D2D")] }) }]}>
        <Animated.View style={[s.knob, { transform: [{ translateX: v.interpolate({ inputRange: [0, 1], outputRange: [0, 20] }) }] }]} />
      </Animated.View>
    </RNPressable>
  );
}

function Conversations({ items, error, synced, onBack, onOpen, onNew }: {
  items: Conversation[];
  error: string;
  synced: boolean;
  onBack: () => void;
  onOpen: (conversation: Conversation, savedOnly: boolean) => void;
  onNew: () => void;
}) {
  const [savedOnly, setSavedOnly] = useState(false);
  const shown = savedOnly ? items.filter(item => item.turns.some(turn => turn.role === "assistant" && turn.diagnosis && turn.saved)) : items;
  return (
    <View style={s.flex}>
      <View style={s.header}>
        <Pressable onPress={onBack} style={s.circle} accessibilityLabel="Back from conversations" accessibilityRole="button">
          <Feather name="arrow-left" size={20} color={tone("#000")} />
        </Pressable>
        <Text style={s.title}>Conversations</Text>
        <Pressable onPress={onNew} style={s.circle} accessibilityLabel="New conversation" accessibilityRole="button">
          <Feather name="plus" size={20} color={tone("#000")} />
        </Pressable>
      </View>
      <ScrollView style={s.flex} contentContainerStyle={s.log}>
        <Text style={s.hxDetail}>{synced ? "Synced with your account" : "Saved on this device"}</Text>
        <View style={s.chips}>
          {[false, true].map(saved => (
            <Pressable key={String(saved)} onPress={() => setSavedOnly(saved)} style={[s.filter, savedOnly === saved && s.filterOn]} accessibilityRole="button" accessibilityLabel={saved ? "Saved diagnoses" : "All conversations"} accessibilityState={{ selected: savedOnly === saved }}>
              <Text style={[s.filterText, savedOnly === saved && s.tagTextLight]}>{saved ? "Saved" : "All chats"}</Text>
            </Pressable>
          ))}
        </View>
        {!!error && <Text style={s.error} accessibilityRole="alert">{error}</Text>}
        {!shown.length && (
          <View style={s.gEmptyCard}>
            <Text style={s.gEmptyTitle}>{savedOnly ? "No saved diagnoses yet" : "No conversations yet"}</Text>
            <Text style={s.gEmptyBody}>{savedOnly ? "Tap Save on a diagnosis to find it here." : "Your chats will appear here as you talk. Use the + button to start a conversation."}</Text>
          </View>
        )}
        {shown.map(conversation => {
          const first = conversation.turns.find(turn => turn.role === "user");
          const title = first?.text?.trim() || "Photo diagnosis";
          const last = conversation.turns.at(-1);
          return (
            <Pressable key={conversation.id} onPress={() => onOpen(conversation, savedOnly)} style={s.hxEntry} accessibilityRole="button" accessibilityLabel={`Open conversation: ${title}`}>
              <View style={s.gTop}>
                <View style={[s.hxBadge, { backgroundColor: surface("#F3F3F3") }]}>
                  <Feather name="message-square" size={18} color={tone("#000")} />
                </View>
                <View style={s.gText}>
                  <Text style={s.hxTitle} numberOfLines={2}>{title}</Text>
                  <Text style={s.hxDetail} numberOfLines={2}>{last?.text || "Photo attached"}</Text>
                </View>
                <Feather name="chevron-right" size={18} color={tone("rgba(0,0,0,0.4)")} />
              </View>
              <View style={s.hxFoot}>
                <Text style={[s.hxMetaText, s.flex]}>{shortDate(conversation.updatedAt)} · {new Date(conversation.updatedAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}</Text>
                <Text style={s.hxMetaText}>{conversation.turns.length} messages</Text>
              </View>
            </Pressable>
          );
        })}
      </ScrollView>
    </View>
  );
}

// History: a month calendar marking each day's checks for one gadget, and the list of those checks.
// Checks sync to the account when a diagnosis finishes. "fixed" comes from the repair
// guide's "Did it work?".
const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const WEEKDAYS = ["S", "M", "T", "W", "T", "F", "S"];
const ymd = (y: number, m: number, d: number) => `${y}-${String(m + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`;

function StatusDot({ status, big }: { status: CheckStatus; big?: boolean }) {
  return <View style={[s.dot, big && s.dotBig, status === "fixed" ? s.dotFixed : status === "checked" ? s.dotChecked : s.dotPro]} />;
}

// History, all gadgets at once by default: a month card (calendar to pick a day, with a legend that counts the
// month) above a timeline of checks grouped by day, newest first. Tapping a check offers Mark as fixed and Remove.
// Same colours as the gadget pills; the legend order is the order a repair moves through.
const STATUS_BADGE: Record<CheckStatus, { label: string; icon: FeatherName; bg: string; fg: string }> = {
  checked: { label: "Checked", icon: "search", bg: "#F3F3F3", fg: "#000" },
  pro: { label: "Needs a pro", icon: "alert-triangle", bg: "#FFF1D6", fg: "#A35F00" },
  fixed: { label: "Fixed", icon: "check", bg: GREEN, fg: ON_ACCENT },
};
const parseDay = (d: string) => new Date(`${d}T00:00:00`);

function History({
  gadgets,
  history,
  syncError,
  onChange,
  onDiagnose,
  onConversations,
}: {
  gadgets: Gadget[];
  history: Check[];
  syncError: string;
  onChange: (list: Check[]) => void;
  onDiagnose: () => void;
  onConversations: () => void;
}) {
  const [only, setOnly] = useState<string | null>(null); // gadget filter; null = all gadgets
  const checks = history.filter((c) => !only || c.gadget === only).sort((a, b) => b.date.localeCompare(a.date) || b.id.localeCompare(a.id));
  const monthOf = (d?: string) => {
    const x = d ? parseDay(d) : new Date();
    return { y: x.getFullYear(), m: x.getMonth() };
  };
  const [view, setView] = useState(() => monthOf(checks[0]?.date)); // opens on the latest check's month
  const [day, setDay] = useState<number | null>(null); // selected day; null shows the whole month
  const [open, setOpen] = useState<string | null>(null); // check showing its actions
  const [confirm, setConfirm] = useState(false);

  const now = new Date();
  const today = ymd(now.getFullYear(), now.getMonth(), now.getDate());
  const yesterday = ymd(now.getFullYear(), now.getMonth(), now.getDate() - 1);
  const prefix = ymd(view.y, view.m, 1).slice(0, 8); // "YYYY-MM-"
  const monthChecks = checks.filter((c) => c.date.startsWith(prefix));
  // Each day's marker: the most urgent status that day (needs a pro > checked > fixed).
  const rank = { pro: 3, checked: 2, fixed: 1 };
  const byDay = new Map<number, CheckStatus>();
  for (const c of monthChecks) {
    const d = Number(c.date.slice(8));
    const cur = byDay.get(d);
    if (!cur || rank[c.status] > rank[cur]) byDay.set(d, c.status);
  }
  const shown = day === null ? monthChecks : monthChecks.filter((c) => Number(c.date.slice(8)) === day);
  const groups: { date: string; items: Check[] }[] = [];
  for (const c of shown) {
    if (groups.at(-1)?.date === c.date) groups.at(-1)!.items.push(c);
    else groups.push({ date: c.date, items: [c] });
  }
  const count = (st: CheckStatus) => monthChecks.filter((c) => c.status === st).length;
  const fixedAll = history.filter((c) => c.status === "fixed").length;
  const filterGadgets = gadgets.filter((g) => history.some((c) => c.gadget === g.id));

  // Weeks of 7 cells, blank before the 1st and after the last day.
  const cells: (number | null)[] = [
    ...Array(new Date(view.y, view.m, 1).getDay()).fill(null),
    ...Array.from({ length: new Date(view.y, view.m + 1, 0).getDate() }, (_, i) => i + 1),
  ];
  while (cells.length % 7) cells.push(null);
  const weeks = Array.from({ length: cells.length / 7 }, (_, w) => cells.slice(w * 7, w * 7 + 7));

  const goTo = (v: { y: number; m: number }) => {
    setView(v);
    setDay(null);
    setOpen(null);
  };
  const move = (delta: number) => {
    const d = new Date(view.y, view.m + delta, 1);
    goTo({ y: d.getFullYear(), m: d.getMonth() });
  };
  const filter = (id: string | null) => {
    setOnly(id);
    const latest = history.filter((c) => !id || c.gadget === id).sort((a, b) => b.date.localeCompare(a.date))[0];
    goTo(monthOf(latest?.date));
  };
  const dayLabel = (d: string) =>
    d === today
      ? "Today"
      : d === yesterday
        ? "Yesterday"
        : parseDay(d).toLocaleDateString([], { weekday: "short", month: "short", day: "numeric" });
  const toggle = (id: string) => {
    setOpen(open === id ? null : id);
    setConfirm(false);
  };

  return (
    <View style={s.flex}>
      <View style={s.gHeader}>
        <View style={s.flex}>
          <Text style={s.gTitle}>History</Text>
          <Text style={s.gCount}>
            {history.length
              ? `${history.length} check${history.length === 1 ? "" : "s"} · ${fixedAll} fixed`
              : "Every check and fix, by date"}
          </Text>
        </View>
        <Pressable onPress={onConversations} style={s.circle} accessibilityLabel="Previous conversations" accessibilityRole="button">
          <Feather name="message-square" size={20} color={tone("#000")} />
        </Pressable>
      </View>

      <ScrollView style={s.flex} contentContainerStyle={s.gList}>
        {!!syncError && <Text style={s.error} accessibilityRole="alert">{syncError}</Text>}
        {!history.length ? (
          <View style={s.gEmptyCard}>
            <View style={s.gHero}>
              <View style={[s.gHeroIcon, s.gHeroSide]}>
                <Feather name="search" size={22} color={tone("#000")} />
              </View>
              <View style={[s.gHeroIcon, s.gHeroMain]}>
                <Feather name="clock" size={30} color={GREEN} />
              </View>
              <View style={[s.gHeroIcon, s.gHeroSide]}>
                <Feather name="check" size={22} color={tone("#000")} />
              </View>
            </View>
            <Text style={s.gEmptyTitle}>No checks yet</Text>
            <Text style={s.gEmptyBody}>Every diagnosis you finish is saved here by date, so you can see what happened to each gadget.</Text>
            <Pressable onPress={onDiagnose} style={[s.welcomeBtn, s.gEmptyBtn]} accessibilityRole="button">
              <Feather name="search" size={19} color={GREEN} />
              <Text style={s.welcomeBtnText}>Start a diagnosis</Text>
            </Pressable>
          </View>
        ) : (
          <>
            {filterGadgets.length > 1 && (
              <ScrollView horizontal showsHorizontalScrollIndicator={false} style={[s.gFilters, s.hxFilters]} contentContainerStyle={s.gFilterRow}>
                {[{ id: null as string | null, name: "All gadgets", kind: "" }, ...filterGadgets].map((g) => {
                  const on = only === g.id;
                  return (
                    <Pressable key={g.id ?? "all"} onPress={() => filter(g.id)} style={[s.gChip, s.hxChip, on && s.filterOn]} accessibilityState={{ selected: on }}>
                      {g.kind ? <Feather name={kindIcon(g.kind)} size={15} color={on ? tone("#fff") : tone("#000")} /> : null}
                      <Text style={[s.gChipText, on && s.tagTextLight]} numberOfLines={1}>
                        {g.name}
                      </Text>
                    </Pressable>
                  );
                })}
              </ScrollView>
            )}

            <View style={s.hCal}>
              <View style={s.hMonthRow}>
                <Text style={s.hMonth}>
                  {MONTHS[view.m]} <Text style={s.hxYear}>{view.y}</Text>
                </Text>
                <Pressable onPress={() => move(-1)} style={s.hxNav} hitSlop={6} accessibilityLabel="Previous month">
                  <Feather name="chevron-left" size={18} color={tone("#000")} />
                </Pressable>
                <Pressable onPress={() => move(1)} style={s.hxNav} hitSlop={6} accessibilityLabel="Next month">
                  <Feather name="chevron-right" size={18} color={tone("#000")} />
                </Pressable>
              </View>

              <View style={s.hWeek}>
                {WEEKDAYS.map((w, i) => (
                  <Text key={i} style={[s.hCell, s.hWeekday]}>
                    {w}
                  </Text>
                ))}
              </View>
              {weeks.map((week, wi) => (
                <View key={wi} style={s.hWeek}>
                  {week.map((d, i) => {
                    if (d === null) return <View key={i} style={s.hCell} />;
                    const status = byDay.get(d);
                    const selected = d === day;
                    const isToday = ymd(view.y, view.m, d) === today;
                    return (
                      <Pressable
                        key={i}
                        onPress={() => {
                          setDay(selected ? null : d);
                          setOpen(null);
                        }}
                        style={s.hCell}
                        accessibilityLabel={`${MONTHS[view.m]} ${d}${status ? `, ${STATUS_BADGE[status].label}` : ""}`}
                        accessibilityState={{ selected }}
                      >
                        <View style={[s.hDay, isToday && s.hToday, selected && s.hSelected]}>
                          <Text style={[s.hDayText, status ? s.hxDayBusy : s.hxDayQuiet, isToday && s.hxDayBusy, selected && s.tagTextLight]}>{d}</Text>
                        </View>
                        {status && (
                          <View style={s.hDayDot}>
                            <StatusDot status={status} />
                          </View>
                        )}
                      </Pressable>
                    );
                  })}
                </View>
              ))}

              {/* The month in numbers; each dot is the calendar's key for that status. */}
              <View style={s.hxLegend}>
                {(Object.keys(STATUS_BADGE) as CheckStatus[]).map((st) => (
                  <View key={st} style={s.hxLegendItem}>
                    <StatusDot status={st} />
                    <Text style={s.hxLegendNum}>{count(st)}</Text>
                    <Text style={s.hxLegendText} numberOfLines={1}>
                      {STATUS_BADGE[st].label.toLowerCase()}
                    </Text>
                  </View>
                ))}
              </View>
            </View>

            {day !== null && (
              <Pressable onPress={() => setDay(null)} style={s.hxDayChip} accessibilityRole="button" accessibilityLabel="Show the whole month">
                <Text style={s.hxDayChipText}>
                  {MONTHS[view.m].slice(0, 3)} {day}
                </Text>
                <Feather name="x" size={14} color={tone("#fff")} />
              </Pressable>
            )}

            {groups.map((grp) => (
              <View key={grp.date}>
                <View style={s.hxDayHead}>
                  <Text style={s.monoLabel}>{dayLabel(grp.date).toUpperCase()}</Text>
                  <Text style={s.monoLabel}>
                    {grp.items.length} CHECK{grp.items.length === 1 ? "" : "S"}
                  </Text>
                </View>
                {grp.items.map((c) => {
                  const b = STATUS_BADGE[c.status];
                  const g = gadgets.find((x) => x.id === c.gadget);
                  const isOpen = open === c.id;
                  return (
                    <Pressable key={c.id} onPress={() => toggle(c.id)} style={s.hxEntry} accessibilityRole="button" accessibilityState={{ expanded: isOpen }}>
                      <View style={s.gTop}>
                        <View style={[s.hxBadge, { backgroundColor: surface(b.bg) }]}>
                          <Feather name={b.icon} size={18} color={tone(b.fg)} />
                        </View>
                        <View style={s.gText}>
                          <View style={s.hxTitleRow}>
                            <Text style={[s.hxTitle, s.flex]} numberOfLines={2}>
                              {c.title}
                            </Text>
                            <Feather name={isOpen ? "chevron-up" : "chevron-down"} size={18} color={tone("rgba(0,0,0,0.35)")} />
                          </View>
                          <Text style={s.hxDetail} numberOfLines={2}>
                            {c.detail}
                          </Text>
                        </View>
                      </View>
                      <View style={s.hxFoot}>
                        <View style={s.hxMeta}>
                          <Feather name={g ? kindIcon(g.kind) : "help-circle"} size={14} color={tone("rgba(0,0,0,0.45)")} />
                          <Text style={s.hxMetaText} numberOfLines={1}>
                            {g ? g.name : c.gadget ? "Removed gadget" : "Unassigned device"}
                          </Text>
                        </View>
                        <View style={[s.hxPill, { backgroundColor: surface(b.bg) }]}>
                          <Text style={[s.hxPillText, { color: tone(b.fg) }]}>{b.label}</Text>
                        </View>
                      </View>
                      {isOpen && (
                        <View style={s.hxActions}>
                          {c.status !== "fixed" && (
                            <Pressable
                              onPress={() => {
                                onChange(history.map((x) => (x.id === c.id ? { ...x, status: "fixed" } : x)));
                                setOpen(null);
                              }}
                              style={[s.welcomeBtn, s.hxAction]}
                              accessibilityRole="button"
                            >
                              <Feather name="check" size={17} color={GREEN} />
                              <Text style={s.welcomeBtnText}>Mark as fixed</Text>
                            </Pressable>
                          )}
                          {/* Two taps instead of a dialog: Alert has no buttons on web. */}
                          <Pressable
                            onPress={() => {
                              if (!confirm) return setConfirm(true);
                              onChange(history.filter((x) => x.id !== c.id));
                              setOpen(null);
                              setConfirm(false);
                            }}
                            style={[s.gRemove, s.hxAction, s.hxRemove]}
                            accessibilityRole="button"
                          >
                            <Feather name="trash-2" size={17} color="#dc2626" />
                            <Text style={s.gRemoveText}>{confirm ? "Tap again" : "Remove"}</Text>
                          </Pressable>
                        </View>
                      )}
                    </Pressable>
                  );
                })}
              </View>
            ))}

            {!shown.length && (
              <View style={s.hxNone}>
                <Text style={[s.msgText, s.dim]}>
                  No checks {day !== null ? "on this day" : `in ${MONTHS[view.m]}`}.
                </Text>
                {day === null && checks.length > 0 && (
                  <Pressable onPress={() => goTo(monthOf(checks[0].date))} hitSlop={8} accessibilityRole="button">
                    <Text style={s.hxShowAll}>Jump to latest</Text>
                  </Pressable>
                )}
              </View>
            )}
          </>
        )}
      </ScrollView>
    </View>
  );
}

// New-account questions: one per screen, with the repair guide's progress bar. Every answer is optional
// (Skip) and can be changed later in Profile. Skill and gadgets are passed to the AI with each diagnosis.
const SETUP_KEY = "setup";
const DEVICE_KINDS: { label: string; icon: FeatherName }[] = [
  { label: "Phone", icon: "smartphone" },
  { label: "Laptop", icon: "monitor" },
  { label: "Tablet", icon: "tablet" },
  { label: "Desktop PC", icon: "cpu" },
  { label: "Smartwatch", icon: "watch" },
  { label: "Headphones", icon: "headphones" },
  { label: "TV", icon: "tv" },
  { label: "Speaker", icon: "speaker" },
];
const SKILLS = [
  { label: "New to this", detail: "Keep it simple and careful, please." },
  { label: "I've fixed a few things", detail: "I can handle a screwdriver." },
  { label: "I'm comfortable with tools", detail: "Give me the technical details." },
];
type SetupAnswers = Pick<Settings, "name" | "devices" | "skill" | "region" | "language">;
const SETUP_STEPS: { title: string; sub: string }[] = [
  { title: "What should we call you?", sub: "We'll greet you by your first name." },
  { title: "Which gadgets do you use?", sub: "Pick all that apply. It helps FixByte AI recognise your devices." },
  { title: "How handy are you with repairs?", sub: "Your repair guides will match your experience." },
  { title: "Where are you based?", sub: "Used to find repair shops when your location is off." },
  { title: "Which language should FixByte AI reply in?", sub: "The app's buttons stay in English." },
];

function Setup({ settings, onFinish }: { settings: Settings; onFinish: (answers: Partial<SetupAnswers>) => void }) {
  const [step, setStep] = useState(0);
  const [a, setA] = useState<SetupAnswers>({
    name: settings.name,
    devices: settings.devices,
    skill: settings.skill,
    region: settings.region,
    language: settings.language,
  });
  const last = step === SETUP_STEPS.length - 1;
  const next = () => (last ? onFinish({ ...a, name: a.name.trim() }) : setStep(step + 1));
  const set = (patch: Partial<SetupAnswers>) => setA((cur) => ({ ...cur, ...patch }));
  const { title, sub } = SETUP_STEPS[step];

  return (
    <KeyboardAvoidingView style={s.flex} behavior="padding">
      <View style={s.header}>
        {step > 0 ? (
          <Pressable onPress={() => setStep(step - 1)} style={s.circle} accessibilityLabel="Previous question">
            <Feather name="arrow-left" size={20} color={tone("#000")} />
          </Pressable>
        ) : (
          <View style={s.headerSpacer} />
        )}
        <Text style={s.title}>Get set up</Text>
        <Pressable onPress={next} style={s.stepCount} accessibilityRole="button" accessibilityLabel={last ? "Skip and finish" : "Skip this question"}>
          <Text style={s.stepCountText}>Skip</Text>
        </Pressable>
      </View>
      <View style={s.segments}>
        {SETUP_STEPS.map((_, i) => (
          <Segment key={i} state={i < step ? "done" : i === step ? "now" : "next"} />
        ))}
      </View>

      {/* Keyed by step so each question starts scrolled to the top. */}
      <ScrollView key={step} style={s.flex} contentContainerStyle={s.setup} keyboardShouldPersistTaps="handled">
        <Text style={s.monoLabel}>
          QUESTION {step + 1} OF {SETUP_STEPS.length}
        </Text>
        <Text style={s.setupTitle}>{title}</Text>
        <Text style={s.setupSub}>{sub}</Text>

        {step === 0 && (
          <TextInput
            value={a.name}
            onChangeText={(name) => set({ name })}
            placeholder="Your name"
            placeholderTextColor={tone("rgba(0,0,0,0.2)")}
            autoComplete="name"
            textContentType="name"
            autoFocus
            returnKeyType="next"
            onSubmitEditing={next}
            accessibilityLabel="Your name"
            style={[s.authInput, s.setupInput]}
          />
        )}

        {step === 1 && (
          <View style={s.setupGrid}>
            {DEVICE_KINDS.map((d) => {
              const on = a.devices.includes(d.label);
              return (
                <Pressable
                  key={d.label}
                  onPress={() => set({ devices: on ? a.devices.filter((x) => x !== d.label) : [...a.devices, d.label] })}
                  style={[s.setupTile, on && s.setupOn]}
                  accessibilityRole="checkbox"
                  accessibilityState={{ checked: on }}
                >
                  <Feather name={d.icon} size={24} color={on ? tone("#fff") : tone("#000")} />
                  <Text style={[s.setupTileText, on && s.tagTextLight]}>{d.label}</Text>
                </Pressable>
              );
            })}
          </View>
        )}

        {step === 2 &&
          SKILLS.map((k) => {
            const on = a.skill === k.label;
            return (
              <Pressable
                key={k.label}
                onPress={() => set({ skill: k.label })}
                style={[s.setupOption, on && s.setupOn]}
                accessibilityRole="radio"
                accessibilityState={{ checked: on }}
              >
                <View style={s.flex}>
                  <Text style={[s.setupOptionTitle, on && s.tagTextLight]}>{k.label}</Text>
                  <Text style={[s.setupOptionDetail, on && s.setupOptionDetailOn]}>{k.detail}</Text>
                </View>
                {on && <Feather name="check" size={20} color={GREEN} />}
              </Pressable>
            );
          })}

        {(step === 3 || step === 4) && (
          <View style={s.pSettings}>
            {(step === 3 ? REGIONS : LANGUAGES).map((o) => {
              const key = step === 3 ? "region" : "language";
              const on = a[key] === o;
              return (
                <Pressable key={o} onPress={() => set({ [key]: o })} style={s.pRow} accessibilityRole="radio" accessibilityState={{ checked: on }}>
                  <Text style={s.pRowLabel}>{o}</Text>
                  {on && <Feather name="check" size={20} color={tone("#000")} />}
                </Pressable>
              );
            })}
          </View>
        )}
      </ScrollView>

      <View style={s.footer}>
        <Pressable onPress={next} style={s.welcomeBtn} accessibilityRole="button">
          <Text style={s.welcomeBtnText}>{last ? "Finish" : "Continue"}</Text>
        </Pressable>
      </View>
    </KeyboardAvoidingView>
  );
}

// Sign in and Create account: one page with a switch between the two, as in the mockups.
// Accounts are Firebase email/password or Google accounts.
// Until Firebase is configured in .env, the buttons just go to Home, as before.
type AuthMode = "signin" | "register";
const AUTH_TEXT = {
  signin: { title: "Welcome back", sub: "Sign in to check on your gadgets.", button: "Sign in" },
  register: { title: "Create account", sub: "Register a new account to continue", button: "Sign up" },
};

function Auth({ initial, onBack, onDone }: { initial: AuthMode; onBack: () => void; onDone: (created: boolean) => void }) {
  const [mode, setMode] = useState(initial);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [message, setMessage] = useState<{ text: string; error: boolean } | null>(null);
  const [segW, setSegW] = useState(0);
  const slide = useRef(new Animated.Value(initial === "register" ? 1 : 0)).current;
  const register = mode === "register";
  const t = AUTH_TEXT[mode];

  function switchTo(m: AuthMode) {
    setMode(m);
    setMessage(null);
    Animated.timing(slide, { toValue: m === "register" ? 1 : 0, duration: 180, easing: Easing.out(Easing.cubic), useNativeDriver: NATIVE }).start();
  }

  const [busy, setBusy] = useState(false);
  const fail = (e: unknown) => setMessage({ text: typeof e === "string" ? e : authMessage(e), error: true });

  // Success needs nothing more here: the App's Firebase listener sees the new sign-in and opens Home.
  async function submit() {
    setMessage(null);
    if (!firebaseReady) return onDone(register);
    if (register && password !== confirm) return fail("The passwords don't match.");
    setBusy(true);
    try {
      const auth = firebaseAuth();
      if (register) await createUserWithEmailAndPassword(auth, email.trim(), password);
      else await signInWithEmailAndPassword(auth, email.trim(), password);
    } catch (e) {
      fail(e);
      setBusy(false);
    }
  }

  async function forgot() {
    if (!firebaseReady) return setMessage({ text: "Password reset isn't available yet.", error: false });
    if (!email.trim()) return fail("Type your email above first.");
    try {
      await sendPasswordResetEmail(firebaseAuth(), email.trim());
      setMessage({ text: `Reset link sent to ${email.trim()}. Check your inbox.`, error: false });
    } catch (e) {
      fail(e);
    }
  }

  async function google() {
    setMessage(null);
    if (!firebaseReady) return onDone(false);
    // Phones use a native module: works in the APK, not in Expo Go.
    try {
      await googleSignIn();
    } catch (e) {
      fail(e);
    }
  }

  // The black pill is half the switch's inner width (the switch has 7pt padding on each side).
  const pillW = segW ? (segW - 14) / 2 : 0;
  const pillX = slide.interpolate({ inputRange: [0, 1], outputRange: [0, pillW] });

  return (
    <KeyboardAvoidingView style={s.flex} behavior="padding">
      <View style={s.header}>
        <Pressable onPress={onBack} style={s.circle} accessibilityLabel="Back">
          <Feather name="arrow-left" size={20} color={tone("#000")} />
        </Pressable>
      </View>
      <ScrollView contentContainerStyle={s.auth} keyboardShouldPersistTaps="handled">
        <Text style={s.authTitle}>{t.title}</Text>
        <Text style={s.authSub}>{t.sub}</Text>

        <View style={s.seg} onLayout={(e) => setSegW(e.nativeEvent.layout.width)}>
          {pillW > 0 && <Animated.View style={[s.segPill, { width: pillW, transform: [{ translateX: pillX }] }]} />}
          {(["signin", "register"] as const).map((m) => (
            <Pressable key={m} onPress={() => switchTo(m)} style={s.segItem} accessibilityRole="tab" accessibilityState={{ selected: mode === m }}>
              <Text style={[s.segText, mode === m && s.segTextOn]}>{m === "signin" ? "Sign in" : "Create account"}</Text>
            </Pressable>
          ))}
        </View>

        <Field
          label="Email"
          value={email}
          onChangeText={setEmail}
          placeholder="contact@khyelcalanuga.dev"
          keyboardType="email-address"
          autoCapitalize="none"
          autoComplete="email"
          textContentType="emailAddress"
        />
        <Field
          label="Password"
          value={password}
          onChangeText={setPassword}
          placeholder="Enter your password"
          secureTextEntry
          autoComplete={register ? "new-password" : "current-password"}
          textContentType={register ? "newPassword" : "password"}
          onSubmitEditing={register ? undefined : submit}
        />
        {register ? (
          <Field
            label="Confirm Password"
            value={confirm}
            onChangeText={setConfirm}
            placeholder="Confirm your password"
            secureTextEntry
            autoComplete="new-password"
            textContentType="newPassword"
            onSubmitEditing={submit}
          />
        ) : (
          <Pressable onPress={forgot} style={s.forgot} hitSlop={8}>
            <Text style={s.forgotText}>Forgot Password?</Text>
          </Pressable>
        )}

        {message && <Text style={message.error ? s.error : s.authNote}>{message.text}</Text>}
        <Pressable onPress={submit} disabled={busy} style={[s.welcomeBtn, s.authBtn, busy && s.disabled]} accessibilityRole="button">
          <Text style={s.welcomeBtnText}>{busy ? (register ? "Creating account…" : "Signing in…") : t.button}</Text>
        </Pressable>

        <View style={s.divider}>
          <View style={s.dividerLine} />
          <Text style={s.dividerText}>or</Text>
          <View style={s.dividerLine} />
        </View>
        <Pressable onPress={google} disabled={busy} style={s.googleBtn} accessibilityRole="button" accessibilityLabel="Continue with Google">
          <GoogleG />
          <Text style={s.googleText}>Google</Text>
        </Pressable>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

// Password fields (secureTextEntry) get an eye button to show or hide what's typed.
function Field({ label, secureTextEntry, ...props }: { label: string } & ComponentProps<typeof TextInput>) {
  const [shown, setShown] = useState(false);
  const input = (
    <TextInput
      placeholderTextColor={tone("rgba(0,0,0,0.2)")}
      accessibilityLabel={label}
      secureTextEntry={secureTextEntry && !shown}
      style={[s.authInput, secureTextEntry && s.authInputSecret]}
      {...props}
    />
  );
  return (
    <>
      <Text style={s.authLabel}>{label}</Text>
      {secureTextEntry ? (
        <View>
          {input}
          <Pressable
            onPress={() => setShown((v) => !v)}
            style={s.eye}
            hitSlop={8}
            accessibilityRole="button"
            accessibilityLabel={shown ? "Hide password" : "Show password"}
          >
            <Feather name={shown ? "eye-off" : "eye"} size={18} color={tone("rgba(0,0,0,0.45)")} />
          </Pressable>
        </View>
      ) : (
        input
      )}
    </>
  );
}

// Google's four-colour "G".
function GoogleG() {
  return (
    <Svg width={24} height={24} viewBox="0 0 48 48">
      <Path fill="#FFC107" d="M43.611 20.083H42V20H24v8h11.303c-1.649 4.657-6.08 8-11.303 8-6.627 0-12-5.373-12-12s5.373-12 12-12c3.059 0 5.842 1.154 7.961 3.039l5.657-5.657C34.046 6.053 29.268 4 24 4 12.955 4 4 12.955 4 24s8.955 20 20 20 20-8.955 20-20c0-1.341-.138-2.65-.389-3.917z" />
      <Path fill="#FF3D00" d="M6.306 14.691l6.571 4.819C14.655 15.108 18.961 12 24 12c3.059 0 5.842 1.154 7.961 3.039l5.657-5.657C34.046 6.053 29.268 4 24 4 16.318 4 9.656 8.337 6.306 14.691z" />
      <Path fill="#4CAF50" d="M24 44c5.166 0 9.86-1.977 13.409-5.192l-6.19-5.238A11.91 11.91 0 0 1 24 36c-5.202 0-9.619-3.317-11.283-7.946l-6.522 5.025C9.505 39.556 16.227 44 24 44z" />
      <Path fill="#1976D2" d="M43.611 20.083H42V20H24v8h11.303a12.04 12.04 0 0 1-4.087 5.571l.003-.002 6.19 5.238C36.971 39.205 44 34 44 24c0-1.341-.138-2.65-.389-3.917z" />
    </Svg>
  );
}

// FixByte mark: a tall bar beside a small block stacked over a "D" (flat left, half-round right).
function Logo() {
  return (
    <View style={s.logo} accessibilityLabel="FixByte AI">
      <View style={s.logoBar} />
      <View style={s.logoCol}>
        <View style={s.logoTop} />
        <View style={s.logoD} />
      </View>
    </View>
  );
}

type Shop = {
  id: string;
  name: string;
  lat: number;
  lng: number;
  km: number;
  openNow?: boolean; // undefined when OpenStreetMap has no (readable) opening hours
  closes?: string; // ISO times worked out from the shop's opening hours
  opens?: string;
  phone?: string;
};
type Point = { lat: number; lng: number };

// "8 PM", "8:30 PM", or "Tue 9 AM" when it isn't today.
function clock(iso: string) {
  const d = new Date(iso);
  const t = d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }).replace(":00", "");
  return d.toDateString() === new Date().toDateString() ? t : `${d.toLocaleDateString([], { weekday: "short" })} ${t}`;
}

function hours(shop: Shop) {
  if (shop.openNow === undefined) return "Hours not listed";
  if (shop.openNow) return shop.closes ? `Open until ${clock(shop.closes)}` : "Open now";
  return shop.opens ? `Opens ${clock(shop.opens)}` : "Closed";
}

// In-app directions from OpenStreetMap's free routing service (FOSSGIS): no key, but meant for light use.
type Mode = "car" | "foot";
type Step = { text: string; m: number; icon: FeatherName };
type Route = { shopId: string; mode: Mode; line: Point[]; m: number; min: number; steps: Step[] };
type OsrmStep = { name: string; distance: number; maneuver: { type: string; modifier?: string; exit?: number } };

const TURNS: Record<string, [string, FeatherName]> = {
  left: ["Turn left", "corner-up-left"],
  right: ["Turn right", "corner-up-right"],
  "sharp left": ["Turn sharp left", "corner-up-left"],
  "sharp right": ["Turn sharp right", "corner-up-right"],
  "slight left": ["Keep left", "corner-up-left"],
  "slight right": ["Keep right", "corner-up-right"],
  uturn: ["Make a U-turn", "rotate-ccw"],
  straight: ["Continue", "arrow-up"],
};

function step({ name, distance, maneuver: { type, modifier, exit } }: OsrmStep, shop: string): Step {
  const onto = name ? ` onto ${name}` : "";
  if (type === "depart") return { text: `Start${name ? ` on ${name}` : ""}`, m: distance, icon: "navigation" };
  if (type === "arrive") return { text: `Arrive at ${shop}`, m: 0, icon: "flag" };
  if (type.includes("roundabout") || type === "rotary") {
    return { text: `At the roundabout, take ${exit ? `exit ${exit}` : "the exit"}${onto}`, m: distance, icon: "rotate-cw" };
  }
  const [verb, icon] = (type !== "new name" && TURNS[modifier ?? ""]) || TURNS.straight;
  return { text: verb + onto, m: distance, icon };
}

async function directions(from: Point, shop: Shop, mode: Mode): Promise<Route> {
  const r = await fetch(
    `https://routing.openstreetmap.de/routed-${mode}/route/v1/driving/${from.lng},${from.lat};${shop.lng},${shop.lat}?overview=full&geometries=geojson&steps=true`,
  );
  if (!r.ok) throw new Error("Directions are busy right now. Try again in a moment.");
  const route = (await r.json()).routes?.[0];
  if (!route) throw new Error("No route found to this shop.");
  return {
    shopId: shop.id,
    mode,
    line: route.geometry.coordinates.map(([lng, lat]: number[]) => ({ lat, lng })),
    m: route.distance,
    min: Math.max(1, Math.round(route.duration / 60)),
    steps: route.legs[0].steps.map((st: OsrmStep) => step(st, shop.name)),
  };
}

const meters = (m: number) => (m < 1000 ? `${Math.round(m / 10) * 10} M` : `${(m / 1000).toFixed(1)} KM`);

const TILE = 256; // map tile size in points
const MAX_ZOOM = 16; // closest zoom Esri's light gray tiles have

// Web Mercator position in world pixels at a zoom level (how map tiles are laid out).
function world({ lat, lng }: Point, zoom: number) {
  const size = TILE * 2 ** zoom;
  const sin = Math.sin((lat * Math.PI) / 180);
  return { x: ((lng + 180) / 360) * size, y: (0.5 - Math.log((1 + sin) / (1 - sin)) / (4 * Math.PI)) * size };
}

// Free map: Esri's light gray tiles laid out by hand, with numbered shop pins (CARTO's free tiles now need a key).
// No native map package or API key; the attribution is required by the tiles' terms.
function TileMap({ you, center, shops, route, onDrag }: { you?: Point; center: Point; shops: Shop[]; route?: Point[]; onDrag: (on: boolean) => void }) {
  const [w, setW] = useState(0);
  // Where the user has dragged/zoomed to (center in world pixels); null = fit the pins or route.
  const [view, setView] = useState<{ zoom: number; x: number; y: number } | null>(null);
  const h = 231;
  const points = route ? [...route] : [...shops, ...(you ? [you] : [])]; // with a route, zoom to fit just the route
  if (!points.length) points.push(center);

  // Closest zoom (up to street level) that still fits every pin with some padding.
  let fit = MAX_ZOOM;
  for (; fit > 3; fit--) {
    const ps = points.map((p) => world(p, fit));
    const xs = ps.map((p) => p.x);
    const ys = ps.map((p) => p.y);
    if (Math.max(...xs) - Math.min(...xs) <= w - 60 && Math.max(...ys) - Math.min(...ys) <= h - 60) break;
  }
  const ps = points.map((p) => world(p, fit));
  const zoom = view?.zoom ?? fit;
  const cx = view?.x ?? (Math.min(...ps.map((p) => p.x)) + Math.max(...ps.map((p) => p.x))) / 2;
  const cy = view?.y ?? (Math.min(...ps.map((p) => p.y)) + Math.max(...ps.map((p) => p.y))) / 2;
  const left = cx - w / 2;
  const top = cy - h / 2;

  // New pins or a new route re-fit the map.
  const fitKey = `${shops.map((sh) => sh.id).join()}|${route?.length}`;
  useEffect(() => setView(null), [fitKey]);

  // Drag to pan. The responder is created once, so it reads the current view through a ref.
  const cur = useRef({ zoom, x: cx, y: cy });
  cur.current = { zoom, x: cx, y: cy };
  const start = useRef(cur.current);
  const pan = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onPanResponderTerminationRequest: () => false, // keep the page from scrolling mid-drag
      onPanResponderGrant: () => {
        start.current = cur.current;
        onDrag(true); // the page stops scrolling while the map is dragged
      },
      onPanResponderRelease: () => onDrag(false),
      onPanResponderTerminate: () => onDrag(false),
      onPanResponderMove: (_, g) => setView({ zoom: start.current.zoom, x: start.current.x - g.dx, y: start.current.y - g.dy }),
    }),
  ).current;
  const zoomBy = (d: number) => {
    const z = Math.min(MAX_ZOOM, Math.max(3, zoom + d));
    setView({ zoom: z, x: cx * 2 ** (z - zoom), y: cy * 2 ** (z - zoom) }); // keep the same spot in the middle
  };

  const tiles: { x: number; y: number }[] = [];
  if (w) {
    for (let x = Math.floor(left / TILE); x <= Math.floor((left + w) / TILE); x++)
      for (let y = Math.floor(top / TILE); y <= Math.floor((top + h) / TILE); y++) tiles.push({ x, y });
  }
  const at = (p: Point, size: number) => {
    const q = world(p, zoom);
    return { left: q.x - left - size / 2, top: q.y - top - size / 2 };
  };
  const line = route?.map((p) => at(p, 0)).map((q) => `${q.left},${q.top}`).join(" ");

  return (
    <View
      // Web-only style (missing from RN's types): touch drags on the map pan it instead of scrolling the page.
      style={[s.map, Platform.OS === "web" && ({ touchAction: "none" } as {})]}
      onLayout={(e) => setW(e.nativeEvent.layout.width)}
      accessibilityLabel="Map of nearby repair shops"
      {...pan.panHandlers}
    >
      {tiles.map(({ x, y }) => (
        <Image
          key={`${zoom}/${x}/${y}`}
          source={{ uri: `https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_${DARK ? "Dark" : "Light"}_Gray_Base/MapServer/tile/${zoom}/${y}/${x}` }}
          style={[s.tile, { left: x * TILE - left, top: y * TILE - top }]}
        />
      ))}
      {w > 0 && line && (
        // A white casing under the black line keeps it readable over streets.
        <Svg width={w} height={h} style={s.routeLine} pointerEvents="none">
          <Polyline points={line} fill="none" stroke={tone("#fff")} strokeWidth={8} strokeLinejoin="round" strokeLinecap="round" />
          <Polyline points={line} fill="none" stroke={tone("#000")} strokeWidth={4} strokeLinejoin="round" strokeLinecap="round" />
        </Svg>
      )}
      {w > 0 && you && <View style={[s.youDot, at(you, 14)]} />}
      {w > 0 &&
        shops.map((shop, i) => (
          <View key={shop.id} style={[s.pin, at(shop, 26)]}>
            <Text style={s.pinText}>{i + 1}</Text>
          </View>
        ))}
      <View style={s.mapControls}>
        <Pressable onPress={() => zoomBy(1)} disabled={zoom >= MAX_ZOOM} style={s.mapBtn} accessibilityLabel="Zoom in">
          <Feather name="plus" size={16} color={tone("#000")} />
        </Pressable>
        <Pressable onPress={() => zoomBy(-1)} disabled={zoom <= 3} style={s.mapBtn} accessibilityLabel="Zoom out">
          <Feather name="minus" size={16} color={tone("#000")} />
        </Pressable>
        {view && (
          <Pressable onPress={() => setView(null)} style={s.mapBtn} accessibilityLabel="Re-center map">
            <Feather name="crosshair" size={16} color={tone("#000")} />
          </Pressable>
        )}
      </View>
      <Text style={s.attribution}>Powered by Esri · © OpenStreetMap</Text>
    </View>
  );
}

const NEEDS = { "Pro repair": "Needs a pro", "Some skill": "Some skill", "Beginner-safe": "Beginner-safe" } as const;

function Shops({ t, region, onBack, onGadgets }: { t: Extract<Turn, { role: "assistant" }>; region: string; onBack: () => void; onGadgets: () => void }) {
  const d = t.diagnosis!;
  const [loc, setLoc] = useState<Point | null>(null);
  const [area, setArea] = useState<{ city?: string; region?: string }>({});
  const [nearText, setNearText] = useState(""); // what's typed in the location field
  const [near, setNear] = useState(""); // submitted: search there instead of around the user
  const [openNow, setOpenNow] = useState(true);
  const [service, setService] = useState<string | null>(null);
  const [data, setData] = useState<{ shops: Shop[]; center: Point } | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [expanded, setExpanded] = useState(0);
  const [route, setRoute] = useState<Route | null>(null);
  const [routing, setRouting] = useState(false);
  const [routeError, setRouteError] = useState("");
  const [dragging, setDragging] = useState(false);
  const scroll = useRef<ComponentRef<typeof ScrollView>>(null);

  async function go(shop: Shop, mode: Mode) {
    setRouteError("");
    if (!loc) return setRouteError("Directions need your location. Turn location on and reopen this page.");
    setRouting(true);
    try {
      setRoute(await directions(loc, shop, mode));
      scroll.current?.scrollTo({ y: 0, animated: true }); // bring the map with the route into view
    } catch (e) {
      setRouteError(e instanceof Error ? e.message : String(e));
    } finally {
      setRouting(false);
    }
  }

  useEffect(() => {
    (async () => {
      try {
        const perm = await Location.requestForegroundPermissionsAsync();
        if (!perm.granted) throw new Error("Location is off.");
        // A recent last-known position is instant; a fresh GPS fix can take several seconds on a phone.
        const p =
          (await Location.getLastKnownPositionAsync({ maxAge: 10 * 60_000 }).catch(() => null)) ??
          (await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced }));
        setLoc({ lat: p.coords.latitude, lng: p.coords.longitude });
        // City and region names for the labels; reverse geocoding isn't available on web, so they're optional.
        Location.reverseGeocodeAsync(p.coords)
          .then(([a]) => setArea({ city: a?.city ?? a?.subregion ?? undefined, region: a?.region ?? undefined }))
          .catch(() => {});
      } catch {
        setNear(region); // no location: search the region from Profile instead (another city can be typed above)
      }
    })();
  }, []);

  useEffect(() => {
    if (!loc && !near) return;
    let live = true; // ignore a slower, older search finishing after a newer one
    setLoading(true);
    setError("");
    apiFetch("/api/shops", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        services: service ? [service] : (d.shopServices ?? []),
        lat: loc?.lat,
        lng: loc?.lng,
        near: near || undefined,
        openNow,
      }),
    })
      .then(async (r) => {
        const j = await r.json();
        if (!r.ok) throw new Error(j.error);
        if (live) {
          setData(j);
          setExpanded(0);
          setRoute(null);
        }
      })
      .catch((e) => live && setError(e instanceof Error ? e.message : String(e)))
      .finally(() => live && setLoading(false));
    return () => {
      live = false;
    };
  }, [loc, near, openNow, service, d.shopServices]);

  const shops = data?.shops ?? [];
  const where = near || area.region;
  const icon = DEVICE_ICONS[t.deviceType ?? ""] ?? "cpu";

  return (
    <View style={s.flex}>
      <View style={s.header}>
        <Pressable onPress={onBack} style={s.circle} accessibilityLabel="Back to diagnosis">
          <Feather name="arrow-left" size={20} color={tone("#000")} />
        </Pressable>
        <Text style={s.title}>Repair Shops</Text>
        <Pressable onPress={onGadgets} style={s.circle} accessibilityLabel="My gadgets" accessibilityRole="button">
          <Feather name={icon} size={20} color={tone("#000")} />
        </Pressable>
      </View>

      <ScrollView ref={scroll} style={s.flex} contentContainerStyle={s.result} keyboardShouldPersistTaps="handled" scrollEnabled={!dragging}>
        <View style={s.caseCard}>
          <Feather name={icon} size={24} color={tone("#fff")} />
          <Text style={s.caseText} numberOfLines={2}>
            {t.device && <Text style={s.caseDevice}>{t.device} · </Text>}
            {d.summary}
          </Text>
          <View style={s.casePill}>
            <Text style={s.casePillText}>{NEEDS[d.difficulty] ?? d.difficulty}</Text>
          </View>
        </View>

        <View style={s.nearBox}>
          <Feather name="map-pin" size={17} color={tone("#000")} />
          <TextInput
            value={nearText}
            onChangeText={setNearText}
            onSubmitEditing={() => setNear(nearText.trim())}
            placeholder={area.city ? `Near ${area.city}` : "Near you"}
            placeholderTextColor={tone("rgba(0,0,0,0.2)")}
            returnKeyType="search"
            accessibilityLabel="Search near a place"
            style={s.nearInput}
          />
        </View>

        {/* Shown around the user while shops load, so the layout doesn't jump when they arrive. */}
        {(data || loc) && <TileMap you={near ? undefined : (loc ?? undefined)} center={data?.center ?? loc!} shops={shops} route={route?.line} onDrag={setDragging} />}

        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={s.filters} contentContainerStyle={s.filterRow}>
          <Pressable onPress={() => setOpenNow((v) => !v)} style={[s.filter, openNow && s.filterOn]} accessibilityState={{ selected: openNow }}>
            <Text style={[s.filterText, openNow && s.tagTextLight]}>Open now</Text>
          </Pressable>
          {(d.shopServices ?? []).map((sv) => {
            const on = service === sv;
            return (
              <Pressable key={sv} onPress={() => setService(on ? null : sv)} style={[s.filter, on && s.filterOn]} accessibilityState={{ selected: on }}>
                <Text style={[s.filterText, on && s.tagTextLight]}>{sv}</Text>
              </Pressable>
            );
          })}
        </ScrollView>

        <Text style={[s.monoLabel, s.shopCount]}>
          {loading ? "FINDING SHOPS…" : `${shops.length} SHOP${shops.length === 1 ? "" : "S"} NEARBY${where ? ` · ${where.toUpperCase()}` : ""}`}
        </Text>
        {!!error && <Text style={s.error}>{error}</Text>}
        {!loading && !error && shops.length === 0 && (
          <Text style={[s.msgText, s.dim]}>No shops found. Try turning off "Open now" or picking another service.</Text>
        )}

        {shops.map((shop, i) => {
          const open = i === expanded;
          const dist = shop.km != null ? `${shop.km.toFixed(1)} KM` : "";
          return (
            <Pressable
              key={shop.id}
              onPress={() => {
                setExpanded(i);
                setRoute(null);
                setRouteError("");
              }}
              disabled={open}
              style={s.shopCard}
            >
              <View style={s.shopRow}>
                <View style={[s.rank, open && s.rankOn]}>
                  <Text style={[s.rankText, !open && s.tagTextLight]}>{i + 1}</Text>
                </View>
                <Text style={s.shopName} numberOfLines={open ? 2 : 1}>
                  {shop.name}
                </Text>
                <Text style={s.shopDist}>{open ? dist : `${dist} >`.trim()}</Text>
              </View>
              {open && (
                <>
                  {/* OpenStreetMap has no ratings, so this row is just the hours. */}
                  <View style={s.shopRow}>
                    <Feather name="clock" size={15} color={tone("rgba(0,0,0,0.5)")} />
                    <Text style={s.shopHours}>{hours(shop)}</Text>
                  </View>
                  {route?.shopId === shop.id ? (
                    <>
                      <View style={s.shopRow}>
                        <Text style={s.routeTime}>{route.min} min</Text>
                        <Text style={[s.shopDist, s.flex]}>{meters(route.m)}</Text>
                        {(["car", "foot"] as const).map((mode) => (
                          <Pressable
                            key={mode}
                            onPress={() => mode !== route.mode && go(shop, mode)}
                            disabled={routing}
                            style={[s.filter, s.modeChip, route.mode === mode && s.filterOn]}
                            accessibilityState={{ selected: route.mode === mode }}
                          >
                            <Text style={[s.filterText, route.mode === mode && s.tagTextLight]}>{mode === "car" ? "Drive" : "Walk"}</Text>
                          </Pressable>
                        ))}
                        <Pressable onPress={() => setRoute(null)} style={[s.circle, s.callBtn, s.modeChip]} accessibilityLabel="Close directions">
                          <Feather name="x" size={16} color={tone("#000")} />
                        </Pressable>
                      </View>
                      <View style={s.routeSteps}>
                        {route.steps.map((st, k) => (
                          <View key={k} style={s.shopRow}>
                            <View style={s.turnIcon}>
                              <Feather name={st.icon} size={15} color={tone("#000")} />
                            </View>
                            <Text style={s.shopHours}>{st.text}</Text>
                            {st.m > 0 && <Text style={s.shopDist}>{meters(st.m)}</Text>}
                          </View>
                        ))}
                      </View>
                    </>
                  ) : (
                  <View style={s.actions}>
                    <Pressable onPress={() => go(shop, "car")} disabled={routing} style={[s.guideBtn, s.shopBtn]}>
                      <Text style={s.shopText}>{routing ? "Finding route…" : "Get directions"}</Text>
                    </Pressable>
                    <Pressable
                      onPress={() => shop.phone && Linking.openURL(`tel:${shop.phone.replace(/[^\d+]/g, "")}`)}
                      disabled={!shop.phone}
                      style={[s.circle, s.bigCircle, s.callBtn, !shop.phone && s.disabled]}
                      accessibilityLabel={shop.phone ? `Call ${shop.name}` : "No phone number listed"}
                    >
                      <Feather name="phone" size={20} color={tone("#000")} />
                    </Pressable>
                  </View>
                  )}
                  {!!routeError && <Text style={s.error}>{routeError}</Text>}
                </>
              )}
            </Pressable>
          );
        })}
      </ScrollView>
    </View>
  );
}

// Keep the allowance secondary to the composer, with one segment per diagnosis left.
function Usage({ used, error, upgrade }: { used: number | null; error: boolean; upgrade?: boolean }) {
  const [showUpgradeInfo, setShowUpgradeInfo] = useState(false);
  const left = used === null ? 0 : Math.max(0, DAILY_LIMIT - used);
  const ready = !error && used !== null;
  const label = error ? "Daily allowance unavailable. Check your connection." : used === null ? "Syncing daily allowance." : `${left} of ${DAILY_LIMIT} free diagnoses left today.${left === 0 ? " Your allowance renews daily." : ""}`;
  return (
    <View style={s.usage}>
      <View style={s.usageHeading}>
        <View style={s.usageSummary} accessible accessibilityLabel={label} accessibilityLiveRegion="polite">
          <Text style={s.usageTitle}>Today's diagnoses</Text>
          {ready ? (
            <Text style={[s.usageCount, left === 0 && s.usageEmpty]}>
              {left}<Text style={s.usageTotal}> / {DAILY_LIMIT} left</Text>
            </Text>
          ) : (
            <Text style={s.usageTotal}>{error ? "Unavailable" : "Syncing…"}</Text>
          )}
        </View>
        {upgrade && (
          <Pressable
            onPress={() => setShowUpgradeInfo((shown) => !shown)}
            style={s.usageUpgrade}
            accessibilityRole="button"
            accessibilityLabel="Upgrade"
            accessibilityState={{ expanded: showUpgradeInfo }}
            aria-expanded={showUpgradeInfo}
          >
            <Text style={s.usageUpgradeText}>Upgrade</Text>
            <Feather name="arrow-up-right" size={13} color={tone("#000")} />
          </Pressable>
        )}
      </View>
      <View style={s.usageMeter} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
        {Array.from({ length: DAILY_LIMIT }, (_, i) => (
          <View key={i} style={[s.usageSegment, ready && i < left && s.usageSegmentOn]} />
        ))}
      </View>
      {showUpgradeInfo ? (
        <Text style={s.usageNote} accessibilityLiveRegion="polite">Paid plans are coming soon. Your free diagnoses renew daily.</Text>
      ) : ready && left === 0 ? (
        <Text style={s.usageNote}>Your free diagnoses renew daily.</Text>
      ) : null}
    </View>
  );
}

function Bookmark({ saved, big, onPress }: { saved: boolean; big?: boolean; onPress: () => void }) {
  return (
    <Pressable
      onPress={onPress}
      style={[s.saveBtn, big && s.bigSaveBtn, saved && s.savedBtn]}
      accessibilityLabel={saved ? "Remove saved diagnosis" : "Save diagnosis"}
      accessibilityRole="button"
      accessibilityHint="Find saved diagnoses in Previous conversations under Saved."
      accessibilityState={{ selected: saved }}
      aria-pressed={saved}
    >
      <Ionicons name={saved ? "bookmark" : "bookmark-outline"} size={18} color={saved ? tone("#fff") : tone("#000")} />
      <Text style={[s.saveText, saved && s.tagTextLight]}>{saved ? "Saved" : "Save"}</Text>
    </Pressable>
  );
}

// After a diagnosis that matched none of your gadgets: save it to one, add the device as a new gadget, or skip.
function FileCheck({
  device,
  gadgets,
  onPick,
  onAdd,
  onSkip,
}: {
  device?: string;
  gadgets: Gadget[];
  onPick: (g: Gadget) => void;
  onAdd: () => void;
  onSkip: () => void;
}) {
  return (
    <Pop from="left" style={s.fileCard}>
      <Text style={s.fileTitle}>Save to My gadgets?</Text>
      <Text style={s.fileSub}>
        {gadgets.length ? "Which gadget is this? It goes in that gadget's history." : "Keep this check in your gadget's history."}
      </Text>
      {gadgets.map((g) => (
        <Pressable key={g.id} onPress={() => onPick(g)} style={s.fileRow} accessibilityRole="button">
          <View style={s.fileIcon}>
            <Feather name={kindIcon(g.kind)} size={18} color={tone("#000")} />
          </View>
          <Text style={s.fileRowText} numberOfLines={1}>
            {g.name}
          </Text>
          <Feather name="chevron-right" size={18} color={tone("rgba(0,0,0,0.4)")} />
        </Pressable>
      ))}
      <Pressable onPress={onAdd} style={s.fileRow} accessibilityRole="button">
        <View style={[s.fileIcon, s.fileIconAdd]}>
          <Feather name="plus" size={18} color={GREEN} />
        </View>
        <Text style={s.fileRowText} numberOfLines={1}>
          Add {device ? `“${device}”` : "this device"} as a gadget
        </Text>
      </Pressable>
      <Pressable onPress={onSkip} style={s.fileSkip} hitSlop={8} accessibilityRole="button">
        <Text style={s.fileSkipText}>Not now</Text>
      </Pressable>
    </Pop>
  );
}

// After finishing a repair guide: did it work? Yes marks the check Fixed.
function AskFixed({ gadget, onAnswer }: { gadget?: string; onAnswer: (fixed: boolean) => void }) {
  return (
    <Pop from="left" style={s.fileCard}>
      <Text style={s.fileTitle}>Did the repair work?</Text>
      <Text style={s.fileSub}>{gadget ? `We'll mark your ${gadget} as fixed.` : "We'll mark this check as fixed."}</Text>
      <View style={s.gAddActions}>
        <Pressable onPress={() => onAnswer(false)} style={[s.googleBtn, s.fileBtn]} accessibilityRole="button">
          <Text style={s.googleText}>Not yet</Text>
        </Pressable>
        <Pressable onPress={() => onAnswer(true)} style={[s.welcomeBtn, s.fileBtn]} accessibilityRole="button">
          <Feather name="check" size={18} color={GREEN} />
          <Text style={s.welcomeBtnText}>Yes, it's fixed</Text>
        </Pressable>
      </View>
    </Pop>
  );
}

// `top` is a card shown above the verdict: "Save to My gadgets?" or "Did the repair work?".
function Result({ t, onBack, onGadgets, top }: { t: Extract<Turn, { role: "assistant" }>; onBack: () => void; onGadgets: () => void; top?: ReactNode }) {
  const d = t.diagnosis!;
  const cat = TAGS.category[d.category] ?? TAGS.category.Hardware;
  const diff = TAGS.difficulty[d.difficulty] ?? TAGS.difficulty["Some skill"];
  const pro = d.difficulty === "Pro repair";
  const secs = t.seconds ?? 1;
  const meta = [t.device, `Diagnosed in ${secs} second${secs === 1 ? "" : "s"}`].filter(Boolean).join(" · ");
  const confidence = Math.round(Math.min(100, Math.max(0, d.confidence ?? 0)));

  return (
    <>
      <View style={s.header}>
        <Pressable onPress={onBack} style={s.circle} accessibilityLabel="Back to chat">
          <Feather name="arrow-left" size={20} color={tone("#000")} />
        </Pressable>
        <Text style={s.title}>Diagnosis</Text>
        {pro ? (
          <Pressable onPress={onGadgets} style={s.circle} accessibilityLabel="My gadgets" accessibilityRole="button">
            <Feather name={DEVICE_ICONS[t.deviceType ?? ""] ?? "cpu"} size={20} color={tone("#000")} />
          </Pressable>
        ) : (
          <Pressable
            onPress={() => Share.share({ message: `${d.summary}${t.device ? ` (${t.device})` : ""}\n\n${t.text}` })}
            style={s.circle}
            accessibilityLabel="Share diagnosis"
          >
            <Feather name="share" size={20} color={tone("#000")} />
          </Pressable>
        )}
      </View>

      <ScrollView style={s.flex} contentContainerStyle={s.result}>
        {top}
        <View style={s.symptom}>
          <View style={s.symptomDot} />
          <Text style={s.symptomText}>{d.summary}</Text>
        </View>
        <View style={s.metaRow}>
          <Feather name="check-circle" size={15} color={GREEN} />
          <Text style={s.metaText}>{meta.toUpperCase()}</Text>
        </View>

        {pro ? (
          <>
            <View style={s.proCard}>
              <View style={s.proLabelRow}>
                <Feather name="alert-circle" size={22} color={GREEN} />
                <Text style={s.proLabel}>NEEDS A PROFESSIONAL</Text>
              </View>
              <Text style={s.proTitle}>{d.problem}</Text>
              <Text style={s.proWhy}>{d.why}</Text>
              <View style={s.proChips}>
                {[cat.label, d.risk, `${confidence}% match`].map((c) => (
                  <View key={c} style={s.proChip}>
                    <Text style={s.proChipText}>{c}</Text>
                  </View>
                ))}
              </View>
            </View>
            <View style={s.nowCard}>
              <Text style={s.monoLabel}>DO THIS NOW</Text>
              {d.now.map((n, i) => (
                <View key={i} style={s.nowRow}>
                  <Feather name={n.icon as FeatherName} size={17} color={tone("#000")} style={s.nowIcon} />
                  <Text style={s.nowText}>{n.text}</Text>
                </View>
              ))}
            </View>
          </>
        ) : (
          <>
            <Text style={s.verdict}>{d.title}</Text>
            <View style={s.tags}>
              <View style={[s.tag, s.tagBlack]}>
                <Feather name={cat.icon} size={16} color={GREEN} />
                <Text style={[s.tagText, s.tagTextLight]}>{cat.label}</Text>
              </View>
              <View style={[s.tag, s[diff.style]]}>
                <Feather name={diff.icon} size={16} color={diff.style === "tagGreen" ? ON_ACCENT : tone("#000")} />
                <Text style={[s.tagText, diff.style === "tagGreen" && s.onAccent]}>{d.difficulty}</Text>
              </View>
            </View>

            <View style={s.list}>
              {d.causes.map((c, i) => (
                <View key={i} style={s.listRow}>
                  <View style={s.num}>
                    <Text style={s.numText}>{i + 1}</Text>
                  </View>
                  <Text style={s.listText}>
                    <Text style={s.listLead}>{c.name}. </Text>
                    {c.detail}
                  </Text>
                </View>
              ))}
            </View>
          </>
        )}
      </ScrollView>
    </>
  );
}

function minutesLabel(m: number) {
  if (!m || m < 60) return `About ${Math.max(1, Math.round(m || 0))} min`;
  const h = Math.round((m / 60) * 2) / 2; // nearest half hour
  return `About ${h} hr${h === 1 ? "" : "s"}`;
}

function Guide({ d, step, onStep, onClose }: { d: Diagnosis; step: number; onStep: (i: number) => void; onClose: (finished: boolean) => void }) {
  const st = d.steps[step];
  const last = step === d.steps.length - 1;
  const cat = TAGS.category[d.category] ?? TAGS.category.Hardware;
  const diff = TAGS.difficulty[d.difficulty] ?? TAGS.difficulty["Some skill"];

  return (
    <View style={s.flex}>
      <View style={s.header}>
        <Pressable onPress={() => onClose(false)} style={s.circle} accessibilityLabel="Back to diagnosis">
          <Feather name="arrow-left" size={20} color={tone("#000")} />
        </Pressable>
        <Text style={s.title}>Repair Guide</Text>
        <View style={s.stepCount} accessibilityLabel={`Step ${step + 1} of ${d.steps.length}`}>
          <Text style={s.stepCountText}>
            {step + 1} | {d.steps.length}
          </Text>
        </View>
      </View>

      {/* Done steps black, current green, upcoming gray. */}
      <View style={s.segments}>
        {d.steps.map((_, i) => (
          <Segment key={i} state={i < step ? "done" : i === step ? "now" : "next"} />
        ))}
      </View>

      {/* Keyed by step so each step starts scrolled to the top. */}
      <ScrollView key={step} style={s.flex} contentContainerStyle={s.result}>
        <View style={[s.tags, s.guideTags]}>
          <View style={[s.tag, s[diff.style]]}>
            <Feather name={diff.icon} size={16} color={diff.style === "tagGreen" ? ON_ACCENT : tone("#000")} />
            <Text style={[s.tagText, diff.style === "tagGreen" && s.onAccent]}>{d.difficulty}</Text>
          </View>
          <View style={[s.tag, s.tagWhite]}>
            <Feather name="clock" size={16} color={tone("#000")} />
            <Text style={s.tagText}>{minutesLabel(d.minutes)}</Text>
          </View>
          <View style={[s.tag, s.tagWhite]}>
            <Feather name={cat.icon} size={16} color={tone("#000")} />
            <Text style={s.tagText}>{cat.label}</Text>
          </View>
        </View>

        <View style={s.stepCard}>
          <Text style={s.monoLabel}>STEP {String(step + 1).padStart(2, "0")}</Text>
          <Text style={s.stepTitle}>{st.title}</Text>
        </View>
        <Text style={s.stepDetail}>{st.detail}</Text>

        {st.tools.length > 0 && (
          <>
            <Text style={[s.monoLabel, s.toolsLabel]}>YOU'LL NEED</Text>
            <View style={s.tags}>
              {st.tools.map((tool) => (
                <View key={tool} style={[s.tag, s.toolChip]}>
                  <Text style={s.tagText}>{tool}</Text>
                </View>
              ))}
            </View>
          </>
        )}

        {!!st.warning && (
          <View style={s.warnCard}>
            <Feather name="alert-circle" size={22} color={GREEN} />
            <Text style={s.warnText}>{st.warning}</Text>
          </View>
        )}
      </ScrollView>

      <View style={[s.footer, s.actions]}>
        <Pressable onPress={() => (step === 0 ? onClose(false) : onStep(step - 1))} style={s.backBtn} accessibilityRole="button">
          <Text style={s.backText}>Back</Text>
        </Pressable>
        <Pressable onPress={() => (last ? onClose(true) : onStep(step + 1))} style={s.nextBtn} accessibilityRole="button">
          <Text style={s.nextText}>{last ? "Finish" : "Next step"}</Text>
          <View style={s.nextIcon}>
            <Feather name={last ? "check" : "arrow-right"} size={16} color={ON_ACCENT} />
          </View>
        </Pressable>
      </View>
    </View>
  );
}

function Diagnosing({ d, onCancel }: { d: Diag; onCancel: () => void }) {
  const { width, height } = useWindowDimensions();
  const size = Math.min(297, width - 105, height * 0.34); // 297pt on the 402x874 design, smaller on short phones
  const r = size / 2 - RING_PAD;
  const circumference = 2 * Math.PI * r;

  // The diagnosis is one request with no real percentage, so the arc follows the checklist:
  // a step per known row, easing toward 85% while the request runs, then 92% and 100% as the last rows tick.
  // useNativeDriver is off: the native driver can't animate SVG stroke props.
  const progress = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    const to = (toValue: number, duration: number, easing = Easing.out(Easing.quad)) =>
      Animated.timing(progress, { toValue, duration, easing, useNativeDriver: false });
    const anim =
      d.stage === 1
        ? to(0.2, 600)
        : d.stage === 2
          ? to(0.4, 600)
          : d.stage === 3
            ? Animated.sequence([to(0.55, 500), to(0.85, 12000, Easing.out(Easing.cubic))])
            : to(d.stage === 4 ? 0.92 : 1, 450);
    anim.start();
    return () => anim.stop();
  }, [d.stage, progress]);
  const dashOffset = progress.interpolate({ inputRange: [0, 1], outputRange: [circumference, 0] });
  const rotate = progress.interpolate({ inputRange: [0, 1], outputRange: ["0deg", "360deg"] });

  const rows: [string, string | undefined][] = [
    ["Identified the device", d.device],
    [d.photo ? "Scanned the photo for damage" : "Reviewed your symptoms", d.finding],
    ["Checking software signs", d.software],
    ["Writing your repair steps", "Done"],
  ];

  return (
    <ScrollView style={s.flex} contentContainerStyle={s.diagPage}>
      <View style={s.header}>
        <Pressable onPress={onCancel} style={s.circle} accessibilityLabel="Back">
          <Feather name="arrow-left" size={20} color={tone("#000")} />
        </Pressable>
        <Text style={s.title}>Diagnosing</Text>
        <View style={s.headerSpacer} />
      </View>

      <View style={[s.ringBox, { width: size, height: size }]}>
        {/* Rotated -90° so the arc starts at 12 o'clock and fills clockwise. */}
        <Svg width={size} height={size} style={s.ringSvg}>
          <Circle cx={size / 2} cy={size / 2} r={r} stroke={tone("#E3E3E3")} strokeWidth={3} fill="none" />
          <AnimatedCircle
            cx={size / 2}
            cy={size / 2}
            r={r}
            stroke={GREEN}
            strokeWidth={3}
            strokeLinecap="round"
            fill="none"
            strokeDasharray={circumference}
            strokeDashoffset={dashOffset}
          />
        </Svg>
        {/* The dot rides the arc's leading edge. */}
        <Animated.View style={[s.ring, { transform: [{ rotate }] }]}>
          <View style={s.ringDot} />
        </Animated.View>
        <View style={[s.innerRing, { width: (size * 2) / 3, height: (size * 2) / 3, borderRadius: size / 3 }]} />
      </View>

      <Text style={s.diagTitle}>Looking closely</Text>
      <Text style={s.diagSub}>This usually takes a few seconds.</Text>

      <View style={s.diagCard}>
        {rows.map(([label, status], i) => {
          const state = i < d.stage - 1 ? "done" : i === d.stage - 1 ? "active" : "next";
          return (
            <View key={i} style={s.stepRow}>
              {/* Keyed by state so the icon remounts, and its entry animation plays, when the row changes state. */}
              <StepIcon key={state} state={state} />
              <Text style={[s.stepLabel, state === "next" && s.muted]}>{label}</Text>
              <Text style={[s.stepStatus, state === "active" && s.greenText]}>
                {state === "done" ? (status || "Done").toUpperCase() : state === "active" ? "WORKING" : "NEXT"}
              </Text>
            </View>
          );
        })}
      </View>

      <View style={s.flex} />
      <Pressable onPress={onCancel} style={s.cancel} accessibilityRole="button">
        <Text style={s.cancelText}>Cancel</Text>
      </Pressable>
    </ScrollView>
  );
}

// Buttons fade on touch without changing their size or moving their hit area.
const AnimatedPressable = Animated.createAnimatedComponent(RNPressable);
function Pressable({ style, onPressIn, onPressOut, ...props }: PressableProps) {
  const opacity = useRef(new Animated.Value(1)).current;
  const to = (toValue: number) =>
    Animated.timing(opacity, { toValue, duration: toValue === 1 ? 140 : 90, easing: Easing.out(Easing.quad), useNativeDriver: NATIVE }).start();
  useEffect(() => () => opacity.stopAnimation(), [opacity]);
  return (
    <AnimatedPressable
      {...props}
      onPressIn={(e) => {
        to(0.72);
        onPressIn?.(e);
      }}
      onPressOut={(e) => {
        to(1);
        onPressOut?.(e);
      }}
      style={[style as StyleProp<ViewStyle>, { opacity: Animated.multiply(opacity, StyleSheet.flatten(style as StyleProp<ViewStyle>)?.opacity ?? 1) }]}
    />
  );
}

// New elements fade in with a short, eased slide, keeping their size fixed.
// Keyed by turn index, so only bubbles that just arrived animate; a second bubble in the same turn waits STAGGER_MS.
type PopProps = { from: "left" | "right"; delay?: number; style?: ComponentProps<typeof View>["style"]; children: ReactNode };
function Pop({ from, delay = 0, style, children }: PopProps) {
  const v = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    const animation = Animated.timing(v, { toValue: 1, delay, duration: 200, easing: Easing.out(Easing.cubic), useNativeDriver: NATIVE });
    animation.start();
    return () => animation.stop();
  }, [v, delay]);
  return (
    <Animated.View
      style={[
        style,
        {
          opacity: v,
          transform: [
            { translateX: v.interpolate({ inputRange: [0, 1], outputRange: [from === "left" ? -4 : 4, 0] }) },
            { translateY: v.interpolate({ inputRange: [0, 1], outputRange: [6, 0] }) },
          ],
        },
      ]}
    >
      {children}
    </Animated.View>
  );
}

// Three dots hopping in turn while the reply is on its way.
function Typing() {
  const v = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    const anim = Animated.loop(Animated.timing(v, { toValue: 1, duration: 1100, easing: Easing.linear, useNativeDriver: NATIVE }));
    anim.start();
    return () => anim.stop();
  }, [v]);
  return (
    <View style={[s.bubble, s.assistant, s.typing]} accessibilityLabel="Diagnosing">
      {[0, 1, 2].map((k) => {
        const at = 0.1 + k * 0.2;
        const translateY = v.interpolate({ inputRange: [0, at, at + 0.15, at + 0.3, 1], outputRange: [0, 0, -5, 0, 0] });
        return <Animated.View key={k} style={[s.typingDot, { transform: [{ translateY }] }]} />;
      })}
    </View>
  );
}

// Fills from the left as its step becomes current (green), turns black once done, and empties when stepping back.
function Segment({ state }: { state: "done" | "now" | "next" }) {
  const fill = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    const anim = Animated.timing(fill, {
      toValue: state === "next" ? 0 : 1,
      duration: 450,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: NATIVE,
    });
    anim.start();
    return () => anim.stop();
  }, [state, fill]);
  return (
    <View style={s.segment}>
      <Animated.View style={[s.segmentFill, state === "done" && s.segmentDone, { transform: [{ scaleX: fill }] }]} />
    </View>
  );
}

// Only the active step pulses; completed steps fade in and upcoming steps stay still.
function StepIcon({ state }: { state: "done" | "active" | "next" }) {
  const v = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (state === "next") return;
    const anim =
      state === "done"
        ? Animated.timing(v, { toValue: 1, duration: 180, easing: Easing.out(Easing.quad), useNativeDriver: NATIVE })
        : Animated.loop(
            Animated.timing(v, {
              toValue: 1,
              duration: 1400,
              easing: Easing.linear,
              useNativeDriver: NATIVE,
            }),
          );
    anim.start();
    return () => anim.stop();
  }, [state, v]);

  if (state === "done") {
    return (
      <Animated.View style={[s.stepIcon, s.stepDone, { opacity: v }]}>
        <Feather name="check" size={16} color={GREEN} />
      </Animated.View>
    );
  }
  if (state === "active") {
    const pulse = { opacity: v.interpolate({ inputRange: [0, 0.5, 1], outputRange: [0.4, 1, 0.4] }) };
    return (
      <View style={[s.stepIcon, s.stepActive]}>
        <Animated.View style={[s.stepDot, pulse]} />
      </View>
    );
  }
  return <View style={[s.stepIcon, s.stepNext]} />;
}

function Card(p: { icon: "camera" | "message-square"; title: string; subtitle: string; onPress: () => void }) {
  return (
    <Pressable onPress={p.onPress} style={s.card}>
      <Feather name={p.icon} size={22} color={tone("#000")} style={s.cardIcon} />
      <Text style={s.cardTitle}>{p.title}</Text>
      {/* One line: shrinks to fit on narrow phones (native) rather than wrapping. */}
      <Text style={s.cardSub} numberOfLines={1} adjustsFontSizeToFit>
        {p.subtitle}
      </Text>
    </Pressable>
  );
}

// The stylesheet is built once per theme (tone() and surface() read DARK while it's built); `s` is the current one.
function makeStyles() {
  return StyleSheet.create({
  // overflow: the Home dot circle is wider than the screen; unclipped, browsers scroll the page sideways.
  screen: { flex: 1, backgroundColor: PAGE_BG(), overflow: "hidden" },
  flex: { flex: 1 },

  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 20 },
  circle: { width: 45, height: 45, borderRadius: 100, backgroundColor: surface("#fff"), alignItems: "center", justifyContent: "center" },
  avatar: { alignItems: "center", justifyContent: "center", overflow: "hidden" },
  avatarText: { fontFamily: "Poppins_600SemiBold", color: ON_ACCENT, includeFontPadding: false, textAlignVertical: "center" },
  title: { fontFamily: "Poppins_600SemiBold", fontSize: 15, lineHeight: 22, color: tone("#000") },
  time: { fontFamily: "Poppins_400Regular", fontSize: 11, lineHeight: 16, textAlign: "center", color: tone("#000"), marginTop: 4 },

  home: { flexGrow: 1, justifyContent: "center", paddingHorizontal: 20, paddingVertical: 20 },
  conversationLink: { alignSelf: "center", minHeight: 44, flexDirection: "row", alignItems: "center", gap: 7, marginTop: 14 },
  start: { position: "absolute", top: 0, left: 0, right: 0, bottom: 0, zIndex: 10, backgroundColor: surface("#fff"), alignItems: "center", justifyContent: "center" },
  startLogo: { transform: [{ scale: 1.8 }] },
  // Welcome page, measured from the mockup. The logo area and the gap above the button split the spare
  // height about 3.25 : 1, as in the mockup, so it scales to other screen heights.
  welcome: { flex: 1, paddingHorizontal: 20, paddingBottom: 20 },
  welcomeTop: { flex: 3.25, alignItems: "center", justifyContent: "center" },
  welcomeTitle: { fontFamily: "Poppins_500Medium", fontSize: 32, lineHeight: 42, textAlign: "center", color: tone("#000") },
  welcomeSub: { fontFamily: "Poppins_500Medium", fontSize: 20, lineHeight: 28, textAlign: "center", color: tone("#000") },
  welcomeBody: { fontFamily: "Poppins_400Regular", fontSize: 15, lineHeight: 23, textAlign: "center", color: tone("#000"), marginTop: 14, paddingHorizontal: 6 },
  welcomeGap: { flex: 1 },
  welcomeBtn: { height: 59, borderRadius: 100, backgroundColor: surface("#000"), alignItems: "center", justifyContent: "center" },
  welcomeBtnText: { fontFamily: "Poppins_600SemiBold", fontSize: 15, lineHeight: 22, includeFontPadding: false, textAlignVertical: "center", color: tone("#fff") },
  // My gadgets and the tab bar, measured from the mockup.
  gHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 20, paddingTop: 15 },
  gTitle: { fontFamily: "Poppins_600SemiBold", fontSize: 26, lineHeight: 34, color: tone("#000") },
  gCount: { fontFamily: "Poppins_400Regular", fontSize: 14, lineHeight: 20, color: tone("rgba(0,0,0,0.5)") },
  gAdd: { backgroundColor: surface("#000") },
  gEmpty: { textAlign: "center", marginTop: 20 }, // History's empty message
  gEmptyCard: { alignItems: "center", paddingTop: 36, paddingBottom: 28, paddingHorizontal: 24, borderRadius: 28, backgroundColor: surface("#fff") },
  gHero: { flexDirection: "row", alignItems: "center", marginBottom: 22 },
  gHeroIcon: { alignItems: "center", justifyContent: "center", borderRadius: 100 },
  gHeroMain: { width: 76, height: 76, backgroundColor: surface("#000"), marginHorizontal: -8, zIndex: 1, borderWidth: 5, borderColor: surface("#fff") },
  gHeroSide: { width: 56, height: 56, backgroundColor: surface("#F3F3F3") },
  gEmptyTitle: { fontFamily: "Poppins_600SemiBold", fontSize: 20, lineHeight: 28, color: tone("#000") },
  gEmptyBody: { fontFamily: "Poppins_400Regular", fontSize: 15, lineHeight: 22, textAlign: "center", color: tone("rgba(0,0,0,0.55)"), marginTop: 6, maxWidth: 290 },
  gEmptyBtn: { flexDirection: "row", gap: 8, alignSelf: "stretch", marginTop: 24 },
  gSearch: { flexDirection: "row", alignItems: "center", gap: 12, height: 52, paddingHorizontal: 18, borderRadius: 100, backgroundColor: surface("#fff") },
  gSearchInput: { flex: 1, height: "100%", fontFamily: "Poppins_400Regular", fontSize: 15, color: tone("#000") },
  gFilters: { marginTop: 12, marginHorizontal: -20 },
  gFilterRow: { gap: 8, paddingHorizontal: 20 },
  gChip: { flexDirection: "row", alignItems: "center", gap: 8, height: 40, paddingLeft: 16, paddingRight: 8, borderRadius: 100, backgroundColor: surface("#fff") },
  gChipText: { fontFamily: "Poppins_500Medium", fontSize: 14, color: tone("#000") },
  gChipCount: { minWidth: 24, height: 24, paddingHorizontal: 6, borderRadius: 12, backgroundColor: surface("#F3F3F3"), alignItems: "center", justifyContent: "center" },
  gChipCountOn: { backgroundColor: surface("rgba(255,255,255,0.18)") },
  gChipCountText: { fontFamily: "Poppins_500Medium", fontSize: 12, color: tone("rgba(0,0,0,0.55)") },
  gChipCountTextOn: { color: tone("#fff") },
  gCard: { marginTop: 12, padding: 18, borderRadius: 24, backgroundColor: surface("#fff") },
  gTop: { flexDirection: "row", alignItems: "center" },
  gIcon: { width: 52, height: 52, borderRadius: 16, backgroundColor: surface("#F3F3F3"), alignItems: "center", justifyContent: "center" },
  gText: { flex: 1, marginLeft: 14 },
  gName: { fontFamily: "Poppins_600SemiBold", fontSize: 16, lineHeight: 23, color: tone("#000") },
  gKind: { fontFamily: "Poppins_400Regular", fontSize: 13, lineHeight: 19, color: tone("rgba(0,0,0,0.5)") },
  gStatus: { flexDirection: "row", alignItems: "center", gap: 5, height: 28, paddingHorizontal: 12, borderRadius: 100 },
  gStatusText: { fontFamily: "Poppins_500Medium", fontSize: 13, color: tone("#000") },
  gDivider: { height: 1, backgroundColor: surface("rgba(0,0,0,0.06)"), marginVertical: 14 },
  gFoot: { flexDirection: "row", alignItems: "center", gap: 12 },
  gIssue: { flex: 1, fontFamily: "Poppins_400Regular", fontSize: 14, lineHeight: 20, color: tone("rgba(0,0,0,0.6)") },
  gMeta: { fontFamily: "Poppins_400Regular", fontSize: 13, lineHeight: 19, color: tone("rgba(0,0,0,0.4)") },
  gRemove: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, height: 48, marginTop: 14, borderRadius: 100, backgroundColor: surface("#FDECEC") },
  gRemoveText: { fontFamily: "Poppins_500Medium", fontSize: 14, color: "#dc2626" },
  gCheckBtn: { flexDirection: "row", gap: 8, height: 52, marginTop: 14 },
  forTag: { flexDirection: "row", alignItems: "center", gap: 8, alignSelf: "center", maxWidth: "100%", height: 34, paddingHorizontal: 14, marginBottom: 10, borderRadius: 100, backgroundColor: surface("#fff") },
  forTagText: { flexShrink: 1, fontFamily: "Poppins_500Medium", fontSize: 13, color: tone("#000") },
  fileCard: { padding: 18, marginBottom: 14, borderRadius: 24, backgroundColor: surface("#fff"), borderWidth: 1, borderColor: tone("rgba(0,0,0,0.06)") },
  fileTitle: { fontFamily: "Poppins_600SemiBold", fontSize: 17, lineHeight: 24, color: tone("#000") },
  fileSub: { fontFamily: "Poppins_400Regular", fontSize: 14, lineHeight: 20, color: tone("rgba(0,0,0,0.55)"), marginTop: 2, marginBottom: 8 },
  fileRow: { flexDirection: "row", alignItems: "center", gap: 12, height: 52 },
  fileIcon: { width: 36, height: 36, borderRadius: 12, backgroundColor: surface("#F3F3F3"), alignItems: "center", justifyContent: "center" },
  fileIconAdd: { backgroundColor: surface("#000") },
  fileRowText: { flex: 1, fontFamily: "Poppins_500Medium", fontSize: 15, color: tone("#000") },
  fileSkip: { alignSelf: "center", marginTop: 6 },
  fileSkipText: { fontFamily: "Poppins_500Medium", fontSize: 14, color: tone("rgba(0,0,0,0.5)") },
  fileBtn: { flex: 1, flexDirection: "row", gap: 8, height: 50 },
  gNoMatch: { textAlign: "center", marginTop: 24 },
  gAddCard: { padding: 20, marginBottom: 12, borderRadius: 28, backgroundColor: surface("#fff") },
  gAddTitle: { fontFamily: "Poppins_600SemiBold", fontSize: 18, lineHeight: 26, color: tone("#000"), marginBottom: 14 },
  gAddInput: { backgroundColor: surface("#F3F3F3"), borderColor: "transparent" },
  gAddLabel: { fontFamily: "Poppins_500Medium", fontSize: 14, color: tone("rgba(0,0,0,0.55)"), marginTop: 18, marginBottom: 10 },
  gKinds: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  gKindTile: { width: "23%", flexGrow: 1, height: 72, borderRadius: 18, backgroundColor: surface("#F3F3F3"), alignItems: "center", justifyContent: "center", gap: 6, paddingHorizontal: 4 },
  gKindText: { fontFamily: "Poppins_500Medium", fontSize: 11, color: tone("#000") },
  gAddActions: { flexDirection: "row", gap: 10, marginTop: 18 },
  gAddBtn: { flex: 1, height: 52 },
  gList: { paddingHorizontal: 20, paddingTop: 15, paddingBottom: 110 }, // room to scroll clear of the floating tab bar
  // Floats over the page, so the page shows through the glass.
  tabBar: { position: "absolute", left: 0, right: 0, bottom: 0, flexDirection: "row", gap: 10, paddingHorizontal: 16, paddingBottom: 18 },
  tabHome: { width: 64, height: 64, alignItems: "center", justifyContent: "center" },
  tabPill: { flexDirection: "row", height: 64, padding: 6 },
  // The selected tab's lens: brighter glass with its own rim.
  tabMorph: { position: "absolute", left: 8, top: 6, bottom: 6, borderRadius: 100, backgroundColor: surface("rgba(0,0,0,0.07)") },
  tabItem: { flex: 1, alignItems: "center", justifyContent: "center", gap: 2 },
  tabIconBox: { width: 24, height: 24, alignItems: "center", justifyContent: "center" },
  solidPhone: { width: 14, height: 21, borderRadius: 4 }, // a phone silhouette, matched to the solid clock and person
  headerPhone: { width: 12, height: 18, borderRadius: 3.5, backgroundColor: tone("#000") }, // same phone, at header-icon size
  tabLabel: { fontFamily: "Poppins_500Medium", fontSize: 10, lineHeight: 13, color: tone("rgba(0,0,0,0.7)") },
  tabLabelOn: { fontFamily: "Poppins_600SemiBold", color: GREEN },
  glass: { overflow: "hidden", borderRadius: 100, backgroundColor: DARK ? "rgba(36,36,40,0.45)" : "rgba(255,255,255,0.12)" },
  glassNative: { borderRadius: 100, overflow: "hidden" },
  glassShadow: { borderRadius: 100, shadowColor: "#000", shadowOpacity: 0.1, shadowRadius: 24, shadowOffset: { width: 0, height: 10 } },
  // Profile, measured from the mockup.
  pCard: { padding: 18, borderRadius: 25, backgroundColor: surface("#fff") },
  avatarPreview: { alignItems: "center", paddingTop: 16 },
  avatarColors: { flexDirection: "row", flexWrap: "wrap", gap: 12 },
  avatarSwatch: { width: 44, height: 44, borderRadius: 22, alignItems: "center", justifyContent: "center" },
  pName: { fontFamily: "Poppins_600SemiBold", fontSize: 18, lineHeight: 25, color: tone("#000") },
  pEdit: { height: 32, paddingHorizontal: 14, marginLeft: 10, borderRadius: 100, justifyContent: "center", backgroundColor: surface("#F3F3F3") },
  pEditText: { fontFamily: "Poppins_500Medium", fontSize: 13, color: tone("#000") },
  pEmail: { fontFamily: "Poppins_400Regular", fontSize: 13, lineHeight: 19, color: tone("rgba(0,0,0,0.55)") },
  pStats: { flexDirection: "row", marginTop: 16, paddingTop: 14, borderTopWidth: 1, borderTopColor: surface("rgba(0,0,0,0.06)") },
  pStat: { flex: 1, alignItems: "center", paddingHorizontal: 4 },
  pStatLine: { borderLeftWidth: 1, borderLeftColor: surface("rgba(0,0,0,0.06)") },
  pStatNum: { fontFamily: "Poppins_600SemiBold", fontSize: 22, lineHeight: 30, color: tone("#000") },
  pStatLabel: { fontFamily: "Poppins_400Regular", fontSize: 12, lineHeight: 17, color: tone("rgba(0,0,0,0.55)") },
  pSection: { marginTop: 24, marginBottom: -2, paddingHorizontal: 6 }, // pSettings adds its own 12 below
  pSettings: { marginTop: 12, paddingHorizontal: 16, paddingVertical: 4, borderRadius: 25, backgroundColor: surface("#fff") },
  pRow: { flexDirection: "row", alignItems: "center", minHeight: 58, paddingVertical: 8, gap: 14 },
  pLine: { borderTopWidth: 1, borderTopColor: surface("rgba(0,0,0,0.06)") },
  pIcon: { width: 34, height: 34, alignItems: "center", justifyContent: "center" },
  pRowLabel: { flex: 1, fontFamily: "Poppins_400Regular", fontSize: 15, color: tone("#000") },
  pRowSub: { fontFamily: "Poppins_400Regular", fontSize: 12, lineHeight: 17, color: tone("rgba(0,0,0,0.5)"), marginTop: 1 },
  pRowValue: { flexShrink: 1, maxWidth: "40%", fontFamily: "Poppins_400Regular", fontSize: 14, color: tone("rgba(0,0,0,0.45)") },
  pSignOut: { marginTop: 10 },
  pHint: { marginTop: 10, marginBottom: 4, paddingHorizontal: 6 },
  pDoc: { paddingVertical: 20, gap: 4 },
  pDocItem: { gap: 4, marginBottom: 12 },
  pDocHeading: { fontFamily: "Poppins_500Medium", fontSize: 16, lineHeight: 23, color: tone("#000") },
  pDocBody: { fontFamily: "Poppins_400Regular", fontSize: 15, lineHeight: 23, color: tone("rgba(0,0,0,0.6)") },
  pAbout: { alignItems: "center", paddingVertical: 28 },
  pAboutName: { marginTop: 16 },
  pAboutText: { textAlign: "center", marginTop: 8 },
  pSignOutText: { color: "#dc2626" },
  toggle: { width: 48, height: 28, borderRadius: 14, padding: 3 },
  knob: { width: 22, height: 22, borderRadius: 11, backgroundColor: WHITE },
  // History, measured from the mockup.
  hxFilters: { marginTop: 0, marginBottom: 12 },
  hxChip: { paddingRight: 16, gap: 6, maxWidth: 200 },
  hxNav: { width: 34, height: 34, borderRadius: 17, backgroundColor: surface("#F3F3F3"), alignItems: "center", justifyContent: "center", marginLeft: 8 },
  hxYear: { fontFamily: "Poppins_400Regular", color: tone("rgba(0,0,0,0.4)") },
  hxDayQuiet: { color: tone("rgba(0,0,0,0.4)") },
  hxDayBusy: { fontFamily: "Poppins_600SemiBold" },
  hxLegend: { flexDirection: "row", justifyContent: "space-between", gap: 8, marginTop: 10, paddingTop: 14, borderTopWidth: 1, borderTopColor: surface("rgba(0,0,0,0.06)") },
  hxLegendItem: { flexDirection: "row", alignItems: "center", gap: 6, flexShrink: 1 },
  hxLegendNum: { fontFamily: "Poppins_600SemiBold", fontSize: 13, color: tone("#000") },
  hxLegendText: { flexShrink: 1, fontFamily: "Poppins_400Regular", fontSize: 12, color: tone("rgba(0,0,0,0.55)") },
  hxDayChip: { flexDirection: "row", alignItems: "center", alignSelf: "flex-start", gap: 6, height: 32, marginTop: 14, paddingHorizontal: 14, borderRadius: 100, backgroundColor: surface("#000") },
  hxDayChipText: { fontFamily: "Poppins_500Medium", fontSize: 13, color: tone("#fff") },
  hxShowAll: { fontFamily: "Poppins_600SemiBold", fontSize: 14, color: tone("#000"), textDecorationLine: "underline" },
  hxDayHead: { flexDirection: "row", justifyContent: "space-between", marginTop: 24, marginBottom: 2, paddingHorizontal: 6 },
  hxEntry: { marginTop: 10, padding: 16, borderRadius: 22, backgroundColor: surface("#fff") },
  hxBadge: { width: 42, height: 42, borderRadius: 14, alignItems: "center", justifyContent: "center", alignSelf: "flex-start" },
  hxTitleRow: { flexDirection: "row", alignItems: "flex-start", gap: 8 },
  hxTitle: { fontFamily: "Poppins_600SemiBold", fontSize: 15, lineHeight: 21, color: tone("#000") },
  hxDetail: { fontFamily: "Poppins_400Regular", fontSize: 14, lineHeight: 20, color: tone("rgba(0,0,0,0.6)"), marginTop: 2 },
  hxFoot: { flexDirection: "row", alignItems: "center", gap: 10, marginTop: 14, paddingTop: 12, borderTopWidth: 1, borderTopColor: surface("rgba(0,0,0,0.06)") },
  hxMeta: { flex: 1, flexDirection: "row", alignItems: "center", gap: 6 },
  hxMetaText: { flexShrink: 1, fontFamily: "Poppins_500Medium", fontSize: 12, color: tone("rgba(0,0,0,0.5)") },
  hxPill: { height: 24, paddingHorizontal: 10, borderRadius: 100, justifyContent: "center" },
  hxPillText: { fontFamily: "Poppins_500Medium", fontSize: 12 },
  hxActions: { flexDirection: "row", gap: 8, marginTop: 14 },
  hxAction: { flex: 1, flexDirection: "row", gap: 8, height: 46, marginTop: 0 },
  hxRemove: { flex: 0, paddingHorizontal: 18 },
  hxNone: { alignItems: "center", gap: 8, marginTop: 24 },
  hCal: { padding: 20, borderRadius: 25, backgroundColor: surface("#fff") },
  hMonthRow: { flexDirection: "row", alignItems: "center", marginBottom: 8 },
  hMonth: { flex: 1, fontFamily: "Poppins_600SemiBold", fontSize: 17, color: tone("#000") },
  hWeek: { flexDirection: "row" },
  hCell: { flex: 1, height: 42, alignItems: "center", justifyContent: "center" },
  hWeekday: { fontFamily: "Poppins_500Medium", fontSize: 11, lineHeight: 30, textAlign: "center", color: tone("rgba(0,0,0,0.35)") },
  hDay: { width: 34, height: 34, borderRadius: 17, alignItems: "center", justifyContent: "center" },
  hToday: { backgroundColor: surface("#F3F3F3") },
  hSelected: { backgroundColor: surface("#000") },
  hDayText: { fontFamily: "Poppins_400Regular", fontSize: 14, color: tone("#000") },
  hDayDot: { position: "absolute", bottom: 0 }, // just under the day circle
  dot: { width: 6, height: 6, borderRadius: 3 },
  dotBig: { width: 10, height: 10, borderRadius: 5 },
  dotFixed: { backgroundColor: GREEN },
  dotChecked: { backgroundColor: surface("rgba(0,0,0,0.3)") },
  dotPro: { backgroundColor: AMBER },
  // New-account questions.
  setup: { paddingHorizontal: 20, paddingTop: 26, paddingBottom: 20 },
  setupTitle: { fontFamily: "Poppins_600SemiBold", fontSize: 26, lineHeight: 34, color: tone("#000"), marginTop: 8 },
  setupSub: { fontFamily: "Poppins_400Regular", fontSize: 15, lineHeight: 22, color: tone("rgba(0,0,0,0.55)"), marginTop: 6, marginBottom: 22 },
  setupInput: { fontSize: 17 },
  setupGrid: { flexDirection: "row", flexWrap: "wrap", gap: 10 },
  setupTile: { width: "48%", flexGrow: 1, height: 96, borderRadius: 22, backgroundColor: surface("#fff"), alignItems: "center", justifyContent: "center", gap: 8 },
  setupTileText: { fontFamily: "Poppins_500Medium", fontSize: 15, color: tone("#000") },
  setupOn: { backgroundColor: surface("#000") },
  setupOption: { flexDirection: "row", alignItems: "center", gap: 12, padding: 20, marginBottom: 10, borderRadius: 22, backgroundColor: surface("#fff") },
  setupOptionTitle: { fontFamily: "Poppins_500Medium", fontSize: 16, lineHeight: 23, color: tone("#000") },
  setupOptionDetail: { fontFamily: "Poppins_400Regular", fontSize: 14, lineHeight: 20, color: tone("rgba(0,0,0,0.55)") },
  setupOptionDetailOn: { color: tone("rgba(255,255,255,0.7)") },
  // Sign in / Create account, measured from the mockups.
  auth: { paddingHorizontal: 20, paddingTop: 20, paddingBottom: 30 },
  authTitle: { fontFamily: "Poppins_500Medium", fontSize: 32, lineHeight: 42, textAlign: "center", color: tone("#000") },
  authSub: { fontFamily: "Poppins_400Regular", fontSize: 15, lineHeight: 22, textAlign: "center", color: tone("#000") },
  seg: { flexDirection: "row", height: 59, marginTop: 22, padding: 7, borderRadius: 100, backgroundColor: surface("#fff") },
  segPill: { position: "absolute", top: 7, bottom: 7, left: 7, borderRadius: 100, backgroundColor: surface("#000") },
  segItem: { flex: 1, alignItems: "center", justifyContent: "center" },
  segText: { fontFamily: "Poppins_600SemiBold", fontSize: 15, lineHeight: 22, includeFontPadding: false, textAlignVertical: "center", color: tone("#000") },
  segTextOn: { color: tone("#fff") },
  authLabel: { fontFamily: "Poppins_400Regular", fontSize: 15, lineHeight: 22, color: tone("#000"), marginTop: 20, marginBottom: 10 },
  authInput: { height: 58, paddingHorizontal: 20, paddingVertical: 0, textAlignVertical: "center", includeFontPadding: false, borderRadius: 100, backgroundColor: surface("#fff"), borderWidth: 1, borderColor: tone("rgba(0,0,0,0.05)"), fontFamily: "Poppins_400Regular", fontSize: 15, lineHeight: 22, color: tone("#000") },
  authInputSecret: { paddingRight: 52 }, // room for the eye button
  eye: { position: "absolute", right: 20, top: 0, bottom: 0, justifyContent: "center" },
  forgot: { alignSelf: "flex-end", marginTop: 10 },
  forgotText: { fontFamily: "Poppins_400Regular", fontSize: 13, color: tone("rgba(0,0,0,0.5)") },
  authNote: { fontFamily: "Poppins_400Regular", fontSize: 13, textAlign: "center", color: tone("rgba(0,0,0,0.5)"), marginTop: 12 },
  authBtn: { marginTop: 20 },
  divider: { flexDirection: "row", alignItems: "center", marginVertical: 14 },
  dividerLine: { flex: 1, height: 1, backgroundColor: surface("rgba(0,0,0,0.2)") },
  dividerText: { fontFamily: "Poppins_400Regular", fontSize: 14, color: tone("rgba(0,0,0,0.5)"), marginHorizontal: 18 },
  googleBtn: { flexDirection: "row", gap: 10, height: 59, borderRadius: 100, backgroundColor: surface("#fff"), alignItems: "center", justifyContent: "center" },
  googleText: { fontFamily: "Poppins_600SemiBold", fontSize: 15, lineHeight: 22, includeFontPadding: false, textAlignVertical: "center", color: tone("#000") },
  welcomeLink: { fontFamily: "Poppins_400Regular", fontSize: 12, textAlign: "center", color: tone("rgba(0,0,0,0.5)"), marginTop: 12 }, // the Home logo, scaled up to the start page's size
  // Centered horizontally, with the circle's middle ~90pt above the bottom (behind the message bar).
  glowClip: { position: "absolute", top: 0, left: 0, right: 0, bottom: 0, overflow: "hidden" },
  glow: { position: "absolute", left: "50%", marginLeft: -GLOW_R, bottom: GLOW_Y - GLOW_R },
  greeting: { fontFamily: SERIF, fontSize: 28, lineHeight: 36, textAlign: "center", color: tone("#000"), marginTop: 18, marginBottom: 28 },
  // Measured from the logo artwork (287 tall), scaled to 80: the D's right side is a full half-circle.
  logo: { flexDirection: "row", gap: 7, height: 80, alignSelf: "center" },
  logoBar: { width: 20, borderRadius: 3.5, backgroundColor: tone("#000") },
  logoCol: { width: 38, gap: 7 },
  logoTop: { width: 36, height: 22, borderRadius: 3.5, backgroundColor: tone("#000") },
  logoD: { flex: 1, borderRadius: 3.5, borderTopRightRadius: 25.5, borderBottomRightRadius: 25.5, backgroundColor: tone("#000") },
  cards: { flexDirection: "row", gap: 10 },
  card: { flex: 1, backgroundColor: surface("#fff"), borderRadius: 25, paddingVertical: 20, paddingHorizontal: 18 },
  cardIcon: { marginBottom: 8 },
  cardTitle: { fontFamily: "Poppins_500Medium", fontSize: 15, lineHeight: 22, color: tone("#000") },
  cardSub: { fontFamily: "Poppins_400Regular", fontSize: 12, lineHeight: 20, color: tone("rgba(0,0,0,0.5)") },

  log: { paddingHorizontal: 20, paddingTop: 16, paddingBottom: 12, gap: 10 },
  userTurn: { alignItems: "flex-end", gap: 10 },
  assistantTurn: { alignItems: "flex-start", gap: 10 },
  photo: { width: 150, height: 178, borderRadius: 28, borderWidth: 3, borderColor: surface("#fff"), overflow: "hidden", backgroundColor: surface("#ddd") },
  photoImg: { width: "100%", height: "100%" },
  bubble: { paddingVertical: 14, paddingHorizontal: 20, borderRadius: 25, maxWidth: "80%" },
  user: { backgroundColor: surface("#000"), borderBottomRightRadius: 6 },
  assistant: { alignSelf: "flex-start", backgroundColor: surface("#fff") },
  qCard: { paddingVertical: 20, gap: 16 },
  msgText: { fontFamily: "Poppins_400Regular", fontSize: 13, lineHeight: 20, color: tone("#000") },
  userText: { color: tone("#fff") },
  dim: { color: tone("rgba(0,0,0,0.5)") },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: 6, marginTop: 10 },
  chip: { paddingHorizontal: 20, height: 30, borderRadius: 100, borderWidth: 1, borderColor: tone("rgba(0,0,0,0.1)"), justifyContent: "center", backgroundColor: surface("#fff") },
  chipOn: { backgroundColor: surface("#000"), borderColor: tone("#000") },
  typing: { flexDirection: "row", gap: 6, paddingVertical: 20 },
  typingDot: { width: 7, height: 7, borderRadius: 4, backgroundColor: surface("rgba(0,0,0,0.35)") },
  chipText: { fontFamily: "Poppins_400Regular", fontSize: 13, color: tone("#000") },
  chipTextOn: { color: tone("#fff") },
  error: { fontFamily: "Poppins_400Regular", color: "#dc2626", textAlign: "center", marginTop: 12 },

  footer: { paddingHorizontal: 20, paddingBottom: 20, paddingTop: 8 },
  usage: { marginHorizontal: 10, marginBottom: 18, gap: 8 },
  usageHeading: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", justifyContent: "space-between", columnGap: 12, rowGap: 4 },
  usageSummary: { flexShrink: 1, gap: 2 },
  usageTitle: { fontFamily: "Poppins_500Medium", fontSize: 12, lineHeight: 20, color: tone("rgba(0,0,0,0.6)") },
  usageCount: { fontFamily: "Poppins_600SemiBold", fontSize: 16, lineHeight: 22, fontVariant: ["tabular-nums"], color: tone("#000") },
  usageTotal: { fontFamily: "Poppins_400Regular", fontSize: 12, lineHeight: 20, color: tone("rgba(0,0,0,0.6)") },
  usageEmpty: { color: tone("#A35F00") },
  usageMeter: { flexDirection: "row", gap: 5 },
  usageSegment: { flex: 1, height: 3, borderRadius: 2, backgroundColor: surface("rgba(0,0,0,0.12)") },
  usageSegmentOn: { backgroundColor: DARK ? GREEN : "#579744" },
  usageNote: { fontFamily: "Poppins_400Regular", fontSize: 11, lineHeight: 17, color: tone("rgba(0,0,0,0.6)") },
  usageUpgrade: { minHeight: 44, paddingHorizontal: 14, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 5, borderRadius: 100, borderWidth: 1, borderColor: tone("rgba(0,0,0,0.15)") },
  usageUpgradeText: { fontFamily: "Poppins_500Medium", fontSize: 12, lineHeight: 20, color: tone("#000") },
  hint: { fontFamily: "Poppins_400Regular", fontSize: 13, lineHeight: 20, textAlign: "center", color: tone("rgba(0,0,0,0.4)"), marginBottom: 12 },
  preview: { alignSelf: "flex-start", marginBottom: 8, marginLeft: 8 },
  thumb: { width: 64, height: 64, borderRadius: 14 },
  remove: { position: "absolute", top: -6, right: -6, width: 22, height: 22, borderRadius: 11, backgroundColor: surface("#000"), alignItems: "center", justifyContent: "center" },
  bar: {
    height: 59,
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: surface("#fff"),
    borderWidth: 1,
    borderColor: tone("rgba(0,0,0,0.07)"),
    borderRadius: 100,
    paddingLeft: 20,
    paddingRight: 6,
  },
  // bottom = footer's bottom padding (20) + bar height (59) + an 8pt gap.
  attachMenu: { position: "absolute", left: 20, bottom: 87, padding: 6, borderRadius: 22, backgroundColor: surface("#fff"), borderWidth: 1, borderColor: tone("rgba(0,0,0,0.07)") },
  attachItem: { flexDirection: "row", alignItems: "center", gap: 12, paddingVertical: 12, paddingHorizontal: 14, borderRadius: 16 },
  attachText: { fontFamily: "Poppins_400Regular", fontSize: 14, color: tone("#000") },
  input: { flex: 1, height: "100%", marginLeft: 15, paddingVertical: 0, textAlignVertical: "center", includeFontPadding: false, fontFamily: "Poppins_400Regular", fontSize: 15, lineHeight: 22, color: tone("#000") },
  send: { width: 45, height: 45, borderRadius: 100, backgroundColor: GREEN, alignItems: "center", justifyContent: "center" },
  disabled: { opacity: 0.5 },

  diagPage: { flexGrow: 1 },
  headerSpacer: { width: 45 },
  ringBox: { alignSelf: "center", marginTop: 45, alignItems: "center", justifyContent: "center" },
  ringSvg: { position: "absolute", transform: [{ rotate: "-90deg" }] },
  ring: { position: "absolute", top: 0, left: 0, right: 0, bottom: 0 },
  // Centered on the arc's stroke, which sits RING_PAD in from the edge.
  ringDot: { position: "absolute", top: RING_PAD - 5, left: "50%", marginLeft: -5, width: 10, height: 10, borderRadius: 5, backgroundColor: GREEN },
  innerRing: { borderWidth: 1.5, borderColor: tone("#E3E3E3") },
  diagTitle: { fontFamily: "Poppins_500Medium", fontSize: 32, lineHeight: 48, textAlign: "center", color: tone("#000"), marginTop: 20 },
  diagSub: { fontFamily: "Poppins_400Regular", fontSize: 15, lineHeight: 22, textAlign: "center", color: tone("#000") },
  diagCard: { backgroundColor: surface("#fff"), borderRadius: 25, marginHorizontal: 20, marginTop: 16, paddingHorizontal: 20, paddingVertical: 25, gap: 20 },
  stepRow: { flexDirection: "row", alignItems: "center" },
  stepIcon: { width: 30, height: 30, borderRadius: 15, alignItems: "center", justifyContent: "center" },
  stepDone: { backgroundColor: surface("#000") },
  stepActive: { borderWidth: 1.5, borderColor: GREEN, backgroundColor: surface("#fff") },
  stepDot: { width: 10, height: 10, borderRadius: 5, backgroundColor: GREEN },
  stepNext: { borderWidth: 1.5, borderColor: tone("rgba(0,0,0,0.4)"), borderStyle: "dashed" },
  stepLabel: { flex: 1, marginLeft: 10, fontFamily: "Poppins_400Regular", fontSize: 13, lineHeight: 20, color: tone("#000") },
  stepStatus: { maxWidth: 95, marginLeft: 8, fontFamily: "Poppins_400Regular", fontSize: 12, lineHeight: 17, textAlign: "right", color: tone("rgba(0,0,0,0.4)") },
  muted: { color: tone("rgba(0,0,0,0.4)") },
  greenText: { color: GREEN },
  verdictCard: { gap: 2 },
  verdictLabel: { fontFamily: "Poppins_400Regular", fontSize: 11, color: tone("rgba(0,0,0,0.4)") },
  verdictTitle: { fontFamily: "Poppins_500Medium", fontSize: 15, lineHeight: 22, color: tone("#000") },
  verdictLink: { flexDirection: "row", alignItems: "center", gap: 2, marginTop: 4 },

  result: { paddingHorizontal: 20, paddingTop: 16, paddingBottom: 20 },
  symptom: { alignSelf: "flex-start", flexDirection: "row", alignItems: "center", gap: 10, height: 40, paddingHorizontal: 16, borderRadius: 100, backgroundColor: surface("#fff") },
  symptomDot: { width: 10, height: 10, borderRadius: 5, backgroundColor: GREEN },
  symptomText: { fontFamily: "Poppins_400Regular", fontSize: 13, color: tone("#000") },
  metaRow: { flexDirection: "row", alignItems: "center", gap: 10, marginTop: 10 },
  metaText: { flex: 1, fontFamily: "Poppins_400Regular", fontSize: 11, lineHeight: 16, color: tone("rgba(0,0,0,0.4)") },
  verdict: { fontFamily: "Poppins_500Medium", fontSize: 20, lineHeight: 28, color: tone("#000"), marginTop: 12 },
  tags: { flexDirection: "row", flexWrap: "wrap", gap: 10, marginTop: 12 },
  tag: { flexDirection: "row", alignItems: "center", gap: 10, height: 30, paddingHorizontal: 20, borderRadius: 100 },
  tagBlack: { backgroundColor: surface("#000") },
  tagGreen: { backgroundColor: GREEN },
  tagWhite: { backgroundColor: surface("#fff"), borderWidth: 1, borderColor: tone("rgba(0,0,0,0.1)") },
  tagWarn: { backgroundColor: surface("#FFD9D2") },
  tagText: { fontFamily: "Poppins_400Regular", fontSize: 13, color: tone("#000") },
  onAccent: { color: ON_ACCENT }, // text on green
  tagTextLight: { color: tone("#fff") },
  list: { gap: 16, marginTop: 20 },
  listRow: { flexDirection: "row", alignItems: "flex-start", gap: 11 },
  num: { width: 20, height: 20, borderRadius: 10, backgroundColor: surface("#E3E3E3"), alignItems: "center", justifyContent: "center", marginTop: 1 },
  numText: { fontFamily: "Poppins_500Medium", fontSize: 10, lineHeight: 14, color: tone("#000") },
  listText: { flex: 1, fontFamily: "Poppins_400Regular", fontSize: 13, lineHeight: 20, color: tone("#000") },
  listLead: { fontFamily: "Poppins_500Medium" },
  actions: { flexDirection: "row", alignItems: "center", gap: 10 },
  actionsGap: { marginBottom: 12 },
  proCard: { backgroundColor: surface("#000"), borderRadius: 25, padding: 20, marginTop: 16 },
  proLabelRow: { flexDirection: "row", alignItems: "center", gap: 11 },
  proLabel: { fontFamily: "Poppins_400Regular", fontSize: 11, color: GREEN },
  proTitle: { fontFamily: "Poppins_500Medium", fontSize: 20, lineHeight: 28, color: tone("#fff"), marginTop: 10 },
  proWhy: { fontFamily: "Poppins_400Regular", fontSize: 13, lineHeight: 20, color: tone("#fff"), marginTop: 2 },
  proChips: { flexDirection: "row", flexWrap: "wrap", gap: 10, marginTop: 10 },
  proChip: { height: 30, paddingHorizontal: 10, borderRadius: 100, backgroundColor: surface("#2A2A2A"), justifyContent: "center" },
  proChipText: { fontFamily: "Poppins_400Regular", fontSize: 13, color: tone("#fff") },
  nowCard: { backgroundColor: surface("#fff"), borderRadius: 25, padding: 20, marginTop: 20, gap: 15 },
  monoLabel: { fontFamily: MONO, fontSize: 11, letterSpacing: 1, color: tone("rgba(0,0,0,0.5)") },
  nowRow: { flexDirection: "row", alignItems: "flex-start", gap: 18 },
  nowIcon: { marginTop: 1 },
  nowText: { flex: 1, fontFamily: "Poppins_400Regular", fontSize: 13, lineHeight: 20, color: tone("#000") },
  disclaimer: { fontFamily: "Poppins_400Regular", fontSize: 13, lineHeight: 18, textAlign: "center", color: tone("rgba(0,0,0,0.4)"), marginBottom: 12, paddingHorizontal: 20 },
  shopBtn: { height: 58 },
  shopText: { fontFamily: "Poppins_500Medium", fontSize: 15, lineHeight: 22, includeFontPadding: false, textAlignVertical: "center", textAlign: "center", color: tone("#fff") },
  bigCircle: { width: 58, height: 58 },

  caseCard: { flexDirection: "row", alignItems: "center", gap: 18, backgroundColor: surface("#000"), borderRadius: 25, paddingHorizontal: 24, paddingVertical: 20 },
  caseText: { flex: 1, fontFamily: "Poppins_400Regular", fontSize: 13, lineHeight: 20, color: tone("rgba(255,255,255,0.6)") },
  caseDevice: { color: tone("#fff") },
  casePill: { height: 20, paddingHorizontal: 12, borderRadius: 100, backgroundColor: GREEN, justifyContent: "center" },
  casePillText: { fontFamily: "Poppins_400Regular", fontSize: 11, color: ON_ACCENT },
  nearBox: { flexDirection: "row", alignItems: "center", gap: 15, height: 44, paddingHorizontal: 20, marginTop: 10, borderRadius: 100, backgroundColor: surface("#fff"), borderWidth: 1, borderColor: tone("rgba(0,0,0,0.07)") },
  nearInput: { flex: 1, height: "100%", paddingVertical: 0, includeFontPadding: false, textAlignVertical: "center", fontFamily: "Poppins_400Regular", fontSize: 15, lineHeight: 22, color: tone("#000") },
  map: { width: "100%", height: 231, borderRadius: 25, marginTop: 10, backgroundColor: surface("#E8E8E8"), overflow: "hidden" },
  filters: { marginTop: 10, marginHorizontal: -20 },
  filterRow: { gap: 10, paddingHorizontal: 20 },
  filter: { height: 40, paddingHorizontal: 20, borderRadius: 100, backgroundColor: surface("#fff"), justifyContent: "center" },
  filterOn: { backgroundColor: surface("#000") },
  filterText: { fontFamily: "Poppins_400Regular", fontSize: 14, color: tone("#000") },
  shopCount: { marginTop: 15, marginBottom: 2 },
  shopCard: { backgroundColor: surface("#fff"), borderRadius: 25, padding: 20, marginTop: 10, gap: 18 },
  shopRow: { flexDirection: "row", alignItems: "center", gap: 10 },
  rank: { width: 30, height: 30, borderRadius: 15, backgroundColor: surface("#000"), alignItems: "center", justifyContent: "center" },
  rankOn: { backgroundColor: GREEN },
  rankText: { fontFamily: "Poppins_500Medium", fontSize: 12, color: ON_ACCENT },
  shopName: { flex: 1, fontFamily: "Poppins_500Medium", fontSize: 14, lineHeight: 20, color: tone("#000") },
  shopDist: { fontFamily: MONO, fontSize: 11, color: tone("rgba(0,0,0,0.5)") },
  shopHours: { flex: 1, fontFamily: "Poppins_400Regular", fontSize: 13, color: tone("#000") },
  tile: { position: "absolute", width: TILE, height: TILE },
  pin: { position: "absolute", width: 26, height: 26, borderRadius: 13, backgroundColor: GREEN, borderWidth: 2, borderColor: surface("#fff"), alignItems: "center", justifyContent: "center" },
  pinText: { fontFamily: "Poppins_600SemiBold", fontSize: 11, color: ON_ACCENT },
  youDot: { position: "absolute", width: 14, height: 14, borderRadius: 7, backgroundColor: surface("#000"), borderWidth: 3, borderColor: surface("#fff") },
  attribution: { position: "absolute", right: 12, bottom: 8, paddingHorizontal: 6, borderRadius: 6, backgroundColor: surface("rgba(255,255,255,0.8)"), fontFamily: "Poppins_400Regular", fontSize: 9, color: tone("rgba(0,0,0,0.6)") },
  callBtn: { borderWidth: 1, borderColor: tone("rgba(0,0,0,0.1)") },
  routeLine: { position: "absolute", left: 0, top: 0 },
  mapControls: { position: "absolute", right: 10, top: 10, gap: 6 },
  mapBtn: { width: 34, height: 34, borderRadius: 17, backgroundColor: surface("#fff"), alignItems: "center", justifyContent: "center" },
  routeTime: { fontFamily: "Poppins_600SemiBold", fontSize: 18, color: tone("#000") },
  modeChip: { height: 34, paddingHorizontal: 14 },
  routeSteps: { gap: 12 },
  turnIcon: { width: 30, height: 30, borderRadius: 15, backgroundColor: surface("#F2F2F2"), alignItems: "center", justifyContent: "center" },

  stepCount: { height: 45, paddingHorizontal: 20, borderRadius: 100, backgroundColor: surface("#fff"), alignItems: "center", justifyContent: "center" },
  stepCountText: { fontFamily: "Poppins_500Medium", fontSize: 15, color: tone("#000") },
  segments: { flexDirection: "row", gap: 5, paddingHorizontal: 20, marginTop: 16 },
  segment: { flex: 1, height: 6, borderRadius: 3, backgroundColor: surface("#DDDDDD"), overflow: "hidden" },
  segmentFill: { position: "absolute", left: 0, top: 0, right: 0, bottom: 0, backgroundColor: GREEN, transformOrigin: "left" },
  segmentDone: { backgroundColor: surface("#000") },
  guideTags: { marginTop: 4 },
  stepCard: { backgroundColor: surface("#fff"), borderRadius: 25, padding: 20, marginTop: 20 },
  stepTitle: { fontFamily: "Poppins_500Medium", fontSize: 20, lineHeight: 28, color: tone("#000"), marginTop: 4 },
  stepDetail: { fontFamily: "Poppins_400Regular", fontSize: 13, lineHeight: 20, color: tone("#000"), marginTop: 15, paddingHorizontal: 10 },
  toolsLabel: { marginTop: 20, marginBottom: -2 },
  toolChip: { backgroundColor: surface("#fff"), paddingHorizontal: 10 },
  warnCard: { flexDirection: "row", alignItems: "center", gap: 11, backgroundColor: surface("#000"), borderRadius: 25, padding: 20, marginTop: 10 },
  warnText: { flex: 1, fontFamily: "Poppins_400Regular", fontSize: 13, lineHeight: 20, color: tone("#fff") },
  backBtn: { width: 138, height: 58, borderRadius: 100, backgroundColor: surface("#fff"), alignItems: "center", justifyContent: "center" },
  backText: { fontFamily: "Poppins_500Medium", fontSize: 15, color: tone("#000") },
  nextBtn: { flex: 1, height: 58, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 10, borderRadius: 100, backgroundColor: surface("#000") },
  nextText: { fontFamily: "Poppins_500Medium", fontSize: 15, color: tone("#fff") },
  nextIcon: { width: 30, height: 30, borderRadius: 15, backgroundColor: GREEN, alignItems: "center", justifyContent: "center" },
  guideBtn: { flex: 1, height: 44, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 10, borderRadius: 100, backgroundColor: surface("#000") },
  guideText: { fontFamily: "Poppins_400Regular", fontSize: 15, color: tone("#fff") },
  savedBtn: { backgroundColor: surface("#000") },
  saveBtn: { minWidth: 88, height: 44, paddingHorizontal: 12, borderRadius: 100, backgroundColor: surface("#fff"), flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6 },
  bigSaveBtn: { height: 58 },
  saveText: { fontFamily: "Poppins_500Medium", fontSize: 12, lineHeight: 18, includeFontPadding: false, textAlignVertical: "center", color: tone("#000") },

  cancel: { alignSelf: "center", paddingHorizontal: 24, paddingVertical: 16, marginBottom: 12 },
  cancelText: { fontFamily: "Poppins_600SemiBold", fontSize: 15, color: tone("#000") },
});
}
DARK = true;
const DARK_SHEET = makeStyles();
DARK = false;
const LIGHT_SHEET = makeStyles();
let s = LIGHT_SHEET;
function applyTheme(dark: boolean) {
  DARK = dark;
  s = dark ? DARK_SHEET : LIGHT_SHEET;
}

