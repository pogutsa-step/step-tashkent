/* global maplibregl */
/**
 * SAO module for MapLibre custom layer (WebGL2).
 *
 * What it does:
 *  - Pass 1: render depth into offscreen FBO (DEPTH_COMPONENT24)
 *  - Pass 2: reconstruct normals from depth into RGBA8
 *  - Pass 3: compute SAO into RGBA8
 *  - Pass 4: composite AO over the map (multiply or screen)
 *
 * Usage:
 *   import { SAOLayer } from './sao-layer.js';
 *   map.addLayer(new SAOLayer({ sourceId:'openmaptiles', buildingBucket:'building-3d' }), 'water_name_line');
 */

// -------------------- Shaders --------------------

const BUILDINGS_DEPTH_VS = `#version 300 es
precision highp float;

layout(location=0) in vec2 a_pos;
layout(location=1) in vec4 a_normal_ed;
layout(location=3) in float a_height;
layout(location=4) in float a_base;

uniform mat4 u_matrix;

void main() {
  // roof flag packed in a_normal_ed.xy like Mapbox/MapLibre extrusion
  vec2 normalXY = floor(a_normal_ed.xy * 0.5);
  vec2 topXY    = a_normal_ed.xy - 2.0 * normalXY;
  float t = topXY.x; // 0 wall, 1 roof

  float z = (t > 0.5 ? a_height : a_base);
  gl_Position = u_matrix * vec4(a_pos, z, 1.0);
}
`;

const GROUND_DEPTH_VS = `#version 300 es
precision highp float;

layout(location=0) in vec2 a_pos;

uniform mat4 u_matrix;
uniform float u_z;

void main() {
  gl_Position = u_matrix * vec4(a_pos, u_z, 1.0);
}
`;

const FSQ_VS = `#version 300 es
precision highp float;

layout(location=0) in vec2 a_pos;
out vec2 v_uv;

void main() {
  v_uv = a_pos * 0.5 + 0.5;
  gl_Position = vec4(a_pos, 0.0, 1.0);
}
`;

const DEPTH_ONLY_FS = `#version 300 es
precision highp float;
out vec4 outColor;
void main() { outColor = vec4(0.0); }
`;

const NORMAL_FROM_DEPTH_FS = `#version 300 es
precision highp float;
precision highp sampler2D;
in vec2 v_uv;
uniform sampler2D u_depthTex;
uniform mat4 u_inverseProjectionMatrix;
uniform vec2 u_resolution;
out vec4 outColor;

vec3 reconstructViewPos(vec2 uv, float depth01) {
  vec4 ndc = vec4(uv * 2.0 - 1.0, depth01 * 2.0 - 1.0, 1.0);
  vec4 viewPos = u_inverseProjectionMatrix * ndc;
  return viewPos.xyz / viewPos.w;
}

vec3 computeViewNormal(vec2 uv) {
  vec2 texel = 1.0 / u_resolution;
  float dC = texture(u_depthTex, uv).r;
  float dL = texture(u_depthTex, uv + vec2(-texel.x,  0.0)).r;
  float dR = texture(u_depthTex, uv + vec2( texel.x,  0.0)).r;
  float dT = texture(u_depthTex, uv + vec2( 0.0, -texel.y)).r;
  float dB = texture(u_depthTex, uv + vec2( 0.0,  texel.y)).r;
  if (dC >= 1.0 || dL >= 1.0 || dR >= 1.0 || dT >= 1.0 || dB >= 1.0) return vec3(0.0,0.0,1.0);
  vec3 pL = reconstructViewPos(uv + vec2(-texel.x,  0.0), dL);
  vec3 pR = reconstructViewPos(uv + vec2( texel.x,  0.0), dR);
  vec3 pT = reconstructViewPos(uv + vec2( 0.0, -texel.y), dT);
  vec3 pB = reconstructViewPos(uv + vec2( 0.0,  texel.y), dB);
  vec3 dx = pR - pL;
  vec3 dy = pB - pT;
  return normalize(cross(dx, dy));
}

void main() {
  vec3 n = computeViewNormal(v_uv);
  outColor = vec4(n * 0.5 + 0.5, 1.0);
}
`;

