// Phones: keyboard handling that moves with the keyboard as it slides. React Native's own KeyboardAvoidingView only
// reacts once the keyboard has finished opening on Android, so the message bar lagged behind, then jumped.
// The web build uses keyboard.web.tsx instead: this library's animation code can't run in the web server render.
export { KeyboardAvoidingView, KeyboardProvider } from "react-native-keyboard-controller";
