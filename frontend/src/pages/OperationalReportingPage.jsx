import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Alert,
  Box,
  Button,
  Chip,
  CircularProgress,
  Dialog,
  DialogContent,
  DialogTitle,
  FormControl,
  IconButton,
  InputLabel,
  MenuItem,
  Popover,
  Select,
  Stack,
  TextField,
  Tooltip,
  Typography,
} from "@mui/material";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import dayjs from "dayjs";
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
  // padding + due pulsanti globali + gap + maniglia
  let required = 24 + 40 + 10 + headerLabelWidth + 8;

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
      allocations: allocationsWithPositions(block.allocations),
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
        const segments = netRangeToClock(geometry.work, netStart, netStart + minutes);
        const allocationClockStart = segments[0]?.start;
        const allocationClockEnd = segments[segments.length - 1]?.end;
        return segments.map((segment, segmentIndex) => (
          <Box
            key={`${allocation.id || allocation._local_id || `${allocation.customer_code}:${allocation.jupiter_description}:${index}`}:${segmentIndex}`}
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
            title={`${allocation.customer_description || allocation.customer_code} · ${allocation.jupiter_description || "Dato storico"} · ${durationLabel(minutes)} · ${weightLabel(minutes, totalWork)} del totale · ${clockLabel(segment.start)}–${clockLabel(segment.end)}`}
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
                    {allocation.customer_description || allocation.customer_code}
                    {allocationClockStart != null && allocationClockEnd != null
                      ? ` · ${clockLabel(allocationClockStart)}–${clockLabel(allocationClockEnd)}`
                      : ""}
                  </span>
                  <span className="op-report-box-jupiter">
                    {allocation.jupiter_description || "Dato storico"} · {durationLabel(minutes)} · {weightLabel(minutes, totalWork)}{allocation.notes ? " · 📝" : ""}
                  </span>
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

function CustomerAllocationEditor({ block, blockIndex, pauses, pauseBounds, totalWork, onChange, onPausesChange }) {
  const [customerToAdd, setCustomerToAdd] = useState("");
  const [jupiterToAdd, setJupiterToAdd] = useState("");
  const [createMenu, setCreateMenu] = useState(null);
  const [createMode, setCreateMode] = useState(null);
  const [selectedAllocationIndex, setSelectedAllocationIndex] = useState(null);
  const customersQuery = useQuery({
    queryKey: ["operational-reporting-customers", block.actual_area_id, block.actual_building],
    queryFn: () => getOperationalReportingCustomers(block.actual_area_id, block.actual_building),
    enabled: Boolean(block.actual_area_id),
    staleTime: 5 * 60 * 1000,
  });
  const customers = customersQuery.data ?? [];
  const customerGeometry = useMemo(() => blockGeometry(block, pauses), [block, pauses]);
  const customerWorkWindows = useMemo(() => netWorkWindows(customerGeometry.work), [customerGeometry.work]);
  // La stessa combinazione Cliente + Descrizione Jupiter può essere usata
  // in più box distinti (per esempio prima e dopo una pausa).
  const availableCustomers = customers.filter((customer) => (customer.jupiter_descriptions ?? []).length > 0);
  const selectedCustomer = customers.find((item) => item.code === customerToAdd);
  const availableJupiterDescriptions = selectedCustomer?.jupiter_descriptions ?? [];
  const allocated = block.allocations.reduce((sum, item) => sum + Number(item.minutes || 0), 0);
  const remaining = Math.max(0, block.capacity_minutes - allocated);
  const selectedAllocation = selectedAllocationIndex == null ? null : block.allocations[selectedAllocationIndex];
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
  const addCustomer = () => {
    const customer = customers.find((item) => item.code === customerToAdd);
    if (!customer || !jupiterToAdd || !createMenu) return;
    const localId = `local-${Date.now()}-${Math.random()}`;
    const allocations = allocationsWithPositions([
      ...block.allocations,
      {
        _local_id: localId,
        customer_code: customer.code,
        customer_description: customer.description,
        jupiter_description: jupiterToAdd,
        start_offset_minutes: createMenu.startOffset,
        minutes: Math.min(60, createMenu.availableMinutes),
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
    setCreateMenu({
      ...position,
      availableMinutes: Math.min(position.availableMinutes, (workWindow?.end ?? position.startOffset) - position.startOffset),
      top: event.clientY,
      left: event.clientX,
    });
    setCreateMode(null);
    setCustomerToAdd("");
    setJupiterToAdd("");
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
        <TextField
          className="op-report-block-notes"
          label={`Note attività · ${selectedAllocation.customer_description || selectedAllocation.customer_code}${selectedAllocationTime ? ` · ${selectedAllocationTime}` : ""}`}
          size="small"
          value={selectedAllocation.notes ?? ""}
          onChange={(event) => updateSelectedAllocation({ notes: event.target.value })}
        />
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
          <Typography className="op-report-create-time">Dalle {createMenu ? clockLabel(createMenu.clockStart) : ""}</Typography>
          {!createMode && (
            <Stack direction="row" spacing={1}>
              <Button variant="contained" onClick={() => setCreateMode("activity")}>Attività cliente</Button>
              <Button variant="outlined" color="warning" onClick={addPause}>Pausa</Button>
            </Stack>
          )}
          {createMode === "activity" && (
            <Stack spacing={1}>
              <FormControl size="small" fullWidth disabled={!block.actual_area_id || customersQuery.isLoading}>
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
      {customersQuery.isError && <Alert severity="error">{customersQuery.error.message}</Alert>}
      <Coverage work={block.capacity_minutes} allocated={allocated} uncovered={remaining} over={Math.max(0, allocated - block.capacity_minutes)} />
    </Stack>
  );
}

function BlockEditor({ block, index, areas, pauses, pauseBounds, totalWork, onChange, onPausesChange }) {
  const selectedArea = areas.find((area) => area.id === block.actual_area_id);
  const setBlock = (changes) => onChange(index, { ...block, ...changes });
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
              onChange={(event) => setBlock({ actual_area_id: event.target.value, actual_building: "", allocations: [] })}
            >
              {areas.map((area) => <MenuItem key={area.id} value={area.id}>{area.name}</MenuItem>)}
            </Select>
          </FormControl>
          <FormControl size="small" fullWidth disabled={!selectedArea || !selectedArea.buildings.length}>
            <InputLabel>Immobile effettivo</InputLabel>
            <Select
              value={block.actual_building}
              label="Immobile effettivo"
              onChange={(event) => setBlock({ actual_building: event.target.value, allocations: [] })}
            >
              <MenuItem value=""><em>Nessun immobile</em></MenuItem>
              {(selectedArea?.buildings ?? []).map((building) => <MenuItem key={building} value={building}>{building}</MenuItem>)}
            </Select>
          </FormControl>
        </Stack>
      </Box>
      <CustomerAllocationEditor block={block} blockIndex={index} pauses={pauses} pauseBounds={pauseBounds} totalWork={totalWork} onChange={onChange} onPausesChange={onPausesChange} />
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
    if (!dirty || !draft.actual_start || !draft.actual_end || draft.blocks.some((block) => !block.actual_area_id)) return undefined;
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
  }, [dirty, draft, workDate]); // eslint-disable-line react-hooks/exhaustive-deps

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
          {restoreMutation.isPending ? "Ripristino…" : saveMutation.isPending ? "Salvataggio…" : dirty ? "Modifiche in attesa di autosalvataggio" : saveMessage || "Dati sincronizzati"}
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
          disabled={saveMutation.isPending || confirmMutation.isPending || restoreMutation.isPending || totals.over > 0}
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
              const netEnd = netStart + Number(allocation.minutes || 0);
              const color = allocationColor(`${allocation.customer_code}:${allocation.jupiter_description}`);
              return netRangeToClock(geometry.work, netStart, netEnd).map((segment, segmentIndex) => (
                <Box
                  key={`${allocation.id || `${allocation.customer_code}:${allocation.jupiter_description}:${allocationIndex}`}:${segmentIndex}`}
                  className="op-report-overview-allocation"
                  style={{
                    left: `${((segment.start - geometry.start) / geometry.span) * 100}%`,
                    width: `${((segment.end - segment.start) / geometry.span) * 100}%`,
                    background: color.background,
                    borderColor: color.border,
                    color: color.text,
                  }}
                >
                  {segmentIndex === 0 ? allocation.customer_description : ""}
                </Box>
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
    },
  });
  const visibleTeams = useMemo(
    () => (query.data?.teams ?? []).filter((team) => team.members.some((member) => member.has_planning)),
    [query.data?.teams],
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
      <Box className="op-report-topbar">
        <Box className="op-report-title-wrap">
          <Box className="op-report-title-badge">✓</Box>
          <Typography className="op-report-title">Rendicontazione operativa</Typography>
        </Box>
        <Box className="op-report-date-nav">
          <button className="op-report-nav-btn" onClick={() => moveDay(-1)}>‹</button>
          <TextField type="date" size="small" value={selectedDate} onChange={(event) => setSelectedDate(event.target.value)} className="op-report-date-input" />
          <button className="op-report-nav-btn" onClick={() => moveDay(1)}>›</button>
          <Typography className="op-report-date-label">{dayjs(selectedDate).format("dddd D MMMM YYYY")}</Typography>
        </Box>
        <Box className="op-report-topbar-actions">
          <Typography className="op-report-readonly-hint">Il Planner resta invariato</Typography>
          <Button
            size="small"
            variant="outlined"
            color="warning"
            disabled={resetDayMutation.isPending || query.isLoading}
            onClick={resetAllFromPlanner}
          >
            {resetDayMutation.isPending ? "Ricaricamento…" : "Ricarica da Planner"}
          </Button>
        </Box>
      </Box>

      {query.isLoading && <Box sx={{ display: "grid", placeItems: "center", minHeight: 300 }}><CircularProgress /></Box>}
      {query.isError && <Alert severity="error">{query.error.message}</Alert>}
      {resetDayMutation.isError && <Alert severity="error">{resetDayMutation.error.message}</Alert>}
      {query.data && visibleTeams.length === 0 && <Alert severity="info">Nessuna squadra con pianificazione per questa giornata.</Alert>}

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
                          onConfirmed={() => setActiveMember(null)}
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
    </Box>
  );
}
