import { forwardRef, useEffect, useRef, useState } from "react";
import {
  Alert,
  Animated,
  Easing,
  Image,
  KeyboardAvoidingView,
  Linking,
  Platform,
  Pressable,
  ScrollView,
  Share,
  StyleSheet,
  Text,
  TextInput,
  View,
  useWindowDimensions,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { StatusBar } from "expo-status-bar";
import * as ImagePicker from "expo-image-picker";
import { Feather } from "@expo/vector-icons";
import * as Location from "expo-location";
import Svg, { Circle, Polyline, type CircleProps } from "react-native-svg";
import { useFonts } from "expo-font";
// Per-weight imports: the package root pulls in all 18 Poppins files.
import { Poppins_400Regular } from "@expo-google-fonts/poppins/400Regular";
import { Poppins_500Medium } from "@expo-google-fonts/poppins/500Medium";
import { Poppins_600SemiBold } from "@expo-google-fonts/poppins/600SemiBold";

type Question = { question: string; options: string[] };
type Diagnosis = {
  summary: string;
  title: string;
  category: "Hardware" | "Software" | "Both";
  difficulty: "Beginner-safe" | "Some skill" | "Pro repair";
  causes: { name: string; detail: string }[];
  steps: { title: string; detail: string; tools: string[]; warning: string }[]; // the Repair Guide
  minutes: number;
  // Shown instead of the above on the "needs a professional" page (difficulty "Pro repair").
  problem: string;
  why: string;
  risk: string;
  confidence: number;
  now: { icon: string; text: string }[];
  shopServices: string[]; // filter chips on the Repair Shops page
};
type FeatherName = keyof typeof Feather.glyphMap;
// What the screen shows. toApi() turns these into OpenAI-style messages for the API route.
type Turn =
  | { role: "user"; image?: string; text?: string; answers?: string }
  | {
      role: "assistant";
      text: string;
      questions: Question[];
      picked: (string | undefined)[];
      device?: string; // short status labels for the Diagnosing screen
      deviceType?: string;
      finding?: string;
      diagnosis?: Diagnosis; // set on the verdict turn; shown on the Diagnosis page
      seconds?: number; // how long the diagnosis request took
      saved?: boolean;
    };
type Part = { type: "text"; text: string } | { type: "image_url"; image_url: { url: string } };
// Diagnosing screen state. stage = the 1-based checklist row in progress; 5 = all done.
type Diag = { photo: boolean; device?: string; finding?: string; software?: string; stage: number };

const TYPES = ["image/png", "image/jpeg", "image/gif", "image/webp"];
const GREEN = "#7CEB5A";
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
const NATIVE = Platform.OS !== "web"; // Animated's native driver doesn't exist on web
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
  const [turns, setTurns] = useState<Turn[]>([]);
  const [text, setText] = useState("");
  const [image, setImage] = useState<string | null>(null); // data URL
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [startedAt, setStartedAt] = useState<Date | null>(null);
  const [diag, setDiag] = useState<Diag | null>(null);
  const [resultIdx, setResultIdx] = useState<number | null>(null); // turn shown on the Diagnosis page
  const [guideStep, setGuideStep] = useState<number | null>(null); // Repair Guide step on screen, null = closed
  const [showShops, setShowShops] = useState(false); // Repair Shops page, opened from "Find a repair shop"
  const scroll = useRef<ScrollView>(null);
  const input = useRef<TextInput>(null);
  const run = useRef(0); // bumped by cancel() so a late reply from a cancelled request is ignored
  const abort = useRef<AbortController | null>(null);

  const last = turns[turns.length - 1];
  const pending = last?.role === "assistant" && last.questions.length > 0 && !busy ? last : null;

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
    const url = await pick(Platform.OS !== "web");
    if (!url) return;
    setImage(url);
    input.current?.focus();
  }

  function choosePhoto() {
    const attach = async (camera: boolean) => {
      const url = await pick(camera);
      if (url) setImage(url);
    };
    // Alert buttons are a no-op on web, where the picker is a file dialog anyway.
    if (Platform.OS === "web") return attach(false);
    Alert.alert("Add a photo", undefined, [
      { text: "Take photo", onPress: () => attach(true) },
      { text: "Choose from library", onPress: () => attach(false) },
      { text: "Cancel", style: "cancel" },
    ]);
  }

  function reset() {
    if (busy) return;
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

  function toggleSaved(i: number) {
    setTurns((ts) => ts.map((t, j) => (j === i && t.role === "assistant" ? { ...t, saved: !t.saved } : t)));
  }

  function menu() {
    if (Platform.OS === "web") return reset();
    Alert.alert("Diagnosis", undefined, [
      { text: "Start a new diagnosis", onPress: reset },
      { text: "Cancel", style: "cancel" },
    ]);
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

    const next: Turn[] = [...turns, { role: "user", image: image ?? undefined, text: text.trim() || undefined, answers }];
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
      const r = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(toApi(next)),
        signal: ctrl.signal,
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error);
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
      if (data.diagnosis) openResult(next.length);
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

  if (!fontsLoaded) return null;

  const home = turns.length === 0 && !busy;
  const time = startedAt?.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }).toUpperCase();
  const shown = resultIdx === null ? undefined : turns[resultIdx];
  const result = shown?.role === "assistant" && shown.diagnosis ? shown : undefined;

  return (
    <SafeAreaView style={s.screen} edges={["top", "left", "right"]}>
      <StatusBar style="dark" />
      {diag ? (
        <Diagnosing d={diag} onCancel={cancel} />
      ) : result && guideStep !== null ? (
        <Guide d={result.diagnosis!} step={guideStep} onStep={setGuideStep} onClose={() => setGuideStep(null)} />
      ) : result && showShops ? (
        <Shops t={result} onBack={() => setShowShops(false)} />
      ) : (
        <KeyboardAvoidingView style={s.flex} behavior={Platform.OS === "ios" ? "padding" : undefined}>
          {result ? (
            <Result t={result} onBack={() => setResultIdx(null)} />
          ) : home ? (
            <>
              <View style={s.header}>
                <View style={s.circle}>
                  <Feather name="smartphone" size={20} color="#000" />
                </View>
                <Text style={s.title}>FixByte AI</Text>
                {/* ponytail: initial-letter avatar; swap for a profile photo via <Image> when there's one */}
                <View style={[s.circle, s.avatar]}>
                  <Text style={s.avatarText}>K</Text>
                </View>
              </View>
              <View style={s.home}>
                <Text style={s.greeting}>Hey, Kiel,</Text>
                <Text style={s.greetingSub}>What needs fixing today?</Text>
                <View style={s.cards}>
                  <Card icon="camera" title="Scan a photo" subtitle="AI spots the damage" onPress={scan} />
                  <Card icon="message-square" title="Describe it" subtitle="Type the symptoms" onPress={() => input.current?.focus()} />
                </View>
                {!!error && <Text style={s.error}>{error}</Text>}
              </View>
            </>
          ) : (
            <>
              <View style={s.header}>
                <Pressable onPress={reset} style={s.circle} accessibilityLabel="Back">
                  <Feather name="arrow-left" size={20} color="#000" />
                </Pressable>
                <Text style={s.title}>New diagnosis</Text>
                <Pressable onPress={menu} style={s.circle} accessibilityLabel="More options">
                  <Feather name="more-horizontal" size={20} color="#000" />
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
                    <View key={i} style={s.userTurn}>
                      {t.image && (
                        <View style={s.photo}>
                          <Image source={{ uri: t.image }} style={s.photoImg} accessibilityLabel="Your photo" />
                        </View>
                      )}
                      {t.text && (
                        <View style={[s.bubble, s.user]}>
                          <Text selectable style={[s.msgText, s.userText]}>{t.text}</Text>
                        </View>
                      )}
                    </View>
                  ) : t.diagnosis ? (
                    // The verdict lives on the Diagnosis page; the chat keeps a card that reopens it.
                    <Pressable key={i} onPress={() => openResult(i)} style={[s.bubble, s.assistant, s.verdictCard]}>
                      <Text style={s.verdictLabel}>DIAGNOSIS</Text>
                      <Text style={s.verdictTitle}>{t.diagnosis.title}</Text>
                      <View style={s.verdictLink}>
                        <Text style={[s.msgText, s.dim]}>View diagnosis</Text>
                        <Feather name="chevron-right" size={16} color="rgba(0,0,0,0.5)" />
                      </View>
                    </Pressable>
                  ) : (
                    <View key={i} style={s.assistantTurn}>
                      <View style={[s.bubble, s.assistant]}>
                        <Text selectable style={s.msgText}>{t.text}</Text>
                      </View>
                      {t.questions.length > 0 && (
                        <View style={[s.bubble, s.assistant, s.qCard]}>
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
                        </View>
                      )}
                    </View>
                  ),
                )}
                {busy && (
                  <View style={[s.bubble, s.assistant]}>
                    <Text style={[s.msgText, s.dim]}>Diagnosing…</Text>
                  </View>
                )}
                {!!error && <Text style={s.error}>{error}</Text>}
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
                      <Feather name="x" size={14} color="#fff" />
                    </Pressable>
                  </View>
                )}
                <View style={s.bar}>
                  <Pressable onPress={choosePhoto} hitSlop={12} accessibilityLabel="Add photo">
                    <Feather name="camera" size={17} color="#000" />
                  </Pressable>
                  <TextInput
                    ref={input}
                    value={text}
                    onChangeText={setText}
                    onSubmitEditing={() => send()}
                    placeholder={home ? "Describe the problem..." : result ? "Ask a follow-up..." : "Add more details..."}
                    placeholderTextColor="rgba(0,0,0,0.2)"
                    accessibilityLabel="Message"
                    style={s.input}
                  />
                  <Pressable onPress={() => send()} disabled={busy} style={[s.send, busy && s.disabled]} accessibilityLabel="Send">
                    <Feather name="arrow-up" size={18} color="#fff" />
                  </Pressable>
                </View>
              </>
            )}
          </View>
        </KeyboardAvoidingView>
      )}
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

