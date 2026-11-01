import { and, desc, eq, gte } from 'drizzle-orm';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { googleAdsConfigured, type Config } from '../config.js';
import type { Db } from '../db/client.js';
import { clicks, clients, contacts, type Client } from '../db/schema.js';
import { parseMoney } from '../lib/format.js';
import type { SafeHtml } from '../lib/html.js';
import { DAY_MS, fromLocal, isIsoDate, localDate, weekStart } from '../lib/time.js';
import { syncAdSpend } from '../jobs/adSpend.js';
import type { FetchLike } from '../jobs/googleAds.js';
import { runBackup } from '../jobs/backup.js';
import { recentRuns, runJob } from '../jobs/runs.js';
import { createExportFile, exportFileCsv, exportStats, listExportFiles, markFileImported } from '../services/exports.js';
import { isOrigem, PanelError, setOrigem } from '../services/panel.js';
import { lastSpendDate, weeklyReport } from '../services/report.js';
import { deleteSale, listSales, updateSale } from '../services/sales.js';
import {
  adminNav,
  clientListPage,
  contactsPage,
  exportsPage,
  reportPage,
  salesPage,
  systemPage,
} from '../views/admin.js';
import type { WhatsAppSessions } from '../services/whatsappSessions.js';
import { flash, page } from '../views/layout.js';
import { requireRole } from './auth.js';

type Section = Parameters<typeof adminNav>[1];
type Req = FastifyRequest<{
  Params: { cid: string; id?: string; arquivo?: string };
  Querystring: Record<string, string | undefined>;
  Body: Record<string, string | undefined>;
}>;

// Fixed texts for ?ok= / ?erro=, so the query string can't inject arbitrary messages.
const MESSAGES: Record<string, string> = {
  origem: 'Origem atualizada.',
  venda: 'Venda atualizada.',
  excluida: 'Venda excluída.',
  arquivo: 'Arquivo gerado. Baixe e envie no Google Ads.',
  vazio: 'Não há nada pronto para exportar.',
  importado: 'Arquivo marcado como importado.',
  job: 'Concluído. Veja o resultado na tabela.',
  jobErro: 'Falhou. Veja o detalhe na tabela.',
  whatsappDesconectado: 'WhatsApp desconectado.',
};

const SIXTY_DAYS = 60 * DAY_MS;

