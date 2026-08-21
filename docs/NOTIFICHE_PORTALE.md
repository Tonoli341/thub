# Notifiche del portale

Le due campanelle del portale — nella barra laterale e nella Home — mostrano lo stesso
elenco restituito da `GET /api/notifications`. Le notifiche sono personali e dinamiche:
restano visibili finché l'azione richiesta non viene completata. Non esiste quindi uno
stato separato "letta/non letta" da salvare nel database.

## Sorgenti collegate

| Modulo | Quando compare | Quando scompare | Destinazione |
|---|---|---|---|
| Rendicontazione operativa | Dopo le 10:00, se una squadra abilitata di cui l'utente è owner non è confermata per il giorno precedente | Quando tutti i dipendenti pianificati risultano confermati | Rendicontazioni › Operativa, con giorno e squadra preselezionati |
| Assenze | Quando una richiesta in attesa è assegnata all'utente come approvatore configurato o responsabile di fallback | Quando la richiesta viene approvata o rifiutata | Home, dove sono presenti i comandi di approvazione |
| Consegne dispositivi | Quando per una consegna personale è stata richiesta esplicitamente una firma e manca una firma successiva alla richiesta | Quando la consegna viene firmata o resa | Pagina di firma della consegna |

Il frontend aggiorna l'elenco ogni minuto, quando la finestra torna attiva e subito dopo
le principali mutazioni che risolvono una notifica.

L'email delle 10:00 per la rendicontazione operativa è un canale distinto dalla
campanella e ha un interruttore separato nel dettaglio squadra. Condivide il calcolo
delle conferme mancanti, ma viene recapitata una sola volta tramite SMTP all'owner.

## Segnali non convertiti in notifiche personali

Le scadenze dipendenti/formazione, le anomalie timesheet, lo stato delle integrazioni e
gli altri riepiloghi amministrativi restano nelle rispettive dashboard. Oggi descrivono
insiemi globali o stati informativi, senza un destinatario personale univoco né una
preferenza di attivazione: inserirli nella campanella produrrebbe notifiche non
attribuibili e duplicati dei contatori già presenti.

Timer, registrazioni giornaliere e checklist strumenti sono invece stati operativi in
tempo reale, non richieste pendenti indirizzate a un utente, e non alimentano la
campanella.
