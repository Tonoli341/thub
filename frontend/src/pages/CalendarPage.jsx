import dayjs from "dayjs";

import PageHeader from "../components/PageHeader";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Alert,
  Autocomplete,
  Avatar,
  Box,
  Button,
  Checkbox,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Grid2,
  MenuItem,
  Paper,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  TextField,
  ToggleButton,
  ToggleButtonGroup,
  Tooltip,
  Typography,
} from "@mui/material";
import { DayPicker } from "react-day-picker";
import { it as dayPickerLocale } from "react-day-picker/locale";
import "react-day-picker/style.css";

import {
  createJustification,
  commitAbsenceBalances,
  deleteJustification,
  exportAbsenceBalances,
  getAbsenceBalance,
  getAbsenceBalanceStatus,
  getAbsenceBalances,
  getAssignments,
  getEmployeeOptions,
  getEmployeePhoto,
  getJustifications,
  getTeams,
  updateJustificationApproval,
  updateJustification,
} from "../api";
import { useAuth } from "../auth";
import logoTonoli from "../upload/logoTonoli.png";
import { hasPlannerOverlap } from "./calendarOverlap";
import "./CalendarPage.css";

const weekdayLabels = ["LUN", "MAR", "MER", "GIO", "VEN"];
const defaultDayStartTime = "08:00";
const defaultDayEndTime = "18:00";
// Le giornate intere salvate prima del passaggio a 08:00-18:00 — e quelle che
// arrivano dai client esterni — usano ancora 08:00-17:00 come marcatore:
// va riconosciuto in lettura, altrimenti risulterebbero assenze a ore.
const legacyDayEndTime = "17:00";
const absenceModes = { halfDay: "half_day", days: "days" };
const shortMonthLabels = ["gen", "feb", "mar", "apr", "mag", "giu", "lug", "ago", "set", "ott", "nov", "dic"];
const fullMonthLabels = ["gennaio", "febbraio", "marzo", "aprile", "maggio", "giugno", "luglio", "agosto", "settembre", "ottobre", "novembre", "dicembre"];
const allFilterValue = "all";
// Tetto di assenze mostrate per giornata: oltre questo si passa dal riepilogo.
const maxVisibleLanes = 10;
const noTeamFilterValue = "__no_team__";
const absenceBalancesDraftStorageKey = "thub-absence-balances-draft-v1";
const absenceRoleOptions = [
  { value: "IMPIEGATO", label: "Impiegato", color: "#2563eb", icon: "💻" },
  { value: "MAGAZZINIERE", label: "Magazziniere", color: "#d97706", icon: "📦" },
  { value: "AUTISTA", label: "Autista", color: "#7c3aed", icon: "🚚" },
  { value: "OFFICINA", label: "Officina", color: "#dc2626", icon: "🔧" },
  { value: "PULIZIE", label: "Pulizie", color: "#059669", icon: "🧹" },
  { value: "ALTRO", label: "Altro", color: "#64748b", icon: "👤" },
];

const absenceRoleByValue = new Map(absenceRoleOptions.map((role) => [role.value, role]));
const absenceRoleOrder = new Map(absenceRoleOptions.map((role, index) => [role.value, index]));

function absenceRoleIcon(roleValue) {
  return absenceRoleByValue.get(roleValue)?.icon ?? "👤";
}

function compareResourcesByRoleAndName(first, second, employeeRoleById, getId, getName) {
  const firstRoleOrder = absenceRoleOrder.get(employeeRoleById.get(getId(first))) ?? absenceRoleOptions.length;
  const secondRoleOrder = absenceRoleOrder.get(employeeRoleById.get(getId(second))) ?? absenceRoleOptions.length;
  if (firstRoleOrder !== secondRoleOrder) return firstRoleOrder - secondRoleOrder;
  return String(getName(first) ?? "").localeCompare(String(getName(second) ?? ""), "it", { sensitivity: "base" });
}

function createEmptyForm(date, defaultEmployeeId = "") {
  return {
    employee_id: defaultEmployeeId,
    justification_type: "FERIE",
    description: "",
    start_date: date,
    end_date: date,
    start_time: defaultDayStartTime,
    end_time: defaultDayEndTime,
  };
}

function normalizeTimeValue(value) {
  if (!value) return "";
  return String(value).slice(0, 5);
}

function inferAbsenceMode(item) {
  const startTime = normalizeTimeValue(item.start_time);
  const endTime = normalizeTimeValue(item.end_time);
  if (item.start_date !== item.end_date) return absenceModes.days;
  if (startTime === defaultDayStartTime && (endTime === defaultDayEndTime || endTime === legacyDayEndTime)) return absenceModes.days;
  return absenceModes.halfDay;
}

function isPartialDayAbsence(item) {
  return inferAbsenceMode(item) === absenceModes.halfDay;
}

/* Durata di un'assenza a ore, compattata per stare nella cella: "1h", "1h30", "45m". */
function partialDurationLabel(item) {
  const startTime = normalizeTimeValue(item.start_time);
  const endTime = normalizeTimeValue(item.end_time);
  if (!startTime || !endTime) return "";
  const minutes = dayjs(`2000-01-01T${endTime}`).diff(dayjs(`2000-01-01T${startTime}`), "minute");
  if (!Number.isFinite(minutes) || minutes <= 0) return "";
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  if (!hours) return `${rest}m`;
  return rest ? `${hours}h${String(rest).padStart(2, "0")}` : `${hours}h`;
}

function partialTimeRangeLabel(item) {
  const startTime = normalizeTimeValue(item.start_time);
  const endTime = normalizeTimeValue(item.end_time);
  if (!startTime || !endTime) return "";
  return `${startTime} - ${endTime}`;
}

function formatShortDateLabel(value) {
  const parsed = dayjs(value);
  if (!parsed.isValid()) return value;
  return `${parsed.date()} ${shortMonthLabels[parsed.month()]} ${parsed.year()}`;
}

function formatDateRangeLabel(startDate, endDate) {
  if (startDate === endDate) return formatShortDateLabel(startDate);
  return `${formatShortDateLabel(startDate)} – ${formatShortDateLabel(endDate)}`;
}

function toPickerDate(value) {
  const parsed = dayjs(value);
  if (!parsed.isValid()) return undefined;
  return parsed.toDate();
}

function toIsoDate(value) {
  return dayjs(value).format("YYYY-MM-DD");
}

function formatCsvDate(value) {
  const parsed = dayjs(value);
  return parsed.isValid() ? parsed.format("DD/MM/YYYY") : value;
}

function formatPlannerAssignmentDetail(assignment) {
  const startTime = normalizeTimeValue(assignment.start_time);
  const endTime = normalizeTimeValue(assignment.end_time);
  const location = [assignment.area, assignment.immobile].filter(Boolean).join(" / ");
  const cause = assignment.cause
    ? assignment.cause.charAt(0) + assignment.cause.slice(1).toLowerCase()
    : "Attività";
  const details = [
    formatCsvDate(assignment.work_date),
    startTime && endTime ? `${startTime}–${endTime}` : null,
    location || assignment.site,
    cause,
    assignment.training_course_title,
    assignment.customer,
    assignment.activity,
  ].filter(Boolean);

  const breakStart = normalizeTimeValue(assignment.break_start);
  const breakEnd = normalizeTimeValue(assignment.break_end);
  if (breakStart && breakEnd) details.push(`pausa ${breakStart}–${breakEnd}`);
  return details.join(" · ");
}

function escapeXmlValue(value) {
  if (value == null) return "";
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

async function fetchAssetBytes(url) {
  const response = await fetch(url);
  return new Uint8Array(await response.arrayBuffer());
}

function buildCrc32Table() {
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i += 1) {
    let c = i;
    for (let j = 0; j < 8; j += 1) c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
    table[i] = c >>> 0;
  }
  return table;
}

const crc32Table = buildCrc32Table();

