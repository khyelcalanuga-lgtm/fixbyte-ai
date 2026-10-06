import { useRef, useState } from "react";
import {
  Alert,
  Image,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { StatusBar } from "expo-status-bar";
import * as ImagePicker from "expo-image-picker";
import { Feather } from "@expo/vector-icons";
import { useFonts } from "expo-font";
// Per-weight imports: the package root pulls in all 18 Poppins files.
import { Poppins_400Regular } from "@expo-google-fonts/poppins/400Regular";
import { Poppins_500Medium } from "@expo-google-fonts/poppins/500Medium";
import { Poppins_600SemiBold } from "@expo-google-fonts/poppins/600SemiBold";

type Question = { question: string; options: string[] };
// What the screen shows. toApi() turns these into OpenAI-style messages for the API route.
type Turn =
  | { role: "user"; image?: string; text?: string; answers?: string }
  | { role: "assistant"; text: string; questions: Question[]; picked: (string | undefined)[] };
type Part = { type: "text"; text: string } | { type: "image_url"; image_url: { url: string } };

const TYPES = ["image/png", "image/jpeg", "image/gif", "image/webp"];
const GREEN = "#7CEB5A";

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
  const scroll = useRef<ScrollView>(null);
  const input = useRef<TextInput>(null);

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
    try {
      const r = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(toApi(next)),
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error);
      const questions: Question[] = data.questions ?? [];
      setTurns([...next, { role: "assistant", text: data.text, questions, picked: questions.map(() => undefined) }]);
    } catch (err) {
      setTurns(turns); // roll back so history stays valid (keeps any picked answers)
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  if (!fontsLoaded) return null;

  const home = turns.length === 0 && !busy;
  const time = startedAt?.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }).toUpperCase();

  return (
    <SafeAreaView style={s.screen} edges={["top", "left", "right"]}>
      <StatusBar style="dark" />
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
    </SafeAreaView>
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
});
