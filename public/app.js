(function () {
  'use strict';

  // Inline handlers are blocked by the CSP, so confirmations are wired here.
  document.addEventListener('submit', function (e) {
    var message = e.submitter && e.submitter.getAttribute('data-confirm');
    if (message && !window.confirm(message)) e.preventDefault();
  });

  // Selects marked data-autosubmit apply as soon as they change.
  document.addEventListener('change', function (e) {
    var el = e.target;
    if (el.matches && el.matches('select[data-autosubmit]') && el.form) el.form.submit();
  });

  // Amount mask: digits fill in from the cents, so typing 125090 shows 1.250,90.
  document.addEventListener('input', function (e) {
    var input = e.target;
    if (!input.matches || !input.matches('input[name="valor"]')) return;
    var digits = input.value.replace(/\D/g, '').replace(/^0+/, '');
    if (!digits) {
      input.value = '';
      return;
    }
    digits = digits.padStart(3, '0');
    var reais = digits.slice(0, -2).replace(/\B(?=(\d{3})+(?!\d))/g, '.');
    input.value = reais + ',' + digits.slice(-2);
  });

  function openModal(dialog) {
    dialog.showModal();
    var input = dialog.querySelector('input[name="valor"]');
    if (input) input.focus();
  }

  // A sale rejected by the server comes back with its dialog flagged to reopen.
  function reopenFlagged() {
    document.querySelectorAll('dialog[data-autoopen]').forEach(function (d) {
      d.removeAttribute('data-autoopen');
      if (!d.open) openModal(d);
    });
  }
  document.body.addEventListener('htmx:afterSettle', reopenFlagged);

  // Modals: a button opens its <dialog>; "Cancelar" and a click on the backdrop close it.
  document.addEventListener('click', function (e) {
    var open = e.target.closest && e.target.closest('[data-modal-open]');
    if (open) {
      var dialog = document.getElementById(open.getAttribute('data-modal-open'));
      if (dialog && dialog.showModal) openModal(dialog);
      return;
    }
    var close = e.target.closest && e.target.closest('[data-modal-close]');
    if (close) {
      var d = close.closest('dialog');
      if (d) d.close();
      return;
    }
    if (e.target.tagName === 'DIALOG' && e.target.classList.contains('modal')) e.target.close();
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
