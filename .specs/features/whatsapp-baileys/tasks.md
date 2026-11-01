# WhatsApp via Baileys Tasks

## Execution Protocol (MANDATORY -- do not skip)

Implement these tasks with the `tlc-spec-driven` skill: **activate it by name and follow its Execute flow and Critical Rules.** Do not search for skill files by filesystem path. The skill is the source of truth for the full flow (per-task cycle, sub-agent delegation, the walk, check_proofs, the Verifier and the screens sub-agent).

**If the skill cannot be activated, STOP and tell the user - do not proceed without it.**

---

**Design**: `.specs/features/whatsapp-baileys/design.md`
**Status**: Approved
**Approved**: 2026-10-31 - user: "implementa"
**Build**: `npm run build; npm run typecheck`
**Run unit**: `npm test`

---

## Test Coverage Matrix

> Generated from codebase, project guidelines, and spec - confirm before Execute. Guidelines found: none (no AGENTS.md, CONTRIBUTING.md, CI or coverage config) - strong defaults applied. Style from `test/unit.test.ts`, `test/flow.test.ts`, `test/adSpend.test.ts`: `node:test` via `tsx --test`, in-memory SQLite, `app.inject`, fakes injected through deps (`fetchImpl`).

| Code Layer | Required Test Type | Coverage Expectation | Location Pattern | Run Command |
| ---------- | ------------------ | -------------------- | ---------------- | ----------- |
| Service (`src/services/*`) | unit | All branches; 1:1 to spec ACs; every listed edge case | `test/*.test.ts` | `npm test` |
| Routes + views (`src/routes/*`, `src/views/*`) | integration (`app.inject`) | Every route in scope: happy + edge + error | `test/*.test.ts` | `npm test` |
| DB schema + migration | integration | Migration runs on `openDb`, data rule of the migration | `test/*.test.ts` | `npm test` |
| Config (`src/config.ts`) | unit | Defaults and parsing of new vars | `test/unit.test.ts` | `npm test` |
| CLI (`src/cli.ts`) | integration | New flag: valid and invalid value | `test/*.test.ts` | `npm test` |
| Baileys adapter (`src/services/baileysSocket.ts`), `server.ts` wiring, deps, docs | none | build gate only; proven by the walk with a real phone | - | build gate only |

## Gate Check Commands

> Generated from codebase - confirm before Execute. No lint is configured.

| Gate Level | When to Use | Command |
| ---------- | ----------- | ------- |
| Quick | After tasks with unit tests only | `npm test` |
| Full | After tasks with integration tests | `npm test` |
| Build | After phase completion or config/deps-only tasks | `npm run build && npm run typecheck && npm test` |

---

## Execution Plan

### Phase 1: Foundation

```
T1 → T2 → T3
```

### Phase 2: Core

```
T4 → T5 → T6
```

### Phase 3: Accounts and Cloud API

```
T7 → T8 → T9
```

### Phase 4: Screens and wiring

```
T10 → T11 → T12 → T13 → T14 → T15
```

---

## Task Breakdown

### T1: Add Baileys and QR dependencies

**What**: Add `baileys@7.0.0-rc14` and `qrcode@1.5.4` as exact versions, and `@types/qrcode` as dev dependency.
**Where**: `package.json`
**Depends on**: None
**Reuses**: -
**Requirement**: WA-01

**Done when**:

- [x] `npm ci --ignore-scripts` installs with no install script needed (as in the Dockerfile)
- [x] Gate check passes: `npm run build && npm run typecheck && npm test`
- [x] Test count: 16 tests pass (no silent deletions)

**Tests**: none
**Gate**: build

**Commit**: `build(deps): add baileys 7.0.0-rc14 and qrcode`

---

### T2: Schema for connection mode and auth state

