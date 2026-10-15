import type { SelectedFile } from "../lib/selection";
import { ArrowDownIcon, ArrowUpIcon, FileIcon, TrashIcon } from "./Icons";

interface FileListProps {
  files: SelectedFile[];
  disabled: boolean;
  onMove: (id: string, offset: number) => void;
  onRemove: (id: string) => void;
}

export function FileList({ files, disabled, onMove, onRemove }: FileListProps) {
  return (
    <ol className="file-list" aria-label="Selected PDF files, in merge order">
      {files.map((file, index) => (
        <li key={file.id} className="file-row">
          <span className="file-position" aria-hidden="true">
            {index + 1}
          </span>
          <FileIcon className="file-icon" />
          <span className="file-name" title={file.path}>
            {file.name}
          </span>
          <span className="file-actions">
            <button
              type="button"
              className="icon-button"
              onClick={() => onMove(file.id, -1)}
              disabled={disabled || index === 0}
              aria-label={`Move ${file.name} up`}
              title="Move up"
            >
              <ArrowUpIcon />
            </button>
            <button
              type="button"
              className="icon-button"
              onClick={() => onMove(file.id, 1)}
              disabled={disabled || index === files.length - 1}
              aria-label={`Move ${file.name} down`}
              title="Move down"
            >
              <ArrowDownIcon />
            </button>
            <button
              type="button"
              className="icon-button icon-button--danger"
              onClick={() => onRemove(file.id)}
              disabled={disabled}
              aria-label={`Remove ${file.name} from the list`}
              title="Remove from list"
            >
              <TrashIcon />
            </button>
          </span>
        </li>
      ))}
    </ol>
  );
}
