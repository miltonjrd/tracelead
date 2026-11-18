import { html, SafeHtml } from '../lib/html.js';
import { flash } from './layout.js';
import { MAX_STAGES, MAX_STAGE_NAME, TEMPLATE_STAGES, type StageWithCount } from '../services/funnel.js';

const ARROW_UP = '<path d="m18 15-6-6-6 6"/>';
const ARROW_DOWN = '<path d="m6 9 6 6 6-6"/>';

function icon(path: string): SafeHtml {
  return html`<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${new SafeHtml(path)}</svg>`;
}

function stageRow(s: StageWithCount, index: number, total: number, error?: { id: number; message: string }): SafeHtml {
  const base = `/painel/funil/${s.id}`;
  const mine = error?.id === s.id ? error.message : undefined;
  return html`<li class="stage-row" id="etapa-${s.id}">
    <form method="post" action="${base}/renomear" class="stage-name">
      <label class="sr-only" for="nome-${s.id}">Nome da etapa ${index + 1}</label>
      <input id="nome-${s.id}" name="nome" value="${s.name}" maxlength="${MAX_STAGE_NAME}" required>
      <button class="btn btn-secondary" type="submit">Salvar</button>
    </form>
    <a class="stage-count muted" href="/painel?etapa=${s.id}">${s.contacts} ${s.contacts === 1 ? 'contato' : 'contatos'}</a>
    <div class="stage-actions">
      <form method="post" action="${base}/subir"><button class="btn btn-secondary btn-icon" type="submit" aria-label="Mover ${s.name} para cima" title="Mover para cima"${index === 0 ? ' disabled' : ''}>${icon(ARROW_UP)}</button></form>
      <form method="post" action="${base}/descer"><button class="btn btn-secondary btn-icon" type="submit" aria-label="Mover ${s.name} para baixo" title="Mover para baixo"${index === total - 1 ? ' disabled' : ''}>${icon(ARROW_DOWN)}</button></form>
      <form method="post" action="${base}/excluir"><button class="btn-link" type="submit" data-confirm="${s.contacts ? `Excluir a etapa “${s.name}”? Os ${s.contacts} contatos continuam no sistema, só ficam sem etapa.` : `Excluir a etapa “${s.name}”?`}">Excluir</button></form>
    </div>
    ${mine ? html`<p class="flash flash-erro stage-error" role="alert">${mine}</p>` : ''}
  </li>`;
}

export function funnelPage(
  stages: StageWithCount[],
  opts: { error?: { id: number; message: string }; formError?: string; ok?: string; draft?: string } = {},
): SafeHtml {
  return html`<section class="panel-col">
    <div class="page-head"><h1>Funil</h1></div>
    <p class="muted">Crie as etapas do seu atendimento, na ordem em que o contato avança. Depois, escolha a etapa de cada contato na lista de Contatos. O funil é só para você se organizar e não muda o que é enviado ao Google Ads.</p>
    ${flash('ok', opts.ok)}
    ${flash('erro', opts.formError)}
    <form method="post" action="/painel/funil" class="stage-add">
      <label for="nova-etapa">Nova etapa</label>
      <div class="stage-add-row">
        <input id="nova-etapa" name="nome" value="${opts.draft ?? ''}" maxlength="${MAX_STAGE_NAME}" placeholder="Ex.: Visita agendada" autocomplete="off" required${stages.length >= MAX_STAGES ? ' disabled' : ''}>
        <button class="btn btn-primary" type="submit"${stages.length >= MAX_STAGES ? ' disabled' : ''}>Adicionar</button>
      </div>
    </form>
    ${stages.length
      ? html`<h2 class="section-title">Etapas <span class="count">${stages.length}</span></h2>
        <ol class="stage-list">${stages.map((s, i) => stageRow(s, i, stages.length, opts.error))}</ol>`
      : html`<p class="empty">Nenhuma etapa ainda. Adicione a primeira acima ou comece com um modelo (${TEMPLATE_STAGES.join(', ')}) e ajuste do seu jeito.</p>
        <form method="post" action="/painel/funil/modelo"><button class="btn btn-secondary" type="submit">Usar modelo sugerido</button></form>`}
  </section>`;
}
