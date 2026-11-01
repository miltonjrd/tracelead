# Exportação de gbraid e wbraid Specification

**Approved**: [written when the user approves]

## Problem Statement

O CSV de conversões offline só inclui contatos e vendas cujo clique tem `gclid`. Cliques de iPhone (iOS 14+, privacidade) chegam só com `gbraid` ou `wbraid`: o contato aparece no relatório como anúncio, mas nunca entra no arquivo, e o Google Ads não recebe a conversão. O painel já avisa que esses contatos ficam de fora.

## Goals

- [ ] Todo lead e toda venda cujo clique tem `gclid`, `gbraid` ou `wbraid` entra no arquivo de exportação, dentro da janela de 90 dias.
- [ ] O fluxo do usuário não muda: um botão "Gerar arquivo" por tipo de conversão, um arquivo gerado.
- [ ] Nenhuma conversão é exportada duas vezes nem com mais de um identificador.

## Out of Scope

| Feature | Reason |
| ------- | ------ |
| Enhanced Conversions for Leads (telefone em hash) | Mudança maior, outro identificador; cobre quem veio sem nenhum identificador de clique |
| Upload automático pela API do Google Ads | O fluxo continua manual: baixar o CSV e subir em Metas → Conversões → Uploads |
| Arquivos separados por identificador | Decisão do usuário: um arquivo, três colunas |
| Coletar `gbraid`/`wbraid` no `t.js` | Já coletados e guardados em `clicks` |
| Reexportar arquivos já gerados | Linhas já exportadas ficam marcadas e não voltam |
| Conversão de contatos sem nenhum identificador (só `utm_medium=cpc`) | Sem identificador de clique não há o que enviar ao Google |

---

## Assumptions & Open Questions

| Assumption / decision | Chosen default | Rationale | Confirmed? |
| --------------------- | -------------- | --------- | ---------- |
| Organização do CSV | Um arquivo por tipo de conversão, com as colunas `Google Click ID`, `GBRAID` e `WBRAID`; cada linha preenche uma só | Usuário: "Um arquivo, 3 colunas (Recomendado)" | y |
| Prioridade quando o clique tem mais de um identificador | `gclid`, depois `gbraid`, depois `wbraid`; a conversão vai com um só | Usuário: "gclid, depois gbraid, depois wbraid (Recomendado)" | y |
| Cabeçalhos `GBRAID` e `WBRAID` | Esses nomes, ao lado de `Google Click ID`, que a página do Google manda manter | A documentação não confirma os cabeçalhos do CSV; o primeiro upload com um gbraid real valida | n |
| Ordem das colunas | `Google Click ID` primeiro, depois `GBRAID`, `WBRAID`, depois as colunas atuais | A página do Google avisa para não remover a coluna que começa com "Google Click ID" | n |
| Arquivos já gerados antes da mudança | Baixam no novo layout, com `GBRAID` e `WBRAID` vazios | Só há um layout de renderização; as linhas antigas têm `gclid` | n |
| Contagem de conversão no Google Ads | O painel avisa que a ação de conversão precisa estar em "Every" para aceitar BRAID | Google: sem "Every" o upload pode dar erro | n |
| Janela de 90 dias | Vale para os três identificadores, contada a partir do clique | Regra atual do `gclid`; o Google não documenta janela própria para BRAID | n |

**Open questions:** none - all resolved or logged above. As linhas com `n` são defaults para você corrigir ao aprovar.

---

## User Stories

### P1: Exportar conversões de cliques com gbraid ou wbraid ⭐ MVP

**User Story**: Como operador do tracker, quero que leads e vendas de cliques de iPhone entrem no CSV do Google Ads, para o Google atribuir essas conversões ao anúncio.

**Why P1**: É a razão da mudança: hoje essas conversões se perdem.

**Acceptance Criteria**:

