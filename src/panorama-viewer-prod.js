import * as THREE from "https://unpkg.com/three@0.161.0/build/three.module.js";

/*
Keyboard tuning:
Y / H = heading + / -
T / G = pitch   + / -
R / F = roll    + / -
Shift = bigger step
*/

export function setupPanoramaViewer(map, options) {
  const pad = window.innerWidth - window.innerWidth * 0.3;

  const {
    pointsSourceId = "panoramas",
    pointsLayerId = "panoramas-points",
    pointsData,
    imageBaseUrl = "https://storage.yandexcloud.net/ts-tiles/tashkent-pano/",
    leftPadding = 30,
    rightPadding = pad,
    topPadding = 30,
    bottomPadding = 30,
    minZoom = 16,
    fallbackMountOffsets = {
      heading: 107,
      pitch: -15,
      roll: 136,
    },
  } = options;

  // const normalizedPointsData = normalizePointsData(pointsData);

  let isEnabled = false;
  let hoveredId = null;
  let selectedId = null;

  let resizeState = null;
  const VIEWER_ASPECT = 16 / 9;
  const MIN_VIEWER_WIDTH = 360;

  let scene, camera, renderer;
  let panoMesh = null;
  let currentTexture = null;

  let lon = 0;
  let lat = 0;
  let fov = 75;

  let isPointerDown = false;
  let pointerDownX = 0;
  let pointerDownY = 0;
  let lonOnDown = 0;
  let latOnDown = 0;

  let isTouchDragging = false;
  let touchStartX = 0;
  let touchStartY = 0;
  let touchStartLon = 0;
  let touchStartLat = 0;
  let touchStartNav = null;
  const TOUCH_DRAG_THRESHOLD = 8;

  let hoveredNav = null;

  let points = [];
  let currentIndex = -1;

  const mountOffsets = { ...fallbackMountOffsets };
  const tweakOffsets = { heading: 0, pitch: 0, roll: 0 };
  let tuningHudHideTimer = null;

  const raycaster = new THREE.Raycaster();
  const mouse = new THREE.Vector2();
  const navTargets = [];

  const viewer = document.createElement("div");
  viewer.className = "panorama-viewer hidden";
  viewer.innerHTML = `
    <button class="panorama-close" type="button">×</button>
    <div class="panorama-body">
      <div class="panorama-canvas-wrap"></div>
      <div class="panorama-tuning-hud"></div>
      <div class="panorama-resize-handle" title="Изменить размер"></div>
    </div>
  `;
  document.body.appendChild(viewer);

  const canvasWrap = viewer.querySelector(".panorama-canvas-wrap");
  const closeBtn = viewer.querySelector(".panorama-close");
  const resizeHandle = viewer.querySelector(".panorama-resize-handle");
  const tuningHud = viewer.querySelector(".panorama-tuning-hud");

  closeBtn.onclick = closeViewer;

  const style = document.createElement("style");
  style.innerHTML = `
    .panorama-viewer {
      position: absolute;
      top: 10px;
      right: 50px;
      width: 60%;
      aspect-ratio: 16 / 9;
      z-index: 1000;
      border-radius: 8px;
      overflow: hidden;
      box-shadow: 0 0 0 2px rgba(0,0,0,1);
      background: #111;
      backdrop-filter: blur(10px);
      min-width: 360px;
      max-width: calc(100vw - 80px);
      user-select: none;
    }

    .panorama-viewer.hidden {
      display: none;
    }

    .panorama-close {
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
      box-shadow: 0 0 0 2px rgba(0,0,0,1);
      z-index: 5;
    }

    .panorama-close:hover {
      background: #eee;
    }

    .panorama-body {
      position: relative;
      width: 100%;
      height: 100%;
    }

    .panorama-canvas-wrap {
      position: absolute;
      inset: 0;
      overflow: hidden;
    }

    .panorama-canvas-wrap canvas {
      width: 100%;
      height: 100%;
      display: block;
    }

    .panorama-resize-handle {
      position: absolute;
      left: 0;
      bottom: 0;
      width: 31px;
      height: 31px;
      z-index: 6;
      cursor: nesw-resize;
      background: transparent;
      border-top-right-radius: 8px;
      transition: background 0.2s;
    }

    .panorama-resize-handle:hover {
      background: #ffffff4f;
    }

        .panorama-tuning-hud {
      position: absolute;
      left: 12px;
      bottom: 12px;
      z-index: 7;
      padding: 8px 10px;
      border-radius: 8px;
      background: rgba(0, 0, 0, 0.72);
      color: #fff;
      font: 12px/1.35 monospace;
      white-space: pre;
      pointer-events: none;
      opacity: 0;
      transform: translateY(4px);
      transition:
        opacity 0.15s ease,
        transform 0.15s ease;
    }

    .panorama-tuning-hud.visible {
      opacity: 1;
      transform: translateY(0);
    }
  `;
  document.head.appendChild(style);

  function toPmtilesUrl(url) {
    if (typeof url !== "string" || !url.trim()) {
      throw new Error("pointsData must be a non-empty PMTiles URL string");
    }

    return url.startsWith("pmtiles://") ? url : `pmtiles://${url}`;
  }

  map.addSource(pointsSourceId, {
    type: "vector",
    url: toPmtilesUrl(pointsData),
  });

  map.addLayer({
    id: pointsLayerId,
    type: "circle",
    source: pointsSourceId,
    "source-layer": "merged",
    minzoom: minZoom - 3,
    layout: {
      visibility: "none",
    },
    paint: {
      "circle-radius": 4,
      "circle-color": "#e7ab00",
      "circle-stroke-color": "#ffffff",
      "circle-stroke-width": 1.5,
    },
  });

  map.addSource("panorama-selected-buffer", {
    type: "geojson",
    data: { type: "FeatureCollection", features: [] },
  });

  map.addLayer({
    id: "panorama-selected-buffer",
    //type: "circle",
    type: "symbol",
    source: "panorama-selected-buffer",
    layout: {
      visibility: "none",
      "icon-image": "panoIcon",
      "icon-rotate": ["get", "initialHeading"],
    },
    /*
    paint: {
      "circle-radius": 18,
      "circle-color": "#e7ab00",
      "circle-opacity": 0.18,
      "circle-stroke-color": "#e7ab00",
      "circle-stroke-opacity": 0.4,
      "circle-stroke-width": 1.5,
    },
    */
  });

  map.addSource("panorama-selected", {
    type: "geojson",
    data: { type: "FeatureCollection", features: [] },
  });

  map.addLayer({
    id: "panorama-selected",
    type: "circle",
    source: "panorama-selected",
    layout: { visibility: "none" },
    paint: {
      "circle-radius": 8,
      "circle-color": "#e7ab00",
      "circle-stroke-color": "#fff",
      "circle-stroke-width": 2,
    },
  });
  /*
  if (map.getLayer("panorama-selected-buffer")) {
    map.moveLayer("panorama-selected-buffer", pointsLayerId);
  }

  if (map.getLayer("panorama-selected")) {
    map.moveLayer("panorama-selected", pointsLayerId);
  }
    */

  function setLayerVisibility(id, visible) {
    if (!map.getLayer(id)) return;
    map.setLayoutProperty(id, "visibility", visible ? "visible" : "none");
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

  function getFeatureCoordsKey(feature) {
    const coords = feature?.geometry?.coordinates;
    if (!Array.isArray(coords) || coords.length < 2) return "";
    return `${Number(coords[0]).toFixed(7)},${Number(coords[1]).toFixed(7)}`;
  }

  function getFeatureStableKey(feature) {
    //const id = feature?.properties?.id;
    const name = feature?.properties?.name;
    /*const coordsKey = getFeatureCoordsKey(feature);

    if (id != null && id !== "") return `id:${String(id)}`;
    if (name != null && name !== "") return `name:${String(name)}|${coordsKey}`;
    return `coords:${coordsKey}`;*/
    return name;
  }

  function parsePanoramaDateTime(value) {
    if (typeof value !== "string") return null;

    const m = value
      .trim()
      .match(/^(\d{4})-(\d{2})-(\d{2})\s+(\d{2}):(\d{2}):(\d{2})$/);

    if (!m) return null;

    const [, y, mo, d, h, mi, s] = m;

    return new Date(
      Number(y),
      Number(mo) - 1,
      Number(d),
      Number(h),
      Number(mi),
      Number(s),
    ).getTime();
  }

  function updatePointsPaint() {
    if (!map.getLayer(pointsLayerId)) return;

    map.setPaintProperty(pointsLayerId, "circle-radius", [
      "case",
      ["==", ["to-string", ["get", "name"]], String(hoveredId ?? "")],
      8,
      ["==", ["to-string", ["get", "name"]], String(selectedId ?? "")],
      7,
      4,
    ]);

    map.setPaintProperty(pointsLayerId, "circle-color", "#e7ab00");
    map.setPaintProperty(pointsLayerId, "circle-stroke-color", "#ffffff");
    map.setPaintProperty(pointsLayerId, "circle-stroke-width", 1.5);
    map.setPaintProperty(pointsLayerId, "circle-opacity", [
      "case",
      ["==", ["to-string", ["get", "name"]], String(selectedId ?? "")],
      1,
      isEnabled ? 1 : 0.85,
    ]);
  }

  function setSelectedFeature(feature) {
    const plainFeature = toPlainFeature(feature);
    selectedId = plainFeature?.properties?.name ?? null;

    const fc = plainFeature
      ? { type: "FeatureCollection", features: [plainFeature] }
      : { type: "FeatureCollection", features: [] };

    map.getSource("panorama-selected-buffer")?.setData(fc);
    map.getSource("panorama-selected")?.setData(fc);
  }

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

    if (renderer) {
      renderer.setSize(width, height, false);
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
    }
  }

  function openViewer() {
    viewer.classList.remove("hidden");
    setViewerSize(
      viewer.getBoundingClientRect().width || window.innerWidth * 0.6,
    );
  }

  function closeViewer() {
    viewer.classList.add("hidden");
    hoveredNav = null;

    if (tuningHudHideTimer) {
      clearTimeout(tuningHudHideTimer);
      tuningHudHideTimer = null;
    }
    tuningHud?.classList.remove("visible");

    setSelectedFeature(null);
    selectedId = null;
    updatePointsPaint();
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
    if (rect.width > 0) setViewerSize(rect.width);
  });

  function applyMountOffsetsFromPoint(point) {
    const raw = point?.properties || {};

    mountOffsets.heading = Number.isFinite(Number(raw?.heading))
      ? Number(raw.heading)
      : fallbackMountOffsets.heading;

    mountOffsets.pitch = Number.isFinite(Number(raw?.pitch))
      ? Number(raw.pitch)
      : fallbackMountOffsets.pitch;

    mountOffsets.roll = Number.isFinite(Number(raw?.roll))
      ? Number(raw.roll)
      : fallbackMountOffsets.roll;
  }

  function buildPointsFromVectorFeatures(features) {
    return (features || [])
      .filter(
        (f) =>
          f?.geometry?.type === "Point" &&
          Array.isArray(f.geometry.coordinates) &&
          typeof f?.properties?.name === "string" &&
          f.properties.name.trim() !== "",
      )
      .map((f, idx) => {
        const plainFeature = toPlainFeature(f);

        const properties = { ...(f.properties || {}) };

        return {
          index: idx,
          id: f?.properties?.name ?? idx,
          stableKey: getFeatureStableKey(plainFeature),
          name: f.properties.name,
          datetime: properties.datetime ?? null,
          timestamp: parsePanoramaDateTime(properties.datetime),
          coordinates: {
            lon: Number(f.geometry.coordinates[0]),
            lat: Number(f.geometry.coordinates[1]),
          },
          properties,
          feature: plainFeature,
        };
      });
  }

  function pointFromFeature(feature) {
    if (
      !feature ||
      feature?.geometry?.type !== "Point" ||
      !Array.isArray(feature?.geometry?.coordinates)
    ) {
      return null;
    }

    const plainFeature = toPlainFeature(feature);
    const props = plainFeature.properties || {};

    return {
      index: -1,
      id: props.name ?? null,
      stableKey: getFeatureStableKey(plainFeature),
      name: props.name,
      datetime: props.datetime ?? null,
      timestamp: parsePanoramaDateTime(props.datetime),
      coordinates: {
        lon: Number(plainFeature.geometry.coordinates[0]),
        lat: Number(plainFeature.geometry.coordinates[1]),
      },
      properties: props,
      feature: plainFeature,
    };
  }

  function findPointByIndex(index) {
    return index >= 0 && index < points.length ? points[index] : null;
  }

  function rebuildPointsFromSource() {
    if (!map.getSource(pointsSourceId)) {
      points = [];
      return;
    }

    const features = map.querySourceFeatures(pointsSourceId, {
      sourceLayer: "merged",
    });

    const unique = new Map();

    for (const f of features) {
      const coords = f?.geometry?.coordinates;
      const id = f?.properties?.id;
      const name = f?.properties?.name;

      const key =
        id != null
          ? `id:${id}`
          : `${name || ""}:${Array.isArray(coords) ? coords.join(",") : ""}`;

      if (!unique.has(key)) {
        unique.set(key, f);
      }
    }

    points = buildPointsFromVectorFeatures([...unique.values()]);

    points.sort((a, b) => {
      const ta = Number.isFinite(a.timestamp) ? a.timestamp : Infinity;
      const tb = Number.isFinite(b.timestamp) ? b.timestamp : Infinity;

      if (ta !== tb) return ta - tb;

      return String(a.name || "").localeCompare(
        String(b.name || ""),
        undefined,
        {
          numeric: true,
          sensitivity: "base",
        },
      );
    });

    points.forEach((p, i) => {
      p.index = i;
    });
  }

  function syncSelectedPointFromIndex() {
    const point = findPointByIndex(currentIndex);
    if (!point) return;

    setSelectedFeature(point.feature);
    updatePointsPaint();
    focusWithPadding(point.feature);
  }

  function createPlaceholderPanorama() {
    const canvas = document.createElement("canvas");
    canvas.width = 2048;
    canvas.height = 1024;
    const ctx = canvas.getContext("2d");

    const grad = ctx.createLinearGradient(0, 0, 0, canvas.height);
    grad.addColorStop(0, "#2f3340");
    grad.addColorStop(1, "#111318");
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    ctx.fillStyle = "rgba(255,255,255,0.25)";
    ctx.font = "bold 64px Arial";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText("Loading panorama...", canvas.width / 2, canvas.height / 2);

    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    setPanoramaTexture(texture);
  }

  function createSphereMesh(texture) {
    const geometry = new THREE.SphereGeometry(500, 160, 100);
    geometry.scale(-1, 1, 1);

    const material = new THREE.MeshBasicMaterial({
      map: texture,
      side: THREE.FrontSide,
    });

    const mesh = new THREE.Mesh(geometry, material);
    mesh.rotation.order = "YXZ";
    return mesh;
  }

  function setPanoramaTexture(texture) {
    if (panoMesh) {
      scene.remove(panoMesh);
      panoMesh.geometry.dispose();
      panoMesh.material.dispose();
    }

    if (currentTexture) currentTexture.dispose();

    currentTexture = texture;
    panoMesh = createSphereMesh(texture);
    panoMesh.renderOrder = 0;
    scene.add(panoMesh);

    applyOrientation();
  }

  function loadTextureFromURL(url) {
    return new Promise((resolve, reject) => {
      const loader = new THREE.TextureLoader();
      loader.load(
        url,
        (texture) => {
          texture.colorSpace = THREE.SRGBColorSpace;
          texture.minFilter = THREE.LinearFilter;
          texture.magFilter = THREE.LinearFilter;
          texture.generateMipmaps = true;
          resolve(texture);
        },
        undefined,
        (err) => reject(err || new Error(`Texture load error: ${url}`)),
      );
    });
  }

  function applyOrientation() {
    if (!panoMesh) return;

    const heading = THREE.MathUtils.degToRad(
      mountOffsets.heading + tweakOffsets.heading,
    );
    const pitch = THREE.MathUtils.degToRad(
      mountOffsets.pitch + tweakOffsets.pitch,
    );
    const roll = THREE.MathUtils.degToRad(
      mountOffsets.roll + tweakOffsets.roll,
    );

    const q = new THREE.Quaternion();

    q.multiply(
      new THREE.Quaternion().setFromAxisAngle(
        new THREE.Vector3(0, 1, 0),
        -heading,
      ),
    );
    q.multiply(
      new THREE.Quaternion().setFromAxisAngle(
        new THREE.Vector3(1, 0, 0),
        -pitch,
      ),
    );
    q.multiply(
      new THREE.Quaternion().setFromAxisAngle(
        new THREE.Vector3(0, 0, 1),
        -roll,
      ),
    );

    panoMesh.quaternion.copy(q);
  }

  function getFinalOffsets() {
    return {
      heading: mountOffsets.heading + tweakOffsets.heading,
      pitch: mountOffsets.pitch + tweakOffsets.pitch,
      roll: mountOffsets.roll + tweakOffsets.roll,
    };
  }

  function showTuningHud() {
    if (!tuningHud) return;

    const final = getFinalOffsets();

    tuningHud.textContent = [
      `heading: ${final.heading.toFixed(2)}`,
      `pitch:   ${final.pitch.toFixed(2)}`,
      `roll:    ${final.roll.toFixed(2)}`,
    ].join("\n");

    tuningHud.classList.add("visible");

    if (tuningHudHideTimer) {
      clearTimeout(tuningHudHideTimer);
    }

    tuningHudHideTimer = setTimeout(() => {
      tuningHud.classList.remove("visible");
      tuningHudHideTimer = null;
    }, 1400);
  }

  function logFinalOffsets() {
    const final = getFinalOffsets();
    console.log(
      `[panorama-viewer] heading=${final.heading.toFixed(2)}, pitch=${final.pitch.toFixed(2)}, roll=${final.roll.toFixed(2)}`,
    );
  }

  function normalizeAngle(deg) {
    let v = deg % 360;
    if (v > 180) v -= 360;
    if (v < -180) v += 360;
    return v;
  }

  function createNavArrowMesh({ direction = "forward" }) {
    const group = new THREE.Group();

    const innerShape = new THREE.Shape();
    innerShape.moveTo(0, 10);
    innerShape.lineTo(-4.77, 0.44);
    innerShape.lineTo(-4.535, 0.185);
    innerShape.lineTo(0, 2);
    innerShape.lineTo(4.535, 0.185);
    innerShape.lineTo(4.77, 0.44);
    innerShape.closePath();

    const outerShape = new THREE.Shape();
    outerShape.moveTo(0, 11.1);
    outerShape.lineTo(-5.377, 0.362);
    outerShape.lineTo(-4.67, -0.406);
    outerShape.lineTo(0, 1.46);
    outerShape.lineTo(4.67, -0.406);
    outerShape.lineTo(5.377, 0.362);
    outerShape.closePath();

    const whiteGeometry = new THREE.ShapeGeometry(
      innerShape,
    ); /*new THREE.ExtrudeGeometry(innerShape, {
      depth: 0.5,
      bevelEnabled: false,
    });*/
    whiteGeometry.center();

    const blackGeometry = new THREE.ShapeGeometry(
      innerShape,
    ); /*new THREE.ExtrudeGeometry(outerShape, {
      depth: 0.4,
      bevelEnabled: false,
    });
    */
    blackGeometry.center();

    const whiteMaterial = new THREE.MeshBasicMaterial({
      color: 0xffffff,
      depthTest: true,
      depthWrite: true,
    });

    const blackMaterial = new THREE.MeshBasicMaterial({
      color: 0x000000,
      transparent: true,
      opacity: 0.45,
      depthTest: true,
      depthWrite: true,
    });

    const blackMesh = new THREE.Mesh(blackGeometry, blackMaterial);
    const whiteMesh = new THREE.Mesh(whiteGeometry, whiteMaterial);

    whiteMesh.position.z = 1;

    group.add(blackMesh);
    group.add(whiteMesh);

    group.rotation.x = -Math.PI / 2;
    group.position.y = 0.2;

    if (direction === "backward") {
      group.rotation.z = Math.PI;
    }

    group.userData.isNavArrow = true;
    group.userData.direction = direction;
    group.userData.baseColor = 0xffffff;
    group.userData.hoverColor = 0xe7ab00;
    group.userData.whiteMesh = whiteMesh;

    return group;
  }

  function clearNavigationArrows() {
    while (navTargets.length) {
      const obj = navTargets.pop();
      obj.parent?.remove(obj);
      obj.traverse((child) => {
        if (child.geometry) child.geometry.dispose?.();
        if (Array.isArray(child.material)) {
          child.material.forEach((m) => m.dispose?.());
        } else if (child.material) {
          child.material.dispose?.();
        }
      });
    }
  }

  function createNavigationArrows() {
    clearNavigationArrows();

    const forwardArrow = createNavArrowMesh({ direction: "forward" });
    const backwardArrow = createNavArrowMesh({ direction: "backward" });

    forwardArrow.position.set(0, -20, -40);
    backwardArrow.position.set(0, -20, 40);

    scene.add(forwardArrow);
    scene.add(backwardArrow);

    navTargets.push(forwardArrow, backwardArrow);
  }

  function updateNavigationVisibility() {
    for (const obj of navTargets) {
      if (!obj?.userData?.isNavArrow) continue;

      if (obj.userData.direction === "forward") {
        obj.visible = currentIndex < points.length - 1;
      } else {
        obj.visible = currentIndex > 0;
      }
    }
  }

  function pickNavObject(clientX, clientY) {
    if (!navTargets.length) return null;

    const rect = renderer.domElement.getBoundingClientRect();
    mouse.x = ((clientX - rect.left) / rect.width) * 2 - 1;
    mouse.y = -((clientY - rect.top) / rect.height) * 2 + 1;

    raycaster.setFromCamera(mouse, camera);

    const intersects = raycaster.intersectObjects(navTargets, true);
    if (!intersects.length) return null;

    let obj = intersects[0].object;
    while (obj && !obj.userData?.isNavArrow) {
      obj = obj.parent;
    }

    return obj?.userData?.isNavArrow ? obj : null;
  }

  function setHoveredNav(newHovered) {
    if (hoveredNav === newHovered) return;

    if (hoveredNav?.userData?.whiteMesh) {
      hoveredNav.userData.whiteMesh.material.color.set(
        hoveredNav.userData.baseColor ?? 0xffffff,
      );
    }

    if (newHovered?.userData?.whiteMesh) {
      newHovered.userData.whiteMesh.material.color.set(
        newHovered.userData.hoverColor ?? 0xe7ab00,
      );
    }

    hoveredNav = newHovered;
  }

  async function loadPanoramaByIndex(index) {
    if (index < 0 || index >= points.length) return;
    await loadPanoramaFromPoint(points[index]);
  }

  async function loadPanoramaFromPoint(point) {
    if (!point?.name) return;

    const idx = points.findIndex((p) => p.stableKey === point.stableKey);
    currentIndex = idx;

    const texture = await loadTextureFromURL(imageBaseUrl + point.name);

    applyMountOffsetsFromPoint(point);
    setPanoramaTexture(texture);
    updateNavigationVisibility();

    setSelectedFeature(point.feature);
    updatePointsPaint();
    focusWithPadding(point.feature);
  }

  function handleNavigate(direction) {
    if (direction === "forward" && currentIndex < points.length - 1) {
      loadPanoramaByIndex(currentIndex + 1);
    } else if (direction === "backward" && currentIndex > 0) {
      loadPanoramaByIndex(currentIndex - 1);
    }
  }

  function onPointerDown(e) {
    isPointerDown = true;
    pointerDownX = e.clientX;
    pointerDownY = e.clientY;
    lonOnDown = lon;
    latOnDown = lat;
  }

  function onPointerMove(e) {
    if (!isPointerDown) return;

    lon = lonOnDown - (e.clientX - pointerDownX) * 0.12;
    lat = latOnDown + (e.clientY - pointerDownY) * 0.12;
    lat = Math.max(-89, Math.min(89, lat));
    lon = normalizeAngle(lon);
    map.setLayoutProperty("panorama-selected-buffer", "icon-rotate", [
      "+",
      ["get", "initialHeading"],
      lon,
    ]);
  }

  function onPointerUp() {
    isPointerDown = false;
  }

  function onWheel(e) {
    e.preventDefault();
    fov += e.deltaY * 0.03;
    fov = Math.max(30, Math.min(100, fov));
    camera.fov = fov;
    camera.updateProjectionMatrix();
  }

  function onKeyDown(e) {
    if (viewer.classList.contains("hidden")) return;

    const tag = document.activeElement?.tagName;
    if (
      tag === "INPUT" ||
      tag === "TEXTAREA" ||
      document.activeElement?.isContentEditable
    ) {
      return;
    }

    const key = e.key.toLowerCase();
    const step = e.shiftKey ? 2 : 0.5;
    let changed = false;

    switch (key) {
      case "y":
        tweakOffsets.heading += step;
        changed = true;
        break;
      case "h":
        tweakOffsets.heading -= step;
        changed = true;
        break;
      case "t":
        tweakOffsets.pitch += step;
        changed = true;
        break;
      case "g":
        tweakOffsets.pitch -= step;
        changed = true;
        break;
      case "r":
        tweakOffsets.roll += step;
        changed = true;
        break;
      case "f":
        tweakOffsets.roll -= step;
        changed = true;
        break;
      default:
        break;
    }

    if (!changed) return;

    e.preventDefault();
    applyOrientation();
    logFinalOffsets();
    showTuningHud();
  }

  function onPointerHover(event) {
    setHoveredNav(pickNavObject(event.clientX, event.clientY));
  }

  function onTouchStart(event) {
    if (!event.touches.length) return;

    const t = event.touches[0];
    isTouchDragging = false;
    touchStartX = t.clientX;
    touchStartY = t.clientY;
    touchStartLon = lon;
    touchStartLat = lat;
    touchStartNav = pickNavObject(t.clientX, t.clientY);

    setHoveredNav(touchStartNav);
  }

  function onTouchMove(event) {
    if (!event.touches.length) return;

    const t = event.touches[0];
    const dx = t.clientX - touchStartX;
    const dy = t.clientY - touchStartY;

    if (
      !isTouchDragging &&
      (Math.abs(dx) > TOUCH_DRAG_THRESHOLD ||
        Math.abs(dy) > TOUCH_DRAG_THRESHOLD)
    ) {
      isTouchDragging = true;
      setHoveredNav(null);
    }

    if (isTouchDragging) {
      lon = touchStartLon - dx * 0.12;
      lat = touchStartLat + dy * 0.12;
      lat = Math.max(-89, Math.min(89, lat));
      lon = normalizeAngle(lon);
      return;
    }

    setHoveredNav(pickNavObject(t.clientX, t.clientY));
  }

  function onTouchEnd(event) {
    if (!event.changedTouches.length) return;

    const t = event.changedTouches[0];

    if (isTouchDragging) {
      isTouchDragging = false;
      touchStartNav = null;
      setHoveredNav(null);
      return;
    }

    const obj = pickNavObject(t.clientX, t.clientY) || touchStartNav;
    if (obj?.userData?.isNavArrow) {
      handleNavigate(obj.userData.direction);
    }

    isTouchDragging = false;
    touchStartNav = null;
    setHoveredNav(null);
  }

  function onViewerClick(event) {
    const obj = pickNavObject(event.clientX, event.clientY);
    if (!obj?.userData?.isNavArrow) return;
    handleNavigate(obj.userData.direction);
  }

  function updateCamera() {
    const phi = THREE.MathUtils.degToRad(90 - lat);
    const theta = THREE.MathUtils.degToRad(lon);

    camera.lookAt(
      Math.sin(phi) * Math.sin(theta),
      Math.cos(phi),
      -Math.sin(phi) * Math.cos(theta),
    );
  }

  function animate() {
    if (!renderer) return;
    requestAnimationFrame(animate);
    updateCamera();
    renderer.render(scene, camera);
  }

  function initThree() {
    scene = new THREE.Scene();

    camera = new THREE.PerspectiveCamera(fov, 16 / 9, 0.1, 2000);
    camera.position.set(0, 0, 0.01);
    scene.add(camera);

    renderer = new THREE.WebGLRenderer({
      antialias: true,
      alpha: false,
    });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    canvasWrap.appendChild(renderer.domElement);

    createPlaceholderPanorama();
    createNavigationArrows();

    renderer.domElement.addEventListener("mousedown", onPointerDown);
    window.addEventListener("mousemove", onPointerMove);
    window.addEventListener("mouseup", onPointerUp);
    renderer.domElement.addEventListener("wheel", onWheel, { passive: false });
    renderer.domElement.addEventListener("click", onViewerClick);
    renderer.domElement.addEventListener("mousemove", onPointerHover);
    window.addEventListener("keydown", onKeyDown);

    renderer.domElement.addEventListener("touchstart", onTouchStart, {
      passive: true,
    });
    renderer.domElement.addEventListener("touchmove", onTouchMove, {
      passive: true,
    });
    renderer.domElement.addEventListener("touchend", onTouchEnd, {
      passive: true,
    });
    renderer.domElement.addEventListener(
      "touchcancel",
      () => {
        isTouchDragging = false;
        touchStartNav = null;
        setHoveredNav(null);
      },
      { passive: true },
    );

    animate();
  }

  function handlePointClick(e) {
    if (!isEnabled) return;

    e?.originalEvent?.stopPropagation?.();

    if (!points.length) {
      rebuildPointsFromSource();
    }

    const f = e.features?.[0];
    if (!f) return;

    const point = pointFromFeature(f);
    if (!point?.name) return;

    openViewer();
    loadPanoramaFromPoint(point);
  }

  function handleMouseEnter(e) {
    if (!isEnabled) return;
    map.getCanvas().style.cursor = "pointer";
    hoveredId = e.features?.[0]?.properties?.name ?? null;
    updatePointsPaint();
  }

  function handleMouseMove(e) {
    if (!isEnabled) return;
    const nextHoveredId = e.features?.[0]?.properties?.name ?? null;
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

    if (map.getZoom() < minZoom) {
      map.easeTo({
        zoom: minZoom,
        duration: 500,
        essential: true,
      });
    }

    rebuildPointsFromSource();

    setLayerVisibility(pointsLayerId, true);
    setLayerVisibility("panorama-selected-buffer", true);
    setLayerVisibility("panorama-selected", true);
    updatePointsPaint();
  }

  function disable() {
    isEnabled = false;
    hoveredId = null;
    selectedId = null;

    setSelectedFeature(null);
    closeViewer();

    setLayerVisibility(pointsLayerId, false);
    setLayerVisibility("panorama-selected-buffer", false);
    setLayerVisibility("panorama-selected", false);

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

  initThree();

  setLayerVisibility(pointsLayerId, false);
  setLayerVisibility("panorama-selected-buffer", false);
  setLayerVisibility("panorama-selected", false);
  updatePointsPaint();

  return {
    enable,
    disable,
    isOpen,
    closeViewer,
  };
}
