#!/usr/bin/env bash
# PreToolUse su Edit|Write|NotebookEdit|Bash: blocca finche' la versione CORRENTE
# di AGENTS.md non e' stata letta in questa sessione.
#
# Due scelte di progetto:
#
# 1. Deny-by-default su Bash. La versione precedente cercava i pattern di
#    scrittura (">", "sed -i", ...) e consentiva il resto: bastava un
#    `python3 - <<PY` che apre un file per aggirarla. Qui si consente solo cio'
#    che e' riconoscibilmente di sola lettura. Un falso positivo costa una
#    lettura di AGENTS.md — il blocco vale una volta per sessione — mentre un
#    falso negativo costava l'intera protezione.
#
# 2. Il marcatore contiene l'impronta di AGENTS.md. Se le regole cambiano, le
#    letture precedenti non valgono piu': chi sta lavorando sulla versione
#    vecchia viene rimandato al file.
#
# Fallisce APERTO se AGENTS.md non esiste o se manca jq: un gate rotto non deve
# impedire di lavorare in un checkout che non ha ancora il file.
set -uo pipefail

radice="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
agents_md="$radice/AGENTS.md"
[ -f "$agents_md" ] || exit 0
command -v jq >/dev/null 2>&1 || exit 0
# shellcheck source=/dev/null
. "$(dirname "${BASH_SOURCE[0]}")/agents-md-lib.sh"

payload=$(cat)
sessione=$(printf '%s' "$payload" | jq -r '.session_id // "sconosciuta"')
strumento=$(printf '%s' "$payload" | jq -r '.tool_name // ""')

if [ "$strumento" = "Bash" ]; then
  comando=$(printf '%s' "$payload" | jq -r '.tool_input.command // ""')
  comando_di_sola_lettura "$comando" && exit 0
fi

marcatore=$(percorso_marcatore "$sessione")
impronta_attuale=$(impronta_agents_md "$agents_md")
impronta_letta=""
[ -f "$marcatore" ] && impronta_letta=$(cat "$marcatore" 2>/dev/null)

if [ -n "$impronta_letta" ] && [ "$impronta_letta" = "$impronta_attuale" ]; then
  exit 0
fi

if [ -n "$impronta_letta" ]; then
  motivo="AGENTS.md è cambiato da quando l'hai letto in questa sessione.
Rileggilo prima di continuare: le regole che stai seguendo non sono più quelle correnti.
Poi ripeti questa operazione."
  breve="AGENTS.md modificato dopo la tua lettura: rileggilo."
else
  motivo="Prima di modificare file in questo progetto devi leggere AGENTS.md (nella radice del repo).
Definisce cosa è congelato, cosa richiede una proposta preventiva, quali pattern sono
accettati o rifiutati e i test di convalida obbligatori dopo ogni modifica.
Leggilo, poi ripeti questa operazione: il blocco vale una sola volta per sessione."
  breve="Operazione bloccata: AGENTS.md non ancora letto in questa sessione."
fi

jq -n --arg motivo "$motivo" --arg breve "$breve" '{
  hookSpecificOutput: {
    hookEventName: "PreToolUse",
    permissionDecision: "deny",
    permissionDecisionReason: $motivo
  },
  systemMessage: $breve
}'
exit 0
