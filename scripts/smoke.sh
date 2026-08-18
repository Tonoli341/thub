#!/usr/bin/env bash
# Smoke test sull'applicazione viva: verifica che OGNI sezione risponda.
#
# Nasce per intercettare il "Connection Refused" e la pagina bianca. Quando il
# backend non parte (import rotto, migrazione fallita, variabile mancante) nginx
# non ha nessuno a cui inoltrare: l'utente vede un errore di connessione, non un
# 500. Nessun test unitario se ne accorge, perche' i test montano l'app in
# memoria e non passano dal proxy.
#
# Uso:
#   ./scripts/smoke.sh                        # default http://localhost:8088
#   BASE_URL=http://thub.tonoli.com ./scripts/smoke.sh
#
# Esce 0 se tutto risponde, 1 al primo problema (riepilogo in coda).
# Non serve autenticazione: su un endpoint protetto un 401 e' un SUCCESSO,
# significa che l'app e' viva e il gate funziona.

set -uo pipefail

BASE_URL="${BASE_URL:-http://localhost:8088}"
TIMEOUT="${TIMEOUT:-15}"

verdi=0; rossi=0; saltati=0
FALLITI=()

c_ok=$'\033[32m'; c_ko=$'\033[31m'; c_sk=$'\033[33m'; c_off=$'\033[0m'
[ -t 1 ] || { c_ok=""; c_ko=""; c_sk=""; c_off=""; }

ok()   { printf '  %sOK%s    %-34s %s\n'   "$c_ok" "$c_off" "$1" "${2:-}"; verdi=$((verdi+1)); }
ko()   { printf '  %sKO%s    %-34s %s\n'   "$c_ko" "$c_off" "$1" "${2:-}"; FALLITI+=("$1: ${2:-}"); rossi=$((rossi+1)); }
skip() { printf '  %s--%s    %-34s %s\n'   "$c_sk" "$c_off" "$1" "${2:-}"; saltati=$((saltati+1)); }

# http <etichetta> <path> <codici attesi>
http() {
  local etichetta="$1" path="$2" attesi="$3" codice
  codice=$(curl -s -o /dev/null -w '%{http_code}' --max-time "$TIMEOUT" "$BASE_URL$path" 2>/dev/null)
  if [ "$codice" = "000" ]; then
    ko "$etichetta" "CONNECTION REFUSED su $path — il servizio non risponde"
    return
  fi
  if [[ " $attesi " == *" $codice "* ]]; then
    ok "$etichetta" "$codice  $path"
  else
    ko "$etichetta" "$path ha risposto $codice (attesi: $attesi)"
  fi
}

echo "Smoke test su $BASE_URL"

echo
echo "── Backend ─────────────────────────────────────────────────────────────"
http "health"            /health           "200"
http "health ready"      /api/health/ready "200"
# Nota: /api/docs NON e' raggiungibile da nginx (FastAPI espone Swagger su /docs,
# che nginx instrada al frontend). Non e' un guasto: e' la configurazione attuale.

echo
echo "── Sezioni frontend ────────────────────────────────────────────────────"
# In dev il server Vite trasforma ogni modulo su richiesta: se una pagina non
# compila risponde 500, e quello e' esattamente l'errore che l'utente vedrebbe
# come schermata bianca. Se invece torna HTML, siamo in build statica (prod):
# li' la compilazione e' gia' stata validata da `npm run build`.
sonda=$(curl -s --max-time "$TIMEOUT" "$BASE_URL/src/main.jsx" 2>/dev/null | head -c 40)
if [ -z "$sonda" ]; then
  ko "server frontend" "nessuna risposta su /src/main.jsx — frontend giu'?"
elif [[ "$sonda" == "<!doctype"* || "$sonda" == "<!DOCTYPE"* ]]; then
  skip "modalita' build statica" "compilazione gia' validata da npm run build"
  http "shell SPA" / "200"
else
  for pagina in \
    ActiveActivitiesPage AuditLogPage CalendarPage ConsegnePage DailyRecordsPage \
    DashboardPage DeliverySignaturePage EmployeesPage EndpointsPage \
    FunctionsDepartmentsPage IntegrationsPage LdapEmployeesPage LoginPage \
    OperationalAreasPage OperationalReportingDashboardPage OperationalReportingPage \
    OrgChartPage PlannerPage ProjectsPage SquadrePage SystemStatusPage \
    TimesheetDashboardPage TimesheetListPage ToolChangesPage TrainingConfigPage \
    WorkloadPage \
  ; do
    risposta=$(curl -s -w '\n%{http_code}' --max-time "$TIMEOUT" "$BASE_URL/src/pages/$pagina.jsx" 2>/dev/null)
    codice="${risposta##*$'\n'}"
    corpo="${risposta%$'\n'*}"
    if [ "$codice" = "000" ]; then
      ko "$pagina" "CONNECTION REFUSED"
    elif [ "$codice" = "500" ]; then
      ko "$pagina" "errore di compilazione: $(printf '%s' "$corpo" | head -c 160)"
    elif [[ "$corpo" == "<!doctype"* || "$corpo" == "<!DOCTYPE"* ]]; then
      ko "$pagina" "modulo non trovato (risposta HTML di fallback) — file rinominato o rimosso?"
    else
      ok "$pagina" "compila"
    fi
  done
fi

echo
echo "── Endpoint API (401 = vivo e protetto) ────────────────────────────────"
http "auth/me"                 /api/auth/me                    "401"
http "dashboard"               /api/dashboard                  "401 422"
http "dipendenti"              /api/employees                  "401"
http "assegnazioni"            /api/assignments                "401 422"
http "assenze"                 /api/absence-requests           "401"
http "saldi assenze"           /api/absence-balances           "401 422"
http "consegne"                /api/deliveries                 "401"
http "consegne dispositivi"    /api/device-deliveries          "401"
http "squadre"                 /api/teams                      "401"
http "aree operative"          /api/operational-areas          "401"
http "audit"                   /api/audit-logs                 "401"
http "carichi"                 /api/workloads/teams            "401 422"
http "timer attivi"            /api/activity-records/active    "401"
http "record giornalieri"      /api/daily-records              "401"
http "integrazioni"            /api/system/integrations/office365 "401"
http "modifiche tool"          /api/tool-changes               "401 422"
http "commesse Jupiter"        /api/projects                   "401 422"

echo
echo "────────────────────────────────────────────────────────────────────────"
if [ "$rossi" -eq 0 ]; then
  echo "${c_ok}OK${c_off}: $verdi controlli superati${saltati:+, $saltati saltati}. Tutte le sezioni rispondono."
  exit 0
fi

echo "${c_ko}FALLITO${c_off}: $rossi problemi su $((verdi + rossi)) controlli."
for f in "${FALLITI[@]}"; do echo "  - $f"; done
cat <<'AIUTO'

Se vedi CONNECTION REFUSED il servizio e' giu'. Nell'ordine:
  docker compose logs --tail=80 backend
  cd backend && ./.venv/bin/python -c 'import app.main'   # riproduce l'import rotto
La causa piu' frequente e' un errore di import o di sintassi introdotto
dall'ultima modifica: uvicorn muore all'avvio e nginx non ha piu' un upstream.
AIUTO
exit 1
