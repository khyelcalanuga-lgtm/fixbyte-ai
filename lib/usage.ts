import { load, save } from "./store";
import { doc, getFirestore, onSnapshot, runTransaction, Timestamp } from "firebase/firestore";
import { firebaseAuth } from "./auth";

// Offline sign-in keeps its local count; Firebase accounts share one count across devices.
export const DAILY_LIMIT = 3;
export const LIMIT_MESSAGE = `You've used today's ${DAILY_LIMIT} free diagnoses. Come back tomorrow.`;
export const SYNC_MESSAGE = "Daily limit could not sync. Check your connection and try again.";

const key = (uid: string) => `usage-2-${uid}.json`; // renaming this resets every count (old files are just ignored)
const today = () => new Date().toDateString(); // local day, so it resets at the user's midnight

// A missing or unreadable count starts from 0.
export function usedToday(uid: string): number {
  try {
    const u: { day: string; used: number } | null = JSON.parse(load(key(uid)) ?? "null");
    return u?.day === today() ? u.used : 0;
  } catch {
    return 0;
  }
}

export function recordUse(uid: string): number {
  const used = usedToday(uid) + 1;
  save(key(uid), JSON.stringify({ day: today(), used }));
  return used;
}

// Erase data only resets the offline count; signed-in counts remain shared.
export function resetUsage(uid: string) {
  save(key(uid), "");
}

const utcDay = () => Math.floor(Date.now() / 86_400_000) * 86_400_000;
const usageRef = (uid: string) => doc(getFirestore(firebaseAuth().app), "dailyUsage", uid);

export function watchSharedUsage(uid: string, onChange: (used: number) => void, onError: () => void) {
  let data: { day?: Timestamp; used?: number } | undefined;
  let timer: ReturnType<typeof setTimeout>;
  let failed = false;
  const show = () => onChange(data?.day?.toMillis() === utcDay() ? data.used ?? 0 : 0);
  const schedule = () => {
    timer = setTimeout(() => {
      show();
      schedule();
    }, utcDay() + 86_400_000 - Date.now() + 1000);
  };
  const stop = onSnapshot(usageRef(uid), (snapshot) => {
    data = snapshot.data();
    show();
  }, () => {
    failed = true;
    clearTimeout(timer);
    onError();
  });
  if (!failed) schedule();
  return () => { stop(); clearTimeout(timer); };
}

export async function recordSharedUse(uid: string): Promise<number> {
  const ref = usageRef(uid);
  try {
    return await runTransaction(getFirestore(firebaseAuth().app), async (transaction) => {
      const data = (await transaction.get(ref)).data();
      const day = utcDay();
      const used = data?.day?.toMillis() === day ? data.used ?? 0 : 0;
      if (used >= DAILY_LIMIT) throw new Error(LIMIT_MESSAGE);
      transaction.set(ref, { day: Timestamp.fromMillis(day), used: used + 1 });
      return used + 1;
    });
  } catch (error) {
    if (error instanceof Error && error.message === LIMIT_MESSAGE) throw error;
    throw new Error(SYNC_MESSAGE);
  }
}
