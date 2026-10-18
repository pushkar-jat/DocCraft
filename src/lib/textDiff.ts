/** Text comparison for Compare PDF: Myers line diff, grouped into hunks, plus word-level detail. */

export type DiffOp<T> = { kind: "equal" | "delete" | "insert"; item: T };

/**
 * Myers O((N+M)·D) diff. Returns null when the inputs differ by more than `maxEdits`
 * (to keep time and memory bounded on unrelated documents).
 */
export function myersDiff<T>(a: readonly T[], b: readonly T[], equals: (x: T, y: T) => boolean, maxEdits = 20_000): DiffOp<T>[] | null {
  const n = a.length;
  const m = b.length;
  const max = Math.min(n + m, maxEdits);
  const offset = max + 1;
  let v: Int32Array = new Int32Array(2 * max + 3);
  const trace: Int32Array[] = [];
  let found = -1;
  for (let d = 0; d <= max && found < 0; d++) {
    trace.push(v.slice());
    for (let k = -d; k <= d; k += 2) {
      let x = k === -d || (k !== d && v[offset + k - 1] < v[offset + k + 1]) ? v[offset + k + 1] : v[offset + k - 1] + 1;
      let y = x - k;
      while (x < n && y < m && equals(a[x], b[y])) {
        x++;
        y++;
      }
      v[offset + k] = x;
      if (x >= n && y >= m) {
        found = d;
        break;
      }
    }
  }
  if (found < 0) return null;

  // Backtrack through the saved frontiers.
  const ops: DiffOp<T>[] = [];
  let x = n;
  let y = m;
  for (let d = found; d > 0; d--) {
    v = trace[d];
    const k = x - y;
    const prevK = k === -d || (k !== d && v[offset + k - 1] < v[offset + k + 1]) ? k + 1 : k - 1;
    const prevX = v[offset + prevK];
    const prevY = prevX - prevK;
    // Undo the diagonal "snake" of equal items, then the single edit that started it.
    while (x > prevX && y > prevY) {
      x--;
      y--;
      ops.push({ kind: "equal", item: a[x] });
    }
    if (x === prevX) ops.push({ kind: "insert", item: b[y - 1] });
    else ops.push({ kind: "delete", item: a[x - 1] });
    x = prevX;
    y = prevY;
  }
  while (x > 0 && y > 0) {
    ops.push({ kind: "equal", item: a[--x] });
    y--;
  }
  return ops.reverse();
}

export interface Line {
  text: string;
  /** 1-based page number. */
  page: number;
}

export interface Hunk {
  removed: Line[];
  added: Line[];
}

export interface Comparison {
  identical: boolean;
  hunks: Hunk[];
  removedLines: number;
  addedLines: number;
  unchangedLines: number;
}

const normalize = (text: string) => text.replace(/\s+/g, " ").trim().toLowerCase();

/** Compares two documents' lines; hunks group consecutive removals/additions. */
export function compareLines(a: readonly Line[], b: readonly Line[]): Comparison | null {
  const ops = myersDiff(a, b, (x, y) => normalize(x.text) === normalize(y.text));
  if (!ops) return null;
  const hunks: Hunk[] = [];
  let current: Hunk | null = null;
  let unchanged = 0;
  for (const op of ops) {
    if (op.kind === "equal") {
      unchanged++;
      current = null;
      continue;
    }
    if (!current) {
      current = { removed: [], added: [] };
      hunks.push(current);
    }
    (op.kind === "delete" ? current.removed : current.added).push(op.item);
  }
  const removedLines = hunks.reduce((sum, hunk) => sum + hunk.removed.length, 0);
  const addedLines = hunks.reduce((sum, hunk) => sum + hunk.added.length, 0);
  return { identical: hunks.length === 0, hunks, removedLines, addedLines, unchangedLines: unchanged };
}

export type WordPart = { text: string; changed: boolean };

/** Word-level highlighting between an old and a new version of a passage. */
export function wordDiff(before: string, after: string): { before: WordPart[]; after: WordPart[] } {
  const a = before.split(/(\s+)/).filter((part) => part !== "");
  const b = after.split(/(\s+)/).filter((part) => part !== "");
  const ops = myersDiff(a, b, (x, y) => x === y, 5_000);
  if (!ops) return { before: [{ text: before, changed: true }], after: [{ text: after, changed: true }] };
  const result = { before: [] as WordPart[], after: [] as WordPart[] };
  for (const op of ops) {
    if (op.kind !== "insert") result.before.push({ text: op.item, changed: op.kind === "delete" && op.item.trim() !== "" });
    if (op.kind !== "delete") result.after.push({ text: op.item, changed: op.kind === "insert" && op.item.trim() !== "" });
  }
  return result;
}

/** Plain-text report of a comparison. */
export function comparisonReport(nameA: string, nameB: string, comparison: Comparison): string {
  const lines = [`Comparison of "${nameA}" (original) and "${nameB}" (changed)`, ""];
  if (comparison.identical) {
    lines.push("No text differences found.");
  } else {
    lines.push(`${comparison.hunks.length} changes: ${comparison.removedLines} lines removed or changed, ${comparison.addedLines} lines added or changed.`, "");
    comparison.hunks.forEach((hunk, index) => {
      lines.push(`--- Change ${index + 1}`);
      hunk.removed.forEach((line) => lines.push(`- [p.${line.page}] ${line.text}`));
      hunk.added.forEach((line) => lines.push(`+ [p.${line.page}] ${line.text}`));
      lines.push("");
    });
  }
  return `${lines.join("\n")}\n`;
}
