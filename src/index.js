import { SAOLayer } from "./sao-layer-fxaa.optim-render.din-res.js";
import { BuildingShadowsLayer } from "./shadows.dev.js";
import { setupTwoFingerRuler } from "./maplibre-ruler.js";
import { setupMirrorViewer } from "./mirror-viewer.js";
import { installYandex3395Protocol } from "./yandex3395-protocol.js";

const isMobile =
  /Android|iPhone|iPad|iPod/i.test(navigator.userAgent) ||
  window.innerWidth < 900;

// --- main -------------------------------------------------------------------

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

    this._container.appendChild(this._satButton);
    this._container.appendChild(this._mapButton);
    this._container.appendChild(this._orthoButton);
    if (!isMobile) {
      this._container.appendChild(this._mirrorsButton);
    }

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

let nav = new maplibregl.NavigationControl();
map.addControl(nav, "top-right");

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

const TASHKENT_BORDERS_URL =
  //"https://lucky-haze-a46b.yanpogutsa.workers.dev/tashkent_vector/260403_borders.geojson";
  "https://storage.yandexcloud.net/ts-tiles/tashkent-vector/260403_borders.geojson";

const TASHKENT_OTHER_BORDERS_URL =
  //"https://lucky-haze-a46b.yanpogutsa.workers.dev/tashkent_vector/260403_other_streets.geojson";
  "https://storage.yandexcloud.net/ts-tiles/tashkent-vector/260403_other_streets.geojson";
const TASHKENT_AXISES_URL =
  //"https://lucky-haze-a46b.yanpogutsa.workers.dev/tashkent_vector/260331_axises.geojson",
  "https://storage.yandexcloud.net/ts-tiles/tashkent_vector/260331_axises.geojson";

const TASHKENT_MIRRORS_URL =
  //"pmtiles://https://lucky-haze-a46b.yanpogutsa.workers.dev/tashkent_vector/260403_tashkent_mirrors.pmtiles";
  "pmtiles://https://storage.yandexcloud.net/ts-tiles/tashkent_vector/260403_tashkent_mirrors.pmtiles";
map.on("load", async () => {
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

      "fill-opacity": 0.3,
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

  const bordersResp = await fetch(TASHKENT_BORDERS_URL);
  bordersGeojson = await bordersResp.json();
  buildStreetsPanel(bordersGeojson);
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

function selectBorderFeature(feature, opts = {}) {
  if (!feature) return;

  const { flyToFeature = false } = opts;
  const props = feature.properties || {};

  if (activeBorderPopup) {
    activeBorderPopup.remove();
    activeBorderPopup = null;
  }

  selectedFeatureId = props.Name || null;
  updateBordersStyle();
  setActiveStreetItem(selectedFeatureId);

  const name = (props.Name || "").trim();
  const link = (props.link || "").trim();

  const html = `
    <div style="min-width:220px;">
      <div style="font-weight:600; margin-bottom:8px;">
        ${escapeHtml(name || "Без названия")}
      </div>
      ${
        link
          ? `<a
               href="${escapeAttr(link)}"
               target="_blank"
               rel="noopener noreferrer"
               style="color:#1a73e8; text-decoration:underline;"
             >ссылка на проект</a>`
          : `<div style="color:#999;">ссылка на проект</div>`
      }
    </div>
  `;

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

  activeBorderPopup = new maplibregl.Popup({
    closeButton: true,
    closeOnClick: true,
  })
    .setLngLat(center)
    .setHTML(html)
    .addTo(map);

  activeBorderPopup.on("close", () => {
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

function buildStreetsPanel(featureCollection) {
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

      itemEl.innerHTML = `
        <span>${escapeHtml(name)}</span>
      `;

      itemEl.addEventListener("click", () => {
        selectBorderFeature(feature, { flyToFeature: true });
      });

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
  if (ruler.isEnabled?.() || mirrorsModeEnabled) return;

  const feature = e.features?.[0];
  if (!feature) return;

  selectBorderFeature(feature, { flyToFeature: false });
});

map.on("click", "tashkent-other-borders", (e) => {
  if (ruler.isEnabled?.() || mirrorsModeEnabled) return;

  const topFeature = map.queryRenderedFeatures(e.point, {
    layers: ["tashkent-borders", "tashkent-other-borders"],
  })[0];

  if (!topFeature || topFeature.layer.id !== "tashkent-other-borders") return;

  const feature = e.features?.[0];
  if (!feature) return;

  selectOtherBorderFeature(feature);
});

map.on("click", (e) => {
  if (ruler.isEnabled?.() || mirrorsModeEnabled) return;

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
  if (ruler.isEnabled?.() || mirrorsModeEnabled) return;
  map.getCanvas().style.cursor = "pointer";
});

map.on("mouseleave", "tashkent-borders", () => {
  if (ruler.isEnabled?.() || mirrorsModeEnabled) return;
  map.getCanvas().style.cursor = "";
});

map.on("mouseenter", "tashkent-other-borders", () => {
  if (ruler.isEnabled?.() || mirrorsModeEnabled) return;
  map.getCanvas().style.cursor = "pointer";
});

map.on("mouseleave", "tashkent-other-borders", () => {
  if (ruler.isEnabled?.() || mirrorsModeEnabled) return;
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
