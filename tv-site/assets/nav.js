// One header for every public page: Addons, Buy me a coffee, Download. Pages carry the same links as plain HTML;
// this keeps the older pages in step and adds the coffee link from the server's SUPPORT_URL.
(function () {
  var nav = document.querySelector('.bar nav'); if (!nav) return;
  var here = location.pathname.replace(/\/$/, '');
  nav.innerHTML = '<a href="/addon-list"' + (here === '/addon-list' ? ' aria-current="page"' : '') + '>Addons</a>' +
    '<a href="/download" class="pill">Download</a>';
  var brand = document.querySelector('.bar .brand'); if (brand) brand.setAttribute('href', '/download');
  fetch('/support-config').then(function (r) { return r.json(); }).then(function (d) {
    if (!d || !d.url) return;
    var a = document.createElement('a');
    a.className = 'coffee'; a.href = d.url; a.target = '_blank'; a.rel = 'noopener noreferrer';
    a.setAttribute('aria-label', 'Buy me a coffee');
    a.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 9h13v5a5 5 0 0 1-5 5H9a5 5 0 0 1-5-5V9z"/><path d="M17 11h1.5a2.5 2.5 0 0 1 0 5H16"/><path d="M8 3v2M12 3v2"/></svg><span>Buy me a coffee</span>';
    nav.insertBefore(a, nav.querySelector('.pill'));
  }).catch(function () {});
})();
