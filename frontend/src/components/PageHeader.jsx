import { Box, Button, Paper, Stack, Typography } from "@mui/material";

import NotificationsBell from "../NotificationsBell";
import { HEADER_GRADIENT } from "./pageTokens";

/**
 * Banda di testata comune a tutte le pagine (regola 1).
 *
 * Non espone volutamente uno slot per i filtri (regola 2): i filtri stanno in
 * FilterBar, sotto. `actions` è per i soli pulsanti di azione della sezione.
 *
 * La campanella delle notifiche è sempre presente, come sulla banda della Home:
 * l'utente deve trovarla nello stesso punto in ogni sezione. `bell={false}` solo
 * per una banda che ne ospita già una propria.
 */
export default function PageHeader({ section, title, meta, actions, bell = true }) {
  return (
    <Paper sx={{ px: 2.5, py: 1.75, borderRadius: 3, background: HEADER_GRADIENT, color: "#fff" }}>
      <Stack direction="row" spacing={2} alignItems="center" sx={{ flexWrap: "wrap", rowGap: 1 }}>
        <Box sx={{ flex: 1, minWidth: 0 }}>
          {section && (
            <Typography variant="overline" sx={{ opacity: 0.75, lineHeight: 1.2, display: "block" }}>
              {section}
            </Typography>
          )}
          <Typography variant="h5" sx={{ lineHeight: 1.2 }} noWrap={false}>
            {title}
          </Typography>
        </Box>
        {meta && <Typography sx={{ fontSize: 13, opacity: 0.85 }}>{meta}</Typography>}
        {actions}
        {bell && <NotificationsBell variant="home" tooltipPlacement="bottom" />}
      </Stack>
    </Paper>
  );
}

/** Pulsante di azione della banda: unico stile per tutte le sezioni. */
export function HeaderButton({ children, ...props }) {
  return (
    <Button
      {...props}
      sx={{
        height: 32,
        px: 2,
        borderRadius: "16px",
        background: "rgba(255,255,255,0.15)",
        color: "#fff",
        border: "1.5px solid rgba(255,255,255,0.4)",
        fontSize: 13.5,
        fontWeight: 600,
        textTransform: "none",
        backdropFilter: "blur(4px)",
        "&:hover": { background: "rgba(255,255,255,0.25)" },
        "&.Mui-disabled": { color: "rgba(255,255,255,0.5)", borderColor: "rgba(255,255,255,0.2)" },
        ...props.sx,
      }}
    >
      {children}
    </Button>
  );
}
