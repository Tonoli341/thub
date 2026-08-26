import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Alert,
  Box,
  Button,
  Chip,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControl,
  IconButton,
  InputLabel,
  MenuItem,
  Popover,
  Select,
  Snackbar,
  Stack,
  TextField,
  Tooltip,
  Typography,
} from "@mui/material";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import dayjs from "dayjs";

import FilterBar from "../components/FilterBar";
import FilterSelect from "../components/FilterSelect";
import {
  allocationsKeptAfterBlockRelocation,
  defaultAllocationLocation,
  relocationLabel,
} from "./operationalReportingLocation";
import {
  fillPastedBlocks,
  flattenAllocations,
  scheduleDifferences,
  scheduleDigest,
} from "./operationalReportingPaste";
import PageHeader from "../components/PageHeader";
import { useSearchParams } from "react-router-dom";
import "./OperationalReportingPage.css";

import {
  confirmOperationalReportingDay,
  getOperationalReportingCustomers,
  getOperationalReportingDay,
  resetOperationalReportingDay,
  resetOperationalReportingMember,
  saveOperationalReportingDay,
} from "../operationalReportingApi";


const STATUS_LABELS = {
  DRAFT: "Bozza",
  CONFIRMED: "Confermata",
  REOPENED: "Riaperta",
  LOCKED: "Bloccata",
};

const hhmm = (value) => (value ? String(value).slice(0, 5) : "");
const durationLabel = (minutes = 0) => `${Math.floor(minutes / 60)}h ${String(minutes % 60).padStart(2, "0")}m`;
const weightLabel = (minutes, total) => {
  if (!total) return "0%";
  const value = (Number(minutes || 0) / total) * 100;
  return `${value < 10 ? value.toFixed(1) : Math.round(value)}%`;
};
// Stessa fascia oraria del Planner: un turno che parte alle 05:00 deve restare
// disegnabile anche qui, altrimenti la riga risulta troncata a sinistra.
const REPORT_START_HOUR = 5;
const REPORT_END_HOUR = 22;
const REPORT_HOURS = Array.from({ length: REPORT_END_HOUR - REPORT_START_HOUR + 1 }, (_, index) => REPORT_START_HOUR + index);

function defaultNameColumnWidth(teams) {
  if (typeof document === "undefined") return 250;
  const context = document.createElement("canvas").getContext("2d");
  if (!context) return 250;

  context.font = '800 10.5px "Lexend", "Segoe UI", sans-serif';
  const headerLabelWidth = context.measureText("SQUADRA / DIPENDENTE").width;
  // padding + due pulsanti globali + gap + maniglia, più copia/incolla che
  // stanno sulle righe dipendente ma allargano la stessa colonna
  let required = 24 + 40 + 10 + headerLabelWidth + 8 + 46;

  for (const team of teams) {
    const plannedCount = team.members.filter((member) => member.has_planning).length;
    context.font = '800 10.5px "Lexend", "Segoe UI", sans-serif';
    const teamWidth = context.measureText(`${team.team_icon || ""} ${team.team_name || ""}`.toUpperCase()).width;
    context.font = '600 9px "Lexend", "Segoe UI", sans-serif';
    const countWidth = context.measureText(`${plannedCount} pianificati`).width;
    // padding + freccia squadra + due gap + testi + margine della maniglia
    required = Math.max(required, 24 + 18 + 16 + teamWidth + countWidth + 8);
  }

  return Math.max(190, Math.min(480, Math.ceil(required)));
}

// Firma della casella con lo stesso metodo del Planner: il backend salva il
// nome dell'autore già risolto, qui si formatta soltanto.
function allocationSignature(allocation = {}) {
  const stamp = (name, at, prefix) => (
    name && at ? `${prefix} ${name} il ${dayjs(at).format("DD/MM/YYYY [alle] HH:mm")}` : null
  );
  const created = stamp(allocation.created_by_name, allocation.created_at, "Creata da");
  const modified = stamp(allocation.last_modified_by_name, allocation.last_modified_at, "Ultima modifica di");
  // Dentro il box c'è spazio per una riga sola: vince l'ultima modifica, che è
  // il dato che si cerca quando una casella cambia sotto gli occhi di qualcuno.
  const inlineName = allocation.last_modified_by_name || allocation.created_by_name;
  const inlineAt = allocation.last_modified_at || allocation.created_at;
  const inline = inlineName && inlineAt
    ? `✎ ${inlineName} · ${dayjs(inlineAt).format("DD/MM HH:mm")}`
    : "";
  return { created, modified, inline };
}

function renderAllocationTooltip(allocation, { customerLabel, relocation, minutes, totalWork, clockRange }) {
  const signature = allocationSignature(allocation);
  return (
    <Box sx={{ py: 0.25 }}>
      <Typography sx={{ fontSize: 11, fontWeight: 700 }}>{customerLabel}</Typography>
      <Typography sx={{ fontSize: 10.5, opacity: 0.8 }}>
        {allocation.jupiter_description || "Dato storico"}{relocation ? ` · ${relocation}` : ""}
      </Typography>
      <Typography sx={{ fontSize: 10.5, opacity: 0.8 }}>
        {clockRange ? `${clockRange} · ` : ""}{durationLabel(minutes)} · {weightLabel(minutes, totalWork)} del totale
      </Typography>
      {allocation.notes && (
        <Typography sx={{ fontSize: 10.5, mt: 0.5, maxWidth: 260, whiteSpace: "pre-wrap" }}>
          {allocation.notes}
        </Typography>
      )}
      {(signature.created || signature.modified) && (
        <Box sx={{ mt: 0.75, pt: 0.6, borderTop: "1px solid rgba(255,255,255,0.25)", opacity: 0.82 }}>
          {signature.created && <Typography sx={{ fontSize: 10 }}>{signature.created}</Typography>}
          {signature.modified && <Typography sx={{ fontSize: 10 }}>{signature.modified}</Typography>}
        </Box>
      )}
    </Box>
  );
}

function allocationColor(code = "") {
  let hash = 0;
  for (const char of code) hash = ((hash << 5) - hash + char.charCodeAt(0)) | 0;
  const hue = Math.abs(hash) % 360;
  return { background: `hsl(${hue} 72% 91%)`, border: `hsl(${hue} 55% 43%)`, text: `hsl(${hue} 55% 24%)` };
}

function timelinePercent(minutes) {
  const start = REPORT_START_HOUR * 60;
  const total = (REPORT_END_HOUR - REPORT_START_HOUR) * 60;
  return Math.max(0, Math.min(100, ((minutes - start) / total) * 100));
}

function clockLabel(minutes) {
  const total = Math.max(0, Math.round(minutes));
  return `${String(Math.floor(total / 60)).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`;
}

// Finestra rendicontabile del blocco, spezzata dalle pause come i segmenti del
// Planner: `work` sono le finestre effettivamente attribuibili a un cliente.
function blockGeometry(block, pauses = []) {
  const start = timeMinutes(block.reporting_start || block.planned_start);
  const end = Math.max(start, timeMinutes(block.reporting_end || block.planned_end));
  const inside = pauses
    .map((pause, index) => ({
      index,
      rawStart: timeMinutes(pause.start),
      rawEnd: timeMinutes(pause.end),
      start: Math.max(start, timeMinutes(pause.start)),
      end: Math.min(end, timeMinutes(pause.end)),
    }))
    .filter((pause) => pause.end > pause.start)
    .sort((a, b) => a.start - b.start);
  const work = [];
  let cursor = start;
  for (const pause of inside) {
    if (pause.start > cursor) work.push({ start: cursor, end: pause.start });
    cursor = Math.max(cursor, pause.end);
  }
  if (cursor < end) work.push({ start: cursor, end });
  return { start, end, span: Math.max(1, end - start), pauses: inside, work };
}

// Converte un intervallo di minuti netti (l'asse delle allocazioni) negli
// intervalli di orologio corrispondenti, scavalcando le pause.
function netRangeToClock(work, fromNet, toNet) {
  const segments = [];
  let consumed = 0;
  for (const window of work) {
    const length = window.end - window.start;
    const from = Math.max(fromNet, consumed);
    const to = Math.min(toNet, consumed + length);
    if (to > from) segments.push({ start: window.start + (from - consumed), end: window.start + (to - consumed) });
    consumed += length;
    if (consumed >= toNet) break;
  }
  return segments;
}

function clockToNet(work, clock) {
  let consumed = 0;
  for (const window of work) {
    if (clock <= window.start) return consumed;
    if (clock < window.end) return consumed + (clock - window.start);
    consumed += window.end - window.start;
  }
  return consumed;
}

function netWorkWindows(work) {
  let cursor = 0;
  return work.map((window) => {
    const length = window.end - window.start;
    const result = { start: cursor, end: cursor + length };
    cursor += length;
    return result;
  });
}

function findContinuousPlacement(windows, earliest, duration) {
  for (const window of windows) {
    const start = Math.max(earliest, window.start);
    if (start + duration <= window.end) return start;
  }
  return null;
}

function allocationsWithPositions(allocations = []) {
  let cursor = 0;
  return allocations.map((allocation) => {
    const persisted = Number(allocation.start_offset_minutes);
    const start = Number.isFinite(persisted) ? persisted : cursor;
    cursor = Math.max(cursor, start + Number(allocation.minutes || 0));
    return { ...allocation, start_offset_minutes: start };
  }).sort((left, right) => left.start_offset_minutes - right.start_offset_minutes);
}

function freeNetRanges(allocations, capacity) {
  const ranges = [];
  let cursor = 0;
  for (const allocation of [...allocations].sort((left, right) => left.start_offset_minutes - right.start_offset_minutes)) {
    const start = Number(allocation.start_offset_minutes || 0);
    if (start > cursor) ranges.push({ start: cursor, end: start });
    cursor = Math.max(cursor, start + Number(allocation.minutes || 0));
  }
  if (cursor < capacity) ranges.push({ start: cursor, end: capacity });
  return ranges;
}

// Stessi limiti del trascinamento a bordo box (vedi startResize): l'allocazione
// precedente/successiva più vicina, in minuti netti. Servono per bloccare gli
// orari digitati a mano nello stesso modo in cui il drag non lascia sovrapporre
// due attività o sforare la capienza del blocco.
function neighborBounds(allocations, index, capacity) {
  const current = allocations[index];
  const currentStart = Number(current?.start_offset_minutes || 0);
  const currentEnd = currentStart + Number(current?.minutes || 0);
  const others = allocations.filter((_, itemIndex) => itemIndex !== index);
  const previousEnds = others
    .map((item) => Number(item.start_offset_minutes || 0) + Number(item.minutes || 0))
    .filter((end) => end <= currentStart);
  const nextStarts = others
    .map((item) => Number(item.start_offset_minutes || 0))
    .filter((start) => start >= currentEnd);
  return {
    previousEnd: previousEnds.length ? Math.max(...previousEnds) : 0,
    nextStart: nextStarts.length ? Math.min(...nextStarts) : capacity,
  };
}

function memberToDraft(member, workDate) {
  return {
    report_id: member.report_id ?? null,
    status: member.status ?? null,
    employee_id: member.employee_id,
    work_date: workDate,
    actual_start: hhmm(member.actual_start),
    actual_end: hhmm(member.actual_end),
    pauses: (member.pauses ?? []).map((pause) => ({ start: hhmm(pause.start), end: hhmm(pause.end) })),
    notes: member.notes ?? "",
    blocks: (member.blocks ?? []).map((block) => ({
      ...block,
      planned_start: hhmm(block.planned_start),
      planned_end: hhmm(block.planned_end),
      reporting_start: hhmm(block.reporting_start || block.planned_start),
      reporting_end: hhmm(block.reporting_end || block.planned_end),
      actual_area_id: block.actual_area_id ?? "",
      actual_building: block.actual_building ?? "",
      notes: block.notes ?? "",
      // Ogni box porta la propria destinazione: il backend risponde già con
      // quella del blocco per le rendicontazioni precedenti alla modifica.
      allocations: allocationsWithPositions((block.allocations ?? []).map((allocation) => ({
        ...allocation,
        actual_area_id: allocation.actual_area_id ?? block.actual_area_id ?? "",
        actual_building: allocation.actual_building ?? "",
      }))),
    })),
  };
}

