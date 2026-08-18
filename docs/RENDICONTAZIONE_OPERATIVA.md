# Rendicontazione operativa

## Confini

Il modulo legge Planner, Squadre, gerarchia dipendenti, Aree e gli Incroci
Jupiter attivi. Scrive esclusivamente nelle tabelle `operational_report_*` e
nell'audit applicativo. Non modifica Planner, Jupiter, Timesheet, presenze o
timer.

## Accesso

- Admin: tutte le squadre.
- Manager con `config_can_access_timesheets`: solo le squadre in cui è indicato
  direttamente come `operational_reporting_owner_employee_id`.
- Ogni altro utente: nessun accesso.
- Squadre prive di `operational_reporting_owner_employee_id`: solo Admin.

## Stati

`DRAFT`, `CONFIRMED`, `REOPENED`, `LOCKED`. Nella prima versione sono usati
`DRAFT` e `CONFIRMED`; una modifica successiva alla conferma conserva lo stato.

## Snapshot

Alla prima scrittura vengono copiati blocchi, orari, pause, Area e Immobile del
Planner. Le destinazioni effettive sono dati separati. Gli incroci selezionabili
sono ricalcolati, mentre ogni allocazione conserva codice/descrizione cliente e
gli ID degli incroci che ne hanno permesso la scelta. L'allocazione avviene su
due livelli: prima Cliente e poi Descrizione Jupiter. Lo stesso cliente può
comparire più volte nello stesso blocco con descrizioni Jupiter differenti.

## Vincoli

- quantità in passi di 10 minuti;
- nessuna sovrallocazione del blocco o della giornata netta;
- copertura incompleta consentita;
- Area effettiva obbligatoria;
- Immobile validato rispetto agli immobili visibili in rendicontazione;
- conferma esplicita, bozze salvate automaticamente dall'interfaccia.
