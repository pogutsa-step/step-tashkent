// yandex3395-protocol.js
// MapLibre addProtocol: returns a 3857 tile assembled from Yandex tiles,
// where Yandex tiles are addressed in EPSG:3395-like grid.
// Key fix: compute Y mapping via proj4(4326->3395) and normalize using WORLD_HALF
// exactly like typical tile formulas.

const R = 6378137;
const MAX_LAT = 85.0511287798066;
const DEG2RAD = Math.PI / 180;

// Important: in many tile grids the world extent is still the *spherical* WebMercator half-world,
// even if underlying projection formula differs. Your mosaic code uses this constant.
const WORLD_HALF = 20037508.342789244;

// Define EPSG:3395 explicitly (ellipsoidal Mercator on WGS84)
proj4.defs(
  "EPSG:3395",
  "+proj=merc +lon_0=0 +k=1 +x_0=0 +y_0=0 +a=6378137 +b=6356752.314245179 +units=m +no_defs"
);

// WebMercator inverse: get latitude for global pixel Y at zoom z
function latFromWebMercatorGlobalY(pxY, z) {
  const size = 256 * (1 << z);
  const y = 0.5 - pxY / size;
  const lat = 90 - (360 * Math.atan(Math.exp(-y * 2 * Math.PI))) / Math.PI;
  return Math.max(-MAX_LAT, Math.min(MAX_LAT, lat));
}

// Convert latitude to EPSG:3395 Y meters using proj4 (lon doesn't matter for Y; set lon=0)
function yMeters3395FromLat(latDeg) {
  const p = proj4("EPSG:4326", "EPSG:3395", [0, latDeg]);
  return p[1];
}

// Normalize EPSG:3395 meters to *global pixel Y* on a WORLD_HALF-based tile grid (like your mosaic)
function globalPxY3395FromLat(latDeg, z) {
  const size = 256 * (1 << z);
  const yMeters = yMeters3395FromLat(latDeg);
  return ((WORLD_HALF - yMeters) / (2 * WORLD_HALF)) * size;
}

function yandexUrl(template, z, x, y) {
  return template
    .replace("{z}", String(z))
    .replace("{x}", String(x))
    .replace("{y}", String(y));
}

async function fetchBitmap(url, abortSignal) {
  const res = await fetch(url, { signal: abortSignal, mode: "cors" });
  if (!res.ok) throw new Error(`Tile fetch failed ${res.status}: ${url}`);
  const blob = await res.blob();
  return await createImageBitmap(blob);
}

function createLRU(maxEntries = 300) {
  const map = new Map();
  return {
    get(k) {
      const v = map.get(k);
      if (!v) return null;
      map.delete(k);
      map.set(k, v);
      return v;
    },
    set(k, v) {
      if (map.has(k)) map.delete(k);
      map.set(k, v);
      while (map.size > maxEntries) {
        const oldestKey = map.keys().next().value;
        const oldest = map.get(oldestKey);
        map.delete(oldestKey);
        try {
          oldest?.close?.(); // ImageBitmap
        } catch {}
      }
    },
  };
}

/**
 * Register protocol yandex3395://z/x/y that returns a *3857* raster tile as PNG.
 *
 * @param {object} opts
 * @param {string} opts.yandexTemplate - URL template with {z}{x}{y}
 * @param {number} [opts.cacheSize] - LRU entries
 */
export function installYandex3395Protocol(maplibregl, opts) {
  const { yandexTemplate, cacheSize = 400 } = opts;

  const outCache = createLRU(cacheSize); // final 3857 PNG ArrayBuffers
  const srcCache = createLRU(cacheSize * 2); // ImageBitmaps of Yandex tiles

  maplibregl.addProtocol("yandex3395", async (params, abortController) => {
    // MapLibre may append extension or query; accept both
    const m = params.url.match(
      /^yandex3395:\/\/(\d+)\/(\d+)\/(\d+)(?:\.\w+)?(?:\?.*)?$/
    );
    if (!m) throw new Error("Bad protocol url: " + params.url);

    const z = +m[1],
      x = +m[2],
      y = +m[3];

    const outKey = `${z}/${x}/${y}`;
    const cached = outCache.get(outKey);
    if (cached) return { data: cached };

    // Determine which Yandex Y-tiles we need (usually 1..2)
    let minSrcY = Infinity,
      maxSrcY = -Infinity;

    // Scan 256 output rows: compute where they land in Yandex(3395) global pixels
    for (let r = 0; r < 256; r++) {
      const lat = latFromWebMercatorGlobalY(y * 256 + (r + 0.5), z);
      const srcY = globalPxY3395FromLat(lat, z);
      if (srcY < minSrcY) minSrcY = srcY;
      if (srcY > maxSrcY) maxSrcY = srcY;
    }

    const yMinTile = Math.floor(minSrcY / 256);
    const yMaxTile = Math.floor(maxSrcY / 256);
    const tileCountY = yMaxTile - yMinTile + 1;

    // Fetch needed source tiles
    const bitmaps = [];
    for (let ty = yMinTile; ty <= yMaxTile; ty++) {
      const srcKey = `${z}/${x}/${ty}`;
      let bmp = srcCache.get(srcKey);
      if (!bmp) {
        const url = yandexUrl(yandexTemplate, z, x, ty);
        bmp = await fetchBitmap(url, abortController.signal);
        srcCache.set(srcKey, bmp);
      }
      bitmaps.push(bmp);
    }

    // Compose vertical mosaic of the Yandex tiles we fetched
    const mosaic = new OffscreenCanvas(256, 256 * tileCountY);
    const mctx = mosaic.getContext("2d", { alpha: true });
    for (let i = 0; i < bitmaps.length; i++) {
      mctx.drawImage(bitmaps[i], 0, i * 256);
    }

    // Resample into output 256x256 by rows
    const out = new OffscreenCanvas(256, 256);
    const octx = out.getContext("2d", { alpha: true });
    octx.imageSmoothingEnabled = true;

    for (let r = 0; r < 256; r++) {
      const lat = latFromWebMercatorGlobalY(y * 256 + (r + 0.5), z);
      const srcGlobalY = globalPxY3395FromLat(lat, z);
      const srcLocalY = srcGlobalY - yMinTile * 256;

      // fractional sampling is fine
      const sy = Math.max(0, Math.min(mosaic.height - 1, srcLocalY));
      octx.drawImage(mosaic, 0, sy, 256, 1, 0, r, 256, 1);
    }

    // Encode as PNG and cache
    const blob = await out.convertToBlob({ type: "image/png" });
    const buf = await blob.arrayBuffer();
    outCache.set(outKey, buf);

    return { data: buf };
  });
}
