/* Rastreio de cliques no WhatsApp. Instalação:
   <script src="https://SEU_DOMINIO/t.js" data-client="CHAVE" async></script> */
(function () {
  'use strict';
  var script = document.currentScript;
  if (!script || !window.URL || !window.URLSearchParams) return;

  var key = script.getAttribute('data-client');
  var endpoint = new URL('/click', script.src).href;
  var defaultMessage = script.getAttribute('data-message') || 'Olá! Gostaria de um orçamento.';
  var STORE = '_trk';
  var TTL = 90 * 24 * 60 * 60 * 1000;
  var FIELDS = ['gclid', 'gbraid', 'wbraid', 'utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content'];
  // Same alphabet as src/lib/ref.ts: no 0/O or 1/I.
  var ALPHABET = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';

  function fresh(v) {
    return v && typeof v.t === 'number' && Date.now() - v.t < TTL ? v : null;
  }

  function read() {
    try {
      var v = fresh(JSON.parse(localStorage.getItem(STORE) || 'null'));
      if (v) return v;
    } catch (e) {}
    var m = document.cookie.match(/(?:^|; )_trk=([^;]*)/);
    if (m) {
      try {
        return fresh(JSON.parse(decodeURIComponent(m[1])));
      } catch (e) {}
    }
    return null;
  }

  function save(v) {
    var s = JSON.stringify(v);
    try {
      localStorage.setItem(STORE, s);
    } catch (e) {}
    document.cookie = STORE + '=' + encodeURIComponent(s) + '; max-age=' + TTL / 1000 + '; path=/; SameSite=Lax';
  }

  // Last click wins: a visit with new ad parameters replaces the stored ones.
  var params = new URLSearchParams(location.search);
  var found = null;
  for (var i = 0; i < FIELDS.length; i++) {
    var value = params.get(FIELDS[i]);
    if (value) {
      found = found || {};
      found[FIELDS[i]] = value.slice(0, 512);
    }
  }
  if (found) {
    found.t = Date.now();
    found.landing_url = location.href.slice(0, 2048);
    save(found);
  }

  function newRef() {
    var bytes = new Uint8Array(5);
    crypto.getRandomValues(bytes);
    var ref = '';
    for (var i = 0; i < bytes.length; i++) ref += ALPHABET[bytes[i] & 31];
    return ref;
  }

  function isWhatsApp(url) {
    return url.protocol === 'whatsapp:' || /^(wa\.me|api\.whatsapp\.com|web\.whatsapp\.com)$/.test(url.hostname);
  }

  function send(payload) {
    var body = JSON.stringify(payload);
    try {
      if (navigator.sendBeacon && navigator.sendBeacon(endpoint, new Blob([body], { type: 'text/plain' }))) return;
    } catch (e) {}
    try {
      fetch(endpoint, { method: 'POST', body: body, keepalive: true, mode: 'no-cors', headers: { 'Content-Type': 'text/plain' } });
    } catch (e) {}
  }

  document.addEventListener(
    'click',
    function (ev) {
      if (!key || ev.defaultPrevented || ev.button !== 0) return;
      var link = ev.target && ev.target.closest ? ev.target.closest('a[href]') : null;
      if (!link) return;
      var url;
      try {
        url = new URL(link.href, location.href);
      } catch (e) {
        return;
      }
      if (!isWhatsApp(url)) return;

      var ref = newRef();
      var stored = read() || {};
      var payload = { k: key, ref: ref, landing_url: stored.landing_url || location.href.slice(0, 2048) };
      for (var i = 0; i < FIELDS.length; i++) if (stored[FIELDS[i]]) payload[FIELDS[i]] = stored[FIELDS[i]];
      send(payload);

      var text = (url.searchParams.get('text') || defaultMessage) + ' (ref. ' + ref + ')';
      url.searchParams.delete('text');
      // encodeURIComponent writes spaces as %20; searchParams would write "+", which WhatsApp may show literally.
      var href = url.href + (url.search ? '&' : '?') + 'text=' + encodeURIComponent(text);
      ev.preventDefault();
      var target = link.getAttribute('target');
      if (target && target !== '_self') window.open(href, target, 'noopener');
      else location.href = href;
    },
    true
  );
})();
