# Layout delle pagine — regole comuni

Regole di layout valide per **tutte** le pagine di `frontend/src/pages/`, decise il
2026-08-18 per uniformare 26 schermate che avevano ciascuna la propria testata, la
propria barra filtri e il proprio stile di tabella.

## Le 7 regole

1. **Prima banda in alto con il titolo della sezione.**
2. **Nessun filtro nella banda del titolo.**
3. **Tutti i filtri, se servono, in una seconda barra sotto la banda**, mantenendo forma
   e colori standard dei controlli (`outlined`, `size="small"`): la barra uniforma le
   dimensioni, non ricolora nulla.
4. **Filtri a tendina con ricerca durante la digitazione**, dove le opzioni sono più di
   una manciata.
5. **Stessi colori, font e formato grafico su tutte le pagine.**
6. **Le tabelle si adattano alla pagina e a schermi di dimensioni diverse.**
7. **Grafica, colori e dimensioni uniformi** in generale.

## Componenti da usare

| Componente | Regola | Note |
|---|---|---|
| [`PageHeader`](../frontend/src/components/PageHeader.jsx) | 1, 2 | `section`, `title`, `meta` (contatori a destra), `actions`. Non ha uno slot filtri **di proposito**: è la regola 2 resa impossibile da violare. `HeaderButton` è il pulsante di azione della banda |
| [`FilterBar`](../frontend/src/components/FilterBar.jsx) | 3, 6 | Contenitore dei filtri, con "Azzera filtri" via `onReset`. I filtri si restringono insieme invece di generare scroll orizzontale |
| [`FilterSelect`](../frontend/src/components/FilterSelect.jsx) | 4 | `Autocomplete` preconfigurato da usare **al posto di `<Select>` / `<TextField select>`**. Stessa forma di un TextField outlined, ma l'elenco si filtra mentre si scrive. Si dimensiona da solo sull'opzione più lunga (vedi sotto) |
| [`filterWidth`](../frontend/src/components/filterWidth.js) | 4, 7 | `filterBasis()`: larghezza del filtro stimata dal contenuto, fra 170 e 340px |
| [`tableStyles`](../frontend/src/components/tableStyles.js) | 6 | `tableSx`, `headRowSx`, `bodyRowSx`, `stickyFirstColumnSx` |
| [`pageTokens`](../frontend/src/components/pageTokens.js) | 5, 7 | Gradiente della banda, altezza e larghezza dei controlli filtro |

## Filtri: larghi quanto il loro contenuto

Un filtro di larghezza fissa tronca proprio il testo che serve per scegliere: il menu
*Squadra* di **Carichi** a 190px taglia `📦 Team Magazzino CROSS-DOCKING`. Perciò:

- `FilterSelect` calcola il proprio `flex-basis` con `filterBasis()` sull'etichetta più
  lunga fra le opzioni, e lo pubblica come variabile CSS `--filter-basis`;
- `FilterBar` la legge (`flex: 1 1 var(--filter-basis, 190px)`), così i filtri **crescono
  nello spazio libero** invece di restare fissi, con un tetto di 340px perché un solo
  filtro non si prenda tutta la riga;
- restano comunque comprimibili fino a 130px quando la riga è piena: la regola 6 vale
  anche per la barra dei filtri, non solo per le tabelle;
- la tendina aperta si dimensiona sulle opzioni (`popper` a `width: fit-content`), quindi
  l'etichetta lunga resta leggibile anche se il campo chiuso la tronca.

Effetto misurato: *Carichi › Squadra* passa da 190 a 298px, i due filtri di *Audit* a
199px, un filtro con opzioni corte scende a 170px.

## Notifiche nella banda

`PageHeader` include **sempre** la campanella delle notifiche (`NotificationsBell`), la
stessa che sta sulla banda della Home: deve trovarsi nello stesso punto in ogni sezione.
`bell={false}` solo per una banda che ne ospita già una propria — oggi il solo caso è
[DashboardPage](../frontend/src/pages/DashboardPage.jsx), che ha la sua banda e non usa
ancora `PageHeader`.

