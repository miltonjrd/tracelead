import type { Client, Contact, Sale } from '../db/schema.js';
import { centsToInput, formatMoney, formatPhone } from '../lib/format.js';
import { html, type SafeHtml } from '../lib/html.js';
import { addDays, formatDateBr, localDateTime } from '../lib/time.js';
import type { WeeklyReport } from '../services/report.js';
import type { SessionStatus } from '../services/whatsappSessions.js';
import { ORIGEM_LABEL } from './labels.js';
import { ORIGENS } from '../db/schema.js';

type Section = 'relatorio' | 'contatos' | 'vendas' | 'exportacoes' | 'sistema';

const SECTIONS: [Section, string, string][] = [
  ['relatorio', 'Relatório', ''],
  ['contatos', 'Contatos', '/contatos'],
  ['vendas', 'Vendas', '/vendas'],
  ['exportacoes', 'Exportações', '/exportacoes'],
  ['sistema', 'Sistema', '/sistema'],
];

export function adminNav(client: Client, active: Section, clientCount: number): SafeHtml {
  return html`<nav class="side-nav" aria-label="Admin">
      ${clientCount > 1 ? html`<a class="side-link" href="/admin?todos=1">Clientes</a>` : ''}
      ${SECTIONS.map(
        ([key, label, path]) =>
          html`<a class="side-link${key === active ? ' active' : ''}" href="/admin/c/${client.id}${path}"${key === active ? html` aria-current="page"` : ''}>${label}</a>`,
      )}
  </nav>`;
}

function dateTime(ts: number, client: Client): string {
  const [d, t] = localDateTime(ts, client.timezone).split(' ');
  return `${formatDateBr(d!)} ${t!.slice(0, 5)}`;
}

function money(micros: number, client: Client): string {
  return formatMoney(Math.round(micros / 10_000), client.currency);
}

function ratio(value: number, cost: number): string {
  return cost > 0 ? `${(value / cost).toFixed(1).replace('.', ',')}×` : '—';
}

function pct(n: number, d: number): string {
  return d > 0 ? `${Math.round((n / d) * 100)}%` : '—';
}

export function clientListPage(list: Client[]): SafeHtml {
  if (!list.length) {
    return html`<div class="page-head"><h1>Nenhum cliente ainda</h1></div>
      <p>Crie o primeiro no servidor:</p>
      <pre class="code">npm run cli -- create-client --name "Nome do cliente"</pre>`;
  }
  return html`<div class="page-head"><h1>Clientes</h1></div>
    <ul class="list">${list.map((c) => html`<li><a href="/admin/c/${c.id}">${c.name}</a></li>`)}</ul>`;
}

