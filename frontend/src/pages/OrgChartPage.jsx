import dagre from "dagre";
import PageHeader, { HeaderButton } from "../components/PageHeader";
import { useQuery } from "@tanstack/react-query";
import { Background, Controls, Handle, MarkerType, Position, ReactFlow, ReactFlowProvider, getViewportForBounds, useReactFlow } from "@xyflow/react";
import { Alert, Avatar, Box, Button, Checkbox, Chip, CircularProgress, Divider, ListItemText, Menu, MenuItem, Paper, Stack, Typography } from "@mui/material";
import { useEffect, useMemo, useRef, useState } from "react";

import { getEmployeeCourseBadges, getEmployeePhoto, getEmployees, getOrgDepartments, getOrgFunctions } from "../api";

const groupNodeWidth = 220;
const functionNodeHeight = 86;
const departmentNodeHeight = 74;
const personNodeWidth = 180;
const personNodeHeight = 126;
const personNodeHeightWithBadges = 158;

const resourceTone = {
  "Responsabile di funzione": { bg: "#007040", soft: "rgba(15, 76, 92, 0.12)", text: "#007040" },
  "Manager": { bg: "#5c3d6e", soft: "rgba(92, 61, 110, 0.12)", text: "#5c3d6e" },
  "Responsabile di dipartimento": { bg: "#5e6c8a", soft: "rgba(94, 108, 138, 0.12)", text: "#3d4f6e" },
  "Responsabile": { bg: "#7a5c61", soft: "rgba(122, 92, 97, 0.12)", text: "#7a5c61" },
  Collaboratore: { bg: "#6b7280", soft: "rgba(107, 114, 128, 0.12)", text: "#4b5563" },
  "Team Leader": { bg: "rgba(212, 160, 23, 0.14)", soft: "rgba(212, 160, 23, 0.14)", text: "#a07808" },
  BOARD: { bg: "#7a5a00", soft: "linear-gradient(135deg, rgba(202, 138, 4, 0.2), rgba(120, 53, 15, 0.14))", text: "#7a4b00" },
};

function getPersonDisplayLabel({ resourceLabel, isTeamLeader, isDirettivo }) {
  if (isDirettivo) {
    return "BOARD";
  }
  if (isTeamLeader && resourceLabel === "Collaboratore") {
    return "Team Leader";
  }
  return resourceLabel;
}

function getInitials(fullName) {
  return fullName.split(" ").filter(Boolean).slice(0, 2).map((token) => token[0]).join("").toUpperCase() || "?";
}

function getRoleColor(role) {
  if (role === "IMPIEGATO") return "#007040";
  if (role === "MAGAZZINIERE") return "#6c584c";
  if (role === "AUTISTA") return "#bc4749";
  if (role === "OFFICINA") return "#7f5539";
  if (role === "PULIZIE") return "#588157";
  return "#40506b";
}

function compareEmployees(a, b) {
  return (a.full_name ?? "").localeCompare(b.full_name ?? "", "it", { sensitivity: "base" });
}

function compareOrgNodes(a, b) {
  const priority = {
    "Responsabile di funzione": 0,
    "Manager": 1,
    "Responsabile di dipartimento": 2,
    "Responsabile": 3,
    Collaboratore: 4,
  };
  const priorityDelta = (priority[a.resourceLabel] ?? 99) - (priority[b.resourceLabel] ?? 99);
  if (priorityDelta !== 0) {
    return priorityDelta;
  }
  return compareEmployees(a.employee, b.employee);
}

function countPersonDescendants(node) {
  return (node.sameGroupChildren ?? []).reduce((total, child) => total + 1 + countPersonDescendants(child), 0);
}

function sortOrgBranch(node) {
  node.sameGroupChildren.sort(compareOrgNodes);
  node.sameGroupChildren.forEach(sortOrgBranch);
}

