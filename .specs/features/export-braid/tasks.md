# Exportação de gbraid e wbraid Tasks

## Execution Protocol (MANDATORY -- do not skip)

Implement these tasks with the `tlc-spec-driven` skill: **activate it by name and follow its Execute flow and Critical Rules.** Do not search for skill files by filesystem path. The skill is the source of truth for the full flow (per-task cycle, sub-agent delegation, the walk, check_proofs, the Verifier and the screens sub-agent).

**If the skill cannot be activated, STOP and tell the user - do not proceed without it.**

---

**Design**: none - decisões de design abaixo, inline (mudança de uma tabela, um serviço e uma view)
**Status**: In Progress
**Approved**: 2026-10-31 - user: "aprovo, pode começar pela T1"
**Build**: `npm run build; npm run typecheck`
**Run unit**: `npm test`

**Decisões de design (inline):**
- `exports` ganha as colunas `gbraid` e `wbraid` (nullable) e `gclid` deixa de ser `NOT NULL`. Cada linha guarda um só identificador, o escolhido por `gclid > gbraid > wbraid`.
- A escolha acontece em `src/services/exports.ts`, uma vez, na função que monta os candidatos; stats e arquivo usam o mesmo resultado.
- `exportStats` troca `anuncioSemGclid` por `anuncioSemIdentificador` (contatos de anúncio cujo clique não tem `gclid`, `gbraid` nem `wbraid`).
- `exportFileCsv` escreve sempre o layout de 7 colunas, também para linhas antigas.

---

## Test Coverage Matrix

> Generated from codebase and spec - confirm before Execute. Guidelines found: none (sem `AGENTS.md`, `CONTRIBUTING.md` ou limite de cobertura) - strong defaults applied. Amostra: `test/flow.test.ts`, `test/whatsappSchema.test.ts`, `test/unit.test.ts`.

| Code Layer | Required Test Type | Coverage Expectation | Location Pattern | Run Command |
| ---------- | ------------------ | -------------------- | ---------------- | ----------- |
| Schema / migração | unit | A migração preserva linhas antigas e aceita gbraid/wbraid sem gclid | `test/*.test.ts` | `npm test` |
| Serviço (`src/services/exports.ts`) | unit | Todos os ramos; 1:1 com os critérios da spec; todos os edge cases | `test/exportBraid.test.ts` | `npm test` |
| Rota admin + view (`src/routes/admin.ts`, `src/views/admin.ts`) | integration | Painel e download pela rota: caminho feliz e cada edge case listado | `test/exportBraid.test.ts`, `test/flow.test.ts` | `npm test` |

## Gate Check Commands

> Generated from `package.json` - confirm before Execute.

| Gate Level | When to Use | Command |
| ---------- | ----------- | ------- |
| Quick | Tarefas só de serviço ou schema | `npx tsx --test test/exportBraid.test.ts` |
| Full | Tarefas que tocam rota ou view | `npm test` |
| Build | Fim de cada fase e de tarefa de config | `npm run build; npm run typecheck; npm test` |

---

## Execution Plan

### Phase 1: Exportação de ponta a ponta

```
T1 → T2 → T3 → T4 → T5
```

---

## Task Breakdown

### T1: Colunas gbraid e wbraid em exports

**What**: Tornar `exports.gclid` nullable, adicionar `exports.gbraid` e `exports.wbraid` e gerar a migração `0002_export_braid`.
**Where**: `src/db/schema.ts`
**Depends on**: None
**Reuses**: padrão de `drizzle/0001_whatsapp_baileys.sql` e de `test/whatsappSchema.test.ts`
**Requirement**: BRAID-01

**Done when**:

- [x] `npx drizzle-kit generate --name export_braid` cria `drizzle/0002_export_braid.sql` e o snapshot em `drizzle/meta`
- [x] Um banco com a migração 0000 e 0001 e uma exportação antiga com `gclid` mantém a linha intacta depois da 0002
- [x] Depois da 0002, uma exportação com só `gbraid` (sem `gclid`) é aceita
- [x] Gate check passes: `npx tsx --test test/exportBraid.test.ts`
- [x] Test count: 2 tests pass (no silent deletions)

**Tests**: unit
**Gate**: quick

