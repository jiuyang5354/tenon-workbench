/**
 * metal-fx.js — Shared WebGL2 Liquid Metal Ring Engine (inspired by 21st.dev larsen66/metal-fx #21563)
 *
 * Drives all `[data-metal-fx]` wrappers with a SINGLE shared offscreen WebGL2 shader canvas
 * featuring laminar valley-field liquid mercury, Cauchy spectral dispersion (silver / chromatic),
 * cursor proximity reflection, and hover/press velocity ramp. Falls back cleanly to CSS rim if
 * WebGL2 is unavailable and pauses smoothly under prefers-reduced-motion.
 */
(() => {
  'use strict';

  const VERT_SRC = `#version 300 es
  in vec2 aPos;
  out vec2 vUv;
  void main() {
    vUv = aPos * 0.5 + 0.5;
    gl_Position = vec4(aPos, 0.0, 1.0);
  }`;

  const FRAG_SRC = `#version 300 es
  precision highp float;
  in vec2 vUv;
  out vec4 fragColor;

  uniform float uTime;
  uniform vec2 uPointer;
  uniform float uHover;
  uniform float uPreset; // 0.0 = silver/cryo-titanium, 1.0 = chromatic
  uniform float uLight;  // 0.0 = dark, 1.0 = light

  float valleyField(vec2 p, float t) {
    float wave = sin(p.x * 3.1 + t * 0.9) * 0.24
               + cos(p.x * 6.2 - t * 0.65) * 0.11
               + sin((p.x + p.y) * 4.4 + t * 0.5) * 0.14;
    float v = (p.y - wave) * (2.6 + 0.45 * sin(p.x * 2.0 + t * 0.4));
    float fold = sin(v * 3.2 + cos(p.x * 5.0 - t * 0.8) * 1.1);
    return fold;
  }

  vec3 sampleSpectrum(vec2 p, float t, float disp) {
    // Lightweight Cauchy spectral dispersion across R/G/B wavelengths
    float r = valleyField(p + vec2(disp * 0.045, disp * 0.018), t);
    float g = valleyField(p, t);
    float b = valleyField(p - vec2(disp * 0.045, disp * 0.022), t);
    vec3 bands = 0.5 + 0.5 * vec3(r, g, b);
    // Sharp metallic specular punch
    vec3 metal = pow(clamp(bands, 0.0, 1.0), vec3(2.35));
    // Subtle dark mercury base + crisp silver crest
    vec3 base = mix(vec3(0.11, 0.12, 0.15), vec3(0.95, 0.97, 1.0), metal);
    return base;
  }

  void main() {
    vec2 p = vUv * 2.0 - 1.0;
    // Cursor proximity well
    vec2 delta = p - uPointer;
    float dist = length(delta);
    float well = exp(-dist * dist * 3.2) * (0.28 + 0.35 * uHover);
    vec2 warped = p + normalize(delta + 1e-4) * well * 0.18;

    float disp = mix(0.14, 1.15, uPreset);
    vec3 col = sampleSpectrum(warped, uTime, disp);

    // Traveling perimeter specular glint
    float ang = atan(p.y, p.x);
    float glint1 = pow(max(0.0, cos(ang - uTime * 1.15)), 10.0);
    float glint2 = pow(max(0.0, cos(ang + uTime * 0.72 + 2.4)), 14.0);
    vec3 glintTint = mix(vec3(0.84, 0.91, 1.0), vec3(0.55, 0.76, 1.0), 0.45);
    col += glintTint * (glint1 * 0.95 + glint2 * 0.65);

    // Cursor specular bloom
    col += vec3(0.88, 0.94, 1.0) * exp(-dist * dist * 5.0) * (0.35 + 0.45 * uHover);

    // Subtle cobalt/titanium grading in dark mode; crisp graphite-silver in daylight
    if (uPreset < 0.5) {
      col *= vec3(0.92, 0.96, 1.04);
    } else {
      // Warm-gold + cool-blue iridescent chrome edge (matches 21st.dev screenshot)
      float edgeShift = sin(ang * 2.0 - uTime * 0.9);
      col *= mix(vec3(1.08, 0.96, 0.84), vec3(0.82, 0.92, 1.16), edgeShift * 0.5 + 0.5);
    }

    if (uLight > 0.5) {
      col = mix(vec3(0.20, 0.22, 0.26), col, 0.78);
    }

    fragColor = vec4(clamp(col, 0.0, 1.0), 1.0);
  }`;

  function compileShader(gl, type, src) {
    const sh = gl.createShader(type);
    gl.shaderSource(sh, src);
    gl.compileShader(sh);
    if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
      gl.deleteShader(sh);
      return null;
    }
    return sh;
  }

  function createSharedGL() {
    const off = document.createElement('canvas');
    off.width = 256;
    off.height = 96;
    const gl = off.getContext('webgl2', { antialias: true, alpha: true, powerPreference: 'low-power' });
    if (!gl) return null;

    const vs = compileShader(gl, gl.VERTEX_SHADER, VERT_SRC);
    const fs = compileShader(gl, gl.FRAGMENT_SHADER, FRAG_SRC);
    if (!vs || !fs) return null;

    const prog = gl.createProgram();
    gl.attachShader(prog, vs);
    gl.attachShader(prog, fs);
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) return null;

    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
    const loc = gl.getAttribLocation(prog, 'aPos');
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
    gl.useProgram(prog);

    return {
      canvas: off,
      gl,
      uniforms: {
        uTime: gl.getUniformLocation(prog, 'uTime'),
        uPointer: gl.getUniformLocation(prog, 'uPointer'),
        uHover: gl.getUniformLocation(prog, 'uHover'),
        uPreset: gl.getUniformLocation(prog, 'uPreset'),
        uLight: gl.getUniformLocation(prog, 'uLight'),
      },
    };
  }

  function roundedRectPath(ctx, x, y, w, h, r) {
    const rad = Math.min(r, w / 2, h / 2);
    ctx.beginPath();
    ctx.moveTo(x + rad, y);
    ctx.arcTo(x + w, y, x + w, y + h, rad);
    ctx.arcTo(x + w, y + h, x, y + h, rad);
    ctx.arcTo(x, y + h, x, y, rad);
    ctx.arcTo(x, y, x + w, y, rad);
    ctx.closePath();
  }

  function initMetalFx() {
    const wrappers = Array.from(document.querySelectorAll('[data-metal-fx]'));
    if (wrappers.length === 0) return { sync: () => {} };

    const shared = createSharedGL();
    if (!shared) {
      // Graceful CSS fallback
      document.documentElement.dataset.metalFallback = 'css';
      return { sync: () => {} };
    }

    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const instances = wrappers.map((wrap) => {
      const canvas = document.createElement('canvas');
      canvas.className = 'metal-fx-canvas';
      canvas.setAttribute('aria-hidden', 'true');
      wrap.prepend(canvas);
      const inst = {
        wrap,
        canvas,
        ctx: canvas.getContext('2d'),
        hover: 0,
        targetHover: 0,
        px: 0,
        py: 0,
        visible: true,
        ringWidth: Number(wrap.dataset.metalRing) || 2,
      };
      wrap.addEventListener('pointerenter', () => { inst.targetHover = 1; });
      wrap.addEventListener('pointerleave', () => { inst.targetHover = 0; });
      wrap.addEventListener('pointermove', (e) => {
        const r = wrap.getBoundingClientRect();
        if (r.width > 0 && r.height > 0) {
          inst.px = ((e.clientX - r.left) / r.width) * 2 - 1;
          inst.py = -(((e.clientY - r.top) / r.height) * 2 - 1);
        }
      });
      return inst;
    });

    if (typeof IntersectionObserver === 'function') {
      const io = new IntersectionObserver(
        (entries) => {
          entries.forEach((entry) => {
            const found = instances.find((i) => i.wrap === entry.target);
            if (found) found.visible = entry.isIntersecting;
          });
        },
        { rootMargin: '60px' }
      );
      instances.forEach((i) => io.observe(i.wrap));
    }

    let time = 0;
    let rafId = null;

    function renderFrame(advance = true) {
      const mode = document.documentElement.dataset.metal || 'chromatic';
      const motionEnabled = document.documentElement.dataset.motion !== 'off' && !reducedMotion;
      if (mode === 'off') {
        instances.forEach((i) => i.ctx.clearRect(0, 0, i.canvas.width, i.canvas.height));
        return;
      }

      const isLight = document.documentElement.dataset.surface === 'daylight' ? 1.0 : 0.0;
      const presetVal = mode === 'chromatic' ? 1.0 : 0.0;
      const dpr = Math.min(window.devicePixelRatio || 1, 2);

      if (advance && motionEnabled) {
        const anyHover = instances.some((i) => i.targetHover > 0);
        time += anyHover ? 0.032 : 0.015;
      }

      const { gl, uniforms, canvas: glCanvas } = shared;
      gl.viewport(0, 0, glCanvas.width, glCanvas.height);

      for (const inst of instances) {
        if (!inst.visible) continue;
        const rect = inst.wrap.getBoundingClientRect();
        if (rect.width <= 0 || rect.height <= 0) continue;

        inst.hover += (inst.targetHover - inst.hover) * 0.14;
        const cw = Math.max(1, Math.round(rect.width * dpr));
        const ch = Math.max(1, Math.round(rect.height * dpr));
        if (inst.canvas.width !== cw || inst.canvas.height !== ch) {
          inst.canvas.width = cw;
          inst.canvas.height = ch;
        }

        gl.uniform1f(uniforms.uTime, time);
        gl.uniform2f(uniforms.uPointer, inst.px, inst.py);
        gl.uniform1f(uniforms.uHover, inst.hover);
        gl.uniform1f(uniforms.uPreset, presetVal);
        gl.uniform1f(uniforms.uLight, isLight);
        gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);

        const ctx = inst.ctx;
        ctx.save();
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        ctx.clearRect(0, 0, rect.width, rect.height);

        const isPill = inst.wrap.dataset.metalVariant === 'pill' || inst.wrap.dataset.metalVariant === 'circle';
        const outerRadius = isPill ? Math.min(rect.width, rect.height) / 2 : 6;
        const ring = inst.ringWidth;

        // Draw rounded liquid-metal shell then punch clean inner cutout
        roundedRectPath(ctx, 0, 0, rect.width, rect.height, outerRadius);
        ctx.clip();
        ctx.drawImage(glCanvas, 0, 0, rect.width, rect.height);

        ctx.globalCompositeOperation = 'destination-out';
        roundedRectPath(
          ctx,
          ring,
          ring,
          Math.max(0, rect.width - ring * 2),
          Math.max(0, rect.height - ring * 2),
          Math.max(0, outerRadius - ring)
        );
        ctx.fill();
        ctx.restore();
      }
    }

    function loop() {
      const mode = document.documentElement.dataset.metal || 'chromatic';
      const motionEnabled = document.documentElement.dataset.motion !== 'off' && !reducedMotion;
      if (mode === 'off' || !motionEnabled) {
        rafId = null;
        return;
      }
      renderFrame(true);
      rafId = requestAnimationFrame(loop);
    }

    function sync() {
      const mode = document.documentElement.dataset.metal || 'chromatic';
      const motionEnabled = document.documentElement.dataset.motion !== 'off' && !reducedMotion;
      renderFrame(false);
      if (mode !== 'off' && motionEnabled && !rafId) {
        rafId = requestAnimationFrame(loop);
      } else if ((mode === 'off' || !motionEnabled) && rafId) {
        cancelAnimationFrame(rafId);
        rafId = null;
      }
    }

    window.addEventListener('resize', () => renderFrame(false));
    sync();
    return { sync };
  }

  window.ConduitMetalFx = { init: initMetalFx };
})();
