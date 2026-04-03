// building-shadows-layer.js
/* global maplibregl */

/**
 * BuildingShadowsLayer — тени от экструзий зданий для MapLibre (WebGL2 custom layer).
 *
 * Основано на:
 *  - доступе к геометрии, как в building-floors-layer.js (sourceId + buildingBucket)
 *  - логике смещения вершин из BuildingShadows (mapbox + threebox)
 *
 * Требования:
 *  - WebGL2 (MapLibre 3+)
 *  - 3D-здания рендерятся fill-extrusion'ом из того же MVT источника
 *
 * Использование:
 *
 *   import { BuildingShadowsLayer } from "./building-shadows-layer.js";
 *
 *   const shadows = new BuildingShadowsLayer({
 *     id: "bldg-shadows",
 *     sourceId: "openmaptiles",
 *     buildingBucket: "building-3d",
 *     opacity: 0.6,
 *     minAltitude: 0.10, // радианы; ниже — тени обнуляются
 *   });
 *   map.addLayer(shadows, "water_name_line");
 */

function makeProgram(gl, vsSrc, fsSrc) {
  const compile = (type, src) => {
    const sh = gl.createShader(type);
    gl.shaderSource(sh, src);
    gl.compileShader(sh);
    if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
      throw new Error(gl.getShaderInfoLog(sh) || "shader compile failed");
    }
    return sh;
  };

  const p = gl.createProgram();
  gl.attachShader(p, compile(gl.VERTEX_SHADER, vsSrc));
  gl.attachShader(p, compile(gl.FRAGMENT_SHADER, fsSrc));
  gl.linkProgram(p);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) {
    throw new Error(gl.getProgramInfoLog(p) || "program link failed");
  }
  return p;
}

function normalizeColor3(color) {
  if (!Array.isArray(color) || color.length < 3) {
    return [0.0, 0.0, 0.0];
  }
  let [r, g, b] = color;
  // если пришло в 0–255 — нормализуем
  if (r > 1.0 || g > 1.0 || b > 1.0) {
    r /= 255.0;
    g /= 255.0;
    b /= 255.0;
  }
  return [r, g, b];
}

function makeTexture(gl, w, h) {
  const tex = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.texImage2D(
    gl.TEXTURE_2D,
    0,
    gl.RGBA,
    w,
    h,
    0,
    gl.RGBA,
    gl.UNSIGNED_BYTE,
    null,
  );
  gl.bindTexture(gl.TEXTURE_2D, null);
  return tex;
}

function ensureFbo(gl, state, w, h) {
  // используем те же поля, что и в конструкторе: _fbo / _fboTex / _fboW / _fboH
  if (state._fbo && state._fboW === w && state._fboH === h) return;
  // cleanup old
  if (state._fbo) gl.deleteFramebuffer(state._fbo);
  if (state._fboTex) gl.deleteTexture(state._fboTex);

  state._fboTex = makeTexture(gl, w, h);
  state._fbo = gl.createFramebuffer();
  gl.bindFramebuffer(gl.FRAMEBUFFER, state._fbo);
  gl.framebufferTexture2D(
    gl.FRAMEBUFFER,
    gl.COLOR_ATTACHMENT0,
    gl.TEXTURE_2D,
    state._fboTex,
    0,
  );

  const status = gl.checkFramebufferStatus(gl.FRAMEBUFFER);
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  if (status !== gl.FRAMEBUFFER_COMPLETE) {
    throw new Error(
      `[BuildingShadowsLayer] FBO incomplete: 0x${status.toString(16)}`,
    );
  }
  state._fboW = w;
  state._fboH = h;
}

// как в building-floors-layer
function getInViewTiles(map, sourceId) {
  return map.getSource(sourceId)?._eventedParent?._inViewTiles?._tiles || {};
}

// Простой GPU-таймер на EXT_disjoint_timer_query_webgl2
function createGpuTimer(gl, options = {}) {
  const ext =
    gl.getExtension("EXT_disjoint_TIMER_query_webgl2") ||
    gl.getExtension("EXT_disjoint_timer_query_webgl2");
  if (!ext) {
    console.warn(
      "[BuildingShadowsLayer] EXT_disjoint_timer_query_webgl2 not available",
    );
    return null;
  }
  const maxPending = options.maxPending || 6;
  const pending = [];
  let active = null;

  return {
    begin() {
      if (active) return; // не поддерживаем вложенность
      const q = gl.createQuery();
      gl.beginQuery(ext.TIME_ELAPSED_EXT, q);
      active = q;
    },
    end() {
      if (!active) return;
      gl.endQuery(ext.TIME_ELAPSED_EXT);
      pending.push(active);
      active = null;
      while (pending.length > maxPending) {
        const old = pending.shift();
        gl.deleteQuery(old);
      }
    },
    poll() {
      if (!pending.length) return null;
      const disjoint = gl.getParameter(ext.GPU_DISJOINT_EXT);
      if (disjoint) {
        while (pending.length) gl.deleteQuery(pending.shift());
        return null;
      }
      const q = pending[0];
      const available = gl.getQueryParameter(q, gl.QUERY_RESULT_AVAILABLE);
      if (!available) return null;
      const ns = gl.getQueryParameter(q, gl.QUERY_RESULT);
      pending.shift();
      gl.deleteQuery(q);
      return ns / 1e6; // ms
    },
  };
}

