export function initComments(map, deck, options = {}) {
  const {
    name,
    toggleButtonId = "toggleComments",
    //panelId = "commentsPanel",
    //screenOutlineId = "screenOutline",
    minDrawZoom = 16,
    dom = {},
    storage = {},
    spatial = {},
    hooks = {},
  } = options;

  const { addCommentButton = null, drawButton = null } = dom;
  const { loadAll = null, saveOne = null, deleteOne = null } = storage;
  const drawBtn = drawButton;

  const { bordersGeojson = null, streetNameProp = "Name" } = spatial;

  const { onCommentsStateChange = null } = hooks;

  const defColor = "rgb(0, 41, 112)"; //rgb(37, 147, 110)

  let showComments = false;
  let addingCommentMode = false;
  let activePopupElement = null;
  let activePopups = [];
  let commentFeatures = [];
  let commentsByStreet = new Map();
  let draggingPopup = null;
  let draggingPopupIndex = null;
  let isDragging = false;

  let isInitialLoadComplete = false;

  const saveTimers = new Map(); // id -> timeout id
  const saveInFlight = new Map(); // id -> boolean
  const saveQueued = new Map(); // id -> boolean

  //////
  let isDrawing = false;
  let drawingMode = false;
  let selectedLineId = null;
  let deletePopup = null;
  let currentLineCoords = [];
  let currentLineColor = "#d54e55";
  let drawnLines = []; // массив Feature
  //////

  const toggleBtn = document.getElementById(toggleButtonId);
  //const commentsPanel = document.getElementById(panelId);

  const addBtn = addCommentButton;

  //const screenOutline = document.getElementById(screenOutlineId);

  if (!name) {
    throw new Error("initComments: option 'name' is required");
  }
  if (!addBtn) {
    throw new Error("initComments: dom.addCommentButton is required");
  }
  if (!drawBtn) {
    throw new Error("initComments: dom.drawButton is required");
  }
  if (typeof loadAll !== "function") {
    throw new Error("initComments: storage.loadAll must be a function");
  }
  if (typeof saveOne !== "function") {
    throw new Error("initComments: storage.saveOne must be a function");
  }
  if (typeof deleteOne !== "function") {
    throw new Error("initComments: storage.deleteOne must be a function");
  }

  // =========================
  // deck.gl FREEHAND LAYERS
  // =========================
  const DECK_LINE_LAYER_ID = name + "-freehand-lines-deck";
  const DECK_LINE_OUTLINE_LAYER_ID = name + "-freehand-lines-deck-outline";
  const DECK_LINE_PICK_LAYER_ID = name + "-freehand-lines-deck-pick";

  // =========================
  // deck.gl COMMENT LAYERS
  // =========================
  const DECK_COMMENT_POINTS_LAYER_ID = name + "-comments-deck-points";
  const DECK_COMMENT_POINTS_OUTLINE_LAYER_ID =
    name + "-comments-deck-points-outline";
  const DECK_COMMENT_CURVES_OUTLINE_LAYER_ID =
    name + "-comments-deck-curves-outline";
  const DECK_COMMENT_CURVES_ACTIVE_LAYER_ID =
    name + "-comments-deck-curves-active";
  const DECK_COMMENT_CURVES_RESOLVED_LAYER_ID =
    name + "-comments-deck-curves-resolved";

  function featureToEntity(feature) {
    const entityType =
      feature?.geometry?.type === "LineString" ? "line" : "comment";

    const id = feature?.properties?.id;
    if (!id) {
      throw new Error("featureToEntity: feature.properties.id is required");
    }

    return {
      id,
      project: name,
      entityType,
      feature,
      createdAt: feature.properties.createdAt || new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
  }

  function scheduleFeatureSave(feature, delay = 1200) {
    if (!isInitialLoadComplete) return;
    if (!feature?.properties?.id) return;

    const id = feature.properties.id;
    clearTimeout(saveTimers.get(id));

    const timer = setTimeout(() => {
      void flushFeatureSave(feature);
    }, delay);

    saveTimers.set(id, timer);
  }

  async function flushFeatureSave(feature) {
    const id = feature?.properties?.id;
    if (!id) return;

    if (saveInFlight.get(id)) {
      saveQueued.set(id, true);
      return;
    }

    saveInFlight.set(id, true);
    saveQueued.set(id, false);

    try {
      await saveOne(name, featureToEntity(feature));
    } catch (err) {
      console.error("Autosave failed:", err);
      showToast("Ошибка сохранения");
    } finally {
      saveInFlight.set(id, false);

      if (saveQueued.get(id)) {
        saveQueued.set(id, false);
        scheduleFeatureSave(feature, 300);
      }
    }
  }

  async function removeFeatureFromStorage(featureId) {
    try {
      await deleteOne(name, featureId);
    } catch (err) {
      console.error("Delete failed:", err);
      showToast("Ошибка удаления");
    }
  }

  function getPointStreetName(feature) {
    if (!bordersGeojson?.features?.length) return null;
    if (feature?.geometry?.type !== "Point") return null;

    const coords = feature.geometry.coordinates;
    if (!Array.isArray(coords) || coords.length < 2) return null;

    const pt = turf.point(coords);

    for (const borderFeature of bordersGeojson.features) {
      if (!borderFeature?.geometry) continue;

      try {
        if (turf.booleanPointInPolygon(pt, borderFeature)) {
          return borderFeature.properties?.[streetNameProp] || null;
        }
      } catch (err) {
        console.warn("[comments] point-in-polygon failed:", err);
      }
    }

    return null;
  }

  function ensureCommentStreetAssignment(feature) {
    if (!feature?.properties) feature.properties = {};
    if (feature?.geometry?.type !== "Point") return null;

    const streetName = getPointStreetName(feature);
    feature.properties.streetName = streetName || null;
    return streetName;
  }

  function rebuildCommentsByStreet() {
    commentsByStreet = new Map();

    for (const feature of commentFeatures) {
      if (feature?.geometry?.type !== "Point") continue;

      const streetName =
        feature.properties?.streetName ||
        ensureCommentStreetAssignment(feature);

      if (!streetName) continue;

      if (!commentsByStreet.has(streetName)) {
        commentsByStreet.set(streetName, []);
      }

      commentsByStreet.get(streetName).push(feature);
    }

    for (const items of commentsByStreet.values()) {
      items.sort((a, b) => {
        const ad = a?.properties?.createdAt || "";
        const bd = b?.properties?.createdAt || "";
        return bd.localeCompare(ad);
      });
    }
  }

  function emitCommentsState() {
    if (typeof onCommentsStateChange !== "function") return;

    const streets = {};

    for (const [streetName, items] of commentsByStreet.entries()) {
      const unresolved = items.filter((f) => !f?.properties?.resolved).length;

      streets[streetName] = {
        total: items.length,
        unresolved,
        items: items.map((f) => ({
          id: f?.properties?.id,
          text: f?.properties?.text || "",
          resolved: !!f?.properties?.resolved,
          streetName: f?.properties?.streetName || streetName,
          coordinates: f?.geometry?.coordinates || null,
          popupOffset: f?.properties?.popupOffset || null,
          createdAt: f?.properties?.createdAt || null,
        })),
      };
    }

    onCommentsStateChange({ streets });
  }

  function syncStreetCommentsState() {
    rebuildCommentsByStreet();
    emitCommentsState();
  }

  function focusCommentById(id) {
    const feature = commentFeatures.find((f) => f?.properties?.id === id);
    if (!feature) return false;

    if (!showComments) {
      showComments = true;
    }

    const centerCoords =
      feature.properties?.popupOffset || feature.geometry?.coordinates;

    if (!centerCoords) return false;

    if (map.getZoom() < minDrawZoom) {
      map.jumpTo({
        center: centerCoords,
        zoom: minDrawZoom + 1,
      });
    } else {
      map.easeTo({
        center: centerCoords,
        zoom: Math.max(map.getZoom(), minDrawZoom),
        duration: 300,
      });
    }

    toggleComments();
    refreshPopupById(id);

    return true;
  }

  function _hexToRgba255(hex, a = 255) {
    if (!hex) return [0, 0, 0, a];
    const h = hex.replace("#", "").trim();
    if (h.length === 3) {
      const r = parseInt(h[0] + h[0], 16);
      const g = parseInt(h[1] + h[1], 16);
      const b = parseInt(h[2] + h[2], 16);
      return [r, g, b, a];
    }
    if (h.length >= 6) {
      const r = parseInt(h.slice(0, 2), 16);
      const g = parseInt(h.slice(2, 4), 16);
      const b = parseInt(h.slice(4, 6), 16);
      return [r, g, b, a];
    }
    return [0, 0, 0, a];
  }

  function _rgbToRgbaArray(rgb, a = 255) {
    if (!rgb) return [0, 0, 0, a];
    const m = /rgb\s*\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*\)/i.exec(rgb);
    if (!m) return [0, 0, 0, a];
    const r = Number(m[1]);
    const g = Number(m[2]);
    const b = Number(m[3]);
    return [r, g, b, a];
  }

  // интерполяция ширины как было в MapLibre:
  // layer: zoom 14 => 1px, zoom 18 => 3px
  function _lineWidthPxByZoom(z) {
    if (z <= 14) return 1;
    if (z >= 18) return 3;
    return 1 + ((z - 14) / (18 - 14)) * (3 - 1);
  }

  function _highlightWidthPxByZoom(z) {
    // highlight: zoom 14 => 6px, zoom 18 => 16px
    if (z <= 14) return 6;
    if (z >= 18) return 6;
    return 6; //+ ((z - 14) / (18 - 14)) * (16 - 6);
  }

  // Унифицированный доступ к слоям deck / MapboxOverlay
  function _getDeckLayers() {
    if (!deck) return [];
    if (Array.isArray(deck.props?.layers)) return deck.props.layers;
    if (Array.isArray(deck._props?.layers)) return deck._props.layers;
    return [];
  }

  function _upsertDeckLayers(newOnes) {
    if (!deck) return;
    //const prev = Array.isArray(deck.props?.layers) ? deck.props.layers : [];
    const prev = _getDeckLayers();
    const filtered = prev.filter(
      (l) =>
        l?.id !== DECK_LINE_LAYER_ID &&
        l?.id !== DECK_LINE_OUTLINE_LAYER_ID &&
        l?.id !== DECK_LINE_PICK_LAYER_ID,
    );
    deck.setProps({ layers: [...filtered, ...newOnes] });
  }

  function _removeDeckLayers() {
    if (!deck) return;
    //const prev = Array.isArray(deck.props?.layers) ? deck.props.layers : [];
    const prev = _getDeckLayers();
    const filtered = prev.filter(
      (l) =>
        l?.id !== DECK_LINE_LAYER_ID &&
        l?.id !== DECK_LINE_OUTLINE_LAYER_ID &&
        l?.id !== DECK_LINE_PICK_LAYER_ID,
    );
    deck.setProps({ layers: filtered });
  }

  function syncCommentsButtons() {
    const enabled = showComments;

    toggleBtn?.classList.toggle("active", enabled);

    if (addBtn) {
      addBtn.style.display = enabled ? "" : "none";
      addBtn.classList.toggle("active", enabled && addingCommentMode);
    }

    if (drawBtn) {
      drawBtn.style.display = enabled ? "" : "none";
      drawBtn.classList.toggle("active", enabled && drawingMode);
    }
  }

  function syncCommentsInteractionState() {
    window.__commentsBlockingMapInteractions = showComments; // && (addingCommentMode || drawingMode);
  }

  function resetCommentModes() {
    addingCommentMode = false;
    drawingMode = false;
    isDrawing = false;
    currentLineCoords = [];

    map.getCanvas().style.cursor = "";
    document.body.style.overflow = "";

    if (deletePopup) {
      deletePopup.remove();
      deletePopup = null;
    }

    selectedLineId = null;

    _refreshFreehandDeck();
    syncCommentsInteractionState();
    syncCommentsButtons();
  }

  function clearAllCommentPopups() {
    activePopups.forEach(({ popup }) => {
      try {
        popup.remove();
      } catch {}
    });

    activePopups = [];
    activePopupElement = null;
  }

  function isCommentsInteractionBlocking() {
    return showComments && (addingCommentMode || drawingMode);
  }
  // ===== deck.gl COMMENTS (points + curves) =====

  function _upsertCommentDeckLayers(newOnes) {
    if (!deck) return;
    const prev = _getDeckLayers();
    const filtered = prev.filter(
      (l) =>
        l?.id !== DECK_COMMENT_POINTS_LAYER_ID &&
        l?.id !== DECK_COMMENT_POINTS_OUTLINE_LAYER_ID &&
        l?.id !== DECK_COMMENT_CURVES_OUTLINE_LAYER_ID &&
        l?.id !== DECK_COMMENT_CURVES_ACTIVE_LAYER_ID &&
        l?.id !== DECK_COMMENT_CURVES_RESOLVED_LAYER_ID,
    );
    deck.setProps({ layers: [...filtered, ...newOnes] });
  }

  function _removeCommentDeckLayers() {
    if (!deck) return;
    const prev = _getDeckLayers();
    const filtered = prev.filter(
      (l) =>
        l?.id !== DECK_COMMENT_POINTS_LAYER_ID &&
        l?.id !== DECK_COMMENT_POINTS_OUTLINE_LAYER_ID &&
        l?.id !== DECK_COMMENT_CURVES_OUTLINE_LAYER_ID &&
        l?.id !== DECK_COMMENT_CURVES_ACTIVE_LAYER_ID &&
        l?.id !== DECK_COMMENT_CURVES_RESOLVED_LAYER_ID,
    );
    deck.setProps({ layers: filtered });
  }

  function _buildCommentsDeckLayers() {
    if (!deck || !showComments) return [];

    const zoom = map.getZoom();
    const visiblePoints = zoom >= minDrawZoom;

    const GeoJsonLayerCtor =
      (globalThis.deck && globalThis.deck.GeoJsonLayer) ||
      globalThis.GeoJsonLayer ||
      null;
    if (!GeoJsonLayerCtor) {
      console.warn("GeoJsonLayer not found. Make sure deck.gl is loaded.");
      return [];
    }
    const commentData = {
      type: "FeatureCollection",
      features: commentFeatures,
    };

    const unresolvedColor = _rgbToRgbaArray(defColor, 155);
    const resolvedColor = [153, 153, 153, 155];

    // Точки
    const pointsOutline = new GeoJsonLayerCtor({
      id: DECK_COMMENT_POINTS_OUTLINE_LAYER_ID,
      data: commentData,
      pickable: false,
      stroked: false,
      filled: true,
      pointType: "circle",
      pointRadiusUnits: "pixels",
      getPointRadius: 6,
      getFillColor: [255, 255, 255, 255],
      visible: visiblePoints,
      updateTriggers: {
        visible: [visiblePoints],
      },
    });

    const pointsFill = new GeoJsonLayerCtor({
      id: DECK_COMMENT_POINTS_LAYER_ID,
      data: commentData,
      pickable: false,
      stroked: false,
      filled: true,
      pointType: "circle",
      pointRadiusUnits: "pixels",
      getPointRadius: 4,
      getFillColor: (f) =>
        f?.properties?.resolved ? resolvedColor : unresolvedColor,
      visible: visiblePoints,
      updateTriggers: {
        visible: [visiblePoints],
        getFillColor: [commentFeatures.length],
      },
    });

    // Кривые забираем из geojson-source popup-curves
    const curvesData = {
      type: "FeatureCollection",
      features: commentFeatures
        .map((f, i) => {
          if (!f.properties.popupOffset) return null;
          return {
            type: "Feature",
            geometry: {
              type: "LineString",
              coordinates: computeDirectionalBezier(
                f.geometry.coordinates,
                f.properties.popupOffset,
              ),
            },
            properties: {
              featureIndex: i,
              resolved: f.properties.resolved || false,
            },
          };
        })
        .filter(Boolean),
    };

    const unresolvedCurves = {
      type: "FeatureCollection",
      features: curvesData.features.filter((f) => !f?.properties?.resolved),
    };
    const resolvedCurves = {
      type: "FeatureCollection",
      features: curvesData.features.filter((f) => !!f?.properties?.resolved),
    };

    const curvesOutline = new GeoJsonLayerCtor({
      id: DECK_COMMENT_CURVES_OUTLINE_LAYER_ID,
      data: curvesData,
      pickable: false,
      stroked: true,
      filled: false,
      lineWidthUnits: "pixels",
      lineCapRounded: true,
      lineJointRounded: true,
      getLineWidth: 5,
      getLineColor: [255, 255, 255, 255],
    });
    const curvesActive = new GeoJsonLayerCtor({
      id: DECK_COMMENT_CURVES_ACTIVE_LAYER_ID,
      data: unresolvedCurves,
      pickable: false,
      stroked: true,
      filled: false,
      lineWidthUnits: "pixels",
      lineCapRounded: true,
      lineJointRounded: true,
      getLineWidth: 3,
      getLineColor: unresolvedColor,
    });

    const curvesResolved = new GeoJsonLayerCtor({
      id: DECK_COMMENT_CURVES_RESOLVED_LAYER_ID,
      data: resolvedCurves,
      pickable: false,
      stroked: true,
      filled: false,
      lineWidthUnits: "pixels",
      lineCapRounded: true,
      lineJointRounded: true,
      getLineWidth: 3,
      getLineColor: resolvedColor,
    });

    return [
      curvesOutline,
      curvesActive,
      curvesResolved,
      pointsOutline,
      pointsFill,
    ];
  }

  function _refreshCommentsDeck() {
    if (!deck) return;
    const zoom = map.getZoom();
    if (!showComments || zoom < minDrawZoom) {
      _removeCommentDeckLayers();
      return;
    }
    const layers = _buildCommentsDeckLayers();
    _upsertCommentDeckLayers(layers);
  }

  function _buildFreehandDeckLayers() {
    if (!deck) return [];
    // важный момент: previewLine как раньше — временная линия во время рисования
    const previewLine =
      currentLineCoords.length > 1
        ? [
            {
              type: "Feature",
              geometry: { type: "LineString", coordinates: currentLineCoords },
              properties: {
                color: currentLineColor,
                type: "line-preview",
                id: "__preview__",
              },
            },
          ]
        : [];

    const data = {
      type: "FeatureCollection",
      features: [...drawnLines, ...previewLine],
    };

    const z = map.getZoom();
    const baseWidth = _lineWidthPxByZoom(z);
    const hiWidth = _highlightWidthPxByZoom(z);

    // ВАЖНО: мы не импортируем тут GeoJsonLayer, предполагаем что он доступен как deck.GeoJsonLayer
    // или у тебя уже есть import в проекте. Ниже — самый совместимый вариант:
    const GeoJsonLayerCtor =
      (globalThis.deck && globalThis.deck.GeoJsonLayer) ||
      globalThis.GeoJsonLayer ||
      null;

    if (!GeoJsonLayerCtor) {
      console.warn("GeoJsonLayer not found. Make sure deck.gl is loaded.");
      return [];
    }

    const visibleOutline = new GeoJsonLayerCtor({
      id: DECK_LINE_OUTLINE_LAYER_ID,
      data,
      pickable: false,
      stroked: true,
      filled: false,
      lineWidthUnits: "pixels",
      lineCapRounded: true,
      lineJointRounded: true,
      getLineWidth: (f) => {
        if (!f?.properties?.id) return baseWidth;
        if (selectedLineId && f.properties.id === selectedLineId)
          return hiWidth + 2;
        return baseWidth + 2;
      },
      getLineColor: [255, 255, 255],
      updateTriggers: {
        getLineWidth: [selectedLineId, z],
        getLineColor: [selectedLineId],
      },
    });

    // Видимый слой + highlight (по selectedLineId) в getLineColor/getLineWidth
    const visible = new GeoJsonLayerCtor({
      id: DECK_LINE_LAYER_ID,
      data,
      pickable: false,
      stroked: true,
      filled: false,
      lineWidthUnits: "pixels",
      lineCapRounded: true,
      lineJointRounded: true,
      getLineWidth: (f) => {
        if (!f?.properties?.id) return baseWidth;
        if (selectedLineId && f.properties.id === selectedLineId)
          return hiWidth;
        return baseWidth;
      },
      getLineColor: (f) => {
        // highlight как раньше: чёрный (а под ним белый контур у тебя был highlight2,
        // но он фактически не использовался — оставляем один “жирный” highlight)
        // if (selectedLineId && f?.properties?.id === selectedLineId)
        //   return [0, 0, 0, 255];
        // обычный цвет из properties.color (hex)
        const c = f?.properties?.color;
        return _hexToRgba255(c, 255);
      },
      updateTriggers: {
        getLineWidth: [selectedLineId, z],
        getLineColor: [selectedLineId],
      },
    });

    // Невидимый pick-слой с большой шириной для удобного клика
    const pick = new GeoJsonLayerCtor({
      id: DECK_LINE_PICK_LAYER_ID,
      data,
      pickable: true,
      autoHighlight: false,
      stroked: true,
      filled: false,
      opacity: 0.3,
      lineWidthUnits: "pixels",
      getLineWidth: () => Math.max(20, hiWidth), // как у тебя было line-width: 20 на click-слое
      getLineColor: () => [0, 0, 0, 0], // прозрачный
      onHover: (info) => {
        if (drawingMode) return;
        map.getCanvas().style.cursor = info?.object ? "pointer" : "";
      },
    });

    return [visibleOutline, visible, pick];
  }

  function _refreshFreehandDeck() {
    if (!deck) return;
    if (!showComments || map.getZoom() < minDrawZoom) {
      // комментарии выключены => убираем слои рисования (как раньше visibility:none)
      _removeDeckLayers();
      return;
    }
    const layers = _buildFreehandDeckLayers();
    _upsertDeckLayers(layers);
  }

  // перехватываем deck.onClick, чтобы не ломать чужие onClick
  //const _prevDeckOnClick = deck?.props?.onClick;
  const _prevDeckOnClick =
    (deck && (deck.props?.onClick || deck._props?.onClick)) || null;
  if (deck) {
    deck.setProps({
      onClick: (info, evt) => {
        try {
          if (isCommentsInteractionBlocking()) {
            return;
          }
          if (!drawingMode) {
            // клик по линии
            if (
              info?.object?.properties?.id &&
              info.object.properties.id !== "__preview__"
            ) {
              selectedLineId = info.object.properties.id;
              deletePopup?.remove();
              deletePopup = null;

              const coords = info.coordinate; // [lng, lat]
              deletePopup = new mapboxgl.Popup({
                closeOnClick: true,
                closeButton: false,
                className: "techPopup",
              })
                .setLngLat(coords)
                .setHTML(
                  `<div class="popup-main"><button id="confirmDeleteLine">Удалить?</button></div>`,
                )
                .addTo(map);

              _refreshFreehandDeck();
            } else {
              // клик мимо линии
              selectedLineId = null;
              deletePopup?.remove();
              deletePopup = null;
              _refreshFreehandDeck();
            }
          }
        } finally {
          if (typeof _prevDeckOnClick === "function")
            _prevDeckOnClick(info, evt);
        }
      },
    });
  }
  ////

  /////////////////////////////

  /////////////////////////////

  /////////////////////////////

  /////////////////////////////

  /////////////////////////////Комментирование
  // Функция добавления комментария
  map.on("click", (e) => {
    if (!addingCommentMode) return;
    addingCommentMode = false;

    addBtn.classList.remove("active");
    map.getCanvas().style.cursor = "";

    const coords = e.lngLat;
    const popup = new mapboxgl.Popup({
      closeOnClick: true,
      closeButton: false,
      className: "techPopup",
    })
      .setLngLat(coords)
      .setHTML(
        `
  <div class="popup-main">
    <form id="commentForm" autocomplete="off">
      <input
        id="commentInput"
        type="text"
        inputmode="text"
        enterkeyhint="done"
        placeholder="Комментарий…"
        style="width: 220px;"
      />
      <div style="margin-top:8px; display:flex; gap:8px;">
        <button type="submit" id="saveComment">Добавить</button>
        <button type="button" id="cancelComment">Отмена</button>
      </div>
    </form>
  </div>
`,
      )

      .addTo(map);
    map.easeTo({
      center: coords,
      duration: 150,
      offset: [0, 0],
    });
    const popupEl = popup.getElement();
    const form = popupEl.querySelector("#commentForm");
    const input = popupEl.querySelector("#commentInput");
    const cancelBtn = popupEl.querySelector("#cancelComment");

    // фокус (чтобы сразу появилась клавиатура)
    setTimeout(() => input?.focus(), 0);

    form.addEventListener("submit", (evt) => {
      evt.preventDefault(); // не даём форме перезагрузить страницу
      evt.stopPropagation();

      const text = (input.value || "").trim();
      if (!text) return;

      const id = generateUUID();
      const feature = {
        type: "Feature",
        geometry: { type: "Point", coordinates: [coords.lng, coords.lat] },
        properties: {
          text,
          id: "comment-" + id,
          date: formatDateDDMMYY(),
          createdAt: new Date().toISOString(),
        },
      };
      console.log(feature);

      ensureCommentStreetAssignment(feature);
      commentFeatures.push(feature);
      scheduleFeatureSave(feature);
      syncStreetCommentsState();
      updateAllCurves();
      refreshPopupById(feature.properties.id);
      popup.remove();
    });

    cancelBtn.addEventListener("click", (evt) => {
      evt.preventDefault();
      evt.stopPropagation();
      // возвращаемся в режим crosshair / добавления — как ты хочешь
      addingCommentMode = true;
      addBtn.classList.add("active");
      map.getCanvas().style.cursor = "crosshair";
      popup.remove();
    });
  });

  function getEventCoordinates(e) {
    if (e.touches && e.touches.length > 0) {
      return [e.touches[0].clientX, e.touches[0].clientY];
    } else {
      return [e.clientX, e.clientY];
    }
  }

  // ✅ Touch-события для перетаскивания popup на мобильных

  function startTouchDragging(e) {
    const target = e.target;
    if (target.classList.contains("move-popup")) {
      const id = target.dataset.id;
      const popupRecord = activePopups.find((p) => p.index === id);
      if (!popupRecord) return;
      draggingPopup = popupRecord.popup;
      draggingPopupIndex = id;
      isDragging = true;
      document.body.style.overflow = "hidden";
      e.preventDefault();
    }
  }

  function touchDragPopup(e) {
    if (!isDragging || draggingPopupIndex === null) return;
    const [x, y] = getEventCoordinates(e);
    const rect = map.getContainer().getBoundingClientRect();
    const px = [x - rect.left, y - rect.top];
    const lngLat = map.unproject(px);

    if (draggingPopup) draggingPopup.setLngLat(lngLat);
    const feature = commentFeatures.find(
      (f) => f.properties.id === draggingPopupIndex,
    );
    if (feature) {
      feature.properties.popupOffset = [lngLat.lng, lngLat.lat];
      updateAllCurves();
    }
  }

  function endTouchDragging(e) {
    if (!isDragging || draggingPopupIndex === null) return;

    const feature = commentFeatures.find(
      (f) => f.properties.id === draggingPopupIndex,
    );
    if (feature) {
      scheduleFeatureSave(feature, 800);
      refreshPopupById(draggingPopupIndex);
      updateAllCurves();
    }

    draggingPopup = null;
    draggingPopupIndex = null;
    isDragging = false;
    document.body.style.overflow = "";
  }

  map
    .getContainer()
    .addEventListener("touchstart", startTouchDragging, { passive: false });
  map
    .getContainer()
    .addEventListener("touchmove", touchDragPopup, { passive: false });
  map
    .getContainer()
    .addEventListener("touchend", endTouchDragging, { passive: false });

  map
    .getContainer()
    .addEventListener("mousedown", startTouchDragging, { passive: false });
  map
    .getContainer()
    .addEventListener("mousemove", touchDragPopup, { passive: false });
  map
    .getContainer()
    .addEventListener("mouseup", endTouchDragging, { passive: false });

  function ensureFeatureIds() {
    commentFeatures.forEach((f) => {
      if (!f.properties.id) {
        const id = generateUUID();
        f.properties.id = "comment-" + id;
      }
    });
  }

  // ✅ Обновлённый updateSource — не дублирует popup'ы при moveend
  function updateSource() {
    if (!showComments) {
      clearAllCommentPopups();
      return;
    }

    ensureFeatureIds();
    _refreshCommentsDeck();

    if (showComments) {
      //const bounds = map.getBounds();
      const bounds = getBufferedBounds(100); // ⬅️ Заменили map.getBounds() на расширенные границы
      const existingIds = new Set(activePopups.map((p) => p.index));
      const updatedPopups = [];

      commentFeatures.forEach((f) => {
        const lngLat = f.properties.popupOffset || f.geometry.coordinates;
        if (!bounds.contains(lngLat)) return;
        if (existingIds.has(f.properties.id)) {
          // Уже есть — оставить как есть
          updatedPopups.push(
            activePopups.find((p) => p.index === f.properties.id),
          );
          return;
        }

        const popup = new mapboxgl.Popup({
          closeButton: false,
          closeOnClick: false,
          className: f.properties.resolved
            ? "comment-popup resolved-comment"
            : "comment-popup",
          anchor: "bottom",
        })
          .setLngLat(lngLat)
          .setHTML(createPopupHtml(f))
          .addTo(map);

        const popupEl = popup.getElement();
        popupEl.addEventListener(
          "touchstart",
          (e) => {
            if (e.touches.length > 1) {
              e.preventDefault();
              e.stopPropagation();
            }
          },
          { passive: false },
        );

        popupEl.addEventListener(
          "touchmove",
          (e) => {
            if (e.touches.length > 1) {
              e.preventDefault();
              e.stopPropagation();
            }
          },
          { passive: false },
        );

        updatedPopups.push({ index: f.properties.id, popup });
      });

      // Удалить popup’ы, которые ушли за пределы экрана
      activePopups.forEach(({ index, popup }) => {
        const stillVisible = updatedPopups.some((p) => p.index === index);
        if (!stillVisible) popup.remove();
      });

      activePopups = updatedPopups;
    }
  }

  function getBufferedBounds(bufferPx = 100) {
    const canvas = map.getCanvas();
    const rect = canvas.getBoundingClientRect();

    // Четыре угла экрана с буфером в пикселях
    const screenCorners = [
      [-bufferPx, -bufferPx], // левый верх
      [rect.width + bufferPx, -bufferPx], // правый верх
      [rect.width + bufferPx, rect.height + bufferPx], // правый низ
      [-bufferPx, rect.height + bufferPx], // левый низ
    ];

    // Проецируем в географические координаты
    const worldCorners = screenCorners.map((pt) => {
      const ll = map.unproject(pt);
      return [ll.lng, ll.lat];
    });

    // Полигон видимой области (с буфером)
    const ring = [...worldCorners, worldCorners[0]];
    const poly = turf.polygon([ring]);

    // Возвращаем объект с .contains(lngLat), как у LngLatBounds
    return {
      polygon: poly,
      contains(lngLat) {
        const pt = turf.point(lngLat);
        return turf.booleanPointInPolygon(pt, this.polygon);
      },
    };
  }

  function updateAllCurves() {
    const curves = commentFeatures
      .map((f, i) => {
        if (!f.properties.popupOffset) return null;
        return {
          type: "Feature",
          geometry: {
            type: "LineString",
            coordinates: computeDirectionalBezier(
              f.geometry.coordinates,
              f.properties.popupOffset,
            ),
          },
          properties: {
            featureIndex: i,
            resolved: f.properties.resolved || false,
          },
        };
      })
      .filter(Boolean);

    _refreshCommentsDeck();
  }

  // ✅ Обновлённая функция createPopupHtml с data-id вместо data-index
  function createPopupHtml(feature) {
    const replies = feature.properties.replies || [];
    const id = feature.properties.id;
    const isResolved = feature.properties.resolved;
    const resolveClass = isResolved ? "resolved-active" : "";
    const featureDate = feature.properties.date || "";
    const repliesHtml = replies
      .map(
        (r) => `
        <div class="reply" data-reply-id="${r.id}">
          <div class="reply-row">
            <div class="reply-text">${r.text}</div>
            <textarea class="reply-edit" style="display:none;">${r.text}</textarea>
            <div class="reply-actions hidden-inactive">
              <button class="edit-reply" data-id="${id}" data-reply-id="${r.id}"><i class="fa fa-pencil"></i></button>
              <button class="save-reply" style="display:none;" data-id="${id}" data-reply-id="${r.id}"><i class="fa fa-floppy-o"></i></button>
              <button class="delete-reply" data-id="${id}" data-reply-id="${r.id}"><i class="fa fa-times-circle"></i></button>
            </div>
          </div>
        </div>`,
      )
      .join("");

    return `
    <div class="popup-main" data-id="${id}">
      <div class="comment-text">${feature.properties.text}</div>
      <div class="date-shield" style="display:none;">${featureDate}</div>
      <textarea class="comment-edit" rows="5" style="display:none;">${feature.properties.text}</textarea>
      <div class="reply-block">${repliesHtml}</div>
      <div class="reply-input" style="display: none; flex-direction: column; gap: 6px;">
  <div class="reply-form" style="display:none;">
    <textarea rows="2" class="reply-text" placeholder="Введите ответ..."></textarea>
  </div>

  <div class="reply-buttons" style="display: flex; flex-wrap: wrap; align-items: center; gap: 4px;">
    <button class="add-reply" data-id="${feature.properties.id}" style="display:none;" title="Добавить ответ">
      <i class="fa fa-floppy-o" aria-hidden="true"></i>
    </button>

    <button class="resolve-comment ${resolveClass}" data-id="${feature.properties.id}" title="Отметить как решённый">
      <i class="fa fa-check" aria-hidden="true"></i>
    </button>

    <button class="show-reply-input" data-id="${feature.properties.id}" title="Ответить">
      <i class="fa fa-reply" aria-hidden="true"></i>
    </button>

    <button class="edit-comment" data-id="${feature.properties.id}" title="Редактировать">
      <i class="fa fa-pencil" aria-hidden="true"></i>
    </button>

    <button class="save-comment" style="display:none;" data-id="${feature.properties.id}" title="Сохранить">
      <i class="fa fa-floppy-o" aria-hidden="true"></i>
    </button>

    <div style="margin-left: auto; display: flex; gap: 4px;">
      <button class="move-popup" data-id="${feature.properties.id}" title="Переместить">
        <i class="fa fa-arrows" aria-hidden="true"></i>
      </button>
      <button class="delete-comment" data-id="${feature.properties.id}" style="color:black" title="Удалить">
        <i class="fa fa-trash" aria-hidden="true"></i>
      </button>
    </div>
  </div>
</div>

    </div>
  `;
  }

  function refreshPopupById(id) {
    const idx = commentFeatures.findIndex((f) => f.properties.id === id);
    if (idx === -1) return;

    // Удалить старый popup
    const existing = activePopups.find((p) => p.index === id);
    if (existing) {
      existing.popup.remove();
      activePopups = activePopups.filter((p) => p.index !== id);
    }

    const feature = commentFeatures[idx];
    const lngLat =
      feature.properties.popupOffset || feature.geometry.coordinates;
    if (!map.getBounds().contains(lngLat)) return;

    const popup = new mapboxgl.Popup({
      closeButton: false,
      closeOnClick: false,
      className: feature.properties.resolved
        ? "comment-popup resolved-comment"
        : "comment-popup",
      anchor: "bottom",
    })
      .setLngLat(lngLat)
      .setHTML(createPopupHtml(feature))
      .addTo(map);

    const popupEl = popup.getElement();
    popupEl.addEventListener(
      "touchstart",
      (e) => {
        if (e.touches.length > 1) {
          e.preventDefault();
          e.stopPropagation();
        }
      },
      { passive: false },
    );

    popupEl.addEventListener(
      "touchmove",
      (e) => {
        if (e.touches.length > 1) {
          e.preventDefault();
          e.stopPropagation();
        }
      },
      { passive: false },
    );

    activePopups.push({ index: id, popup });
    ////////// ой бля удалитьь это скорее всего придется
    // Автоматическая активация popup
    const popupRecord = activePopups.find((p) => p.index === id);
    if (popupRecord) {
      const popupEl = popupRecord.popup
        .getElement()
        .querySelector(".popup-main");
      if (popupEl) {
        popupEl
          .querySelector(".reply-input")
          ?.style.setProperty("display", "block");
        popupEl
          .querySelector(".date-shield")
          ?.style.setProperty("display", "block");
        popupEl
          .querySelectorAll(".reply-actions")
          .forEach((el) => el.classList.remove("hidden-inactive"));

        activePopupElement = popupEl;

        /*const feature = commentFeatures.find((f) => f.properties.id === id);
        if (feature) {
          const centerCoords =
            feature.properties.popupOffset || feature.geometry.coordinates;
          const popupHeight = popupEl.offsetHeight || 0;

          map.easeTo({
            center: centerCoords,
            zoom: Math.max(map.getZoom(), 17),
            duration: 300,
            offset: [0, popupHeight],
          });
        }*/
      }
    }
  }

  // ✅ Обновлённый обработчик кликов по popup с использованием data-id
  // ✅ Финальный рабочий обработчик кликов — всё по уникальному ID

  document.addEventListener("click", (e) => {
    const target = e.target;
    if (activePopupElement && !activePopupElement.contains(e.target)) {
      const el = activePopupElement;

      el.querySelector(".reply-input")?.style.setProperty("display", "none");
      el.querySelectorAll(".reply-form").forEach(
        (el) => (el.style.display = "none"),
      );
      el.querySelectorAll(".show-reply-input").forEach(
        (el) => (el.style.display = "flex") /*"inline-block"*/,
      );
      el.querySelectorAll(".comment-edit").forEach(
        (el) => (el.style.display = "none"),
      );
      el.querySelectorAll(".date-shield").forEach(
        (el) => (el.style.display = "none"),
      );
      el.querySelectorAll(".comment-text").forEach(
        (el) => (el.style.display = "block"),
      );
      el.querySelectorAll(".save-comment").forEach(
        (el) => (el.style.display = "none"),
      );
      el.querySelectorAll(".edit-comment").forEach(
        (el) => (el.style.display = "flex") /*"inline-block"*/,
      );
      el.querySelectorAll(".reply-edit").forEach(
        (el) => (el.style.display = "none"),
      );
      el.querySelectorAll(".reply-text").forEach(
        (el) => (el.style.display = "block"),
      );
      el.querySelectorAll(".save-reply").forEach(
        (el) => (el.style.display = "none"),
      );
      el.querySelectorAll(".edit-reply").forEach(
        (el) => (el.style.display = "flex") /*"inline-block"*/,
      );
      el.querySelectorAll(".reply-actions").forEach((el) =>
        el.classList.add("hidden-inactive"),
      );
      el.querySelectorAll(".reply-block").forEach((el) =>
        el.classList.remove("hidden"),
      );

      // 👁 Явно скрываем все save-кнопки и показываем edit-кнопки внутри popup
      activePopupElement
        .querySelectorAll(".save-comment")
        .forEach((el) => (el.style.display = "none"));
      activePopupElement
        .querySelectorAll(".edit-comment")
        .forEach((el) => (el.style.display = "flex") /*"inline-block"*/);
      activePopupElement
        .querySelectorAll(".add-reply")
        .forEach((el) => (el.style.display = "none"));
      activePopupElement
        .querySelectorAll(".show-reply-input")
        .forEach((el) => (el.style.display = "flex") /*"inline-block"*/);

      el.querySelectorAll(
        ".delete-comment, .move-popup, .resolve-comment, .show-reply-input, .add-reply, .edit-reply, .edit-comment",
      ).forEach((btn) => {
        btn.disabled = false;
        btn.style.opacity = "";
        btn.style.pointerEvents = "";
      });

      activePopupElement = null;
    }

    if (target.closest(".popup-main")) {
      const popup = target.closest(".popup-main");

      const id = popup.dataset.id;

      const feature = commentFeatures.find((f) => f.properties.id === id);
      if (!feature) return;

      // 💡 Только если это новый popup — делаем зум
      if (!activePopupElement || activePopupElement.dataset.id !== id) {
        const centerCoords =
          feature.properties.popupOffset || feature.geometry.coordinates;
        const popupHeight = popup?.offsetHeight || 0;

        map.easeTo({
          center: centerCoords,
          zoom: Math.max(map.getZoom(), 17),
          duration: 300,
          offset: [0, popupHeight],
        });
      }

      activePopupElement = popup;

      // 👁 Показываем UI
      const replyInput = popup.querySelector(".reply-input");
      if (replyInput) replyInput.style.display = "flex";

      popup.querySelector(".date-shield").style.display = "block";

      popup.querySelectorAll(".reply-actions").forEach((el) => {
        el.classList.remove("hidden-inactive");
      });
    }

    const id = target.dataset.id;
    const feature = commentFeatures.find((f) => f.properties.id === id);
    if (!feature) return;
    const idx = commentFeatures.indexOf(feature);

    if (target.classList.contains("delete-comment")) {
      var confirmDelete = confirm("Удалить комментарий?");
      if (confirmDelete) {
        const removed = commentFeatures.splice(idx, 1)[0];

        const popup = activePopups.find(
          (p) => p.index === feature.properties.id,
        );
        if (popup) popup.popup.remove();
        activePopups = activePopups.filter(
          (p) => p.index !== feature.properties.id,
        );

        void removeFeatureFromStorage(feature.properties.id);

        if (removed?.geometry?.type === "Point") {
          syncStreetCommentsState();
        }

        updateAllCurves();
      }
    }

    if (target.classList.contains("show-reply-input")) {
      const container = target.closest(".reply-input");
      container.querySelector(".reply-form").style.display = "block";
      container.querySelector(".add-reply").style.display =
        "flex" /*"inline-block"*/;
      target.style.display = "none";

      setTimeout(() => {
        container.querySelector(".reply-text")?.focus();
      }, 100);

      // 🔒 Скрываем/дизейблим все остальные кнопки
      container
        .querySelectorAll(
          ".delete-comment, .move-popup, .resolve-comment, .show-reply-input, .edit-comment, .edit-reply:not(.save-reply)",
        )
        .forEach((btn) => {
          btn.disabled = true;
          btn.style.opacity = "0.4";
          btn.style.pointerEvents = "none";
        });
    }

    if (target.classList.contains("add-reply")) {
      const container = target.closest(".popup-main");
      const replyForm = container.querySelector(".reply-form");
      const textarea = replyForm.querySelector(".reply-text");
      const text = textarea.value.trim();

      if (text) {
        const replyId = "reply-" + Date.now();
        feature.properties.replies ||= [];
        feature.properties.replies.push({ id: replyId, text });
        scheduleFeatureSave(feature);
        textarea.value = "";
        replyForm.style.display = "none";
        container.querySelector(".show-reply-input").style.display =
          "flex" /*"inline-block"*/;
        container.querySelector(".add-reply").style.display = "none";
        // updateSource();
        refreshPopupById(feature.properties.id);
      } else {
        // если ничего не ввели — свернуть всё
        replyForm.style.display = "none";
        container.querySelector(".add-reply").style.display = "none";
        container.querySelector(".show-reply-input").style.display =
          "flex" /*"inline-block"*/;

        // 🔓 Вернуть заблокированные кнопки
        container
          .querySelectorAll(
            ".delete-comment, .move-popup, .resolve-comment, .show-reply-input, .edit-comment, .edit-reply:not(.save-reply)",
          )
          .forEach((btn) => {
            btn.disabled = false;
            btn.style.opacity = "";
            btn.style.pointerEvents = "";
          });
      }
    }

    if (target.classList.contains("delete-reply")) {
      const replyId = target.dataset.replyId;
      feature.properties.replies = feature.properties.replies?.filter(
        (r) => r.id !== replyId,
      );
      scheduleFeatureSave(feature);
      refreshPopupById(feature.properties.id);
    }

    if (target.classList.contains("move-popup")) {
      draggingPopupIndex = id;
      draggingPopup = activePopups.find((p) => p.index === id)?.popup;
      e.preventDefault();
    }
    if (target.classList.contains("edit-comment")) {
      const container = target.closest(".popup-main");

      container.querySelector(".comment-text").style.display = "none";
      container.querySelector(".comment-edit").style.display = "block";

      container.querySelector(".comment-edit").focus();

      target.style.display = "none";
      container.querySelector(".save-comment").style.display =
        "flex" /*"inline-block"*/;

      // 🔒 Скрываем/дизейблим все остальные кнопки
      container.querySelector(".reply-block")?.classList.add("hidden");
      container
        .querySelectorAll(
          ".delete-comment, .move-popup, .resolve-comment, .show-reply-input, .add-reply",
        )
        .forEach((btn) => {
          btn.disabled = true;
          btn.style.opacity = "0.4";
          btn.style.pointerEvents = "none";
        });

      // 👁 Скрываем блок с ответами
      container.querySelector(".reply-block")?.classList.add("hidden");
    }

    if (target.classList.contains("save-comment")) {
      const container = target.closest(".popup-main");
      const newText = container.querySelector(".comment-edit").value.trim();
      if (newText) {
        feature.properties.text = newText;
        scheduleFeatureSave(feature);
        refreshPopupById(feature.properties.id);
      }

      // 🔓 Возвращаем интерфейс
      container.querySelector(".reply-block")?.classList.remove("hidden");
      container
        .querySelectorAll(
          ".delete-comment, .move-popup, .resolve-comment, .show-reply-input, .add-reply",
        )
        .forEach((btn) => {
          btn.disabled = false;
          btn.style.opacity = "";
          btn.style.pointerEvents = "";
        });
    }

    if (target.classList.contains("edit-reply")) {
      const container = target.closest(".reply");
      const popup = target.closest(".popup-main");

      container.querySelector(".reply-text").style.display = "none";
      container.querySelector(".reply-edit").style.display = "block";
      container.querySelector(".reply-edit").focus();
      container.querySelector(".edit-reply").style.display = "none";
      container.querySelector(".save-reply").style.display =
        "flex" /*"inline-block"*/;
    }

    if (target.classList.contains("save-reply")) {
      const replyId = target.dataset.replyId;
      const container = target.closest(".reply");
      const popup = target.closest(".popup-main");

      const newText = container.querySelector(".reply-edit").value.trim();
      if (newText) {
        const reply = feature.properties.replies?.find((r) => r.id === replyId);
        if (reply) {
          reply.text = newText;
          scheduleFeatureSave(feature);
          refreshPopupById(feature.properties.id);
        }
      }

      // 🔓 Возвращаем интерфейс
      popup
        .querySelectorAll(
          ".delete-comment, .move-popup, .resolve-comment, .show-reply-input, .edit-comment, .edit-reply:not(.save-reply)",
        )
        .forEach((btn) => {
          btn.disabled = false;
          btn.style.opacity = "";
          btn.style.pointerEvents = "";
        });
    }

    if (target.classList.contains("resolve-comment")) {
      feature.properties.resolved = !feature.properties.resolved;
      scheduleFeatureSave(feature);

      if (feature?.geometry?.type === "Point") {
        syncStreetCommentsState();
      }

      refreshPopupById(feature.properties.id);
      updateAllCurves();
    }

    if (
      !e.target.closest(".maplibregl-popup") &&
      !e.target.closest(".mapboxgl-popup")
    ) {
      document
        .querySelectorAll(".reply-input")
        .forEach((el) => (el.style.display = "none"));
      document
        .querySelectorAll(".reply-form")
        .forEach((el) => (el.style.display = "none"));
      document
        .querySelectorAll(".show-reply-input")
        .forEach((el) => (el.style.display = "flex") /*"inline-block"*/);
      document
        .querySelectorAll(".comment-edit")
        .forEach((el) => (el.style.display = "none"));
      document
        .querySelectorAll(".date-shield")
        .forEach((el) => (el.style.display = "none"));
      document
        .querySelectorAll(".comment-text")
        .forEach((el) => (el.style.display = "block"));
      document
        .querySelectorAll(".save-comment")
        .forEach((el) => (el.style.display = "none"));
      document
        .querySelectorAll(".edit-comment")
        .forEach((el) => (el.style.display = "flex") /*"inline-block"*/);
      document
        .querySelectorAll(".reply-edit")
        .forEach((el) => (el.style.display = "none"));
      document
        .querySelectorAll(".reply-text")
        .forEach((el) => (el.style.display = "block"));
      document
        .querySelectorAll(".save-reply")
        .forEach((el) => (el.style.display = "none"));
      document
        .querySelectorAll(".edit-reply")
        .forEach((el) => (el.style.display = "flex") /*"inline-block"*/);
      document
        .querySelectorAll(".reply-actions")
        .forEach((el) => el.classList.add("hidden-inactive"));
      draggingPopup = null;
      draggingPopupIndex = null;

      // 🔓 Возвращаем активность всем кнопкам
      document
        .querySelectorAll(
          ".delete-comment, .move-popup, .resolve-comment, .show-reply-input, .add-reply, .edit-reply, .edit-comment",
        )
        .forEach((btn) => {
          btn.disabled = false;
          btn.style.opacity = "";
          btn.style.pointerEvents = "";
        });

      // 👁 Показываем обратно .edit-*, скрываем .save-*
      document
        .querySelectorAll(".save-comment")
        .forEach((el) => (el.style.display = "none"));
      document
        .querySelectorAll(".edit-comment")
        .forEach((el) => (el.style.display = "flex") /*"inline-block"*/);

      document
        .querySelectorAll(".save-reply")
        .forEach((el) => (el.style.display = "none"));
      document
        .querySelectorAll(".edit-reply")
        .forEach((el) => (el.style.display = "flex") /*"inline-block"*/);

      // 👁 Показываем блок с ответами, если он был скрыт
      document
        .querySelectorAll(".reply-block")
        .forEach((el) => el.classList.remove("hidden"));
    }
  });

  toggleBtn.addEventListener("click", () => {
    showComments = !showComments;

    if (showComments && map.getZoom() < minDrawZoom) {
      map.zoomTo(minDrawZoom);
    }

    toggleComments();
  });

  map.on("moveend", () => {
    if (!showComments) return;
    //toggleComments();

    updateSource();
    updatePopupScales();
    _refreshCommentsDeck();
    _refreshFreehandDeck();
  });

  function toggleComments() {
    const zoom = map.getZoom();

    if (showComments) {
      if (zoom >= minDrawZoom) {
        toggleBtn.classList.add("active");

        updateSource();
        updatePopupScales();
        _refreshCommentsDeck();
        _refreshFreehandDeck();
        syncCommentsInteractionState();
        syncCommentsButtons();
      } else {
        toggleBtn.classList.remove("active");

        resetCommentModes();
        clearAllCommentPopups();

        _removeCommentDeckLayers();
        _removeDeckLayers();

        clearAllCommentPopups();

        syncCommentsInteractionState();
        syncCommentsButtons();
      }
      return;
    }

    // всё остальное трактуем как выключение
    showComments = false;

    toggleBtn.classList.remove("active");

    resetCommentModes();
    clearAllCommentPopups();

    _removeCommentDeckLayers();
    _removeDeckLayers();

    syncCommentsInteractionState();
    syncCommentsButtons();
  }

  addBtn.addEventListener("click", () => {
    // 🛑 Выход из режима рисования, если активен
    if (drawingMode) {
      toggleDrawing();
    }
    addingCommentMode = !addingCommentMode;

    if (addingCommentMode) {
      addBtn.classList.add("active");
      map.getCanvas().style.cursor = "crosshair";
      showToast("Кликните на карту, чтобы добавить комментарий");
    } else {
      addBtn.classList.remove("active");
      map.getCanvas().style.cursor = "";
    }
  });

  async function loadComments() {
    try {
      const data = await loadAll(name);
      const items = Array.isArray(data?.items) ? data.items : [];

      commentFeatures = items
        .filter((item) => item?.entityType === "comment")
        .map((item) => item.feature)
        .filter(Boolean);

      commentFeatures.forEach((feature) => {
        if (feature?.geometry?.type === "Point") {
          ensureCommentStreetAssignment(feature);
        }
      });

      syncStreetCommentsState();

      drawnLines = items
        .filter((item) => item?.entityType === "line")
        .map((item) => item.feature)
        .filter(Boolean);

      updateAllCurves();
      updateSource();
      updatePopupScales();
      _refreshFreehandDeck();

      isInitialLoadComplete = true;
    } catch (err) {
      console.error("Ошибка при загрузке комментариев:", err);
      commentFeatures = [];
      drawnLines = [];
      isInitialLoadComplete = true;
    }
  }

  function computeDirectionalBezier(start, end, steps = 30) {
    const dx = end[0] - start[0];
    const dy = end[1] - start[1];

    // Направление между точкой и popup
    const direction =
      Math.abs(dx) > Math.abs(dy)
        ? dx > 0
          ? "right"
          : "left"
        : dy > 0
          ? "up"
          : "down";

    // Контрольная точка 1 (от точки)
    let ctrl1;
    switch (direction) {
      case "right":
      case "left": {
        const xOffset = dx * 0.33;
        ctrl1 = [start[0] + xOffset, start[1]];
        break;
      }
      case "up":
      case "down": {
        const yOffset = dy * 0.33;
        ctrl1 = [start[0], start[1] + yOffset];
        break;
      }
    }

    // Второе направление — от popup к точке
    const direction2 =
      Math.abs(dx) > Math.abs(dy)
        ? dx > 0
          ? "left"
          : "right"
        : dy > 0
          ? "down"
          : "up";

    // Контрольная точка 2 (от popup)
    let ctrl2;
    switch (direction2) {
      case "right":
      case "left": {
        const xOffset = dx * 0.33;
        ctrl2 = [end[0] - xOffset, end[1]];
        break;
      }
      case "up":
      case "down": {
        const yOffset = dy * 0.33;
        ctrl2 = [end[0], end[1] - yOffset];
        break;
      }
    }

    // Построение кривой
    const points = [];
    for (let t = 0; t <= 1; t += 1 / steps) {
      const x =
        Math.pow(1 - t, 3) * start[0] +
        3 * Math.pow(1 - t, 2) * t * ctrl1[0] +
        3 * (1 - t) * Math.pow(t, 2) * ctrl2[0] +
        Math.pow(t, 3) * end[0];
      const y =
        Math.pow(1 - t, 3) * start[1] +
        3 * Math.pow(1 - t, 2) * t * ctrl1[1] +
        3 * (1 - t) * Math.pow(t, 2) * ctrl2[1] +
        Math.pow(t, 3) * end[1];
      points.push([x, y]);
    }

    return points;
  }

  function showToast(text, duration = 3000) {
    let toast = document.getElementById("map-toast");

    if (!toast) {
      toast = document.createElement("div");
      toast.id = "map-toast";
      document.body.appendChild(toast);
    }

    toast.textContent = text;
    toast.style.display = "block";
    toast.style.opacity = "1";

    if (duration) {
      clearTimeout(toast._hideTimeout);
      toast._hideTimeout = setTimeout(() => {
        toast.style.opacity = "0";
        setTimeout(() => {
          toast.style.display = "none";
        }, 300);
      }, duration);
    }
  }

  function metersPerPixel(zoom, latitude) {
    const earthCircumference = 40075016.686; // в метрах
    return (
      (earthCircumference * Math.cos((latitude * Math.PI) / 180)) /
      Math.pow(2, zoom + 8)
    );
  }

  function lineWidthInPixels(desiredMeters, zoom, lat) {
    const mpp = metersPerPixel(zoom, lat);
    return desiredMeters / mpp;
  }

  function computePopupScale(currentZoom, latitude, baseZoom = 17) {
    if (currentZoom >= baseZoom) return 1;

    const currentMPP = metersPerPixel(currentZoom, latitude);
    const baseMPP = metersPerPixel(baseZoom, latitude);
    return baseMPP / currentMPP;
  }

  function updatePopupScales() {
    const zoom = map.getZoom();
    const lat = map.getCenter().lat;
    const scale = computePopupScale(zoom, lat);

    document
      .querySelectorAll(
        ".maplibregl-popup.comment-popup .maplibregl-popup-content",
      )
      .forEach((content) => {
        content.style.transform = `scale(${scale})`;
        content.style.opacity = scale < 0.2 ? 0 : 1;
      });
  }

  ///////////////////////////////////////////////////////////////////////////////////////////////////////
  ///////////////////////////////////////////////////////////////////////////////////////////////////////
  ///////////////////////////////////////////////////////////////////////////////////////////////////////
  // РИСОВАНИЕ
  ///////////////////////////////////////////////////////////////////////////////////////////////////////
  ///////////////////////////////////////////////////////////////////////////////////////////////////////
  ///////////////////////////////////////////////////////////////////////////////////////////////////////
  // ✅ Переключатель кнопки
  drawBtn.addEventListener("click", toggleDrawing);

  function toggleDrawing() {
    drawingMode = !drawingMode;

    let palette = document.getElementById("colorPalette");
    if (!palette) {
      palette = document.createElement("div");
      palette.id = "colorPalette";
      palette.innerHTML = `
          <button class="color-swatch" data-color="#25936e" style="background:#25936e"></button>
          <button class="color-swatch" data-color="#2578b1" style="background:#2578b1"></button>
          <button class="color-swatch selected" data-color="#d54e55" style="background:#d54e55"></button>
          <button class="color-swatch" data-color="#0c0c0c" style="background:#0c0c0c"></button>
          <button class="color-swatch" data-color="#dfc680" style="background:#dfc680"></button>
          <button id="exitDraw" title="Выйти из режима рисования"><i class="fa fa-times" aria-hidden="true"></i></button>
        `;
      document.body.appendChild(palette);
      document.querySelectorAll(".color-swatch").forEach((btn) => {
        btn.addEventListener("click", () => {
          currentLineColor = btn.dataset.color;

          document
            .querySelectorAll(".color-swatch")
            .forEach((b) => b.classList.remove("selected"));
          btn.classList.add("selected");
        });
      });

      document
        .querySelector("#exitDraw")
        .addEventListener("click", toggleDrawing);
    }

    if (drawingMode) {
      selectedLineId = null;
      deletePopup?.remove();
      deletePopup = null;
      /*
      map.setFilter(name + "-freehand-lines-highlight", [
        "==",
        ["get", "id"],
        "",
      ]);
      */
      selectedLineId = null;
      _refreshFreehandDeck();
      //
      map.getCanvas().style.cursor = "crosshair";
      drawBtn.classList.add("active");
      palette.style.display = "flex";
      //screenOutline.style.opacity = 1;

      map.dragPan.disable();
      map.touchZoomRotate.disable();
      map.setMinZoom(minDrawZoom);
    } else {
      map.getCanvas().style.cursor = "";
      drawBtn.classList.remove("active");
      palette.style.display = "none";
      //screenOutline.style.opacity = 0;

      map.dragPan.enable();
      map.touchZoomRotate.enable();
      map.setMinZoom(0);

      // Сброс выделения
      /*
      selectedLineId = null;
      deletePopup?.remove();
      deletePopup = null;
      map.setPaintProperty(name + "-freehand-lines-layer", "line-color", [
        "get",
        "color",
      ]);
      */
      selectedLineId = null;
      deletePopup?.remove();
      deletePopup = null;
      _refreshFreehandDeck();
    }
  }

  function getEventLngLat(e) {
    const point = e.touches ? e.touches[0] : e;
    const rect = map.getCanvas().getBoundingClientRect();
    const x = point.clientX - rect.left;
    const y = point.clientY - rect.top;
    return map.unproject([x, y]).toArray();
  }

  function startDrawing(e) {
    if (!drawingMode) return;
    e.preventDefault();
    isDrawing = true;
    currentLineCoords = [];
    const lngLat = getEventLngLat(e);
    currentLineCoords.push(lngLat);
    //updateFreehand();
    _refreshFreehandDeck();
  }

  function draw(e) {
    if (!isDrawing) return;
    e.preventDefault();
    const lngLat = getEventLngLat(e);
    currentLineCoords.push(lngLat);
    //updateFreehand();
    _refreshFreehandDeck();
  }

  function stopDrawing() {
    if (!isDrawing) return;
    isDrawing = false;

    const simplifiedCoords = simplifyScreenBased(currentLineCoords, 1); // 2 пикселя

    const simplifiedFeature = {
      type: "Feature",
      geometry: {
        type: "LineString",
        coordinates: simplifiedCoords,
      },
      properties: {},
    };

    simplifiedFeature.properties.color = currentLineColor;
    simplifiedFeature.properties.type = "line";
    simplifiedFeature.properties.id = generateUniqueId(); // ✅ тут
    simplifiedFeature.properties.createdAt = new Date().toISOString();

    drawnLines.push(simplifiedFeature);
    scheduleFeatureSave(simplifiedFeature);

    _refreshFreehandDeck();

    currentLineCoords = [];
  }

  const canvas = map.getCanvas();
  canvas.addEventListener("mousedown", startDrawing);
  canvas.addEventListener("mousemove", draw);
  canvas.addEventListener("mouseup", stopDrawing);

  canvas.addEventListener("touchstart", startDrawing, { passive: false });
  canvas.addEventListener("touchmove", draw, { passive: false });
  canvas.addEventListener("touchend", stopDrawing);

  function lngLatToPixelCoords(coords) {
    return coords.map(([lng, lat]) => {
      const point = map.project([lng, lat]);
      return [point.x, point.y];
    });
  }

  function pixelCoordsToLngLat(coords) {
    return coords.map(([x, y]) => {
      const lngLat = map.unproject([x, y]);
      return [lngLat.lng, lngLat.lat];
    });
  }

  function simplifyScreenBased(coords, pixelTolerance = 1) {
    const pixelLine = {
      type: "Feature",
      geometry: {
        type: "LineString",
        coordinates: lngLatToPixelCoords(coords),
      },
    };

    const simplifiedPixels = turf.simplify(pixelLine, {
      tolerance: pixelTolerance,
      highQuality: true,
      mutate: false,
    });

    return pixelCoordsToLngLat(simplifiedPixels.geometry.coordinates);
  }

  document.addEventListener("click", (e) => {
    if (e.target.id === "confirmDeleteLine" && selectedLineId) {
      const index = drawnLines.findIndex(
        (f) => f.properties.id === selectedLineId,
      );
      if (index !== -1) {
        drawnLines.splice(index, 1);
        void removeFeatureFromStorage(selectedLineId);
        _refreshFreehandDeck();
      }

      // Очистка
      selectedLineId = null;
      deletePopup?.remove();
      deletePopup = null;

      _refreshFreehandDeck();
    }
  });

  // Удаление выбранной линии по клавише Delete / Backspace
  document.addEventListener("keydown", (e) => {
    if (!selectedLineId) return;
    if (drawingMode) return;
    if (e.key !== "Delete" && e.key !== "Backspace") return;

    const index = drawnLines.findIndex(
      (f) => f.properties.id === selectedLineId,
    );
    if (index !== -1) {
      drawnLines.splice(index, 1);
      void removeFeatureFromStorage(selectedLineId);
      _refreshFreehandDeck();
    }

    // Очистка выделения и popup'а
    selectedLineId = null;
    deletePopup?.remove();
    deletePopup = null;
  });

  function generateUniqueId() {
    return "line-" + Date.now() + "-" + Math.floor(Math.random() * 100000);
  }

  loadComments();
  syncCommentsButtons();

  document.addEventListener("mousemove", (e) => {
    const button = e.target.closest(".popup-main button");
    if (!button) return;

    const rect = button.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    button.style.setProperty("--x", `${x}px`);
    button.style.setProperty("--y", `${y}px`);
  });

  return {
    focusCommentById,
    getStreetCommentsState() {
      const streets = {};
      for (const [streetName, items] of commentsByStreet.entries()) {
        streets[streetName] = {
          total: items.length,
          unresolved: items.filter((f) => !f?.properties?.resolved).length,
          items: items.map((f) => ({
            id: f?.properties?.id,
            text: f?.properties?.text || "",
            resolved: !!f?.properties?.resolved,
          })),
        };
      }
      return { streets };
    },
  };
}

let _uuidCounter = 0;

function generateUUID() {
  // 1) Нормальный крипто-UUID v4
  const c = globalThis.crypto;
  if (c?.getRandomValues) {
    const b = new Uint8Array(16);
    c.getRandomValues(b);
    b[6] = (b[6] & 0x0f) | 0x40;
    b[8] = (b[8] & 0x3f) | 0x80;
    const hex = Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
  }

  // 2) Если крипто нет — НЕ Math.random. Делаем монотонный уникальный id в рамках сессии.
  _uuidCounter = (_uuidCounter + 1) >>> 0;

  // performance.now() даёт суб-мс, Date.now() — глобальное время
  const t = Date.now().toString(16);
  const p = Math.floor((performance?.now?.() || 0) * 1000).toString(16);

  // userAgentData нет на iOS, поэтому просто session-уникальность
  return `id-${t}-${p}-${_uuidCounter.toString(16)}`;
}

function formatDateDDMMYY(date = new Date()) {
  const dd = String(date.getDate()).padStart(2, "0");
  const mm = String(date.getMonth() + 1).padStart(2, "0");
  const yy = String(date.getFullYear()).slice(-2);
  return `${dd}-${mm}-${yy}`;
}
