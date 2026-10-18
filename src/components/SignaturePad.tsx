import { useEffect, useRef, useState, type PointerEvent } from "react";
import { fileNameFromPath } from "../lib/paths";
import { bytesToDataUrl } from "../services/pageEditing";
import { IMAGE_FILTER, pickFile, readInput } from "../services/tauriFiles";

export interface SignatureImage {
  png: Uint8Array;
  dataUrl: string;
  /** width / height */
  aspect: number;
}

const FONTS = ["Segoe Script", "Lucida Handwriting", "Brush Script MT", "Ink Free"];

/** Crops a canvas to its non-transparent content and returns it as PNG. */
async function trimmedPng(canvas: HTMLCanvasElement): Promise<SignatureImage | null> {
  const context = canvas.getContext("2d")!;
  const { width, height } = canvas;
  const data = context.getImageData(0, 0, width, height).data;
  let [minX, minY, maxX, maxY] = [width, height, -1, -1];
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (data[(y * width + x) * 4 + 3] > 8) {
        minX = Math.min(minX, x);
        maxX = Math.max(maxX, x);
        minY = Math.min(minY, y);
        maxY = Math.max(maxY, y);
      }
    }
  }
  if (maxX < 0) return null;
  const pad = 6;
  const out = document.createElement("canvas");
  out.width = maxX - minX + 1 + pad * 2;
  out.height = maxY - minY + 1 + pad * 2;
  out.getContext("2d")!.drawImage(canvas, minX - pad, minY - pad, out.width, out.height, 0, 0, out.width, out.height);
  const blob = await new Promise<Blob | null>((resolve) => out.toBlob(resolve, "image/png"));
  if (!blob) return null;
  const png = new Uint8Array(await blob.arrayBuffer());
  return { png, dataUrl: bytesToDataUrl(png, "image/png"), aspect: out.width / out.height };
}

/** Create a signature by drawing, typing or choosing an image. */
export function SignaturePad({ onChange, disabled }: { onChange: (signature: SignatureImage | null) => void; disabled: boolean }) {
  const [mode, setMode] = useState<"draw" | "type" | "image">("draw");
  const [typed, setTyped] = useState("");
  const [font, setFont] = useState(FONTS[0]);
  const [imageName, setImageName] = useState<string | null>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const drawing = useRef(false);
  const [hasInk, setHasInk] = useState(false);

  const clear = () => {
    const c = canvas.current;
    if (c) c.getContext("2d")!.clearRect(0, 0, c.width, c.height);
    setHasInk(false);
    onChange(null);
  };

  useEffect(() => {
    if (mode !== "type") return;
    const c = canvas.current;
    if (!c) return;
    const context = c.getContext("2d")!;
    context.clearRect(0, 0, c.width, c.height);
    if (typed.trim() === "") {
      onChange(null);
      return;
    }
    context.fillStyle = "#14286b";
    context.textBaseline = "middle";
    let size = 96;
    context.font = `${size}px "${font}", cursive`;
    while (context.measureText(typed).width > c.width - 40 && size > 24) {
      size -= 4;
      context.font = `${size}px "${font}", cursive`;
    }
    context.fillText(typed, 20, c.height / 2);
    void trimmedPng(c).then(onChange);
    // onChange is a stable setter from the parent.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, typed, font]);

  const position = (event: PointerEvent<HTMLCanvasElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    return [((event.clientX - rect.left) / rect.width) * event.currentTarget.width, ((event.clientY - rect.top) / rect.height) * event.currentTarget.height] as const;
  };

  const start = (event: PointerEvent<HTMLCanvasElement>) => {
    if (mode !== "draw" || disabled) return;
    drawing.current = true;
    event.currentTarget.setPointerCapture(event.pointerId);
    const context = event.currentTarget.getContext("2d")!;
    context.strokeStyle = "#14286b";
    context.lineWidth = 5;
    context.lineCap = "round";
    context.lineJoin = "round";
    context.beginPath();
    context.moveTo(...position(event));
  };

  const move = (event: PointerEvent<HTMLCanvasElement>) => {
    if (!drawing.current) return;
    const context = event.currentTarget.getContext("2d")!;
    context.lineTo(...position(event));
    context.stroke();
    setHasInk(true);
  };

  const end = () => {
    if (!drawing.current) return;
    drawing.current = false;
    if (canvas.current) void trimmedPng(canvas.current).then(onChange);
  };

  const chooseImage = async () => {
    const path = await pickFile("Select a signature image", IMAGE_FILTER);
    if (!path) return;
    const bytes = await readInput(path, 10 * 1024 * 1024);
    const isPng = bytes[0] === 0x89;
    const dataUrl = bytesToDataUrl(bytes, isPng ? "image/png" : "image/jpeg");
    const image = new Image();
    image.onload = () => onChange({ png: bytes, dataUrl, aspect: image.width / image.height });
    image.src = dataUrl;
    setImageName(fileNameFromPath(path));
  };

  const switchMode = (next: typeof mode) => {
    setMode(next);
    setImageName(null);
    clear();
  };

  return (
    <div className="signature-pad">
      <div className="choice-row" role="radiogroup" aria-label="How to create the signature">
        {(["draw", "type", "image"] as const).map((m) => (
          <label key={m} className="choice">
            <input type="radio" name="sig-mode" checked={mode === m} onChange={() => switchMode(m)} disabled={disabled} />
            {m === "draw" ? "Draw" : m === "type" ? "Type" : "Image"}
          </label>
        ))}
      </div>
      {mode === "image" ? (
        <div className="choice-row">
          <button type="button" className="button button--secondary" onClick={chooseImage} disabled={disabled}>
            {imageName ? "Choose another image…" : "Choose image…"}
          </button>
          <span className="field-help">{imageName ?? "A PNG with a transparent background looks best."}</span>
        </div>
      ) : (
        <>
          {mode === "type" && (
            <div className="choice-row">
              <label className="inline-field">
                Name
                <input className="text-input" style={{ width: "18em" }} value={typed} maxLength={60} onChange={(e) => setTyped(e.target.value)} disabled={disabled} />
              </label>
              <label className="inline-field">
                Style
                <select className="select" value={font} onChange={(e) => setFont(e.target.value)} disabled={disabled}>
                  {FONTS.map((f) => (
                    <option key={f} value={f}>
                      {f}
                    </option>
                  ))}
                </select>
              </label>
            </div>
          )}
          <canvas
            ref={canvas}
            className={`signature-canvas ${mode === "draw" ? "signature-canvas--draw" : ""}`}
            width={900}
            height={260}
            onPointerDown={start}
            onPointerMove={move}
            onPointerUp={end}
            onPointerCancel={end}
            aria-label={mode === "draw" ? "Signature drawing area: draw with the mouse, pen or finger" : "Typed signature preview"}
          />
          {mode === "draw" && (
            <button type="button" className="button button--ghost" onClick={clear} disabled={disabled || !hasInk}>
              Clear
            </button>
          )}
        </>
      )}
    </div>
  );
}