**What**: Add `clients.whatsapp_mode` (`baileys` default) and table `whatsapp_auth`; generate migration `0001` with `drizzle-kit generate` and append the `UPDATE` that sets `cloud` for clients with a Phone number ID.
**Where**: `src/db/schema.ts`
**Depends on**: T1
**Reuses**: existing `clients` table, `drizzle-kit generate`
**Requirement**: WA-04

**Done when**:

- [x] Test "migração põe em cloud quem já tem phone number id" passes
- [x] Test "cliente novo nasce em modo baileys" passes
- [x] `test/helpers.ts` `setup()` creates the test client with `whatsappMode: 'cloud'` and the existing webhook tests stay green
- [x] Gate check passes: `npm test`
- [x] Test count: 18 tests pass

**Tests**: integration
**Gate**: full

**Commit**: `feat(whatsapp): add whatsapp_mode and whatsapp_auth schema`

---

### T3: SQLite auth state for Baileys

**What**: `loadAuthState(db, clientId)` and `clearAuthState(db, clientId)` implementing Baileys' `AuthenticationState` over `whatsapp_auth` with `BufferJSON`.
**Where**: `src/services/whatsappAuthState.ts`
**Depends on**: T2
**Reuses**: `initAuthCreds`, `BufferJSON` from `baileys`; shape of `useMultiFileAuthState`
**Requirement**: WA-03

**Done when**:

- [x] Tests "auth state guarda e relê creds e chaves", "auth state apaga só o cliente pedido", "auth state corrompido volta a creds novas" pass
- [x] Gate check passes: `npm test`
- [x] Test count: 21 tests pass

**Tests**: unit
**Gate**: quick

**Commit**: `feat(whatsapp): store baileys auth state in sqlite`

---

### T4: Inbound messages from Baileys

**What**: `processUpsert` turning `messages.upsert` into `handleInboundMessage` calls, with the filters and LID resolution from the design.
**Where**: `src/services/baileysInbound.ts`
**Depends on**: None (previous phase complete)
**Reuses**: `extractRef`, `handleInboundMessage`, `isJidGroup`/`isJidBroadcast`/`isPnUser` from `baileys`
**Requirement**: WA-02

**Done when**:

- [x] Tests for C8-C14 pass
- [x] Gate check passes: `npm test`
- [x] Test count: 28 tests pass

**Tests**: unit
**Gate**: quick

**Commit**: `feat(whatsapp): turn baileys messages into tracked contacts`

---

### T5: Session manager

**What**: `WhatsAppSessions` with `connect`, `disconnect`, `status`, `startAll`, `stopAll`, the state rules, backoff, 2-minute QR timeout and session limit, over an injected `SocketFactory`.
**Where**: `src/services/whatsappSessions.ts`
**Depends on**: T4
**Reuses**: T3 auth state, T4 `processUpsert`
**Requirement**: WA-01, WA-03

**Done when**:

- [ ] Tests for C1-C3, C5, C6, C15-C19, C25-C27 pass using a fake socket and fake timers
- [ ] Gate check passes: `npm test`
- [ ] Test count: 41 tests pass

**Tests**: unit
**Gate**: quick

**Commit**: `feat(whatsapp): add baileys session manager`

---

### T6: Real Baileys socket factory

**What**: `createBaileysSocket` calling `makeWASocket` with the config from the design (latest WA Web version with fallback, no history sync, not online, cacheable key store).
**Where**: `src/services/baileysSocket.ts`
**Depends on**: T5
**Reuses**: `makeWASocket`, `fetchLatestWaWebVersion`, `makeCacheableSignalKeyStore`, `Browsers`
**Requirement**: WA-01

**Done when**:

- [ ] Type-checks against the `SocketFactory` type from T5
- [ ] Gate check passes: `npm run build && npm run typecheck && npm test`
- [ ] Test count: 41 tests pass

**Tests**: none
**Gate**: build

**Commit**: `feat(whatsapp): add real baileys socket factory`

---

### T7: Cloud API only for cloud clients