function buildOrgChartModel(employees, orgDepartments = [], orgFunctions = []) {
  const sortedEmployees = [...employees].sort(compareEmployees);
  const employeeById = new Map(sortedEmployees.map((e) => [e.id, e]));
  const functionMap = new Map();

  // Map: func name → responsible employee id (from OrgFunction entities)
  const funcResponsibleMap = new Map();
  for (const orgFunc of orgFunctions) {
    if (orgFunc.responsible_employee_id) {
      funcResponsibleMap.set(orgFunc.name, { empId: orgFunc.responsible_employee_id, orgFuncId: orgFunc.id });
    }
  }

  // Map: dept name → {responsibleEmpId, functionName} (from OrgDepartment entities)
  const deptResponsibleMap = new Map();
  const deptFunctionMap = new Map();
  for (const dept of orgDepartments) {
    if (dept.function_name) {
      deptFunctionMap.set(dept.name, dept.function_name);
    }
    if (dept.responsible_employee_id) {
      deptResponsibleMap.set(dept.name, { empId: dept.responsible_employee_id, orgDeptId: dept.id });
    }
  }

  function ensureDepartment(functionLabel, departmentLabel) {
    let functionEntry = functionMap.get(functionLabel);
    if (!functionEntry) {
      functionEntry = {
        id: `function:${functionLabel}`,
        label: functionLabel,
        employeeCount: 0,
        roots: [],
        departmentsMap: new Map(),
      };
      functionMap.set(functionLabel, functionEntry);
    }

    let departmentEntry = functionEntry.departmentsMap.get(departmentLabel);
    if (!departmentEntry) {
      departmentEntry = {
        id: `department:${functionLabel}:${departmentLabel}`,
        label: departmentLabel,
        employeeCount: 0,
        roots: [],
        personNodes: [],
        descendantCount: 0,
      };
      functionEntry.departmentsMap.set(departmentLabel, departmentEntry);
    }
    return { functionEntry, departmentEntry };
  }

  // I team sono trasversali all'organigramma: la gerarchia è definita solo da manager_employee_id.
  // Tutti i dipendenti vengono posizionati in base a organization_function/organization_department.
  const managerEmployeeIds = new Set(sortedEmployees.map((e) => e.manager_employee_id).filter(Boolean));

  for (const employee of sortedEmployees.filter((e) => !e.is_direttivo)) {
    const rawDepartmentLabel = String(employee.organization_department ?? "").trim();
    const functionLabel = (rawDepartmentLabel && deptFunctionMap.get(rawDepartmentLabel))
      || String(employee.organization_function ?? "").trim()
      || "Fuori struttura";
    const departmentLabel = rawDepartmentLabel || "Senza dipartimento";
    const { functionEntry, departmentEntry } = ensureDepartment(functionLabel, departmentLabel);
    const targetRoots = rawDepartmentLabel ? departmentEntry.roots : functionEntry.roots;
    const targetContainerId = rawDepartmentLabel ? departmentEntry.id : functionEntry.id;
    functionEntry.employeeCount += 1;
    if (rawDepartmentLabel) {
      departmentEntry.employeeCount += 1;
    }
    targetRoots.push({
      id: "employee:" + employee.id,
      employee,
      resourceLabel: managerEmployeeIds.has(employee.id) ? (rawDepartmentLabel ? "Responsabile" : "Manager") : "Collaboratore",
      departmentId: targetContainerId,
      crossGroupParentId: null,
      reportsToEmployeeId: employee.manager_employee_id ?? null,
      sameGroupChildren: [],
      descendantCount: 0,
    });
  }

  function indexNode(node, nodeByEmployeeId) {
    nodeByEmployeeId.set(node.employee.id, node);
    for (const child of node.sameGroupChildren ?? []) {
      indexNode(child, nodeByEmployeeId);
    }
  }

  function wouldCreateReportingCycle(node, parentNode, nodeByEmployeeId) {
    let current = parentNode;
    const visited = new Set();
    while (current && !visited.has(current.id)) {
      if (current.id === node.id) {
        return true;
      }
      visited.add(current.id);
      current = current.reportsToEmployeeId ? nodeByEmployeeId.get(current.reportsToEmployeeId) ?? null : null;
    }
    return false;
  }

  for (const functionEntry of functionMap.values()) {
    const nodeByEmployeeId = new Map();
    functionEntry.roots.forEach((node) => indexNode(node, nodeByEmployeeId));
    for (const departmentEntry of functionEntry.departmentsMap.values()) {
      departmentEntry.personNodes = [...departmentEntry.roots];
      departmentEntry.personNodes.forEach((node) => indexNode(node, nodeByEmployeeId));
    }

    const rootCollections = [functionEntry.roots, ...[...functionEntry.departmentsMap.values()].map((departmentEntry) => departmentEntry.roots)];
    for (const roots of rootCollections) {
      const nestedRootIds = new Set();
      for (const root of roots) {
        if (!root.reportsToEmployeeId) {
          continue;
        }
        const parentNode = nodeByEmployeeId.get(root.reportsToEmployeeId) ?? null;
        if (!parentNode || parentNode.id === root.id || wouldCreateReportingCycle(root, parentNode, nodeByEmployeeId)) {
          continue;
        }
        if (parentNode.departmentId === root.departmentId) {
          if (root.resourceLabel === "Manager") {
            root.resourceLabel = "Responsabile";
          }
          parentNode.sameGroupChildren.push(root);
          nestedRootIds.add(root.id);
          continue;
        }
        // Cross-group edges only allowed when the parent is at function level (not in another dept)
        if (parentNode.departmentId.startsWith("function:")) {
          root.crossGroupParentId = parentNode.id;
        }
      }
      const remainingRoots = roots.filter((root) => !nestedRootIds.has(root.id));
      roots.length = 0;
      roots.push(...remainingRoots);
    }
  }

  // Post-processing: apply OrgDepartment responsible_employee_id
  function findInRoots(roots, empId) {
    for (const root of roots) {
      if (root.employee.id === empId) return root;
      const found = findInRoots(root.sameGroupChildren, empId);
      if (found) return found;
    }
    return null;
  }

  for (const [deptName, { empId: responsibleId }] of deptResponsibleMap) {
    const responsibleEmployee = employeeById.get(responsibleId);
    if (!responsibleEmployee) continue;

    let foundDeptEntry = null;
    let foundFunctionEntry = null;
    for (const functionEntry of functionMap.values()) {
      const deptEntry = functionEntry.departmentsMap.get(deptName);
      if (deptEntry) {
        foundDeptEntry = deptEntry;
        foundFunctionEntry = functionEntry;
        break;
      }
    }

    if (!foundDeptEntry) {
      // Dept has no team yet; use dept's explicit function, then responsible's function as fallback
      const functionLabel = deptFunctionMap.get(deptName)
        || String(responsibleEmployee.organization_function ?? "").trim()
        || "Fuori struttura";
      const result = ensureDepartment(functionLabel, deptName);
      foundDeptEntry = result.departmentEntry;
      foundFunctionEntry = result.functionEntry;
    }

    // Se coincide con il Responsabile di funzione, non riportarlo anche come responsabile di dipartimento
    if (funcResponsibleMap.get(foundFunctionEntry.label)?.empId === responsibleId) continue;

    const existingDirectRoot = foundDeptEntry.roots.find((r) => r.employee.id === responsibleId);
    if (existingDirectRoot) {
      // È già root diretto: lo rinomina e porta gli altri root come suoi figli
      existingDirectRoot.resourceLabel = "Responsabile di dipartimento";
      const otherRoots = foundDeptEntry.roots.filter((r) => r.id !== existingDirectRoot.id);
      if (otherRoots.length > 0) {
        existingDirectRoot.sameGroupChildren = [...existingDirectRoot.sameGroupChildren, ...otherRoots];
        foundDeptEntry.roots = [existingDirectRoot];
      }
    } else {
      const existingNestedNode = findInRoots(foundDeptEntry.roots, responsibleId);
      if (existingNestedNode) {
        // È annidato dentro un altro nodo: solo rinomina, non ristruttura
        existingNestedNode.resourceLabel = "Responsabile di dipartimento";
      } else {
        // Nuovo nodo: diventa l'unico root, gli esistenti diventano suoi figli
        const existingRoots = [...foundDeptEntry.roots];
        const nodeId = `dept-responsible:${foundDeptEntry.id}:${responsibleId}`;
        foundDeptEntry.roots = [{
          id: nodeId,
          employee: responsibleEmployee,
          resourceLabel: "Responsabile di dipartimento",
          departmentId: foundDeptEntry.id,
          crossGroupParentId: null,
          reportsToEmployeeId: null,
          sameGroupChildren: existingRoots,
          descendantCount: 0,
        }];
        foundDeptEntry.employeeCount += 1;
        foundFunctionEntry.employeeCount += 1;
      }
    }
  }

  // Post-processing: apply OrgFunction responsible_employee_id
  for (const [funcName, { empId: responsibleId }] of funcResponsibleMap) {
    const responsibleEmployee = employeeById.get(responsibleId);
    if (!responsibleEmployee) continue;

    let functionEntry = functionMap.get(funcName);
    if (!functionEntry) {
      functionEntry = {
        id: `function:${funcName}`,
        label: funcName,
        employeeCount: 0,
        roots: [],
        departmentsMap: new Map(),
      };
      functionMap.set(funcName, functionEntry);
    }

    // 1. Already in function roots → just relabel, and remove any duplicate in depts
    const existingInFuncRoots = findInRoots(functionEntry.roots, responsibleId);
    if (existingInFuncRoots) {
      existingInFuncRoots.resourceLabel = "Responsabile di funzione";
      for (const deptEntry of functionEntry.departmentsMap.values()) {
        const idx = deptEntry.roots.findIndex((r) => r.employee.id === responsibleId);
        if (idx >= 0) {
          const removed = deptEntry.roots[idx];
          deptEntry.roots.splice(idx, 1, ...removed.sameGroupChildren);
          deptEntry.employeeCount = Math.max(0, deptEntry.employeeCount - 1);
          functionEntry.employeeCount = Math.max(0, functionEntry.employeeCount - 1);
        }
      }
      continue;
    }

    // 2. Is a direct root of one of the depts → move the node to function level (keep same ID
    //    so any crossGroupParentId references to this node remain valid in buildGraph)
    let movedNode = null;
    for (const deptEntry of functionEntry.departmentsMap.values()) {
      const idx = deptEntry.roots.findIndex((r) => r.employee.id === responsibleId);
      if (idx >= 0) {
        movedNode = deptEntry.roots[idx];
        // Promote this node's children directly into the dept, then remove the node itself
        deptEntry.roots.splice(idx, 1, ...movedNode.sameGroupChildren);
        deptEntry.employeeCount = Math.max(0, deptEntry.employeeCount - 1);
        functionEntry.employeeCount = Math.max(0, functionEntry.employeeCount - 1);
        break;
      }
    }
    if (movedNode) {
      movedNode.resourceLabel = "Responsabile di funzione";
      movedNode.sameGroupChildren = [];
      movedNode.descendantCount = 0;
      movedNode.reportsToEmployeeId = null;
      functionEntry.roots.unshift(movedNode);
      functionEntry.employeeCount += 1;
      continue;
    }

    // 3. Nested inside a dept node → just relabel in place (can't easily extract)
    let foundNested = false;
    for (const deptEntry of functionEntry.departmentsMap.values()) {
      const nestedNode = findInRoots(deptEntry.roots, responsibleId);
      if (nestedNode) {
        nestedNode.resourceLabel = "Responsabile di funzione";
        foundNested = true;
        break;
      }
    }

    // 4. Not found anywhere → create new node
    if (!foundNested) {
      const nodeId = `function-responsible:${functionEntry.id}:${responsibleId}`;
      functionEntry.roots.unshift({
        id: nodeId,
        employee: responsibleEmployee,
        resourceLabel: "Responsabile di funzione",
        departmentId: functionEntry.id,
        crossGroupParentId: null,
        reportsToEmployeeId: null,
        sameGroupChildren: [],
        descendantCount: 0,
      });
      functionEntry.employeeCount += 1;
    }
  }

  for (const functionEntry of functionMap.values()) {
    functionEntry.roots.sort(compareOrgNodes);
    let managerAssigned = false;
    functionEntry.roots.forEach((root) => {
      if (root.resourceLabel === "Manager") {
        if (managerAssigned) {
          root.resourceLabel = "Responsabile";
        } else {
          managerAssigned = true;
        }
      }
      sortOrgBranch(root);
      root.descendantCount = countPersonDescendants(root);
    });
    for (const departmentEntry of functionEntry.departmentsMap.values()) {
      departmentEntry.roots.sort(compareOrgNodes);
      departmentEntry.roots.forEach((root) => {
        sortOrgBranch(root);
        root.descendantCount = countPersonDescendants(root);
      });
      departmentEntry.descendantCount = departmentEntry.employeeCount;
    }
  }

  const functions = [...functionMap.values()]
    .sort((left, right) => left.label.localeCompare(right.label, "it", { sensitivity: "base" }))
    .map((functionEntry) => {
      const departments = [...functionEntry.departmentsMap.values()]
        .filter((departmentEntry) => departmentEntry.employeeCount > 0 || departmentEntry.roots.length > 0)
        .sort((left, right) => left.label.localeCompare(right.label, "it", { sensitivity: "base" }))
        .map((departmentEntry) => departmentEntry);
      return {
        id: functionEntry.id,
        label: functionEntry.label,
        employeeCount: functionEntry.employeeCount,
        descendantCount: functionEntry.employeeCount + departments.length,
        roots: functionEntry.roots,
        departments,
      };
    });

  const direttivoEmployees = sortedEmployees.filter((e) => e.is_direttivo);
  const direttivoTree = buildDirettivoTree(direttivoEmployees);

  return { functions, totalEmployees: sortedEmployees.length, direttivoEmployees, direttivoTree };
}

