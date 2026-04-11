import { SAOLayer } from "./sao-layer-fxaa.optim-render.din-res.js";
import { BuildingShadowsLayer } from "./shadows.dev.js";
import { setupTwoFingerRuler } from "./maplibre-ruler.js";
import { setupMirrorViewer } from "./mirror-viewer.js";
import { installYandex3395Protocol } from "./yandex3395-protocol.js";
import { setupPanoramaViewer } from "./panorama-viewer-prod.js";
import { createDxfExportWidget } from "./dxf-deck/dxf-export-widget.js";
import { createPmtilesProjectsManager } from "./dxf-deck/pmtiles-projects.js";
import { initComments } from "./comments.js";

const { MapboxOverlay } = deck;

const TASHKENT_BORDERS_URL =
  //"https://lucky-haze-a46b.yanpogutsa.workers.dev/tashkent_vector/260403_borders.geojson";
  "https://storage.yandexcloud.net/ts-tiles/tashkent-vector/260403_borders.geojson";

const TASHKENT_OTHER_BORDERS_URL =
  //"https://lucky-haze-a46b.yanpogutsa.workers.dev/tashkent_vector/260403_other_streets.geojson";
  "https://storage.yandexcloud.net/ts-tiles/tashkent-vector/260403_other_streets.geojson";
const TASHKENT_AXISES_URL =
  //"https://lucky-haze-a46b.yanpogutsa.workers.dev/tashkent_vector/260331_axises.geojson",
  "https://storage.yandexcloud.net/ts-tiles/tashkent-vector/260331_axises.geojson";

const TASHKENT_MIRRORS_URL =
  //"pmtiles://https://lucky-haze-a46b.yanpogutsa.workers.dev/tashkent_vector/260403_tashkent_mirrors.pmtiles";
  "pmtiles://https://storage.yandexcloud.net/ts-tiles/tashkent-vector/260403_tashkent_mirrors.pmtiles";

const TASHKENT_PANORAMAS_URL =
  "https://storage.yandexcloud.net/ts-tiles/tashkent-pano/merged.pmtiles";

const TASHKENT_PROJECT_INDEX_URL =
  "https://storage.yandexcloud.net/ts-tiles/tashkent-vector/260403_project_index.json";

const API_BASE = "https://d5dvd58pocihuelne2bh.iwzqm34r.apigw.yandexcloud.net";

// --- main -------------------------------------------------------------------

const isMobile =
  /Android|iPhone|iPad|iPod/i.test(navigator.userAgent) ||
  window.innerWidth < 900;

let viewState = {
  longitude: 69.248161,
  latitude: 41.310787,
  zoom: 12,
  pitch: 0,
  bearing: 0,
};

installYandex3395Protocol(maplibregl, {
  yandexTemplate:
    "https://sat02.maps.yandex.net/tiles?l=sat&v=3.1726.0&x={x}&y={y}&z={z}&lang=ru_KZ&client_id=yandex-web-maps",
});

var map = new maplibregl.Map({
  container: "map",
  hash: true,
  style: "./src/ts-style.json", //"https://tiles.openfreemap.org/styles/positron", // stylesheet location
  center: [viewState.longitude, viewState.latitude],
  zoom: 9, // starting zoom
  minZoom: 2,
  zoom: 15,
  bearingSnap: 5,
  antialias: !isMobile,
  touchPitch: !isMobile,
  dragRotate: false,
  preserveDrawingBuffer: false,
});

const ruler = setupTwoFingerRuler(map, turf, {
  longPressMs: 800,
  offsetPx: 40,
  showDesktopControl: !isMobile,
});

window.mapboxgl = maplibregl;

let mirrorViewer = null;
let mirrorsModeEnabled = false;

let panoramaViewer = null;
let panoramasModeEnabled = false;

const deckOverlay = new MapboxOverlay({
  interleaved: false,
  layers: [],
});

const projectsManager = createPmtilesProjectsManager({
  deck,
  deckOverlay,
  enablePanelUi: false,
  onLog: console.log,
});

