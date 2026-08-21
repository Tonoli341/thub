// Token di layout condivisi da tutte le pagine (regole 5 e 7): un solo posto in
// cui cambiare gradiente, spaziature e dimensioni tipografiche delle testate.
// I colori veri vivono nel tema MUI e in styles.css: qui stanno solo le costanti
// che il tema non esprime, come il gradiente della banda di sezione.
export const HEADER_GRADIENT = "linear-gradient(135deg, rgba(0,112,64,0.96), rgba(0,80,46,0.92))";

// Altezza dei controlli filtro: allineata a un TextField MUI size="small".
export const CONTROL_HEIGHT = 40;

// Larghezza di base di un filtro nella barra: sotto questa soglia le etichette
// dei Select si troncano, sopra i filtri sprecano spazio sugli schermi stretti.
export const FILTER_WIDTH = 190;
