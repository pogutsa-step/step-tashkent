import { dxfFileToPmtilesBytes } from "./dxf-pmtiles.js";
import { makeWorker } from "./sidecarWidthMap.js";
import { AwsClient } from "https://esm.sh/aws4fetch@1.0.20";

export function createDxfExportWidget({
  container,
  Gdal,
  proj4,
  featureName,
  storage,
  workerUrl = new URL("./dxf-width-worker.js", import.meta.url),
}) {
  if (!container) throw new Error("container is required");
  if (!Gdal) throw new Error("Gdal is required");
  if (!proj4) throw new Error("proj4 is required");
  if (!featureName) throw new Error("featureName is required");
  if (!storage?.bucketName) throw new Error("storage.bucketName is required");
  if (!storage?.accessKeyId || !storage?.secretAccessKey) {
    throw new Error("storage access keys are required");
  }

  let processed = null;
  let busy = false;

  container.innerHTML = "";
  container.classList.add("dxf-export-widget");

  const root = document.createElement("div");
  root.style.display = "grid";
  root.style.gap = "10px";
  root.style.maxWidth = "520px";
  root.style.padding = "12px";
  root.style.border = "1px solid #d0d0d0";
  root.style.borderRadius = "8px";
  root.style.background = "#fff";

  const fileInput = document.createElement("input");
  fileInput.type = "file";
  fileInput.accept = ".dxf";
  fileInput.style.width = "100%";

  const buttonsRow = document.createElement("div");
  buttonsRow.style.display = "flex";
  buttonsRow.style.gap = "8px";
  buttonsRow.style.flexWrap = "wrap";

  const processBtn = document.createElement("button");
  processBtn.type = "button";
  processBtn.textContent = "Обработать";

  const uploadBtn = document.createElement("button");
  uploadBtn.type = "button";
  uploadBtn.textContent = "Загрузить в бакет";
  uploadBtn.disabled = true;

  buttonsRow.append(processBtn, uploadBtn);

  const progressWrap = document.createElement("div");
  progressWrap.style.display = "grid";
  progressWrap.style.gap = "4px";

  const progress = document.createElement("progress");
  progress.max = 100;
  progress.value = 0;
  progress.style.width = "100%";

  const progressText = document.createElement("div");
  progressText.textContent = "Готово";
  progressText.style.fontSize = "12px";
  progressText.style.color = "#555";

  progressWrap.append(progress, progressText);

  const logBox = document.createElement("pre");
  logBox.style.margin = "0";
  logBox.style.padding = "10px";
  logBox.style.background = "#f6f6f6";
  logBox.style.borderRadius = "6px";
  logBox.style.fontSize = "12px";
  logBox.style.lineHeight = "1.4";
  logBox.style.whiteSpace = "pre-wrap";
  logBox.style.wordBreak = "break-word";
  logBox.style.maxHeight = "220px";
  logBox.style.overflow = "auto";
  logBox.textContent = "";

  root.append(fileInput, buttonsRow, progressWrap, logBox);
  container.append(root);

  function setProgress(value, text) {
    progress.value = Math.max(0, Math.min(100, value));
    progressText.textContent = text;
  }

  function log(message) {
    const line = typeof message === "string" ? message : String(message);
    logBox.textContent += (logBox.textContent ? "\n" : "") + line;
    logBox.scrollTop = logBox.scrollHeight;
  }

  function setBusyState(nextBusy) {
    busy = nextBusy;
    fileInput.disabled = nextBusy;
    processBtn.disabled = nextBusy;
    uploadBtn.disabled = nextBusy || !processed;
  }

  function getBaseName(filename) {
    return filename.replace(/\.[^.]+$/, "");
  }

  const s3 = new AwsClient({
    accessKeyId: storage.accessKeyId,
    secretAccessKey: storage.secretAccessKey,
    service: "s3",
    region: storage.region || "ru-central1",
  });

  function sanitizeNameForKey(name) {
    return (
      String(name || "")
        .trim()
        .toLowerCase()
        .replace(/[^\p{L}\p{N}._-]+/gu, "_")
        .replace(/^_+|_+$/g, "") || "unnamed"
    );
  }

  function encodeObjectKey(key) {
    return String(key)
      .split("/")
      .map((part) => encodeURIComponent(part))
      .join("/");
  }

  function buildPublicUrl(key) {
    const base = (storage.publicBaseUrl || "").replace(/\/+$/, "");
    return `${base}/${encodeObjectKey(key)}`;
  }

  async function loadProjectIndex() {
    const indexUrl = buildPublicUrl(storage.indexKey);
    const resp = await fetch(indexUrl, { cache: "no-store" });

    if (resp.status === 404) {
      return {
        schemaVersion: 1,
        updatedAt: new Date().toISOString(),
        items: {},
      };
    }

    if (!resp.ok) {
      throw new Error(`Не удалось загрузить index.json: HTTP ${resp.status}`);
    }

    const json = await resp.json();
    return {
      schemaVersion: 1,
      updatedAt: json?.updatedAt || new Date().toISOString(),
      items: json?.items && typeof json.items === "object" ? json.items : {},
    };
  }

  async function putObject(key, body, contentType) {
    const base = (
      storage.endpoint || "https://storage.yandexcloud.net"
    ).replace(/\/+$/, "");
    const url = `${base}/${storage.bucketName}/${encodeObjectKey(key)}`;

    const resp = await s3.fetch(url, {
      method: "PUT",
      headers: {
        "Content-Type": contentType,
      },
      body,
    });

    if (!resp.ok) {
      const text = await resp.text().catch(() => "");
      throw new Error(`PUT ${key} failed: HTTP ${resp.status} ${text}`);
    }
  }

  async function uploadFiles() {
    if (!processed) return;

    try {
      setBusyState(true);
      setProgress(82, "Читаю project_index...");
      log(`Улица: ${featureName}`);

      const projectIndex = await loadProjectIndex();
      const currentEntry = projectIndex.items?.[featureName] || null;
      const nextVersion = Number(currentEntry?.version || 0) + 1;
      const safeName = sanitizeNameForKey(featureName);
      const basePrefix = `${storage.projectsPrefix}/${safeName}/v${nextVersion}`;

      const pmtilesFileName = `${safeName}.pmtiles`;
      const sidecarFileName = `${safeName}.sidecar.json`;

      const pmtilesKey = `${basePrefix}/${pmtilesFileName}`;
      const sidecarKey = `${basePrefix}/${sidecarFileName}`;

      const sidecarData = {
        ...processed.sidecarData,
        name: processed.baseName,
        pmtilesName: pmtilesFileName,
      };
      const sidecarJsonText = JSON.stringify(sidecarData, null, 2);

      setProgress(88, "Загружаю PMTiles...");
      await putObject(
        pmtilesKey,
        processed.pmtilesBytes,
        "application/octet-stream",
      );
      log(`Загружен ${pmtilesKey}`);

      setProgress(93, "Загружаю sidecar...");
      await putObject(sidecarKey, sidecarJsonText, "application/json");
      log(`Загружен ${sidecarKey}`);

      const updatedAt = new Date().toISOString();
      projectIndex.items[featureName] = {
        name: featureName,
        version: nextVersion,
        updatedAt,
        pmtilesUrl: buildPublicUrl(pmtilesKey),
        sidecarUrl: buildPublicUrl(sidecarKey),
      };
      projectIndex.updatedAt = updatedAt;

      setProgress(97, "Обновляю project_index...");
      await putObject(
        storage.indexKey,
        JSON.stringify(projectIndex, null, 2),
        "application/json",
      );

      setProgress(100, "Загружено");
      log(`index updated: ${featureName}, version ${nextVersion}`);
    } catch (err) {
      console.error(err);
      setProgress(0, "Ошибка загрузки");
      log(`Ошибка загрузки: ${err?.message || err}`);
    } finally {
      setBusyState(false);
    }
  }

  function buildSidecarJson({ fileName, lastModified, entitiesMap, layers }) {
    const entities = Object.fromEntries(entitiesMap.entries());
    const baseName = fileName.replace(/\.[^.]+$/, "");

    return {
      name: fileName,
      pmtilesName: `${baseName}.pmtiles`,
      date: new Date(lastModified || Date.now()).toISOString(),
      layers: Array.isArray(layers) ? layers : [],
      entities,
    };
  }

  async function extractSidecar(file) {
    return new Promise((resolve, reject) => {
      const entities = new Map();
      let layers = [];

      const worker = makeWorker(workerUrl, { type: "module" });

      worker.onmessage = (e) => {
        const msg = e.data;

        if (msg?.type === "chunk") {
          for (const it of msg.items || []) {
            const prev = entities.get(it.h) || {};
            const next = { ...prev, ...it };
            delete next.h;
            entities.set(String(it.h), next);
          }
          return;
        }

        if (msg?.type === "done") {
          layers = Array.isArray(msg.layers) ? msg.layers : [];
          worker.terminate();
          resolve({ entities, layers });
          return;
        }

        if (msg?.type === "error") {
          worker.terminate();
          reject(new Error(msg.message || "DXF sidecar worker error"));
        }
      };

      worker.onerror = (err) => {
        worker.terminate();
        reject(err instanceof Error ? err : new Error("DXF worker failed"));
      };

      worker.postMessage({ file });
    });
  }

  async function processFile() {
    const file = fileInput.files?.[0];
    if (!file) {
      log("Сначала выбери DXF файл.");
      return;
    }

    processed = null;
    uploadBtn.disabled = true;
    logBox.textContent = "";

    try {
      setBusyState(true);
      setProgress(5, "Старт...");
      log(`Файл: ${file.name}`);

      setProgress(15, "Читаю DXF...");
      log("Собираю sidecar...");

      const sidecarPromise = extractSidecar(file);

      setProgress(30, "Конвертирую DXF в PMTiles...");
      const { pmtilesBytes } = await dxfFileToPmtilesBytes({
        Gdal,
        file,
        s_srs: proj4,
        simplify: 0.02,
        minzoom: 12,
        maxzoom: 17,
        name: file.name,
        onLog: log,
      });

      setProgress(75, "Финализирую sidecar...");
      const { entities, layers } = await sidecarPromise;

      const sidecar = buildSidecarJson({
        fileName: file.name,
        lastModified: file.lastModified,
        entitiesMap: entities,
        layers,
      });

      const baseName = getBaseName(file.name);

      processed = {
        baseName,
        pmtilesBytes,
        sidecarData: sidecar,
        sidecarJsonText: JSON.stringify(sidecar, null, 2),
      };

      setProgress(100, "Готово");
      log(`PMTiles готов: ${pmtilesBytes.byteLength} bytes`);
      log(`Sidecar готов: ${entities.size} entities`);
      uploadBtn.disabled = false;
    } catch (err) {
      console.error(err);
      setProgress(0, "Ошибка");
      log(`Ошибка: ${err?.message || err}`);
    } finally {
      setBusyState(false);
    }
  }

  processBtn.addEventListener("click", processFile);
  uploadBtn.addEventListener("click", uploadFiles);

  return {
    destroy() {
      processBtn.removeEventListener("click", processFile);
      uploadBtn.removeEventListener("click", uploadFiles);
      container.innerHTML = "";
    },
    getProcessed() {
      return processed;
    },
  };
}