let projectIndex = null;
const streetProjectState = new Map();
// === PMTiles URLs ===
/*
const PMTILES_URLS = [
  //МКАД
  "https://lucky-haze-a46b.yanpogutsa.workers.dev/tashkent-ortho/Amir Temur - Aytmatov.pmtiles",
  "https://lucky-haze-a46b.yanpogutsa.workers.dev/tashkent-ortho/Aytmatov - Darkhon.pmtiles",
  "https://lucky-haze-a46b.yanpogutsa.workers.dev/tashkent-ortho/Babur%20-%20Rustaveli.pmtiles",
  "https://lucky-haze-a46b.yanpogutsa.workers.dev/tashkent-ortho/Beruni - Talabalar.pmtiles",
  "https://lucky-haze-a46b.yanpogutsa.workers.dev/tashkent-ortho/DJI_202603141532_002_tow11-1 Bunedkor-stadion.pmtiles",
  "https://lucky-haze-a46b.yanpogutsa.workers.dev/tashkent-ortho/DJI_202603141532_002_tow11-2 Bunedkor-stadion.pmtiles",
  "https://lucky-haze-a46b.yanpogutsa.workers.dev/tashkent-ortho/DJI_202603151253_029_17 - Donish-MKAD.pmtiles",
  "https://lucky-haze-a46b.yanpogutsa.workers.dev/tashkent-ortho/Darkhon - Mustakillik.pmtiles",
  "https://lucky-haze-a46b.yanpogutsa.workers.dev/tashkent-ortho/Darvoza%20-%20Tashkucha.pmtiles",
  "https://lucky-haze-a46b.yanpogutsa.workers.dev/tashkent-ortho/Donish - Iftihor.pmtiles",
  "https://lucky-haze-a46b.yanpogutsa.workers.dev/tashkent-ortho/Iftihor - Amir Temur.pmtiles",
  "https://lucky-haze-a46b.yanpogutsa.workers.dev/tashkent-ortho/Kizil Takzar -Darvoza.pmtiles",
  "https://lucky-haze-a46b.yanpogutsa.workers.dev/tashkent-ortho/Lutfi - Kizil Takzar.pmtiles",
  "https://lucky-haze-a46b.yanpogutsa.workers.dev/tashkent-ortho/Mustakillik - Parkent.pmtiles",
  "https://lucky-haze-a46b.yanpogutsa.workers.dev/tashkent-ortho/Olmazor - Ahmad Donish.pmtiles",
  "https://lucky-haze-a46b.yanpogutsa.workers.dev/tashkent-ortho/Parkent - Abduli Kadiri.pmtiles",
  "https://lucky-haze-a46b.yanpogutsa.workers.dev/tashkent-ortho/Sagban - Olmazor.pmtiles",
  "https://lucky-haze-a46b.yanpogutsa.workers.dev/tashkent-ortho/Talabalar - Sagban.pmtiles",
  "https://lucky-haze-a46b.yanpogutsa.workers.dev/tashkent-ortho/Abdulli Kadiri - Sarikul.pmtiles",
  "https://lucky-haze-a46b.yanpogutsa.workers.dev/tashkent-ortho/Sarikul - Babur.pmtiles",
  "https://lucky-haze-a46b.yanpogutsa.workers.dev/tashkent-ortho/Sergeli - Bunedkor.pmtiles",
  "https://lucky-haze-a46b.yanpogutsa.workers.dev/tashkent-ortho/Tashkocha - Beruni.pmtiles",
  "https://lucky-haze-a46b.yanpogutsa.workers.dev/tashkent-ortho/Ахмат_Дониш_1.pmtiles",
  "https://lucky-haze-a46b.yanpogutsa.workers.dev/tashkent-ortho/Ахмат_Дониш_2.pmtiles",
  "https://lucky-haze-a46b.yanpogutsa.workers.dev/tashkent-ortho/Ахмат_Дониш_3.pmtiles",
  "https://lucky-haze-a46b.yanpogutsa.workers.dev/tashkent-ortho/Ахмат_Дониш_4.pmtiles",
  "https://lucky-haze-a46b.yanpogutsa.workers.dev/tashkent-ortho/Ислам_Каримов_1.pmtiles",
  "https://lucky-haze-a46b.yanpogutsa.workers.dev/tashkent-ortho/Ислам_Каримов_2.pmtiles",
  "https://lucky-haze-a46b.yanpogutsa.workers.dev/tashkent-ortho/Ислам_Каримов_3.pmtiles",
  "https://lucky-haze-a46b.yanpogutsa.workers.dev/tashkent-ortho/Махтумкули_1.pmtiles",
  "https://lucky-haze-a46b.yanpogutsa.workers.dev/tashkent-ortho/Махтумкули_2.pmtiles",
  "https://lucky-haze-a46b.yanpogutsa.workers.dev/tashkent-ortho/Махтумкули_3.pmtiles",
  "https://lucky-haze-a46b.yanpogutsa.workers.dev/tashkent-ortho/Махтумкули_4.pmtiles",
  "https://lucky-haze-a46b.yanpogutsa.workers.dev/tashkent-ortho/Махтумкули_5.pmtiles",
  "https://lucky-haze-a46b.yanpogutsa.workers.dev/tashkent-ortho/Нукус-1.pmtiles",
  "https://lucky-haze-a46b.yanpogutsa.workers.dev/tashkent-ortho/Нукус-2.pmtiles",
  "https://lucky-haze-a46b.yanpogutsa.workers.dev/tashkent-ortho/Нукус-3.pmtiles",
  "https://lucky-haze-a46b.yanpogutsa.workers.dev/tashkent-ortho/Нурафшон 1.pmtiles",
  "https://lucky-haze-a46b.yanpogutsa.workers.dev/tashkent-ortho/Нурафшон 10.pmtiles",
  "https://lucky-haze-a46b.yanpogutsa.workers.dev/tashkent-ortho/Нурафшон 11.pmtiles",
  "https://lucky-haze-a46b.yanpogutsa.workers.dev/tashkent-ortho/Нурафшон 2.pmtiles",
  "https://lucky-haze-a46b.yanpogutsa.workers.dev/tashkent-ortho/Нурафшон 3.pmtiles",
  "https://lucky-haze-a46b.yanpogutsa.workers.dev/tashkent-ortho/Нурафшон 4.pmtiles",
  "https://lucky-haze-a46b.yanpogutsa.workers.dev/tashkent-ortho/Нурафшон 5.pmtiles",
  "https://lucky-haze-a46b.yanpogutsa.workers.dev/tashkent-ortho/Нурафшон 6.pmtiles",
  "https://lucky-haze-a46b.yanpogutsa.workers.dev/tashkent-ortho/Нурафшон 7.pmtiles",
  "https://lucky-haze-a46b.yanpogutsa.workers.dev/tashkent-ortho/Нурафшон 8.pmtiles",
  "https://lucky-haze-a46b.yanpogutsa.workers.dev/tashkent-ortho/Нурафшон 9.pmtiles",
  "https://lucky-haze-a46b.yanpogutsa.workers.dev/tashkent-ortho/Ферганское_1.pmtiles",
  "https://lucky-haze-a46b.yanpogutsa.workers.dev/tashkent-ortho/Ферганское_2.pmtiles",
  "https://lucky-haze-a46b.yanpogutsa.workers.dev/tashkent-ortho/Ферганское_3.pmtiles",
  "https://lucky-haze-a46b.yanpogutsa.workers.dev/tashkent-ortho/Ферганское_4.pmtiles",
  "https://lucky-haze-a46b.yanpogutsa.workers.dev/tashkent-ortho/Ферганское_5.pmtiles",
  "https://lucky-haze-a46b.yanpogutsa.workers.dev/tashkent-ortho/Ферганское_6.pmtiles",
  "https://lucky-haze-a46b.yanpogutsa.workers.dev/tashkent-ortho/Ферганское_7.pmtiles",
];
*/
const PMTILES_URLS = [
  "https://storage.yandexcloud.net/ts-tiles/tashkent-ortho/Abdulli Kadiri - Sarikul.pmtiles",
  "https://storage.yandexcloud.net/ts-tiles/tashkent-ortho/Amir Temur - Aytmatov.pmtiles",
  "https://storage.yandexcloud.net/ts-tiles/tashkent-ortho/Aytmatov - Darkhon.pmtiles",
  "https://storage.yandexcloud.net/ts-tiles/tashkent-ortho/Babur - Rustaveli.pmtiles",
  "https://storage.yandexcloud.net/ts-tiles/tashkent-ortho/Beruni - Talabalar.pmtiles",
  "https://storage.yandexcloud.net/ts-tiles/tashkent-ortho/DJI_202603141532_002_tow11-1 Bunedkor-stadion.pmtiles",
  "https://storage.yandexcloud.net/ts-tiles/tashkent-ortho/DJI_202603141532_002_tow11-2 Bunedkor-stadion.pmtiles",
  "https://storage.yandexcloud.net/ts-tiles/tashkent-ortho/DJI_202603151253_029_17 - Donish-MKAD.pmtiles",
  "https://storage.yandexcloud.net/ts-tiles/tashkent-ortho/Darkhon - Mustakillik.pmtiles",
  "https://storage.yandexcloud.net/ts-tiles/tashkent-ortho/Darvoza - Tashkucha.pmtiles",
  "https://storage.yandexcloud.net/ts-tiles/tashkent-ortho/Donish - Iftihor.pmtiles",
  "https://storage.yandexcloud.net/ts-tiles/tashkent-ortho/Iftihor - Amir Temur.pmtiles",
  "https://storage.yandexcloud.net/ts-tiles/tashkent-ortho/Kizil Takzar -Darvoza.pmtiles",
  "https://storage.yandexcloud.net/ts-tiles/tashkent-ortho/Lutfi - Kizil Takzar.pmtiles",
  "https://storage.yandexcloud.net/ts-tiles/tashkent-ortho/Mustakillik - Parkent.pmtiles",
  "https://storage.yandexcloud.net/ts-tiles/tashkent-ortho/Olmazor - Ahmad Donish.pmtiles",
  "https://storage.yandexcloud.net/ts-tiles/tashkent-ortho/Parkent - Abduli Kadiri.pmtiles",
  "https://storage.yandexcloud.net/ts-tiles/tashkent-ortho/Sagban - Olmazor.pmtiles",
  "https://storage.yandexcloud.net/ts-tiles/tashkent-ortho/Sarikul - Babur.pmtiles",
  "https://storage.yandexcloud.net/ts-tiles/tashkent-ortho/Sergeli - Bunedkor.pmtiles",
  "https://storage.yandexcloud.net/ts-tiles/tashkent-ortho/Talabalar - Sagban.pmtiles",
  "https://storage.yandexcloud.net/ts-tiles/tashkent-ortho/Tashkocha - Beruni.pmtiles",
  "https://storage.yandexcloud.net/ts-tiles/tashkent-ortho/Ахмат_Дониш_1.pmtiles",
  "https://storage.yandexcloud.net/ts-tiles/tashkent-ortho/Ахмат_Дониш_2.pmtiles",
  "https://storage.yandexcloud.net/ts-tiles/tashkent-ortho/Ахмат_Дониш_3.pmtiles",
  "https://storage.yandexcloud.net/ts-tiles/tashkent-ortho/Ахмат_Дониш_4.pmtiles",
  "https://storage.yandexcloud.net/ts-tiles/tashkent-ortho/Ислам_Каримов_1.pmtiles",
  "https://storage.yandexcloud.net/ts-tiles/tashkent-ortho/Ислам_Каримов_2.pmtiles",
  "https://storage.yandexcloud.net/ts-tiles/tashkent-ortho/Ислам_Каримов_3.pmtiles",
  "https://storage.yandexcloud.net/ts-tiles/tashkent-ortho/Махтумкули_1.pmtiles",
  "https://storage.yandexcloud.net/ts-tiles/tashkent-ortho/Махтумкули_2.pmtiles",
  "https://storage.yandexcloud.net/ts-tiles/tashkent-ortho/Махтумкули_3.pmtiles",
  "https://storage.yandexcloud.net/ts-tiles/tashkent-ortho/Махтумкули_4.pmtiles",
  "https://storage.yandexcloud.net/ts-tiles/tashkent-ortho/Махтумкули_5.pmtiles",
  "https://storage.yandexcloud.net/ts-tiles/tashkent-ortho/Нукус-1.pmtiles",
  "https://storage.yandexcloud.net/ts-tiles/tashkent-ortho/Нукус-2.pmtiles",
  "https://storage.yandexcloud.net/ts-tiles/tashkent-ortho/Нукус-3.pmtiles",
  "https://storage.yandexcloud.net/ts-tiles/tashkent-ortho/Нурафшон 1.pmtiles",
  "https://storage.yandexcloud.net/ts-tiles/tashkent-ortho/Нурафшон 10.pmtiles",
  "https://storage.yandexcloud.net/ts-tiles/tashkent-ortho/Нурафшон 11.pmtiles",
  "https://storage.yandexcloud.net/ts-tiles/tashkent-ortho/Нурафшон 2.pmtiles",
  "https://storage.yandexcloud.net/ts-tiles/tashkent-ortho/Нурафшон 3.pmtiles",
  "https://storage.yandexcloud.net/ts-tiles/tashkent-ortho/Нурафшон 4.pmtiles",
  "https://storage.yandexcloud.net/ts-tiles/tashkent-ortho/Нурафшон 5.pmtiles",
  "https://storage.yandexcloud.net/ts-tiles/tashkent-ortho/Нурафшон 6.pmtiles",
  "https://storage.yandexcloud.net/ts-tiles/tashkent-ortho/Нурафшон 7.pmtiles",
  "https://storage.yandexcloud.net/ts-tiles/tashkent-ortho/Нурафшон 8.pmtiles",
  "https://storage.yandexcloud.net/ts-tiles/tashkent-ortho/Нурафшон 9.pmtiles",
  "https://storage.yandexcloud.net/ts-tiles/tashkent-ortho/Ферганское_1.pmtiles",
  "https://storage.yandexcloud.net/ts-tiles/tashkent-ortho/Ферганское_2.pmtiles",
  "https://storage.yandexcloud.net/ts-tiles/tashkent-ortho/Ферганское_3.pmtiles",
  "https://storage.yandexcloud.net/ts-tiles/tashkent-ortho/Ферганское_4.pmtiles",
  "https://storage.yandexcloud.net/ts-tiles/tashkent-ortho/Ферганское_5.pmtiles",
  "https://storage.yandexcloud.net/ts-tiles/tashkent-ortho/Ферганское_6.pmtiles",
  "https://storage.yandexcloud.net/ts-tiles/tashkent-ortho/Ферганское_7.pmtiles",
];
const PMTILES_LAYER_IDS = PMTILES_URLS.map((_, i) => `pmtiles-${i}`);