// Gerarchia interna al Board: usa esclusivamente "Responsabile Diretto" (manager_employee_id)
// per collegare i membri del board tra loro. Non ha alcun effetto fuori dal box Board.
function buildDirettivoTree(direttivoEmployees) {
  const idSet = new Set(direttivoEmployees.map((e) => e.id));
  const nodeById = new Map(direttivoEmployees.map((employee) => [employee.id, {
    id: "direttivo:person:" + employee.id,
    employee,
    resourceLabel: "Collaboratore",
    crossGroupParentId: null,
    reportsToEmployeeId: employee.manager_employee_id ?? null,
    sameGroupChildren: [],
    descendantCount: 0,
  }]));

  function wouldCreateCycle(node, parentNode) {
    let current = parentNode;
    const visited = new Set();
    while (current) {
      if (current === node) return true;
      if (visited.has(current.employee.id)) return true;
      visited.add(current.employee.id);
      const managerId = current.reportsToEmployeeId;
      current = managerId && idSet.has(managerId) ? nodeById.get(managerId) : null;
    }
    return false;
  }

  const roots = [];
  for (const employee of direttivoEmployees) {
    const node = nodeById.get(employee.id);
    const managerId = employee.manager_employee_id;
    const managerNode = managerId && managerId !== employee.id ? nodeById.get(managerId) : null;
    if (managerNode && !wouldCreateCycle(node, managerNode)) {
      managerNode.sameGroupChildren.push(node);
    } else {
      roots.push(node);
    }
  }

  roots.sort(compareOrgNodes);
  roots.forEach((root) => {
    sortOrgBranch(root);
    root.descendantCount = countPersonDescendants(root);
  });

  return roots;
}

function GroupNode({ data }) {
  return (
    <Box
      className="nodrag nopan"
      sx={{
        width: data.width,
        minHeight: data.height,
        borderRadius: data.kind === "function" ? 4 : 3,
        px: 2,
        py: 1.5,
        display: "flex",
        flexDirection: "column",
        justifyContent: "center",
        alignItems: "center",
        gap: 0.75,
        textAlign: "center",
        background: data.kind === "function"
          ? "linear-gradient(135deg, rgba(0,112,64,0.98), rgba(20,54,66,0.96))"
          : "linear-gradient(180deg, rgba(255,253,248,0.98), rgba(246,241,235,0.96))",
        color: data.kind === "function" ? "white" : "#1e1e31",
        border: data.isCollapsed
          ? "1.5px solid #3b82f6"
          : data.kind === "function"
            ? "1px solid rgba(255,255,255,0.18)"
            : "1px solid rgba(226,226,229,0.95)",
        boxShadow: data.isCollapsed
          ? "0 18px 34px rgba(30,30,49,0.16), 0 0 0 3px rgba(59,130,246,0.16)"
          : "0 18px 34px rgba(30,30,49,0.12)",
        cursor: data.hasChildren ? "pointer" : "default",
        position: "relative",
      }}
    >
      <Handle type="target" position={Position.Top} isConnectable={false} style={{ opacity: 0 }} />
      <Typography variant="overline" sx={{ lineHeight: 1, opacity: data.kind === "function" ? 0.86 : 0.64 }}>
        {data.kind === "function" ? "Funzione" : "Ente / Dipartimento"}
      </Typography>
      <Typography sx={{ fontSize: data.kind === "function" ? 18 : 15, fontWeight: 800, lineHeight: 1.15 }}>
        {data.label}
      </Typography>
      <Typography sx={{ fontSize: 12, opacity: data.kind === "function" ? 0.82 : 0.72 }}>
        {data.employeeCount} risorse
      </Typography>
      {data.hasChildren && (
        <Box
          sx={{
            position: "absolute",
            bottom: -13,
            left: "50%",
            transform: "translateX(-50%)",
            minWidth: 28,
            height: 20,
            borderRadius: 10,
            background: data.isCollapsed ? "#3b82f6" : "#e2e2ea",
            border: "2px solid white",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            px: 0.75,
            fontSize: 10,
            fontWeight: 700,
            color: data.isCollapsed ? "white" : "#40506b",
            boxShadow: "0 1px 4px rgba(0,0,0,0.18)",
            pointerEvents: "none",
          }}
        >
          {data.isCollapsed ? `+${data.hiddenCount}` : "−"}
        </Box>
      )}
      <Handle type="source" position={Position.Bottom} isConnectable={false} style={{ opacity: 0 }} />
    </Box>
  );
}

const BADGE_STATUS_COLOR = {
  valid: "#16a34a",
  expiring: "#d97706",
  expired: "#dc2626",
  missing: "#9ca3af",
};

const COURSE_BADGES = [
  { key: "antincendio", icon: "🔥", label: "Antincendio" },
  { key: "preposto", icon: "🦺", label: "Preposto" },
  { key: "primo_soccorso", icon: "🩹", label: "Primo soccorso" },
  { key: "rls", icon: "🛡️", label: "RLS" },
];

function CourseBadges({ badges }) {
  if (!badges) return null;
  const visible = COURSE_BADGES.filter(({ key }) => (badges[key] ?? "missing") !== "missing");
  if (visible.length === 0) return null;
  return (
    <Box sx={{ display: "flex", gap: 0.5, justifyContent: "center" }}>
      {visible.map(({ key, icon, label }) => {
        const status = badges[key];
        const color = BADGE_STATUS_COLOR[status];
        return (
          <Box
            key={key}
            title={`${label}: ${status}`}
            sx={{
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              width: 22,
              height: 22,
              borderRadius: "50%",
              bgcolor: `${color}22`,
              border: `1.5px solid ${color}`,
              fontSize: 11,
              lineHeight: 1,
            }}
          >
            {icon}
          </Box>
        );
      })}
    </Box>
  );
}