function apiPayload(draft) {
  return {
    employee_id: draft.employee_id,
    work_date: draft.work_date,
    actual_start: draft.actual_start,
    actual_end: draft.actual_end,
    pauses: draft.pauses,
    notes: draft.notes || null,
    blocks: draft.blocks.map((block) => ({
      id: block.id ?? null,
      source_assignment_id: block.source_assignment_id ?? null,
      actual_area_id: block.actual_area_id,
      actual_building: block.actual_building || null,
      notes: block.notes || null,
      allocations: block.allocations.map((allocation) => ({
        id: allocation.id ?? null,
        customer_code: allocation.customer_code,
        jupiter_description: allocation.jupiter_description || null,
        actual_area_id: allocation.actual_area_id || null,
        actual_building: allocation.actual_building || null,
        start_offset_minutes: Number(allocation.start_offset_minutes || 0),
        minutes: Number(allocation.minutes),
        notes: allocation.notes || null,
      })),
    })),
  };
}

function timeMinutes(value) {
  if (!value) return 0;
  const [hours, minutes] = value.split(":").map(Number);
  return hours * 60 + minutes;
}

function draftTotals(draft) {
  const start = timeMinutes(draft.actual_start);
  const end = timeMinutes(draft.actual_end);
  const gross = Math.max(0, end - start);
  // Ritagliate sulla giornata, come fa il backend: una pausa che sborda non
  // può scalare più tempo di quello effettivamente lavorato.
  const pauses = draft.pauses.reduce(
    (sum, pause) => sum + Math.max(0, Math.min(end, timeMinutes(pause.end)) - Math.max(start, timeMinutes(pause.start))),
    0,
  );
  const work = Math.max(0, gross - pauses);
  const allocated = draft.blocks.reduce(
    (sum, block) => sum + block.allocations.reduce((inner, allocation) => inner + Number(allocation.minutes || 0), 0),
    0,
  );
  return { work, allocated, uncovered: Math.max(0, work - allocated), over: Math.max(0, allocated - work) };
}

function blocksWithEffectiveCapacity(draft) {
  return draft.blocks.map((block, index) => {
    const reportingStart = index === 0 ? draft.actual_start : block.planned_start;
    const reportingEnd = index === draft.blocks.length - 1 ? draft.actual_end : block.planned_end;
    const start = timeMinutes(reportingStart);
    const end = timeMinutes(reportingEnd);
    const pauseMinutes = draft.pauses.reduce((sum, pause) => {
      const overlap = Math.max(0, Math.min(end, timeMinutes(pause.end)) - Math.max(start, timeMinutes(pause.start)));
      return sum + overlap;
    }, 0);
    return {
      ...block,
      reporting_start: reportingStart,
      reporting_end: reportingEnd,
      capacity_minutes: Math.max(0, end - start - pauseMinutes),
    };
  });
}

// Mantiene fissi gli orari di orologio delle attività quando cambiano i
// confini della giornata o le pause. Le parti fuori dalle nuove finestre
// lavorative vengono tagliate; una pausa interna separa il box in due.
function rebaseDraftTimeline(draft, changes) {
  const oldBlocks = blocksWithEffectiveCapacity(draft);
  const nextBase = { ...draft, ...changes };
  const nextBlocks = blocksWithEffectiveCapacity(nextBase);
  return {
    ...nextBase,
    blocks: draft.blocks.map((sourceBlock, blockIndex) => {
      const oldGeometry = blockGeometry(oldBlocks[blockIndex], draft.pauses);
      const nextGeometry = blockGeometry(nextBlocks[blockIndex], nextBase.pauses);
      const allocations = [];
      for (const allocation of sourceBlock.allocations) {
        const netStart = Number(allocation.start_offset_minutes || 0);
        const oldSegments = netRangeToClock(oldGeometry.work, netStart, netStart + Number(allocation.minutes || 0));
        let partIndex = 0;
        for (const oldSegment of oldSegments) {
          for (const workWindow of nextGeometry.work) {
            const start = Math.max(oldSegment.start, workWindow.start);
            const end = Math.min(oldSegment.end, workWindow.end);
            if (end - start < 10) continue;
            allocations.push({
              ...allocation,
              id: partIndex === 0 ? allocation.id : null,
              _local_id: partIndex === 0
                ? allocation._local_id
                : `local-${Date.now()}-${Math.random()}-${blockIndex}-${partIndex}`,
              start_offset_minutes: clockToNet(nextGeometry.work, start),
              minutes: end - start,
            });
            partIndex += 1;
          }
        }
      }
      return { ...sourceBlock, allocations: allocationsWithPositions(allocations) };
    }),
  };
}

// --- Copia di una rendicontazione da una risorsa all'altra ----------------

const PASTE_DIFFERENCE_LABELS = {
  schedule: "orario",
  pauses: "pause",
  blocks: "blocchi pianificati",
};

function scheduleLine(label, summary) {
  const pauses = summary.pauses
    ? summary.pauses.split(" ").map((pause) => pause.replace("-", "–")).join(", ")
    : "nessuna pausa";
  return `${label}: ${summary.name} · ${summary.start}–${summary.end} · pause ${pauses} · ${durationLabel(summary.minutes)} netti`;
}

function memberHasAllocations(member) {
  return (member.blocks ?? []).some((block) => (block.allocations ?? []).length > 0);
}

// `alignTime` porta l'orario effettivo della destinazione su quello
// dell'origine: è la risposta "sì" all'avviso sul tempo da compilare diverso.
function buildPasteDraft(sourceMember, targetMember, workDate, alignTime) {
  const sourceDraft = memberToDraft(sourceMember, workDate);
  const targetDraft = memberToDraft(targetMember, workDate);
  const base = alignTime
    ? {
      ...targetDraft,
      actual_start: sourceDraft.actual_start,
      actual_end: sourceDraft.actual_end,
      pauses: sourceDraft.pauses.map((pause) => ({ ...pause })),
    }
    : targetDraft;
  const { blocks, leftover } = fillPastedBlocks(
    blocksWithEffectiveCapacity(base),
    flattenAllocations(sourceDraft.blocks),
  );
  // Un blocco pianificato in un'area che non esiste in rendicontazione arriva
  // senza destinazione: prende quella di ciò che vi è stato incollato dentro,
  // altrimenti il salvataggio verrebbe rifiutato per area mancante.
  const withLocation = blocks.map((block) => (
    block.actual_area_id || !block.allocations.length
      ? block
      : {
        ...block,
        actual_area_id: block.allocations[0].actual_area_id,
        actual_building: block.allocations[0].actual_building,
      }
  ));
  return { draft: { ...base, notes: sourceDraft.notes, blocks: withLocation }, leftover };
}

function Coverage({ work, allocated, uncovered, over }) {
  const color = over ? "error" : uncovered ? "warning" : "success";
  return (
    <Stack direction={{ xs: "column", sm: "row" }} spacing={1} alignItems={{ sm: "center" }}>
      <Chip color={color} size="small" label={`${durationLabel(allocated)} / ${durationLabel(work)}`} />
      <Typography variant="caption" color={over ? "error.main" : "text.secondary"}>
        {over ? `${durationLabel(over)} oltre il disponibile` : uncovered ? `${durationLabel(uncovered)} non attribuite` : "Copertura completa"}
      </Typography>
    </Stack>
  );
}

