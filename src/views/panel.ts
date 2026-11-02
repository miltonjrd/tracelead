import type { Client } from '../db/schema.js';
import { formatMoney, formatPhone } from '../lib/format.js';
import { html, type SafeHtml } from '../lib/html.js';
import { localDate, localTime, formatDateBr } from '../lib/time.js';
import { OPEN_WINDOW_MS, type PanelRow } from '../services/panel.js';
import { DAY_MS } from '../lib/time.js';
import type { SessionStatus } from '../services/whatsappSessions.js';
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

/** Open contacts leave the list after OPEN_WINDOW_MS; say so before a forgotten one is lost. */
function expiry(lastMessageAt: number, now: number): SafeHtml | '' {
  const left = lastMessageAt + OPEN_WINDOW_MS - now;
  if (left > 2 * DAY_MS) return '';
  const label = left < DAY_MS ? 'Sai da lista hoje' : `Sai da lista em ${Math.ceil(left / DAY_MS)} dias`;
  return html` · <span class="expiry">${label}</span>`;
}

export function contactCard(row: PanelRow, client: Client, now: number, error?: string, moved = false): SafeHtml {
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
            <span class="money"><span class="money-sign" aria-hidden="true">R$</span><input id="valor-${c.id}" name="valor" inputmode="decimal" autocomplete="off" placeholder="0,00" required></span>
            <button class="btn btn-primary" type="submit">Confirmar</button>
          </div>
          <button class="btn-link" type="button" data-cancel>Cancelar</button>
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
    : html`<details class="origem-edit">
        <summary class="origem-summary">Alterar origem</summary>
        <form ${hx(`${base}/origem`, c.id)} hx-trigger="change" class="origem">
          <label for="origem-${c.id}">Como conheceu?</label>
          <select id="origem-${c.id}" name="origem">
            ${ORIGENS_MANUAIS.map(
              (o) => html`<option value="${o}"${o === c.origem ? ' selected' : ''}>${ORIGEM_LABEL[o]}</option>`,
            )}
          </select>
          <noscript><button class="btn-link" type="submit">Salvar</button></noscript>
        </form>
      </details>`;

  return html`<article class="card contact${moved ? ' moved' : ''}" id="contato-${c.id}">
    <div class="contact-head">
      <div>
        <strong>${title}</strong>
        ${c.name ? html`<a class="muted phone" href="https://wa.me/${c.phone.slice(1)}">${formatPhone(c.phone)}</a>` : ''}
      </div>
      <span class="badge badge-${c.origem}">${ORIGEM_LABEL[c.origem]}</span>
    </div>
    <p class="meta">Chegou ${when(c.firstMessageAt, client, now)}${c.lastMessageAt - c.firstMessageAt > 60_000 ? ` · última mensagem ${when(c.lastMessageAt, client, now)}` : ''}${expiry(c.lastMessageAt, now)}</p>
    ${error ? html`<p class="flash flash-erro" role="alert">${error}</p>` : ''}
    ${actions}
    ${origem}
  </article>`;
}

export type PanelData = { pendentes: PanelRow[]; resolvidos: PanelRow[] };

/** A marked contact is one ruled line of the day's ledger: who, what, how much, undo. */
export function ledgerRow(row: PanelRow, client: Client, error?: string, moved = false): SafeHtml {
  const { contact: c, lastSale } = row;
  const base = `/painel/contatos/${c.id}`;
  const title = c.name ?? formatPhone(c.phone);
  const result =
    c.status === 'vendeu' && lastSale
      ? html`<span class="ledger-val status-ok num">Vendeu ${formatMoney(lastSale.valorCentavos, client.currency)}</span>`
      : html`<span class="ledger-val status-no">Não comprou</span>`;
  return html`<li class="ledger-row${moved ? ' moved' : ''}" id="contato-${c.id}">
    <strong class="ledger-who">${title}</strong>
    ${result}
    <form ${hx(`${base}/reabrir`, c.id)} class="inline"><button class="btn-link" type="submit">Desfazer</button></form>
    ${error ? html`<p class="flash flash-erro ledger-error" role="alert">${error}</p>` : ''}
  </li>`;
}

