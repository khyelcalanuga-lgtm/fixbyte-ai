import type { ReactNode } from "react";

// Web: browsers resize the page for the on-screen keyboard themselves, so React Native's view is enough.
export { KeyboardAvoidingView } from "react-native";
export const KeyboardProvider = ({ children }: { children: ReactNode }) => children;
