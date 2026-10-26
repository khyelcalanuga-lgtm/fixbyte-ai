import { Platform } from "react-native";
import Constants, { ExecutionEnvironment } from "expo-constants";
import type * as NotificationsModule from "expo-notifications";
import { tr } from "./i18n";

// Repair reminders: a local notification two days after a diagnosis, asking how the repair went.
// Phones only: the web version has no notifications.
const AFTER_SECONDS = 2 * 24 * 60 * 60;
const CHANNEL = "reminders";

// expo-notifications is loaded on first use, never at import: Expo Go for Android lacks one of its native modules
// (ExpoTopicSubscriptionModule, SDK 58), and loading the package there crashes the whole app. Reminders are off there.
const unsupported = Platform.OS === "web" || (Platform.OS === "android" && Constants.executionEnvironment === ExecutionEnvironment.StoreClient);
let loaded: typeof NotificationsModule | null = null;
function notifications(): typeof NotificationsModule | null {
  if (unsupported) return null;
  return (loaded ??= require("expo-notifications"));
}

// Asks for permission when needed; false means reminders can't be shown here.
export async function allowReminders(): Promise<boolean> {
  const Notifications = notifications();
  if (!Notifications) return false;
  try {
    const current = await Notifications.getPermissionsAsync();
    const granted = current.granted || (await Notifications.requestPermissionsAsync()).granted;
    if (granted && Platform.OS === "android") {
      // Android shows notifications only through a channel.
      await Notifications.setNotificationChannelAsync(CHANNEL, { name: "Repair reminders", importance: Notifications.AndroidImportance.DEFAULT });
    }
    return granted;
  } catch {
    return false;
  }
}

export async function remindLater(device: string | undefined, summary: string) {
  const Notifications = notifications();
  if (!Notifications || !(await allowReminders())) return;
  await Notifications.scheduleNotificationAsync({
    content: { title: tr("How's your {0}?", device || tr("device")), body: tr("{0}. Open FixByte AI to pick up the repair guide.", summary) },
    trigger: { type: Notifications.SchedulableTriggerInputTypes.TIME_INTERVAL, seconds: AFTER_SECONDS, channelId: CHANNEL },
  }).catch(() => {});
}

export function cancelReminders() {
  notifications()?.cancelAllScheduledNotificationsAsync().catch(() => {});
}