function PersonNode({ data }) {
  const isDirettivo = data.isDirettivo ?? false;
  const displayLabel = getPersonDisplayLabel({
    resourceLabel: data.resourceLabel,
    isTeamLeader: data.isTeamLeader,
    isDirettivo,
  });
  const tone = resourceTone[displayLabel] ?? resourceTone.Collaboratore;

  // cache condivisa con le altre pagine (stessa queryKey): la foto non viene
  // riscaricata per ogni nodo dell'organigramma né a ogni remount
  const { data: photoUrl } = useQuery({
    queryKey: ["employee-photo", data.employeeId],
    queryFn: () => getEmployeePhoto(data.employeeId).then((blob) => URL.createObjectURL(blob)),
    enabled: Boolean(data.hasPhoto),
    staleTime: 1000 * 60 * 30,
    gcTime: 1000 * 60 * 60,
    retry: false,
  });

  return (
    <Box
      className="nodrag nopan"
      sx={{
        width: personNodeWidth,
        minHeight: data.height,
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        gap: 1,
        borderRadius: 3,
        bgcolor: "rgba(255,255,255,0.97)",
        border: data.isCollapsed ? "1.5px solid #3b82f6" : "1px solid rgba(226,226,229,0.95)",
        boxShadow: data.isCollapsed
          ? "0 18px 34px rgba(30,30,49,0.18), 0 0 0 3px rgba(59,130,246,0.16)"
          : "0 18px 34px rgba(30,30,49,0.14)",
        px: 1.25,
        py: 1.25,
        textAlign: "center",
        cursor: data.hasChildren ? "pointer" : "default",
        position: "relative",
      }}
    >
      <Handle type="target" position={Position.Top} isConnectable={false} style={{ opacity: 0 }} />

      <Avatar src={photoUrl || undefined} alt={data.fullName} sx={{ width: 62, height: 62, bgcolor: data.color, fontWeight: 700 }}>
        {data.initials}
      </Avatar>
      <Typography sx={{ fontSize: 12.5, fontWeight: 700, lineHeight: 1.2, color: "#1e1e31" }}>
        {data.fullName}
      </Typography>
      <Chip
        size="small"
        label={displayLabel}
        sx={{
          bgcolor: isDirettivo ? undefined : tone.soft,
          background: isDirettivo ? tone.soft : undefined,
          color: tone.text,
          fontWeight: 700,
          letterSpacing: isDirettivo ? "0.08em" : "normal",
          border: isDirettivo ? `1px solid ${tone.bg}` : "none",
          boxShadow: isDirettivo ? "inset 0 0 0 1px rgba(255,255,255,0.26)" : "none",
          maxWidth: "100%",
          height: "auto",
          "& .MuiChip-label": { whiteSpace: "normal", textAlign: "center", py: 0.375, lineHeight: 1.25 },
        }}
      />
      <CourseBadges badges={data.courseBadges} />
      {data.hasChildren && (
        <Box
          sx={{
            position: "absolute",
            bottom: -13,
            left: "50%",
            transform: "translateX(-50%)",
            minWidth: 28,
            height: 20,
            borderRadius: 10,
            background: data.isCollapsed ? "#3b82f6" : "#e2e2ea",
            border: "2px solid white",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            px: 0.75,
            fontSize: 10,
            fontWeight: 700,
            color: data.isCollapsed ? "white" : "#40506b",
            boxShadow: "0 1px 4px rgba(0,0,0,0.18)",
            pointerEvents: "none",
          }}
        >
          {data.isCollapsed ? `+${data.hiddenCount}` : "−"}
        </Box>
      )}
      <Handle type="source" position={Position.Bottom} isConnectable={false} style={{ opacity: 0 }} />
    </Box>
  );
}

function DirettivoNode({ data }) {
  return (
    <Box
      className="nodrag nopan"
      sx={{
        width: data.width,
        minHeight: 56,
        borderRadius: 3,
        px: 3,
        py: 1.25,
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        gap: 0.35,
        textAlign: "center",
        background: "linear-gradient(135deg, #3f454a, #383e42)",
        color: "#f1ece1",
        border: data.isCollapsed
          ? "1.5px solid #3b82f6"
          : "1px solid rgba(255,255,255,0.14)",
        boxShadow: data.isCollapsed
          ? "0 18px 34px rgba(30,30,49,0.16), 0 0 0 3px rgba(59,130,246,0.16)"
          : "0 18px 34px rgba(30,30,49,0.22)",
        cursor: data.hasChildren ? "pointer" : "default",
        position: "relative",
      }}
    >
      <Handle type="target" position={Position.Top} isConnectable={false} style={{ opacity: 0 }} />
      <Box>
        <Typography variant="overline" sx={{ fontSize: 9, opacity: 0.6, lineHeight: 1, color: "#f1ece1" }}>Organo</Typography>
        <Typography sx={{ fontSize: 16, fontWeight: 900, lineHeight: 1.1, letterSpacing: "0.04em", color: "#f1ece1" }}>BOARD</Typography>
      </Box>
      <Typography sx={{ fontSize: 12, opacity: 0.82, color: "#f1ece1" }}>{data.employeeCount} membri</Typography>
      {data.hasChildren && (
        <Box
          sx={{
            position: "absolute",
            bottom: -13,
            left: "50%",
            transform: "translateX(-50%)",
            minWidth: 28,
            height: 20,
            borderRadius: 10,
            background: data.isCollapsed ? "#3b82f6" : "#e2e2ea",
            border: "2px solid white",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            px: 0.75,
            fontSize: 10,
            fontWeight: 700,
            color: data.isCollapsed ? "white" : "#40506b",
            boxShadow: "0 1px 4px rgba(0,0,0,0.18)",
            pointerEvents: "none",
          }}
        >
          {data.isCollapsed ? `+${data.hiddenCount}` : "−"}
        </Box>
      )}
      <Handle type="source" position={Position.Bottom} isConnectable={false} style={{ opacity: 0 }} />
    </Box>
  );
}

const nodeTypes = {
  group: GroupNode,
  person: PersonNode,
  direttivo: DirettivoNode,
};

// Allinea in alto i nodi dello stesso rango (stesso livello gerarchico): raggruppa per centro-Y
// simile e sposta tutti i membri del gruppo in modo che i loro bordi superiori coincidano,
// dando l'effetto "piramide pulita" a strati usato sia per i blocchi funzione/dipartimento
// che per la gerarchia interna del Board.
function computeTopAlignedY(entries) {
  const RANK_TOLERANCE = 5;
  const rankGroups = [];
  for (const entry of entries) {
    let placed = false;
    for (const group of rankGroups) {
      if (Math.abs(group.centerY - entry.centerY) <= RANK_TOLERANCE) {
        group.members.push(entry);
        placed = true;
        break;
      }
    }
    if (!placed) rankGroups.push({ centerY: entry.centerY, members: [entry] });
  }
  const topAlignedY = new Map();
  for (const group of rankGroups) {
    if (group.members.length <= 1) continue;
    const minTop = Math.min(...group.members.map((m) => m.centerY - m.height / 2));
    for (const m of group.members) topAlignedY.set(m.id, minTop + m.height / 2);
  }
  return topAlignedY;
}

