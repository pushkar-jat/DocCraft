import { useEffect, useRef, useState } from "react";
import { isCancelled, throwIfCancelled } from "../../lib/errors";
import type { PageSizeMode } from "../../lib/images";
import { a4WidthDpi, enhanceDocument } from "../../lib/imageFilters";
import { fileNameFromPath } from "../../lib/paths";
import { getScannerStatus, scanPage, type ScannerStatus } from "../../services/native";
import { ocrImageFiles } from "../../services/operations";
import { chooseSavePath } from "../../services/output";
import { bytesToDataUrl } from "../../services/pageEditing";
import { runPdfWorker } from "../../services/pdfWorkerClient";
import { PDF_FILTER, writeOutput } from "../../services/tauriFiles";
import { useEngines } from "../../state/EnginesContext";
import { useJob } from "../../state/useJob";
import { ArrowDownIcon, ArrowUpIcon, TrashIcon } from "../Icons";
import { JobStatus } from "../JobStatus";
import { ActionBar, ToolLayout } from "../ToolLayout";

interface ScannedPage {
  id: string;
  jpeg: Uint8Array;
  dataUrl: string;
  width: number;
  /** DPI to use for OCR (scanner pages carry their own; camera pages are fitted to A4 width). */
  dpi: number | null;
  source: "scanner" | "camera";
}

let nextPage = 0;

function loadImage(dataUrl: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = reject;
    image.src = dataUrl;
  });
}

async function canvasJpeg(canvas: HTMLCanvasElement): Promise<Uint8Array> {
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.9));
  if (!blob) throw new Error("toBlob failed");
  return new Uint8Array(await blob.arrayBuffer());
}

async function makePage(jpeg: Uint8Array, source: ScannedPage["source"], dpi: number | null): Promise<ScannedPage> {
  const dataUrl = bytesToDataUrl(jpeg, "image/jpeg");
  const image = await loadImage(dataUrl);
  return { id: `page-${nextPage++}`, jpeg, dataUrl, width: image.naturalWidth, dpi, source };
}

/** Rotates a page image 90° clockwise. */
async function rotatePage(page: ScannedPage): Promise<ScannedPage> {
  const image = await loadImage(page.dataUrl);
  const canvas = document.createElement("canvas");
  canvas.width = image.naturalHeight;
  canvas.height = image.naturalWidth;
  const context = canvas.getContext("2d")!;
  context.translate(canvas.width, 0);
  context.rotate(Math.PI / 2);
  context.drawImage(image, 0, 0);
  const jpeg = await canvasJpeg(canvas);
  return { ...(await makePage(jpeg, page.source, page.dpi)), id: page.id };
}

