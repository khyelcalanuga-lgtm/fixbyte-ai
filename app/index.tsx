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
import Svg, { Circle, type CircleProps } from "react-native-svg";
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
  steps: string[];
  // Shown instead of the above on the "needs a professional" page (difficulty "Pro repair").
  problem: string;
  why: string;
  risk: string;
  confidence: number;
  now: { icon: string; text: string }[];
  shopSearch: string;
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
const MIN_DIAG_MS = 2500; // shortest time the Diagnosing screen stays up
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
  const [guide, setGuide] = useState(false); // repair steps revealed on the Diagnosis page
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
    setResultIdx(null);
  }

  function openResult(i: number) {
    setGuide(false);
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

  async function send(img = image) {
    const answers = pending
      ?.questions.flatMap((q, i) => (pending.picked[i] ? [`${q.question} ${pending.picked[i]}`] : []))
      .join("\n");
    if (busy || (!text.trim() && !img && !answers)) return;

    const next: Turn[] = [...turns, { role: "user", image: img ?? undefined, text: text.trim() || undefined, answers }];
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
      ) : (
        <KeyboardAvoidingView style={s.flex} behavior={Platform.OS === "ios" ? "padding" : undefined}>
          {result ? (
            <Result t={result} guide={guide} onBack={() => setResultIdx(null)} />
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
                <Text style={s.greeting}>Hey, Kiel, What needs fixing today?</Text>
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
                  <Pressable onPress={() => findShop(result.diagnosis!.shopSearch)} style={[s.guideBtn, s.shopBtn]} accessibilityRole="link">
                    <Text style={s.shopText}>Find a repair shop</Text>
                  </Pressable>
                  <Bookmark saved={!!result.saved} big onPress={() => toggleSaved(resultIdx!)} />
                </View>
              </>
            ) : (
              <>
                {result ? (
                  <View style={[s.actions, s.actionsGap]}>
                    <Pressable onPress={() => setGuide(true)} style={s.guideBtn} accessibilityRole="button">
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

function findShop(query: string) {
  // Universal Maps link: opens Google Maps (or the browser), searching around the user's location.
  Linking.openURL(`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${query} near me`)}`);
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

function Result({ t, guide, onBack }: { t: Extract<Turn, { role: "assistant" }>; guide: boolean; onBack: () => void }) {
  const d = t.diagnosis!;
  const ref = useRef<ScrollView>(null);
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

      {/* Scrolls to the repair steps when "Start repair guide" reveals them. */}
      <ScrollView ref={ref} style={s.flex} contentContainerStyle={s.result} onContentSizeChange={() => guide && ref.current?.scrollToEnd()}>
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
              <Text style={s.nowLabel}>DO THIS NOW</Text>
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

            {/* ponytail: inline steps until there's a repair-guide screen design */}
            {guide && (
              <>
                <Text style={s.sectionTitle}>Repair steps</Text>
                <View style={s.list}>
                  {d.steps.map((step, i) => (
                    <View key={i} style={s.listRow}>
                      <View style={[s.num, s.numDark]}>
                        <Text style={[s.numText, s.tagTextLight]}>{i + 1}</Text>
                      </View>
                      <Text style={s.listText}>{step}</Text>
                    </View>
                  ))}
                </View>
              </>
            )}
          </>
        )}
      </ScrollView>
    </>
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
              {/* Keyed by state so the icon remounts, and its entry animation plays, when the row changes state.
                  The two rows already done on open check off one after the other. */}
              <StepIcon key={state} state={state} delay={d.stage === 3 && i < 2 ? 200 + i * 350 : 0} />

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
function StepIcon({ state, delay }: { state: "done" | "active" | "next"; delay: number }) {
  const v = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    const anim =
      state === "done"
        ? Animated.sequence([
            Animated.delay(delay),
            Animated.spring(v, { toValue: 1, friction: 5, tension: 140, useNativeDriver: NATIVE }),
          ])
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
  }, [state, delay, v]);

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
  numDark: { backgroundColor: "#000" },
  numText: { fontFamily: "Poppins_500Medium", fontSize: 10, lineHeight: 14, color: "#000" },
  listText: { flex: 1, fontFamily: "Poppins_400Regular", fontSize: 13, lineHeight: 20, color: "#000" },
  listLead: { fontFamily: "Poppins_500Medium" },
  sectionTitle: { fontFamily: "Poppins_600SemiBold", fontSize: 15, lineHeight: 22, color: "#000", marginTop: 28 },
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
  nowLabel: { fontFamily: MONO, fontSize: 11, letterSpacing: 1, color: "rgba(0,0,0,0.5)" },
  nowRow: { flexDirection: "row", alignItems: "flex-start", gap: 18 },
  nowIcon: { marginTop: 1 },
  nowText: { flex: 1, fontFamily: "Poppins_400Regular", fontSize: 13, lineHeight: 20, color: "#000" },
  disclaimer: { fontFamily: "Poppins_400Regular", fontSize: 13, lineHeight: 18, textAlign: "center", color: "rgba(0,0,0,0.4)", marginBottom: 12, paddingHorizontal: 20 },
  shopBtn: { height: 58 },
  shopText: { fontFamily: "Poppins_500Medium", fontSize: 15, color: "#fff" },
  bigCircle: { width: 58, height: 58 },
  guideBtn: { flex: 1, height: 44, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 10, borderRadius: 100, backgroundColor: "#000" },
  guideText: { fontFamily: "Poppins_400Regular", fontSize: 15, color: "#fff" },
  savedBtn: { backgroundColor: "#000" },

  cancel: { alignSelf: "center", paddingHorizontal: 24, paddingVertical: 16, marginBottom: 12 },
  cancelText: { fontFamily: "Poppins_600SemiBold", fontSize: 15, color: "#000" },
});