function buildGraph(model, collapsedIds, badgesMap = new Map()) {
  const graph = new dagre.graphlib.Graph();
  graph.setGraph({ rankdir: "TB", nodesep: 44, ranksep: 96, marginx: 28, marginy: 28 });
  graph.setDefaultEdgeLabel(() => ({}));

  const direttivoEmployees = model.direttivoEmployees ?? [];

  const nodes = [];
  const edges = [];

  function addNode(node) {
    nodes.push(node);
    graph.setNode(node.id, { width: node.data.width ?? personNodeWidth, height: node.data.height ?? personNodeHeight });
  }

  function addEdge(source, target) {
    const edgeId = `${source}->${target}`;
    edges.push({
      id: edgeId,
      source,
      target,
      type: "smoothstep",
      markerEnd: { type: MarkerType.ArrowClosed, width: 18, height: 18, color: "#7a8899" },
      style: { stroke: "#7a8899", strokeWidth: 1.45 },
    });
    graph.setEdge(source, target);
  }

  function addPersonBranch(node, parentId, suppressedCrossGroupId = null) {
    const isCollapsed = collapsedIds.has(node.id);
    const badge = badgesMap.get(node.employee.id) ?? null;
    const hasBadges = badge !== null && COURSE_BADGES.some(({ key }) => (badge[key] ?? "missing") !== "missing");
    const nodeHeight = hasBadges ? personNodeHeightWithBadges : personNodeHeight;
    addNode({
      id: node.id,
      type: "person",
      position: { x: 0, y: 0 },
      draggable: false,
      selectable: false,
      data: {
        id: node.id,
        employeeId: node.employee.id,
        width: personNodeWidth,
        height: nodeHeight,
        fullName: node.employee.full_name,
        hasPhoto: node.employee.has_photo,
        initials: getInitials(node.employee.full_name || ""),
        color: getRoleColor(node.employee.tms_role_description),
        resourceLabel: node.resourceLabel,
        isDirettivo: node.employee.is_direttivo ?? false,
        isTeamLeader: node.employee.is_team_leader ?? false,
        hasChildren: node.sameGroupChildren.length > 0,
        isCollapsed,
        hiddenCount: node.descendantCount,
        courseBadges: badge,
      },
      style: {
        background: "transparent",
        border: "none",
        boxShadow: "none",
        padding: 0,
      },
    });
    addEdge(parentId, node.id);
    if (node.crossGroupParentId && node.crossGroupParentId !== parentId && node.crossGroupParentId !== suppressedCrossGroupId) {
      addEdge(node.crossGroupParentId, node.id);
    }
    if (isCollapsed) {
      return;
    }
    for (const child of node.sameGroupChildren) {
      addPersonBranch(child, node.id);
    }
  }

  for (const section of model.functions) {
    const sectionCollapsed = collapsedIds.has(section.id);
    addNode({
      id: section.id,
      type: "group",
      position: { x: 0, y: 0 },
      draggable: false,
      selectable: false,
      data: {
        width: groupNodeWidth,
        height: functionNodeHeight,
        kind: "function",
        label: section.label,
        employeeCount: section.employeeCount,
        hasChildren: section.roots.length > 0 || section.departments.length > 0,
        isCollapsed: sectionCollapsed,
        hiddenCount: section.descendantCount,
      },
      style: {
        background: "transparent",
        border: "none",
        boxShadow: "none",
        padding: 0,
      },
    });
    if (sectionCollapsed) {
      continue;
    }

    for (const root of section.roots) {
      addPersonBranch(root, section.id);
    }

    // Il responsabile di funzione (se presente come root diretto) è il parent dei dipartimenti
    const functionResponsibleNodeId = section.roots.find(
      (r) => r.resourceLabel === "Responsabile di funzione",
    )?.id ?? null;

    for (const department of section.departments) {
      const departmentCollapsed = collapsedIds.has(department.id);
      addNode({
        id: department.id,
        type: "group",
        position: { x: 0, y: 0 },
        draggable: false,
        selectable: false,
        data: {
          width: groupNodeWidth,
          height: departmentNodeHeight,
          kind: "department",
          label: department.label,
          employeeCount: department.employeeCount,
          hasChildren: department.roots.length > 0,
          isCollapsed: departmentCollapsed,
          hiddenCount: department.descendantCount,
        },
        style: {
          background: "transparent",
          border: "none",
          boxShadow: "none",
          padding: 0,
        },
      });

      // Parent priority: responsabile di funzione > cross-group parent > nodo funzione
      const crossParentCounts = new Map();
      for (const root of department.roots) {
        if (root.crossGroupParentId) {
          crossParentCounts.set(root.crossGroupParentId, (crossParentCounts.get(root.crossGroupParentId) ?? 0) + 1);
        }
      }
      const departmentParentId = functionResponsibleNodeId
        ?? (crossParentCounts.size > 0
          ? [...crossParentCounts.entries()].reduce((a, b) => a[1] >= b[1] ? a : b)[0]
          : section.id);

      addEdge(departmentParentId, department.id);
      if (departmentCollapsed) {
        continue;
      }

      for (const root of department.roots) {
        addPersonBranch(root, department.id, departmentParentId !== section.id ? departmentParentId : null);
      }
    }
  }

  dagre.layout(graph);

  // Top-align nodes within each rank: group by similar y-center, then shift so tops align
  const topAlignedY = computeTopAlignedY(
    nodes
      .map((rfNode) => {
        const pos = graph.node(rfNode.id);
        return pos ? { id: rfNode.id, centerY: pos.y, height: rfNode.data.height ?? personNodeHeight } : null;
      })
      .filter(Boolean),
  );

  const positionedNodes = nodes.map((node) => {
    const position = graph.node(node.id) ?? { x: 0, y: 0 };
    const width = node.data.width ?? personNodeWidth;
    const height = node.data.height ?? personNodeHeight;
    const adjustedY = topAlignedY.get(node.id) ?? position.y;
    return {
      ...node,
      position: { x: position.x - width / 2, y: adjustedY - height / 2 },
      sourcePosition: Position.Bottom,
      targetPosition: Position.Top,
    };
  });

  // If there are direttivo employees, add the banner node + the board's internal hierarchy above the rest.
  // La gerarchia interna al board (basata su "Responsabile Diretto") è solo estetica: viene
  // calcolata con un dagre separato e non tocca il layout dell'organigramma sottostante.
  if (direttivoEmployees.length > 0) {
    const isBannerCollapsed = collapsedIds.has("direttivo:banner");
    const nonDirettivoNodes = positionedNodes.filter((n) => !n.id.startsWith("direttivo:"));
    const minX = nonDirettivoNodes.length > 0 ? Math.min(...nonDirettivoNodes.map((n) => n.position.x)) : 0;
    const maxX = nonDirettivoNodes.length > 0 ? Math.max(...nonDirettivoNodes.map((n) => n.position.x + (n.data.width ?? personNodeWidth))) : 800;
    const bannerH = 56;
    const gapBanner = 92;
    const gapPerson = 48;

    let boardNodes = [];
    let boardEdges = [];
    let boardWidth = 0;
    let boardHeight = personNodeHeight;

    if (!isBannerCollapsed) {
      const treeRoots = model.direttivoTree ?? [];
      const boardGraph = new dagre.graphlib.Graph();
      boardGraph.setGraph({ rankdir: "TB", nodesep: 44, ranksep: 64, marginx: 0, marginy: 0 });
      boardGraph.setDefaultEdgeLabel(() => ({}));

      // renderParentId è sempre il vero genitore visivo (banner per le radici) e serve solo per
      // disegnare l'arco in React Flow; dagreParentId è null per le radici così dagre tratta
      // ogni radice come componente separata invece di appiattirle tutte sullo stesso rango.
      function addBoardBranch(node, renderParentId, dagreParentId) {
        const isNodeCollapsed = collapsedIds.has(node.id);
        const badge = badgesMap.get(node.employee.id) ?? null;
        const hasBadges = badge !== null && COURSE_BADGES.some(({ key }) => (badge[key] ?? "missing") !== "missing");
        const nodeHeight = hasBadges ? personNodeHeightWithBadges : personNodeHeight;
        boardGraph.setNode(node.id, { width: personNodeWidth, height: nodeHeight });
        if (dagreParentId) {
          boardGraph.setEdge(dagreParentId, node.id);
        }
        boardNodes.push({
          id: node.id,
          type: "person",
          position: { x: 0, y: 0 },
          draggable: false,
          selectable: false,
          data: {
            id: node.id,
            employeeId: node.employee.id,
            width: personNodeWidth,
            height: nodeHeight,
            fullName: node.employee.full_name,
            hasPhoto: node.employee.has_photo,
            initials: getInitials(node.employee.full_name || ""),
            color: getRoleColor(node.employee.tms_role_description),
            resourceLabel: node.resourceLabel,
            isDirettivo: true,
            isTeamLeader: node.employee.is_team_leader ?? false,
            hasChildren: node.sameGroupChildren.length > 0,
            isCollapsed: isNodeCollapsed,
            hiddenCount: node.descendantCount,
            courseBadges: badge,
          },
          style: { background: "transparent", border: "none", boxShadow: "none", padding: 0 },
        });
        boardEdges.push({ source: renderParentId, target: node.id });
        if (isNodeCollapsed) {
          return;
        }
        for (const child of node.sameGroupChildren) {
          addBoardBranch(child, node.id, node.id);
        }
      }

      treeRoots.forEach((root) => addBoardBranch(root, "direttivo:banner", null));
      dagre.layout(boardGraph);

      // Stessa logica "a piramide pulita" usata per i blocchi funzione/dipartimento: allinea
      // in alto i membri del board che si trovano allo stesso livello gerarchico.
      const boardTopAlignedY = computeTopAlignedY(
        boardNodes.map((node) => {
          const pos = boardGraph.node(node.id);
          return { id: node.id, centerY: pos.y, height: node.data.height };
        }),
      );

      let boardMinX = Infinity;
      let boardMaxX = -Infinity;
      let boardMaxBottom = 0;
      for (const node of boardNodes) {
        const pos = boardGraph.node(node.id);
        const alignedY = boardTopAlignedY.get(node.id) ?? pos.y;
        node.position = { x: pos.x, y: alignedY };
        boardMinX = Math.min(boardMinX, pos.x - node.data.width / 2);
        boardMaxX = Math.max(boardMaxX, pos.x + node.data.width / 2);
        boardMaxBottom = Math.max(boardMaxBottom, alignedY + node.data.height / 2);
      }
      boardWidth = boardMaxX - boardMinX;
      boardHeight = boardMaxBottom;

      const chartWidthForCentering = Math.max(maxX - minX, boardWidth + 80);
      const centerShiftX = (chartWidthForCentering - boardWidth) / 2 - boardMinX;
      const yOffset = bannerH + gapBanner;
      boardNodes.forEach((node) => {
        node.position = {
          x: minX + centerShiftX + node.position.x - node.data.width / 2,
          y: yOffset + node.position.y - node.data.height / 2,
        };
        node.sourcePosition = Position.Bottom;
        node.targetPosition = Position.Top;
      });
    }

    const chartWidth = Math.max(maxX - minX, boardWidth + 80);

    // Shift all existing nodes down (only if expanded — the board hierarchy takes space)
    const shift = isBannerCollapsed ? bannerH + gapPerson : bannerH + gapBanner + boardHeight + gapPerson;
    positionedNodes.forEach((n) => { n.position = { x: n.position.x, y: n.position.y + shift }; });

    // Banner node
    positionedNodes.unshift({
      id: "direttivo:banner",
      type: "direttivo",
      position: { x: minX, y: 0 },
      draggable: false,
      selectable: false,
      data: {
        width: chartWidth,
        height: bannerH,
        employeeCount: direttivoEmployees.length,
        hasChildren: true,
        isCollapsed: isBannerCollapsed,
        hiddenCount: direttivoEmployees.length,
      },
      style: { background: "transparent", border: "none", boxShadow: "none", padding: 0 },
      sourcePosition: Position.Bottom,
      targetPosition: Position.Top,
    });

    if (!isBannerCollapsed) {
      positionedNodes.push(...boardNodes);
      for (const { source, target } of boardEdges) {
        edges.push({
          id: `${source}->${target}`,
          source,
          target,
          type: "smoothstep",
          markerEnd: { type: MarkerType.ArrowClosed, width: 16, height: 16, color: "#7a8899" },
          style: { stroke: "#7a8899", strokeWidth: 1.45 },
        });
      }
    }
  }

  return { nodes: positionedNodes, edges };
}

