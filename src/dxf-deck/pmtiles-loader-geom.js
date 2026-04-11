// pmtiles-loader-geom.js
import {
  PMTiles,
  FileSource,
} from "https://unpkg.com/pmtiles@3.1.0/dist/index.js";
import Pbf from "https://esm.sh/pbf@3.3.0?bundle";
import { VectorTile } from "https://esm.sh/@mapbox/vector-tile@2.0.3?bundle";

/**
 * Creates PMTiles source + tile decoder (MVT -> {paths, polygons, points, clipBounds})
 */
export function createPmtilesLoaderGeom({ id = "dxf", onLog } = {}) {
  let pm = null;
  let lastBlobUrl = null;
  let sidecarByHandle = null;

  const log = (m) => onLog?.(m);

  function dispose() {
    if (lastBlobUrl) {
      try {
        URL.revokeObjectURL(lastBlobUrl);
      } catch {}
      lastBlobUrl = null;
    }
    pm = null;
  }

  function setFromBytes(pmtilesBytes) {
    dispose();

    const file = new File([pmtilesBytes], `${id}.pmtiles`, {
      type: "application/octet-stream",
    });
    pm = new PMTiles(new FileSource(file));
    log?.(`PMTiles loaded from bytes: ${pmtilesBytes.byteLength} bytes`);
  }

  function setFromUrl(url) {
    dispose();
    pm = new PMTiles(url); // remote HTTP range reader
    log?.(`PMTiles loaded from URL: ${url}`);
  }

  // Optional: attach sidecar widths (handle -> width)
  function setSidecarWidthMap(map) {
    sidecarByHandle = map || null;
    log?.(
      sidecarByHandle
        ? `Sidecar map set: ${sidecarByHandle.size ?? "?"} entries`
        : `Sidecar width map cleared`,
    );
  }

  async function getTileData({ index, signal }) {
    if (!pm) throw new Error("PMTiles not set");
    if (!index) return null;

    const { x, y, z } = index;
    const clipBounds = tileBoundsLngLat(x, y, z);

    const rr = await pm.getZxy(z, x, y, signal);
    if (!rr?.data) return null;

    const vt = new VectorTile(new Pbf(rr.data));

    const paths = [];
    const polygons = [];
    const points = [];

    for (const layerName of Object.keys(vt.layers || {})) {
      const layer = vt.layers[layerName];

      for (let i = 0; i < layer.length; i++) {
        const f = layer.feature(i);
        const gj = f.toGeoJSON(x, y, z);
        if (!gj?.geometry) continue;

        const props = gj.properties || {};

        // Enrich: width from DXF sidecar by EntityHandle
        if (sidecarByHandle) {
          const h = props.EntityHandle;

          if (h != null) {
            const rec = sidecarByHandle.get(String(h));
            if (rec?.w != null) props.__width = rec.w;
            // HATCH extras (optional)
            if (rec?.ht != null && Number.isFinite(rec.ht)) {
              // DXF transparency (group 440): 0x020000TT
              // TT: 0 = fully transparent, 255 = opaque :contentReference[oaicite:1]{index=1}
              const raw = rec.ht >>> 0;
              const tt = raw & 0xff; // TT byte
              const opacity = tt / 255; // 0..1 (0=transparent, 1=opaque)

              props.__hatchOpacity = Math.max(
                0,
                Math.min(1, opacity.toFixed(2)),
              );
              // If you ever need transparency instead:
              // props.__hatchTransparency = 1 - props.__hatchOpacity;
            }
            if (rec?.hp != null) props.__hatchPattern = rec.hp;
            if (rec?.ha != null) props.__hatchAngle = rec.ha.toFixed(2);
            if (rec?.hs != null) props.__hatchScale = rec.hs.toFixed(4);
          }
        }
        const featureId = f.id ?? props.id ?? null;
        const geomType = gj.geometry.type;

        const meta = { properties: props, layerName, featureId, geomType };

        if (geomType === "LineString") {
          const c = gj.geometry.coordinates;
          if (Array.isArray(c) && c.length >= 2) {
            paths.push({ path: c, ...meta });
          }
        } else if (geomType === "MultiLineString") {
          for (const line of gj.geometry.coordinates || []) {
            if (Array.isArray(line) && line.length >= 2) {
              paths.push({ path: line, ...meta });
            }
          }
        } else if (geomType === "Polygon") {
          const fixed = fixPolygonCoords(gj.geometry.coordinates);
          if (fixed) polygons.push({ polygon: fixed, ...meta });
        } else if (geomType === "MultiPolygon") {
          const fixed = fixMultiPolygonCoords(gj.geometry.coordinates);
          if (fixed) {
            for (const poly of fixed) polygons.push({ polygon: poly, ...meta });
          }
        } else if (geomType === "Point") {
          const c = gj.geometry.coordinates;
          if (isFinitePos(c)) points.push({ position: c, ...meta });
        } else if (geomType === "MultiPoint") {
          for (const c of gj.geometry.coordinates || []) {
            if (isFinitePos(c)) points.push({ position: c, ...meta });
          }
        }
      }
    }

    return { paths, polygons, points, clipBounds };
  }

  //return { setFromBytes, setFromUrl, getTileData, dispose };
  return { setFromBytes, setFromUrl, setSidecarWidthMap, getTileData, dispose };
}

// ---------------- geometry helpers ----------------

function isFinitePos(p) {
  return (
    Array.isArray(p) &&
    p.length >= 2 &&
    Number.isFinite(p[0]) &&
    Number.isFinite(p[1])
  );
}

function closeRing(ring) {
  if (ring.length < 2) return ring;
  const a = ring[0];
  const b = ring[ring.length - 1];
  if (a[0] !== b[0] || a[1] !== b[1]) ring = ring.concat([[a[0], a[1]]]);
  return ring;
}

function fixPolygonCoords(coords) {
  if (!Array.isArray(coords)) return null;
  const rings = [];
  for (let ring of coords) {
    if (!Array.isArray(ring)) continue;
    ring = ring.filter(isFinitePos);
    ring = closeRing(ring);
    if (ring.length < 4) continue;
    rings.push(ring);
  }
  return rings.length ? rings : null;
}

function fixMultiPolygonCoords(coords) {
  if (!Array.isArray(coords)) return null;
  const polys = [];
  for (const poly of coords) {
    const rings = fixPolygonCoords(poly);
    if (rings) polys.push(rings);
  }
  return polys.length ? polys : null;
}

// ---------------- tile bounds ----------------

function tileBoundsLngLat(x, y, z) {
  const n = 2 ** z;
  const west = (x / n) * 360 - 180;
  const east = ((x + 1) / n) * 360 - 180;

  const lat = (yy) => {
    const t = Math.PI * (1 - (2 * yy) / n);
    return (180 / Math.PI) * Math.atan(Math.sinh(t));
  };

  const north = lat(y);
  const south = lat(y + 1);

  return [west, south, east, north]; // [minLng, minLat, maxLng, maxLat]
}
