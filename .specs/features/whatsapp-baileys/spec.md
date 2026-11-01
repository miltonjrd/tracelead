# WhatsApp via Baileys Specification

**Approved**: 2026-10-31 - user: "aprovo, vai pro design"

## Problem Statement

A conexão atual usa a Cloud API da Meta (app, webhook, App secret, Phone number ID). A configuração é difícil e o cliente final (a loja) não consegue fazê-la. O tracker só precisa receber mensagens para ler o ref e o telefone. A loja deve conectar o próprio número escaneando um QR code, sem conta Meta.

## Goals

- [ ] A loja conecta o WhatsApp em menos de 1 minuto, só com o celular e o QR code, sem tocar em configuração da Meta.
- [ ] Mensagens recebidas pela sessão Baileys geram o mesmo lead/venda rastreável que o webhook da Cloud API gera hoje.
- [ ] A Cloud API continua implementada e funcional, mas desligada por padrão.

## Out of Scope

| Feature | Reason |
| ------- | ------ |
| Enviar mensagens pelo Baileys | O tracker só recebe; enviar aumenta o risco de banimento |
| Aviso de risco de banimento na tela | Decisão do usuário: sem aviso |
| Mais de 5 lojas simultâneas | MVP testa 1 loja; limite de 5 sessões |
| Remover ou alterar a Cloud API | Decisão do usuário: manter implementada |
| Guardar texto das conversas | Mantém a regra atual: texto só serve para achar o ref |
| Processar histórico de conversas anteriores à conexão | Evita criar leads falsos de conversas antigas |

---

## Assumptions & Open Questions

| Assumption / decision | Chosen default | Rationale | Confirmed? |
| --------------------- | -------------- | --------- | ---------- |
| Modo de conexão padrão | `baileys` para clientes novos e para clientes sem Phone number ID; `cloud` fica selecionável | Usuário: "Baileys padrão, Cloud API implementada mas sem uso" | y |
| Aviso de risco | Nenhum | Usuário: "Sim, sem aviso" | y |
| Escala | Limite de 5 sessões ativas, configurável por `BAILEYS_MAX_SESSIONS` (padrão 5) | Usuário: "testa uma loja, suporta umas cinco" | y |
| Estado de autenticação | Guardado no SQLite, por cliente, incluído no backup diário | O volume `app_data` e o backup já existem; evita novo serviço | n |
| Biblioteca | `@whiskeysockets/baileys`; versão e tratamento de LID definidos no Design | Pesquisa: 7.0.0-rc é a última; precisa fixar versão | n |
| Quem gera o QR | A loja em `/painel`; o admin também vê o estado e pode desconectar em `/admin` | O objetivo é a loja se conectar sozinha | n |

**Open questions:** none - all resolved or logged above. As linhas com `n` são defaults para você corrigir ao aprovar.

---

## User Stories

### P1: A loja conecta o WhatsApp por QR code ⭐ MVP

**User Story**: Como loja, quero escanear um QR code no painel para conectar meu número, para não configurar nada na Meta.

**Why P1**: É a razão da mudança.

**Acceptance Criteria**:

1. WHEN a loja logada abre a tela de conexão em `/painel` e o modo do cliente é `baileys` THEN the system SHALL mostrar um QR code válido para escanear.
2. WHEN a loja escaneia o QR code com o WhatsApp THEN the system SHALL mostrar o estado "Conectado" e o número conectado em até 15 segundos.
3. WHILE o QR code está na tela the system SHALL renová-lo quando o WhatsApp emitir um novo.
4. WHILE o cliente está conectado the system SHALL mostrar "Conectado" em `/painel` e "Conectado" por cliente em Admin → Sistema.
5. WHEN a loja usa "Desconectar" THEN the system SHALL encerrar a sessão, apagar o estado de autenticação do cliente e mostrar "Desconectado".
6. IF o limite de sessões ativas já foi atingido THEN the system SHALL recusar uma nova conexão e mostrar a mensagem "Limite de conexões atingido".
7. IF o usuário de uma loja abre a tela de conexão de outro cliente THEN the system SHALL responder 403 sem mostrar o QR code.

**Independent Test**: Criar cliente em modo `baileys`, abrir a tela, ver o QR e o estado mudar para "Conectado" com um socket simulado.

---

### P1: Mensagens recebidas viram leads rastreados ⭐ MVP

**User Story**: Como dono do tracker, quero que mensagens recebidas pela sessão Baileys liguem o telefone ao clique do anúncio, para enviar conversões ao Google Ads.

**Why P1**: Sem isso a conexão não serve ao produto.

**Acceptance Criteria**:

