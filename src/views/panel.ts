import type { Client } from '../db/schema.js';
import { formatMoney, formatPhone } from '../lib/format.js';
import { html, SafeHtml } from '../lib/html.js';
import { addDays, localDate, localTime, formatDateBr } from '../lib/time.js';
import { OPEN_WINDOW_MS, PAGE_SIZE, PAGE_SIZES, type PanelRow } from '../services/panel.js';
import { DAY_MS } from '../lib/time.js';
import type { HealthReason } from '../services/connectionHealth.js';
import type { SessionStatus } from '../services/whatsappSessions.js';
import { ORIGENS, type Origem } from '../db/schema.js';
import { ORIGEM_LABEL, ORIGENS_MANUAIS } from './labels.js';

const MESES = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];

/** "Hoje, às 14:30", "Ontem, às …", "Anteontem, às …", then "Dia 12 de março, às …". */
function when(ts: number, client: Client, now: number): string {
  const day = localDate(ts, client.timezone);
  const today = localDate(now, client.timezone);
  const time = localTime(ts, client.timezone);
  if (day === today) return `Hoje, às ${time}`;
  if (day === addDays(today, -1)) return `Ontem, às ${time}`;
  if (day === addDays(today, -2)) return `Anteontem, às ${time}`;
  const [, m, d] = day.split('-');
  return `Dia ${Number(d)} de ${MESES[Number(m) - 1]}, às ${time}`;
}

function hx(action: string, id: number) {
  return html`method="post" action="${action}" hx-post="${action}" hx-target="#contato-${id}" hx-swap="outerHTML"`;
}

/** Open contacts leave the list after OPEN_WINDOW_MS; say so before a forgotten one is lost. */
function expiry(lastMessageAt: number, now: number): SafeHtml | '' {
  const left = lastMessageAt + OPEN_WINDOW_MS - now;
  // Already past the window: it only shows up under a date filter, where the warning would be a lie.
  if (left <= 0 || left > 2 * DAY_MS) return '';
  const label = left < DAY_MS ? 'Sai da lista hoje' : `Sai da lista em ${Math.ceil(left / DAY_MS)} dias`;
  return html` · <span class="expiry">${label}</span>`;
}

/** Sidebar of the store panel. */
export function panelNav(active: 'contatos' | 'whatsapp'): SafeHtml {
  const link = (key: typeof active, href: string, label: string) =>
    html`<a class="side-link${key === active ? ' active' : ''}" href="${href}"${key === active ? html` aria-current="page"` : ''}>${label}</a>`;
  return html`<nav class="side-nav" aria-label="Painel">
    ${link('contatos', '/painel', 'Contatos')}
    ${link('whatsapp', '/painel/whatsapp', 'WhatsApp')}
  </nav>`;
}