export function reportPage(r: WeeklyReport, client: Client, lastSpend: string | null, isCurrentWeek: boolean): SafeHtml {
  const prev = addDays(r.start, -7);
  const next = addDays(r.start, 7);
  const custoConversa = r.totals.conversas && r.totals.costMicros ? money(r.totals.costMicros / r.totals.conversas, client) : '—';
  return html`<div class="page-head">
      <h1>Semana de ${formatDateBr(r.start)} a ${formatDateBr(r.end)}</h1>
      <div class="week-nav">
        <a class="btn btn-secondary btn-small" href="?semana=${prev}">← Anterior</a>
        ${isCurrentWeek ? '' : html`<a class="btn btn-secondary btn-small" href="?semana=${next}">Próxima →</a>`}
      </div>
    </div>
    <p class="muted">${lastSpend ? `Gasto sincronizado até ${formatDateBr(lastSpend)}.` : 'Gasto ainda não sincronizado com o Google Ads (veja Sistema).'}</p>

    <div class="tiles">
      <div class="tile"><span class="tile-label">Gasto</span><span class="tile-value">${money(r.totals.costMicros, client)}</span></div>
      <div class="tile"><span class="tile-label">Conversas</span><span class="tile-value">${r.totals.conversas}</span></div>
      <div class="tile"><span class="tile-label">Vendas</span><span class="tile-value">${r.totals.vendas}</span></div>
      <div class="tile"><span class="tile-label">Valor vendido</span><span class="tile-value">${formatMoney(r.totals.valorCentavos, client.currency)}</span></div>
      <div class="tile"><span class="tile-label">Retorno dos anúncios</span><span class="tile-value">${ratio(r.totals.valorAnuncioCentavos * 10_000, r.totals.costMicros)}</span></div>
      <div class="tile"><span class="tile-label">Custo por conversa</span><span class="tile-value">${custoConversa}</span></div>
    </div>

    <h2 class="section-title">Por campanha</h2>
    ${r.campaigns.length
      ? html`<div class="table-wrap"><table>
          <thead><tr><th>Campanha</th><th class="num">Gasto</th><th class="num">Cliques</th><th class="num">Conversas</th><th class="num">Vendas</th><th class="num">Valor</th><th class="num">Retorno</th></tr></thead>
          <tbody>${r.campaigns.map(
            (c) => html`<tr>
              <td>${c.name}</td>
              <td class="num">${money(c.costMicros, client)}</td>
              <td class="num">${c.adClicks}</td>
              <td class="num">${c.conversas}</td>
              <td class="num">${c.vendas}</td>
              <td class="num">${formatMoney(c.valorCentavos, client.currency)}</td>
              <td class="num">${ratio(c.valorCentavos * 10_000, c.costMicros)}</td>
            </tr>`,
          )}</tbody>
        </table></div>`
      : html`<p class="empty">Sem gasto nem conversas de anúncio nesta semana.</p>`}
    <p class="muted small">Retorno = valor vendido ÷ gasto. Conversas contam pela data da primeira mensagem; vendas, pela data em que foram marcadas.</p>

    <h2 class="section-title">Por origem</h2>
    ${r.origens.length
      ? html`<div class="table-wrap"><table>
          <thead><tr><th>Origem</th><th class="num">Conversas</th><th class="num">Vendas</th><th class="num">Valor</th></tr></thead>
          <tbody>${r.origens.map(
            (o) => html`<tr><td>${ORIGEM_LABEL[o.origem]}</td><td class="num">${o.conversas}</td><td class="num">${o.vendas}</td><td class="num">${formatMoney(o.valorCentavos, client.currency)}</td></tr>`,
          )}</tbody>
        </table></div>`
      : html`<p class="empty">Nenhuma conversa nesta semana.</p>`}

    <h2 class="section-title">Saúde do rastreio</h2>
    <dl class="facts">
      <div><dt>Cliques no botão do WhatsApp</dt><dd>${r.botaoCliques}</dd></div>
      <div><dt>Conversas ligadas a um clique</dt><dd>${r.conversasRastreadas} (${pct(r.conversasRastreadas, r.totals.conversas)} das conversas)</dd></div>
      <div><dt>Cliques que viraram conversa</dt><dd>${pct(r.conversasRastreadas, r.botaoCliques)}</dd></div>
      <div><dt>Contatos de dias anteriores ainda sem marcação</dt><dd>${r.pendentesMarcacao}</dd></div>
    </dl>`;
}

