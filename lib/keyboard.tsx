import type { ComponentProps } from "react";
import { KeyboardAvoidingView as NativeKeyboardAvoidingView } from "react-native-keyboard-controller";

export { KeyboardProvider } from "react-native-keyboard-controller";

// Measure in screen coordinates so safe-area padding cannot leave inputs behind the Android keyboard.
export function KeyboardAvoidingView(props: ComponentProps<typeof NativeKeyboardAvoidingView>) {
  return <NativeKeyboardAvoidingView automaticOffset {...props} />;
}
