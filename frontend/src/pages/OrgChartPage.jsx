import dagre from "dagre";
import { useQuery } from "@tanstack/react-query";
import { Background, Controls, Handle, MarkerType, Position, ReactFlow, ReactFlowProvider, useReactFlow } from "@xyflow/react";
import { Alert, Avatar, Box, Button, Chip, CircularProgress, Paper, Stack, Typography } from "@mui/material";
import { useEffect, useMemo, useRef, useState } from "react";

import { getEmployeePhoto, getEmployees, getOrgDepartments, getOrgFunctions } from "../api";

const groupNodeWidth = 220;
const functionNodeHeight = 86;
const departmentNodeHeight = 74;
const personNodeWidth = 180;
const personNodeHeight = 126;

const resourceTone = {
  "Responsabile di funzione": { bg: "#007040", soft: "rgba(15, 76, 92, 0.12)", text: "#007040" },
  "Manager": { bg: "#5c3d6e", soft: "rgba(92, 61, 110, 0.12)", text: "#5c3d6e" },
  "Responsabile di dipartimento": { bg: "#5e6c8a", soft: "rgba(94, 108, 138, 0.12)", text: "#3d4f6e" },
  "Responsabile": { bg: "#7a5c61", soft: "rgba(122, 92, 97, 0.12)", text: "#7a5c61" },
  Collaboratore: { bg: "#6b7280", soft: "rgba(107, 114, 128, 0.12)", text: "#4b5563" },
  "Team Leader": { bg: "rgba(212, 160, 23, 0.14)", soft: "rgba(212, 160, 23, 0.14)", text: "#a07808" },
};

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

  for (const employee of sortedEmployees) {
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

  return { functions, totalEmployees: sortedEmployees.length };
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

function PersonNode({ data }) {
  const [photoUrl, setPhotoUrl] = useState(null);
  const displayLabel = (data.isTeamLeader && data.resourceLabel === "Collaboratore") ? "Team Leader" : data.resourceLabel;
  const tone = resourceTone[displayLabel] ?? resourceTone.Collaboratore;

  useEffect(() => {
    if (!data.hasPhoto) {
      setPhotoUrl(null);
      return undefined;
    }

    let active = true;
    let objectUrl = null;
    getEmployeePhoto(data.employeeId)
      .then((blob) => {
        if (!active) {
          return;
        }
        objectUrl = URL.createObjectURL(blob);
        setPhotoUrl(objectUrl);
      })
      .catch(() => {
        if (active) {
          setPhotoUrl(null);
        }
      });

    return () => {
      active = false;
      if (objectUrl) {
        URL.revokeObjectURL(objectUrl);
      }
    };
  }, [data.employeeId, data.hasPhoto]);

  return (
    <Box
      className="nodrag nopan"
      sx={{
        width: personNodeWidth,
        minHeight: personNodeHeight,
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
          bgcolor: tone.soft,
          color: tone.text,
          fontWeight: 700,
          maxWidth: "100%",
          height: "auto",
          "& .MuiChip-label": { whiteSpace: "normal", textAlign: "center", py: 0.375, lineHeight: 1.25 },
        }}
      />
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
};

function buildGraph(model, collapsedIds) {
  const graph = new dagre.graphlib.Graph();
  graph.setGraph({ rankdir: "TB", nodesep: 44, ranksep: 96, marginx: 28, marginy: 28 });
  graph.setDefaultEdgeLabel(() => ({}));

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
        height: personNodeHeight,
        fullName: node.employee.full_name,
        hasPhoto: node.employee.has_photo,
        initials: getInitials(node.employee.full_name || ""),
        color: getRoleColor(node.employee.tms_role_description),
        resourceLabel: node.resourceLabel,
        isTeamLeader: node.employee.is_team_leader ?? false,
        hasChildren: node.sameGroupChildren.length > 0,
        isCollapsed,
        hiddenCount: node.descendantCount,
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
  const RANK_TOLERANCE = 5;
  const rankGroups = [];
  for (const rfNode of nodes) {
    const pos = graph.node(rfNode.id);
    if (!pos) continue;
    const h = rfNode.data.height ?? personNodeHeight;
    let placed = false;
    for (const group of rankGroups) {
      if (Math.abs(group.centerY - pos.y) <= RANK_TOLERANCE) {
        group.members.push({ id: rfNode.id, centerY: pos.y, height: h });
        placed = true;
        break;
      }
    }
    if (!placed) rankGroups.push({ centerY: pos.y, members: [{ id: rfNode.id, centerY: pos.y, height: h }] });
  }
  const topAlignedY = new Map();
  for (const group of rankGroups) {
    if (group.members.length <= 1) continue;
    const minTop = Math.min(...group.members.map((m) => m.centerY - m.height / 2));
    for (const m of group.members) topAlignedY.set(m.id, minTop + m.height / 2);
  }

  return {
    nodes: nodes.map((node) => {
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
    }),
    edges,
  };
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

  const graph = useMemo(() => buildGraph(model, collapsedIds), [model, collapsedIds]);

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
      <Paper
        sx={{
          p: 4,
          color: "white",
          background: "linear-gradient(135deg, rgba(0,112,64,0.96), rgba(0,80,46,0.92))",
        }}
      >
        <Typography variant="overline" sx={{ opacity: 0.82 }}>Panoramica relazioni</Typography>
        <Typography variant="h4">Organigramma</Typography>


        <Stack direction={{ xs: "column", md: "row" }} spacing={1.25} sx={{ mt: 2.25, flexWrap: "wrap" }}>
          <Button
            variant="contained"
            onClick={() => setCollapsedIds(new Set(collapsibleIds))}
            disabled={!collapsibleIds.length}
            sx={{
              borderRadius: 2,
              textTransform: "none",
              fontWeight: 700,
              bgcolor: "rgba(255,255,255,0.14)",
              color: "white",
              boxShadow: "none",
              "&:hover": { bgcolor: "rgba(255,255,255,0.22)", boxShadow: "none" },
            }}
          >
            Comprimi tutto
          </Button>
          <Button
            variant="outlined"
            onClick={() => setCollapsedIds(new Set())}
            disabled={collapsedIds.size === 0}
            sx={{
              borderRadius: 2,
              textTransform: "none",
              fontWeight: 700,
              color: "white",
              borderColor: "rgba(255,255,255,0.45)",
              "&:hover": { borderColor: "rgba(255,255,255,0.7)", bgcolor: "rgba(255,255,255,0.08)" },
              "&.Mui-disabled": { color: "rgba(255,255,255,0.4)", borderColor: "rgba(255,255,255,0.16)" },
            }}
          >
            Espandi tutto{collapsedIds.size > 0 ? ` (${collapsedIds.size})` : ""}
          </Button>
        </Stack>

        <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap sx={{ mt: 2.25 }}>
          <Chip size="small" label={`${model.totalEmployees} risorse`} sx={{ bgcolor: "rgba(255,255,255,0.16)", color: "white" }} />
        </Stack>
      </Paper>

      {error && <Alert severity="error">{employeesQuery.error?.message || departmentsQuery.error?.message}</Alert>}

      <Paper
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
            nodes={graph.nodes}
            edges={graph.edges}
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