class BaseLayersControl {
  onAdd(map) {
    this._map = map;

    this._container = document.createElement("div");
    this._container.className = "maplibregl-ctrl maplibregl-ctrl-group";

    this._satButton = document.createElement("button");
    this._satButton.type = "button";
    this._satButton.title = "Google спутник";
    this._satButton.setAttribute("aria-label", "Google спутник");
    this._satButton.innerHTML =
      '<i class="fa fa-globe" aria-hidden="true"></i>';
    this._satButton.style.width = "30px";
    this._satButton.style.height = "30px";
    this._satButton.style.fontSize = "16px";

    this._mapButton = document.createElement("button");
    this._mapButton.type = "button";
    this._mapButton.title = "Yandex карта";
    this._mapButton.setAttribute("aria-label", "Yandex карта");
    this._mapButton.innerHTML = '<i class="fa fa-map" aria-hidden="true"></i>'; //"🗺️";
    this._mapButton.style.width = "30px";
    this._mapButton.style.height = "30px";
    this._mapButton.style.fontSize = "16px";

    this._orthoButton = document.createElement("button");
    this._orthoButton.type = "button";
    this._orthoButton.title = "Ортофото";
    this._orthoButton.setAttribute("aria-label", "Ортофото");
    this._orthoButton.innerHTML =
      '<i class="fa fa-plane" aria-hidden="true"></i>';
    this._orthoButton.style.width = "30px";
    this._orthoButton.style.height = "30px";
    this._orthoButton.style.fontSize = "16px";

    this._mirrorsButton = document.createElement("button");
    this._mirrorsButton.type = "button";
    this._mirrorsButton.title = "Зеркала";
    this._mirrorsButton.setAttribute("aria-label", "Зеркала");
    this._mirrorsButton.innerHTML =
      '<i class="fa fa-camera" aria-hidden="true"></i>';
    this._mirrorsButton.style.width = "30px";
    this._mirrorsButton.style.height = "30px";
    this._mirrorsButton.style.fontSize = "16px";

    this._panoramasButton = document.createElement("button");
    this._panoramasButton.type = "button";
    this._panoramasButton.title = "Панорамы";
    this._panoramasButton.setAttribute("aria-label", "Панорамы");
    this._panoramasButton.innerHTML =
      '<i class="fa fa-street-view" aria-hidden="true"></i>';
    this._panoramasButton.style.width = "30px";
    this._panoramasButton.style.height = "30px";
    this._panoramasButton.style.fontSize = "16px";

    this._commentsToggleButton = document.createElement("button");
    this._commentsToggleButton.type = "button";
    this._commentsToggleButton.id = "toggleComments";
    this._commentsToggleButton.title = "Комментарии";
    this._commentsToggleButton.setAttribute("aria-label", "Комментарии");
    this._commentsToggleButton.innerHTML =
      '<i class="fa fa-commenting-o" aria-hidden="true"></i>';
    this._commentsToggleButton.style.width = "30px";
    this._commentsToggleButton.style.height = "30px";
    this._commentsToggleButton.style.fontSize = "16px";

    this._commentsAddButton = document.createElement("button");
    this._commentsAddButton.type = "button";
    this._commentsAddButton.id = "addCommentBtn";
    this._commentsAddButton.title = "Добавить комментарий";
    this._commentsAddButton.setAttribute("aria-label", "Добавить комментарий");
    this._commentsAddButton.innerHTML =
      '<i class="fa fa-plus-square-o" aria-hidden="true"></i>';
    this._commentsAddButton.style.width = "30px";
    this._commentsAddButton.style.height = "30px";
    this._commentsAddButton.style.fontSize = "16px";

    this._commentsDrawButton = document.createElement("button");
    this._commentsDrawButton.type = "button";
    this._commentsDrawButton.id = "drawFreehandBtn";
    this._commentsDrawButton.title = "Рисование";
    this._commentsDrawButton.setAttribute("aria-label", "Рисование");
    this._commentsDrawButton.innerHTML =
      '<i class="fa fa-pencil" aria-hidden="true"></i>';
    this._commentsDrawButton.style.width = "30px";
    this._commentsDrawButton.style.height = "30px";
    this._commentsDrawButton.style.fontSize = "16px";

    this._commentsAddButton.style.display = "none";
    this._commentsDrawButton.style.display = "none";

    const isLayerVisible = (layerId) => {
      if (!this._map.getLayer(layerId)) return false;
      return this._map.getLayoutProperty(layerId, "visibility") === "visible";
    };

    const setLayerVisibility = (layerId, visible) => {
      if (!this._map.getLayer(layerId)) return;
      this._map.setLayoutProperty(
        layerId,
        "visibility",
        visible ? "visible" : "none",
      );
    };

    const anyPmtilesVisible = () => {
      return PMTILES_LAYER_IDS.some((layerId) => isLayerVisible(layerId));
    };

    const setPmtilesVisibility = (visible) => {
      PMTILES_LAYER_IDS.forEach((layerId) => {
        if (!this._map.getLayer(layerId)) return;
        this._map.setLayoutProperty(
          layerId,
          "visibility",
          visible ? "visible" : "none",
        );
      });
    };

    const syncButtons = () => {
      this._satButton.style.backgroundColor = isLayerVisible("sat")
        ? "#22966fa5"
        : "";
      this._mapButton.style.backgroundColor = isLayerVisible("yandex-map")
        ? "#22966fa5"
        : "";
      this._orthoButton.style.backgroundColor = anyPmtilesVisible()
        ? "#22966fa5"
        : "";

      this._mirrorsButton.style.backgroundColor = mirrorsModeEnabled
        ? "#22966fa5"
        : "";

      this._panoramasButton.style.backgroundColor = panoramasModeEnabled
        ? "#22966fa5"
        : "";

      this._commentsToggleButton.style.backgroundColor = document
        .getElementById("toggleComments")
        ?.classList.contains("active")
        ? "#22966fa5"
        : "";

      const commentsEnabled = document
        .getElementById("toggleComments")
        ?.classList.contains("active");

      this._commentsToggleButton.style.backgroundColor = commentsEnabled
        ? "#22966fa5"
        : "";

      this._commentsAddButton.style.display = commentsEnabled ? "" : "none";
      this._commentsDrawButton.style.display = commentsEnabled ? "" : "none";
    };

    this._satButton.addEventListener("click", () => {
      const next = !isLayerVisible("sat");

      // либо включаем sat, либо выключаем всё
      setLayerVisibility("sat", next);
      setLayerVisibility("yandex-map", false);

      syncButtons();
    });

    this._mapButton.addEventListener("click", () => {
      const next = !isLayerVisible("yandex-map");

      // либо включаем yandex-map, либо выключаем всё
      setLayerVisibility("yandex-map", next);
      setLayerVisibility("sat", false);

      syncButtons();
    });

    this._orthoButton.addEventListener("click", () => {
      const next = !anyPmtilesVisible();

      setPmtilesVisibility(next);
      setLayerVisibility("sat", false);
      setLayerVisibility("yandex-map", false);

      syncButtons();
    });

    this._mirrorsButton.addEventListener("click", () => {
      const next = !mirrorsModeEnabled;
      mirrorsModeEnabled = next;

      if (next) {
        setLayerVisibility("sat", false);
        setLayerVisibility("yandex-map", false);

        if (this._map.getZoom() < 16) {
          this._map.easeTo({
            zoom: 16,
            duration: 500,
            essential: true,
          });
        }

        mirrorViewer?.enable?.();
      } else {
        mirrorViewer?.disable?.();
      }

      syncButtons();
    });

    this._panoramasButton.addEventListener("click", () => {
      const next = !panoramasModeEnabled;
      panoramasModeEnabled = next;

      if (next) {
        setLayerVisibility("sat", false);
        setLayerVisibility("yandex-map", false);

        if (this._map.getZoom() < 16) {
          this._map.easeTo({
            zoom: 16,
            duration: 500,
            essential: true,
          });
        }

        panoramaViewer?.enable?.();
      } else {
        panoramaViewer?.disable?.();
      }

      syncButtons();
    });

    this._container.appendChild(this._satButton);
    this._container.appendChild(this._mapButton);
    this._container.appendChild(this._orthoButton);

    if (!isMobile) {
      this._container.appendChild(this._mirrorsButton);
      this._container.appendChild(this._panoramasButton);
    }

    this._container.appendChild(this._commentsToggleButton);
    this._container.appendChild(this._commentsAddButton);
    this._container.appendChild(this._commentsDrawButton);

    this._onIdle = () => syncButtons();
    this._map.on("idle", this._onIdle);

    syncButtons();

    return this._container;
  }