function computeGraphBounds(nodes) {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const node of nodes) {
    const width = node.data.width ?? personNodeWidth;
    const height = node.data.height ?? personNodeHeight;
    minX = Math.min(minX, node.position.x);
    minY = Math.min(minY, node.position.y);
    maxX = Math.max(maxX, node.position.x + width);
    maxY = Math.max(maxY, node.position.y + height);
  }
  const padding = 28;
  return { x: minX - padding, y: minY - padding, width: maxX - minX + padding * 2, height: maxY - minY + padding * 2 };
}

function waitForNextFrames() {
  return new Promise((resolve) => window.requestAnimationFrame(() => window.requestAnimationFrame(resolve)));
}

// Le foto dei nodi appena montati (prima compressi) partono in fetch dopo il mount:
// attende che tutte le <img> presenti nel viewport siano caricate, con un timeout di sicurezza.
async function waitForImages(container, timeoutMs = 5000) {
  await new Promise((resolve) => setTimeout(resolve, 350));
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const images = [...container.querySelectorAll("img")];
    if (images.every((img) => img.complete)) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
}

function OrgChartCanvas() {
  const { fitView } = useReactFlow();
  const employeesQuery = useQuery({
    queryKey: ["employees", "org-chart"],
    queryFn: () => getEmployees("", []),
  });
  const departmentsQuery = useQuery({
    queryKey: ["org-departments", "org-chart"],
    queryFn: () => getOrgDepartments(),
  });
  const functionsQuery = useQuery({
    queryKey: ["org-functions", "org-chart"],
    queryFn: () => getOrgFunctions(),
  });
  const badgesQuery = useQuery({
    queryKey: ["employee-course-badges"],
    queryFn: getEmployeeCourseBadges,
    staleTime: 5 * 60_000,
  });

  const badgesMap = useMemo(() => {
    const map = new Map();
    for (const badge of (badgesQuery.data ?? [])) {
      map.set(badge.employee_id, badge);
    }
    return map;
  }, [badgesQuery.data]);

  const model = useMemo(
    () => buildOrgChartModel(
      employeesQuery.data ?? [],
      departmentsQuery.data ?? [],
      functionsQuery.data ?? [],
    ),
    [employeesQuery.data, departmentsQuery.data, functionsQuery.data],
  );

  const collapsibleIds = useMemo(() => {
    const ids = [];
    if ((model.direttivoEmployees ?? []).length > 0) {
      ids.push("direttivo:banner");
      const boardQueue = [...(model.direttivoTree ?? [])];
      while (boardQueue.length) {
        const current = boardQueue.shift();
        if ((current.sameGroupChildren?.length ?? 0) > 0) {
          ids.push(current.id);
          boardQueue.push(...current.sameGroupChildren);
        }
      }
    }
    for (const section of model.functions) {
      if (section.roots.length > 0 || section.departments.length > 0) {
        ids.push(section.id);
      }
      for (const department of section.departments) {
        if (department.roots.length > 0) {
          ids.push(department.id);
        }
        const queue = [...department.roots];
        while (queue.length) {
          const current = queue.shift();
          if ((current.sameGroupChildren?.length ?? 0) > 0) {
            ids.push(current.id);
            queue.push(...current.sameGroupChildren);
          }
        }
      }
    }
    return ids;
  }, [model]);

  const [collapsedIds, setCollapsedIds] = useState(new Set());
  const initializedRef = useRef(false);

  useEffect(() => {
    setCollapsedIds((current) => new Set([...current].filter((id) => collapsibleIds.includes(id))));
  }, [collapsibleIds]);

  useEffect(() => {
    if (initializedRef.current || employeesQuery.isLoading || departmentsQuery.isLoading || functionsQuery.isLoading) {
      return;
    }
    initializedRef.current = true;
    setCollapsedIds(new Set(collapsibleIds));
  }, [employeesQuery.isLoading, departmentsQuery.isLoading, functionsQuery.isLoading]);

  const graph = useMemo(() => buildGraph(model, collapsedIds, badgesMap), [model, collapsedIds, badgesMap]);

  // ── Stampa PDF ──────────────────────────────────────────────────────────
  const flowWrapperRef = useRef(null);
  const [printMenuAnchor, setPrintMenuAnchor] = useState(null);
  const [printSelectionState, setPrintSelectionState] = useState(null); // null = intero organigramma
  const [printGraph, setPrintGraph] = useState(null); // grafo temporaneo mostrato durante la cattura
  const [printing, setPrinting] = useState(false);
  const [printError, setPrintError] = useState(null);

  const printSections = useMemo(() => {
    const sections = [];
    if ((model.direttivoEmployees ?? []).length > 0) {
      sections.push({ id: "board", label: "Board", count: model.direttivoEmployees.length, departments: [] });
    }
    for (const section of model.functions) {
      sections.push({
        id: section.id,
        label: section.label,
        count: section.employeeCount,
        departments: section.departments.map((department) => ({
          id: department.id,
          label: department.label,
          count: department.employeeCount,
        })),
      });
    }
    return sections;
  }, [model]);

  // Le unità selezionabili ("foglie") sono i dipartimenti; per le sezioni senza
  // dipartimenti (Board, funzioni piatte) è la sezione stessa.
  function printLeafIds(section) {
    return section.departments.length > 0 ? section.departments.map((department) => department.id) : [section.id];
  }

  const allPrintLeafIds = printSections.flatMap(printLeafIds);
  const printSelection = printSelectionState ?? new Set(allPrintLeafIds);
  const allPrintSelected = allPrintLeafIds.length > 0 && allPrintLeafIds.every((id) => printSelection.has(id));
  const anyPrintSelected = allPrintLeafIds.some((id) => printSelection.has(id));
  // Una pagina per ogni sezione con almeno una foglia selezionata
  const selectedPageCount = printSections.filter((section) => printLeafIds(section).some((id) => printSelection.has(id))).length;

  function togglePrintLeaf(id) {
    const next = new Set(printSelection);
    if (next.has(id)) {
      next.delete(id);
    } else {
      next.add(id);
    }
    setPrintSelectionState(next);
  }

  function togglePrintSection(section) {
    const leafIds = printLeafIds(section);
    const allSelected = leafIds.every((id) => printSelection.has(id));
    const next = new Set(printSelection);
    for (const id of leafIds) {
      if (allSelected) {
        next.delete(id);
      } else {
        next.add(id);
      }
    }
    setPrintSelectionState(next);
  }

  function togglePrintAll() {
    setPrintSelectionState(allPrintSelected ? new Set() : null);
  }

  async function handleGeneratePdf() {
    // Una pagina A4 orizzontale per ogni sezione selezionata (Board e/o funzioni)
    const pageSpecs = [];
    if (printSelection.has("board") && (model.direttivoEmployees ?? []).length > 0) {
      pageSpecs.push({
        functions: [],
        totalEmployees: model.totalEmployees,
        direttivoEmployees: model.direttivoEmployees,
        direttivoTree: model.direttivoTree,
      });
    }
    for (const section of model.functions) {
      let pageSection = null;
      if (section.departments.length === 0) {
        if (printSelection.has(section.id)) {
          pageSection = section;
        }
      } else {
        const selectedDepartments = section.departments.filter((department) => printSelection.has(department.id));
        if (selectedDepartments.length === section.departments.length) {
          pageSection = section;
        } else if (selectedDepartments.length > 0) {
          // Funzione filtrata sui soli dipartimenti selezionati (le persone a livello
          // funzione restano incluse per mantenere il contesto gerarchico)
          const excludedCount = section.departments
            .filter((department) => !printSelection.has(department.id))
            .reduce((total, department) => total + department.employeeCount, 0);
          pageSection = { ...section, departments: selectedDepartments, employeeCount: section.employeeCount - excludedCount };
        }
      }
      if (pageSection) {
        pageSpecs.push({ functions: [pageSection], totalEmployees: model.totalEmployees, direttivoEmployees: [], direttivoTree: [] });
      }
    }
    if (pageSpecs.length === 0) {
      return;
    }

    setPrintMenuAnchor(null);
    setPrinting(true);
    setPrintError(null);
    try {
      // Come per l'export del planner, le librerie vengono caricate solo al momento della stampa
      const [{ toPng }, { PDFDocument }] = await Promise.all([
        import("html-to-image"),
        import("pdf-lib"),
      ]);
      const pdfDoc = await PDFDocument.create();
      const a3Long = 1190.55; // A3 in punti
      const a3Short = 841.89;
      const pageMargin = 24;

      for (const spec of pageSpecs) {
        // Grafo della sola sezione, con tutti i rami espansi
        const pageGraph = buildGraph(spec, new Set(), badgesMap);
        setPrintGraph(pageGraph);
        await waitForNextFrames();
        const viewportEl = flowWrapperRef.current?.querySelector(".react-flow__viewport");
        if (!viewportEl) {
          continue;
        }
        await waitForImages(viewportEl);

        const bounds = computeGraphBounds(pageGraph.nodes);
        // Cattura ad alta risoluzione (fino a 3x, max 8000px per lato) per una stampa nitida
        const scale = Math.min(3, 8000 / bounds.width, 8000 / bounds.height);
        const imageWidth = Math.max(1, Math.round(bounds.width * scale));
        const imageHeight = Math.max(1, Math.round(bounds.height * scale));
        const viewport = getViewportForBounds(bounds, imageWidth, imageHeight, 0.05, 3, 0);
        const dataUrl = await toPng(viewportEl, {
          backgroundColor: "#fdfbf8",
          width: imageWidth,
          height: imageHeight,
          pixelRatio: 1,
          style: {
            width: `${imageWidth}px`,
            height: `${imageHeight}px`,
            transform: `translate(${viewport.x}px, ${viewport.y}px) scale(${viewport.zoom})`,
          },
        });

        const png = await pdfDoc.embedPng(dataUrl);
        // Orientamento della pagina A3 in base alle proporzioni del grafico
        const isPortrait = imageHeight > imageWidth;
        const pageWidth = isPortrait ? a3Short : a3Long;
        const pageHeight = isPortrait ? a3Long : a3Short;
        const page = pdfDoc.addPage([pageWidth, pageHeight]);
        const fitScale = Math.min((pageWidth - pageMargin * 2) / png.width, (pageHeight - pageMargin * 2) / png.height);
        const drawWidth = png.width * fitScale;
        const drawHeight = png.height * fitScale;
        page.drawImage(png, {
          x: (pageWidth - drawWidth) / 2,
          y: (pageHeight - drawHeight) / 2,
          width: drawWidth,
          height: drawHeight,
        });
      }

      const pdfBytes = await pdfDoc.save();
      const blob = new Blob([pdfBytes], { type: "application/pdf" });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `organigramma-${new Date().toISOString().slice(0, 10)}.pdf`;
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (error) {
      setPrintError(error?.message || "Errore durante la generazione del PDF");
    } finally {
      setPrintGraph(null);
      setPrinting(false);
      window.requestAnimationFrame(() => {
        fitView({ padding: 0.22, minZoom: 0.2, maxZoom: 1.2 });
      });
    }
  }

  useEffect(() => {
    if (employeesQuery.isLoading || departmentsQuery.isLoading || functionsQuery.isLoading || graph.nodes.length === 0) {
      return undefined;
    }
    const frameId = window.requestAnimationFrame(() => {
      fitView({ padding: 0.22, duration: 260, minZoom: 0.2, maxZoom: 1.2 });
    });
    return () => window.cancelAnimationFrame(frameId);
  }, [employeesQuery.isLoading, departmentsQuery.isLoading, functionsQuery.isLoading, fitView, graph.nodes.length, graph.edges.length]);

  function handleNodeClick(_event, node) {
    if (!node.data.hasChildren) {
      return;
    }
    setCollapsedIds((current) => {
      const next = new Set(current);
      if (next.has(node.id)) {
        next.delete(node.id);
      } else {
        next.add(node.id);
      }
      return next;
    });
  }

  const loading = employeesQuery.isLoading || departmentsQuery.isLoading || functionsQuery.isLoading;
  const error = employeesQuery.error || departmentsQuery.error || functionsQuery.error;

  return (
    <Stack spacing={3}>
      <PageHeader section="Panoramica relazioni" title="Organigramma" />

      <Paper variant="outlined" sx={{ p: 1.25, borderRadius: 2 }}>

        <Stack direction={{ xs: "column", md: "row" }} spacing={1} sx={{ flexWrap: "wrap" }} useFlexGap>
          <Button
            size="small"
            variant="outlined"
            onClick={() => setCollapsedIds(new Set(collapsibleIds))}
            disabled={!collapsibleIds.length}
          >
            Comprimi tutto
          </Button>
          <Button
            size="small"
            variant="outlined"
            onClick={() => setCollapsedIds(new Set())}
            disabled={collapsedIds.size === 0}
          >
            Espandi tutto{collapsedIds.size > 0 ? ` (${collapsedIds.size})` : ""}
          </Button>
          <Box sx={{ flexGrow: 1 }} />
          <Button
            size="small"
            variant="contained"
            onClick={(event) => setPrintMenuAnchor(event.currentTarget)}
            disabled={loading || printing || printSections.length === 0}
          >
            {printing ? "Generazione PDF…" : "Stampa PDF ▾"}
          </Button>
        </Stack>

        <Menu
          anchorEl={printMenuAnchor}
          open={Boolean(printMenuAnchor)}
          onClose={() => setPrintMenuAnchor(null)}
          anchorOrigin={{ vertical: "bottom", horizontal: "right" }}
          transformOrigin={{ vertical: "top", horizontal: "right" }}
          slotProps={{ paper: { sx: { minWidth: 280, maxHeight: 440 } } }}
        >
          <MenuItem dense onClick={togglePrintAll}>
            <Checkbox
              size="small"
              checked={allPrintSelected}
              indeterminate={!allPrintSelected && anyPrintSelected}
              sx={{ p: 0.5, mr: 1 }}
            />
            <ListItemText primary="Intero organigramma" primaryTypographyProps={{ fontWeight: 700 }} />
          </MenuItem>
          <Divider />
          {printSections.flatMap((section) => {
            const leafIds = printLeafIds(section);
            const selectedLeafCount = leafIds.filter((id) => printSelection.has(id)).length;
            const sectionChecked = selectedLeafCount === leafIds.length;
            return [
              <MenuItem key={section.id} dense onClick={() => togglePrintSection(section)}>
                <Checkbox
                  size="small"
                  checked={sectionChecked}
                  indeterminate={!sectionChecked && selectedLeafCount > 0}
                  sx={{ p: 0.5, mr: 1 }}
                />
                <ListItemText
                  primary={section.label}
                  secondary={`${section.count} risorse`}
                  primaryTypographyProps={{ fontWeight: 600 }}
                />
              </MenuItem>,
              ...section.departments.map((department) => (
                <MenuItem key={department.id} dense onClick={() => togglePrintLeaf(department.id)} sx={{ pl: 4.5 }}>
                  <Checkbox size="small" checked={printSelection.has(department.id)} sx={{ p: 0.5, mr: 1 }} />
                  <ListItemText primary={department.label} secondary={`${department.count} risorse`} />
                </MenuItem>
              )),
            ];
          })}
          <Divider />
          <Box sx={{ px: 2, py: 1 }}>
            <Button
              fullWidth
              variant="contained"
              disabled={selectedPageCount === 0}
              onClick={handleGeneratePdf}
              sx={{ borderRadius: 2, textTransform: "none", fontWeight: 700 }}
            >
              Genera PDF{selectedPageCount > 0 ? ` (${selectedPageCount} ${selectedPageCount === 1 ? "pagina" : "pagine"})` : ""}
            </Button>
          </Box>
        </Menu>

        <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap sx={{ mt: 1.25 }}>
          <Chip size="small" label={`${model.totalEmployees} risorse`} sx={{ bgcolor: "action.hover" }} />
        </Stack>

        <Stack direction="row" spacing={2} flexWrap="wrap" useFlexGap sx={{ mt: 1, color: "text.secondary" }}>
          {COURSE_BADGES.map(({ icon, label }) => (
            <Typography key={label} sx={{ fontSize: 12 }}>{icon} {label}</Typography>
          ))}
          <Typography sx={{ fontSize: 11, opacity: 0.7 }}>· verde valido · arancio in scadenza · rosso scaduto · grigio assente</Typography>
        </Stack>
      </Paper>

      {error && <Alert severity="error">{employeesQuery.error?.message || departmentsQuery.error?.message}</Alert>}
      {printError && <Alert severity="error" onClose={() => setPrintError(null)}>{printError}</Alert>}

      <Paper
        ref={flowWrapperRef}
        sx={{
          height: "calc(100vh - 280px)",
          minHeight: 640,
          overflow: "hidden",
          borderRadius: 6,
          border: "1px solid rgba(226,226,229,0.95)",
          background: "linear-gradient(180deg, #f6f1eb, #fdfbf8)",
          position: "relative",
        }}
        onContextMenu={(event) => event.preventDefault()}
      >
        {loading ? (
          <Box sx={{ position: "absolute", inset: 0, display: "grid", placeItems: "center" }}>
            <CircularProgress />
          </Box>
        ) : (
          <ReactFlow
            nodes={(printGraph ?? graph).nodes}
            edges={(printGraph ?? graph).edges}
            nodeTypes={nodeTypes}
            onNodeClick={handleNodeClick}
            fitView
            minZoom={0.2}
            maxZoom={1.35}
            nodesDraggable={false}
            nodesConnectable={false}
            elementsSelectable={false}
            panOnDrag={[0]}
            proOptions={{ hideAttribution: true }}
          >
            <Background color="#d8cfc3" gap={24} size={1} />
            <Controls showInteractive={false} />
          </ReactFlow>
        )}
        {printing && (
          <Box
            sx={{
              position: "absolute",
              inset: 0,
              zIndex: 10,
              display: "grid",
              placeItems: "center",
              bgcolor: "rgba(246,241,235,0.94)",
            }}
          >
            <Stack alignItems="center" spacing={1.5}>
              <CircularProgress />
              <Typography sx={{ fontWeight: 700, color: "#40506b" }}>Generazione PDF in corso…</Typography>
            </Stack>
          </Box>
        )}
      </Paper>
    </Stack>
  );
}

export default function OrgChartPage() {
  return (
    <ReactFlowProvider>
      <OrgChartCanvas />
    </ReactFlowProvider>
  );
}
