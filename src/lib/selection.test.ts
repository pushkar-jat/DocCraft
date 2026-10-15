import { describe, expect, it } from "vitest";
import {
  addFiles,
  mergeBlocker,
  moveFile,
  removeFile,
  suggestOutputPath,
  validateOutputPath,
  type SelectedFile,
} from "./selection";

const names = (files: SelectedFile[]) => files.map((file) => file.name);

describe("addFiles", () => {
  it("adds files in picked order with readable names", () => {
    const result = addFiles([], ["C:\\docs\\b.pdf", "C:\\docs\\a.pdf"]);
    expect(names(result.files)).toEqual(["b.pdf", "a.pdf"]);
    expect(result.added).toBe(2);
    expect(result.duplicates).toEqual([]);
  });

  it("does not add a path that is already selected", () => {
    const first = addFiles([], ["C:\\docs\\a.pdf"]);
    const second = addFiles(first.files, ["C:\\docs\\a.pdf", "C:\\docs\\b.pdf"]);
    expect(names(second.files)).toEqual(["a.pdf", "b.pdf"]);
    expect(second.added).toBe(1);
    expect(second.duplicates).toEqual(["a.pdf"]);
  });

  it("treats differently spelled paths to the same file as duplicates", () => {
    const result = addFiles([], ["C:\\Docs\\A.pdf", "c:/docs/a.pdf"]);
    expect(result.files).toHaveLength(1);
    expect(result.duplicates).toEqual(["a.pdf"]);
  });

  it("keeps files with the same name in different folders", () => {
    const result = addFiles([], ["C:\\one\\scan.pdf", "C:\\two\\scan.pdf"]);
    expect(result.files).toHaveLength(2);
  });

  it("skips paths without a .pdf extension", () => {
    const result = addFiles([], ["C:\\docs\\a.pdf", "C:\\docs\\notes.docx"]);
    expect(names(result.files)).toEqual(["a.pdf"]);
    expect(result.rejected).toEqual(["notes.docx"]);
  });

  it("leaves the list unchanged when the dialog is cancelled (no paths)", () => {
    const current = addFiles([], ["C:\\a.pdf"]).files;
    const result = addFiles(current, []);
    expect(result.files).toEqual(current);
    expect(result.added).toBe(0);
  });
});

describe("removeFile", () => {
  it("removes only the matching file", () => {
    const files = addFiles([], ["C:\\a.pdf", "C:\\b.pdf", "C:\\c.pdf"]).files;
    expect(names(removeFile(files, files[1].id))).toEqual(["a.pdf", "c.pdf"]);
  });
});

describe("moveFile", () => {
  const files = addFiles([], ["C:\\a.pdf", "C:\\b.pdf", "C:\\c.pdf"]).files;

  it("moves a file up", () => {
    expect(names(moveFile(files, files[1].id, -1))).toEqual(["b.pdf", "a.pdf", "c.pdf"]);
  });

  it("moves a file down", () => {
    expect(names(moveFile(files, files[0].id, 1))).toEqual(["b.pdf", "a.pdf", "c.pdf"]);
  });

  it("ignores moves past either end", () => {
    expect(names(moveFile(files, files[0].id, -1))).toEqual(["a.pdf", "b.pdf", "c.pdf"]);
    expect(names(moveFile(files, files[2].id, 1))).toEqual(["a.pdf", "b.pdf", "c.pdf"]);
  });

  it("ignores unknown ids and does not mutate the input", () => {
    const copy = [...files];
    moveFile(files, files[0].id, 1);
    expect(files).toEqual(copy);
    expect(names(moveFile(files, "missing", 1))).toEqual(["a.pdf", "b.pdf", "c.pdf"]);
  });
});

describe("mergeBlocker", () => {
  it("blocks merging with zero or one file", () => {
    expect(mergeBlocker([])).toMatch(/at least 2/);
    expect(mergeBlocker(addFiles([], ["C:\\a.pdf"]).files)).toMatch(/one more/);
  });

  it("allows merging with two or more files", () => {
    expect(mergeBlocker(addFiles([], ["C:\\a.pdf", "C:\\b.pdf"]).files)).toBeNull();
  });
});

describe("validateOutputPath", () => {
  const inputs = ["C:\\docs\\a.pdf", "C:\\docs\\b.pdf"];

  it("accepts a new .pdf path", () => {
    expect(validateOutputPath("C:\\docs\\merged.pdf", inputs)).toBeNull();
  });

  it("rejects an output that is one of the inputs, however it is spelled", () => {
    expect(validateOutputPath("C:\\docs\\a.pdf", inputs)).toMatch(/cannot replace/);
    expect(validateOutputPath("c:/DOCS/b.pdf", inputs)).toMatch(/cannot replace/);
  });

  it("rejects an output without a .pdf extension", () => {
    expect(validateOutputPath("C:\\docs\\merged", inputs)).toMatch(/\.pdf/);
  });
});

describe("suggestOutputPath", () => {
  it("suggests merged.pdf next to the first input", () => {
    expect(suggestOutputPath(["C:\\docs\\a.pdf", "D:\\b.pdf"])).toBe("C:\\docs\\merged.pdf");
  });

  it("never suggests one of the inputs", () => {
    expect(suggestOutputPath(["C:\\docs\\merged.pdf", "C:\\docs\\b.pdf"])).toBe("C:\\docs\\merged (1).pdf");
  });
});
