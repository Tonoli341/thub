import { Button, Paper, Stack } from "@mui/material";

import { FILTER_MAX_PX } from "./filterWidth";
import { FILTER_WIDTH } from "./pageTokens";

/**
 * Seconda barra di testata con tutti i filtri della pagina (regola 3).
 *
 * Non ricolora i controlli: impone solo dimensione e larghezza uniformi, così i
 * filtri restano gli `outlined size="small"` standard di MUI su ogni pagina.
 * `onReset` aggiunge "Azzera filtri" allineato a destra.
 */
export default function FilterBar({ children, onReset, resetDisabled = false, dense = false }) {
  return (
    <Paper variant="outlined" sx={{ px: 1.25, py: dense ? 0.75 : 1.25, borderRadius: 2 }}>
      <Stack
        direction="row"
        spacing={1}
        useFlexGap
        flexWrap="wrap"
        alignItems="center"
        sx={{
          // I filtri si restringono insieme invece di far comparire lo scroll
          // orizzontale (regola 6), ma crescono nello spazio libero: `--filter-basis`
          // la imposta FilterSelect in base all'opzione più lunga, gli altri
          // controlli usano il valore di ripiego.
          "& > .MuiFormControl-root, & > .MuiAutocomplete-root": {
            flex: `1 1 var(--filter-basis, ${FILTER_WIDTH}px)`,
            minWidth: 130,
            maxWidth: FILTER_MAX_PX,
          },
        }}
      >
        {children}
        {onReset && (
          <Button
            size="small"
            onClick={onReset}
            disabled={resetDisabled}
            sx={{ ml: "auto", flexShrink: 0, textTransform: "none" }}
          >
            Azzera filtri
          </Button>
        )}
      </Stack>
    </Paper>
  );
}