export function contactsPage(
  rows: { contact: Contact; gclid: string | null }[],
  client: Client,
  filtro: 'desconhecida' | 'todos',
  msg?: SafeHtml | '',
): SafeHtml {
  return html`<div class="page-head">
      <h1>Contatos</h1>
      <div class="segmented">
        <a class="${filtro === 'desconhecida' ? 'active' : ''}" href="?filtro=desconhecida">Sem origem</a>
        <a class="${filtro === 'todos' ? 'active' : ''}" href="?filtro=todos">Todos (60 dias)</a>
      </div>
    </div>
    ${msg ?? ''}
    ${rows.length
      ? html`<div class="table-wrap"><table>
          <thead><tr><th>Contato</th><th>Chegou</th><th>Rastreio</th><th>Status</th><th>Origem</th></tr></thead>
          <tbody>${rows.map(({ contact: c, gclid }) => {
            const action = `/admin/c/${client.id}/contatos/${c.id}/origem`;
            return html`<tr>
              <td><strong>${c.name ?? ''}</strong> <span class="muted nowrap">${formatPhone(c.phone)}</span></td>
              <td>${dateTime(c.firstMessageAt, client)}</td>
              <td>${c.clickId ? (gclid ? 'clique + gclid' : 'clique sem gclid') : '—'}</td>
              <td>${c.status === 'aberto' ? 'Aberto' : c.status === 'vendeu' ? 'Vendeu' : 'Não comprou'}</td>
              <td><form method="post" action="${action}" class="inline">
                <select name="origem" aria-label="Origem">${ORIGENS.map(
                  (o) => html`<option value="${o}"${o === c.origem ? ' selected' : ''}>${ORIGEM_LABEL[o]}</option>`,
                )}</select>
                <button class="btn btn-secondary btn-small" type="submit">Salvar</button>
              </form></td>
            </tr>`;
          })}</tbody>
        </table></div>`
      : html`<p class="empty">${filtro === 'desconhecida' ? 'Nenhum contato sem origem nos últimos 60 dias.' : 'Nenhum contato nos últimos 60 dias.'}</p>`}`;
}

export function salesPage(rows: { sale: Sale; contact: Contact }[], client: Client, msg?: SafeHtml | ''): SafeHtml {
  return html`<div class="page-head"><h1>Vendas (60 dias)</h1></div>
    ${msg ?? ''}
    ${rows.length
      ? html`<div class="stack">${rows.map(({ sale: s, contact: c }) => {
          const [date, time] = localDateTime(s.soldAt, client.timezone).split(' ');
          const base = `/admin/c/${client.id}/vendas/${s.id}`;
          return html`<form method="post" action="${base}" class="card sale-edit">
            <div class="contact-head">
              <strong>${c.name ?? formatPhone(c.phone)}</strong>
              ${s.exportadaEm ? html`<span class="badge badge-warn">Enviada ao Ads em ${dateTime(s.exportadaEm, client)}</span>` : ''}
            </div>
            ${s.exportadaEm ? html`<p class="small muted">Alterar aqui não muda o que já está no Google Ads; corrija lá com um ajuste de conversão.</p>` : ''}
            <div class="grid-form">
              <label>Valor<input name="valor" inputmode="decimal" value="${centsToInput(s.valorCentavos)}" required></label>
              <label>Data<input type="date" name="data" value="${date}" required></label>
              <label>Hora<input type="time" name="hora" value="${time!.slice(0, 5)}" required></label>
              <label>Telefone do contato<input name="telefone" value="${c.phone}" required></label>
            </div>
            <div class="row">
              <button class="btn btn-primary btn-small" type="submit">Salvar</button>
              <button class="btn btn-danger btn-small" type="submit" formaction="${base}/excluir" data-confirm="Excluir esta venda?">Excluir</button>
            </div>
          </form>`;
        })}</div>`
      : html`<p class="empty">Nenhuma venda nos últimos 60 dias.</p>`}`;
}