  onRemove() {
    if (this._map && this._onIdle) {
      this._map.off("idle", this._onIdle);
    }

    if (this._container && this._container.parentNode) {
      this._container.parentNode.removeChild(this._container);
    }

    this._map = undefined;
  }
}

map.addControl(new BaseLayersControl(), "top-right");

//let nav = new maplibregl.NavigationControl();
//map.addControl(nav, "top-right");

// ✅ GeolocateControl — уже внутри maplibregl

const geolocate = new maplibregl.GeolocateControl({
  positionOptions: {
    enableHighAccuracy: true,
  },
  trackUserLocation: true,
  showUserHeading: true,
});

map.addControl(geolocate, "top-right");

let scale = new maplibregl.ScaleControl({
  maxWidth: 80,
  unit: "metric",
});
map.addControl(scale);

//https://lucky-haze-a46b.yanpogutsa.workers.dev/tashkent-ortho/Amir%20Temur%20-%20Aytmatov.pmtiles

// add the PMTiles plugin to the maplibregl global.
const protocol = new pmtiles.Protocol();
maplibregl.addProtocol("pmtiles", protocol.tile);

let selectedFeatureId = null;
let activeBorderPopup = null;

let activePopupWidget = null;
let gdalPromise = null;

const DXF_WIDGET_PASSWORD = "1234";
const DXF_PROJ4 = `
+proj=tmerc +lat_0=0 +lon_0=69 +k=1 +x_0=12500000 +y_0=0 +ellps=krass +towgs84=15,-130,-84 +units=m +no_defs
`.trim();

