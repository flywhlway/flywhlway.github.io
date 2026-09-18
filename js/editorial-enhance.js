/**
 * 飞轮之道博客 — Editorial Magazine 交互
 * 对准原型 C：导航 scrolled、暗色、搜索、精选轨拖拽、reveal。
 * 内页给 Solitude #nav 加上 magazine-chrome。
 */
(function () {
  'use strict';

  var reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  var root = document.documentElement;
  var revealIo = null;

  function isMagazineHome() {
    return !!document.querySelector('.magazine-home');
  }

  function syncMagazineCover() {
    document.body.classList.toggle('magazine-cover', isMagazineHome());
  }

  function initNavScroll() {
    var nav = document.getElementById('magazine-nav') || document.querySelector('.magazine-home .nav');
    if (!window.__flywhlMagNavScroll) {
      window.__flywhlMagNavScroll = true;
      window.addEventListener('scroll', function () {
        var current = document.getElementById('magazine-nav') || document.querySelector('.magazine-home .nav');
        if (!current) return;
        current.classList.toggle('scrolled', window.scrollY > 40);
      }, { passive: true });
    }
    if (nav) nav.classList.toggle('scrolled', window.scrollY > 40);
  }

  function initInnerNavChrome() {
    if (isMagazineHome()) return;
    var nav = document.getElementById('nav');
    if (nav) nav.classList.add('magazine-chrome');
  }

  function applyTheme(next) {
    if (next === 'dark') root.setAttribute('data-theme', 'dark');
    else root.setAttribute('data-theme', 'light');
    try { localStorage.setItem('flywhl-theme', next); } catch (e) { /* ignore */ }
  }

  function initDarkMode() {
    var stored = null;
    try { stored = localStorage.getItem('flywhl-theme'); } catch (e) { stored = null; }
    if (stored === 'dark' || stored === 'light') {
      root.setAttribute('data-theme', stored);
    } else if (window.matchMedia('(prefers-color-scheme: dark)').matches) {
      root.setAttribute('data-theme', 'dark');
    }

    var themeBtn = document.getElementById('themeBtn');
    if (themeBtn && themeBtn.dataset.editorialBound !== '1') {
      themeBtn.dataset.editorialBound = '1';
      themeBtn.addEventListener('click', function () {
        if (window.sco && typeof window.sco.switchDarkMode === 'function') {
          window.sco.switchDarkMode();
          return;
        }
        var next = root.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';
        applyTheme(next);
      });
    }
  }

  function initMobileMenu() {
    var nav = document.getElementById('magazine-nav');
    var mobileMenu = document.getElementById('mobileMenu');
    var menuBtn = document.getElementById('menuBtn');
    if (!mobileMenu || !menuBtn || menuBtn.dataset.editorialBound === '1') return;
    menuBtn.dataset.editorialBound = '1';
    var menuOpen = false;
    menuBtn.addEventListener('click', function () {
      menuOpen = !menuOpen;
      mobileMenu.classList.toggle('open', menuOpen);
      if (nav) nav.classList.toggle('solid', menuOpen);
    });
    mobileMenu.querySelectorAll('a').forEach(function (a) {
      a.addEventListener('click', function () {
        menuOpen = false;
        mobileMenu.classList.remove('open');
        if (nav) nav.classList.remove('solid');
      });
    });
  }

  function clickSolitudeSearch() {
    var solitudeBtn = document.getElementById('search-button');
    if (solitudeBtn) {
      solitudeBtn.click();
      return true;
    }
    return false;
  }

  function openMagazineSearch() {
    if (clickSolitudeSearch()) return;
    var overlay = document.getElementById('searchOverlay');
    var input = document.getElementById('searchInput');
    if (!overlay) return;
    overlay.classList.add('open');
    if (input) setTimeout(function () { input.focus(); }, 120);
  }

  function closeMagazineSearch() {
    var overlay = document.getElementById('searchOverlay');
    if (overlay) overlay.classList.remove('open');
  }

  function initSearch() {
    var overlay = document.getElementById('searchOverlay');
    var searchBtn = document.getElementById('searchBtn');
    var searchClose = document.getElementById('searchClose');

    if (searchBtn && searchBtn.dataset.editorialBound !== '1') {
      searchBtn.dataset.editorialBound = '1';
      searchBtn.addEventListener('click', openMagazineSearch);
    }
    if (searchClose && searchClose.dataset.editorialBound !== '1') {
      searchClose.dataset.editorialBound = '1';
      searchClose.addEventListener('click', closeMagazineSearch);
    }
    if (overlay && overlay.dataset.editorialBound !== '1') {
      overlay.dataset.editorialBound = '1';
      overlay.addEventListener('click', function (e) {
        if (e.target === overlay) closeMagazineSearch();
      });
    }

    if (!window.__flywhlEditorialSearchKeys) {
      window.__flywhlEditorialSearchKeys = true;
      document.addEventListener('keydown', function (e) {
        if (e.key === 'Escape') {
          closeMagazineSearch();
          var searchMask = document.getElementById('search-mask');
          if (searchMask && searchMask.style.display !== 'none' && typeof searchMask.click === 'function') {
            searchMask.click();
          }
        }
        if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
          e.preventDefault();
          openMagazineSearch();
        }
      });
    }
  }

  function initScrollCue() {
    var cue = document.getElementById('scrollCue');
    var latest = document.getElementById('latest');
    if (!cue || !latest || cue.dataset.editorialBound === '1') return;
    cue.dataset.editorialBound = '1';
    cue.addEventListener('click', function () {
      var target = document.getElementById('latest');
      if (target) target.scrollIntoView({ behavior: reduced ? 'auto' : 'smooth' });
    });
  }

  function initReveal() {
    var revealEls = document.querySelectorAll('.reveal');
    if (revealIo) {
      revealIo.disconnect();
      revealIo = null;
    }
    if (!revealEls.length) return;
    if (reduced || !('IntersectionObserver' in window)) {
      revealEls.forEach(function (el) { el.classList.add('in'); });
      return;
    }
    revealIo = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (entry.isIntersecting) {
          entry.target.classList.add('in');
          revealIo.unobserve(entry.target);
        }
      });
    }, { threshold: 0.1, rootMargin: '0px 0px -6% 0px' });
    revealEls.forEach(function (el) { revealIo.observe(el); });
  }

  function initFeaturedTrack() {
    var track = document.getElementById('featuredTrack');
    if (!track || track.dataset.editorialBound === '1') return;
    track.dataset.editorialBound = '1';
    var step = function () { return track.clientWidth * 0.72; };
    var prev = document.getElementById('fPrev');
    var next = document.getElementById('fNext');
    if (prev) {
      prev.addEventListener('click', function () {
        track.scrollBy({ left: -step(), behavior: reduced ? 'auto' : 'smooth' });
      });
    }
    if (next) {
      next.addEventListener('click', function () {
        track.scrollBy({ left: step(), behavior: reduced ? 'auto' : 'smooth' });
      });
    }

    var dragging = false;
    var startX = 0;
    var startScroll = 0;
    var moved = false;
    track.addEventListener('pointerdown', function (e) {
      if (e.pointerType !== 'mouse') return;
      dragging = true;
      moved = false;
      startX = e.clientX;
      startScroll = track.scrollLeft;
    });
    track.addEventListener('pointermove', function (e) {
      if (!dragging) return;
      var dx = e.clientX - startX;
      if (Math.abs(dx) > 6) {
        moved = true;
        track.classList.add('dragging');
      }
      track.scrollLeft = startScroll - dx;
    });
    ['pointerup', 'pointercancel', 'pointerleave'].forEach(function (evt) {
      track.addEventListener(evt, function () {
        dragging = false;
        track.classList.remove('dragging');
      });
    });
    track.addEventListener('click', function (e) {
      if (moved) {
        e.preventDefault();
        e.stopPropagation();
        moved = false;
      }
    }, true);
  }

  function initSmoothScroll() {
    document.querySelectorAll('.magazine-home a[href^="#"]').forEach(function (anchor) {
      if (anchor.dataset.editorialBound === '1') return;
      anchor.dataset.editorialBound = '1';
      anchor.addEventListener('click', function (e) {
        var targetId = this.getAttribute('href');
        if (!targetId || targetId === '#') return;
        var target = document.querySelector(targetId);
        if (target) {
          e.preventDefault();
          target.scrollIntoView({ behavior: reduced ? 'auto' : 'smooth', block: 'start' });
        }
      });
    });
  }

  function init() {
    syncMagazineCover();
    initInnerNavChrome();
    initNavScroll();
    initDarkMode();
    initMobileMenu();
    initSearch();
    initScrollCue();
    initReveal();
    initFeaturedTrack();
    initSmoothScroll();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  document.addEventListener('pjax:complete', init);
  window.addEventListener('pageshow', function (event) {
    if (event.persisted) init();
  });
})();
