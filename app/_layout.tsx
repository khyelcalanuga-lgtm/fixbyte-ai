import { Slot } from "expo-router";
import { KeyboardProvider } from "../lib/keyboard";

// Without this file, Expo Router wraps iOS screens in its own SafeAreaView,
// doubling the top inset index.tsx already applies (shows as a black band).
// KeyboardProvider lets screens move with the keyboard frame by frame, instead of jumping once it has opened.
export default function Layout() {
  return (
    <KeyboardProvider>
      <Slot />
    </KeyboardProvider>
  );
}
