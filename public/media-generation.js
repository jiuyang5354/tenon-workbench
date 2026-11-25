(() => {
  'use strict';

  /**
   * CONDUIT Media Generation Suite — Zero-Dependency Native Port of 21st.dev `chatcn`
   *   1. ImageGeneration + GenerationFrame + GenerationGrain + ImageLightbox (image-generation.tsx)
   *   2. VideoGeneration + VideoPlayer (video-generation.tsx)
   *   3. Automatic Markdown/Path media extractor + procedural architectural studio demo generator
   *
   * Styled strictly to CONDUIT's locked Figma Weave (`DESIGN.md`) light/dark token palette.
   */

  let grainUid = 0;

  function escapeHtml(str) {
    return String(str || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function parseAspectRatio(ratio) {
    if (typeof ratio === 'number') return ratio > 0 ? ratio : 1;
    if (!ratio) return 1;
    const parts = String(ratio).split(':').map(Number);
    return parts[0] > 0 && parts[1] > 0 ? parts[0] / parts[1] : 1;
  }

  function clampCount(n) {
    return Math.min(4, Math.max(1, Math.round(n || 1)));
  }

  function columnsFor(total, ratio) {
    if (total === 4) return ratio < 1 ? 4 : 2;
    return total;
  }

  function slugify(text) {
    return (
      String(text || '')
        .toLowerCase()
        .replace(/[^a-z0-9\u4e00-\u9fa5]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, 32) || 'media'
    );
  }

  function extensionOf(src, fallback = 'png') {
    const data = /^data:(?:image|video)\/([a-z0-9]+)/i.exec(src || '');
    if (data?.[1]) return data[1] === 'jpeg' ? 'jpg' : data[1];
    const p = /\.([a-z0-9]{2,4})(?:[?#]|$)/i.exec(src || '');
    return p?.[1] || fallback;
  }

  function formatClock(seconds) {
    const s = Math.max(0, Math.floor(Number.isFinite(seconds) ? seconds : 0));
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    const rest = String(s % 60).padStart(2, '0');
    return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${rest}` : `${m}:${rest}`;
  }

  function formatDuration(ms, precise = false) {
    const safe = Math.max(0, ms);
    if (precise && safe < 1000) return `${Math.max(1, Math.round(safe))}\u00a0ms`;
    const s = safe / 1000;
    if (precise && s < 10) return `${s.toFixed(1)}\u00a0s`;
    if (s < 60) return `${precise ? Math.round(s) : Math.floor(s)}\u00a0s`;
    const totalS = Math.floor(s);
    const h = Math.floor(totalS / 3600);
    const m = Math.floor((totalS % 3600) / 60);
    const rest = totalS % 60;
    if (h > 0) return `${h}\u00a0h ${m}\u00a0m`;
    return `${m}\u00a0m ${rest}\u00a0s`;
  }

  function generationEtaLabel(ms, progress) {
    if (ms === undefined || ms === null || !Number.isFinite(ms)) return null;
    if (ms < 5000) return (progress ?? 0) >= 90 ? '即将完成' : '还剩数秒';
    const step = ms < 60_000 ? 5000 : 10_000;
    return `约 ${formatDuration(Math.ceil(ms / step) * step, false)} 剩余`;
  }

  function imageStageLabel(progress, plural) {
    if (progress === undefined || progress < 30) return plural ? '正在生成多组图像变体' : '正在创建图像';
    if (progress < 80) return '正在精修光影与细节';
    return '正在收尾锐化';
  }

  function videoStageLabel(progress) {
    if (progress === undefined || progress < 40) return '正在生成视频序列';
    if (progress < 88) return '正在逐帧渲染画面';
    return '正在封装编码';
  }

  /* --- Crisp 24px Stroke Icons matching chatcn --- */
  const ICONS = {
    copy: '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M11.5 9h7a2.5 2.5 0 0 1 2.5 2.5v7a2.5 2.5 0 0 1-2.5 2.5h-7A2.5 2.5 0 0 1 9 18.5v-7A2.5 2.5 0 0 1 11.5 9"/><path d="M6 15h-.5A2.5 2.5 0 0 1 3 12.5v-7A2.5 2.5 0 0 1 5.5 3h7A2.5 2.5 0 0 1 15 5.5V6"/></svg>',
    check: '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><path d="m4.5 12.75 3.23 3.23a2.5 2.5 0 0 0 3.54 0l8.48-8.48"/></svg>',
    upscale: '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M14.5 3.5H18A2.5 2.5 0 0 1 20.5 6v3.5"/><path d="m13.75 10.25 3.21-3.21"/><path d="M9.5 20.5H6A2.5 2.5 0 0 1 3.5 18v-3.5"/><path d="m10.25 13.75-3.21 3.21"/></svg>',
    vary: '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M2.75 18h1.96a3 3 0 0 0 2.64-1.57l4.8-8.86A3 3 0 0 1 14.79 6h2.46"/><path d="M2.75 6h1.96a3 3 0 0 1 2.64 1.57l.69 1.28"/><path d="m11.46 15.15.69 1.28A3 3 0 0 0 14.79 18h2.46"/><path d="m18 2.5 2.26 2.26a1.75 1.75 0 0 1 0 2.48L18 9.5"/><path d="m18 14.5 2.26 2.26a1.75 1.75 0 0 1 0 2.48L18 21.5"/></svg>',
    reference: '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M13 3H6a3 3 0 0 0-3 3v12a3 3 0 0 0 3 3h12a3 3 0 0 0 3-3v-7"/><path d="M15.25 5.5h6"/><path d="M18.25 2.5v6"/><path d="M6.75 8.5a1.75 1.75 0 1 0 3.5 0 1.75 1.75 0 1 0-3.5 0"/><path d="m6.5 18 4.59-4.59a2 2 0 0 1 2.82 0L17 16.5"/></svg>',
    download: '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M3.5 15v2.5a3 3 0 0 0 3 3h11a3 3 0 0 0 3-3V15"/><path d="m7.5 10.5 3.09 3.09a2 2 0 0 0 2.82 0l3.09-3.09"/><path d="M12 3.5v7"/></svg>',
    open: '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M3 8.5V6a3 3 0 0 1 3-3h2.5"/><path d="M15.5 3H18a3 3 0 0 1 3 3v2.5"/><path d="M21 15.5V18a3 3 0 0 1-3 3h-2.5"/><path d="M8.5 21H6a3 3 0 0 1-3-3v-2.5"/></svg>',
    minimize: '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M3.5 8.5H6A2.5 2.5 0 0 0 8.5 6V3.5"/><path d="M15.5 3.5V6A2.5 2.5 0 0 0 18 8.5h2.5"/><path d="M20.5 15.5H18a2.5 2.5 0 0 0-2.5 2.5v2.5"/><path d="M8.5 20.5V18A2.5 2.5 0 0 0 6 15.5H3.5"/></svg>',
    clock: '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M3 12a9 9 0 1 0 18 0 9 9 0 1 0-18 0"/><path d="M12 6.75v4.26a1.75 1.75 0 0 0 .85 1.5l2.9 1.74"/></svg>',
    error: '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M3 12a9 9 0 1 0 18 0 9 9 0 1 0-18 0"/><path d="m9 9 6 6"/><path d="m15 9-6 6"/></svg>',
    shield: '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="m13.63 3.31 5.02 1.73A2 2 0 0 1 20 6.93v5.32C20 17 16.5 20 12 21.5 7.5 20 4 17 4 12.25V6.93a2 2 0 0 1 1.35-1.89l5.02-1.73a5 5 0 0 1 3.26 0"/></svg>',
    retry: '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M5.49 17.46A8.5 8.5 0 1 0 6.54 5.49"/><path d="m8.21 8.65-2.94-.26a2 2 0 0 1-1.82-2.16l.26-2.94"/></svg>',
    play: '<svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor" stroke="none"><path d="m9.51 5.75 7.4 4.31a2.25 2.25 0 0 1 0 3.88l-7.4 4.31a2 2 0 0 1-3.01-1.73V7.48a2 2 0 0 1 3.01-1.73"/></svg>',
    pause: '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M8.5 5v14"/><path d="M15.5 5v14"/></svg>',
    volOn: '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M4.5 8.5h1.63a1.5 1.5 0 0 0 1.06-.44l1.68-1.68a1.25 1.25 0 0 1 2.13.89v9.46a1.25 1.25 0 0 1-2.13.89l-1.68-1.68a1.5 1.5 0 0 0-1.06-.44H4.5A1.5 1.5 0 0 1 3 14v-4a1.5 1.5 0 0 1 1.5-1.5"/><path d="M14.93 9.03a4 4 0 0 1 0 5.94"/><path d="M17.18 5.7a8 8 0 0 1 0 12.6"/></svg>',
    volOff: '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M4.5 8.5h1.63a1.5 1.5 0 0 0 1.06-.44l1.68-1.68a1.25 1.25 0 0 1 2.13.89v9.46a1.25 1.25 0 0 1-2.13.89l-1.68-1.68a1.5 1.5 0 0 0-1.06-.44H4.5A1.5 1.5 0 0 1 3 14v-4a1.5 1.5 0 0 1 1.5-1.5"/><path d="m15.25 9.25 5.5 5.5"/><path d="m20.75 9.25-5.5 5.5"/></svg>',
    chevL: '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="m14.75 6-4.23 4.23a2.5 2.5 0 0 0 0 3.54L14.75 18"/></svg>',
    chevR: '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="m9.25 18 4.23-4.23a2.5 2.5 0 0 0 0-3.54L9.25 6"/></svg>',
    close: '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="m6 6 12 12"/><path d="m18 6-12 12"/></svg>',
    spinner: '<svg class="mg-spin" viewBox="0 0 16 16" width="14" height="14" fill="none"><circle cx="8" cy="8" r="6.25" stroke="currentColor" stroke-opacity="0.22" stroke-width="1.5"/><path d="M8 1.75A6.25 6.25 0 0 1 14.25 8" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>',
  };

  function grainSvgHtml() {
    const id = `mg-grain-${++grainUid}`;
    return `
      <svg class="mg-grain" aria-hidden="true" data-slot="generation-grain">
        <filter id="${id}" x="0" y="0" width="100%" height="100%">
          <feTurbulence type="fractalNoise" baseFrequency="0.8" numOctaves="2" stitchTiles="stitch" />
          <feColorMatrix values="0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  1.6 0 0 0 -0.5" />
        </filter>
        <rect width="100%" height="100%" filter="url(#${id})" />
      </svg>`;
  }

  /* =========================================================================
     Shared Global ImageLightbox Singleton
     ========================================================================= */
  let lightboxState = null;
  let lightboxEl = null;

  function ensureLightbox() {
    if (lightboxEl) return lightboxEl;
    lightboxEl = document.createElement('div');
    lightboxEl.id = 'conduitMediaLightbox';
    lightboxEl.className = 'mg-lightbox hidden';
    lightboxEl.setAttribute('role', 'dialog');
    lightboxEl.setAttribute('aria-modal', 'true');
    lightboxEl.innerHTML = `
      <div class="mg-lb-backdrop" data-lb-close></div>
      <div class="mg-lb-dialog">
        <header class="mg-lb-head">
          <h3 class="mg-lb-title" id="mgLbTitle"></h3>
          <span class="mg-lb-counter mono-xs" id="mgLbCounter"></span>
          <a class="mg-icon-btn" id="mgLbDownload" download aria-label="下载原图" title="下载原图">${ICONS.download}</a>
          <button type="button" class="mg-icon-btn" data-lb-close aria-label="关闭 [Esc]" title="关闭 [Esc]">${ICONS.close}</button>
        </header>
        <div class="mg-lb-stage" tabindex="-1" id="mgLbStage">
          <img class="mg-lb-img" id="mgLbImg" alt="" draggable="false" />
          <button type="button" class="mg-lb-nav is-prev" id="mgLbPrev" aria-label="上一张">${ICONS.chevL}</button>
          <button type="button" class="mg-lb-nav is-next" id="mgLbNext" aria-label="下一张">${ICONS.chevR}</button>
        </div>
      </div>`;
    document.body.appendChild(lightboxEl);

    lightboxEl.querySelectorAll('[data-lb-close]').forEach((n) => n.addEventListener('click', closeLightbox));
    lightboxEl.querySelector('#mgLbPrev').addEventListener('click', () => stepLightbox(-1));
    lightboxEl.querySelector('#mgLbNext').addEventListener('click', () => stepLightbox(1));
    document.addEventListener('keydown', (e) => {
      if (!lightboxState) return;
      if (e.key === 'Escape') { e.preventDefault(); closeLightbox(); }
      else if (e.key === 'ArrowRight') { e.preventDefault(); stepLightbox(1); }
      else if (e.key === 'ArrowLeft') { e.preventDefault(); stepLightbox(-1); }
    });
    return lightboxEl;
  }

  function renderLightbox() {
    if (!lightboxState || !lightboxEl) return;
    const { images, index } = lightboxState;
    const cur = images[index];
    if (!cur) return;
    lightboxEl.querySelector('#mgLbTitle').textContent = cur.caption || cur.alt || '图像预览';
    const cnt = lightboxEl.querySelector('#mgLbCounter');
    cnt.textContent = images.length > 1 ? `${index + 1} / ${images.length}` : '';
    cnt.classList.toggle('hidden', images.length <= 1);
    const dl = lightboxEl.querySelector('#mgLbDownload');
    dl.href = cur.src;
    dl.download = cur.filename || 'image.png';
    const img = lightboxEl.querySelector('#mgLbImg');
    img.src = cur.src;
    img.alt = cur.alt || '';
    lightboxEl.querySelector('#mgLbPrev').classList.toggle('hidden', images.length <= 1);
    lightboxEl.querySelector('#mgLbNext').classList.toggle('hidden', images.length <= 1);
  }

  function openLightbox(images, startIndex = 0, onIndexChange = null) {
    if (!images || !images.length) return;
    ensureLightbox();
    lightboxState = {
      images,
      index: Math.max(0, Math.min(startIndex, images.length - 1)),
      onIndexChange,
    };
    renderLightbox();
    lightboxEl.classList.remove('hidden');
    requestAnimationFrame(() => lightboxEl.querySelector('#mgLbStage')?.focus({ preventScroll: true }));
  }

  function stepLightbox(delta) {
    if (!lightboxState || lightboxState.images.length <= 1) return;
    const n = lightboxState.images.length;
    lightboxState.index = (lightboxState.index + delta + n) % n;
    renderLightbox();
    if (lightboxState.onIndexChange) lightboxState.onIndexChange(lightboxState.index);
  }

  function closeLightbox() {
    if (!lightboxEl) return;
    lightboxEl.classList.add('hidden');
    lightboxState = null;
  }

  /* =========================================================================
     Helper: Wire CopyButton with 150ms blur crossfade to Check icon
     ========================================================================= */
  function bindCopyButton(btn, getText, onToast) {
    if (!btn) return;
    let timer = null;
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const text = typeof getText === 'function' ? getText() : String(getText || '');
      if (!text) return;
      navigator.clipboard?.writeText(text).then(() => {
        btn.classList.add('is-copied');
        if (onToast) onToast('已复制提示词');
        clearTimeout(timer);
        timer = setTimeout(() => btn.classList.remove('is-copied'), 1500);
      }).catch(() => {});
    });
  }

  /* =========================================================================
     1. ImageGeneration Component (Native Zero-Dep Port of image-generation.tsx)
     ========================================================================= */
  function renderGenerationFrameHtml({ image, phase, progress, ratio, instant, alt, extraClass = '' }) {
    const src = image?.src || '';
    const blurSrc = image?.previewSrc || src;
    const done = phase === 'done';
    const showImg = Boolean(src) && (phase === 'generating' || done);
    const known = progress !== undefined && progress !== null;
    const p = done ? 1 : phase === 'generating' && known ? Math.max(0, Math.min(1, progress / 100)) : 0;
    const scanning = phase === 'generating' && known && p > 0 && p < 1;
    const clip = `inset(0 0 ${((1 - p) * 100).toFixed(2)}% 0)`;
    const blurPx = Math.round(4 + (1 - p) * 20);

    return `
      <div class="mg-frame ${done ? 'is-done' : ''} ${instant ? 'is-instant' : ''} ${extraClass}" data-slot="generation-frame" data-frame-phase="${escapeHtml(phase)}" style="aspect-ratio:${ratio}">
        ${grainSvgHtml()}
        ${phase === 'generating' && known && !src ? `<span class="mg-progress-tone" style="clip-path:${clip}" aria-hidden="true"></span>` : ''}
        ${showImg && blurSrc && !instant ? `<img class="mg-img-blur ${done ? 'is-hidden' : ''}" src="${escapeHtml(blurSrc)}" alt="" aria-hidden="true" draggable="false" style="filter:blur(${blurPx}px) grayscale(0.2)" />` : ''}
        ${showImg ? `<img class="mg-img-sharp ${done ? 'is-revealed' : ''}" src="${escapeHtml(src)}" alt="${done ? escapeHtml(alt) : ''}" draggable="false" decoding="async" ${instant ? '' : `style="clip-path:${clip}"`} />` : ''}
        <span class="mg-scan-wrap ${scanning ? 'is-scanning' : ''}" aria-hidden="true" style="transform:translateY(${(p * 100).toFixed(2)}%)">
          <span class="mg-scan-line"></span>
        </span>
        <span class="mg-tile-hover" aria-hidden="true"></span>
        <span class="mg-hairline" aria-hidden="true"></span>
      </div>`;
  }

  function mountImageGeneration(container, initialOpts) {
    if (!container) return null;
    let opts = {
      prompt: '',
      status: 'done',
      images: [],
      count: undefined,
      aspectRatio: '4:3',
      progress: undefined,
      etaMs: undefined,
      queuePosition: undefined,
      statusText: undefined,
      settings: [],
      showPrompt: true,
      errorText: undefined,
      blockedText: undefined,
      busyAction: undefined,
      selectedIndex: 0,
      instant: initialOpts?.status === 'done',
      ...initialOpts,
    };

    const etaTracker = { start: null, rate: null, est: null };

    function computeEta() {
      if (opts.status !== 'generating') {
        etaTracker.start = null;
        etaTracker.rate = null;
        etaTracker.est = null;
        return undefined;
      }
      if (opts.etaMs !== undefined) return opts.etaMs;
      if (opts.progress === undefined) return undefined;
      const t = Date.now();
      if (!etaTracker.start) {
        etaTracker.start = { t, p: opts.progress };
        return undefined;
      }
      const dt = t - etaTracker.start.t;
      const dp = opts.progress - etaTracker.start.p;
      if (dt >= 1200 && dp >= 3) {
        const measured = dp / dt;
        etaTracker.rate = etaTracker.rate === null ? measured : etaTracker.rate * 0.7 + measured * 0.3;
        const ms = Math.max(0, (100 - opts.progress) / etaTracker.rate);
        etaTracker.est = { ms, at: t };
      }
      if (!etaTracker.est) return undefined;
      return Math.max(0, etaTracker.est.ms - (t - etaTracker.est.at));
    }

    function render() {
      const total = clampCount(opts.count ?? Math.max((opts.images || []).length, 1));
      const ratio = parseAspectRatio(opts.aspectRatio);
      const cols = columnsFor(total, ratio);
      const done = opts.status === 'done';
      const single = total === 1;
      const selected = Math.max(0, Math.min(opts.selectedIndex || 0, total - 1));
      opts.selectedIndex = selected;
      const slots = Array.from({ length: total }, (_, i) => (opts.images || [])[i]);
      const current = slots[selected];

      const facts = [
        typeof opts.aspectRatio === 'string' ? opts.aspectRatio : null,
        total > 1 ? `${total} 组变体` : null,
        ...(opts.settings || []),
      ].filter(Boolean);

      const percent = opts.progress === undefined ? undefined : Math.round(Math.min(100, opts.progress));
      const stageText = opts.statusText || imageStageLabel(opts.progress, total > 1);
      const etaText = generationEtaLabel(computeEta(), opts.progress);
      const settled = opts.status === 'failed' || opts.status === 'blocked';
      const maxWStyle = single && ratio < 1 ? `max-width:${Math.round(32 * ratio * 10) / 10}rem;margin-inline:auto;` : '';

      const gridHtml = slots
        .map((img, i) => {
          const frameProgress = img?.progress ?? opts.progress;
          const alt = img?.alt || (total > 1 ? `${opts.prompt} (变体 ${i + 1})` : opts.prompt);
          const framePhase = done && !img?.src ? 'failed' : opts.status;
          const frame = renderGenerationFrameHtml({
            image: img,
            phase: framePhase,
            progress: frameProgress,
            ratio,
            instant: opts.instant,
            alt,
          });
          if (!done || !img?.src) {
            return `<div class="mg-tile ${single ? 'is-single' : ''}">${frame}</div>`;
          }
          if (single) {
            return `<button type="button" class="mg-tile is-single is-zoomable" data-mg-open="${i}" aria-label="放大查看图像">${frame}</button>`;
          }
          const isSel = i === selected;
          return `
            <button
              type="button"
              class="mg-tile is-selectable ${isSel ? 'is-selected' : ''}"
              role="radio"
              aria-checked="${isSel}"
              aria-label="变体 ${i + 1}"
              tabindex="${isSel ? 0 : -1}"
              data-mg-select="${i}"
            >
              ${frame}
              <span class="mg-tile-ring" aria-hidden="true"></span>
            </button>`;
        })
        .join('');

      let noticeHtml = '';
      if (opts.status === 'failed') {
        noticeHtml = `
          <div class="mg-notice is-error" data-slot="generation-notice">
            <div class="mg-notice-inner">
              <span class="mg-notice-icon">${ICONS.error}</span>
              <p class="mg-notice-title">图像生成中断</p>
              <p class="mg-notice-desc">${escapeHtml(opts.errorText || '图像渲染服务暂时无响应，请稍后重试。')}</p>
              ${opts.onRetry ? `<div class="mg-notice-actions"><button type="button" class="mg-btn is-outline" data-mg-retry>${ICONS.retry}<span>重新生成</span></button></div>` : ''}
            </div>
          </div>`;
      } else if (opts.status === 'blocked') {
        noticeHtml = `
          <div class="mg-notice" data-slot="generation-notice">
            <div class="mg-notice-inner">
              <span class="mg-notice-icon">${ICONS.shield}</span>
              <p class="mg-notice-title">未能创建该图像</p>
              <p class="mg-notice-desc">${escapeHtml(opts.blockedText || '提示词可能触及内容策略，建议改为描述场景、构图与光影氛围。')}</p>
              ${opts.onEditPrompt ? `<div class="mg-notice-actions"><button type="button" class="mg-btn is-outline" data-mg-edit>编辑提示词</button></div>` : ''}
            </div>
          </div>`;
      }

      let footerHtml = '';
      if (!settled) {
        let leftHtml = '';
        let rightHtml = '';
        if (opts.status === 'queued') {
          leftHtml = `
            <div class="mg-status-line">
              <span class="mg-muted-icon">${ICONS.clock}</span>
              <span class="mg-status-strong">排队中</span>
              ${opts.queuePosition ? `<span class="mg-status-sub mono">第 ${opts.queuePosition} 位</span>` : ''}
            </div>`;
          if (opts.onCancel) rightHtml = `<button type="button" class="mg-btn is-ghost" data-mg-cancel>取消</button>`;
        } else if (opts.status === 'generating') {
          leftHtml = `
            <div class="mg-status-line" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${percent ?? 0}">
              <span class="mg-shimmer">${escapeHtml(stageText)}</span>
              ${percent !== undefined ? `<span class="mg-status-sub mono">${percent}%</span>` : ''}
              ${etaText ? `<span class="mg-dot">·</span><span class="mg-status-sub mono">${escapeHtml(etaText)}</span>` : ''}
            </div>`;
          if (opts.onCancel) rightHtml = `<button type="button" class="mg-btn is-ghost" data-mg-cancel>取消</button>`;
        } else {
          const busy = opts.busyAction;
          const actBtns = [];
          if (opts.onUpscale && current) {
            actBtns.push(`<button type="button" class="mg-btn is-ghost" data-mg-act="upscale" ${busy ? 'disabled' : ''}>${busy === 'upscale' ? ICONS.spinner : ICONS.upscale}<span>高清放大</span></button>`);
          }
          if (opts.onVary && current) {
            actBtns.push(`<button type="button" class="mg-btn is-ghost" data-mg-act="vary" ${busy ? 'disabled' : ''}>${busy === 'vary' ? ICONS.spinner : ICONS.vary}<span>微调变体</span></button>`);
          }
          if (opts.onUseAsReference && current) {
            actBtns.push(`<button type="button" class="mg-btn is-ghost" data-mg-act="reference" ${busy ? 'disabled' : ''}>${busy === 'reference' ? ICONS.spinner : ICONS.reference}<span>作为参考图</span></button>`);
          }
          leftHtml = `<div class="mg-actions-row">${actBtns.join('')}</div>`;
          if (current?.src) {
            const dlName = current.filename || `${slugify(opts.prompt)}${total > 1 ? `-${selected + 1}` : ''}.${extensionOf(current.src)}`;
            rightHtml = `
              <div class="mg-right-tools">
                ${total > 1 ? `<span class="mg-counter mono-xs">${selected + 1} / ${total}</span>` : ''}
                <a class="mg-icon-btn" href="${escapeHtml(current.src)}" download="${escapeHtml(dlName)}" aria-label="下载图像" title="下载图像">${ICONS.download}</a>
                <button type="button" class="mg-icon-btn" data-mg-open="${selected}" aria-label="全屏查看" title="全屏查看">${ICONS.open}</button>
              </div>`;
          }
        }
        footerHtml = `<div class="mg-footer" data-slot="image-generation-footer">${leftHtml}${rightHtml}</div>`;
      }

      container.innerHTML = `
        <div class="mg-card" data-slot="image-generation" data-generation-state="${escapeHtml(opts.status)}">
          ${
            opts.showPrompt
              ? `<div class="mg-header" data-slot="image-generation-header">
                  <div class="mg-header-text">
                    <p class="mg-prompt">${escapeHtml(opts.prompt)}</p>
                    ${facts.length ? `<p class="mg-facts mono-xs">${facts.map((f) => `<span>${escapeHtml(f)}</span>`).join('<span class="mg-dot">·</span>')}</p>` : ''}
                  </div>
                  <button type="button" class="mg-icon-btn mg-copy-btn" data-mg-copy aria-label="复制提示词" title="复制提示词">
                    <span class="mg-copy-ico">${ICONS.copy}</span>
                    <span class="mg-check-ico">${ICONS.check}</span>
                  </button>
                </div>`
              : ''
          }
          <div class="mg-stage-wrap">
            <div
              class="mg-grid"
              data-slot="image-generation-grid"
              ${done && total > 1 ? 'role="radiogroup" aria-label="图像变体"' : ''}
              style="grid-template-columns:repeat(${cols},minmax(0,1fr));${maxWStyle}"
            >
              ${gridHtml}
            </div>
            ${noticeHtml}
          </div>
          ${footerHtml}
        </div>`;

      // Bind copy
      bindCopyButton(container.querySelector('[data-mg-copy]'), () => opts.prompt, opts.onToast);

      // Build ready list for lightbox
      const ready = slots.map((img, i) => (img?.src ? { img, i } : null)).filter(Boolean);
      const lbList = ready.map(({ img, i }) => ({
        src: img.src,
        alt: img.alt || opts.prompt,
        caption: opts.prompt,
        filename: img.filename || `${slugify(opts.prompt)}${total > 1 ? `-${i + 1}` : ''}.${extensionOf(img.src)}`,
      }));
      const launchLightbox = (slotIdx) => {
        const pos = ready.findIndex((r) => r.i === slotIdx);
        if (pos < 0) return;
        opts.selectedIndex = slotIdx;
        render();
        openLightbox(lbList, pos, (nextLbIdx) => {
          const hit = ready[nextLbIdx];
          if (hit) {
            opts.selectedIndex = hit.i;
            render();
          }
        });
      };

      // Selection & Double-click to open lightbox
      container.querySelectorAll('[data-mg-select]').forEach((btn) => {
        const idx = Number(btn.dataset.mgSelect);
        btn.addEventListener('click', () => {
          opts.selectedIndex = idx;
          render();
          container.querySelector(`[data-mg-select="${idx}"]`)?.focus({ preventScroll: true });
        });
        btn.addEventListener('dblclick', () => launchLightbox(idx));
      });

      container.querySelectorAll('[data-mg-open]').forEach((btn) => {
        btn.addEventListener('click', () => launchLightbox(Number(btn.dataset.mgOpen)));
      });

      // Keyboard radiogroup navigation (Arrow keys / Home / End / Enter)
      const gridEl = container.querySelector('[data-slot="image-generation-grid"]');
      if (gridEl && done && total > 1) {
        gridEl.addEventListener('keydown', (e) => {
          const step = { ArrowRight: 1, ArrowLeft: -1, ArrowDown: cols, ArrowUp: -cols };
          let next;
          if (e.key in step) next = (opts.selectedIndex + step[e.key] + total) % total;
          else if (e.key === 'Home') next = 0;
          else if (e.key === 'End') next = total - 1;
          else if (e.key === 'Enter') { e.preventDefault(); launchLightbox(opts.selectedIndex); return; }
          if (next === undefined) return;
          e.preventDefault();
          opts.selectedIndex = next;
          render();
          container.querySelector(`[data-mg-select="${next}"]`)?.focus({ preventScroll: true });
        });
      }

      container.querySelectorAll('[data-mg-act]').forEach((btn) => {
        btn.addEventListener('click', () => {
          const act = btn.dataset.mgAct;
          if (!current) return;
          if (act === 'upscale' && opts.onUpscale) opts.onUpscale(current, selected, api);
          if (act === 'vary' && opts.onVary) opts.onVary(current, selected, api);
          if (act === 'reference' && opts.onUseAsReference) opts.onUseAsReference(current, selected, api);
        });
      });

      container.querySelector('[data-mg-cancel]')?.addEventListener('click', () => opts.onCancel?.(api));
      container.querySelector('[data-mg-retry]')?.addEventListener('click', () => opts.onRetry?.(api));
      container.querySelector('[data-mg-edit]')?.addEventListener('click', () => opts.onEditPrompt?.(api));
    }

    const api = {
      update(patch) {
        opts = { ...opts, ...patch };
        if (patch.status && patch.status !== 'done') opts.instant = false;
        render();
      },
      getState() {
        return { ...opts };
      },
    };

    render();
    return api;
  }

  /* =========================================================================
     2. VideoPlayer + VideoGeneration Component (Native Port of video-generation.tsx)
     ========================================================================= */
  function mountVideoPlayer(slotEl, { src, poster, title, duration: durationProp, autoPlay = false, loop = true, ratio = 16 / 9 }) {
    slotEl.innerHTML = `
      <div class="mg-vplayer" role="group" aria-label="视频播放器: ${escapeHtml(title)}" tabindex="-1" data-slot="video-player" style="aspect-ratio:${ratio}">
        <video class="mg-vplayer-video" src="${escapeHtml(src)}" ${poster ? `poster="${escapeHtml(poster)}"` : ''} ${autoPlay ? 'autoplay muted' : ''} ${loop ? 'loop' : ''} playsinline preload="metadata"></video>
        <button type="button" class="mg-vplayer-center-play" aria-label="播放视频">
          <span class="mg-play-shift">${ICONS.play}</span>
        </button>
        <div class="mg-vplayer-bar" data-slot="video-player-controls">
          <button type="button" class="mg-icon-btn" data-vp-toggle aria-label="播放 / 暂停">${ICONS.play}</button>
          <span class="mg-vp-time mono-xs"><span data-vp-cur>0:00</span><span class="mg-vp-dur"> / ${formatClock(Math.round(durationProp || 0))}</span></span>
          <div class="mg-vp-scrub">
            <span class="mg-vp-track"><span class="mg-vp-fill" data-vp-fill></span></span>
            <span class="mg-vp-thumb" data-vp-thumb></span>
            <input type="range" class="mg-vp-range" min="0" max="${durationProp || 1}" step="0.05" value="0" aria-label="拖动进度条" />
          </div>
          <button type="button" class="mg-icon-btn" data-vp-mute aria-label="静音 / 取消静音" title="静音 (M)">${autoPlay ? ICONS.volOff : ICONS.volOn}</button>
          <button type="button" class="mg-icon-btn" data-vp-fs aria-label="全屏" title="全屏 (F)">${ICONS.open}</button>
        </div>
        <span class="mg-hairline" aria-hidden="true"></span>
      </div>`;

    const root = slotEl.querySelector('.mg-vplayer');
    const video = root.querySelector('video');
    const centerPlay = root.querySelector('.mg-vplayer-center-play');
    const bar = root.querySelector('.mg-vplayer-bar');
    const btnToggle = root.querySelector('[data-vp-toggle]');
    const curEl = root.querySelector('[data-vp-cur]');
    const durEl = root.querySelector('.mg-vp-dur');
    const fillEl = root.querySelector('[data-vp-fill]');
    const thumbEl = root.querySelector('[data-vp-thumb]');
    const rangeEl = root.querySelector('.mg-vp-range');
    const btnMute = root.querySelector('[data-vp-mute]');
    const btnFs = root.querySelector('[data-vp-fs]');

    let started = Boolean(autoPlay);
    let playing = false;
    let ended = false;
    let duration = durationProp || 0;
    let idle = false;
    let idleTimer = null;
    let rafId = 0;

    function syncBar() {
      centerPlay.classList.toggle('hidden', started);
      const show = started && (!playing || !idle);
      bar.classList.toggle('is-visible', show);
      root.classList.toggle('is-cursor-hidden', started && playing && !show);
      btnToggle.innerHTML = playing ? ICONS.pause : ended ? ICONS.retry : ICONS.play;
      btnMute.innerHTML = video.muted ? ICONS.volOff : ICONS.volOn;
      btnFs.innerHTML = document.fullscreenElement === root ? ICONS.minimize : ICONS.open;
    }

    function syncProgress() {
      const t = video.currentTime || 0;
      const d = duration || video.duration || 0;
      const p = d > 0 ? Math.min(1, t / d) : 0;
      curEl.textContent = formatClock(t);
      if (d > 0 && Number.isFinite(d)) {
        durEl.textContent = ` / ${formatClock(Math.round(d))}`;
        rangeEl.max = String(d);
      }
      rangeEl.value = String(Math.min(t, d || t));
      fillEl.style.transform = `scaleX(${p})`;
      thumbEl.style.left = `${(p * 100).toFixed(2)}%`;
    }

    function wake() {
      idle = false;
      clearTimeout(idleTimer);
      idleTimer = setTimeout(() => {
        idle = true;
        syncBar();
      }, 2000);
      syncBar();
    }

    function toggle() {
      if (video.paused || video.ended) {
        started = true;
        video.play().catch(() => {});
      } else {
        video.pause();
      }
    }

    function seek(to) {
      const d = duration || (Number.isFinite(video.duration) ? video.duration : 0);
      video.currentTime = Math.min(Math.max(0, to), d || 0);
      ended = false;
      syncProgress();
    }

    function tick() {
      if (!playing || !video.isConnected) { rafId = 0; return; }
      syncProgress();
      rafId = requestAnimationFrame(tick);
    }

    video.addEventListener('play', () => {
      started = true;
      playing = true;
      ended = false;
      wake();
      if (!rafId) rafId = requestAnimationFrame(tick);
    });
    video.addEventListener('pause', () => {
      playing = false;
      syncBar();
    });
    video.addEventListener('ended', () => {
      playing = false;
      ended = true;
      syncProgress();
      syncBar();
    });
    video.addEventListener('timeupdate', syncProgress);
    video.addEventListener('loadedmetadata', () => {
      if (Number.isFinite(video.duration) && video.duration > 0) {
        duration = video.duration;
        syncProgress();
      }
    });

    centerPlay.addEventListener('click', toggle);
    video.addEventListener('click', toggle);
    btnToggle.addEventListener('click', toggle);
    rangeEl.addEventListener('input', (e) => seek(Number(e.target.value)));
    btnMute.addEventListener('click', () => {
      video.muted = !video.muted;
      syncBar();
    });
    btnFs.addEventListener('click', () => {
      if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
      else root.requestFullscreen?.().catch(() => {});
    });
    document.addEventListener('fullscreenchange', syncBar);

    root.addEventListener('pointermove', wake);
    root.addEventListener('pointerleave', () => {
      if (playing) { idle = true; syncBar(); }
    });
    root.addEventListener('keydown', (e) => {
      const key = e.key.toLowerCase();
      if (key === 'k' || (key === ' ' && e.target === root)) { e.preventDefault(); toggle(); wake(); }
      else if (key === 'arrowleft') { e.preventDefault(); seek((video.currentTime || 0) - 5); wake(); }
      else if (key === 'arrowright') { e.preventDefault(); seek((video.currentTime || 0) + 5); wake(); }
      else if (key === 'm') { video.muted = !video.muted; syncBar(); wake(); }
      else if (key === 'f') { btnFs.click(); wake(); }
    });

    syncBar();
    syncProgress();
  }

  function mountVideoGeneration(container, initialOpts) {
    if (!container) return null;
    let opts = {
      prompt: '',
      status: 'done',
      progress: undefined,
      queuePosition: undefined,
      etaMs: undefined,
      posterSrc: undefined,
      src: undefined,
      duration: 4,
      resolution: '1080p',
      fps: 24,
      audio: false,
      aspectRatio: '16:9',
      settings: [],
      statusText: undefined,
      errorText: undefined,
      blockedText: undefined,
      filename: undefined,
      autoPlay: false,
      loop: true,
      instant: initialOpts?.status === 'done',
      ...initialOpts,
    };

    const etaTracker = { start: null, rate: null, est: null };
    let mountedSrc = '';

    function computeEta() {
      if (opts.status !== 'generating') {
        etaTracker.start = null;
        etaTracker.rate = null;
        etaTracker.est = null;
        return undefined;
      }
      if (opts.etaMs !== undefined) return opts.etaMs;
      if (opts.progress === undefined) return undefined;
      const t = Date.now();
      if (!etaTracker.start) {
        etaTracker.start = { t, p: opts.progress };
        return undefined;
      }
      const dt = t - etaTracker.start.t;
      const dp = opts.progress - etaTracker.start.p;
      if (dt >= 1200 && dp >= 3) {
        const measured = dp / dt;
        etaTracker.rate = etaTracker.rate === null ? measured : etaTracker.rate * 0.7 + measured * 0.3;
        etaTracker.est = { ms: Math.max(0, (100 - opts.progress) / etaTracker.rate), at: t };
      }
      if (!etaTracker.est) return undefined;
      return Math.max(0, etaTracker.est.ms - (t - etaTracker.est.at));
    }

    function render() {
      const ratio = parseAspectRatio(opts.aspectRatio);
      const generating = opts.status === 'generating';
      const done = opts.status === 'done' && Boolean(opts.src);
      const settled = opts.status === 'failed' || opts.status === 'blocked';
      const percent = opts.progress === undefined ? undefined : Math.round(Math.min(100, opts.progress));
      const stageLabel = opts.statusText || videoStageLabel(opts.progress);
      const etaText = generationEtaLabel(computeEta(), opts.progress);

      const facts = [
        typeof opts.aspectRatio === 'string' ? opts.aspectRatio : null,
        opts.duration !== undefined ? formatDuration(opts.duration * 1000, false) : null,
        typeof opts.resolution === 'string'
          ? opts.resolution
          : opts.resolution?.width
            ? `${opts.resolution.width} × ${opts.resolution.height}`
            : null,
        opts.fps ? `${opts.fps}\u00a0fps` : null,
        opts.audio === undefined ? null : opts.audio ? '有声' : '无声',
        ...(opts.settings || []),
      ].filter(Boolean);

      // Avoid tearing down a live playing <video> if already mounted with same src
      if (done && mountedSrc === opts.src && container.querySelector('[data-slot="video-player"]')) {
        return;
      }
      mountedSrc = done ? opts.src : '';

      let noticeHtml = '';
      if (opts.status === 'failed') {
        noticeHtml = `
          <div class="mg-notice is-error" data-slot="generation-notice">
            <div class="mg-notice-inner">
              <span class="mg-notice-icon">${ICONS.error}</span>
              <p class="mg-notice-title">视频渲染失败</p>
              <p class="mg-notice-desc">${escapeHtml(opts.errorText || '片段在完成编码前中止，请稍后重试。')}</p>
              ${opts.onRetry ? `<div class="mg-notice-actions"><button type="button" class="mg-btn is-outline" data-vg-retry>${ICONS.retry}<span>重新渲染</span></button></div>` : ''}
            </div>
          </div>`;
      } else if (opts.status === 'blocked') {
        noticeHtml = `
          <div class="mg-notice" data-slot="generation-notice">
            <div class="mg-notice-inner">
              <span class="mg-notice-icon">${ICONS.shield}</span>
              <p class="mg-notice-title">未能创建该视频</p>
              <p class="mg-notice-desc">${escapeHtml(opts.blockedText || '提示词可能触及内容策略，请改为描述镜头运动、材质与环境氛围。')}</p>
              ${opts.onEditPrompt ? `<div class="mg-notice-actions"><button type="button" class="mg-btn is-outline" data-vg-edit>编辑提示词</button></div>` : ''}
            </div>
          </div>`;
      }

      let footerHtml = '';
      if (!settled) {
        let leftHtml = '';
        let rightHtml = '';
        if (opts.status === 'queued') {
          leftHtml = `
            <div class="mg-status-line">
              <span class="mg-muted-icon">${ICONS.clock}</span>
              <span class="mg-status-strong">排队中</span>
              ${opts.queuePosition ? `<span class="mg-status-sub mono">第 ${opts.queuePosition} 位</span>` : ''}
              ${opts.etaMs !== undefined ? `<span class="mg-dot">·</span><span class="mg-status-sub mono">预计等待 ${formatDuration(opts.etaMs, false)}</span>` : ''}
            </div>`;
          if (opts.onCancel) rightHtml = `<button type="button" class="mg-btn is-ghost" data-vg-cancel>取消</button>`;
        } else if (generating || !done) {
          leftHtml = `
            <div class="mg-status-line" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${percent ?? 0}">
              <span class="mg-shimmer">${escapeHtml(stageLabel)}</span>
              ${percent !== undefined ? `<span class="mg-status-sub mono">${percent}%</span>` : ''}
              ${etaText ? `<span class="mg-dot">·</span><span class="mg-status-sub mono">${escapeHtml(etaText)}</span>` : ''}
            </div>`;
          if (opts.onCancel) rightHtml = `<button type="button" class="mg-btn is-ghost" data-vg-cancel>取消</button>`;
        } else {
          const dlName = opts.filename || `${slugify(opts.prompt)}.${extensionOf(opts.src, 'webm')}`;
          leftHtml = `
            <div class="mg-actions-row">
              ${opts.onRetry ? `<button type="button" class="mg-btn is-ghost" data-vg-retry>${ICONS.retry}<span>重新渲染</span></button>` : ''}
              ${opts.onUseAsReference ? `<button type="button" class="mg-btn is-ghost" data-vg-ref>${ICONS.reference}<span>引用分镜</span></button>` : ''}
            </div>`;
          rightHtml = `
            <div class="mg-right-tools">
              <a class="mg-icon-btn" href="${escapeHtml(opts.src)}" download="${escapeHtml(dlName)}" aria-label="下载视频" title="下载视频">${ICONS.download}</a>
            </div>`;
        }
        footerHtml = `<div class="mg-footer" data-slot="video-generation-footer">${leftHtml}${rightHtml}</div>`;
      }

      container.innerHTML = `
        <div class="mg-card" data-slot="video-generation" data-generation-state="${escapeHtml(opts.status)}">
          <div class="mg-header" data-slot="video-generation-header">
            <div class="mg-header-text">
              <p class="mg-prompt">${escapeHtml(opts.prompt)}</p>
              ${facts.length ? `<p class="mg-facts mono-xs">${facts.map((f) => `<span>${escapeHtml(f)}</span>`).join('<span class="mg-dot">·</span>')}</p>` : ''}
            </div>
            <button type="button" class="mg-icon-btn mg-copy-btn" data-vg-copy aria-label="复制提示词" title="复制提示词">
              <span class="mg-copy-ico">${ICONS.copy}</span>
              <span class="mg-check-ico">${ICONS.check}</span>
            </button>
          </div>
          <div class="mg-stage-wrap">
            <div class="mg-video-slot">
              ${
                done
                  ? ''
                  : renderGenerationFrameHtml({
                      image: opts.posterSrc ? { src: opts.posterSrc } : undefined,
                      phase: opts.status === 'done' ? 'generating' : opts.status,
                      progress: opts.status === 'done' ? 99 : opts.progress,
                      ratio,
                      instant: opts.instant,
                      alt: opts.prompt,
                      extraClass: 'is-video-frame',
                    })
              }
            </div>
            ${noticeHtml}
          </div>
          ${footerHtml}
        </div>`;

      bindCopyButton(container.querySelector('[data-vg-copy]'), () => opts.prompt, opts.onToast);
      if (done && opts.src) {
        mountVideoPlayer(container.querySelector('.mg-video-slot'), {
          src: opts.src,
          poster: opts.posterSrc,
          title: opts.prompt,
          duration: opts.duration,
          autoPlay: opts.autoPlay,
          loop: opts.loop,
          ratio,
        });
      }
      container.querySelector('[data-vg-cancel]')?.addEventListener('click', () => opts.onCancel?.(api));
      container.querySelector('[data-vg-retry]')?.addEventListener('click', () => opts.onRetry?.(api));
      container.querySelector('[data-vg-edit]')?.addEventListener('click', () => opts.onEditPrompt?.(api));
      container.querySelector('[data-vg-ref]')?.addEventListener('click', () => opts.onUseAsReference?.(opts, api));
    }

    const api = {
      update(patch) {
        opts = { ...opts, ...patch };
        if (patch.status && patch.status !== 'done') opts.instant = false;
        render();
      },
      getState() {
        return { ...opts };
      },
    };

    render();
    return api;
  }

  /* =========================================================================
     3. Automatic Media Extractor from Gemini / Codex Markdown & Tool Outputs
     ========================================================================= */
  function resolveMediaUrl(rawPath, workspaceDir) {
    const clean = String(rawPath || '').trim().replace(/^["'`(<]+|["'`)>]+$/g, '');
    if (!clean) return '';
    if (/^(https?:|data:|blob:|\/api\/workspace\/media)/i.test(clean)) return clean;
    if (/^file:\/\//i.test(clean)) {
      const fsPath = decodeURIComponent(clean.replace(/^file:\/\/\/?/i, ''));
      return `/api/workspace/media?dir=${encodeURIComponent(workspaceDir || '')}&file=${encodeURIComponent(fsPath)}`;
    }
    return `/api/workspace/media?dir=${encodeURIComponent(workspaceDir || '')}&file=${encodeURIComponent(clean)}`;
  }

  function extractMediaFromText(text, workspaceDir) {
    const raw = String(text || '');
    const images = [];
    const videos = [];
    const seen = new Set();

    const addImage = (url, alt = '') => {
      const resolved = resolveMediaUrl(url, workspaceDir);
      if (!resolved || seen.has(resolved)) return;
      seen.add(resolved);
      images.push({ src: resolved, alt: alt || '' });
    };
    const addVideo = (url, alt = '') => {
      const resolved = resolveMediaUrl(url, workspaceDir);
      if (!resolved || seen.has(resolved)) return;
      seen.add(resolved);
      videos.push({ src: resolved, title: alt || '' });
    };

    // 1. Markdown image syntax ![alt](path-or-url)
    for (const m of raw.matchAll(/!\[([^\]]*)\]\(([^)\s]+)\)/g)) {
      const alt = m[1] || '';
      const target = m[2] || '';
      if (/\.(mp4|webm|mov)(?:[?#]|$)/i.test(target)) addVideo(target, alt);
      else addImage(target, alt);
    }

    // 2. Markdown link or raw path ending in video/image extension
    for (const m of raw.matchAll(/\[([^\]]*)\]\(([^)\s]+\.(?:mp4|webm|mov|png|jpe?g|webp|gif)(?:[?#][^)\s]*)?)\)/gi)) {
      const alt = m[1] || '';
      const target = m[2] || '';
      if (/\.(mp4|webm|mov)(?:[?#]|$)/i.test(target)) addVideo(target, alt);
      else addImage(target, alt);
    }

    // 3. Backticked local file paths like `output/render.png` or `D:\gemini\photo\shot.webp`
    for (const m of raw.matchAll(/`([^`\n]+?\.(?:png|jpe?g|webp|gif|mp4|webm|mov))`/gi)) {
      const target = m[1].trim();
      if (/\.(mp4|webm|mov)$/i.test(target)) addVideo(target, target.split(/[\\/]/).pop());
      else addImage(target, target.split(/[\\/]/).pop());
    }

    return { images, videos };
  }

  /* =========================================================================
     4. Procedural Architectural Artwork & Kinetic WebM Recorder (100% Offline)
     ========================================================================= */
  function mulberry32(seed) {
    let a = seed >>> 0;
    return () => {
      a = (a + 0x6d2b79f5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function hashString(str) {
    let h = 2166136261;
    for (let i = 0; i < str.length; i++) {
      h ^= str.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    return h >>> 0;
  }

  function getCanvasResolutionPreset() {
    const scale = Number(document.documentElement.dataset.canvasScale || 2);
    if (scale >= 3) return { imgW: 1600, imgH: 1200, vidW: 1920, vidH: 1080, label: '3× Ultra' };
    if (scale >= 2) return { imgW: 1280, imgH: 960, vidW: 1280, vidH: 720, label: '2× Retina' };
    return { imgW: 768, imgH: 576, vidW: 768, vidH: 432, label: '1× 标准' };
  }

  function createArchitecturalImage(prompt, variationIdx = 0, width, height, salt = 0) {
    const preset = getCanvasResolutionPreset();
    width = width || preset.imgW;
    height = height || preset.imgH;
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    const rand = mulberry32(hashString(`${prompt}#${variationIdx}#${salt}`));

    const palettes = [
      { bg1: '#EAECEF', bg2: '#D8DEE4', ink: '#141618', mid: '#63707E', accent: '#D8EE5C' },
      { bg1: '#15181C', bg2: '#232830', ink: '#F3F5F7', mid: '#7D8794', accent: '#EEFF82' },
      { bg1: '#ECE9E2', bg2: '#DCD6CB', ink: '#1C1B19', mid: '#797267', accent: '#C6DF4E' },
      { bg1: '#1D2229', bg2: '#101317', ink: '#E9EDF2', mid: '#687687', accent: '#C2F068' },
    ];
    const pal = palettes[(variationIdx + salt) % palettes.length];

    const grad = ctx.createLinearGradient(0, 0, width, height);
    grad.addColorStop(0, pal.bg1);
    grad.addColorStop(1, pal.bg2);
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, width, height);

    // Architectural drafting grid
    ctx.strokeStyle = pal.mid;
    ctx.globalAlpha = 0.14;
    ctx.lineWidth = 1;
    const step = 36;
    for (let x = step; x < width; x += step) {
      ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, height); ctx.stroke();
    }
    for (let y = step; y < height; y += step) {
      ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(width, y); ctx.stroke();
    }

    // Layered sculptural forms
    const cx = width * (0.34 + rand() * 0.32);
    const cy = height * (0.36 + rand() * 0.28);
    const r = Math.min(width, height) * (0.24 + rand() * 0.12);

    ctx.globalAlpha = 0.92;
    ctx.fillStyle = pal.ink;
    if (variationIdx % 2 === 0) {
      ctx.beginPath();
      ctx.arc(cx, cy, r, 0, Math.PI * 2);
      ctx.fill();
      ctx.globalAlpha = 0.85;
      ctx.fillStyle = pal.accent;
      ctx.beginPath();
      ctx.arc(cx + r * 0.55, cy - r * 0.35, r * 0.34, 0, Math.PI * 2);
      ctx.fill();
    } else {
      ctx.save();
      ctx.translate(cx, cy);
      ctx.rotate((rand() - 0.5) * 0.45);
      ctx.fillRect(-r, -r * 0.68, r * 2, r * 1.36);
      ctx.fillStyle = pal.accent;
      ctx.fillRect(r * 0.25, -r * 0.9, r * 0.65, r * 1.8);
      ctx.restore();
    }

    // Concentric architectural rings
    ctx.strokeStyle = pal.ink;
    ctx.globalAlpha = 0.28;
    ctx.lineWidth = 1.25;
    for (let k = 1; k <= 5; k++) {
      ctx.beginPath();
      ctx.ellipse(cx, cy, r * (0.6 + k * 0.24), r * (0.35 + k * 0.16), (variationIdx * 0.35), 0, Math.PI * 2);
      ctx.stroke();
    }

    // Subtle specular architectural bar & specimen stamp
    ctx.globalAlpha = 0.72;
    ctx.fillStyle = pal.ink;
    ctx.font = '600 12px "JetBrains Mono", monospace';
    ctx.fillText(`FIG.0${variationIdx + 1} · TENON STUDIO`, 24, height - 24);
    ctx.globalAlpha = 0.48;
    ctx.fillText(`${width}×${height}`, width - 88, height - 24);

    // Fine static monochrome film grain
    ctx.fillStyle = pal.ink;
    for (let i = 0; i < 1200; i++) {
      ctx.globalAlpha = 0.02 + rand() * 0.045;
      ctx.fillRect(rand() * width, rand() * height, 1.5, 1.5);
    }
    ctx.globalAlpha = 1;

    // Tiny blurred low-res preview
    const sm = document.createElement('canvas');
    sm.width = 48;
    sm.height = Math.max(24, Math.round((48 * height) / width));
    sm.getContext('2d').drawImage(canvas, 0, 0, sm.width, sm.height);

    return {
      src: canvas.toDataURL('image/png'),
      previewSrc: sm.toDataURL('image/jpeg', 0.6),
      width,
      height,
    };
  }

  function drawRippleFrame(ctx, w, h, t, seed) {
    ctx.globalAlpha = 1;
    ctx.fillStyle = '#0F1114';
    ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = '#FFFFFF';
    ctx.globalAlpha = 0.04;
    ctx.fillRect(0, 0, w, h);

    const cx = w * 0.5;
    const cy = h * 0.54;
    const maxR = w * 0.82;
    const rings = 12;
    for (let k = 0; k < rings; k++) {
      const f = ((k + t * 0.9) % rings) / rings;
      const r = f * maxR;
      ctx.strokeStyle = k % 4 === 0 ? '#EEFF82' : '#FFFFFF';
      ctx.globalAlpha = Math.max(0, (1 - f) * (k % 4 === 0 ? 0.65 : 0.82));
      ctx.lineWidth = 1 + (1 - f) * 2.4;
      ctx.beginPath();
      ctx.ellipse(cx, cy, Math.max(0.2, r), Math.max(0.2, r * 0.32), 0, 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.fillStyle = '#EEFF82';
    ctx.globalAlpha = 0.92;
    ctx.beginPath();
    ctx.ellipse(cx, cy, w * 0.012, w * 0.005, 0, 0, Math.PI * 2);
    ctx.fill();

    const rand = mulberry32(Math.floor(t * 24) + seed + 1);
    ctx.fillStyle = '#FFFFFF';
    for (let i = 0; i < 450; i++) {
      ctx.globalAlpha = 0.03 + rand() * 0.07;
      ctx.fillRect(rand() * w, rand() * h, 1.5, 1.5);
    }
    ctx.globalAlpha = 1;
  }

  function recordKineticClip({ prompt = 'ripples', seconds = 3.6, width, height } = {}) {
    const preset = getCanvasResolutionPreset();
    width = width || preset.vidW;
    height = height || preset.vidH;
    const seed = hashString(prompt);
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    drawRippleFrame(ctx, width, height, 0.35, seed);
    const posterSrc = canvas.toDataURL('image/jpeg', 0.86);

    const videoPromise = new Promise((resolve) => {
      if (typeof MediaRecorder === 'undefined' || !canvas.captureStream) {
        resolve(null);
        return;
      }
      const mime = ['video/webm;codecs=vp9', 'video/webm', 'video/mp4'].find((m) => MediaRecorder.isTypeSupported(m));
      if (!mime) {
        resolve(null);
        return;
      }
      const stream = canvas.captureStream(24);
      const recorder = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: 1_800_000 });
      const chunks = [];
      recorder.ondataavailable = (ev) => { if (ev.data.size > 0) chunks.push(ev.data); };
      recorder.onstop = () => {
        stream.getTracks().forEach((tr) => tr.stop());
        const blob = new Blob(chunks, { type: mime.split(';')[0] });
        resolve(URL.createObjectURL(blob));
      };
      const t0 = performance.now();
      const step = () => {
        const elapsed = (performance.now() - t0) / 1000;
        drawRippleFrame(ctx, width, height, elapsed, seed);
        if (elapsed < seconds) requestAnimationFrame(step);
        else if (recorder.state === 'recording') recorder.stop();
      };
      recorder.start(200);
      requestAnimationFrame(step);
    });

    return { posterSrc, videoPromise };
  }

  /* =========================================================================
     5. Safari Browser Window Frame (Native Port of safari.tsx)
     ========================================================================= */
  function renderSafariMockupSvg({ url = 'localhost:4177', src = '' } = {}) {
    const uid = `saf-${++grainUid}`;
    return `
      <svg class="safari-svg" viewBox="0 0 1203 753" fill="none" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="Safari 浏览器预览: ${escapeHtml(url)}">
        <g clip-path="url(#${uid}-clip)">
          <path d="M0 52H1202V741C1202 747.627 1196.63 753 1190 753H12C5.37258 753 0 747.627 0 741V52Z" class="safari-fill-border" />
          <path fill-rule="evenodd" clip-rule="evenodd" d="M0 12C0 5.37258 5.37258 0 12 0H1190C1196.63 0 1202 5.37258 1202 12V52H0L0 12Z" class="safari-fill-border" />
          <path fill-rule="evenodd" clip-rule="evenodd" d="M1.067 12C1.067 5.925 5.992 1 12.067 1H1189.93C1196.01 1 1200.93 5.925 1200.93 12V51H1.067V12Z" class="safari-fill-bar" />
          <circle cx="27" cy="25" r="6" class="safari-fill-dot" />
          <circle cx="47" cy="25" r="6" class="safari-fill-dot" />
          <circle cx="67" cy="25" r="6" class="safari-fill-dot" />
          <path d="M286 17C286 13.686 288.686 11 292 11H946C949.314 11 952 13.686 952 17V35C952 38.314 949.314 41 946 41H292C288.686 41 286 38.314 286 35V17Z" class="safari-fill-pill" />
          <text x="619" y="30" text-anchor="middle" fill="#8C939E" font-size="13" font-family="var(--font-mono)">${escapeHtml(url)}</text>
          ${src ? `<image href="${escapeHtml(src)}" width="1200" height="700" x="1" y="52" preserveAspectRatio="xMidYMid slice" clip-path="url(#${uid}-body)" />` : ''}
        </g>
        <defs>
          <clipPath id="${uid}-clip"><rect width="1203" height="753" fill="white" /></clipPath>
          <clipPath id="${uid}-body"><path d="M1 52H1201V741C1201 747.075 1196.08 752 1190 752H12C5.925 752 1 747.075 1 741V52Z" fill="white" /></clipPath>
        </defs>
      </svg>`;
  }

  function mountSafariPreview(container, { url = '', htmlSnippet = '', codeSnippet = '', codeLang = 'tsx', runMeta = null, onToast } = {}) {
    if (!container) return;
    let currentUrl = url || '';
    let viewMode = url ? 'safari' : 'split'; // Default to Right Control: Code + Live Preview Split Workspace!

    const fallbackCode = [
      'export function DeployCard({ checks }: Props) {',
      '  return (',
      '    <section className="rounded-xl border p-5">',
      '      <p className="text-xs text-muted">Deploy to production</p>',
      '      <h3 className="font-mono text-sm">tenon-workbench@main</h3>',
      '      <ul className="mt-4 space-y-2 text-xs">',
      '        {checks.map((c) => (',
      '          <li key={c.name} className="flex justify-between">',
      '            <span>{c.name}</span>',
      '            <span className="tabular-nums">{c.time}</span>',
      '          </li>',
      '        ))}',
      '      </ul>',
      '      <button className="mt-4 w-full rounded-lg bg-ink py-2">',
      '        Promote to production',
      '      </button>',
      '    </section>',
      '  );',
      '}',
    ].join('\n');

    function loadSplitRatio() {
      try {
        const v = Number(localStorage.getItem('tenon_preview_split'));
        if (Number.isFinite(v) && v >= 22 && v <= 78) return v;
      } catch {}
      return 52;
    }

    function saveSplitRatio(pct) {
      try { localStorage.setItem('tenon_preview_split', String(Math.round(pct * 10) / 10)); } catch {}
    }

    function render() {
      const safeSrcdoc = htmlSnippet || '';
      const hasUrl = Boolean(currentUrl);
      const displayUrl = hasUrl ? currentUrl : safeSrcdoc ? 'sandbox://artifact-preview.html' : 'http://127.0.0.1:4177/';
      const activeCode = (codeSnippet || safeSrcdoc || fallbackCode).trim();
      const codeLines = activeCode.split(/\r?\n/).length;
      const fileLabel = codeLang === 'diff' ? 'workspace.patch' : codeLang === 'html' ? 'preview.html' : `artifact.${codeLang || 'tsx'}`;
      const targetName = runMeta?.title ? runMeta.title.slice(0, 24) : 'tenon-workbench@main';
      const durSec = runMeta?.durationSec || '1.4';
      const splitPct = loadSplitRatio();
      const checks = [
        { name: 'Syntax Check', time: '0.2 s' },
        { name: 'Pre-CI Gate', time: `${durSec} s` },
        { name: 'Unit Tests (5/5)', time: '1.1 s' },
      ];

      container.innerHTML = `
        <div class="safari-preview-wrap" data-slot="safari-preview">
          <div class="safari-controls-top">
            <span class="mono-xs">${viewMode === 'split' ? 'CODE + LIVE PREVIEW' : 'SAFARI WEB PREVIEW'}</span>
            <div class="safari-device-pills">
              <button type="button" class="safari-dev-btn ${viewMode === 'split' ? 'active' : ''}" data-saf-mode="split">代码 + 预览</button>
              <button type="button" class="safari-dev-btn ${viewMode === 'safari' ? 'active' : ''}" data-saf-mode="safari">Safari 窗口</button>
            </div>
          </div>

          ${
            viewMode === 'split'
              ? `<div class="code-preview-split" data-slot="code-preview-split" style="--cps-left:${splitPct}%">
                  <div class="cps-code-pane">
                    <div class="cps-pane-head">
                      <span class="cps-filename mono-xs">${escapeHtml(fileLabel)}</span>
                      <div class="cps-head-right">
                        <span class="mono-xs cps-lines">${codeLines} lines</span>
                        <button type="button" class="cps-copy-btn mono-xs" id="btnCpsCopy">复制</button>
                      </div>
                    </div>
                    <pre class="cps-code-pre"><code>${escapeHtml(activeCode)}</code></pre>
                  </div>
                  <div class="cps-split-handle" id="cpsSplitHandle" role="separator" aria-orientation="vertical" aria-label="拖动调整代码与预览比例" title="拖动调整代码与预览比例（双击重置）"></div>
                  <div class="cps-preview-pane">
                    <div class="cps-pane-head">
                      <span class="cps-filename mono-xs">Preview</span>
                      <span class="mono-xs cps-lines">${safeSrcdoc ? 'HTML 实时沙箱' : '构建验证预览'}</span>
                    </div>
                    <div class="cps-preview-body">
                      ${
                        safeSrcdoc
                          ? `<iframe class="cps-preview-iframe" sandbox="allow-scripts" srcdoc="${escapeHtml(safeSrcdoc)}" title="HTML 组件实时预览"></iframe>`
                          : `<div class="cps-deploy-card">
                              <span class="cps-deploy-kicker">Deploy to production</span>
                              <strong class="cps-deploy-target mono">${escapeHtml(targetName)}</strong>
                              <ul class="cps-checks-list">
                                ${checks
                                  .map(
                                    (c) => `
                                    <li>
                                      <span>${escapeHtml(c.name)}</span>
                                      <span class="mono">${escapeHtml(c.time)}</span>
                                    </li>`
                                  )
                                  .join('')}
                              </ul>
                              <button type="button" class="cps-promote-btn" id="btnCpsOpenSafari">打开 Safari 实机预览</button>
                            </div>`
                      }
                    </div>
                  </div>
                </div>`
              : `<div class="safari-window">
                  <div class="safari-chrome">
                    <div class="safari-dots" aria-hidden="true">
                      <span></span><span></span><span></span>
                    </div>
                    <form class="safari-url-form" id="safariUrlForm">
                      <svg class="safari-lock" width="11" height="11" viewBox="0 0 16 16" fill="none" aria-hidden="true">
                        <rect x="3.5" y="7" width="9" height="6.5" rx="1.5" stroke="currentColor" stroke-width="1.3"/>
                        <path d="M5.5 7V5a2.5 2.5 0 0 1 5 0v2" stroke="currentColor" stroke-width="1.3"/>
                      </svg>
                      <input type="text" class="safari-url-input mono-xs" id="safariUrlInput" value="${escapeHtml(displayUrl)}" placeholder="输入本地预览地址，如 http://localhost:3000" autocomplete="off" />
                    </form>
                    <div class="safari-chrome-acts">
                      <button type="button" class="mg-icon-btn" id="safariReloadBtn" title="刷新预览">${ICONS.retry}</button>
                      ${hasUrl ? `<a class="mg-icon-btn" href="${escapeHtml(currentUrl)}" target="_blank" rel="noopener" title="新标签打开">${ICONS.open}</a>` : ''}
                    </div>
                  </div>
                  <div class="safari-viewport">
                    ${
                      hasUrl
                        ? `<iframe class="safari-iframe" id="safariFrame" src="${escapeHtml(currentUrl)}" title="Safari 实时页面预览"></iframe>`
                        : safeSrcdoc
                          ? `<iframe class="safari-iframe" id="safariFrame" sandbox="allow-scripts" srcdoc="${escapeHtml(safeSrcdoc)}" title="HTML 产物实时预览"></iframe>`
                          : `<div class="safari-standby">
                              ${renderSafariMockupSvg({ url: 'localhost:3000' })}
                              <p class="safari-standby-note">在上方地址栏输入本地开发地址（如 <code>http://localhost:3000</code>）回车即可实时预览。</p>
                            </div>`
                    }
                  </div>
                </div>`
          }
        </div>`;

      container.querySelectorAll('[data-saf-mode]').forEach((b) => {
        b.addEventListener('click', () => {
          viewMode = b.dataset.safMode;
          render();
        });
      });

      container.querySelector('#btnCpsCopy')?.addEventListener('click', () => {
        navigator.clipboard?.writeText(activeCode).then(() => {
          if (onToast) onToast(`已复制 ${fileLabel}`);
        }).catch(() => {});
      });

      const splitEl = container.querySelector('.code-preview-split');
      const splitHandle = container.querySelector('#cpsSplitHandle');
      if (splitEl && splitHandle) {
        splitHandle.addEventListener('dblclick', () => {
          splitEl.style.setProperty('--cps-left', '52%');
          saveSplitRatio(52);
        });
        splitHandle.addEventListener('pointerdown', (ev) => {
          ev.preventDefault();
          splitHandle.setPointerCapture(ev.pointerId);
          splitHandle.classList.add('is-dragging');
          document.body.classList.add('is-resizing');
          const rect = splitEl.getBoundingClientRect();
          let lastPct = loadSplitRatio();

          const onMove = (mEv) => {
            if (rect.width <= 0) return;
            const rawPct = ((mEv.clientX - rect.left) / rect.width) * 100;
            lastPct = Math.max(22, Math.min(78, rawPct));
            splitEl.style.setProperty('--cps-left', `${lastPct.toFixed(1)}%`);
          };
          const onUp = () => {
            splitHandle.classList.remove('is-dragging');
            document.body.classList.remove('is-resizing');
            saveSplitRatio(lastPct);
            splitHandle.removeEventListener('pointermove', onMove);
            splitHandle.removeEventListener('pointerup', onUp);
            splitHandle.removeEventListener('pointercancel', onUp);
          };
          splitHandle.addEventListener('pointermove', onMove);
          splitHandle.addEventListener('pointerup', onUp);
          splitHandle.addEventListener('pointercancel', onUp);
        });
      }

      container.querySelector('#btnCpsOpenSafari')?.addEventListener('click', () => {
        viewMode = 'safari';
        render();
      });

      container.querySelector('#safariUrlForm')?.addEventListener('submit', (e) => {
        e.preventDefault();
        const raw = (container.querySelector('#safariUrlInput')?.value || '').trim();
        if (!raw || raw.startsWith('sandbox://')) {
          currentUrl = '';
          render();
          return;
        }
        const normalized = /^https?:\/\//i.test(raw) ? raw : `http://${raw}`;
        currentUrl = normalized;
        render();
        if (onToast) onToast(`已载入预览：${normalized}`);
      });

      container.querySelector('#safariReloadBtn')?.addEventListener('click', () => {
        const frame = container.querySelector('#safariFrame');
        if (frame && currentUrl) frame.src = currentUrl;
        else render();
      });
    }

    render();
  }

  window.ConduitMediaGen = {
    mountImageGeneration,
    mountVideoGeneration,
    renderSafariMockupSvg,
    mountSafariPreview,
    openLightbox,
    closeLightbox,
    extractMediaFromText,
    createArchitecturalImage,
    recordKineticClip,
  };
})();
