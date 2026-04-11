// pmtiles-projects.js
import { createPmtilesLoaderGeom } from "./pmtiles-loader-geom.js";
import { createPmtilesDeckLayers } from "./pmtiles-deck-layers.js";

/**
 * options:
 *  - deck, deckOverlay
 *  - layersPanelId: id контейнера для кнопок проектов (default: "layersPanel")
 *  - onLog: optional логгер
 */
export function createPmtilesProjectsManager({
  deck,
  deckOverlay,
  layersPanelId = "layersPanel",
  enablePanelUi = true,
  onLog = console.log,
}) {
  const projects = new Map();

  const toggleLayersPanel = document.getElementById("toggleLayers");
  const layersPanel = document.getElementById("layersPanel");

  if (enablePanelUi && toggleLayersPanel && layersPanel) {
    toggleLayersPanel.addEventListener("click", () => {
      const isOpen = toggleLayersPanel.classList.contains("active");

      if (isOpen) {
        // ЗАКРЫВАЕМ
        // 1) зафиксировать текущую высоту числом
        const fullHeight = layersPanel.scrollHeight + "px";
        layersPanel.style.height = fullHeight;

        // 2) форс-рефлоу, чтобы браузер "поверил" в эту высоту
        void layersPanel.offsetHeight;

        // 3) теперь плавно анимируем до 0
        layersPanel.style.height = "0px";

        // 4) снимаем active после анимации (если хочешь с задержкой)
        setTimeout(() => {
          toggleLayersPanel.classList.remove("active");
        }, 300);
      } else {
        // ОТКРЫВАЕМ
        toggleLayersPanel.classList.add("active");

        // 1) сначала ставим высоту 0 (старт анимации)
        layersPanel.style.height = "0px";

        // 2) в следующем кадре ставим целевую высоту
        const fullHeight = layersPanel.scrollHeight + "px";
        requestAnimationFrame(() => {
          layersPanel.style.height = fullHeight;
        });

        // 3) после завершения анимации фиксируем height в auto
        const onTransitionEnd = (e) => {
          if (e.propertyName !== "height") return;
          layersPanel.removeEventListener("transitionend", onTransitionEnd);
          layersPanel.style.height = "auto"; // дальше блок сам растягивается
        };
        layersPanel.addEventListener("transitionend", onTransitionEnd);
      }
    });
  }

  function log(...args) {
    onLog?.("[pmtiles-projects]", ...args);
  }

  function getLayersPanel() {
    const el = document.getElementById(layersPanelId);
    if (!el) {
      log(`⚠️ layersPanel #${layersPanelId} не найден`);
    }

    return el;
  }

  /**
   * projectId: строка, например "zharokov"
   * projectName: как показывать в UI, например "Жарокова"
   * layers: массив объектов:
   *   [{ url, name, minZoom?, maxZoom? }, ...]
   */
  function addProject(projectId, projectName, layers, options = {}) {
    const { createButton = true, initiallyVisible = true } = options;
    const panel = getLayersPanel();

    const project = {
      id: projectId,
      name: projectName || projectId,
      visible: initiallyVisible,
      layers: [],
      buttonEl: null,
    };
    projects.set(projectId, project);

    // создаём/подключаем все слои проекта
    layers.forEach((layerDef) => {
      const { url, name, minZoom = 14, maxZoom = 22 } = layerDef;

      if (!url) {
        log(`⚠️ Пустой url для слоя "${name}" проекта "${projectId}"`);
        return;
      }

      const layerId = `${projectId}-${(name || "layer")
        .toLowerCase()
        .trim()
        .replace(/\s+/g, "-")
        .replace(/[^a-z0-9_-]/g, "")}`;

      const isSidecar = /\.sidecar\.json$/i.test(url);

      if (isSidecar) {
        loadSidecarLayer({
          project,
          layerId,
          name,
          sidecarUrl: url,
          minZoom,
          maxZoom,
        });
      } else {
        loadPmtilesLayer({
          project,
          layerId,
          name,
          pmtilesUrl: url,
          minZoom,
          maxZoom,
        });
      }
    });

    // кнопка проекта
    if (enablePanelUi && createButton && panel) {
      createProjectButton(panel, project);
    }

    return project;
  }

  function loadPmtilesLayer({
    project,
    layerId,
    name,
    pmtilesUrl,
    minZoom,
    maxZoom,
  }) {
    const loader = createPmtilesLoaderGeom({
      id: layerId,
      onLog,
    });
    loader.setFromUrl(pmtilesUrl);

    const renderer = createPmtilesDeckLayers({
      deck,
      deckOverlay,
      loader,
      id: layerId,
      minZoom,
      maxZoom,
      onLog,
    });
    renderer.apply();

    const layerEntry = {
      id: layerId,
      name,
      type: "pmtiles",
      loader,
      renderer,
      visible: project.visible,
    };

    if (!project.visible) {
      toggleDeckLayerVisibility(layerEntry.id, false);
    }

    project.layers.push(layerEntry);

    // если проект уже выключен, сразу спрячем только что добавленный слой
    //if (!project.visible) {
    //  toggleDeckLayerVisibility(layerEntry.id, false);
    //  layerEntry.visible = false;
    //}
  }

  async function loadSidecarLayer({
    project,
    layerId,
    name,
    sidecarUrl,
    minZoom,
    maxZoom,
  }) {
    try {
      const resp = await fetch(sidecarUrl);
      if (!resp.ok) {
        throw new Error(`[TS] sidecar HTTP ${resp.status} ${resp.statusText}`);
      }
      const sidecar = await resp.json();

      const loader = createPmtilesLoaderGeom({
        id: layerId,
        onLog,
      });

      // pmtilesName относительный к сайдкару
      const base = new URL(sidecarUrl, window.location.href);
      const pmtilesUrl = new URL(sidecar.pmtilesName, base).toString();
      loader.setFromUrl(pmtilesUrl);

      // widthMap: handle -> { w, ht, hs, ha, hp }
      if (sidecar.entities && typeof sidecar.entities === "object") {
        const widthMap = new Map();
        for (const [handle, rec] of Object.entries(sidecar.entities)) {
          if (!rec) continue;
          const merged = {};
          if (typeof rec.w === "number" && Number.isFinite(rec.w)) {
            merged.w = rec.w;
          }
          if (typeof rec.ht === "number" && Number.isFinite(rec.ht)) {
            merged.ht = rec.ht;
          }
          if (typeof rec.hs === "number" && Number.isFinite(rec.hs)) {
            merged.hs = rec.hs;
          }
          if (typeof rec.ha === "number" && Number.isFinite(rec.ha)) {
            merged.ha = rec.ha;
          }
          if (typeof rec.hp === "string") {
            merged.hp = rec.hp;
          }
          if (Object.keys(merged).length) {
            widthMap.set(handle, merged);
          }
        }
        loader.setSidecarWidthMap(widthMap);
      }

      const renderer = createPmtilesDeckLayers({
        deck,
        deckOverlay,
        loader,
        id: layerId,
        minZoom,
        maxZoom,
        onLog,
      });
      renderer.apply();

      const layerEntry = {
        id: layerId,
        name,
        type: "sidecar",
        loader,
        renderer,
        visible: project.visible,
      };

      if (!project.visible) {
        toggleDeckLayerVisibility(layerEntry.id, false);
      }
      project.layers.push(layerEntry);

      // если проект уже выключен, сразу спрячем и этот слой
      //if (!project.visible) {
      //  toggleDeckLayerVisibility(layerEntry.id, false);
      //  layerEntry.visible = false;
      //}
    } catch (err) {
      log("[TS] failed to load sidecar/pmtiles", err);
    }
  }

  function createProjectButton(panel, project) {
    const btn = document.createElement("button");
    btn.className = "project-toggle";
    btn.dataset.projectId = project.id;
    btn.innerHTML = `<div class=buttonLine>
  <i class="fa ${project.visible ? "fa-eye" : "fa-eye-slash"}" aria-hidden="true"></i>
  <span>${project.name}</span>
</div>`.trim();

    if (!project.visible) {
      btn.classList.add("hidden");
    }

    btn.addEventListener("click", () => {
      project.visible = !project.visible;
      toggleProjectVisibility(project.id, project.visible);

      const icon = btn.querySelector("i");
      if (icon) {
        icon.className = project.visible ? "fa fa-eye" : "fa fa-eye-slash";
      }

      if (!project.visible) {
        btn.classList.add("hidden");
      } else {
        btn.classList.remove("hidden");
      }
    });

    panel.appendChild(btn);
    project.buttonEl = btn;
  }

  function toggleProjectVisibility(projectId, visible) {
    const project = projects.get(projectId);
    if (!project) return;

    project.visible = visible;

    // Прячем/показываем все deck-слои проекта
    for (const layerEntry of project.layers) {
      layerEntry.visible = visible;
      toggleDeckLayerVisibility(layerEntry.id, visible);
    }
  }

  /**
   * Прячет/показывает все deck-сабслои, относящиеся к данному pmtiles-слою.
   * createPmtilesDeckLayers создаёт TileLayer с id `${id}-tiles`
   * и sublayers, чьи id начинаются с `${id}-tiles`.
   */
  function toggleDeckLayerVisibility(layerId, visible) {
    const current = deckOverlay._props?.layers || [];
    if (!current.length) return;

    const tilePrefix = `${layerId}-tiles`;

    const next = current.map((l) => {
      if (!l || typeof l.id !== "string") return l;
      if (!l.id.startsWith(tilePrefix)) return l;
      return l.clone({ visible });
    });

    deckOverlay.setProps({ layers: next });
  }

  return {
    addProject,
    toggleProjectVisibility,
    projects,
  };
}
