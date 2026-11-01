# WhatsApp via Baileys verification

**Verdict**: PASS (round 1 found 4 findings; all closed in 797d0b0)
**Proofs**: `proofs.md` at 27b44cd
**Verifier**: independent sub-agent (author != verifier)

## Checks

| Check | Test | Holds |
| --- | --- | --- |
| C1 | `whatsappPanel.test.ts` `painel mostra o qr code de um cliente baileys` | yes - no svg before connect, svg inside `div.qr` after a `qr` event (does not decode the QR, acceptable) |
| C2 | `whatsappSessions.test.ts` `sessão aberta mostra conectado e o número` | yes - deepEqual on `{conectado, '+5511999990000'}` with a device-suffixed JID; the 15 s bound is not timed |
| C3 | `whatsappSessions.test.ts` `qr novo substitui o anterior` | yes |
| C4 | `whatsappAdmin.test.ts` `painel e admin mostram conectado` | yes |
| C5 | `whatsappSessions.test.ts` `desconectar apaga o login e mostra desconectado` | yes - rows exist before, zero for the client after, logout and end called |
| C6 | `whatsappSessions.test.ts` `sexta conexão é recusada pelo limite` | yes - 5 allowed, 6th rejected with the exact message, reconnect of an existing one allowed |
| C7 | `whatsappPanel.test.ts` `loja não acessa a conexão de outro cliente` | yes - asserts the approved 303 to /painel with no svg |
| C8 | `baileysInbound.test.ts` `mensagem baileys com ref liga ao clique` | yes |
| C9 | `baileysInbound.test.ts` `mensagem baileys sem ref cria contato sem clique` | yes |
| C10 | `baileysInbound.test.ts` `texto da mensagem baileys não é guardado` | yes - dumps every table and looks for the text |
| C11 | `baileysInbound.test.ts` `ignora grupo, status e mensagem da própria loja` | yes - group, status, broadcast, newsletter, fromMe in one batch, zero contacts |
| C12 | `baileysInbound.test.ts` `ignora histórico (append)` | yes |
| C13 | `baileysInbound.test.ts` `mensagem repetida gera um contato só` | yes - but a contact is per phone, so it would also pass with no message-id dedupe |
| C14 | `baileysInbound.test.ts` `lid sem telefone é ignorado e lid resolvido é aceito` | yes - unresolved warned and skipped, `remoteJidAlt` and lookup each accepted; resolution order not held (see Findings) |
| C15 | `whatsappSessions.test.ts` `reinício reabre a sessão salva sem qr` | yes |
| C16 | `whatsappSessions.test.ts` `queda de rede reconecta com espera crescente até 60 s` | yes - exact delays 1000..32000, 60000 x3, and 1000 again after open |
| C17 | `whatsappSessions.test.ts` `logout pelo celular apaga o login e não reconecta` | yes - state is asserted, the "escaneie o QR code" text is covered only by `whatsappView.test.ts` |
| C18 | `whatsappAdmin.test.ts` `admin mostra cliente desconectado por logout` | yes |
| C19 | `whatsappSessions.test.ts` `falha ao reabrir um cliente não derruba os outros` | yes |
| C20 | `whatsappMode.test.ts` `cliente cloud usa o webhook e não abre sessão` | yes |
| C21 | `whatsappMode.test.ts` `webhook de cliente baileys é ignorado` | yes |
| C22 | `cliMode.test.ts` `cli troca o modo do whatsapp` | yes - the close happens via a manual `reconcile()`; the 60 s timer in `server.ts` is not exercised |
| C23 | `cliMode.test.ts` `cli recusa modo inválido` | yes |
| C24 | `whatsappAdmin.test.ts` `admin só cobra segredos da meta de cliente cloud` | yes |
| C25 | `whatsappSessions.test.ts` `qr não escaneado em 2 minutos expira` | yes - 119 999 ms still waiting, 120 000 ms expired, socket ended, new QR after reconnect |
| C26 | `whatsappSessions.test.ts` `duas conexões da mesma loja usam um socket` | yes |
| C27 | `whatsappSessions.test.ts` `login salvo corrompido pede qr novo` | yes |
| C28 | `whatsappSessions.test.ts` `close 500 mantém o login e reconecta com espera` | yes (author-judged: added after the Verifier's round, no second Verifier by design) - asserts `reconectando` attempt 1, the auth rows still there, a new socket after exactly 1000 ms with `registered` true |
| C29 | `whatsappSessions.test.ts` `depois do scan o close 515 reabre com o login salvo` | yes (author-judged, as C28) - the second socket is created with `registered` true and the creds row is saved |
| C30 | `whatsappSessions.test.ts` `reinício acima do limite reabre só até o limite` | yes (author-judged, as C28) - one socket, the other client `desconectado`, exactly one warn |
## Findings

| Finding | Evidence | Fix | Closed |
| --- | --- | --- | --- |
| Any status 500 close wipes the store's login and forces a new QR | `whatsappSessions.ts:231` treats `BAD_SESSION` (500) like `401 loggedOut`: `clearAuthState` and no reconnect. Baileys emits 500 for any unknown `stream:error` (`generics.js:292` defaults to `badSession`) and for `CB:failure` with no reason (`socket.js:799`), so a transient server hiccup deletes the saved session. The spec (WA-03 AC3) only fixes the logout case; no test covers 500 | drop `BAD_SESSION` from the logout branch so 500 goes through the backoff reconnect (or wipe only after repeated 500s), and add a test that a 500 close keeps the auth rows and schedules a retry | 797d0b0 - 500 now retries and keeps the login; proven by C28 |
| C14 does not hold the LID resolution order | `baileysInbound.ts:44` takes `remoteJidAlt` before `getPNForLID`, but the test's `remoteJidAlt` case uses a lookup that returns null, so swapping the order still passes | in the `L2` case use a lookup returning a different phone and assert the contact is the `remoteJidAlt` one (and that the lookup was not called) | 797d0b0 - C14's test now returns another phone from the lookup, asserts the `remoteJidAlt` contact and that the lookup was not asked |
| `startAll` over the session limit has no test | `whatsappSessions.ts:131` skips clients beyond the limit with a warn. My throwaway test (max 1, two registered clients) opened one socket, so it works, but nothing guards it | add a test with `maxSessions: 1` and two registered clients: one socket, the other `desconectado`, one warn | 797d0b0 - new check C30 (startAll over the limit: one socket, one warn) |
| The 515 restart-required reopen and the `reconcile()` 60 s timer are rules no check names | `whatsappSessions.ts:236`, `server.ts` interval. Tests exist (`depois do scan o close 515 reabre com o login salvo`, the `reconcile` part of the upsert test) but no C-check selects them | add a check for each to tasks.md, or accept them as covered by named tests | 797d0b0 - 515 reopen is now check C29; `reconcile()` is proven by C22 (CLI switch then `reconcile()` closes the session); the 60 s `setInterval` wiring in `server.ts` has no test, accepted as one line checked by reading |