const STORAGE_CONFIG = {
  bucketName: "ts-tiles",
  region: "ru-central1",
  endpoint: "https://storage.yandexcloud.net",
  publicBaseUrl: "https://storage.yandexcloud.net/ts-tiles",
  projectsPrefix: "tashkent-vector/projects",
  indexKey: "tashkent-vector/260403_project_index.json",

  // MVP: временно храним на фронте.
  // Потом вынесешь в function / presigned URLs.
  accessKeyId: "YCAJE2gKkBvJ3PrfV8MR1sx4Q",
  secretAccessKey: "YCOPWqG4jYqd5yVOs9gN7-T07lVtYkfuOpd1KQyU",
};

function ensureGdal() {
  if (!gdalPromise) {
    gdalPromise = initGdalJs({
      path: "./vendor/gdal3",
      useWorker: false,
      env: {
        DXF_ENCODING: "UTF-8",
      },
    });
  }
  return gdalPromise;
}

let bordersGeojson = null;

const streetsPanel = document.getElementById("streets-panel");
const streetsPanelBody = document.getElementById("streets-panel-body");
const streetsPanelToggle = document.getElementById("streets-panel-toggle");
const streetsSearchInput = document.getElementById("streets-search-input");

if (streetsPanelBody) {
  streetsPanelBody.addEventListener("scroll", updateScrollFades);
}

function updateScrollFades() {
  if (!streetsPanelBody) return;

  const { scrollTop, scrollHeight, clientHeight } = streetsPanelBody;

  const isScrollable = scrollHeight - clientHeight > 4;
  const hasTop = isScrollable && scrollTop > 2;
  const hasBottom = isScrollable && scrollTop + clientHeight < scrollHeight - 2;

  streetsPanelBody.classList.toggle("has-top-fade", hasTop);
  streetsPanelBody.classList.toggle("has-bottom-fade", hasBottom);
}

if (streetsPanel && streetsPanelToggle) {
  streetsPanelToggle.addEventListener("click", () => {
    streetsPanel.classList.toggle("is-collapsed");
  });
  if (streetsSearchInput) {
    streetsSearchInput.addEventListener("input", (e) => {
      filterStreetsPanel(e.target.value);
    });
  }
}

map.on("load", async () => {
  map.addControl(deckOverlay);

  const panoIcon = await map.loadImage("./src/icon-pano.png");
  map.addImage("panoIcon", panoIcon.data);

  const shadows = new BuildingShadowsLayer({
    id: "bldg-shadows",
    sourceId: "openmaptiles",
    buildingBucket: "building-3d",
    sunAltitudeDeg: 30,
    sunAzimuthDeg: 360 - 45,
    shadowResolutionScale: isMobile ? 0.5 : 1,
    color: [0, 15, 20],
    opacity: 0.3, //0.3,
  });

  map.addLayer(shadows, "building");

  map.addLayer(
    new SAOLayer({
      id: "sao",
      // ✅ you asked: wire these via attributes
      sourceId: "openmaptiles",
      buildingBucket: "building-3d",

      minzoom: 14,
      maxzoom: 22,

      // output
      saoMode: 1, // 1=blend layer, 0=debug AO
      offscreenScale: isMobile ? 0.5 : 1,
      compositeMode: "multiply", // 'multiply' | 'screen'
      aoTint: [59, 74, 89], // tint for shadows

      // optional: if bn64.png is next to your index.html
      blueNoiseUrl: "./bn64.png",

      // Large scale
      saoLarge: {
        radius: 120.0,
        bias: 0.005,
        range: 1000.0,
        intensityStops: [
          [14, 0.6],
          [16, 2],
          [17, 4],
          [18.5, 12],
          [20, 20],
        ],
      },
      // Small scale
      saoSmall: {
        radius: 20.0,
        bias: 0.1,
        range: 100.0,
        intensityStops: [
          [14, 0.1],
          [16, 0.3],
          [17, 0.5],
          [20, 5],
        ],
      },
    }),
    "water_name_line",
  );

  map.addLayer(
    {
      id: "yandex-map",
      source: {
        type: "raster",
        tiles: [
          "https://core-renderer-tiles.maps.yandex.net/tiles?l=map&x={x}&y={y}&z={z}&scale=2&projection=web_mercator",
        ],
        tileSize: 256,
        scheme: "xyz",
      },
      type: "raster",
      layout: { visibility: "none" },
    },
    "road_label",
  );

  map.addLayer(
    {
      id: "sat",
      source: {
        type: "raster",
        tiles: ["https://mt1.google.com/vt/lyrs=s&x={x}&y={y}&z={z}"],
        tileSize: 128,
        scheme: "xyz",
      },
      type: "raster",
      layout: { visibility: "none" },
    },
    "road_label",
  );
  /*
  initComments(map, {
    name: "Mayline",
    toggleButtonId: "toggleComments",
    addCommentButtonId: "addCommentBtn",
    uploadButtonId: "uploadComments",
    screenOutlineId: "screenOutline",
    panelId: "commentsPanel",
    github: {
      owner: GITHUB_OWNER,
      repo: GITHUB_REPO,
      filepath: "Zharokova.geojson",
      token: GITHUB_TOKEN,
    },
  });
  */

  // добавить все слои
  addPmtilesLayers(PMTILES_URLS);

  map.addSource("tashkent-borders", {
    type: "geojson",
    data: TASHKENT_BORDERS_URL,
  });

  map.addSource("tashkent-other-borders", {
    type: "geojson",
    data: TASHKENT_OTHER_BORDERS_URL,
  });

  map.addSource("tashkent-lines", {
    type: "geojson",
    data: TASHKENT_AXISES_URL,
  });

  map.addLayer({
    id: "tashkent-borders",
    type: "fill",
    source: "tashkent-borders",
    paint: {
      "fill-color": [
        "match",
        ["get", "Etap"],
        "March",
        "#229670",
        "April",
        "#285cd4",
        "May",
        "#d13f7c",
        "#cccccc", // дефолт если что-то другое или null
      ],
      "fill-opacity": [
        "interpolate",
        ["linear"],
        ["zoom"],
        16,
        ["case", ["==", ["get", "Name"], selectedFeatureId], 0.6, 0.3],
        18,
        ["case", ["==", ["get", "Name"], selectedFeatureId], 0.3, 0],
      ],
    },
  });

  map.addLayer({
    id: "tashkent-other-borders",
    type: "fill",
    source: "tashkent-other-borders",
    paint: {
      "fill-color": "#464646",

      "fill-opacity": ["interpolate", ["linear"], ["zoom"], 16, 0.3, 18, 0],
    },
  });

  map.addLayer({
    id: "tashkent-borders-outline",
    type: "line",
    source: "tashkent-borders",
    paint: {
      "line-color": [
        "match",
        ["get", "Etap"],
        "March",
        "#229670",
        "April",
        "#285cd4",
        "May",
        "#d13f7c",
        "#cccccc", // дефолт если что-то другое или null
      ],
      "line-width": 1.5,
    },
  });

  map.addLayer({
    id: "tashkent-labels",
    type: "symbol",
    source: "tashkent-lines",
    layout: {
      "text-field": ["get", "Name"],
      "symbol-placement": "line",
      "symbol-spacing": 500,
      "text-ignore-placement": true,
      "text-allow-overlap": true,
    },

    paint: {
      //"text-color":
      "text-halo-width": 1.5,
      "text-halo-color": "white",
      //"line-width": 1.5,
    },
  });

  /*
  map.addSource("mirrors", {
    type: "geojson",
    data: "/src/mirrors_sample_100.geojson",
  });
  */
  map.addSource("mirrors", {
    type: "vector",
    url: TASHKENT_MIRRORS_URL,
    minzoom: 16,
  });

  map.addLayer({
    id: "mirrors-points",
    type: "circle",
    source: "mirrors",
    "source-layer": "mirrors",
    layout: {
      visibility: "none",
    },
    paint: {
      "circle-radius": 4,
      "circle-color": "#eb4e4b",
      "circle-stroke-color": "#ffffff",
      "circle-stroke-width": 1.5,
    },
  });

  mirrorViewer = setupMirrorViewer(map, {
    pointsLayerId: "mirrors-points",
    workerBaseUrl: "https://mirrors-api.yanpogutsa.workers.dev",
  });

  //const panoramasResp = await fetch(TASHKENT_PANORAMAS_URL);
  //const panoramasGeojson = await panoramasResp.json();

  panoramaViewer = setupPanoramaViewer(map, {
    pointsSourceId: "panoramas",
    pointsLayerId: "panoramas-points",
    pointsData: TASHKENT_PANORAMAS_URL,
    minZoom: 16,
  });

  const bordersResp = await fetch(TASHKENT_BORDERS_URL);
  bordersGeojson = await bordersResp.json();
  projectIndex = await loadProjectIndexSafe();
  buildStreetsPanel(bordersGeojson, projectIndex);

  initComments(map, deckOverlay, {
    name: "tashkent",
    minDrawZoom: 16,
    dom: {
      addCommentButton: document.getElementById("addCommentBtn"),
      drawButton: document.getElementById("drawFreehandBtn"),
    },
    storage: {
      loadAll: async (project) => {
        const res = await fetch(
          `${API_BASE}/comments?project=${encodeURIComponent(project)}`,
        );

        const text = await res.text();

        if (!res.ok) {
          console.error("[loadAll] status:", res.status);
          console.error("[loadAll] body:", text);
          throw new Error(`Load failed: ${res.status} ${text}`);
        }

        try {
          return JSON.parse(text);
        } catch {
          throw new Error(`Load failed: invalid JSON response: ${text}`);
        }
      },

      saveOne: async (project, entity) => {
        const res = await fetch(
          `${API_BASE}/comments?project=${encodeURIComponent(project)}&id=${encodeURIComponent(entity.id)}`,
          {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(entity),
          },
        );

        const text = await res.text();

        if (!res.ok) {
          console.error("[saveOne] status:", res.status);
          console.error("[saveOne] body:", text);
          console.error("[saveOne] entity:", entity);
          throw new Error(`Save failed: ${res.status} ${text}`);
        }

        try {
          return text ? JSON.parse(text) : null;
        } catch {
          return text;
        }
      },

      deleteOne: async (project, id) => {
        const res = await fetch(
          `${API_BASE}/comments/${encodeURIComponent(id)}?project=${encodeURIComponent(project)}`,
          { method: "DELETE" },
        );

        const text = await res.text();

        if (!res.ok) {
          console.error("[deleteOne] status:", res.status);
          console.error("[deleteOne] body:", text);
          throw new Error(`Delete failed: ${res.status} ${text}`);
        }

        try {
          return text ? JSON.parse(text) : null;
        } catch {
          return text;
        }
      },
    },
  });
});

