import type { Client } from '../db/schema.js';
import { formatMoney, formatPhone } from '../lib/format.js';
import { html, type SafeHtml } from '../lib/html.js';
import { localDate, localTime, formatDateBr } from '../lib/time.js';
import type { PanelRow } from '../services/panel.js';
import { ORIGEM_LABEL, ORIGENS_MANUAIS } from './labels.js';

function when(ts: number, client: Client, now: number): string {
  const day = localDate(ts, client.timezone);
  const today = localDate(now, client.timezone);
  const yesterday = localDate(now - 24 * 60 * 60 * 1000, client.timezone);
  const label = day === today ? 'hoje' : day === yesterday ? 'ontem' : formatDateBr(day).slice(0, 5);
  return `${label} ${localTime(ts, client.timezone)}`;
}

function hx(action: string, id: number) {
  return html`method="post" action="${action}" hx-post="${action}" hx-target="#contato-${id}" hx-swap="outerHTML"`;
}

export function contactCard(row: PanelRow, client: Client, now: number, error?: string): SafeHtml {
  const { contact: c, lastSale } = row;
  const base = `/painel/contatos/${c.id}`;
  const title = c.name ?? formatPhone(c.phone);

  let actions: SafeHtml;
  if (c.status === 'aberto') {
    actions = html`<div class="actions">
      <details class="sale"${error ? ' open' : ''}>
        <summary class="btn btn-primary">Vendeu</summary>
        <form ${hx(`${base}/venda`, c.id)} class="sale-form">
          <label for="valor-${c.id}">Valor da venda</label>
          <div class="row">
            <input id="valor-${c.id}" name="valor" inputmode="decimal" autocomplete="off" placeholder="0,00" required>
            <button class="btn btn-primary" type="submit">Confirmar</button>
          </div>
        </form>
      </details>
      <form ${hx(`${base}/nao-comprou`, c.id)}>
        <button class="btn btn-secondary" type="submit">Não comprou</button>
      </form>
    </div>`;
  } else {
    const label =
      c.status === 'vendeu' && lastSale
        ? html`<span class="status status-ok">Vendeu ${formatMoney(lastSale.valorCentavos, client.currency)}</span>`
        : html`<span class="status status-no">Não comprou</span>`;
    actions = html`<div class="actions resolved">
      ${label}
      <form ${hx(`${base}/reabrir`, c.id)}><button class="btn-link" type="submit">Desfazer</button></form>
    </div>`;
  }

  const origem = c.clickId
    ? ''
    : html`<form ${hx(`${base}/origem`, c.id)} hx-trigger="change" class="origem">
        <label for="origem-${c.id}">Como conheceu?</label>
        <select id="origem-${c.id}" name="origem">
          ${ORIGENS_MANUAIS.map(
            (o) => html`<option value="${o}"${o === c.origem ? ' selected' : ''}>${ORIGEM_LABEL[o]}</option>`,
          )}
        </select>
        <noscript><button class="btn-link" type="submit">Salvar</button></noscript>
      </form>`;

  return html`<article class="card contact" id="contato-${c.id}">
    <div class="contact-head">
      <div>
        <strong>${title}</strong>
        ${c.name ? html`<a class="muted phone" href="https://wa.me/${c.phone.slice(1)}">${formatPhone(c.phone)}</a>` : ''}
      </div>
      <span class="badge badge-${c.origem}">${ORIGEM_LABEL[c.origem]}</span>
    </div>
    <p class="meta">Chegou ${when(c.firstMessageAt, client, now)}${c.lastMessageAt - c.firstMessageAt > 60_000 ? ` · última mensagem ${when(c.lastMessageAt, client, now)}` : ''}</p>
    ${error ? html`<p class="flash flash-erro" role="alert">${error}</p>` : ''}
    ${actions}
    ${origem}
  </article>`;
}

export function panelPage(
  data: { pendentes: PanelRow[]; resolvidos: PanelRow[] },
  client: Client,
  now: number,
): SafeHtml {
  return html`<section>
    <div class="page-head">
      <h1>${client.name}</h1>
      <p class="muted">${formatDateBr(localDate(now, client.timezone))}</p>
    </div>
    <h2 class="section-title">Para marcar <span class="count">${data.pendentes.length}</span></h2>
    ${data.pendentes.length
      ? html`<div class="stack">${data.pendentes.map((r) => contactCard(r, client, now))}</div>`
      : html`<p class="empty">Tudo marcado. Novos contatos do WhatsApp aparecem aqui.</p>`}
    ${data.resolvidos.length
      ? html`<h2 class="section-title">Marcados hoje <span class="count">${data.resolvidos.length}</span></h2>
          <div class="stack">${data.resolvidos.map((r) => contactCard(r, client, now))}</div>`
      : ''}
  </section>`;
}
