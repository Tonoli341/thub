// Stili condivisi delle tabelle (regola 6).
//
// La regola è: `table-layout: fixed` + larghezze in percentuale. Con il layout
// automatico la tabella si allarga finché ogni cella sta su una riga, e su un
// 14" — dove la sidebar da 240px lascia meno di 900px alla pagina — le ultime
// colonne finiscono fuori schermo. Con il layout fisso le colonne si spartiscono
// lo spazio disponibile e i testi lunghi si troncano con l'ellissi.

/** Somma delle percentuali: deve fare 100, altrimenti l'ultima colonna sborda. */
export function totalColumnWidth(columns) {
  return columns.reduce((sum, column) => sum + column.width, 0);
}

/**
 * sx della <Table>. `minWidth` è la soglia sotto la quale si preferisce lo
 * scroll orizzontale alla compressione: sotto, le colonne diventano illeggibili.
 */
export function tableSx({ minWidth = 720, dense = false } = {}) {
  return {
    tableLayout: "fixed",
    minWidth,
    // `dense` recupera 4px per lato su ogni colonna: irrilevante su 6 colonne,
    // decisivo sulle tabelle da 12-13 dove il padding da solo pesa 200px.
    "& td, & th": { px: dense ? 0.75 : 1 },
  };
}

/**
 * Prima colonna bloccata durante lo scroll orizzontale.
 *
 * Serve alle tabelle che non possono stare in 990px nemmeno con il layout fisso
 * (oltre ~10 colonne): la pagina non sborda comunque, perché lo scroll resta
 * dentro il TableContainer, e la colonna identificativa resta sempre visibile.
 */
export const stickyFirstColumnSx = {
  "& th:first-of-type, & td:first-of-type": {
    position: "sticky",
    left: 0,
    zIndex: 1,
    bgcolor: "background.paper",
    borderRight: "1px solid",
    borderRightColor: "divider",
  },
  "& thead th:first-of-type": { zIndex: 2, bgcolor: "background.default" },
};

/** sx della riga di intestazione: stessa tipografia su tutte le pagine. */
export const headRowSx = {
  bgcolor: "action.hover",
  "& th": {
    py: 0.75,
    fontSize: 11.5,
    fontWeight: 700,
    lineHeight: 1.25,
    letterSpacing: "0.03em",
    textTransform: "uppercase",
    color: "text.secondary",
    // Un'etichetta lunga va a capo invece di sfondare la sua colonna.
    overflowWrap: "anywhere",
    borderColor: "divider",
  },
};

/** sx delle righe dati: compatte, cliccabili quando la pagina apre un dettaglio. */
export function bodyRowSx({ clickable = false } = {}) {
  return {
    ...(clickable ? { cursor: "pointer" } : null),
    "& > td": { py: 0.5, borderColor: "divider" },
  };
}
