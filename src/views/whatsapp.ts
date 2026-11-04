import type { Client } from '../db/schema.js';
import { formatPhone } from '../lib/format.js';
import { html, SafeHtml } from '../lib/html.js';
import type { HealthReason } from '../services/connectionHealth.js';
import type { SessionStatus } from '../services/whatsappSessions.js';
import { flash } from './layout.js';

const POLL_STATES = new Set<SessionStatus['state']>(['conectando', 'aguardando_qr', 'reconectando']);

/** Explains why a "connected" WhatsApp looks deaf, and what to do about it. */
export function healthNote(reasons: HealthReason[] | undefined): SafeHtml | '' {
  if (!reasons?.length) return '';
  const lines = reasons.map((r) =>
    r.kind === 'silencio'
      ? html`<li>Nenhuma mensagem chegou há ${r.hours} h, mas houve ${r.clicks} ${r.clicks === 1 ? 'clique' : 'cliques'} no WhatsApp nesse período.</li>`
      : html`<li>${r.clicks} cliques no WhatsApp nas últimas 24 h e nenhuma mensagem recebida.</li>`,
  );
  return html`<div class="flash flash-erro" role="alert"><strong>Confira a conexão.</strong> O WhatsApp aparece como conectado, mas pode ter parado de receber.
    <ul>${lines}</ul>
    Se alguém já mandou mensagem e ela não apareceu, desconecte e conecte de novo escaneando o QR code.</div>`;
}

function connectButton(label: string): SafeHtml {
  return html`<form method="post" action="/painel/whatsapp/conectar" hx-post="/painel/whatsapp/conectar" hx-target="#wa-status" hx-swap="outerHTML">
    <button class="btn btn-primary" type="submit">${label}</button>
  </form>`;
}

/** Fragment HTMX swaps in place: refreshes itself every 2 s while a connection is in progress. */
export function whatsappStatus(client: Client, status: SessionStatus, qrSvg?: string, error?: string, health?: HealthReason[]): SafeHtml {
  const poll = POLL_STATES.has(status.state)
    ? html` hx-get="/painel/whatsapp/estado" hx-trigger="every 2s" hx-swap="outerHTML"`
    : '';

  let body: SafeHtml;
  if (client.whatsappMode === 'cloud') {
    body = html`<p>Este cliente usa a Cloud API da Meta, configurada pelo gestor. Não há nada para conectar aqui.</p>`;
  } else {
    switch (status.state) {
      case 'conectado':
        body = html`${healthNote(health)}<p><span class="badge badge-ok">Conectado</span> ${status.phone ? formatPhone(status.phone) : ''}</p>
          <form method="post" action="/painel/whatsapp/desconectar" hx-post="/painel/whatsapp/desconectar" hx-target="#wa-status" hx-swap="outerHTML" hx-confirm="Desconectar o WhatsApp? Novos contatos deixam de chegar.">
            <button class="btn btn-secondary" type="submit">Desconectar</button>
          </form>`;
        break;
      case 'aguardando_qr':
        body = html`<p>No celular, abra o WhatsApp, vá em <strong>Aparelhos conectados</strong>, toque em <strong>Conectar um aparelho</strong> e aponte a câmera para o código.</p>
          <p class="qr-hint">Está lendo isto no celular? Abra este painel no computador ou em outro celular para escanear o código com a câmera do WhatsApp.</p>
          <div class="qr" role="img" aria-label="QR code para conectar o WhatsApp">${qrSvg ? new SafeHtml(qrSvg) : ''}</div>`;
        break;
      case 'conectando':
        body = html`<p>Conectando…</p>`;
        break;
      case 'reconectando':
        body = html`<p><span class="badge badge-warn">Reconectando…</span> Tentativa ${status.attempt}.</p>`;
        break;
      case 'qr_expirado':
        body = html`<p>QR expirado.</p>${connectButton('Gerar novo QR')}`;
        break;
      case 'desconectado_logout':
        body = html`<p><span class="badge badge-error">Desconectado</span> Escaneie o QR code para conectar de novo.</p>${connectButton('Conectar WhatsApp')}`;
        break;
      case 'substituida':
        body = html`<p><span class="badge badge-error">Aberto em outro lugar</span> Este WhatsApp foi aberto em outro servidor e a conexão aqui foi encerrada. Novos contatos não chegam até você reconectar.</p>${connectButton('Reconectar WhatsApp')}`;
        break;
      default:
        body = html`<p><span class="badge badge-error">Desconectado</span> O WhatsApp ainda não está conectado.</p>${connectButton('Conectar WhatsApp')}`;
    }
  }

  return html`<div id="wa-status"${poll}>${flash('erro', error)}${body}</div>`;
}

export function whatsappPage(client: Client, status: SessionStatus, qrSvg?: string, health?: HealthReason[]): SafeHtml {
  return html`<section class="card">
    <div class="page-head">
      <h1>WhatsApp</h1>
      <a class="btn-link" href="/painel">Contatos</a>
    </div>
    ${whatsappStatus(client, status, qrSvg, undefined, health)}
  </section>`;
}
