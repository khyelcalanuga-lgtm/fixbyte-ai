// Liquid Glass refraction for the web: what's behind the glass bends near its edges, like looking through a thick
// lens. An SVG displacement filter is applied to the backdrop (backdrop-filter: url(#...)), which only Chromium
// browsers (Chrome, Edge, Android Chrome) support; elsewhere the glass keeps a plain blur.
//
// How the lens works: two displacement maps, one per axis. Each is mid-grey (no shift) everywhere except a thin rim,
// where it ramps up: pixels at the edge are sampled from further inside, so the content bends only along the edge
// of the glass, while everything inside the rim stays undistorted.
const ID = "fixbyte-lens";

function map(axis: "x" | "y") {
  // x: red ramps left (shift right) to right (shift left); blue stays 128 (no shift) for the other axis.
  // y: green ramps top to bottom; blue stays 128.
  const [x2, y2] = axis === "x" ? [1, 0] : [0, 1];
  const c = (v: number) => (axis === "x" ? `rgb(${v},128,128)` : `rgb(128,${v},128)`);
  // Only the very rim bends: about 7pt at the ends of a phone-width bar, 7pt along the top and bottom.
  const band = axis === "x" ? 0.025 : 0.11;
  const svg =
    `<svg xmlns='http://www.w3.org/2000/svg' width='100' height='100' preserveAspectRatio='none'>` +
    `<linearGradient id='g' x1='0' y1='0' x2='${x2}' y2='${y2}'>` +
    `<stop offset='0' stop-color='${c(255)}'/><stop offset='${band}' stop-color='${c(128)}'/>` +
    `<stop offset='${1 - band}' stop-color='${c(128)}'/><stop offset='1' stop-color='${c(0)}'/>` +
    `</linearGradient><rect width='100' height='100' fill='url(%23g)'/></svg>`;
  return `data:image/svg+xml,${svg.replace(/</g, "%3C").replace(/>/g, "%3E").replace(/'/g, "%27")}`;
}

function inject() {
  if (typeof document === "undefined" || document.getElementById(ID)) return;
  const holder = document.createElement("div");
  holder.innerHTML =
    `<svg width="0" height="0" style="position:absolute" aria-hidden="true">` +
    `<filter id="${ID}" x="0" y="0" width="100%" height="100%" color-interpolation-filters="sRGB">` +
    `<feImage href="${map("x")}" x="0" y="0" width="100%" height="100%" preserveAspectRatio="none" result="mx"/>` +
    `<feDisplacementMap in="SourceGraphic" in2="mx" scale="40" xChannelSelector="R" yChannelSelector="B" result="dx"/>` +
    `<feImage href="${map("y")}" x="0" y="0" width="100%" height="100%" preserveAspectRatio="none" result="my"/>` +
    `<feDisplacementMap in="dx" in2="my" scale="26" xChannelSelector="B" yChannelSelector="G"/>` +
    `</filter></svg>`;
  document.body.appendChild(holder.firstChild!);
}

// Chromium only: Safari and Firefox (and every iOS browser, all WebKit) don't apply SVG filters to backdrops.
const supported =
  typeof navigator !== "undefined" && /Chrome|Chromium|Edg\//.test(navigator.userAgent) && !/CriOS|FxiOS/.test(navigator.userAgent);

// The backdrop style for a piece of glass: bend, then blur slightly and lift the colour, as Liquid Glass does.
export function lensStyle(): object {
  if (!supported) return { backdropFilter: "blur(12px) saturate(160%)", WebkitBackdropFilter: "blur(12px) saturate(160%)" };
  inject();
  // A very light blur, so the inside of the glass stays clear and only the rim visibly bends.
  return { backdropFilter: `url(#${ID}) blur(1px) saturate(160%)` };
}
