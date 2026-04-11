// dxf-pmtiles.js
// super-lite: File(DXF) -> PMTiles bytes (через GDAL wasm) + helper для deck

// 1) DXF(File) -> PMTiles bytes

export async function dxfFileToPmtilesBytes({
  Gdal,
  file,
  s_srs,
  simplify = 0.02,
  minzoom = 12,
  maxzoom = 17,
  name = "dxf",
  onLog,
} = {}) {
  if (!Gdal) throw new Error("Gdal is required");
  if (!file) throw new Error("file is required");
  if (!s_srs) throw new Error("s_srs is required");

  const log = (m) => onLog?.(m);

  const { datasets } = await Gdal.open(file);
  const ds = datasets?.[0];
  if (!ds) throw new Error("GDAL: cannot open dataset from file");

  log?.("Слои: " + (ds.info?.layers || []).map((l) => l.name).join(", "));

  const DX = 12500180.7145;
  const DY = 4500726.2092;

  const sql = `
    SELECT
      ST_Translate(geometry, ${DX}, ${DY}, 0) AS geometry,
      Layer,
      PaperSpace,
      SubClasses,
      Linetype,
      EntityHandle,
      Text,
      OGR_STYLE
    FROM entities
    WHERE Layer <> 'Defpoints'
  `;

  const outPath = await Gdal.ogr2ogr(ds, [
    "-skipfailures",
    "-explodecollections",

    "--config",
    "DXF_ENCODING",
    "UTF-8",

    "--config",
    "DXF_FEATURE_LIMIT_PER_BLOCK",
    "-1",

    "-oo",
    "INCLUDE_RAW_CODE_VALUES=YES",

    "-s_srs",
    s_srs,

    "-t_srs",
    "EPSG:3857",

    "-dialect",
    "SQLITE",

    "-sql",
    sql.trim(),

    "-simplify",
    String(simplify),

    "-makevalid",
    "-nlt",
    "PROMOTE_TO_MULTI",

    "-f",
    "PMTiles",

    "-dsco",
    `MINZOOM=${minzoom}`,
    "-dsco",
    `MAXZOOM=${maxzoom}`,
    "-dsco",
    `NAME=${name}`,
  ]);

  const pmtilesBytes = await Gdal.getFileBytes(outPath);
  return { pmtilesBytes, outPath };
}

export function downloadBytes(bytes, filename = "data.pmtiles") {
  const blob = new Blob([bytes], { type: "application/octet-stream" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}
