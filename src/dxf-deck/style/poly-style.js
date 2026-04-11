export function parseBrushFillColor(ogrStyle, fallback = [200, 200, 200, 255]) {
  if (!ogrStyle || typeof ogrStyle !== "string") return fallback;

  // ищем fc:#RRGGBB или fc:#RRGGBBAA (регистр не важен)
  const m = ogrStyle.match(/fc\s*:\s*(#[0-9a-f]{6}([0-9a-f]{2})?)/i);
  if (!m) return fallback;

  const hex = m[1].replace("#", "");
  const r = parseInt(hex.slice(0, 2), 16);
  const g = parseInt(hex.slice(2, 4), 16);
  const b = parseInt(hex.slice(4, 6), 16);
  const a = hex.length === 8 ? parseInt(hex.slice(6, 8), 16) : fallback[3];

  if (![r, g, b, a].every(Number.isFinite)) return fallback;
  return [r, g, b, a];
}
