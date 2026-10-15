import { describe, expect, it } from "vitest";
import { chunkRanges, formatRange, parsePageRanges, rangesToIndices } from "./pageRanges";

const ok = (input: string, pageCount = 10) => {
  const result = parsePageRanges(input, pageCount);
  if (!result.ok) throw new Error(result.error);
  return result.ranges;
};
const error = (input: string, pageCount = 10) => {
  const result = parsePageRanges(input, pageCount);
  if (result.ok) throw new Error(`expected an error for "${input}"`);
  return result.error;
};

describe("parsePageRanges", () => {
  it("parses a single page", () => {
    expect(ok("4")).toEqual([{ start: 4, end: 4 }]);
  });

  it("parses a range", () => {
    expect(ok("2-6")).toEqual([{ start: 2, end: 6 }]);
  });

  it("parses a mixed list and keeps its order", () => {
    expect(ok("8-10, 1-2, 5")).toEqual([
      { start: 8, end: 10 },
      { start: 1, end: 2 },
      { start: 5, end: 5 },
    ]);
  });

  it("tolerates whitespace and en dashes", () => {
    expect(ok("  1 - 2 ,5 ,  8–10 ")).toEqual([
      { start: 1, end: 2 },
      { start: 5, end: 5 },
      { start: 8, end: 10 },
    ]);
  });

  it("rejects empty input and empty entries", () => {
    expect(error("")).toMatch(/Enter the pages/);
    expect(error("   ")).toMatch(/Enter the pages/);
    expect(error("1,,3")).toMatch(/Entry 2 is empty/);
    expect(error("1,3,")).toMatch(/Entry 3 is empty/);
  });

  it("rejects malformed tokens", () => {
    expect(error("abc")).toMatch(/not a page number/);
    expect(error("1-")).toMatch(/not a page number/);
    expect(error("1-2-3")).toMatch(/not a page number/);
    expect(error("2.5")).toMatch(/not a page number/);
  });

  it("rejects zero and negative values", () => {
    expect(error("0")).toMatch(/start at 1/);
    expect(error("0-3")).toMatch(/start at 1/);
    expect(error("-3")).toMatch(/start at 1/);
  });

  it("rejects reversed ranges", () => {
    expect(error("5-3")).toMatch(/reversed\. Write it as 3-5/);
  });

  it("rejects pages beyond the end", () => {
    expect(error("11", 10)).toMatch(/Page 11 does not exist\. This PDF has 10 pages/);
    expect(error("9-12", 10)).toMatch(/Page 12 does not exist/);
    expect(error("2", 1)).toMatch(/has 1 page\./);
  });

  it("rejects overlaps and duplicates", () => {
    expect(error("1-3, 2")).toMatch(/Page 2 is selected more than once \("1-3" and "2"\)/);
    expect(error("4, 4")).toMatch(/Page 4 is selected more than once/);
    expect(error("1-5, 5-6")).toMatch(/Page 5/);
  });
});

describe("helpers", () => {
  it("converts ranges to 0-based indices in order", () => {
    expect(rangesToIndices([{ start: 3, end: 3 }, { start: 1, end: 2 }])).toEqual([2, 0, 1]);
  });

  it("chunks pages", () => {
    expect(chunkRanges(5, 2)).toEqual([
      { start: 1, end: 2 },
      { start: 3, end: 4 },
      { start: 5, end: 5 },
    ]);
    expect(chunkRanges(3, 1)).toHaveLength(3);
  });

  it("formats ranges", () => {
    expect(formatRange({ start: 2, end: 2 })).toBe("2");
    expect(formatRange({ start: 2, end: 5 })).toBe("2-5");
  });
});
