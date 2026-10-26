// The app's language. English text is the key: tr("Sign in") looks it up in lib/translations.ts and falls back to
// the English when a string has no translation. Text and TextInput here translate what they show, so most of the
// app needs no tr() calls; tr() is for text built from variables ("{0} checks").
import { createElement, type ComponentProps, type ReactNode } from "react";
import { Text as RNText, TextInput as RNTextInput } from "react-native";
import { STRINGS } from "./translations";

// Settings keep the English name (the server tells the AI which language to write in); pickers show the native name.
export const LANGUAGES = ["English", "Filipino", "Cebuano", "Spanish", "Japanese"];
export const LANGUAGE_NAMES: Record<string, string> = { English: "English", Filipino: "Filipino", Cebuano: "Cebuano", Spanish: "Español", Japanese: "日本語" };
const COLUMN: Record<string, number> = { Filipino: 0, Cebuano: 1, Spanish: 2, Japanese: 3 };
// Dates and times. Cebuano falls back to Filipino month names where the device has no Cebuano data.
const LOCALES: Record<string, string[]> = { English: ["en"], Filipino: ["fil"], Cebuano: ["ceb", "fil"], Spanish: ["es"], Japanese: ["ja"] };

let language = "English";
// Set by the App on every render, before anything below it renders.
export function setLanguage(name: string) {
  language = name in LANGUAGE_NAMES ? name : "English";
}
export const locale = () => LOCALES[language];

const lookup = (key: string) => (language === "English" ? undefined : STRINGS[key]?.[COLUMN[language]]);

// tr("{0} of {1} left", 2, 3): translated, then {0}, {1}... filled in.
export function tr(key: string, ...args: (string | number)[]): string {
  return (lookup(key) ?? key).replace(/\{(\d+)\}/g, (m, i) => (args[+i] === undefined ? m : String(args[+i])));
}

// Each piece of text is looked up on its own. Text with a value inside goes through tr("Checking your {0}", name)
// instead: at runtime a name is just another string, so a sentence can't be pieced back together from children.
function translate(children: ReactNode): ReactNode[] {
  const pieces = Array.isArray(children) ? children : [children];
  return language === "English" ? pieces : pieces.map((c) => (typeof c === "string" ? tr(c) : c));
}

// Spread as separate children (not one array), so React doesn't ask for keys on nested elements.
export function Text({ children, ...props }: ComponentProps<typeof RNText>) {
  return createElement(RNText, props, ...translate(children));
}

export function TextInput({ placeholder, accessibilityLabel, ...props }: ComponentProps<typeof RNTextInput>) {
  return <RNTextInput placeholder={placeholder && tr(placeholder)} accessibilityLabel={accessibilityLabel && tr(accessibilityLabel)} {...props} />;
}
