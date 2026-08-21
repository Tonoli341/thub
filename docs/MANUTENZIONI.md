# Modulo Manutenzioni

## Stato attuale

Il primo incremento del modulo raccoglie i requisiti direttamente dagli utenti che
gestiscono le manutenzioni. Non contiene ancora anagrafiche di beni, interventi,
scadenze o documenti sul NAS.

La pagina `/manutenzioni` presenta il questionario definito in
`frontend/src/pages/maintenanceQuestionnaire.js`. Le risposte costituiscono un unico
documento aziendale condiviso: ogni utente abilitato vede la versione più recente e può
aggiornarla.

## Autorizzazione

- `build_auth_user_read()` è la fonte del campo `can_access_maintenance`.
- Gli amministratori sono sempre abilitati.
- Gli altri utenti richiedono `Employee.config_can_access_maintenance`.
- L'utenza tecnica del portale rendicontazioni resta esclusa.
- Gli endpoint usano `Depends(require_maintenance_access)`.
- Il toggle viene amministrato in Dipendenti › Accessi.

## Persistenza e concorrenza

La tabella `maintenance_questionnaires` conserva le risposte come JSON, insieme a
versione, autore e date di creazione/aggiornamento. Il salvataggio richiede la versione
letta dal client: se un altro utente ha già salvato, il backend rifiuta la copia obsoleta
e chiede di ricaricare. Ogni salvataggio genera un audit senza copiare il contenuto delle
risposte nel dettaglio dell'audit.

## Confini del primo incremento

- Nessuna lettura o scrittura su SharePoint.
- Nessun accesso al NAS.
- Nessun upload di documenti.
- Nessun import o backfill di dati reali.
- Nessuna notifica o email.

Questi elementi saranno progettati dopo l'analisi delle risposte raccolte.
