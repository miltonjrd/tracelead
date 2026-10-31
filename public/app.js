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

  if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(function () {});
})();
