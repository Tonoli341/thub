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
