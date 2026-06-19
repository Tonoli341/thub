import { createTheme } from "@mui/material/styles";

export const theme = createTheme({
  palette: {
    mode: "light",
    primary: {
      main: "#007040",
    },
    secondary: {
      main: "#2B2B2B",
    },
    background: {
      default: "#F3F0E8",
      paper: "#FBFAF6",
    },
  },
  shape: {
    borderRadius: 4,
  },
  typography: {
    fontFamily: '"Lexend", "Segoe UI", sans-serif',
    h3: {
      fontWeight: 700,
      letterSpacing: "-0.04em",
    },
    h4: {
      fontWeight: 700,
      letterSpacing: "-0.03em",
    },
    button: {
      textTransform: "none",
      fontWeight: 600,
    },
  },
});
