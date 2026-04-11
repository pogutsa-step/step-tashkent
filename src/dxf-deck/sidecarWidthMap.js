// Structured sidecar:
// {
//   name: string,
//   date: string (ISO),
//   layers: string[],
//   entities: Map<string, object>  // handle -> payload (w, ht, hp, ha, hs, lp, lf, tr, t, ...)
// }

export function makeWorker(url, opts) {
  const w = new Worker(url, opts);
  //w.onmessage = (e) => console.log("[DXF width] msg", e.data);
  w.onerror = (e) => {
    console.error("[DXF width] WORKER ERROR:", e.message);
    console.error("  file:", e.filename, "line:", e.lineno, "col:", e.colno);
  };
  w.onmessageerror = (e) => console.error("[DXF width] messageerror", e);
  return w;
}

export const dxfSidecar = {
  name: "",
  date: "",
  layers: [],
  entities: new Map(),
};