function normalizeSearchValue(value) {
  return String(value || "")
    .trim()
    .toLowerCase();
}

function filterStreetsPanel(query) {
  const q = normalizeSearchValue(query);
  const groups = document.querySelectorAll(".streets-group");
  let hasAnyVisible = false;

  groups.forEach((groupEl) => {
    const items = groupEl.querySelectorAll(".street-item");
    let visibleCount = 0;

    items.forEach((itemEl) => {
      const name = normalizeSearchValue(itemEl.dataset.name);
      const isVisible = !q || name.includes(q);
      itemEl.style.display = isVisible ? "" : "none";
      if (isVisible) visibleCount += 1;
    });

    groupEl.style.display = visibleCount > 0 ? "" : "none";
    if (visibleCount > 0) hasAnyVisible = true;
  });

  let emptyEl = document.getElementById("streets-empty");

  if (!hasAnyVisible) {
    if (!emptyEl) {
      emptyEl = document.createElement("div");
      emptyEl.id = "streets-empty";
      emptyEl.className = "streets-empty";
      emptyEl.textContent = "Ничего не найдено";
      streetsPanelBody.appendChild(emptyEl);
    }
  } else if (emptyEl) {
    emptyEl.remove();
  }
  updateScrollFades();
}

function getFeatureCenter(feature) {
  const center = turf.centerOfMass(feature);
  return center.geometry.coordinates;
}

function getFeatureBounds(feature) {
  const [minX, minY, maxX, maxY] = turf.bbox(feature);
  return [
    [minX, minY],
    [maxX, maxY],
  ];
}

function setActiveStreetItem(name) {
  document.querySelectorAll(".street-item").forEach((el) => {
    el.classList.toggle("is-active", el.dataset.name === name);
  });
}