export function ScanView({ onBack }: { onBack: () => void }) {
  const job = useJob();
  const { status: engines } = useEngines();
  const ocrReady = engines?.tesseract.available ?? false;
  const languages = engines?.tesseract.languages ?? [];
  const [mode, setMode] = useState<"scanner" | "camera">("scanner");
  const [scanners, setScanners] = useState<ScannerStatus | null>(null);
  const [pages, setPages] = useState<ScannedPage[]>([]);
  const [pageSize, setPageSize] = useState<PageSizeMode>("a4");
  const [ocr, setOcr] = useState(false);
  const [language, setLanguage] = useState("eng");
  const [enhance, setEnhance] = useState(true);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [streaming, setStreaming] = useState(false);
  const video = useRef<HTMLVideoElement>(null);
  const stream = useRef<MediaStream | null>(null);

  const refreshScanners = () => {
    setScanners(null);
    getScannerStatus()
      .then(setScanners)
      .catch(() => setScanners({ supported: false, scanners: [] }));
  };
  useEffect(refreshScanners, []);

  const stopCamera = () => {
    stream.current?.getTracks().forEach((track) => track.stop());
    stream.current = null;
    setStreaming(false);
  };
  useEffect(() => stopCamera, []);
  useEffect(() => {
    if (mode !== "camera") stopCamera();
  }, [mode]);

  const startCamera = async () => {
    setCameraError(null);
    try {
      const media = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment", width: { ideal: 2560 }, height: { ideal: 1440 } }, audio: false });
      stream.current = media;
      if (video.current) {
        video.current.srcObject = media;
        await video.current.play();
      }
      setStreaming(true);
    } catch {
      setCameraError("The camera could not be started. Check that a camera is connected, not used by another app, and that camera access is allowed in Windows privacy settings.");
    }
  };

  const capture = async () => {
    const element = video.current;
    if (!element || !element.videoWidth) return;
    const canvas = document.createElement("canvas");
    canvas.width = element.videoWidth;
    canvas.height = element.videoHeight;
    const context = canvas.getContext("2d")!;
    context.drawImage(element, 0, 0);
    if (enhance) {
      const data = context.getImageData(0, 0, canvas.width, canvas.height);
      enhanceDocument(data.data);
      context.putImageData(data, 0, 0);
    }
    const page = await makePage(await canvasJpeg(canvas), "camera", null);
    setPages((current) => [...current, { ...page, dpi: a4WidthDpi(page.width) }]);
  };

  const scan = () =>
    job.run(async (context) => {
      context.progress("Waiting for the scan… Use the Windows scan dialog that opened.", null, true);
      try {
        const jpeg = await scanPage(context.signal);
        const page = await makePage(jpeg, "scanner", null);
        setPages((current) => [...current, page]);
        return null;
      } catch (error) {
        if (isCancelled(error)) return null; // closing the scan dialog is not an error
        throw error;
      }
    });

  const move = (id: string, offset: number) =>
    setPages((current) => {
      const from = current.findIndex((p) => p.id === id);
      const to = from + offset;
      if (from < 0 || to < 0 || to >= current.length) return current;
      const next = [...current];
      next.splice(to, 0, next.splice(from, 1)[0]);
      return next;
    });

  const rotate = async (id: string) => {
    const page = pages.find((p) => p.id === id);
    if (!page) return;
    const rotated = await rotatePage(page);
    setPages((current) => current.map((p) => (p.id === id ? rotated : p)));
  };

  const save = () =>
    job.run(async (context) => {
      if (pages.length === 0) return null;
      const output = await chooseSavePath(context, { title: "Save scanned PDF as", suggested: "Scan.pdf", filters: PDF_FILTER, inputs: [], extension: "pdf" });
      if (output === null) return null;
      let pdf: Uint8Array;
      if (ocr && ocrReady) {
        pdf = await ocrImageFiles(
          pages.map((page, i) => ({ name: `page ${i + 1}`, bytes: page.jpeg, dpi: page.dpi ?? undefined })),
          [languages.includes(language) ? language : (languages[0] ?? "eng")],
          { signal: context.signal, onProgress: (p) => context.progress(`Recognizing text on page ${p.current} of ${p.total}…`, (p.current / p.total) * 90) },
        );
      } else {
        context.progress("Building the PDF…");
        const result = await runPdfWorker({ op: "images", images: pages.map((page, i) => ({ name: `page ${i + 1}.jpg`, bytes: page.jpeg })), pageSize }, { signal: context.signal });
        pdf = result.outputs[0];
      }
      throwIfCancelled(context.signal);
      context.progress("Saving…", null, false);
      await writeOutput(output, pdf);
      return {
        title: `Saved ${fileNameFromPath(output)} with ${pages.length} ${pages.length === 1 ? "page" : "pages"}.`,
        details: [ocr && ocrReady ? "The text is searchable (OCR). Check important numbers against the original." : "Pages are images; use OCR to make the text searchable."],
      };
    });

  return (
    <ToolLayout title="Scan to PDF" description="Scan pages with your scanner or camera and save them as one PDF — optionally searchable." onBack={onBack} busy={job.busy}>
      <fieldset className="panel form-panel" disabled={job.busy}>
        <legend className="form-legend">Source</legend>
        <div className="choice-row">
          <label className="choice">
            <input type="radio" name="scan-source" checked={mode === "scanner"} onChange={() => setMode("scanner")} /> Scanner
          </label>
          <label className="choice">
            <input type="radio" name="scan-source" checked={mode === "camera"} onChange={() => setMode("camera")} /> Camera
          </label>
        </div>
        {mode === "scanner" ? (
          <div className="choice-row">
            <button type="button" className="button button--primary" onClick={scan} disabled={job.busy || !scanners?.supported || scanners.scanners.length === 0}>
              Scan a page
            </button>
            <span className="field-help">
              {scanners === null
                ? "Looking for scanners…"
                : !scanners.supported
                  ? "Scanner support is available on Windows only."
                  : scanners.scanners.length === 0
                    ? "No scanner found. Connect and switch on your scanner (or install its driver), then check again."
                    : `Found: ${scanners.scanners.join(", ")}. The Windows scan dialog lets you preview and choose colour and resolution.`}
            </span>
            <button type="button" className="button button--ghost" onClick={refreshScanners}>
              Check again
            </button>
          </div>
        ) : (
          <div className="camera-panel">
            <video ref={video} className={`camera-preview ${streaming ? "" : "camera-preview--off"}`} muted playsInline aria-label="Camera preview" />
            <div className="choice-row">
              {streaming ? (
                <>
                  <button type="button" className="button button--primary" onClick={() => void capture()}>
                    Capture page
                  </button>
                  <button type="button" className="button button--ghost" onClick={stopCamera}>
                    Stop camera
                  </button>
                </>
              ) : (
                <button type="button" className="button button--primary" onClick={() => void startCamera()}>
                  Start camera
                </button>
              )}
              <label className="choice">
                <input type="checkbox" checked={enhance} onChange={(e) => setEnhance(e.target.checked)} /> Document mode (black and white, higher contrast)
              </label>
            </div>
            {cameraError && <p className="field-error">{cameraError}</p>}
            <p className="field-help">The camera picture stays on this computer. Lay the page flat in good light and fill the frame.</p>
          </div>
        )}
      </fieldset>

      <div className="panel">
        <div className="panel-toolbar">
          <span className="panel-count">{pages.length === 0 ? "No pages yet" : `${pages.length} ${pages.length === 1 ? "page" : "pages"}`}</span>
          {pages.length > 0 && (
            <button type="button" className="button button--ghost" onClick={() => setPages([])} disabled={job.busy}>
              Clear
            </button>
          )}
        </div>
        {pages.length > 0 && (
          <ol className="page-grid" aria-label="Scanned pages">
            {pages.map((page, index) => (
              <li key={page.id} className="page-card">
                <div className="page-thumb" aria-hidden="true">
                  <img src={page.dataUrl} alt="" />
                </div>
                <span className="page-label">
                  {index + 1}. {page.source === "scanner" ? "Scanned" : "Camera"}
                </span>
                <span className="page-actions">
                  <button type="button" className="icon-button" onClick={() => move(page.id, -1)} disabled={job.busy || index === 0} aria-label={`Move page ${index + 1} earlier`}>
                    <ArrowUpIcon style={{ transform: "rotate(-90deg)" }} />
                  </button>
                  <button type="button" className="icon-button" onClick={() => move(page.id, 1)} disabled={job.busy || index === pages.length - 1} aria-label={`Move page ${index + 1} later`}>
                    <ArrowDownIcon style={{ transform: "rotate(-90deg)" }} />
                  </button>
                  <button type="button" className="icon-button" onClick={() => void rotate(page.id)} disabled={job.busy} aria-label={`Rotate page ${index + 1} clockwise`}>
                    ⟳
                  </button>
                  <button type="button" className="icon-button icon-button--danger" onClick={() => setPages((c) => c.filter((p) => p.id !== page.id))} disabled={job.busy} aria-label={`Remove page ${index + 1}`}>
                    <TrashIcon />
                  </button>
                </span>
              </li>
            ))}
          </ol>
        )}
      </div>

      <fieldset className="panel form-panel" disabled={job.busy}>
        <legend className="form-legend">Output</legend>
        <div className="choice-row">
          <label className="inline-field">
            Page size
            <select className="select" value={pageSize} onChange={(e) => setPageSize(e.target.value as PageSizeMode)} disabled={ocr}>
              <option value="a4">A4</option>
              <option value="letter">US Letter</option>
              <option value="image">Same as the image</option>
            </select>
          </label>
          <label className="choice">
            <input type="checkbox" checked={ocr && ocrReady} disabled={!ocrReady} onChange={(e) => setOcr(e.target.checked)} /> Make the text searchable (OCR)
          </label>
          {ocr && ocrReady && (
            <label className="inline-field">
              Language
              <select className="select" value={language} onChange={(e) => setLanguage(e.target.value)}>
                {(languages.length ? languages : ["eng"]).map((code) => (
                  <option key={code} value={code}>
                    {code}
                  </option>
                ))}
              </select>
            </label>
          )}
          {!ocrReady && <span className="field-help">OCR needs Tesseract (see the OCR PDF tool).</span>}
        </div>
      </fieldset>

      <JobStatus job={job} />
      <ActionBar hint={pages.length === 0 ? "Scan or capture at least one page." : "Ready. You will choose where to save the PDF next."}>
        <button type="button" className="button button--primary button--large" onClick={save} disabled={job.busy || pages.length === 0}>
          Save PDF
        </button>
      </ActionBar>
    </ToolLayout>
  );
}
