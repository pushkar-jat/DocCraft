import { PDFDocument } from "pdf-lib";
import { describe, expect, it } from "vitest";
import { jpeg4x2, png, withExifOrientation } from "../test/imageFixtures";
import { textBytes } from "../test/fixtures";
import { CancelledError, DocError } from "./errors";
import { detectImageKind, imagesToPdf, layoutImage, orientationMatrix, orientedSize, readJpegOrientation } from "./images";

async function pageSizes(bytes: Uint8Array) {
  const doc = await PDFDocument.load(bytes);
  return doc.getPages().map((page) => [Math.round(page.getWidth()), Math.round(page.getHeight())]);
}

describe("image detection and EXIF", () => {
  it("detects JPEG and PNG by content, not name", () => {
    expect(detectImageKind(jpeg4x2())).toBe("jpeg");
    expect(detectImageKind(png(2, 2))).toBe("png");
    expect(detectImageKind(textBytes("GIF89a"))).toBeNull();
  });

  it("reads the EXIF orientation in both byte orders", () => {
    expect(readJpegOrientation(jpeg4x2())).toBe(1);
    expect(readJpegOrientation(withExifOrientation(jpeg4x2(), 6))).toBe(6);
    expect(readJpegOrientation(withExifOrientation(jpeg4x2(), 8, true))).toBe(8);
  });

  it("swaps width and height for rotated orientations", () => {
    expect(orientedSize(1, 4, 2)).toEqual([4, 2]);
    expect(orientedSize(6, 4, 2)).toEqual([2, 4]);
  });

  it("maps the stored image box onto the upright display box for every orientation", () => {
    const w = 4;
    const h = 2;
    for (let orientation = 1; orientation <= 8; orientation++) {
      const [a, b, c, d, e, f] = orientationMatrix(orientation, w, h);
      const [dw, dh] = orientedSize(orientation, w, h);
      const corners = [[0, 0], [w, 0], [0, h], [w, h]].map(([u, v]) => [a * u + c * v + e, b * u + d * v + f]);
      const xs = corners.map(([x]) => x).sort((p, q) => p - q);
      const ys = corners.map(([, y]) => y).sort((p, q) => p - q);
      expect([xs[0], xs[3], ys[0], ys[3]], `orientation ${orientation}`).toEqual([0, dw, 0, dh]);
    }
  });

  it("rotates the top-left stored pixel to the top-right for orientation 6", () => {
    // Stored top-left corner is (u=0, v=h) in PDF space; after 90° CW it must end up top-right.
    const [a, b, c, d, e, f] = orientationMatrix(6, 4, 2);
    expect([a * 0 + c * 2 + e, b * 0 + d * 2 + f]).toEqual([2, 4]);
  });
});

describe("layoutImage", () => {
  it("uses the image size at 96 dpi", () => {
    expect(layoutImage("image", 800, 600)).toMatchObject({ pageWidth: 600, pageHeight: 450, x: 0, y: 0 });
  });

  it("fits large images on A4 and picks landscape for wide images", () => {
    const layout = layoutImage("a4", 4000, 3000);
    expect(Math.round(layout.pageWidth)).toBe(842);
    expect(layout.scale * 4000).toBeLessThanOrEqual(842 - 72 + 0.01);
  });

  it("does not enlarge small images", () => {
    expect(layoutImage("letter", 100, 100).scale).toBe(0.75);
  });
});

describe("imagesToPdf", () => {
  it("creates one page per image in order, honouring EXIF rotation", async () => {
    const result = await imagesToPdf(
      [
        { name: "wide.jpg", bytes: jpeg4x2() },
        { name: "rotated.jpg", bytes: withExifOrientation(jpeg4x2(), 6) },
        { name: "square.png", bytes: png(8, 8) },
      ],
      { pageSize: "image" },
    );
    expect(result.pageCount).toBe(3);
    expect(await pageSizes(result.bytes)).toEqual([
      [3, 2],
      [2, 3],
      [6, 6],
    ]);
  });

  it("rejects files that are not images, naming the file", async () => {
    const error = await imagesToPdf([{ name: "notes.png", bytes: textBytes("hello") }], { pageSize: "a4" }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(DocError);
    expect((error as DocError).code).toBe("invalid-image");
    expect((error as DocError).message).toContain("notes.png");
  });

  it("rejects damaged images with a valid signature", async () => {
    const broken = jpeg4x2().slice(0, 30);
    await expect(imagesToPdf([{ name: "broken.jpg", bytes: broken }], { pageSize: "a4" })).rejects.toMatchObject({ code: "invalid-image" });
  });

  it("requires at least one image and honours cancellation", async () => {
    await expect(imagesToPdf([], { pageSize: "a4" })).rejects.toMatchObject({ code: "not-enough-files" });
    const controller = new AbortController();
    controller.abort();
    await expect(imagesToPdf([{ name: "a.png", bytes: png(2, 2) }], { pageSize: "a4", signal: controller.signal })).rejects.toBeInstanceOf(
      CancelledError,
    );
  });
});
