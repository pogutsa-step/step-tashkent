// two-finger-ruler.js

/**
 * Подключение:
 *   import * as turf from "@turf/turf";
 *   import { setupTwoFingerRuler } from "./two-finger-ruler.js";
 *
 *   const ruler = setupTwoFingerRuler(map, turf, {
 *     longPressMs: 800,
 *     offsetPx: 40,
 *   });
 *
 *   // При необходимости:
 *   ruler.destroy();
 */

export function setupTwoFingerRuler(map, turf, options = {}) {
  const {
    sourceId = "mobile-ruler-source",
    lineLayerId = "mobile-ruler-line",
    circleLayerId = "mobile-ruler-circles",
    labelLayerId = "mobile-ruler-label",
    labelPointLayerId = "mobile-ruler-label-point",
    longPressMs = 800,
    offsetPx = 80,
    longitudinalOffsetPx = 30,
    moveTolerancePx = 15,
    lineColor = "rgba(37, 147, 110, 1)",
    lineWidth = 3,
    circleRadius = 10,
    circleColor = "rgba(37, 147, 110, 0.3)",
    circleStrokeColor = "rgba(37, 147, 110, 1)",
    circleStrokeWidth = 2,
    textColor = "#000000",
    textHaloColor = "#ffffff",
    textHaloWidth = 1.5,
    textSize = 18,
    controlPosition = "top-right",
    controlTitle = "Замер длины",
    showDesktopControl = true,
  } = options;

  const container = map.getCanvasContainer();

  const state = {
    waiting: false,
    active: false,
    timer: null,
    touchIds: [],
    startPositions: [],

    desktopEnabled: false,
    clickStage: 0,
    startLngLat: null,

    dragEndpoint: null, // "a" | "b" | null
    dragMoved: false,
    lastFixedMeasurement: null, // { c1, c2 } | null
  };

  // Базовый GeoJSON
  const geojson = {
    type: "FeatureCollection",
    features: [],
  };

  function ensureSourceAndLayers() {
    if (!map.getSource(sourceId)) {
      map.addSource(sourceId, {
        type: "geojson",
        data: geojson,
      });
    }

    if (!map.getLayer(lineLayerId)) {
      map.addLayer({
        id: lineLayerId,
        type: "line",
        source: sourceId,
        filter: ["==", ["get", "role"], "line"],
        layout: {
          "line-cap": "round",
          "line-join": "round",
        },
        paint: {
          "line-color": lineColor,
          "line-width": lineWidth,
        },
      });
    }

    if (!map.getLayer(circleLayerId)) {
      map.addLayer({
        id: circleLayerId,
        type: "circle",
        source: sourceId,
        filter: ["==", ["get", "role"], "circle"],
        paint: {
          "circle-radius": circleRadius,
          "circle-color": circleColor,
          "circle-stroke-color": circleStrokeColor,
          "circle-stroke-width": circleStrokeWidth,
        },
      });
    }
    /*
    if (!map.getLayer(labelLayerId)) {
      map.addLayer({
        id: labelLayerId,
        type: "symbol",
        source: sourceId,
        filter: ["==", ["get", "role"], "line"],
        layout: {
          "symbol-placement": "line-center",
          // показываем текст только если линия не совсем крошечная
          "text-field": [
            "case",
            [">", ["get", "distanceM"], 1], // 1 метр, порог можно подвинуть
            ["get", "label"],
            "",
          ],
          "text-size": textSize,
          "text-font": ["Open Sans Regular", "Arial Unicode MS Regular"],
          "text-rotation-alignment": "map",
          "text-keep-upright": true,
          "text-allow-overlap": true,
          "text-ignore-placement": true,
        },
        paint: {
          "text-color": textColor,
          "text-halo-color": textHaloColor,
          "text-halo-width": textHaloWidth,
        },
      });
    }
*/
    // 🔥 отдельный слой для point-подписи, чтобы не пропадала на коротких линиях
    if (!map.getLayer(labelPointLayerId)) {
      map.addLayer({
        id: labelPointLayerId,
        type: "symbol",
        source: sourceId,
        filter: ["==", ["get", "role"], "label-point"],
        layout: {
          "symbol-placement": "point",
          "text-field": ["get", "label"],
          "text-size": textSize,
          "text-rotate": ["get", "angle"],
          "text-font": ["Open Sans Regular", "Arial Unicode MS Regular"],
          "text-rotation-alignment": "map",
          "text-allow-overlap": true,
          "text-ignore-placement": true,
          "text-anchor": "bottom",
          "text-offset": [0, -0.1],
        },
        paint: {
          "text-color": textColor,
          "text-halo-color": textHaloColor,
          "text-halo-width": textHaloWidth,
        },
      });
    }
  }

  function clearGeojson() {
    geojson.features = [];
    const src = map.getSource(sourceId);
    if (src) src.setData(geojson);
  }

  function hasFixedMeasurement() {
    return (
      state.lastFixedMeasurement &&
      Array.isArray(state.lastFixedMeasurement.c1) &&
      Array.isArray(state.lastFixedMeasurement.c2)
    );
  }

  function formatDistanceMeters(m) {
    if (!isFinite(m)) return "";
    if (m < 1) {
      return `${m.toFixed(2)} м`;
    } else if (m < 1000) {
      return `${m.toFixed(1)} м`;
    } else {
      return `${(m / 1000).toFixed(2)} км`;
    }
  }

  function updateMeasurementFromLngLats(c1, c2) {
    const p1 = turf.point(c1);
    const p2 = turf.point(c2);
    const distM = turf.distance(p1, p2, { units: "meters" });
    const label = formatDistanceMeters(distM);

    let angleDeg = turf.bearing(p1, p2);
    angleDeg += 90;
    if (angleDeg > 90) angleDeg -= 180;
    if (angleDeg < -90) angleDeg += 180;

    geojson.features = [
      {
        type: "Feature",
        properties: {
          role: "line",
          label,
          distanceM: distM,
          angle: angleDeg,
        },
        geometry: {
          type: "LineString",
          coordinates: [c1, c2],
        },
      },
      {
        type: "Feature",
        properties: {
          role: "circle",
          which: "a",
        },
        geometry: {
          type: "Point",
          coordinates: c1,
        },
      },
      {
        type: "Feature",
        properties: {
          role: "circle",
          which: "b",
        },
        geometry: {
          type: "Point",
          coordinates: c2,
        },
      },
      {
        type: "Feature",
        properties: {
          role: "label-point",
          label,
          distanceM: distM,
          angle: angleDeg,
        },
        geometry: {
          type: "Point",
          coordinates: [(c1[0] + c2[0]) / 2, (c1[1] + c2[1]) / 2],
        },
      },
    ];

    const src = map.getSource(sourceId);
    state.lastFixedMeasurement = { c1: [...c1], c2: [...c2] };
    if (src) src.setData(geojson);
  }

  function updateMeasurementFromTouches(touches) {
    if (touches.length !== 2) return;

    // экранные координаты пальцев
    const s1 = { x: touches[0].clientX, y: touches[0].clientY };
    const s2 = { x: touches[1].clientX, y: touches[1].clientY };

    // реальные координаты касаний (для измерения)
    const ll1 = map.unproject([s1.x, s1.y]);
    const ll2 = map.unproject([s2.x, s2.y]);
    /*
    const p1 = turf.point([ll1.lng, ll1.lat]);
    const p2 = turf.point([ll2.lng, ll2.lat]);

    const distM = turf.distance(p1, p2, { units: "meters" });
    const label = formatDistanceMeters(distM);
    */

    // вектор от первого пальца ко второму в экранных координатах
    const dx = s2.x - s1.x;
    const dy = s2.y - s1.y;
    const len = Math.sqrt(dx * dx + dy * dy) || 1;

    // единичный тангенс вдоль линии (от первой точки ко второй)
    const tx = dx / len;
    const ty = dy / len;

    // нормаль (перпендикуляр) к линии
    let nx = -dy / len;
    let ny = dx / len;

    // стабилизируем направление нормали — чтоб не флипало
    if (ny < 0) {
      nx = -nx;
      ny = -ny;
    }

    // 🔁 если надо развернуть поперечный оффсет — оставляем инверсию
    nx = -nx;
    ny = -ny;

    // базовый поперечный сдвиг (чтоб пальцы не перекрывали круги)
    let o1screen = {
      x: s1.x + nx * offsetPx,
      y: s1.y + ny * offsetPx,
    };
    let o2screen = {
      x: s2.x + nx * offsetPx,
      y: s2.y + ny * offsetPx,
    };

    // 🔥 продольный сдвиг вдоль линии:
    // от "левой" точки вправо (к второй), от правой — влево (от второй к первой)
    if (longitudinalOffsetPx !== 0) {
      o1screen = {
        x: o1screen.x + tx * longitudinalOffsetPx,
        y: o1screen.y + ty * longitudinalOffsetPx,
      };
      o2screen = {
        x: o2screen.x - tx * longitudinalOffsetPx,
        y: o2screen.y - ty * longitudinalOffsetPx,
      };
    }

    const o1ll = map.unproject([o1screen.x, o1screen.y]);
    const o2ll = map.unproject([o2screen.x, o2screen.y]);

    const c1 = [o1ll.lng, o1ll.lat];
    const c2 = [o2ll.lng, o2ll.lat];

    // ✅ теперь длину считаем по оффсетнутым точкам
    updateMeasurementFromLngLats(c1, c2);
  }

  function getTrackedTouches(e) {
    const list = [];
    for (let i = 0; i < e.touches.length; i++) {
      const t = e.touches[i];
      if (state.touchIds.includes(t.identifier)) {
        list.push(t);
      }
    }
    return list;
  }

  function cancelWaiting() {
    state.waiting = false;
    if (state.timer) {
      clearTimeout(state.timer);
      state.timer = null;
    }
  }

  function endMeasurement() {
    cancelWaiting();
    if (state.active) {
      state.active = false;
      clearGeojson();
      state.touchIds = [];
      state.startPositions = [];

      // вернём интеракции карты
      if (map.dragPan) map.dragPan.enable();
      if (map.touchZoomRotate) {
        map.touchZoomRotate.enable();
        map.touchZoomRotate.enableRotation();
      }
    }
  }

  function startWaitingForLongPress(touches) {
    state.waiting = true;
    state.active = false;
    state.touchIds = [touches[0].identifier, touches[1].identifier];
    state.startPositions = [
      { x: touches[0].clientX, y: touches[0].clientY },
      { x: touches[1].clientX, y: touches[1].clientY },
    ];

    state.timer = setTimeout(() => {
      if (!state.waiting) return;
      state.waiting = false;
      state.active = true;

      // 🔔 короткая вибрация при активации рулетки
      if (typeof navigator !== "undefined" && navigator.vibrate) {
        navigator.vibrate(30); // 30 мс, можно 10–50 по вкусу
      }

      ensureSourceAndLayers();
      const tracked = getTrackedTouches({ touches });
      if (tracked.length === 2) {
        updateMeasurementFromTouches(tracked);
      }

      // отключаем пан/пинч на время измерения
      if (map.dragPan) map.dragPan.disable();
      if (map.touchZoomRotate) {
        map.touchZoomRotate.disable();
      }
    }, longPressMs);
  }

  function onTouchStart(e) {
    if (state.active) {
      // уже меряем — блокируем дефолт, чтобы карта не панилась
      e.preventDefault();
      return;
    }

    // рулетка на мобиле стартует только при 2 пальцах
    if (e.touches.length === 2 && !state.waiting) {
      e.preventDefault();
      startWaitingForLongPress([e.touches[0], e.touches[1]]);
    } else {
      // одиночные тапы / обычные жесты не трогаем
      cancelWaiting();
    }
  }

  function onTouchMove(e) {
    if (state.waiting) {
      const tracked = getTrackedTouches(e);
      if (tracked.length !== 2) {
        cancelWaiting();
        return;
      }

      for (let i = 0; i < 2; i++) {
        const t = tracked[i];
        const start = state.startPositions[i];
        const dx = t.clientX - start.x;
        const dy = t.clientY - start.y;
        const d = Math.sqrt(dx * dx + dy * dy);
        if (d > moveTolerancePx) {
          cancelWaiting();
          return;
        }
      }

      // пока ждём long press двумя пальцами — гасим дефолт
      e.preventDefault();
      return;
    }

    if (state.active) {
      e.preventDefault();
      const tracked = getTrackedTouches(e);
      if (tracked.length === 2) {
        updateMeasurementFromTouches(tracked);
      } else {
        endMeasurement();
      }
    }
  }

  function onTouchEnd(e) {
    if (state.waiting) {
      // если один или оба пальца ушли до лонгтапа — отменяем
      if (e.touches.length < 2) {
        cancelWaiting();
      }
    }

    if (state.active) {
      // любой отпуск пальца завершает измерение
      if (e.touches.length < 2) {
        endMeasurement();
      }
    }
  }

  function onTouchCancel() {
    endMeasurement();
  }

  function setCursor(active) {
    const canvas = map.getCanvas();
    if (canvas) {
      canvas.style.cursor = active ? "crosshair" : "";
    }
  }

  function resetDesktopMeasurement({ clearFixed = true } = {}) {
    state.clickStage = 0;
    state.startLngLat = null;
    state.dragEndpoint = null;
    state.dragMoved = false;

    if (clearFixed) {
      state.lastFixedMeasurement = null;
      clearGeojson();
    }
  }

  function onDesktopMapClick(e) {
    if (!state.desktopEnabled) return;
    if (state.dragEndpoint) return;

    // после drag не даём click-событию начать новый замер
    if (state.dragMoved) {
      state.dragMoved = false;
      return;
    }

    ensureSourceAndLayers();

    if (state.clickStage === 0) {
      state.startLngLat = e.lngLat;
      state.clickStage = 1;
      state.lastFixedMeasurement = null;

      geojson.features = [
        {
          type: "Feature",
          properties: {
            role: "circle",
            which: "a",
          },
          geometry: {
            type: "Point",
            coordinates: [e.lngLat.lng, e.lngLat.lat],
          },
        },
      ];

      const src = map.getSource(sourceId);
      if (src) src.setData(geojson);
      return;
    }

    if (state.clickStage === 1) {
      const c1 = [state.startLngLat.lng, state.startLngLat.lat];
      const c2 = [e.lngLat.lng, e.lngLat.lat];
      updateMeasurementFromLngLats(c1, c2);

      state.startLngLat = null;
      state.clickStage = 0;
      return;
    }
  }

  function onEndpointMouseEnter() {
    if (!state.desktopEnabled) return;
    if (state.dragEndpoint) return;
    map.getCanvas().style.cursor = "grab";
  }

  function onEndpointMouseLeave() {
    if (!state.desktopEnabled) return;
    if (state.dragEndpoint) return;
    map.getCanvas().style.cursor = "crosshair";
  }

  function onEndpointMouseDown(e) {
    if (!state.desktopEnabled) return;

    // 🚫 Пока идёт постановка второй точки, никакой drag не начинаем.
    // Иначе второй клик по circle "b" воспринимается как начало нового замера.
    if (state.clickStage !== 0) return;

    // 🚫 Drag разрешаем только для уже зафиксированного замера
    if (!hasFixedMeasurement()) return;

    const feature = e.features?.[0];
    if (!feature) return;

    const which = feature.properties?.which;
    if (which !== "a" && which !== "b") return;

    e.preventDefault?.();
    e.originalEvent?.stopPropagation?.();

    state.dragEndpoint = which;
    state.dragMoved = false;
    state.clickStage = 0;
    state.startLngLat = null;

    map.getCanvas().style.cursor = "grabbing";

    if (map.dragPan) map.dragPan.disable();
  }

  function onDesktopMouseMove(e) {
    if (!state.desktopEnabled) return;

    if (state.dragEndpoint) {
      if (!hasFixedMeasurement()) return;

      state.dragMoved = true;

      let c1 = [...state.lastFixedMeasurement.c1];
      let c2 = [...state.lastFixedMeasurement.c2];

      if (state.dragEndpoint === "a") {
        c1 = [e.lngLat.lng, e.lngLat.lat];
      } else if (state.dragEndpoint === "b") {
        c2 = [e.lngLat.lng, e.lngLat.lat];
      }

      updateMeasurementFromLngLats(c1, c2);
      return;
    }

    if (state.clickStage !== 1 || !state.startLngLat) return;

    const c1 = [state.startLngLat.lng, state.startLngLat.lat];
    const c2 = [e.lngLat.lng, e.lngLat.lat];
    updateMeasurementFromLngLats(c1, c2);
  }

  function onDesktopMouseUp() {
    if (!state.desktopEnabled) return;
    if (!state.dragEndpoint) return;

    state.dragEndpoint = null;
    state.dragMoved = false;

    map.getCanvas().style.cursor = "crosshair";

    if (map.dragPan) map.dragPan.enable();
  }

  function enableDesktopMode() {
    state.desktopEnabled = true;
    resetDesktopMeasurement();
    ensureSourceAndLayers();
    setCursor(true);

    map.on("click", onDesktopMapClick);
    map.on("mousemove", onDesktopMouseMove);
    map.on("mouseup", onDesktopMouseUp);

    map.on("mouseenter", circleLayerId, onEndpointMouseEnter);
    map.on("mouseleave", circleLayerId, onEndpointMouseLeave);
    map.on("mousedown", circleLayerId, onEndpointMouseDown);

    if (map.doubleClickZoom) map.doubleClickZoom.disable();
  }

  function disableDesktopMode() {
    state.desktopEnabled = false;
    resetDesktopMeasurement({ clearFixed: true });
    setCursor(false);

    map.off("click", onDesktopMapClick);
    map.off("mousemove", onDesktopMouseMove);
    map.off("mouseup", onDesktopMouseUp);

    map.off("mouseenter", circleLayerId, onEndpointMouseEnter);
    map.off("mouseleave", circleLayerId, onEndpointMouseLeave);
    map.off("mousedown", circleLayerId, onEndpointMouseDown);

    if (map.dragPan) map.dragPan.enable();
    if (map.doubleClickZoom) map.doubleClickZoom.enable();
  }

  class RulerControl {
    onAdd(mapInstance) {
      this._map = mapInstance;

      this._container = document.createElement("div");
      this._container.className = "maplibregl-ctrl maplibregl-ctrl-group";

      this._button = document.createElement("button");
      this._button.type = "button";
      this._button.title = controlTitle;
      this._button.setAttribute("aria-label", controlTitle);
      this._button.style.width = "30px";
      this._button.style.height = "30px";
      this._button.style.fontSize = "16px";
      this._button.style.lineHeight = "30px";
      this._button.innerHTML =
        '<i class="fa fa-arrows-h" aria-hidden="true"></i>';
      ("");

      this._button.addEventListener("click", () => {
        const next = !state.desktopEnabled;

        if (next) {
          enableDesktopMode();
          this._button.style.backgroundColor = "#22966fa5";
        } else {
          disableDesktopMode();
          this._button.style.backgroundColor = "";
        }
      });

      this._container.appendChild(this._button);
      return this._container;
    }

    onRemove() {
      if (this._button) {
        this._button.remove();
      }
      if (this._container && this._container.parentNode) {
        this._container.parentNode.removeChild(this._container);
      }
      this._map = undefined;
    }
  }

  let rulerControl = null;

  function ensureControl() {
    if (!showDesktopControl) return;
    if (rulerControl) return;
    rulerControl = new RulerControl();
    map.addControl(rulerControl, controlPosition);
  }

  // Вешаем обработчики
  container.addEventListener("touchstart", onTouchStart, { passive: false });
  container.addEventListener("touchmove", onTouchMove, { passive: false });
  container.addEventListener("touchend", onTouchEnd, { passive: false });
  container.addEventListener("touchcancel", onTouchCancel, { passive: false });
  ensureControl();

  function destroy() {
    endMeasurement();
    disableDesktopMode();

    container.removeEventListener("touchstart", onTouchStart);
    container.removeEventListener("touchmove", onTouchMove);
    container.removeEventListener("touchend", onTouchEnd);
    container.removeEventListener("touchcancel", onTouchCancel);

    if (rulerControl) {
      map.removeControl(rulerControl);
      rulerControl = null;
    }

    if (map.getLayer(labelPointLayerId)) map.removeLayer(labelPointLayerId);
    if (map.getLayer(circleLayerId)) map.removeLayer(circleLayerId);
    if (map.getLayer(lineLayerId)) map.removeLayer(lineLayerId);
    if (map.getSource(sourceId)) map.removeSource(sourceId);
  }

  function isEnabled() {
    return !!state.desktopEnabled;
  }

  return { destroy, isEnabled };
}
