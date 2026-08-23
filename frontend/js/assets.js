// HiTechNour brand assets — see artifacts; minimal loader
window.HTN_ASSETS = window.HTN_ASSETS || {};
(function () {
  // Prefer real PNGs when present on CDN after upload
  var candidates = [
    'icons/logo-htn.png',
    'icons/logo-hitech.png',
    'icons/logo.svg'
  ];
  var iconCandidates = [
    'icons/icon-192.png',
    'icons/logo-htn.png',
    'icons/logo.svg'
  ];
  function setImgs(src) {
    document.querySelectorAll('img.boot-logo-img, img.brand-logo-img, .topbar-brand img, img.brand-mark-img').forEach(function (img) {
      img.src = src;
      img.onerror = null;
    });
  }
  function setIcons(src) {
    document.querySelectorAll('link[rel="icon"], link[rel="apple-touch-icon"]').forEach(function (l) {
      l.href = src;
      l.type = src.indexOf('.svg') >= 0 ? 'image/svg+xml' : 'image/png';
    });
  }
  function tryNext(list, i, apply) {
    if (i >= list.length) return;
    var img = new Image();
    img.onload = function () { apply(list[i]); };
    img.onerror = function () { tryNext(list, i + 1, apply); };
    img.src = list[i] + '?v=' + Date.now();
  }
  function loadFinalLoginStyles() {
    if (document.getElementById('htn-final-login-styles')) return;
    var link = document.createElement('link');
    link.id = 'htn-final-login-styles';
    link.rel = 'stylesheet';
    link.href = 'css/login-reference-final.css?v=2';
    document.head.appendChild(link);
  }
  function run() {
    tryNext(candidates, 0, setImgs);
    tryNext(iconCandidates, 0, setIcons);
    loadFinalLoginStyles();
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', run);
  else run();
  setTimeout(run, 100);
  setTimeout(run, 500);
})();