## Tabelle: perché il layout fisso

Con il layout automatico una tabella si allarga finché ogni cella sta su una riga. Su un
14" la sidebar da 240px più i padding di pagina lasciano **meno di 900px**: le ultime
colonne finiscono fuori schermo. Perciò:

- `sx={tableSx({ minWidth })}` → `table-layout: fixed`;
- ogni colonna dichiara una **percentuale**, e le percentuali **devono sommare a 100**;
- l'elenco colonne sta in un modulo `.js` a parte (`squadreColumns.js`, `auditColumns.js`,
  `dailyRecordsColumns.js`) con un test `node:test` che verifica la somma. È l'invariante
  che tiene in piedi il layout: chi aggiunge una colonna senza ribilanciare fa sbordare
  di nuovo l'ultima, e il test lo intercetta;
- i testi lunghi si troncano con l'ellissi e riportano il valore pieno in `title`;
- `minWidth` è la soglia sotto la quale si preferisce lo scroll orizzontale alla
  compressione.

Quando la colonna identificativa continua a essere troppo stretta, il passo prima
dello scroll è **ridurre a icona le colonne codificate** (un ruolo, uno stato): l'icona
resta, il testo passa nel `title`/tooltip. In *Dipendenti* è così per *Ruolo* e *Ruolo
portale*, che insieme scendono a 15% e restituiscono larghezza al nome.

**Oltre ~10 colonne la tabella non entra in 900px**, nemmeno con il layout fisso: le sole
intestazioni ne occupano già la metà. In quel caso si aggiunge `stickyFirstColumnSx`: la
pagina non sborda comunque (lo scroll resta dentro il `TableContainer`) e la colonna
identificativa resta visibile mentre si scorre. È il caso di *Presenze*.

## Stato della migrazione

Tutte le 24 pagine applicative usano `PageHeader`. Restano fuori perimetro `LoginPage` e
`DeliverySignaturePage` (login e flusso firma da tablet, layout a schermo intero).

| Gruppo | Pagine |
|---|---|
| Banda + filtri + tabella adattiva | `SquadrePage`, `AuditLogPage`, `DailyRecordsPage`, `LdapEmployeesPage`, `ActiveActivitiesPage`, `TimesheetListPage`, `EmployeesPage` |
| Banda + filtri | `WorkloadPage`, `ToolChangesPage`, `TrainingConfigPage`, `OperationalAreasPage`, `OperationalReportingPage`, `OperationalReportingDashboardPage`, `ConsegnePage`, `PlannerPage`, `CalendarPage`, `OrgChartPage` |
| Sola banda (nessun filtro in pagina) | `DashboardPage`, `SystemStatusPage`, `IntegrationsPage`, `EndpointsPage`, `FunctionsDepartmentsPage`, `ProjectsPage`, `TimesheetDashboardPage`, `MaintenancePage` |

### Cosa resta aperto

- **Campi `<Select>` nei dialog**, non convertiti a `FilterSelect`: 7 in `PlannerPage`
  (Tipo, Titolo corso, Building, Immobile), 2 in `ProjectsPage` (Tipo campo, Sorgente
  MSSQL), 1 in `TrainingConfigPage` (Macro area). La regola 4 parla di **filtri**: questi
  sono campi di inserimento con poche opzioni. Convertirli è un miglioramento possibile,
  non un debito.
- **Tabelle senza colonne in percentuale**: `ConsegnePage` (4 tabelle), `ProjectsPage`,
  e le tabelle di dettaglio del profilo dipendente. Usano `tableSx` dove era già presente
  un `minWidth`, ma non hanno ancora un modulo colonne con il test sulla somma.
  L'elenco principale di *Dipendenti* è invece migrato (`employeesColumns.js`): le sue
  larghezze devono sommare a 100 **in due varianti**, perché la colonna "impersona"
  compare solo per chi può impersonare.
- **`ConsegnePage` ha perso il gradiente per area** (DPI arancio / IT blu): la banda ora è
  verde come le altre. L'area resta identificata dai pulsanti nella barra filtri.

Aggiornare questa tabella a ogni pagina migrata.
