import type { Paragraph } from "./textLayout";

/** Escapes characters that would otherwise start Markdown syntax at the beginning of a line. */
function escapeLineStart(text: string): string {
  return text.replace(/^([#>+=|`~-])/, "\\$1").replace(/^(\d+)([.)])(\s)/, "$1\\$2$3");
}

function escapeInline(text: string): string {
  return text.replace(/([\\*_`[\]<>])/g, "\\$1");
}

/**
 * Converts extracted paragraphs to Markdown. Headings get levels by relative font size (largest = #),
 * bullet and numbered items become list items, and pages are separated by a horizontal rule.
 */
export function paragraphsToMarkdown(pages: readonly Paragraph[][], options: { pageSeparators?: boolean } = {}): string {
  const headingSizes = [...new Set(pages.flat().filter((p) => p.heading).map((p) => p.fontSize))].sort((a, b) => b - a);
  const level = (size: number) => Math.min(headingSizes.indexOf(size) + 1, 3);

  const pageBlocks = pages.map((paragraphs) => {
    // Consecutive list items share one block; everything else is its own block.
    const blocks: string[] = [];
    let previousWasList = false;
    for (const paragraph of paragraphs) {
      const text = paragraph.text.trim();
      if (text === "") continue;
      const bullet = /^[•◦▪●‣*-]\s+(.*)$/.exec(text);
      const numbered = /^(\d{1,3})[.)]\s+(.*)$/.exec(text);
      if (paragraph.heading) {
        blocks.push(`${"#".repeat(level(paragraph.fontSize))} ${escapeInline(text)}`);
        previousWasList = false;
      } else if (bullet || numbered) {
        const item = bullet ? `- ${escapeInline(bullet[1])}` : `${numbered![1]}. ${escapeInline(numbered![2])}`;
        if (previousWasList) blocks[blocks.length - 1] += `\n${item}`;
        else blocks.push(item);
        previousWasList = true;
      } else {
        blocks.push(escapeLineStart(escapeInline(text)));
        previousWasList = false;
      }
    }
    return blocks.join("\n\n");
  });

  const separator = options.pageSeparators === false ? "\n\n" : "\n\n---\n\n";
  return `${pageBlocks.filter((block) => block !== "").join(separator)}\n`;
}
