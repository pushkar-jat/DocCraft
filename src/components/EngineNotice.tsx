import { useEngines } from "../state/EnginesContext";

const GUIDANCE = {
  libreOffice: {
    name: "LibreOffice",
    purpose: "Word ↔ PDF conversion uses LibreOffice, a free office suite, running on this computer.",
    install: "Install LibreOffice from libreoffice.org (or with: winget install TheDocumentFoundation.LibreOffice), then click Check again.",
  },
  tesseract: {
    name: "Tesseract OCR",
    purpose: "Text recognition uses Tesseract, a free OCR engine, running on this computer.",
    install:
      "Install Tesseract (Windows: the UB Mannheim build, or winget install UB-Mannheim.TesseractOCR) including the language data you need, then click Check again.",
  },
} as const;

/** Readiness check for an external local engine. Renders nothing when the engine is available. */
export function EngineNotice({ engine }: { engine: keyof typeof GUIDANCE }) {
  const { status, checking, refresh } = useEngines();
  const info = status?.[engine];
  if (info?.available) {
    return null;
  }
  const guide = GUIDANCE[engine];
  return (
    <div className="status status--warning" role="status">
      <div className="status-row">
        <div>
          <strong>{checking ? `Checking for ${guide.name}…` : `${guide.name} was not found.`}</strong>
          {!checking && (
            <>
              <p className="status-text">{guide.purpose}</p>
              <p className="status-text">{guide.install}</p>
              {engine === "tesseract" && info?.path && <p className="status-text">Tesseract was found, but no OCR language data is installed.</p>}
            </>
          )}
        </div>
        <button type="button" className="button button--secondary" onClick={refresh} disabled={checking}>
          Check again
        </button>
      </div>
    </div>
  );
}
