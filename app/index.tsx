import { forwardRef, useEffect, useRef, useState } from "react";
import {
  Alert,
  Animated,
  Easing,
  Image,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
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
import Svg, { Circle, type CircleProps } from "react-native-svg";
import { useFonts } from "expo-font";
// Per-weight imports: the package root pulls in all 18 Poppins files.
import { Poppins_400Regular } from "@expo-google-fonts/poppins/400Regular";
import { Poppins_500Medium } from "@expo-google-fonts/poppins/500Medium";
import { Poppins_600SemiBold } from "@expo-google-fonts/poppins/600SemiBold";

type Question = { question: string; options: string[] };
// What the screen shows. toApi() turns these into OpenAI-style messages for the API route.
type Turn =
  | { role: "user"; image?: string; text?: string; answers?: string }
  | {
      role: "assistant";
      text: string;
      questions: Question[];
      picked: (string | undefined)[];
      device?: string; // short status labels for the Diagnosing screen
      finding?: string;
    };
type Part = { type: "text"; text: string } | { type: "image_url"; image_url: { url: string } };
// Diagnosing screen state. stage = the 1-based checklist row in progress; 5 = all done.
type Diag = { photo: boolean; device?: string; finding?: string; software?: string; stage: number };

const TYPES = ["image/png", "image/jpeg", "image/gif", "image/webp"];
const GREEN = "#7CEB5A";
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
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

  // "Scan a photo": straight to the camera, then send. Web has no camera UI, so it opens the file picker.
  async function scan() {
    const url = await pick(Platform.OS !== "web");
    if (url) send(url);
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

  async function send(img = image) {
    const answers = pending
      ?.questions.flatMap((q, i) => (pending.picked[i] ? [`${q.question} ${pending.picked[i]}`] : []))
      .join("\n");
    if (busy || (!text.trim() && !img && !answers)) return;

    const next: Turn[] = [...turns, { role: "user", image: img ?? undefined, text: text.trim() || undefined, answers }];
    setTurns(next);
    setStartedAt((d) => d ?? new Date());
    setText("");
    setImage(null);
    setError("");
    setBusy(true);
    const id = ++run.current;
    const ctrl = new AbortController();
    abort.current = ctrl;
    // Answering the clarifying questions gets the final diagnosis: show the Diagnosing screen meanwhile.
    // Device and finding were already worked out in the question turn, so those rows start as done.
    if (pending && answers) {
      const photo = next.some((t) => t.role === "user" && !!t.image);
      setDiag({ photo, device: pending.device, finding: pending.finding, stage: 3 });
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
      if (pending && answers) {
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
          finding: data.finding,
        },
      ]);
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

  return (
    <SafeAreaView style={s.screen} edges={["top", "left", "right"]}>
      <StatusBar style="dark" />
      {diag ? (
        <Diagnosing d={diag} onCancel={cancel} />
      ) : (
      <KeyboardAvoidingView style={s.flex} behavior={Platform.OS === "ios" ? "padding" : undefined}>
        {home ? (
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
          </>
        )}

        {home ? (
          <View style={s.home}>
            <Text style={s.greeting}>Hey, Kiel, What needs fixing today?</Text>
            <View style={s.cards}>
              <Card icon="camera" title="Scan a photo" subtitle="AI spots the damage" onPress={scan} />
              <Card icon="message-square" title="Describe it" subtitle="Type the symptoms" onPress={() => input.current?.focus()} />
            </View>
            {!!error && <Text style={s.error}>{error}</Text>}
          </View>
        ) : (
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
        )}

        <View style={s.footer}>
          {!home && !image && <Text style={s.hint}>Add another photo for a sharper result</Text>}
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
              placeholder={home ? "Describe the problem..." : "Add more details..."}
              placeholderTextColor="rgba(0,0,0,0.2)"
              accessibilityLabel="Message"
              style={s.input}
            />
            <Pressable onPress={() => send()} disabled={busy} style={[s.send, busy && s.disabled]} accessibilityLabel="Send">
              <Feather name="arrow-up" size={18} color="#fff" />
            </Pressable>
          </View>
        </View>
      </KeyboardAvoidingView>
      )}
    </SafeAreaView>
  );
}

function Diagnosing({ d, onCancel }: { d: Diag; onCancel: () => void }) {
  const { width, height } = useWindowDimensions();
  const size = Math.min(297, width - 105, height * 0.34); // 297pt on the 402x874 design, smaller on short phones
  const r = size / 2 - RING_PAD;
  const circumference = 2 * Math.PI * r;

  // The diagnosis is one request with no real percentage, so the arc follows the checklist:
  // half on open (two rows done), easing toward 85% while waiting, then 92% and 100% as the last rows tick.
  // useNativeDriver is off: the native driver can't animate SVG stroke props.
  const progress = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    const to = (toValue: number, duration: number, easing = Easing.out(Easing.quad)) =>
      Animated.timing(progress, { toValue, duration, easing, useNativeDriver: false });
    const anim =
      d.stage <= 3
        ? Animated.sequence([to(0.5, 700), to(0.85, 12000, Easing.out(Easing.cubic))])
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
              {state === "done" ? (
                <View style={[s.stepIcon, s.stepDone]}>
                  <Feather name="check" size={16} color={GREEN} />
                </View>
              ) : state === "active" ? (
                <View style={[s.stepIcon, s.stepActive]}>
                  <View style={s.stepDot} />
                </View>
              ) : (
                <View style={[s.stepIcon, s.stepNext]} />
              )}
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
  greeting: { fontFamily: "Poppins_500Medium", fontSize: 32, lineHeight: 48, textAlign: "center", color: "#000", marginBottom: 20 },
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
  stepNext: { borderWidth: 1.5, borderColor: "rgba(0,0,0,0.4)", borderStyle: "dashed" },
  stepLabel: { flex: 1, marginLeft: 10, fontFamily: "Poppins_400Regular", fontSize: 13, lineHeight: 20, color: "#000" },
  stepStatus: { maxWidth: 95, marginLeft: 8, fontFamily: "Poppins_400Regular", fontSize: 12, lineHeight: 17, textAlign: "right", color: "rgba(0,0,0,0.4)" },
  muted: { color: "rgba(0,0,0,0.4)" },
  greenText: { color: GREEN },
  cancel: { alignSelf: "center", paddingHorizontal: 24, paddingVertical: 16, marginBottom: 12 },
  cancelText: { fontFamily: "Poppins_600SemiBold", fontSize: 15, color: "#000" },
});
