export function setupMirrorViewer(map, options) {
  const pad = window.innerWidth - window.innerWidth * 0.3;
  const {
    pointsLayerId,
    workerBaseUrl,
    leftPadding = 30,
    rightPadding = pad,
    topPadding = 30,
    bottomPadding = 30,
  } = options;

  let abortController = null;
  let currentObjectUrl = null;
  let isEnabled = false;
  let hoveredId = null;
  let selectedId = null;

  let isImageLoading = false;
  let resizeState = null;
  const VIEWER_ASPECT = 16 / 9;
  const MIN_VIEWER_WIDTH = 360;

  const pointsSourceId = map.getLayer(pointsLayerId)?.source;

  // === DOM ===
  const viewer = document.createElement("div");
  viewer.className = "mirror-viewer hidden";
  viewer.innerHTML = `
    <button class="mirror-close" type="button">×</button>
    <div class="mirror-body">
      <div class="mirror-placeholder">
        <div class="mirror-skeleton"></div>
        <div class="mirror-loading-text">Загрузка…</div>
      </div>
      <img />
      <div class="mirror-date hidden"></div>
      <div class="mirror-resize-handle" title="Изменить размер"></div>
    </div>
  `;
  document.body.appendChild(viewer);

  const img = viewer.querySelector("img");
  const placeholder = viewer.querySelector(".mirror-placeholder");

  const resizeHandle = viewer.querySelector(".mirror-resize-handle");
  const closeBtn = viewer.querySelector(".mirror-close");
  const dateBadge = viewer.querySelector(".mirror-date");
  closeBtn.onclick = closeViewer;

  // === CSS ===
  const style = document.createElement("style");
  style.innerHTML = `
    .mirror-viewer {
      position: absolute;
      top: 10px;
      right: 50px;
      width: 60%;
      aspect-ratio: 16 / 9;
      z-index: 1000;
      border-radius: 8px;
      overflow: hidden;
      box-shadow: 0 0 0 2px rgba(0,0,0,.1);
      background: #51555cc2;
      backdrop-filter: blur(10px);
      min-width: 360px;
      max-width: calc(100vw - 80px);
      user-select: none;
    }

    .mirror-viewer.hidden {
      display: none;
    }

    .mirror-close {
      position: absolute;
      right: 0;
      top: 0;
      background: white;
      border: none;
      color: black;
      cursor: pointer;
      width: 31px;
      height: 31px;
      font-size: 24px;
      border-bottom-left-radius: 8px;
      box-shadow: 0 0 0 2px rgba(0,0,0,.1);
      z-index: 2;
    }

    .mirror-close:hover {
      background: #eee;
    }

    .mirror-body img {
      width: 100%;
      height: 100%;
      object-fit: contain;
      display: block;
    }

        .mirror-body {
      position: relative;
      width: 100%;
      height: 100%;
    }

    .mirror-placeholder {
      position: absolute;
      inset: 0;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      gap: 14px;
      background: linear-gradient(180deg, rgba(50,54,61,.88), rgba(37,40,46,.92));
      z-index: 1;
      pointer-events: none;
    }

    .mirror-placeholder.hidden {
      display: none;
    }

    .mirror-skeleton {
      width: 42%;
      max-width: 420px;
      aspect-ratio: 16 / 9;
      border-radius: 10px;
      background:
        linear-gradient(
          90deg,
          rgba(255,255,255,0.08) 0%,
          rgba(255,255,255,0.18) 50%,
          rgba(255,255,255,0.08) 100%
        );
      background-size: 200% 100%;
      animation: mirrorSkeletonShimmer 1.2s linear infinite;
      box-shadow: inset 0 0 0 1px rgba(255,255,255,0.08);
    }

    .mirror-loading-text {
      color: rgba(255,255,255,0.88);
      font-size: 14px;
      line-height: 1.2;
    }

    @keyframes mirrorSkeletonShimmer {
      from {
        background-position: 200% 0;
      }
      to {
        background-position: -200% 0;
      }
    }

    .mirror-date {
    position: absolute;
    right: 8px;
    /* right: 8px; */
    bottom: 8px;
    padding: 6px 10px;
    border-radius: 8px;
    background: rgba(0, 0, 0, 0.55);
    backdrop-filter: blur(6px);
    color: #fff;
    font-size: 12px;
    line-height: 1.2;
    z-index: 2;
    pointer-events: none;
    }

    .mirror-date.hidden {
      display: none;
    }

    .mirror-resize-handle {
    position: absolute;
    left: 0;
    bottom: 0;
    width: 31px;
    height: 31px;
    z-index: 4;
    cursor: nesw-resize;
    background: transparent;
    border-top-right-radius: 8px;
    transition: background 0.2s;
    }

    .mirror-resize-handle:hover {
    background: #ffffff4f;
    }
  `;
  document.head.appendChild(style);

  // === SELECTED BUFFER + POINT ===
  map.addSource("mirror-selected-buffer", {
    type: "geojson",
    data: { type: "FeatureCollection", features: [] },
  });

  map.addLayer({
    id: "mirror-selected-buffer",
    type: "circle",
    source: "mirror-selected-buffer",
    layout: {
      visibility: "none",
    },
    paint: {
      "circle-radius": 18,
      "circle-color": "#eb4e4b",
      "circle-opacity": 0.18,
      "circle-stroke-color": "#eb4e4b",
      "circle-stroke-opacity": 0.4,
      "circle-stroke-width": 1.5,
    },
  });

  map.addSource("mirror-selected", {
    type: "geojson",
    data: { type: "FeatureCollection", features: [] },
  });

  map.addLayer({
    id: "mirror-selected",
    type: "circle",
    source: "mirror-selected",
    layout: {
      visibility: "none",
    },
    paint: {
      "circle-radius": 8,
      "circle-color": "#eb4e4b",
      "circle-stroke-color": "#fff",
      "circle-stroke-width": 2,
    },
  });

  function showPlaceholder(text = "Загрузка…") {
    isImageLoading = true;
    placeholder.classList.remove("hidden");
    placeholder.querySelector(".mirror-loading-text").textContent = text;
    img.style.visibility = "hidden";
    img.removeAttribute("src");
  }

  function hidePlaceholder() {
    isImageLoading = false;
    placeholder.classList.add("hidden");
    img.style.visibility = "visible";
  }

  function setViewerSize(nextWidth) {
    const maxWidth = Math.min(
      window.innerWidth - 80,
      window.innerHeight * VIEWER_ASPECT - 20,
    );
    const width = Math.max(MIN_VIEWER_WIDTH, Math.min(nextWidth, maxWidth));
    const height = width / VIEWER_ASPECT;

    viewer.style.width = `${width}px`;
    viewer.style.height = `${height}px`;
    viewer.style.aspectRatio = "auto";
  }

  function formatMirrorDate(value) {
    if (!value) return "";

    const d = new Date(value);
    if (Number.isNaN(d.getTime())) return value;

    return d.toLocaleString("ru-RU", {
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      timeZone: "Asia/Tashkent",
    });
  }

  function updateDateBadge(feature) {
    const rawDate = feature?.properties?.date;
    if (!rawDate) {
      dateBadge.textContent = "";
      dateBadge.classList.add("hidden");
      return;
    }

    dateBadge.textContent = `Дата съемки: ${formatMirrorDate(rawDate)}`;
    dateBadge.classList.remove("hidden");
  }

  function setLayerVisibility(id, visible) {
    if (!map.getLayer(id)) return;
    map.setLayoutProperty(id, "visibility", visible ? "visible" : "none");
  }

  function updatePointsPaint() {
    if (!map.getLayer(pointsLayerId)) return;

    map.setPaintProperty(pointsLayerId, "circle-radius", [
      "case",
      ["==", ["get", "id"], hoveredId ?? ""],
      8,
      4,
    ]);

    map.setPaintProperty(pointsLayerId, "circle-color", "#eb4e4b");
    map.setPaintProperty(pointsLayerId, "circle-stroke-color", "#ffffff");
    map.setPaintProperty(pointsLayerId, "circle-stroke-width", 1.5);
    map.setPaintProperty(pointsLayerId, "circle-opacity", isEnabled ? 1 : 0.85);
  }

  function toPlainFeature(feature) {
    if (!feature) return null;

    return {
      type: "Feature",
      geometry: feature.geometry
        ? JSON.parse(JSON.stringify(feature.geometry))
        : null,
      properties: feature.properties
        ? JSON.parse(JSON.stringify(feature.properties))
        : {},
    };
  }

  function setSelectedFeature(feature) {
    const plainFeature = toPlainFeature(feature);
    selectedId = plainFeature?.properties?.id ?? null;

    const fc = plainFeature
      ? { type: "FeatureCollection", features: [plainFeature] }
      : { type: "FeatureCollection", features: [] };

    map.getSource("mirror-selected-buffer")?.setData(fc);
    map.getSource("mirror-selected")?.setData(fc);
  }

  function openViewer() {
    viewer.classList.remove("hidden");
  }

  function clearImageMemory() {
    if (abortController) {
      abortController.abort();
      abortController = null;
    }

    if (currentObjectUrl) {
      URL.revokeObjectURL(currentObjectUrl);
      currentObjectUrl = null;
    }

    img.removeAttribute("src");
    img.style.visibility = "hidden";
  }

  function closeViewer() {
    viewer.classList.add("hidden");
    dateBadge.textContent = "";
    dateBadge.classList.add("hidden");
    showPlaceholder("Загрузка…");
    clearImageMemory();
  }

  async function loadImage(key) {
    try {
      showPlaceholder("Загрузка…");

      if (abortController) abortController.abort();
      abortController = new AbortController();

      const url = `${workerBaseUrl}/api/mirror-photo?key=${encodeURIComponent(key)}`;
      const resp = await fetch(url, { signal: abortController.signal });
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);

      const blob = await resp.blob();

      if (currentObjectUrl) {
        URL.revokeObjectURL(currentObjectUrl);
      }

      currentObjectUrl = URL.createObjectURL(blob);

      await new Promise((resolve, reject) => {
        img.onload = () => {
          img.onload = null;
          img.onerror = null;
          resolve();
        };
        img.onerror = (e) => {
          img.onload = null;
          img.onerror = null;
          reject(e);
        };
        img.src = currentObjectUrl;
      });

      hidePlaceholder();
    } catch (err) {
      if (err?.name === "AbortError") return;
      console.log("image load error", err);
      showPlaceholder("Не удалось загрузить изображение");
    }
  }

  function onResizeMove(e) {
    if (!resizeState) return;

    e.preventDefault();

    const dx = resizeState.startX - e.clientX;
    const nextWidth = resizeState.startWidth + dx;

    setViewerSize(nextWidth);
  }

  function onResizeEnd() {
    if (!resizeState) return;

    window.removeEventListener("mousemove", onResizeMove);
    window.removeEventListener("mouseup", onResizeEnd);
    resizeState = null;
  }

  function onResizeStart(e) {
    e.preventDefault();
    e.stopPropagation();

    const rect = viewer.getBoundingClientRect();

    resizeState = {
      startX: e.clientX,
      startWidth: rect.width,
    };

    window.addEventListener("mousemove", onResizeMove);
    window.addEventListener("mouseup", onResizeEnd);
  }

  resizeHandle.addEventListener("mousedown", onResizeStart);

  window.addEventListener("resize", () => {
    const rect = viewer.getBoundingClientRect();
    setViewerSize(rect.width);
  });

  function focusWithPadding(feature) {
    const coords = feature?.geometry?.coordinates;
    if (!Array.isArray(coords) || coords.length < 2) return;

    map.easeTo({
      center: coords,
      padding: {
        left: leftPadding,
        right: rightPadding,
        top: topPadding,
        bottom: bottomPadding,
      },
      duration: 300,
      essential: true,
    });
  }

  function handlePointClick(e) {
    if (!isEnabled) return;

    e?.originalEvent?.stopPropagation?.();

    const f = e.features?.[0];
    if (!f) return;

    const plainFeature = toPlainFeature(f);

    setSelectedFeature(plainFeature);
    updateDateBadge(plainFeature);
    openViewer();
    loadImage(plainFeature.properties.imageKey);
    focusWithPadding(plainFeature);
  }

  function handleMouseEnter(e) {
    if (!isEnabled) return;
    map.getCanvas().style.cursor = "pointer";

    const f = e.features?.[0];
    hoveredId = f?.properties?.id ?? null;
    updatePointsPaint();
  }

  function handleMouseMove(e) {
    if (!isEnabled) return;

    const f = e.features?.[0];
    const nextHoveredId = f?.properties?.id ?? null;
    if (nextHoveredId === hoveredId) return;

    hoveredId = nextHoveredId;
    updatePointsPaint();
  }

  function handleMouseLeave() {
    hoveredId = null;
    map.getCanvas().style.cursor = "";
    updatePointsPaint();
  }

  map.on("click", pointsLayerId, handlePointClick);
  map.on("mouseenter", pointsLayerId, handleMouseEnter);
  map.on("mousemove", pointsLayerId, handleMouseMove);
  map.on("mouseleave", pointsLayerId, handleMouseLeave);

  function enable() {
    isEnabled = true;
    setLayerVisibility(pointsLayerId, true);
    setLayerVisibility("mirror-selected-buffer", true);
    setLayerVisibility("mirror-selected", true);
    updatePointsPaint();

    setViewerSize(
      viewer.getBoundingClientRect().width || window.innerWidth * 0.6,
    );
    showPlaceholder("Загрузка…");
  }

  function disable() {
    isEnabled = false;
    hoveredId = null;
    selectedId = null;

    setSelectedFeature(null);
    closeViewer();

    setLayerVisibility(pointsLayerId, false);
    setLayerVisibility("mirror-selected-buffer", false);
    setLayerVisibility("mirror-selected", false);

    map.getCanvas().style.cursor = "";
    updatePointsPaint();

    map.easeTo({
      padding: { left: 0, right: 0, top: 0, bottom: 0 },
      duration: 0,
      essential: true,
    });
  }

  function isOpen() {
    return isEnabled;
  }

  // стартовое состояние
  setLayerVisibility(pointsLayerId, false);
  setLayerVisibility("mirror-selected-buffer", false);
  setLayerVisibility("mirror-selected", false);
  updatePointsPaint();

  return {
    enable,
    disable,
    isOpen,
    closeViewer,
  };
}
