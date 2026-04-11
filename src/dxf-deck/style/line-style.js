// line-style.js
export function parseOgrPenStyle(ogrStyle) {
  // Example: PEN(c:#000000,p:"0.5g 0.5g")
  const out = {
    color: [0, 0, 0, 255],
    dashArray: null, // e.g. [4,4]
  };
  if (!ogrStyle || typeof ogrStyle !== "string") return out;

  // color
  const mColor = ogrStyle.match(/\bc:\s*#([0-9a-fA-F]{6})\b/);
  if (mColor) out.color = hexToRgba(mColor[1], 255);

  // pattern p:"0.5g 0.5g" or p:"4px 2px" etc.
  const mP = ogrStyle.match(/\bp:\s*"([^"]+)"/);
  if (mP) {
    const tokens = mP[1].trim().split(/\s+/).filter(Boolean);
    const segs = tokens
      .map(parseLenToken)
      .map((t) => t.value)
      .filter((v) => Number.isFinite(v));

    if (segs.length >= 2) {
      //out.dashArray = segs; // ← ТОЛЬКО ЧИСЛА
      out.dashArray = segs.map((v) => v * 7);
    }
  }
  return out;
}

function parseLenToken(t) {
  // "0.5g", "4px", "1.2mm", "3" (unitless)
  const m = String(t).match(/^(-?\d*\.?\d+)([a-zA-Z%]*)$/);
  if (!m) return { value: NaN, unit: "" };
  return { value: Number(m[1]), unit: (m[2] || "").toLowerCase() };
}

function hexToRgba(hex6, a = 255) {
  const r = parseInt(hex6.slice(0, 2), 16);
  const g = parseInt(hex6.slice(2, 4), 16);
  const b = parseInt(hex6.slice(4, 6), 16);
  return [r, g, b, a];
}

/**
 * Convert dash tokens from OGR ("g"/"px"/etc) to deck dash array in pixels.
 * - 'px' => px
 * - 'g'  => "ground-ish" unit; we map to px via dashScalePx (tune)
 * - other units => treated like 'g' (best effort)
 */
export function dashTokensToPx(dashTokens, dashScalePx = 10) {
  if (!dashTokens || !Array.isArray(dashTokens) || dashTokens.length < 2)
    return null;

  const arr = dashTokens.map((t) => {
    const unit = t.unit || "";
    if (unit === "px") return t.value;
    if (unit === "") return t.value;
    if (unit === "g") return t.value * dashScalePx;
    // mm/cm/in/pt/etc — без геопривязки лучше приравнять к "g"
    return t.value * dashScalePx;
  });

  // deck expects finite positive numbers
  const clean = arr
    .map((v) => (Number.isFinite(v) ? Math.max(0.001, v) : 0))
    .filter((v) => v > 0);
  return clean.length >= 2 ? clean : null;
}
