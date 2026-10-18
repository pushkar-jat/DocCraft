import { useId } from "react";
import { parsePageRanges, type PageRange } from "../lib/pageRanges";

export interface PageSelectionValue {
  mode: "all" | "some";
  text: string;
}

export const ALL_PAGES: PageSelectionValue = { mode: "all", text: "" };

/** null selection = all pages; error = message to show; undefined ranges = not valid yet. */
export function resolveSelection(value: PageSelectionValue, pageCount: number): { ranges: PageRange[] | null; error: string | null; valid: boolean } {
  if (value.mode === "all") return { ranges: null, error: null, valid: true };
  if (value.text.trim() === "") return { ranges: null, error: null, valid: false };
  const parsed = parsePageRanges(value.text, pageCount);
  return parsed.ok ? { ranges: parsed.ranges, error: null, valid: true } : { ranges: null, error: parsed.error, valid: false };
}

interface PageSelectionFieldProps {
  value: PageSelectionValue;
  onChange: (value: PageSelectionValue) => void;
  pageCount: number;
  /** Label for the "some pages" option, e.g. "Only these pages". */
  someLabel?: string;
  /** Hide the "All pages" option (e.g. for Remove pages). */
  requireRanges?: boolean;
}

export function PageSelectionField({ value, onChange, pageCount, someLabel = "Only these pages", requireRanges = false }: PageSelectionFieldProps) {
  const id = useId();
  const { error } = resolveSelection(value, pageCount);
  const showInput = requireRanges || value.mode === "some";
  return (
    <div className="field">
      {!requireRanges && (
        <div className="choice-row">
          <label className="choice">
            <input type="radio" name={`${id}-mode`} checked={value.mode === "all"} onChange={() => onChange({ ...value, mode: "all" })} />
            All {pageCount} pages
          </label>
          <label className="choice">
            <input type="radio" name={`${id}-mode`} checked={value.mode === "some"} onChange={() => onChange({ ...value, mode: "some" })} />
            {someLabel}
          </label>
        </div>
      )}
      {showInput && (
        <>
          <label htmlFor={id}>{requireRanges ? someLabel : "Pages"}</label>
          <input
            id={id}
            className="text-input"
            value={value.text}
            onChange={(event) => onChange({ mode: "some", text: event.target.value })}
            placeholder="e.g. 1-3, 7, 10-12"
            aria-invalid={error !== null}
            aria-describedby={`${id}-help`}
          />
          <p id={`${id}-help`} className={error ? "field-error" : "field-help"} aria-live="polite">
            {error ?? `Pages 1 to ${pageCount}, numbered from 1. Separate entries with commas.`}
          </p>
        </>
      )}
    </div>
  );
}
