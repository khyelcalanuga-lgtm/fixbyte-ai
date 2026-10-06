import { useRef, useState } from "react";
import {
  Image,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
  useColorScheme,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { StatusBar } from "expo-status-bar";
import * as ImagePicker from "expo-image-picker";

// OpenRouter (OpenAI-style) chat message shape.
type Part = { type: "text"; text: string } | { type: "image_url"; image_url: { url: string } };
type Msg = { role: "user" | "assistant"; content: string | Part[] };

const TYPES = ["image/png", "image/jpeg", "image/gif", "image/webp"];

export default function App() {
  const dark = useColorScheme() === "dark";
  const fg = dark ? "#f4f4f5" : "#18181b";
  const bg = dark ? "#09090b" : "#ffffff";

  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [text, setText] = useState("");
  const [image, setImage] = useState<string | null>(null); // data URL
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const scroll = useRef<ScrollView>(null);

  async function pick(camera: boolean) {
    const perm = camera
      ? await ImagePicker.requestCameraPermissionsAsync()
      : await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) return setError(`${camera ? "Camera" : "Photo"} permission denied.`);

    // quality < 1 re-encodes to JPEG (also converts iOS HEIC) and keeps uploads under the 5MB image limit.
    const opts: ImagePicker.ImagePickerOptions = { mediaTypes: ["images"], base64: true, quality: 0.7 };
    const r = camera ? await ImagePicker.launchCameraAsync(opts) : await ImagePicker.launchImageLibraryAsync(opts);
    const a = r.assets?.[0];
    if (r.canceled || !a?.base64) return;
    const mime = a.mimeType && TYPES.includes(a.mimeType) ? a.mimeType : "image/jpeg";
    setImage(`data:${mime};base64,${a.base64}`);
  }

  async function send() {
    if (busy || (!text.trim() && !image)) return;

    const content: Part[] = [];
    if (image) content.push({ type: "image_url", image_url: { url: image } });
    content.push({ type: "text", text: text.trim() || "What's wrong here and how do I fix it?" });

    const next: Msg[] = [...msgs, { role: "user", content }];
    setMsgs(next);
    setText("");
    setImage(null);
    setError("");
    setBusy(true);
    try {
      const r = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(next),
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error);
      setMsgs([...next, { role: "assistant", content: data.text }]);
    } catch (err) {
      setMsgs(msgs); // roll back so history stays valid
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <SafeAreaView style={[s.main, { backgroundColor: bg }]}>
      <StatusBar style="auto" />
      <KeyboardAvoidingView style={s.flex} behavior={Platform.OS === "ios" ? "padding" : undefined}>
        <ScrollView
          ref={scroll}
          style={s.flex}
          contentContainerStyle={s.log}
          onContentSizeChange={() => scroll.current?.scrollToEnd()}
        >
          <Text style={[s.h1, { color: fg }]}>🔧 FixIt Bot</Text>
          <Text style={[s.hint, { color: fg }]}>
            Snap a photo of damaged hardware or a screenshot of an error, or just describe the problem.
          </Text>

          {msgs.map((m, i) => {
            const user = m.role === "user";
            const color = user ? "#fff" : fg;
            return (
              <View key={i} style={[s.msg, user ? s.user : s.assistant]}>
                {typeof m.content === "string" ? (
                  <Text selectable style={[s.text, { color }]}>{m.content}</Text>
                ) : (
                  m.content.map((b, j) =>
                    b.type === "image_url" ? (
                      <Image
                        key={j}
                        source={{ uri: b.image_url.url }}
                        style={s.img}
                        accessibilityLabel="uploaded"
                      />
                    ) : b.type === "text" ? (
                      <Text key={j} selectable style={[s.text, { color }]}>{b.text}</Text>
                    ) : null,
                  )
                )}
              </View>
            );
          })}
          {busy && (
            <View style={[s.msg, s.assistant]}>
              <Text style={[s.text, { color: fg }]}>Diagnosing…</Text>
            </View>
          )}
          {!!error && <Text style={s.error}>Error: {error}</Text>}
        </ScrollView>

        <View style={s.form}>
          {image && (
            <View style={s.preview}>
              <Image source={{ uri: image }} style={s.img} />
              <Pressable onPress={() => setImage(null)} style={[s.btn, s.removeBtn]}>
                <Text style={{ color: fg }}>Remove</Text>
              </Pressable>
            </View>
          )}
          <View style={s.row}>
            <Pressable onPress={() => pick(true)} style={s.icon} accessibilityLabel="Take photo">
              <Text style={s.iconText}>📷</Text>
            </Pressable>
            <Pressable onPress={() => pick(false)} style={s.icon} accessibilityLabel="Choose photo">
              <Text style={s.iconText}>🖼️</Text>
            </Pressable>
            <TextInput
              value={text}
              onChangeText={setText}
              onSubmitEditing={send}
              placeholder="Describe the problem…"
              placeholderTextColor="#888"
              accessibilityLabel="Message"
              style={[s.input, { color: fg }]}
            />
            <Pressable onPress={send} disabled={busy} style={[s.btn, busy && s.disabled]}>
              <Text style={s.btnText}>Send</Text>
            </Pressable>
          </View>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  main: { flex: 1 },
  flex: { flex: 1 },
  h1: { fontSize: 28, fontWeight: "700", marginBottom: 4 },
  hint: { opacity: 0.7, marginBottom: 16 },
  log: { padding: 16, gap: 10 },
  msg: { paddingVertical: 10, paddingHorizontal: 14, borderRadius: 12, maxWidth: "85%" },
  user: { alignSelf: "flex-end", backgroundColor: "#2563eb" },
  assistant: { alignSelf: "flex-start", backgroundColor: "#88888833" },
  text: { fontSize: 16, lineHeight: 24 },
  img: { width: 240, height: 240, borderRadius: 8, marginBottom: 6, resizeMode: "cover" },
  error: { color: "#dc2626" },
  form: { paddingHorizontal: 16, paddingVertical: 8 },
  preview: { flexDirection: "row", alignItems: "flex-end", gap: 8, marginBottom: 8 },
  row: { flexDirection: "row", gap: 8, alignItems: "center" },
  icon: { paddingVertical: 6, paddingHorizontal: 8, borderRadius: 8, borderWidth: 1, borderColor: "#88888866" },
  iconText: { fontSize: 20 },
  input: { flex: 1, padding: 10, fontSize: 16, borderRadius: 8, borderWidth: 1, borderColor: "#88888866" },
  btn: { paddingVertical: 10, paddingHorizontal: 16, borderRadius: 8, backgroundColor: "#2563eb" },
  btnText: { color: "#fff", fontSize: 16 },
  removeBtn: { backgroundColor: "#88888844", paddingVertical: 4, paddingHorizontal: 10 },
  disabled: { opacity: 0.5 },
});
