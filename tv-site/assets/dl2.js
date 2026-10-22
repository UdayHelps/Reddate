// /download, second edition: entrances, the stream picker, the ways-to-watch tabs, the menu preview,
// and the live version number. Everything on the page reads fine without it.
(function () {
  var reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;

  // sections reveal their parts once, in reading order
  var io = 'IntersectionObserver' in window && new IntersectionObserver(function (es) {
    es.forEach(function (e) { if (e.isIntersecting) { e.target.classList.add('in'); io.unobserve(e.target); } });
  }, { threshold: .15, rootMargin: '0px 0px -8% 0px' });
  document.querySelectorAll('[data-rv], .shot').forEach(function (n) { io ? io.observe(n) : n.classList.add('in'); });
  if (!io) document.documentElement.classList.remove('js');

  // the stream picker: pick once, the next episode starts the same kind of stream
  var list = document.getElementById('pkList'), note = document.getElementById('pkNote'),
      title = document.getElementById('pkTitle'), sub = document.getElementById('pkSub'), again = document.getElementById('pkAgain'), timer;
  if (list) {
    var rows = [].slice.call(list.children), original = rows.slice();
    list.addEventListener('click', function (e) {
      var row = e.target.closest('.pk-row'); if (!row || title.textContent.indexOf('Episode 2') === 0) return;
      var k = row.dataset.k, label = row.querySelector('.q').textContent;
      title.textContent = 'Episode 2 · Streams'; sub.textContent = 'Same as last time';
      rows.forEach(function (r) { r.classList.toggle('is-usual', r.dataset.k === k); });
      list.insertBefore(row, list.firstChild);
      var n = 3; note.textContent = 'Starting your usual ' + label + ' stream in ' + n + '…';
      clearInterval(timer);
      timer = setInterval(function () {
        n--; note.textContent = n > 0 ? 'Starting your usual ' + label + ' stream in ' + n + '…' : 'Playing episode 2. You pressed nothing.';
        if (n <= 0) clearInterval(timer);
      }, 900);
      again.hidden = false;
    });
    again.addEventListener('click', function () {
      clearInterval(timer);
      original.forEach(function (r) { r.classList.remove('is-usual'); list.appendChild(r); });
      title.textContent = 'Episode 1 · Streams'; sub.textContent = 'Pick one';
      note.textContent = "Choose the stream you'd watch tonight."; again.hidden = true;
    });
  }

  // ways to watch: the tabs change the plate and the words
  var copy = {
    together: ['Chat from the couch', "Everyone in the party chats with the TV's own keyboard. Messages sit over the picture and hide when the film gets good."],
    alone: ['Just you, no lobby', 'Pick a title and press Watch alone. Nothing to set up, and your Continue watching stays yours.'],
    code: ['Friends outside the house', 'Share the short party code or link. They join from a TV, phone, tablet or computer, and there is no seat limit.']
  };
  var tabs = [].slice.call(document.querySelectorAll('.tabs [role=tab]')), plates = [].slice.call(document.querySelectorAll('#plate [data-p]'));
  tabs.forEach(function (t) {
    t.addEventListener('click', function () {
      var p = t.dataset.p;
      tabs.forEach(function (x) { x.setAttribute('aria-selected', String(x === t)); });
      plates.forEach(function (x) { x.classList.toggle('on', x.dataset.p === p); });
      document.getElementById('showTitle').textContent = copy[p][0];
      document.getElementById('showDesc').textContent = copy[p][1];
    });
  });

  // the menu: point at a row and the frame shows it on the TV
  var frame = document.getElementById('frame');
  if (frame && matchMedia('(hover: hover) and (pointer: fine)').matches) {
    var cache = {}, current = frame.querySelector('img');
    cache[current.getAttribute('src')] = current;
    document.querySelectorAll('.item[data-img]').forEach(function (it) {
      function show() {
        var src = it.dataset.img, img = cache[src];
        if (!img) { img = cache[src] = new Image(); img.src = src; img.alt = ''; frame.appendChild(img); }
        if (img === current) return;
        current.classList.remove('on'); img.classList.add('on'); current = img;
      }
      it.addEventListener('mouseenter', show); it.addEventListener('focus', show);
    });
  }


  // Top 10 tonight: the catalog's live row, shown only when it answers
  var row = document.getElementById('t10Row');
  if (row) fetch('/catalog/catalog/movie/top10/genre=Today.json').then(function (r) { return r.ok ? r.json() : null; }).then(function (d) {
    var metas = d && d.metas ? d.metas.filter(function (m) { return m.poster; }).slice(0, 10) : [];
    if (metas.length < 5) return;
    metas.forEach(function (m, i) {
      var li = document.createElement('li'); li.style.setProperty('--k', i);
      var n = document.createElement('span'); n.className = 'n'; n.textContent = i + 1; n.setAttribute('aria-hidden', 'true');
      var a = document.createElement('a'); a.href = '#install'; a.title = m.name;
      var img = new Image(); img.src = m.poster; img.alt = (i + 1) + '. ' + m.name; img.loading = 'lazy'; img.width = 342; img.height = 513;
      a.appendChild(img); li.appendChild(n); li.appendChild(a); row.appendChild(li);
    });
    document.getElementById('top10').hidden = false;
    // the watch party plays tonight's number one
    if (metas[0].background) document.querySelectorAll('.l-play img').forEach(function (im) { im.src = metas[0].background; im.classList.add('backdrop'); });
    var ro = 'IntersectionObserver' in window && new IntersectionObserver(function (es) {
      if (es[0].isIntersecting) { [].forEach.call(row.children, function (li) { li.classList.add('in'); }); ro.disconnect(); }
    }, { threshold: .2 });
    if (ro) ro.observe(row);
  }).catch(function () {});

  // the watch party plays while it's on screen
  var party = document.getElementById('party');
  if (party && 'IntersectionObserver' in window && !reduce) new IntersectionObserver(function (es) {
    party.classList.toggle('play', es[0].isIntersecting);
  }, { threshold: .35 }).observe(party);

  // the download bar shows once the hero has gone and hides again at the install section
  var dock = document.getElementById('dock'), hero = document.querySelector('.hero'), install = document.getElementById('install'), past = false, atInstall = false, atFoot = false;
  function dockState() {
    var on = past && !atInstall && !atFoot; dock.classList.toggle('on', on);
    dock.setAttribute('aria-hidden', String(!on)); dock.querySelector('a').tabIndex = on ? 0 : -1;
  }
  if (dock && 'IntersectionObserver' in window) {
    new IntersectionObserver(function (es) { past = !es[0].isIntersecting; dockState(); }).observe(hero);
    new IntersectionObserver(function (es) { atInstall = es.some(function (e) { return e.isIntersecting; }); dockState(); }).observe(install);
    var foot = document.querySelector('footer');
    new IntersectionObserver(function (es) { atFoot = es[0].isIntersecting; dockState(); }).observe(foot);
  }

  // the newest version, size and checksum come from the server when it answers
  fetch('/api/app-version').then(function (r) { return r.ok ? r.json() : null; }).then(function (v) {
    if (!v || !v.versionName) return;
    document.querySelectorAll('[data-ver]').forEach(function (n) { n.textContent = 'Version ' + v.versionName; });
    if (v.size) document.querySelectorAll('[data-size]').forEach(function (n) { n.textContent = (v.size / 1048576).toFixed(1) + ' MB'; });
    if (v.sha256) document.querySelectorAll('[data-hash]').forEach(function (n) { n.textContent = v.sha256; });
  }).catch(function () {});

  // Buy me a coffee, when the server has a link for it
  fetch('/support-config').then(function (r) { return r.ok ? r.json() : null; }).then(function (d) {
    if (!d || !d.url) return;
    var a = document.createElement('a'); a.href = d.url; a.target = '_blank'; a.rel = 'noopener noreferrer'; a.textContent = 'Buy me a coffee'; a.className = 'coffee';
    var nav = document.getElementById('nav'); nav.insertBefore(a, nav.querySelector('.btn'));
  }).catch(function () {});

  if (reduce) return;
  // the hero film drifts a little as the page scrolls
  var vid = null, ticking = false;
  function drift() {
    ticking = false; if (!vid) return;
    var r = vid.getBoundingClientRect(); if (r.bottom < 0 || r.top > innerHeight) return;
    vid.style.transform = 'scale(' + (1 + Math.max(0, Math.min(1, 1 - r.top / innerHeight)) * .03) + ')';
  }
  addEventListener('scroll', function () { if (!ticking) { ticking = true; requestAnimationFrame(drift); } }, { passive: true });
})();
