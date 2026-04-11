// dxf-width-worker.js
// Быстрый DXF scanner для width полилиний.
// DXF ожидается текстовый (ASCII/UTF-8). Если DXF бинарный — не взлетит.

self.onmessage = async (e) => {
  console.log("[DXF width] worker started");

  const { file } = e.data || {};
  const CHUNK_SIZE = 5000;
  let chunk = [];
  let sent = 0;
  if (!file) {
    self.postMessage({ type: "error", message: "No file provided" });
    return;
  }

  try {
    const t0 = performance.now();

    // DXF = пары строк: <group code>\n<value>\n...
    const text = await file.text();

    let i = 0;
    const n = text.length;

    // утилита: прочитать строку до \n (без аллокаций массивов)
    function readLine() {
      if (i >= n) return null;
      let j = text.indexOf("\n", i);
      if (j === -1) j = n;
      let line = text.slice(i, j);
      if (line.endsWith("\r")) line = line.slice(0, -1);
      i = j + 1;
      return line;
    }

    // текущее состояние внутри ENTITY
    let inEntities = false;
    let currentType = null; // "LWPOLYLINE" / "POLYLINE" / "HATCH" / ...
    let handle = null;
    let currentLayerName = null; // DXF group code 8
    //const layerSet = new Set();
    const layerTypeMap = new Map(); // layerName -> Set(types)

    // --- POLYLINE/LWPOLYLINE aggregation (max width over 43/40/41) ---
    let polyActive = false;
    let polyType = null; // "LWPOLYLINE" | "POLYLINE"
    let polyHandle = null; // handle именно полилинии (не VERTEX)
    let polyWidthMax = 0;

    function noteWidthCandidate(num) {
      if (!Number.isFinite(num) || num <= 0) return;
      if (num > polyWidthMax) polyWidthMax = num;
    }

    function flushPolyline() {
      if (!polyActive) return;
      if (polyHandle && Number.isFinite(polyWidthMax) && polyWidthMax > 0) {
        found++;
        pushPair(polyHandle, { w: polyWidthMax });
      }
      polyActive = false;
      polyType = null;
      polyHandle = null;
      polyWidthMax = 0;
    }

    // width candidates
    let w43 = null; // constant width
    let w40 = null; // start width
    let w41 = null; // end width

    // HATCH candidates (minimal)
    let hatchPattern = null; // group 2 (pattern name)
    let hatchAngle = null; // group 52
    let hatchScale = null; // group 41
    let hatchTransp = null; // group 440 (0..1 or 0..100 depending on writer; we'll store raw number)

    // --- MULTILEADER extraction (text position + leader start + text) ---
    let mldrActive = false;
    let mldrHandle = null;
    let mldrInContext = false;
    let mldrLeaderFrom = null; // [x,y]
    let mldrTextPos = null; // [x,y]
    let mldrTextRaw = null;

    function resetMldr() {
      mldrActive = false;
      mldrHandle = null;
      mldrInContext = false;
      mldrLeaderFrom = null;
      mldrTextPos = null;
      mldrTextRaw = null;
    }

    function decodeMtextRaw(s) {
      if (typeof s !== "string") return "";
      // минимально полезная “очистка”:
      // \P -> перенос строки, убираем большинство форматных {\...; ...}
      let out = s.replace(/\\P/g, "\n");
      // убрать DXF-коды вида {\H0.5x;\C7; ...}
      out = out.replace(/\{\\[^}]*?;/g, ""); // срежем "{\H..;\C..;" в начале фрагментов
      out = out.replace(/[{}]/g, "");
      return out.trim();
    }

    function flushMldr() {
      if (!mldrHandle) return;
      const payload = {};
      if (mldrTextPos) payload.lp = mldrTextPos; // label position
      if (mldrLeaderFrom) payload.lf = mldrLeaderFrom; // leader-from
      if (mldrTextRaw) payload.tr = mldrTextRaw; // raw text
      const t = decodeMtextRaw(mldrTextRaw);
      if (t) payload.t = t; // plain text
      if (Object.keys(payload).length) {
        found++;
        pushPair(mldrHandle, payload);
      }
    }

    let found = 0;
    function pushPair(handle, payload) {
      handle = handle.toString();
      chunk.push({ h: handle, ...payload });
      if (chunk.length >= CHUNK_SIZE) {
        sent += chunk.length;
        self.postMessage({ type: "chunk", items: chunk });
        chunk = [];
      }
    }

    function flushEntity() {
      if (!currentType) return;

      // classify geometry type by DXF entity type
      let geomType = null;
      let isOther = false;

      switch (currentType) {
        // polygon-like
        case "HATCH":
          geomType = "polygon";
          break;
        // line-like
        case "LINE":
        case "LWPOLYLINE":
        case "POLYLINE":
        case "ARC":
        case "CIRCLE":
        case "ELLIPSE":
        case "SPLINE":
          geomType = "line";
          break;

        // point / annotation-like
        case "POINT":
        case "TEXT":
        case "MTEXT":
        case "DIMENSION":
        case "LEADER":
        case "MULTILEADER":
        case "INSERT":
          geomType = "point";
          break;

        default:
          // неизвестный/экзотический тип
          isOther = true;
          break;
      }

      if (currentLayerName) {
        let set = layerTypeMap.get(currentLayerName);
        if (!set) {
          set = new Set();
          layerTypeMap.set(currentLayerName, set);
        }
        //set.add(geomType);
        if (geomType) {
          set.add(geomType);
        }
        if (isOther) {
          // fallback: считаем, что в этом слое потенциально есть всё
          set.add("point");
          set.add("line");
          set.add("polygon");
        }
      }

      if (
        (currentType === "LWPOLYLINE" || currentType === "POLYLINE") &&
        handle
      ) {
        let w = null;

        if (w43 != null && Number.isFinite(w43) && w43 > 0) {
          w = w43;
        } else if (
          (w40 != null && Number.isFinite(w40) && w40 > 0) ||
          (w41 != null && Number.isFinite(w41) && w41 > 0)
        ) {
          const a = w40 != null && Number.isFinite(w40) ? w40 : 0;
          const b = w41 != null && Number.isFinite(w41) ? w41 : a;
          w = (a + b) * 0.5;
        }

        if (w != null && Number.isFinite(w) && w > 0) {
          found++;
          // логгируем не каждую, чтобы не убить консоль
          pushPair(handle, { w });
        }
      }

      // Minimal HATCH capture
      if (currentType === "HATCH" && handle) {
        const out = {};
        if (hatchTransp != null && Number.isFinite(hatchTransp))
          out.ht = hatchTransp;
        if (hatchPattern) out.hp = hatchPattern;
        if (hatchAngle != null && Number.isFinite(hatchAngle))
          out.ha = hatchAngle;
        if (hatchScale != null && Number.isFinite(hatchScale))
          out.hs = hatchScale;
        // only send if we captured something
        if (Object.keys(out).length) {
          found++;
          pushPair(handle, out);
        }
      }

      // reset entity state
      currentType = null;
      handle = null;
      currentLayerName = null;
      w43 = null;
      w40 = null;
      w41 = null;

      hatchPattern = null;
      hatchAngle = null;
      hatchScale = null;
      hatchTransp = null;
    }

    // основной цикл по парам (code,value)
    while (true) {
      const codeLine = readLine();
      if (codeLine == null) break;
      const valueLine = readLine();
      if (valueLine == null) break;

      const code = parseInt(codeLine.trim(), 10);
      const value = valueLine; // строка (может быть число/текст)

      // секции
      if (code === 0) {
        const v = value.trim();

        // закрытие предыдущего MULTILEADER на границе сущности
        if (mldrActive && v !== "MULTILEADER") {
          flushMldr();
          resetMldr();
        }

        if (v === "SECTION") {
          // ничего
        } else if (v === "ENDSEC") {
          // выход из ENTITIES
          if (inEntities) {
            flushEntity();
            flushPolyline(); // добиваем полилинию
            if (mldrActive) {
              flushMldr();
              resetMldr();
            }
            inEntities = false;
          }
        } else if (v === "EOF") {
          flushEntity();
          flushPolyline();
          if (mldrActive) {
            flushMldr();
            resetMldr();
          }
          break;
        } else {
          // начало новой сущности или спец-токены
          if (inEntities) {
            // новая сущность => закрыть предыдущую
            //flushEntity();
            //currentType = v;
            // если это не продолжение POLYLINE-пакета, закрываем текущую polyline
            if (polyActive) {
              if (polyType === "POLYLINE") {
                if (v === "SEQEND") flushPolyline();
                else if (v !== "VERTEX") flushPolyline(); // любая другая ENTITY завершает пакет
              } else if (polyType === "LWPOLYLINE") {
                //if (v !== "LWPOLYLINE") flushPolyline();
                // LWPOLYLINE ВСЕГДА заканчивается на границе сущности (code 0),
                // даже если следующая сущность тоже LWPOLYLINE
                flushPolyline();
              }
            }
            flushEntity(); // HATCH и прочее как было
            currentType = v;
            currentLayerName = null;

            if (v === "MULTILEADER") {
              resetMldr();
              mldrActive = true;
            }

            if (v === "LWPOLYLINE" || v === "POLYLINE") {
              polyActive = true;
              polyType = v;
              polyHandle = null;
              polyWidthMax = 0;
            }
          }
        }
        continue;
      }

      // определяем вход в ENTITIES секцию
      if (code === 2) {
        if (value.trim() === "ENTITIES") {
          inEntities = true;
          // перед входом — сброс
          flushEntity();
        }
        continue;
      }

      if (!inEntities || !currentType) continue;

      // DXF Layer name
      if (code === 8) {
        currentLayerName = value.trim();
        //if (currentLayerName) layerSet.add(currentLayerName);
        if (!layerTypeMap.has(currentLayerName)) {
          layerTypeMap.set(currentLayerName, new Set());
        }
        continue;
      }

      // ловим handle и ширины
      /* if (code === 5) {
        handle = value.trim();
      } else if (code === 43) {
        const num = Number(value.trim());
        if (Number.isFinite(num)) w43 = num;
      } else if (code === 40) {
        const num = Number(value.trim());
        if (Number.isFinite(num)) w40 = num;
      } else if (code === 41) {
        const num = Number(value.trim());
        if (Number.isFinite(num)) w41 = num;
      } else if (currentType === "HATCH") {*/
      if (code === 5) {
        handle = value.trim();
        // handle полилинии берём только с самой POLYLINE/LWPOLYLINE (не с VERTEX)
        if (polyActive && !polyHandle && currentType === polyType) {
          polyHandle = handle;
        }
      } else if (polyActive && (code === 43 || code === 40 || code === 41)) {
        const num = Number(value.trim());
        noteWidthCandidate(num); // <-- MAX вместо среднего
      } else if (currentType === "HATCH") {
        if (code === 2) {
          // pattern name
          hatchPattern = value.trim();
        } else if (code === 52) {
          const num = Number(value.trim());
          if (Number.isFinite(num)) hatchAngle = num;
        } else if (code === 41) {
          const num = Number(value.trim());
          if (Number.isFinite(num)) hatchScale = num;
        } else if (code === 440) {
          const num = Number(value.trim());
          if (Number.isFinite(num)) hatchTransp = num;
        }
      }

      // --- MULTILEADER parsing ---
      if (mldrActive && currentType === "MULTILEADER") {
        if (code === 5) {
          mldrHandle = value.trim();
          continue;
        }
        // OGR/DXF: CONTEXT_DATA{ идёт как 300
        if (code === 300 && String(value).includes("CONTEXT_DATA{")) {
          mldrInContext = true;
          continue;
        }
        // Ловим точки только внутри контекста (там они стабильно есть)
        if (
          mldrInContext &&
          (code === 10 || code === 20 || code === 12 || code === 22)
        ) {
          const num = Number(value.trim());
          if (!Number.isFinite(num)) continue;
          // 10/20 = leader anchor, 12/22 = text position (по твоему dxf это так) :contentReference[oaicite:1]{index=1}
          if (code === 10) mldrLeaderFrom = [num, mldrLeaderFrom?.[1] ?? 0];
          if (code === 20) mldrLeaderFrom = [mldrLeaderFrom?.[0] ?? 0, num];
          if (code === 12) mldrTextPos = [num, mldrTextPos?.[1] ?? 0];
          if (code === 22) mldrTextPos = [mldrTextPos?.[0] ?? 0, num];
          continue;
        }
        if (mldrInContext && code === 304) {
          mldrTextRaw = value; // содержит {\H..;\C..; ... \P ...} :contentReference[oaicite:2]{index=2}
          continue;
        }
      }
    }

    const t1 = performance.now();
    // flush remainder
    if (chunk.length) {
      sent += chunk.length;
      self.postMessage({ type: "chunk", items: chunk });
      chunk = [];
    }

    self.postMessage({
      type: "done",
      found,
      sent,
      ms: t1 - t0,
      fileName: file.name,

      //layers: Array.from(layerTypeMap.entries()).map(([name, types]) => ({name,types: Array.from(types),}))       .sort((a, b) => String(a.name).localeCompare(String(b.name), "ru")),
      layers: Array.from(layerTypeMap.entries())
        .reverse()
        .map(([name, types]) => ({
          name,
          types: Array.from(types),
        })),
    });
  } catch (err) {
    console.error(err);
    self.postMessage({ type: "error", message: String(err?.message || err) });
  }
};
