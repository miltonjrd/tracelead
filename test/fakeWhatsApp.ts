import type { AuthenticationState } from 'baileys';
import type { SessionLog, WaSocket } from '../src/services/whatsappSessions.js';

type Handler = (arg: any) => void;

export class FakeSock implements WaSocket {
  handlers = new Map<string, Handler[]>();
  ended = false;
  loggedOut = false;
  user: { id: string } | undefined;
  lid = new Map<string, string>();
  ev = {
    on: (event: string, fn: Handler) => {
      this.handlers.set(event, [...(this.handlers.get(event) ?? []), fn]);
    },
  } as unknown as WaSocket['ev'];
  signalRepository = { lidMapping: { getPNForLID: async (l: string) => this.lid.get(l) ?? null } };
  constructor(public auth: AuthenticationState) {}
  emit(event: string, arg: unknown) {
    for (const fn of this.handlers.get(event) ?? []) fn(arg);
  }
  end() {
    this.ended = true;
  }
  async logout() {
    this.loggedOut = true;
  }
  qr(code: string) {
    this.emit('connection.update', { qr: code });
  }
  open(id = '5511999990000:3@s.whatsapp.net') {
    this.user = { id };
    this.emit('connection.update', { connection: 'open' });
  }
  close(statusCode: number) {
    this.emit('connection.update', { connection: 'close', lastDisconnect: { error: { output: { statusCode } } } });
  }
}

export function fakeFactory(opts: { failFor?: (auth: AuthenticationState) => boolean } = {}) {
  const socks: FakeSock[] = [];
  const factory = async (auth: AuthenticationState) => {
    if (opts.failFor?.(auth)) throw new Error('falha ao abrir socket');
    const s = new FakeSock(auth);
    socks.push(s);
    return s;
  };
  return { socks, factory, last: () => socks[socks.length - 1]! };
}

/** Manual clock: schedule() records, advance() fires what is due. */
export class FakeTimers {
  now = 0;
  delays: number[] = [];
  private tasks: { at: number; fn: () => void; cancelled: boolean }[] = [];
  schedule = (fn: () => void, ms: number) => {
    this.delays.push(ms);
    const t = { at: this.now + ms, fn, cancelled: false };
    this.tasks.push(t);
    return () => {
      t.cancelled = true;
    };
  };
  async advance(ms: number) {
    const end = this.now + ms;
    for (;;) {
      const due = this.tasks.filter((t) => !t.cancelled && t.at <= end).sort((a, b) => a.at - b.at)[0];
      if (!due) break;
      this.now = due.at;
      due.cancelled = true;
      due.fn();
      await settle();
    }
    this.now = end;
  }
  pending() {
    return this.tasks.filter((t) => !t.cancelled).length;
  }
}

export async function settle() {
  for (let i = 0; i < 8; i++) await new Promise((r) => setImmediate(r));
}

export function silentLog(): SessionLog & { errors: unknown[]; warns: unknown[] } {
  const errors: unknown[] = [];
  const warns: unknown[] = [];
  return { info() {}, warn: (o) => void warns.push(o), error: (o) => void errors.push(o), errors, warns };
}
