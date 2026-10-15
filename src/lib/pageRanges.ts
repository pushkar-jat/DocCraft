/** A 1-based, inclusive page range. */
export interface PageRange {
  start: number;
  end: number;
}

export type RangeParseResult = { ok: true; ranges: PageRange[] } | { ok: false; error: string };

const TOKEN = /^(\d+)(?:\s*[-–]\s*(\d+))?$/;

export function formatRange(range: PageRange): string {
  return range.start === range.end ? String(range.start) : `${range.start}-${range.end}`;
}

/**
 * Parses selections such as `1-3, 5, 8-10` against a document with `pageCount` pages.
 * Order is preserved. Empty entries, zero, negative or non-numeric values, reversed ranges,
 * pages beyond the end, and pages selected more than once are all rejected with a message.
 */
export function parsePageRanges(input: string, pageCount: number): RangeParseResult {
  const text = input.trim();
  if (text === "") {
    return { ok: false, error: "Enter the pages to use, for example 1-3, 5, 8-10." };
  }
  const tokens = text.split(",").map((token) => token.trim());
  const ranges: PageRange[] = [];
  const usedBy = new Map<number, string>();

  for (const [index, token] of tokens.entries()) {
    if (token === "") {
      return { ok: false, error: `Entry ${index + 1} is empty. Remove the extra comma.` };
    }
    const match = TOKEN.exec(token);
    if (!match) {
      return {
        ok: false,
        error: token.startsWith("-")
          ? `"${token}" is not valid. Page numbers start at 1.`
          : `"${token}" is not a page number or range. Use forms like 4 or 2-6.`,
      };
    }
    const start = Number(match[1]);
    const end = match[2] === undefined ? start : Number(match[2]);
    if (start === 0 || end === 0) {
      return { ok: false, error: `"${token}" is not valid. Page numbers start at 1.` };
    }
    if (start > end) {
      return { ok: false, error: `"${token}" is reversed. Write it as ${end}-${start}.` };
    }
    if (end > pageCount) {
      const page = start > pageCount ? start : end;
      return {
        ok: false,
        error: `Page ${page} does not exist. This PDF has ${pageCount} ${pageCount === 1 ? "page" : "pages"}.`,
      };
    }
    for (let page = start; page <= end; page++) {
      const previous = usedBy.get(page);
      if (previous !== undefined) {
        return {
          ok: false,
          error: `Page ${page} is selected more than once ("${previous}" and "${token}"). Each page can only appear once.`,
        };
      }
      usedBy.set(page, token);
    }
    ranges.push({ start, end });
  }
  return { ok: true, ranges };
}

/** Converts ranges to 0-based page indices, in the given order. */
export function rangesToIndices(ranges: readonly PageRange[]): number[] {
  return ranges.flatMap((range) => Array.from({ length: range.end - range.start + 1 }, (_, i) => range.start - 1 + i));
}

/** Splits `pageCount` pages into consecutive chunks of `size` pages. */
export function chunkRanges(pageCount: number, size: number): PageRange[] {
  const chunk = Math.max(1, Math.floor(size));
  const ranges: PageRange[] = [];
  for (let start = 1; start <= pageCount; start += chunk) {
    ranges.push({ start, end: Math.min(pageCount, start + chunk - 1) });
  }
  return ranges;
}
