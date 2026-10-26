// Android's version of the web glass lens (lib/refraction.web.ts): the page behind the glass, bent inward along
// the glass's outline, then a light blur and a colour lift. Draws the page that expo-blur's BlurTargetView records.
// Needs Android 13+ (AGSL shaders) and an app build that includes this module; otherwise `lensAvailable` is false.
import { requireNativeView, requireOptionalNativeModule } from "expo";
import { useEffect, useState, type ComponentRef, type ComponentType, type RefObject } from "react";
import { findNodeHandle, Platform, type View, type ViewProps } from "react-native";

export const lensAvailable =
  Platform.OS === "android" && Number(Platform.Version) >= 33 && requireOptionalNativeModule("GlassLens") !== null;

const NativeLens: ComponentType<ViewProps & { targetId?: number }> | null = lensAvailable ? requireNativeView("GlassLens", "GlassLensView") : null;

export function GlassLens({ target, style }: { target: RefObject<ComponentRef<typeof View> | null>; style?: ViewProps["style"] }) {
  const [targetId, setTargetId] = useState<number>();
  useEffect(() => setTargetId(findNodeHandle(target.current) ?? undefined), [target]);
  return NativeLens && <NativeLens targetId={targetId} style={style} pointerEvents="none" />;
}
