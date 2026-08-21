import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Accordion,
  AccordionDetails,
  AccordionSummary,
  Alert,
  Box,
  Button,
  Checkbox,
  Chip,
  CircularProgress,
  FormControlLabel,
  LinearProgress,
  Paper,
  Snackbar,
  Stack,
  TextField,
  Typography,
} from "@mui/material";
import { useEffect, useMemo, useState } from "react";

import { getMaintenanceQuestionnaire, saveMaintenanceQuestionnaire } from "../maintenanceApi";
import PageHeader, { HeaderButton } from "../components/PageHeader";
import {
  MAINTENANCE_QUESTIONNAIRE_SECTIONS,
  isMaintenanceAnswerComplete,
  maintenanceQuestionnaireProgress,
} from "./maintenanceQuestionnaire";


function formatDateTime(value) {
  if (!value) return "Non ancora salvato";
  return new Intl.DateTimeFormat("it-IT", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

function QuestionField({ question, value, onChange }) {
  if (question.type === "multi") {
    const selected = Array.isArray(value) ? value : [];
    return (
      <Stack direction="row" useFlexGap flexWrap="wrap" gap={0.75}>
        {question.options.map((option) => {
          const checked = selected.includes(option);
          return (
            <FormControlLabel
              key={option}
              control={
                <Checkbox
                  size="small"
                  checked={checked}
                  onChange={() => onChange(
                    checked ? selected.filter((item) => item !== option) : [...selected, option],
                  )}
                />
              }
              label={option}
              sx={{
                m: 0,
                pr: 1.25,
                border: "1px solid",
                borderColor: checked ? "primary.main" : "divider",
                borderRadius: 999,
                bgcolor: checked ? "rgba(0,112,64,0.08)" : "background.paper",
                "& .MuiFormControlLabel-label": { fontSize: 13 },
              }}
            />
          );
        })}
      </Stack>
    );
  }

  return (
    <TextField
      value={typeof value === "string" ? value : ""}
      onChange={(event) => onChange(event.target.value)}
      type={question.type === "date" ? "date" : "text"}
      multiline={question.type !== "date"}
      minRows={question.type === "date" ? undefined : 3}
      fullWidth
      size="small"
      placeholder={question.type === "date" ? undefined : "Scrivi qui la risposta…"}
      helperText={question.helper}
      slotProps={question.type === "date" ? { inputLabel: { shrink: true } } : undefined}
      sx={{
        "& .MuiOutlinedInput-root": {
          bgcolor: "background.paper",
          alignItems: "flex-start",
        },
      }}
    />
  );
}

function SectionCard({ section, answers, onAnswer }) {
  const completed = section.questions.filter((question) => isMaintenanceAnswerComplete(answers[question.id])).length;
  const complete = completed === section.questions.length;

  return (
    <Accordion
      id={`questionnaire-${section.id}`}
      defaultExpanded={section.id === "compilazione" || section.id === "obiettivi"}
      disableGutters
      elevation={0}
      sx={{
        border: "1px solid",
        borderColor: "divider",
        borderRadius: "16px !important",
        overflow: "hidden",
        scrollMarginTop: 20,
        "&::before": { display: "none" },
      }}
    >
      <AccordionSummary
        expandIcon={<Typography component="span" sx={{ color: "text.secondary", fontSize: 20 }}>⌄</Typography>}
        sx={{
          px: { xs: 2, md: 2.5 },
          py: 0.5,
          bgcolor: complete ? "rgba(0,112,64,0.06)" : "background.paper",
          "& .MuiAccordionSummary-content": { alignItems: "center", gap: 1.5 },
        }}
      >
        <Box
          sx={{
            width: 38,
            height: 38,
            display: "grid",
            placeItems: "center",
            borderRadius: 2,
            bgcolor: complete ? "primary.main" : "action.hover",
            color: complete ? "primary.contrastText" : "primary.main",
            fontSize: 12,
            fontWeight: 800,
            flexShrink: 0,
          }}
        >
          {complete ? "✓" : section.eyebrow}
        </Box>
        <Box sx={{ flex: 1, minWidth: 0 }}>
          <Typography fontWeight={800}>{section.title}</Typography>
          <Typography variant="caption" color="text.secondary">
            {section.description}
          </Typography>
        </Box>
        <Chip
          size="small"
          label={`${completed}/${section.questions.length}`}
          color={complete ? "success" : "default"}
          variant={complete ? "filled" : "outlined"}
          sx={{ mr: 0.5, fontWeight: 700 }}
        />
      </AccordionSummary>
      <AccordionDetails sx={{ px: { xs: 2, md: 3 }, py: 3, borderTop: "1px solid", borderColor: "divider" }}>
        <Stack spacing={3}>
          {section.questions.map((question, index) => (
            <Box key={question.id}>
              <Stack direction="row" spacing={1} alignItems="flex-start" sx={{ mb: 1 }}>
                <Typography
                  component="span"
                  sx={{
                    minWidth: 26,
                    color: isMaintenanceAnswerComplete(answers[question.id]) ? "primary.main" : "text.disabled",
                    fontSize: 12,
                    fontWeight: 800,
                    pt: 0.2,
                  }}
                >
                  {String(index + 1).padStart(2, "0")}
                </Typography>
                <Typography variant="body2" fontWeight={700}>{question.label}</Typography>
              </Stack>
              <Box sx={{ pl: { xs: 0, sm: 4.25 } }}>
                <QuestionField
                  question={question}
                  value={answers[question.id]}
                  onChange={(value) => onAnswer(question.id, value)}
                />
              </Box>
            </Box>
          ))}
        </Stack>
      </AccordionDetails>
    </Accordion>
  );
}

export default function MaintenancePage() {
  const queryClient = useQueryClient();
  const [answers, setAnswers] = useState({});
  const [version, setVersion] = useState(0);
  const [savedSnapshot, setSavedSnapshot] = useState("{}");
  const [loadedVersion, setLoadedVersion] = useState(null);
  const [feedback, setFeedback] = useState(null);

  const questionnaireQuery = useQuery({
    queryKey: ["maintenance-questionnaire"],
    queryFn: getMaintenanceQuestionnaire,
    staleTime: 30_000,
  });

  useEffect(() => {
    const data = questionnaireQuery.data;
    if (!data || loadedVersion === data.version) return;
    const nextAnswers = data.answers ?? {};
    setAnswers(nextAnswers);
    setVersion(data.version ?? 0);
    setSavedSnapshot(JSON.stringify(nextAnswers));
    setLoadedVersion(data.version ?? 0);
  }, [loadedVersion, questionnaireQuery.data]);

  const progress = useMemo(() => maintenanceQuestionnaireProgress(answers), [answers]);
  const dirty = JSON.stringify(answers) !== savedSnapshot;

  const saveMutation = useMutation({
    mutationFn: () => saveMaintenanceQuestionnaire({ version, answers }),
    onSuccess: (data) => {
      const nextAnswers = data.answers ?? {};
      setAnswers(nextAnswers);
      setVersion(data.version);
      setLoadedVersion(data.version);
      setSavedSnapshot(JSON.stringify(nextAnswers));
      queryClient.setQueryData(["maintenance-questionnaire"], data);
      setFeedback("Risposte salvate correttamente");
    },
  });

  function updateAnswer(questionId, value) {
    setAnswers((current) => ({ ...current, [questionId]: value }));
  }

  function restoreSavedAnswers() {
    setAnswers(JSON.parse(savedSnapshot));
  }

  function goToSection(sectionId) {
    document.getElementById(`questionnaire-${sectionId}`)?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  if (questionnaireQuery.isLoading) {
    return (
      <Box sx={{ minHeight: "55vh", display: "grid", placeItems: "center" }}>
        <Stack spacing={1.5} alignItems="center">
          <CircularProgress />
          <Typography color="text.secondary">Caricamento del questionario…</Typography>
        </Stack>
      </Box>
    );
  }

  return (
    <Stack spacing={2.5}>
      <PageHeader
        section="Manutenzioni"
        title="Progettiamo insieme il nuovo strumento"
        meta={`${progress.completed} risposte su ${progress.total}`}
        actions={
          <HeaderButton
            onClick={() => saveMutation.mutate()}
            disabled={!dirty || saveMutation.isPending}
          >
            {saveMutation.isPending ? "Salvataggio…" : "Salva risposte"}
          </HeaderButton>
        }
      />

      <Paper
        variant="outlined"
        sx={{
          p: { xs: 2, md: 2.5 },
          borderRadius: 3,
          background: "linear-gradient(135deg, rgba(0,112,64,0.08), rgba(240,236,224,0.55))",
        }}
      >
        <Stack direction={{ xs: "column", md: "row" }} spacing={2.5} alignItems={{ md: "center" }}>
          <Box sx={{ flex: 1 }}>
            <Typography variant="h6" fontWeight={850}>La manutenzione, raccontata da chi la gestisce</Typography>
            <Typography color="text.secondary" sx={{ mt: 0.5, maxWidth: 820 }}>
              Compilate le sezioni descrivendo il lavoro reale di oggi. Le risposte sono condivise con gli altri
              utenti abilitati e serviranno all'IT per definire il primo rilascio del modulo.
            </Typography>
          </Box>
          <Box sx={{ minWidth: { md: 250 } }}>
            <Stack direction="row" justifyContent="space-between" sx={{ mb: 0.75 }}>
              <Typography variant="caption" fontWeight={700}>Completamento</Typography>
              <Typography variant="caption" fontWeight={800} color="primary.main">{progress.percent}%</Typography>
            </Stack>
            <LinearProgress
              variant="determinate"
              value={progress.percent}
              sx={{ height: 9, borderRadius: 99, bgcolor: "rgba(0,112,64,0.12)" }}
            />
          </Box>
        </Stack>
      </Paper>

      {questionnaireQuery.isError && (
        <Alert severity="error">{questionnaireQuery.error?.message || "Impossibile caricare il questionario."}</Alert>
      )}
      {saveMutation.isError && (
        <Alert severity="error" action={<Button color="inherit" onClick={() => questionnaireQuery.refetch()}>Ricarica</Button>}>
          {saveMutation.error?.message || "Impossibile salvare le risposte."}
        </Alert>
      )}

      <Box sx={{ display: "grid", gridTemplateColumns: { xs: "1fr", lg: "250px minmax(0, 1fr)" }, gap: 2.5, alignItems: "start" }}>
        <Paper
          variant="outlined"
          sx={{
            display: { xs: "none", lg: "block" },
            position: "sticky",
            top: 24,
            p: 1,
            borderRadius: 3,
            maxHeight: "calc(100vh - 48px)",
            overflowY: "auto",
          }}
        >
          <Typography variant="overline" color="text.secondary" sx={{ display: "block", px: 1.25, pt: 0.75, pb: 0.5 }}>
            Sezioni
          </Typography>
          {MAINTENANCE_QUESTIONNAIRE_SECTIONS.map((section) => {
            const complete = section.questions.every((question) => isMaintenanceAnswerComplete(answers[question.id]));
            return (
              <Button
                key={section.id}
                fullWidth
                onClick={() => goToSection(section.id)}
                sx={{ justifyContent: "flex-start", gap: 1, px: 1.25, py: 0.8, borderRadius: 2, textTransform: "none", color: "text.primary" }}
              >
                <Box sx={{ width: 20, color: complete ? "primary.main" : "text.disabled", fontWeight: 900 }}>
                  {complete ? "✓" : section.eyebrow}
                </Box>
                <Typography variant="body2" noWrap>{section.title}</Typography>
              </Button>
            );
          })}
        </Paper>

        <Stack spacing={1.5}>
          {MAINTENANCE_QUESTIONNAIRE_SECTIONS.map((section) => (
            <SectionCard key={section.id} section={section} answers={answers} onAnswer={updateAnswer} />
          ))}

          <Paper variant="outlined" sx={{ p: 2, borderRadius: 3 }}>
            <Stack direction={{ xs: "column", sm: "row" }} spacing={1.5} alignItems={{ sm: "center" }} justifyContent="space-between">
              <Box>
                <Typography variant="body2" fontWeight={700}>
                  {dirty ? "Hai modifiche non ancora salvate" : "Tutte le modifiche sono salvate"}
                </Typography>
                <Typography variant="caption" color="text.secondary">
                  Ultimo salvataggio: {formatDateTime(questionnaireQuery.data?.updated_at)}
                  {questionnaireQuery.data?.updated_by ? ` · ${questionnaireQuery.data.updated_by}` : ""}
                </Typography>
              </Box>
              <Stack direction="row" spacing={1}>
                {dirty && <Button variant="text" onClick={restoreSavedAnswers}>Annulla modifiche</Button>}
                <Button variant="contained" onClick={() => saveMutation.mutate()} disabled={!dirty || saveMutation.isPending}>
                  {saveMutation.isPending ? "Salvataggio…" : "Salva risposte"}
                </Button>
              </Stack>
            </Stack>
          </Paper>
        </Stack>
      </Box>

      <Snackbar
        open={Boolean(feedback)}
        autoHideDuration={3500}
        onClose={() => setFeedback(null)}
        message={feedback}
        anchorOrigin={{ vertical: "bottom", horizontal: "center" }}
      />
    </Stack>
  );
}
