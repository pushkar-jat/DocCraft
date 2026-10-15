/**
 * Turns positioned text fragments from a PDF page into paragraphs. This is a "basic layout"
 * heuristic: reading order is top-to-bottom, left-to-right, so multi-column pages, tables and
 * floating text boxes are flattened into plain paragraphs.
 */

export interface TextFragment {
  text: string;
  /** Left edge in PDF points. */
  x: number;
  /** Baseline in PDF points (origin at the bottom of the page). */
  y: number;
  width: number;
  fontSize: number;
}

export interface Paragraph {
  text: string;
  fontSize: number;
  heading: boolean;
}

interface Line {
  y: number;
  fontSize: number;
  text: string;
}

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

function buildLines(fragments: readonly TextFragment[]): Line[] {
  const usable = fragments.filter((fragment) => fragment.text.length > 0 && fragment.fontSize > 0);
  const sorted = [...usable].sort((a, b) => b.y - a.y || a.x - b.x);
  const groups: TextFragment[][] = [];
  for (const fragment of sorted) {
    const current = groups[groups.length - 1];
    if (current && Math.abs(current[0].y - fragment.y) <= Math.max(current[0].fontSize, fragment.fontSize) * 0.5) {
      current.push(fragment);
    } else {
      groups.push([fragment]);
    }
  }
  return groups
    .map((group) => {
      const parts = [...group].sort((a, b) => a.x - b.x);
      let text = "";
      let previousEnd: number | null = null;
      for (const part of parts) {
        const gap = previousEnd === null ? 0 : part.x - previousEnd;
        if (previousEnd !== null && gap > part.fontSize * 0.2 && !text.endsWith(" ") && !part.text.startsWith(" ")) {
          text += " ";
        }
        text += part.text;
        previousEnd = part.x + part.width;
      }
      return { y: group[0].y, fontSize: median(group.map((part) => part.fontSize)), text: text.replace(/\s+/g, " ").trim() };
    })
    .filter((line) => line.text.length > 0);
}

function joinLines(previous: string, next: string): string {
  // Re-join words hyphenated across a line break ("docu-" + "ment").
  if (/[a-zà-ÿ]-$/i.test(previous) && /^[a-zà-ÿ]/.test(next)) {
    return previous.slice(0, -1) + next;
  }
  return `${previous} ${next}`;
}

/** Groups a page's fragments into paragraphs; large text relative to the page body becomes a heading. */
export function layoutPage(fragments: readonly TextFragment[]): Paragraph[] {
  const lines = buildLines(fragments);
  if (lines.length === 0) return [];
  const bodySize = median(lines.map((line) => line.fontSize));
  const paragraphs: { lines: Line[] }[] = [];

  for (const line of lines) {
    const current = paragraphs[paragraphs.length - 1];
    const last = current?.lines[current.lines.length - 1];
    const sameSize = last !== undefined && Math.abs(last.fontSize - line.fontSize) <= Math.max(last.fontSize, line.fontSize) * 0.15;
    const closeEnough = last !== undefined && last.y - line.y <= Math.max(last.fontSize, line.fontSize) * 1.6;
    if (current && sameSize && closeEnough) {
      current.lines.push(line);
    } else {
      paragraphs.push({ lines: [line] });
    }
  }

  return paragraphs.map(({ lines: group }) => {
    const fontSize = median(group.map((line) => line.fontSize));
    return {
      text: group.map((line) => line.text).reduce(joinLines),
      fontSize: Math.round(fontSize * 2) / 2,
      heading: fontSize >= bodySize * 1.3 && group.length <= 3,
    };
  });
}

export function countCharacters(pages: readonly Paragraph[][]): number {
  return pages.reduce((total, page) => total + page.reduce((sum, paragraph) => sum + paragraph.text.replace(/\s/g, "").length, 0), 0);
}
