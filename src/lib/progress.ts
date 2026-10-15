import type { MergeProgress } from "./merge";

/** Overall completion in percent: reading ~40%, merging ~50%, writing the last 10%. */
export function progressPercent(progress: MergeProgress | null): number {
  if (progress === null || progress.total <= 0) return 0;
  const fraction = Math.min(Math.max(progress.current / progress.total, 0), 1);
  switch (progress.stage) {
    case "reading":
      return Math.round(fraction * 40);
    case "merging":
      return Math.round(40 + fraction * 50);
    case "saving":
      return 95;
  }
}

export function progressLabel(progress: MergeProgress | null): string {
  if (progress === null) return "Preparing…";
  switch (progress.stage) {
    case "reading":
      return `Reading file ${progress.current} of ${progress.total}…`;
    case "merging":
      return `Merging file ${progress.current} of ${progress.total}…`;
    case "saving":
      return "Writing the merged PDF…";
  }
}
