import { jidDecode, proto, type AuthenticationState, type BaileysEventEmitter } from 'baileys';
import { and, eq } from 'drizzle-orm';
import type { Db } from '../db/client.js';
import { clients } from '../db/schema.js';
import { processUpsert, recordHistoryChats } from './baileysInbound.js';
import { createHistoryProbe, type HistoryProbe, type ProbeSocket } from './historyProbe.js';
import { clearAuthState, loadAuthState } from './whatsappAuthState.js';

export type SessionStatus =
  | { state: 'desconectado' }
  | { state: 'conectando' }
  | { state: 'aguardando_qr'; qr: string }
  | { state: 'qr_expirado' }
  | { state: 'conectado'; phone: string }
  | { state: 'reconectando'; attempt: number }
  | { state: 'desconectado_logout' }
  | { state: 'substituida' };

/** The slice of a Baileys socket the manager uses; tests pass a fake. */
export interface WaSocket {
  ev: Pick<BaileysEventEmitter, 'on'>;
  user?: { id: string } | undefined;
  signalRepository: { lidMapping: { getPNForLID(lid: string): Promise<string | null> } };
  /** Asks the store's phone for a chat's earlier messages; absent in fakes that don't test it. */
  fetchMessageHistory?: ProbeSocket['fetchMessageHistory'];
  end(error?: Error): void;
  logout(): Promise<void>;
}

export interface SessionLog {
  info(obj: object, msg: string): void;
  warn(obj: object, msg: string): void;
  error(obj: object, msg: string): void;
}

export type SocketFactory = (auth: AuthenticationState, log: SessionLog) => Promise<WaSocket>;
type Schedule = (fn: () => void, ms: number) => () => void;

export class SessionLimitError extends Error {
  constructor() {
    super('Limite de conexões atingido');
  }
}

export const QR_TIMEOUT_MS = 2 * 60 * 1000;
const BACKOFF_START_MS = 1000;
const BACKOFF_MAX_MS = 60_000;
const LOGGED_OUT = 401;
// Another client opened the same login (a second server, a copied database): WhatsApp drops this one.
const CONNECTION_REPLACED = 440;
const RESTART_REQUIRED = 515;
// A socket that stays "conectado" but hears nothing is reopened with the saved login (no QR). WhatsApp
// replays what was missed on reconnect, so a quiet store only pays a harmless reconnect every few hours.
export const SILENT_SOCKET_MAX_MS = 3 * 60 * 60 * 1000;
// A socket that never reports open or close (hung handshake) would otherwise stay "conectando" forever.
const SYNC_WARN_MS = 45_000;
export const CONNECTING_MAX_MS = 3 * 60 * 1000;

const defaultSchedule: Schedule = (fn, ms) => {
  const t = setTimeout(fn, ms);
  t.unref();
  return () => clearTimeout(t);
};

interface Session {
  status: SessionStatus;
  gen: number;
  attempt: number;
  sock?: WaSocket;
  saveChain: Promise<void>;
  cancelRetry?: () => void;
  cancelQr?: () => void;
  cancelSync?: () => void;
  openedAt?: number;
  /** When the current socket was requested; for spotting a handshake that never finishes. */
  openingAt?: number;
  /** Last connection or message event from WhatsApp; for diagnosing a session that is "connected" but silent. */
  lastEventAt?: number;
}

const ACTIVE = new Set<SessionStatus['state']>(['conectando', 'aguardando_qr', 'conectado', 'reconectando']);

export interface SessionsOptions {
  maxSessions: number;
  socketFactory: SocketFactory;
  log: SessionLog;
  schedule?: Schedule;
}

export class WhatsAppSessions {
  private sessions = new Map<number, Session>();
  private schedule: Schedule;

  constructor(
    private db: Db,
    private opts: SessionsOptions,
  ) {
    this.schedule = opts.schedule ?? defaultSchedule;
  }

  status(clientId: number): SessionStatus {
    return this.sessions.get(clientId)?.status ?? { state: 'desconectado' };
  }

