import { useEffect, useState } from "react";
import type { OverlayItem } from "../../lib/annotate";
import { DocError, throwIfCancelled } from "../../lib/errors";
import { normalizedToUser, type NormalizedBox } from "../../lib/pageGeometry";
import { fileNameFromPath } from "../../lib/paths";
import { getCertificateInfo, type CertificateInfo } from "../../services/native";
import { chooseSavePath, suggestedPath } from "../../services/output";
import { bytesToDataUrl, findTerm, renderRedactedPages, signWithCertificate, type PdfRenderer } from "../../services/pageEditing";
import { runPdfWorker } from "../../services/pdfWorkerClient";
import { IMAGE_FILTER, PDF_FILTER, pickFile, readInput, writeOutput } from "../../services/tauriFiles";
import { useJob, type JobContext } from "../../state/useJob";
import { usePdfRenderer } from "../../state/usePdfRenderer";
import { usePdfSource, type PdfSource } from "../../state/usePdfSource";
import { JobStatus } from "../JobStatus";
import { PageEditor, type PlacedItem } from "../PageEditor";
import { SignaturePad, type SignatureImage } from "../SignaturePad";
import { ActionBar, SingleFilePicker, ToolLayout } from "../ToolLayout";

type BackProps = { onBack: () => void };

let nextId = 0;
const newId = () => `item-${nextId++}`;

function hexToRgb(hex: string): [number, number, number] {
  const value = Number.parseInt(hex.slice(1), 16);
  return [((value >> 16) & 255) / 255, ((value >> 8) & 255) / 255, (value & 255) / 255];
}

/** Runs an overlay job in the worker. */
async function overlay(context: JobContext, source: PdfSource, bytes: Uint8Array, items: OverlayItem[]): Promise<Uint8Array> {
  context.progress("Applying your changes…");
  const result = await runPdfWorker({ op: "overlay", input: { name: source.name, bytes }, items }, { signal: context.signal });
  throwIfCancelled(context.signal);
  return result.outputs[0];
}

