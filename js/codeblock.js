/**
 * 飞轮之道「判断观测仪」主题 · 代码块交互（Apple 风格）
 *
 * 输入：构建期 scripts/lib/codeblock.js 输出的 figure.cb 逐行结构。
 * 能力：
 *   - 块级：收起 / 预览（部分展开，逐段显示更多）/ 全部展开；本页全部收起 / 展开 / 恢复
 *   - 结构级：按缩进（Markdown 按标题）识别代码区段，逐段折叠 / 展开、全部折叠 / 展开、按层级折叠
 *   - 全屏：从原位置缩放进入，查找（⌘F，命中高亮）、字号缩放、换行、行号、系统全屏
 *   - 复制：整块 / 仅命令（Shell 去掉 $ 与输出）/ 所选行；手动选中复制保留空行并剔除界面元素
 *   - 行选择与深链：点击行号选中，Shift 扩展，URL #cb-3-L5-L9 可直达并高亮
 *   - 偏好（localStorage obs:code-prefs）：自动换行、行号、配色（浅色 / 深色 / 跟随系统）、全屏字号
 * 约定：所有交互不依赖 hover；键盘可达；尊重「减少动态效果」；localStorage 读写包裹 try/catch。
 */
(function () {
  'use strict';

  var doc = document;
  var root = doc.documentElement;
  var MOBILE = window.matchMedia('(max-width: 800px)');
  var REDUCED = window.matchMedia('(prefers-reduced-motion: reduce)');
  var DARK = window.matchMedia('(prefers-color-scheme: dark)');
  var PREF_KEY = 'obs:code-prefs';
  var PREVIEW_ROWS = 18;
  var STEP_ROWS = 40;
  var MIN_FOLD = 2;
  var EASE = 'cubic-bezier(0.32, 0.72, 0, 1)';
  var NO_FOLD_LANGS = { text: 1, log: 1, csv: 1, diff: 1, console: 1 };
  var HL = !!(window.CSS && CSS.highlights && window.Highlight);
  /** Highlight 构造器接收可变参数，这里统一由数组构建 */
  function makeHighlight(ranges) {
    var h = new Highlight();
    ranges.forEach(function (r) { if (r) h.add(r); });
    return h;
  }

  var blocks = [];
  var byId = {};

  /* ------------------------------------------------------------------ 工具 */

  function $$(sel, ctx) { return Array.prototype.slice.call((ctx || doc).querySelectorAll(sel)); }
  function on(el, type, fn, opts) { if (el) el.addEventListener(type, fn, opts); }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]; }); }
  function clamp(n, a, b) { return Math.max(a, Math.min(b, n)); }
  function motion() { return !REDUCED.matches && typeof Element.prototype.animate === 'function'; }
  function headerH() {
    var h = parseFloat(getComputedStyle(root).getPropertyValue('--header-h'));
    var el = doc.querySelector('.kind-post .global-header');
    return el ? el.offsetHeight : (h || 0);
  }

  /** 阻尼弹簧曲线 → CSS linear() 缓动（轻微回弹）；不支持时回退为 cubic-bezier */
  var SPRING = (function () {
    try {
      if (!(window.CSS && CSS.supports && CSS.supports('animation-timing-function', 'linear(0, 1)'))) return null;
      var k = 220, c = 26, w0 = Math.sqrt(k), z = c / (2 * Math.sqrt(k)), wd = w0 * Math.sqrt(1 - z * z);
      var dur = 0.62, pts = [];
      for (var i = 0; i <= 48; i++) {
        var t = dur * i / 48;
        pts.push((1 - Math.exp(-z * w0 * t) * (Math.cos(wd * t) + (z * w0 / wd) * Math.sin(wd * t))).toFixed(4));
      }
      pts[48] = '1';
      return { easing: 'linear(' + pts.join(', ') + ')', duration: Math.round(dur * 1000) };
    } catch (e) { return null; }
  })();

  var ICON = {
    chev: '<path d="m6 9 6 6 6-6"/>',
    up: '<path d="m6 15 6-6 6 6"/>',
    copy: '<rect x="8.5" y="8.5" width="11" height="11" rx="2.5"/><path d="M15.5 5.5V5a2 2 0 0 0-2-2h-8A2.5 2.5 0 0 0 3 5.5v8a2 2 0 0 0 2 2h.5"/>',
    check: '<path d="m5 12.5 4.5 4.5L19 7.5"/>',
    expand: '<path d="M14 4h6v6M10 20H4v-6M20 4l-6.5 6.5M4 20l6.5-6.5"/>',
    shrink: '<path d="M4 14h6v6M20 10h-6V4M10 14l-6.5 6.5M14 10l6.5-6.5"/>',
    wrap: '<path d="M4 6h16M4 12h13a3 3 0 0 1 0 6h-4M4 18h5"/><path d="m15 16-2 2 2 2"/>',
    more: '<circle cx="5.5" cy="12" r="1.3" fill="currentColor" stroke="none"/><circle cx="12" cy="12" r="1.3" fill="currentColor" stroke="none"/><circle cx="18.5" cy="12" r="1.3" fill="currentColor" stroke="none"/>',
    fold: '<path d="m8 4 4 4 4-4M8 20l4-4 4 4M4 12h16"/>',
    unfold: '<path d="m8 8 4-4 4 4M8 16l4 4 4-4M4 12h16"/>',
    link: '<path d="M10 14a4.5 4.5 0 0 0 6.4 0l3-3a4.5 4.5 0 0 0-6.4-6.4l-1.2 1.2"/><path d="M14 10a4.5 4.5 0 0 0-6.4 0l-3 3a4.5 4.5 0 0 0 6.4 6.4l1.2-1.2"/>',
    download: '<path d="M12 4v11M7 10.5l5 5 5-5M5 20h14"/>',
    close: '<path d="M6 6l12 12M18 6 6 18"/>',
    search: '<circle cx="11" cy="11" r="6.5"/><path d="m16 16 4 4"/>',
    minus: '<path d="M5 12h14"/>',
    plus: '<path d="M12 5v14M5 12h14"/>',
    lines: '<path d="M10 6h10M10 12h10M10 18h10"/><path d="M4.5 4.5v3.5M3.8 14.5h1.8l-1.8 2.3h2"/>',
    preview: '<rect x="4" y="4" width="16" height="16" rx="3"/><path d="M8 9h8M8 13h5"/>',
    terminal: '<rect x="3" y="4.5" width="18" height="15" rx="3"/><path d="m7.5 10 3 2.5-3 2.5M12.5 15h4"/>',
    screen: '<path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/>',
    stack: '<path d="m12 4 8 4-8 4-8-4z"/><path d="m4 12 8 4 8-4M4 16l8 4 8-4"/>',
    text: '<path d="M4 18 8.5 6h1L14 18M5.6 14h6.8M16 18l2.5-7h.5l2.5 7M17 16h4"/>'
  };
  function svg(name, cls) {
    return '<svg class="' + (cls || '') + '" viewBox="0 0 24 24" aria-hidden="true" focusable="false">' + (ICON[name] || '') + '</svg>';
  }
  var GLYPH = {
    close: '<svg viewBox="0 0 10 10" aria-hidden="true"><path d="M2.8 2.8l4.4 4.4M7.2 2.8 2.8 7.2" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/></svg>',
    min: '<svg viewBox="0 0 10 10" aria-hidden="true"><path d="M2.3 5h5.4" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/></svg>',
    zoom: '<svg viewBox="0 0 10 10" aria-hidden="true"><path d="M2.6 7.2V3.4h3.8zM7.4 2.8v3.8H3.6z" fill="currentColor"/></svg>'
  };

  /* ------------------------------------------------------------------ 偏好 */

  var prefs = (function () {
    var p = {};
    try { p = JSON.parse(localStorage.getItem(PREF_KEY) || '{}') || {}; } catch (e) { p = {}; }
    return {
      theme: /^(light|dark|auto)$/.test(p.theme) ? p.theme : 'light',
      wrap: p.wrap === true,
      ln: p.ln !== false,
      zoom: clamp(Number(p.zoom) || 1, 0.7, 1.8)
    };
  })();
  function savePrefs() { try { localStorage.setItem(PREF_KEY, JSON.stringify(prefs)); } catch (e) { /* 私密模式忽略 */ } }
  function scheme() { return prefs.theme === 'auto' ? (DARK.matches ? 'dark' : 'light') : prefs.theme; }
  function applyPrefs() {
    root.setAttribute('data-code-theme', prefs.theme);
    root.setAttribute('data-code-scheme', scheme());
    if (prefs.wrap) root.setAttribute('data-code-wrap', ''); else root.removeAttribute('data-code-wrap');
    if (prefs.ln) root.removeAttribute('data-code-ln'); else root.setAttribute('data-code-ln', 'off');
    blocks.forEach(function (b) {
      b.wrapBtn.setAttribute('aria-pressed', prefs.wrap ? 'true' : 'false');
      b.gutter = 0;
    });
    syncDock();
  }
  /** 改变全局偏好时保持触发块的标题栏位置不动（换行 / 行号会改变全页高度） */
  function setPref(key, value, anchorBlock) {
    var anchor = anchorBlock && anchorBlock.el.isConnected && !fs.b ? anchorBlock.el : null;
    var top0 = anchor ? anchor.getBoundingClientRect().top : 0;
    prefs[key] = value;
    savePrefs();
    var run = function () {
      applyPrefs();
      if (anchor) window.scrollBy(0, anchor.getBoundingClientRect().top - top0);
    };
    if (key === 'theme' && doc.startViewTransition && !REDUCED.matches) doc.startViewTransition(run);
    else run();
  }
  on(DARK, 'change', function () { if (prefs.theme === 'auto') applyPrefs(); });

  /* ------------------------------------------------------------------ 播报 / 剪贴板 / 下载 */

  var live;
  function announce(msg) {
    if (!live) { live = doc.createElement('div'); live.className = 'cb-live'; live.setAttribute('aria-live', 'polite'); doc.body.appendChild(live); }
    live.textContent = '';
    setTimeout(function () { live.textContent = msg; }, 30);
  }

  function legacyCopy(text) {
    var active = doc.activeElement;
    var ta = doc.createElement('textarea');
    ta.value = text;
    ta.setAttribute('readonly', '');
    ta.style.cssText = 'position:fixed;top:0;left:0;opacity:0;pointer-events:none';
    (fs.overlay && !fs.overlay.hidden ? fs.overlay : doc.body).appendChild(ta);
    ta.select();
    var ok = false;
    try { ok = doc.execCommand('copy'); } catch (e) { ok = false; }
    ta.remove();
    if (active && active.focus) active.focus({ preventScroll: true });
    if (!ok) throw new Error('copy failed');
  }
  function writeClipboard(text) {
    if (navigator.clipboard && window.isSecureContext) {
      return navigator.clipboard.writeText(text).catch(function () { legacyCopy(text); });
    }
    return new Promise(function (resolve) { legacyCopy(text); resolve(); });
  }
  function flashCopied(btn, label) {
    if (!btn) return;
    var span = btn.querySelector('.cb-btn__label');
    var tip = btn.getAttribute('data-tip');
    clearTimeout(btn._copyTimer);
    if (!btn._tip) btn._tip = tip;
    btn.classList.remove('is-copied');
    void btn.offsetWidth;
    btn.classList.add('is-copied');
    if (span) { if (!btn._label) btn._label = span.textContent; span.textContent = label || '已复制'; }
    btn._copyTimer = setTimeout(function () {
      btn.classList.remove('is-copied');
      if (span && btn._label) span.textContent = btn._label;
    }, 1700);
    if (navigator.vibrate && MOBILE.matches) { try { navigator.vibrate(8); } catch (e) { /* 忽略 */ } }
  }
  function doCopy(text, btn, msg) {
    writeClipboard(text).then(function () {
      flashCopied(btn);
      announce(msg || '已复制');
    }, function () { announce('复制失败，请手动选择文本复制'); });
  }

  function download(b) {
    var name = /^[\w.@-]+\.[\w-]+$/.test(b.title) ? b.title : 'snippet-' + b.index + '.' + b.ext;
    var url = URL.createObjectURL(new Blob([b.texts.join('\n') + '\n'], { type: 'text/plain;charset=utf-8' }));
    var a = doc.createElement('a');
    a.href = url;
    a.download = name;
    doc.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 1500);
    announce('已下载 ' + name);
  }

  function blockUrl(b, a, z) {
    var hash = '#' + b.id;
    if (a != null) hash += '-L' + b.lnOf(a) + (z != null && z !== a ? '-L' + b.lnOf(z) : '');
    return window.location.origin + window.location.pathname + window.location.search + hash;
  }

  /* ------------------------------------------------------------------ 结构区段 */

  function indentOf(s) {
    if (!/\S/.test(s)) return -1;
    var n = 0;
    for (var i = 0; i < s.length; i++) {
      var ch = s.charAt(i);
      if (ch === ' ') n += 1; else if (ch === '\t') n += 4; else break;
    }
    return n;
  }

  /** 缩进区段：起始行之后连续缩进更深的非空行；Markdown 按标题层级 */
  function computeRegions(texts, lang) {
    var n = texts.length;
    var regions = [];
    if (NO_FOLD_LANGS[lang]) return regions;
    if (lang === 'markdown') {
      var heads = [];
      var fence = false;
      texts.forEach(function (t, i) {
        if (/^\s*(```|~~~)/.test(t)) fence = !fence;
        var m = !fence && /^(#{1,6})\s/.exec(t);
        if (m) heads.push({ i: i, level: m[1].length });
      });
      heads.forEach(function (h, k) {
        var end = n - 1;
        for (var j = k + 1; j < heads.length; j++) { if (heads[j].level <= h.level) { end = heads[j].i - 1; break; } }
        while (end > h.i && !/\S/.test(texts[end])) end--;
        if (end - h.i >= MIN_FOLD) regions.push({ s: h.i, e: end });
      });
    } else {
      var ind = texts.map(indentOf);
      for (var i = 0; i < n; i++) {
        if (ind[i] < 0) continue;
        var j = i + 1;
        while (j < n && ind[j] < 0) j++;
        if (j >= n || ind[j] <= ind[i]) continue;
        var last = j;
        for (var k = j; k < n; k++) {
          if (ind[k] < 0) continue;
          if (ind[k] <= ind[i]) break;
          last = k;
        }
        if (last - i >= MIN_FOLD) regions.push({ s: i, e: last });
      }
    }
    // 嵌套深度
    var stack = [];
    regions.forEach(function (r) {
      while (stack.length && stack[stack.length - 1].e < r.s) stack.pop();
      r.depth = stack.length;
      r.folded = false;
      stack.push(r);
    });
    return regions;
  }

  /* ------------------------------------------------------------------ 构建 */

  function barHtml(b) {
    var fid = b.id + '-frame';
    var foldBtn = b.regions.length
      ? '<button type="button" class="cb-btn cb-btn--folds" data-act="folds" aria-pressed="false" aria-label="折叠全部结构" data-tip="折叠全部结构">' + svg('fold') + '</button>'
      : '';
    var copyTip = b.cmds ? '复制命令（不含 $ 与输出）' : '复制代码';
    return '<div class="cb-bar">' +
      '<div class="cb-lights" aria-hidden="true">' +
        '<button type="button" class="cb-light cb-light--close" data-act="collapse" tabindex="-1" data-tip="收起">' + GLYPH.close + '</button>' +
        '<button type="button" class="cb-light cb-light--min" data-act="preview" tabindex="-1"' + (b.long ? ' data-tip="预览 / 完整"' : ' disabled') + '>' + GLYPH.min + '</button>' +
        '<button type="button" class="cb-light cb-light--zoom" data-act="fs" tabindex="-1" data-tip="全屏">' + GLYPH.zoom + '</button>' +
      '</div>' +
      '<button type="button" class="cb-title" data-act="collapse" aria-expanded="true" aria-controls="' + fid + '" aria-label="' + esc(b.label + ' 代码，' + b.total + ' 行') + '">' +
        svg('chev', 'cb-chev') + '<i class="cb-dot" aria-hidden="true"></i>' +
        '<span class="cb-label">' + esc(b.label) + '</span>' +
        (b.title ? '<span class="cb-file">' + esc(b.title) + '</span>' : '') +
        '<span class="cb-meta">' + b.total + ' 行</span><span class="cb-state">已收起</span>' +
      '</button>' +
      '<div class="cb-selbar" role="group" aria-label="已选代码行">' +
        '<span class="cb-selbar__text"></span>' +
        '<button type="button" class="cb-btn" data-act="sel-copy" aria-label="复制所选行" data-tip="复制所选行">' + '<span class="cb-ic">' + svg('copy', 'ic-idle') + svg('check', 'ic-done') + '</span></button>' +
        '<button type="button" class="cb-btn" data-act="sel-link" aria-label="复制行链接" data-tip="复制行链接">' + svg('link') + '</button>' +
        '<button type="button" class="cb-btn" data-act="sel-clear" aria-label="取消选择" data-tip="取消选择">' + svg('close') + '</button>' +
      '</div>' +
      '<div class="cb-actions">' + foldBtn +
        '<button type="button" class="cb-btn cb-btn--wrap" data-act="wrap" aria-pressed="' + (prefs.wrap ? 'true' : 'false') + '" aria-label="自动换行" data-tip="自动换行">' + svg('wrap') + '</button>' +
        '<button type="button" class="cb-btn cb-btn--fs" data-act="fs" aria-label="全屏查看" data-tip="全屏查看">' + svg('expand') + '<span class="cb-fs-label">完成</span></button>' +
        '<button type="button" class="cb-btn cb-btn--copy" data-act="copy" aria-label="' + copyTip + '" data-tip="' + copyTip + '"><span class="cb-ic">' + svg('copy', 'ic-idle') + svg('check', 'ic-done') + '</span><span class="cb-btn__label">复制</span></button>' +
        '<button type="button" class="cb-btn cb-btn--menu" data-act="menu" aria-haspopup="menu" aria-expanded="false" aria-label="更多操作" data-tip="更多">' + svg('more') + '</button>' +
      '</div>' +
    '</div>';
  }

  function footHtml(b) {
    return '<div class="cb-foot">' +
      '<button type="button" class="cb-pill" data-act="more"></button>' +
      '<button type="button" class="cb-pill cb-pill--primary" data-act="preview" aria-controls="' + b.id + '-frame"><span></span>' + svg('chev') + '</button>' +
    '</div>';
  }

  function setup(fig, index) {
    var code = fig.querySelector('.cb-code');
    if (!code || fig.classList.contains('is-ready')) return null;
    var lines = $$('.cb-line', code);
    var b = {
      el: fig,
      index: index,
      id: fig.id || 'cb-' + index,
      lang: fig.getAttribute('data-lang') || 'text',
      label: fig.getAttribute('data-label') || 'Text',
      ext: fig.getAttribute('data-ext') || 'txt',
      title: fig.getAttribute('data-title') || '',
      cmds: Number(fig.getAttribute('data-cmds') || 0) > 0,
      code: code,
      lines: lines,
      texts: lines.map(function (l) { return l.textContent; }),
      total: lines.length,
      long: fig.classList.contains('cb--long'),
      collapsed: false,
      expanded: false,
      rows: PREVIEW_ROWS,
      sel: null,
      gutter: 0,
      start: Number(lines.length ? lines[0].getAttribute('data-ln') : 1) || 1
    };
    b.lnOf = function (i) { return b.start + i; };
    fig.id = b.id;
    b.regions = computeRegions(b.texts, b.lang);

    fig.insertAdjacentHTML('afterbegin', barHtml(b));
    b.bar = fig.querySelector('.cb-bar');
    b.titleBtn = b.bar.querySelector('.cb-title');
    b.wrapBtn = b.bar.querySelector('[data-act="wrap"]');
    b.foldsBtn = b.bar.querySelector('[data-act="folds"]');
    b.copyBtn = b.bar.querySelector('[data-act="copy"]');
    b.fsBtn = b.bar.querySelector('.cb-btn--fs');
    b.menuBtn = b.bar.querySelector('[data-act="menu"]');
    b.selText = b.bar.querySelector('.cb-selbar__text');
    b.frame = fig.querySelector('.cb-frame');
    b.frame.id = b.id + '-frame';
    b.body = fig.querySelector('.cb-body');
    b.body.setAttribute('tabindex', '0');
    b.body.setAttribute('role', 'region');
    b.body.setAttribute('aria-label', b.label + ' 代码，共 ' + b.total + ' 行');

    if (b.regions.length) {
      fig.classList.add('has-folds');
      b.regions.forEach(function (r) {
        var btn = doc.createElement('button');
        btn.type = 'button';
        btn.className = 'cb-fold';
        btn.setAttribute('aria-expanded', 'true');
        btn.setAttribute('aria-label', '折叠第 ' + b.lnOf(r.s) + '–' + b.lnOf(r.e) + ' 行');
        btn.innerHTML = svg('chev');
        r.btn = btn;
        lines[r.s].insertBefore(btn, lines[r.s].firstChild);
      });
    }

    if (b.long) {
      fig.insertAdjacentHTML('beforeend', footHtml(b));
      b.foot = fig.querySelector('.cb-foot');
      b.moreBtn = b.foot.querySelector('[data-act="more"]');
      b.expandBtn = b.foot.querySelector('.cb-pill--primary');
      syncFoot(b);
    }

    on(code, 'click', function (e) { onCodeClick(b, e); });
    // 行号区按下时阻止原生文本选择（Shift 扩展选行时尤其明显）
    on(code, 'mousedown', function (e) {
      if (e.target.classList && e.target.classList.contains('cb-line') && e.clientX - b.body.getBoundingClientRect().left <= gutterWidth(b)) e.preventDefault();
    });
    on(b.bar, 'dblclick', function (e) {
      if (fs.b === b || e.target.closest('button')) return;
      setCollapsed(b, !b.collapsed);
    });
    fig._cb = b;
    fig.classList.add('is-ready');
    return b;
  }

  /* ------------------------------------------------------------------ 高度动画 */

  /** 先测量、再变更、再从旧高度过渡到新高度；超长内容把起止高度截到一屏，避免“飞过”整页 */
  function morph(b, mutate, opts) {
    opts = opts || {};
    var frame = b.frame;
    if (!motion() || opts.instant || fs.b === b) { mutate(); return; }
    var h0 = frame.getBoundingClientRect().height;
    if (b.anim) { b.anim.cancel(); b.anim = null; }
    if (b.fade) { b.fade.cancel(); b.fade = null; }
    var scroller = doc.scrollingElement || root;
    var anchorPrev = scroller.style.overflowAnchor;
    scroller.style.overflowAnchor = 'none';
    mutate();
    var h1 = frame.getBoundingClientRect().height;
    if (Math.abs(h1 - h0) < 1) { scroller.style.overflowAnchor = anchorPrev; return; }
    var cap = window.innerHeight * 1.2;
    var from = Math.min(h0, h1 + cap);
    var to = Math.min(h1, h0 + cap);
    var dur = clamp(260 + Math.abs(to - from) * 0.22, 300, 520);
    b.anim = frame.animate([
      { height: from + 'px', maxHeight: 'none', visibility: 'visible' },
      { height: to + 'px', maxHeight: 'none', visibility: 'visible' }
    ], { duration: dur, easing: EASE });
    if (opts.fade) {
      b.fade = b.body.animate(opts.fade === 'out'
        ? [{ opacity: 1 }, { opacity: 0 }]
        : [{ opacity: 0 }, { opacity: 1 }], { duration: dur * 0.7, easing: 'ease' });
    }
    var done = function () { b.anim = null; scroller.style.overflowAnchor = anchorPrev; };
    b.anim.onfinish = done;
    b.anim.oncancel = done;
  }

  /** 块顶已滚出视口（标题栏吸顶中）时，先把块顶拉回视口，保证收起后标题栏仍在指针下 */
  function keepBarInView(b) {
    if (fs.b === b) return;
    var top = b.el.getBoundingClientRect().top;
    var h = headerH();
    if (top < h) window.scrollBy(0, top - h - 12);
  }

  /* ------------------------------------------------------------------ 块级状态 */

  function setCollapsed(b, collapsed, opts) {
    opts = opts || {};
    if (b.collapsed === collapsed) return;
    if (collapsed && !opts.instant) keepBarInView(b);
    morph(b, function () {
      b.collapsed = collapsed;
      b.el.classList.toggle('is-collapsed', collapsed);
      b.titleBtn.setAttribute('aria-expanded', collapsed ? 'false' : 'true');
      var red = b.bar.querySelector('.cb-light--close');
      if (red) red.setAttribute('data-tip', collapsed ? '展开' : '收起');
    }, { instant: opts.instant, fade: collapsed ? 'out' : 'in' });
    if (!opts.silent) announce(collapsed ? '已收起代码块' : '已展开代码块');
  }

  function syncFoot(b) {
    if (!b.foot) return;
    var remain = b.total - b.rows;
    b.el.classList.toggle('is-expanded', b.expanded);
    if (!b.expanded && b.rows !== PREVIEW_ROWS) b.el.style.setProperty('--cb-rows', String(b.rows));
    else b.el.style.removeProperty('--cb-rows');
    b.moreBtn.hidden = b.expanded || remain <= STEP_ROWS;
    b.moreBtn.textContent = '显示更多 ' + Math.min(STEP_ROWS, remain) + ' 行';
    var label = b.expandBtn.querySelector('span');
    label.textContent = b.expanded ? '收起为预览' : '展开全部 · 剩余 ' + remain + ' 行';
    b.expandBtn.setAttribute('aria-expanded', b.expanded ? 'true' : 'false');
  }

  function setExpanded(b, expanded, opts) {
    opts = opts || {};
    if (!b.long) return;
    if (b.collapsed) setCollapsed(b, false, { instant: true, silent: true });
    if (b.expanded === expanded && (expanded || b.rows === PREVIEW_ROWS)) return;
    if (!expanded && !opts.instant) keepBarInView(b);
    morph(b, function () {
      b.expanded = expanded;
      b.rows = PREVIEW_ROWS;
      syncFoot(b);
    }, { instant: opts.instant });
    if (!opts.silent) announce(expanded ? '已展开全部 ' + b.total + ' 行' : '已收起为预览');
  }

  function showMore(b) {
    if (b.expanded) return;
    var next = b.rows + STEP_ROWS;
    if (next >= b.total - 2) { setExpanded(b, true); return; }
    morph(b, function () { b.rows = next; syncFoot(b); });
    announce('已显示前 ' + next + ' 行');
  }

  /* ------------------------------------------------------------------ 结构折叠 */

  function applyFolds(b, reveal) {
    var until = -1;
    var shown = [];
    b.lines.forEach(function (line, i) {
      var hide = i <= until;
      if (line.classList.contains('is-hidden') !== hide) {
        line.classList.toggle('is-hidden', hide);
        if (!hide && reveal) shown.push(line);
      }
      var r = b.regionAt && b.regionAt[i];
      if (r && !hide && r.folded) until = Math.max(until, r.e);
    });
    b.regions.forEach(function (r) {
      r.btn.setAttribute('aria-expanded', r.folded ? 'false' : 'true');
      r.btn.setAttribute('aria-label', (r.folded ? '展开' : '折叠') + '第 ' + b.lnOf(r.s) + '–' + b.lnOf(r.e) + ' 行');
      var tx = b.lines[r.s].querySelector('.cb-tx');
      var pill = tx.querySelector('.cb-folded');
      if (r.folded && !pill) {
        pill = doc.createElement('button');
        pill.type = 'button';
        pill.className = 'cb-folded';
        pill.setAttribute('aria-label', '展开折叠的 ' + (r.e - r.s) + ' 行');
        pill.textContent = '⋯ ' + (r.e - r.s) + ' 行';
        tx.appendChild(pill);
      } else if (!r.folded && pill) pill.remove();
    });
    if (shown.length && motion()) {
      shown.forEach(function (line, k) { line.style.setProperty('--i', String(Math.min(k, 14))); line.classList.add('is-in'); });
      setTimeout(function () { shown.forEach(function (line) { line.classList.remove('is-in'); line.style.removeProperty('--i'); }); }, 620);
    }
    var any = b.regions.some(function (r) { return r.folded; });
    if (b.foldsBtn) {
      b.foldsBtn.setAttribute('aria-pressed', any ? 'true' : 'false');
      b.foldsBtn.setAttribute('aria-label', any ? '展开全部结构' : '折叠全部结构');
      b.foldsBtn.setAttribute('data-tip', any ? '展开全部结构' : '折叠全部结构');
      b.foldsBtn.innerHTML = svg(any ? 'unfold' : 'fold');
    }
  }

  function indexRegions(b) {
    if (b.regionAt) return;
    b.regionAt = {};
    b.regions.forEach(function (r) { b.regionAt[r.s] = r; });
  }

  function foldRegion(b, r, fold) {
    indexRegions(b);
    if (r.folded === fold) return;
    morph(b, function () { r.folded = fold; applyFolds(b, !fold); });
  }

  /** mode: 'all' 全部折叠 / 'none' 全部展开 / 数字 N 表示折叠到第 N 层 */
  function foldLevel(b, mode) {
    if (!b.regions.length) return;
    indexRegions(b);
    if (b.collapsed) setCollapsed(b, false, { instant: true, silent: true });
    morph(b, function () {
      b.regions.forEach(function (r) {
        r.folded = mode === 'none' ? false : mode === 'all' ? true : r.depth >= mode - 1;
      });
      applyFolds(b, mode === 'none');
    });
    var n = b.regions.filter(function (r) { return r.folded; }).length;
    announce(mode === 'none' ? '已展开全部结构' : '已折叠 ' + n + ' 处结构');
  }

  function currentLevel(b) {
    if (!b.regions.some(function (r) { return r.folded; })) return 'none';
    for (var lv = 1; lv <= 3; lv++) {
      var ok = b.regions.every(function (r) { return r.folded === (r.depth >= lv - 1); });
      if (ok) return lv;
    }
    return '';
  }

  /** 让第 i 行可见：展开外层折叠区段、必要时展开块 */
  function reveal(b, i) {
    indexRegions(b);
    var changed = false;
    b.regions.forEach(function (r) { if (r.folded && r.s < i && i <= r.e) { r.folded = false; changed = true; } });
    if (changed) applyFolds(b, false);
    if (b.collapsed) setCollapsed(b, false, { instant: true, silent: true });
    if (b.long && !b.expanded && i >= b.rows - 2) setExpanded(b, true, { instant: true, silent: true });
  }

  /* ------------------------------------------------------------------ 行选择 */

  function gutterWidth(b) {
    if (!b.gutter) b.gutter = parseFloat(getComputedStyle(b.lines[0], '::before').width) || 48;
    return b.gutter;
  }

  function onCodeClick(b, e) {
    var t = e.target;
    var foldBtn = t.closest && t.closest('.cb-fold');
    if (foldBtn) {
      var line = foldBtn.parentNode;
      var i = b.lines.indexOf(line);
      indexRegions(b);
      if (b.regionAt[i]) foldRegion(b, b.regionAt[i], !b.regionAt[i].folded);
      return;
    }
    var pill = t.closest && t.closest('.cb-folded');
    if (pill) {
      indexRegions(b);
      var r = b.regionAt[b.lines.indexOf(pill.closest('.cb-line'))];
      if (r) foldRegion(b, r, false);
      return;
    }
    if (!t.classList || !t.classList.contains('cb-line')) return;
    var left = b.body.getBoundingClientRect().left;
    if (e.clientX - left > gutterWidth(b)) return;
    var idx = b.lines.indexOf(t);
    if (idx < 0) return;
    if (e.shiftKey && b.sel) selectLines(b, b.anchor, idx, true);
    else if (b.sel && b.sel.a === idx && b.sel.z === idx) clearSel(b);
    else { b.anchor = idx; selectLines(b, idx, idx, true); }
  }

  function selectLines(b, a, z, updateHash) {
    var lo = Math.min(a, z);
    var hi = Math.max(a, z);
    blocks.forEach(function (other) { if (other !== b && other.sel) clearSel(other, true); });
    b.lines.forEach(function (line, i) { line.classList.toggle('is-sel', i >= lo && i <= hi); });
    b.sel = { a: lo, z: hi };
    if (b.anchor == null) b.anchor = lo;
    b.el.classList.add('has-sel');
    var n = hi - lo + 1;
    b.selText.textContent = lo === hi ? '已选第 ' + b.lnOf(lo) + ' 行' : '已选第 ' + b.lnOf(lo) + '–' + b.lnOf(hi) + ' 行';
    b.selText.setAttribute('title', '共 ' + n + ' 行');
    if (updateHash && history.replaceState) history.replaceState(null, '', '#' + b.id + '-L' + b.lnOf(lo) + (hi !== lo ? '-L' + b.lnOf(hi) : ''));
  }

  function clearSel(b, keepHash) {
    if (!b.sel) return;
    b.lines.forEach(function (line) { line.classList.remove('is-sel'); });
    b.sel = null;
    b.anchor = null;
    b.el.classList.remove('has-sel');
    if (!keepHash && history.replaceState && new RegExp('^#' + b.id + '(-L|$)').test(window.location.hash)) {
      history.replaceState(null, '', window.location.pathname + window.location.search);
    }
  }

  /* ------------------------------------------------------------------ 复制 */

  function commandsText(b) {
    var out = [];
    var cont = false;
    b.lines.forEach(function (line, i) {
      var t = b.texts[i];
      if (line.classList.contains('is-cmd')) { t = t.replace(/^\$ /, ''); out.push(t); cont = /\\\s*$/.test(t); }
      else if (cont) { out.push(t); cont = /\\\s*$/.test(t); }
    });
    return out.join('\n');
  }
  function allText(b) { return b.texts.join('\n'); }
  function selText(b) { return b.sel ? b.texts.slice(b.sel.a, b.sel.z + 1).join('\n') : ''; }

  /** 手动选中复制：逐行拼接，保留空行，剔除折叠胶囊 / 折叠钮 / 提示符 */
  on(doc, 'copy', function (e) {
    var sel = window.getSelection();
    if (!sel || !sel.rangeCount || sel.isCollapsed || !e.clipboardData) return;
    var range = sel.getRangeAt(0);
    var node = range.commonAncestorContainer;
    var el = node.nodeType === 1 ? node : node.parentNode;
    if (!el || !el.closest || !el.closest('.cb-code')) return;
    var frag = range.cloneContents();
    $$('.cb-folded, .cb-fold, .cb-prompt', frag).forEach(function (n) { n.remove(); });
    var lines = $$('.cb-line', frag);
    var text = lines.length ? lines.map(function (l) { return l.textContent; }).join('\n') : frag.textContent;
    e.clipboardData.setData('text/plain', text);
    e.preventDefault();
  });

  /* ------------------------------------------------------------------ 菜单 */

  var menu = { el: null, scrim: null, b: null, anchor: null };

  function mi(act, icon, text, extra) {
    extra = extra || {};
    var role = extra.check != null ? 'menuitemcheckbox' : 'menuitem';
    return '<button type="button" class="cb-mi" role="' + role + '" data-act="' + act + '"' +
      (extra.check != null ? ' aria-checked="' + (extra.check ? 'true' : 'false') + '"' : '') + ' tabindex="-1">' +
      svg(icon) + '<span class="cb-mi__text">' + esc(text) + '</span>' +
      (extra.hint ? '<span class="cb-mi__hint">' + esc(extra.hint) + '</span>' : '') +
      (extra.check != null ? svg('check', 'cb-mi__check') : '') + '</button>';
  }
  function seg(label, act, options, current) {
    return '<div class="cb-menu__head" aria-hidden="true">' + esc(label) + '</div><div class="cb-seg" role="group" aria-label="' + esc(label) + '">' +
      options.map(function (o) {
        return '<button type="button" role="menuitemradio" tabindex="-1" data-act="' + act + '" data-val="' + o[0] + '" aria-checked="' + (String(o[0]) === String(current) ? 'true' : 'false') + '">' + esc(o[1]) + '</button>';
      }).join('') + '</div>';
  }
  function group(title, html) {
    return '<div class="cb-menu__group" role="group"' + (title ? ' aria-label="' + esc(title) + '"' : '') + '>' +
      (title ? '<div class="cb-menu__head" aria-hidden="true">' + esc(title) + '</div>' : '') + html + '</div>';
  }

  function menuHtml(b) {
    var html = '';
    html += group('视图',
      mi('wrap', 'wrap', '自动换行', { check: prefs.wrap }) +
      mi('ln', 'lines', '显示行号', { check: prefs.ln }) +
      seg('代码配色', 'theme', [['light', '浅色'], ['dark', '深色'], ['auto', '跟随系统']], prefs.theme));
    var fold = mi('collapse', b.collapsed ? 'chev' : 'up', b.collapsed ? '展开代码块' : '收起代码块');
    if (b.long) fold += mi('preview', 'preview', b.expanded ? '收起为预览' : '展开全部', { hint: b.total + ' 行' });
    if (b.regions.length) {
      fold += mi('fold-all', 'fold', '折叠全部结构', { hint: b.regions.length + ' 处' }) + mi('unfold-all', 'unfold', '展开全部结构');
      var maxDepth = Math.max.apply(null, b.regions.map(function (r) { return r.depth; }));
      if (maxDepth >= 1) {
        var opts = [];
        for (var lv = 1; lv <= Math.min(maxDepth + 1, 3); lv++) opts.push([lv, '第 ' + lv + ' 层']);
        opts.push(['none', '不折叠']);
        fold += seg('折叠层级', 'level', opts, currentLevel(b));
      }
    }
    html += group('折叠', fold);
    var out = '';
    if (b.cmds) out += mi('copy-cmd', 'terminal', '仅复制命令', { hint: '去掉 $ 与输出' }) + mi('copy-all', 'copy', '复制全部内容', { hint: '含输出' });
    else out += mi('copy-all', 'copy', '复制全部代码', { hint: b.total + ' 行' });
    out += mi('link', 'link', '复制代码块链接') + mi('download', 'download', '下载为文件', { hint: '.' + b.ext });
    if (!MOBILE.matches || fs.b !== b) out += mi('fs', fs.b === b ? 'shrink' : 'expand', fs.b === b ? '退出全屏' : '全屏查看');
    html += group('复制与导出', out);
    if (blocks.length > 1 && fs.b !== b) {
      html += group('本页 ' + blocks.length + ' 个代码块',
        mi('page-collapse', 'up', '全部收起') + mi('page-expand', 'chev', '全部展开') + mi('page-reset', 'preview', '恢复默认视图'));
    }
    return html;
  }

  function ensureMenu() {
    if (menu.el) return;
    menu.scrim = doc.createElement('div');
    menu.scrim.className = 'cb-scrim';
    menu.scrim.hidden = true;
    menu.el = doc.createElement('div');
    menu.el.className = 'cb-menu';
    menu.el.setAttribute('role', 'menu');
    menu.el.hidden = true;
    doc.body.appendChild(menu.scrim);
    doc.body.appendChild(menu.el);
    on(menu.scrim, 'click', function () { closeMenu(); });
    on(menu.el, 'click', function (e) {
      var btn = e.target.closest('[data-act]');
      if (!btn || !menu.b) return;
      var b = menu.b;
      var act = btn.getAttribute('data-act');
      if (act === 'theme' || act === 'level') {
        var val = btn.getAttribute('data-val');
        $$('[data-act="' + act + '"]', menu.el).forEach(function (x) { x.setAttribute('aria-checked', x === btn ? 'true' : 'false'); });
        if (act === 'theme') setPref('theme', val, b);
        else foldLevel(b, val === 'none' ? 'none' : Number(val));
        return;
      }
      closeMenu(act === 'menu-close');
      runAction(b, act, btn);
    });
    on(menu.el, 'keydown', function (e) {
      var items = $$('.cb-mi, .cb-seg button, .cb-menu__cancel', menu.el).filter(function (x) { return x.offsetParent !== null; });
      var i = items.indexOf(doc.activeElement);
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        var next = e.key === 'ArrowDown' ? (i + 1) % items.length : (i - 1 + items.length) % items.length;
        items[next].focus();
      } else if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
        var segEl = doc.activeElement && doc.activeElement.closest('.cb-seg');
        if (!segEl) return;
        e.preventDefault();
        var opts = $$('button', segEl);
        var k = opts.indexOf(doc.activeElement);
        opts[(k + (e.key === 'ArrowRight' ? 1 : -1) + opts.length) % opts.length].focus();
      } else if (e.key === 'Home' || e.key === 'End') {
        e.preventDefault();
        items[e.key === 'Home' ? 0 : items.length - 1].focus();
      } else if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        closeMenu();
      } else if (e.key === 'Tab') {
        closeMenu();
      }
    });
  }

  function openMenu(b, anchor) {
    ensureMenu();
    if (menu.b === b && !menu.el.hidden) { closeMenu(); return; }
    closeMenu(true, true);
    menu.b = b;
    menu.anchor = anchor;
    var sheet = MOBILE.matches;
    menu.el.innerHTML = '<div class="cb-menu__body">' + menuHtml(b) + '</div>' +
      '<button type="button" class="cb-menu__cancel" data-act="menu-close">取消</button>';
    menu.el.classList.toggle('cb-menu--sheet', sheet);
    menu.el.classList.remove('is-leaving');
    menu.el.setAttribute('aria-label', b.label + ' 代码块操作');
    menu.el.hidden = false;
    menu.scrim.hidden = !sheet;
    if (sheet) {
      menu.el.style.left = menu.el.style.top = '';
      doc.body.classList.add('no-scroll');
    } else placeMenu(true);
    anchor.setAttribute('aria-expanded', 'true');
    var first = menu.el.querySelector('.cb-mi');
    if (first) first.focus({ preventScroll: true });
  }

  /** 桌面 popover 定位：锚定按钮右下，空间不足时翻到上方；滚动时跟随锚点 */
  function placeMenu(first) {
    var r = menu.anchor.getBoundingClientRect();
    var w = menu.el.offsetWidth;
    var h = menu.el.offsetHeight;
    var left = clamp(r.right - w, 12, window.innerWidth - w - 12);
    var below = first ? r.bottom + 6 + h <= window.innerHeight - 12 : menu.below;
    var top = below ? r.bottom + 6 : Math.max(12, r.top - 6 - h);
    menu.below = below;
    menu.el.style.left = left + 'px';
    menu.el.style.top = top + 'px';
    if (first) menu.el.style.setProperty('--origin', (below ? 'top ' : 'bottom ') + (r.right - left) + 'px');
  }

  function closeMenu(skipFocus, instant) {
    if (!menu.el || menu.el.hidden) return;
    var el = menu.el;
    var anchor = menu.anchor;
    var sheet = el.classList.contains('cb-menu--sheet');
    if (anchor) anchor.setAttribute('aria-expanded', 'false');
    menu.b = null;
    menu.anchor = null;
    menu.scrim.hidden = true;
    if (sheet && !fs.b) doc.body.classList.remove('no-scroll');
    var hide = function () { el.hidden = true; el.classList.remove('is-leaving'); };
    if (instant || !motion()) hide();
    else { el.classList.add('is-leaving'); setTimeout(hide, sheet ? 230 : 130); }
    if (!skipFocus && anchor && anchor.isConnected) anchor.focus({ preventScroll: true });
  }

  on(doc, 'pointerdown', function (e) {
    if (!menu.el || menu.el.hidden) return;
    if (menu.el.contains(e.target) || (menu.anchor && menu.anchor.contains(e.target))) return;
    closeMenu(true);
  }, true);
  on(window, 'resize', function () { closeMenu(true, true); });
  on(window, 'scroll', function () {
    if (!menu.el || menu.el.hidden || !menu.anchor || menu.el.classList.contains('cb-menu--sheet')) return;
    var r = menu.anchor.getBoundingClientRect();
    if (r.bottom < 0 || r.top > window.innerHeight) closeMenu(true, true);
    else placeMenu(false);
  }, { passive: true });

  /* ------------------------------------------------------------------ 全屏 */

  var fs = { b: null, overlay: null, panel: null, dock: null, ghost: null, last: null, hits: [], cur: -1, q: '' };

  function ensureOverlay() {
    if (fs.overlay) return;
    var o = doc.createElement('div');
    o.className = 'cb-overlay';
    o.hidden = true;
    o.setAttribute('role', 'dialog');
    o.setAttribute('aria-modal', 'true');
    o.innerHTML = '<div class="cb-overlay__backdrop" data-fs="close"></div>' +
      '<div class="cb-overlay__panel"></div>' +
      '<div class="cb-dock" role="toolbar" aria-label="全屏工具">' +
        '<label class="cb-find">' + svg('search') +
          '<input type="search" enterkeyhint="search" autocomplete="off" spellcheck="false" placeholder="查找" aria-label="在代码中查找">' +
          '<span class="cb-find__count" aria-live="polite"></span>' +
          '<button type="button" class="cb-btn" data-fs="prev" aria-label="上一个" data-tip="上一个 ⇧↩">' + svg('up') + '</button>' +
          '<button type="button" class="cb-btn" data-fs="next" aria-label="下一个" data-tip="下一个 ↩">' + svg('chev') + '</button>' +
        '</label>' +
        '<span class="cb-dock__sep" aria-hidden="true"></span>' +
        '<button type="button" class="cb-btn" data-fs="zoom-out" aria-label="缩小字号" data-tip="缩小 ⌘−">' + svg('minus') + '</button>' +
        '<button type="button" class="cb-zoom cb-btn" data-fs="zoom-reset" aria-label="重置字号" data-tip="重置 ⌘0">100%</button>' +
        '<button type="button" class="cb-btn" data-fs="zoom-in" aria-label="放大字号" data-tip="放大 ⌘+">' + svg('plus') + '</button>' +
        '<span class="cb-dock__sep" aria-hidden="true"></span>' +
        '<button type="button" class="cb-btn" data-fs="wrap" aria-pressed="false" aria-label="自动换行" data-tip="自动换行">' + svg('wrap') + '</button>' +
        '<button type="button" class="cb-btn" data-fs="ln" aria-pressed="true" aria-label="显示行号" data-tip="显示行号">' + svg('lines') + '</button>' +
        '<button type="button" class="cb-btn" data-fs="native" aria-pressed="false" aria-label="系统全屏" data-tip="系统全屏">' + svg('screen') + '</button>' +
      '</div>';
    doc.body.appendChild(o);
    fs.overlay = o;
    fs.panel = o.querySelector('.cb-overlay__panel');
    fs.dock = o.querySelector('.cb-dock');
    fs.input = o.querySelector('.cb-find input');
    fs.count = o.querySelector('.cb-find__count');
    fs.zoomEl = o.querySelector('.cb-zoom');
    var nativeBtn = o.querySelector('[data-fs="native"]');
    if (!(doc.fullscreenEnabled || doc.webkitFullscreenEnabled)) nativeBtn.hidden = true;

    on(o, 'click', function (e) {
      var btn = e.target.closest('[data-fs]');
      if (!btn) return;
      var act = btn.getAttribute('data-fs');
      if (act === 'close') closeFs();
      else if (act === 'next') gotoHit(fs.cur + 1);
      else if (act === 'prev') gotoHit(fs.cur - 1);
      else if (act === 'zoom-in') setZoom(prefs.zoom + 0.1);
      else if (act === 'zoom-out') setZoom(prefs.zoom - 0.1);
      else if (act === 'zoom-reset') setZoom(1);
      else if (act === 'wrap') setPref('wrap', !prefs.wrap);
      else if (act === 'ln') setPref('ln', !prefs.ln);
      else if (act === 'native') toggleNative();
    });
    var findTimer;
    on(fs.input, 'input', function () { clearTimeout(findTimer); findTimer = setTimeout(function () { runFind(fs.input.value); }, 90); });
    on(fs.input, 'keydown', function (e) {
      if (e.key === 'Enter') { e.preventDefault(); if (fs.q !== fs.input.value) runFind(fs.input.value); else gotoHit(fs.cur + (e.shiftKey ? -1 : 1)); }
      else if (e.key === 'Escape' && fs.input.value) { e.preventDefault(); e.stopPropagation(); fs.input.value = ''; runFind(''); }
    });
    // Safari 点击按钮不转移焦点（落到 body），因此在 document 层监听全屏快捷键
    on(doc, 'keydown', function (e) { if (fs.b && !e.defaultPrevented) onFsKey(e); });
    on(doc, 'fullscreenchange', syncDock);
    on(doc, 'webkitfullscreenchange', syncDock);
  }

  function syncDock() {
    if (!fs.overlay) return;
    var q = function (s) { return fs.overlay.querySelector(s); };
    q('[data-fs="wrap"]').setAttribute('aria-pressed', prefs.wrap ? 'true' : 'false');
    q('[data-fs="ln"]').setAttribute('aria-pressed', prefs.ln ? 'true' : 'false');
    var nativeOn = !!(doc.fullscreenElement || doc.webkitFullscreenElement);
    var nb = q('[data-fs="native"]');
    nb.setAttribute('aria-pressed', nativeOn ? 'true' : 'false');
    nb.setAttribute('data-tip', nativeOn ? '退出系统全屏' : '系统全屏');
    fs.zoomEl.textContent = Math.round(prefs.zoom * 100) + '%';
    fs.overlay.style.setProperty('--cb-zoom', String(prefs.zoom));
  }

  function setZoom(z) {
    prefs.zoom = Math.round(clamp(z, 0.7, 1.8) * 10) / 10;
    savePrefs();
    syncDock();
    if (fs.b) fs.b.gutter = 0;
  }

  function toggleNative() {
    var o = fs.overlay;
    if (doc.fullscreenElement || doc.webkitFullscreenElement) {
      (doc.exitFullscreen || doc.webkitExitFullscreen).call(doc);
    } else {
      var req = o.requestFullscreen || o.webkitRequestFullscreen;
      if (req) { var p = req.call(o); if (p && p.catch) p.catch(function () { announce('浏览器拒绝了系统全屏'); }); }
    }
  }

  function focusables() {
    return $$('button:not([hidden]):not([disabled]), input, [tabindex="0"]', fs.overlay).filter(function (el) {
      return el.offsetParent !== null && el.getAttribute('tabindex') !== '-1';
    });
  }

  function onFsKey(e) {
    var mod = e.metaKey || e.ctrlKey;
    if (e.key === 'Escape') {
      if (menu.el && !menu.el.hidden) return;
      e.preventDefault();
      closeFs();
    } else if (mod && (e.key === 'f' || e.key === 'F')) {
      e.preventDefault();
      fs.input.focus();
      fs.input.select();
    } else if (mod && (e.key === 'g' || e.key === 'G')) {
      e.preventDefault();
      gotoHit(fs.cur + (e.shiftKey ? -1 : 1));
    } else if (mod && (e.key === '=' || e.key === '+')) { e.preventDefault(); setZoom(prefs.zoom + 0.1); }
    else if (mod && e.key === '-') { e.preventDefault(); setZoom(prefs.zoom - 0.1); }
    else if (mod && e.key === '0') { e.preventDefault(); setZoom(1); }
    else if (e.key === 'Tab') {
      var list = focusables();
      if (!list.length) return;
      var i = list.indexOf(doc.activeElement);
      if (i === -1) { e.preventDefault(); list[e.shiftKey ? list.length - 1 : 0].focus(); }
      else if (e.shiftKey && i === 0) { e.preventDefault(); list[list.length - 1].focus(); }
      else if (!e.shiftKey && i === list.length - 1) { e.preventDefault(); list[0].focus(); }
    }
  }

  /** 全屏期间背景页面不可聚焦、不可点击（真正的模态） */
  function setInert(on) {
    $$('body > .site-shell, body > .skip-link').forEach(function (el) {
      if (on) el.setAttribute('inert', ''); else el.removeAttribute('inert');
    });
  }

  function setFsButton(b, inFs) {
    b.fsBtn.innerHTML = svg(inFs ? 'shrink' : 'expand') + '<span class="cb-fs-label">完成</span>';
    b.fsBtn.setAttribute('aria-label', inFs ? '退出全屏' : '全屏查看');
    b.fsBtn.setAttribute('data-tip', inFs ? '退出全屏 Esc' : '全屏查看');
    var green = b.bar.querySelector('.cb-light--zoom');
    var red = b.bar.querySelector('.cb-light--close');
    if (green) green.setAttribute('data-tip', inFs ? '退出全屏' : '全屏');
    if (red) red.setAttribute('data-tip', inFs ? '关闭全屏' : (b.collapsed ? '展开' : '收起'));
  }

  function openFs(b) {
    if (fs.b) return;
    ensureOverlay();
    closeMenu(true, true);
    var fig = b.el;
    var r0 = fig.getBoundingClientRect();
    fs.last = doc.activeElement;
    fs.b = b;
    var ghost = doc.createElement('div');
    ghost.className = 'cb-ghost';
    ghost.setAttribute('aria-hidden', 'true');
    ghost.style.height = r0.height + 'px';
    ghost.innerHTML = '<span>正在全屏查看 · Esc 返回</span>';
    fig.parentNode.insertBefore(ghost, fig);
    fs.ghost = ghost;
    fs.panel.appendChild(fig);
    fig.classList.add('is-fs');
    fs.overlay.setAttribute('aria-label', '全屏查看：' + b.label + ' 代码');
    setFsButton(b, true);
    syncDock();
    fs.overlay.hidden = false;
    doc.body.classList.add('no-scroll');
    setInert(true);
    b.gutter = 0;
    fs.input.value = '';
    fs.count.textContent = '';
    if (motion()) {
      var r1 = fs.panel.getBoundingClientRect();
      var s = clamp(r0.width / r1.width, 0.3, 1);
      var from = 'translate(' + (r0.left - r1.left) + 'px, ' + (r0.top - r1.top) + 'px) scale(' + s + ')';
      fs.panel.animate([
        { transform: from, opacity: 0.4 },
        { opacity: 1, offset: 0.3 },
        { transform: 'none', opacity: 1 }
      ], SPRING ? { duration: SPRING.duration, easing: SPRING.easing } : { duration: 460, easing: EASE });
      fs.overlay.querySelector('.cb-overlay__backdrop').animate([{ opacity: 0 }, { opacity: 1 }], { duration: 280, easing: 'ease' });
      fs.dock.animate([{ translate: '0 24px', opacity: 0 }, { translate: '0 0', opacity: 1 }], { duration: 420, delay: 120, easing: EASE, fill: 'backwards' });
    }
    setTimeout(function () { b.body.focus({ preventScroll: true }); }, 30);
    if (b.sel) setTimeout(function () { centerLine(b, b.sel.a); }, 60);
  }

  function closeFs() {
    var b = fs.b;
    if (!b) return;
    if (doc.fullscreenElement || doc.webkitFullscreenElement) { try { (doc.exitFullscreen || doc.webkitExitFullscreen).call(doc); } catch (e) { /* 忽略 */ } }
    runFind('');
    var finish = function () {
      if (!fs.ghost) return;
      fs.ghost.parentNode.replaceChild(b.el, fs.ghost);
      fs.ghost = null;
      b.el.classList.remove('is-fs');
      fs.overlay.hidden = true;
      setInert(false);
      if (!menu.el || menu.el.hidden || !menu.el.classList.contains('cb-menu--sheet')) doc.body.classList.remove('no-scroll');
      fs.b = null;
      b.gutter = 0;
      setFsButton(b, false);
      // Safari 点击不聚焦按钮，打开前的焦点可能是 body；此时归还到全屏按钮
      var last = fs.last;
      var target = last && last !== doc.body && last.isConnected && (b.el.contains(last) || !fs.overlay.contains(last)) ? last : b.fsBtn;
      if (target === b.el.querySelector('.cb-light--zoom') || target === b.el.querySelector('.cb-light--close')) target = b.fsBtn;
      if (target && target.focus) target.focus({ preventScroll: true });
    };
    if (!motion()) { finish(); return; }
    var r1 = fs.panel.getBoundingClientRect();
    var r0 = fs.ghost.getBoundingClientRect();
    var s = clamp(r0.width / r1.width, 0.3, 1);
    var anim = fs.panel.animate([
      { transform: 'none', opacity: 1 },
      { transform: 'translate(' + (r0.left - r1.left) + 'px, ' + (r0.top - r1.top) + 'px) scale(' + s + ')', opacity: 0 }
    ], { duration: 300, easing: 'cubic-bezier(0.4, 0, 0.6, 1)' });
    fs.overlay.querySelector('.cb-overlay__backdrop').animate([{ opacity: 1 }, { opacity: 0 }], { duration: 300, easing: 'ease', fill: 'forwards' });
    fs.dock.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 160, fill: 'forwards' });
    var done = false;
    var end = function () {
      if (done) return;
      done = true;
      finish();
      fs.overlay.getAnimations({ subtree: true }).forEach(function (a) { a.cancel(); });
    };
    anim.onfinish = end;
    setTimeout(end, 420);
  }

  /* ------------------------------------------------------------------ 查找 */

  function clearFind() {
    var b = fs.b;
    if (b) b.lines.forEach(function (l) { l.classList.remove('is-found', 'is-found-on'); });
    if (HL) { CSS.highlights.delete('cb-find'); CSS.highlights.delete('cb-find-on'); }
    fs.hits = [];
    fs.cur = -1;
  }

  function rangeFor(line, start, len) {
    var tx = line.querySelector('.cb-tx');
    var walker = doc.createTreeWalker(tx, NodeFilter.SHOW_TEXT, {
      acceptNode: function (n) { return n.parentNode.closest('.cb-folded') ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT; }
    });
    var pos = 0;
    var range = doc.createRange();
    var startSet = false;
    var end = start + len;
    var n;
    while ((n = walker.nextNode())) {
      var l = n.nodeValue.length;
      if (!startSet && start < pos + l) { range.setStart(n, start - pos); startSet = true; }
      if (startSet && end <= pos + l) { range.setEnd(n, end - pos); return range; }
      pos += l;
    }
    return null;
  }

  function runFind(q) {
    clearFind();
    fs.q = q || '';
    if (!fs.count) return;
    var b = fs.b;
    if (!b || !q) { fs.count.textContent = ''; return; }
    var ql = q.toLowerCase();
    b.texts.forEach(function (t, i) {
      var tl = t.toLowerCase();
      var at = tl.indexOf(ql);
      while (at !== -1) { fs.hits.push({ i: i, at: at }); at = tl.indexOf(ql, at + ql.length); }
    });
    if (!fs.hits.length) { fs.count.textContent = '无结果'; return; }
    var seen = {};
    fs.hits.forEach(function (h) { if (!seen[h.i]) { seen[h.i] = 1; b.lines[h.i].classList.add('is-found'); } });
    if (HL) {
      var ranges = [];
      fs.hits.forEach(function (h) { var r = rangeFor(b.lines[h.i], h.at, ql.length); if (r) { h.range = r; ranges.push(r); } });
      CSS.highlights.set('cb-find', makeHighlight(ranges));
    }
    gotoHit(0);
  }

  function gotoHit(k) {
    var b = fs.b;
    if (!b || !fs.hits.length) return;
    k = (k + fs.hits.length) % fs.hits.length;
    var prev = fs.hits[fs.cur];
    if (prev) b.lines[prev.i].classList.remove('is-found-on');
    fs.cur = k;
    var h = fs.hits[k];
    var hiddenBefore = b.lines[h.i].classList.contains('is-hidden');
    reveal(b, h.i);
    if (hiddenBefore && HL) {
      // 展开折叠后折叠胶囊被移除，文本节点不变；重建全部范围以防偏移
      fs.hits.forEach(function (x) { x.range = rangeFor(b.lines[x.i], x.at, fs.q.length); });
      CSS.highlights.set('cb-find', makeHighlight(fs.hits.map(function (x) { return x.range; })));
    }
    b.lines[h.i].classList.add('is-found-on');
    if (HL && h.range) CSS.highlights.set('cb-find-on', makeHighlight([h.range]));
    fs.count.textContent = (k + 1) + ' / ' + fs.hits.length;
    centerLine(b, h.i, h.range);
  }

  function centerLine(b, i, range) {
    var body = b.body;
    var br = body.getBoundingClientRect();
    var lr = b.lines[i].getBoundingClientRect();
    var top = body.scrollTop + (lr.top - br.top) - (body.clientHeight - lr.height) / 2;
    var left = body.scrollLeft;
    if (range && !prefs.wrap) {
      var rr = range.getBoundingClientRect();
      var minX = br.left + gutterWidth(b) + 16;
      var maxX = br.left + body.clientWidth - 24;
      if (rr.left < minX) left -= (minX - rr.left) + 24;
      else if (rr.right > maxX) left += (rr.right - maxX) + 24;
    }
    body.scrollTo({ top: Math.max(0, top), left: Math.max(0, left), behavior: motion() ? 'smooth' : 'auto' });
  }

  /* ------------------------------------------------------------------ 动作分发 */

  function runAction(b, act, btn) {
    switch (act) {
      case 'collapse':
        if (fs.b === b) { closeFs(); return; }
        setCollapsed(b, !b.collapsed);
        break;
      case 'preview':
        if (fs.b === b) return;
        if (b.long) setExpanded(b, !b.expanded);
        break;
      case 'more': showMore(b); break;
      case 'fs': if (fs.b === b) closeFs(); else openFs(b); break;
      case 'wrap': setPref('wrap', !prefs.wrap, b); break;
      case 'ln': setPref('ln', !prefs.ln, b); break;
      case 'folds':
        foldLevel(b, b.regions.some(function (r) { return r.folded; }) ? 'none' : 'all');
        break;
      case 'fold-all': foldLevel(b, 'all'); break;
      case 'unfold-all': foldLevel(b, 'none'); break;
      case 'copy':
        if (b.cmds) doCopy(commandsText(b), b.copyBtn, '已复制命令');
        else doCopy(allText(b), b.copyBtn, '已复制 ' + b.total + ' 行代码');
        break;
      case 'copy-cmd': doCopy(commandsText(b), b.copyBtn, '已复制命令'); break;
      case 'copy-all': doCopy(allText(b), b.copyBtn, '已复制全部 ' + b.total + ' 行'); break;
      case 'link': doCopy(blockUrl(b), b.copyBtn, '已复制代码块链接'); break;
      case 'download': download(b); break;
      case 'sel-copy': if (b.sel) doCopy(selText(b), btn, '已复制 ' + (b.sel.z - b.sel.a + 1) + ' 行'); break;
      case 'sel-link': if (b.sel) doCopy(blockUrl(b, b.sel.a, b.sel.z), btn, '已复制行链接'); break;
      case 'sel-clear': clearSel(b); b.titleBtn.focus({ preventScroll: true }); break;
      case 'menu': openMenu(b, b.menuBtn); break;
      case 'page-collapse': pageAll(b, 'collapse'); break;
      case 'page-expand': pageAll(b, 'expand'); break;
      case 'page-reset': pageAll(b, 'reset'); break;
      default: break;
    }
  }

  /** 本页全部代码块：瞬时切换，并保持触发块在视口中的位置 */
  function pageAll(origin, kind) {
    var top0 = origin.el.getBoundingClientRect().top;
    blocks.forEach(function (b) {
      if (kind === 'collapse') setCollapsed(b, true, { instant: true, silent: true });
      else {
        setCollapsed(b, false, { instant: true, silent: true });
        if (b.long) setExpanded(b, kind === 'expand', { instant: true, silent: true });
        if (kind === 'reset') {
          if (b.regions.some(function (r) { return r.folded; })) { indexRegions(b); b.regions.forEach(function (r) { r.folded = false; }); applyFolds(b, false); }
          clearSel(b);
        }
      }
    });
    window.scrollBy(0, origin.el.getBoundingClientRect().top - top0);
    announce(kind === 'collapse' ? '已收起本页 ' + blocks.length + ' 个代码块' : kind === 'expand' ? '已展开本页全部代码块' : '已恢复默认视图');
  }

  on(doc, 'click', function (e) {
    var btn = e.target.closest && e.target.closest('.cb [data-act]');
    if (!btn) return;
    var fig = btn.closest('.cb');
    var b = fig && fig._cb;
    if (!b || btn.disabled) return;
    runAction(b, btn.getAttribute('data-act'), btn);
  });

  /* ------------------------------------------------------------------ 深链 */

  function fromHash(smooth) {
    var m = /^#(cb-\d+)(?:-L(\d+)(?:-L(\d+))?)?$/.exec(window.location.hash || '');
    if (!m || !byId[m[1]]) return;
    var b = byId[m[1]];
    if (fs.b && fs.b !== b) closeFs();
    setCollapsed(b, false, { instant: true, silent: true });
    var target = b.el;
    if (m[2]) {
      var a = clamp(Number(m[2]) - b.start, 0, b.total - 1);
      var z = m[3] ? clamp(Number(m[3]) - b.start, 0, b.total - 1) : a;
      reveal(b, Math.max(a, z));
      for (var i = Math.min(a, z); i <= Math.max(a, z); i++) reveal(b, i);
      b.anchor = Math.min(a, z);
      selectLines(b, a, z, false);
      target = b.lines[Math.min(a, z)];
    }
    requestAnimationFrame(function () {
      var y = target.getBoundingClientRect().top + window.scrollY - (m[2] ? window.innerHeight * 0.3 : headerH() + 16);
      window.scrollTo({ top: Math.max(0, y), behavior: smooth && motion() ? 'smooth' : 'auto' });
    });
  }

  /* ------------------------------------------------------------------ 初始化 */

  function init() {
    if (HL) root.classList.add('cb-hl');
    var perf = window.performance && performance.mark ? performance : null;
    if (perf) perf.mark('cb:init:start');
    var figs = $$('.article-content figure.cb, .cb-scope figure.cb');
    if (!figs.length) figs = $$('figure.cb');
    figs.forEach(function (fig, i) {
      var b = setup(fig, i + 1);
      if (b) { blocks.push(b); byId[b.id] = b; }
    });
    applyPrefs();
    if (perf) { perf.mark('cb:init:end'); try { perf.measure('cb:init', 'cb:init:start', 'cb:init:end'); } catch (e) { /* 忽略 */ } }
    if (!blocks.length) return;
    fromHash(false);
    on(window, 'hashchange', function () { fromHash(true); });
    on(MOBILE, 'change', function () { blocks.forEach(function (b) { b.gutter = 0; }); });
  }

  if (doc.readyState === 'loading') doc.addEventListener('DOMContentLoaded', init);
  else init();
})();