  /** When WhatsApp last sent this session anything (connection or messages), or undefined if never. */
  lastEventAt(clientId: number): number | undefined {
    return this.sessions.get(clientId)?.lastEventAt;
  }

  private activeCount(): number {
    let n = 0;
    for (const s of this.sessions.values()) if (ACTIVE.has(s.status.state)) n++;
    return n;
  }

  async connect(clientId: number): Promise<void> {
    const existing = this.sessions.get(clientId);
    if (existing && ACTIVE.has(existing.status.state)) return;
    if (this.activeCount() >= this.opts.maxSessions) throw new SessionLimitError();
    const s = existing ?? { status: { state: 'conectando' } as SessionStatus, gen: 0, attempt: 0, saveChain: Promise.resolve() };
    s.status = { state: 'conectando' };
    s.attempt = 0;
    this.sessions.set(clientId, s);
    await this.open(clientId, s);
  }

  async disconnect(clientId: number): Promise<void> {
    const s = this.sessions.get(clientId);
    if (s) {
      this.stop(s);
      const sock = s.sock;
      s.sock = undefined;
      if (sock) {
        try {
          await sock.logout();
        } catch (err) {
          this.opts.log.warn({ err, clientId }, 'logout do WhatsApp falhou');
        }
        sock.end();
      }
      s.status = { state: 'desconectado' };
    }
    await clearAuthState(this.db, clientId);
  }

  /** Reopens the saved session of every `baileys` client, up to the session limit. */
  async startAll(): Promise<void> {
    const rows = await this.db
      .select()
      .from(clients)
      .where(and(eq(clients.whatsappMode, 'baileys'), eq(clients.active, true)));
    for (const client of rows) await this.resume(client.id);
  }

  /** Reopens one client's saved login, if it has one. */
  async resume(clientId: number): Promise<void> {
    try {
      const existing = this.sessions.get(clientId);
      if (existing && ACTIVE.has(existing.status.state)) return;
      const { state } = await loadAuthState(this.db, clientId);
      // A QR pairing leaves `registered` false and only fills `me`, so either one means a saved login.
      if (!state.creds.registered && !state.creds.me) return;
      if (this.activeCount() >= this.opts.maxSessions) {
        this.opts.log.warn({ clientId }, 'limite de sessões do WhatsApp atingido, cliente não reconectado');
        return;
      }
      const s: Session = existing ?? { status: { state: 'conectando' }, gen: 0, attempt: 0, saveChain: Promise.resolve() };
      s.status = { state: 'conectando' };
      s.attempt = 0;
      this.sessions.set(clientId, s);
      await this.open(clientId, s);
    } catch (err) {
      this.opts.log.error({ err, clientId }, 'falha ao reabrir sessão do WhatsApp');
    }
  }

  /** Closes the socket but keeps the saved login, so reactivating the client doesn't need a new QR code. */
  pause(clientId: number): void {
    const s = this.sessions.get(clientId);
    if (!s) return;
    this.stop(s);
    s.sock?.end();
    s.sock = undefined;
    s.status = { state: 'desconectado' };
  }

  async stopAll(): Promise<void> {
    for (const s of this.sessions.values()) {
      this.stop(s);
      s.sock?.end();
      s.sock = undefined;
      s.status = { state: 'desconectado' };
    }
  }

  /** Reopens sessions that look dead without WhatsApp saying so: silent for hours, or stuck connecting. */
  async watchdog(now = Date.now()): Promise<void> {
    for (const [clientId, s] of [...this.sessions]) {
      const { state } = s.status;
      let why: string | undefined;
      if (state === 'conectado') {
        const quietSince = Math.max(s.lastEventAt ?? 0, s.openedAt ?? 0);
        if (quietSince > 0 && now - quietSince >= SILENT_SOCKET_MAX_MS) why = 'silencio';
      } else if (state === 'conectando' && s.openingAt !== undefined && now - s.openingAt >= CONNECTING_MAX_MS) {
        why = 'conexao-travada';
      }
      if (!why) continue;
      this.opts.log.warn({ clientId, why }, 'whatsapp: sessão reaberta pelo watchdog');
      this.stop(s);
      s.sock?.end();
      s.sock = undefined;
      s.attempt = 0;
      s.status = { state: 'conectando' };
      await this.open(clientId, s);
    }
  }