export function exportsPage(
  stats: { lead: { prontos: number; foraDoPrazo: number }; venda: { prontos: number; foraDoPrazo: number }; anuncioSemIdentificador: number },
  files: { arquivo: string; tipo: 'lead' | 'venda'; linhas: number; valorCentavos: number; exportadoEm: number; importado: number }[],
  client: Client,
  names: { lead: string; venda: string },
  msg?: SafeHtml | '',
): SafeHtml {
  const base = `/admin/c/${client.id}/exportacoes`;
  const box = (tipo: 'lead' | 'venda', title: string) => {
    const s = stats[tipo];
    return html`<form method="post" action="${base}" class="card">
      <h3>${title}</h3>
      <p class="tile-value">${s.prontos}</p>
      <p class="muted small">prontos para enviar como “${tipo === 'lead' ? names.lead : names.venda}”${s.foraDoPrazo ? `; ${s.foraDoPrazo} com clique há mais de 90 dias (o Ads recusa)` : ''}</p>
      <input type="hidden" name="tipo" value="${tipo}">
      <button class="btn btn-primary" type="submit"${s.prontos ? '' : ' disabled'}>Gerar arquivo</button>
    </form>`;
  };
  return html`<div class="page-head"><h1>Exportações para o Google Ads</h1></div>
    ${msg ?? ''}
    <div class="two-col">${box('lead', 'Leads')}${box('venda', 'Vendas')}</div>
    ${stats.anuncioSemIdentificador
      ? html`<p class="muted small">${stats.anuncioSemIdentificador} contato(s) de anúncio chegaram sem identificador de clique (gclid, gbraid ou wbraid). Eles aparecem no relatório, mas não entram no arquivo.</p>`
      : ''}
    <p class="muted small">Gere o arquivo, baixe e envie em Google Ads → Metas → Conversões → Uploads. Depois marque como importado.</p>
    <p class="muted small">Conversões com gbraid ou wbraid exigem que a ação de conversão no Google Ads esteja com a contagem em “Todas”.</p>

    <h2 class="section-title">Arquivos gerados</h2>
    ${files.length
      ? html`<div class="table-wrap"><table>
          <thead><tr><th>Arquivo</th><th>Tipo</th><th class="num">Linhas</th><th class="num">Valor</th><th>Gerado</th><th>Status</th><th></th></tr></thead>
          <tbody>${files.map(
            (f) => html`<tr>
              <td><a href="${base}/${encodeURIComponent(f.arquivo)}">${f.arquivo}</a></td>
              <td>${f.tipo === 'lead' ? 'Lead' : 'Venda'}</td>
              <td class="num">${f.linhas}</td>
              <td class="num">${f.tipo === 'venda' ? formatMoney(f.valorCentavos, client.currency) : '—'}</td>
              <td>${dateTime(f.exportadoEm, client)}</td>
              <td>${f.importado ? 'Importado' : 'Aguardando upload'}</td>
              <td>${f.importado
                ? ''
                : html`<form method="post" action="${base}/${encodeURIComponent(f.arquivo)}/importado" class="inline">
                    <button class="btn btn-secondary btn-small" type="submit">Marcar importado</button>
                  </form>`}</td>
            </tr>`,
          )}</tbody>
        </table></div>`
      : html`<p class="empty">Nenhum arquivo gerado ainda.</p>`}`;
}

interface RunRow {
  status: 'rodando' | 'ok' | 'erro';
  detail: string | null;
  startedAt: number;
}

function runsTable(runs: RunRow[], client: Client): SafeHtml {
  if (!runs.length) return html`<p class="empty">Nunca rodou.</p>`;
  return html`<div class="table-wrap"><table>
    <thead><tr><th>Quando</th><th>Status</th><th>Detalhe</th></tr></thead>
    <tbody>${runs.map(
      (r) => html`<tr>
        <td>${dateTime(r.startedAt, client)}</td>
        <td><span class="badge ${r.status === 'ok' ? 'badge-ok' : r.status === 'erro' ? 'badge-error' : ''}">${r.status}</span></td>
        <td class="small">${r.detail ?? ''}</td>
      </tr>`,
    )}</tbody>
  </table></div>`;
}

function whatsappBaileysCard(base: string, status: SessionStatus): SafeHtml {
  const label: Record<SessionStatus['state'], SafeHtml> = {
    conectado: html`<span class="badge badge-ok">Conectado</span>${status.state === 'conectado' && status.phone ? html` ${formatPhone(status.phone)}` : ''}`,
    conectando: html`<span class="badge badge-warn">Conectando</span>`,
    aguardando_qr: html`<span class="badge badge-warn">Aguardando o QR code ser escaneado</span>`,
    reconectando: html`<span class="badge badge-warn">Reconectando</span>`,
    qr_expirado: html`<span class="badge badge-error">QR expirado</span>`,
    desconectado_logout: html`<span class="badge badge-error">Desconectado pelo celular</span> A loja precisa escanear o QR code de novo.`,
    desconectado: html`<span class="badge badge-error">Desconectado</span>`,
  };
  const canDisconnect = status.state !== 'desconectado' && status.state !== 'desconectado_logout';
  return html`<section class="card">
    <div class="contact-head">
      <h3>WhatsApp (Baileys)</h3>
      ${canDisconnect ? html`<form method="post" action="${base}/whatsapp/desconectar"><button class="btn btn-secondary btn-small" type="submit">Desconectar</button></form>` : ''}
    </div>
    <dl class="facts">
      <div><dt>Conexão</dt><dd>${label[status.state]}</dd></div>
    </dl>
    <p class="small muted">A loja conecta pelo QR code em <code>/painel/whatsapp</code>.</p>
  </section>`;
}

