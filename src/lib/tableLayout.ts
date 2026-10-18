/**
 * Rebuilds a grid of cells from positioned text fragments, for PDF -> Excel. This is a basic
 * heuristic: rows are found by baseline, cells by horizontal gaps, and columns by clustering
 * cell start positions across the page. Merged cells, rotated text and multi-line cells are not
 * reconstructed.
 */
import type { TextFragment } from "./textLayout";

export type CellValue = string | number;

interface Cell {
  x: number;
  end: number;
  text: string;
  fontSize: number;
}

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
}

function rowsOf(fragments: readonly TextFragment[]): TextFragment[][] {
  const sorted = fragments.filter((f) => f.text.trim() !== "" && f.fontSize > 0).sort((a, b) => b.y - a.y || a.x - b.x);
  const rows: TextFragment[][] = [];
  for (const fragment of sorted) {
    const row = rows[rows.length - 1];
    if (row && Math.abs(row[0].y - fragment.y) <= Math.max(row[0].fontSize, fragment.fontSize) * 0.45) row.push(fragment);
    else rows.push([fragment]);
  }
  return rows.map((row) => row.sort((a, b) => a.x - b.x));
}

/** Splits a row into cells wherever the horizontal gap is wider than ~1 character. */
function cellsOf(row: TextFragment[]): Cell[] {
  const cells: Cell[] = [];
  for (const fragment of row) {
    const last = cells[cells.length - 1];
    const gap = last ? fragment.x - last.end : Infinity;
    if (last && gap < fragment.fontSize * 0.9) {
      last.text += (gap > fragment.fontSize * 0.15 && !last.text.endsWith(" ") ? " " : "") + fragment.text;
      last.end = fragment.x + fragment.width;
    } else {
      cells.push({ x: fragment.x, end: fragment.x + fragment.width, text: fragment.text, fontSize: fragment.fontSize });
    }
  }
  return cells.map((cell) => ({ ...cell, text: cell.text.replace(/\s+/g, " ").trim() }));
}

/** Column boundaries from clustered cell start positions. */
function columnStarts(cells: Cell[], tolerance: number): number[] {
  const starts = cells.map((cell) => cell.x).sort((a, b) => a - b);
  const columns: number[] = [];
  for (const x of starts) {
    if (columns.length === 0 || x - columns[columns.length - 1] > tolerance) columns.push(x);
  }
  return columns;
}

const NUMBER = /^[-+]?(?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d+)?%?$/;

/** "1,234.50" -> 1234.5; "45%" -> 0.45; anything else stays text. Leading zeros keep text (IDs). */
export function toCellValue(text: string): CellValue {
  const trimmed = text.trim();
  if (!NUMBER.test(trimmed) || /^[-+]?0\d/.test(trimmed)) return trimmed;
  const percent = trimmed.endsWith("%");
  const value = Number(trimmed.replace(/[,%+]/g, ""));
  if (!Number.isFinite(value)) return trimmed;
  return percent ? value / 100 : value;
}

/** One page of fragments -> rows of cell values (ragged rows are padded by the writer). */
export function layoutTable(fragments: readonly TextFragment[]): CellValue[][] {
  const rows = rowsOf(fragments).map(cellsOf);
  const allCells = rows.flat();
  if (allCells.length === 0) return [];
  const tolerance = median(allCells.map((cell) => cell.fontSize)) * 1.2;
  const columns = columnStarts(allCells, tolerance);
  return rows.map((cells) => {
    const values: CellValue[] = [];
    for (const cell of cells) {
      // Rightmost column whose start is at or before this cell (with tolerance).
      let index = 0;
      for (let c = 0; c < columns.length; c++) if (columns[c] <= cell.x + tolerance / 2) index = c;
      while (values.length < index) values.push("");
      if (values.length > index && values[index] !== "") values[index] = `${values[index]} ${cell.text}`;
      else values[index] = toCellValue(cell.text);
    }
    return values;
  });
}
