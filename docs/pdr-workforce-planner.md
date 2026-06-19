# Workforce Planner - PDR Aggiornato

## 4. Ambito della Release

### Gestione Anagrafica

Import automatico dal database TMS di:

- matricola
- nome
- cognome
- sito di default
- responsabile
- stato attivo/inattivo
- area operativa di default gestita lato applicativo

### Anagrafica Aree Operative

Il sistema deve includere una sezione dedicata alla gestione dinamica delle aree operative.

Aree operative iniziali:

- Kimberly
- Sede
- Rossana
- Villar
- Dronero
- Fossano
- Costigliole

Operazioni supportate:

- creazione
- modifica
- disattivazione
- consultazione

Dati minimi per area operativa:

- ID
- codice area
- nome area
- descrizione
- stato attivo/inattivo
- data creazione
- data ultima modifica

### Gestione Calendario Operativo

Per ogni giornata sara possibile registrare:

- turno mattina (MAT)
- turno pomeriggio (POM)
- doppio turno
- assenza
- ferie
- permesso
- formazione
- trasferta
- altre causali configurabili

### Sezione Calendario

Il sistema deve prevedere una sezione Calendario consultabile in vista:

- giornaliera
- settimanale
- mensile

Cliccando un giorno, l'utente deve poter aprire un popup/modale per l'inserimento di un giustificativo con i seguenti campi:

- dipendente
- tipo di giustificativo: Ferie, Permesso, Altro
- descrizione
- intervallo di date
- intervallo orario da-a

Il giustificativo salvato deve risultare visibile sia nel calendario sia nel planner operativo.

## 5. Requisiti Funzionali

### RF-001 - Sincronizzazione Anagrafica

Il sistema deve sincronizzare periodicamente i lavoratori dal TMS.

### RF-002 - Gestione Presenze

L'utente deve poter registrare per ogni giorno presenza, ferie, permesso, malattia, formazione e altra causale.

### RF-003 - Gestione Turni

L'utente deve poter indicare MAT, POM e MAT+POM.

### RF-004 - Gestione Assegnazioni

Ogni presenza puo essere associata a sito, area, cliente e attivita.

### RF-005 - Modifica Massiva

Possibilita di applicare una modifica su piu giorni e piu lavoratori.

### RF-006 - Consultazione Storica

Accesso ai dati storici senza limiti temporali.

### RF-007 - Audit Log

Tracciamento di utente, data e modifica effettuata.

### RF-008 - Gestione Utenti

Profili iniziali: Planner, Responsabile, Amministratore.

### RF-009 - Gestione Aree Operative

Il sistema deve consentire la creazione, modifica, disattivazione e consultazione delle aree operative.

### RF-010 - Area Operativa di Default Dipendente

Ogni dipendente deve poter essere associato a una area operativa di default collegata all'anagrafica aree operative.

L'area di default deve essere proposta automaticamente nella pianificazione giornaliera, restando modificabile manualmente.

### RF-011 - Gestione Giustificativi da Calendario

L'utente deve poter inserire giustificativi dal calendario selezionando dipendente, tipo, descrizione, intervallo date e intervallo orario.

### RF-012 - Visibilita Integrata Giustificativi

I giustificativi salvati devono essere visibili nel calendario e nel planner operativo.

## 8. Modello Dati

### Employee

- id: UUID
- tms_id: string
- nome: string
- cognome: string
- responsabile: string
- sito_default: string
- area_operativa_default_id: UUID nullable
- attivo: boolean

### OperationalArea

- id: UUID
- codice_area: string
- nome_area: string
- descrizione: string
- attivo: boolean
- created_at: datetime
- updated_at: datetime

### Assignment

- id: UUID
- employee_id: UUID
- data: date
- turno: enum
- sito: string
- area: string
- attivita: string
- causale: enum

### Justification

- id: UUID
- employee_id: UUID
- tipo: enum(FERIE, PERMESSO, ALTRO)
- descrizione: string
- data_inizio: date
- data_fine: date
- ora_inizio: time
- ora_fine: time
- created_at: datetime
- updated_at: datetime

### User

- id: UUID
- username: string
- ruolo: enum

### AuditLog

- id: UUID
- utente: UUID
- timestamp: datetime
- azione: string
- dettaglio: json

## 9. Interfacce Principali

### Dashboard

Mostra:

- presenti oggi
- assenti oggi
- ferie oggi
- formazione oggi
- distribuzione per sito

### Planner Mensile

Visualizza le assegnazioni giornaliere e i giustificativi del periodo, proponendo automaticamente l'area operativa di default del dipendente.

### Anagrafica Aree Operative

Permette di:

- creare nuove aree operative
- modificare codice, nome e descrizione
- disattivare o riattivare una area
- consultare stato e ultima modifica

### Calendario

Fornisce:

- vista giorno
- vista settimana
- vista mese
- apertura popup da click sul giorno
- inserimento giustificativi con intervallo date e orario
- consultazione dei giustificativi salvati

## 10. Evoluzioni Future

- approvazione giustificativi
- workflow ferie e permessi con autorizzazione responsabile
- segnalazione automatica di conflitti tra giustificativi e assegnazioni
- esportazione planning e calendario in Excel/PDF
- notifiche email o Teams per variazioni di calendario

## 11. Criteri di Accettazione

Il sistema sara considerato conforme quando:

1. L'anagrafica viene sincronizzata correttamente dal TMS.
2. Le aree operative iniziali risultano caricate e gestibili dinamicamente.
3. Ogni dipendente puo essere associato a una area operativa di default.
4. L'area operativa di default viene proposta automaticamente nella pianificazione giornaliera.
5. Il calendario e consultabile per giorno, settimana e mese.
6. Da un giorno di calendario e possibile inserire un giustificativo completo di date e orari.
7. Il giustificativo salvato risulta visibile sia nel calendario sia nel planner operativo.
8. Sono disponibili conteggi automatici per sito e giornata.
9. Le modifiche sono tracciate tramite audit log.