**What**: `processWebhook` handles only clients with `whatsappMode = 'cloud'`.
**Where**: `src/services/whatsapp.ts`
**Depends on**: None (previous phase complete)
**Reuses**: existing webhook tests and `waPayload`
**Requirement**: WA-04

**Done when**:

- [ ] Tests for C20, C21 pass
- [ ] Gate check passes: `npm test`
- [ ] Test count: 43 tests pass

**Tests**: integration
**Gate**: full

**Commit**: `feat(whatsapp): webhook only for cloud clients`

---

### T8: Mode in accounts service

**What**: `createClient`/`updateClient` accept `whatsappMode`, reject other values with `Modo de WhatsApp inválido: <valor>`.
**Where**: `src/services/accounts.ts`
**Depends on**: T7
**Reuses**: existing input pattern
**Requirement**: WA-04

**Done when**:

- [ ] Tests "updateClient troca o modo do whatsapp" and "updateClient recusa modo inválido" pass
- [ ] Gate check passes: `npm test`
- [ ] Test count: 45 tests pass

**Tests**: unit
**Gate**: quick

**Commit**: `feat(whatsapp): whatsapp mode in accounts`

---

### T9: CLI flag `--whatsapp-mode`

**What**: `create-client` and `update-client` take `--whatsapp-mode <baileys|cloud>`.
**Where**: `src/cli.ts`
**Depends on**: T8
**Reuses**: `parseArgs` options already in the CLI
**Requirement**: WA-04

**Done when**:

- [ ] Tests for C22, C23 pass (spawning the CLI on a temp `DATABASE_PATH`)
- [ ] Gate check passes: `npm test`
- [ ] Test count: 47 tests pass

**Tests**: integration
**Gate**: full

**Commit**: `feat(whatsapp): --whatsapp-mode in the cli`

---

### T10: Max sessions in config

**What**: `config.whatsapp.maxSessions` from `BAILEYS_MAX_SESSIONS`, default 5.
**Where**: `src/config.ts`
**Depends on**: None (previous phase complete)
**Reuses**: `get()` helper
**Requirement**: WA-01

**Done when**:

- [ ] Test "BAILEYS_MAX_SESSIONS padrão 5 e lê o valor" passes
- [ ] Gate check passes: `npm test`
- [ ] Test count: 48 tests pass

**Tests**: unit
**Gate**: quick

**Commit**: `feat(whatsapp): BAILEYS_MAX_SESSIONS config`

---

### T11: Connection screen view

**What**: `whatsappPage` and `whatsappStatus` render each `SessionStatus` (QR as SVG, Conectado + número, QR expirado + "Gerar novo QR", Reconectando, Desconectado, logout message, limit message, cloud mode notice).
**Where**: `src/views/whatsapp.ts`
**Depends on**: T10
**Reuses**: `html`, `page`, `qrcode`
**Requirement**: WA-01

**Done when**:

- [ ] Test "tela de conexão mostra cada estado" passes
- [ ] Gate check passes: `npm test`
- [ ] Test count: 49 tests pass

**Tests**: unit
**Gate**: quick

**Commit**: `feat(whatsapp): connection screen view`

---

### T12: Panel connection routes and app wiring

**What**: `GET /painel/whatsapp`, `GET /painel/whatsapp/estado`, `POST /painel/whatsapp/conectar`, `POST /painel/whatsapp/desconectar`, menu link, and `sessions` added to `AppDeps` and `setup()` with a fake factory.
**Where**: `src/routes/panel.ts`
**Depends on**: T11
**Reuses**: `requireRole('client')`, `currentClient`, `isHtmx`
**Requirement**: WA-01

**Done when**:

- [ ] Tests for C1, C2 (via routes), C4 (painel part), C5, C6, C7, C24 pass
- [ ] Gate check passes: `npm test`
- [ ] Test count: 55 tests pass

**Tests**: integration
**Gate**: full

