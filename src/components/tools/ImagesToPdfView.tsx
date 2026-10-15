import { useState } from "react";
import { DocError, throwIfCancelled } from "../../lib/errors";
import type { PageSizeMode } from "../../lib/images";
import { directoryOfPath, fileNameFromPath } from "../../lib/paths";
import { addFiles, hasExtension, moveFile, removeFile, type SelectedFile } from "../../lib/selection";
import { chooseSavePath } from "../../services/output";
import { runPdfWorker } from "../../services/pdfWorkerClient";
import { IMAGE_FILTER, PDF_FILTER, pickFiles, readInput, writeOutput } from "../../services/tauriFiles";
import { useJob } from "../../state/useJob";
import { FileList } from "../FileList";
import { PlusIcon } from "../Icons";
import { JobStatus } from "../JobStatus";
import { ActionBar, ToolLayout } from "../ToolLayout";

const IMAGE_EXTENSIONS = ["jpg", "jpeg", "png"];
/** Images are embedded in memory; keep the total reasonable. */
const MAX_TOTAL_IMAGE_BYTES = 512 * 1024 * 1024;

export function ImagesToPdfView({ onBack }: { onBack: () => void }) {
  const job = useJob();
  const [files, setFiles] = useState<SelectedFile[]>([]);
  const [notice, setNotice] = useState<string | null>(null);
  const [pageSize, setPageSize] = useState<PageSizeMode>("a4");

  const add = () =>
    job.run(async (context) => {
      context.progress("Choose images in the dialog.", null, false);
      const paths = await pickFiles("Select images", IMAGE_FILTER);
      const result = addFiles(files, paths, hasExtension(IMAGE_EXTENSIONS));
      setFiles(result.files);
      const skipped = [...result.duplicates.map((name) => `${name} (already added)`), ...result.rejected.map((name) => `${name} (not JPEG/PNG)`)];
      setNotice(skipped.length ? `Skipped: ${skipped.join(", ")}.` : null);
      return null;
    });

  const create = () =>
    job.run(async (context) => {
      const output = await chooseSavePath(context, {
        title: "Save PDF as",
        suggested: `${directoryOfPath(files[0].path)}images.pdf`,
        filters: PDF_FILTER,
        inputs: files.map((file) => file.path),
        extension: "pdf",
      });
      if (output === null) return null;
      const images = [];
      let total = 0;
      for (const [index, file] of files.entries()) {
        throwIfCancelled(context.signal);
        context.progress(`Reading image ${index + 1} of ${files.length}…`, (index / files.length) * 40);
        const bytes = await readInput(file.path);
        total += bytes.length;
        if (total > MAX_TOTAL_IMAGE_BYTES) {
          throw new DocError("too-large", "The selected images are larger than 512 MB in total. Create the PDF from fewer images.");
        }
        images.push({ name: file.name, bytes });
      }
      const result = await runPdfWorker(
        { op: "images", images, pageSize },
        { signal: context.signal, onProgress: (p) => context.progress(`Adding image ${p.current} of ${p.total}…`, 40 + (p.current / p.total) * 55) },
      );
      throwIfCancelled(context.signal);
      context.progress("Saving…", null, false);
      await writeOutput(output, result.outputs[0]);
      return { title: `Created ${fileNameFromPath(output)} with ${result.pageCount} ${result.pageCount === 1 ? "page" : "pages"}.` };
    });

  return (
    <ToolLayout
      title="Images to PDF"
      description="Combine JPEG and PNG images into one PDF, one image per page, in the order shown."
      onBack={onBack}
      busy={job.busy}
    >
      <div className="panel">
        <div className="panel-toolbar">
          <span className="panel-count">{files.length === 0 ? "No images selected" : `${files.length} ${files.length === 1 ? "image" : "images"}`}</span>
          <div className="toolbar-actions">
            <label className="inline-field">
              Page size
              <select className="select" value={pageSize} onChange={(event) => setPageSize(event.target.value as PageSizeMode)} disabled={job.busy}>
                <option value="a4">A4 (fit image)</option>
                <option value="letter">US Letter (fit image)</option>
                <option value="image">Same as image</option>
              </select>
            </label>
            <button type="button" className="button button--secondary" onClick={add} disabled={job.busy}>
              <PlusIcon /> Add images
            </button>
          </div>
        </div>
        {notice && (
          <p className="notice" role="status">
            {notice}
          </p>
        )}
        {files.length === 0 ? (
          <div className="empty-state">
            <p className="empty-title">Add the images you want in the PDF.</p>
            <p className="empty-text">Photos are rotated according to their camera orientation.</p>
          </div>
        ) : (
          <FileList
            files={files}
            disabled={job.busy}
            onMove={(id, offset) => setFiles((current) => moveFile(current, id, offset))}
            onRemove={(id) => setFiles((current) => removeFile(current, id))}
          />
        )}
      </div>
      <JobStatus job={job} />
      <ActionBar hint={files.length ? "Ready." : "Add at least one image."}>
        <button type="button" className="button button--primary button--large" onClick={create} disabled={job.busy || files.length === 0}>
          Create PDF
        </button>
      </ActionBar>
    </ToolLayout>
  );
}