function AllocationTimeline({
  block,
  blockIndex,
  pauses,
  pauseBounds,
  totalWork,
  selectedAllocationIndex,
  onAllocationSelect,
  onAllocationDelete,
  onChange,
  onPausesChange,
  onEmptyClick,
}) {
  const trackRef = useRef(null);
  const [draggedIndex, setDraggedIndex] = useState(null);
  const draggedIndexRef = useRef(null);
  const dragGrabOffsetRef = useRef(0);
  const dragOriginalStartRef = useRef(0);
  const geometry = useMemo(() => blockGeometry(block, pauses), [block, pauses]);
  const workWindows = useMemo(() => netWorkWindows(geometry.work), [geometry.work]);
  const displayStart = geometry.start;
  const displayEnd = geometry.end;
  const displaySpan = Math.max(1, displayEnd - displayStart);
  const percent = (minute) => ((minute - displayStart) / displaySpan) * 100;
  const widthPercent = (segment) => ((segment.end - segment.start) / displaySpan) * 100;
  const hourTicks = [];
  for (let hour = Math.floor(displayStart / 60) + 1; hour * 60 < displayEnd; hour += 1) hourTicks.push(hour);
  // Posiziona il box sul minuto netto indicato. Se incontra altri box li fa
  // scorrere, conservando gli spazi liberi quando c'è capienza.
  const dragAllocation = (event) => {
    event.preventDefault();
    if (draggedIndexRef.current == null) return;
    const rect = trackRef.current?.getBoundingClientRect();
    if (!rect?.width) return;
    const clock = displayStart + ((event.clientX - rect.left) / rect.width) * displaySpan;
    const net = clockToNet(geometry.work, clock);
    const sourceIndex = draggedIndexRef.current;
    const source = block.allocations[sourceIndex];
    if (!source) return;
    const duration = Number(source.minutes || 0);
    const desired = Math.max(0, Math.min(block.capacity_minutes - duration, Math.round((net - dragGrabOffsetRef.current) / 10) * 10));
    const movingRight = desired >= dragOriginalStartRef.current;
    const fittedDesired = findContinuousPlacement(workWindows, desired, duration);
    if (fittedDesired == null) return;
    const positioned = block.allocations.map((allocation, index) => ({
      ...allocation,
      start_offset_minutes: index === sourceIndex ? fittedDesired : Number(allocation.start_offset_minutes || 0),
      _moving: index === sourceIndex,
    })).sort((left, right) => (
      left.start_offset_minutes - right.start_offset_minutes
      || (left._moving ? (movingRight ? 1 : -1) : right._moving ? (movingRight ? -1 : 1) : 0)
    ));
    let cursor = 0;
    for (const allocation of positioned) {
      const placement = findContinuousPlacement(
        workWindows,
        Math.max(allocation.start_offset_minutes, cursor),
        Number(allocation.minutes || 0),
      );
      if (placement == null) return;
      allocation.start_offset_minutes = placement;
      cursor = allocation.start_offset_minutes + Number(allocation.minutes || 0);
    }
    const allocations = positioned.map(({ _moving, ...allocation }) => allocation);
    const nextSourceIndex = positioned.findIndex((allocation) => allocation._moving);
    onChange(blockIndex, { ...block, allocations });
    draggedIndexRef.current = nextSourceIndex;
    setDraggedIndex(nextSourceIndex);
  };

  const stopAllocationDrag = () => {
    draggedIndexRef.current = null;
    setDraggedIndex(null);
  };

  const startPauseEdit = (event, pause, mode) => {
    event.preventDefault();
    event.stopPropagation();
    const initial = pauses[pause.index];
    if (!initial) return;
    const initialStart = timeMinutes(initial.start);
    const initialEnd = timeMinutes(initial.end);
    const duration = initialEnd - initialStart;
    const rect = trackRef.current?.getBoundingClientRect();
    if (!rect?.width || duration < 10) return;
    const pointerStart = displayStart + ((event.clientX - rect.left) / rect.width) * displaySpan;
    const otherRanges = pauses
      .filter((_, index) => index !== pause.index)
      .map((item) => ({ start: timeMinutes(item.start), end: timeMinutes(item.end) }));
    const previousEnd = Math.max(
      pauseBounds.start,
      ...otherRanges.filter((item) => item.end <= initialStart).map((item) => item.end),
    );
    const nextStart = Math.min(
      pauseBounds.end,
      ...otherRanges.filter((item) => item.start >= initialEnd).map((item) => item.start),
    );
    let pendingPauses = pauses;
    onPausesChange(pauses, "start");

    const move = (moveEvent) => {
      const currentRect = trackRef.current?.getBoundingClientRect() || rect;
      const pointerClock = displayStart + ((moveEvent.clientX - currentRect.left) / currentRect.width) * displaySpan;
      let start = initialStart;
      let end = initialEnd;
      if (mode === "move") {
        const delta = Math.round(((pointerClock - pointerStart) / 10)) * 10;
        start = Math.max(previousEnd, Math.min(nextStart - duration, initialStart + delta));
        end = start + duration;
      } else if (mode === "start") {
        start = Math.max(previousEnd, Math.min(initialEnd - 10, Math.round(pointerClock / 10) * 10));
      } else {
        end = Math.max(initialStart + 10, Math.min(nextStart, Math.round(pointerClock / 10) * 10));
      }
      const nextPauses = pauses.map((item, index) => (
        index === pause.index ? { start: clockLabel(start), end: clockLabel(end) } : item
      ));
      pendingPauses = nextPauses;
      onPausesChange(nextPauses, "move");
    };
    const stop = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", stop);
      onPausesChange(pendingPauses, "end");
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", stop, { once: true });
  };

  // La maniglia lavora in posizione assoluta: il puntatore indica un orario,
  // che viene riconvertito in minuti netti saltando le pause attraversate. Il
  // resize può quindi oltrepassare una pausa: l'allocazione resta unica e
  // viene soltanto disegnata in più segmenti sull'asse dell'orologio.
  const startResize = (event, allocationIndex, netStart, edge = "end") => {
    event.preventDefault();
    event.stopPropagation();
    const initial = [...block.allocations];
    const followingStarts = initial
      .filter((_, index) => index !== allocationIndex)
      .map((item) => Number(item.start_offset_minutes || 0))
      .filter((start) => start >= netStart + Number(initial[allocationIndex].minutes || 0));
    const nextStart = followingStarts.length ? Math.min(...followingStarts) : block.capacity_minutes;
    const maxMinutes = Math.max(10, nextStart - netStart);
    const initialEnd = netStart + Number(initial[allocationIndex].minutes || 0);
    const previousEnds = initial
      .filter((_, index) => index !== allocationIndex)
      .map((item) => Number(item.start_offset_minutes || 0) + Number(item.minutes || 0))
      .filter((end) => end <= netStart);
    const previousEnd = previousEnds.length ? Math.max(...previousEnds) : 0;
    const move = (moveEvent) => {
      const rect = trackRef.current?.getBoundingClientRect();
      if (!rect?.width) return;
      const clock = displayStart + ((moveEvent.clientX - rect.left) / rect.width) * displaySpan;
      const net = clockToNet(geometry.work, clock);
      const snappedNet = Math.round(net / 10) * 10;
      const allocations = initial.map((item, index) => (
        index === allocationIndex
          ? edge === "start"
            ? {
                ...item,
                start_offset_minutes: Math.max(previousEnd, Math.min(initialEnd - 10, snappedNet)),
                minutes: initialEnd - Math.max(previousEnd, Math.min(initialEnd - 10, snappedNet)),
              }
            : { ...item, minutes: Math.max(10, Math.min(maxMinutes, Math.round((net - netStart) / 10) * 10)) }
          : item
      ));
      onChange(blockIndex, { ...block, allocations });
    };
    const stop = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", stop);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", stop, { once: true });
  };

  return (
    <Box
      className="op-report-allocation-track"
      ref={trackRef}
      onDragOver={dragAllocation}
      onDrop={(event) => { event.preventDefault(); stopAllocationDrag(); }}
    >
      {hourTicks.map((hour) => (
        <Box key={hour} className="op-report-track-tick" style={{ left: `${percent(hour * 60)}%` }}>
          <span>{String(hour).padStart(2, "0")}:00</span>
        </Box>
      ))}
      {geometry.pauses.map((pause) => (
        <Box
          key={`pause-${pause.start}-${pause.end}`}
          className="op-report-track-pause"
          style={{ left: `${percent(pause.start)}%`, width: `${widthPercent(pause)}%` }}
          title={`Pausa ${clockLabel(pause.start)}–${clockLabel(pause.end)}`}
          onPointerDown={(event) => startPauseEdit(event, pause, "move")}
        >
          {pause.rawStart >= geometry.start && (
            <Box className="op-report-pause-resize is-start" onPointerDown={(event) => startPauseEdit(event, pause, "start")} />
          )}
          <span>{widthPercent(pause) >= 12 ? `Pausa ${clockLabel(pause.start)}–${clockLabel(pause.end)}` : "Pausa"}</span>
          {pause.rawEnd <= geometry.end && (
            <Box className="op-report-pause-resize is-end" onPointerDown={(event) => startPauseEdit(event, pause, "end")} />
          )}
        </Box>
      ))}
      {block.allocations.flatMap((allocation, index) => {
        const netStart = Number(allocation.start_offset_minutes || 0);
        const minutes = Number(allocation.minutes || 0);
        const color = allocationColor(`${allocation.customer_code}:${allocation.jupiter_description}`);
        const relocation = relocationLabel(block, allocation);
        const customerLabel = allocation.customer_description || allocation.customer_code || "Da assegnare";
        const segments = netRangeToClock(geometry.work, netStart, netStart + minutes);
        const allocationClockStart = segments[0]?.start;
        const allocationClockEnd = segments[segments.length - 1]?.end;
        const signature = allocationSignature(allocation);
        return segments.map((segment, segmentIndex) => (
          <Tooltip
            key={`${allocation.id || allocation._local_id || `${allocation.customer_code}:${allocation.jupiter_description}:${index}`}:${segmentIndex}`}
            title={renderAllocationTooltip(allocation, {
              customerLabel,
              relocation,
              minutes,
              totalWork,
              clockRange: allocationClockStart != null && allocationClockEnd != null
                ? `${clockLabel(allocationClockStart)}–${clockLabel(allocationClockEnd)}`
                : "",
            })}
            placement="top"
            arrow
            enterDelay={150}
          >
            <Box
              className={`op-report-allocation-box${draggedIndex === index ? " is-dragging" : ""}${selectedAllocationIndex === index ? " is-selected" : ""}${segmentIndex > 0 ? " is-continued" : ""}`}
              draggable
              onClick={() => onAllocationSelect(index)}
              onDragStart={(event) => {
                draggedIndexRef.current = index;
                setDraggedIndex(index);
                const rect = trackRef.current?.getBoundingClientRect();
                if (rect?.width) {
                  const pointerClock = displayStart + ((event.clientX - rect.left) / rect.width) * displaySpan;
                  dragGrabOffsetRef.current = Math.max(0, clockToNet(geometry.work, pointerClock) - netStart);
                } else {
                  dragGrabOffsetRef.current = 0;
                }
                dragOriginalStartRef.current = netStart;
                event.dataTransfer.effectAllowed = "move";
                event.dataTransfer.setData("text/plain", String(index));
              }}
              onDrag={(event) => { if (event.clientX) dragAllocation(event); }}
              onDragEnd={stopAllocationDrag}
              style={{ left: `${percent(segment.start)}%`, width: `${widthPercent(segment)}%`, background: color.background, borderColor: color.border, color: color.text }}
            >
              {segmentIndex === 0 && (
                <>
                  <Box className="op-report-box-resize is-start" onPointerDown={(event) => startResize(event, index, netStart, "start")} />
                  <Box className="op-report-box-grip">⋮⋮</Box>
                </>
              )}
              {/* Anche vuoto, il blocco copy fa da spaziatore e tiene la
                  maniglia di ridimensionamento sul bordo destro del segmento. */}
              <Box className="op-report-box-copy">
                {segmentIndex === 0 && (
                  <>
                    <span className="op-report-box-customer">
                      {customerLabel}
                      {allocationClockStart != null && allocationClockEnd != null
                        ? ` · ${clockLabel(allocationClockStart)}–${clockLabel(allocationClockEnd)}`
                        : ""}
                    </span>
                    <span className="op-report-box-jupiter">
                      {allocation.jupiter_description || "Dato storico"}{relocation ? ` · ${relocation}` : ""} · {durationLabel(minutes)} · {weightLabel(minutes, totalWork)}{allocation.notes ? " · 📝" : ""}
                    </span>
                    {/* Sotto l'ora di durata la riga non ci sta: resta sul tooltip. */}
                    {signature.inline && minutes >= 60 && (
                      <span className="op-report-box-signature">{signature.inline}</span>
                    )}
                  </>
                )}
              </Box>
              {segmentIndex === 0 && (
                <button
                  type="button"
                  className="op-report-box-delete"
                  title="Rimuovi"
                  onClick={(event) => {
                    event.stopPropagation();
                    onAllocationDelete(index);
                    onChange(blockIndex, { ...block, allocations: block.allocations.filter((_, itemIndex) => itemIndex !== index) });
                  }}
                >×</button>
              )}
              {segmentIndex === segments.length - 1 && (
                <Box className="op-report-box-resize is-end" onPointerDown={(event) => startResize(event, index, netStart, "end")} />
              )}
            </Box>
          </Tooltip>
        ));
      })}
      {freeNetRanges(block.allocations, block.capacity_minutes).flatMap((range) => (
        netRangeToClock(geometry.work, range.start, range.end).map((segment) => (
          <Box
            key={`free-${range.start}-${segment.start}`}
            className="op-report-unallocated"
            style={{ left: `${percent(segment.start)}%`, width: `${widthPercent(segment)}%` }}
            role="button"
            tabIndex={0}
            title="Clicca per aggiungere un’attività o una pausa"
            onClick={(event) => {
              const rect = trackRef.current?.getBoundingClientRect();
              if (!rect?.width) return;
              const clock = displayStart + ((event.clientX - rect.left) / rect.width) * displaySpan;
              const net = clockToNet(geometry.work, clock);
              const startOffset = Math.max(range.start, Math.min(range.end - 10, Math.round(net / 10) * 10));
              const clockSegment = netRangeToClock(geometry.work, startOffset, startOffset + 1)[0];
              onEmptyClick(event, {
                startOffset,
                clockStart: clockSegment?.start ?? segment.start,
                availableMinutes: range.end - startOffset,
                segmentEnd: segment.end,
                rangeStart: range.start,
                rangeEnd: range.end,
              });
            }}
          >
            {segment.end - segment.start >= 30 ? `+ ${durationLabel(segment.end - segment.start)} libere` : "+"}
          </Box>
        ))
      ))}
    </Box>
  );
}

// Gli Incroci ammessi dipendono dalla coppia Area + Immobile, non dal blocco:
// due box dello stesso blocco possono quindi avere elenchi clienti diversi.
function useEligibleCustomers(areaId, building) {
  return useQuery({
    queryKey: ["operational-reporting-customers", areaId || "", building || ""],
    queryFn: () => getOperationalReportingCustomers(areaId, building || null),
    enabled: Boolean(areaId),
    staleTime: 5 * 60 * 1000,
  });
}

function withJupiterDescriptions(customers = []) {
  return customers.filter((customer) => (customer.jupiter_descriptions ?? []).length > 0);
}

