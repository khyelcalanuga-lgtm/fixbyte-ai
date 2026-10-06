import { Slot } from "expo-router";

// Without this file, Expo Router wraps iOS screens in its own SafeAreaView,
// doubling the top inset index.tsx already applies (shows as a black band).
export default function Layout() {
  return <Slot />;
}
