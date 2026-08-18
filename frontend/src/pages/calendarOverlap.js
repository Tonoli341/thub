function timeToMinutes(value) {
  const match = /^(\d{1,2}):(\d{2})(?::\d{2})?$/.exec(String(value ?? ""));
  if (!match) return null;

  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (hours > 23 || minutes > 59) return null;
  return hours * 60 + minutes;
}

function intervalsOverlap(firstStart, firstEnd, secondStart, secondEnd) {
  return firstStart < secondEnd && firstEnd > secondStart;
}

function assignmentWorkIntervals(assignment, start, end) {
  const breakStart = timeToMinutes(assignment.break_start);
  const breakEnd = timeToMinutes(assignment.break_end);
  if (breakStart === null || breakEnd === null || breakStart >= breakEnd) {
    return [[start, end]];
  }

  const clippedBreakStart = Math.max(start, breakStart);
  const clippedBreakEnd = Math.min(end, breakEnd);
  if (clippedBreakStart >= clippedBreakEnd) return [[start, end]];

  return [
    [start, clippedBreakStart],
    [clippedBreakEnd, end],
  ].filter(([intervalStart, intervalEnd]) => intervalStart < intervalEnd);
}

/**
 * Verifica se un'assenza intercetta ore effettivamente lavorate nel Planner.
 * Gli intervalli sono semiaperti: 08:00-14:00 e 14:00-18:00 sono adiacenti,
 * non sovrapposti. Le pause vengono sottratte dall'intervallo pianificato.
 */
export function hasPlannerOverlap(justification, assignment) {
  if (assignment.employee_id !== justification.employee_id) return false;
  if (assignment.work_date < justification.start_date || assignment.work_date > justification.end_date) return false;

  const assignmentStart = timeToMinutes(assignment.start_time);
  const assignmentEnd = timeToMinutes(assignment.end_time);
  const absenceStart = timeToMinutes(justification.start_time);
  const absenceEnd = timeToMinutes(justification.end_time);

  // In presenza di record storici senza orari validi manteniamo l'avviso
  // prudenziale basato sulla data, invece di nascondere un possibile conflitto.
  if (
    assignmentStart === null
    || assignmentEnd === null
    || absenceStart === null
    || absenceEnd === null
    || assignmentStart >= assignmentEnd
    || absenceStart >= absenceEnd
  ) {
    return true;
  }

  return assignmentWorkIntervals(assignment, assignmentStart, assignmentEnd).some(
    ([workStart, workEnd]) => intervalsOverlap(workStart, workEnd, absenceStart, absenceEnd)
  );
}
