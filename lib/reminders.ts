import { Platform } from "react-native";
import * as Notifications from "expo-notifications";

// Repair reminders: a local notification two days after a diagnosis, asking how the repair went.
// Phones only: the web version has no notifications.
const AFTER_SECONDS = 2 * 24 * 60 * 60;
const CHANNEL = "reminders";

// Asks for permission when needed; false means reminders can't be shown here.
export async function allowReminders(): Promise<boolean> {
  if (Platform.OS === "web") return false;
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
  if (!(await allowReminders())) return;
  await Notifications.scheduleNotificationAsync({
    content: { title: `How's your ${device || "device"}?`, body: `${summary}. Open FixByte AI to pick up the repair guide.` },
    trigger: { type: Notifications.SchedulableTriggerInputTypes.TIME_INTERVAL, seconds: AFTER_SECONDS, channelId: CHANNEL },
  }).catch(() => {});
}

export function cancelReminders() {
  if (Platform.OS !== "web") Notifications.cancelAllScheduledNotificationsAsync().catch(() => {});
}