function buildBorderPopupContent(feature) {
  const props = feature?.properties || {};
  const name = (props.Name || "").trim();
  const link = (props.link || "").trim();

  const root = document.createElement("div");
  root.style.minWidth = "240px";

  const title = document.createElement("div");
  title.style.fontWeight = "600";
  title.style.marginBottom = "8px";
  title.textContent = name || "Без названия";
  root.appendChild(title);

  if (link) {
    const linkEl = document.createElement("a");
    linkEl.href = link;
    linkEl.target = "_blank";
    linkEl.rel = "noopener noreferrer";
    linkEl.style.display = "block";
    linkEl.style.width = "calc(100% - 42px)";
    linkEl.style.padding = "8px 10px";
    linkEl.style.border = "1px solid rgb(204, 204, 204)";
    linkEl.style.borderRadius = "6px";
    linkEl.style.cursor = "pointer";

    linkEl.textContent = "Ссылка на проект";
    root.appendChild(linkEl);
  } else {
    const emptyLink = document.createElement("div");
    emptyLink.style.color = "#999";
    emptyLink.style.display = "block";
    emptyLink.style.width = "calc(100% - 42px)";
    emptyLink.style.padding = "8px 10px";
    emptyLink.style.border = "1px solid rgb(204, 204, 204)";
    emptyLink.style.borderRadius = "6px";
    emptyLink.textContent = "Ссылка на проект";
    root.appendChild(emptyLink);
  }

  const adminWrap = document.createElement("div");
  adminWrap.style.marginTop = "12px";
  adminWrap.style.width = "calc(100% - 20px)";
  adminWrap.style.paddingTop = "10px";
  adminWrap.style.borderTop = "1px solid #e5e5e5";
  root.appendChild(adminWrap);

  const openAuthBtn = document.createElement("button");
  openAuthBtn.type = "button";
  openAuthBtn.textContent = "Загрузить проект на карту";
  openAuthBtn.style.display = "block";
  openAuthBtn.style.width = "100%";
  openAuthBtn.style.padding = "8px 10px";
  openAuthBtn.style.border = "1px solid #ccc";
  openAuthBtn.style.borderRadius = "6px";
  openAuthBtn.style.background = "#fff";
  openAuthBtn.style.cursor = "pointer";
  adminWrap.appendChild(openAuthBtn);

  const authWrap = document.createElement("div");
  authWrap.style.display = "none";
  authWrap.style.marginTop = "10px";
  adminWrap.appendChild(authWrap);

  const passInput = document.createElement("input");
  passInput.type = "password";
  passInput.placeholder = "Пароль";
  passInput.style.boxSizing = "border-box";
  passInput.style.width = "100%";
  passInput.style.padding = "8px";
  passInput.style.marginBottom = "8px";
  passInput.style.border = "1px solid #ccc";
  passInput.style.borderRadius = "6px";

  const authBtn = document.createElement("button");
  authBtn.type = "button";
  authBtn.textContent = "Открыть";
  authBtn.style.display = "block";
  authBtn.style.width = "100%";
  authBtn.style.padding = "8px 10px";
  authBtn.style.border = "1px solid #ccc";
  authBtn.style.borderRadius = "6px";
  authBtn.style.background = "#fff";
  authBtn.style.cursor = "pointer";

  const authError = document.createElement("div");
  authError.style.display = "none";
  authError.style.marginTop = "6px";
  authError.style.fontSize = "12px";
  authError.style.color = "#c62828";
  authError.textContent = "Неверный пароль";

  authWrap.appendChild(passInput);
  authWrap.appendChild(authBtn);
  authWrap.appendChild(authError);

  const widgetHost = document.createElement("div");
  widgetHost.style.display = "none";
  widgetHost.style.width = "calc(100% - 20px)";
  widgetHost.style.marginTop = "12px";
  root.appendChild(widgetHost);

  openAuthBtn.addEventListener("click", () => {
    authWrap.style.display =
      authWrap.style.display === "none" ? "block" : "none";
    if (authWrap.style.display === "block") {
      setTimeout(() => passInput.focus(), 0);
    }
  });

  async function openWidget() {
    const pass = passInput.value.trim();

    if (pass !== DXF_WIDGET_PASSWORD) {
      authError.style.display = "block";
      return;
    }

    authError.style.display = "none";
    authWrap.style.display = "none";
    openAuthBtn.style.display = "none";
    widgetHost.style.display = "block";

    if (activePopupWidget) {
      activePopupWidget.destroy();
      activePopupWidget = null;
    }

    widgetHost.innerHTML = `<div style="font-size:12px;color:#666;">Инициализация GDAL...</div>`;

    try {
      const Gdal = await ensureGdal();
      widgetHost.innerHTML = "";

      activePopupWidget = createDxfExportWidget({
        container: widgetHost,
        Gdal,
        proj4: DXF_PROJ4,
        featureName: name,
        storage: STORAGE_CONFIG,
      });
    } catch (err) {
      console.error(err);
      widgetHost.innerHTML = `
        <div style="color:#c62828; font-size:12px;">
          Ошибка инициализации GDAL: ${escapeHtml(err?.message || String(err))}
        </div>
      `;
    }
  }

  authBtn.addEventListener("click", openWidget);

  passInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      openWidget();
    }
  });

  return root;
}

function selectBorderFeature(feature, opts = {}) {
  if (!feature) return;

  const { flyToFeature = false } = opts;
  const props = feature.properties || {};

  if (activeBorderPopup) {
    activeBorderPopup.remove();
    activeBorderPopup = null;
  }

  if (activePopupWidget) {
    activePopupWidget.destroy();
    activePopupWidget = null;
  }

  selectedFeatureId = props.Name || null;
  updateBordersStyle();
  setActiveStreetItem(selectedFeatureId);

  if (flyToFeature) {
    map.fitBounds(getFeatureBounds(feature), {
      padding: {
        top: 60,
        right: 60,
        bottom: 60,
        left: isMobile ? 60 : 380,
      },
      duration: 700,
      maxZoom: 16.5,
    });
  }

  const center = getFeatureCenter(feature);

  const popupContent = buildBorderPopupContent(feature);

  activeBorderPopup = new maplibregl.Popup({
    closeButton: true,
    closeOnClick: true,
  })
    .setLngLat(center)
    .setDOMContent(popupContent)
    .addTo(map);

  activeBorderPopup.on("close", () => {
    if (activePopupWidget) {
      activePopupWidget.destroy();
      activePopupWidget = null;
    }
    activeBorderPopup = null;
    clearBorderSelection();
  });
}

function selectOtherBorderFeature(feature) {
  if (!feature) return;

  const props = feature.properties || {};

  if (activeBorderPopup) {
    activeBorderPopup.remove();
    activeBorderPopup = null;
  }

  clearBorderSelection();

  const name = (props.Name || "").trim();
  const center = getFeatureCenter(feature);

  activeBorderPopup = new maplibregl.Popup({
    closeButton: true,
    closeOnClick: true,
  })
    .setLngLat(center)
    .setHTML(
      `
      <div style="min-width:180px;">
        <div style="font-weight:600;">
          ${escapeHtml(name || "Без названия")}
        </div>
      </div>
    `,
    )
    .addTo(map);

  activeBorderPopup.on("close", () => {
    activeBorderPopup = null;
    clearBorderSelection();
  });
}

function etapOrderValue(etap) {
  if (etap === "March") return 1;
  if (etap === "April") return 2;
  if (etap === "May") return 3;
  return 999;
}

function etapLabel(etap) {
  if (etap === "March") return "Март";
  if (etap === "April") return "Апрель";
  if (etap === "May") return "Май";
  return etap || "Без этапа";
}

function normalizeProjectId(name) {
  return (
    String(name || "")
      .trim()
      .toLowerCase()
      .replace(/[^\p{L}\p{N}._-]+/gu, "_")
      .replace(/^_+|_+$/g, "") || "unnamed"
  );
}

async function loadProjectIndexSafe() {
  try {
    const resp = await fetch(TASHKENT_PROJECT_INDEX_URL, { cache: "no-store" });
    if (resp.status === 404) {
      return { schemaVersion: 1, updatedAt: null, items: {} };
    }
    if (!resp.ok) {
      throw new Error(`project_index HTTP ${resp.status}`);
    }
    const json = await resp.json();
    return {
      schemaVersion: 1,
      updatedAt: json?.updatedAt || null,
      items: json?.items && typeof json.items === "object" ? json.items : {},
    };
  } catch (err) {
    console.error("[project-index]", err);
    return { schemaVersion: 1, updatedAt: null, items: {} };
  }
}

function getStreetProjectMeta(streetName) {
  return projectIndex?.items?.[streetName] || null;
}

function ensureStreetProjectState(streetName) {
  if (!streetProjectState.has(streetName)) {
    streetProjectState.set(streetName, {
      loaded: false,
      visible: false,
      projectId: normalizeProjectId(streetName),
    });
  }
  return streetProjectState.get(streetName);
}

async function ensureStreetProjectLoaded(streetName) {
  const meta = getStreetProjectMeta(streetName);
  if (!meta?.sidecarUrl) return null;

  const state = ensureStreetProjectState(streetName);
  if (state.loaded) return state;

  const projectId = state.projectId;

  projectsManager.addProject(
    projectId,
    streetName,
    [
      {
        name: "Транспортная схема",
        url: meta.sidecarUrl,
        minZoom: 14,
        maxZoom: 17,
      },
    ],
    {
      createButton: false,
      initiallyVisible: true,
    },
  );

  state.loaded = true;
  state.visible = true;
  return state;
}