function CustomerAllocationEditor({ block, blockIndex, areas, pauses, pauseBounds, totalWork, onChange, onPausesChange }) {
  const [customerToAdd, setCustomerToAdd] = useState("");
  const [jupiterToAdd, setJupiterToAdd] = useState("");
  const [createMenu, setCreateMenu] = useState(null);
  const [createMode, setCreateMode] = useState(null);
  const [createLocation, setCreateLocation] = useState({ actual_area_id: "", actual_building: "" });
  const [selectedAllocationIndex, setSelectedAllocationIndex] = useState(null);
  const customersQuery = useEligibleCustomers(createLocation.actual_area_id, createLocation.actual_building);
  const customers = customersQuery.data ?? [];
  const areaById = (areaId) => areas.find((area) => area.id === areaId);
  const customerGeometry = useMemo(() => blockGeometry(block, pauses), [block, pauses]);
  const customerWorkWindows = useMemo(() => netWorkWindows(customerGeometry.work), [customerGeometry.work]);
  // La stessa combinazione Cliente + Descrizione Jupiter può essere usata
  // in più box distinti (per esempio prima e dopo una pausa).
  const availableCustomers = withJupiterDescriptions(customers);
  const selectedCustomer = customers.find((item) => item.code === customerToAdd);
  const availableJupiterDescriptions = selectedCustomer?.jupiter_descriptions ?? [];
  const createArea = areaById(createLocation.actual_area_id);
  const allocated = block.allocations.reduce((sum, item) => sum + Number(item.minutes || 0), 0);
  const remaining = Math.max(0, block.capacity_minutes - allocated);
  const selectedAllocation = selectedAllocationIndex == null ? null : block.allocations[selectedAllocationIndex];
  const selectedArea = areaById(selectedAllocation?.actual_area_id);
  const selectedLocationQuery = useEligibleCustomers(
    selectedAllocation?.actual_area_id,
    selectedAllocation?.actual_building,
  );
  const selectedLocationCustomers = withJupiterDescriptions(selectedLocationQuery.data ?? []);
  const selectedAllocationCustomer = selectedLocationCustomers.find(
    (item) => item.code === selectedAllocation?.customer_code,
  );
  // Un cliente rimosso dagli Incroci non deve sparire dal box già rendicontato:
  // resta selezionabile finché non si cambia destinazione. La voce va comunque
  // renderizzata mentre l'elenco carica, altrimenti la Select resta senza il
  // proprio valore. Il suffisso arriva solo quando la risposta c'è davvero.
  const selectedCustomerIsHistorical = Boolean(
    selectedAllocation?.customer_code && !selectedAllocationCustomer,
  );
  const selectedJupiterIsHistorical = Boolean(
    selectedAllocation?.jupiter_description
    && !(selectedAllocationCustomer?.jupiter_descriptions ?? []).some(
      (item) => item.description === selectedAllocation.jupiter_description,
    ),
  );
  const historicalHint = selectedLocationQuery.isPending ? "" : " · non più in elenco";
  const selectedAllocationSegments = selectedAllocation
    ? netRangeToClock(
      customerGeometry.work,
      Number(selectedAllocation.start_offset_minutes || 0),
      Number(selectedAllocation.start_offset_minutes || 0) + Number(selectedAllocation.minutes || 0),
    )
    : [];
  const selectedAllocationTime = selectedAllocationSegments.length
    ? `${clockLabel(selectedAllocationSegments[0].start)}–${clockLabel(selectedAllocationSegments[selectedAllocationSegments.length - 1].end)}`
    : "";
  // Il popover di creazione lavora anch'esso in minuti netti (start_offset_minutes
  // + minutes): l'orario "Alle" mostrato va riconvertito in clock scavalcando le pause.
  const createMenuEndSegments = createMenu
    ? netRangeToClock(customerGeometry.work, createMenu.startOffset, createMenu.startOffset + createMenu.minutes)
    : [];
  const createMenuEndClock = createMenuEndSegments.length
    ? createMenuEndSegments[createMenuEndSegments.length - 1].end
    : createMenu?.clockStart ?? 0;
  useEffect(() => {
    if (selectedAllocationIndex != null && selectedAllocationIndex >= block.allocations.length) {
      setSelectedAllocationIndex(null);
    }
  }, [block.allocations.length, selectedAllocationIndex]);

  const updateSelectedAllocation = (changes) => {
    if (selectedAllocationIndex == null || !block.allocations[selectedAllocationIndex]) return;
    onChange(blockIndex, {
      ...block,
      allocations: block.allocations.map((allocation, index) => (
        index === selectedAllocationIndex ? { ...allocation, ...changes } : allocation
      )),
    });
  };
  // Digitare "Dalle"/"Alle" equivale a trascinare i bordi del box: stessi
  // limiti di startResize (nessuna sovrapposizione, nessuno sforo di capienza),
  // così i due modi di impostare l'orario restano sincronizzati sullo stesso dato.
  const handleSelectedStartChange = (value) => {
    if (selectedAllocationIndex == null || !selectedAllocation) return;
    if (!value) return;
    const clock = timeMinutes(value);
    const net = Math.round(clockToNet(customerGeometry.work, clock) / 10) * 10;
    const { previousEnd, nextStart } = neighborBounds(block.allocations, selectedAllocationIndex, block.capacity_minutes);
    const currentEnd = Number(selectedAllocation.start_offset_minutes || 0) + Number(selectedAllocation.minutes || 0);
    const start = Math.max(previousEnd, Math.min(currentEnd - 10, nextStart - 10, net));
    updateSelectedAllocation({ start_offset_minutes: start, minutes: currentEnd - start });
  };
  const handleSelectedEndChange = (value) => {
    if (selectedAllocationIndex == null || !selectedAllocation) return;
    if (!value) return;
    const clock = timeMinutes(value);
    const net = Math.round(clockToNet(customerGeometry.work, clock) / 10) * 10;
    const { nextStart } = neighborBounds(block.allocations, selectedAllocationIndex, block.capacity_minutes);
    const start = Number(selectedAllocation.start_offset_minutes || 0);
    const end = Math.max(start + 10, Math.min(nextStart, net));
    updateSelectedAllocation({ minutes: end - start });
  };
  // Cambiando Area o Immobile cambia l'elenco degli Incroci ammessi: la scelta
  // del cliente va rifatta, e `_needs_customer` tiene fermo l'autosave finché
  // il box non è di nuovo completo.
  const relocateSelectedAllocation = (changes) => updateSelectedAllocation({
    ...changes,
    customer_code: "",
    customer_description: "",
    jupiter_description: "",
    _needs_customer: true,
  });
  const pickSelectedCustomer = (code) => {
    const customer = selectedLocationCustomers.find((item) => item.code === code);
    updateSelectedAllocation({
      customer_code: code,
      customer_description: customer?.description ?? code,
      jupiter_description: "",
      _needs_customer: true,
    });
  };

  const addCustomer = () => {
    const customer = customers.find((item) => item.code === customerToAdd);
    if (!customer || !jupiterToAdd || !createMenu || !createLocation.actual_area_id) return;
    const localId = `local-${Date.now()}-${Math.random()}`;
    const allocations = allocationsWithPositions([
      ...block.allocations,
      {
        _local_id: localId,
        customer_code: customer.code,
        customer_description: customer.description,
        jupiter_description: jupiterToAdd,
        actual_area_id: createLocation.actual_area_id,
        actual_area_name: createArea?.name ?? "",
        actual_building: createLocation.actual_building,
        start_offset_minutes: createMenu.startOffset,
        minutes: createMenu.minutes,
        notes: "",
      },
    ]);
    onChange(blockIndex, {
      ...block,
      allocations,
    });
    setSelectedAllocationIndex(allocations.findIndex((allocation) => allocation._local_id === localId));
    setCustomerToAdd("");
    setJupiterToAdd("");
    setCreateMenu(null);
    setCreateMode(null);
  };

  const addPause = () => {
    if (!createMenu) return;
    const duration = Math.max(10, Math.min(30, createMenu.availableMinutes, createMenu.segmentEnd - createMenu.clockStart));
    const pause = { start: clockLabel(createMenu.clockStart), end: clockLabel(createMenu.clockStart + duration) };
    onPausesChange([...pauses, pause].sort((left, right) => timeMinutes(left.start) - timeMinutes(right.start)));
    setCreateMenu(null);
    setCreateMode(null);
  };

  const openCreateMenu = (event, position) => {
    const workWindow = customerWorkWindows.find((window) => position.startOffset >= window.start && position.startOffset < window.end);
    const availableMinutes = Math.min(position.availableMinutes, (workWindow?.end ?? position.startOffset) - position.startOffset);
    // Chi si sposta continua a lavorare dove è arrivato: il box nuovo eredita
    // la destinazione di quello che lo precede, il blocco solo se è il primo.
    setCreateLocation(defaultAllocationLocation(block, position.startOffset));
    setCreateMenu({
      ...position,
      availableMinutes,
      // Durata di default degli 60 minuti come prima; i campi Dalle/Alle nel
      // popover permettono di correggerla digitando invece che trascinando.
      minutes: Math.max(10, Math.min(60, availableMinutes)),
      top: event.clientY,
      left: event.clientX,
    });
    setCreateMode(null);
    setCustomerToAdd("");
    setJupiterToAdd("");
  };

  // Digitare "Dalle" o "Alle" nel popover di creazione equivale a trascinare i
  // bordi di un box che non esiste ancora: stessi vincoli (capienza del
  // blocco, nessuna sovrapposizione con l'attività adiacente) del resize.
  const updateCreateStart = (value) => {
    if (!createMenu) return;
    if (!value) return;
    const clock = timeMinutes(value);
    const net = Math.round(clockToNet(customerGeometry.work, clock) / 10) * 10;
    const currentEnd = createMenu.startOffset + createMenu.minutes;
    const start = Math.max(createMenu.rangeStart ?? 0, Math.min(currentEnd - 10, net));
    const newClockStart = netRangeToClock(customerGeometry.work, start, start + 1)[0]?.start ?? createMenu.clockStart;
    const newWorkWindow = customerGeometry.work.find((window) => newClockStart >= window.start && newClockStart < window.end);
    setCreateMenu({
      ...createMenu,
      startOffset: start,
      clockStart: newClockStart,
      segmentEnd: newWorkWindow?.end ?? createMenu.segmentEnd,
      minutes: currentEnd - start,
      availableMinutes: (createMenu.rangeEnd ?? currentEnd) - start,
    });
  };

  const updateCreateEnd = (value) => {
    if (!createMenu) return;
    if (!value) return;
    const clock = timeMinutes(value);
    const net = Math.round(clockToNet(customerGeometry.work, clock) / 10) * 10;
    const rangeEnd = createMenu.rangeEnd ?? createMenu.startOffset + createMenu.availableMinutes;
    const end = Math.max(createMenu.startOffset + 10, Math.min(rangeEnd, net));
    setCreateMenu({
      ...createMenu,
      minutes: end - createMenu.startOffset,
      availableMinutes: rangeEnd - createMenu.startOffset,
    });
  };

  return (
    <Stack spacing={1.25}>
      <AllocationTimeline
        block={block}
        blockIndex={blockIndex}
        pauses={pauses}
        pauseBounds={pauseBounds}
        totalWork={totalWork}
        selectedAllocationIndex={selectedAllocationIndex}
        onAllocationSelect={setSelectedAllocationIndex}
        onAllocationDelete={(index) => {
          if (selectedAllocationIndex === index) setSelectedAllocationIndex(null);
          else if (selectedAllocationIndex > index) setSelectedAllocationIndex(selectedAllocationIndex - 1);
        }}
        onChange={onChange}
        onPausesChange={onPausesChange}
        onEmptyClick={openCreateMenu}
      />
      <Typography className="op-report-drag-hint">Clicca sul bianco per aggiungere · clicca un box per annotarlo · trascina i box e le pause · usa i bordi per ridimensionare · scatti di 10 minuti</Typography>
      {selectedAllocation && (
        <Box className="op-report-allocation-panel">
          <Typography className="op-report-allocation-panel-title">
            Attività selezionata{selectedAllocationTime ? ` · ${selectedAllocationTime}` : ""}
          </Typography>
          <Stack direction={{ xs: "column", md: "row" }} spacing={1}>
            <FormControl size="small" fullWidth>
              <InputLabel>Area effettiva</InputLabel>
              <Select
                value={selectedAllocation.actual_area_id ?? ""}
                label="Area effettiva"
                onChange={(event) => relocateSelectedAllocation({
                  actual_area_id: event.target.value,
                  actual_area_name: areaById(event.target.value)?.name ?? "",
                  actual_building: "",
                })}
              >
                {areas.map((area) => <MenuItem key={area.id} value={area.id}>{area.name}</MenuItem>)}
              </Select>
            </FormControl>
            <FormControl size="small" fullWidth disabled={!selectedArea || !selectedArea.buildings.length}>
              <InputLabel>Immobile effettivo</InputLabel>
              <Select
                value={selectedAllocation.actual_building ?? ""}
                label="Immobile effettivo"
                onChange={(event) => relocateSelectedAllocation({ actual_building: event.target.value })}
              >
                <MenuItem value=""><em>Nessun immobile</em></MenuItem>
                {(selectedArea?.buildings ?? []).map((building) => <MenuItem key={building} value={building}>{building}</MenuItem>)}
              </Select>
            </FormControl>
            <FormControl size="small" fullWidth disabled={!selectedAllocation.actual_area_id || selectedLocationQuery.isLoading}>
              <InputLabel>Cliente</InputLabel>
              <Select
                value={selectedAllocation.customer_code ?? ""}
                label="Cliente"
                onChange={(event) => pickSelectedCustomer(event.target.value)}
              >
                {selectedCustomerIsHistorical && (
                  <MenuItem value={selectedAllocation.customer_code}>
                    {selectedAllocation.customer_description || selectedAllocation.customer_code}{historicalHint}
                  </MenuItem>
                )}
                {selectedLocationCustomers.map((customer) => (
                  <MenuItem key={customer.code} value={customer.code}>{customer.description}</MenuItem>
                ))}
              </Select>
            </FormControl>
            <FormControl size="small" fullWidth disabled={!selectedAllocation.customer_code}>
              <InputLabel>Descrizione Jupiter</InputLabel>
              <Select
                value={selectedAllocation.jupiter_description ?? ""}
                label="Descrizione Jupiter"
                onChange={(event) => updateSelectedAllocation({
                  jupiter_description: event.target.value,
                  _needs_customer: false,
                })}
              >
                {selectedJupiterIsHistorical && (
                  <MenuItem value={selectedAllocation.jupiter_description}>
                    {selectedAllocation.jupiter_description}{historicalHint}
                  </MenuItem>
                )}
                {(selectedAllocationCustomer?.jupiter_descriptions ?? []).map((item) => (
                  <MenuItem key={item.description} value={item.description}>{item.description}</MenuItem>
                ))}
              </Select>
            </FormControl>
          </Stack>
          {selectedAllocation._needs_customer && (
            <Typography className="op-report-allocation-panel-hint">
              Scegli Cliente e Descrizione Jupiter validi per la nuova destinazione: la bozza non viene salvata finché il box è incompleto.
            </Typography>
          )}
          <Stack direction="row" spacing={1}>
            <TextField
              type="time"
              label="Dalle"
              size="small"
              value={selectedAllocationSegments.length ? clockLabel(selectedAllocationSegments[0].start) : ""}
              inputProps={{ step: 600 }}
              InputLabelProps={{ shrink: true }}
              onChange={(event) => handleSelectedStartChange(event.target.value)}
            />
            <TextField
              type="time"
              label="Alle"
              size="small"
              value={selectedAllocationSegments.length ? clockLabel(selectedAllocationSegments[selectedAllocationSegments.length - 1].end) : ""}
              inputProps={{ step: 600 }}
              InputLabelProps={{ shrink: true }}
              onChange={(event) => handleSelectedEndChange(event.target.value)}
            />
          </Stack>
          <TextField
            className="op-report-block-notes"
            label="Note attività"
            size="small"
            value={selectedAllocation.notes ?? ""}
            onChange={(event) => updateSelectedAllocation({ notes: event.target.value })}
          />
        </Box>
      )}
      <Popover
        open={Boolean(createMenu)}
        onClose={() => { setCreateMenu(null); setCreateMode(null); }}
        anchorReference="anchorPosition"
        anchorPosition={createMenu ? { top: createMenu.top, left: createMenu.left } : undefined}
        transformOrigin={{ vertical: "top", horizontal: "left" }}
        className="op-report-create-popover"
      >
        <Box className="op-report-create-menu">
          <Stack direction="row" spacing={1} className="op-report-create-time">
            <TextField
              type="time"
              label="Dalle"
              size="small"
              value={createMenu ? clockLabel(createMenu.clockStart) : ""}
              inputProps={{ step: 600 }}
              InputLabelProps={{ shrink: true }}
              onChange={(event) => updateCreateStart(event.target.value)}
            />
            {createMode === "activity" && (
              <TextField
                type="time"
                label="Alle"
                size="small"
                value={createMenu ? clockLabel(createMenuEndClock) : ""}
                inputProps={{ step: 600 }}
                InputLabelProps={{ shrink: true }}
                onChange={(event) => updateCreateEnd(event.target.value)}
              />
            )}
          </Stack>
          {!createMode && (
            <Stack direction="row" spacing={1}>
              <Button variant="contained" onClick={() => setCreateMode("activity")}>Attività cliente</Button>
              <Button variant="outlined" color="warning" onClick={addPause}>Pausa</Button>
            </Stack>
          )}
          {createMode === "activity" && (
            <Stack spacing={1}>
              <FormControl size="small" fullWidth>
                <InputLabel>Area effettiva</InputLabel>
                <Select
                  value={createLocation.actual_area_id}
                  label="Area effettiva"
                  onChange={(event) => {
                    setCreateLocation({ actual_area_id: event.target.value, actual_building: "" });
                    setCustomerToAdd("");
                    setJupiterToAdd("");
                  }}
                >
                  {areas.map((area) => <MenuItem key={area.id} value={area.id}>{area.name}</MenuItem>)}
                </Select>
              </FormControl>
              <FormControl size="small" fullWidth disabled={!createArea || !createArea.buildings.length}>
                <InputLabel>Immobile effettivo</InputLabel>
                <Select
                  value={createLocation.actual_building}
                  label="Immobile effettivo"
                  onChange={(event) => {
                    setCreateLocation((current) => ({ ...current, actual_building: event.target.value }));
                    setCustomerToAdd("");
                    setJupiterToAdd("");
                  }}
                >
                  <MenuItem value=""><em>Nessun immobile</em></MenuItem>
                  {(createArea?.buildings ?? []).map((building) => <MenuItem key={building} value={building}>{building}</MenuItem>)}
                </Select>
              </FormControl>
              <FormControl size="small" fullWidth disabled={!createLocation.actual_area_id || customersQuery.isLoading}>
                <InputLabel>Cliente</InputLabel>
                <Select value={customerToAdd} label="Cliente" onChange={(event) => { setCustomerToAdd(event.target.value); setJupiterToAdd(""); }}>
                  {availableCustomers.map((customer) => <MenuItem key={customer.code} value={customer.code}>{customer.description}</MenuItem>)}
                </Select>
              </FormControl>
              <FormControl size="small" fullWidth disabled={!customerToAdd}>
                <InputLabel>Descrizione Jupiter</InputLabel>
                <Select value={jupiterToAdd} label="Descrizione Jupiter" onChange={(event) => setJupiterToAdd(event.target.value)}>
                  {availableJupiterDescriptions.map((item) => <MenuItem key={item.description} value={item.description}>{item.description}</MenuItem>)}
                </Select>
              </FormControl>
              <Stack direction="row" spacing={1} justifyContent="flex-end">
                <Button size="small" onClick={() => setCreateMode(null)}>Indietro</Button>
                <Button size="small" variant="contained" disabled={!customerToAdd || !jupiterToAdd} onClick={addCustomer}>Aggiungi</Button>
              </Stack>
            </Stack>
          )}
        </Box>
      </Popover>
      {(customersQuery.isError || selectedLocationQuery.isError) && (
        <Alert severity="error">{(customersQuery.error || selectedLocationQuery.error).message}</Alert>
      )}
      <Coverage work={block.capacity_minutes} allocated={allocated} uncovered={remaining} over={Math.max(0, allocated - block.capacity_minutes)} />
    </Stack>
  );
}

