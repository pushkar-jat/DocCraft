import { useId, useState } from "react";
import { throwIfCancelled } from "../../lib/errors";
import { fileNameFromPath } from "../../lib/paths";
import { protectPdf, repairPdf, unlockPdf } from "../../services/operations";
import { chooseSavePath, suggestedPath } from "../../services/output";
import { PDF_FILTER, readInput, writeOutput } from "../../services/tauriFiles";
import { useJob } from "../../state/useJob";
import { usePdfSource } from "../../state/usePdfSource";
import { PdfToolShell } from "./PdfToolShell";

type BackProps = { onBack: () => void };

function PasswordField({ label, value, onChange, help, autoComplete = "new-password" }: { label: string; value: string; onChange: (value: string) => void; help?: string; autoComplete?: string }) {
  const id = useId();
  const [visible, setVisible] = useState(false);
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      <div className="choice-row">
        <input
          id={id}
          className="text-input"
          style={{ maxWidth: "22em" }}
          type={visible ? "text" : "password"}
          value={value}
          autoComplete={autoComplete}
          spellCheck={false}
          onChange={(event) => onChange(event.target.value)}
          aria-describedby={help ? `${id}-help` : undefined}
        />
        <label className="choice">
          <input type="checkbox" checked={visible} onChange={(event) => setVisible(event.target.checked)} /> Show
        </label>
      </div>
      {help && (
        <p id={`${id}-help`} className="field-help">
          {help}
        </p>
      )}
    </div>
  );
}

// ---------------------------------------------------------------- Protect

export function ProtectView({ onBack }: BackProps) {
  const job = useJob();
  const pdf = usePdfSource(job);
  const [open, setOpen] = useState("");
  const [confirm, setConfirm] = useState("");
  const [owner, setOwner] = useState("");
  const [printing, setPrinting] = useState(true);
  const [copying, setCopying] = useState(false);
  const [editing, setEditing] = useState(false);

  const blocker =
    open === "" && owner === ""
      ? "Enter a password to open the PDF, a permissions password, or both."
      : open !== confirm
        ? "The two open passwords do not match."
        : open !== "" && open.length < 4
          ? "Use at least 4 characters for the open password."
          : owner !== "" && owner === open
            ? "Use a different permissions password, or leave it empty."
            : null;

  return (
    <PdfToolShell
      title="Protect PDF"
      description="Encrypt a PDF with a password (AES-256) and choose what people may do with it."
      onBack={onBack}
      job={job}
      source={pdf.source}
      sourceDetail={pdf.detail}
      onChoose={pdf.choose}
      actionLabel="Protect PDF"
      blocker={blocker}
      notice={
        <div className="status status--info">
          <strong>Keep your password safe.</strong> DocCraft cannot recover a forgotten password — nobody can, which is the point of encryption.
        </div>
      }
      onRun={() =>
        job.run(async (context) => {
          const source = pdf.source;
          if (!source) return null;
          const output = await chooseSavePath(context, {
            title: "Save protected PDF as",
            suggested: suggestedPath(source.path, "_protected", "pdf"),
            filters: PDF_FILTER,
            inputs: [source.path],
            extension: "pdf",
          });
          if (output === null) return null;
          context.progress("Encrypting…");
          const result = await protectPdf(
            await readInput(source.path),
            { openPassword: open, permissionsPassword: owner, allowPrinting: printing, allowCopying: copying, allowEditing: editing },
            { signal: context.signal },
          );
          throwIfCancelled(context.signal);
          context.progress("Saving…", null, false);
          await writeOutput(output, result);
          const allowed = [printing && "printing", copying && "copying text", editing && "editing"].filter(Boolean).join(", ") || "nothing beyond viewing";
          return {
            title: `Saved ${fileNameFromPath(output)} (AES-256).`,
            details: [open ? "A password is needed to open it." : "It opens without a password.", `Allowed: ${allowed}.`],
            warning: "Permission limits are honoured by standard PDF readers but are not enforced by the encryption itself; only the open password protects the content.",
          };
        })
      }
    >
      {() => (
        <>
          <PasswordField label="Password to open the PDF" value={open} onChange={setOpen} help="Leave empty to let anyone open it but still apply the restrictions below." />
          <PasswordField label="Repeat the open password" value={confirm} onChange={setConfirm} />
          <PasswordField
            label="Permissions password (optional)"
            value={owner}
            onChange={setOwner}
            help="Needed to change the restrictions later. If empty, a random one is used and the restrictions cannot be changed."
          />
          <div className="choice-row" role="group" aria-label="Allowed actions">
            <label className="choice">
              <input type="checkbox" checked={printing} onChange={(event) => setPrinting(event.target.checked)} /> Allow printing
            </label>
            <label className="choice">
              <input type="checkbox" checked={copying} onChange={(event) => setCopying(event.target.checked)} /> Allow copying text
            </label>
            <label className="choice">
              <input type="checkbox" checked={editing} onChange={(event) => setEditing(event.target.checked)} /> Allow editing, comments and forms
            </label>
          </div>
        </>
      )}
    </PdfToolShell>
  );
}