// Web Mercator position in world pixels at a zoom level (how map tiles are laid out).
function world({ lat, lng }: Point, zoom: number) {
  const size = TILE * 2 ** zoom;
  const sin = Math.sin((lat * Math.PI) / 180);
  return { x: ((lng + 180) / 360) * size, y: (0.5 - Math.log((1 + sin) / (1 - sin)) / (4 * Math.PI)) * size };
}

// Free map: Esri's light gray tiles laid out by hand, with numbered shop pins (CARTO's free tiles now need a key).
// No native map package or API key; the attribution is required by the tiles' terms.
function TileMap({ you, center, shops, route }: { you?: Point; center: Point; shops: Shop[]; route?: Point[] }) {
  const [w, setW] = useState(0);
  const h = 231;
  const points = route ? [...route] : [...shops, ...(you ? [you] : [])]; // with a route, zoom to fit just the route
  if (!points.length) points.push(center);

  // Closest zoom (up to street level) that still fits every pin with some padding.
  let zoom = 16;
  for (; zoom > 3; zoom--) {
    const ps = points.map((p) => world(p, zoom));
    const xs = ps.map((p) => p.x);
    const ys = ps.map((p) => p.y);
    if (Math.max(...xs) - Math.min(...xs) <= w - 60 && Math.max(...ys) - Math.min(...ys) <= h - 60) break;
  }
  const ps = points.map((p) => world(p, zoom));
  const midX = (Math.min(...ps.map((p) => p.x)) + Math.max(...ps.map((p) => p.x))) / 2;
  const midY = (Math.min(...ps.map((p) => p.y)) + Math.max(...ps.map((p) => p.y))) / 2;
  const left = midX - w / 2;
  const top = midY - h / 2;

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
    <View style={s.map} onLayout={(e) => setW(e.nativeEvent.layout.width)} accessibilityLabel="Map of nearby repair shops">
      {tiles.map(({ x, y }) => (
        <Image
          key={`${zoom}/${x}/${y}`}
          source={{ uri: `https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Light_Gray_Base/MapServer/tile/${zoom}/${y}/${x}` }}
          style={[s.tile, { left: x * TILE - left, top: y * TILE - top }]}
        />
      ))}
      {w > 0 && line && (
        // A white casing under the black line keeps it readable over streets.
        <Svg width={w} height={h} style={s.routeLine} pointerEvents="none">
          <Polyline points={line} fill="none" stroke="#fff" strokeWidth={8} strokeLinejoin="round" strokeLinecap="round" />
          <Polyline points={line} fill="none" stroke="#000" strokeWidth={4} strokeLinejoin="round" strokeLinecap="round" />
        </Svg>
      )}
      {w > 0 && you && <View style={[s.youDot, at(you, 14)]} />}
      {w > 0 &&
        shops.map((shop, i) => (
          <View key={shop.id} style={[s.pin, at(shop, 26)]}>
            <Text style={s.pinText}>{i + 1}</Text>
          </View>
        ))}
      <Text style={s.attribution}>Powered by Esri · © OpenStreetMap</Text>
    </View>
  );
}