  /** Closes sessions of clients that are no longer in `baileys` mode (the CLI runs in another process). */
  async reconcile(): Promise<void> {
    for (const [clientId, s] of [...this.sessions]) {
      if (!ACTIVE.has(s.status.state)) continue;
      const client = await this.db.query.clients.findFirst({ where: eq(clients.id, clientId) });
      if (!client || client.whatsappMode !== 'baileys') await this.disconnect(clientId);
      else if (!client.active) this.pause(clientId);
    }
  }

  private stop(s: Session) {
    s.gen++;
    s.cancelRetry?.();
    s.cancelQr?.();
    s.cancelSync?.();
    s.cancelRetry = s.cancelQr = s.cancelSync = undefined;
  }

  private async open(clientId: number, s: Session): Promise<void> {
    const gen = ++s.gen;
    s.openingAt = Date.now();
    try {
      await s.saveChain;
      const auth = await loadAuthState(this.db, clientId);
      if (s.gen !== gen) return;
      const sock = await this.opts.socketFactory(auth.state, this.opts.log);
      if (s.gen !== gen) {
        sock.end();
        return;
      }
      s.sock = sock;
      this.listen(clientId, s, gen, sock, auth.saveCreds);
    } catch (err) {
      if (s.gen !== gen) return;
      this.opts.log.error({ err, clientId }, 'falha ao abrir socket do WhatsApp');
      this.retryLater(clientId, s);
    }
  }

  private listen(clientId: number, s: Session, gen: number, sock: WaSocket, saveCreds: () => Promise<void>) {
    const live = () => s.gen === gen;
    const fetchMessageHistory = sock.fetchMessageHistory?.bind(sock);
    const probe = fetchMessageHistory ? createHistoryProbe({ ev: sock.ev, fetchMessageHistory }, this.schedule) : undefined;
    sock.ev.on('creds.update', () => {
      s.saveChain = s.saveChain.then(saveCreds).catch((err) => this.opts.log.error({ err, clientId }, 'falha ao salvar login do WhatsApp'));
    });
    sock.ev.on('connection.update', (u) => {
      if (!live()) return;
      if (u.connection || u.qr) s.lastEventAt = Date.now();
      if (u.receivedPendingNotifications) {
        s.cancelSync?.();
        s.cancelSync = undefined;
        this.opts.log.info({ clientId, afterSec: s.openedAt ? Math.round((Date.now() - s.openedAt) / 1000) : undefined }, 'whatsapp: mensagens pendentes recebidas');
      }
      if (u.qr) {
        s.status = { state: 'aguardando_qr', qr: u.qr };
        s.cancelQr ??= this.schedule(() => this.expireQr(s), QR_TIMEOUT_MS);
      }
      if (u.connection === 'open') {
        s.cancelQr?.();
        s.cancelQr = undefined;
        s.attempt = 0;
        s.openedAt = Date.now();
        this.opts.log.info({ clientId }, 'whatsapp: conexão aberta');
        // WhatsApp normally says it finished delivering what was queued while offline within seconds.
        s.cancelSync?.();
        s.cancelSync = this.schedule(() => {
          s.cancelSync = undefined;
          if (live()) this.opts.log.warn({ clientId }, 'whatsapp: pendentes não chegaram em 45s após abrir');
        }, SYNC_WARN_MS);
        const user = sock.user ? jidDecode(sock.user.id)?.user : undefined;
        s.status = { state: 'conectado', phone: user ? `+${user}` : '' };
      }
      if (u.connection === 'close') {
        const code = (u.lastDisconnect?.error as { output?: { statusCode?: number } } | undefined)?.output?.statusCode;
        const now = Date.now();
        this.opts.log.info(
          {
            clientId,
            code,
            reason: (u.lastDisconnect?.error as Error | undefined)?.message,
            openForSec: s.openedAt ? Math.round((now - s.openedAt) / 1000) : undefined,
            silentForSec: s.lastEventAt ? Math.round((now - s.lastEventAt) / 1000) : undefined,
          },
          'whatsapp: conexão fechada',
        );
        s.openedAt = undefined;
        void this.onClose(clientId, s, gen, code);
      }
    });
    sock.ev.on('messages.upsert', (upsert) => {
      if (!live()) return;
      s.lastEventAt = Date.now();
      void this.onUpsert(clientId, sock, upsert, probe);
    });
    sock.ev.on('messaging-history.set', (set) => {
      if (!live()) return;
      s.lastEventAt = Date.now();
      void this.onHistory(clientId, sock, set);
    });
  }

