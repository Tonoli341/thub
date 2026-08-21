// Nucleo puro della copia di una rendicontazione da una risorsa all'altra.
// Sta fuori dalla pagina perché è l'unica parte con una logica da verificare:
// il resto è lettura del draft e chiamata all'API. Testato con `node --test`.

// Il "tempo da compilare" non è il solo totale netto: due giornate da otto ore
// con orari o pause diversi non si sovrappongono, e la copia finirebbe su fasce
// che la destinazione non ha lavorato. Il confronto guarda quindi anche gli
// estremi della giornata, le pause e la capienza dei blocchi pianificati.
export function scheduleDigest(draft, blocks) {
  return {
    start: draft.actual_start,
    end: draft.actual_end,
    pauses: (draft.pauses ?? []).map((pause) => `${pause.start}-${pause.end}`).join(" "),
    capacities: blocks.map((block) => Number(block.capacity_minutes || 0)).join(" "),
  };
}

export function scheduleDifferences(source, target) {
  const differences = [];
  if (source.start !== target.start || source.end !== target.end) differences.push("schedule");
  if (source.pauses !== target.pauses) differences.push("pauses");
  if (source.capacities !== target.capacities) differences.push("blocks");
  return differences;
}

// Sequenza piatta delle attività dell'origine, in ordine di orologio.
export function flattenAllocations(blocks) {
  const items = [];
  for (const block of blocks) {
    const ordered = [...(block.allocations ?? [])].sort(
      (left, right) => Number(left.start_offset_minutes || 0) - Number(right.start_offset_minutes || 0),
    );
    for (const allocation of ordered) {
      const minutes = Number(allocation.minutes || 0);
      if (minutes < 10) continue;
      items.push({
        customer_code: allocation.customer_code,
        customer_description: allocation.customer_description,
        jupiter_description: allocation.jupiter_description ?? null,
        // Si porta dietro la destinazione dell'origine: è lì che il cliente è
        // stato validato, mentre l'area pianificata della destinazione può
        // essere un'altra e renderebbe l'incrocio non valido.
        actual_area_id: allocation.actual_area_id || block.actual_area_id || "",
        actual_building: allocation.actual_building || block.actual_building || "",
        notes: allocation.notes ?? null,
        minutes,
      });
    }
  }
  return items;
}

// Riempie in sequenza i blocchi della destinazione: un'attività che non entra
// in un blocco prosegue nel successivo e quello che avanza resta fuori, perché
// i blocchi pianificati non si possono né creare né allungare da qui.
export function fillPastedBlocks(blocks, queue) {
  let index = 0;
  let remaining = queue.length ? queue[0].minutes : 0;
  const filled = blocks.map((block) => {
    const allocations = [];
    let offset = 0;
    while (index < queue.length) {
      // Il backend accetta solo passi di 10 minuti, offset compreso.
      const room = Math.floor((Number(block.capacity_minutes || 0) - offset) / 10) * 10;
      if (room < 10) break;
      const take = Math.min(remaining, room);
      allocations.push({
        ...queue[index],
        id: null,
        _local_id: `paste-${index}-${offset}`,
        minutes: take,
        start_offset_minutes: offset,
      });
      offset += take;
      remaining -= take;
      if (remaining < 10) {
        index += 1;
        remaining = index < queue.length ? queue[index].minutes : 0;
      }
    }
    return { ...block, allocations };
  });
  const leftover = index >= queue.length
    ? 0
    : remaining + queue.slice(index + 1).reduce((sum, item) => sum + item.minutes, 0);
  return { blocks: filled, leftover };
}
