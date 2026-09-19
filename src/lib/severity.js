// Display labels for the real severity values (mild/medium/"destroy me" — never
// changed, only how they're shown). Originally inlined separately in InputForm.jsx and
// ChatThread.jsx; pulled out once History.jsx needed the same mapping a third time.
export const SEVERITY_LABELS = { mild: "Mild", medium: "Medium", "destroy me": "Destroy Me" };

// CSS modifier suffix for a severity value (".rs-severity-btn--<x>", ".rs-docket-severity--<x>",
// etc.) — "destroy me" isn't a valid class-name fragment on its own.
export function severityModifier(value) {
  return value === "destroy me" ? "destroy-me" : value;
}
