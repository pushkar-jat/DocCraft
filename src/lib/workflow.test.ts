import { describe, expect, it } from "vitest";
import { makePdf, pageWidths, textBytes } from "../test/fixtures";
import { MergeCancelledError, MergeError } from "./errors";
import { MAX_TOTAL_INPUT_BYTES, runMergeWorkflow, type FileAccess } from "./workflow";

/** In-memory stand-in for the Tauri fs plugin that records every write. */
class FakeFiles implements FileAccess {
  readonly files = new Map<string, Uint8Array>();
  readonly writes: string[] = [];
  readonly sizes = new Map<string, number>();
  failWrite = false;

  async fileSize(path: string) {
    const bytes = this.files.get(path);
    if (!bytes) throw new Error("ENOENT");
    return this.sizes.get(path) ?? bytes.length;
  }

  async readFile(path: string) {
    const bytes = this.files.get(path);
    if (!bytes) throw new Error("ENOENT");
    return Uint8Array.from(bytes);
  }

  async writeFile(path: string, bytes: Uint8Array) {
    if (this.failWrite) throw new Error("EACCES");
    this.writes.push(path);
    this.files.set(path, bytes);
  }
}

async function setup() {
  const fs = new FakeFiles();
  fs.files.set("C:\\in\\one.pdf", await makePdf(1, 2));
  fs.files.set("C:\\in\\two.pdf", await makePdf(2, 1));
  return fs;
}

async function caught(promise: Promise<unknown>): Promise<unknown> {
  return promise.then(
    () => null,
    (error: unknown) => error,
  );
}

describe("runMergeWorkflow", () => {
  it("writes the merged PDF in the displayed order and leaves inputs untouched", async () => {
    const fs = await setup();
    const before = Uint8Array.from(fs.files.get("C:\\in\\one.pdf")!);

    const result = await runMergeWorkflow(["C:\\in\\two.pdf", "C:\\in\\one.pdf"], "C:\\out\\merged.pdf", fs);

    expect(result).toEqual({ pageCount: 3, fileCount: 2, outputName: "merged.pdf" });
    expect(fs.writes).toEqual(["C:\\out\\merged.pdf"]);
    expect(await pageWidths(fs.files.get("C:\\out\\merged.pdf")!)).toEqual([200, 100, 101]);
    expect(fs.files.get("C:\\in\\one.pdf")).toEqual(before);
  });

  it("refuses to overwrite an input file and writes nothing", async () => {
    const fs = await setup();
    const error = await caught(runMergeWorkflow(["C:\\in\\one.pdf", "C:\\in\\two.pdf"], "c:/IN/one.pdf", fs));
    expect((error as MergeError).code).toBe("invalid-output");
    expect(fs.writes).toEqual([]);
  });

  it("writes nothing when cancelled before the write", async () => {
    const fs = await setup();
    const controller = new AbortController();
    const run = runMergeWorkflow(["C:\\in\\one.pdf", "C:\\in\\two.pdf"], "C:\\out\\merged.pdf", fs, {
      signal: controller.signal,
      onProgress: (progress) => {
        if (progress.stage === "saving") controller.abort();
      },
    });
    await expect(run).rejects.toBeInstanceOf(MergeCancelledError);
    expect(fs.writes).toEqual([]);
  });

  it("writes nothing when an input is invalid", async () => {
    const fs = await setup();
    fs.files.set("C:\\in\\fake.pdf", textBytes("not a pdf"));
    const error = await caught(
      runMergeWorkflow(["C:\\in\\one.pdf", "C:\\in\\fake.pdf"], "C:\\out\\merged.pdf", fs),
    );
    expect(error).toBeInstanceOf(MergeError);
    expect((error as MergeError).code).toBe("not-pdf");
    expect(fs.writes).toEqual([]);
  });

  it("reports a missing input by file name only", async () => {
    const fs = await setup();
    const error = (await caught(
      runMergeWorkflow(["C:\\in\\one.pdf", "C:\\secret folder\\gone.pdf"], "C:\\out\\merged.pdf", fs),
    )) as MergeError;
    expect(error.code).toBe("read-failed");
    expect(error.message).toContain("gone.pdf");
    expect(error.message).not.toContain("secret folder");
  });

  it("rejects inputs that are too large in total before reading them", async () => {
    const fs = await setup();
    fs.sizes.set("C:\\in\\two.pdf", MAX_TOTAL_INPUT_BYTES);
    const error = (await caught(
      runMergeWorkflow(["C:\\in\\one.pdf", "C:\\in\\two.pdf"], "C:\\out\\merged.pdf", fs),
    )) as MergeError;
    expect(error.code).toBe("too-large");
    expect(fs.writes).toEqual([]);
  });

  it("explains a failed write", async () => {
    const fs = await setup();
    fs.failWrite = true;
    const error = (await caught(
      runMergeWorkflow(["C:\\in\\one.pdf", "C:\\in\\two.pdf"], "C:\\out\\merged.pdf", fs),
    )) as MergeError;
    expect(error.code).toBe("write-failed");
    expect(error.message).toContain("merged.pdf");
  });

  it("requires at least two inputs", async () => {
    const fs = await setup();
    const error = (await caught(runMergeWorkflow(["C:\\in\\one.pdf"], "C:\\out\\merged.pdf", fs))) as MergeError;
    expect(error.code).toBe("not-enough-files");
    expect(fs.writes).toEqual([]);
  });
});
