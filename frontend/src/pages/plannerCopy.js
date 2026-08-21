export function buildCopySourceTeams(assignments, employeeTeamMap, employeeNameMap) {
  const byTeam = new Map();

  for (const assignment of assignments ?? []) {
    const team = employeeTeamMap[assignment.employee_id];
    const id = team?.id ?? "__no_team__";
    if (!byTeam.has(id)) {
      byTeam.set(id, {
        id,
        name: team?.name ?? "Senza squadra",
        icon: team?.icon ?? null,
        count: 0,
        notedAssignments: [],
      });
    }

    const item = byTeam.get(id);
    item.count += 1;
    const notes = String(assignment.notes ?? "").trim();
    if (notes) {
      item.notedAssignments.push({
        id: assignment.id,
        employeeName: employeeNameMap[assignment.employee_id] ?? "Dipendente",
        notes,
        startTime: String(assignment.start_time ?? "").slice(0, 5),
        endTime: String(assignment.end_time ?? "").slice(0, 5),
      });
    }
  }

  return [...byTeam.values()].sort((a, b) => {
    if (a.id === "__no_team__") return 1;
    if (b.id === "__no_team__") return -1;
    return a.name.localeCompare(b.name);
  });
}

export function notesForCopiedAssignment(assignment, selectedNoteIds) {
  return selectedNoteIds?.has(assignment.id) ? assignment.notes ?? null : null;
}
