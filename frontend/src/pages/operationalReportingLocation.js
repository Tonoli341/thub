// Regole di destinazione dei box di rendicontazione: chi si sposta durante lo
// stesso blocco pianificato rendiconta ogni attività dove ha lavorato davvero.
// Estratte dalla pagina per poterle provare con `node --test`.

export function sameLocation(left = {}, right = {}) {
  return (left.actual_area_id || "") === (right.actual_area_id || "")
    && (left.actual_building || "") === (right.actual_building || "");
}

// La destinazione di un box viene mostrata solo quando differisce da quella
// del blocco: chi non si sposta non deve leggere un'informazione in più.
export function relocationLabel(block, allocation) {
  if (sameLocation(block, allocation)) return "";
  const parts = [allocation.actual_area_name, allocation.actual_building].filter(Boolean);
  return parts.length ? `📍 ${parts.join(" / ")}` : "";
}

// Destinazione di un box nuovo: quella del box che lo precede sulla timeline,
// il blocco solo quando è il primo.
export function defaultAllocationLocation(block, startOffset) {
  const previous = (block.allocations ?? [])
    .filter((allocation) => Number(allocation.start_offset_minutes || 0) <= startOffset)
    .sort((left, right) => Number(left.start_offset_minutes || 0) - Number(right.start_offset_minutes || 0))
    .at(-1);
  const source = previous?.actual_area_id ? previous : block;
  return {
    actual_area_id: source.actual_area_id || "",
    actual_building: source.actual_building || "",
  };
}

// Cambiando la destinazione del blocco, i box rimasti su quella vecchia
// perdono i clienti mappati lì; quelli già spostati altrove non c'entrano.
export function allocationsKeptAfterBlockRelocation(block) {
  return (block.allocations ?? []).filter((allocation) => !sameLocation(block, allocation));
}
