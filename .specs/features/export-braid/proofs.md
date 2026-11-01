# export-braid proofs

**HEAD**: c55314c
**Tree**: clean
**Shell**: /bin/sh
**Result**: 16 pass, 0 fail

| Check | Proof | Result |
| --- | --- | --- |
| C1 | `run unit / ✔ arquivo inclui itens com gclid, gbraid ou wbraid` | pass |
| C2 | `run unit / ✔ CSV põe o gclid só na coluna Google Click ID quando o clique tem os três` | pass |
| C3 | `run unit / ✔ CSV põe o gbraid só na coluna GBRAID quando não há gclid` | pass |
| C4 | `run unit / ✔ CSV põe o wbraid só na coluna WBRAID quando é o único` | pass |
| C5 | `run unit / ✔ cabeçalho do CSV tem as sete colunas na ordem` | pass |
| C6 | `run unit / ✔ segundo gerar arquivo não repete itens` | pass |
| C7 | `run unit / ✔ gbraid antigo fica fora do arquivo e conta como fora do prazo` | pass |
| C8 | `run unit / ✔ arquivo gerado antes da mudança baixa no layout novo` | pass |
| C9 | `run unit / ✔ prontos conta gclid, gbraid e wbraid` | pass |
| C10 | `run unit / ✔ aviso aparece para anúncio sem identificador` | pass |
| C11 | `run unit / ✔ aviso some quando todo anúncio tem identificador` | pass |
| C12 | `run unit / ✔ página explica a contagem Todas para gbraid e wbraid` | pass |
| C13 | `run unit / ✔ item sem identificador continua pendente` | pass |
| C14 | `run unit / ✔ tipos diferentes no mesmo arquivo caem cada um na sua coluna` | pass |
| Build | `npm run build` | pass |
| Build | `npm run typecheck` | pass |

## Output

`Run unit` - exit 0

```
✔ qr não escaneado em 2 minutos expira (17.019545ms)
✔ duas conexões da mesma loja usam um socket (10.372599ms)
✔ login salvo corrompido pede qr novo (10.351283ms)
✔ mensagem recebida na sessão vira contato e reconcile fecha cliente que saiu do modo baileys (18.088809ms)
✔ close 500 mantém o login e reconecta com espera (29.746558ms)
✔ reinício acima do limite reabre só até o limite (20.508943ms)
✔ tela de conexão mostra cada estado (1.174962ms)
ℹ tests 81
ℹ suites 0
ℹ pass 81
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 8600.642504
```