const NEEDS = { "Pro repair": "Needs a pro", "Some skill": "Some skill", "Beginner-safe": "Beginner-safe" } as const;

function Shops({ t, onBack }: { t: Extract<Turn, { role: "assistant" }>; onBack: () => void }) {
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
  const scroll = useRef<ScrollView>(null);

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
        if (!perm.granted) throw new Error("Location is off. Type a city above to search there.");
        const p = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
        setLoc({ lat: p.coords.latitude, lng: p.coords.longitude });
        // City and region names for the labels; reverse geocoding isn't available on web, so they're optional.
        Location.reverseGeocodeAsync(p.coords)
          .then(([a]) => setArea({ city: a?.city ?? a?.subregion ?? undefined, region: a?.region ?? undefined }))
          .catch(() => {});
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
        setLoading(false);
      }
    })();
  }, []);

  useEffect(() => {
    if (!loc && !near) return;
    let live = true; // ignore a slower, older search finishing after a newer one
    setLoading(true);
    setError("");
    fetch("/api/shops", {
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
          <Feather name="arrow-left" size={20} color="#000" />
        </Pressable>
        <Text style={s.title}>Repair Shops</Text>
        <View style={s.circle} accessibilityLabel={t.device}>
          <Feather name={icon} size={20} color="#000" />
        </View>
      </View>

      <ScrollView ref={scroll} style={s.flex} contentContainerStyle={s.result} keyboardShouldPersistTaps="handled">
        <View style={s.caseCard}>
          <Feather name={icon} size={24} color="#fff" />
          <Text style={s.caseText} numberOfLines={2}>
            {t.device && <Text style={s.caseDevice}>{t.device} · </Text>}
            {d.summary}
          </Text>
          <View style={s.casePill}>
            <Text style={s.casePillText}>{NEEDS[d.difficulty] ?? d.difficulty}</Text>
          </View>
        </View>

        <View style={s.nearBox}>
          <Feather name="map-pin" size={17} color="#000" />
          <TextInput
            value={nearText}
            onChangeText={setNearText}
            onSubmitEditing={() => setNear(nearText.trim())}
            placeholder={area.city ? `Near ${area.city}` : "Near you"}
            placeholderTextColor="rgba(0,0,0,0.2)"
            returnKeyType="search"
            accessibilityLabel="Search near a place"
            style={s.nearInput}
          />
        </View>

        {/* Shown around the user while shops load, so the layout doesn't jump when they arrive. */}
        {(data || loc) && <TileMap you={near ? undefined : (loc ?? undefined)} center={data?.center ?? loc!} shops={shops} route={route?.line} />}

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
                    <Feather name="clock" size={15} color="rgba(0,0,0,0.5)" />
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
                          <Feather name="x" size={16} color="#000" />
                        </Pressable>
                      </View>
                      <View style={s.routeSteps}>
                        {route.steps.map((st, k) => (
                          <View key={k} style={s.shopRow}>
                            <View style={s.turnIcon}>
                              <Feather name={st.icon} size={15} color="#000" />
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
                      <Feather name="phone" size={20} color="#000" />
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

function Bookmark({ saved, big, onPress }: { saved: boolean; big?: boolean; onPress: () => void }) {
  return (
    <Pressable
      onPress={onPress}
      style={[s.circle, big && s.bigCircle, saved && s.savedBtn]}
      accessibilityLabel={saved ? "Remove bookmark" : "Bookmark diagnosis"}
      accessibilityState={{ selected: saved }}
    >
      <Feather name="bookmark" size={big ? 22 : 20} color={saved ? "#fff" : "#000"} />
    </Pressable>
  );
}

function Result({ t, onBack }: { t: Extract<Turn, { role: "assistant" }>; onBack: () => void }) {
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
          <Feather name="arrow-left" size={20} color="#000" />
        </Pressable>
        <Text style={s.title}>Diagnosis</Text>
        {pro ? (
          // The professional page's design shows the device type here instead of Share.
          <View style={s.circle} accessibilityLabel={t.device}>
            <Feather name={DEVICE_ICONS[t.deviceType ?? ""] ?? "cpu"} size={20} color="#000" />
          </View>
        ) : (
          <Pressable
            onPress={() => Share.share({ message: `${d.summary}${t.device ? ` (${t.device})` : ""}\n\n${t.text}` })}
            style={s.circle}
            accessibilityLabel="Share diagnosis"
          >
            <Feather name="share" size={20} color="#000" />
          </Pressable>
        )}
      </View>

      <ScrollView style={s.flex} contentContainerStyle={s.result}>
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
                  <Feather name={n.icon as FeatherName} size={17} color="#000" style={s.nowIcon} />
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
                <Feather name={diff.icon} size={16} color="#000" />
                <Text style={s.tagText}>{d.difficulty}</Text>
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

function Guide({ d, step, onStep, onClose }: { d: Diagnosis; step: number; onStep: (i: number) => void; onClose: () => void }) {
  const st = d.steps[step];
  const last = step === d.steps.length - 1;
  const cat = TAGS.category[d.category] ?? TAGS.category.Hardware;
  const diff = TAGS.difficulty[d.difficulty] ?? TAGS.difficulty["Some skill"];

  return (
    <View style={s.flex}>
      <View style={s.header}>
        <Pressable onPress={onClose} style={s.circle} accessibilityLabel="Back to diagnosis">
          <Feather name="arrow-left" size={20} color="#000" />
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
          <View key={i} style={[s.segment, i < step && s.segmentDone, i === step && s.segmentNow]} />
        ))}
      </View>

      {/* Keyed by step so each step starts scrolled to the top. */}
      <ScrollView key={step} style={s.flex} contentContainerStyle={s.result}>
        <View style={[s.tags, s.guideTags]}>
          <View style={[s.tag, s[diff.style]]}>
            <Feather name={diff.icon} size={16} color="#000" />
            <Text style={s.tagText}>{d.difficulty}</Text>
          </View>
          <View style={[s.tag, s.tagWhite]}>
            <Feather name="clock" size={16} color="#000" />
            <Text style={s.tagText}>{minutesLabel(d.minutes)}</Text>
          </View>
          <View style={[s.tag, s.tagWhite]}>
            <Feather name={cat.icon} size={16} color="#000" />
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
        <Pressable onPress={() => (step === 0 ? onClose() : onStep(step - 1))} style={s.backBtn} accessibilityRole="button">
          <Text style={s.backText}>Back</Text>
        </Pressable>
        <Pressable onPress={() => (last ? onClose() : onStep(step + 1))} style={s.nextBtn} accessibilityRole="button">
          <Text style={s.nextText}>{last ? "Finish" : "Next step"}</Text>
          <View style={s.nextIcon}>
            <Feather name={last ? "check" : "arrow-right"} size={16} color="#000" />
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
          <Feather name="arrow-left" size={20} color="#000" />
        </Pressable>
        <Text style={s.title}>Diagnosing</Text>
        <View style={s.headerSpacer} />
      </View>

      <View style={[s.ringBox, { width: size, height: size }]}>
        {/* Rotated -90° so the arc starts at 12 o'clock and fills clockwise. */}
        <Svg width={size} height={size} style={s.ringSvg}>
          <Circle cx={size / 2} cy={size / 2} r={r} stroke="#E3E3E3" strokeWidth={3} fill="none" />
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

// Done: pops in. Active: pulsing dot with a ripple. Next: dashed circle slowly turning.
function StepIcon({ state }: { state: "done" | "active" | "next" }) {
  const v = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    const anim =
      state === "done"
        ? Animated.spring(v, { toValue: 1, friction: 5, tension: 140, useNativeDriver: NATIVE })
        : Animated.loop(
            Animated.timing(v, {
              toValue: 1,
              duration: state === "active" ? 1200 : 6000,
              easing: state === "active" ? Easing.out(Easing.quad) : Easing.linear,
              useNativeDriver: NATIVE,
            }),
          );
    anim.start();
    return () => anim.stop();
  }, [state, v]);

  if (state === "done") {
    return (
      <Animated.View style={[s.stepIcon, s.stepDone, { transform: [{ scale: v }] }]}>
        <Feather name="check" size={16} color={GREEN} />
      </Animated.View>
    );
  }
  if (state === "active") {
    const ripple = {
      opacity: v.interpolate({ inputRange: [0, 1], outputRange: [0.45, 0] }),
      transform: [{ scale: v.interpolate({ inputRange: [0, 1], outputRange: [1, 1.7] }) }],
    };
    const pulse = { transform: [{ scale: v.interpolate({ inputRange: [0, 0.5, 1], outputRange: [1, 0.6, 1] }) }] };
    return (
      <View>
        <Animated.View style={[s.stepIcon, s.stepRipple, ripple]} />
        <View style={[s.stepIcon, s.stepActive]}>
          <Animated.View style={[s.stepDot, pulse]} />
        </View>
      </View>
    );
  }
  const rotate = v.interpolate({ inputRange: [0, 1], outputRange: ["0deg", "360deg"] });
  return <Animated.View style={[s.stepIcon, s.stepNext, { transform: [{ rotate }] }]} />;
}

function Card(p: { icon: "camera" | "message-square"; title: string; subtitle: string; onPress: () => void }) {
  return (
    <Pressable onPress={p.onPress} style={s.card}>
      <View style={s.cardIcon}>
        <Feather name={p.icon} size={18} color="#fff" />
      </View>
      <Text style={s.cardTitle}>{p.title}</Text>
      <Text style={s.cardSub}>{p.subtitle}</Text>
    </Pressable>
  );
}

const s = StyleSheet.create({
  screen: { flex: 1, backgroundColor: "#F3F3F3" },
  flex: { flex: 1 },

  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 20 },
  circle: { width: 45, height: 45, borderRadius: 100, backgroundColor: "#fff", alignItems: "center", justifyContent: "center" },
  avatar: { borderWidth: 1, borderColor: "#D5E2D5", backgroundColor: "#EAF7E5" },
  avatarText: { fontFamily: "Poppins_600SemiBold", fontSize: 17, color: "#000" },
  title: { fontFamily: "Poppins_600SemiBold", fontSize: 15, lineHeight: 22, color: "#000" },
  time: { fontFamily: "Poppins_400Regular", fontSize: 11, lineHeight: 16, textAlign: "center", color: "#000", marginTop: 4 },

  home: { flex: 1, justifyContent: "center", paddingHorizontal: 20 },
  greeting: { fontFamily: "Poppins_500Medium", fontSize: 32, lineHeight: 44, textAlign: "center", color: "#000" },
  greetingSub: { fontFamily: "Poppins_500Medium", fontSize: 20, lineHeight: 28, textAlign: "center", color: "#000", marginBottom: 20 },
  cards: { flexDirection: "row", gap: 10 },
  card: { flex: 1, minHeight: 138, backgroundColor: "#fff", borderRadius: 25, padding: 20 },
  cardIcon: { width: 37, height: 37, borderRadius: 10, backgroundColor: "#000", alignItems: "center", justifyContent: "center", marginBottom: 18 },
  cardTitle: { fontFamily: "Poppins_500Medium", fontSize: 15, lineHeight: 22, color: "#000" },
  cardSub: { fontFamily: "Poppins_400Regular", fontSize: 13, lineHeight: 20, color: "rgba(0,0,0,0.5)" },

  log: { paddingHorizontal: 20, paddingTop: 16, paddingBottom: 12, gap: 10 },
  userTurn: { alignItems: "flex-end", gap: 10 },
  assistantTurn: { alignItems: "flex-start", gap: 10 },
  photo: { width: 150, height: 178, borderRadius: 28, borderWidth: 3, borderColor: "#fff", overflow: "hidden", backgroundColor: "#ddd" },
  photoImg: { width: "100%", height: "100%" },
  bubble: { paddingVertical: 14, paddingHorizontal: 20, borderRadius: 25, maxWidth: "80%" },
  user: { backgroundColor: "#000", borderBottomRightRadius: 6 },
  assistant: { alignSelf: "flex-start", backgroundColor: "#fff" },
  qCard: { paddingVertical: 20, gap: 16 },
  msgText: { fontFamily: "Poppins_400Regular", fontSize: 13, lineHeight: 20, color: "#000" },
  userText: { color: "#fff" },
  dim: { color: "rgba(0,0,0,0.5)" },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: 6, marginTop: 10 },
  chip: { paddingHorizontal: 20, height: 30, borderRadius: 100, borderWidth: 1, borderColor: "rgba(0,0,0,0.1)", justifyContent: "center", backgroundColor: "#fff" },
  chipOn: { backgroundColor: "#000", borderColor: "#000" },
  chipText: { fontFamily: "Poppins_400Regular", fontSize: 13, color: "#000" },
  chipTextOn: { color: "#fff" },
  error: { fontFamily: "Poppins_400Regular", color: "#dc2626", textAlign: "center", marginTop: 12 },

  footer: { paddingHorizontal: 20, paddingBottom: 20, paddingTop: 8 },
  hint: { fontFamily: "Poppins_400Regular", fontSize: 13, lineHeight: 20, textAlign: "center", color: "rgba(0,0,0,0.4)", marginBottom: 12 },
  preview: { alignSelf: "flex-start", marginBottom: 8, marginLeft: 8 },
  thumb: { width: 64, height: 64, borderRadius: 14 },
  remove: { position: "absolute", top: -6, right: -6, width: 22, height: 22, borderRadius: 11, backgroundColor: "#000", alignItems: "center", justifyContent: "center" },
  bar: {
    height: 59,
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#fff",
    borderWidth: 1,
    borderColor: "rgba(0,0,0,0.07)",
    borderRadius: 100,
    paddingLeft: 20,
    paddingRight: 6,
  },
  input: { flex: 1, height: "100%", marginLeft: 15, fontFamily: "Poppins_400Regular", fontSize: 15, color: "#000" },
  send: { width: 45, height: 45, borderRadius: 100, backgroundColor: GREEN, alignItems: "center", justifyContent: "center" },
  disabled: { opacity: 0.5 },

  diagPage: { flexGrow: 1 },
  headerSpacer: { width: 45 },
  ringBox: { alignSelf: "center", marginTop: 45, alignItems: "center", justifyContent: "center" },
  ringSvg: { position: "absolute", transform: [{ rotate: "-90deg" }] },
  ring: { position: "absolute", top: 0, left: 0, right: 0, bottom: 0 },
  // Centered on the arc's stroke, which sits RING_PAD in from the edge.
  ringDot: { position: "absolute", top: RING_PAD - 5, left: "50%", marginLeft: -5, width: 10, height: 10, borderRadius: 5, backgroundColor: GREEN },
  innerRing: { borderWidth: 1.5, borderColor: "#E3E3E3" },
  diagTitle: { fontFamily: "Poppins_500Medium", fontSize: 32, lineHeight: 48, textAlign: "center", color: "#000", marginTop: 20 },
  diagSub: { fontFamily: "Poppins_400Regular", fontSize: 15, lineHeight: 22, textAlign: "center", color: "#000" },
  diagCard: { backgroundColor: "#fff", borderRadius: 25, marginHorizontal: 20, marginTop: 16, paddingHorizontal: 20, paddingVertical: 25, gap: 20 },
  stepRow: { flexDirection: "row", alignItems: "center" },
  stepIcon: { width: 30, height: 30, borderRadius: 15, alignItems: "center", justifyContent: "center" },
  stepDone: { backgroundColor: "#000" },
  stepActive: { borderWidth: 1.5, borderColor: GREEN, backgroundColor: "#fff" },
  stepDot: { width: 10, height: 10, borderRadius: 5, backgroundColor: GREEN },
  stepRipple: { position: "absolute", backgroundColor: GREEN },
  stepNext: { borderWidth: 1.5, borderColor: "rgba(0,0,0,0.4)", borderStyle: "dashed" },
  stepLabel: { flex: 1, marginLeft: 10, fontFamily: "Poppins_400Regular", fontSize: 13, lineHeight: 20, color: "#000" },
  stepStatus: { maxWidth: 95, marginLeft: 8, fontFamily: "Poppins_400Regular", fontSize: 12, lineHeight: 17, textAlign: "right", color: "rgba(0,0,0,0.4)" },
  muted: { color: "rgba(0,0,0,0.4)" },
  greenText: { color: GREEN },
  verdictCard: { gap: 2 },
  verdictLabel: { fontFamily: "Poppins_400Regular", fontSize: 11, color: "rgba(0,0,0,0.4)" },
  verdictTitle: { fontFamily: "Poppins_500Medium", fontSize: 15, lineHeight: 22, color: "#000" },
  verdictLink: { flexDirection: "row", alignItems: "center", gap: 2, marginTop: 4 },

  result: { paddingHorizontal: 20, paddingTop: 16, paddingBottom: 20 },
  symptom: { alignSelf: "flex-start", flexDirection: "row", alignItems: "center", gap: 10, height: 40, paddingHorizontal: 16, borderRadius: 100, backgroundColor: "#fff" },
  symptomDot: { width: 10, height: 10, borderRadius: 5, backgroundColor: GREEN },
  symptomText: { fontFamily: "Poppins_400Regular", fontSize: 13, color: "#000" },
  metaRow: { flexDirection: "row", alignItems: "center", gap: 10, marginTop: 10 },
  metaText: { flex: 1, fontFamily: "Poppins_400Regular", fontSize: 11, lineHeight: 16, color: "rgba(0,0,0,0.4)" },
  verdict: { fontFamily: "Poppins_500Medium", fontSize: 20, lineHeight: 28, color: "#000", marginTop: 12 },
  tags: { flexDirection: "row", flexWrap: "wrap", gap: 10, marginTop: 12 },
  tag: { flexDirection: "row", alignItems: "center", gap: 10, height: 30, paddingHorizontal: 20, borderRadius: 100 },
  tagBlack: { backgroundColor: "#000" },
  tagGreen: { backgroundColor: GREEN },
  tagWhite: { backgroundColor: "#fff", borderWidth: 1, borderColor: "rgba(0,0,0,0.1)" },
  tagWarn: { backgroundColor: "#FFD9D2" },
  tagText: { fontFamily: "Poppins_400Regular", fontSize: 13, color: "#000" },
  tagTextLight: { color: "#fff" },
  list: { gap: 16, marginTop: 20 },
  listRow: { flexDirection: "row", alignItems: "flex-start", gap: 11 },
  num: { width: 20, height: 20, borderRadius: 10, backgroundColor: "#E3E3E3", alignItems: "center", justifyContent: "center", marginTop: 1 },
  numText: { fontFamily: "Poppins_500Medium", fontSize: 10, lineHeight: 14, color: "#000" },
  listText: { flex: 1, fontFamily: "Poppins_400Regular", fontSize: 13, lineHeight: 20, color: "#000" },
  listLead: { fontFamily: "Poppins_500Medium" },
  actions: { flexDirection: "row", alignItems: "center", gap: 10 },
  actionsGap: { marginBottom: 12 },
  proCard: { backgroundColor: "#000", borderRadius: 25, padding: 20, marginTop: 16 },
  proLabelRow: { flexDirection: "row", alignItems: "center", gap: 11 },
  proLabel: { fontFamily: "Poppins_400Regular", fontSize: 11, color: GREEN },
  proTitle: { fontFamily: "Poppins_500Medium", fontSize: 20, lineHeight: 28, color: "#fff", marginTop: 10 },
  proWhy: { fontFamily: "Poppins_400Regular", fontSize: 13, lineHeight: 20, color: "#fff", marginTop: 2 },
  proChips: { flexDirection: "row", flexWrap: "wrap", gap: 10, marginTop: 10 },
  proChip: { height: 30, paddingHorizontal: 10, borderRadius: 100, backgroundColor: "#2A2A2A", justifyContent: "center" },
  proChipText: { fontFamily: "Poppins_400Regular", fontSize: 13, color: "#fff" },
  nowCard: { backgroundColor: "#fff", borderRadius: 25, padding: 20, marginTop: 20, gap: 15 },
  monoLabel: { fontFamily: MONO, fontSize: 11, letterSpacing: 1, color: "rgba(0,0,0,0.5)" },
  nowRow: { flexDirection: "row", alignItems: "flex-start", gap: 18 },
  nowIcon: { marginTop: 1 },
  nowText: { flex: 1, fontFamily: "Poppins_400Regular", fontSize: 13, lineHeight: 20, color: "#000" },
  disclaimer: { fontFamily: "Poppins_400Regular", fontSize: 13, lineHeight: 18, textAlign: "center", color: "rgba(0,0,0,0.4)", marginBottom: 12, paddingHorizontal: 20 },
  shopBtn: { height: 58 },
  shopText: { fontFamily: "Poppins_500Medium", fontSize: 15, color: "#fff" },
  bigCircle: { width: 58, height: 58 },

  caseCard: { flexDirection: "row", alignItems: "center", gap: 18, backgroundColor: "#000", borderRadius: 25, paddingHorizontal: 24, paddingVertical: 20 },
  caseText: { flex: 1, fontFamily: "Poppins_400Regular", fontSize: 13, lineHeight: 20, color: "rgba(255,255,255,0.6)" },
  caseDevice: { color: "#fff" },
  casePill: { height: 20, paddingHorizontal: 12, borderRadius: 100, backgroundColor: GREEN, justifyContent: "center" },
  casePillText: { fontFamily: "Poppins_400Regular", fontSize: 11, color: "#000" },
  nearBox: { flexDirection: "row", alignItems: "center", gap: 15, height: 44, paddingHorizontal: 20, marginTop: 10, borderRadius: 100, backgroundColor: "#fff", borderWidth: 1, borderColor: "rgba(0,0,0,0.07)" },
  nearInput: { flex: 1, height: "100%", fontFamily: "Poppins_400Regular", fontSize: 15, color: "#000" },
  map: { width: "100%", height: 231, borderRadius: 25, marginTop: 10, backgroundColor: "#E8E8E8", overflow: "hidden" },
  filters: { marginTop: 10, marginHorizontal: -20 },
  filterRow: { gap: 10, paddingHorizontal: 20 },
  filter: { height: 40, paddingHorizontal: 20, borderRadius: 100, backgroundColor: "#fff", justifyContent: "center" },
  filterOn: { backgroundColor: "#000" },
  filterText: { fontFamily: "Poppins_400Regular", fontSize: 14, color: "#000" },
  shopCount: { marginTop: 15, marginBottom: 2 },
  shopCard: { backgroundColor: "#fff", borderRadius: 25, padding: 20, marginTop: 10, gap: 18 },
  shopRow: { flexDirection: "row", alignItems: "center", gap: 10 },
  rank: { width: 30, height: 30, borderRadius: 15, backgroundColor: "#000", alignItems: "center", justifyContent: "center" },
  rankOn: { backgroundColor: GREEN },
  rankText: { fontFamily: "Poppins_500Medium", fontSize: 12, color: "#000" },
  shopName: { flex: 1, fontFamily: "Poppins_500Medium", fontSize: 14, lineHeight: 20, color: "#000" },
  shopDist: { fontFamily: MONO, fontSize: 11, color: "rgba(0,0,0,0.5)" },
  shopHours: { flex: 1, fontFamily: "Poppins_400Regular", fontSize: 13, color: "#000" },
  tile: { position: "absolute", width: TILE, height: TILE },
  pin: { position: "absolute", width: 26, height: 26, borderRadius: 13, backgroundColor: GREEN, borderWidth: 2, borderColor: "#fff", alignItems: "center", justifyContent: "center" },
  pinText: { fontFamily: "Poppins_600SemiBold", fontSize: 11, color: "#000" },
  youDot: { position: "absolute", width: 14, height: 14, borderRadius: 7, backgroundColor: "#000", borderWidth: 3, borderColor: "#fff" },
  attribution: { position: "absolute", right: 12, bottom: 8, paddingHorizontal: 6, borderRadius: 6, backgroundColor: "rgba(255,255,255,0.8)", fontFamily: "Poppins_400Regular", fontSize: 9, color: "rgba(0,0,0,0.6)" },
  callBtn: { borderWidth: 1, borderColor: "rgba(0,0,0,0.1)" },
  routeLine: { position: "absolute", left: 0, top: 0 },
  routeTime: { fontFamily: "Poppins_600SemiBold", fontSize: 18, color: "#000" },
  modeChip: { height: 34, paddingHorizontal: 14 },
  routeSteps: { gap: 12 },
  turnIcon: { width: 30, height: 30, borderRadius: 15, backgroundColor: "#F2F2F2", alignItems: "center", justifyContent: "center" },

  stepCount: { height: 45, paddingHorizontal: 20, borderRadius: 100, backgroundColor: "#fff", alignItems: "center", justifyContent: "center" },
  stepCountText: { fontFamily: "Poppins_500Medium", fontSize: 15, color: "#000" },
  segments: { flexDirection: "row", gap: 5, paddingHorizontal: 20, marginTop: 16 },
  segment: { flex: 1, height: 6, borderRadius: 3, backgroundColor: "#DDDDDD" },
  segmentDone: { backgroundColor: "#000" },
  segmentNow: { backgroundColor: GREEN },
  guideTags: { marginTop: 4 },
  stepCard: { backgroundColor: "#fff", borderRadius: 25, padding: 20, marginTop: 20 },
  stepTitle: { fontFamily: "Poppins_500Medium", fontSize: 20, lineHeight: 28, color: "#000", marginTop: 4 },
  stepDetail: { fontFamily: "Poppins_400Regular", fontSize: 13, lineHeight: 20, color: "#000", marginTop: 15, paddingHorizontal: 10 },
  toolsLabel: { marginTop: 20, marginBottom: -2 },
  toolChip: { backgroundColor: "#fff", paddingHorizontal: 10 },
  warnCard: { flexDirection: "row", alignItems: "center", gap: 11, backgroundColor: "#000", borderRadius: 25, padding: 20, marginTop: 10 },
  warnText: { flex: 1, fontFamily: "Poppins_400Regular", fontSize: 13, lineHeight: 20, color: "#fff" },
  backBtn: { width: 138, height: 58, borderRadius: 100, backgroundColor: "#fff", alignItems: "center", justifyContent: "center" },
  backText: { fontFamily: "Poppins_500Medium", fontSize: 15, color: "#000" },
  nextBtn: { flex: 1, height: 58, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 10, borderRadius: 100, backgroundColor: "#000" },
  nextText: { fontFamily: "Poppins_500Medium", fontSize: 15, color: "#fff" },
  nextIcon: { width: 30, height: 30, borderRadius: 15, backgroundColor: GREEN, alignItems: "center", justifyContent: "center" },
  guideBtn: { flex: 1, height: 44, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 10, borderRadius: 100, backgroundColor: "#000" },
  guideText: { fontFamily: "Poppins_400Regular", fontSize: 15, color: "#fff" },
  savedBtn: { backgroundColor: "#000" },

  cancel: { alignSelf: "center", paddingHorizontal: 24, paddingVertical: 16, marginBottom: 12 },
  cancelText: { fontFamily: "Poppins_600SemiBold", fontSize: 15, color: "#000" },
});