function BlockEditor({ block, index, areas, pauses, pauseBounds, totalWork, onChange, onPausesChange }) {
  const selectedArea = areas.find((area) => area.id === block.actual_area_id);
  // Il select del blocco governa la destinazione pianificata e fa da default
  // per i box nuovi. I box rimasti su quella destinazione perdono i clienti
  // della vecchia area; quelli già spostati altrove non c'entrano e restano.
  const setBlockLocation = (changes) => onChange(index, {
    ...block,
    ...changes,
    allocations: allocationsKeptAfterBlockRelocation(block),
  });
  return (
    <Box className="op-report-block-editor">
      <Box className="op-report-block-editor-head">
        <Box>
          <Typography className="op-report-block-title">Blocco {index + 1} · {block.planned_start}–{block.planned_end}</Typography>
          <Typography className="op-report-block-subtitle">
            Pianificato: {block.planned_area || "Area non definita"}{block.planned_building ? ` / ${block.planned_building}` : ""} · {durationLabel(Math.max(0, timeMinutes(block.planned_end) - timeMinutes(block.planned_start) - Number(block.planned_break_minutes || 0)))}
          </Typography>
          {(block.reporting_start !== block.planned_start || block.reporting_end !== block.planned_end) && (
            <Typography className="op-report-block-extension">
              Rendicontabile: {block.reporting_start}–{block.reporting_end}
            </Typography>
          )}
        </Box>
        <Stack direction={{ xs: "column", md: "row" }} spacing={1} className="op-report-location-fields">
          <FormControl size="small" fullWidth>
            <InputLabel>Area effettiva</InputLabel>
            <Select
              value={block.actual_area_id}
              label="Area effettiva"
              onChange={(event) => setBlockLocation({ actual_area_id: event.target.value, actual_building: "" })}
            >
              {areas.map((area) => <MenuItem key={area.id} value={area.id}>{area.name}</MenuItem>)}
            </Select>
          </FormControl>
          <FormControl size="small" fullWidth disabled={!selectedArea || !selectedArea.buildings.length}>
            <InputLabel>Immobile effettivo</InputLabel>
            <Select
              value={block.actual_building}
              label="Immobile effettivo"
              onChange={(event) => setBlockLocation({ actual_building: event.target.value })}
            >
              <MenuItem value=""><em>Nessun immobile</em></MenuItem>
              {(selectedArea?.buildings ?? []).map((building) => <MenuItem key={building} value={building}>{building}</MenuItem>)}
            </Select>
          </FormControl>
        </Stack>
      </Box>
      <CustomerAllocationEditor block={block} blockIndex={index} areas={areas} pauses={pauses} pauseBounds={pauseBounds} totalWork={totalWork} onChange={onChange} onPausesChange={onPausesChange} />
    </Box>
  );
}

