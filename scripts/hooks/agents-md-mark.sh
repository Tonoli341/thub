#!/usr/bin/env bash
# PostToolUse su Read|Bash: registra la lettura di AGENTS.md, salvandone l'impronta.
#
# La marcatura e' volutamente stretta: valgono solo lo strumento Read su un file
# chiamato AGENTS.md, o un comando shell il cui PRIMO token e' un lettore noto con
# AGENTS.md tra gli argomenti. Una versione piu' permissiva si accontenterebbe di un
# `grep AGENTS.md` — o di uno script che la cita in un commento — e il gate
# diventerebbe una formalita'.
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

marca() {
  marcatore=$(percorso_marcatore "$sessione")
  mkdir -p "$(dirname "$marcatore")" 2>/dev/null || exit 0
  impronta_agents_md "$agents_md" > "$marcatore" 2>/dev/null || true
  # Igiene: i marcatori delle sessioni chiuse non servono piu'.
  find "$(dirname "$marcatore")" -type f -mtime +7 -delete 2>/dev/null || true
  exit 0
}

case "$strumento" in
  Read)
    percorso=$(printf '%s' "$payload" | jq -r '.tool_input.file_path // ""')
    case "$percorso" in
      */AGENTS.md|AGENTS.md) marca ;;
    esac
    ;;
  Bash)
    comando=$(printf '%s' "$payload" | jq -r '.tool_input.command // ""')
    prima_riga=${comando%%$'\n'*}
    lettore=${prima_riga%% *}
    lettore=${lettore##*/}
    case "$lettore" in
      cat|head|tail|less|more|bat|view|sed|awk|nl|fold|grep)
        case "$prima_riga" in
          *AGENTS.md*) marca ;;
        esac
        ;;
    esac
    ;;
esac
exit 0
