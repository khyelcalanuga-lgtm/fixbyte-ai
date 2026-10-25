import { load, save } from "./store";
import { doc, getFirestore, onSnapshot, setDoc } from "firebase/firestore";
import { firebaseAuth } from "./auth";

export const AVATAR_COLORS = [
  { label: "Green", value: "#7CEB5A" },
  { label: "Blue", value: "#93C5FD" },
  { label: "Purple", value: "#C4B5FD" },
  { label: "Pink", value: "#FDA4AF" },
  { label: "Orange", value: "#FDBA74" },
  { label: "Yellow", value: "#FDE047" },
] as const;

type Account = { uid: string } | null;
const colorKey = (user: Account) => `profile-color-${user?.uid ?? "offline"}`;
const profileRef = (uid: string) => doc(getFirestore(firebaseAuth().app), "profiles", uid);

export function loadAvatarColor(user: Account): string {
  const color = load(colorKey(user));
  return AVATAR_COLORS.find((c) => c.value === color)?.value ?? AVATAR_COLORS[0].value;
}

export function watchAvatarColor(uid: string, onChange: (color: string) => void, onError: () => void) {
  return onSnapshot(profileRef(uid), (snapshot) => {
    const color = AVATAR_COLORS.find((c) => c.value === snapshot.data()?.avatarColor)?.value ?? loadAvatarColor({ uid });
    save(colorKey({ uid }), color);
    onChange(color);
  }, onError);
}

export function resetAvatarColorCache(user: Account) {
  save(colorKey(user), "");
}

export async function saveAvatarColor(user: Account, color: string): Promise<void> {
  if (!AVATAR_COLORS.some((c) => c.value === color)) throw new Error("Choose one of the available avatar colors.");
  if (user) {
    try {
      await setDoc(profileRef(user.uid), { avatarColor: color }, { merge: true });
    } catch {
      throw new Error("Your avatar color could not be saved. Check your connection and try again.");
    }
  }
  const key = colorKey(user);
  save(key, color);
  if (!user && load(key) !== color) throw new Error("Your color could not be saved. Allow storage for this app and try again.");
}