export async function adminRoutes(app: FastifyInstance, opts: { db: Db; config: Config; sessions: WhatsAppSessions; fetchImpl?: FetchLike }) {
  const { db, config, sessions } = opts;
  app.addHook('preHandler', requireRole('admin'));

  async function render(req: Req, reply: FastifyReply, client: Client, section: Section, title: string, body: SafeHtml) {
    const all = await db.select({ id: clients.id }).from(clients);
    return reply
      .type('text/html')
      .send(page({ title, user: req.user, nav: adminNav(client, section, all.length), body }));
  }

  function messages(req: Req): SafeHtml | '' {
    const ok = req.query.ok && MESSAGES[req.query.ok];
    const erro = req.query.erro && MESSAGES[req.query.erro];
    return erro ? flash('erro', erro) : flash('ok', ok);
  }

  async function loadClient(req: Req, reply: FastifyReply): Promise<Client | null> {
    const id = Number(req.params.cid);
    const client = Number.isInteger(id) ? await db.query.clients.findFirst({ where: eq(clients.id, id) }) : undefined;
    if (!client) {
      reply.code(404).type('text/html').send(page({ title: 'Não encontrado', user: req.user, body: clientListPage(await db.select().from(clients)) }));
      return null;
    }
    return client;
  }

  app.get('/admin', async (req: Req, reply) => {
    const list = await db.select().from(clients).orderBy(clients.name);
    if (list.length === 1 && !req.query.todos) return reply.redirect(`/admin/c/${list[0]!.id}`, 303);
    return reply.type('text/html').send(page({ title: 'Clientes', user: req.user, body: clientListPage(list) }));
  });

  app.get('/admin/c/:cid', async (req: Req, reply) => {
    const client = await loadClient(req, reply);
    if (!client) return;
    const today = localDate(Date.now(), client.timezone);
    const current = weekStart(today);
    const start = isIsoDate(req.query.semana) ? weekStart(req.query.semana) : current;
    const report = await weeklyReport(db, client, start > current ? current : start);
    const body = reportPage(report, client, await lastSpendDate(db, client.id), report.start === current);
    return render(req, reply, client, 'relatorio', 'Relatório', body);
  });

  app.get('/admin/c/:cid/contatos', async (req: Req, reply) => {
    const client = await loadClient(req, reply);
    if (!client) return;
    const filtro = req.query.filtro === 'todos' ? 'todos' : 'desconhecida';
    const rows = await db
      .select({ contact: contacts, gclid: clicks.gclid })
      .from(contacts)
      .leftJoin(clicks, eq(clicks.id, contacts.clickId))
      .where(
        and(
          eq(contacts.clientId, client.id),
          gte(contacts.lastMessageAt, Date.now() - SIXTY_DAYS),
          filtro === 'desconhecida' ? eq(contacts.origem, 'desconhecida') : undefined,
        ),
      )
      .orderBy(desc(contacts.firstMessageAt));
    return render(req, reply, client, 'contatos', 'Contatos', contactsPage(rows, client, filtro, messages(req)));
  });

  app.post('/admin/c/:cid/contatos/:id/origem', async (req: Req, reply) => {
    const client = await loadClient(req, reply);
    if (!client) return;
    const origem = req.body?.origem;
    if (!isOrigem(origem)) return reply.code(400).send('Origem inválida');
    await setOrigem(db, client.id, Number(req.params.id), origem, { overrideTracked: true });
    const back = req.headers.referer?.includes('filtro=todos') ? 'todos' : 'desconhecida';
    return reply.redirect(`/admin/c/${client.id}/contatos?filtro=${back}&ok=origem`, 303);
  });

  async function salesView(req: Req, reply: FastifyReply, client: Client, msg: SafeHtml | '') {
    const rows = await listSales(db, client.id, Date.now() - SIXTY_DAYS);
    return render(req, reply, client, 'vendas', 'Vendas', salesPage(rows, client, msg));
  }

  app.get('/admin/c/:cid/vendas', async (req: Req, reply) => {
    const client = await loadClient(req, reply);
    if (!client) return;
    return salesView(req, reply, client, messages(req));
  });

  app.post('/admin/c/:cid/vendas/:id', async (req: Req, reply) => {
    const client = await loadClient(req, reply);
    if (!client) return;
    const b = req.body ?? {};
    const valor = parseMoney(b.valor);
    const validTime = typeof b.hora === 'string' && /^\d{2}:\d{2}$/.test(b.hora);
    try {
      if (valor === null) throw new PanelError('Valor inválido.');
      if (!isIsoDate(b.data) || !validTime) throw new PanelError('Data ou hora inválida.');
      await updateSale(db, client, Number(req.params.id), {
        valorCentavos: valor,
        soldAt: fromLocal(b.data, client.timezone, b.hora),
        phone: b.telefone ?? '',
      });
    } catch (err) {
      if (!(err instanceof PanelError)) throw err;
      reply.code(422);
      return salesView(req, reply, client, flash('erro', err.message));
    }
    return reply.redirect(`/admin/c/${client.id}/vendas?ok=venda`, 303);
  });

  app.post('/admin/c/:cid/vendas/:id/excluir', async (req: Req, reply) => {
    const client = await loadClient(req, reply);
    if (!client) return;
    try {
      await deleteSale(db, client.id, Number(req.params.id));
    } catch (err) {
      if (!(err instanceof PanelError)) throw err;
      reply.code(404);
      return salesView(req, reply, client, flash('erro', err.message));
    }
    return reply.redirect(`/admin/c/${client.id}/vendas?ok=excluida`, 303);
  });

  app.get('/admin/c/:cid/exportacoes', async (req: Req, reply) => {
    const client = await loadClient(req, reply);
    if (!client) return;
    const body = exportsPage(
      exportStats(db, client.id),
      await listExportFiles(db, client.id),
      client,
      config.conversionNames,
      messages(req),
    );
    return render(req, reply, client, 'exportacoes', 'Exportações', body);
  });

  app.post('/admin/c/:cid/exportacoes', async (req: Req, reply) => {
    const client = await loadClient(req, reply);
    if (!client) return;
    const tipo = req.body?.tipo;
    if (tipo !== 'lead' && tipo !== 'venda') return reply.code(400).send('Tipo inválido');
    const file = createExportFile(db, client, tipo);
    return reply.redirect(`/admin/c/${client.id}/exportacoes?ok=${file ? 'arquivo' : 'vazio'}`, 303);
  });

  app.get('/admin/c/:cid/exportacoes/:arquivo', async (req: Req, reply) => {
    const client = await loadClient(req, reply);
    if (!client) return;
    const arquivo = req.params.arquivo ?? '';
    const csv = await exportFileCsv(db, client, arquivo, config.conversionNames);
    if (!csv) return reply.code(404).send('Arquivo não encontrado');
    return reply
      .type('text/csv; charset=utf-8')
      .header('Content-Disposition', `attachment; filename="${arquivo.replace(/[^\w.-]/g, '_')}"`)
      .send(csv);
  });

  app.post('/admin/c/:cid/exportacoes/:arquivo/importado', async (req: Req, reply) => {
    const client = await loadClient(req, reply);
    if (!client) return;
    await markFileImported(db, client.id, req.params.arquivo ?? '');
    return reply.redirect(`/admin/c/${client.id}/exportacoes?ok=importado`, 303);
  });

  app.get('/admin/c/:cid/sistema', async (req: Req, reply) => {
    const client = await loadClient(req, reply);
    if (!client) return;
    const body = systemPage({
      client,
      baseUrl: config.baseUrl,
      metaConfigured: { appSecret: Boolean(config.meta.appSecret), verifyToken: Boolean(config.meta.verifyToken) },
      googleAdsConfigured: googleAdsConfigured(config),
      whatsapp: sessions.status(client.id),
      backups: await recentRuns(db, 'backup', null),
      spendRuns: await recentRuns(db, 'ad_spend', client.id),
      msg: messages(req),
    });
    return render(req, reply, client, 'sistema', 'Sistema', body);
  });

  app.post('/admin/c/:cid/sistema/whatsapp/desconectar', async (req: Req, reply) => {
    const client = await loadClient(req, reply);
    if (!client) return;
    await sessions.disconnect(client.id);
    return reply.redirect(`/admin/c/${client.id}/sistema?ok=whatsappDesconectado`, 303);
  });

  app.post('/admin/c/:cid/sistema/backup', async (req: Req, reply) => {
    const client = await loadClient(req, reply);
    if (!client) return;
    const r = await runJob(db, 'backup', null, () => runBackup(db, config));
    return reply.redirect(`/admin/c/${client.id}/sistema?${r.ok ? 'ok=job' : 'erro=jobErro'}`, 303);
  });

  app.post('/admin/c/:cid/sistema/gasto', async (req: Req, reply) => {
    const client = await loadClient(req, reply);
    if (!client) return;
    const r = await runJob(db, 'ad_spend', client.id, () => syncAdSpend(db, config, client, { fetchImpl: opts.fetchImpl }));
    return reply.redirect(`/admin/c/${client.id}/sistema?${r.ok ? 'ok=job' : 'erro=jobErro'}`, 303);
  });
}
