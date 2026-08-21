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

## Notifiche owner

Campanella ed email sono configurabili separatamente nel dettaglio squadra e
usano la stessa regola: alle 10:00 (Europe/Rome) del giorno successivo controllano
la giornata precedente. L'avviso viene prodotto quando almeno una persona attiva
della squadra era pianificata e la sua giornata non è **completata**.

Una giornata è completata solo se è `CONFIRMED` **e** i minuti attribuiti coprono
tutto il tempo pianificato dai blocchi (`planned` di `_dashboard_report_metrics`:
somma delle capienze `planned_start`–`planned_end` al netto delle pause del
Planner). La copertura è esatta, senza tolleranza: le assenze non entrano nella
rendicontazione operativa — sono `Justification`, non `Assignment` — quindi tutto
ciò che la pagina propone dev'essere allocato. Una conferma parziale non fa più
sparire l'avviso; il messaggio distingue le persone da confermare da quelle
confermate senza copertura completa, e l'email indica per ciascuna quanti minuti
restano da attribuire.

La campanella resta visibile finché tutte le persone pianificate risultano
completate. L'email raggruppa per owner tutte le sue squadre incomplete e viene
inviata una sola volta per giornata; se il backend parte dopo le 10:00 recupera
l'invio. Il destinatario è l'indirizzo LDAP dell'owner e la consegna usa il relay
SMTP già configurato.

`confirm_day` **non** verifica la copertura: la conferma di una giornata parziale
resta possibile e viene segnalata, non impedita.

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

## Destinazione effettiva

Area e Immobile effettivi esistono su due livelli. Quello del blocco è lo
snapshot della destinazione pianificata e fa da default. Ogni singola attività
può però indicarne una propria: serve a rendicontare chi si sposta fisicamente e
lavora in aree diverse dentro lo stesso blocco pianificato.

Gli Incroci selezionabili dipendono dalla coppia Area + Immobile, quindi due box
dello stesso blocco possono avere elenchi clienti differenti e ognuno è validato
sulla propria destinazione. Nella dashboard i filtri Area/Immobile e il
raggruppamento per luogo seguono il box, non il blocco.

Sulle rendicontazioni salvate prima di questa funzione i campi dell'attività
sono `NULL` e vale la destinazione del blocco: il fallback è tutto-o-niente,
Area e Immobile non si mescolano mai tra i due livelli.

## Firma delle caselle

Ogni casella rendicontata porta autore e data, con lo stesso metodo del Planner
(`assignments.last_modified_by_name`): il nome viene denormalizzato sulla riga —
resta leggibile anche se l'utenza viene disattivata — e i timestamp restano
`NULL` sulle caselle salvate prima del tracciamento, perché una data inventata
sarebbe peggio di nessuna data.

`created_by_name` / `created_at` si scrivono alla nascita della casella;
`last_modified_by_name` / `last_modified_at` solo quando cambia davvero un
campo (cliente, minuti, posizione, nota, ordine). Il confronto è necessario
perché l'autosalvataggio rimanda l'intera giornata a ogni modifica: senza di
esso tutte le caselle risulterebbero toccate ogni volta.

Nell'interfaccia la firma è visibile in entrambe le viste: nel dettaglio della
risorsa come terza riga dei box da almeno un'ora, nella riga di riepilogo della
pagina generale dai tre in su. Sotto quelle soglie il box non ha larghezza utile
e la firma resta nel tooltip, che in ogni caso riporta creazione e ultima
modifica per intero.

## Copia tra risorse

Dalla pagina generale ogni riga ha due comandi: **⧉ copia** la rendicontazione
della risorsa e **⤓ incolla** quella copiata su un'altra risorsa della stessa
giornata. La copia vive nella pagina e si azzera cambiando data, perché i
blocchi appartengono alla giornata pianificata.

L'incolla non introduce un endpoint nuovo: costruisce il draft della
destinazione e lo salva con lo stesso `PUT /operational-reporting/day`, quindi
tutte le validazioni restano quelle di sempre.

Le attività dell'origine vengono messe in fila in ordine di orologio e
distribuite nei blocchi pianificati della destinazione, che non si possono né
creare né allungare da qui: un'attività che non entra in un blocco prosegue nel
successivo e ciò che avanza resta fuori, dichiarato nel messaggio di esito. Ogni
attività porta con sé Area e Immobile dell'origine — è lì che il cliente è stato
validato — e un blocco della destinazione privo di destinazione eredita quella
di ciò che vi è stato incollato.

Prima di scrivere, l'incolla confronta le due giornate: **orario effettivo**,
**pause** e **capienza dei blocchi pianificati**. Il solo totale netto non basta
— due giornate da otto ore con orari diversi non si sovrappongono e la copia
finirebbe su fasce che la destinazione non ha lavorato. Se qualcosa non
coincide, l'incolla si ferma, mostra le due giornate a confronto e chiede
conferma:

- **Sì** copia comunque e porta l'orario effettivo della destinazione (inizio,
  fine, pause) su quello dell'origine;
- **No** annulla senza scrivere nulla.

Lo stesso avviso compare quando la destinazione ha già una rendicontazione, che
la copia sostituisce.

## Vincoli

- quantità in passi di 10 minuti;
- nessuna sovrallocazione del blocco o della giornata netta;
- copertura incompleta consentita;
- Area effettiva obbligatoria sul blocco, facoltativa sulla singola attività
  (assente significa "quella del blocco");
- Immobile validato rispetto agli immobili visibili in rendicontazione, sia sul
  blocco sia sull'attività;
- conferma esplicita, bozze salvate automaticamente dall'interfaccia.
