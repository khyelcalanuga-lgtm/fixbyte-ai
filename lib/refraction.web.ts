// Liquid Glass refraction for the web: what's behind the glass bends along its outline, like the rim of a thick
// lens. An SVG displacement filter is applied to the backdrop (backdrop-filter: url(#...)), which only Chromium
// browsers (Chrome, Edge, Android Chrome) support; elsewhere the glass keeps a plain blur.
//
// How the lens works: a displacement map shaped like the glass (a capsule, or a circle when square). Each pixel
// within BAND of the outline is shifted inward along the outline's normal, most at the very edge and fading to
// nothing BAND inside it, so the bend follows the outline all the way round, rounded ends included. Everywhere
// else the map is neutral and the backdrop is untouched.
const BAND = 12; // px: how far in from the outline the bending reaches
const SCALE = 36; // px: the largest shift, at the outline itself

// Displacement map for a w x h capsule: red = x shift, green = y shift (128 = none).
function capsuleMap(w: number, h: number): string {
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d")!;
  const img = ctx.createImageData(w, h);
  const wide = w >= h;
  const r = (wide ? h : w) / 2;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const px = x + 0.5;
      const py = y + 0.5;
      // Nearest point on the capsule's centre line; the outline is r away from it.
      const cx = wide ? Math.min(Math.max(px, r), w - r) : w / 2;
      const cy = wide ? h / 2 : Math.min(Math.max(py, r), h - r);
      const dx = px - cx;
      const dy = py - cy;
      const dist = Math.hypot(dx, dy);
      const inside = r - dist; // distance in from the outline
      let red = 128;
      let green = 128;
      if (inside >= 0 && inside < BAND && dist > 0) {
        const f = (1 - inside / BAND) ** 2; // strongest at the outline, smoothly to nothing
        red = 128 - 127 * f * (dx / dist); // shift toward the inside
        green = 128 - 127 * f * (dy / dist);
      }
      const i = (y * w + x) * 4;
      img.data[i] = red;
      img.data[i + 1] = green;
      img.data[i + 2] = 128;
      img.data[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  return canvas.toDataURL();
}

// One filter per glass size, created on first use.
function filterFor(w: number, h: number): string {
  const id = `fixbyte-lens-${w}x${h}`;
  if (!document.getElementById(id)) {
    const holder = document.createElement("div");
    holder.innerHTML =
      `<svg width="0" height="0" style="position:absolute" aria-hidden="true">` +
      `<filter id="${id}" x="0" y="0" width="${w}" height="${h}" filterUnits="userSpaceOnUse" color-interpolation-filters="sRGB">` +
      `<feImage href="${capsuleMap(w, h)}" x="0" y="0" width="${w}" height="${h}" preserveAspectRatio="none" result="map"/>` +
      `<feDisplacementMap in="SourceGraphic" in2="map" scale="${SCALE}" xChannelSelector="R" yChannelSelector="G"/>` +
      `</filter></svg>`;
    document.body.appendChild(holder.firstChild!);
  }
  return id;
}

// Chromium only: Safari and Firefox (and every iOS browser, all WebKit) don't apply SVG filters to backdrops.
const supported =
  typeof navigator !== "undefined" && /Chrome|Chromium|Edg\//.test(navigator.userAgent) && !/CriOS|FxiOS/.test(navigator.userAgent);
const PLAIN = { backdropFilter: "blur(12px) saturate(160%)", WebkitBackdropFilter: "blur(12px) saturate(160%)" };

// The backdrop style for a w x h piece of glass: bend along the outline, then a very light blur and a colour lift.
// Until the glass has been measured (w, h unknown), or where unsupported, it's a plain blur.
export function lensStyle(w?: number, h?: number): object {
  if (!supported || typeof document === "undefined" || !w || !h) return PLAIN;
  const id = filterFor(Math.round(w), Math.round(h));
  return { backdropFilter: `url(#${id}) blur(1px) saturate(160%)` };
}
