import { Autocomplete, Checkbox, TextField } from "@mui/material";

import { filterBasis } from "./filterWidth";

// Normalizza le due forme accettate: stringhe semplici oppure {value,label}.
function toOption(option) {
  return typeof option === "string" ? { value: option, label: option } : option;
}

/**
 * Filtro a tendina con ricerca durante la digitazione (regola 4).
 *
 * Sostituisce i `<Select>` secchi: stessa forma e stessi colori di un
 * TextField outlined size="small", ma l'elenco si filtra mentre si scrive.
 * `value` è il valore grezzo (stringa), `""` significa "nessun filtro".
 * Con `multiple` diventa un array di valori e `onChange` ne riceve uno: la
 * tendina resta aperta e ogni riga ha una casella, così si selezionano più
 * voci di seguito senza dover riaprire l'elenco a ogni scelta.
 */
export default function FilterSelect({
  label,
  value,
  onChange,
  options,
  placeholder,
  disabled = false,
  clearable = true,
  multiple = false,
  sx,
}) {
  const normalized = options.map(toOption);
  const selected = multiple
    ? normalized.filter((option) => (value ?? []).includes(option.value))
    : normalized.find((option) => option.value === value) ?? null;
  // `--filter-basis` è letta da FilterBar: il filtro parte largo quanto serve
  // all'opzione più lunga, e si restringe solo quando la riga è piena.
  const basis = filterBasis(normalized.map((option) => option.label));
  // Con multiple i chip selezionati occupano il campo: serve più respiro.
  const width = multiple ? Math.round(basis * 1.15) : basis;

  return (
    <Autocomplete
      options={normalized}
      value={selected}
      onChange={(_, option) =>
        onChange(multiple ? (option ?? []).map((item) => item.value) : option?.value ?? "")
      }
      getOptionLabel={(option) => option.label ?? ""}
      isOptionEqualToValue={(option, current) => option.value === current.value}
      size="small"
      multiple={multiple}
      autoHighlight
      openOnFocus
      disabled={disabled}
      disableClearable={!clearable}
      disableCloseOnSelect={multiple}
      renderOption={multiple
        ? (props, option, { selected: isSelected }) => {
            const { key, ...optionProps } = props;
            return (
              <li key={key} {...optionProps}>
                <Checkbox size="small" checked={isSelected} sx={{ mr: 0.5, p: 0.5 }} />
                {option.label}
              </li>
            );
          }
        : undefined}
      // La tendina si dimensiona sulle opzioni, non sull'input: un'etichetta
      // lunga resta leggibile anche se il campo chiuso la tronca.
      slotProps={{ popper: { style: { width: "fit-content" } } }}
      sx={{ "--filter-basis": `${width}px`, ...sx }}
      renderInput={(params) => <TextField {...params} label={label} placeholder={placeholder} />}
    />
  );
}