**Commit**: `feat(exports): add gbraid and wbraid columns`

---

### T2: Candidatos de exportação com prioridade gclid > gbraid > wbraid

**What**: `leadCandidates`, `saleCandidates` e `createExportFile` aceitam cliques com qualquer um dos três identificadores, escolhem um só pela prioridade e gravam em `exports` a coluna escolhida.
**Where**: `src/services/exports.ts`
**Depends on**: T1
**Reuses**: `candidates()` e a transação de `createExportFile`
**Requirement**: BRAID-01, BRAID-03

**Done when**:

- [x] Lead e venda com clique `gclid`, `gbraid` ou `wbraid` dentro de 90 dias entram no arquivo
- [x] Clique com os três identificadores grava só o `gclid`; com `gbraid` e `wbraid`, só o `gbraid`; só com `wbraid`, o `wbraid`
- [x] Clique de mais de 90 dias com `gbraid` fica fora do arquivo
- [x] Item cujo clique não tem nenhum identificador continua pendente, sem erro
- [x] Segundo `createExportFile` não repete os itens do primeiro
- [x] Gate check passes: `npx tsx --test test/exportBraid.test.ts`
- [x] Test count: 9 tests pass (no silent deletions)

**Tests**: unit
**Gate**: quick

**Commit**: `feat(exports): export gbraid and wbraid conversions`

---

### T3: Contagem e aviso do painel por identificador

**What**: `exportStats` conta como prontos e fora do prazo os itens com qualquer identificador e devolve `anuncioSemIdentificador`; a página de exportações mostra o novo aviso só quando esse número é maior que zero.
**Where**: `src/services/exports.ts`, `src/views/admin.ts`
**Depends on**: T2
**Reuses**: `exportsPage` e o `stats` já passado por `src/routes/admin.ts`
**Requirement**: BRAID-01, BRAID-04

**Done when**:

- [ ] Um contato só com `gbraid` conta em "prontos para enviar" na página de exportações
- [ ] Um `gbraid` com clique de mais de 90 dias fica fora do arquivo e conta em "fora do prazo"
- [ ] Contato de anúncio sem nenhum identificador mostra "N contato(s) de anúncio chegaram sem identificador de clique (gclid, gbraid ou wbraid). Eles aparecem no relatório, mas não entram no arquivo."
- [ ] Quando todos os contatos de anúncio têm identificador, o aviso não aparece
- [ ] Gate check passes: `npm test`
- [ ] Test count: 13 tests pass in `test/exportBraid.test.ts` (no silent deletions)

**Tests**: integration
**Gate**: full

**Commit**: `feat(exports): count braid conversions and update the panel notice`

---

### T4: CSV com as colunas Google Click ID, GBRAID e WBRAID

**What**: `exportFileCsv` escreve o cabeçalho de 7 colunas e preenche, em cada linha, só a coluna do identificador gravado; atualiza o teste existente do CSV em `test/flow.test.ts` para o novo cabeçalho.
**Where**: `src/services/exports.ts`
**Depends on**: T3
**Reuses**: `toCsv` de `src/lib/csv.ts`
**Requirement**: BRAID-02

**Done when**:

- [ ] A linha 2 do CSV é `Google Click ID,GBRAID,WBRAID,Conversion Name,Conversion Time,Conversion Value,Conversion Currency`
- [ ] Clique com os três identificadores sai só em `Google Click ID`; com `gbraid` e `wbraid`, só em `GBRAID`; só com `wbraid`, só em `WBRAID`
- [ ] Linhas de tipos diferentes no mesmo arquivo caem cada uma na sua coluna
- [ ] Um arquivo gerado antes da mudança baixa no layout novo, com `GBRAID` e `WBRAID` vazios
- [ ] `test/flow.test.ts` espera o novo cabeçalho e as linhas com as colunas vazias
- [ ] Gate check passes: `npm test`
- [ ] Test count: 19 tests pass in `test/exportBraid.test.ts` (no silent deletions)

**Tests**: integration
**Gate**: full

**Commit**: `feat(exports): write GBRAID and WBRAID columns in the CSV`

---

### T5: Instrução sobre contagem "Todas" na página de exportações

