// Colori e label per il ruolo TMS del dipendente (Employee.tms_role_description),
// usati per distinguere a colpo d'occhio magazzinieri/officina/ecc. nei report
// "chi e' in planner oggi" (Dashboard e riepilogo Planner). Stessa palette di
// getRoleColor in OrgChartPage.jsx, qui condivisa perche' serve in piu' punti.
export const ROLE_LABELS = {
  MAGAZZINIERE: "Magazziniere",
  AUTISTA: "Autista",
  IMPIEGATO: "Impiegato",
  OFFICINA: "Officina",
  PULIZIE: "Pulizie",
  ALTRO: "Altro",
};

export function getRoleColor(role) {
  if (role === "IMPIEGATO") return "#007040";
  if (role === "MAGAZZINIERE") return "#6c584c";
  if (role === "AUTISTA") return "#bc4749";
  if (role === "OFFICINA") return "#7f5539";
  if (role === "PULIZIE") return "#588157";
  return "#40506b";
}

export function getRoleLabel(role) {
  if (!role) return null;
  return ROLE_LABELS[role] ?? role;
}

const ROLE_ORDER = Object.keys(ROLE_LABELS);
const NO_ROLE_KEY = "_SENZA_RUOLO";
const NO_ROLE_COLOR = "#8a8f98";

// Sottogruppi per ruolo di un elenco di persone/allocazioni (ognuna con un
// campo `role`): usato sia dalla card "In Planner oggi" della Dashboard sia
// dal riepilogo del Planner, cosi' i due report raggruppano allo stesso modo.
// L'ordine segue ROLE_LABELS; chi non ha un ruolo finisce in un gruppo
// residuo "Senza ruolo" in coda invece di sparire dall'elenco.
export function groupByRole(items) {
  const buckets = new Map();
  for (const item of items) {
    const key = item.role || NO_ROLE_KEY;
    if (!buckets.has(key)) buckets.set(key, []);
    buckets.get(key).push(item);
  }
  const orderedKeys = [
    ...ROLE_ORDER.filter((key) => buckets.has(key)),
    ...[...buckets.keys()].filter((key) => key !== NO_ROLE_KEY && !ROLE_ORDER.includes(key)),
    ...(buckets.has(NO_ROLE_KEY) ? [NO_ROLE_KEY] : []),
  ];
  return orderedKeys.map((key) => ({
    key,
    label: key === NO_ROLE_KEY ? "Senza ruolo" : getRoleLabel(key),
    color: key === NO_ROLE_KEY ? NO_ROLE_COLOR : getRoleColor(key),
    items: buckets.get(key),
  }));
}
