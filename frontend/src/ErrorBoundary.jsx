import { Component } from "react";
import { Alert, Box, Button, Typography } from "@mui/material";

export default class ErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error, info) {
    console.error("Errore di rendering:", error, info);
  }

  render() {
    if (!this.state.error) {
      return this.props.children;
    }
    return (
      <Box sx={{ p: 4, display: "grid", placeItems: "center", minHeight: "50vh" }}>
        <Alert severity="error" sx={{ maxWidth: 560 }}>
          <Typography fontWeight={700} gutterBottom>
            Si è verificato un errore in questa pagina.
          </Typography>
          <Typography fontSize={13} sx={{ mb: 2, opacity: 0.8 }}>
            {String(this.state.error?.message || this.state.error)}
          </Typography>
          <Button size="small" variant="outlined" color="error" onClick={() => window.location.reload()}>
            Ricarica la pagina
          </Button>
        </Alert>
      </Box>
    );
  }
}
