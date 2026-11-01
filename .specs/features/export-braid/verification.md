# Exportação de gbraid e wbraid verification

**Verdict**: FAIL
**Proofs**: `proofs.md` at c37cfa3
**Verifier**: independent sub-agent (author != verifier)

## Checks

| Check | Test | Holds |
| --- | --- | --- |
| C1 | `exportBraid.test.ts` `arquivo inclui itens com gclid, gbraid ou wbraid` | yes - lead and venda, one click per identifier, asserts the stored gclid/gbraid/wbraid per row |
| C2 | `exportBraid.test.ts` `CSV põe o gclid só na coluna Google Click ID quando o clique tem os três` | yes - asserts the full CSV line `G-1,,,...` |
| C3 | `exportBraid.test.ts` `CSV põe o gbraid só na coluna GBRAID quando não há gclid` | yes - full line `,GB-1,,...` with wbraid also on the click |
| C4 | `exportBraid.test.ts` `CSV põe o wbraid só na coluna WBRAID quando é o único` | yes - full line `,,WB-1,...` |
| C5 | `exportBraid.test.ts` `cabeçalho do CSV tem as sete colunas na ordem` | yes - exact header string |
| C6 | `exportBraid.test.ts` `segundo gerar arquivo não repete itens` | yes |
| C7 | `exportBraid.test.ts` `gbraid antigo fica fora do arquivo e conta como fora do prazo` | no - only 91 days was tested, so changing `<=` to `<` in `now - c.clickAt <= CLICK_MAX_AGE_MS` (exports.ts:92 and :122) kept it green; closed by the finding below |
| C8 | `exportBraid.test.ts` `arquivo gerado antes da mudança baixa no layout novo` | yes - exact old-row line `GCLID-ANTIGO,,,...` |
| C9 | `exportBraid.test.ts` `prontos conta gclid, gbraid e wbraid` | yes - tiles `[3, 3]` for leads and sales (no 90-day case, which C7 covers) |
| C10 | `exportBraid.test.ts` `aviso aparece para anúncio sem identificador` | yes - exact notice text with N=1, next to a gbraid contact that must not count |
| C11 | `exportBraid.test.ts` `aviso some quando todo anúncio tem identificador` | yes |
| C12 | `exportBraid.test.ts` `página explica a contagem Todas para gbraid e wbraid` | yes - exact text |
| C13 | `exportBraid.test.ts` `item sem identificador continua pendente` | yes - both tipos return null, no export row, and `exportadaEm` stays null on the contact and the sale |
| C14 | `exportBraid.test.ts` `tipos diferentes no mesmo arquivo caem cada um na sua coluna` | yes - three exact lines in one file |

## Findings

| Finding | Evidence | Fix | Closed |
| --- | --- | --- | --- |
| The 90-day boundary is untested: no test sits at exactly 90 days, so `<=` vs `<` is not held (spec AC 1: "no máximo 90 dias" includes day 90; AC 7: "mais de 90 dias" excludes it) | `exportBraid.test.ts:167-175` and `:221-231` use 89 and 91 days only. My probe at HEAD: a gbraid click at exactly 90 days is exported (correct), 90 days + 1 ms is `foraDoPrazo` (correct), so the code is right but no test would fail if it changed | add a test seeding a gbraid click at exactly 90 days (exported, counted in prontos) and at 90 days + 1 ms (left out, counted fora do prazo) | 30f8e97 - C7's test now seeds exactly 90 days and 90 days + 1 ms; swapping `<=` for `<` turns it red |

Other probes (no finding): empty-string and whitespace identifiers (clicks with `gclid=''` or `'  '`) pass `isNotNull`, so they are exported as rows with a blank or whitespace identifier, and the notice does not count them. `recordClick` (`tracking.ts:24`) trims and stores null for empty values, so this is unreachable through the app. A migration on 4 rows with a deleted id 5 keeps ids, gclid values and leaves foreign_key_check empty.
