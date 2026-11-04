import { jidDecode, type AuthenticationState, type BaileysEventEmitter } from 'baileys';
import { eq } from 'drizzle-orm';
import type { Db } from '../db/client.js';
import { clients } from '../db/schema.js';
import { processUpsert } from './baileysInbound.js';
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
  openedAt?: number;
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
    const rows = await this.db.select().from(clients).where(eq(clients.whatsappMode, 'baileys'));
    for (const client of rows) {
      try {
        const { state } = await loadAuthState(this.db, client.id);
        // A QR pairing leaves `registered` false and only fills `me`, so either one means a saved login.
        if (!state.creds.registered && !state.creds.me) continue;
        if (this.activeCount() >= this.opts.maxSessions) {
          this.opts.log.warn({ clientId: client.id }, 'limite de sessões do WhatsApp atingido, cliente não reconectado');
          continue;
        }
        const s: Session = { status: { state: 'conectando' }, gen: 0, attempt: 0, saveChain: Promise.resolve() };
        this.sessions.set(client.id, s);
        await this.open(client.id, s);
      } catch (err) {
        this.opts.log.error({ err, clientId: client.id }, 'falha ao reabrir sessão do WhatsApp');
      }
    }
  }

  async stopAll(): Promise<void> {
    for (const s of this.sessions.values()) {
      this.stop(s);
      s.sock?.end();
      s.sock = undefined;
      s.status = { state: 'desconectado' };
    }
  }

  /** Closes sessions of clients that are no longer in `baileys` mode (the CLI runs in another process). */
  async reconcile(): Promise<void> {
    for (const [clientId, s] of [...this.sessions]) {
      if (!ACTIVE.has(s.status.state)) continue;
      const client = await this.db.query.clients.findFirst({ where: eq(clients.id, clientId) });
      if (!client || client.whatsappMode !== 'baileys') await this.disconnect(clientId);
    }
  }

  private stop(s: Session) {
    s.gen++;
    s.cancelRetry?.();
    s.cancelQr?.();
    s.cancelRetry = s.cancelQr = undefined;
  }

  private async open(clientId: number, s: Session): Promise<void> {
    const gen = ++s.gen;
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
    sock.ev.on('creds.update', () => {
      s.saveChain = s.saveChain.then(saveCreds).catch((err) => this.opts.log.error({ err, clientId }, 'falha ao salvar login do WhatsApp'));
    });
    sock.ev.on('connection.update', (u) => {
      if (!live()) return;
      if (u.connection || u.qr) s.lastEventAt = Date.now();
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
      void this.onUpsert(clientId, sock, upsert);
    });
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

  private async onUpsert(clientId: number, sock: WaSocket, upsert: Parameters<typeof processUpsert>[2]) {
    try {
      const client = await this.db.query.clients.findFirst({ where: eq(clients.id, clientId) });
      if (!client || client.whatsappMode !== 'baileys') return;
      await processUpsert(this.db, client, upsert, (lid) => sock.signalRepository.lidMapping.getPNForLID(lid), this.opts.log);
    } catch (err) {
      this.opts.log.error({ err, clientId }, 'falha ao processar mensagens do WhatsApp');
    }
  }
}