const SAO_FS = `#version 300 es
precision highp float;
precision highp sampler2D;

in vec2 v_uv;

uniform sampler2D u_depth;
uniform sampler2D u_normal;     // full-res normals (encoded)
uniform sampler2D u_blueNoise;
uniform mat4 u_inverseProjectionMatrix;
uniform vec2 u_resolution;
uniform vec2 u_aoResolution;    // AO target resolution (can be half-res later)
uniform float u_metersPerPixel;

uniform vec4 u_params;   // SMALL: x radiusMeters, y intensity, z bias, w range
uniform vec4 u_params2;  // LARGE: x radiusMeters, y intensity, z bias, w range
uniform int u_mode;
uniform int u_compMode;   // 0=multiply, 1=screen
uniform vec3 u_tint;      // AO tint RGB (0..1)

out vec4 outColor;

vec3 reconstructViewPos(vec2 uv, float depth01) {
  vec4 ndc = vec4(uv * 2.0 - 1.0, depth01 * 2.0 - 1.0, 1.0);
  vec4 viewPos = u_inverseProjectionMatrix * ndc;
  return viewPos.xyz / viewPos.w;
}

vec3 decodeN(vec4 t) { return normalize(t.xyz * 2.0 - 1.0); }

float computeAO(vec3 centerPos, vec3 centerNormal, vec2 offset, vec4 params) {
  vec2 sampleUV = v_uv + offset;
  float sampleDepth = texture(u_depth, sampleUV).r;
  if (sampleDepth >= 1.0) return 1.0;

  vec3 samplePos = reconstructViewPos(sampleUV, sampleDepth);
  vec3 delta = samplePos - centerPos;

  float dist = length(delta);
  float occlusion = max(0.0, dot(centerNormal, delta) - params.z);
  occlusion /= (dist * dist + 1e-5);
  occlusion *= 1.0 - smoothstep(0.0, params.w, dist);

  return 1.0 - occlusion * params.y;
}

void main() {
  float depth = texture(u_depth, v_uv).r;
  if (depth >= 1.0) { outColor = vec4(1.0); return; }

  vec3 viewPos = reconstructViewPos(v_uv, depth);
  vec3 viewNormal = decodeN(texture(u_normal, v_uv));

  float metersPerPixel = max(u_metersPerPixel, 0.0001);
  float radiusPxS = u_params.x / metersPerPixel;
  float radiusPxL = u_params2.x / metersPerPixel;

  vec2 aoRes = u_aoResolution;

  // NOTE: blue-noise is 64x64, wrap
  vec2 noiseUV = v_uv * (u_resolution / 64.0);
  vec2 blueNoise = texture(u_blueNoise, noiseUV).rg;

  float aoS = 0.0;
  float aoL = 0.0;
  const int NUM_SAMPLES = 12;

  for (int i = 0; i < NUM_SAMPLES; ++i) {
    float fi = float(i) + 0.5;
    float t = fi / float(NUM_SAMPLES);
    float r = sqrt(t);
    float angle = 2.39996323 * fi + blueNoise.x * 6.28318530718;
    vec2 dir = vec2(cos(angle), sin(angle));

    vec2 jitter = (blueNoise - 0.5) * 0.8 / aoRes;

    vec2 ofsS = dir * r * radiusPxS / aoRes + jitter;
    aoS += computeAO(viewPos, viewNormal, ofsS, u_params);

    vec2 ofsL = dir * r * radiusPxL / aoRes + jitter;
    aoL += computeAO(viewPos, viewNormal, ofsL, u_params2);
  }

  aoS /= float(NUM_SAMPLES);
  aoL /= float(NUM_SAMPLES);

  aoS = pow(aoS, 1.1);
  aoL = pow(aoL, 1.1);

  float ao = aoS * aoL;
  float mask = clamp(1.0 - ao, 0.0, 1.0);

  // u_mode==1: output a pre-composited tint layer in RGB (alpha unused)
  if (u_mode == 1) {
    vec3 src =
      (u_compMode == 0)
        ? mix(vec3(1.0), u_tint, mask)   // multiply: 1..tint
        : mix(vec3(0.0), u_tint, mask);  // screen:   0..tint
    outColor = vec4(src, 1.0);
  } else {
    // debug: grayscale AO
    outColor = vec4(vec3(ao), 1.0);
  }
}
`;

const AO_BILATERAL_BLUR_FS = `#version 300 es
precision highp float;
precision highp sampler2D;

in vec2 v_uv;

uniform sampler2D u_src;     // AO (already tinted if u_mode==1)
uniform sampler2D u_depth;   // depth01
uniform mat4 u_inverseProjectionMatrix;
uniform vec2 u_resolution;   // full-res
uniform vec2 u_dir;          // (1,0) or (0,1) in pixels
uniform float u_sigma;       // blur sigma in pixels (e.g. 1.2)
uniform float u_depthSigma;  // depth edge sigma in meters (e.g. 1.0)

out vec4 outColor;

vec3 reconstructViewPos(vec2 uv, float depth01) {
  vec4 ndc = vec4(uv * 2.0 - 1.0, depth01 * 2.0 - 1.0, 1.0);
  vec4 viewPos = u_inverseProjectionMatrix * ndc;
  return viewPos.xyz / viewPos.w;
}

float gauss(float x, float s) { return exp(-(x*x) / (2.0*s*s)); }

void main() {
  float dC = texture(u_depth, v_uv).r;
  if (dC >= 1.0) { outColor = texture(u_src, v_uv); return; }

  float zC = reconstructViewPos(v_uv, dC).z;

  vec2 texel = 1.0 / u_resolution;
  vec2 stepUV = u_dir * texel;

  // 5-tap separable bilateral blur: -2,-1,0,+1,+2
  vec4 sum = vec4(0.0);
  float wsum = 0.0;

  for (int i = -2; i <= 2; i++) {
    vec2 uv = v_uv + float(i) * stepUV;

    float dN = texture(u_depth, uv).r;
    vec4 cN = texture(u_src, uv);

    float w = gauss(float(i), u_sigma);

    // depth edge preservation (in meters)
    if (dN < 1.0) {
      float zN = reconstructViewPos(uv, dN).z;
      float dz = abs(zN - zC);
      w *= gauss(dz, u_depthSigma);
    } else {
      // don't blur into sky
      w *= 0.0;
    }

   sum += cN * w;
    wsum += w;
 }

  outColor = (wsum > 0.0) ? (sum / wsum) : texture(u_src, v_uv);
}
`;