/** Keeps track of each page's width in points, so text previews use the real size. */
function usePageWidths(renderer: PdfRenderer | null) {
  const [widths, setWidths] = useState<Record<number, number>>({});
  useEffect(() => {
    setWidths({});
    if (!renderer) return;
    let cancelled = false;
    (async () => {
      for (let page = 1; page <= Math.min(renderer.pageCount, 500) && !cancelled; page++) {
        const size = await renderer.pageSize(page);
        if (!cancelled) setWidths((current) => ({ ...current, [page - 1]: size.width }));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [renderer]);
  return widths;
}

// ---------------------------------------------------------------- Edit PDF

type EditItem = PlacedItem &
  (
    | { kind: "text"; text: string; fontSize: number; color: string }
    | { kind: "image"; bytes: Uint8Array; name: string; dataUrl: string }
    | { kind: "rect"; color: string; lineWidth: number }
    | { kind: "highlight"; color: string }
    | { kind: "whiteout" }
  );

type EditTool = "select" | "text" | "image" | "rect" | "highlight" | "whiteout";

const TOOL_LABELS: Record<EditTool, string> = {
  select: "Select / move",
  text: "Text",
  image: "Image",
  rect: "Rectangle",
  highlight: "Highlight",
  whiteout: "White-out",
};

export function EditPdfView({ onBack }: BackProps) {
  const job = useJob();
  const pdf = usePdfSource(job);
  const { renderer, error } = usePdfRenderer(pdf.source);
  const widths = usePageWidths(renderer);
  const [items, setItems] = useState<EditItem[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [tool, setTool] = useState<EditTool>("text");
  const [pendingImage, setPendingImage] = useState<{ bytes: Uint8Array; name: string; dataUrl: string } | null>(null);

  useEffect(() => setItems([]), [pdf.source]);
  const selected = items.find((item) => item.id === selectedId) ?? null;
  const patch = (changes: Partial<EditItem>) => setItems((current) => current.map((item) => (item.id === selectedId ? ({ ...item, ...changes } as EditItem) : item)));

  const chooseImage = () =>
    job.run(async (context) => {
      context.progress("Choose an image in the dialog.", null, false);
      const path = await pickFile("Select an image to add", IMAGE_FILTER);
      if (!path) return null;
      const bytes = await readInput(path, 20 * 1024 * 1024);
      setPendingImage({ bytes, name: fileNameFromPath(path), dataUrl: bytesToDataUrl(bytes, bytes[0] === 0x89 ? "image/png" : "image/jpeg") });
      setTool("image");
      return null;
    });

  const createItem = (page: number, box: NormalizedBox): EditItem | null => {
    const base = { id: newId(), page, box };
    switch (tool) {
      case "text":
        return { ...base, kind: "text", text: "Your text", fontSize: 12, color: "#000000" };
      case "image":
        return pendingImage ? { ...base, kind: "image", ...pendingImage } : null;
      case "rect":
        return { ...base, kind: "rect", color: "#c62828", lineWidth: 2 };
      case "highlight":
        return { ...base, kind: "highlight", color: "#ffeb3b" };
      case "whiteout":
        return { ...base, kind: "whiteout" };
      default:
        return null;
    }
  };

  const renderItem = (item: EditItem) => {
    switch (item.kind) {
      case "text":
        return (
          <span className="page-item-text" style={{ fontSize: `${(item.fontSize / (widths[item.page] ?? 595)) * 100}cqw`, color: item.color }}>
            {item.text}
          </span>
        );
      case "image":
        return <img className="page-item-image" src={item.dataUrl} alt="" />;
      case "rect":
        return <span className="page-item-fill" style={{ border: `${Math.max(1, item.lineWidth / 1.5)}px solid ${item.color}` }} />;
      case "highlight":
        return <span className="page-item-fill" style={{ background: item.color, opacity: 0.4 }} />;
      case "whiteout":
        return <span className="page-item-fill" style={{ background: "#ffffff" }} />;
    }
  };

  const save = () =>
    job.run(async (context) => {
      const source = pdf.source;
      if (!source || items.length === 0) return null;
      const output = await chooseSavePath(context, {
        title: "Save edited PDF as",
        suggested: suggestedPath(source.path, "_edited", "pdf"),
        filters: PDF_FILTER,
        inputs: [source.path],
        extension: "pdf",
      });
      if (output === null) return null;
      const overlays: OverlayItem[] = items.map((item) => {
        switch (item.kind) {
          case "text":
            return { kind: "text", page: item.page, box: item.box, text: item.text, fontSize: item.fontSize, color: hexToRgb(item.color) };
          case "image":
            return { kind: "image", page: item.page, box: item.box, bytes: item.bytes, name: item.name };
          case "rect":
            return { kind: "rect", page: item.page, box: item.box, color: hexToRgb(item.color), lineWidth: item.lineWidth };
          case "highlight":
            return { kind: "highlight", page: item.page, box: item.box, color: hexToRgb(item.color) };
          case "whiteout":
            return { kind: "whiteout", page: item.page, box: item.box };
        }
      });
      const result = await overlay(context, source, await readInput(source.path), overlays);
      context.progress("Saving…", null, false);
      await writeOutput(output, result);
      return {
        title: `Saved ${fileNameFromPath(output)} with ${items.length} ${items.length === 1 ? "change" : "changes"}.`,
        warning: items.some((item) => item.kind === "whiteout")
          ? "White-out only covers content visually. The text underneath can still be copied — use Redact PDF to remove sensitive text for real."
          : undefined,
      };
    });

  return (
    <ToolLayout title="Edit PDF" description="Add text, images, shapes and highlights, or cover parts of a page." onBack={onBack} busy={job.busy}>
      <SingleFilePicker label="Select a PDF" fileName={pdf.source?.name ?? null} detail={pdf.detail} onChoose={pdf.choose} disabled={job.busy} />
      {error && <div className="status status--error" role="alert">{error}</div>}
      {pdf.source && (
        <div className="panel">
          <div className="panel-toolbar">
            <div className="editor-tools" role="toolbar" aria-label="Editing tools">
              {(Object.keys(TOOL_LABELS) as EditTool[]).map((id) => (
                <button key={id} type="button" className="button button--secondary" aria-pressed={tool === id} onClick={() => (id === "image" && !pendingImage ? chooseImage() : setTool(id))} disabled={job.busy}>
                  {TOOL_LABELS[id]}
                </button>
              ))}
            </div>
          </div>
          {selected && (
            <div className="panel-toolbar editor-properties">
              {selected.kind === "text" && (
                <>
                  <label className="inline-field" style={{ flex: 1 }}>
                    Text
                    <textarea className="text-input" rows={2} value={selected.text} onChange={(e) => patch({ text: e.target.value })} />
                  </label>
                  <label className="inline-field">
                    Size
                    <input className="number-input" type="number" min={4} max={120} value={selected.fontSize} onChange={(e) => patch({ fontSize: Math.min(120, Math.max(4, Number(e.target.value) || 12)) })} />
                  </label>
                  <label className="inline-field">
                    Colour
                    <input type="color" value={selected.color} onChange={(e) => patch({ color: e.target.value })} aria-label="Text colour" />
                  </label>
                </>
              )}
              {(selected.kind === "rect" || selected.kind === "highlight") && (
                <label className="inline-field">
                  Colour
                  <input type="color" value={selected.color} onChange={(e) => patch({ color: e.target.value })} aria-label="Colour" />
                </label>
              )}
              {selected.kind === "image" && <span className="field-help">{selected.name}</span>}
              <button type="button" className="button button--ghost" onClick={() => {
                  setItems((c) => c.filter((i) => i.id !== selectedId));
                  setSelectedId(null);
                }}>
                Remove
              </button>
            </div>
          )}
          <PageEditor
            renderer={renderer}
            items={items}
            onChange={setItems}
            createItem={tool === "select" ? null : createItem}
            renderItem={renderItem}
            describeItem={(item) => `${TOOL_LABELS[item.kind]} on page ${item.page + 1}`}
            selectedId={selectedId}
            onSelect={setSelectedId}
            disabled={job.busy}
            hint={
              tool === "select"
                ? "Click an item to select it. Drag to move, drag the corner to resize."
                : tool === "image" && !pendingImage
                  ? "Choose an image first."
                  : `Drag on the page to add: ${TOOL_LABELS[tool].toLowerCase()}. Text uses a Latin font (Helvetica).`
            }
          />
        </div>
      )}
      <JobStatus job={job} />
      <ActionBar hint={!pdf.source ? "Choose a PDF to start." : items.length === 0 ? "Add at least one item to the page." : "Ready. You will choose where to save the edited copy next."}>
        <button type="button" className="button button--primary button--large" onClick={save} disabled={job.busy || !pdf.source || items.length === 0}>
          Save edited PDF
        </button>
      </ActionBar>
    </ToolLayout>
  );
}

// ---------------------------------------------------------------- Redact

export function RedactView({ onBack }: BackProps) {
  const job = useJob();
  const pdf = usePdfSource(job);
  const { renderer, error } = usePdfRenderer(pdf.source);
  const [items, setItems] = useState<PlacedItem[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [term, setTerm] = useState("");

  useEffect(() => setItems([]), [pdf.source]);
  const pages = new Set(items.map((item) => item.page));

  const markAll = () =>
    job.run(async (context) => {
      if (!renderer || term.trim() === "") return null;
      context.progress(`Searching for “${term.trim()}”…`);
      const found = await findTerm(renderer, term, context.signal);
      const added = [...found.entries()].flatMap(([page, boxes]) => boxes.map((box) => ({ id: newId(), page, box })));
      setItems((current) => [...current, ...added]);
      return added.length === 0
        ? { title: `No matches for “${term.trim()}”.`, details: ["Scanned pages have no searchable text — mark those areas by drawing boxes."], tone: "info" }
        : { title: `Marked ${added.length} ${added.length === 1 ? "match" : "matches"} on ${found.size} ${found.size === 1 ? "page" : "pages"}.`, details: ["Check each page: review the boxes before applying."] };
    });

  const apply = () =>
    job.run(async (context) => {
      const source = pdf.source;
      if (!source || !renderer || items.length === 0) return null;
      const output = await chooseSavePath(context, {
        title: "Save redacted PDF as",
        suggested: suggestedPath(source.path, "_redacted", "pdf"),
        filters: PDF_FILTER,
        inputs: [source.path],
        extension: "pdf",
      });
      if (output === null) return null;
      const byPage = new Map<number, NormalizedBox[]>();
      for (const item of items) byPage.set(item.page, [...(byPage.get(item.page) ?? []), item.box]);
      const rendered = await renderRedactedPages(renderer, byPage, {
        signal: context.signal,
        onProgress: (done, total) => context.progress(`Flattening page ${done + 1} of ${total}…`, (done / total) * 80),
      });
      context.progress("Building the redacted PDF…", 85);
      const result = await runPdfWorker({ op: "assembleRedacted", input: { name: source.name, bytes: await readInput(source.path) }, pages: rendered }, { signal: context.signal });
      throwIfCancelled(context.signal);
      context.progress("Saving…", null, false);
      await writeOutput(output, result.outputs[0]);
      return {
        title: `Saved ${fileNameFromPath(output)} with ${items.length} ${items.length === 1 ? "area" : "areas"} redacted on ${byPage.size} ${byPage.size === 1 ? "page" : "pages"}.`,
        details: [
          "Redacted pages were flattened into images: the hidden content is permanently removed, and text on those pages can no longer be selected or searched.",
          "The new file has no metadata, bookmarks or attachments from the original.",
        ],
      };
    });

  return (
    <ToolLayout title="Redact PDF" description="Permanently remove sensitive text and images — not just cover them." onBack={onBack} busy={job.busy}>
      <SingleFilePicker label="Select a PDF" fileName={pdf.source?.name ?? null} detail={pdf.detail} onChoose={pdf.choose} disabled={job.busy} />
      {error && <div className="status status--error" role="alert">{error}</div>}
      {pdf.source && (
        <div className="panel">
          <div className="panel-toolbar">
            <label className="inline-field" style={{ flex: 1 }}>
              Find
              <input className="text-input" value={term} placeholder="e.g. a name, account number or email" onChange={(e) => setTerm(e.target.value)} onKeyDown={(e) => e.key === "Enter" && markAll()} />
            </label>
            <button type="button" className="button button--secondary" onClick={markAll} disabled={job.busy || !renderer || term.trim() === ""}>
              Mark all matches
            </button>
            {items.length > 0 && (
              <button type="button" className="button button--ghost" onClick={() => setItems([])} disabled={job.busy}>
                Clear all
              </button>
            )}
          </div>
          <PageEditor
            renderer={renderer}
            items={items}
            onChange={setItems}
            createItem={(page, box) => ({ id: newId(), page, box })}
            renderItem={() => <span className="page-item-fill" style={{ background: "#000", opacity: 0.85 }} />}
            describeItem={(item) => `Redaction area on page ${item.page + 1}`}
            selectedId={selectedId}
            onSelect={setSelectedId}
            disabled={job.busy}
            hint="Drag over anything you want removed. Boxes can be moved, resized or deleted (select one and press Delete)."
          />
        </div>
      )}
      <JobStatus job={job} />
      <ActionBar
        hint={
          !pdf.source
            ? "Choose a PDF to start."
            : items.length === 0
              ? "Mark at least one area to redact."
              : `${items.length} ${items.length === 1 ? "area" : "areas"} on ${pages.size} ${pages.size === 1 ? "page" : "pages"}. The original file is not changed.`
        }
      >
        <button type="button" className="button button--primary button--large" onClick={apply} disabled={job.busy || !pdf.source || !renderer || items.length === 0}>
          Redact and save
        </button>
      </ActionBar>
    </ToolLayout>
  );
}

// ---------------------------------------------------------------- Sign

export function SignView({ onBack }: BackProps) {
  const job = useJob();
  const pdf = usePdfSource(job);
  const { renderer, error } = usePdfRenderer(pdf.source);
  const [signature, setSignature] = useState<SignatureImage | null>(null);
  const [placement, setPlacement] = useState<PlacedItem[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [withDate, setWithDate] = useState(true);
  const [useCertificate, setUseCertificate] = useState(false);
  const [certificate, setCertificate] = useState<{ name: string; bytes: Uint8Array } | null>(null);
  const [password, setPassword] = useState("");
  const [certInfo, setCertInfo] = useState<CertificateInfo | null>(null);
  const [reason, setReason] = useState("");
  const [location, setLocation] = useState("");

  useEffect(() => setPlacement([]), [pdf.source]);
  useEffect(() => setCertInfo(null), [certificate, password]);

  const now = Date.now() / 1000;
  const certProblem = !useCertificate
    ? null
    : !certificate
      ? "Choose your certificate file (.pfx or .p12)."
      : !certInfo
        ? "Check the certificate first."
        : certInfo.validTo < now
          ? "This certificate has expired."
          : certInfo.validFrom > now
            ? "This certificate is not valid yet."
            : null;
  const visual = signature !== null && placement.length > 0;
  const blocker = !pdf.source ? "Choose a PDF to start." : !visual && !useCertificate ? "Create your signature and drag a box on the page where it should go." : certProblem;

  const chooseCertificate = () =>
    job.run(async (context) => {
      context.progress("Choose your certificate in the dialog.", null, false);
      const path = await pickFile("Select your certificate", [{ name: "Certificates (PKCS#12)", extensions: ["pfx", "p12"] }]);
      if (path) setCertificate({ name: fileNameFromPath(path), bytes: await readInput(path, 1024 * 1024) });
      return null;
    });

  const checkCertificate = () =>
    job.run(async (context) => {
      if (!certificate) return null;
      context.progress("Opening the certificate…");
      setCertInfo(await getCertificateInfo(certificate.bytes, password));
      return null;
    });

  const sign = () =>
    job.run(async (context) => {
      const source = pdf.source;
      if (!source || !renderer) return null;
      const output = await chooseSavePath(context, {
        title: "Save signed PDF as",
        suggested: suggestedPath(source.path, "_signed", "pdf"),
        filters: PDF_FILTER,
        inputs: [source.path],
        extension: "pdf",
      });
      if (output === null) return null;
      let bytes = await readInput(source.path);
      const placed = placement[0];
      if (visual && placed) {
        const items: OverlayItem[] = [{ kind: "image", page: placed.page, box: placed.box, bytes: signature!.png, name: "signature" }];
        if (withDate) {
          const below = placed.box.y + placed.box.height + 0.035 <= 1;
          const date = new Date().toLocaleDateString(undefined, { year: "numeric", month: "long", day: "numeric" });
          items.push({
            kind: "text",
            page: placed.page,
            box: { x: placed.box.x, y: below ? placed.box.y + placed.box.height : placed.box.y - 0.03, width: Math.max(placed.box.width, 0.2), height: 0.03 },
            text: `Signed ${date}${certInfo ? ` by ${certInfo.subject}` : ""}`,
            fontSize: 8,
            color: [0.2, 0.2, 0.2],
          });
        }
        bytes = await overlay(context, source, bytes, items);
      }
      if (useCertificate && certificate) {
        context.progress("Signing with your certificate…");
        let rect: [number, number, number, number] | null = null;
        let page = 0;
        if (visual && placed) {
          const geometry = await renderer.geometry(placed.page + 1);
          const user = normalizedToUser(geometry.rotation, geometry.crop, placed.box).rect;
          rect = [user.x, user.y, user.x + user.width, user.y + user.height];
          page = placed.page;
        }
        bytes = await signWithCertificate(bytes, { p12: certificate.bytes, password, page, rect, reason, location }, context.signal);
      }
      throwIfCancelled(context.signal);
      if (!visual && !useCertificate) throw new DocError("invalid-range", "Nothing to sign.");
      context.progress("Saving…", null, false);
      await writeOutput(output, bytes);
      return {
        title: `Saved ${fileNameFromPath(output)}.`,
        details: [
          visual ? "Your signature image was placed on the page." : "",
          useCertificate ? `Digitally signed with ${certInfo?.subject ?? "your certificate"} (PAdES, SHA-256).` : "This is a visual signature only, not a certificate-based digital signature.",
        ].filter(Boolean),
        warning: useCertificate
          ? "Do not edit the signed file afterwards: any change invalidates the digital signature." + (certInfo?.selfSigned ? " Your certificate is self-signed, so readers will show the signer as unverified." : "")
          : undefined,
      };
    });

  return (
    <ToolLayout title="Sign PDF" description="Add your handwritten signature, and optionally a certificate-based digital signature." onBack={onBack} busy={job.busy}>
      <SingleFilePicker label="Select a PDF" fileName={pdf.source?.name ?? null} detail={pdf.detail} onChoose={pdf.choose} disabled={job.busy} />
      {error && <div className="status status--error" role="alert">{error}</div>}
      {pdf.source && (
        <>
          <fieldset className="panel form-panel" disabled={job.busy}>
            <legend className="form-legend">1. Your signature</legend>
            <SignaturePad onChange={setSignature} disabled={job.busy} />
            <label className="choice">
              <input type="checkbox" checked={withDate} onChange={(e) => setWithDate(e.target.checked)} /> Add the date under the signature
            </label>
          </fieldset>
          <div className="panel">
            <div className="panel-toolbar">
              <span className="panel-count">2. Place it on the page</span>
            </div>
            <PageEditor
              renderer={renderer}
              items={placement}
              onChange={(next) => setPlacement(next.slice(-1))}
              createItem={signature ? (page, box) => ({ id: newId(), page, box }) : null}
              renderItem={() => (signature ? <img className="page-item-image" src={signature.dataUrl} alt="" /> : null)}
              describeItem={(item) => `Signature on page ${item.page + 1}`}
              selectedId={selectedId}
              onSelect={setSelectedId}
              disabled={job.busy}
              hint={signature ? "Drag a box where the signature should appear. Drawing a new box replaces the old one." : "Create your signature above first."}
            />
          </div>
          <fieldset className="panel form-panel" disabled={job.busy}>
            <legend className="form-legend">3. Certificate (optional)</legend>
            <label className="choice">
              <input type="checkbox" checked={useCertificate} onChange={(e) => setUseCertificate(e.target.checked)} /> Also sign digitally with my certificate (.pfx / .p12)
            </label>
            {useCertificate && (
              <>
                <div className="choice-row">
                  <button type="button" className="button button--secondary" onClick={chooseCertificate}>
                    {certificate ? "Choose another certificate…" : "Choose certificate…"}
                  </button>
                  <span className="field-help">{certificate?.name ?? "Your certificate file, as issued by your organisation or a certificate authority."}</span>
                </div>
                <div className="choice-row">
                  <label className="inline-field">
                    Certificate password
                    <input className="text-input" style={{ width: "16em" }} type="password" autoComplete="off" value={password} onChange={(e) => setPassword(e.target.value)} />
                  </label>
                  <button type="button" className="button button--secondary" onClick={checkCertificate} disabled={!certificate}>
                    Check certificate
                  </button>
                </div>
                {certInfo && (
                  <div className={`status ${certProblem ? "status--error" : certInfo.selfSigned ? "status--warning" : "status--success"}`} role="status">
                    <strong>{certInfo.subject}</strong> · issued by {certInfo.issuer} · {certInfo.keyType}
                    <br />
                    Valid {new Date(certInfo.validFrom * 1000).toLocaleDateString()} – {new Date(certInfo.validTo * 1000).toLocaleDateString()}
                    {certInfo.selfSigned && <> · Self-signed: PDF readers will show the signature as valid but the signer as unverified.</>}
                  </div>
                )}
                <div className="choice-row">
                  <label className="inline-field">
                    Reason
                    <input className="text-input" style={{ width: "14em" }} value={reason} placeholder="e.g. Approved" onChange={(e) => setReason(e.target.value)} />
                  </label>
                  <label className="inline-field">
                    Location
                    <input className="text-input" style={{ width: "14em" }} value={location} placeholder="e.g. Pune" onChange={(e) => setLocation(e.target.value)} />
                  </label>
                </div>
              </>
            )}
          </fieldset>
        </>
      )}
      <JobStatus job={job} />
      <ActionBar hint={blocker ?? "Ready. You will choose where to save the signed copy next."}>
        <button type="button" className="button button--primary button--large" onClick={sign} disabled={job.busy || blocker !== null}>
          Sign PDF
        </button>
      </ActionBar>
    </ToolLayout>
  );
}
