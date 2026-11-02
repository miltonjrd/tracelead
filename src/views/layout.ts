import { html, type SafeHtml } from '../lib/html.js';
import { assetUrl } from '../routes/static.js';
import type { SessionUser } from '../services/auth.js';

export function page(opts: { title: string; body: SafeHtml; user?: SessionUser | null; nav?: SafeHtml }): string {
  const { title, body, user, nav } = opts;
  return `<!doctype html>${html`<html lang="pt-BR">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="htmx-config" content='{"includeIndicatorStyles":false}'>
<meta name="theme-color" content="#15803d">
<title>${title} · TraceLead</title>
<link rel="manifest" href="/manifest.webmanifest">
<link rel="icon" href="${assetUrl('icon.svg')}" type="image/svg+xml">
<link rel="stylesheet" href="${assetUrl('app.css')}">
<script src="${assetUrl('htmx.min.js')}" defer></script>
<script src="${assetUrl('app.js')}" defer></script>
</head>
<body>
${user || nav
  ? html`<div class="shell">
  <aside class="sidebar">
    <a class="brand" href="/"><img src="${assetUrl('icon.svg')}" alt="" width="24" height="24">TraceLead</a>
    ${nav ?? ''}
    ${user
      ? html`<form method="post" action="/logout" class="logout">
          <span class="muted">${user.username}</span>
          <button class="btn-link" type="submit">Sair</button>
        </form>`
      : ''}
  </aside>
  <main class="container">${body}</main>
</div>`
  : html`<main class="container"><a class="brand brand-solo" href="/"><img src="${assetUrl('icon.svg')}" alt="" width="24" height="24">TraceLead</a>${body}</main>`}
</body>
</html>`}`;
}

export function flash(kind: 'ok' | 'erro', message: string | null | undefined): SafeHtml | '' {
  if (!message) return '';
  return html`<p class="flash flash-${kind}" role="${kind === 'erro' ? 'alert' : 'status'}">${message}</p>`;
}