function dayTotal(resolvidos: PanelRow[], client: Client): SafeHtml | '' {
  const sold = resolvidos.filter((r) => r.contact.status === 'vendeu' && r.lastSale);
  if (!sold.length) return '';
  const total = sold.reduce((sum, r) => sum + r.lastSale!.valorCentavos, 0);
  return html`<li class="ledger-total"><span>Total do dia · ${sold.length} ${sold.length === 1 ? 'venda' : 'vendas'}</span><strong class="num">${formatMoney(total, client.currency)}</strong></li>`;
}

/** The two lists share one swap target so a mark moves the contact and refreshes both counts. */
export function contactLists(
  data: PanelData,
  client: Client,
  now: number,
  opts: { movedId?: number; whatsappOff?: boolean; firstRun?: boolean } = {},
): SafeHtml {
  const card = (r: PanelRow) => contactCard(r, client, now, undefined, r.contact.id === opts.movedId);
  const empty = opts.whatsappOff
    ? html`<p class="empty">Conecte o WhatsApp para começar. Os contatos só chegam depois da conexão. <a href="/painel/whatsapp">Conectar agora</a></p>`
    : opts.firstRun
      ? html`<p class="empty">Nenhum contato ainda. Quando alguém clicar no anúncio e chamar no WhatsApp, ele aparece aqui. Marcar Vendeu ou Não comprou é o que devolve as vendas ao Google Ads.</p>`
      : html`<p class="empty">Tudo marcado. Novos contatos do WhatsApp aparecem aqui.</p>`;
  return html`<div id="painel-lista">
    <h2 class="section-title">Para marcar <span class="count">${data.pendentes.length}</span></h2>
    ${data.pendentes.length ? html`<div class="stack">${data.pendentes.map(card)}</div>` : empty}
    ${data.resolvidos.length
      ? html`<h2 class="section-title">Marcados hoje <span class="count">${data.resolvidos.length}</span></h2>
          <ol class="ledger">${data.resolvidos.map((r) => ledgerRow(r, client, undefined, r.contact.id === opts.movedId))}${dayTotal(data.resolvidos, client)}</ol>`
      : ''}
  </div>`;
}

/**
 * Toast the mark actions report into: fixed on screen so it is seen from anywhere in a long list,
 * swapped out of band after each mark. Marks carry an undo for the contact that just moved.
 */
export function avisoRegion(message?: string, fresh = false, undoContactId?: number): SafeHtml {
  const undo = undoContactId
    ? html` <form method="post" action="/painel/contatos/${undoContactId}/reabrir" hx-post="/painel/contatos/${undoContactId}/reabrir" class="inline"><button class="btn-link aviso-undo" type="submit">Desfazer</button></form>`
    : '';
  return html`<p id="painel-aviso" class="flash flash-ok aviso" role="status" aria-live="polite" tabindex="-1" data-fresh="${fresh ? '1' : '0'}"${message ? '' : ' hidden'}>${message ?? ''}${message ? undo : ''}</p>`;
}

/** Chip in the header: the whole product stops working silently if this connection drops. */
function connectionChip(client: Client, status?: SessionStatus): SafeHtml | '' {
  if (client.whatsappMode !== 'baileys' || !status) return '';
  switch (status.state) {
    case 'conectado':
      return html`<a class="chip chip-ok" href="/painel/whatsapp">WhatsApp conectado</a>`;
    case 'conectando':
    case 'reconectando':
    case 'aguardando_qr':
      return html`<a class="chip chip-warn" href="/painel/whatsapp">WhatsApp conectando…</a>`;
    default:
      return html`<a class="chip chip-error" href="/painel/whatsapp">WhatsApp desconectado</a>`;
  }
}

export function panelPage(
  data: PanelData,
  client: Client,
  now: number,
  status?: SessionStatus,
  hasContacts = true,
): SafeHtml {
  const off = client.whatsappMode === 'baileys' && !!status && status.state !== 'conectado';
  return html`<section>
    <div class="page-head">
      <h1>${client.name}</h1>
      <p class="muted">${formatDateBr(localDate(now, client.timezone))}</p>
      ${connectionChip(client, status)}
    </div>
    ${off
      ? html`<p class="flash flash-erro" role="alert">O WhatsApp está desconectado, então novos contatos não chegam. <a href="/painel/whatsapp">Conectar o WhatsApp</a></p>`
      : ''}
    ${avisoRegion()}
    ${contactLists(data, client, now, { whatsappOff: off, firstRun: !hasContacts })}
  </section>`;
}