1. WHEN o operador usa "Gerar arquivo" de Leads ou de Vendas THEN the system SHALL incluir no arquivo cada item pendente cujo clique tem `gclid`, `gbraid` ou `wbraid` e foi feito há no máximo 90 dias.
2. WHEN o clique de um item tem `gclid` THEN the system SHALL preencher só a coluna `Google Click ID` da linha, mesmo que o clique também tenha `gbraid` ou `wbraid`.
3. WHEN o clique de um item não tem `gclid` e tem `gbraid` THEN the system SHALL preencher só a coluna `GBRAID` da linha, mesmo que o clique também tenha `wbraid`.
4. WHEN o clique de um item não tem `gclid` nem `gbraid` e tem `wbraid` THEN the system SHALL preencher só a coluna `WBRAID` da linha.
5. The system SHALL escrever o cabeçalho do CSV com as colunas `Google Click ID`, `GBRAID`, `WBRAID`, `Conversion Name`, `Conversion Time`, `Conversion Value` e `Conversion Currency`, nessa ordem.
6. WHEN um arquivo é gerado THEN the system SHALL marcar os itens incluídos como exportados, de modo que um segundo "Gerar arquivo" não os inclua de novo.
7. IF o clique de um item tem `gbraid` ou `wbraid` e foi feito há mais de 90 dias THEN the system SHALL deixá-lo fora do arquivo e contá-lo em "fora do prazo".
8. WHEN o operador baixa um arquivo gerado antes desta mudança THEN the system SHALL entregá-lo no novo layout, com `GBRAID` e `WBRAID` vazios nas linhas antigas.

**Independent Test**: Criar um clique só com `gbraid`, um contato e uma venda ligados a ele, gerar o arquivo de Vendas e ver uma linha com a coluna `GBRAID` preenchida e as outras duas identificações vazias.

---

### P2: Painel reflete os novos identificadores

**User Story**: Como operador, quero que a contagem e o aviso do painel reflitam o que realmente entra no arquivo, para não achar que há conversões perdidas quando não há.

**Why P2**: O aviso atual diz que contatos só com gbraid/wbraid ficam de fora, o que deixa de ser verdade.

**Acceptance Criteria**:

1. The system SHALL contar em "prontos para enviar" os itens com `gclid`, `gbraid` ou `wbraid` dentro de 90 dias.
2. WHEN existem contatos de anúncio cujo clique não tem `gclid`, `gbraid` nem `wbraid` THEN the system SHALL mostrar o aviso "N contato(s) de anúncio chegaram sem identificador de clique (gclid, gbraid ou wbraid). Eles aparecem no relatório, mas não entram no arquivo."
3. WHEN todos os contatos de anúncio têm ao menos um identificador THEN the system SHALL omitir o aviso de contatos sem identificador.
4. The system SHALL mostrar na página de exportações o texto "Conversões com gbraid ou wbraid exigem que a ação de conversão no Google Ads esteja com a contagem em “Todas”."

**Independent Test**: Abrir a página de exportações com um contato só com `gbraid`: ele conta em "prontos" e o aviso de "sem identificador" não aparece.

---

## Edge Cases

- IF o clique de um item tem os três identificadores THEN the system SHALL exportar só o `gclid`.
- IF um item pendente tem clique sem nenhum dos três identificadores THEN the system SHALL mantê-lo pendente e fora do arquivo, sem erro.
- IF não há nenhum item exportável THEN the system SHALL responder "Não há nada pronto para exportar." e não criar arquivo.
- WHEN dois itens do mesmo arquivo usam identificadores de tipos diferentes THEN the system SHALL colocar cada um na sua coluna, no mesmo arquivo.

---

## Requirement Traceability

| Requirement ID | Story | Phase | Status |
| -------------- | ----- | ----- | ------ |
| BRAID-01 | P1: Exportar conversões (critérios 1-4, 7) | Specify | Pending |
| BRAID-02 | P1: Exportar conversões (critérios 5, 8) | Specify | Pending |
| BRAID-03 | P1: Exportar conversões (critério 6) | Specify | Pending |
| BRAID-04 | P2: Painel (critérios 1-3) | Specify | Pending |
| BRAID-05 | P2: Painel (critério 4) | Specify | Pending |

**Coverage:** 5 total, 0 mapped to tasks, 5 unmapped ⚠️

---

## Sources

- Pedido do usuário - exportar `gbraid` e `wbraid` no CSV de conversões offline.
- [Importar conversões de cliques por arquivo (legado)](https://support.google.com/google-ads/answer/7014069) - mantém a coluna `Google Click ID`; não documenta cabeçalhos de gbraid/wbraid.
- [How to upgrade offline imports](https://support.google.com/google-ads/answer/15479791) - gclid e gbraid na mesma linha sem erro desde 2025-10-03; BRAID exige contagem "Every".
- [Data Manager: campos de conversão offline](https://support.google.com/google-ads-data-manager/answer/14184381) - lista `GCLID`, `GBRAID` e `WBRAID` como campos separados.

---

## Success Criteria

- [ ] Uma venda de um clique só com `gbraid` aparece no CSV, na coluna `GBRAID`.
- [ ] Nenhuma conversão aparece em mais de uma coluna nem em mais de um arquivo.
- [ ] O aviso do painel nunca cita contatos que o arquivo de fato inclui.