function crc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) crc = crc32Table[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function encodeUtf8(value) {
  return new TextEncoder().encode(value);
}

function writeUint16(view, offset, value) {
  view.setUint16(offset, value, true);
}

function writeUint32(view, offset, value) {
  view.setUint32(offset, value, true);
}

function createZip(entries) {
  const fileParts = [];
  const centralParts = [];
  let offset = 0;

  for (const entry of entries) {
    const nameBytes = encodeUtf8(entry.name);
    const dataBytes = entry.data instanceof Uint8Array ? entry.data : encodeUtf8(entry.data);
    const crc = crc32(dataBytes);
    const localHeader = new Uint8Array(30 + nameBytes.length);
    const localView = new DataView(localHeader.buffer);
    writeUint32(localView, 0, 0x04034b50);
    writeUint16(localView, 4, 20);
    writeUint16(localView, 6, 0);
    writeUint16(localView, 8, 0);
    writeUint16(localView, 10, 0);
    writeUint16(localView, 12, 0);
    writeUint32(localView, 14, crc);
    writeUint32(localView, 18, dataBytes.length);
    writeUint32(localView, 22, dataBytes.length);
    writeUint16(localView, 26, nameBytes.length);
    writeUint16(localView, 28, 0);
    localHeader.set(nameBytes, 30);
    fileParts.push(localHeader, dataBytes);

    const centralHeader = new Uint8Array(46 + nameBytes.length);
    const centralView = new DataView(centralHeader.buffer);
    writeUint32(centralView, 0, 0x02014b50);
    writeUint16(centralView, 4, 20);
    writeUint16(centralView, 6, 20);
    writeUint16(centralView, 8, 0);
    writeUint16(centralView, 10, 0);
    writeUint16(centralView, 12, 0);
    writeUint16(centralView, 14, 0);
    writeUint32(centralView, 16, crc);
    writeUint32(centralView, 20, dataBytes.length);
    writeUint32(centralView, 24, dataBytes.length);
    writeUint16(centralView, 28, nameBytes.length);
    writeUint16(centralView, 30, 0);
    writeUint16(centralView, 32, 0);
    writeUint16(centralView, 34, 0);
    writeUint16(centralView, 36, 0);
    writeUint32(centralView, 38, 0);
    writeUint32(centralView, 42, offset);
    centralHeader.set(nameBytes, 46);
    centralParts.push(centralHeader);

    offset += localHeader.length + dataBytes.length;
  }

  const centralSize = centralParts.reduce((sum, part) => sum + part.length, 0);
  const end = new Uint8Array(22);
  const endView = new DataView(end.buffer);
  writeUint32(endView, 0, 0x06054b50);
  writeUint16(endView, 4, 0);
  writeUint16(endView, 6, 0);
  writeUint16(endView, 8, entries.length);
  writeUint16(endView, 10, entries.length);
  writeUint32(endView, 12, centralSize);
  writeUint32(endView, 16, offset);
  writeUint16(endView, 20, 0);

  return new Blob([...fileParts, ...centralParts, end], {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
}

function cellRef(column, row) {
  let dividend = column;
  let name = "";
  while (dividend > 0) {
    const modulo = (dividend - 1) % 26;
    name = String.fromCharCode(65 + modulo) + name;
    dividend = Math.floor((dividend - modulo) / 26);
  }
  return `${name}${row}`;
}

function buildInlineCell(column, row, value, styleId) {
  return `<c r="${cellRef(column, row)}" t="inlineStr" s="${styleId}"><is><t>${escapeXmlValue(value)}</t></is></c>`;
}

function buildNumberCell(column, row, value, styleId) {
  return `<c r="${cellRef(column, row)}" s="${styleId}"><v>${value}</v></c>`;
}

function buildRow(rowNumber, cells, height = null) {
  const heightAttrs = height ? ` ht="${height}" customHeight="1"` : "";
  return `<row r="${rowNumber}"${heightAttrs}>${cells.join("")}</row>`;
}

function buildSheetXml({ rows, periodLabel, generatedAtLabel, employeeFilterLabel }) {
  const xmlRows = [];
  xmlRows.push(buildRow(1, [
    buildInlineCell(3, 1, "Export assenze ultimo mese", 1),
  ], 30));
  xmlRows.push(buildRow(2, [
    buildInlineCell(3, 2, "Report brandizzato Tonoli generato da T-Hub", 2),
  ], 22));
  xmlRows.push(buildRow(4, [
    buildInlineCell(1, 4, "Periodo", 3),
    buildInlineCell(2, 4, periodLabel, 4),
    buildInlineCell(4, 4, "Filtro dipendente", 3),
    buildInlineCell(5, 4, employeeFilterLabel, 4),
    buildInlineCell(7, 4, "Generato il", 3),
    buildInlineCell(8, 4, generatedAtLabel, 4),
  ], 20));
  xmlRows.push(buildRow(6, [
    buildInlineCell(1, 6, "Dipendente", 5),
    buildInlineCell(2, 6, "Tipo", 5),
    buildInlineCell(3, 6, "Stato", 5),
    buildInlineCell(4, 6, "Data inizio", 5),
    buildInlineCell(5, 6, "Data fine", 5),
    buildInlineCell(6, 6, "Giorni", 5),
    buildInlineCell(7, 6, "Ora inizio", 5),
    buildInlineCell(8, 6, "Ora fine", 5),
    buildInlineCell(9, 6, "Descrizione", 5),
    buildInlineCell(10, 6, "Creata da", 5),
    buildInlineCell(11, 6, "Decisa da", 5),
  ], 22));

  rows.forEach((item, index) => {
    const rowNumber = index + 7;
    const baseStyle = index % 2 === 0 ? 6 : 7;
    const typeStyle =
      item.justification_type === "FERIE" ? 8 :
      item.justification_type === "PERMESSO" ? 9 : 10;
    const statusStyle =
      item.approval_status === "approved" ? 11 :
      item.approval_status === "rejected" ? 12 : 13;
    xmlRows.push(buildRow(rowNumber, [
      buildInlineCell(1, rowNumber, item.employee_name ?? "", baseStyle),
      buildInlineCell(2, rowNumber, "ASSENZA", typeStyle),
      buildInlineCell(3, rowNumber, approvalStatusLabel(item.approval_status), statusStyle),
      buildInlineCell(4, rowNumber, formatCsvDate(item.start_date), baseStyle),
      buildInlineCell(5, rowNumber, formatCsvDate(item.end_date), baseStyle),
      buildNumberCell(6, rowNumber, countAbsentDays(item), baseStyle),
      buildInlineCell(7, rowNumber, normalizeTimeValue(item.start_time) || "-", baseStyle),
      buildInlineCell(8, rowNumber, normalizeTimeValue(item.end_time) || "-", baseStyle),
      buildInlineCell(9, rowNumber, item.description || "-", baseStyle),
      buildInlineCell(10, rowNumber, item.created_by_name || item.requested_by_employee_name || "-", baseStyle),
      buildInlineCell(11, rowNumber, item.decided_by_name || "-", baseStyle),
    ], 20));
  });

  const lastRow = Math.max(rows.length + 6, 6);
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:xdr="http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing">
  <dimension ref="A1:K${lastRow}"/>
  <sheetViews><sheetView workbookViewId="0"/></sheetViews>
  <sheetFormatPr defaultRowHeight="15"/>
  <cols>
    <col min="1" max="1" width="24" customWidth="1"/>
    <col min="2" max="3" width="16" customWidth="1"/>
    <col min="4" max="5" width="15" customWidth="1"/>
    <col min="6" max="6" width="10" customWidth="1"/>
    <col min="7" max="8" width="12" customWidth="1"/>
    <col min="9" max="9" width="38" customWidth="1"/>
    <col min="10" max="11" width="22" customWidth="1"/>
  </cols>
  <sheetData>${xmlRows.join("")}</sheetData>
  <mergeCells count="2">
    <mergeCell ref="C1:K1"/>
    <mergeCell ref="C2:K2"/>
  </mergeCells>
  <drawing r:id="rId1"/>
</worksheet>`;
}

function buildWorkbookXml() {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <sheets>
    <sheet name="Assenze" sheetId="1" r:id="rId1"/>
  </sheets>
</workbook>`;
}

function buildStylesXml() {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <fonts count="5">
    <font><sz val="11"/><name val="Calibri"/><family val="2"/><color rgb="FF2B2B2B"/></font>
    <font><b/><sz val="18"/><name val="Calibri"/><family val="2"/><color rgb="FF0A5235"/></font>
    <font><sz val="11"/><name val="Calibri"/><family val="2"/><color rgb="FF6B6560"/></font>
    <font><b/><sz val="11"/><name val="Calibri"/><family val="2"/><color rgb="FFFFFFFF"/></font>
    <font><b/><sz val="11"/><name val="Calibri"/><family val="2"/><color rgb="FF2B2B2B"/></font>
  </fonts>
  <fills count="9">
    <fill><patternFill patternType="none"/></fill>
    <fill><patternFill patternType="gray125"/></fill>
    <fill><patternFill patternType="solid"><fgColor rgb="FFFFFFFF"/><bgColor indexed="64"/></patternFill></fill>
    <fill><patternFill patternType="solid"><fgColor rgb="FFF6F1E6"/><bgColor indexed="64"/></patternFill></fill>
    <fill><patternFill patternType="solid"><fgColor rgb="FF007040"/><bgColor indexed="64"/></patternFill></fill>
    <fill><patternFill patternType="solid"><fgColor rgb="FFE4F0EA"/><bgColor indexed="64"/></patternFill></fill>
    <fill><patternFill patternType="solid"><fgColor rgb="FFFFF1CF"/><bgColor indexed="64"/></patternFill></fill>
    <fill><patternFill patternType="solid"><fgColor rgb="FFF7DDDA"/><bgColor indexed="64"/></patternFill></fill>
    <fill><patternFill patternType="solid"><fgColor rgb="FFF9EBC8"/><bgColor indexed="64"/></patternFill></fill>
  </fills>
  <borders count="2">
    <border><left/><right/><top/><bottom/><diagonal/></border>
    <border>
      <left style="thin"><color rgb="FFE6E0CF"/></left>
      <right style="thin"><color rgb="FFE6E0CF"/></right>
      <top style="thin"><color rgb="FFE6E0CF"/></top>
      <bottom style="thin"><color rgb="FFE6E0CF"/></bottom>
      <diagonal/>
    </border>
  </borders>
  <cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
  <cellXfs count="14">
    <xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>
    <xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1" applyAlignment="1"><alignment horizontal="left" vertical="center"/></xf>
    <xf numFmtId="0" fontId="2" fillId="0" borderId="0" xfId="0" applyFont="1" applyAlignment="1"><alignment horizontal="left" vertical="center"/></xf>
    <xf numFmtId="0" fontId="4" fillId="0" borderId="0" xfId="0" applyFont="1" applyAlignment="1"><alignment horizontal="left" vertical="center"/></xf>
    <xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0" applyAlignment="1"><alignment horizontal="left" vertical="center"/></xf>
    <xf numFmtId="0" fontId="3" fillId="4" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf>
    <xf numFmtId="0" fontId="0" fillId="2" borderId="1" xfId="0" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="left" vertical="center"/></xf>
    <xf numFmtId="0" fontId="0" fillId="3" borderId="1" xfId="0" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="left" vertical="center"/></xf>
    <xf numFmtId="0" fontId="4" fillId="5" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf>
    <xf numFmtId="0" fontId="4" fillId="6" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf>
    <xf numFmtId="0" fontId="4" fillId="2" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf>
    <xf numFmtId="0" fontId="4" fillId="5" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf>
    <xf numFmtId="0" fontId="4" fillId="7" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf>
    <xf numFmtId="0" fontId="4" fillId="8" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf>
  </cellXfs>
  <cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>
</styleSheet>`;
}

function buildContentTypesXml() {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Default Extension="png" ContentType="image/png"/>
  <Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
  <Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>
  <Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>
  <Override PartName="/xl/drawings/drawing1.xml" ContentType="application/vnd.openxmlformats-officedocument.drawing+xml"/>
  <Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>
  <Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/>
</Types>`;
}

function buildRootRelsXml() {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>
  <Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/>
  <Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties" Target="docProps/app.xml"/>
</Relationships>`;
}

function buildWorkbookRelsXml() {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>
  <Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
</Relationships>`;
}

function buildSheetRelsXml() {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/drawing" Target="../drawings/drawing1.xml"/>
</Relationships>`;
}

function buildDrawingXml() {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<xdr:wsDr xmlns:xdr="http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">
  <xdr:twoCellAnchor editAs="oneCell">
    <xdr:from><xdr:col>0</xdr:col><xdr:colOff>0</xdr:colOff><xdr:row>0</xdr:row><xdr:rowOff>0</xdr:rowOff></xdr:from>
    <xdr:to><xdr:col>1</xdr:col><xdr:colOff>381000</xdr:colOff><xdr:row>2</xdr:row><xdr:rowOff>152400</xdr:rowOff></xdr:to>
    <xdr:pic>
      <xdr:nvPicPr>
        <xdr:cNvPr id="1" name="Logo Tonoli"/>
        <xdr:cNvPicPr/>
      </xdr:nvPicPr>
      <xdr:blipFill>
        <a:blip r:embed="rId1" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"/>
        <a:stretch><a:fillRect/></a:stretch>
      </xdr:blipFill>
      <xdr:spPr>
        <a:xfrm><a:off x="0" y="0"/><a:ext cx="1524000" cy="609600"/></a:xfrm>
        <a:prstGeom prst="rect"><a:avLst/></a:prstGeom>
      </xdr:spPr>
    </xdr:pic>
    <xdr:clientData/>
  </xdr:twoCellAnchor>
</xdr:wsDr>`;
}

function buildDrawingRelsXml() {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="../media/image1.png"/>
</Relationships>`;
}

function buildCorePropsXml() {
  const created = dayjs().toISOString();
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:dcmitype="http://purl.org/dc/dcmitype/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">
  <dc:creator>T-Hub</dc:creator>
  <cp:lastModifiedBy>T-Hub</cp:lastModifiedBy>
  <dcterms:created xsi:type="dcterms:W3CDTF">${created}</dcterms:created>
  <dcterms:modified xsi:type="dcterms:W3CDTF">${created}</dcterms:modified>
</cp:coreProperties>`;
}

function buildAppPropsXml() {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties" xmlns:vt="http://schemas.openxmlformats.org/officeDocument/2006/docPropsVTypes">
  <Application>Microsoft Excel</Application>
  <DocSecurity>0</DocSecurity>
  <ScaleCrop>false</ScaleCrop>
  <HeadingPairs><vt:vector size="2" baseType="variant"><vt:variant><vt:lpstr>Worksheets</vt:lpstr></vt:variant><vt:variant><vt:i4>1</vt:i4></vt:variant></vt:vector></HeadingPairs>
  <TitlesOfParts><vt:vector size="1" baseType="lpstr"><vt:lpstr>Assenze</vt:lpstr></vt:vector></TitlesOfParts>
  <Company>Tonoli</Company>
  <LinksUpToDate>false</LinksUpToDate>
  <SharedDoc>false</SharedDoc>
  <HyperlinksChanged>false</HyperlinksChanged>
  <AppVersion>16.0300</AppVersion>
</Properties>`;
}

function buildAbsenceExcelWorkbook({ rows, periodLabel, generatedAtLabel, employeeFilterLabel, logoBytes }) {
  return createZip([
    { name: "[Content_Types].xml", data: buildContentTypesXml() },
    { name: "_rels/.rels", data: buildRootRelsXml() },
    { name: "docProps/core.xml", data: buildCorePropsXml() },
    { name: "docProps/app.xml", data: buildAppPropsXml() },
    { name: "xl/workbook.xml", data: buildWorkbookXml() },
    { name: "xl/_rels/workbook.xml.rels", data: buildWorkbookRelsXml() },
    { name: "xl/styles.xml", data: buildStylesXml() },
    { name: "xl/worksheets/sheet1.xml", data: buildSheetXml({ rows, periodLabel, generatedAtLabel, employeeFilterLabel }) },
    { name: "xl/worksheets/_rels/sheet1.xml.rels", data: buildSheetRelsXml() },
    { name: "xl/drawings/drawing1.xml", data: buildDrawingXml() },
    { name: "xl/drawings/_rels/drawing1.xml.rels", data: buildDrawingRelsXml() },
    { name: "xl/media/image1.png", data: logoBytes },
  ]);
}

function downloadBlob(blob, filename) {
  const url = window.URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  window.URL.revokeObjectURL(url);
}

function getWeekStart(date) {
  const weekday = date.day();
  const diff = weekday === 0 ? -6 : 1 - weekday;
  return date.add(diff, "day").startOf("day");
}

function isWeekendDay(date) {
  return date.day() === 0 || date.day() === 6;
}

function getRange(view, currentDate) {
  if (view === "day") return { start: currentDate.startOf("day"), end: currentDate.endOf("day") };
  if (view === "week") {
    const start = getWeekStart(currentDate);
    return { start, end: start.add(4, "day").endOf("day") };
  }
  return { start: currentDate.startOf("month"), end: currentDate.endOf("month") };
}

function getDaysForMonth(currentDate) {
  const monthStart = currentDate.startOf("month");
  const monthEnd = currentDate.endOf("month");
  const gridStart = getWeekStart(monthStart);
  const gridEnd = getWeekStart(monthEnd).add(4, "day");
  const days = [];
  let cursor = gridStart;
  while (cursor.isBefore(gridEnd) || cursor.isSame(gridEnd, "day")) {
    if (!isWeekendDay(cursor)) days.push(cursor);
    cursor = cursor.add(1, "day");
  }
  return days;
}

function splitWeeks(days) {
  const weeks = [];
  for (let i = 0; i < days.length; i += 5) weeks.push(days.slice(i, i + 5));
  return weeks;
}

function overlapsDay(item, date) {
  if (item.justification_type === "FERIE" && (date.day() === 0 || date.day() === 6)) return false;
  return (
    dayjs(item.start_date).isSame(date, "day") ||
    dayjs(item.end_date).isSame(date, "day") ||
    (dayjs(item.start_date).isBefore(date, "day") && dayjs(item.end_date).isAfter(date, "day"))
  );
}

function overlapsRange(item, start, end) {
  const itemStart = dayjs(item.start_date).startOf("day");
  const itemEnd = dayjs(item.end_date).startOf("day");
  return !itemEnd.isBefore(start, "day") && !itemStart.isAfter(end, "day");
}

function buildWeekSegments(week, items, maxLanes = maxVisibleLanes) {
  const weekStart = week[0].startOf("day");
  const weekEnd = week[week.length - 1].endOf("day");
  const relevant = items
    .filter((item) => overlapsRange(item, weekStart, weekEnd))
    .map((item) => {
      const itemStart = dayjs(item.start_date).startOf("day");
      const itemEnd = dayjs(item.end_date).startOf("day");
      const visibleStart = itemStart.isBefore(weekStart, "day") ? weekStart : itemStart;
      const visibleEnd = itemEnd.isAfter(weekEnd, "day") ? weekEnd.startOf("day") : itemEnd;
      const colStart = week.findIndex((date) => date.isSame(visibleStart, "day")) + 1;
      const colEnd = week.findIndex((date) => date.isSame(visibleEnd, "day")) + 1;
      return {
        ...item,
        visibleStart,
        visibleEnd,
        colStart,
        colSpan: colEnd - colStart + 1,
        startsBeforeWeek: itemStart.isBefore(weekStart, "day"),
        endsAfterWeek: itemEnd.isAfter(weekEnd, "day"),
      };
    })
    .filter((seg) => seg.colStart > 0 && seg.colSpan > 0)
    .sort((l, r) => {
      const byStart = l.visibleStart.diff(r.visibleStart, "day");
      return byStart !== 0 ? byStart : r.colSpan - l.colSpan;
    });

  const laneEnds = [];
  const positioned = relevant.map((seg) => {
    let lane = laneEnds.findIndex((le) => le.isBefore(seg.visibleStart, "day"));
    if (lane === -1) { lane = laneEnds.length; laneEnds.push(seg.visibleEnd); }
    else { laneEnds[lane] = seg.visibleEnd; }
    return { ...seg, lane };
  });

  // Oltre il tetto di corsie le assenze restano fuori dalla griglia: il conteggio
  // per giornata finisce nel badge "+N", che apre il riepilogo del giorno.
  const segments = positioned.filter((seg) => seg.lane < maxLanes);
  const hiddenByColumn = week.map(() => 0);
  for (const seg of positioned) {
    if (seg.lane < maxLanes) continue;
    for (let offset = 0; offset < seg.colSpan; offset++) {
      hiddenByColumn[seg.colStart - 1 + offset] += 1;
    }
  }

  return { lanes: Math.max(Math.min(laneEnds.length, maxLanes), 1), segments, hiddenByColumn };
}

function eventToneClass(type) {
  if (type === "FERIE") return "ferie";
  if (type === "PERMESSO") return "permesso";
  return "altro";
}

function approvalToneClass(item) {
  if (item.approval_status === "rejected") return " rejected";
  if (item.requires_my_approval && item.approval_status === "pending") return " approval-pending";
  if (item.approval_status === "pending") return " pending";
  return "";
}

function approvalStatusLabel(status) {
  if (status === "approved") return "Approvato";
  if (status === "pending") return "In attesa";
  if (status === "rejected") return "Rifiutato";
  return status;
}

function eventBadgeIcon(type) {
  if (type === "FERIE") return "🌴";
  if (type === "PERMESSO") return "🏆";
  return "✳";
}

function justificationTypeLabel(type) {
  if (type === "PERMESSO") return "Permesso";
  return "Altro";
}

function getInitials(name) {
  if (!name) return "?";
  return name.split(/\s+/).map((w) => w[0]).slice(0, 2).join("").toUpperCase();
}

const dayNames = ["Dom", "Lun", "Mar", "Mer", "Gio", "Ven", "Sab"];

function formatNavLabel(view, currentDate) {
  if (view === "day") {
    const dow = dayNames[currentDate.day()];
    return `${dow} ${currentDate.date()} ${shortMonthLabels[currentDate.month()]} ${currentDate.year()}`;
  }
  if (view === "week") {
    const start = getWeekStart(currentDate);
    const end = start.add(4, "day");
    if (start.month() === end.month()) return `${start.date()} – ${end.date()} ${shortMonthLabels[start.month()]} ${start.year()}`;
    const endYear = start.year() !== end.year() ? ` ${end.year()}` : "";
    return `${start.date()} ${shortMonthLabels[start.month()]} – ${end.date()} ${shortMonthLabels[end.month()]}${endYear} ${start.year()}`;
  }
  const formatted = `${fullMonthLabels[currentDate.month()]} ${currentDate.year()}`;
  return formatted.charAt(0).toUpperCase() + formatted.slice(1);
}

function countAbsentDays(j) {
  const start = dayjs(j.start_date);
  const totalDays = dayjs(j.end_date).diff(start, "day") + 1;
  if (j.justification_type !== "FERIE") return totalDays;
  let count = 0;
  for (let i = 0; i < totalDays; i++) {
    const weekday = start.add(i, "day").day(); // 0 = domenica, 6 = sabato
    if (weekday !== 0 && weekday !== 6) count++;
  }
  return count;
}

function countPartialAbsenceMinutes(j) {
  if (!isPartialDayAbsence(j)) return 0;
  const startTime = normalizeTimeValue(j.start_time);
  const endTime = normalizeTimeValue(j.end_time);
  if (!startTime || !endTime) return 0;
  const minutes = dayjs(`2000-01-01T${endTime}`).diff(dayjs(`2000-01-01T${startTime}`), "minute");
  return Number.isFinite(minutes) && minutes > 0 ? minutes : 0;
}

function formatAbsenceTotal(totalDays, totalMinutes) {
  const parts = [];
  if (totalDays > 0 || totalMinutes === 0) {
    parts.push(`${totalDays} giorn${totalDays === 1 ? "o" : "i"}`);
  }
  if (totalMinutes > 0) {
    const hours = Math.floor(totalMinutes / 60);
    const minutes = totalMinutes % 60;
    if (hours > 0) parts.push(`${hours} or${hours === 1 ? "a" : "e"}`);
    if (minutes > 0) parts.push(`${minutes} minut${minutes === 1 ? "o" : "i"}`);
  }
  return parts.join(" e ");
}

/* ─── KPI Card ─────────────────────────────────────────────────────────── */
function KpiCard({ title, value, icon, accent, warn }) {
  return (
    <Paper className={["kpi-card", accent ? "accent" : "", warn ? "warn" : ""].filter(Boolean).join(" ")}>
      <Box className="kpi-card-icon">{icon}</Box>
      <Box className="kpi-card-value">{value}</Box>
      <Box className="kpi-card-title">{title}</Box>
    </Paper>
  );
}

/* ─── Employee Avatar (foto + fallback iniziale) ────────────────────────── */
function EmployeeAvatarById({ employeeId, employeeName, size = 32 }) {
  const { data: photoUrl } = useQuery({
    queryKey: ["employee-photo", employeeId],
    queryFn: () => getEmployeePhoto(employeeId).then((blob) => URL.createObjectURL(blob)),
    staleTime: Infinity,
    gcTime: 30 * 60 * 1000,
    retry: false,
  });

  return (
    <Avatar
      src={photoUrl}
      alt={employeeName}
      sx={{ width: size, height: size, bgcolor: "#007040", fontWeight: 700, fontSize: Math.round(size * 0.42), flexShrink: 0 }}
    >
      {(employeeName || "?").charAt(0).toUpperCase()}
    </Avatar>
  );
}

/* ─── Employee Absence Search ───────────────────────────────────────────── */
function EmpAbsenceSearch({ allJustifications, employees }) {
  const [inputValue, setInputValue] = useState("");
  const [selectedEmployee, setSelectedEmployee] = useState(null);

  const employeeNameById = useMemo(
    () => new Map((employees ?? []).map((employee) => [employee.id, employee.full_name])),
    [employees]
  );

  const employeeOptions = useMemo(() => {
    const grouped = new Map();
    for (const justification of allJustifications) {
      if (justification.approval_status === "rejected" || !justification.employee_id) continue;
      const existing = grouped.get(justification.employee_id);
      if (existing) {
        existing.items.push(justification);
        continue;
      }
      grouped.set(justification.employee_id, {
        id: justification.employee_id,
        name: employeeNameById.get(justification.employee_id) ?? justification.employee_name ?? "Dipendente",
        items: [justification],
      });
    }

    return [...grouped.values()]
      .map((group) => {
        const items = group.items.slice().sort((a, b) => b.start_date.localeCompare(a.start_date));
        return {
          ...group,
          items,
          totalDays: items.reduce(
            (acc, justification) => acc + (isPartialDayAbsence(justification) ? 0 : countAbsentDays(justification)),
            0
          ),
          totalMinutes: items.reduce(
            (acc, justification) => acc + countPartialAbsenceMinutes(justification),
            0
          ),
        };
      })
      .sort((a, b) => a.name.localeCompare(b.name, "it", { sensitivity: "base" }));
  }, [allJustifications, employeeNameById]);

  const normalizedInput = inputValue.trim().toLowerCase();

  const exactMatch = useMemo(() => {
    if (!normalizedInput) return null;
    return employeeOptions.find((option) => option.name.trim().toLowerCase() === normalizedInput) ?? null;
  }, [employeeOptions, normalizedInput]);

  const partialMatches = useMemo(() => {
    if (!normalizedInput) return [];
    return employeeOptions.filter((option) => option.name.toLowerCase().includes(normalizedInput));
  }, [employeeOptions, normalizedInput]);

  const empAbsences = selectedEmployee ?? exactMatch;
  const showAmbiguousHint = !selectedEmployee && !exactMatch && partialMatches.length > 1;
  const showNoResults = normalizedInput && partialMatches.length === 0;

  return (
    <Paper className="riepilogo-card">
      <Typography className="riepilogo-section-title">🔍 Assenze per dipendente</Typography>
      <Box sx={{ mt: 1.5 }}>
        <Autocomplete
          options={employeeOptions}
          getOptionLabel={(option) => option.name ?? ""}
          isOptionEqualToValue={(option, value) => option.id === value.id}
          value={selectedEmployee}
          inputValue={inputValue}
          onInputChange={(_, value, reason) => {
            setInputValue(value);
            if (reason === "input" && selectedEmployee && value !== selectedEmployee.name) {
              setSelectedEmployee(null);
            }
            if (reason === "clear") setSelectedEmployee(null);
          }}
          onChange={(_, value) => {
            setSelectedEmployee(value);
            setInputValue(value?.name ?? "");
          }}
          renderInput={(params) => (
            <TextField
              {...params}
              placeholder="Scrivi il nome del dipendente…"
              fullWidth
              size="small"
            />
          )}
        />
      </Box>

      {showNoResults && (
        <Box className="emp-search-empty">Nessuna assenza trovata per "<strong>{inputValue}</strong>"</Box>
      )}

      {showAmbiguousHint && (
        <Box className="emp-search-empty">Sono presenti piu dipendenti compatibili: selezionane uno dai suggerimenti.</Box>
      )}

      {empAbsences && empAbsences.items.length > 0 && (
        <Box sx={{ mt: 2 }}>
          {/* Riepilogo numerico */}
          <Box className="emp-search-summary">
            <EmployeeAvatarById employeeId={empAbsences.id} employeeName={empAbsences.name} size={44} />
            <Box sx={{ flex: 1, minWidth: 0 }}>
              <Box className="emp-search-summary-name">{empAbsences.name}</Box>
              <Box className="emp-search-summary-sub">
                {formatAbsenceTotal(empAbsences.totalDays, empAbsences.totalMinutes)} totali
                {" · "}
                {empAbsences.items.length} assenz{empAbsences.items.length === 1 ? "a" : "e"}
              </Box>
            </Box>
          </Box>

          {/* Lista assenze */}
          <Stack spacing={0} sx={{ mt: 1.5 }}>
            {empAbsences.items.map((j) => {
              const isPartialDay = inferAbsenceMode(j) === absenceModes.halfDay;
              return (
                <Box key={j.id} className="emp-search-row">
                  <span className="emp-search-row-icon">{eventBadgeIcon(j.justification_type)}</span>
                  <Box className="emp-search-row-main">
                    <span className="emp-search-row-period">{formatDateRangeLabel(j.start_date, j.end_date)}</span>
                    <span className="emp-search-row-days">{countAbsentDays(j)} gg</span>
                    {isPartialDay && (
                      <span className="emp-search-row-hours">
                        {normalizeTimeValue(j.start_time)} – {normalizeTimeValue(j.end_time)}
                      </span>
                    )}
                    <span className={`richieste-type-badge ${eventToneClass(j.justification_type)}`}>
                      ASSENZA
                    </span>
                    <span className={`calendar-approval-badge ${j.approval_status}`}>
                      {approvalStatusLabel(j.approval_status)}
                    </span>
                  </Box>
                  {j.description && (
                    <Box className="emp-search-row-note">{j.description}</Box>
                  )}
                </Box>
              );
            })}
          </Stack>
        </Box>
      )}
    </Paper>
  );
}

/* ─── Residui ferie e permessi ─────────────────────────────────────────── */
function ResiduiTab({ canEdit, balancesQuery, statusQuery }) {
  const queryClient = useQueryClient();
  const [drafts, setDrafts] = useState({});
  const [draftsReady, setDraftsReady] = useState(false);
  const [dirtyEmployeeIds, setDirtyEmployeeIds] = useState(new Set());
  const [draftSaveStatus, setDraftSaveStatus] = useState("idle");
  const [search, setSearch] = useState("");
  const [exportError, setExportError] = useState("");
  const [isExporting, setIsExporting] = useState(false);
  const [confirmDialogOpen, setConfirmDialogOpen] = useState(false);
  const [confirmationDate, setConfirmationDate] = useState("");
  const expectedConfirmationDate = dayjs().startOf("month").subtract(1, "day").format("YYYY-MM-DD");
  const displayedUpdatedThrough = statusQuery.data?.updated_through ?? expectedConfirmationDate;

  useEffect(() => {
    if (draftsReady || !balancesQuery.data) return;
    const next = {};
    let storedDrafts = {};
    let storedDirtyIds = [];
    try {
      const stored = JSON.parse(window.localStorage.getItem(absenceBalancesDraftStorageKey) || "null");
      storedDrafts = stored?.drafts ?? {};
      storedDirtyIds = Array.isArray(stored?.dirtyEmployeeIds) ? stored.dirtyEmployeeIds : [];
    } catch {
      // Una bozza illeggibile non deve impedire l'apertura della tabella.
    }
    const availableEmployeeIds = new Set((balancesQuery.data ?? []).map((row) => row.employee_id));
    const restoredDirtyIds = new Set(storedDirtyIds.filter((employeeId) => availableEmployeeIds.has(employeeId)));
    for (const row of balancesQuery.data ?? []) {
      const persisted = restoredDirtyIds.has(row.employee_id) ? storedDrafts[row.employee_id] : null;
      next[row.employee_id] = persisted ? {
        permission_hours: String(persisted.permission_hours ?? 0),
        vacation_days: String(persisted.vacation_days ?? 0),
      } : {
        permission_hours: String(row.permission_hours ?? 0),
        vacation_days: String(row.vacation_days ?? 0),
      };
    }
    setDrafts(next);
    setDirtyEmployeeIds(restoredDirtyIds);
    setDraftSaveStatus(restoredDirtyIds.size ? "saved" : "idle");
    setDraftsReady(true);
  }, [balancesQuery.data, draftsReady]);

  useEffect(() => {
    if (!canEdit || !draftsReady) return undefined;
    if (dirtyEmployeeIds.size === 0) {
      try {
        window.localStorage.removeItem(absenceBalancesDraftStorageKey);
      } catch {
        // Lo storage puo essere disabilitato dal browser.
      }
      setDraftSaveStatus("idle");
      return undefined;
    }

    setDraftSaveStatus("saving");
    const timeoutId = window.setTimeout(() => {
      try {
        const dirtyDrafts = {};
        for (const employeeId of dirtyEmployeeIds) dirtyDrafts[employeeId] = drafts[employeeId];
        window.localStorage.setItem(absenceBalancesDraftStorageKey, JSON.stringify({
          drafts: dirtyDrafts,
          dirtyEmployeeIds: [...dirtyEmployeeIds],
        }));
        setDraftSaveStatus("saved");
      } catch {
        setDraftSaveStatus("error");
      }
    }, 500);
    return () => window.clearTimeout(timeoutId);
  }, [canEdit, drafts, draftsReady, dirtyEmployeeIds]);

  const commitMutation = useMutation({
    mutationFn: commitAbsenceBalances,
    onSuccess: (result, payload) => {
      const savedRows = result.balances;
      setDrafts((current) => {
        const next = { ...current };
        for (const row of savedRows) {
          next[row.employee_id] = {
            permission_hours: String(row.permission_hours ?? 0),
            vacation_days: String(row.vacation_days ?? 0),
          };
        }
        return next;
      });
      setDirtyEmployeeIds(new Set());
      setDraftSaveStatus("idle");
      try {
        window.localStorage.removeItem(absenceBalancesDraftStorageKey);
      } catch {
        // Il commit server e comunque concluso correttamente.
      }
      queryClient.invalidateQueries({ queryKey: ["absence-balances"] });
      queryClient.invalidateQueries({ queryKey: ["absence-balance-status"] });
      for (const { employee_id: employeeId } of payload.changes) {
        queryClient.invalidateQueries({ queryKey: ["absence-balance", employeeId] });
      }
      setConfirmDialogOpen(false);
    },
  });

  const rows = useMemo(() => {
    const normalizedSearch = search.trim().toLocaleLowerCase("it");
    return (balancesQuery.data ?? []).filter((row) => (
      !normalizedSearch
      || row.employee_name.toLocaleLowerCase("it").includes(normalizedSearch)
      || row.tms_id.toLocaleLowerCase("it").includes(normalizedSearch)
    ));
  }, [balancesQuery.data, search]);

  function updateDraft(employeeId, field, value) {
    if (value !== "" && !/^-?\d*(?:[.,]\d{0,2})?$/.test(value)) return;
    setDrafts((current) => ({
      ...current,
      [employeeId]: { ...current[employeeId], [field]: value },
    }));
    setDirtyEmployeeIds((current) => new Set(current).add(employeeId));
  }

  function parseDraftValue(value) {
    if (value === "") return 0;
    const parsed = Number(String(value).replace(",", "."));
    return Number.isFinite(parsed) ? parsed : null;
  }

  function valueTone(value) {
    const parsed = parseDraftValue(value);
    if (parsed > 0) return "positive";
    if (parsed < 0) return "negative";
    return "neutral";
  }

  const invalidDirtyIds = [...dirtyEmployeeIds].filter((employeeId) => {
    const draft = drafts[employeeId];
    return (
      parseDraftValue(draft?.permission_hours ?? "") === null
      || parseDraftValue(draft?.vacation_days ?? "") === null
    );
  });

  function openCommitDialog() {
    if (!dirtyEmployeeIds.size || invalidDirtyIds.length) return;
    setConfirmationDate(expectedConfirmationDate);
    commitMutation.reset();
    setConfirmDialogOpen(true);
  }

  function confirmCommit() {
    if (confirmationDate !== expectedConfirmationDate) return;
    const changes = [...dirtyEmployeeIds].map((employeeId) => ({
      employee_id: employeeId,
      permission_hours: parseDraftValue(drafts[employeeId]?.permission_hours ?? ""),
      vacation_days: parseDraftValue(drafts[employeeId]?.vacation_days ?? ""),
    }));
    commitMutation.mutate({ updated_through: confirmationDate, changes });
  }

  function CommitBar({ position }) {
    if (!canEdit) return null;
    const dirtyCount = dirtyEmployeeIds.size;
    return (
      <Box className={`residui-commit-bar ${position}`}>
        <Box className={`residui-draft-status ${draftSaveStatus}`}>
          <span className="residui-draft-dot" />
          {draftSaveStatus === "saving" && "Salvataggio bozza…"}
          {draftSaveStatus === "saved" && `Bozza salvata automaticamente · ${dirtyCount} ${dirtyCount === 1 ? "modifica" : "modifiche"}`}
          {draftSaveStatus === "error" && "Bozza non salvata nel browser"}
          {draftSaveStatus === "idle" && "Nessuna modifica in bozza"}
        </Box>
        <Button
          variant="contained"
          className="residui-commit-button"
          onClick={openCommitDialog}
          disabled={!dirtyCount || invalidDirtyIds.length > 0 || commitMutation.isPending}
        >
          {commitMutation.isPending
            ? "Salvataggio globale…"
            : `Salva e conferma${dirtyCount ? ` (${dirtyCount})` : ""}`}
        </Button>
      </Box>
    );
  }

  async function handleExport() {
    setIsExporting(true);
    setExportError("");
    try {
      await exportAbsenceBalances();
    } catch (error) {
      setExportError(error?.message || "Errore durante l'esportazione");
    } finally {
      setIsExporting(false);
    }
  }

  if (balancesQuery.isLoading) {
    return <Box sx={{ p: 4, textAlign: "center", color: "text.secondary" }}>Caricamento residui…</Box>;
  }

  return (
    <Paper className="residui-shell">
      <Box className="residui-toolbar">
        <Box>
          <Typography className="riepilogo-section-title">Residui ferie e permessi</Typography>
          <Typography className="trend-subtitle">
            {canEdit
              ? "Aggiorna i valori disponibili per ciascun dipendente."
              : "Consultazione in sola lettura: non sei abilitato alla modifica dei residui."}
          </Typography>
        </Box>
        <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
          <TextField
            size="small"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Cerca dipendente…"
            className="residui-search"
          />
          <Button className="calendar-ghost-button" onClick={handleExport} disabled={isExporting}>
            {isExporting ? "Esportazione…" : "Export Excel"}
          </Button>
        </Stack>
      </Box>

      <Box className="residui-updated-through">
        <TextField
          size="small"
          label="Ferie e Permessi aggiornati al"
          value={dayjs(displayedUpdatedThrough).format("DD/MM/YYYY")}
          slotProps={{ input: { readOnly: true } }}
          className="residui-updated-through-field"
        />
        {statusQuery.data?.last_modified_by && (
          <Typography variant="caption" color="text.secondary">
            Ultima conferma di {statusQuery.data.last_modified_by}
          </Typography>
        )}
      </Box>

      {balancesQuery.error && <Alert severity="error" sx={{ m: 2 }}>{balancesQuery.error.message}</Alert>}
      {statusQuery.error && <Alert severity="error" sx={{ m: 2 }}>{statusQuery.error.message}</Alert>}
      {commitMutation.error && <Alert severity="error" sx={{ m: 2 }}>{commitMutation.error.message}</Alert>}
      {exportError && <Alert severity="error" sx={{ m: 2 }}>{exportError}</Alert>}
      {invalidDirtyIds.length > 0 && (
        <Alert severity="warning" sx={{ mx: 2, mt: 2 }}>
          Correggi i valori non validi prima del salvataggio globale.
        </Alert>
      )}

      <CommitBar position="top" />

      <Box sx={{ overflowX: "auto" }}>
        <Table size="small" className="residui-table">
          <TableHead>
            <TableRow>
              <TableCell>Dipendente</TableCell>
              <TableCell>Ferie (GG)</TableCell>
              <TableCell>Permessi (Ore)</TableCell>
              <TableCell>Ultima Modifica</TableCell>
              <TableCell>Utente Ultima Modifica</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {rows.map((row) => {
              const draft = drafts[row.employee_id] ?? { permission_hours: "0", vacation_days: "0" };
              const permissionHours = parseDraftValue(draft.permission_hours);
              const vacationDays = parseDraftValue(draft.vacation_days);
              const combinedDays = permissionHours !== null && vacationDays !== null
                ? vacationDays + (permissionHours / 8)
                : null;
              const hasNegativeCombinedBalance = combinedDays !== null && combinedDays < 0;
              return (
                <TableRow key={row.employee_id} hover className={hasNegativeCombinedBalance ? "residui-row-warning" : ""}>
                  <TableCell>
                    <Box className="residui-employee-cell">
                      <Typography variant="body2" fontWeight={700}>{row.employee_name}</Typography>
                      {hasNegativeCombinedBalance && (
                        <Tooltip title={`La somma di ferie e permessi è negativa (${combinedDays.toLocaleString("it-IT", { maximumFractionDigits: 2 })} giorni).`}>
                          <span className="residui-warning-badge">
                            ⚠ Saldo negativo ≈ {Math.abs(combinedDays).toLocaleString("it-IT", { maximumFractionDigits: 2 })} gg
                          </span>
                        </Tooltip>
                      )}
                    </Box>
                    <Typography variant="caption" color="text.secondary">Matricola {row.tms_id}</Typography>
                  </TableCell>
                  <TableCell>
                    <input
                      className={`residui-number-field ${valueTone(draft.vacation_days)}`}
                      value={draft.vacation_days}
                      disabled={!canEdit || commitMutation.isPending}
                      onChange={(event) => updateDraft(row.employee_id, "vacation_days", event.target.value)}
                      inputMode="decimal"
                      aria-label={`Ferie residue di ${row.employee_name}`}
                    />
                  </TableCell>
                  <TableCell>
                    <input
                      className={`residui-number-field ${valueTone(draft.permission_hours)}`}
                      value={draft.permission_hours}
                      disabled={!canEdit || commitMutation.isPending}
                      onChange={(event) => updateDraft(row.employee_id, "permission_hours", event.target.value)}
                      inputMode="decimal"
                      aria-label={`Permessi residui di ${row.employee_name}`}
                    />
                  </TableCell>
                  <TableCell>
                    {row.last_modified_at ? dayjs(row.last_modified_at).format("DD/MM/YYYY HH:mm") : "—"}
                  </TableCell>
                  <TableCell>{row.last_modified_by || "—"}</TableCell>
                </TableRow>
              );
            })}
            {!rows.length && (
              <TableRow>
                <TableCell colSpan={5} align="center" sx={{ py: 4, color: "text.secondary" }}>
                  Nessun dipendente trovato.
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </Box>
      <CommitBar position="bottom" />

      <Dialog open={confirmDialogOpen} onClose={() => !commitMutation.isPending && setConfirmDialogOpen(false)} maxWidth="xs" fullWidth>
        <DialogTitle>Conferma aggiornamento residui</DialogTitle>
        <DialogContent>
          <Stack spacing={2} sx={{ pt: 1 }}>
            <Typography variant="body2" color="text.secondary">
              Indica la data alla quale risultano aggiornati ferie e permessi. Deve corrispondere all’ultimo giorno del mese precedente.
            </Typography>
            <TextField
              autoFocus
              required
              fullWidth
              type="date"
              label="Ferie e Permessi aggiornati al"
              value={confirmationDate}
              onChange={(event) => setConfirmationDate(event.target.value)}
              error={Boolean(confirmationDate) && confirmationDate !== expectedConfirmationDate}
              helperText={confirmationDate && confirmationDate !== expectedConfirmationDate
                ? `La data richiesta è ${dayjs(expectedConfirmationDate).format("DD/MM/YYYY")}.`
                : `Data proposta: ${dayjs(expectedConfirmationDate).format("DD/MM/YYYY")}`}
              slotProps={{ inputLabel: { shrink: true }, htmlInput: { min: expectedConfirmationDate, max: expectedConfirmationDate } }}
            />
            {commitMutation.error && <Alert severity="error">{commitMutation.error.message}</Alert>}
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setConfirmDialogOpen(false)} disabled={commitMutation.isPending}>Annulla</Button>
          <Button
            variant="contained"
            onClick={confirmCommit}
            disabled={!confirmationDate || confirmationDate !== expectedConfirmationDate || commitMutation.isPending}
          >
            {commitMutation.isPending ? "Salvataggio…" : "Conferma salvataggio"}
          </Button>
        </DialogActions>
      </Dialog>
    </Paper>
  );
}

/* ─── Trend: tooltip e dettaglio giornata ───────────────────────────────── */
function TrendTooltip({ day, totalEmployees }) {
  const available = Math.max(totalEmployees - day.count, 0);
  const pct = totalEmployees > 0 ? Math.round((day.count / totalEmployees) * 100) : 0;
  // Le FERIE sono gia' il totale della barra: ripeterle nel dettaglio e' rumore.
  const types = Object.entries(day.byType).filter(([type, n]) => n > 0 && type !== "FERIE");

  return (
    <Box className="trend-tip-body">
      <Box className="trend-tip-date">
        {dayNames[day.date.day()]} {day.date.date()} {shortMonthLabels[day.date.month()]}
      </Box>
      <Box className="trend-tip-main">
        <strong>{day.count}</strong> assent{day.count === 1 ? "e" : "i"}
        {totalEmployees > 0 && <span className="trend-tip-pct"> · {pct}% dell&apos;organico</span>}
      </Box>
      {totalEmployees > 0 && (
        <Box className="trend-tip-avail">
          Disponibili {available} su {totalEmployees}
        </Box>
      )}
      {types.length > 0 && (
        <Box className="trend-tip-types">
          {types.map(([type, n]) => (
            <span key={type}>
              {eventBadgeIcon(type)} {justificationTypeLabel(type)} <strong>{n}</strong>
            </span>
          ))}
        </Box>
      )}
      {day.byRole.some((role) => role.count > 0) && (
        <Box className="trend-tip-types">
          {day.byRole.filter((role) => role.count > 0).map((role) => (
            <span key={role.value}>
              <i className="trend-tip-role-dot" style={{ background: role.color }} />
              {role.label} <strong>{role.count}</strong>
            </span>
          ))}
        </Box>
      )}
      {day.count > 0 && <Box className="trend-tip-hint">Clicca per l&apos;elenco</Box>}
    </Box>
  );
}

function TrendDayDialog({ day, totalEmployees, overlapIds, employees, employeeRoleById, onClose }) {
  const open = Boolean(day);
  const [visibleResources, setVisibleResources] = useState("absent");
  // Il dialog resta montato in chiusura: senza giornata mostro l'ultimo stato vuoto.
  const items = day?.items ?? [];
  const sortedItems = [...items].sort((first, second) => compareResourcesByRoleAndName(
    first,
    second,
    employeeRoleById,
    (item) => item.employee_id,
    (item) => item.employee_name,
  ));
  const count = day?.count ?? 0;
  const absentEmployeeIds = new Set(items.map((item) => item.employee_id));
  const availableEmployees = employees
    .filter((employee) => !absentEmployeeIds.has(employee.id))
    .sort((first, second) => compareResourcesByRoleAndName(
      first,
      second,
      employeeRoleById,
      (employee) => employee.id,
      (employee) => employee.full_name,
    ));
  const available = availableEmployees.length;
  const pct = totalEmployees > 0 ? Math.round((count / totalEmployees) * 100) : 0;
  const dayLabel = day
    ? `${dayNames[day.date.day()]} ${day.date.date()} ${shortMonthLabels[day.date.month()]} ${day.date.year()}`
    : "";

  useEffect(() => {
    setVisibleResources("absent");
  }, [day?.dateStr]);

  return (
    <Dialog open={open} onClose={onClose} fullWidth maxWidth="xs" PaperProps={{ className: "calendar-daysum-paper" }}>
      <DialogTitle className="calendar-daysum-title">
        <Box className="calendar-daysum-header">
          <Box>
            <Typography className="calendar-daysum-heading">{dayLabel}</Typography>
            <Typography className="calendar-daysum-subtitle">Copertura della giornata</Typography>
          </Box>
          <Button className="calendar-modal-close" onClick={onClose}>×</Button>
        </Box>
      </DialogTitle>
      <DialogContent className="calendar-daysum-content">
        <Box className="trend-detail-summary">
          <Box
            component="button"
            type="button"
            className={`trend-detail-metric${visibleResources === "absent" ? " active" : ""}`}
            aria-pressed={visibleResources === "absent"}
            onClick={() => setVisibleResources("absent")}
          >
            <span className="trend-detail-value">{count}</span>
            <span className="trend-detail-label">Assenti{totalEmployees > 0 ? ` · ${pct}%` : ""}</span>
          </Box>
          <Box
            component="button"
            type="button"
            className={`trend-detail-metric${visibleResources === "available" ? " active" : ""}`}
            aria-pressed={visibleResources === "available"}
            onClick={() => setVisibleResources("available")}
          >
            <span className="trend-detail-value">{available}</span>
            <span className="trend-detail-label">Disponibili</span>
          </Box>
        </Box>

        <Stack spacing={0.75} className="calendar-daysum-list">
          {visibleResources === "absent" && sortedItems.map((item) => {
            const roleValue = employeeRoleById.get(item.employee_id);
            const role = absenceRoleByValue.get(roleValue);
            return (
              <Box
                key={item.id}
                className={`calendar-inline-event ${eventToneClass(item.justification_type)}${approvalToneClass(item)}${overlapIds.has(item.id) ? " overlap-conflict" : ""}`}
              >
                <span
                  className="calendar-span-event-icon"
                  title={role?.label ?? "Categoria non assegnata"}
                  aria-label={role?.label ?? "Categoria non assegnata"}
                >
                  {absenceRoleIcon(roleValue)}
                </span>
                <span className="calendar-inline-event-name">{item.employee_name}</span>
                {isPartialDayAbsence(item) && (
                  <span className="calendar-hours-badge" title={partialTimeRangeLabel(item)}>
                    🕑 {partialTimeRangeLabel(item)}
                  </span>
                )}
                {overlapIds.has(item.id) && (
                  <span className="calendar-overlap-warn" title="Ha attività pianificate nel Planner">Sovrapp.</span>
                )}
                <span className={`calendar-approval-badge ${item.approval_status}`}>{approvalStatusLabel(item.approval_status)}</span>
              </Box>
            );
          })}
          {visibleResources === "available" && availableEmployees.map((employee) => {
            const roleValue = employeeRoleById.get(employee.id);
            const role = absenceRoleByValue.get(roleValue);
            return (
              <Box key={employee.id} className="calendar-inline-event present">
                <span
                  className="calendar-span-event-icon"
                  title={role?.label ?? "Categoria non assegnata"}
                  aria-label={role?.label ?? "Categoria non assegnata"}
                >
                  {absenceRoleIcon(roleValue)}
                </span>
                <span className="calendar-inline-event-name">{employee.full_name}</span>
                <span className="calendar-presence-badge">Presente</span>
              </Box>
            );
          })}
          {visibleResources === "absent" && !items.length && (
            <Typography className="calendar-empty-state">Nessuna assenza in questa giornata.</Typography>
          )}
          {visibleResources === "available" && !availableEmployees.length && (
            <Typography className="calendar-empty-state">Nessuna risorsa disponibile in questa giornata.</Typography>
          )}
        </Stack>
      </DialogContent>
      <DialogActions className="calendar-daysum-actions">
        <Button onClick={onClose} className="calendar-ghost-button">Chiudi</Button>
      </DialogActions>
    </Dialog>
  );
}

/* ─── Riepilogo Tab ─────────────────────────────────────────────────────── */
function RiepilogoTab({
  allJustifications,
  allAssignments,
  employees,
  today,
  periodMode,
  periodStart,
  periodEnd,
  onPeriodModeChange,
  onCustomPeriodChange,
}) {
  const todayStr = today.format("YYYY-MM-DD");
  const [selectedRoles, setSelectedRoles] = useState(() => absenceRoleOptions.map((role) => role.value));

  const employeeRoleById = useMemo(
    () => new Map(employees.map((employee) => [
      employee.id,
      String(employee.tms_role_description ?? "").trim().toUpperCase(),
    ])),
    [employees]
  );

  const selectedRoleSet = useMemo(() => new Set(selectedRoles), [selectedRoles]);
  const filteredEmployees = useMemo(
    () => employees.filter((employee) => selectedRoleSet.has(employeeRoleById.get(employee.id))),
    [employees, employeeRoleById, selectedRoleSet]
  );
  const filteredEmployeeIds = useMemo(
    () => new Set(filteredEmployees.map((employee) => employee.id)),
    [filteredEmployees]
  );
  const filteredTotalEmployees = filteredEmployees.length;

  const nonRejected = useMemo(
    () => allJustifications.filter((j) => (
      j.approval_status !== "rejected"
      && j.start_date <= periodEnd
      && j.end_date >= periodStart
    )),
    [allJustifications, periodStart, periodEnd]
  );

  const overlapPeriodStart = periodStart > todayStr ? periodStart : todayStr;
  const periodAssignments = useMemo(
    () => allAssignments.filter((assignment) => (
      assignment.work_date >= overlapPeriodStart
      && assignment.work_date <= periodEnd
    )),
    [allAssignments, overlapPeriodStart, periodEnd]
  );

  const overlapIds = useMemo(() => {
    const s = new Set();
    for (const j of nonRejected) {
      if (periodAssignments.some((a) => hasPlannerOverlap(j, a))) {
        s.add(j.id);
      }
    }
    return s;
  }, [nonRejected, periodAssignments]);

  const openOverlapIds = useMemo(() => {
    const ids = new Set();
    for (const justification of nonRejected) {
      const hasCurrentOrFutureOverlap = periodAssignments.some((assignment) => (
        assignment.work_date >= todayStr
        && hasPlannerOverlap(justification, assignment)
      ));
      if (hasCurrentOrFutureOverlap) ids.add(justification.id);
    }
    return ids;
  }, [nonRejected, periodAssignments, todayStr]);

  // Il grafico mostra i soli giorni lavorativi: le barre restano larghe e leggibili
  // e sparisce l'ambiguita' delle FERIE nel weekend, gia' escluse dal conteggio.
  const workingDays = useMemo(() => {
    const rangeStart = dayjs(periodStart);
    const rangeEnd = dayjs(periodEnd);
    const days = [];
    const rangeLength = rangeEnd.diff(rangeStart, "day") + 1;
    for (let i = 0; i < rangeLength; i++) {
      const date = rangeStart.add(i, "day");
      if (date.day() === 0 || date.day() === 6) continue;
      const dateStr = date.format("YYYY-MM-DD");
      // Una sola giustificazione per dipendente, cosi' il totale del giorno resta
      // allineato alle KPI in alto, che contano persone assenti e non richieste.
      const byEmployee = new Map();
      for (const j of nonRejected) {
        if (j.start_date > dateStr || j.end_date < dateStr) continue;
        if (!filteredEmployeeIds.has(j.employee_id)) continue;
        if (!byEmployee.has(j.employee_id)) byEmployee.set(j.employee_id, j);
      }
      const items = [...byEmployee.values()];
      const byType = {};
      for (const j of items) byType[j.justification_type] = (byType[j.justification_type] ?? 0) + 1;
      const byRole = absenceRoleOptions
        .filter((role) => selectedRoleSet.has(role.value))
        .map((role) => ({
          ...role,
          count: items.filter((item) => employeeRoleById.get(item.employee_id) === role.value).length,
        }));
      days.push({
        day: date.date(),
        date,
        dateStr,
        items,
        byType,
        byRole,
        count: items.length,
        isToday: dateStr === todayStr,
      });
    }
    return days;
  }, [nonRejected, periodStart, periodEnd, todayStr, filteredEmployeeIds, employeeRoleById, selectedRoleSet]);

  const absentPeriodSet = useMemo(
    () => new Set(workingDays.flatMap((day) => day.items.map((item) => item.employee_id))),
    [workingDays]
  );

  const periodSearchJustifications = useMemo(
    () => nonRejected.map((justification) => ({
      ...justification,
      start_date: justification.start_date < periodStart ? periodStart : justification.start_date,
      end_date: justification.end_date > periodEnd ? periodEnd : justification.end_date,
    })),
    [nonRejected, periodStart, periodEnd]
  );

  const avgAbsent = workingDays.length
    ? workingDays.reduce((sum, d) => sum + d.count, 0) / workingDays.length
    : 0;
  const availPct = filteredTotalEmployees > 0
    ? Math.round(((filteredTotalEmployees - avgAbsent) / filteredTotalEmployees) * 100)
    : 100;

  // Scala fissa sull'organico: l'altezza di una barra e' confrontabile fra mesi
  // diversi, e un picco basso resta visivamente basso.
  const chartMax = Math.max(filteredTotalEmployees, 1);
  const criticalRatio = 0.25;
  const criticalThreshold = filteredTotalEmployees * criticalRatio;

  const criticalDays = useMemo(
    () => workingDays.filter((d) => filteredTotalEmployees > 0 && d.count >= criticalThreshold && d.count > 0),
    [workingDays, filteredTotalEmployees, criticalThreshold]
  );

  const peakDay = useMemo(
    () => workingDays.reduce((best, d) => (best === null || d.count > best.count ? d : best), null),
    [workingDays]
  );

  const [trendDetailDay, setTrendDetailDay] = useState(null);

  const overlapAlerts = useMemo(
    () => nonRejected.filter((j) => overlapIds.has(j.id)),
    [nonRejected, overlapIds]
  );

  const startDate = dayjs(periodStart);
  const endDate = dayjs(periodEnd);
  const periodLabel = periodStart === periodEnd
    ? `${startDate.date()} ${fullMonthLabels[startDate.month()]} ${startDate.year()}`
    : startDate.month() === endDate.month() && startDate.year() === endDate.year()
      ? `${startDate.date()}–${endDate.date()} ${fullMonthLabels[startDate.month()]} ${startDate.year()}`
      : `${startDate.date()} ${fullMonthLabels[startDate.month()]} ${startDate.year()} – ${endDate.date()} ${fullMonthLabels[endDate.month()]} ${endDate.year()}`;

  const periodOptions = [
    { value: "today", label: "Oggi" },
    { value: "week", label: "Questa settimana" },
    { value: "month", label: "Questo mese" },
    { value: "custom", label: "Date selezionabili" },
  ];

  return (
    <Stack spacing={2.5}>
      <Paper className="riepilogo-period-filter">
        <Box className="riepilogo-period-header">
          <Box>
            <Typography className="riepilogo-period-title">Periodo di riferimento</Typography>
            <Typography className="riepilogo-period-current">{periodLabel}</Typography>
          </Box>
          <Box className="riepilogo-period-options" role="group" aria-label="Periodo del riepilogo">
            {periodOptions.map((option) => (
              <button
                key={option.value}
                type="button"
                className={`riepilogo-period-option${periodMode === option.value ? " active" : ""}`}
                aria-pressed={periodMode === option.value}
                onClick={() => {
                  setTrendDetailDay(null);
                  onPeriodModeChange(option.value);
                }}
              >
                {option.label}
              </button>
            ))}
          </Box>
        </Box>
        {periodMode === "custom" && (
          <Box className="riepilogo-custom-dates">
            <TextField
              type="date"
              label="Dal"
              size="small"
              value={periodStart}
              InputLabelProps={{ shrink: true }}
              inputProps={{ max: periodEnd }}
              onChange={(event) => {
                if (!event.target.value) return;
                setTrendDetailDay(null);
                const start = event.target.value;
                onCustomPeriodChange((current) => ({
                  start,
                  end: start > current.end ? start : current.end,
                }));
              }}
            />
            <TextField
              type="date"
              label="Al"
              size="small"
              value={periodEnd}
              InputLabelProps={{ shrink: true }}
              inputProps={{ min: periodStart }}
              onChange={(event) => {
                if (!event.target.value) return;
                setTrendDetailDay(null);
                const end = event.target.value;
                onCustomPeriodChange((current) => ({
                  start: end < current.start ? end : current.start,
                  end,
                }));
              }}
            />
          </Box>
        )}
      </Paper>

      {/* KPI Strip */}
      <Box className="kpi-grid">
        <KpiCard title="Risorse assenti nel periodo" value={absentPeriodSet.size} icon="🏖️" />
        <KpiCard title="Giorni lavorativi" value={workingDays.length} icon="📅" />
        <KpiCard title="Disponibilità media" value={`${availPct}%`} icon="✅" accent={availPct >= 80} warn={availPct < 70} />
        <KpiCard title="Sovrapposizioni da oggi" value={openOverlapIds.size} icon="⚠️" warn={openOverlapIds.size > 0} />
      </Box>

      {/* Monthly coverage chart */}
      <Paper className="riepilogo-card">
        <Box className="trend-header">
          <Box>
            <Typography className="riepilogo-section-title">
              Copertura · {periodLabel.charAt(0).toUpperCase() + periodLabel.slice(1)}
            </Typography>
            <Typography className="trend-subtitle">
              Persone assenti per giorno lavorativo, sul totale dell&apos;organico selezionato
            </Typography>
          </Box>
          <Box className="trend-scale-chip">Organico selezionato {filteredTotalEmployees}</Box>
        </Box>

        <Box className="trend-role-filter" aria-label="Filtra il grafico per ruolo">
          {absenceRoleOptions.map((role) => {
            const selected = selectedRoleSet.has(role.value);
            return (
              <button
                key={role.value}
                type="button"
                className={`trend-role-filter-button${selected ? " selected" : ""}`}
                aria-pressed={selected}
                onClick={() => {
                  setTrendDetailDay(null);
                  setSelectedRoles((current) => {
                    if (current.includes(role.value)) {
                      return current.length === 1 ? current : current.filter((value) => value !== role.value);
                    }
                    return [...current, role.value];
                  });
                }}
              >
                <span className="trend-role-swatch" style={{ background: role.color }} />
                {role.label}
              </button>
            );
          })}
        </Box>

        {workingDays.length === 0 ? (
          <Typography className="calendar-empty-state">Nessun giorno lavorativo nel periodo selezionato.</Typography>
        ) : (
          <>
            <Box className="trend-body">
              <Box className="trend-yaxis">
                {[0, 0.5, 1].map((ratio) => (
                  <span key={ratio} className="trend-ytick" style={{ bottom: `${ratio * 100}%` }}>
                    {Math.round(chartMax * ratio)}
                  </span>
                ))}
              </Box>

              <Box className="trend-plot">
                {[0, 0.5, 1].map((ratio) => (
                  <span key={ratio} className="trend-gridline" style={{ bottom: `${ratio * 100}%` }} />
                ))}
                {filteredTotalEmployees > 0 && (
                  <span className="trend-threshold" style={{ bottom: `${criticalRatio * 100}%` }}>
                    <span className="trend-threshold-label">
                      soglia critica · {Math.ceil(criticalThreshold)} assenti (25%)
                    </span>
                  </span>
                )}

                <Box className="trend-cols">
                  {workingDays.map((d) => {
                    const isCritical = filteredTotalEmployees > 0 && d.count >= criticalThreshold && d.count > 0;
                    const pct = Math.min((d.count / chartMax) * 100, 100);
                    return (
                      <Tooltip
                        key={d.dateStr}
                        arrow
                        placement="top"
                        classes={{ tooltip: "trend-tip", arrow: "trend-tip-arrow" }}
                        title={<TrendTooltip day={d} totalEmployees={filteredTotalEmployees} />}
                      >
                        <Box
                          component="button"
                          type="button"
                          onClick={() => setTrendDetailDay(d)}
                          className={[
                            "trend-col",
                            isCritical ? "critical" : "",
                            d.isToday ? "today" : "",
                            d.date.day() === 1 ? "week-start" : "",
                          ].filter(Boolean).join(" ")}
                          aria-label={`${dayNames[d.date.day()]} ${d.date.date()} ${shortMonthLabels[d.date.month()]}: ${d.count} assenti su ${filteredTotalEmployees}`}
                        >
                          {d.count > 0 && <span className="trend-col-count">{d.count}</span>}
                          <span className="trend-col-bar" style={{ height: `${pct}%` }}>
                            {d.byRole.filter((role) => role.count > 0).map((role) => (
                              <span
                                key={role.value}
                                className="trend-col-segment"
                                style={{ background: role.color, flexGrow: role.count }}
                              />
                            ))}
                          </span>
                        </Box>
                      </Tooltip>
                    );
                  })}
                </Box>
              </Box>
            </Box>

            <Box className="trend-xaxis">
              {workingDays.map((d) => (
                <Box
                  key={d.dateStr}
                  className={["trend-xlabel", d.isToday ? "today" : "", d.date.day() === 1 ? "week-start" : ""].filter(Boolean).join(" ")}
                >
                  <span className="trend-xlabel-dow">{dayNames[d.date.day()].charAt(0)}</span>
                  <span className="trend-xlabel-day">{d.day}</span>
                </Box>
              ))}
            </Box>

            <Box className="trend-footer">
              <Box className="trend-legend">
                {absenceRoleOptions.filter((role) => selectedRoleSet.has(role.value)).map((role) => (
                  <span key={role.value} className="trend-legend-item">
                    <span className="trend-swatch" style={{ background: role.color }} />{role.label}
                  </span>
                ))}
                <span className="trend-legend-item"><span className="trend-swatch today" />Oggi</span>
                <span className="trend-legend-item"><span className="trend-threshold-key" />Soglia critica 25%</span>
              </Box>
              <Box className="trend-stats">
                <span className="trend-stat">
                  Media <strong>{avgAbsent.toFixed(1)}</strong> assenti/giorno
                </span>
                {peakDay && peakDay.count > 0 && (
                  <span className="trend-stat">
                    Picco <strong>{peakDay.count}</strong> il {peakDay.day} {shortMonthLabels[peakDay.date.month()]}
                  </span>
                )}
                <span className={`trend-stat${criticalDays.length > 0 ? " warn" : ""}`}>
                  <strong>{criticalDays.length}</strong> {criticalDays.length === 1 ? "giorno critico" : "giorni critici"}
                </span>
              </Box>
            </Box>
          </>
        )}
      </Paper>

      <TrendDayDialog
        day={trendDetailDay}
        totalEmployees={filteredTotalEmployees}
        overlapIds={overlapIds}
        employees={filteredEmployees}
        employeeRoleById={employeeRoleById}
        onClose={() => setTrendDetailDay(null)}
      />

      {/* Alerts */}
      {overlapAlerts.length > 0 && (
        <Paper className="riepilogo-card">
          <Typography className="riepilogo-section-title">⚠️ Avvisi sovrapposizioni da oggi</Typography>
          <Stack spacing={1} sx={{ mt: 1.5 }}>
            {overlapAlerts.slice(0, 6).map((j) => (
              <Box key={j.id} className="riepilogo-alert overlap">
                <span className="riepilogo-alert-icon">🔴</span>
                <span>
                  <strong>{j.employee_name}</strong> ha un'assenza ({formatDateRangeLabel(j.start_date, j.end_date)}) sovrapposta ad attività nel Planner
                </span>
              </Box>
            ))}
          </Stack>
        </Paper>
      )}

      {overlapAlerts.length === 0 && (
        <Paper className="riepilogo-card riepilogo-ok">
          <span style={{ fontSize: 22 }}>✅</span>
          <Typography sx={{ fontWeight: 600, fontSize: 15 }}>Nessuna sovrapposizione futura</Typography>
          <Typography sx={{ fontSize: 13, opacity: 0.65 }}>Non ci sono assenze sovrapposte ad attività nel Planner da oggi alla fine del periodo selezionato.</Typography>
        </Paper>
      )}

      {/* Ricerca assenze per dipendente */}
      <EmpAbsenceSearch
        key={`${periodStart}-${periodEnd}`}
        allJustifications={periodSearchJustifications}
        employees={employees}
      />
    </Stack>
  );
}

// Schede della pagina; l'elenco serve anche a validare ?tab= nella URL.
const CALENDAR_TABS = ["calendario", "riepilogo", "richieste", "residui"];

/* ─── Richieste Tab ─────────────────────────────────────────────────────── */
function RichiesteTab({ allJustifications, overlapIds, onOpenDetail, onApprove, isMutating, onBulkAction, isBulkPending, focusJustificationId, onFocusHandled }) {
  const [statusFilter, setStatusFilter] = useState("pending");
  const [selectedIds, setSelectedIds] = useState(new Set());
  const [detailItem, setDetailItem] = useState(null);
  const [empSearch, setEmpSearch] = useState("");

  // Arrivo dalla home con ?richiesta=<id>: apre il dettaglio di quella richiesta.
  // Il filtro segue lo stato reale, perché nel frattempo può essere stata decisa.
  useEffect(() => {
    if (!focusJustificationId) return;
    const target = allJustifications.find((item) => item.id === focusJustificationId);
    if (!target) return;
    setStatusFilter(target.approval_status);
    setSelectedIds(new Set());
    setDetailItem(target);
    onFocusHandled?.();
  }, [focusJustificationId, allJustifications, onFocusHandled]);

  const counts = useMemo(() => ({
    pending: allJustifications.filter((j) => j.approval_status === "pending").length,
    approved: allJustifications.filter((j) => j.approval_status === "approved").length,
    rejected: allJustifications.filter((j) => j.approval_status === "rejected").length,
  }), [allJustifications]);

  const filtered = useMemo(() => {
    let items = allJustifications.filter((j) => j.approval_status === statusFilter);
    if (empSearch.trim()) {
      const q = empSearch.trim().toLowerCase();
      items = items.filter((j) => j.employee_name?.toLowerCase().includes(q));
    }
    return items.sort((a, b) => b.start_date.localeCompare(a.start_date));
  }, [allJustifications, statusFilter, empSearch]);

  function toggleSelect(id) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }

  function toggleSelectAll() {
    setSelectedIds(selectedIds.size === filtered.length ? new Set() : new Set(filtered.map((j) => j.id)));
  }

  function handleStatusFilter(val) {
    setStatusFilter(val);
    setSelectedIds(new Set());
    setDetailItem(null);
  }

  const statusTabs = [
    { key: "pending", label: "In attesa", count: counts.pending },
    { key: "approved", label: "Approvate", count: counts.approved },
    { key: "rejected", label: "Rifiutate", count: counts.rejected },
  ];

  return (
    <Box sx={{ display: "flex", gap: 2, alignItems: "flex-start" }}>
      {/* Left: list */}
      <Box sx={{ flex: 1, minWidth: 0 }}>
        <Paper className="richieste-shell">
          {/* Status tabs */}
          <Box className="richieste-status-tabs">
            {statusTabs.map(({ key, label, count }) => (
              <button
                key={key}
                className={`richieste-status-tab${statusFilter === key ? " active" : ""}`}
                onClick={() => handleStatusFilter(key)}
              >
                {label}
                <span className={`richieste-tab-badge${key === "pending" && count > 0 ? " urgent" : ""}`}>{count}</span>
              </button>
            ))}
          </Box>

          {/* Filter bar */}
          <Box className="richieste-filter-bar">
            <input
              className="richieste-search"
              placeholder="Cerca dipendente…"
              value={empSearch}
              onChange={(e) => setEmpSearch(e.target.value)}
            />
            {selectedIds.size > 0 && statusFilter === "pending" && (
              <Box className="richieste-bulk-bar">
                <span className="richieste-bulk-label">{selectedIds.size} selezionat{selectedIds.size === 1 ? "o" : "i"}</span>
                <button
                  className="richieste-bulk-btn approve"
                  onClick={() => { onBulkAction([...selectedIds], "approved"); setSelectedIds(new Set()); }}
                  disabled={isBulkPending}
                >
                  ✓ Approva tutti
                </button>
                <button
                  className="richieste-bulk-btn reject"
                  onClick={() => { onBulkAction([...selectedIds], "rejected"); setSelectedIds(new Set()); }}
                  disabled={isBulkPending}
                >
                  ✕ Rifiuta tutti
                </button>
              </Box>
            )}
          </Box>

          {/* List header */}
          {filtered.length > 0 && (
            <Box className="richieste-list-header">
              <Box sx={{ width: 24, flexShrink: 0 }}>
                {statusFilter === "pending" && (
                  <Checkbox
                    size="small"
                    checked={selectedIds.size === filtered.length && filtered.length > 0}
                    indeterminate={selectedIds.size > 0 && selectedIds.size < filtered.length}
                    onChange={toggleSelectAll}
                    sx={{ p: 0.5 }}
                  />
                )}
              </Box>
              <span className="richieste-col-name">Dipendente</span>
              <span className="richieste-col-period">Periodo</span>
              <span className="richieste-col-days">Dettaglio</span>
              <span className="richieste-col-type">Tipo</span>
              <span className="richieste-col-actions" />
            </Box>
          )}

          {/* List */}
          <Box className="richieste-list">
            {filtered.length === 0 && (
              <Box className="richieste-empty">
                {statusFilter === "pending" ? "Nessuna richiesta in attesa 🎉" : `Nessuna richiesta ${statusFilter === "approved" ? "approvata" : "rifiutata"}`}
              </Box>
            )}
            {filtered.map((j) => {
              const isSelected = selectedIds.has(j.id);
              const hasOverlap = overlapIds.has(j.id);
              const days = countAbsentDays(j);
              return (
                <Box
                  key={j.id}
                  className={["richieste-row", isSelected ? "selected" : "", detailItem?.id === j.id ? "detail-open" : "", hasOverlap ? "has-overlap" : ""].filter(Boolean).join(" ")}
                  onClick={() => setDetailItem(detailItem?.id === j.id ? null : j)}
                >
                  <Box sx={{ width: 24, flexShrink: 0 }} onClick={(e) => e.stopPropagation()}>
                    {statusFilter === "pending" && (
                      <Checkbox
                        size="small"
                        checked={isSelected}
                        onChange={(e) => { e.stopPropagation(); toggleSelect(j.id); }}
                        onClick={(e) => e.stopPropagation()}
                        sx={{ p: 0.5 }}
                      />
                    )}
                  </Box>
                  <Box className="richieste-col-name">
                    <EmployeeAvatarById employeeId={j.employee_id} employeeName={j.employee_name} size={32} />
                    <Box>
                      <Box className="richieste-emp-name">{j.employee_name}</Box>
                      {hasOverlap && (
                        <Box className="richieste-overlap-badge">⚠ Sovrapp. Planner</Box>
                      )}
                      {statusFilter === "approved" && (
                        <Box className="richieste-audit-info">
                          {(j.created_by_name || j.requested_by_employee_name) && (
                            <Box className="richieste-audit-line">
                              Creata da <strong>{j.created_by_name || j.requested_by_employee_name}</strong>
                              {j.created_at ? ` · ${dayjs(j.created_at).format("DD/MM/YYYY HH:mm")}` : ""}
                            </Box>
                          )}
                          {j.decided_by_name && (
                            <Box className="richieste-audit-line">
                              Approvata da <strong>{j.decided_by_name}</strong>
                              {j.decided_at ? ` · ${dayjs(j.decided_at).format("DD/MM/YYYY HH:mm")}` : ""}
                            </Box>
                          )}
                        </Box>
                      )}
                    </Box>
                  </Box>
                  <Box className="richieste-col-period">
                    {formatDateRangeLabel(j.start_date, j.end_date)}
                  </Box>
                  <Box className="richieste-col-days">
                    {isPartialDayAbsence(j)
                      ? `${partialDurationLabel(j)} · ${partialTimeRangeLabel(j)}`
                      : `${days}gg`}
                  </Box>
                  <Box className="richieste-col-type">
                    <span className={`richieste-type-badge ${eventToneClass(j.justification_type)}`}>
                      {eventBadgeIcon(j.justification_type)} ASSENZA
                    </span>
                  </Box>
                  <Box className="richieste-col-actions" onClick={(e) => e.stopPropagation()}>
                    {j.requires_my_approval && j.approval_status === "pending" && (
                      <>
                        <button
                          className="richieste-action-btn approve"
                          onClick={() => onApprove({ justificationId: j.id, approvalStatus: "approved" })}
                          disabled={isMutating}
                          title="Approva"
                        >
                          ✓
                        </button>
                        <button
                          className="richieste-action-btn reject"
                          onClick={() => onApprove({ justificationId: j.id, approvalStatus: "rejected" })}
                          disabled={isMutating}
                          title="Rifiuta"
                        >
                          ✕
                        </button>
                      </>
                    )}
                    <button
                      className="richieste-action-btn detail"
                      onClick={() => onOpenDetail(j)}
                      title="Modifica / Dettaglio"
                    >
                      ✎
                    </button>
                  </Box>
                </Box>
              );
            })}
          </Box>
        </Paper>
      </Box>

      {/* Right: detail panel */}
      {detailItem && (
        <Box className="richieste-detail-panel">
          <Box className="richieste-detail-header">
            <EmployeeAvatarById employeeId={detailItem.employee_id} employeeName={detailItem.employee_name} size={38} />
            <Box>
              <Typography className="richieste-detail-name">{detailItem.employee_name}</Typography>
              <span className={`calendar-approval-badge ${detailItem.approval_status}`}>
                {approvalStatusLabel(detailItem.approval_status)}
              </span>
            </Box>
            <button className="richieste-detail-close" onClick={() => setDetailItem(null)}>×</button>
          </Box>

          <Stack spacing={1.5} sx={{ p: 2 }}>
            <Box className="richieste-detail-row">
              <span className="richieste-detail-label">Periodo</span>
              <span className="richieste-detail-val">{formatDateRangeLabel(detailItem.start_date, detailItem.end_date)}</span>
            </Box>
            <Box className="richieste-detail-row">
              <span className="richieste-detail-label">Durata</span>
              <span className="richieste-detail-val">
                {isPartialDayAbsence(detailItem)
                  ? `${partialDurationLabel(detailItem)} · ${partialTimeRangeLabel(detailItem)}`
                  : `${countAbsentDays(detailItem)} giorn${countAbsentDays(detailItem) === 1 ? "o" : "i"}`}
              </span>
            </Box>
            <Box className="richieste-detail-row">
              <span className="richieste-detail-label">Tipo</span>
              <span className={`richieste-type-badge ${eventToneClass(detailItem.justification_type)}`}>
                {eventBadgeIcon(detailItem.justification_type)} ASSENZA
              </span>
            </Box>
            {normalizeTimeValue(detailItem.start_time) !== defaultDayStartTime && (
              <Box className="richieste-detail-row">
                <span className="richieste-detail-label">Orario</span>
                <span className="richieste-detail-val">{normalizeTimeValue(detailItem.start_time)} – {normalizeTimeValue(detailItem.end_time)}</span>
              </Box>
            )}
            {(detailItem.created_by_name || detailItem.requested_by_employee_name) && (
              <Box className="richieste-detail-row">
                <span className="richieste-detail-label">Creata da</span>
                <span className="richieste-detail-val">
                  {detailItem.created_by_name || detailItem.requested_by_employee_name}
                  {detailItem.created_at ? ` · ${dayjs(detailItem.created_at).format("DD/MM/YYYY HH:mm")}` : ""}
                </span>
              </Box>
            )}
            {detailItem.decided_by_name && (
              <Box className="richieste-detail-row">
                <span className="richieste-detail-label">{detailItem.approval_status === "rejected" ? "Rifiutata da" : "Approvata da"}</span>
                <span className="richieste-detail-val">
                  {detailItem.decided_by_name}
                  {detailItem.decided_at ? ` · ${dayjs(detailItem.decided_at).format("DD/MM/YYYY HH:mm")}` : ""}
                </span>
              </Box>
            )}
            {detailItem.description && (
              <Box className="richieste-detail-note">
                <span className="richieste-detail-label">Note</span>
                <Box className="richieste-detail-desc">{detailItem.description}</Box>
              </Box>
            )}
            {overlapIds.has(detailItem.id) && (
              <Box className="richieste-alert overlap" sx={{ mt: 0.5 }}>
                <span className="riepilogo-alert-icon">🔴</span>
                <span>Sovrapposta ad attività nel Planner</span>
              </Box>
            )}
          </Stack>

          {detailItem.requires_my_approval && detailItem.approval_status === "pending" && (
            <Box className="richieste-detail-actions">
              <button
                className="richieste-detail-btn approve"
                onClick={() => { onApprove({ justificationId: detailItem.id, approvalStatus: "approved" }); setDetailItem(null); }}
                disabled={isMutating}
              >
                ✓ Approva
              </button>
              <button
                className="richieste-detail-btn reject"
                onClick={() => { onApprove({ justificationId: detailItem.id, approvalStatus: "rejected" }); setDetailItem(null); }}
                disabled={isMutating}
              >
                ✕ Rifiuta
              </button>
            </Box>
          )}
          {detailItem.approval_status !== "pending" && detailItem.requires_my_approval && (
            <Box className="richieste-detail-actions">
              <button
                className="richieste-detail-btn neutral"
                onClick={() => { onApprove({ justificationId: detailItem.id, approvalStatus: "pending" }); setDetailItem(null); }}
                disabled={isMutating}
              >
                ↩ Rimetti in attesa
              </button>
            </Box>
          )}
          <Box sx={{ p: 2, pt: 0 }}>
            <button className="richieste-detail-edit" onClick={() => { onOpenDetail(detailItem); setDetailItem(null); }}>
              ✎ Apri modifica completa
            </button>
          </Box>
        </Box>
      )}
    </Box>
  );
}

/* ─── Riepilogo del giorno ──────────────────────────────────────────────── */
function DaySummaryDialog({ date, items, overlapIds, onClose, onCreate, onOpenDetail }) {
  const open = Boolean(date);
  // Il dialog resta montato durante la chiusura: senza data mostro l'ultimo stato vuoto.
  const dayLabel = date ? `${dayNames[date.day()]} ${date.date()} ${shortMonthLabels[date.month()]} ${date.year()}` : "";
  const ferieCount = items.filter((item) => item.justification_type === "FERIE").length;
  const otherCount = items.length - ferieCount;
  const partialCount = items.filter(isPartialDayAbsence).length;

  return (
    <Dialog open={open} onClose={onClose} fullWidth maxWidth="xs" PaperProps={{ className: "calendar-daysum-paper" }}>
      <DialogTitle className="calendar-daysum-title">
        <Box className="calendar-daysum-header">
          <Box>
            <Typography className="calendar-daysum-heading">{dayLabel}</Typography>
            <Typography className="calendar-daysum-subtitle">Riepilogo assenze della giornata</Typography>
          </Box>
          <Button className="calendar-modal-close" onClick={onClose}>×</Button>
        </Box>
      </DialogTitle>
      <DialogContent className="calendar-daysum-content">
        <Box className="calendar-daysum-total">
          <span className="calendar-daysum-total-value">{ferieCount}</span>
          <span className="calendar-daysum-total-label">Assenze</span>
          {partialCount > 0 && (
            <span className="calendar-daysum-total-note">
              di cui {partialCount} a ore
            </span>
          )}
        </Box>

        {otherCount > 0 && (
          <Typography className="calendar-daysum-other">
            {otherCount === 1 ? "+1 assenza di altro tipo" : `+${otherCount} assenze di altro tipo`}
          </Typography>
        )}

        <Stack spacing={0.75} className="calendar-daysum-list">
          {items.map((item) => (
            <Box
              key={item.id}
              className={`calendar-inline-event ${eventToneClass(item.justification_type)}${approvalToneClass(item)}${overlapIds.has(item.id) ? " overlap-conflict" : ""}`}
              onClick={() => onOpenDetail(item)}
            >
              <span className="calendar-span-event-icon">{eventBadgeIcon(item.justification_type)}</span>
              <span className="calendar-inline-event-name">{item.employee_name}</span>
              {isPartialDayAbsence(item) && (
                <span className="calendar-hours-badge" title={partialTimeRangeLabel(item)}>
                  🕑 {partialTimeRangeLabel(item)}
                </span>
              )}
              {overlapIds.has(item.id) && (
                <span className="calendar-overlap-warn" title="Ha attività pianificate nel Planner">Sovrapp.</span>
              )}
              <span className={`calendar-approval-badge ${item.approval_status}`}>{approvalStatusLabel(item.approval_status)}</span>
            </Box>
          ))}
          {!items.length && <Typography className="calendar-empty-state">Nessuna assenza in questa giornata.</Typography>}
        </Stack>
      </DialogContent>
      <DialogActions className="calendar-daysum-actions">
        <Button onClick={onClose} className="calendar-ghost-button">Chiudi</Button>
        <Button variant="contained" onClick={onCreate} className="calendar-add-action">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" style={{ flexShrink: 0 }}><path d="M12 5v14M5 12h14"/></svg>
          Inserisci assenza
        </Button>
      </DialogActions>
    </Dialog>
  );
}

/* ─── Main CalendarPage ─────────────────────────────────────────────────── */
export default function CalendarPage() {
  const queryClient = useQueryClient();
  const { effectiveUser: user } = useAuth();
  const canAccessBalances = user?.effective_role === "admin" || user?.effective_role === "hr";
  const today = dayjs();
  const summaryTodayStr = today.format("YYYY-MM-DD");
  // Deep link dalla home: /calendario?tab=richieste&richiesta=<id>
  const [searchParams, setSearchParams] = useSearchParams();
  const requestedTab = searchParams.get("tab");
  const focusJustificationId = searchParams.get("richiesta");
  const [activeTab, setActiveTab] = useState(
    () => (CALENDAR_TABS.includes(requestedTab) ? requestedTab : "calendario"),
  );

  // Una volta aperta la richiesta il parametro si toglie dalla URL, così un
  // refresh o un cambio di scheda non la riapre a sorpresa.
  const clearFocusedJustification = useCallback(() => {
    setSearchParams(
      (params) => {
        const next = new URLSearchParams(params);
        next.delete("richiesta");
        return next;
      },
      { replace: true },
    );
  }, [setSearchParams]);
  const [view, setView] = useState("month");
  const [currentDate, setCurrentDate] = useState(today);
  const [selectedDate, setSelectedDate] = useState(today.format("YYYY-MM-DD"));
  const [modalOpen, setModalOpen] = useState(false);
  const [daySummaryDate, setDaySummaryDate] = useState(null);
  const [editingJustification, setEditingJustification] = useState(null);
  const [form, setForm] = useState(createEmptyForm(today.format("YYYY-MM-DD")));
  const [absenceMode, setAbsenceMode] = useState(absenceModes.days);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [filters, setFilters] = useState({ employeeId: allFilterValue, teamId: allFilterValue });
  const [isExportingMonth, setIsExportingMonth] = useState(false);
  const [exportError, setExportError] = useState("");
  const [summaryPeriodMode, setSummaryPeriodMode] = useState("month");
  const [summaryCustomRange, setSummaryCustomRange] = useState({
    start: today.startOf("month").format("YYYY-MM-DD"),
    end: today.endOf("month").format("YYYY-MM-DD"),
  });

  const range = useMemo(() => getRange(view, currentDate), [view, currentDate]);
  const monthWeeks = useMemo(() => splitWeeks(getDaysForMonth(currentDate)), [currentDate]);

  const summaryRange = useMemo(() => {
    const summaryToday = dayjs(summaryTodayStr);
    if (summaryPeriodMode === "today") {
      const date = summaryToday.format("YYYY-MM-DD");
      return { start: date, end: date };
    }
    if (summaryPeriodMode === "week") {
      const start = getWeekStart(summaryToday);
      return { start: start.format("YYYY-MM-DD"), end: start.add(6, "day").format("YYYY-MM-DD") };
    }
    if (summaryPeriodMode === "custom") return summaryCustomRange;
    return {
      start: summaryToday.startOf("month").format("YYYY-MM-DD"),
      end: summaryToday.endOf("month").format("YYYY-MM-DD"),
    };
  }, [summaryPeriodMode, summaryCustomRange, summaryTodayStr]);

  // Wide range for riepilogo / richieste tabs; si estende automaticamente
  // quando nel riepilogo viene scelto un intervallo personalizzato piu ampio.
  const wideStart = useMemo(() => {
    const defaultStart = dayjs(summaryTodayStr).subtract(6, "month").startOf("month").format("YYYY-MM-DD");
    return summaryRange.start < defaultStart ? summaryRange.start : defaultStart;
  }, [summaryRange.start, summaryTodayStr]);
  const wideEnd = useMemo(() => {
    const defaultEnd = dayjs(summaryTodayStr).add(12, "month").endOf("month").format("YYYY-MM-DD");
    return summaryRange.end > defaultEnd ? summaryRange.end : defaultEnd;
  }, [summaryRange.end, summaryTodayStr]);
  const isWideTabActive = activeTab === "riepilogo" || activeTab === "richieste";

  const employeesQuery = useQuery({
    queryKey: ["employee-options", "calendar", "absence"],
    queryFn: () => getEmployeeOptions({ authorizedForAbsence: true }),
  });

  const teamsQuery = useQuery({
    queryKey: ["teams"],
    queryFn: getTeams,
    staleTime: 30000,
  });

  const justificationsQuery = useQuery({
    queryKey: ["justifications", view, range.start.format("YYYY-MM-DD"), range.end.format("YYYY-MM-DD")],
    queryFn: () => getJustifications(range.start.format("YYYY-MM-DD"), range.end.format("YYYY-MM-DD")),
  });

  // La cella di oggi (mese o settimana) è già evidenziata via CSS (.today);
  // qui si tratta solo di farla scorrere in vista, perché su una griglia di 5-6
  // settimane può restare sotto la piega. Parte già a true perché la pagina si
  // apre su oggi di default: va portato in vista anche senza toccare "Oggi".
  // L'altezza di ogni riga dipende da --calendar-lanes (CalendarPage.css:320),
  // calcolato dagli eventi di justificationsQuery: finché è in caricamento le
  // righe sono al minimo e uno scroll calcolato ora atterrerebbe corto rispetto
  // a dove finisce la riga di oggi una volta che le righe sopra si allargano.
  const todayCellRef = useRef(null);
  const [pendingTodayScroll, setPendingTodayScroll] = useState(true);
  useEffect(() => {
    if (!pendingTodayScroll || activeTab !== "calendario" || justificationsQuery.isLoading) return;
    let raf2 = null;
    // Due rAF invece di uno: il primo aspetta il commit del DOM del render
    // appena scattato, il secondo che il browser abbia calcolato il layout
    // finale (righe già alte quanto devono essere) prima di misurare dove scorrere.
    const raf1 = requestAnimationFrame(() => {
      raf2 = requestAnimationFrame(() => {
        todayCellRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
      });
    });
    setPendingTodayScroll(false);
    return () => {
      cancelAnimationFrame(raf1);
      if (raf2 != null) cancelAnimationFrame(raf2);
    };
  }, [pendingTodayScroll, currentDate, view, activeTab, justificationsQuery.isLoading]);
  function goToToday() {
    setCurrentDate(today);
    setSelectedDate(today.format("YYYY-MM-DD"));
    setPendingTodayScroll(true);
  }

  const assignmentsQuery = useQuery({
    queryKey: ["assignments", range.start.format("YYYY-MM-DD"), range.end.format("YYYY-MM-DD")],
    queryFn: () => getAssignments(range.start.format("YYYY-MM-DD"), range.end.format("YYYY-MM-DD")),
  });

  // Query dedicata alle assegnazioni Planner della data selezionata nel form: il
  // range della vista calendario (assignmentsQuery) copre solo i giorni visibili,
  // quindi cambiando data dentro la modale (es. su un mese non ancora caricato)
  // l'avviso di sovrapposizione perderebbe i dati per quel giorno.
  const formAssignmentsQuery = useQuery({
    queryKey: ["assignments", "form", form.start_date, form.end_date],
    queryFn: () => getAssignments(form.start_date, form.end_date),
    enabled: modalOpen && Boolean(form.employee_id) && Boolean(form.start_date) && Boolean(form.end_date),
  });

  const wideJustificationsQuery = useQuery({
    queryKey: ["justifications", "wide", wideStart, wideEnd],
    queryFn: () => getJustifications(wideStart, wideEnd),
    enabled: isWideTabActive,
  });

  const wideAssignmentsQuery = useQuery({
    queryKey: ["assignments", "wide", wideStart, wideEnd],
    queryFn: () => getAssignments(wideStart, wideEnd),
    enabled: isWideTabActive,
  });

  // Il tab Residui viene precaricato per HR/Admin: la tabella è pronta quando
  // viene aperta e non introduce un'attesa aggiuntiva nella navigazione.
  const absenceBalancesQuery = useQuery({
    queryKey: ["absence-balances"],
    queryFn: getAbsenceBalances,
    enabled: canAccessBalances,
    staleTime: 60_000,
  });

  const absenceBalanceStatusQuery = useQuery({
    queryKey: ["absence-balance-status"],
    queryFn: getAbsenceBalanceStatus,
    enabled: canAccessBalances,
    staleTime: 60_000,
  });

  const canViewSelectedBalance = Boolean(
    form.employee_id
    && (canAccessBalances || form.employee_id === user?.linked_employee_id)
  );
  const selectedBalanceQuery = useQuery({
    queryKey: ["absence-balance", form.employee_id],
    queryFn: () => getAbsenceBalance(form.employee_id),
    enabled: modalOpen && canViewSelectedBalance,
    retry: false,
  });

  const wideJustifications = wideJustificationsQuery.data ?? [];
  const wideAssignments = wideAssignmentsQuery.data ?? [];

  const wideOverlapIds = useMemo(() => {
    const s = new Set();
    for (const j of wideJustifications) {
      if (j.approval_status === "rejected") continue;
      if (wideAssignments.some((a) => hasPlannerOverlap(j, a))) {
        s.add(j.id);
      }
    }
    return s;
  }, [wideJustifications, wideAssignments]);

  const createMutation = useMutation({
    mutationFn: createJustification,
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["justifications"] }); closeModal(); setForm(createEmptyForm(selectedDate)); },
  });

  const updateMutation = useMutation({
    mutationFn: ({ justificationId, payload }) => updateJustification(justificationId, payload),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["justifications"] }); closeModal(); },
  });

  const deleteMutation = useMutation({
    mutationFn: deleteJustification,
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["justifications"] }); closeModal(); },
  });

  const approveMutation = useMutation({
    mutationFn: ({ justificationId, approvalStatus }) =>
      updateJustificationApproval(justificationId, { approval_status: approvalStatus }),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["justifications"] }); closeModal(); },
  });

  const bulkApproveMutation = useMutation({
    mutationFn: async ({ ids, status }) => {
      for (const id of ids) {
        await updateJustificationApproval(id, { approval_status: status });
      }
    },
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["justifications"] }); },
  });

  function closeModal() {
    createMutation.reset(); updateMutation.reset(); deleteMutation.reset(); approveMutation.reset();
    setModalOpen(false); setEditingJustification(null);
  }

  function openDaySummary(date) {
    setSelectedDate(date.format("YYYY-MM-DD"));
    setDaySummaryDate(date);
  }

  function closeDaySummary() {
    setDaySummaryDate(null);
  }

  function openCreateModal(date) {
    const isoDate = date.format("YYYY-MM-DD");
    createMutation.reset(); updateMutation.reset(); deleteMutation.reset(); approveMutation.reset();
    setDaySummaryDate(null);
    setSelectedDate(isoDate);
    setEditingJustification(null);
    setAbsenceMode(absenceModes.days);
    const options = employeesQuery.data ?? [];
    const defaultEmployeeId = options.length === 1 ? options[0].id : "";
    setForm(createEmptyForm(isoDate, defaultEmployeeId));
    setModalOpen(true);
  }

  function openEditModal(item) {
    createMutation.reset(); updateMutation.reset(); deleteMutation.reset(); approveMutation.reset();
    setDaySummaryDate(null);
    setSelectedDate(item.start_date);
    setEditingJustification(item);
    setAbsenceMode(inferAbsenceMode(item));
    setForm({
      employee_id: item.employee_id,
      justification_type: item.justification_type,
      description: item.description || "",
      start_date: item.start_date,
      end_date: item.end_date,
      start_time: normalizeTimeValue(item.start_time),
      end_time: normalizeTimeValue(item.end_time),
    });
    setModalOpen(true);
  }

  function updateFormValue(field, value) {
    setForm((current) => {
      const next = { ...current, [field]: value };
      if (field === "start_date" && absenceMode === absenceModes.halfDay) next.end_date = value;
      return next;
    });
  }

  function handleAbsenceModeChange(mode) {
    if (mode === absenceMode) return;
    setAbsenceMode(mode);
    setForm((current) => {
      if (mode === absenceModes.halfDay) return { ...current, end_date: current.start_date };
      return { ...current, start_time: defaultDayStartTime, end_time: defaultDayEndTime };
    });
  }

  function handleDateRangeSelect(range) {
    if (!range?.from) return;
    setForm((current) => ({
      ...current,
      start_date: toIsoDate(range.from),
      end_date: toIsoDate(range.to ?? range.from),
    }));
  }

  function handleSave() {
    const payload =
      absenceMode === absenceModes.days
        ? { ...form, start_time: defaultDayStartTime, end_time: defaultDayEndTime }
        : { ...form, end_date: form.start_date };
    if (editingJustification) { updateMutation.mutate({ justificationId: editingJustification.id, payload }); return; }
    createMutation.mutate(payload);
  }

  function move(step) {
    const unit = view === "month" ? "month" : "day";
    const amount = view === "week" ? step * 7 : step;
    setCurrentDate((current) => current.add(amount, unit));
  }

  function updateFilterValue(field, value) {
    setFilters((current) => {
      const next = { ...current, [field]: value };
      if (field === "teamId" && current.employeeId !== allFilterValue) {
        const selectedEmployeeTeam = employeeTeamMap[current.employeeId];
        const employeeMatchesTeam =
          value === allFilterValue
            ? true
            : value === noTeamFilterValue
              ? !selectedEmployeeTeam
              : selectedEmployeeTeam?.id === value;
        if (!employeeMatchesTeam) next.employeeId = allFilterValue;
      }
      return next;
    });
  }

  function resetFilters() {
    setFilters({ employeeId: allFilterValue, teamId: allFilterValue });
  }

  async function handleLastMonthExport() {
    const exportEnd = today.format("YYYY-MM-DD");
    const exportStart = today.subtract(1, "month").add(1, "day").format("YYYY-MM-DD");
    const employeeId = filters.employeeId === allFilterValue ? "" : filters.employeeId;
    setIsExportingMonth(true);
    setExportError("");
    try {
      const [exportRows, logoBytes] = await Promise.all([
        queryClient.fetchQuery({
          queryKey: ["justifications", "export-last-month", exportStart, exportEnd, employeeId],
          queryFn: () => getJustifications(exportStart, exportEnd, employeeId),
          staleTime: 60 * 1000,
        }),
        fetchAssetBytes(logoTonoli),
      ]);

      const rowsForExport = exportRows.filter((row) => {
        if (filters.teamId === allFilterValue) return true;
        const team = employeeTeamMap[row.employee_id];
        if (filters.teamId === noTeamFilterValue) return !team;
        return team?.id === filters.teamId;
      });

      const sortedRows = rowsForExport
        .slice()
        .sort((a, b) => {
          const byName = (a.employee_name ?? "").localeCompare(b.employee_name ?? "", "it", { sensitivity: "base" });
          if (byName !== 0) return byName;
          return (a.start_date ?? "").localeCompare(b.start_date ?? "");
        });
      const employeeLabel =
        employeeId
          ? ((employeesQuery.data ?? []).find((employee) => employee.id === employeeId)?.full_name ?? "Dipendente selezionato")
          : "Tutti i dipendenti";
      const teamLabel =
        filters.teamId === allFilterValue
          ? "Tutte le squadre"
          : filters.teamId === noTeamFilterValue
            ? "Senza squadra"
            : (teamsQuery.data ?? []).find((team) => team.id === filters.teamId)?.name ?? "Squadra selezionata";
      const workbookBlob = buildAbsenceExcelWorkbook({
        rows: sortedRows,
        periodLabel: `${formatCsvDate(exportStart)} - ${formatCsvDate(exportEnd)}`,
        generatedAtLabel: dayjs().format("DD/MM/YYYY HH:mm"),
        employeeFilterLabel: teamLabel === "Tutte le squadre" ? employeeLabel : `${employeeLabel} · ${teamLabel}`,
        logoBytes,
      });
      downloadBlob(workbookBlob, `assenze-tonoli-${exportStart}-${exportEnd}.xlsx`);
    } catch (error) {
      setExportError(error.message);
    } finally {
      setIsExportingMonth(false);
    }
  }

  const justifications = justificationsQuery.data ?? [];
  const employeeTeamMap = useMemo(() => {
    const map = {};
    for (const team of teamsQuery.data ?? []) {
      for (const member of team.members ?? []) {
        map[member.employee_id] = team;
      }
    }
    return map;
  }, [teamsQuery.data]);

  const teamFilterOptions = useMemo(() => {
    const teams = (teamsQuery.data ?? [])
      .slice()
      .sort((a, b) => a.name.localeCompare(b.name))
      .map((team) => ({ value: team.id, label: team.name }));

    return [
      { value: allFilterValue, label: "Tutte le squadre" },
      ...teams,
      { value: noTeamFilterValue, label: "Senza squadra" },
    ];
  }, [teamsQuery.data]);

  const filteredEmployees = useMemo(() => {
    return (employeesQuery.data ?? []).filter((employee) => {
      if (filters.teamId === allFilterValue) return true;
      const team = employeeTeamMap[employee.id];
      if (filters.teamId === noTeamFilterValue) return !team;
      return team?.id === filters.teamId;
    });
  }, [employeesQuery.data, employeeTeamMap, filters.teamId]);

  const justificationsWithOverlap = useMemo(() => {
    const assignments = assignmentsQuery.data ?? [];
    const overlap = new Set();
    for (const j of justifications) {
      if (assignments.some((a) => hasPlannerOverlap(j, a))) {
        overlap.add(j.id);
      }
    }
    return overlap;
  }, [justifications, assignmentsQuery.data]);

  const formOverlapAssignments = useMemo(() => {
    if (!modalOpen || !form.employee_id) return [];
    return (formAssignmentsQuery.data ?? [])
      .filter((assignment) => hasPlannerOverlap(form, assignment))
      .sort((first, second) => (
        first.work_date.localeCompare(second.work_date)
        || String(first.start_time).localeCompare(String(second.start_time))
      ));
  }, [modalOpen, form, formAssignmentsQuery.data]);
  const formHasOverlap = formOverlapAssignments.length > 0;

  const filteredJustifications = justifications.filter((item) => {
    if (filters.employeeId !== allFilterValue && item.employee_id !== filters.employeeId) return false;
    if (filters.teamId === allFilterValue) return true;
    const team = employeeTeamMap[item.employee_id];
    if (filters.teamId === noTeamFilterValue) return !team;
    return team?.id === filters.teamId;
  });
  const hasActiveFilters = filters.employeeId !== allFilterValue || filters.teamId !== allFilterValue;
  const weekDays = Array.from({ length: 5 }, (_, i) => getWeekStart(currentDate).add(i, "day"));
  const currentDayItems = filteredJustifications.filter((item) => overlapsDay(item, currentDate));
  const daySummaryItems = daySummaryDate
    ? filteredJustifications.filter((item) => overlapsDay(item, daySummaryDate))
    : [];
  const saveInProgress = createMutation.isPending || updateMutation.isPending;
  const modalError = createMutation.error ?? updateMutation.error ?? deleteMutation.error;
  const singleEmployee = (employeesQuery.data ?? []).length === 1;
  const isLocked = Boolean(
    editingJustification &&
    !editingJustification.requires_my_approval &&
    (editingJustification.approval_status === "approved" || editingJustification.approval_status === "rejected")
  );
  const selectedDateRange = { from: toPickerDate(form.start_date), to: toPickerDate(form.end_date) };

  return (
    <Stack spacing={3} className="calendar-page">
      <PageHeader section="Impresa" title="Assenze" />

      {/* Il topbar resta come seconda barra: il titolo è nella banda (regole 1-2) */}
      <Paper className="calendar-topbar">
        <Stack direction="row" spacing={0} className="calendar-section-tabs">
          <Button
            className={`calendar-section-tab${activeTab === "calendario" ? " active" : ""}`}
            onClick={() => setActiveTab("calendario")}
          >
            <span className="calendar-section-tab-icon" aria-hidden="true">🗓️</span>
            Calendario Assenze
          </Button>
          <Button
            className={`calendar-section-tab${activeTab === "riepilogo" ? " active" : ""}`}
            onClick={() => setActiveTab("riepilogo")}
          >
            <span className="calendar-section-tab-icon" aria-hidden="true">📊</span>
            Riepilogo
          </Button>
          <Button
            className={`calendar-section-tab${activeTab === "richieste" ? " active" : ""}`}
            onClick={() => setActiveTab("richieste")}
          >
            <span className="calendar-section-tab-icon" aria-hidden="true">📨</span>
            Richieste
          </Button>
          {canAccessBalances && (
            <Button
              className={`calendar-section-tab${activeTab === "residui" ? " active" : ""}`}
              onClick={() => setActiveTab("residui")}
            >
              <span className="calendar-section-tab-icon" aria-hidden="true">🧮</span>
              Residui
            </Button>
          )}
        </Stack>
      </Paper>

      {employeesQuery.error && <Alert severity="error">{employeesQuery.error.message}</Alert>}
      {teamsQuery.error && <Alert severity="error">{teamsQuery.error.message}</Alert>}
      {justificationsQuery.error && <Alert severity="error">{justificationsQuery.error.message}</Alert>}
      {approveMutation.error && <Alert severity="error">{approveMutation.error.message}</Alert>}
      {bulkApproveMutation.error && <Alert severity="error">{bulkApproveMutation.error.message}</Alert>}
      {exportError && <Alert severity="error">{exportError}</Alert>}

      {/* ── Calendario tab ─────────────────────────────────────────────── */}
      {activeTab === "calendario" && (
        <Paper className="calendar-shell calendar-board-shell">
          <Box className="calendar-controls-row">
            <Stack direction="row" spacing={1} flexWrap="wrap" className="calendar-controls-left">
              <Button className="calendar-filter-button" onClick={() => setFiltersOpen((c) => !c)}>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round"><path d="M3 6h18M6 12h12M10 18h4"/></svg>
                Filtri
              </Button>
              <ToggleButtonGroup value={view} exclusive onChange={(_, v) => v && setView(v)} size="small" className="calendar-view-switcher">
                <ToggleButton value="day">Giorno</ToggleButton>
                <ToggleButton value="week">Settimana</ToggleButton>
                <ToggleButton value="month">Mese</ToggleButton>
              </ToggleButtonGroup>
            </Stack>
            <Box className="calendar-controls-center">
              <Button className="calendar-nav-button" onClick={() => move(-1)}>
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><polyline points="15 18 9 12 15 6"/></svg>
              </Button>
              <Button className="calendar-month-button">{formatNavLabel(view, currentDate)}</Button>
              <Button className="calendar-nav-button" onClick={() => move(1)}>
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><polyline points="9 18 15 12 9 6"/></svg>
              </Button>
              <Button className="calendar-today-button" onClick={goToToday}>Oggi</Button>
            </Box>
            <Stack direction="row" spacing={1} className="calendar-controls-right">
              <Button className="calendar-ghost-button" onClick={handleLastMonthExport} disabled={isExportingMonth}>
                {isExportingMonth ? "Esporto Excel..." : "Export Excel ultimo mese"}
              </Button>
              <Button variant="contained" className="calendar-add-action" onClick={() => openCreateModal(currentDate)}>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" style={{ flexShrink: 0 }}><path d="M12 5v14M5 12h14"/></svg>
                Aggiungi assenza
              </Button>
            </Stack>
          </Box>

          {filtersOpen && (
            <Box className="calendar-filter-panel">
              <TextField
                className="calendar-filter-field" select label="Squadra"
                value={filters.teamId} onChange={(e) => updateFilterValue("teamId", e.target.value)} fullWidth
              >
                {teamFilterOptions.map((team) => (
                  <MenuItem key={team.value} value={team.value}>{team.label}</MenuItem>
                ))}
              </TextField>
              <TextField
                className="calendar-filter-field" select label="Dipendente"
                value={filters.employeeId} onChange={(e) => updateFilterValue("employeeId", e.target.value)} fullWidth
              >
                <MenuItem value={allFilterValue}>Tutti i dipendenti</MenuItem>
                {filteredEmployees.map((emp) => (
                  <MenuItem key={emp.id} value={emp.id}>{emp.full_name}</MenuItem>
                ))}
              </TextField>
              <Button className="calendar-ghost-button" onClick={resetFilters} disabled={!hasActiveFilters}>
                Azzera filtri
              </Button>
            </Box>
          )}

          {view === "month" && (
            <Box className="calendar-month-board">
              <Box className="calendar-weekday-row">
                {weekdayLabels.map((label) => (
                  <Box key={label} className="calendar-weekday-cell">{label}</Box>
                ))}
              </Box>
              <Stack spacing={0} className="calendar-month-stack">
                {monthWeeks.map((week) => {
                  const { lanes, segments, hiddenByColumn } = buildWeekSegments(week, filteredJustifications);
                  return (
                    <Box key={week[0].toString()} className="calendar-week-row" style={{ "--calendar-lanes": lanes }}>
                      <Box className="calendar-week-grid-cells">
                        {week.map((date, columnIndex) => {
                          const dayItems = filteredJustifications.filter((item) => overlapsDay(item, date));
                          const dayHasOverlap = dayItems.some((item) => justificationsWithOverlap.has(item.id));
                          const inMonth = date.month() === currentDate.month();
                          const isToday = date.isSame(dayjs(), "day");
                          const dayTone = dayItems[0] ? eventToneClass(dayItems[0].justification_type) : "";
                          return (
                            <Box
                              key={date.toString()}
                              ref={isToday ? todayCellRef : undefined}
                              className={`calendar-month-cell${inMonth ? "" : " out-of-range"}${isToday ? " today" : ""}`}
                              onClick={() => openDaySummary(date)}
                            >
                              <Box className="calendar-cell-header">
                                <Typography className={`calendar-day-number${isToday ? " today" : ""}`}>
                                  {date.date()}
                                </Typography>
                                {hiddenByColumn[columnIndex] > 0 && (
                                  <span
                                    className={`calendar-day-badge more${dayHasOverlap ? " overlap-conflict" : ""}`}
                                    title="Clicca per vedere tutte le assenze della giornata"
                                  >
                                    +{hiddenByColumn[columnIndex]}
                                  </span>
                                )}
                              </Box>
                            </Box>
                          );
                        })}
                      </Box>
                      <Box className="calendar-week-events-layer">
                        {segments.map((seg) => (
                          <Box
                            key={`${seg.id}-${seg.lane}`}
                            className={`calendar-span-event ${eventToneClass(seg.justification_type)}${approvalToneClass(seg)}${justificationsWithOverlap.has(seg.id) ? " overlap-conflict" : ""}${seg.startsBeforeWeek ? " continues-left" : ""}${seg.endsAfterWeek ? " continues-right" : ""}`}
                            style={{ gridColumn: `${seg.colStart} / span ${seg.colSpan}`, gridRow: String(seg.lane + 1) }}
                            onClick={(e) => { e.stopPropagation(); openEditModal(seg); }}
                          >
                            {/* Il nome viene ripetuto in ogni giornata coperta, così resta
                                leggibile anche sulle assenze che durano più giorni. */}
                            {Array.from({ length: seg.colSpan }, (_, dayIndex) => (
                              <span key={dayIndex} className="calendar-span-day">
                                {dayIndex === 0 && (
                                  <span className={`calendar-span-initials ${eventToneClass(seg.justification_type)}`}>{getInitials(seg.employee_name)}</span>
                                )}
                                <span className="calendar-span-event-text">{seg.employee_name}</span>
                                {dayIndex === 0 && isPartialDayAbsence(seg) && (
                                  <span className="calendar-span-hours" title={partialTimeRangeLabel(seg)}>
                                    {partialDurationLabel(seg)}
                                  </span>
                                )}
                                {dayIndex === seg.colSpan - 1 && (
                                  <>
                                    {justificationsWithOverlap.has(seg.id) && (
                                      <span className="calendar-overlap-warn" title="Ha attività pianificate nel Planner in questo periodo">Sovrapp.</span>
                                    )}
                                    <span className={`calendar-span-dot ${seg.approval_status}`} />
                                  </>
                                )}
                              </span>
                            ))}
                          </Box>
                        ))}
                      </Box>
                    </Box>
                  );
                })}
              </Stack>
            </Box>
          )}

          {view === "week" && (
            <Box className="calendar-week-board">
              {weekDays.map((date) => {
                const items = filteredJustifications.filter((item) => overlapsDay(item, date));
                const isToday = date.isSame(dayjs(), "day");
                return (
                  <Paper
                    key={date.toString()}
                    ref={isToday ? todayCellRef : undefined}
                    onClick={() => openDaySummary(date)}
                    className={`calendar-week-card${isToday ? " today" : ""}`}
                  >
                    <Typography variant="subtitle2" className="calendar-day-label">{`${dayNames[date.day()]} ${date.format("DD/MM")}`}</Typography>
                    <Stack spacing={0.75} className="calendar-events-stack">
                      {items.slice(0, maxVisibleLanes).map((item) => (
                        <Box
                          key={item.id}
                          className={`calendar-inline-event ${eventToneClass(item.justification_type)}${approvalToneClass(item)}${justificationsWithOverlap.has(item.id) ? " overlap-conflict" : ""}`}
                          onClick={(e) => { e.stopPropagation(); openEditModal(item); }}
                        >
                          <span className="calendar-span-event-icon">{eventBadgeIcon(item.justification_type)}</span>
                          <span className="calendar-inline-event-name">{item.employee_name}</span>
                          {isPartialDayAbsence(item) && (
                            <span className="calendar-hours-badge" title={partialTimeRangeLabel(item)}>
                              🕑 {partialDurationLabel(item)}
                            </span>
                          )}
                          {justificationsWithOverlap.has(item.id) && (
                            <span className="calendar-overlap-warn" title="Ha attività pianificate nel Planner">Sovrapp.</span>
                          )}
                          <span className={`calendar-approval-badge ${item.approval_status}`}>{approvalStatusLabel(item.approval_status)}</span>
                        </Box>
                      ))}
                      {items.length > maxVisibleLanes && (
                        <button type="button" className="calendar-more-link" onClick={() => openDaySummary(date)}>
                          +{items.length - maxVisibleLanes} altre assenze
                        </button>
                      )}
                      {!items.length && <Typography variant="body2" className="calendar-empty-state">Nessuna assenza</Typography>}
                    </Stack>
                  </Paper>
                );
              })}
            </Box>
          )}

          {view === "day" && (
            <Stack spacing={2} className="calendar-day-view">
              <Button variant="contained" onClick={() => openCreateModal(currentDate)} className="calendar-add-action">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" style={{ flexShrink: 0 }}><path d="M12 5v14M5 12h14"/></svg>
                Inserisci assenza
              </Button>
              <Stack spacing={1}>
                {currentDayItems.map((item) => (
                  <Paper
                    key={item.id}
                    className={`calendar-day-item ${eventToneClass(item.justification_type)}${approvalToneClass(item)}${justificationsWithOverlap.has(item.id) ? " overlap-conflict" : ""}`}
                    onClick={() => openEditModal(item)}
                  >
                    <Box sx={{ display: "flex", alignItems: "center", gap: 1, mb: 0.5, flexWrap: "wrap" }}>
                      <span className="calendar-span-event-icon">{eventBadgeIcon(item.justification_type)}</span>
                      <Typography variant="subtitle1" className="calendar-day-item-title" sx={{ mb: "0 !important" }}>{item.employee_name}</Typography>
                      {justificationsWithOverlap.has(item.id) && <span className="calendar-overlap-warn">Sovrapposizione</span>}
                      <span className={`calendar-approval-badge ${item.approval_status}`}>{approvalStatusLabel(item.approval_status)}</span>
                    </Box>
                    <Typography variant="body2" className="calendar-day-item-meta">
                      {normalizeTimeValue(item.start_time)} - {normalizeTimeValue(item.end_time)}
                    </Typography>
                    <Typography variant="body2" className="calendar-day-item-description">
                      {item.description || "Nessuna descrizione"}
                    </Typography>
                  </Paper>
                ))}
                {!currentDayItems.length && (
                  <Typography className="calendar-empty-state">Nessuna assenza registrata per il giorno selezionato.</Typography>
                )}
              </Stack>
            </Stack>
          )}
        </Paper>
      )}

      {/* ── Riepilogo tab ──────────────────────────────────────────────── */}
      {activeTab === "riepilogo" && (
        wideJustificationsQuery.isLoading || wideAssignmentsQuery.isLoading
          ? <Box sx={{ p: 4, textAlign: "center", color: "text.secondary" }}>Caricamento dati…</Box>
          : <RiepilogoTab
              allJustifications={wideJustifications}
              allAssignments={wideAssignments}
              employees={employeesQuery.data ?? []}
              today={today}
              periodMode={summaryPeriodMode}
              periodStart={summaryRange.start}
              periodEnd={summaryRange.end}
              onPeriodModeChange={setSummaryPeriodMode}
              onCustomPeriodChange={setSummaryCustomRange}
            />
      )}

      {/* ── Richieste tab ──────────────────────────────────────────────── */}
      {activeTab === "richieste" && (
        wideJustificationsQuery.isLoading
          ? <Box sx={{ p: 4, textAlign: "center", color: "text.secondary" }}>Caricamento dati…</Box>
          : <RichiesteTab
              focusJustificationId={focusJustificationId}
              onFocusHandled={clearFocusedJustification}
              allJustifications={wideJustifications}
              overlapIds={wideOverlapIds}
              onOpenDetail={openEditModal}
              onApprove={approveMutation.mutate}
              isMutating={approveMutation.isPending}
              onBulkAction={(ids, status) => bulkApproveMutation.mutate({ ids, status })}
              isBulkPending={bulkApproveMutation.isPending}
            />
      )}

      {/* ── Residui tab (solo Admin / HR) ─────────────────────────────── */}
      {activeTab === "residui" && canAccessBalances && (
        <ResiduiTab
          canEdit={Boolean(user?.can_edit_absence_balances)}
          balancesQuery={absenceBalancesQuery}
          statusQuery={absenceBalanceStatusQuery}
        />
      )}

      {/* ── Riepilogo giornata ────────────────────────────────────────── */}
      <DaySummaryDialog
        date={daySummaryDate}
        items={daySummaryItems}
        overlapIds={justificationsWithOverlap}
        onClose={closeDaySummary}
        onCreate={() => openCreateModal(daySummaryDate ?? currentDate)}
        onOpenDetail={openEditModal}
      />

      {/* ── Modal ─────────────────────────────────────────────────────── */}
      <Dialog
        open={modalOpen}
        onClose={closeModal}
        fullWidth
        maxWidth="md"
        PaperProps={{ className: "calendar-modal-paper calendar-modal-paper-split" }}
      >
        <DialogTitle className="calendar-modal-title">
          <Box className="calendar-modal-header">
            <Box>
              <Typography className="calendar-modal-heading">
                {editingJustification ? "Modifica assenza" : "Aggiungi assenza"}
              </Typography>
              <Typography className="calendar-modal-subtitle">Inserisci un'assenza per il dipendente selezionato.</Typography>
              {editingJustification && (
                <Box sx={{ display: "flex", alignItems: "center", gap: 1, mt: 1.5, flexWrap: "wrap" }}>
                  <span className={`calendar-approval-badge ${editingJustification.approval_status}`}>
                    {approvalStatusLabel(editingJustification.approval_status)}
                  </span>
                  {(editingJustification.created_by_name || editingJustification.requested_by_employee_name || editingJustification.decided_by_name) && (
                    <span className="calendar-audit-badge">
                      {(editingJustification.created_by_name || editingJustification.requested_by_employee_name)
                        ? `Creata da ${editingJustification.created_by_name || editingJustification.requested_by_employee_name}${editingJustification.created_at ? ` il ${dayjs(editingJustification.created_at).format("DD/MM/YYYY HH:mm")}` : ""}`
                        : ""}
                      {editingJustification.decided_by_name
                        ? `${(editingJustification.created_by_name || editingJustification.requested_by_employee_name) ? " · " : ""}${editingJustification.approval_status === "rejected" ? "Rifiutata" : "Approvata"} da ${editingJustification.decided_by_name}${editingJustification.decided_at ? ` il ${dayjs(editingJustification.decided_at).format("DD/MM/YYYY HH:mm")}` : ""}`
                        : ""}
                    </span>
                  )}
                  {editingJustification.requires_my_approval && editingJustification.approval_status === "pending" && (
                    <Typography className="calendar-modal-subtitle" component="span" sx={{ mt: "0 !important" }}>
                      · Richiede la tua approvazione
                    </Typography>
                  )}
                </Box>
              )}
            </Box>
            <Button onClick={closeModal} className="calendar-modal-close" disabled={saveInProgress || deleteMutation.isPending}>×</Button>
          </Box>
        </DialogTitle>
        <DialogContent className="calendar-modal-content">
          {modalError && <Alert severity="error" sx={{ mb: 2 }}>{modalError.message}</Alert>}
          {isLocked && (
            <Alert severity="info" sx={{ mb: 2 }}>
              Questa assenza è già stata <strong>{editingJustification.approval_status === "approved" ? "approvata" : "rifiutata"}</strong> e non può più essere modificata o eliminata.
            </Alert>
          )}
          {formHasOverlap && !isLocked && (
            <Alert severity="warning" sx={{ mb: 2 }}>
              <Box>Questo dipendente ha attività pianificate nel Planner durante questo periodo:</Box>
              <Stack component="ul" spacing={0.25} sx={{ mt: 0.75, mb: 0, pl: 2.5 }}>
                {formOverlapAssignments.map((assignment) => (
                  <Box component="li" key={assignment.id} sx={{ fontSize: 13 }}>
                    {formatPlannerAssignmentDetail(assignment)}
                  </Box>
                ))}
              </Stack>
            </Alert>
          )}
          <Box className="calendar-modal-form split-layout">
            <Stack spacing={2} className="calendar-form-column calendar-form-column-main">
              <Typography className="calendar-form-column-title">Dati della richiesta</Typography>
              <Box className="calendar-modal-identity">
              {singleEmployee ? (
                <TextField className="calendar-form-field" label="Dipendente" value={(employeesQuery.data ?? [])[0]?.full_name ?? ""} fullWidth disabled />
              ) : (
                <Autocomplete
                  className="calendar-form-field"
                  options={employeesQuery.data ?? []}
                  getOptionLabel={(option) => option.full_name ?? ""}
                  value={(employeesQuery.data ?? []).find((e) => e.id === form.employee_id) ?? null}
                  onChange={(_, v) => updateFormValue("employee_id", v?.id ?? "")}
                  disabled={isLocked} fullWidth
                  renderInput={(params) => <TextField {...params} label="Dipendente" />}
                />
              )}
              </Box>
              {canViewSelectedBalance && selectedBalanceQuery.data && (
                Number(selectedBalanceQuery.data.permission_hours) > 0
                || Number(selectedBalanceQuery.data.vacation_days) > 0
              ) && (
                <Stack
                  direction="row"
                  spacing={1}
                  flexWrap="wrap"
                  useFlexGap
                  className="calendar-balance-chips"
                  title="Valori informativi: non limitano l'invio della richiesta."
                >
                  {Number(selectedBalanceQuery.data.permission_hours) > 0 && (
                    <Chip
                      size="small"
                      className="calendar-balance-chip permissions"
                      label={`Permessi · ${Number(selectedBalanceQuery.data.permission_hours).toLocaleString("it-IT", { maximumFractionDigits: 2 })} h`}
                    />
                  )}
                  {Number(selectedBalanceQuery.data.vacation_days) > 0 && (
                    <Chip
                      size="small"
                      className="calendar-balance-chip vacation"
                      label={`Ferie · ${Number(selectedBalanceQuery.data.vacation_days).toLocaleString("it-IT", { maximumFractionDigits: 2 })} gg`}
                    />
                  )}
                </Stack>
              )}
              <Box className="calendar-mode-section" sx={{ pointerEvents: isLocked ? "none" : "auto", opacity: isLocked ? 0.5 : 1 }}>
                <Typography className="calendar-section-label">Durata</Typography>
                <ToggleButtonGroup
                exclusive
                value={absenceMode}
                onChange={(_, value) => {
                  if (value) handleAbsenceModeChange(value);
                }}
                fullWidth
                className="calendar-mode-switch"
                sx={{
                  display: "grid",
                  gridTemplateColumns: "repeat(2, minmax(0, 1fr))",
                  gap: "0 !important",
                  "& .MuiToggleButtonGroup-grouped": {
                    margin: 0,
                    border: "none !important",
                    borderRadius: "9px !important",
                  },
                }}
              >
                <ToggleButton
                  value={absenceModes.halfDay}
                  sx={{
                    minHeight: 42,
                    textTransform: "none",
                    fontWeight: 600,
                    color: "#2B2B2B",
                    "&.Mui-selected": {
                      bgcolor: "#007040",
                      color: "#ffffff",
                    },
                    "&.Mui-selected:hover": {
                      bgcolor: "#005a32",
                    },
                  }}
                >
                  Giorno
                </ToggleButton>
                <ToggleButton
                  value={absenceModes.days}
                  sx={{
                    minHeight: 42,
                    textTransform: "none",
                    fontWeight: 600,
                    color: "#2B2B2B",
                    "&.Mui-selected": {
                      bgcolor: "#007040",
                      color: "#ffffff",
                    },
                    "&.Mui-selected:hover": {
                      bgcolor: "#005a32",
                    },
                  }}
                >
                  Giorni
                </ToggleButton>
                </ToggleButtonGroup>
              </Box>
              <TextField
                className="calendar-form-field calendar-description-field"
                label="Descrizione facoltativa"
                value={form.description}
                onChange={(e) => updateFormValue("description", e.target.value)}
                multiline
                minRows={2}
                fullWidth
                disabled={isLocked}
              />
            </Stack>
            {absenceMode === absenceModes.days ? (
              <Stack spacing={1.5} className="calendar-form-column calendar-period-section">
                <Typography className="calendar-form-column-title">Periodo</Typography>
                <Box className="calendar-range-preview">{formatDateRangeLabel(form.start_date, form.end_date)}</Box>
                <Box className="calendar-picker-shell">
                  <DayPicker
                    mode="range" locale={dayPickerLocale} weekStartsOn={1} showOutsideDays fixedWeeks
                    selected={selectedDateRange} onSelect={handleDateRangeSelect}
                    defaultMonth={toPickerDate(form.start_date)} className="calendar-day-picker"
                  />
                </Box>
              </Stack>
            ) : (
              <Stack spacing={1.5} className="calendar-form-column calendar-period-section">
                <Typography className="calendar-form-column-title">Periodo e orario</Typography>
                <Grid2 container spacing={2}>
                  <Grid2 size={{ xs: 12 }}>
                    <TextField className="calendar-form-field" type="date" label="Data" value={form.start_date} onChange={(e) => updateFormValue("start_date", e.target.value)} InputLabelProps={{ shrink: true }} fullWidth />
                  </Grid2>
                  <Grid2 size={{ xs: 12, md: 6 }}>
                    <TextField className="calendar-form-field" type="time" label="Dalle" value={form.start_time} onChange={(e) => updateFormValue("start_time", e.target.value)} InputLabelProps={{ shrink: true }} fullWidth />
                  </Grid2>
                  <Grid2 size={{ xs: 12, md: 6 }}>
                    <TextField className="calendar-form-field" type="time" label="Alle" value={form.end_time} onChange={(e) => updateFormValue("end_time", e.target.value)} InputLabelProps={{ shrink: true }} fullWidth />
                  </Grid2>
                </Grid2>
              </Stack>
            )}
          </Box>
        </DialogContent>
        <DialogActions className="calendar-modal-actions">
          {editingJustification && !isLocked && (
            <Button className="calendar-delete-action" color="error" onClick={() => deleteMutation.mutate(editingJustification.id)} disabled={deleteMutation.isPending || saveInProgress}>
              {deleteMutation.isPending ? "Eliminazione..." : "Elimina"}
            </Button>
          )}
          {editingJustification?.requires_my_approval && (
            <>
              {editingJustification.approval_status !== "pending" && (
                <Button onClick={() => approveMutation.mutate({ justificationId: editingJustification.id, approvalStatus: "pending" })} disabled={approveMutation.isPending || saveInProgress || deleteMutation.isPending}>In attesa</Button>
              )}
              {editingJustification.approval_status !== "rejected" && (
                <Button color="error" onClick={() => approveMutation.mutate({ justificationId: editingJustification.id, approvalStatus: "rejected" })} disabled={approveMutation.isPending || saveInProgress || deleteMutation.isPending}>Rifiuta</Button>
              )}
              {editingJustification.approval_status !== "approved" && (
                <Button variant="contained" onClick={() => approveMutation.mutate({ justificationId: editingJustification.id, approvalStatus: "approved" })} disabled={approveMutation.isPending || saveInProgress || deleteMutation.isPending}>Approva</Button>
              )}
            </>
          )}
          <Button onClick={closeModal} className="calendar-ghost-button" disabled={saveInProgress || deleteMutation.isPending}>
            {isLocked ? "Chiudi" : "Annulla"}
          </Button>
          {!isLocked && (
            <Button
              variant="contained"
              disabled={!form.employee_id || saveInProgress || deleteMutation.isPending}
              onClick={handleSave}
              className="calendar-primary-action"
              sx={{
                bgcolor: "#007040",
                color: "#ffffff",
                borderRadius: "10px",
                px: 2.25,
                py: 1.25,
                boxShadow: "0 4px 12px -4px rgba(0,80,46,.5)",
                "&:hover": {
                  bgcolor: "#005a32",
                  boxShadow: "0 4px 12px -4px rgba(0,80,46,.5)",
                },
                "&.Mui-disabled": {
                  bgcolor: "rgba(0,112,64,0.16)",
                  color: "#007040",
                },
              }}
            >
              {saveInProgress ? "Salvataggio..." : editingJustification ? "Salva modifiche" : "Salva assenza"}
            </Button>
          )}
        </DialogActions>
      </Dialog>
    </Stack>
  );
}
