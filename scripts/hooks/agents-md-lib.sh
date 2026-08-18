#!/usr/bin/env bash
# Funzioni condivise dai due hook di AGENTS.md.

# Impronta della versione corrente delle regole. Il marcatore la conserva, cosi'
# una modifica ad AGENTS.md invalida le letture precedenti: chi sta lavorando con
# la versione vecchia viene rimandato a rileggere.
impronta_agents_md() {
  local file="$1"
  sha256sum "$file" 2>/dev/null | cut -d' ' -f1
}

percorso_marcatore() {
  printf '%s/claude-agents-md/%s' "${TMPDIR:-/tmp}" "$1"
}

# Segmenti di un comando shell: separa su ; && || | e newline.
_segmenti() {
  printf '%s' "$1" | tr '\n' ';' | sed 's/&&/;/g; s/||/;/g; s/|/;/g' | tr ';' '\n'
}

# Sottocomandi git che non modificano nulla.
_git_sola_lettura() {
  case "$1" in
    status|log|diff|show|branch|remote|ls-files|ls-tree|rev-parse|describe|blame|\
check-ignore|shortlog|cat-file|grep|whatchanged|reflog|count-objects|var|help) return 0 ;;
    config) case " $* " in *" --get"*|*" --list"*|*" -l "*) return 0 ;; *) return 1 ;; esac ;;
    stash) case " $* " in *" list"*|*" show"*) return 0 ;; *) return 1 ;; esac ;;
    *) return 1 ;;
  esac
}

# Primi token consentiti: solo esplorazione e lettura. Volutamente stretto —
# interpreti (python, node), gestori di pacchetti e runner restano fuori, perche'
# possono scrivere file senza che il testo del comando lo riveli.
_TOKEN_LETTURA="ls cat head tail less more bat nl wc file stat du df pwd cd echo printf true false \
which type command env printenv date whoami id hostname uname jq yq grep egrep fgrep rg ag find fd \
sort uniq cut tr basename dirname realpath readlink diff cmp md5sum sha256sum cksum column tree seq \
test getent locale tty groups"

# 0 = il comando e' di sola lettura, 1 = puo' scrivere (o non e' riconosciuto).
comando_di_sola_lettura() {
  local comando="$1" normalizzato segmento token

  # Le redirezioni di silenziamento non sono scritture su file.
  normalizzato=$(printf '%s' "$comando" \
    | sed 's/2>&1//g; s/2>[[:space:]]*\/dev\/null//g; s/1\{0,1\}>[[:space:]]*\/dev\/null//g')

  # Qualunque altra redirezione, o un editor in place, e' una scrittura.
  case "$normalizzato" in
    *">"*|*"sed -i"*|*" tee "*|*"truncate "*|*"git apply"*|*"patch "*|*"dd "*) return 1 ;;
  esac

  while IFS= read -r segmento; do
    segmento="${segmento#"${segmento%%[![:space:]]*}"}"   # trim iniziale
    [ -z "$segmento" ] && continue
    token="${segmento%% *}"
    token="${token##*/}"
    case "$token" in
      git)
        # shellcheck disable=SC2086
        set -- $segmento
        shift
        _git_sola_lettura "$@" || return 1
        ;;
      sed)
        case "$segmento" in *"-i"*) return 1 ;; esac
        ;;
      awk)
        # awk puo' scrivere con print > "file": gia' intercettato dal check su ">".
        ;;
      xargs)
        return 1 ;;   # esegue un altro comando: non ispezionabile
      *)
        case " $_TOKEN_LETTURA " in
          *" $token "*) ;;
          *) return 1 ;;
        esac
        ;;
    esac
  done <<< "$(_segmenti "$normalizzato")"
  return 0
}
