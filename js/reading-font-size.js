/**
 * 文章正文阅读字号：桌面端导航下拉 / 移动端侧栏（显示模式下方）
 */
(function () {
  'use strict';

  var STORAGE_KEY = 'flywhl-reading-scale';
  var DEFAULT_ID = 'md';
  var MOBILE_QUERY = '(max-width: 768px)';
  var SCALES = [
    { id: 'sm', label: '小', value: 0.875 },
    { id: 'md', label: '默认', value: 1 },
    { id: 'lg', label: '大', value: 1.125 },
    { id: 'xl', label: '特大', value: 1.25 },
  ];

  var mobileMq = window.matchMedia(MOBILE_QUERY);
  var desktopDropdownOpen = false;
  var desktopPanelHome = null;

  function isPostPage() {
    return !!(
      document.querySelector('#body-wrap.post') ||
      document.querySelector('#post .article-container')
    );
  }

  function isMobile() {
    return mobileMq.matches;
  }

  function getScaleById(id) {
    for (var i = 0; i < SCALES.length; i++) {
      if (SCALES[i].id === id) return SCALES[i];
    }
    return SCALES[1];
  }

  function getSavedScaleId() {
    try {
      return localStorage.getItem(STORAGE_KEY) || DEFAULT_ID;
    } catch (e) {
      return DEFAULT_ID;
    }
  }

  function applyScale(id) {
    var item = getScaleById(id);
    document.documentElement.style.setProperty(
      '--flywhl-reading-scale',
      String(item.value)
    );
    document.documentElement.setAttribute('data-reading-scale', item.id);
    try {
      localStorage.setItem(STORAGE_KEY, item.id);
    } catch (e) {
      /* 忽略 */
    }
    updateButtons(item.id);
  }

  function updateButtons(activeId) {
    var buttons = document.querySelectorAll(
      '.flywhl-reading-font__btn[data-scale]'
    );
    for (var i = 0; i < buttons.length; i++) {
      var btn = buttons[i];
      var on = btn.getAttribute('data-scale') === activeId;
      btn.setAttribute('aria-pressed', on ? 'true' : 'false');
      btn.classList.toggle('is-active', on);
    }
  }

  function buildScaleButtons() {
    var group = document.createElement('div');
    group.className = 'flywhl-reading-font__group';
    group.setAttribute('role', 'group');
    group.setAttribute('aria-label', '正文字号档位');

    for (var i = 0; i < SCALES.length; i++) {
      (function (scale) {
        var btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'flywhl-reading-font__btn';
        btn.setAttribute('data-scale', scale.id);
        btn.textContent = scale.label;
        btn.setAttribute('aria-pressed', 'false');
        btn.addEventListener('click', function (e) {
          e.stopPropagation();
          applyScale(scale.id);
          if (!isMobile()) closeDesktopDropdown();
        });
        group.appendChild(btn);
      })(SCALES[i]);
    }
    return group;
  }

  /** 桌面下拉与移动侧栏共用面板结构 */
  function buildReadingFontPanel() {
    var panel = document.createElement('div');
    panel.className = 'flywhl-reading-font-panel';

    var head = document.createElement('div');
    head.className = 'flywhl-reading-font-panel__head';

    var icon = document.createElement('i');
    icon.className = 'solitude fas fa-font';
    head.appendChild(icon);

    var label = document.createElement('span');
    label.className = 'flywhl-reading-font-panel__title';
    label.textContent = '正文字号';
    head.appendChild(label);

    panel.appendChild(head);
    panel.appendChild(buildScaleButtons());
    return panel;
  }

  function removeMounts() {
    closeDesktopDropdown();
    var nodes = document.querySelectorAll(
      '#flywhl-reading-font-nav, #flywhl-reading-font-mobile, #flywhl-reading-font'
    );
    for (var i = 0; i < nodes.length; i++) nodes[i].remove();
    var floating = document.getElementById('flywhl-reading-font-dropdown-float');
    if (floating) floating.remove();
    desktopPanelHome = null;
  }

  function positionDesktopDropdown(trigger, panel) {
    if (!trigger || !panel) return;
    var rect = trigger.getBoundingClientRect();
    panel.style.position = 'fixed';
    panel.style.top = Math.round(rect.bottom + 6) + 'px';
    panel.style.right = Math.round(window.innerWidth - rect.right) + 'px';
    panel.style.left = 'auto';
    panel.style.zIndex = '1100';
  }

  function closeDesktopDropdown() {
    var nav = document.getElementById('flywhl-reading-font-nav');
    if (!nav) return;
    var panel = document.getElementById('flywhl-reading-font-dropdown-float');
    var trigger = nav.querySelector('.flywhl-reading-font-trigger');
    if (panel && desktopPanelHome) {
      desktopPanelHome.appendChild(panel);
      panel.id = '';
      panel.hidden = true;
      panel.removeAttribute('style');
    }
    if (trigger) trigger.setAttribute('aria-expanded', 'false');
    nav.classList.remove('is-open');
    desktopDropdownOpen = false;
  }

  function openDesktopDropdown() {
    var nav = document.getElementById('flywhl-reading-font-nav');
    if (!nav) return;
    var slot = nav.querySelector('.flywhl-reading-font-dropdown');
    var panel = slot && slot.firstElementChild;
    var trigger = nav.querySelector('.flywhl-reading-font-trigger');
    if (!panel || !trigger) return;

    panel.id = 'flywhl-reading-font-dropdown-float';
    panel.hidden = false;
    document.body.appendChild(panel);
    positionDesktopDropdown(trigger, panel);
    trigger.setAttribute('aria-expanded', 'true');
    nav.classList.add('is-open');
    desktopDropdownOpen = true;
  }

  function toggleDesktopDropdown() {
    if (desktopDropdownOpen) closeDesktopDropdown();
    else openDesktopDropdown();
  }

  function mountDesktopNav() {
    if (document.getElementById('flywhl-reading-font-nav')) return;

    var darkBtn = document.getElementById('darkmode_button');
    if (!darkBtn || !darkBtn.parentNode) return;

    var navBtn = document.createElement('div');
    navBtn.className = 'nav-button';
    navBtn.id = 'flywhl-reading-font-nav';

    var trigger = document.createElement('a');
    trigger.className = 'site-page flywhl-reading-font-trigger';
    trigger.href = 'javascript:void(0);';
    trigger.title = '正文字号';
    trigger.setAttribute('aria-label', '正文字号');
    trigger.setAttribute('aria-haspopup', 'true');
    trigger.setAttribute('aria-expanded', 'false');
    trigger.innerHTML = '<i class="solitude fas fa-font"></i>';

    var slot = document.createElement('div');
    slot.className = 'flywhl-reading-font-dropdown';
    slot.setAttribute('role', 'menu');
    slot.hidden = true;
    slot.appendChild(buildReadingFontPanel());
    desktopPanelHome = slot;

    trigger.addEventListener('click', function (e) {
      e.preventDefault();
      e.stopPropagation();
      toggleDesktopDropdown();
    });

    slot.addEventListener('click', function (e) {
      e.stopPropagation();
    });

    navBtn.appendChild(trigger);
    navBtn.appendChild(slot);
    darkBtn.parentNode.insertBefore(navBtn, darkBtn);

    if (!window.__flywhlReadingFontDocClick) {
      window.__flywhlReadingFontDocClick = true;
      document.addEventListener('click', function (e) {
        var nav = document.getElementById('flywhl-reading-font-nav');
        var panel = document.getElementById('flywhl-reading-font-dropdown-float');
        if (!nav) return;
        if (nav.contains(e.target) || (panel && panel.contains(e.target))) return;
        closeDesktopDropdown();
      });
      document.addEventListener('keydown', function (e) {
        if (e.key === 'Escape') closeDesktopDropdown();
      });
      window.addEventListener(
        'resize',
        function () {
          if (!desktopDropdownOpen) return;
          var trigger = document.querySelector(
            '#flywhl-reading-font-nav .flywhl-reading-font-trigger'
          );
          var panel = document.getElementById('flywhl-reading-font-dropdown-float');
          positionDesktopDropdown(trigger, panel);
        },
        { passive: true }
      );
      window.addEventListener(
        'scroll',
        function () {
          if (!desktopDropdownOpen) return;
          var trigger = document.querySelector(
            '#flywhl-reading-font-nav .flywhl-reading-font-trigger'
          );
          var panel = document.getElementById('flywhl-reading-font-dropdown-float');
          positionDesktopDropdown(trigger, panel);
        },
        { passive: true }
      );
    }
  }

  function mountMobileSidebar() {
    if (document.getElementById('flywhl-reading-font-mobile')) return;

    var darkRow = document.querySelector(
      '#sidebar-menus .sidebar-menu-item .darkmode_switchbutton.menu-child'
    );
    var darkItem = darkRow && darkRow.closest('.sidebar-menu-item');
    if (!darkItem || !darkItem.parentNode) return;

    var row = document.createElement('div');
    row.id = 'flywhl-reading-font-mobile';
    row.className = 'flywhl-reading-font-mobile sidebar-menu-item';
    row.appendChild(buildReadingFontPanel());

    darkItem.insertAdjacentElement('afterend', row);
  }

  function fixBackHomeHover() {
    document.querySelectorAll('.back-home-button[tabindex="-1"]').forEach(function (el) {
      el.removeAttribute('tabindex');
    });
  }

  function mount() {
    removeMounts();
    if (!isPostPage()) return;

    applyScale(getSavedScaleId());
    fixBackHomeHover();

    if (isMobile()) mountMobileSidebar();
    else mountDesktopNav();
  }

  function boot() {
    mount();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }

  document.addEventListener('pjax:complete', boot);
  window.addEventListener('pageshow', function (event) {
    if (event.persisted) boot();
  });
  if (typeof mobileMq.addEventListener === 'function') {
    mobileMq.addEventListener('change', boot);
  } else if (typeof mobileMq.addListener === 'function') {
    mobileMq.addListener(boot);
  }
})();