function MemberEditor({ member, workDate, areas, open, onSaved, onConfirmed }) {
  const initialDraftRef = useRef(null);
  if (initialDraftRef.current === null) initialDraftRef.current = memberToDraft(member, workDate);
  const wasOpenRef = useRef(false);
  const [draft, setDraft] = useState(() => initialDraftRef.current);
  const [dayTimeInputs, setDayTimeInputs] = useState(() => ({
    actual_start: hhmm(member.actual_start),
    actual_end: hhmm(member.actual_end),
  }));
  const [dayTimeError, setDayTimeError] = useState("");
  const [dirty, setDirty] = useState(false);
  const [hasSessionChanges, setHasSessionChanges] = useState(false);
  const [saveMessage, setSaveMessage] = useState("");
  const autosaveTimer = useRef(null);
  const pauseEditBaseRef = useRef(null);
  const saveMutation = useMutation({ mutationFn: saveOperationalReportingDay });
  const confirmMutation = useMutation({ mutationFn: confirmOperationalReportingDay });
  const restoreMutation = useMutation({
    mutationFn: async () => {
      const initial = initialDraftRef.current;
      if (!initial.report_id) {
        return resetOperationalReportingMember(workDate, initial.employee_id);
      }
      const payload = apiPayload(initial);
      return saveOperationalReportingDay({
        ...payload,
        blocks: payload.blocks.map((block) => ({
          ...block,
          // Un box iniziale potrebbe essere stato eliminato dall'autosave:
          // senza id il backend può ricrearlo durante il ripristino.
          allocations: block.allocations.map((allocation) => ({ ...allocation, id: null })),
        })),
      });
    },
  });
  const totals = useMemo(() => draftTotals(draft), [draft]);
  const effectiveBlocks = useMemo(() => blocksWithEffectiveCapacity(draft), [draft]);
  // Un box rimasto senza cliente valido dopo un cambio di destinazione non è
  // salvabile: l'autosave si ferma e la conferma resta disabilitata, invece di
  // far arrivare all'utente l'errore di validazione del backend.
  const incomplete = useMemo(() => draft.blocks.some((block) => (
    !block.actual_area_id
    || block.allocations.some((allocation) => allocation._needs_customer || !allocation.actual_area_id)
  )), [draft]);

  useEffect(() => {
    if (!open) {
      wasOpenRef.current = false;
      return;
    }
    if (wasOpenRef.current) return;

    const initial = memberToDraft(member, workDate);
    initialDraftRef.current = initial;
    setDraft(initial);
    setDayTimeInputs({ actual_start: initial.actual_start, actual_end: initial.actual_end });
    setDayTimeError("");
    setDirty(false);
    setHasSessionChanges(false);
    setSaveMessage("");
    saveMutation.reset();
    confirmMutation.reset();
    restoreMutation.reset();
    wasOpenRef.current = true;
  }, [open, member, workDate]); // eslint-disable-line react-hooks/exhaustive-deps

  const change = (updater) => {
    setDraft((current) => (typeof updater === "function" ? updater(current) : updater));
    setDirty(true);
    setHasSessionChanges(true);
    setSaveMessage("");
  };

  const changeTimeline = (changes) => change((current) => rebaseDraftTimeline(current, changes));
  const commitDayTime = (field, value) => {
    const nextTimes = { ...dayTimeInputs, [field]: value };
    if (!nextTimes.actual_start || !nextTimes.actual_end || timeMinutes(nextTimes.actual_end) <= timeMinutes(nextTimes.actual_start)) {
      setDayTimeInputs({ actual_start: draft.actual_start, actual_end: draft.actual_end });
      setDayTimeError("La fine deve essere successiva all’inizio");
      return;
    }
    setDayTimeInputs(nextTimes);
    setDayTimeError("");
    if (nextTimes.actual_start !== draft.actual_start || nextTimes.actual_end !== draft.actual_end) {
      changeTimeline(nextTimes);
    }
  };
  const changePauses = (pauses, phase) => {
    if (phase === "start") {
      pauseEditBaseRef.current = draft;
      return;
    }
    if (!phase) {
      changeTimeline({ pauses });
      return;
    }
    const base = pauseEditBaseRef.current || draft;
    setDraft(rebaseDraftTimeline(base, { pauses }));
    setDirty(true);
    setHasSessionChanges(true);
    setSaveMessage("");
    if (phase === "end") pauseEditBaseRef.current = null;
  };

  useEffect(() => {
    if (!dirty || !draft.actual_start || !draft.actual_end || incomplete) return undefined;
    autosaveTimer.current = window.setTimeout(async () => {
      try {
        const saved = await saveMutation.mutateAsync(apiPayload(draft));
        const next = memberToDraft(saved, workDate);
        setDraft(next);
        setDayTimeInputs({ actual_start: next.actual_start, actual_end: next.actual_end });
        setDirty(false);
        setSaveMessage("Bozza salvata");
        onSaved?.(saved);
      } catch {
        // L'errore resta visibile tramite saveMutation.
      }
    }, 900);
    return () => window.clearTimeout(autosaveTimer.current);
  }, [dirty, draft, incomplete, workDate]); // eslint-disable-line react-hooks/exhaustive-deps

  const updateBlock = (index, nextBlock) => change((current) => ({
    ...current,
    blocks: current.blocks.map((block, blockIndex) => (blockIndex === index ? nextBlock : block)),
  }));

  const restore = async () => {
    window.clearTimeout(autosaveTimer.current);
    try {
      const restored = await restoreMutation.mutateAsync();
      const next = memberToDraft(restored, workDate);
      setDraft(next);
      setDayTimeInputs({ actual_start: next.actual_start, actual_end: next.actual_end });
      setDayTimeError("");
      setDirty(false);
      setHasSessionChanges(false);
      setSaveMessage("Modifiche ripristinate");
      saveMutation.reset();
      confirmMutation.reset();
      onSaved?.(restored);
    } catch {
      // L'errore della mutation viene mostrato nel footer.
    }
  };

  const confirm = async () => {
    window.clearTimeout(autosaveTimer.current);
    try {
      const saved = await saveMutation.mutateAsync(apiPayload(draft));
      const confirmed = await confirmMutation.mutateAsync(saved.report_id);
      const next = memberToDraft(confirmed, workDate);
      setDraft(next);
      setDayTimeInputs({ actual_start: next.actual_start, actual_end: next.actual_end });
      setDirty(false);
      setSaveMessage("Rendicontazione confermata");
      onSaved?.(confirmed);
      onConfirmed?.();
    } catch {
      // Gli errori delle mutation sono mostrati sotto.
    }
  };

  return (
    <Box className="op-report-member-editor">
      <Box className="op-report-day-controls">
        <Stack className="op-report-workday-controls" direction={{ xs: "column", md: "row" }} spacing={1} alignItems={{ md: "center" }}>
        <TextField
          label="Inizio effettivo"
          type="time"
          size="small"
          value={dayTimeInputs.actual_start}
          error={Boolean(dayTimeError)}
          onFocus={() => setDayTimeError("")}
          onChange={(event) => setDayTimeInputs((current) => ({ ...current, actual_start: event.target.value }))}
          onBlur={(event) => commitDayTime("actual_start", event.target.value)}
          onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); commitDayTime("actual_start", event.target.value); event.target.blur(); } }}
          inputProps={{ step: 600 }}
          InputLabelProps={{ shrink: true }}
        />
        <TextField
          label="Fine effettiva"
          type="time"
          size="small"
          value={dayTimeInputs.actual_end}
          error={Boolean(dayTimeError)}
          onFocus={() => setDayTimeError("")}
          onChange={(event) => setDayTimeInputs((current) => ({ ...current, actual_end: event.target.value }))}
          onBlur={(event) => commitDayTime("actual_end", event.target.value)}
          onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); commitDayTime("actual_end", event.target.value); event.target.blur(); } }}
          inputProps={{ step: 600 }}
          InputLabelProps={{ shrink: true }}
        />
        <Coverage {...totals} />
        {totals.work > 480 && <Chip size="small" color="warning" label={`Straordinario ${durationLabel(totals.work - 480)}`} />}
        {dayTimeError && <Typography className="op-report-time-error">{dayTimeError}</Typography>}
        </Stack>
        <Box className="op-report-pauses-wrap">
          <Box className="op-report-pauses-heading">
            <Typography className="op-report-inline-label">Pause effettive</Typography>
            <Typography className="op-report-pauses-help">Aggiungile e modificale direttamente sulle barre</Typography>
          </Box>
          <Box className="op-report-pauses">
          {draft.pauses.map((pause, index) => (
            <Chip
              key={index}
              size="small"
              color="warning"
              variant="outlined"
              label={`Pausa ${pause.start}–${pause.end}`}
              onDelete={() => changeTimeline({ pauses: draft.pauses.filter((_, itemIndex) => itemIndex !== index) })}
            />
          ))}
          {draft.pauses.length === 0 && <Typography className="op-report-no-pauses">Nessuna pausa inserita</Typography>}
          </Box>
        </Box>
      </Box>

      <Box className="op-report-block-list">
        {effectiveBlocks.map((block, index) => (
          <BlockEditor
            key={block.id || block.source_assignment_id}
            block={block}
            index={index}
            areas={areas}
            pauses={draft.pauses}
            pauseBounds={{ start: timeMinutes(draft.actual_start), end: timeMinutes(draft.actual_end) }}
            totalWork={totals.work}
            onChange={updateBlock}
            onPausesChange={changePauses}
          />
        ))}
      </Box>

      {(saveMutation.isError || confirmMutation.isError || restoreMutation.isError) && (
        <Alert severity="error">{(saveMutation.error || confirmMutation.error || restoreMutation.error).message}</Alert>
      )}
      <Box className="op-report-editor-footer">
        <TextField className="op-report-day-notes" label="Note giornata" size="small" value={draft.notes} onChange={(event) => change({ ...draft, notes: event.target.value })} />
        <Typography variant="caption" color={dirty ? "warning.main" : "success.main"}>
          {restoreMutation.isPending ? "Ripristino…" : saveMutation.isPending ? "Salvataggio…" : incomplete ? "Completa Cliente e Descrizione Jupiter dei box spostati" : dirty ? "Modifiche in attesa di autosalvataggio" : saveMessage || "Dati sincronizzati"}
        </Typography>
        <Button
          variant="outlined"
          color="warning"
          disabled={!hasSessionChanges || saveMutation.isPending || confirmMutation.isPending || restoreMutation.isPending}
          onClick={restore}
        >
          {restoreMutation.isPending ? "Ripristino…" : "Ripristina"}
        </Button>
        <Button
          variant="contained"
          color="success"
          disabled={saveMutation.isPending || confirmMutation.isPending || restoreMutation.isPending || totals.over > 0 || incomplete}
          onClick={confirm}
        >
          {confirmMutation.isPending ? "Conferma…" : draft.status === "CONFIRMED" ? "Conferma modifiche" : "Conferma rendicontazione"}
        </Button>
      </Box>
    </Box>
  );
}

