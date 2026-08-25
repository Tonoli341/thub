// Palette colori per area operativa (Fossano, Kimberly, ...), condivisa da
// Planner e Dashboard cosi' la stessa area ha sempre lo stesso colore ovunque.
// L'assegnazione e' per indice (ordine di getOperationalAreas), non per nome:
// aggiungere/rimuovere un'area sposta i colori di quelle successive nella lista.
export const AREA_PALETTE = [
  { bg: "rgba(7,162,173,0.18)", border: "#07a2ad", text: "#004f55" },
  { bg: "rgba(124,58,237,0.15)", border: "#7c3aed", text: "#4c1d95" },
  { bg: "rgba(245,158,11,0.18)", border: "#d97706", text: "#78350f" },
  { bg: "rgba(16,185,129,0.16)", border: "#059669", text: "#064e3b" },
  { bg: "rgba(239,68,68,0.14)", border: "#dc2626", text: "#7f1d1d" },
  { bg: "rgba(59,130,246,0.16)", border: "#2563eb", text: "#1e3a5f" },
  { bg: "rgba(236,72,153,0.14)", border: "#db2777", text: "#831843" },
  { bg: "rgba(251,146,60,0.18)", border: "#ea580c", text: "#7c2d12" },
];

export const AREA_PALETTE_DARK = [
  { bg: "rgba(7,162,173,0.22)", border: "#0dbcc9", text: "#5de8f0" },
  { bg: "rgba(124,58,237,0.22)", border: "#9c66ff", text: "#c4aaff" },
  { bg: "rgba(245,158,11,0.22)", border: "#f0a020", text: "#f5c870" },
  { bg: "rgba(16,185,129,0.20)", border: "#20c070", text: "#60e0a0" },
  { bg: "rgba(239,68,68,0.20)", border: "#f05050", text: "#ff9090" },
  { bg: "rgba(59,130,246,0.20)", border: "#4080ff", text: "#90b8ff" },
  { bg: "rgba(236,72,153,0.20)", border: "#e050a0", text: "#ff90cc" },
  { bg: "rgba(251,146,60,0.22)", border: "#f07020", text: "#ffa060" },
];

export function buildAreaColorMap(areas, darkMode) {
  const palette = darkMode ? AREA_PALETTE_DARK : AREA_PALETTE;
  const map = {};
  (areas ?? []).forEach((area, i) => {
    map[area.name] = palette[i % palette.length];
  });
  return map;
}

// La chiave delle card "In Planner oggi" e' "Area Immobile" (es. "Kimberly
// K1"), costruita in backend/app/api/dashboard.py. Per risalire al colore
// dell'area serve il nome dell'area piu' lungo che la apre esattamente o
// seguito da uno spazio (cosi' "Kimberly" non intercetta un'area "Kimberly 2"
// distinta).
export function getAreaColorForKey(key, areaColorMap) {
  if (!key) return null;
  const names = Object.keys(areaColorMap).sort((a, b) => b.length - a.length);
  const match = names.find((name) => key === name || key.startsWith(`${name} `));
  return match ? areaColorMap[match] : null;
}