export function contactCard(row: PanelRow, client: Client, now: number, error?: string, moved = false): SafeHtml {
  const { contact: c, lastSale } = row;
  const base = `/painel/contatos/${c.id}`;
  const title = c.name ?? formatPhone(c.phone);

  let actions: SafeHtml;
  // "orcamento" is still undecided: same card, minus the button that put it there.
  if (c.status === 'aberto' || c.status === 'orcamento') {
    actions = html`<div class="actions">
      <button class="btn btn-primary" type="button" data-modal-open="venda-modal-${c.id}">Vendeu</button>
      <dialog class="modal" id="venda-modal-${c.id}" aria-labelledby="venda-title-${c.id}"${error ? ' data-autoopen' : ''}>
        <form ${hx(`${base}/venda`, c.id)} class="sale-form">
          <h3 id="venda-title-${c.id}">Registrar venda</h3>
          ${error ? html`<p class="flash flash-erro" role="alert">${error}</p>` : ''}
          <label for="valor-${c.id}">Valor da venda${c.name ? ` para ${c.name}` : ''}</label>
          <span class="money"><span class="money-sign" aria-hidden="true">R$</span><input id="valor-${c.id}" name="valor" inputmode="decimal" autocomplete="off" placeholder="0,00" required></span>
          <div class="modal-actions">
            <button class="btn btn-secondary" type="button" data-modal-close>Cancelar</button>
            <button class="btn btn-primary" type="submit">Confirmar</button>
          </div>
        </form>
      </dialog>
      ${c.status === 'aberto'
        ? html`<form ${hx(`${base}/orcamento`, c.id)}>
            <button class="btn btn-secondary" type="submit">Orçamento</button>
          </form>`
        : ''}
      <form ${hx(`${base}/nao-comprou`, c.id)}>
        <button class="btn btn-secondary" type="submit">Não comprou</button>
      </form>
      ${c.status === 'orcamento'
        ? html`<form ${hx(`${base}/reabrir`, c.id)} class="inline"><button class="btn-link" type="submit">Tirar do orçamento</button></form>`
        : ''}
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
    : html`<button class="btn-link origem-open" type="button" data-modal-open="origem-modal-${c.id}">Alterar origem</button>
      <dialog class="modal" id="origem-modal-${c.id}" aria-labelledby="origem-title-${c.id}">
        <form ${hx(`${base}/origem`, c.id)} hx-trigger="change" class="origem">
          <h3 id="origem-title-${c.id}">Alterar origem</h3>
          <label for="origem-${c.id}">Como conheceu ${title}?</label>
          <select id="origem-${c.id}" name="origem">
            ${ORIGENS_MANUAIS.map(
              (o) => html`<option value="${o}"${o === c.origem ? ' selected' : ''}>${ORIGEM_LABEL[o]}</option>`,
            )}
          </select>
          <div class="modal-actions">
            <noscript><button class="btn btn-primary" type="submit">Salvar</button></noscript>
            <button class="btn btn-secondary" type="button" data-modal-close>Cancelar</button>
          </div>
        </form>
      </dialog>`;

  const arrived = `${when(c.firstMessageAt, client, now)}${c.lastMessageAt - c.firstMessageAt > 60_000 ? ` · última: ${when(c.lastMessageAt, client, now).toLowerCase()}` : ''}`;
  // A quote restarts the 7-day window, so it is the mark — not the last message — that dates it.
  const quote =
    c.status === 'orcamento'
      ? html` · <span class="badge badge-orcamento">Orçamento ${when(c.statusAt, client, now).toLowerCase()}</span>`
      : '';
  const alive = c.status === 'orcamento' ? Math.max(c.lastMessageAt, c.statusAt) : c.lastMessageAt;
  return html`<tr class="contact-row${moved ? ' moved' : ''}" id="contato-${c.id}">
    <td data-label="Contato">
      <strong>${title}</strong>
      ${c.name ? html`<a class="muted phone" href="https://wa.me/${c.phone.slice(1)}">${formatPhone(c.phone)}</a>` : ''}
    </td>
    <td data-label="Origem"><span class="badge badge-${c.origem}">${ORIGEM_LABEL[c.origem]}</span>${origem}</td>
    <td data-label="Data de contato" class="meta">${arrived}${quote}${expiry(alive, now)}</td>
    <td data-label="Ação">
      ${actions}
    </td>
  </tr>`;
}

export type PanelData = { pendentes: PanelRow[]; orcamentos: PanelRow[]; resolvidos: PanelRow[]; total: number; page: number; pages: number; size: number; q: string; origem: Origem | ''; de: string; ate: string };

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

function dayTotal(resolvidos: PanelRow[], client: Client, periodo = false): SafeHtml | '' {
  const sold = resolvidos.filter((r) => r.contact.status === 'vendeu' && r.lastSale);
  if (!sold.length) return '';
  const total = sold.reduce((sum, r) => sum + r.lastSale!.valorCentavos, 0);
  return html`<li class="ledger-total"><span>Total do ${periodo ? 'período' : 'dia'} · ${sold.length} ${sold.length === 1 ? 'venda' : 'vendas'}</span><strong class="num">${formatMoney(total, client.currency)}</strong></li>`;
}

/** "de 01/11/2026 a 05/11/2026", or an open end when only one of the dates is set. */
function periodLabel(data: Pick<PanelData, 'de' | 'ate'>): string {
  if (data.de && data.ate) return data.de === data.ate ? `de ${formatDateBr(data.de)}` : `de ${formatDateBr(data.de)} a ${formatDateBr(data.ate)}`;
  if (data.de) return `a partir de ${formatDateBr(data.de)}`;
  if (data.ate) return `até ${formatDateBr(data.ate)}`;
  return '';
}

function listHref(data: PanelData, page: number): string {
  const params = new URLSearchParams();
  if (data.q) params.set('q', data.q);
  if (data.origem) params.set('origem', data.origem);
  if (data.de) params.set('de', data.de);
  if (data.ate) params.set('ate', data.ate);
  if (page > 1) params.set('pagina', String(page));
  if (data.size !== PAGE_SIZE) params.set('por', String(data.size));
  const qs = params.toString();
  return `/painel${qs ? `?${qs}` : ''}`;
}

const PAGER_ICONS = {
  first: '<path d="M7 5v14"/><path d="m18 6-6 6 6 6"/>',
  prev: '<path d="m15 18-6-6 6-6"/>',
  next: '<path d="m9 18 6-6-6-6"/>',
  last: '<path d="M17 5v14"/><path d="m6 6 6 6-6 6"/>',
} as const;

function pagerButton(kind: keyof typeof PAGER_ICONS, label: string, href: string | null): SafeHtml {
  const icon = html`<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${new SafeHtml(PAGER_ICONS[kind])}</svg>`;
  return href
    ? html`<a class="btn btn-secondary btn-icon" href="${href}" aria-label="${label}" title="${label}">${icon}</a>`
    : html`<span class="btn btn-secondary btn-icon" aria-disabled="true" role="link" aria-label="${label}" title="${label}">${icon}</span>`;
}

/** Page-size picker and first / previous / next / last buttons; shown whenever there is anything to page. */
function pagination(data: PanelData): SafeHtml | '' {
  if (data.total <= PAGE_SIZE) return '';
  const { page, pages } = data;
  const from = (page - 1) * data.size + 1;
  const to = Math.min(page * data.size, data.total);
  return html`<div class="pager">
    <form class="pager-size" method="get" action="/painel">
      ${data.q ? html`<input type="hidden" name="q" value="${data.q}">` : ''}
      ${data.origem ? html`<input type="hidden" name="origem" value="${data.origem}">` : ''}
      ${data.de ? html`<input type="hidden" name="de" value="${data.de}">` : ''}
      ${data.ate ? html`<input type="hidden" name="ate" value="${data.ate}">` : ''}
      <label for="por">Por página</label>
      <select id="por" name="por" data-autosubmit>
        ${PAGE_SIZES.map((n) => html`<option value="${n}"${n === data.size ? ' selected' : ''}>${n}</option>`)}
      </select>
      <noscript><button class="btn btn-secondary" type="submit">OK</button></noscript>
    </form>
    <span class="pager-range muted">${from}–${to} de ${data.total}</span>
    <nav class="pager-nav" aria-label="Paginação">
      ${pagerButton('first', 'Primeira página', page > 1 ? listHref(data, 1) : null)}
      ${pagerButton('prev', 'Página anterior', page > 1 ? listHref(data, page - 1) : null)}
      <span class="pager-page muted">${page} / ${pages}</span>
      ${pagerButton('next', 'Próxima página', page < pages ? listHref(data, page + 1) : null)}
      ${pagerButton('last', 'Última página', page < pages ? listHref(data, pages) : null)}
    </nav>
  </div>`;
}

/** The lists share one swap target so a mark moves the contact and refreshes every count. */
export function contactLists(
  data: PanelData,
  client: Client,
  now: number,
  opts: { movedId?: number; whatsappOff?: boolean; firstRun?: boolean } = {},
): SafeHtml {
  const card = (r: PanelRow) => contactCard(r, client, now, undefined, r.contact.id === opts.movedId);
  const criteria = html`${data.q ? html` para “${data.q}”` : ''}${data.origem ? html` com origem ${ORIGEM_LABEL[data.origem]}` : ''}${periodLabel(data) ? html` ${periodLabel(data)}` : ''}`;
  const periodo = !!(data.de || data.ate);
  const marcados = periodo ? 'Marcados' : 'Marcados hoje';
  const elsewhere = data.orcamentos.length
    ? data.resolvidos.length
      ? `“Orçamentos” e “${marcados}”`
      : '“Orçamentos”'
    : data.resolvidos.length
      ? `“${marcados}”`
      : '';
  const empty = data.q || data.origem || periodo
    ? // The same search runs over the other lists; say where the match is instead of "nothing found".
      elsewhere
      ? html`<p class="empty">Nenhum contato em aberto${criteria}. O resultado está em ${elsewhere}.</p>`
      : html`<p class="empty">Nenhum contato encontrado${criteria}.</p>`
    : opts.whatsappOff
    ? html`<p class="empty">Conecte o WhatsApp para começar. Os contatos só chegam depois da conexão.</p>`
    : opts.firstRun
      ? html`<p class="empty">Nenhum contato ainda. Quando alguém clicar no anúncio e chamar no WhatsApp, ele aparece aqui. Marcar Vendeu ou Não comprou é o que devolve as vendas ao Google Ads.</p>`
      : html`<p class="empty">Tudo marcado. Novos contatos do WhatsApp aparecem aqui.</p>`;
  return html`<div id="painel-lista">
    <h2 class="section-title">Contatos <span class="count">${data.total}</span></h2>
    ${periodo ? html`<p class="muted small">Contatos ${periodLabel(data)}, pela data do primeiro contato. <a class="btn-link" href="/painel">Voltar para hoje</a></p>` : ''}
    ${data.pendentes.length ? html`<table class="contacts">
      <thead><tr><th scope="col">Contato</th><th scope="col">Origem</th><th scope="col">Data de contato</th><th scope="col"><span class="sr-only">Ação</span></th></tr></thead>
      <tbody>${data.pendentes.map(card)}</tbody>
    </table>${pagination(data)}` : empty}
    ${data.orcamentos.length
      ? html`<h2 class="section-title">Orçamentos <span class="count">${data.orcamentos.length}</span></h2>
          <p class="muted small">Esperando resposta. Ainda precisam de Vendeu ou Não comprou.</p>
          <table class="contacts">
            <thead><tr><th scope="col">Contato</th><th scope="col">Origem</th><th scope="col">Data de contato</th><th scope="col"><span class="sr-only">Ação</span></th></tr></thead>
            <tbody>${data.orcamentos.map(card)}</tbody>
          </table>`
      : ''}
    ${data.resolvidos.length
      ? html`<h2 class="section-title">${marcados} <span class="count">${data.resolvidos.length}</span></h2>
          <ol class="ledger">${data.resolvidos.map((r) => ledgerRow(r, client, undefined, r.contact.id === opts.movedId))}${dayTotal(data.resolvidos, client, periodo)}</ol>`
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
function connectionChip(client: Client, status?: SessionStatus, health?: HealthReason[]): SafeHtml | '' {
  if (client.whatsappMode !== 'baileys' || !status) return '';
  switch (status.state) {
    case 'conectado':
      if (health?.length) return html`<span class="chip chip-warn">WhatsApp sem receber? Confira</span>`;
      return html`<span class="chip chip-ok">WhatsApp conectado</span>`;
    case 'conectando':
    case 'reconectando':
    case 'aguardando_qr':
      return html`<span class="chip chip-warn">WhatsApp conectando…</span>`;
    default:
      return html`<span class="chip chip-error">WhatsApp desconectado</span>`;
  }
}

/** Ready-made periods, so seeing an earlier day is one tap and not two date pickers. */
function periodShortcuts(data: PanelData, today: string): SafeHtml {
  const options: { label: string; de: string; ate: string }[] = [
    { label: 'Hoje', de: '', ate: '' },
    { label: 'Ontem', de: addDays(today, -1), ate: addDays(today, -1) },
    { label: '7 dias', de: addDays(today, -6), ate: today },
    { label: '30 dias', de: addDays(today, -29), ate: today },
  ];
  return html`${options.map((o) => {
    const active = data.de === o.de && data.ate === o.ate;
    const params = new URLSearchParams();
    if (data.q) params.set('q', data.q);
    if (data.origem) params.set('origem', data.origem);
    if (data.size !== PAGE_SIZE) params.set('por', String(data.size));
    if (o.de) params.set('de', o.de);
    if (o.ate) params.set('ate', o.ate);
    const qs = params.toString();
    return html`<a class="period-link${active ? ' active' : ''}" href="/painel${qs ? `?${qs}` : ''}"${active ? html` aria-current="true"` : ''}>${o.label}</a>`;
  })}`;
}

export function panelPage(
  data: PanelData,
  client: Client,
  now: number,
  status?: SessionStatus,
  hasContacts = true,
  health?: HealthReason[],
): SafeHtml {
  const today = localDate(now, client.timezone);
  const off = client.whatsappMode === 'baileys' && !!status && status.state !== 'conectado';
  // While (re)connecting the chip already says so; the "disconnected" alert would be wrong.
  const connecting = status?.state === 'conectando' || status?.state === 'reconectando' || status?.state === 'aguardando_qr';
  return html`<section class="panel-col">
    <div class="page-head">
      <h1>${client.name}</h1>
      <p class="muted">${formatDateBr(localDate(now, client.timezone))}</p>
      ${connectionChip(client, status, health)}
    </div>
    ${off && !connecting
      ? html`<p class="flash flash-erro" role="alert">WhatsApp desconectado. Conecte para receber novos contatos</p>`
      : ''}
    <form class="search" method="get" action="/painel" role="search">
      <label class="sr-only" for="busca">Pesquisar contatos</label>
      <input id="busca" type="search" name="q" value="${data.q}" placeholder="Pesquisar por nome ou telefone" autocomplete="off">
      <label class="sr-only" for="filtro-origem">Filtrar por origem</label>
      <select id="filtro-origem" name="origem" data-autosubmit>
        <option value="">Todas as origens</option>
        ${ORIGENS.map((o) => html`<option value="${o}"${o === data.origem ? ' selected' : ''}>${ORIGEM_LABEL[o]}</option>`)}
      </select>
      <button class="btn btn-secondary btn-icon" type="submit" aria-label="Pesquisar" title="Pesquisar"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg></button>
      ${data.size !== PAGE_SIZE ? html`<input type="hidden" name="por" value="${data.size}">` : ''}
      ${data.q || data.origem || data.de || data.ate ? html`<a class="btn-link" href="/painel">Limpar</a>` : ''}
      <div class="search-period">
        <label for="de">De</label>
        <input id="de" type="date" name="de" value="${data.de}" max="${today}">
        <label for="ate">até</label>
        <input id="ate" type="date" name="ate" value="${data.ate}" max="${today}">
      </div>
    </form>
    <nav class="period-shortcuts" aria-label="Período">
      ${periodShortcuts(data, today)}
    </nav>
    ${avisoRegion()}
    ${contactLists(data, client, now, { whatsappOff: off, firstRun: !hasContacts })}
  </section>`;
}