// HUD для отображения времени рендера слоя теней
function ensureShadowHud(layer) {
  if (typeof document === "undefined") return;
  if (layer._hudRoot) return;

  const root = document.createElement("div");
  root.style.position = "fixed";
  root.style.left = "8px";
  root.style.bottom = "8px";
  root.style.zIndex = "9999";
  root.style.padding = "4px 6px";
  root.style.background = "rgba(0,0,0,0.6)";
  root.style.color = "#0f0";
  root.style.font = "11px monospace";
  root.style.pointerEvents = "none";
  root.style.borderRadius = "4px";
  const title = document.createElement("div");
  title.textContent = "shadows gpu ms";
  title.style.marginBottom = "2px";
  root.appendChild(title);

  const canvas = document.createElement("canvas");
  canvas.width = 160;
  canvas.height = 40;
  root.appendChild(canvas);

  document.body.appendChild(root);

  layer._hudRoot = root;
  layer._hudCanvas = canvas;
  layer._hudCtx = canvas.getContext("2d");
  layer._hudSamples = [];
  layer._hudMaxSamples = 120;
}

function pushShadowHudSample(layer, ms) {
  const canvas = layer._hudCanvas;
  const ctx = layer._hudCtx;
  if (!canvas || !ctx) return;

  const samples = layer._hudSamples || (layer._hudSamples = []);
  const maxN = layer._hudMaxSamples || 120;

  samples.push(ms);
  if (samples.length > maxN) samples.shift();

  const w = canvas.width;
  const h = canvas.height;

  // max для масштабирования графика
  let max = 0;
  for (let i = 0; i < samples.length; i++) {
    if (samples[i] > max) max = samples[i];
  }
  if (max < 1) max = 1;
  ctx.clearRect(0, 0, w, h);

  // базовая линия
  ctx.save();
  ctx.strokeStyle = "rgba(255,255,255,0.2)";
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(0, h - 0.5);
  ctx.lineTo(w, h - 0.5);
  ctx.stroke();

  // график ms
  ctx.strokeStyle = "#0f0";
  ctx.beginPath();
  for (let i = 0; i < samples.length; i++) {
    const v = samples[i];
    const x = (i / Math.max(1, maxN - 1)) * w;
    const y = h - (v / max) * (h - 4) - 2;
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.stroke();

  // подпись ms + «fps» слоя
  const fpsLayer = ms > 0.001 ? 1000 / ms : 0;
  const label = `${ms.toFixed(2)} ms  (~${fpsLayer.toFixed(0)} fps)`;
  ctx.fillStyle = "rgba(0,0,0,0.7)";
  ctx.fillRect(1, 1, w - 2, 11);
  ctx.fillStyle = "#0f0";
  ctx.font = "10px monospace";
  ctx.fillText(label, 4, 10);

  ctx.restore();
}

const VS = `#version 300 es
precision highp float;

// layout как у BuildingFloorsLayer / MapLibre fill-extrusion bucket
layout(location=0) in vec2 a_pos;        // SHORT2
layout(location=1) in vec4 a_normal_ed;  // SHORT4
layout(location=3) in float a_height;    // paint attr buffer (float)
layout(location=4) in float a_base;      // paint attr buffer (float)

uniform mat4 u_matrix;
uniform float u_heightFactor; // конвертация z -> горизонтальный сдвиг
uniform float u_altitude;     // высота солнца (радианы)
uniform float u_azimuth;      // азимут солнца (уже с нужным смещением)

/**
 * Декод ровно в том же духе, как в building-floors-layer:
 *  - a_normal_ed.xy хранит normalXY и top/bottom флаг
 *  - по флагу выбираем base/height
 */
void main() {
  float base = max(0.0, a_base);
  float height = max(0.0, a_height);

  // декод флагов top/bottom из a_normal_ed.xy (как в BuildingFloorsLayer)
  vec2 normalXY = floor(a_normal_ed.xy * 0.5);
  vec2 topXY    = a_normal_ed.xy - 2.0 * normalXY;
  float t = (topXY.x > 0.5) ? 1.0 : 0.0; // 0 — низ, 1 — верх

  float z = mix(base, height, t);

  // базовая позиция вершины здания
  vec4 pos = vec4(a_pos, z, 1.0);

  // если солнце под горизонтом — длина ~0
  float alt = max(u_altitude, 0.0);
  float tanAlt = max(tan(alt), 1e-4);

  // длина тени пропорциональна высоте
  float len = z * u_heightFactor / tanAlt;

  // смещаем вершину по направлению азимута (в плоскости XY), тень кладём на землю
  pos.x += cos(u_azimuth) * len;
  pos.y += sin(u_azimuth) * len;
  pos.z = 0.0;

  gl_Position = u_matrix * pos;
}
`;

// 1-pass shadows: рисуем в offscreen БЕЗ blending, alpha=1, чтобы перекрытия не затемняли
const FS_SOLID = `#version 300 es
precision highp float;
out vec4 outColor;
void main() {
  outColor = vec4(0.0, 0.0, 0.0, 1.0);
}
`;

// fullscreen blit (apply opacity to whole layer)
const VS_BLIT = `#version 300 es
precision highp float;
layout(location=0) in vec2 a_pos;
out vec2 v_uv;
void main() {
 v_uv = a_pos * 0.5 + 0.5;
  gl_Position = vec4(a_pos, 0.0, 1.0);
}
`;

const FS_BLIT = `#version 300 es
precision highp float;
in vec2 v_uv;
uniform sampler2D u_tex;
uniform float u_opacity;
uniform vec3 u_color;
uniform vec2 u_texel; // 1/width, 1/height offscreen-текстуры
out vec4 outColor;
void main() {
  //vec4 s = texture(u_tex, v_uv);
  // s.rgb == black where shadow drawn, s.a == 1 there, 0 elsewhere
  //float a = s.a * u_opacity;
  //outColor = vec4(u_color, a);

  // 5-tap фильтр: центр + крест вокруг него
  float a0 = texture(u_tex, v_uv).a;
  float a1 = texture(u_tex, v_uv + vec2( u_texel.x, 0.0)).a;
  float a2 = texture(u_tex, v_uv + vec2(-u_texel.x, 0.0)).a;
 float a3 = texture(u_tex, v_uv + vec2(0.0,  u_texel.y)).a;
  float a4 = texture(u_tex, v_uv + vec2(0.0, -u_texel.y)).a;

  // центр чуть более “весомый”, остальное как сглаживание
  float a = (a0 * 2.0 + a1 + a2 + a3 + a4) / 6.0;
  a *= u_opacity;

  outColor = vec4(u_color, a);
}
`;

export class BuildingShadowsLayer {
  constructor(opts = {}) {
    this.id = opts.id ?? "building-shadows";
    this.type = "custom";
    this.renderingMode = "2d";

    this.sourceId = opts.sourceId; // REQUIRED: vector source id (как в BuildingFloorsLayer)
    this.buildingBucket = opts.buildingBucket; // REQUIRED: ключ bucket'а 3D-зданий

    this.minzoom = opts.minzoom ?? 14;
    this.maxzoom = opts.maxzoom ?? 22;

    this.opacity = opts.opacity ?? 0.4;
    this.color = normalizeColor3(opts.color ?? [0, 0, 0]);
    //this.minAltitude = opts.minAltitude ?? 0.1; // ниже этого тени == 0

    // солнце задаётся снаружи
    // солнце: задаём в градусах (0–360), 0° = север, 90° = восток
    this.sunAltitudeDeg = opts.sunAltitudeDeg ?? 45; // высота
    this.sunAzimuthDeg = opts.sunAzimuthDeg ?? 45; // направление

    // render gating (только при изменении камеры/вьюпорта)
    this._lastCamSig = "";
    this._lastSizeSig = "";

    // offscreen state
    this._fbo = null;
    this._fboTex = null;
    this._fboW = 0;
    this._fboH = 0;
    // blit quad
    this._blitVao = null;
    this._blitVbo = null;
    this.shadowResolutionScale = opts.shadowResolutionScale ?? 1.0;
    // FBO нужно пересчитать при первом рендере
    this._needsRedraw = true;
    this._tilesSig = "";

    // GPU-таймер и HUD
    //this._gpuTimer = null;
    //this._hudRoot = null;
    //this._hudCanvas = null;
    //this._hudCtx = null;
    //this._hudSamples = [];
    //this._hudMaxSamples = 120;
  }

  // опционально: обновление солнца в градусах
  setSunDegrees(altitudeDeg, azimuthDeg) {
    this.sunAltitudeDeg = altitudeDeg;
    this.sunAzimuthDeg = azimuthDeg;
    if (this.map) this.map.triggerRepaint();
  }

  onAdd(map, gl) {
    //this.gpuTimer = createGpuTimer(gl);
    // this._gpuLogEvery = 10; // лог раз в N готовых измерений
    //this._gpuLogCnt = 0;
    if (!this.sourceId || !this.buildingBucket) {
      throw new Error(
        "[BuildingShadowsLayer] You must pass { sourceId, buildingBucket }",
      );
    }

    this.map = map;
    this.gl = gl;

    // program for solid shadow pass (offscreen)
    this.program = makeProgram(gl, VS, FS_SOLID);
    // program for compositing opacity
    this.blitProgram = makeProgram(gl, VS_BLIT, FS_BLIT);

    this.uMatrix = gl.getUniformLocation(this.program, "u_matrix");
    this.uHeightFactor = gl.getUniformLocation(this.program, "u_heightFactor");
    this.uAltitude = gl.getUniformLocation(this.program, "u_altitude");
    this.uAzimuth = gl.getUniformLocation(this.program, "u_azimuth");
    // (u_opacity now used in blitProgram)
    this.uBlitTex = gl.getUniformLocation(this.blitProgram, "u_tex");
    this.uBlitOpacity = gl.getUniformLocation(this.blitProgram, "u_opacity");
    this.uBlitTexel = gl.getUniformLocation(this.blitProgram, "u_texel");
    this.uBlitColor = gl.getUniformLocation(this.blitProgram, "u_color");

    // fullscreen quad VAO
    this._blitVao = gl.createVertexArray();
    this._blitVbo = gl.createBuffer();
    gl.bindVertexArray(this._blitVao);
    gl.bindBuffer(gl.ARRAY_BUFFER, this._blitVbo);
    gl.bufferData(
      gl.ARRAY_BUFFER,
      new Float32Array([-1, -1, 1, -1, -1, 1, -1, 1, 1, -1, 1, 1]),
      gl.STATIC_DRAW,
    );
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 8, 0);
    gl.bindVertexArray(null);
    gl.bindBuffer(gl.ARRAY_BUFFER, null);

    // GPU-таймер (если поддерживается) и HUD
    //this._gpuTimer = createGpuTimer(gl);
    //ensureShadowHud(this);
  }

  render(gl) {
    const z = this.map.getZoom();
    if (z < this.minzoom || z >= this.maxzoom) return;
    //if (this._gpuTimer) this._gpuTimer.begin();

    // --- 1) Рисуем только при изменении камеры / размера viewport ---
    const tr = this.map.painter.transform;
    const c = this.map.getCenter();
    // bearing: в MapLibre корректнее брать tr.bearing (или map.getBearing()).
    // Берём оба на всякий случай, но основной — getBearing().
    const bearing =
      typeof this.map.getBearing === "function"
        ? this.map.getBearing()
        : (tr.bearing ?? tr.angle ?? 0);
    const camSig = [
      tr.zoom,
      tr.pitch,
      bearing, // <-- фикс: учитываем реальный bearing
      c && c.lng,
      c && c.lat,
    ]
      .map((v) => (typeof v === "number" ? v.toFixed(7) : String(v)))
      .join("|");

    const fullW = gl.drawingBufferWidth | 0;
    const fullH = gl.drawingBufferHeight | 0;
    const scale = Math.max(0.25, Math.min(1.0, this.shadowResolutionScale));
    // рендерим маску теней в fullres
    const w = Math.max(1, (fullW * scale) | 0);
    const h = Math.max(1, (fullH * scale) | 0);
    const sizeSig = `${fullW}x${fullH}x${scale.toFixed(2)}`;

    // если камера/размер изменились — надо пересчитать маску теней
    if (camSig !== this._lastCamSig || sizeSig !== this._lastSizeSig) {
      this._lastCamSig = camSig;
      this._lastSizeSig = sizeSig;
      this._needsRedraw = true;
    }

    const tiles = getInViewTiles(this.map, this.sourceId);

    // Тайлы меняются даже при статичной камере (подгрузка, fade, пересборка buckets).
    // Если сигнатура поменялась — надо пересчитать FBO.
    let sig = "";
    let any = 0;
    for (const k in tiles) {
      const tile = tiles[k];
      const b = tile?.buckets?.[this.buildingBucket];
      if (!b) continue;
      any++;
      // максимально стабильные компоненты
      const id = tile.tileID;
      sig += `${id?.key ?? k}:${id?.overscaledZ ?? 0}:${b?.segments?.segments?.length ?? 0}|`;
    }
    // если вообще нет ни одного bucket'а — сигнатура тоже важна
    sig = `${any}|` + sig;
    if (sig !== this._tilesSig) {
      this._tilesSig = sig;
      this._needsRedraw = true;
    }

    const t = tr;

    // --- 2) Offscreen pass: solid shadow, NO BLEND (только когда нужно пересчитать маску) ---
    if (this._needsRedraw) {
      ensureFbo(gl, this, w, h);
      gl.bindFramebuffer(gl.FRAMEBUFFER, this._fbo);
      gl.viewport(0, 0, w, h);
      gl.clearColor(0, 0, 0, 0);
      gl.clear(gl.COLOR_BUFFER_BIT);
      gl.useProgram(this.program);
      gl.disable(gl.BLEND); // ключевое: перекрытия не усиливаются
      gl.disable(gl.DEPTH_TEST);
      gl.disable(gl.CULL_FACE);
      const altitudeRad = (this.sunAltitudeDeg * Math.PI) / 180.0;
      const azimuthRad = (this.sunAzimuthDeg * Math.PI) / 180.0;
      gl.uniform1f(this.uAltitude, altitudeRad);
      gl.uniform1f(this.uAzimuth, azimuthRad);

      for (const k in tiles) {
        const tile = tiles[k];
        const bucket = tile?.buckets?.[this.buildingBucket];
        if (!bucket) continue;

        const layout = bucket.layoutVertexBuffer;
        const index = bucket.indexBuffer;
        if (!layout || !index) continue;

        const pc =
          bucket.programConfigurations?.programConfigurations?.[
            this.buildingBucket
          ];
        if (!pc || !pc._buffers) continue;
        const [heightBuffer, baseBuffer] = pc._buffers;

        const m = t.calculatePosMatrix(tile.tileID);
        gl.uniformMatrix4fv(this.uMatrix, false, m);

        const overscaledZ = tile.tileID.overscaledZ;
        const tileSize = tile.tileSize || 512;
        const heightFactor = Math.pow(2.0, overscaledZ) / tileSize / 8.0;
        gl.uniform1f(this.uHeightFactor, heightFactor);

        gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, index.buffer);

        for (const s of bucket.segments.segments) {
          const stride = 12;
          const vOff = s.vertexOffset * stride;

          gl.bindBuffer(gl.ARRAY_BUFFER, layout.buffer);

          gl.enableVertexAttribArray(0);
          gl.vertexAttribPointer(0, 2, gl.SHORT, false, stride, 0 + vOff);

          gl.enableVertexAttribArray(1);
          gl.vertexAttribPointer(1, 4, gl.SHORT, false, stride, 4 + vOff);

          gl.enableVertexAttribArray(3);
          heightBuffer.bind();
          gl.vertexAttribPointer(3, 1, gl.FLOAT, false, 4, s.vertexOffset * 4);

          gl.enableVertexAttribArray(4);
          baseBuffer.bind();
          gl.vertexAttribPointer(4, 1, gl.FLOAT, false, 4, s.vertexOffset * 4);
          gl.drawElements(
            gl.TRIANGLES,
            s.primitiveLength * 3,
            gl.UNSIGNED_SHORT,
            s.primitiveOffset * 3 * 2,
          );
        }
      }

      this._needsRedraw = false;
    }

    // --- 3) Composite pass: apply opacity to whole layer ---
    gl.disable(gl.SCISSOR_TEST);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, fullW, fullH);
    gl.enable(gl.BLEND);
    gl.blendEquation(gl.FUNC_ADD);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);

    gl.useProgram(this.blitProgram);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this._fboTex);
    gl.uniform1i(this.uBlitTex, 0);
    gl.uniform1f(this.uBlitOpacity, this.opacity);
    if (this.color) {
      const [cr, cg, cb] = this.color;
      gl.uniform3f(this.uBlitColor, cr, cg, cb);
    }
    if (this.uBlitTexel && this._fboW > 0 && this._fboH > 0) {
      gl.uniform2f(this.uBlitTexel, 1.0 / this._fboW, 1.0 / this._fboH);
    }
    gl.bindVertexArray(this._blitVao);
    gl.drawArrays(gl.TRIANGLES, 0, 6);
    gl.bindVertexArray(null);

    // Завершаем измерение и пушим в HUD
    /*
    if (this._gpuTimer) {
      this._gpuTimer.end();
      const ms = this._gpuTimer.poll();
      if (ms != null) {
        pushShadowHudSample(this, ms);
      }
    }
    */
  }
}
