(function () {
  'use strict';

  // Inline handlers are blocked by the CSP, so confirmations are wired here.
  document.addEventListener('submit', function (e) {
    var message = e.submitter && e.submitter.getAttribute('data-confirm');
    if (message && !window.confirm(message)) e.preventDefault();
  });

  // Opening "Vendeu" goes straight to the amount field.
  document.addEventListener(
    'toggle',
    function (e) {
      var details = e.target;
      if (details.matches && details.matches('details.sale') && details.open) {
        var input = details.querySelector('input[name="valor"]');
        if (input) input.focus();
      }
    },
    true
  );

  // "Cancelar" closes the sale form and returns to the Vendeu button.
  document.addEventListener('click', function (e) {
    var cancel = e.target.closest && e.target.closest('[data-cancel]');
    if (!cancel) return;
    var details = cancel.closest('details.sale');
    if (!details) return;
    details.open = false;
    var summary = details.querySelector('summary');
    if (summary) summary.focus();
  });

  // After a mark moves a card, keep keyboard and screen-reader focus on the announcement.
  document.body.addEventListener('htmx:afterSettle', function () {
    var aviso = document.getElementById('painel-aviso');
    if (aviso && aviso.getAttribute('data-fresh') === '1') {
      aviso.setAttribute('data-fresh', '0');
      aviso.focus({ preventScroll: true });
      // Success toasts leave on their own; tabbing to "Desfazer" keeps the toast until focus leaves it.
      clearTimeout(window.__avisoTimer);
      window.__avisoTimer = setTimeout(function () {
        if (!aviso.contains(document.activeElement) || document.activeElement === aviso) aviso.hidden = true;
      }, 8000);
    }
  });

  // Pending state: a tapped button says "Salvando…" and cannot be tapped twice on a slow connection.
  document.body.addEventListener('htmx:beforeRequest', function (e) {
    var form = e.detail.elt;
    if (!form || form.tagName !== 'FORM') return;
    form.querySelectorAll('button[type="submit"]').forEach(function (b) {
      b.setAttribute('data-label', b.textContent);
      b.textContent = 'Salvando…';
      b.disabled = true;
    });
  });

  // A failed request (offline, server error) must say so and leave the form usable.
  document.body.addEventListener('htmx:afterRequest', function (e) {
    if (e.detail.successful) return;
    var form = e.detail.elt;
    if (form && form.querySelectorAll) {
      form.querySelectorAll('button[data-label]').forEach(function (b) {
        b.textContent = b.getAttribute('data-label');
        b.removeAttribute('data-label');
        b.disabled = false;
      });
    }
    var aviso = document.getElementById('painel-aviso');
    if (!aviso) return;
    clearTimeout(window.__avisoTimer);
    aviso.className = 'flash flash-erro aviso';
    aviso.setAttribute('role', 'alert');
    aviso.setAttribute('aria-live', 'assertive');
    aviso.textContent = 'Não deu para salvar. Confira a conexão e toque de novo.';
    aviso.hidden = false;
    aviso.focus({ preventScroll: true });
  });

  if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(function () {});
})();
