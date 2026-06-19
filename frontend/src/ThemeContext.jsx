import { createContext, useContext, useEffect, useMemo, useState } from "react";
import { createTheme, ThemeProvider as MuiThemeProvider } from "@mui/material/styles";
import { CssBaseline } from "@mui/material";

const ThemeCtx = createContext({ darkMode: false, setDarkMode: () => {} });

function buildTheme(dark) {
  return createTheme({
    palette: {
      mode: dark ? "dark" : "light",
      primary: { main: dark ? "#059669" : "#007040" },
      secondary: { main: dark ? "#4b5563" : "#2B2B2B" },
      background: {
        default: dark ? "#1f2937" : "#F3F0E8",
        paper: dark ? "#374151" : "#FBFAF6",
      },
      text: {
        primary: dark ? "#f9fafb" : "#2B2B2B",
        secondary: dark ? "#9ca3af" : "#515164",
      },
      divider: dark ? "#4b5563" : "rgba(0,0,0,0.12)",
      action: {
        hover: dark ? "rgba(255,255,255,0.07)" : "rgba(0,0,0,0.04)",
        selected: dark ? "rgba(5,150,105,0.14)" : "rgba(0,112,64,0.10)",
      },
    },
    shape: { borderRadius: 4 },
    typography: {
      fontFamily: '"Lexend", "Segoe UI", sans-serif',
      h3: { fontWeight: 700, letterSpacing: "-0.04em" },
      h4: { fontWeight: 700, letterSpacing: "-0.03em" },
      button: { textTransform: "none", fontWeight: 600 },
    },
    components: {
      MuiPaper: {
        styleOverrides: {
          root: { backgroundImage: "none" },
        },
      },
    },
  });
}

export function AppThemeProvider({ children }) {
  const [darkMode, setDarkMode] = useState(() => {
    try { return localStorage.getItem("thub-theme") === "dark"; } catch { return false; }
  });

  const theme = useMemo(() => buildTheme(darkMode), [darkMode]);

  useEffect(() => {
    document.documentElement.setAttribute("data-theme", darkMode ? "dark" : "light");
    try { localStorage.setItem("thub-theme", darkMode ? "dark" : "light"); } catch {}
  }, [darkMode]);

  return (
    <ThemeCtx.Provider value={{ darkMode, setDarkMode }}>
      <MuiThemeProvider theme={theme}>
        <CssBaseline />
        {children}
      </MuiThemeProvider>
    </ThemeCtx.Provider>
  );
}

export function useAppTheme() {
  return useContext(ThemeCtx);
}