**Commit**: `feat(whatsapp): connect whatsapp by qr from the panel`

---

### T13: Admin system block

**What**: Admin → Sistema shows mode, state and number per client and a "Desconectar" button (`POST /admin/c/:cid/sistema/whatsapp/desconectar`); Cloud API warnings only when the client is `cloud`.
**Where**: `src/routes/admin.ts`
**Depends on**: T12
**Reuses**: `systemPage` in `src/views/admin.ts`
**Requirement**: WA-01, WA-03, WA-04

**Done when**:

- [ ] Tests for C4 (admin part), C18, C24 pass
- [ ] Gate check passes: `npm test`
- [ ] Test count: 58 tests pass

**Tests**: integration
**Gate**: full

**Commit**: `feat(whatsapp): whatsapp status in admin system page`

---

### T14: Start sessions on boot

**What**: `server.ts` creates `WhatsAppSessions` with the real factory, calls `startAll()` after `listen` and `stopAll()` on shutdown.
**Where**: `src/server.ts`
**Depends on**: T13
**Reuses**: shutdown handler
**Requirement**: WA-03

**Done when**:

- [ ] App starts locally with `npm run dev` and `/painel/whatsapp` shows a real QR
- [ ] Gate check passes: `npm run build && npm run typecheck && npm test`
- [ ] Test count: 58 tests pass

**Tests**: none
**Gate**: build

**Commit**: `feat(whatsapp): open baileys sessions on boot`

---

### T15: README

**What**: README "WhatsApp" section: Baileys as default (scan QR in Painel → WhatsApp), Cloud API as optional mode with `--whatsapp-mode cloud`, `BAILEYS_MAX_SESSIONS`, the auth state in backups, the libsignal GPL note; `.env.example` gets `BAILEYS_MAX_SESSIONS`.
**Where**: `README.md`
**Depends on**: T14
**Reuses**: current Cloud API section
**Requirement**: WA-04

**Done when**:

- [ ] Gate check passes: `npm run build && npm run typecheck && npm test`
- [ ] Test count: 58 tests pass

**Tests**: none
**Gate**: build

**Commit**: `docs: baileys as default whatsapp connection`

---

## Checks

**C1** - Opening the connection screen of a `baileys` client shows a QR code as SVG (WA-01, AC 1)
Proof: run unit | ✔ painel mostra o qr code de um cliente baileys

**C2** - After the socket opens, the state is "Conectado" with the connected number (WA-01, AC 2)
Proof: run unit | ✔ sessão aberta mostra conectado e o número

**C3** - A new `qr` event replaces the QR shown (WA-01, AC 3)
Proof: run unit | ✔ qr novo substitui o anterior

**C4** - While connected, `/painel/whatsapp` and Admin → Sistema show "Conectado" (WA-01, AC 4)
Proof: run unit | ✔ painel e admin mostram conectado

**C5** - "Desconectar" logs out, deletes the client's `whatsapp_auth` rows and shows "Desconectado" (WA-01, AC 5)
Proof: run unit | ✔ desconectar apaga o login e mostra desconectado

**C6** - With 5 active sessions, a sixth connect is refused with "Limite de conexões atingido" (WA-01, AC 6)
Proof: run unit | ✔ sexta conexão é recusada pelo limite

**C7** - A store user cannot reach another client's connection: `/painel/whatsapp` only serves the user's own client, and `/admin/c/:cid/sistema` redirects a store user without a QR (WA-01, AC 7)
Proof: run unit | ✔ loja não acessa a conexão de outro cliente

**C8** - A message with a valid ref from an individual contact links the phone to the click (WA-02, AC 1)
Proof: run unit | ✔ mensagem baileys com ref liga ao clique

**C9** - A message without ref creates the contact with origin `desconhecida` and no click (WA-02, AC 2)
Proof: run unit | ✔ mensagem baileys sem ref cria contato sem clique