// ---------------------------------------------------------------- Unlock

export function UnlockView({ onBack }: BackProps) {
  const job = useJob();
  const pdf = usePdfSource(job, "Select a protected PDF", { countPages: false });
  const [password, setPassword] = useState("");
  const [rightful, setRightful] = useState(false);

  return (
    <PdfToolShell
      title="Unlock PDF"
      description="Remove the password and restrictions from a PDF — you need the correct password. DocCraft never guesses passwords."
      onBack={onBack}
      job={job}
      source={pdf.source}
      sourceDetail={pdf.detail}
      onChoose={pdf.choose}
      actionLabel="Unlock PDF"
      blocker={!rightful ? "Confirm that you may remove the protection." : null}
      onRun={() =>
        job.run(async (context) => {
          const source = pdf.source;
          if (!source) return null;
          context.progress("Checking the password…");
          // Decrypt first, so a wrong password is reported before asking where to save.
          const result = await unlockPdf(await readInput(source.path), password, { signal: context.signal });
          throwIfCancelled(context.signal);
          const output = await chooseSavePath(context, {
            title: "Save unlocked PDF as",
            suggested: suggestedPath(source.path, "_unlocked", "pdf"),
            filters: PDF_FILTER,
            inputs: [source.path],
            extension: "pdf",
          });
          if (output === null) return null;
          context.progress("Saving…", null, false);
          await writeOutput(output, result);
          return { title: `Saved ${fileNameFromPath(output)} without password protection.`, warning: "Anyone who gets this copy can open it. Store it carefully." };
        })
      }
    >
      {() => (
        <>
          <PasswordField
            label="Password"
            value={password}
            onChange={setPassword}
            autoComplete="off"
            help="The password used to open the PDF, or its permissions password. Leave empty if the PDF opens without one and only has restrictions."
          />
          <label className="choice">
            <input type="checkbox" checked={rightful} onChange={(event) => setRightful(event.target.checked)} /> This is my document, or I have permission to remove its protection.
          </label>
        </>
      )}
    </PdfToolShell>
  );
}

// ---------------------------------------------------------------- Repair

export function RepairView({ onBack }: BackProps) {
  const job = useJob();
  const pdf = usePdfSource(job, "Select a damaged PDF", { countPages: false });

  return (
    <PdfToolShell
      title="Repair PDF"
      description="Rebuild a damaged PDF (broken structure, extra data, incomplete downloads) and recover as many pages as possible."
      onBack={onBack}
      job={job}
      source={pdf.source}
      sourceDetail={pdf.detail}
      onChoose={pdf.choose}
      actionLabel="Repair PDF"
      blocker={null}
      onRun={() =>
        job.run(async (context) => {
          const source = pdf.source;
          if (!source) return null;
          context.progress("Analysing and rebuilding the PDF…");
          const result = await repairPdf(await readInput(source.path), source.name, { signal: context.signal });
          throwIfCancelled(context.signal);
          const output = await chooseSavePath(context, {
            title: "Save repaired PDF as",
            suggested: suggestedPath(source.path, "_repaired", "pdf"),
            filters: PDF_FILTER,
            inputs: [source.path],
            extension: "pdf",
          });
          if (output === null) return null;
          context.progress("Saving…", null, false);
          await writeOutput(output, result.bytes);
          return {
            title: `Saved ${fileNameFromPath(output)} with ${result.pageCount} ${result.pageCount === 1 ? "page" : "pages"}.`,
            details: [
              result.method === "rebuilt"
                ? "The document structure was rebuilt; all of its content was kept."
                : "The structure was beyond repair, so every readable page was copied into a new PDF. Bookmarks, forms and metadata may be lost.",
            ],
            warning: "Check the repaired file: content that was physically missing from the damaged file cannot be restored.",
          };
        })
      }
    />
  );
}