const COPY_FS = `#version 300 es
precision highp float;
precision highp sampler2D;
in vec2 v_uv;
uniform sampler2D u_tex;
out vec4 outColor;
void main(){ outColor = texture(u_tex, v_uv); }
`;

// -------------------- GL helpers --------------------

function invertMat4(out, m) {
  const a00 = m[0],
    a01 = m[1],
    a02 = m[2],
    a03 = m[3];
  const a10 = m[4],
    a11 = m[5],
    a12 = m[6],
    a13 = m[7];
  const a20 = m[8],
    a21 = m[9],
    a22 = m[10],
    a23 = m[11];
  const a30 = m[12],
    a31 = m[13],
    a32 = m[14],
    a33 = m[15];

  const b00 = a00 * a11 - a01 * a10;
  const b01 = a00 * a12 - a02 * a10;
  const b02 = a00 * a13 - a03 * a10;
  const b03 = a01 * a12 - a02 * a11;
  const b04 = a01 * a13 - a03 * a11;
  const b05 = a02 * a13 - a03 * a12;
  const b06 = a20 * a31 - a21 * a30;
  const b07 = a20 * a32 - a22 * a30;
  const b08 = a20 * a33 - a23 * a30;
  const b09 = a21 * a32 - a22 * a31;
  const b10 = a21 * a33 - a23 * a31;
  const b11 = a22 * a33 - a23 * a32;

  let det =
    b00 * b11 - b01 * b10 + b02 * b09 + b03 * b08 - b04 * b07 + b05 * b06;
  if (!det) return false;
  det = 1.0 / det;

  out[0] = (a11 * b11 - a12 * b10 + a13 * b09) * det;
  out[1] = (-a01 * b11 + a02 * b10 - a03 * b09) * det;
  out[2] = (a31 * b05 - a32 * b04 + a33 * b03) * det;
  out[3] = (-a21 * b05 + a22 * b04 - a23 * b03) * det;
  out[4] = (-a10 * b11 + a12 * b08 - a13 * b07) * det;
  out[5] = (a00 * b11 - a02 * b08 + a03 * b07) * det;
  out[6] = (-a30 * b05 + a32 * b02 - a33 * b01) * det;
  out[7] = (a20 * b05 - a22 * b02 + a23 * b01) * det;
  out[8] = (a10 * b10 - a11 * b08 + a13 * b06) * det;
  out[9] = (-a00 * b10 + a01 * b08 - a03 * b06) * det;
  out[10] = (a30 * b04 - a31 * b02 + a33 * b00) * det;
  out[11] = (-a20 * b04 + a21 * b02 - a23 * b00) * det;
  out[12] = (-a10 * b09 + a11 * b07 - a12 * b06) * det;
  out[13] = (a00 * b09 - a01 * b07 + a02 * b06) * det;
  out[14] = (-a30 * b03 + a31 * b01 - a32 * b00) * det;
  out[15] = (a20 * b03 - a21 * b01 + a22 * b00) * det;
  return true;
}

function interpZoomStops(zoom, stops) {
  if (!stops || stops.length === 0) return 1.0;
  if (zoom <= stops[0][0]) return stops[0][1];
  for (let i = 0; i < stops.length - 1; i++) {
    const [z0, v0] = stops[i];
    const [z1, v1] = stops[i + 1];
    if (zoom <= z1) {
      const t = (zoom - z0) / Math.max(1e-6, z1 - z0);
      return v0 + (v1 - v0) * t;
    }
  }
  return stops[stops.length - 1][1];
}

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

function ensureColorTarget(gl, state, w, h, filter) {
  if (state.w === w && state.h === h && state.tex && state.fbo) return;
  state.w = w;
  state.h = h;

  if (!state.tex) state.tex = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, state.tex);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, filter);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, filter);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.texImage2D(
    gl.TEXTURE_2D,
    0,
    gl.RGBA8,
    w,
    h,
    0,
    gl.RGBA,
    gl.UNSIGNED_BYTE,
    null,
  );

  if (!state.fbo) state.fbo = gl.createFramebuffer();
  gl.bindFramebuffer(gl.FRAMEBUFFER, state.fbo);
  gl.framebufferTexture2D(
    gl.FRAMEBUFFER,
    gl.COLOR_ATTACHMENT0,
    gl.TEXTURE_2D,
    state.tex,
    0,
  );
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
}