function MemberTimeline({ member }) {
  const pauses = member.pauses ?? [];
  return (
    <Box className="op-report-overview-track">
      {member.blocks.map((block, blockIndex) => {
        const geometry = blockGeometry(block, pauses);
        const left = timelinePercent(geometry.start);
        const right = timelinePercent(geometry.end);
        return (
          <Box
            key={block.id || block.source_assignment_id || blockIndex}
            className="op-report-planned-block"
            style={{ left: `${left}%`, width: `${Math.max(1, right - left)}%` }}
            title={`${block.planned_area || "Area"}${block.planned_building ? ` / ${block.planned_building}` : ""} · ${clockLabel(geometry.start)}–${clockLabel(geometry.end)}`}
          >
            {block.allocations.length === 0 && (
              <span className="op-report-planned-label">{block.planned_area || "Pianificato"}</span>
            )}
            {block.allocations.flatMap((allocation, allocationIndex) => {
              const netStart = Number(allocation.start_offset_minutes || 0);
              const minutes = Number(allocation.minutes || 0);
              const color = allocationColor(`${allocation.customer_code}:${allocation.jupiter_description}`);
              const signature = allocationSignature(allocation);
              const customerLabel = allocation.customer_description || allocation.customer_code || "Da assegnare";
              const segments = netRangeToClock(geometry.work, netStart, netStart + minutes);
              const clockStart = segments[0]?.start;
              const clockEnd = segments[segments.length - 1]?.end;
              // Nella riga di riepilogo un box da un'ora è largo una manciata di
              // pixel: la firma sta nel tooltip, non dentro il box. Il `title`
              // vuoto sul box serve a non far comparire anche quello nativo del
              // blocco pianificato sotto, in doppio con il tooltip.
              const showSignature = Boolean(signature.inline) && minutes >= 180;
              const tooltip = renderAllocationTooltip(allocation, {
                customerLabel,
                relocation: relocationLabel(block, allocation),
                minutes,
                totalWork: member.work_minutes,
                clockRange: clockStart != null && clockEnd != null
                  ? `${clockLabel(clockStart)}–${clockLabel(clockEnd)}`
                  : "",
              });
              return segments.map((segment, segmentIndex) => (
                <Tooltip
                  key={`${allocation.id || `${allocation.customer_code}:${allocation.jupiter_description}:${allocationIndex}`}:${segmentIndex}`}
                  title={tooltip}
                  placement="top"
                  arrow
                  enterDelay={150}
                >
                  <Box
                    className={`op-report-overview-allocation${showSignature ? " has-signature" : ""}`}
                    title=""
                    style={{
                      left: `${((segment.start - geometry.start) / geometry.span) * 100}%`,
                      width: `${((segment.end - segment.start) / geometry.span) * 100}%`,
                      background: color.background,
                      borderColor: color.border,
                      color: color.text,
                    }}
                  >
                    {segmentIndex === 0 ? (
                      <>
                        <span className="op-report-overview-allocation-name">{customerLabel}</span>
                        {showSignature && (
                          <span className="op-report-overview-allocation-signature">{signature.inline}</span>
                        )}
                      </>
                    ) : ""}
                  </Box>
                </Tooltip>
              ));
            })}
          </Box>
        );
      })}
      {pauses.map((pause, pauseIndex) => {
        const left = timelinePercent(timeMinutes(pause.start));
        const right = timelinePercent(timeMinutes(pause.end));
        const start = hhmm(pause.start);
        const end = hhmm(pause.end);
        return (
          <Box
            key={`${start}-${end}-${pauseIndex}`}
            className="op-report-overview-pause"
            style={{ left: `${left}%`, width: `${Math.max(0.5, right - left)}%` }}
            title={`Pausa ${start}–${end}`}
          >
            <span>{right - left >= 4 ? `Pausa ${start}–${end}` : "P"}</span>
          </Box>
        );
      })}
    </Box>
  );
}