**What**: A página de exportações mostra o texto sobre a contagem da ação de conversão.
**Where**: `src/views/admin.ts`
**Depends on**: T4
**Reuses**: o parágrafo `muted small` de instruções de `exportsPage`
**Requirement**: BRAID-05

**Done when**:

- [ ] A página mostra "Conversões com gbraid ou wbraid exigem que a ação de conversão no Google Ads esteja com a contagem em “Todas”."
- [ ] Gate check passes: `npm run build; npm run typecheck; npm test`
- [ ] Test count: 20 tests pass in `test/exportBraid.test.ts` (no silent deletions)

**Tests**: integration
**Gate**: build

**Commit**: `feat(exports): explain the conversion count setting for braid`

---

## Checks

**C1** - Lead e venda de cliques com `gclid`, `gbraid` ou `wbraid` dentro de 90 dias entram no arquivo (BRAID-01, AC 1)
Proof: run unit | ✔ arquivo inclui itens com gclid, gbraid ou wbraid

**C2** - Clique com `gclid` e `gbraid` sai só na coluna `Google Click ID` (BRAID-01, AC 2)
Proof: run unit | ✔ CSV põe o gclid só na coluna Google Click ID quando o clique tem os três

**C3** - Clique com `gbraid` e `wbraid` sai só na coluna `GBRAID` (BRAID-01, AC 3)
Proof: run unit | ✔ CSV põe o gbraid só na coluna GBRAID quando não há gclid

**C4** - Clique só com `wbraid` sai na coluna `WBRAID` (BRAID-01, AC 4)
Proof: run unit | ✔ CSV põe o wbraid só na coluna WBRAID quando é o único

**C5** - O cabeçalho do CSV tem as 7 colunas na ordem `Google Click ID,GBRAID,WBRAID,Conversion Name,Conversion Time,Conversion Value,Conversion Currency` (BRAID-02, AC 5)
Proof: run unit | ✔ cabeçalho do CSV tem as sete colunas na ordem

**C6** - Um segundo "Gerar arquivo" não inclui itens já exportados (BRAID-03, AC 6)
Proof: run unit | ✔ segundo gerar arquivo não repete itens

**C7** - `gbraid` com clique de mais de 90 dias fica fora do arquivo e conta em "fora do prazo" (BRAID-01, AC 7)
Proof: run unit | ✔ gbraid antigo fica fora do arquivo e conta como fora do prazo

**C8** - Um arquivo gerado antes da mudança baixa no layout novo, com `GBRAID` e `WBRAID` vazios (BRAID-02, AC 8)
Proof: run unit | ✔ arquivo gerado antes da mudança baixa no layout novo

**C9** - Itens com `gclid`, `gbraid` ou `wbraid` dentro de 90 dias contam em "prontos para enviar" (BRAID-04, AC 1)
Proof: run unit | ✔ prontos conta gclid, gbraid e wbraid

**C10** - Contato de anúncio sem identificador mostra o aviso "N contato(s) de anúncio chegaram sem identificador de clique (gclid, gbraid ou wbraid)..." (BRAID-04, AC 2)
Proof: run unit | ✔ aviso aparece para anúncio sem identificador

**C11** - Sem contatos de anúncio sem identificador, o aviso não aparece (BRAID-04, AC 3)
Proof: run unit | ✔ aviso some quando todo anúncio tem identificador

**C12** - A página de exportações mostra a instrução sobre a contagem em “Todas” (BRAID-05, AC 1)
Proof: run unit | ✔ página explica a contagem Todas para gbraid e wbraid

**C13** - Item com clique sem nenhum identificador continua pendente e fora do arquivo, sem erro (BRAID-01, edge case)
Proof: run unit | ✔ item sem identificador continua pendente

**C14** - Itens com identificadores de tipos diferentes no mesmo arquivo caem cada um na sua coluna (BRAID-02, edge case)
Proof: run unit | ✔ tipos diferentes no mesmo arquivo caem cada um na sua coluna

---

## Handoff

**Settled mid-build:** none (ajuste do agente, sem decisão do usuário: os testes de coluna C2-C4 passaram da T2 para a T4, porque a coluna só existe no CSV; as contagens de teste de T3-T5 passaram a ser o total de `test/exportBraid.test.ts`)
**Dispatched:** none
**Walked:** none
