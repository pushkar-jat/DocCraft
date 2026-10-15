import { describe, expect, it } from "vitest";
import { baseName, extensionOf, formatBytes, joinPath, percentChange, sanitizeFileName, uniqueFilePath } from "./naming";

describe("names and paths", () => {
  it("splits base names and extensions", () => {
    expect(baseName("C:\\docs\\report.final.pdf")).toBe("report.final");
    expect(baseName("README")).toBe("README");
    expect(extensionOf("photo.JPG")).toBe("jpg");
    expect(extensionOf(".hidden")).toBe("");
  });

  it("joins with the folder's separator", () => {
    expect(joinPath("C:\\out", "a.pdf")).toBe("C:\\out\\a.pdf");
    expect(joinPath("C:\\", "a.pdf")).toBe("C:\\a.pdf");
    expect(joinPath("/home/me", "a.pdf")).toBe("/home/me/a.pdf");
  });

  it("sanitizes unsafe names", () => {
    expect(sanitizeFileName('a<b>:c"d/e\\f|g?h*')).toBe("a_b__c_d_e_f_g_h_");
    expect(sanitizeFileName("name. ")).toBe("name");
    expect(sanitizeFileName("CON")).toBe("_CON");
    expect(sanitizeFileName("")).toBe("document");
  });
});

describe("uniqueFilePath", () => {
  it("never returns an existing or reserved path", async () => {
    const existing = new Set(["C:\\out\\report.pdf", "C:\\out\\report (2).pdf"]);
    const exists = async (path: string) => existing.has(path);
    expect(await uniqueFilePath("C:\\out", "report", "pdf", exists)).toBe("C:\\out\\report (3).pdf");
    expect(await uniqueFilePath("C:\\out", "new", "pdf", exists, new Set(["c:/out/new.pdf"]))).toBe("C:\\out\\new (2).pdf");
  });
});

describe("sizes", () => {
  it("formats bytes", () => {
    expect(formatBytes(512)).toBe("512 B");
    expect(formatBytes(2048)).toBe("2.0 KB");
    expect(formatBytes(5 * 1024 * 1024)).toBe("5.00 MB");
  });

  it("computes percentage change, negative when smaller", () => {
    expect(percentChange(1000, 750)).toBe(-25);
    expect(percentChange(1000, 1100)).toBe(10);
    expect(percentChange(0, 10)).toBe(0);
  });
});
