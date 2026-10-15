import { describe, expect, it } from "vitest";
import { addBatchItems, requeueUnfinished, runBatch, summarize, type BatchItem } from "./batch";
import { CancelledError, DocError } from "./errors";

const queue = (paths: string[]) => addBatchItems([], paths, ["pdf"]).items;

describe("addBatchItems", () => {
  it("queues supported files once and reports duplicates and other types", () => {
    const first = addBatchItems([], ["C:\\a.pdf", "C:\\b.PDF", "C:\\c.docx"], ["pdf"]);
    expect(first.items.map((item) => [item.name, item.status])).toEqual([
      ["a.pdf", "queued"],
      ["b.PDF", "queued"],
    ]);
    expect(first.rejected).toEqual(["c.docx"]);
    const second = addBatchItems(first.items, ["c:/A.pdf"], ["pdf"]);
    expect(second.items).toHaveLength(2);
    expect(second.duplicates).toEqual(["A.pdf"]);
  });
});

describe("runBatch", () => {
  it("processes items in order and isolates failures", async () => {
    const seen: string[] = [];
    const result = await runBatch(
      queue(["C:\\1.pdf", "C:\\2.pdf", "C:\\3.pdf"]),
      async (item) => {
        seen.push(item.name);
        if (item.name === "2.pdf") throw new DocError("not-pdf", "\"2.pdf\" is not a valid PDF file.");
        return `${item.name}-out`;
      },
      { signal: new AbortController().signal, onUpdate: () => undefined },
    );
    expect(seen).toEqual(["1.pdf", "2.pdf", "3.pdf"]);
    expect(result.map((item) => [item.status, item.detail])).toEqual([
      ["succeeded", "1.pdf-out"],
      ["failed", "\"2.pdf\" is not a valid PDF file."],
      ["succeeded", "3.pdf-out"],
    ]);
    expect(summarize(result)).toEqual({ succeeded: 2, failed: 1, cancelled: 0, queued: 0 });
  });

  it("never runs two items at once", async () => {
    let running = 0;
    let maxRunning = 0;
    await runBatch(
      queue(["C:\\1.pdf", "C:\\2.pdf", "C:\\3.pdf"]),
      async () => {
        running++;
        maxRunning = Math.max(maxRunning, running);
        await new Promise((resolve) => setTimeout(resolve, 5));
        running--;
        return "ok";
      },
      { signal: new AbortController().signal, onUpdate: () => undefined },
    );
    expect(maxRunning).toBe(1);
  });

  it("cancels the current item and everything still queued", async () => {
    const controller = new AbortController();
    const updates: BatchItem[][] = [];
    const result = await runBatch(
      queue(["C:\\1.pdf", "C:\\2.pdf", "C:\\3.pdf"]),
      async (item) => {
        if (item.name === "2.pdf") {
          controller.abort();
          throw new CancelledError();
        }
        return "ok";
      },
      { signal: controller.signal, onUpdate: (items) => updates.push(items) },
    );
    expect(result.map((item) => item.status)).toEqual(["succeeded", "cancelled", "cancelled"]);
    expect(updates.some((items) => items[0].status === "processing")).toBe(true);
  });

  it("only re-runs failed and cancelled items after a retry", async () => {
    const items: BatchItem[] = [
      { id: "1", path: "C:\\1.pdf", name: "1.pdf", status: "succeeded", detail: "1-out.pdf" },
      { id: "2", path: "C:\\2.pdf", name: "2.pdf", status: "failed", detail: "boom" },
      { id: "3", path: "C:\\3.pdf", name: "3.pdf", status: "cancelled" },
    ];
    const retried = requeueUnfinished(items);
    expect(retried.map((item) => item.status)).toEqual(["succeeded", "queued", "queued"]);
    const processed: string[] = [];
    await runBatch(retried, async (item) => (processed.push(item.name), "ok"), {
      signal: new AbortController().signal,
      onUpdate: () => undefined,
    });
    expect(processed).toEqual(["2.pdf", "3.pdf"]);
  });
});