async function toggleStreetProject(streetName) {
  const meta = getStreetProjectMeta(streetName);
  if (!meta) return false;

  const state = ensureStreetProjectState(streetName);

  if (!state.loaded) {
    await ensureStreetProjectLoaded(streetName);
    return true;
  }

  state.visible = !state.visible;
  projectsManager.toggleProjectVisibility(state.projectId, state.visible);
  return state.visible;
}

function getStreetProjectVisible(streetName) {
  const state = streetProjectState.get(streetName);
  return !!state?.visible;
}

function buildStreetsPanel(featureCollection, projectIndexArg = null) {
  if (!streetsPanelBody || !featureCollection?.features) return;

  const groups = new Map();

  for (const feature of featureCollection.features) {
    const props = feature.properties || {};
    const etap = props.Etap || "Unknown";

    if (!groups.has(etap)) groups.set(etap, []);
    groups.get(etap).push(feature);
  }

  const sortedEtaps = [...groups.keys()].sort(
    (a, b) => etapOrderValue(a) - etapOrderValue(b),
  );

  streetsPanelBody.innerHTML = "";

  for (const etap of sortedEtaps) {
    const features = groups
      .get(etap)
      .slice()
      .sort((a, b) => {
        const aNum = Number(a.properties?.Number ?? 999999);
        const bNum = Number(b.properties?.Number ?? 999999);
        return aNum - bNum;
      });

    const groupEl = document.createElement("section");
    groupEl.className = "streets-group";
    groupEl.dataset.etap = etap;

    const titleEl = document.createElement("div");
    titleEl.className = "streets-group__title";
    titleEl.textContent = etapLabel(etap);

    const listEl = document.createElement("div");
    listEl.className = "streets-list";

    for (const feature of features) {
      const props = feature.properties || {};
      const itemEl = document.createElement("button");
      itemEl.type = "button";
      itemEl.className = "street-item";
      itemEl.dataset.name = props.Name || "";

      const number = props.Number ?? "";
      const name = props.Name || "Без названия";

      // <span class="street-item__number">${escapeHtml(String(number))}</span>

      const hasProject = !!projectIndexArg?.items?.[name];
      const isVisible = getStreetProjectVisible(name);

      itemEl.innerHTML = `
        <span class="street-item__label">${escapeHtml(name)}</span>
        ${
          hasProject
            ? `<button
                 type="button"
                 class="street-project-toggle"
                 data-project-name="${escapeAttr(name)}"
                 title="${isVisible ? "Скрыть проект" : "Показать проект"}"
               >
                 <i class="fa ${isVisible ? "fa-eye" : "fa-eye-slash"}" aria-hidden="true"></i>
               </button>`
            : ``
        }
      `;

      itemEl.addEventListener("click", () => {
        selectBorderFeature(feature, { flyToFeature: true });
      });

      const toggleBtn = itemEl.querySelector(".street-project-toggle");
      if (toggleBtn) {
        toggleBtn.addEventListener("click", async (e) => {
          e.preventDefault();
          e.stopPropagation();

          toggleBtn.disabled = true;
          try {
            const visible = await toggleStreetProject(name);
            const icon = toggleBtn.querySelector("i");
            if (icon) {
              icon.className = `fa ${visible ? "fa-eye" : "fa-eye-slash"}`;
            }
            toggleBtn.title = visible ? "Скрыть проект" : "Показать проект";
          } catch (err) {
            console.error("[street-project-toggle]", err);
          } finally {
            toggleBtn.disabled = false;
          }
        });
      }

      listEl.appendChild(itemEl);
    }

    groupEl.appendChild(titleEl);
    groupEl.appendChild(listEl);
    streetsPanelBody.appendChild(groupEl);
  }

  filterStreetsPanel(streetsSearchInput?.value || "");
  setTimeout(updateScrollFades, 0);
}

map.on("click", "tashkent-borders", (e) => {
  if (ruler.isEnabled?.() || mirrorsModeEnabled || panoramasModeEnabled)
    if (window.__commentsBlockingMapInteractions) return;
  return;

  const feature = e.features?.[0];
  if (!feature) return;

  selectBorderFeature(feature, { flyToFeature: false });
});

map.on("click", "tashkent-other-borders", (e) => {
  if (ruler.isEnabled?.() || mirrorsModeEnabled || panoramasModeEnabled)
    if (window.__commentsBlockingMapInteractions) return;
  return;

  const topFeature = map.queryRenderedFeatures(e.point, {
    layers: ["tashkent-borders", "tashkent-other-borders"],
  })[0];

  if (!topFeature || topFeature.layer.id !== "tashkent-other-borders") return;

  const feature = e.features?.[0];
  if (!feature) return;

  selectOtherBorderFeature(feature);
});

map.on("click", (e) => {
  if (ruler.isEnabled?.() || mirrorsModeEnabled || panoramasModeEnabled) return;
  if (window.__commentsBlockingMapInteractions) return;

  const features = map.queryRenderedFeatures(e.point, {
    layers: ["tashkent-borders", "tashkent-other-borders"],
  });

  if (features.length) return;

  if (activeBorderPopup) {
    activeBorderPopup.remove();
    activeBorderPopup = null;
  } else {
    clearBorderSelection();
  }
});

function updateBordersStyle() {
  map.setPaintProperty("tashkent-borders", "fill-opacity", [
    "interpolate",
    ["linear"],
    ["zoom"],
    16,
    ["case", ["==", ["get", "Name"], selectedFeatureId], 0.6, 0.3],
    18,
    ["case", ["==", ["get", "Name"], selectedFeatureId], 0.3, 0],
  ]);
}

function clearBorderSelection() {
  selectedFeatureId = null;
  updateBordersStyle();
  setActiveStreetItem(null);
}

map.on("mouseenter", "tashkent-borders", () => {
  if (ruler.isEnabled?.() || mirrorsModeEnabled || panoramasModeEnabled) return;
  map.getCanvas().style.cursor = "pointer";
});

map.on("mouseleave", "tashkent-borders", () => {
  if (ruler.isEnabled?.() || mirrorsModeEnabled || panoramasModeEnabled) return;
  map.getCanvas().style.cursor = "";
});

map.on("mouseenter", "tashkent-other-borders", () => {
  if (ruler.isEnabled?.() || mirrorsModeEnabled || panoramasModeEnabled) return;
  map.getCanvas().style.cursor = "pointer";
});

map.on("mouseleave", "tashkent-other-borders", () => {
  if (ruler.isEnabled?.() || mirrorsModeEnabled || panoramasModeEnabled) return;
  map.getCanvas().style.cursor = "";
});

function escapeHtml(str) {
  return String(str).replace(/[&<>"']/g, (m) => {
    const map = {
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#39;",
    };
    return map[m];
  });
}

function escapeAttr(str) {
  return String(str).replace(/"/g, "&quot;");
}

function addPmtilesLayers(urls) {
  urls.forEach((url, i) => addPmtilesLayer(url, i));
}

async function addPmtilesLayer(url, index = 0) {
  const id = "pmtiles-" + index;

  map.addSource(id, {
    type: "raster",
    url: "pmtiles://" + url,
    tileSize: 256,
    minzoom: 14,
  });

  map.addLayer(
    {
      id: id,
      type: "raster",
      source: id,
      layout: {
        visibility: "none",
      },
      paint: {
        "raster-opacity": ["interpolate", ["linear"], ["zoom"], 14, 0, 14.5, 1],
      },
    },
    "road_label",
  );
}

// доступ из консоли
window.addPmtilesLayers = addPmtilesLayers;
