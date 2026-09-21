/**
 * 飞轮之道「判断观测仪」主题交互
 * 模块：工具 / 存储 / 检索 / 搜索浮层 / 菜单抽屉 / 首页 / 发现 / 专题 / 路径 / 路径详情 / 文章 / 归档
 * 约定：所有交互不依赖 hover；键盘可达；localStorage 读写全部包裹 try/catch。
 */
(function () {
  'use strict';

  var OBS = window.__OBS || {};
  var ROOT = (OBS.root || '/').replace(/\/$/, '');
  var MOBILE = window.matchMedia('(max-width: 800px)');
  var REDUCED = window.matchMedia('(prefers-reduced-motion: reduce)');

  /* ------------------------------------------------------------------ 工具 */

  function $(sel, ctx) { return (ctx || document).querySelector(sel); }
  function $$(sel, ctx) { return Array.prototype.slice.call((ctx || document).querySelectorAll(sel)); }
  function on(el, type, fn, opts) { if (el) el.addEventListener(type, fn, opts); }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]; }); }
  function debounce(fn, wait) { var t; return function () { var a = arguments, c = this; clearTimeout(t); t = setTimeout(function () { fn.apply(c, a); }, wait); }; }

  var store = {
    get: function (key, fallback) {
      try { var raw = localStorage.getItem(key); return raw ? JSON.parse(raw) : fallback; } catch (e) { return fallback; }
    },
    set: function (key, value) {
      try { localStorage.setItem(key, JSON.stringify(value)); } catch (e) { /* 私密模式等场景忽略 */ }
    }
  };

  var toastTimer;
  function toast(msg) {
    var el = $('#toast');
    if (!el) return;
    el.textContent = msg;
    el.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { el.hidden = true; }, 2200);
  }

  function lockScroll(lock) { document.body.classList.toggle('no-scroll', !!lock); }

  function smoothScrollTo(el) {
    if (!el) return;
    el.scrollIntoView({ behavior: REDUCED.matches ? 'auto' : 'smooth', block: 'start' });
  }

  /** 通用弹层：打开 / 关闭 / ESC / 焦点归还 */
  function makeLayer(el, opts) {
    opts = opts || {};
    var lastFocus = null;
    function open() {
      if (!el || !el.hidden) return;
      lastFocus = document.activeElement;
      el.hidden = false;
      lockScroll(true);
      var target = opts.focus ? $(opts.focus, el) : el.querySelector('input, button, a');
      if (target) setTimeout(function () { target.focus(); }, 30);
      if (opts.onOpen) opts.onOpen();
    }
    function close() {
      if (!el || el.hidden) return;
      el.hidden = true;
      lockScroll(false);
      if (lastFocus && typeof lastFocus.focus === 'function') lastFocus.focus();
      if (opts.onClose) opts.onClose();
    }
    on(el, 'keydown', function (e) { if (e.key === 'Escape') { e.preventDefault(); close(); } });
    return { open: open, close: close, el: el, isOpen: function () { return el && !el.hidden; } };
  }

  /* ------------------------------------------------------------------ 进度与收藏存储 */

  var PROGRESS_KEY = 'obs:progress';
  var BOOKMARK_KEY = 'obs:bookmarks';
  var FONT_KEY = 'obs:font-scale';

  var progress = {
    all: function () { return store.get(PROGRESS_KEY, {}); },
    path: function (slug) { return this.all()[slug] || {}; },
    mark: function (pathSlug, postSlug, patch) {
      var all = this.all();
      var p = all[pathSlug] || {};
      p[postSlug] = Object.assign({}, p[postSlug] || {}, patch, { ts: Date.now() });
      all[pathSlug] = p;
      store.set(PROGRESS_KEY, all);
    }
  };

  var bookmarks = {
    all: function () { return store.get(BOOKMARK_KEY, {}); },
    has: function (slug) { return !!this.all()[slug]; },
    toggle: function (entry) {
      var all = this.all();
      var on = !all[entry.slug];
      if (on) all[entry.slug] = { title: entry.title, url: entry.url, ts: Date.now() }; else delete all[entry.slug];
      store.set(BOOKMARK_KEY, all);
      return on;
    }
  };

  /* ------------------------------------------------------------------ 检索索引与相关度 */

  var STOP = '如何怎么什么真正可以需要应该请问一个我们你们他们这个那个的了是在和与或者以及关于让把被对于为了因为所以但是如果就会还有已经没有';
  var indexPromise = null;

  function loadIndex() {
    if (!indexPromise) {
      indexPromise = fetch(ROOT + '/api/discover-index.json', { credentials: 'same-origin' })
        .then(function (r) { if (!r.ok) throw new Error('index ' + r.status); return r.json(); })
        .catch(function (err) { indexPromise = null; throw err; });
    }
    return indexPromise;
  }

  function tokenize(query) {
    var s = String(query || '').trim().toLowerCase();
    if (!s) return { tokens: [], phrases: [] };
    var tokens = {};
    var phrases = [];
    (s.match(/[a-z0-9][a-z0-9.+#_-]*/g) || []).forEach(function (w) { if (w.length > 1) { tokens[w] = 1; phrases.push(w); } });
    (s.match(/[\u4e00-\u9fff]+/g) || []).forEach(function (run) {
      var clean = run.split('').filter(function (ch) { return STOP.indexOf(ch) === -1; }).join('');
      if (!clean) return;
      phrases.push(clean);
      if (clean.length <= 2) { tokens[clean] = 1; return; }
      tokens[clean] = 1.2;
      for (var i = 0; i < clean.length - 1; i++) {
        var bi = clean.slice(i, i + 2);
        tokens[bi] = Math.max(tokens[bi] || 0, 0.8);
      }
    });
    return { tokens: tokens, phrases: phrases };
  }

  /** 为索引补充小写全文块，用于逆文档频率与快速匹配 */
  function prepareDocs(docs) {
    docs.forEach(function (d) {
      if (d._blob) return;
      d._title = d.t.toLowerCase();
      d._tags = d.g.join(' ').toLowerCase();
      d._heads = d.h.join(' ').toLowerCase();
      d._desc = (d.d || '').toLowerCase();
      d._cat = (d.c || '').toLowerCase();
      d._path = (d.pt || '').toLowerCase();
      d._blob = [d._title, d._tags, d._cat, d._heads, d._desc, d._path].join(' ');
    });
    return docs;
  }

  /** 逆文档频率权重：越少文章命中的词，区分度越高 */
  function idfWeights(docs, tokens) {
    var n = docs.length;
    var weights = {};
    Object.keys(tokens).forEach(function (tok) {
      var df = 0;
      for (var i = 0; i < n; i++) { if (docs[i]._blob.indexOf(tok) !== -1) df += 1; }
      weights[tok] = tokens[tok] * (1 + Math.log((n + 1) / (df + 1)));
    });
    return weights;
  }

  /** 返回 { base: 词项与短语得分, bonus: 意图加权 }；有查询时 base 必须大于 0 才算命中 */
  function scoreDoc(doc, q, intent, weights) {
    var base = 0;
    var bonus = 0;
    var hasQuery = q.phrases.length > 0;
    Object.keys(q.tokens).forEach(function (tok) {
      var w = weights ? weights[tok] : q.tokens[tok];
      if (doc._title.indexOf(tok) !== -1) base += 10 * w;
      if (doc._tags.indexOf(tok) !== -1) base += 6 * w;
      if (doc._cat.indexOf(tok) !== -1) base += 5 * w;
      if (doc._path.indexOf(tok) !== -1) base += 4 * w;
      if (doc._heads.indexOf(tok) !== -1) base += 3 * w;
      if (doc._desc.indexOf(tok) !== -1) base += 2 * w;
    });
    q.phrases.forEach(function (ph) {
      if (ph.length > 2 && doc._title.indexOf(ph) !== -1) base += 8;
      if (ph.length > 2 && doc._path.indexOf(ph) !== -1) base += 4;
    });
    if (intent) {
      if (intent.categories.indexOf(doc.c) !== -1) bonus += hasQuery ? 6 : 60;
      intent.keywords.forEach(function (k) { if (doc.t.indexOf(k) !== -1 || doc.g.indexOf(k) !== -1) bonus += hasQuery ? 2 : 8; });
      if (intent.id === 'learn' && doc.p) bonus += hasQuery ? 3 : 30;
    }
    return { base: base, bonus: bonus };
  }

  function search(docs, query, intent, filters) {
    prepareDocs(docs);
    var q = tokenize(query);
    var hasQuery = q.phrases.length > 0;
    var weights = hasQuery ? idfWeights(docs, q.tokens) : null;
    var marks = bookmarks.all();
    var filtering = !!(filters && (filters.category.length || filters.type.length || filters.duration || filters.bookmarked));
    var out = [];
    docs.forEach(function (doc) {
      if (filters) {
        if (filters.category.length && filters.category.indexOf(doc.c) === -1) return;
        if (filters.type.length && filters.type.indexOf(doc.y) === -1) return;
        if (filters.duration === 'short' && doc.m > 10) return;
        if (filters.duration === 'medium' && (doc.m <= 10 || doc.m > 30)) return;
        if (filters.duration === 'long' && doc.m <= 30) return;
        if (filters.bookmarked && !marks[doc.s]) return;
      }
      var sc = scoreDoc(doc, q, intent, weights);
      // 有查询：必须命中词项；无查询且未筛选：只保留与意图相关的文章；已筛选：全部保留并按意图排序
      if (hasQuery ? sc.base <= 0 : (intent && !filtering && sc.bonus <= 0)) return;
      out.push({ doc: doc, score: sc.base + sc.bonus });
    });
    out.sort(function (a, b) { return b.score - a.score || (b.doc.dt > a.doc.dt ? 1 : -1); });
    var top = out.length ? Math.max(out[0].score, 1) : 1;
    out.forEach(function (r) { r.relevance = r.score > 0 ? Math.round(58 + 38 * r.score / top) : 40; });
    return { results: out, hasQuery: hasQuery, phrases: q.phrases };
  }

  function highlight(text, phrases) {
    var html = esc(text);
    if (!phrases || !phrases.length) return html;
    phrases.forEach(function (ph) {
      if (ph.length < 2) return;
      var re = new RegExp(ph.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi');
      html = html.replace(re, function (m) { return '<mark>' + m + '</mark>'; });
    });
    return html;
  }

  var CATEGORY_ICON = {
    '云管端架构': 'network', 'Agent系统': 'agent', '可观测性': 'chart', '具身智能': 'embodied',
    'AI工具链': 'tools', '工程实践': 'practice', '技术文档': 'file', '架构思维': 'mindset'
  };
  var ICON_PATH = {
    network: '<circle cx="12" cy="5" r="2"></circle><circle cx="5" cy="18" r="2"></circle><circle cx="19" cy="18" r="2"></circle><path d="m11 7-5 9M13 7l5 9M7 18h10"></path>',
    agent: '<path d="m12 3 7 4v9l-7 4-7-4V7l7-4Z"/><path d="M5 7l7 4 7-4M12 11v9"/>',
    chart: '<path d="M4 20V10M10 20V4M16 20v-7M22 20V7"></path>',
    embodied: '<circle cx="7" cy="17" r="3"/><circle cx="17" cy="6" r="3"/><path d="m9 15 5-6M15 8l4 6M19 14v5M16 19h6"/>',
    tools: '<path d="m14.5 4.5 5 5L9 20H4v-5z"/><path d="m12.5 6.5 5 5"/>',
    practice: '<path d="M4 20 20 4"/><path d="M14 4h6v6"/><path d="M4 14v6h6"/>',
    file: '<path d="M6 2h8l4 4v16H6z"></path><path d="M14 2v5h5M9 12h6M9 16h6"></path>',
    mindset: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/><path d="M12 3v2M12 19v2M3 12h2M19 12h2"/>',
    copy: '<rect x="9" y="9" width="11" height="11" rx="2"></rect><path d="M5 15V5a2 2 0 0 1 2-2h10"></path>',
    check: '<path d="m5 12 4 4L19 6"></path>'
  };
  function iconHtml(name) {
    return '<span class="icon" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round">' + (ICON_PATH[name] || ICON_PATH.file) + '</svg></span>';
  }

  function displayName(name) {
    return String(name || '').replace(/([A-Za-z0-9])([\u4e00-\u9fff])/g, '$1 $2').replace(/([\u4e00-\u9fff])([A-Za-z0-9])/g, '$1 $2');
  }

  function resultRowHtml(r, phrases, compact) {
    var d = r.doc;
    return '<article class="result-row" data-url="' + esc(d.u) + '">' +
      '<div class="result-icon">' + iconHtml(CATEGORY_ICON[d.c] || 'file') + '</div>' +
      '<div class="result-copy"><span class="section-kicker">' + esc(d.y) + ' · ' + esc(displayName(d.c)) + (d.pt ? ' · ' + esc(d.pt) + ' 第 ' + d.n + ' 篇' : '') + '</span>' +
      '<h3><a href="' + esc(d.u) + '">' + highlight(d.t, phrases) + '</a></h3>' +
      '<p>' + highlight(d.d || '', phrases) + '</p>' +
      (compact ? '' : '<div class="relevance" aria-hidden="true"><span style="width:' + r.relevance + '%"></span></div>') +
      '</div>' +
      '<div class="result-meta">约 ' + d.m + ' 分钟' + (compact ? '' : '<br>相关度 ' + r.relevance + '%') + '</div>' +
      '</article>';
  }

  /* ------------------------------------------------------------------ 全局：搜索浮层 */

  function initSearchOverlay() {
    var overlay = $('#search-overlay');
    if (!overlay) return;
    var input = $('#search-overlay-input');
    var results = $('[data-search-results]', overlay);
    var hint = $('[data-search-hint]', overlay);
    var focused = -1;
    var layer = makeLayer(overlay, { focus: '#search-overlay-input', onOpen: function () { loadIndex().catch(function () {}); } });

    function render(list, phrases, query) {
      focused = -1;
      if (!query) { results.innerHTML = ''; hint.hidden = false; return; }
      hint.hidden = true;
      if (!list.length) {
        results.innerHTML = '<div class="results-empty"><strong>没有匹配的内容</strong><p>换个关键词试试，或前往发现页按意图浏览。</p></div>';
        return;
      }
      results.innerHTML = list.slice(0, 6).map(function (r) { return resultRowHtml(r, phrases, true); }).join('') +
        '<a class="search-overlay__more" href="' + ROOT + '/discover/?q=' + encodeURIComponent(query) + '">在发现页查看全部 ' + list.length + ' 条结果 →</a>';
    }

    var run = debounce(function () {
      var query = input.value.trim();
      if (!query) { render([], [], ''); return; }
      loadIndex().then(function (data) {
        var out = search(data.posts, query, null, null);
        render(out.results, out.phrases, query);
      }).catch(function () { hint.textContent = '索引加载失败，回车进入发现页继续搜索。'; hint.hidden = false; });
    }, 120);

    on(input, 'input', run);
    on(input, 'keydown', function (e) {
      var rows = $$('.result-row', results);
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        if (!rows.length) return;
        e.preventDefault();
        rows.forEach(function (r) { r.classList.remove('focused'); });
        focused = e.key === 'ArrowDown' ? Math.min(rows.length - 1, focused + 1) : Math.max(0, focused - 1);
        rows[focused].classList.add('focused');
        rows[focused].scrollIntoView({ block: 'nearest' });
      } else if (e.key === 'Enter' && focused >= 0 && rows[focused]) {
        e.preventDefault();
        window.location.href = rows[focused].getAttribute('data-url');
      }
    });
    on(results, 'click', function (e) {
      var row = e.target.closest('.result-row');
      if (row && !e.target.closest('a')) window.location.href = row.getAttribute('data-url');
    });

    $$('[data-open-search]').forEach(function (btn) { on(btn, 'click', function () { menuLayer && menuLayer.close(); layer.open(); }); });
    var askKbd = $('[data-ask-kbd]');
    if (askKbd && !/Mac|iPhone|iPad|iPod/.test(navigator.platform || '')) askKbd.textContent = 'Ctrl K';
    $$('[data-close-search]', overlay).forEach(function (btn) { on(btn, 'click', layer.close); });
    on(document, 'keydown', function (e) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); layer.isOpen() ? layer.close() : layer.open(); }
      else if (e.key === '/' && !layer.isOpen() && !/input|textarea/i.test(document.activeElement.tagName)) { e.preventDefault(); layer.open(); }
    });
    return layer;
  }

  /* ------------------------------------------------------------------ 全局：移动端菜单 */

  var menuLayer = null;
  function initMobileMenu() {
    var drawer = $('#mobile-menu');
    if (!drawer) return;
    var trigger = $('[data-open-menu]');
    menuLayer = makeLayer(drawer, {
      onOpen: function () { trigger && trigger.setAttribute('aria-expanded', 'true'); },
      onClose: function () { trigger && trigger.setAttribute('aria-expanded', 'false'); }
    });
    on(trigger, 'click', menuLayer.open);
    $$('[data-close-menu]', drawer).forEach(function (btn) { on(btn, 'click', menuLayer.close); });
  }

  function initScrollLinks() {
    $$('[data-scroll-to]').forEach(function (a) {
      on(a, 'click', function (e) {
        var target = document.getElementById(a.getAttribute('data-scroll-to'));
        if (!target) return;
        e.preventDefault();
        smoothScrollTo(target);
        history.replaceState(null, '', '#' + target.id);
      });
    });
  }

  /* ------------------------------------------------------------------ 01 首页 */

  function initHome() {
    var switcher = $('[data-depth-switch]');
    if (!switcher) return;
    var dial = $('.jo-observatory');
    var action = $('[data-depth-action]');
    var buttons = $$('button', switcher);
    function select(btn) {
      buttons.forEach(function (b) {
        var onIt = b === btn;
        b.classList.toggle('selected', onIt);
        b.setAttribute('aria-pressed', onIt ? 'true' : 'false');
      });
      if (dial) {
        dial.setAttribute('data-mode', btn.getAttribute('data-mode'));
        dial.style.setProperty('--needle', btn.getAttribute('data-needle') + 'deg');
      }
      if (action) action.setAttribute('href', btn.getAttribute('data-href'));
    }
    buttons.forEach(function (btn) { on(btn, 'click', function () { select(btn); }); });
    on(switcher, 'keydown', function (e) {
      if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
      var i = buttons.indexOf(document.activeElement);
      if (i === -1) return;
      e.preventDefault();
      var next = buttons[(i + (e.key === 'ArrowRight' ? 1 : buttons.length - 1)) % buttons.length];
      next.focus();
      select(next);
    });
  }

  /* ------------------------------------------------------------------ 02 发现 */

  function initDiscover() {
    var root = $('[data-discover]');
    if (!root) return;
    var input = $('[data-discover-input]', root);
    var form = $('[data-discover-form]', root);
    var list = $('[data-results-list]', root);
    var title = $('[data-results-title]', root);
    var empty = $('[data-results-empty]', root);
    var more = $('[data-results-more]', root);
    var chips = $$('.intent-chip', root);
    var limit = Number(root.getAttribute('data-limit')) || 6;
    var shown = limit;
    var intents = chips.map(function (c) { return c.getAttribute('data-intent'); });
    var intentMeta = {};
    var current = { query: '', intent: intents[0], results: [], phrases: [] };
    var filters = { category: [], type: [], duration: '', bookmarked: false };
    var docs = null;

    // 意图定义随页面内联在 chips 上不可得，这里从索引外的配置退化为按钮文本；关键词与领域在服务端注入时写入 data 属性
    chips.forEach(function (c) {
      intentMeta[c.getAttribute('data-intent')] = {
        id: c.getAttribute('data-intent'),
        label: c.textContent.trim(),
        categories: (c.getAttribute('data-categories') || '').split('|').filter(Boolean),
        keywords: (c.getAttribute('data-keywords') || '').split('|').filter(Boolean)
      };
    });

    var params = new URLSearchParams(window.location.search);
    if (params.get('q')) { input.value = params.get('q'); current.query = params.get('q'); }
    if (params.get('intent') && intents.indexOf(params.get('intent')) !== -1) current.intent = params.get('intent');
    chips.forEach(function (c) {
      var onIt = c.getAttribute('data-intent') === current.intent;
      c.classList.toggle('selected', onIt);
      c.setAttribute('aria-pressed', onIt ? 'true' : 'false');
    });

    function render() {
      var res = current.results;
      var visible = res.slice(0, shown);
      list.innerHTML = visible.map(function (r) { return resultRowHtml(r, current.phrases, false); }).join('');
      empty.hidden = res.length > 0;
      more.hidden = res.length <= shown;
      if (!more.hidden) more.textContent = '查看更多结果（还有 ' + (res.length - shown) + ' 条）';
      var label = intentMeta[current.intent] ? intentMeta[current.intent].label : '';
      title.textContent = current.query
        ? '最相关的 ' + visible.length + ' 个结果'
        : '与「' + label + '」最相关的 ' + visible.length + ' 个结果';
      if (current.query) updateSuggestion(res);
    }

    function run(resetShown) {
      if (resetShown) shown = limit;
      if (!docs) return;
      var out = search(docs.posts, current.query, intentMeta[current.intent], filters);
      current.results = out.results;
      current.phrases = out.phrases;
      render();
      var url = new URL(window.location.href);
      if (current.query) url.searchParams.set('q', current.query); else url.searchParams.delete('q');
      if (current.intent !== intents[0]) url.searchParams.set('intent', current.intent); else url.searchParams.delete('intent');
      history.replaceState(null, '', url.toString());
    }

    function updateSuggestion(results) {
      if (!docs || !docs.paths || !docs.paths.length) return;
      var box = $('[data-path-suggestion]', root);
      if (!box) return;
      var counts = {};
      results.slice(0, 8).forEach(function (r) { if (r.doc.p) counts[r.doc.p] = (counts[r.doc.p] || 0) + 1; });
      var best = null, bestN = 0;
      Object.keys(counts).forEach(function (slug) { if (counts[slug] > bestN) { best = slug; bestN = counts[slug]; } });
      var path = best ? docs.paths.filter(function (p) { return p.slug === best; })[0] : null;
      if (!path) {
        var q = current.query.toLowerCase();
        path = q ? docs.paths.filter(function (p) { return (p.title + p.category + p.summary).toLowerCase().indexOf(q.slice(0, 4)) !== -1; })[0] : null;
      }
      if (!path) return;
      $('[data-suggestion-title]', box).textContent = path.title;
      $('[data-suggestion-summary]', box).textContent = path.summary;
      $('[data-suggestion-steps]', box).innerHTML = path.stages.map(function (s) { return '<div class="mini-step">' + esc(s) + '</div>'; }).join('');
      var link = $('[data-suggestion-link]', box);
      link.setAttribute('href', ROOT + path.url);
      link.textContent = '进入' + path.title + '路径';
    }

    on(form, 'submit', function (e) { e.preventDefault(); current.query = input.value.trim(); run(true); });
    on(input, 'input', debounce(function () { current.query = input.value.trim(); run(true); }, 160));
    chips.forEach(function (c) {
      on(c, 'click', function () {
        current.intent = c.getAttribute('data-intent');
        chips.forEach(function (x) { var onIt = x === c; x.classList.toggle('selected', onIt); x.setAttribute('aria-pressed', onIt ? 'true' : 'false'); });
        run(true);
      });
    });
    on(more, 'click', function () { shown += limit; render(); });

    // 筛选抽屉
    var drawer = $('#discover-filter');
    var openBtn = $('[data-open-filter]', root);
    var countEl = $('[data-filter-count]', root);
    var backdrop = null;
    function readFilters() {
      filters.category = $$('[data-filter-group="category"] input:checked', drawer).map(function (i) { return i.value; });
      filters.type = $$('[data-filter-group="type"] input:checked', drawer).map(function (i) { return i.value; });
      var d = $('[data-filter-group="duration"] input:checked', drawer);
      filters.duration = d ? d.value : '';
      filters.bookmarked = !!$('[data-filter-group="bookmark"] input:checked', drawer);
      var n = filters.category.length + filters.type.length + (filters.duration ? 1 : 0) + (filters.bookmarked ? 1 : 0);
      countEl.textContent = n ? String(n) : '';
      countEl.hidden = !n;
      openBtn.classList.toggle('has-filters', n > 0);
    }
    function openDrawer() {
      drawer.hidden = false;
      openBtn.setAttribute('aria-expanded', 'true');
      if (MOBILE.matches) {
        backdrop = document.createElement('div');
        backdrop.className = 'filter-backdrop';
        on(backdrop, 'click', closeDrawer);
        document.body.appendChild(backdrop);
        lockScroll(true);
      }
      var first = drawer.querySelector('input');
      if (first) first.focus();
    }
    function closeDrawer() {
      drawer.hidden = true;
      openBtn.setAttribute('aria-expanded', 'false');
      if (backdrop) { backdrop.remove(); backdrop = null; }
      lockScroll(false);
      openBtn.focus();
    }
    on(openBtn, 'click', function () { drawer.hidden ? openDrawer() : closeDrawer(); });
    $$('[data-close-filter]', drawer).forEach(function (b) { on(b, 'click', closeDrawer); });
    on($('[data-apply-filter]', drawer), 'click', function () { readFilters(); run(true); closeDrawer(); });
    on($('[data-reset-filter]', drawer), 'click', function () {
      $$('input', drawer).forEach(function (i) { i.checked = i.type === 'radio' && i.value === ''; });
      readFilters(); run(true);
    });
    on(drawer, 'change', function () { if (!MOBILE.matches) { readFilters(); run(true); } });
    on(drawer, 'keydown', function (e) { if (e.key === 'Escape') closeDrawer(); });

    loadIndex().then(function (data) {
      docs = data;
      run(true);
    }).catch(function () {
      title.textContent = '索引加载失败，已显示默认推荐';
    });
  }

  /* ------------------------------------------------------------------ 03 专题 */

  function initTopics() {
    var root = $('[data-topics]');
    if (!root) return;
    var dataEl = $('#topics-data');
    if (!dataEl) return;
    var domains = JSON.parse(dataEl.textContent || '[]');
    var byName = {};
    domains.forEach(function (d) { byName[d.name] = d; });
    var planes = $$('.domain-plane', root);
    var map = $('.domain-map', root);

    function select(name, focusPlane) {
      var d = byName[name];
      if (!d) return;
      planes.forEach(function (p) {
        var onIt = p.getAttribute('data-domain') === name;
        p.classList.toggle('selected', onIt);
        p.setAttribute('aria-selected', onIt ? 'true' : 'false');
        if (onIt) {
          map.style.setProperty('--selected', p.getAttribute('data-index'));
          if (focusPlane) p.focus();
        }
      });
      $('[data-topic-name]', root).textContent = d.label || d.name;
      $('[data-topic-summary-text]', root).textContent = d.summary;
      $('[data-topic-tags]', root).innerHTML = d.tags.map(function (t) { return '<a href="' + esc(t.url) + '">' + esc(t.name) + '</a>'; }).join('');
      var pathsBox = $('[data-topic-paths]', root);
      if (pathsBox) {
        pathsBox.hidden = !d.paths.length;
        pathsBox.innerHTML = '<span class="topic-paths__label">学习路径</span>' + d.paths.map(function (p) {
          return '<a class="topic-path-link" href="' + ROOT + p.url + '">' + iconHtml('route') + esc(p.title) + ' · ' + p.count + ' 篇</a>';
        }).join('');
      }
      var link = $('[data-topic-link]', root);
      link.setAttribute('href', d.url);
      link.textContent = '浏览' + (d.label || d.name) + '专题';
      var related = $('[data-topic-related]', root);
      related.innerHTML = '<h3>相关领域</h3>' + d.related.map(function (r) {
        return '<a class="relation-item" href="#" data-domain-jump="' + esc(r.name) + '"><strong>' + esc(r.label || r.name) + '</strong><p>' + esc(r.reason) + '</p></a>';
      }).join('');
      if (history.replaceState) history.replaceState(null, '', '#' + encodeURIComponent(d.name));
    }
    ICON_PATH.route = '<circle cx="6" cy="18" r="2"></circle><circle cx="18" cy="6" r="2"></circle><path d="M8 18h3a4 4 0 0 0 4-4v-4a4 4 0 0 1 4-4"></path>';

    planes.forEach(function (p) { on(p, 'click', function () { select(p.getAttribute('data-domain')); }); });
    on(root, 'click', function (e) {
      var jump = e.target.closest('[data-domain-jump]');
      if (!jump) return;
      e.preventDefault();
      select(jump.getAttribute('data-domain-jump'), true);
      if (MOBILE.matches) smoothScrollTo($('[data-topic-summary]', root));
    });
    on($('[data-domain-grid]', root), 'keydown', function (e) {
      if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft' && e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
      var i = planes.indexOf(document.activeElement);
      if (i === -1) return;
      e.preventDefault();
      var forward = e.key === 'ArrowRight' || e.key === 'ArrowDown';
      var next = planes[(i + (forward ? 1 : planes.length - 1)) % planes.length];
      select(next.getAttribute('data-domain'), true);
    });
    var hash = decodeURIComponent((window.location.hash || '').slice(1));
    if (hash && byName[hash]) select(hash);
  }

  /* ------------------------------------------------------------------ 04 路径总览 */

  function initPaths() {
    var root = $('[data-paths]');
    if (!root) return;
    var rows = $$('.path-row', root);
    var buttons = $$('[data-path-filter]', root);
    var emptyEl = $('[data-path-empty]', root);
    var all = progress.all();

    rows.forEach(function (row) {
      var slug = row.getAttribute('data-path');
      var done = Object.keys(all[slug] || {}).filter(function (k) { return all[slug][k].read; }).length;
      if (!done) return;
      var cta = $('[data-path-cta]', row);
      if (cta) cta.textContent = '继续这条路径';
      var steps = $$('.rail-step', row);
      var stats = $('.path-stats strong', row);
      if (stats) stats.insertAdjacentHTML('beforeend', ' <span class="muted" style="font-size:13px;font-weight:500">· 已读 ' + done + ' 篇</span>');
      if (steps.length) steps[0].classList.add('active');
    });

    function apply(id) {
      var visible = 0;
      rows.forEach(function (row) {
        var minutes = Number(row.getAttribute('data-minutes')) || 0;
        var tags = (row.getAttribute('data-tags') || '').split(' ');
        var show = id === 'all' || (id === 'short' && minutes <= 90) || (id === 'production' && tags.indexOf('production') !== -1);
        row.hidden = !show;
        if (show) visible += 1;
      });
      emptyEl.hidden = visible > 0;
    }
    buttons.forEach(function (b) {
      on(b, 'click', function () {
        buttons.forEach(function (x) { var onIt = x === b; x.classList.toggle('selected', onIt); x.setAttribute('aria-pressed', onIt ? 'true' : 'false'); });
        apply(b.getAttribute('data-path-filter'));
      });
    });
  }

  /* ------------------------------------------------------------------ 05 路径详情 */

  function initPathDetail() {
    var root = $('[data-path-detail]');
    if (!root) return;
    var dataEl = $('#path-data');
    if (!dataEl) return;
    var data = JSON.parse(dataEl.textContent || '{}');
    var slug = data.slug;
    var lessons = data.lessons || [];
    var stages = $$('.stage', root);

    function render() {
      var state = progress.path(slug);
      var doneCount = 0;
      var currentIndex = -1;
      lessons.forEach(function (l, i) {
        if (state[l.slug] && state[l.slug].read) doneCount += 1;
        else if (currentIndex === -1) currentIndex = i;
      });
      var allDone = currentIndex === -1;
      var total = lessons.length;

      // 课时状态
      $$('.lesson', root).forEach(function (el) {
        var ls = el.getAttribute('data-lesson');
        var i = lessons.map(function (l) { return l.slug; }).indexOf(ls);
        var stateEl = $('[data-lesson-state]', el);
        el.classList.remove('done', 'current');
        if (state[ls] && state[ls].read) { el.classList.add('done'); stateEl.textContent = '已读'; }
        else if (i === currentIndex) { el.classList.add('current'); stateEl.textContent = state[ls] && state[ls].opened ? '正在阅读' : '下一篇'; }
        else stateEl.textContent = lessons[i].minutes + ' 分钟';
      });

      // 阶段状态
      var offset = 0;
      stages.forEach(function (stageEl, si) {
        var size = data.stages[si].size;
        var start = offset, end = offset + size;
        offset = end;
        var stageDone = lessons.slice(start, end).every(function (l) { return state[l.slug] && state[l.slug].read; }) && size > 0;
        var isActive = !allDone && currentIndex >= start && currentIndex < end;
        stageEl.classList.toggle('active', isActive);
        stageEl.classList.toggle('done', stageDone);
        var label = $('[data-stage-state]', stageEl);
        if (label) label.textContent = stageDone ? '已完成' : (isActive ? '当前阶段' : '未开始');
        var toggle = $('.stage-toggle', stageEl);
        if (!toggle) {
          toggle = document.createElement('button');
          toggle.type = 'button';
          toggle.className = 'stage-toggle';
          toggle.setAttribute('aria-expanded', 'false');
          on(toggle, 'click', function () {
            var expanded = stageEl.classList.toggle('expanded');
            toggle.setAttribute('aria-expanded', expanded ? 'true' : 'false');
            toggle.textContent = expanded ? '收起文章' : '展开 ' + size + ' 篇';
          });
          stageEl.appendChild(toggle);
        }
        toggle.hidden = isActive;
        if (!stageEl.classList.contains('expanded')) toggle.textContent = '展开 ' + size + ' 篇';
      });

      // 进度卡
      var bar = $('[data-progress-bar] span', root);
      if (bar) bar.style.width = (total ? Math.round(doneCount / total * 100) : 0) + '%';
      var barEl = $('[data-progress-bar]', root);
      if (barEl) barEl.setAttribute('aria-valuenow', String(doneCount));
      $('[data-progress-count]', root).textContent = doneCount + ' / ' + total;
      var hint = $('[data-progress-hint]', root);
      var nextTitle = $('[data-next-title]', root);
      var nextSummary = $('[data-next-summary]', root);
      var links = $$('[data-next-link]', root);
      if (allDone) {
        hint.textContent = '已完成全部 ' + total + ' 篇，可以回到路径总览选择下一条路径。';
        nextTitle.textContent = '这条路径已读完';
        nextSummary.textContent = '回顾任一篇，或前往路径总览选择新的目标。';
        links.forEach(function (a) { a.setAttribute('href', ROOT + '/paths/'); a.textContent = '选择下一条路径'; });
        $('.rule-title', $('[data-next-reading]', root)).textContent = '已完成';
        return;
      }
      var cur = lessons[currentIndex];
      var stageIdx = 0, stageStart = 0, walk = 0;
      data.stages.forEach(function (s, i) {
        if (currentIndex >= walk && currentIndex < walk + s.size) { stageIdx = i; stageStart = walk; }
        walk += s.size;
      });
      var stage = data.stages[stageIdx];
      var nextStage = data.stages[stageIdx + 1];
      var stageRemain = lessons.slice(stageStart, stageStart + stage.size).filter(function (l) { return !(state[l.slug] && state[l.slug].read); }).length;
      hint.textContent = doneCount
        ? '继续完成“' + cur.title + '”' + (nextStage && stageRemain <= 1 ? '后进入' + nextStage.title + '。' : '，' + stage.title + '还剩 ' + stageRemain + ' 篇。')
        : '从“' + cur.title + '”开始，进入' + stage.title + '。';
      nextTitle.textContent = cur.title;
      nextSummary.textContent = '约 ' + cur.minutes + ' 分钟 · ' + stage.title + ' 第 ' + (currentIndex - stageStart + 1) + ' / ' + stage.size + ' 篇';
      links.forEach(function (a) { a.setAttribute('href', cur.url); a.textContent = doneCount ? '继续下一篇' : '开始阅读'; });
    }
    render();
    on(window, 'pageshow', function (e) { if (e.persisted) render(); });
    on(window, 'storage', function (e) { if (e.key === PROGRESS_KEY) render(); });
  }

  /* ------------------------------------------------------------------ 06 文章 */

  function initArticle() {
    var root = $('[data-article]');
    if (!root) return;
    var dataEl = $('#article-data');
    var meta = dataEl ? JSON.parse(dataEl.textContent || '{}') : {};
    var content = $('#article-content');

    // 系列进度记录：打开即标记 opened，滚动过 60% 或到底标记 read
    if (meta.path) {
      progress.mark(meta.path, meta.slug, { opened: true });
      var readMarked = false;
      var checkRead = function () {
        if (readMarked || !content) return;
        var rect = content.getBoundingClientRect();
        var total = rect.height || 1;
        var seen = Math.min(total, Math.max(0, window.innerHeight - rect.top));
        if (seen / total >= 0.6 || rect.bottom - window.innerHeight < 120) {
          readMarked = true;
          progress.mark(meta.path, meta.slug, { opened: true, read: true });
        }
      };
      on(window, 'scroll', debounce(checkRead, 200), { passive: true });
      setTimeout(checkRead, 800);
    }

    // 阅读进度：页头进度条 + 目录环 + 百分比；同时维护页头吸顶态
    var globalHeader = $('.global-header');
    var progressBar = $('[data-reading-bar]');
    var readingRing = $('[data-reading-ring]', root);
    var percentEls = $$('[data-reading-percent]', root);
    function updateProgress() {
      if (globalHeader) globalHeader.classList.toggle('is-scrolled', window.scrollY > 8);
      if (!content) return;
      var rect = content.getBoundingClientRect();
      var total = rect.height - window.innerHeight * 0.5;
      var passed = Math.min(Math.max(-rect.top + window.innerHeight * 0.3, 0), Math.max(total, 1));
      var pct = total > 0 ? Math.round(passed / total * 100) : 100;
      pct = Math.max(0, Math.min(100, pct));
      percentEls.forEach(function (el) { el.textContent = pct + '%'; });
      if (readingRing) readingRing.style.setProperty('--p', String(pct));
      if (progressBar) progressBar.style.setProperty('--progress', String(pct / 100));
    }
    on(window, 'scroll', updateProgress, { passive: true });
    on(window, 'resize', updateProgress);
    updateProgress();

    // 目录：滚动定位 + 三级标题按需展开 + 活动指示条 + 折叠态圆点
    var headerHeight = function () { return globalHeader ? globalHeader.offsetHeight : 0; };
    var tocLinks = $$('[data-toc-list] a', root);
    var dots = $$('[data-toc-dots] a', root);
    var currentEl = $('[data-toc-current]', root);
    var headings = tocLinks.map(function (a) {
      return { link: a, el: document.getElementById(a.getAttribute('data-toc-target')), level: a.classList.contains('toc-level-3') ? 3 : 2 };
    }).filter(function (h) { return h.el; });
    var numbered = headings.filter(function (h) { return h.level === 2 && !h.link.classList.contains('toc-intro'); });
    var indicatorTimer = null;
    function placeIndicator(activeLink) {
      var box = activeLink.closest('.toc-list');
      if (!box || MOBILE.matches) return;
      box.style.setProperty('--ind-top', activeLink.offsetTop + 'px');
      box.style.setProperty('--ind-h', activeLink.offsetHeight + 'px');
      box.style.setProperty('--ind-on', '1');
      var lt = activeLink.offsetTop;
      if (lt < box.scrollTop || lt > box.scrollTop + box.clientHeight - 40) box.scrollTop = lt - box.clientHeight / 2;
    }
    function spy() {
      var y = window.scrollY + headerHeight() + 56;
      var current = headings[0];
      for (var i = 0; i < headings.length; i++) {
        if (headings[i].el.offsetTop <= y) current = headings[i]; else break;
      }
      if (!current) return;
      var parent = current;
      if (current.level === 3) {
        for (var j = headings.indexOf(current); j >= 0; j--) { if (headings[j].level === 2) { parent = headings[j]; break; } }
      }
      var showing = false;
      headings.forEach(function (h) {
        var active = h === current;
        h.link.classList.toggle('active', active);
        if (h.level === 2) { showing = h === parent; h.link.classList.toggle('active-parent', h === parent); }
        else h.link.classList.toggle('visible', showing);
      });
      // 三级标题有高度过渡，指示条先定位一次，过渡结束后再校正
      placeIndicator(current.link);
      clearTimeout(indicatorTimer);
      indicatorTimer = setTimeout(function () { placeIndicator(current.link); }, 300);
      var parentId = parent.link.getAttribute('data-toc-target');
      var beforeActive = true;
      dots.forEach(function (d) {
        var isActive = d.getAttribute('data-toc-target') === parentId;
        if (isActive) beforeActive = false;
        d.classList.toggle('active', isActive);
        d.classList.toggle('is-passed', beforeActive);
      });
      if (currentEl) currentEl.textContent = String(numbered.indexOf(parent) + 1);
    }
    on(window, 'scroll', debounce(spy, 60), { passive: true });
    spy();
    tocLinks.concat(dots).forEach(function (a) {
      on(a, 'click', function (e) {
        var target = document.getElementById(a.getAttribute('data-toc-target'));
        if (!target) return;
        e.preventDefault();
        smoothScrollTo(target);
        history.replaceState(null, '', '#' + encodeURIComponent(target.id));
        if (tocSheet && tocSheet.isOpen()) tocSheet.close();
      });
    });

    // 目录折叠：向右收成细条，状态持久化；折叠先播放退场动画再切换布局
    var TOC_KEY = 'obs:toc-collapsed';
    var toggles = $$('[data-toc-toggle]', root);
    var collapseTimer = null;
    function isCollapsed() { return root.classList.contains('toc-collapsed') || root.classList.contains('toc-leaving'); }
    function setCollapsed(collapsed, animate) {
      clearTimeout(collapseTimer);
      root.classList.remove('toc-leaving');
      if (collapsed && animate && !REDUCED.matches) {
        root.classList.add('toc-leaving');
        collapseTimer = setTimeout(function () { root.classList.remove('toc-leaving'); root.classList.add('toc-collapsed'); }, 240);
      } else root.classList.toggle('toc-collapsed', collapsed);
      toggles.forEach(function (b) { b.setAttribute('aria-expanded', collapsed ? 'false' : 'true'); });
      store.set(TOC_KEY, collapsed);
      if (!collapsed) setTimeout(spy, 60);
    }
    toggles.forEach(function (b) {
      on(b, 'click', function () {
        var next = !isCollapsed();
        setCollapsed(next, true);
        var focusTarget = $(next ? '[data-toc-strip] [data-toc-toggle]' : '[data-toc] [data-toc-toggle]', root);
        if (focusTarget) setTimeout(function () { focusTarget.focus({ preventScroll: true }); }, next ? 260 : 40);
      });
    });
    if (store.get(TOC_KEY, false)) setCollapsed(true, false);

    // 回到顶部
    $$('[data-scroll-top]', root).forEach(function (b) {
      on(b, 'click', function () { window.scrollTo({ top: 0, behavior: REDUCED.matches ? 'auto' : 'smooth' }); });
    });

    // 移动端目录面板：克隆完整目录
    var tocClone = $('[data-toc-clone]', root);
    if (tocClone) {
      tocClone.innerHTML = $('[data-toc-list]', root).innerHTML;
      $$('a', tocClone).forEach(function (a) {
        on(a, 'click', function (e) {
          var target = document.getElementById(a.getAttribute('data-toc-target'));
          if (!target) return;
          e.preventDefault();
          tocSheet.close();
          setTimeout(function () { smoothScrollTo(target); }, 60);
        });
      });
    }
    var tocSheet = makeLayer($('#toc-sheet'), { onOpen: function () { var act = $('[data-toc-list] a.active', root); if (act && tocClone) { $$('a', tocClone).forEach(function (a) { a.classList.toggle('active', a.getAttribute('data-toc-target') === act.getAttribute('data-toc-target')); }); } } });
    var fontSheet = makeLayer($('#font-sheet'));
    $$('[data-open-sheet]', root).forEach(function (btn) {
      on(btn, 'click', function () { (btn.getAttribute('data-open-sheet') === 'toc-sheet' ? tocSheet : fontSheet).open(); });
    });
    $$('[data-close-sheet]', root).forEach(function (btn) {
      on(btn, 'click', function () { var sheet = btn.closest('.sheet'); (sheet && sheet.id === 'toc-sheet' ? tocSheet : fontSheet).close(); });
    });

    // 字号
    var SCALES = { sm: 0.9, md: 1, lg: 1.12, xl: 1.25 };
    function applyScale(id) {
      if (!SCALES[id]) id = 'md';
      document.documentElement.style.setProperty('--reading-scale', String(SCALES[id]));
      $$('[data-font-scale] button').forEach(function (b) { b.setAttribute('aria-pressed', b.getAttribute('data-scale') === id ? 'true' : 'false'); });
      store.set(FONT_KEY, id);
    }
    applyScale(store.get(FONT_KEY, 'md'));
    $$('[data-font-scale] button').forEach(function (b) { on(b, 'click', function () { applyScale(b.getAttribute('data-scale')); }); });

    // 收藏 / 分享
    function syncBookmark() {
      var onIt = bookmarks.has(meta.slug);
      $$('[data-bookmark]').forEach(function (b) {
        b.setAttribute('aria-pressed', onIt ? 'true' : 'false');
        var label = b.querySelector('span:not(.icon)');
        if (label) label.textContent = onIt ? '已收藏' : '收藏';
        else if (!b.querySelector('.icon')) b.textContent = onIt ? '已收藏' : '收藏';
        if (b.hasAttribute('title')) { b.setAttribute('title', onIt ? '已收藏' : '收藏'); b.setAttribute('aria-label', onIt ? '已收藏' : '收藏'); }
      });
    }
    $$('[data-bookmark]').forEach(function (b) {
      on(b, 'click', function () {
        var onIt = bookmarks.toggle({ slug: meta.slug, title: meta.title, url: meta.url });
        syncBookmark();
        toast(onIt ? '已加入收藏，可在发现页筛选查看' : '已取消收藏');
      });
    });
    syncBookmark();
    $$('[data-share]').forEach(function (b) {
      on(b, 'click', function () {
        var url = window.location.href.split('#')[0];
        var copyLink = function () {
          var done = function () { toast('已复制链接'); };
          if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(url).then(done, function () { fallbackCopy(url); done(); });
          else { fallbackCopy(url); done(); }
        };
        if (navigator.share) {
          navigator.share({ title: meta.title, url: url }).catch(function (err) { if (!err || err.name !== 'AbortError') copyLink(); });
          return;
        }
        copyLink();
      });
    });

    enhanceCodeBlocks(content);
    renderMermaid(content);
  }

  function fallbackCopy(text) {
    var ta = document.createElement('textarea');
    ta.value = text;
    ta.setAttribute('readonly', '');
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    try { document.execCommand('copy'); } catch (e) { /* 忽略 */ }
    ta.remove();
  }

  function enhanceCodeBlocks(content) {
    if (!content) return;
    $$('figure.highlight', content).forEach(function (fig) {
      var lang = (fig.className.match(/highlight\s+([a-z0-9#+_-]+)/i) || [])[1] || 'code';
      if (lang === 'plaintext' || lang === 'plain') lang = 'text';
      var table = fig.querySelector('table');
      if (!table) return;
      var body = document.createElement('div');
      body.className = 'code-body';
      table.parentNode.insertBefore(body, table);
      body.appendChild(table);
      var head = document.createElement('div');
      head.className = 'code-head';
      head.innerHTML = '<span>' + esc(lang.toUpperCase()) + '</span>';
      var copy = document.createElement('button');
      copy.type = 'button';
      copy.className = 'code-copy';
      copy.innerHTML = iconHtml('copy') + '<span>复制</span>';
      on(copy, 'click', function () {
        var lines = $$('.code .line', table).map(function (l) { return l.textContent; });
        var text = lines.length ? lines.join('\n') : table.textContent;
        var done = function () { copy.innerHTML = iconHtml('check') + '<span>已复制</span>'; setTimeout(function () { copy.innerHTML = iconHtml('copy') + '<span>复制</span>'; }, 1600); };
        if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(text).then(done, function () { fallbackCopy(text); done(); });
        else { fallbackCopy(text); done(); }
      });
      head.appendChild(copy);
      fig.insertBefore(head, fig.firstChild);
      var lineCount = $$('.code .line', table).length;
      if (body.scrollHeight > 520) {
        fig.classList.add('collapsible', 'collapsed');
        var expand = document.createElement('button');
        expand.type = 'button';
        expand.className = 'code-expand';
        expand.textContent = '展开全部 ' + lineCount + ' 行';
        on(expand, 'click', function () {
          var collapsed = fig.classList.toggle('collapsed');
          expand.textContent = collapsed ? '展开全部 ' + lineCount + ' 行' : '收起代码';
          if (collapsed) smoothScrollTo(fig);
        });
        fig.appendChild(expand);
      }
    });
  }

  function renderMermaid(content) {
    if (!content || !OBS.mermaid) return;
    var nodes = $$('pre.mermaid', content);
    if (!nodes.length) return;
    var script = document.createElement('script');
    script.src = OBS.mermaid;
    script.async = true;
    script.onload = function () {
      if (!window.mermaid) return;
      window.mermaid.initialize({
        startOnLoad: false,
        securityLevel: 'loose',
        theme: 'base',
        fontFamily: '"Noto Sans SC", "PingFang SC", system-ui, sans-serif',
        themeVariables: {
          primaryColor: '#e7effd', primaryTextColor: '#111f43', primaryBorderColor: '#7c96c2',
          secondaryColor: '#f2e8db', secondaryBorderColor: '#c79663', tertiaryColor: '#f4f7fb',
          lineColor: '#53678d', textColor: '#111f43', fontSize: '14px', background: '#fbfdff',
          clusterBkg: '#f4f7fb', clusterBorder: '#ced9e9', edgeLabelBackground: '#fbfdff'
        }
      });
      window.mermaid.run({ nodes: nodes }).catch(function () { /* 保留源码作为降级展示 */ });
    };
    document.head.appendChild(script);
  }

  /* ------------------------------------------------------------------ 07 归档 */

  function initArchive() {
    var root = $('[data-archive]');
    if (!root) return;
    var yearButtons = $$('[data-year-nav] button', root);
    var groups = $$('[data-year-group]', root);
    var items = $$('.archive-item', root);
    var emptyEl = $('[data-archive-empty]', root);
    var state = { year: yearButtons.length ? yearButtons[0].getAttribute('data-year') : '', category: '', type: '', sort: 'desc' };

    function apply() {
      var anyVisible = 0;
      groups.forEach(function (g) {
        var isYear = g.getAttribute('data-year-group') === state.year;
        var yearCount = 0;
        $$('.archive-month', g).forEach(function (month) {
          var visible = 0;
          $$('.archive-item', month).forEach(function (it) {
            var ok = (!state.category || it.getAttribute('data-category') === state.category) && (!state.type || it.getAttribute('data-type') === state.type);
            it.hidden = !ok;
            if (ok) visible += 1;
          });
          $('[data-month-count]', month).textContent = String(visible);
          month.hidden = visible === 0;
          yearCount += visible;
        });
        g.hidden = !isYear;
        var btn = yearButtons.filter(function (b) { return b.getAttribute('data-year') === g.getAttribute('data-year-group'); })[0];
        if (btn) $('[data-year-count]', btn).textContent = String(yearCount);
        if (isYear) anyVisible = yearCount;
      });
      emptyEl.hidden = anyVisible > 0;
    }

    function sortDom(desc) {
      groups.forEach(function (g) {
        var months = $$('.archive-month', g);
        months.sort(function (a, b) { var x = a.getAttribute('data-month'), y = b.getAttribute('data-month'); return desc ? (x < y ? 1 : -1) : (x < y ? -1 : 1); });
        months.forEach(function (m) { g.appendChild(m); });
        months.forEach(function (m) {
          var box = $('.archive-items', m);
          var its = $$('.archive-item', box);
          its.sort(function (a, b) { var x = a.getAttribute('data-date'), y = b.getAttribute('data-date'); return desc ? (x < y ? 1 : -1) : (x < y ? -1 : 1); });
          its.forEach(function (it) { box.appendChild(it); });
        });
      });
      // 年份导航顺序同步
      var nav = $('[data-year-nav]', root);
      var btns = yearButtons.slice().sort(function (a, b) { var x = Number(a.getAttribute('data-year')), y = Number(b.getAttribute('data-year')); return desc ? y - x : x - y; });
      btns.forEach(function (b) { nav.appendChild(b); });
      var gs = groups.slice().sort(function (a, b) { var x = Number(a.getAttribute('data-year-group')), y = Number(b.getAttribute('data-year-group')); return desc ? y - x : x - y; });
      var content = $('[data-archive-content]', root);
      gs.forEach(function (g) { content.insertBefore(g, emptyEl); });
    }

    yearButtons.forEach(function (b) {
      on(b, 'click', function () {
        state.year = b.getAttribute('data-year');
        yearButtons.forEach(function (x) { var onIt = x === b; x.classList.toggle('active', onIt); x.setAttribute('aria-pressed', onIt ? 'true' : 'false'); });
        apply();
        if (MOBILE.matches) smoothScrollTo($('[data-archive-content]', root));
      });
    });

    // 下拉筛选
    $$('.dropdown', root).forEach(function (dd) {
      var key = dd.getAttribute('data-dropdown');
      var toggle = $('.dropdown__toggle', dd);
      var menu = $('.dropdown__menu', dd);
      var defaultLabel = toggle.getAttribute('data-dropdown-label');
      function close() { menu.hidden = true; toggle.setAttribute('aria-expanded', 'false'); }
      on(toggle, 'click', function () {
        var open = menu.hidden;
        $$('.dropdown__menu', root).forEach(function (m) { m.hidden = true; });
        $$('.dropdown__toggle', root).forEach(function (t) { t.setAttribute('aria-expanded', 'false'); });
        menu.hidden = !open;
        toggle.setAttribute('aria-expanded', open ? 'true' : 'false');
        if (open) { var first = menu.querySelector('[aria-selected="true"]') || menu.querySelector('button'); if (first) first.focus(); }
      });
      $$('button', menu).forEach(function (opt) {
        on(opt, 'click', function () {
          var value = opt.getAttribute('data-value');
          $$('button', menu).forEach(function (o) { o.setAttribute('aria-selected', o === opt ? 'true' : 'false'); });
          toggle.textContent = opt.textContent;
          toggle.classList.toggle('is-active', key !== 'sort' ? !!value : value !== 'desc');
          if (key === 'sort') { state.sort = value; sortDom(value === 'desc'); }
          else state[key] = value;
          if (!value && key !== 'sort') toggle.textContent = defaultLabel;
          apply();
          close();
          toggle.focus();
        });
      });
      on(dd, 'keydown', function (e) {
        if (e.key === 'Escape') { close(); toggle.focus(); }
        if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
          var opts = $$('button', menu);
          var i = opts.indexOf(document.activeElement);
          if (menu.hidden || i === -1) return;
          e.preventDefault();
          opts[(i + (e.key === 'ArrowDown' ? 1 : opts.length - 1)) % opts.length].focus();
        }
      });
    });
    on(document, 'click', function (e) {
      if (e.target.closest('.dropdown')) return;
      $$('.dropdown__menu', root).forEach(function (m) { m.hidden = true; });
      $$('.dropdown__toggle', root).forEach(function (t) { t.setAttribute('aria-expanded', 'false'); });
    });
  }

  /* ------------------------------------------------------------------ 启动 */

  function boot() {
    initMobileMenu();
    initSearchOverlay();
    initScrollLinks();
    initHome();
    initDiscover();
    initTopics();
    initPaths();
    initPathDetail();
    initArticle();
    initArchive();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