  private async onHistory(clientId: number, sock: WaSocket, set: Parameters<typeof recordHistoryChats>[2] & { syncType?: number | null }) {
    // ON_DEMAND replies belong to the history probe, which saves its own verdict.
    if (set.syncType === proto.HistorySync.HistorySyncType.ON_DEMAND) return;
    try {
      const added = await recordHistoryChats(this.db, clientId, set, (lid) => sock.signalRepository.lidMapping.getPNForLID(lid));
      if (added) this.opts.log.info({ clientId, added, syncType: set.syncType }, 'whatsapp: conversas antigas registradas do histórico');
    } catch (err) {
      this.opts.log.error({ err, clientId }, 'falha ao registrar conversas antigas do WhatsApp');
    }
  }

  private expireQr(s: Session) {
    s.cancelQr = undefined;
    if (s.status.state === 'conectado') return;
    this.stop(s);
    s.sock?.end();
    s.sock = undefined;
    s.status = { state: 'qr_expirado' };
  }

  private async onClose(clientId: number, s: Session, gen: number, code: number | undefined) {
    await s.saveChain;
    if (s.gen !== gen) return;
    s.sock = undefined;
    // Only 401 means the phone removed the device. 500 is Baileys' default for any unknown stream
    // error, so it retries with backoff and keeps the saved login.
    if (code === LOGGED_OUT) {
      this.stop(s);
      await clearAuthState(this.db, clientId);
      s.status = { state: 'desconectado_logout' };
      return;
    }
    if (code === CONNECTION_REPLACED) {
      // Retrying would knock the other client off in turn, and the two would fight forever.
      // The login stays saved: the person decides which one keeps it.
      this.stop(s);
      this.opts.log.warn({ clientId }, 'whatsapp: login aberto em outro lugar, sessão encerrada sem reconectar');
      s.status = { state: 'substituida' };
      return;
    }
    if (code === RESTART_REQUIRED) {
      await this.open(clientId, s);
      return;
    }
    this.retryLater(clientId, s);
  }

  private retryLater(clientId: number, s: Session) {
    s.attempt++;
    s.status = { state: 'reconectando', attempt: s.attempt };
    const delay = Math.min(BACKOFF_MAX_MS, BACKOFF_START_MS * 2 ** (s.attempt - 1));
    s.cancelRetry?.();
    s.cancelRetry = this.schedule(() => {
      s.cancelRetry = undefined;
      void this.open(clientId, s);
    }, delay);
  }

  private async onUpsert(clientId: number, sock: WaSocket, upsert: Parameters<typeof processUpsert>[2], probe: HistoryProbe | undefined) {
    try {
      const client = await this.db.query.clients.findFirst({ where: eq(clients.id, clientId) });
      if (!client || client.whatsappMode !== 'baileys' || !client.active) return;
      await processUpsert(this.db, client, upsert, (lid) => sock.signalRepository.lidMapping.getPNForLID(lid), this.opts.log, Date.now(), probe);
    } catch (err) {
      this.opts.log.error({ err, clientId }, 'falha ao processar mensagens do WhatsApp');
    }
  }
}
