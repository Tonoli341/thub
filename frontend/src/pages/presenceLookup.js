// Formattazione della finestra di assenza mostrata dalla ricerca presenza della Home.
//
// Il backend restituisce la finestra già composta come "05/08–07/08" (endpoint
// dashboard, DashboardDetail.info). Qui serve letta a frase — "il 05/08" oppure
// "dal 05/08 al 07/08" — con il ripiego sul valore originale se un giorno il
// formato cambia: meglio una stringa grezza che una frase sbagliata.
export function absenceWindowLabel(info) {
  const parts = String(info ?? "").split("–");
  if (parts.length !== 2) return info;
  const [from, to] = parts;
  return from === to ? `il ${from}` : `dal ${from} al ${to}`;
}