**C10** - No table stores the message text after processing (WA-02, AC 3)
Proof: run unit | ✔ texto da mensagem baileys não é guardado

**C11** - Messages from groups, status/broadcast or `fromMe` create no contact (WA-02, AC 4)
Proof: run unit | ✔ ignora grupo, status e mensagem da própria loja

**C12** - An upsert of type `append` creates no contact (WA-02, AC 5)
Proof: run unit | ✔ ignora histórico (append)

**C13** - The same message delivered twice leaves one contact (WA-02, AC 6)
Proof: run unit | ✔ mensagem repetida gera um contato só

**C14** - A sender only known by an unresolved LID is skipped with a `warn` log; a LID resolved by `remoteJidAlt` or `getPNForLID` is handled (WA-02, AC 7)
Proof: run unit | ✔ lid sem telefone é ignorado e lid resolvido é aceito

**C15** - On `startAll`, a client with registered creds reopens with the saved creds and no QR (WA-03, AC 1)
Proof: run unit | ✔ reinício reabre a sessão salva sem qr

**C16** - A network close reconnects after 1, 2, 4 … s, capped at 60 s, and resets after `open` (WA-03, AC 2)
Proof: run unit | ✔ queda de rede reconecta com espera crescente até 60 s

**C17** - A `401 loggedOut` close deletes the auth state, shows "Desconectado, escaneie o QR code" and does not reconnect (WA-03, AC 3)
Proof: run unit | ✔ logout pelo celular apaga o login e não reconecta

**C18** - Admin → Sistema shows the logout state of a client (WA-03, AC 4)
Proof: run unit | ✔ admin mostra cliente desconectado por logout

**C19** - A factory that throws for one client in `startAll` leaves the other client connected (WA-03, AC 5)
Proof: run unit | ✔ falha ao reabrir um cliente não derruba os outros

**C20** - A `cloud` client's webhook creates the contact and opens no Baileys session (WA-04, AC 1)
Proof: run unit | ✔ cliente cloud usa o webhook e não abre sessão

**C21** - A webhook for a `baileys` client's Phone number ID creates no contact (WA-04, AC 2)
Proof: run unit | ✔ webhook de cliente baileys é ignorado

**C22** - `update-client --whatsapp-mode cloud` sets the mode and closes the client's Baileys session (WA-04, AC 3)
Proof: run unit | ✔ cli troca o modo do whatsapp

**C23** - `update-client --whatsapp-mode xyz` exits non-zero with "Modo de WhatsApp inválido: xyz" (WA-04, AC 4)
Proof: run unit | ✔ cli recusa modo inválido

**C24** - Admin → Sistema lists missing `META_APP_SECRET`/`META_VERIFY_TOKEN` only for a `cloud` client (WA-04, AC 5)
Proof: run unit | ✔ admin só cobra segredos da meta de cliente cloud

**C25** - A QR not scanned in 2 minutes ends the socket and shows "QR expirado" with "Gerar novo QR" (Edge case 1)
Proof: run unit | ✔ qr não escaneado em 2 minutos expira

**C26** - Two `connect` calls for the same client open one socket (Edge case 2)
Proof: run unit | ✔ duas conexões da mesma loja usam um socket

**C27** - Corrupted saved creds are deleted and the next connect shows a QR (Edge case 3)
Proof: run unit | ✔ login salvo corrompido pede qr novo

---

## Handoff

**Settled mid-build:** user "implementa" - approves tasks as presented (C7 keeps the existing 303 redirect, not 403) and inline execution.
**Dispatched:** none
**Walked:** none

---

## Phase Execution Map

```
Phase 1 → Phase 2 → Phase 3 → Phase 4

Phase 1:  T1 → T2 → T3
Phase 2:  T4 → T5 → T6
Phase 3:  T7 → T8 → T9
Phase 4:  T10 → T11 → T12 → T13 → T14 → T15
```