1. WHEN a sessão de um cliente recebe uma mensagem de um contato individual contendo um ref válido THEN the system SHALL ligar o telefone ao clique, igual ao webhook da Cloud API.
2. WHEN a sessão recebe uma mensagem sem ref THEN the system SHALL registrar o contato sem clique associado, igual ao webhook da Cloud API.
3. The system SHALL descartar o texto da mensagem depois de procurar o ref.
4. WHEN a mensagem vem de grupo, de status/broadcast ou foi enviada pela própria loja THEN the system SHALL ignorá-la.
5. WHEN a mensagem faz parte da sincronização de histórico THEN the system SHALL ignorá-la.
6. IF a mesma mensagem chegar duas vezes THEN the system SHALL registrar o contato uma só vez.
7. IF o remetente só puder ser identificado por um ID sem telefone (LID não resolvido) THEN the system SHALL ignorar a mensagem e registrar um aviso no log.

**Independent Test**: Entregar um evento de mensagem simulado com ref e ver o contato ligado ao clique.

---

### P1: A sessão sobrevive a reinícios e quedas ⭐ MVP

**User Story**: Como loja, quero continuar conectada depois de um deploy ou queda de rede, sem escanear de novo.

**Why P1**: Reescanear a cada deploy repete a dor atual.

**Acceptance Criteria**:

1. WHEN o app reinicia THEN the system SHALL reabrir a sessão de cada cliente `baileys` com estado de autenticação salvo, sem pedir novo QR code.
2. IF a conexão cair por rede THEN the system SHALL tentar reconectar com espera crescente de 1 s até 60 s.
3. IF o WhatsApp encerrar a sessão (aparelho removido pelo celular) THEN the system SHALL apagar o estado de autenticação e mostrar "Desconectado, escaneie o QR code".
4. WHILE um cliente está desconectado por logout the system SHALL mostrar o estado em Admin → Sistema.
5. IF reabrir uma sessão falhar na inicialização THEN the system SHALL manter o app e as outras sessões no ar.

**Independent Test**: Parar e subir o gerenciador de sessões com estado salvo e ver a sessão reaberta sem QR.

---

### P2: Modo de conexão por cliente

**User Story**: Como admin, quero escolher por cliente entre `baileys` e `cloud`, para manter a Cloud API pronta.

**Why P2**: Mantém a Cloud API sem removê-la; o MVP já funciona com o padrão.

**Acceptance Criteria**:

1. WHERE o modo do cliente é `cloud` the system SHALL processar o webhook da Cloud API como hoje e não abrir sessão Baileys para ele.
2. WHERE o modo do cliente é `baileys` the system SHALL ignorar webhooks da Cloud API desse cliente.
3. WHEN o admin muda o modo por `update-client --whatsapp-mode <baileys|cloud>` THEN the system SHALL aplicar o modo e fechar a sessão Baileys se existir.
4. IF `--whatsapp-mode` receber outro valor THEN the system SHALL recusar com mensagem de erro.
5. The system SHALL exigir `META_APP_SECRET` e `META_VERIFY_TOKEN` apenas quando existir cliente em modo `cloud`.

**Independent Test**: Alternar o modo e ver qual caminho processa a mensagem.

---

## Edge Cases

- IF o QR code não for escaneado em 2 minutos THEN the system SHALL encerrar a tentativa e mostrar "QR expirado" com botão "Gerar novo QR".
- IF dois usuários da mesma loja abrirem a tela ao mesmo tempo THEN the system SHALL usar uma única sessão para o cliente.
- IF o estado de autenticação salvo estiver corrompido THEN the system SHALL apagá-lo e pedir novo QR code.

## Requirement Traceability

| Requirement ID | Story | Phase | Status |
| -------------- | ----- | ----- | ------ |
| WA-01 | P1: Conexão por QR (critérios 1-7) | Design | Pending |
| WA-02 | P1: Mensagens viram leads (critérios 1-7) | Design | Pending |
| WA-03 | P1: Sessão sobrevive (critérios 1-5) | Design | Pending |
| WA-04 | P2: Modo por cliente (critérios 1-5) | Design | Pending |

**Coverage:** 4 total, 0 mapped to tasks, 4 unmapped

---

## Sources

- Pedido do usuário nesta sessão - troca da Cloud API por Baileys como padrão, Cloud API mantida.
- `src/services/whatsapp.ts`, `src/services/tracking.ts` - `handleInboundMessage` é o ponto comum.
- [Baileys no npm](https://www.npmjs.com/package/@whiskeysockets/baileys) - última versão 7.0.0-rc.
- [Meta Embedded Signup](https://developers.facebook.com/documentation/business-messaging/whatsapp/embedded-signup/default-flow) - alternativa oficial descartada por ora.

---

## Success Criteria

- [ ] Uma loja de teste conecta pelo QR e uma mensagem com ref aparece como lead com clique ligado.
- [ ] Após reiniciar o container, a sessão volta sem novo QR.
- [ ] `npm test` passa, incluindo os testes atuais do webhook da Cloud API.
