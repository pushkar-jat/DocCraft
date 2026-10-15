import { describe, expect, it } from "vitest";
import { directoryOfPath, fileNameFromPath, hasPdfExtension, isSamePath, pathKey } from "./paths";

describe("fileNameFromPath", () => {
  it.each([
    ["C:\\Users\\me\\Documents\\report.pdf", "report.pdf"],
    ["C:/Users/me/Documents/report.pdf", "report.pdf"],
    ["\\\\server\\share\\scans\\scan 01.pdf", "scan 01.pdf"],
    ["/home/me/My Files/a b c.pdf", "a b c.pdf"],
    ["D:\\Work Profile\\Projects\\A very long file name with spaces (final v2).pdf", "A very long file name with spaces (final v2).pdf"],
    ["report.pdf", "report.pdf"],
    ["C:\\folder\\", "folder"],
  ])("%s -> %s", (input, expected) => {
    expect(fileNameFromPath(input)).toBe(expected);
  });
});

describe("directoryOfPath", () => {
  it("keeps the trailing separator", () => {
    expect(directoryOfPath("C:\\Docs\\a.pdf")).toBe("C:\\Docs\\");
    expect(directoryOfPath("/tmp/a.pdf")).toBe("/tmp/");
    expect(directoryOfPath("a.pdf")).toBe("");
  });
});

describe("pathKey / isSamePath", () => {
  it("ignores slash direction, repeated separators, dot segments and case", () => {
    expect(isSamePath("C:\\Docs\\A.pdf", "c:/docs//a.PDF")).toBe(true);
    expect(isSamePath("C:\\Docs\\.\\a.pdf", "C:\\Docs\\a.pdf")).toBe(true);
  });

  it("distinguishes different files", () => {
    expect(isSamePath("C:\\Docs\\a.pdf", "C:\\Docs\\b.pdf")).toBe(false);
    expect(isSamePath("C:\\Docs\\a.pdf", "D:\\Docs\\a.pdf")).toBe(false);
  });

  it("keeps UNC and absolute POSIX roots distinct from relative paths", () => {
    expect(pathKey("\\\\server\\share\\a.pdf")).toBe("//server/share/a.pdf");
    expect(pathKey("/home/a.pdf")).toBe("/home/a.pdf");
    expect(isSamePath("/home/a.pdf", "home/a.pdf")).toBe(false);
  });
});

describe("hasPdfExtension", () => {
  it("accepts .pdf in any case", () => {
    expect(hasPdfExtension("C:\\a\\b.PDF")).toBe(true);
    expect(hasPdfExtension("/a/b.pdf")).toBe(true);
  });

  it("rejects other or missing extensions", () => {
    expect(hasPdfExtension("C:\\a\\b.docx")).toBe(false);
    expect(hasPdfExtension("C:\\a\\pdf")).toBe(false);
    expect(hasPdfExtension("C:\\a.pdf\\notes.txt")).toBe(false);
  });
});