function ensureFbo(gl, state, w, h) {
  if (state.fbo && state.w === w && state.h === h) return;

  if (state.depthTex) gl.deleteTexture(state.depthTex);
  if (state.colorTex) gl.deleteTexture(state.colorTex);
  if (state.fbo) gl.deleteFramebuffer(state.fbo);

  state.w = w;
  state.h = h;

  const fbo = gl.createFramebuffer();
  gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);

  // color attachment (unused, but required for many drivers)
  const colorTex = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, colorTex);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.texImage2D(
    gl.TEXTURE_2D,
    0,
    gl.RGBA8,
    w,
    h,
    0,
    gl.RGBA,
    gl.UNSIGNED_BYTE,
    null,
  );
  gl.framebufferTexture2D(
    gl.FRAMEBUFFER,
    gl.COLOR_ATTACHMENT0,
    gl.TEXTURE_2D,
    colorTex,
    0,
  );

  // depth texture
  const depthTex = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, depthTex);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.texImage2D(
    gl.TEXTURE_2D,
    0,
    gl.DEPTH_COMPONENT24,
    w,
    h,
    0,
    gl.DEPTH_COMPONENT,
    gl.UNSIGNED_INT,
    null,
  );
  gl.framebufferTexture2D(
    gl.FRAMEBUFFER,
    gl.DEPTH_ATTACHMENT,
    gl.TEXTURE_2D,
    depthTex,
    0,
  );

  const status = gl.checkFramebufferStatus(gl.FRAMEBUFFER);
  if (status !== gl.FRAMEBUFFER_COMPLETE) {
    throw new Error("FBO incomplete: 0x" + status.toString(16));
  }

  gl.bindTexture(gl.TEXTURE_2D, null);
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);

  state.fbo = fbo;
  state.colorTex = colorTex;
  state.depthTex = depthTex;
}

function createProceduralBlueNoise(gl, tex) {
  gl.bindTexture(gl.TEXTURE_2D, tex);
  const W = 64,
    H = 64;
  const data = new Uint8Array(W * H * 4);
  let s = 1337;
  for (let i = 0; i < W * H; i++) {
    s = (s * 1664525 + 1013904223) >>> 0;
    data[i * 4 + 0] = s & 255;
    data[i * 4 + 1] = (s >>> 8) & 255;
    data[i * 4 + 2] = (s >>> 16) & 255;
    data[i * 4 + 3] = 255;
  }
  gl.texImage2D(
    gl.TEXTURE_2D,
    0,
    gl.RGBA8,
    W,
    H,
    0,
    gl.RGBA,
    gl.UNSIGNED_BYTE,
    data,
  );
}

function loadBlueNoisePNG(gl, tex, url) {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      gl.bindTexture(gl.TEXTURE_2D, tex);
      gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, 0);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, img);
      resolve(true);
    };
    img.onerror = () => resolve(false);
    img.src = url;
  });
}

// internal: access in-view tiles for a vector source (private MapLibre internals)
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
// -------------------- SAO custom layer --------------------

export class SAOLayer {
  constructor(opts = {}) {
    this.id = opts.id ?? "sao";
    this.type = "custom";
    this.renderingMode = "2d";

    // ✅ exposed wiring: where to take geometry from
    this.sourceId = opts.sourceId; // REQUIRED
    this.buildingBucket = opts.buildingBucket; // REQUIRED

    // optional: ground depth plane
    this.groundZ = opts.groundZ ?? -0.01;

    // zoom gate
    this.minzoom = opts.minzoom ?? 14;
    this.maxzoom = opts.maxzoom ?? 22;

    // Debug view routing:
    // - If useWindowDbgView=true, render reads window.DBG_VIEW ('sao'|'normal'|'depth')
    this.useWindowDbgView = opts.useWindowDbgView ?? true;
    this.dbgView = opts.dbgView ?? "sao";
    if (this.useWindowDbgView)
      window.DBG_VIEW = window.DBG_VIEW || this.dbgView;

    // AO output mode: 1 = compositing tint layer in RGB, 0 = grayscale debug
    this.saoMode = opts.saoMode ?? 1;

    // Composite mode over the base map
    this.compositeMode = opts.compositeMode ?? "multiply"; // 'multiply'|'screen'
    this.aoTint = opts.aoTint ?? [0, 0, 0]; // [r,g,b] 0..255

    // Масштаб оффскрин-рендеринга (depth/normal/SAO/blur).
    // 1.0 = full-res, 0.5 = половина, 0.25 = четверть и т.д.
    // Для безопасности клампим в (0, 1].
    // Масштаб оффскрина во время движения камеры (move/zoom/pitch/rotate).
    // Пока камера двигается — рендерим SAO в пониженном разрешении (offscreenScale),
    // как только остановилась — считаем один раз в полном (1.0).
    const s = opts.offscreenScale ?? 0.5;
    this.offscreenScale = Math.max(0.01, Math.min(1.0, s));

    // Флаг движения камеры и хендлеры
    this._isMoving = false;
    this._onMoveStart = null;
    this._onMoveEnd = null;

    // Гейт пересчёта: если камера/размер/тайлы не менялись — тяжёлые
    // пассы не пересчитываем, только композицию.
    this._lastCamSig = "";
    this._lastSizeSig = "";
    this._tilesSig = "";
    this._needsRedraw = false;

    // Blue-noise
    this.blueNoiseUrl = opts.blueNoiseUrl ?? "./bn64.png";

    // Two-scale SAO params
    this.saoLarge = {
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
      ...(opts.saoLarge || {}),
    };
    this.saoSmall = {
      radius: 20.0,
      bias: 0.1,
      range: 100.0,
      intensityStops: [
        [14, 0.1],
        [16, 0.3],
        [17, 0.5],
        [20, 5],
      ],
      ...(opts.saoSmall || {}),
    };

    // cached
    this._invProjCached = new Float32Array(16);
    // GPU-таймер и HUD
    //this._gpuTimer = null;
    //this._hudRoot = null;
    //this._hudCanvas = null;
    //this._hudCtx = null;
    //this._hudSamples = [];
    //this._hudMaxSamples = 120;
  }

