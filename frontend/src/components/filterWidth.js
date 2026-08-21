// Larghezza di un filtro a tendina calcolata dal contenuto (regola 4 + richiesta
// dell'utente 2026-08-18): un menu "Squadra" da 190px tronca "📦 Team Magazzino
// CROSS-DOCKING", che è proprio il testo che serve leggere per scegliere.
//
// È una stima tipografica, non una misura: serve solo a scegliere il flex-basis,
// e FilterBar lascia comunque che i filtri si restringano quando la riga è piena.
const CHAR_PX = 7.6;      // larghezza media di un carattere a 14px in Lexend
const CHROME_PX = 62;     // padding dell'input + freccia + "x" di cancellazione

export const FILTER_MIN_PX = 170;
export const FILTER_MAX_PX = 340;

export function filterBasis(labels, { min = FILTER_MIN_PX, max = FILTER_MAX_PX } = {}) {
  const longest = labels.reduce((widest, label) => Math.max(widest, String(label ?? "").length), 0);
  if (!longest) return min;
  return Math.round(Math.min(max, Math.max(min, longest * CHAR_PX + CHROME_PX)));
}
