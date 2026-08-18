import { useState } from "react";
import { Box, Chip, Collapse, Divider, Stack, Tooltip, Typography } from "@mui/material";

function Badge({ method }) {
  const colors = {
    GET: { bg: "#e8f5e9", text: "#2e7d32" },
    POST: { bg: "#e3f2fd", text: "#1565c0" },
  };
  const { bg, text } = colors[method] ?? { bg: "#f5f5f5", text: "#616161" };
  return (
    <Box sx={{ px: 1, py: 0.25, borderRadius: "6px", bgcolor: bg, color: text, fontWeight: 700, fontSize: 12, fontFamily: "monospace", flexShrink: 0 }}>
      {method}
    </Box>
  );
}

function CodeBlock({ children }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = () => {
    navigator.clipboard.writeText(children.trim());
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  return (
    <Box sx={{ position: "relative", my: 1 }}>
      <Box
        component="pre"
        sx={{
          m: 0,
          p: 2,
          pr: 6,
          borderRadius: "10px",
          bgcolor: "var(--color-code-bg, #1e1e2e)",
          color: "var(--color-code-text, #cdd6f4)",
          fontSize: 13,
          fontFamily: "monospace",
          overflowX: "auto",
          whiteSpace: "pre-wrap",
          wordBreak: "break-all",
        }}
      >
        {children.trim()}
      </Box>
      <Tooltip title={copied ? "Copiato!" : "Copia"} placement="top">
        <Box
          component="button"
          onClick={handleCopy}
          sx={{
            position: "absolute",
            top: 8,
            right: 8,
            background: "none",
            border: "none",
            cursor: "pointer",
            color: copied ? "#a6e3a1" : "#6c7086",
            fontSize: 16,
            lineHeight: 1,
            p: 0.5,
            borderRadius: "6px",
            "&:hover": { color: "#cdd6f4" },
          }}
        >
          {copied ? "✓" : "⧉"}
        </Box>
      </Tooltip>
    </Box>
  );
}

function StatusRow({ code, description }) {
  const color = code < 300 ? "#2e7d32" : code < 500 ? "#e65100" : "#c62828";
  return (
    <Stack direction="row" spacing={1.5} alignItems="center">
      <Box sx={{ fontFamily: "monospace", fontWeight: 700, fontSize: 13, color, minWidth: 36 }}>{code}</Box>
      <Typography fontSize={13} color="text.secondary">{description}</Typography>
    </Stack>
  );
}

function EndpointCard({ method, path, description, headers, requestBody, response, errors }) {
  const [open, setOpen] = useState(false);

  return (
    <Box
      sx={{
        borderRadius: "14px",
        border: "1px solid",
        borderColor: "divider",
        overflow: "hidden",
        mb: 3,
      }}
    >
      <Box
        component="button"
        onClick={() => setOpen((current) => !current)}
        sx={{
          width: "100%",
          textAlign: "left",
          px: 2.5,
          py: 2,
          bgcolor: "background.paper",
          border: "none",
          cursor: "pointer",
          display: "block",
        }}
      >
        <Stack direction="row" alignItems="flex-start" justifyContent="space-between" spacing={2}>
          <Box sx={{ minWidth: 0 }}>
            <Stack direction="row" alignItems="center" spacing={1.5} sx={{ mb: 0.75 }}>
              <Badge method={method} />
              <Typography sx={{ fontFamily: "monospace", fontWeight: 600, fontSize: 15, wordBreak: "break-all" }}>{path}</Typography>
            </Stack>
            <Typography fontSize={14} color="text.secondary">{description}</Typography>
          </Box>
          <Box
            sx={{
              fontSize: 18,
              lineHeight: 1,
              color: "text.secondary",
              transform: open ? "rotate(180deg)" : "rotate(0deg)",
              transition: "transform 0.18s ease",
              flexShrink: 0,
              mt: 0.25,
            }}
          >
            ˅
          </Box>
        </Stack>
      </Box>

      <Collapse in={open}>
        <Divider />

        <Box sx={{ px: 2.5, py: 2, bgcolor: "background.default" }}>
          {headers && (
            <Box sx={{ mb: 2.5 }}>
              <Typography fontSize={12} fontWeight={700} color="text.secondary" sx={{ textTransform: "uppercase", letterSpacing: "0.06em", mb: 1 }}>
                Headers richiesti
              </Typography>
              <Stack spacing={0.75}>
                {headers.map(({ key, value, note }) => (
                  <Stack key={key} direction="row" spacing={1} alignItems="flex-start" flexWrap="wrap">
                    <Typography sx={{ fontFamily: "monospace", fontSize: 13, fontWeight: 600, color: "primary.main", flexShrink: 0 }}>{key}</Typography>
                    <Typography sx={{ fontFamily: "monospace", fontSize: 13, color: "text.secondary", flexShrink: 0 }}>{value}</Typography>
                    {note && <Typography fontSize={12} color="text.disabled" sx={{ alignSelf: "center" }}>— {note}</Typography>}
                  </Stack>
                ))}
              </Stack>
            </Box>
          )}

          {requestBody && (
            <Box sx={{ mb: 2.5 }}>
              <Typography fontSize={12} fontWeight={700} color="text.secondary" sx={{ textTransform: "uppercase", letterSpacing: "0.06em", mb: 0.5 }}>
                Request body
              </Typography>
              <CodeBlock>{requestBody}</CodeBlock>
            </Box>
          )}

          <Box sx={{ mb: 2.5 }}>
            <Stack direction="row" spacing={1} alignItems="center" sx={{ mb: 0.5 }}>
              <Typography fontSize={12} fontWeight={700} color="text.secondary" sx={{ textTransform: "uppercase", letterSpacing: "0.06em" }}>
                Response
              </Typography>
              <Chip label="200 OK" size="small" sx={{ height: 18, fontSize: 11, bgcolor: "#e8f5e9", color: "#2e7d32", fontWeight: 700 }} />
            </Stack>
            <CodeBlock>{response}</CodeBlock>
          </Box>

          {errors && (
            <Box>
              <Typography fontSize={12} fontWeight={700} color="text.secondary" sx={{ textTransform: "uppercase", letterSpacing: "0.06em", mb: 1 }}>
                Errori
              </Typography>
              <Stack spacing={0.5}>
                {errors.map(({ code, description: desc }) => (
                  <StatusRow key={code} code={code} description={desc} />
                ))}
              </Stack>
            </Box>
          )}
        </Box>
      </Collapse>
    </Box>
  );
}

const LOGIN_HEADERS = [
  { key: "Content-Type", value: "application/json" },
];

const BEARER_HEADERS = [
  { key: "Authorization", value: "Bearer <access_token>", note: "token JWT ottenuto dal login locale" },
];

const LOGIN_RESPONSE = `{
  "access_token": "<jwt-token>",
  "token_type": "bearer",
  "expires_in": 28800,
  "authenticated": true,
  "employee": {
    "id": "152c7e89-...",
    "tms_id": "153",
    "full_name": "ROSSI MARIO",
    "first_name": "MARIO",
    "last_name": "ROSSI",
    "phone": "33xxxxxxxx",
    "tms_role_code": "05",
    "tms_role_description": "PULIZIE",
    "contract_type": "...",
    "datore_lavoro": "SERVIZI TONOLI SCRL",
    "organization_function": "Operations",
    "organization_department": "Pulizie",
    "organization_role": null,
    "manager_name": "BIANCHI GIULIO",
    "birth_date": "1984-07-07",
    "is_active": true,
    "default_operational_area_id": "3d59fb8b-...",
    "default_operational_area_name": "Sede",
    "default_immobile": "F2"
  },
  "team": {
    "id": "143ec479-...",
    "name": "Team Pulizie",
    "icon": "🎋",
    "color": "#6d3bf7",
    "team_leader_id": null,
    "team_leader_name": null,
    "members": [
      { "id": "...", "tms_id": "153", "full_name": "ROSSI MARIO" },
      { "id": "...", "tms_id": "115", "full_name": "VERDI ANNA" }
    ]
  }
}`;

const EMPLOYEES_RESPONSE = `[
  { "tms_id": "115", "full_name": "BIANCHI ANNA" },
  { "tms_id": "153", "full_name": "ROSSI MARIO" }
]`;

const INFINITY_CROSS_MAPPINGS_RESPONSE = `{
  "authenticated": true,
  "employee": {
    "id": "152c7e89-...",
    "tms_id": "30",
    "full_name": "ROSSI MARIO",
    "first_name": "MARIO",
    "last_name": "ROSSI",
    "phone": "33xxxxxxxx",
    "tms_role_code": "05",
    "tms_role_description": "PULIZIE",
    "contract_type": "...",
    "datore_lavoro": "SERVIZI TONOLI SCRL",
    "organization_function": "Operations",
    "organization_department": "Pulizie",
    "organization_role": null,
    "manager_name": "BIANCHI GIULIO",
    "birth_date": "1984-07-07",
    "is_active": true,
    "default_operational_area_id": "3d59fb8b-...",
    "default_operational_area_name": "Sede",
    "default_immobile": "F2"
  },
  "default_operational_area": {
    "id": "3d59fb8b-...",
    "area_code": "SEDE",
    "name": "Sede",
    "buildings": ["F1", "F2", "F3"],
    "is_default": true
  },
  "operational_areas": [
    {
      "id": "3d59fb8b-...",
      "area_code": "SEDE",
      "name": "Sede",
      "buildings": ["F1", "F2", "F3"],
      "is_default": true
    },
    {
      "id": "6b9c7c42-...",
      "area_code": "KI",
      "name": "Kimberly",
      "buildings": ["K1", "K2"],
      "is_default": false
    }
  ],
  "mappings": [
    {
      "id": "b3b6a930-...",
      "infinity_billing_item_id": "a12f...",
      "infinity_billing_item_name": "PICKING",
      "customer_supplier_code": "CLI001",
      "customer_supplier_description": "Cliente Demo",
      "jupiter_description": "Picking cliente demo",
      "operational_area_id": "3d59fb8b-...",
      "operational_area_code": "SEDE",
      "operational_area_name": "Sede",
      "buildings": ["F2"],
      "is_active": true,
      "field_assignments": [
        {
          "id": "f1a2b3c4-...",
          "map_id": "b3b6a930-...",
          "field_definition_id": "d9e8f7a6-...",
          "field_key": "numero_ddt",
          "field_label": "Numero DDT",
          "field_type": "text",
          "options": [],
          "is_required": true,
          "sort_order": 0
        },
        {
          "id": "a5b6c7d8-...",
          "map_id": "b3b6a930-...",
          "field_definition_id": "e1f2a3b4-...",
          "field_key": "targa_mezzo",
          "field_label": "Targa mezzo",
          "field_type": "text",
          "options": [],
          "is_required": false,
          "sort_order": 1
        },
        {
          "id": "b6c7d8e9-...",
          "map_id": "b3b6a930-...",
          "field_definition_id": "f2a3b4c5-...",
          "field_key": "numero_lista",
          "field_label": "Numero lista",
          "field_type": "mssql_list",
          "options": [],
          "config": {
            "source": "liste_aperte",
            "key_column": "sot_numlista",
            "columns": [
              { "name": "sot_numlista", "label": "Numero lista", "visible": true },
              { "name": "num_ordini", "label": "N. ordini", "visible": true },
              { "name": "num_righe", "label": "N. righe", "visible": true },
              { "name": "cod_cliente", "label": "Cliente", "visible": false },
              { "name": "cod_vettore", "label": "Vettore", "visible": false }
            ]
          },
          "is_required": true,
          "sort_order": 2
        }
      ]
    },
    {
      "id": "c4d5e6f7-...",
      "infinity_billing_item_id": "b23g...",
      "infinity_billing_item_name": "SCARICO CAMION",
      "customer_supplier_code": "CLI002",
      "customer_supplier_description": "Fornitore Logistica",
      "jupiter_description": null,
      "operational_area_id": "6b9c7c42-...",
      "operational_area_code": "KI",
      "operational_area_name": "Kimberly",
      "buildings": [],
      "is_active": true,
      "field_assignments": []
    }
  ]
}`;

const FIELD_VALUES_RESPONSE = `{
  "source": "liste_aperte",
  "key_column": "sot_numlista",
  "columns": [
    { "name": "sot_numlista", "label": "Numero lista", "visible": true },
    { "name": "num_ordini", "label": "N. ordini", "visible": true },
    { "name": "num_righe", "label": "N. righe", "visible": true },
    { "name": "cod_cliente", "label": "Cliente", "visible": false },
    { "name": "cod_vettore", "label": "Vettore", "visible": false }
  ],
  "rows": [
    { "sot_numlista": "L00123", "num_ordini": "1", "num_righe": "8", "cod_cliente": "CLI002", "cod_vettore": "VET01" },
    { "sot_numlista": "L00124", "num_ordini": "3", "num_righe": "21", "cod_cliente": "(vari)", "cod_vettore": "VET02" }
  ]
}`;

const MY_INFO_RESPONSE = `{
  "employee": {
    "id": "152c7e89-...",
    "tms_id": "153",
    "full_name": "ROSSI MARIO",
    "first_name": "MARIO",
    "last_name": "ROSSI",
    "phone": "33xxxxxxxx",
    "tms_role_code": "05",
    "tms_role_description": "PULIZIE",
    "contract_type": "...",
    "datore_lavoro": "SERVIZI TONOLI SCRL",
    "organization_function": "Operations",
    "organization_department": "Pulizie",
    "organization_role": null,
    "manager_name": "BIANCHI GIULIO",
    "birth_date": "1984-07-07",
    "is_active": true,
    "default_operational_area_id": "3d59fb8b-...",
    "default_operational_area_name": "Sede",
    "default_immobile": "F2"
  },
  "date": "2026-07-01",
  "today_assignments": [
    { "area": "Kimberly", "site": "Fossano", "immobile": "F2", "start_time": "08:00", "end_time": "17:00" }
  ],
  "upcoming_absences": [
    {
      "id": "9c1e4b7a-...",
      "justification_type": "FERIE",
      "start_date": "2026-07-10",
      "end_date": "2026-07-12",
      "approval_status": "approved",
      "start_time": null,
      "end_time": null
    }
  ],
  "pending_count": 0
}`;

const ABSENCE_REQUEST_REQUEST = `{
  "description": "Ferie estive",
  "start_date": "2026-08-10",
  "end_date": "2026-08-14",
  "start_time": "08:00",
  "end_time": "17:00"
}`;

const ABSENCE_REQUEST_RESPONSE = `{
  "id": "a1b2c3d4-...",
  "employee_id": "152c7e89-...",
  "justification_type": "FERIE",
  "description": "Ferie estive",
  "start_date": "2026-08-10",
  "end_date": "2026-08-14",
  "start_time": "08:00:00",
  "end_time": "17:00:00",
  "approval_status": "pending",
  "approval_required": true,
  "approver_1_employee_name": "BIANCHI GIULIO",
  "approver_2_employee_name": null,
  "approver_3_employee_name": null,
  "created_at": "2026-07-01T09:00:00Z",
  "updated_at": "2026-07-01T09:00:00Z"
}`;

const ABSENCE_REQUEST_UPDATE_REQUEST = `{
  "description": "Ferie estive (posticipate)",
  "start_date": "2026-08-17",
  "end_date": "2026-08-21"
}`;

const ABSENCE_REQUEST_LIST_RESPONSE = `[
  {
    "id": "a1b2c3d4-...",
    "employee_id": "152c7e89-...",
    "justification_type": "FERIE",
    "description": "Ferie estive",
    "start_date": "2026-08-10",
    "end_date": "2026-08-14",
    "start_time": "08:00:00",
    "end_time": "17:00:00",
    "approval_status": "pending",
    "approval_required": true,
    "approver_1_employee_name": "BIANCHI GIULIO",
    "approver_2_employee_name": null,
    "approver_3_employee_name": null,
    "created_at": "2026-07-01T09:00:00Z",
    "updated_at": "2026-07-01T09:00:00Z"
  }
]`;

const PYTHON_EXAMPLE = `import json, requests

BASE_URL = "http://<server>:8088/api/auth/local-user"

login_res = requests.post(
    f"{BASE_URL}/login",
    json={"username": "153", "password": "LaPassword"},
    timeout=30,
)
login_res.raise_for_status()
login_payload = login_res.json()
token = login_payload["access_token"]

employees_res = requests.get(
    f"{BASE_URL}/employees",
    headers={"Authorization": f"Bearer {token}"},
    timeout=30,
)
employees_res.raise_for_status()
print(json.dumps(employees_res.json(), indent=2, ensure_ascii=False))`;

const JS_EXAMPLE = `const BASE_URL = "http://<server>:8088/api/auth/local-user";

const loginRes = await fetch(\`\${BASE_URL}/login\`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ username: "153", password: "LaPassword" }),
});
const loginPayload = await loginRes.json();
const token = loginPayload.access_token;

const employeesRes = await fetch(\`\${BASE_URL}/employees\`, {
  headers: { Authorization: \`Bearer \${token}\` },
});
console.log(await employeesRes.json());`;

const CURL_EXAMPLE = `LOGIN_RESPONSE=$(curl -s -X POST http://<server>:8088/api/auth/local-user/login \\
  -H "Content-Type: application/json" \\
  -d '{"username":"153","password":"LaPassword"}')

TOKEN=$(echo "$LOGIN_RESPONSE" | python3 -c 'import sys, json; print(json.load(sys.stdin)["access_token"])')

curl -s http://<server>:8088/api/auth/local-user/employees \\
  -H "Authorization: Bearer $TOKEN" | python3 -m json.tool`;

const PHP_EXAMPLE = `<?php
$baseUrl = 'http://<server>:8088/api/auth/local-user';

$loginPayload = json_encode([
    'username' => '153',
    'password' => 'LaPassword',
]);

$ch = curl_init($baseUrl . '/login');
curl_setopt_array($ch, [
    CURLOPT_POST => true,
    CURLOPT_RETURNTRANSFER => true,
    CURLOPT_HTTPHEADER => ['Content-Type: application/json'],
    CURLOPT_POSTFIELDS => $loginPayload,
    CURLOPT_TIMEOUT => 30,
]);
$loginResponse = curl_exec($ch);
if ($loginResponse === false) {
    throw new RuntimeException(curl_error($ch));
}
$loginStatus = curl_getinfo($ch, CURLINFO_RESPONSE_CODE);
curl_close($ch);

if ($loginStatus >= 400) {
    throw new RuntimeException($loginResponse);
}

$token = json_decode($loginResponse, true, 512, JSON_THROW_ON_ERROR)['access_token'];

$ch = curl_init($baseUrl . '/employees');
curl_setopt_array($ch, [
    CURLOPT_RETURNTRANSFER => true,
    CURLOPT_HTTPHEADER => ['Authorization: Bearer ' . $token],
    CURLOPT_TIMEOUT => 30,
]);
$employeesResponse = curl_exec($ch);
if ($employeesResponse === false) {
    throw new RuntimeException(curl_error($ch));
}
$employeesStatus = curl_getinfo($ch, CURLINFO_RESPONSE_CODE);
curl_close($ch);

if ($employeesStatus >= 400) {
    throw new RuntimeException($employeesResponse);
}

echo json_encode(json_decode($employeesResponse, true, 512, JSON_THROW_ON_ERROR), JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE);
?>`;

const ACTIVITY_RECORD_REQUEST = `{
  "employee_id": "152c7e89-...",
  "mapping_id": "b3b6a930-...",
  "operational_area_id": "3d59fb8b-...",
  "building": "F2",
  "started_at": "2025-06-30T08:00:00+02:00",
  "ended_at": "2025-06-30T10:30:00+02:00",
  "duration_seconds": 9000,
  "field_values": {
    "numero_ddt": "DDT-2025-0042",
    "targa_mezzo": "AB123CD"
  }
}`;

const ACTIVITY_RECORD_RESPONSE = `{
  "id": "e7f8a9b0-...",
  "employee_id": "152c7e89-...",
  "mapping_id": "b3b6a930-...",
  "operational_area_id": "3d59fb8b-...",
  "building": "F2",
  "started_at": "2025-06-30T06:00:00Z",
  "ended_at": "2025-06-30T08:30:00Z",
  "duration_seconds": 9000,
  "field_values": {
    "numero_ddt": "DDT-2025-0042",
    "targa_mezzo": "AB123CD"
  },
  "created_at": "2025-06-30T09:15:00Z"
}`;

const ACTIVITY_BULK_REQUEST = `{
  "records": [
    {
      "employee_id": "152c7e89-...",
      "mapping_id": "b3b6a930-...",
      "operational_area_id": "3d59fb8b-...",
      "building": "F2",
      "started_at": "2025-06-30T08:00:00+02:00",
      "ended_at": "2025-06-30T10:30:00+02:00",
      "duration_seconds": 9000,
      "field_values": { "numero_ddt": "DDT-2025-0042" }
    },
    {
      "employee_id": "152c7e89-...",
      "mapping_id": "c4d5e6f7-...",
      "operational_area_id": null,
      "building": null,
      "started_at": "2025-06-30T11:00:00+02:00",
      "ended_at": "2025-06-30T12:00:00+02:00",
      "duration_seconds": 3600,
      "field_values": {}
    }
  ]
}`;

const ACTIVITY_BULK_RESPONSE = `{
  "created": 2,
  "duplicates": 0,
  "errors": []
}`;

const ACTIVE_START_REQUEST = `{
  "mapping_id": "b3b6a930-...",
  "operational_area_id": "3d59fb8b-...",
  "building": "F2",
  "field_values": {},
  "client_token": "6f2b7a10-9c1e-4b7a-9b1a-1c2d3e4f5a6b"
}`;

const LAST_LOCATION_RESPONSE = `{
  "operational_area_id": "3d59fb8b-...",
  "operational_area_name": "Magazzino Nichelino",
  "building": "F2",
  "worked_at": "2026-07-17T08:30:00Z"
}`;

const ACTIVE_STATE_RESPONSE = `{
  "id": "a1b2c3d4-...",
  "employee_id": "152c7e89-...",
  "mapping_id": "b3b6a930-...",
  "operational_area_id": "3d59fb8b-...",
  "operational_area_name": "Magazzino Nichelino",
  "building": "F2",
  "started_at": "2026-06-30T08:00:00Z",
  "paused_at": null,
  "pause_seconds": 0,
  "elapsed_seconds": 720,
  "status": "running",
  "field_values": {},
  "client_token": "6f2b7a10-9c1e-4b7a-9b1a-1c2d3e4f5a6b",
  "last_heartbeat_at": "2026-06-30T08:12:00Z",
  "created_at": "2026-06-30T08:00:00Z"
}`;

const ACTIVE_LIST_RESPONSE = `[
  {
    "id": "a1b2c3d4-...",
    "employee_id": "152c7e89-...",
    "mapping_id": "b3b6a930-...",
    "operational_area_id": "3d59fb8b-...",
    "operational_area_name": "Magazzino Nichelino",
    "building": "F2",
    "started_at": "2026-06-30T08:00:00Z",
    "paused_at": null,
    "pause_seconds": 0,
    "elapsed_seconds": 720,
    "status": "running",
    "field_values": {},
    "client_token": "6f2b7a10-...",
    "last_heartbeat_at": "2026-06-30T08:12:00Z",
    "created_at": "2026-06-30T08:00:00Z"
  },
  {
    "id": "e5f6a7b8-...",
    "employee_id": "152c7e89-...",
    "mapping_id": "c4d7e841-...",
    "operational_area_id": "3d59fb8b-...",
    "operational_area_name": "Magazzino Nichelino",
    "building": "F2",
    "started_at": "2026-06-30T08:05:00Z",
    "paused_at": "2026-06-30T08:10:00Z",
    "pause_seconds": 0,
    "elapsed_seconds": 300,
    "status": "paused",
    "field_values": {},
    "client_token": "7a3c8b21-...",
    "last_heartbeat_at": "2026-06-30T08:10:00Z",
    "created_at": "2026-06-30T08:05:00Z"
  }
]`;

const ACTIVE_UPDATE_REQUEST = `{
  "field_values": { "numero_ddt": "DDT-2025-0042" }
}`;

const ACTIVE_CLOSE_REQUEST = `{
  "field_values": { "numero_ddt": "DDT-2025-0042" }
}`;

const DAILY_RECORD_REQUEST = `{
  "employee_id": "152c7e89-...",
  "operational_area_id": "3d59fb8b-...",
  "building": "F2",
  "date": "2026-06-30",
  "started_at": "2026-06-30T08:00:00+02:00",
  "ended_at": "2026-06-30T17:00:00+02:00",
  "pauses": [
    {
      "started_at": "2026-06-30T12:00:00+02:00",
      "ended_at": "2026-06-30T12:30:00+02:00"
    }
  ],
  "work_seconds": 30600,
  "pause_seconds": 1800
}`;

const DAILY_RECORD_RESPONSE = `{
  "id": "9ad4d488-...",
  "date": "2026-06-30"
}`;

const DAILY_RECORD_GET_RESPONSE = `{
  "id": "9ad4d488-...",
  "employee_id": "152c7e89-...",
  "employee_name": "ROSSI MARIO",
  "operational_area_id": "3d59fb8b-...",
  "operational_area_name": "Kimberly",
  "building": "F2",
  "date": "2026-06-30",
  "started_at": "2026-06-30T08:00:00+02:00",
  "ended_at": "2026-06-30T17:00:00+02:00",
  "pauses": [
    {
      "started_at": "2026-06-30T12:00:00+02:00",
      "ended_at": "2026-06-30T12:30:00+02:00"
    }
  ],
  "work_seconds": 30600,
  "pause_seconds": 1800,
  "created_at": "2026-06-30T17:05:00Z"
}`;

const PYTHON_INFINITY_CROSS_EXAMPLE = `import json, requests

BASE_URL = "http://<server>:8088/api/auth/local-user"

login_res = requests.post(
    f"{BASE_URL}/login",
    json={"username": "30", "password": "LaPassword"},
    timeout=30,
)
login_res.raise_for_status()
token = login_res.json()["access_token"]

cross_res = requests.get(
    f"{BASE_URL}/infinity-cross-mappings",
    headers={"Authorization": f"Bearer {token}"},
    timeout=30,
)
cross_res.raise_for_status()
print(json.dumps(cross_res.json(), indent=2, ensure_ascii=False))`;

const JS_INFINITY_CROSS_EXAMPLE = `const BASE_URL = "http://<server>:8088/api/auth/local-user";

const loginRes = await fetch(\`\${BASE_URL}/login\`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ username: "30", password: "LaPassword" }),
});
const token = (await loginRes.json()).access_token;

const crossRes = await fetch(\`\${BASE_URL}/infinity-cross-mappings\`, {
  headers: { Authorization: \`Bearer \${token}\` },
});
console.log(await crossRes.json());`;

const CURL_INFINITY_CROSS_EXAMPLE = `LOGIN_RESPONSE=$(curl -s -X POST http://<server>:8088/api/auth/local-user/login \\
  -H "Content-Type: application/json" \\
  -d '{"username":"30","password":"LaPassword"}')

TOKEN=$(echo "$LOGIN_RESPONSE" | python3 -c 'import sys, json; print(json.load(sys.stdin)["access_token"])')

curl -s http://<server>:8088/api/auth/local-user/infinity-cross-mappings \\
  -H "Authorization: Bearer $TOKEN" | python3 -m json.tool`;

const PHP_INFINITY_CROSS_EXAMPLE = `<?php
$baseUrl = 'http://<server>:8088/api/auth/local-user';

$loginPayload = json_encode([
    'username' => '30',
    'password' => 'LaPassword',
]);

$ch = curl_init($baseUrl . '/login');
curl_setopt_array($ch, [
    CURLOPT_POST => true,
    CURLOPT_RETURNTRANSFER => true,
    CURLOPT_HTTPHEADER => ['Content-Type: application/json'],
    CURLOPT_POSTFIELDS => $loginPayload,
    CURLOPT_TIMEOUT => 30,
]);
$loginResponse = curl_exec($ch);
if ($loginResponse === false) {
    throw new RuntimeException(curl_error($ch));
}
$loginStatus = curl_getinfo($ch, CURLINFO_RESPONSE_CODE);
curl_close($ch);

if ($loginStatus >= 400) {
    throw new RuntimeException($loginResponse);
}

$token = json_decode($loginResponse, true, 512, JSON_THROW_ON_ERROR)['access_token'];

$ch = curl_init($baseUrl . '/infinity-cross-mappings');
curl_setopt_array($ch, [
    CURLOPT_RETURNTRANSFER => true,
    CURLOPT_HTTPHEADER => ['Authorization: Bearer ' . $token],
    CURLOPT_TIMEOUT => 30,
]);
$crossResponse = curl_exec($ch);
if ($crossResponse === false) {
    throw new RuntimeException(curl_error($ch));
}
$crossStatus = curl_getinfo($ch, CURLINFO_RESPONSE_CODE);
curl_close($ch);

if ($crossStatus >= 400) {
    throw new RuntimeException($crossResponse);
}

echo json_encode(json_decode($crossResponse, true, 512, JSON_THROW_ON_ERROR), JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE);
?>`;

export default function EndpointsPage() {
  const [tab, setTab] = useState("python");
  const [crossTab, setCrossTab] = useState("python");

  const tabs = [
    { id: "python", label: "Python" },
    { id: "js", label: "JavaScript" },
    { id: "php", label: "PHP" },
    { id: "curl", label: "curl" },
  ];

  const examples = { python: PYTHON_EXAMPLE, js: JS_EXAMPLE, php: PHP_EXAMPLE, curl: CURL_EXAMPLE };

  return (
    <Box sx={{ maxWidth: 860, mx: "auto" }}>
      <Box sx={{ mb: 4 }}>
        <Typography variant="h5" fontWeight={700} sx={{ mb: 0.5 }}>
          Endpoint API esterni
        </Typography>
        <Typography color="text.secondary" fontSize={14}>
          Endpoint riservati a client esterni. Il flusso prevede login locale con username/password e successivo uso di JWT Bearer sugli endpoint protetti.
        </Typography>
      </Box>

      <Box sx={{ borderRadius: "14px", border: "1px solid", borderColor: "divider", p: 2.5, mb: 4, bgcolor: "background.paper" }}>
        <Typography fontWeight={700} fontSize={15} sx={{ mb: 1.5 }}>Autenticazione JWT Bearer</Typography>
        <Typography fontSize={14} color="text.secondary" sx={{ mb: 2 }}>
          1. Il client chiama <Box component="code" sx={{ fontFamily: "monospace", fontSize: 13, bgcolor: "action.hover", px: 0.75, py: 0.25, borderRadius: "6px" }}>/api/auth/local-user/login</Box> con username e password.
          2. Il backend restituisce un <Box component="code" sx={{ fontFamily: "monospace", fontSize: 13, bgcolor: "action.hover", px: 0.75, py: 0.25, borderRadius: "6px" }}>access_token</Box> JWT.
          3. Le chiamate successive usano l&apos;header <Box component="code" sx={{ fontFamily: "monospace", fontSize: 13, bgcolor: "action.hover", px: 0.75, py: 0.25, borderRadius: "6px" }}>Authorization: Bearer &lt;token&gt;</Box>.
        </Typography>
        <Stack spacing={1}>
          {BEARER_HEADERS.map(({ key, value, note }) => (
            <Stack key={key} direction="row" spacing={1} alignItems="flex-start" flexWrap="wrap">
              <Typography sx={{ fontFamily: "monospace", fontSize: 13, fontWeight: 600, color: "primary.main", flexShrink: 0 }}>{key}</Typography>
              <Typography sx={{ fontFamily: "monospace", fontSize: 13, color: "text.secondary", flexShrink: 0 }}>{value}</Typography>
              {note && <Typography fontSize={12} color="text.disabled" sx={{ alignSelf: "center" }}>— {note}</Typography>}
            </Stack>
          ))}
        </Stack>
      </Box>

      {/* Endpoints */}
      <Typography fontWeight={700} fontSize={15} sx={{ mb: 2 }}>Endpoint disponibili</Typography>

      <EndpointCard
        method="POST"
        path="/api/auth/local-user/login"
        description="Autentica un utente locale e restituisce il JWT Bearer, i dati del dipendente e l'eventuale squadra di appartenenza con tutti i membri."
        headers={LOGIN_HEADERS}
        requestBody={`{\n  "username": "153",\n  "password": "LaPassword"\n}`}
        response={LOGIN_RESPONSE}
        errors={[
          { code: 401, description: "Credenziali errate o utente inattivo" },
          { code: 403, description: "Password scaduta" },
        ]}
      />

      <EndpointCard
        method="GET"
        path="/api/auth/local-user/employees"
        description="Restituisce l'elenco di tutti i dipendenti attivi con matricola e nominativo, ordinati per nome. Richiede Bearer token ottenuto dal login."
        headers={BEARER_HEADERS}
        response={EMPLOYEES_RESPONSE}
        errors={[
          { code: 401, description: "Token mancante o non valido" },
        ]}
      />

      <EndpointCard
        method="GET"
        path="/api/auth/local-user/infinity-cross-mappings"
        description="Restituisce la tabella Incroci attiva, l'area di default del dipendente autenticato e tutte le altre aree operative. Ogni incrocio include field_assignments: i campi extra configurati (es. numero DDT, targa mezzo) con tipo, etichetta e flag obbligatorio. I campi di tipo mssql_list (value list dinamica) espongono anche config: i valori vanno letti a runtime da GET /api/field-definitions/{field_definition_id}/values."
        headers={BEARER_HEADERS}
        response={INFINITY_CROSS_MAPPINGS_RESPONSE}
        errors={[
          { code: 401, description: "Token mancante o non valido" },
        ]}
      />

      <EndpointCard
        method="GET"
        path="/api/field-definitions/{field_definition_id}/values?mapping_id={mapping_id}"
        description="Valori correnti di un campo value list (field_type mssql_list), eseguendo lato server la query MSSQL della sorgente. Il codice cliente NON si passa: è ricavato dall'incrocio indicato da mapping_id. Es. per 'Numero lista' restituisce solo le liste ancora aperte del cliente di quell'incrocio. Salva in field_values il valore di key_column (es. sot_numlista); le altre colonne sono solo dettaglio a video. Le liste chiuse spariscono da qui ma restano nello storico: se un valore salvato non è più in rows, mostralo comunque come testo."
        headers={BEARER_HEADERS}
        response={FIELD_VALUES_RESPONSE}
        errors={[
          { code: 401, description: "Token mancante o non valido" },
          { code: 404, description: "Campo o incrocio non trovato, o campo non assegnato a quell'incrocio" },
          { code: 422, description: "Il campo non è una value list, o mapping_id mancante" },
          { code: 503, description: "Sorgente MSSQL non raggiungibile o non configurata" },
        ]}
      />

      <EndpointCard
        method="GET"
        path="/api/auth/local-user/me?date=YYYY-MM-DD"
        description="Info di base del dipendente autenticato: anagrafica, pianificazione del giorno richiesto e assenze in corso/future. Equivalente esterno del box 'Le mie info' della home del portale THub. Il parametro date è opzionale (default: oggi). Nota: i campi default_operational_area_id, default_operational_area_name e default_immobile (sede di riferimento) sono deprecati — l'area/immobile si sceglie a ogni avvio attività (vedi GET /api/activity-records/last-location); restano nella risposta solo per retrocompatibilità."
        headers={BEARER_HEADERS}
        response={MY_INFO_RESPONSE}
        errors={[
          { code: 401, description: "Token mancante o non valido" },
        ]}
      />

      <Box sx={{ mt: 1, mb: 2 }}>
        <Typography fontWeight={700} fontSize={15} sx={{ mb: 0.5 }}>Richiesta ferie</Typography>
        <Typography fontSize={13} color="text.secondary">
          Vista semplificata dello stesso sistema di assenze del portale (box &quot;Assenze&quot;): il dipendente gestisce <strong>solo le proprie</strong> ferie.
          Il tipo è sempre <Box component="code" sx={{ fontFamily: "monospace", fontSize: 12, bgcolor: "action.hover", px: 0.5, borderRadius: "4px" }}>FERIE</Box>;
          la distinzione tra &quot;Giorno&quot; (orario custom, <Box component="code" sx={{ fontFamily: "monospace", fontSize: 12, bgcolor: "action.hover", px: 0.5, borderRadius: "4px" }}>start_date == end_date</Box>) e &quot;Giorni&quot;
          (intervallo di giorni interi, tipicamente <Box component="code" sx={{ fontFamily: "monospace", fontSize: 12, bgcolor: "action.hover", px: 0.5, borderRadius: "4px" }}>08:00–17:00</Box>) va gestita lato client, come nel portale.
          Una volta <Box component="code" sx={{ fontFamily: "monospace", fontSize: 12, bgcolor: "action.hover", px: 0.5, borderRadius: "4px" }}>approved</Box> o <Box component="code" sx={{ fontFamily: "monospace", fontSize: 12, bgcolor: "action.hover", px: 0.5, borderRadius: "4px" }}>rejected</Box>, la richiesta non è più modificabile né cancellabile.
        </Typography>
      </Box>

      <EndpointCard
        method="POST"
        path="/api/absence-requests"
        description="Crea una richiesta ferie per il dipendente autenticato. Se absence_requires_approval è attivo nasce 'pending' e notifica gli approvatori configurati; altrimenti nasce già 'approved'."
        headers={BEARER_HEADERS}
        requestBody={ABSENCE_REQUEST_REQUEST}
        response={ABSENCE_REQUEST_RESPONSE}
        errors={[
          { code: 401, description: "Token mancante o non valido" },
          { code: 409, description: "Sovrapposizione con un'altra assenza esistente" },
          { code: 422, description: "Payload non valido (es. end_date precedente a start_date)" },
        ]}
      />

      <EndpointCard
        method="GET"
        path="/api/absence-requests?start=YYYY-MM-DD&end=YYYY-MM-DD"
        description="Elenco delle proprie richieste ferie, passate/in corso/future. I filtri start/end sono opzionali."
        headers={BEARER_HEADERS}
        response={ABSENCE_REQUEST_LIST_RESPONSE}
        errors={[
          { code: 401, description: "Token mancante o non valido" },
        ]}
      />

      <EndpointCard
        method="PUT"
        path="/api/absence-requests/{id}"
        description="Modifica una propria richiesta ferie ancora in stato 'pending' (tutti i campi opzionali, merge parziale). Rifiutata con 409 se la richiesta è già stata approvata o rifiutata."
        headers={BEARER_HEADERS}
        requestBody={ABSENCE_REQUEST_UPDATE_REQUEST}
        response={ABSENCE_REQUEST_RESPONSE}
        errors={[
          { code: 401, description: "Token mancante o non valido" },
          { code: 404, description: "Richiesta non trovata o non appartenente al dipendente autenticato" },
          { code: 409, description: "Richiesta già approvata/rifiutata, oppure sovrapposizione con un'altra assenza" },
          { code: 422, description: "Payload non valido" },
        ]}
      />

      <EndpointCard
        method="DELETE"
        path="/api/absence-requests/{id}"
        description="Cancella una propria richiesta ferie ancora in stato 'pending'. Rifiutata con 409 se già approvata o rifiutata."
        headers={BEARER_HEADERS}
        response={`{}`}
        errors={[
          { code: 401, description: "Token mancante o non valido" },
          { code: 404, description: "Richiesta non trovata o non appartenente al dipendente autenticato" },
          { code: 409, description: "Richiesta già approvata/rifiutata" },
        ]}
      />

      <EndpointCard
        method="POST"
        path="/api/activity-records"
        description="Registra una singola attività svolta dal dipendente autenticato. Se il record esiste già (stessa matricola + incrocio + started_at) viene restituito 409 — usare il bulk endpoint per retry offline."
        headers={BEARER_HEADERS}
        requestBody={ACTIVITY_RECORD_REQUEST}
        response={ACTIVITY_RECORD_RESPONSE}
        errors={[
          { code: 401, description: "Token mancante o non valido" },
          { code: 409, description: "Record duplicato (stessa matricola, incrocio e orario di inizio)" },
          { code: 422, description: "Payload non valido (es. duration_seconds < 1)" },
        ]}
      />

      <EndpointCard
        method="POST"
        path="/api/activity-records/bulk"
        description="Inserisce fino a 500 record in una sola chiamata. I duplicati vengono silenziosamente ignorati: ideale per il flush di attività accumulate offline. La risposta riporta quanti record sono stati creati e quanti erano già presenti."
        headers={BEARER_HEADERS}
        requestBody={ACTIVITY_BULK_REQUEST}
        response={ACTIVITY_BULK_RESPONSE}
        errors={[
          { code: 401, description: "Token mancante o non valido" },
          { code: 422, description: "records vuoto o supera 500 elementi" },
        ]}
      />

      <Box sx={{ mt: 1, mb: 2 }}>
        <Typography fontWeight={700} fontSize={15} sx={{ mb: 0.5 }}>Timer attività realtime (multi-attività)</Typography>
        <Typography fontSize={13} color="text.secondary">
          Pensati per un client mobile: il dipendente può avere <strong>più attività attive in parallelo</strong>, ognuna con timer e pausa indipendenti (vincolo: una sola attività aperta per <Box component="code" sx={{ fontFamily: "monospace", fontSize: 12, bgcolor: "action.hover", px: 0.5, borderRadius: "4px" }}>mapping_id</Box>). Ogni attività è identificata dall&apos;<Box component="code" sx={{ fontFamily: "monospace", fontSize: 12, bgcolor: "action.hover", px: 0.5, borderRadius: "4px" }}>id</Box> restituito da <Box component="code" sx={{ fontFamily: "monospace", fontSize: 12, bgcolor: "action.hover", px: 0.5, borderRadius: "4px" }}>POST /active</Box>: usa quell&apos;id per pausa/ripresa/chiusura del singolo timer.
          Il backend è il punto di verità, così i timer sopravvivono a chiusura app, riavvio o perdita di connessione. Alla chiusura l&apos;attività diventa un <Box component="code" sx={{ fontFamily: "monospace", fontSize: 12, bgcolor: "action.hover", px: 0.5, borderRadius: "4px" }}>ActivityRecord</Box> con lo stesso schema di <Box component="code" sx={{ fontFamily: "monospace", fontSize: 12, bgcolor: "action.hover", px: 0.5, borderRadius: "4px" }}>POST /api/activity-records</Box>. Ogni risposta espone anche <Box component="code" sx={{ fontFamily: "monospace", fontSize: 12, bgcolor: "action.hover", px: 0.5, borderRadius: "4px" }}>elapsed_seconds</Box> (tempo netto lavorato) e <Box component="code" sx={{ fontFamily: "monospace", fontSize: 12, bgcolor: "action.hover", px: 0.5, borderRadius: "4px" }}>status</Box> (running/paused), pronti da mostrare in UI.
        </Typography>
      </Box>

      <EndpointCard
        method="GET"
        path="/api/activity-records/last-location"
        description="Area operativa e immobile del record più recente dell'operatore autenticato (per started_at, timer aperti inclusi): serve a precompilare il selettore area/immobile all'avvio di ogni attività. Valori grezzi dell'ultimo record: se area/immobile non esistono più negli incroci, la validazione va fatta lato client contro /api/auth/local-user/infinity-cross-mappings. Nessuno storico → 200 con tutti i campi null."
        headers={BEARER_HEADERS}
        response={LAST_LOCATION_RESPONSE}
        errors={[
          { code: 401, description: "Token mancante o non valido" },
        ]}
      />

      <EndpointCard
        method="POST"
        path="/api/activity-records/active"
        description="Avvia un nuovo timer in parallelo per il dipendente autenticato. Restituisce l'attività creata (usa il campo id per le operazioni successive). operational_area_id è obbligatorio; building è obbligatorio solo se l'area ha immobili associati e deve appartenere all'area indicata. Come i campi obbligatori dell'incrocio, area e immobile non sono più modificabili a timer avviato. 409 se esiste già un timer aperto sullo stesso mapping_id; ripetere lo stesso client_token rende la chiamata idempotente per i retry dopo un timeout di rete."
        headers={BEARER_HEADERS}
        requestBody={ACTIVE_START_REQUEST}
        response={ACTIVE_STATE_RESPONSE}
        errors={[
          { code: 401, description: "Token mancante o non valido" },
          { code: 409, description: "Esiste già un'attività in corso per lo stesso incrocio (mapping_id)" },
          { code: 422, description: "Payload non valido (area mancante o non valida, immobile mancante o non appartenente all'area, campi obbligatori mancanti)" },
        ]}
      />

      <EndpointCard
        method="GET"
        path="/api/activity-records/active"
        description="Elenca TUTTE le attività in corso del dipendente (array, eventualmente vuoto), per ricostruire i timer alla riapertura dell'app o dopo un reload. Aggiorna last_heartbeat_at su tutte le attività: funge da heartbeat globale."
        headers={BEARER_HEADERS}
        response={ACTIVE_LIST_RESPONSE}
        errors={[
          { code: 401, description: "Token mancante o non valido" },
        ]}
      />

      <EndpointCard
        method="GET"
        path="/api/activity-records/active/{activity_id}"
        description="Restituisce lo stato di un singolo timer del dipendente e aggiorna il suo last_heartbeat_at."
        headers={BEARER_HEADERS}
        response={ACTIVE_STATE_RESPONSE}
        errors={[
          { code: 401, description: "Token mancante o non valido" },
          { code: 404, description: "Attività in corso non trovata (o non appartiene al dipendente)" },
        ]}
      />

      <EndpointCard
        method="PATCH"
        path="/api/activity-records/active/{activity_id}"
        description="Aggiorna i field_values facoltativi in bozza di un singolo timer senza fermarlo. Utile anche come heartbeat mirato mentre l'app resta aperta. Area operativa, immobile e campi obbligatori dell'incrocio sono immutabili a timer avviato: un valore diverso viene rifiutato con 422."
        headers={BEARER_HEADERS}
        requestBody={ACTIVE_UPDATE_REQUEST}
        response={ACTIVE_STATE_RESPONSE}
        errors={[
          { code: 401, description: "Token mancante o non valido" },
          { code: 404, description: "Attività in corso non trovata (o non appartiene al dipendente)" },
          { code: 422, description: "Tentativo di modificare area, immobile o un campo obbligatorio a timer avviato" },
        ]}
      />

      <EndpointCard
        method="POST"
        path="/api/activity-records/active/{activity_id}/pause"
        description="Mette in pausa un singolo timer (le altre attività proseguono). Idempotente se l'attività è già in pausa."
        headers={BEARER_HEADERS}
        response={ACTIVE_STATE_RESPONSE}
        errors={[
          { code: 401, description: "Token mancante o non valido" },
          { code: 404, description: "Attività in corso non trovata (o non appartiene al dipendente)" },
        ]}
      />

      <EndpointCard
        method="POST"
        path="/api/activity-records/active/{activity_id}/resume"
        description="Riprende un singolo timer dopo una pausa, accumulando il tempo trascorso in pause_seconds."
        headers={BEARER_HEADERS}
        response={ACTIVE_STATE_RESPONSE}
        errors={[
          { code: 401, description: "Token mancante o non valido" },
          { code: 404, description: "Attività in corso non trovata (o non appartiene al dipendente)" },
        ]}
      />

      <EndpointCard
        method="POST"
        path="/api/activity-records/active/pause-all"
        description="Mette in pausa tutte le attività in corso non ancora in pausa (es. pausa pranzo, fine turno). Restituisce l'array aggiornato di tutti i timer."
        headers={BEARER_HEADERS}
        response={ACTIVE_LIST_RESPONSE}
        errors={[
          { code: 401, description: "Token mancante o non valido" },
        ]}
      />

      <EndpointCard
        method="POST"
        path="/api/activity-records/active/resume-all"
        description="Riprende tutte le attività attualmente in pausa. Restituisce l'array aggiornato di tutti i timer."
        headers={BEARER_HEADERS}
        response={ACTIVE_LIST_RESPONSE}
        errors={[
          { code: 401, description: "Token mancante o non valido" },
        ]}
      />

      <EndpointCard
        method="POST"
        path="/api/activity-records/active/{activity_id}/close"
        description="Chiude un singolo timer e crea l'ActivityRecord definitivo (duration_seconds calcolato al netto delle pause). Le altre attività restano attive. La risposta ha lo stesso schema di POST /api/activity-records."
        headers={BEARER_HEADERS}
        requestBody={ACTIVE_CLOSE_REQUEST}
        response={ACTIVITY_RECORD_RESPONSE}
        errors={[
          { code: 401, description: "Token mancante o non valido" },
          { code: 404, description: "Attività in corso non trovata (o non appartiene al dipendente)" },
          { code: 409, description: "Record già esistente (stessa matricola, incrocio e orario di inizio)" },
          { code: 422, description: "Durata calcolata non valida (verificare orari e pause)" },
        ]}
      />

      <EndpointCard
        method="DELETE"
        path="/api/activity-records/active/{activity_id}"
        description="Abbandona un singolo timer senza generare alcun record storico (es. avvio per errore). Le altre attività restano attive."
        headers={BEARER_HEADERS}
        response={`{}`}
        errors={[
          { code: 401, description: "Token mancante o non valido" },
          { code: 404, description: "Attività in corso non trovata (o non appartiene al dipendente)" },
        ]}
      />

      <EndpointCard
        method="GET"
        path="/api/activity-records/active/admin"
        description="Elenco dei timer attualmente aperti su tutti i dipendenti (JWT portale, non local-user). Utile per individuare sessioni abbandonate tramite last_heartbeat_at."
        response={`[
  {
    "id": "a1b2c3d4-...",
    "employee_id": "152c7e89-...",
    "employee_name": "ROSSI MARIO",
    "mapping_id": "b3b6a930-...",
    "operational_area_id": "3d59fb8b-...",
    "building": "F2",
    "started_at": "2026-06-30T08:00:00Z",
    "paused_at": null,
    "pause_seconds": 0,
    "elapsed_seconds": 720,
    "last_heartbeat_at": "2026-06-30T08:12:00Z"
  }
]`}
        errors={[
          { code: 401, description: "Token mancante o non valido" },
        ]}
      />

      <EndpointCard
        method="POST"
        path="/api/activity-records/active/admin/{activity_id}/close"
        description="Chiusura forzata di un singolo timer altrui (JWT portale), es. sessione abbandonata. Crea l'ActivityRecord definitivo."
        response={ACTIVITY_RECORD_RESPONSE}
        errors={[
          { code: 401, description: "Token mancante o non valido" },
          { code: 404, description: "Attività in corso non trovata" },
          { code: 422, description: "Durata calcolata non valida (verificare orari e pause)" },
        ]}
      />

      <EndpointCard
        method="DELETE"
        path="/api/activity-records/active/admin/{activity_id}"
        description="Scarto forzato di un singolo timer altrui (JWT portale), senza generare alcun record storico."
        response={`{}`}
        errors={[
          { code: 401, description: "Token mancante o non valido" },
          { code: 404, description: "Attività in corso non trovata" },
        ]}
      />

      <EndpointCard
        method="POST"
        path="/api/daily-records"
        description="Crea o aggiorna la giornata del dipendente autenticato con inizio, fine e pause. Se la stessa data viene reinviata, il record esistente viene sovrascritto."
        headers={BEARER_HEADERS}
        requestBody={DAILY_RECORD_REQUEST}
        response={DAILY_RECORD_RESPONSE}
        errors={[
          { code: 401, description: "Token mancante, non valido o scaduto" },
          { code: 403, description: "employee_id diverso dal dipendente autenticato" },
          { code: 422, description: "Payload non valido" },
        ]}
      />

      <EndpointCard
        method="GET"
        path="/api/daily-records/me?date=2026-06-30"
        description="Restituisce i valori attualmente registrati per il dipendente autenticato e la data richiesta, così il client esterno può precaricare il form, permettere modifiche e poi reinviarle."
        headers={BEARER_HEADERS}
        response={DAILY_RECORD_GET_RESPONSE}
        errors={[
          { code: 401, description: "Token mancante, non valido o scaduto" },
          { code: 404, description: "Nessuna giornata registrata per la data richiesta" },
        ]}
      />

      {/* Code examples */}
      <Box sx={{ mt: 4 }}>
        <Typography fontWeight={700} fontSize={15} sx={{ mb: 2 }}>Esempi client</Typography>
        <Stack direction="row" spacing={0.5} sx={{ mb: 0 }}>
          {tabs.map((t) => (
            <Box
              key={t.id}
              component="button"
              onClick={() => setTab(t.id)}
              sx={{
                px: 1.75,
                py: 0.75,
                border: "1px solid",
                borderColor: tab === t.id ? "primary.main" : "divider",
                borderBottom: "none",
                borderRadius: "8px 8px 0 0",
                bgcolor: tab === t.id ? "background.paper" : "transparent",
                color: tab === t.id ? "primary.main" : "text.secondary",
                fontWeight: tab === t.id ? 700 : 500,
                fontSize: 13,
                cursor: "pointer",
                transition: "all 0.15s",
              }}
            >
              {t.label}
            </Box>
          ))}
        </Stack>
        <Box sx={{ border: "1px solid", borderColor: "divider", borderRadius: "0 8px 8px 8px" }}>
          <CodeBlock>{examples[tab]}</CodeBlock>
        </Box>
      </Box>

      <Box sx={{ mt: 4 }}>
        <Typography fontWeight={700} fontSize={15} sx={{ mb: 2 }}>Esempio client endpoint Incroci</Typography>
        <Stack direction="row" spacing={0.5} sx={{ mb: 0 }}>
          {tabs.map((t) => (
            <Box
              key={`cross-${t.id}`}
              component="button"
              onClick={() => setCrossTab(t.id)}
              sx={{
                px: 1.75,
                py: 0.75,
                border: "1px solid",
                borderColor: crossTab === t.id ? "primary.main" : "divider",
                borderBottom: "none",
                borderRadius: "8px 8px 0 0",
                bgcolor: crossTab === t.id ? "background.paper" : "transparent",
                color: crossTab === t.id ? "primary.main" : "text.secondary",
                fontWeight: crossTab === t.id ? 700 : 500,
                fontSize: 13,
                cursor: "pointer",
                transition: "all 0.15s",
              }}
            >
              {t.label}
            </Box>
          ))}
        </Stack>
        <Box sx={{ border: "1px solid", borderColor: "divider", borderRadius: "0 8px 8px 8px" }}>
          <CodeBlock>{({
            python: PYTHON_INFINITY_CROSS_EXAMPLE,
            js: JS_INFINITY_CROSS_EXAMPLE,
            php: PHP_INFINITY_CROSS_EXAMPLE,
            curl: CURL_INFINITY_CROSS_EXAMPLE,
          })[crossTab] ?? PYTHON_INFINITY_CROSS_EXAMPLE}</CodeBlock>
        </Box>
      </Box>
    </Box>
  );
}