  _getDbgView() {
    return this.useWindowDbgView ? window.DBG_VIEW : this.dbgView;
  }

  onAdd(map, gl) {
    // this.gpuTimer = createGpuTimer(gl);
    // this._gpuLogEvery = 10; // лог раз в N готовых измерений
    // this._gpuLogCnt = 0;
    if (!this.sourceId || !this.buildingBucket) {
      throw new Error("[SAO] You must pass { sourceId, buildingBucket }");
    }

    this.map = map;
    this.gl = gl;

    // offscreen targets
    this._norm = { w: 0, h: 0, tex: null, fbo: null };
    //this._ao = { w: 0, h: 0, tex: null, fbo: null };
    this._aoRaw = { w: 0, h: 0, tex: null, fbo: null }; // SAO output before AA
    this._aoTmp = { w: 0, h: 0, tex: null, fbo: null }; // blur ping-pong
    this._ao = { w: 0, h: 0, tex: null, fbo: null }; // final AO after AA
    this.fboState = { fbo: null, colorTex: null, depthTex: null, w: 0, h: 0 };

    // programs
    this.pBuildings = makeProgram(gl, BUILDINGS_DEPTH_VS, DEPTH_ONLY_FS);
    this.pGround = makeProgram(gl, GROUND_DEPTH_VS, DEPTH_ONLY_FS);
    this.pNorm = makeProgram(gl, FSQ_VS, NORMAL_FROM_DEPTH_FS);
    this.pSao = makeProgram(gl, FSQ_VS, SAO_FS);
    this.pBlur = makeProgram(gl, FSQ_VS, AO_BILATERAL_BLUR_FS);
    this.pCopy = makeProgram(gl, FSQ_VS, COPY_FS);

    // uniforms
    this.uB_matrix = gl.getUniformLocation(this.pBuildings, "u_matrix");
    this.uG_matrix = gl.getUniformLocation(this.pGround, "u_matrix");
    this.uG_z = gl.getUniformLocation(this.pGround, "u_z");

    this.uN_tex = gl.getUniformLocation(this.pNorm, "u_depthTex");
    this.uN_invProj = gl.getUniformLocation(
      this.pNorm,
      "u_inverseProjectionMatrix",
    );
    this.uN_res = gl.getUniformLocation(this.pNorm, "u_resolution");

    this.uS_depth = gl.getUniformLocation(this.pSao, "u_depth");
    this.uS_normal = gl.getUniformLocation(this.pSao, "u_normal");
    this.uS_blueNoise = gl.getUniformLocation(this.pSao, "u_blueNoise");
    this.uS_invProj = gl.getUniformLocation(
      this.pSao,
      "u_inverseProjectionMatrix",
    );
    this.uS_res = gl.getUniformLocation(this.pSao, "u_resolution");
    this.uS_aoRes = gl.getUniformLocation(this.pSao, "u_aoResolution");
    this.uS_mpp = gl.getUniformLocation(this.pSao, "u_metersPerPixel");
    this.uS_params = gl.getUniformLocation(this.pSao, "u_params");
    this.uS_params2 = gl.getUniformLocation(this.pSao, "u_params2");
    this.uS_mode = gl.getUniformLocation(this.pSao, "u_mode");
    this.uS_compMode = gl.getUniformLocation(this.pSao, "u_compMode");
    this.uS_tint = gl.getUniformLocation(this.pSao, "u_tint");

    this.uC_tex = gl.getUniformLocation(this.pCopy, "u_tex");

    // blur uniforms (depth-aware AA)
    this.uBl_src = gl.getUniformLocation(this.pBlur, "u_src");
    this.uBl_depth = gl.getUniformLocation(this.pBlur, "u_depth");
    this.uBl_invProj = gl.getUniformLocation(
      this.pBlur,
      "u_inverseProjectionMatrix",
    );
    this.uBl_res = gl.getUniformLocation(this.pBlur, "u_resolution");
    this.uBl_dir = gl.getUniformLocation(this.pBlur, "u_dir");
    this.uBl_sigma = gl.getUniformLocation(this.pBlur, "u_sigma");
    this.uBl_dSigma = gl.getUniformLocation(this.pBlur, "u_depthSigma");

    // fullscreen quad VBO
    this.fsVBO = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, this.fsVBO);
    gl.bufferData(
      gl.ARRAY_BUFFER,
      new Float32Array([-1, -1, 1, -1, -1, 1, -1, 1, 1, -1, 1, 1]),
      gl.STATIC_DRAW,
    );