export default function OperationalReportingPage() {
  const [searchParams] = useSearchParams();
  const requestedDay = searchParams.get("day");
  const requestedEmployee = searchParams.get("employee");
  const requestedTeam = searchParams.get("team");
  const deepLinkAppliedRef = useRef("");
  const [selectedDate, setSelectedDate] = useState(
    /^\d{4}-\d{2}-\d{2}$/.test(requestedDay || "") ? requestedDay : dayjs().format("YYYY-MM-DD"),
  );
  const [activeMember, setActiveMember] = useState(null);
  const [openedMembers, setOpenedMembers] = useState(() => new Set());
  const [collapsedTeams, setCollapsedTeams] = useState({});
  const [teamFilter, setTeamFilter] = useState("");
  const [employeeFilter, setEmployeeFilter] = useState("");
  // Appunti della copia: tiene lo snapshot della risorsa di origine, non un id,
  // così l'incolla non dipende da un nuovo caricamento della giornata.
  const [clipboard, setClipboard] = useState(null);
  const [pasteRequest, setPasteRequest] = useState(null);
  const [pasteFeedback, setPasteFeedback] = useState(null);
  const queryClient = useQueryClient();
  const query = useQuery({
    queryKey: ["operational-reporting-day", selectedDate],
    queryFn: () => getOperationalReportingDay(selectedDate),
    staleTime: 30 * 1000,
    refetchOnWindowFocus: false,
  });
  const resetDayMutation = useMutation({
    mutationFn: () => resetOperationalReportingDay(selectedDate),
    onSuccess: (cleanDay) => {
      setActiveMember(null);
      setOpenedMembers(new Set());
      setCollapsedTeams({});
      queryClient.setQueryData(["operational-reporting-day", selectedDate], cleanDay);
      queryClient.invalidateQueries({ queryKey: ["notifications"] });
    },
  });
  const plannedTeams = useMemo(
    () => (query.data?.teams ?? []).filter((team) => team.members.some((member) => member.has_planning)),
    [query.data?.teams],
  );
  // Le risorse selezionabili si restringono alla squadra scelta: filtrare per una
  // persona che non ne fa parte lascerebbe sempre l'elenco vuoto.
  const employeeOptions = useMemo(() => {
    const byId = new Map();
    for (const team of plannedTeams) {
      if (teamFilter && team.team_id !== teamFilter) continue;
      for (const member of team.members) {
        if (!member.has_planning || byId.has(member.employee_id)) continue;
        byId.set(member.employee_id, { value: member.employee_id, label: member.employee_name });
      }
    }
    return [...byId.values()].sort((left, right) => left.label.localeCompare(right.label, "it"));
  }, [plannedTeams, teamFilter]);
  const visibleTeams = useMemo(
    () => plannedTeams
      .filter((team) => !teamFilter || team.team_id === teamFilter)
      .map((team) => ({
        ...team,
        members: team.members.filter((member) => (
          member.has_planning && (!employeeFilter || member.employee_id === employeeFilter)
        )),
      }))
      .filter((team) => team.members.length > 0),
    [plannedTeams, teamFilter, employeeFilter],
  );
  const automaticNameColWidth = useMemo(() => defaultNameColumnWidth(visibleTeams), [visibleTeams]);
  const [manualNameColWidth, setManualNameColWidth] = useState(null);
  const nameColWidth = manualNameColWidth ?? automaticNameColWidth;
  const handleNameColResizeStart = useCallback((event) => {
    event.preventDefault();
    const startX = event.clientX;
    const startWidth = nameColWidth;
    const onMove = (moveEvent) => {
      setManualNameColWidth(Math.max(120, Math.min(480, startWidth + moveEvent.clientX - startX)));
    };
    const onUp = () => {
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
    };
    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
  }, [nameColWidth]);

  useEffect(() => {
    setActiveMember(null);
    setOpenedMembers(new Set());
    setCollapsedTeams({});
    // I blocchi copiati appartengono alla giornata: su un'altra data non
    // corrispondono più a nulla di pianificato.
    setClipboard(null);
    setPasteRequest(null);
  }, [selectedDate]);

  useEffect(() => {
    if (!query.data || !requestedEmployee || requestedDay !== selectedDate) return;
    const deepLinkKey = `${requestedDay}:${requestedTeam || ""}:${requestedEmployee}`;
    if (deepLinkAppliedRef.current === deepLinkKey) return;
    const team = query.data.teams.find((item) => (
      (!requestedTeam || item.team_id === requestedTeam)
      && item.members.some((member) => member.employee_id === requestedEmployee)
    ));
    if (!team) return;
    const memberKey = `${team.team_id}:${requestedEmployee}`;
    setCollapsedTeams((current) => ({ ...current, [team.team_id]: false }));
    setOpenedMembers((current) => new Set(current).add(memberKey));
    setActiveMember(memberKey);
    deepLinkAppliedRef.current = deepLinkKey;
  }, [query.data, requestedDay, requestedEmployee, requestedTeam, selectedDate]);

  const moveDay = (amount) => setSelectedDate(dayjs(selectedDate).add(amount, "day").format("YYYY-MM-DD"));
  const changeTeamFilter = (value) => {
    setTeamFilter(value);
    setActiveMember(null);
    // Con un filtro attivo restano poche righe: tenerle collassate le nasconderebbe.
    if (value) setCollapsedTeams({});
    // La risorsa già scelta può non appartenere alla nuova squadra: lasciarla
    // attiva produrrebbe un elenco vuoto senza motivo apparente.
    if (!value || !employeeFilter) return;
    const team = plannedTeams.find((item) => item.team_id === value);
    if (!team?.members.some((member) => member.employee_id === employeeFilter)) setEmployeeFilter("");
  };
  const changeEmployeeFilter = (value) => {
    setEmployeeFilter(value);
    setActiveMember(null);
    if (value) setCollapsedTeams({});
  };
  const resetFilters = () => {
    setTeamFilter("");
    setEmployeeFilter("");
    setActiveMember(null);
  };
  const resetAllFromPlanner = () => {
    const accepted = window.confirm(
      "Azzerare tutte le rendicontazioni delle squadre per la giornata selezionata e ricaricarle dal Planner? L’operazione non modifica il Planner.",
    );
    if (accepted) resetDayMutation.mutate();
  };
  const updateCachedMember = (savedMember) => {
    queryClient.setQueryData(["operational-reporting-day", selectedDate], (current) => {
      if (!current) return current;
      return {
        ...current,
        teams: current.teams.map((team) => ({
          ...team,
          members: team.members.map((member) => (
            member.employee_id === savedMember.employee_id ? savedMember : member
          )),
        })),
      };
    });
  };

  const pasteMutation = useMutation({
    mutationFn: ({ payload }) => saveOperationalReportingDay(payload),
    onSuccess: (saved, variables) => {
      updateCachedMember(saved);
      queryClient.invalidateQueries({ queryKey: ["notifications"] });
      const leftover = variables.leftover
        ? ` · ${durationLabel(variables.leftover)} non attribuite: la destinazione ha meno tempo disponibile`
        : "";
      setPasteFeedback({
        severity: variables.leftover ? "warning" : "success",
        message: `Rendicontazione copiata su ${saved.employee_name}${leftover}`,
      });
    },
    onError: (error) => setPasteFeedback({ severity: "error", message: error.message }),
  });

  const copyMember = (member) => {
    setClipboard({ member });
    setPasteFeedback({
      severity: "info",
      message: `Rendicontazione di ${member.employee_name} copiata: usa ⤓ sulla risorsa di destinazione.`,
    });
  };
  const runPaste = (member, alignTime) => {
    setPasteRequest(null);
    const { draft, leftover } = buildPasteDraft(clipboard.member, member, selectedDate, alignTime);
    pasteMutation.mutate({ payload: apiPayload(draft), leftover });
  };
  const requestPaste = (member) => {
    if (!clipboard) return;
    const sourceDraft = memberToDraft(clipboard.member, selectedDate);
    const targetDraft = memberToDraft(member, selectedDate);
    const source = scheduleDigest(sourceDraft, blocksWithEffectiveCapacity(sourceDraft));
    const target = scheduleDigest(targetDraft, blocksWithEffectiveCapacity(targetDraft));
    const differences = scheduleDifferences(source, target);
    const overwrites = memberHasAllocations(member);
    // Giornata sovrapponibile e destinazione vuota: non c'è nulla da avvisare.
    if (!differences.length && !overwrites) {
      runPaste(member, false);
      return;
    }
    setPasteRequest({
      member,
      differences,
      overwrites,
      source: { ...source, name: clipboard.member.employee_name, minutes: draftTotals(sourceDraft).work },
      target: { ...target, name: member.employee_name, minutes: draftTotals(targetDraft).work },
    });
  };

  const openMember = (memberKey) => {
    setOpenedMembers((current) => new Set(current).add(memberKey));
    setActiveMember(memberKey);
  };
  const toggleTeamCollapsed = (teamId) => {
    const willCollapse = !collapsedTeams[teamId];
    if (willCollapse && activeMember?.startsWith(`${teamId}:`)) setActiveMember(null);
    setCollapsedTeams((current) => ({ ...current, [teamId]: !current[teamId] }));
  };
  const expandAllTeams = () => setCollapsedTeams({});
  const collapseAllTeams = () => {
    setActiveMember(null);
    setCollapsedTeams(Object.fromEntries(visibleTeams.map((team) => [team.team_id, true])));
  };

  return (
    <Box className="op-report-page">
      <PageHeader
        section="Rendicontazioni"
        title="Rendicontazione operativa"
        meta="Il Planner resta invariato"
      />

      {/* Data e azioni in barra a sé, fuori dalla banda del titolo (regole 2-3) */}
      <Box sx={{ mt: 2, mb: 2 }}>
        <FilterBar dense>
          <Box className="op-report-date-nav">
            <button className="op-report-nav-btn" onClick={() => moveDay(-1)}>‹</button>
            <TextField type="date" size="small" value={selectedDate} onChange={(event) => setSelectedDate(event.target.value)} className="op-report-date-input" />
            <button className="op-report-nav-btn" onClick={() => moveDay(1)}>›</button>
            <Typography className="op-report-date-label">{dayjs(selectedDate).format("dddd D MMMM YYYY")}</Typography>
          </Box>
          <FilterSelect
            label="Squadra"
            value={teamFilter}
            onChange={changeTeamFilter}
            options={plannedTeams.map((team) => ({
              value: team.team_id,
              label: `${team.team_icon || ""} ${team.team_name}`.trim(),
            }))}
            placeholder="Tutte le squadre"
          />
          <FilterSelect
            label="Risorsa"
            value={employeeFilter}
            onChange={changeEmployeeFilter}
            options={employeeOptions}
            placeholder="Tutte le risorse"
          />
          <Box sx={{ flexGrow: 1 }} />
          <Button
            size="small"
            variant="outlined"
            color="warning"
            disabled={resetDayMutation.isPending || query.isLoading}
            onClick={resetAllFromPlanner}
            sx={{ flexShrink: 0 }}
          >
            {resetDayMutation.isPending ? "Ricaricamento…" : "Ricarica da Planner"}
          </Button>
        </FilterBar>
      </Box>

      {query.isLoading && <Box sx={{ display: "grid", placeItems: "center", minHeight: 300 }}><CircularProgress /></Box>}
      {query.isError && <Alert severity="error">{query.error.message}</Alert>}
      {resetDayMutation.isError && <Alert severity="error">{resetDayMutation.error.message}</Alert>}
      {query.data && plannedTeams.length === 0 && <Alert severity="info">Nessuna squadra con pianificazione per questa giornata.</Alert>}
      {query.data && plannedTeams.length > 0 && visibleTeams.length === 0 && (
        <Alert severity="info" action={<Button size="small" onClick={resetFilters}>Azzera filtri</Button>}>
          Nessuna risorsa corrisponde ai filtri selezionati.
        </Alert>
      )}

      {visibleTeams.length > 0 && (
        <Box className="op-report-shell">
          <Box className="op-report-grid" style={{ "--opr-name-w": `${nameColWidth}px` }}>
            <Box className="op-report-row op-report-hour-row">
              <Box className="op-report-name-header">
                <Tooltip title="Espandi tutte le squadre">
                  <button
                    type="button"
                    className="op-report-header-collapse-btn"
                    aria-label="Espandi tutte le squadre"
                    onClick={expandAllTeams}
                  >
                    ⊞
                  </button>
                </Tooltip>
                <Tooltip title="Comprimi tutte le squadre">
                  <button
                    type="button"
                    className="op-report-header-collapse-btn"
                    aria-label="Comprimi tutte le squadre"
                    onClick={collapseAllTeams}
                  >
                    ⊟
                  </button>
                </Tooltip>
                <span>Squadra / dipendente</span>
                <Box className="op-report-resize-handle" onMouseDown={handleNameColResizeStart} />
              </Box>
              <Box className="op-report-hour-header">
                {REPORT_HOURS.map((hour) => <span key={hour} style={{ left: `${((hour - REPORT_START_HOUR) / (REPORT_END_HOUR - REPORT_START_HOUR)) * 100}%` }}>{String(hour).padStart(2, "0")}:00</span>)}
              </Box>
            </Box>
            {visibleTeams.map((team) => {
              const isTeamCollapsed = Boolean(collapsedTeams[team.team_id]);
              return (
              <Box key={team.team_id} className="op-report-team-section">
                <Box
                  className="op-report-team-row"
                  style={{ "--team-color": team.team_color || "#007040" }}
                  role="button"
                  tabIndex={0}
                  aria-expanded={!isTeamCollapsed}
                  onClick={() => toggleTeamCollapsed(team.team_id)}
                  onKeyDown={(event) => {
                    if (event.target === event.currentTarget && (event.key === "Enter" || event.key === " ")) {
                      event.preventDefault();
                      toggleTeamCollapsed(team.team_id);
                    }
                  }}
                >
                  <button
                    type="button"
                    className={`op-report-team-collapse-btn${isTeamCollapsed ? " is-collapsed" : ""}`}
                    aria-label={isTeamCollapsed ? "Espandi squadra" : "Collassa squadra"}
                    onClick={(event) => {
                      event.stopPropagation();
                      toggleTeamCollapsed(team.team_id);
                    }}
                  >
                    ▾
                  </button>
                  <span>{team.team_icon} {team.team_name}</span>
                  <small>{team.members.filter((member) => member.has_planning).length} pianificati</small>
                </Box>
                {!isTeamCollapsed && team.members.filter((member) => member.has_planning).map((member) => {
              const memberKey = `${team.team_id}:${member.employee_id}`;
              const isOpen = activeMember === memberKey;
              return (
                <Box key={member.employee_id} className={`op-report-member-wrap${isOpen ? " is-active" : ""}`}>
                  <Box
                    className="op-report-row op-report-member-row"
                    role="button"
                    tabIndex={0}
                    aria-haspopup="dialog"
                    onClick={() => openMember(memberKey)}
                    onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") openMember(memberKey); }}
                  >
                    <Box className="op-report-name-cell">
                      <span className="op-report-open-icon">↗</span>
                      <Box className="op-report-member-copy">
                        <strong>{member.employee_name}</strong>
                        <small>{hhmm(member.planned_start)}–{hhmm(member.planned_end)}</small>
                      </Box>
                      <span className={`op-report-status ${member.status === "CONFIRMED" ? "is-confirmed" : ""}`}>{STATUS_LABELS[member.status] || "Da compilare"}</span>
                      <Box
                        className="op-report-row-actions"
                        onKeyDown={(event) => event.stopPropagation()}
                      >
                        <Tooltip title={memberHasAllocations(member) ? "Copia questa rendicontazione" : "Nessuna attività da copiare"}>
                          <span>
                            <button
                              type="button"
                              className={`op-report-row-action${clipboard?.member.employee_id === member.employee_id ? " is-copied" : ""}`}
                              aria-label="Copia rendicontazione"
                              disabled={!memberHasAllocations(member)}
                              onClick={(event) => {
                                event.stopPropagation();
                                copyMember(member);
                              }}
                            >⧉</button>
                          </span>
                        </Tooltip>
                        {/* Con il dettaglio aperto l'editor tiene una propria
                            bozza: il suo autosalvataggio sovrascriverebbe la
                            copia appena incollata. */}
                        <Tooltip
                          title={isOpen
                            ? "Chiudi il dettaglio prima di incollare"
                            : clipboard
                              ? `Incolla la rendicontazione di ${clipboard.member.employee_name}`
                              : "Copia prima una rendicontazione"}
                        >
                          <span>
                            <button
                              type="button"
                              className="op-report-row-action"
                              aria-label="Incolla rendicontazione"
                              disabled={
                                !clipboard
                                || clipboard.member.employee_id === member.employee_id
                                || pasteMutation.isPending
                                || isOpen
                              }
                              onClick={(event) => {
                                event.stopPropagation();
                                requestPaste(member);
                              }}
                            >⤓</button>
                          </span>
                        </Tooltip>
                      </Box>
                    </Box>
                    <MemberTimeline member={member} />
                  </Box>
                  {openedMembers.has(memberKey) && (
                    <Dialog
                      open={isOpen}
                      onClose={() => setActiveMember(null)}
                      keepMounted
                      fullWidth
                      maxWidth="xl"
                      className="op-report-dialog"
                    >
                      <DialogTitle className="op-report-dialog-title">
                        <Box>
                          <Typography component="span" className="op-report-dialog-member">{member.employee_name}</Typography>
                          <Typography component="span" className="op-report-dialog-meta">
                            {team.team_icon} {team.team_name} · {dayjs(selectedDate).format("D MMMM YYYY")}
                          </Typography>
                        </Box>
                        <IconButton aria-label="Chiudi" onClick={() => setActiveMember(null)}>×</IconButton>
                      </DialogTitle>
                      <DialogContent className="op-report-dialog-content" dividers>
                        <MemberEditor
                          member={member}
                          workDate={selectedDate}
                          areas={query.data.areas}
                          open={isOpen}
                          onSaved={updateCachedMember}
                          onConfirmed={() => {
                            queryClient.invalidateQueries({ queryKey: ["notifications"] });
                            setActiveMember(null);
                          }}
                        />
                      </DialogContent>
                    </Dialog>
                  )}
                </Box>
              );
                })}
              </Box>
              );
            })}
          </Box>
        </Box>
      )}

      <Dialog open={Boolean(pasteRequest)} onClose={() => setPasteRequest(null)} maxWidth="sm" fullWidth>
        <DialogTitle>Copia su {pasteRequest?.member.employee_name}</DialogTitle>
        <DialogContent dividers>
          {pasteRequest && pasteRequest.differences.length > 0 && (
            <Alert severity="warning" sx={{ mb: 1.5 }}>
              <Typography variant="body2" sx={{ fontWeight: 700, mb: 0.75 }}>
                Le due giornate non coincidono: {pasteRequest.differences.map((key) => PASTE_DIFFERENCE_LABELS[key]).join(", ")}.
              </Typography>
              <Typography variant="body2" component="div">
                {scheduleLine("Origine", pasteRequest.source)}
                <br />
                {scheduleLine("Destinazione", pasteRequest.target)}
              </Typography>
              <Typography variant="body2" sx={{ mt: 0.75 }}>
                Rispondendo «Sì» l’orario di {pasteRequest.target.name} viene portato su quello
                dell’origine ({pasteRequest.source.start}–{pasteRequest.source.end}, pause comprese);
                ciò che non entra nei blocchi pianificati resta fuori e va sistemato a mano.
              </Typography>
            </Alert>
          )}
          {pasteRequest?.overwrites && (
            <Alert severity="info">
              {pasteRequest.member.employee_name} ha già una rendicontazione per questa giornata:
              viene sostituita da quella copiata.
            </Alert>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setPasteRequest(null)}>No, annulla</Button>
          <Button
            variant="contained"
            onClick={() => runPaste(pasteRequest.member, pasteRequest.differences.length > 0)}
          >
            Sì, copia
          </Button>
        </DialogActions>
      </Dialog>

      {pasteFeedback && (
        <Snackbar
          open
          autoHideDuration={7000}
          onClose={() => setPasteFeedback(null)}
          anchorOrigin={{ vertical: "bottom", horizontal: "center" }}
        >
          <Alert
            severity={pasteFeedback.severity}
            variant="filled"
            onClose={() => setPasteFeedback(null)}
          >
            {pasteFeedback.message}
          </Alert>
        </Snackbar>
      )}
    </Box>
  );
}
