// pmtiles-deck-layers.js
import { parseOgrPenStyle, dashTokensToPx } from "./style/line-style.js";
import { parseBrushFillColor } from "./style/poly-style.js";

export function createPmtilesDeckLayers({
  deck,
  deckOverlay,
  loader, // { getTileData }

  keepLayerIds = ["deckgl-circle"],
  id = "dxf",

  polygonFill = [120, 120, 120, 120],
  lineColor = [30, 30, 30, 255],
  pointColor = [255, 0, 0, 255],
  minZoom = 12,
  maxZoom = 17,

  // ✅ Picking options
  enablePicking = false,
  enableTooltip = false, // hover tooltip
  tooltipMaxChars = 4000, // чтобы UI не умирал от мегапропертей
  autoHighlight = false,
  highlightColor = [255, 255, 0, 160],
  onPick, // (info) => void, вызывается на click/hover
  logOnClick = false, // ✅ NEW: console.log props on click
  logOnClickMaxChars = 20000, // ✅ NEW: truncate huge dumps (optional)

  onLog,
} = {}) {
  if (!deck) throw new Error("deck required");
  if (!deckOverlay) throw new Error("deckOverlay required");
  if (!loader?.getTileData) throw new Error("loader.getTileData required");

  const {
    TileLayer,
    PathLayer,
    SolidPolygonLayer,
    ScatterplotLayer,
    TextLayer,
  } = deck;
  if (
    !TileLayer ||
    !PathLayer ||
    !SolidPolygonLayer ||
    !ScatterplotLayer ||
    !TextLayer
  ) {
    throw new Error(
      "Need deck TileLayer/PathLayer/SolidPolygonLayer/ScatterplotLayer",
    );
  }
  const { PathStyleExtension, DataFilterExtension } = deck;
  const ClipExt = deck.ClipExtension;

  const pathStyle = new PathStyleExtension({ dash: true });

  const hasWidth = (d) =>
    Number.isFinite(d.properties?.__width) && d.properties.__width > 0;

  const log = (m) => onLog?.(m);

  // ---------- universal helpers ----------

  function safeStringify(obj, maxChars) {
    let s;
    try {
      s = JSON.stringify(obj, null, 2);
    } catch {
      s = String(obj);
    }
    if (maxChars && s.length > maxChars)
      return s.slice(0, maxChars) + "\n…(truncated)…";
    return s;
  }

  function isGeoJSONFeature(x) {
    return x && typeof x === "object" && x.type === "Feature" && x.geometry;
  }

  function getProperties(x) {
    if (!x || typeof x !== "object") return {};
    if (isGeoJSONFeature(x)) return x.properties || {};
    if (x.properties && typeof x.properties === "object") return x.properties;
    if (x.props && typeof x.props === "object") return x.props;
    return {};
  }

  // polygons: accept
  // - rings array: [ [ [lng,lat], ... ], [hole...], ... ]
  // - Feature Polygon/MultiPolygon
  // - { polygon: rings } or { rings: rings } or { coordinates: rings }
  function getPolygonRings(item) {
    if (!item) return null;

    if (Array.isArray(item)) return item; // already rings

    if (isGeoJSONFeature(item)) {
      const g = item.geometry;
      if (g.type === "Polygon") return g.coordinates;
      // SolidPolygonLayer принимает один polygon за элемент,
      // поэтому MultiPolygon лучше заранее разложить в loader, но на всякий:
      if (g.type === "MultiPolygon") return g.coordinates?.[0] || null;
      return null;
    }

    if (Array.isArray(item.polygon)) return item.polygon;
    if (Array.isArray(item.rings)) return item.rings;
    if (Array.isArray(item.coordinates)) return item.coordinates;
    if (item.geometry && Array.isArray(item.geometry.coordinates)) {
      const g = item.geometry;
      if (g.type === "Polygon") return g.coordinates;
      if (g.type === "MultiPolygon") return g.coordinates?.[0] || null;
    }
    return null;
  }

  // paths: accept
  // - line array: [ [lng,lat], ... ]
  // - Feature LineString/MultiLineString (берём первую линию, если multi)
  // - { path: line } or { coordinates: line }
  function getPathLine(item) {
    if (!item) return null;

    if (Array.isArray(item) && Array.isArray(item[0])) return item;

    if (isGeoJSONFeature(item)) {
      const g = item.geometry;
      if (g.type === "LineString") return g.coordinates;
      if (g.type === "MultiLineString") return g.coordinates?.[0] || null;
      return null;
    }

    if (Array.isArray(item.path)) return item.path;
    if (Array.isArray(item.coordinates)) return item.coordinates;
    if (item.geometry && Array.isArray(item.geometry.coordinates)) {
      const g = item.geometry;
      if (g.type === "LineString") return g.coordinates;
      if (g.type === "MultiLineString") return g.coordinates?.[0] || null;
    }
    return null;
  }

  // points: accept
  // - [lng,lat]
  // - Feature Point/MultiPoint (берём первую)
  // - { position: [lng,lat] } or { coordinates: [lng,lat] }
  function getPointPos(item) {
    if (!item) return null;

    if (
      Array.isArray(item) &&
      item.length >= 2 &&
      isFinite(item[0]) &&
      isFinite(item[1])
    )
      return item;

    if (isGeoJSONFeature(item)) {
      const g = item.geometry;
      if (g.type === "Point") return g.coordinates;
      if (g.type === "MultiPoint") return g.coordinates?.[0] || null;
      return null;
    }

    if (Array.isArray(item.position)) return item.position;
    if (Array.isArray(item.coordinates)) return item.coordinates;
    if (item.geometry && Array.isArray(item.geometry.coordinates)) {
      const g = item.geometry;
      if (g.type === "Point") return g.coordinates;
      if (g.type === "MultiPoint") return g.coordinates?.[0] || null;
    }
    return null;
  }

  function safeStringify(obj, maxChars) {
    let s;
    try {
      s = JSON.stringify(obj, null, 2);
    } catch {
      s = String(obj);
    }
    if (maxChars && s.length > maxChars)
      return s.slice(0, maxChars) + "\n…(truncated)…";
    return s;
  }

  function makeTooltipText(info) {
    // info.object — это элемент твоего data
    const o = info?.object;
    if (!o) return null;

    const props = getProperties(o);
    const header = [];
    if (props?.id != null) header.push(`id: ${props.id}`);
    if (props?.name) header.push(`name: ${props.name}`);

    const body = safeStringify(props, tooltipMaxChars);
    return (header.length ? header.join(" | ") + "\n" : "") + body;
  }

  // ---------- overlay-level tooltip (hover) ----------
  // MapboxOverlay/deckOverlay умеет getTooltip (строка или {text})
  function installTooltip() {
    if (!enablePicking || !enableTooltip) return;

    deckOverlay.setProps({
      getTooltip: (info) => {
        if (!info?.object) return null;
        const text = makeTooltipText(info);
        if (!text) return null;

        // можно вернуть строку, но {text} даёт более предсказуемое поведение
        return { text };
      },
    });
  }

  // ---------- click handler ----------
  function handleClick(info, event) {
    if (!enablePicking) return;

    if (!info?.object) return;

    // полный объект + props — в консоль (для “всё увидеть” это реально удобно)
    const props = getProperties(info.object);
    if (logOnClick) {
      // 1) компактный заголовок
      console.log(`[${id}] click`, {
        layerId: info.layer?.id,
        tile: info.tile,
        coordinate: info.coordinate,
      });
      // 2) всё проперти — отдельно, чтобы удобно копировать
      console.log(
        `[${id}] properties:\n` + safeStringify(props, logOnClickMaxChars),
      );
    }

    onPick?.(info, event);
  }

  function removeOurLayers() {
    const existing =
      deckOverlay?.deck?.props?.layers || deckOverlay?.props?.layers || [];
    deckOverlay.setProps({
      layers: existing.filter((l) => !String(l?.id || "").startsWith(`${id}-`)),
    });
  }
  // ---------- LABEL (OGR_STYLE) parsing ----------
  function isLabelStyle(ogrStyle) {
    return typeof ogrStyle === "string" && ogrStyle.startsWith("LABEL(");
  }

  function hexToRgba255(hex, a = 255) {
    if (!hex || typeof hex !== "string") return [0, 0, 0, a];
    const h = hex.replace("#", "").trim();
    if (h.length !== 6) return [0, 0, 0, a];
    const r = parseInt(h.slice(0, 2), 16);
    const g = parseInt(h.slice(2, 4), 16);
    const b = parseInt(h.slice(4, 6), 16);
    return [r, g, b, a];
  }

  // LABEL(..., c:#RRGGBB, a:deg, s:0.8g, ...)
  function parseOgrLabelStyle(ogrStyle) {
    const out = {
      color: [0, 0, 0, 255],
      angle: 0,
      size: 1, // meters
      fontFamily: "sans-serif",
      textAnchor: "start", // 'start' | 'middle' | 'end'
      alignmentBaseline: "center", // 'top' | 'center' | 'bottom'
      background: false,
      backgroundColor: [255, 255, 255, 200],
    };
    if (!isLabelStyle(ogrStyle)) return out;
    // helper: match param after LABEL( or ,
    const rx = (name, value) =>
      new RegExp(`(?:^|[,(])\\s*${name}:\\s*${value}`);
    // font family: f:"PT Sans" or f:"Arial"

    const mf = ogrStyle.match(rx("f", `"([^"]*)"`));

    if (mf && mf[1]) out.fontFamily = mf[1];

    // color
    const mc = ogrStyle.match(rx("c", "#([0-9a-fA-F]{6})"));
    if (mc) out.color = hexToRgba255(mc[1], 255);

    // angle
    const ma = ogrStyle.match(rx("a", "([+-]?\\d+(?:\\.\\d+)?)"));
    if (ma) {
      const v = Number(ma[1]);
      if (Number.isFinite(v)) out.angle = v;
    }

    // size (we treat "g" as meters)
    const ms = ogrStyle.match(rx("s", "([+-]?\\d+(?:\\.\\d+)?)([a-zA-Z]*)"));
    if (ms) {
      const v = Number(ms[1]);
      if (Number.isFinite(v) && v > 0) out.size = v;
    }

    // background flag (bo:1)
    const mbo = ogrStyle.match(rx("bo", "(\\d+)"));

    if (mbo) out.background = Number(mbo[1]) === 1;

    // background color if present (not in your samples, but support it)
    // e.g. bc:#RRGGBB
    const mbc = ogrStyle.match(rx("bc", "#([0-9a-fA-F]{6})"));
    if (mbc) out.backgroundColor = hexToRgba255(mbc[1], 200);

    // alignment/anchor via p: (OGR label position code)
    // anchor/alignment via p: (OGR label position code)
    // Empirical mapping for your DXF->OGR export:
    // 5 = center (confirmed)
    // 7 = top-* (confirmed by your example)
    const mp = ogrStyle.match(rx("p", "(\\d+)"));
    if (mp) {
      const p = Number(mp[1]);
      if (Number.isFinite(p)) {
        const map = {
          1: { textAnchor: "start", alignmentBaseline: "bottom" },
          2: { textAnchor: "middle", alignmentBaseline: "bottom" },
          3: { textAnchor: "end", alignmentBaseline: "bottom" },

          4: { textAnchor: "start", alignmentBaseline: "center" },
          5: { textAnchor: "middle", alignmentBaseline: "center" },
          6: { textAnchor: "end", alignmentBaseline: "center" },

          7: { textAnchor: "start", alignmentBaseline: "top" },
          8: { textAnchor: "middle", alignmentBaseline: "top" },
          9: { textAnchor: "end", alignmentBaseline: "top" },

          // Baseline positions: deck.gl TextLayer doesn't expose "alphabetic"/"baseline",
          // so closest practical approximation is "bottom".
          10: { textAnchor: "start", alignmentBaseline: "bottom" },
          11: { textAnchor: "middle", alignmentBaseline: "bottom" },
          12: { textAnchor: "end", alignmentBaseline: "bottom" },
        };
        const m = map[p];
        if (m) {
          out.textAnchor = m.textAnchor;
          out.alignmentBaseline = m.alignmentBaseline;
        }
      }
    }
    return out;
  }

  function apply() {
    installTooltip();

    const tileLayer = new TileLayer({
      id: `${id}-tiles`,
      minZoom,
      maxZoom,
      pickable: !!enablePicking, // важно для tile-level picking
      autoHighlight: false, // подсветка будет на sublayers

      getTileData: (args) => loader.getTileData(args),

      renderSubLayers: (subProps) => {
        const d = subProps.data;
        if (!d) return null;

        const base = subProps.id || `${id}-tile`;
        const out = [];

        const common = {
          pickable: !!enablePicking,
          autoHighlight: !!autoHighlight,
          highlightColor,
          //onClick: enablePicking ? handleClick : console.log("anus"),
          onHover: enablePicking ? (info, e) => onPick?.(info, e) : undefined,
          extensions: ClipExt ? [new ClipExt()] : [],
          clipBounds: d.clipBounds,
          parameters: { depthTest: false },
        };

        if (d.polygons?.length) {
          out.push(
            new SolidPolygonLayer({
              id: `${base}-polys`,
              data: d.polygons,
              getPolygon: (p) => getPolygonRings(p),
              filled: true,
              stroked: false,
              getFillColor: (d) => {
                const [r, g, b] = parseBrushFillColor(d.properties?.OGR_STYLE);
                const a = Math.round(255 * (d.properties?.__hatchOpacity ?? 1));
                return [r, g, b, a];
              },
              ...common,
            }),
          );
        }

        if (d.paths?.length) {
          out.push(
            new PathLayer({
              id: `${base}-paths-meters`,
              data: d.paths,
              getPath: (p) => getPathLine(p),
              getFilterValue: (d) => (hasWidth(d) ? 1 : 0),
              filterRange: [1, 1],

              widthUnits: "meters",
              //  getWidth: 0.2, // 30 см как было
              getWidth: (d) => d.properties.__width,
              widthMinPixels: 0.75,
              capRounded: false,
              jointRounded: false,
              miterLimit: 2,
              // цвет
              getColor: (d) => {
                const s = parseOgrPenStyle(d.properties?.OGR_STYLE);
                return s.color;
              },

              // dash

              getDashArray: (d) => {
                const s = parseOgrPenStyle(d.properties?.OGR_STYLE);
                // если OGR_STYLE не дал dash — fallback на Linetype (простая эвристика)
                //const dash = s.dashArray
                //  ? dashTokensToPx(s.dashArray, 14)
                //  : linetypeFallback(d.properties?.Linetype);
                return s.dashArray || [1, 0]; // сплошная
              },
              dashJustified: true,
              ...common,
              extensions: ClipExt
                ? [
                    pathStyle,
                    new ClipExt(),
                    new DataFilterExtension({ filterSize: 1 }),
                  ]
                : [pathStyle, new DataFilterExtension({ filterSize: 1 })],
            }),
          );
          out.push(
            new PathLayer({
              id: `${base}-paths-pixels`,
              data: d.paths,
              getPath: (p) => getPathLine(p),
              getFilterValue: (d) => (hasWidth(d) ? 1 : 0),
              filterRange: [0, 0],

              widthUnits: "pixels",
              //  getWidth: 0.2, // 30 см как было
              getWidth: 1,
              capRounded: false,
              jointRounded: false,
              miterLimit: 2,
              // цвет
              getColor: (d) => {
                const s = parseOgrPenStyle(d.properties?.OGR_STYLE);
                return s.color;
              },

              // dash

              getDashArray: (d) => {
                const s = parseOgrPenStyle(d.properties?.OGR_STYLE);
                // если OGR_STYLE не дал dash — fallback на Linetype (простая эвристика)
                //const dash = s.dashArray
                //  ? dashTokensToPx(s.dashArray, 14)
                //  : linetypeFallback(d.properties?.Linetype);
                return s.dashArray || [1, 0]; // сплошная
              },
              dashJustified: true,
              ...common,
              extensions: ClipExt
                ? [
                    pathStyle,
                    new ClipExt(),
                    new DataFilterExtension({ filterSize: 1 }),
                  ]
                : [pathStyle, new DataFilterExtension({ filterSize: 1 })],
            }),
          );
        }

        if (d.points?.length) {
          const labelPts = [];
          const otherPts = [];
          for (const p of d.points) {
            const props = getProperties(p);
            if (
              isLabelStyle(props?.OGR_STYLE) &&
              (props?.Text || props?.text)
            ) {
              labelPts.push(p);
            } else {
              otherPts.push(p);
            }
          }

          // 2) labels
          if (labelPts.length) {
            out.push(
              new TextLayer({
                id: `${base}-labels`,
                data: labelPts,
                getPosition: (p) => getPointPos(p),

                // Cyrillic + Latin + digits + punctuation
                characterSet:
                  "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz" +
                  "АБВГДЕЁЖЗИЙКЛМНОПРСТУФХЦЧШЩЪЫЬЭЮЯ" +
                  "абвгдеёжзийклмнопрстуфхцчшщъыьэюя" +
                  "0123456789" +
                  "–⌀№.,:;!?\"'()[]{}<>+-=*/\\|@#$%^&_~` \n",

                // текст лучше брать из props.Text (у тебя он уже нормальный, с переносами строк)
                getText: (p) => {
                  const props = getProperties(p);
                  return props?.Text ?? props?.text ?? "";
                },

                // стиль из OGR_STYLE
                getColor: (p) => {
                  const props = getProperties(p);
                  return parseOgrLabelStyle(props?.OGR_STYLE).color;
                },
                getAngle: (p) => {
                  const props = getProperties(p);
                  return parseOgrLabelStyle(props?.OGR_STYLE).angle;
                },
                getSize: (p) => {
                  const props = getProperties(p);
                  return parseOgrLabelStyle(props?.OGR_STYLE).size;
                },
                //fontFamily: "PT Sans",
                //fontWeight: 700,
                /*getFontFamily: "PT Sans" /*(p) => {
                  const props = getProperties(p);
                  return parseOgrLabelStyle(props?.OGR_STYLE).fontFamily;
                },*/ getTextAnchor: (p) => {
                  const props = getProperties(p);
                  return parseOgrLabelStyle(props?.OGR_STYLE).textAnchor;
                },
                getAlignmentBaseline: (p) => {
                  const props = getProperties(p);
                  return parseOgrLabelStyle(props?.OGR_STYLE).alignmentBaseline;
                },

                // DXF-size в "g" -> метры
                sizeUnits: "meters",

                // чтобы не “стояло лицом к камере” (иначе угол может выглядеть странно)
                billboard: false,
                // легкая читаемость
                //background: true,
                getBackgroundColor: (p) => {
                  const props = getProperties(p);
                  const st = parseOgrLabelStyle(props?.OGR_STYLE);
                  // включаем фон только если bo:1
                  return st.background ? st.backgroundColor : [0, 0, 0, 0];
                },

                // picking/tooltip/click
                ...common,
              }),
            );
          }

          // 1) non-label points (если нужны как маркеры)
          /* if (otherPts.length) {
            out.push(
              new ScatterplotLayer({
                id: `${base}-pts`,
                data: labelPts, //otherPts,
                getPosition: (p) => getPointPos(p),
                getRadius: 2.5,
                radiusUnits: "pixels",
                getFillColor: pointColor,
                //...common,
              })
            );
          }*/
        }

        return out;
      },

      parameters: { depthTest: false },
    });

    const existing =
      deckOverlay?._deck?.props?.layers || deckOverlay?.props?.layers || [];
    const prefix = `${id}-`; // our namespace, e.g. "topo-" or "dxf-"
    // Keep everything except our own previous layers (unless explicitly kept)
    const keep = existing.filter((l) => {
      const lid = String(l?.id ?? "");
      if (!lid) return true;
      if (keepLayerIds?.length && keepLayerIds.includes(lid)) return true;
      return !lid.startsWith(prefix);
    });

    // Append our TileLayer after the kept layers, preserving previous renderers
    deckOverlay.setProps({ layers: [...keep, tileLayer] });

    log?.("PMTiles rendered in deck (with picking + tooltip).");
  }

  function dispose() {
    removeOurLayers();
    // tooltip не трогаю, потому что оно может быть нужно другим слоям
  }

  function refresh() {
    apply();
  }

  return { apply, refresh, dispose, removeOurLayers };
}