    // ground quad in tile space (0..8192)
    this.groundVBO = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, this.groundVBO);
    gl.bufferData(
      gl.ARRAY_BUFFER,
      new Int16Array([0, 0, 8192, 0, 8192, 8192, 0, 8192]),
      gl.STATIC_DRAW,
    );

    this.groundIBO = gl.createBuffer();
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.groundIBO);
    gl.bufferData(
      gl.ELEMENT_ARRAY_BUFFER,
      new Uint16Array([0, 1, 2, 0, 2, 3]),
      gl.STATIC_DRAW,
    );

    // blue-noise texture (try PNG, fallback procedural)
    this.blueNoiseTex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, this.blueNoiseTex);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.REPEAT);

    loadBlueNoisePNG(gl, this.blueNoiseTex, this.blueNoiseUrl).then((ok) => {
      if (!ok) createProceduralBlueNoise(gl, this.blueNoiseTex);
    });

    // --- camera movement tracking (как в shadows) ---
    this._onMoveStart = () => {
      this._isMoving = true;
    };

    this._onMoveEnd = () => {
      // камера остановилась → форсим один full-res пересчёт
      this._isMoving = false;
      this._needsRedraw = true;
      this._aoValid = false;
    };

    map.on("movestart", this._onMoveStart);
    map.on("move", this._onMoveStart);
    map.on("zoomstart", this._onMoveStart);
    map.on("pitchstart", this._onMoveStart);
    map.on("rotatestart", this._onMoveStart);

    map.on("moveend", this._onMoveEnd);
    map.on("zoomend", this._onMoveEnd);
    map.on("pitchend", this._onMoveEnd);
    map.on("rotateend", this._onMoveEnd);

    // GPU-таймер (если поддерживается) и HUD
    //this._gpuTimer = createGpuTimer(gl);
    //ensureShadowHud(this);
  }

  onRemove(map, gl) {
    map.off("moveend", this._onMoveEnd);
    map.off("movestart", this._onMoveStart);
    map.off("move", this._onMoveStart);
    map.off("zoomstart", this._onMoveStart);
    map.off("pitchstart", this._onMoveStart);
    map.off("rotatestart", this._onMoveStart);
    map.off("zoomend", this._onMoveEnd);
    map.off("pitchend", this._onMoveEnd);
    map.off("rotateend", this._onMoveEnd);
  }
  render(gl) {
    const dbg = this._getDbgView();

    const z = this.map.getZoom();
    if (z < this.minzoom || z >= this.maxzoom) return;

    const t = this.map.painter.transform;
    const center = this.map.getCenter();
    const bearing =
      typeof this.map.getBearing === "function"
        ? this.map.getBearing()
        : (t.bearing ?? t.angle ?? 0);

    // сигнатура камеры
    const camSig = [
      t.zoom,
      t.pitch,
      bearing,
      center && center.lng,
      center && center.lat,
    ].join("|");
    // full-res размеры буфера + оффскрин масштаб
    const fullW = gl.drawingBufferWidth | 0;
    const fullH = gl.drawingBufferHeight | 0;

    // Пока камера двигается — считаем AO в пониженном разрешении,
    // когда остановилась — пересчитываем один раз в full-res.
    const dynScale = this._isMoving
      ? this.offscreenScale * 0.75
      : this.offscreenScale;
    const w = Math.max(1, (fullW * dynScale) | 0);
    const h = Math.max(1, (fullH * dynScale) | 0);

    const sizeSig = `${fullW}x${fullH}x${dynScale.toFixed(2)}`;

    // камера/размер поменялись — пересчитать SAO

    if (camSig !== this._lastCamSig || sizeSig !== this._lastSizeSig) {
      this._lastCamSig = camSig;
      this._lastSizeSig = sizeSig;
      this._needsRedraw = true;
    }

    const tiles = getInViewTiles(this.map, this.sourceId);

    // --- учёт изменений тайлов, как в shadows.dev.js ---
    let tilesSig = "";
    let tileCount = 0;
    for (const k in tiles) {
      const tile = tiles[k];
      const bucket = tile?.buckets?.[this.buildingBucket];
      if (!bucket) continue;
      tileCount++;
      const id = tile.tileID;
      tilesSig += `${id?.key ?? k}:${id?.overscaledZ ?? 0}:${
        bucket.segments?.segments?.length ?? 0
      }|`;
    }
    tilesSig = `${tileCount}|` + tilesSig;

    if (tilesSig !== this._tilesSig) {
      this._tilesSig = tilesSig;
      this._needsRedraw = true;
    }

    const needUpdate = this._needsRedraw;

    if (needUpdate) {
      //if (this._gpuTimer) this._gpuTimer.begin();
      ensureFbo(gl, this.fboState, w, h);
      const proj = this.map.transform._projectionMatrix;
      invertMat4(this._invProjCached, proj);
      // PASS 1: depth-only into FBO
      gl.bindFramebuffer(gl.FRAMEBUFFER, this.fboState.fbo);
      gl.viewport(0, 0, w, h);

      gl.disable(gl.BLEND);
      gl.enable(gl.DEPTH_TEST);
      gl.depthFunc(gl.LESS);
      gl.depthMask(true);

      gl.clearColor(0, 0, 0, 0);
      gl.clearDepth(1.0);
      gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
      gl.colorMask(false, false, false, false);

      // 1) ground
      gl.useProgram(this.pGround);
      gl.uniform1f(this.uG_z, this.groundZ);

      gl.bindBuffer(gl.ARRAY_BUFFER, this.groundVBO);
      gl.enableVertexAttribArray(0);
      gl.vertexAttribPointer(0, 2, gl.SHORT, false, 4, 0);
      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.groundIBO);

      for (const k in tiles) {
        const tile = tiles[k];
        if (!tile?.tileID) continue;
        const m = t.calculatePosMatrix(tile.tileID);
        gl.uniformMatrix4fv(this.uG_matrix, false, m);
        gl.drawElements(gl.TRIANGLES, 6, gl.UNSIGNED_SHORT, 0);
      }

      // 2) buildings (from bucket)
      gl.useProgram(this.pBuildings);

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
        gl.uniformMatrix4fv(this.uB_matrix, false, m);

        gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, index.buffer);

        for (const s of bucket.segments.segments) {
          const stride = 12;
          const vOff = s.vertexOffset * stride;

          gl.bindBuffer(gl.ARRAY_BUFFER, layout.buffer);

          // a_pos (loc=0): vec2 short
          gl.enableVertexAttribArray(0);
          gl.vertexAttribPointer(0, 2, gl.SHORT, false, stride, 0 + vOff);

          // a_normal_ed (loc=1): vec4 short
          gl.enableVertexAttribArray(1);
          gl.vertexAttribPointer(1, 4, gl.SHORT, false, stride, 4 + vOff);

          // a_height (loc=3): float (paint attribute buffer)
          gl.enableVertexAttribArray(3);
          heightBuffer.bind();
          gl.vertexAttribPointer(3, 1, gl.FLOAT, false, 4, s.vertexOffset * 4);

          // a_base (loc=4): float (paint attribute buffer)
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

      gl.colorMask(true, true, true, true);
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);

      // PASS 2/3/4 only when dbg === 'sao'
      if (dbg !== "sao") {
        // (optional) you can add your debug views later, but keeping module clean for now
        this.map.triggerRepaint();
        return;
      }

      // Common fullscreen state
      gl.viewport(0, 0, w, h);
      gl.disable(gl.DEPTH_TEST);
      gl.depthMask(false);
      gl.disable(gl.BLEND);

      gl.bindBuffer(gl.ARRAY_BUFFER, this.fsVBO);
      gl.enableVertexAttribArray(0);
      gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 8, 0);

      // PASS 2: normals into RGBA8
      ensureColorTarget(gl, this._norm, w, h, gl.NEAREST);
      gl.bindFramebuffer(gl.FRAMEBUFFER, this._norm.fbo);
      gl.viewport(0, 0, w, h);
      gl.useProgram(this.pNorm);

      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, this.fboState.depthTex);
      gl.uniform1i(this.uN_tex, 0);

      gl.uniformMatrix4fv(this.uN_invProj, false, this._invProjCached);
      gl.uniform2f(this.uN_res, w, h);

      gl.drawArrays(gl.TRIANGLES, 0, 6);

      // PASS 3: SAO into RGBA8
      //ensureColorTarget(gl, this._ao, w, h, gl.NEAREST);
      //gl.bindFramebuffer(gl.FRAMEBUFFER, this._ao.fbo);

      // PASS 3: SAO into RGBA8 (raw)
      ensureColorTarget(gl, this._aoRaw, w, h, gl.NEAREST);
      gl.bindFramebuffer(gl.FRAMEBUFFER, this._aoRaw.fbo);

      gl.viewport(0, 0, w, h);
      gl.useProgram(this.pSao);

      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, this.fboState.depthTex);
      gl.activeTexture(gl.TEXTURE1);
      gl.bindTexture(gl.TEXTURE_2D, this._norm.tex);
      gl.activeTexture(gl.TEXTURE2);
      gl.bindTexture(gl.TEXTURE_2D, this.blueNoiseTex);

      gl.uniform1i(this.uS_depth, 0);
      gl.uniform1i(this.uS_normal, 1);
      gl.uniform1i(this.uS_blueNoise, 2);

      // inverse projection for depth->view
      gl.uniformMatrix4fv(this.uS_invProj, false, this._invProjCached);

      gl.uniform2f(this.uS_res, w, h);
      gl.uniform2f(this.uS_aoRes, w, h);

      // meters per pixel (approx WebMercator)
      const c = this.map.getCenter();
      const lat = c ? c.lat : 0;
      const mpp =
        (156543.03392804097 * Math.cos((lat * Math.PI) / 180)) /
        Math.pow(2, this.map.getZoom());
      gl.uniform1f(this.uS_mpp, mpp);

      const intensityL =
        interpZoomStops(z, this.saoLarge.intensityStops) / dynScale;
      const intensityS =
        interpZoomStops(z, this.saoSmall.intensityStops) / dynScale;

      gl.uniform4f(
        this.uS_params,
        this.saoLarge.radius,
        intensityL,
        this.saoLarge.bias,
        this.saoLarge.range,
      );
      gl.uniform4f(
        this.uS_params2,
        this.saoSmall.radius,
        intensityS,
        this.saoSmall.bias,
        this.saoSmall.range,
      );

      gl.uniform1i(this.uS_mode, this.saoMode);
      gl.uniform1i(this.uS_compMode, this.compositeMode === "screen" ? 1 : 0);
      gl.uniform3f(
        this.uS_tint,
        this.aoTint[0] / 255,
        this.aoTint[1] / 255,
        this.aoTint[2] / 255,
      );

      gl.drawArrays(gl.TRIANGLES, 0, 6);

      // PASS 3.5: depth-aware AA blur (fix jaggies at building bases)
      // Tunables: small radius but strong edge preservation
      const blurSigmaPx = 1.15;
      const blurDepthSigmaMeters = 1.25;

      ensureColorTarget(gl, this._aoTmp, w, h, gl.NEAREST);
      ensureColorTarget(gl, this._ao, w, h, gl.NEAREST);

      gl.useProgram(this.pBlur);

      // horizontal
      gl.bindFramebuffer(gl.FRAMEBUFFER, this._aoTmp.fbo);
      gl.viewport(0, 0, w, h);

      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, this._aoRaw.tex);
      gl.activeTexture(gl.TEXTURE1);
      gl.bindTexture(gl.TEXTURE_2D, this.fboState.depthTex);

      gl.uniform1i(this.uBl_src, 0);
      gl.uniform1i(this.uBl_depth, 1);
      gl.uniformMatrix4fv(this.uBl_invProj, false, this._invProjCached);
      gl.uniform2f(this.uBl_res, w, h);
      gl.uniform2f(this.uBl_dir, 1.0, 0.0);
      gl.uniform1f(this.uBl_sigma, blurSigmaPx);
      gl.uniform1f(this.uBl_dSigma, blurDepthSigmaMeters);

      gl.drawArrays(gl.TRIANGLES, 0, 6);

      // vertical
      gl.bindFramebuffer(gl.FRAMEBUFFER, this._ao.fbo);
      gl.viewport(0, 0, w, h);

      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, this._aoTmp.tex);
      gl.activeTexture(gl.TEXTURE1);
      gl.bindTexture(gl.TEXTURE_2D, this.fboState.depthTex);

      gl.uniform1i(this.uBl_src, 0);
      gl.uniform1i(this.uBl_depth, 1);
      gl.uniform2f(this.uBl_dir, 0.0, 1.0);

      gl.drawArrays(gl.TRIANGLES, 0, 6);
      // закончили обновление AO-текстуры
      this._needsRedraw = false;
    }

    // PASS 4: composite over default framebuffer
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);

    gl.viewport(0, 0, gl.drawingBufferWidth, gl.drawingBufferHeight);

    gl.useProgram(this.pCopy);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this._ao.tex);
    gl.uniform1i(this.uC_tex, 0);

    if (this.saoMode === 0) {
      gl.disable(gl.BLEND);
    } else {
      gl.enable(gl.BLEND);
      gl.blendEquation(gl.FUNC_ADD);
      if (this.compositeMode === "screen") {
        gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_COLOR);
      } else {
        gl.blendFunc(gl.ZERO, gl.SRC_COLOR);
      }
    }

    gl.drawArrays(gl.TRIANGLES, 0, 6);
    // Завершаем измерение и пушим в HUD

    // if (this._gpuTimer) {
    //   this._gpuTimer.end();
    //   const ms = this._gpuTimer.poll();
    //   if (ms != null) {
    //     pushShadowHudSample(this, ms);
    //   }
    // }

    // keep animating (MapLibre sometimes draws only 1 frame for custom layers)
    this.map.triggerRepaint();
  }
}