export function systemPage(opts: {
  client: Client;
  baseUrl: string;
  metaConfigured: { appSecret: boolean; verifyToken: boolean };
  googleAdsConfigured: boolean;
  whatsapp: SessionStatus;
  backups: RunRow[];
  spendRuns: RunRow[];
  msg?: SafeHtml | '';
}): SafeHtml {
  const { client, baseUrl } = opts;
  const base = `/admin/c/${client.id}/sistema`;
  const yesNo = (ok: boolean) => (ok ? html`<span class="badge badge-ok">configurado</span>` : html`<span class="badge badge-error">faltando</span>`);
  const snippet = `<script src="${baseUrl}/t.js" data-client="${client.publicKey}" async></script>`;
  return html`<div class="page-head"><h1>Sistema</h1></div>
    ${opts.msg ?? ''}
    <section class="card">
      <h3>Instalação no site</h3>
      <p class="small">Cole antes do <code>&lt;/body&gt;</code> em todas as páginas. O script detecta sozinho os links de WhatsApp (wa.me e api.whatsapp.com). Para mudar a mensagem padrão, adicione <code>data-message="..."</code>.</p>
      <pre class="code">${snippet}</pre>
    </section>

    ${client.whatsappMode === 'cloud'
      ? html`<section class="card">
          <h3>WhatsApp (Cloud API)</h3>
          <dl class="facts">
            <div><dt>URL de callback do webhook</dt><dd><code>${baseUrl}/webhook</code></dd></div>
            <div><dt>Verify token (META_VERIFY_TOKEN)</dt><dd>${yesNo(opts.metaConfigured.verifyToken)}</dd></div>
            <div><dt>App secret (META_APP_SECRET)</dt><dd>${yesNo(opts.metaConfigured.appSecret)}</dd></div>
            <div><dt>Phone number ID deste cliente</dt><dd>${client.whatsappPhoneNumberId ? html`<code>${client.whatsappPhoneNumberId}</code>` : yesNo(false)}</dd></div>
          </dl>
          <p class="small muted">No app da Meta, assine o campo <code>messages</code> do webhook.</p>
        </section>`
      : whatsappBaileysCard(base, opts.whatsapp)}

    <section class="card">
      <div class="contact-head">
        <h3>Gasto do Google Ads</h3>
        <form method="post" action="${base}/gasto"><button class="btn btn-secondary btn-small" type="submit"${opts.googleAdsConfigured && client.googleAdsCustomerId ? '' : ' disabled'}>Sincronizar agora</button></form>
      </div>
      <dl class="facts">
        <div><dt>Credenciais da API (GOOGLE_ADS_*)</dt><dd>${yesNo(opts.googleAdsConfigured)}</dd></div>
        <div><dt>Customer ID deste cliente</dt><dd>${client.googleAdsCustomerId ? html`<code>${client.googleAdsCustomerId}</code>` : yesNo(false)}</dd></div>
      </dl>
      <p class="small muted">Roda todo dia às 6h e relê os últimos 7 dias.</p>
      ${runsTable(opts.spendRuns, client)}
    </section>

    <section class="card">
      <div class="contact-head">
        <h3>Backup do banco</h3>
        <form method="post" action="${base}/backup"><button class="btn btn-secondary btn-small" type="submit">Fazer backup agora</button></form>
      </div>
      <p class="small muted">Roda todo dia às 3h.</p>
      ${runsTable(opts.backups, client)}
    </section>`;
}
