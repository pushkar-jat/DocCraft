import { useEffect, useRef, useState, type KeyboardEvent, type PointerEvent, type ReactNode } from "react";
import type { NormalizedBox } from "../lib/pageGeometry";
import type { PdfRenderer } from "../services/pageEditing";

export interface PlacedItem {
  id: string;
  /** 0-based page index. */
  page: number;
  box: NormalizedBox;
}

interface PageEditorProps<T extends PlacedItem> {
  renderer: PdfRenderer | null;
  items: T[];
  onChange: (items: T[]) => void;
  /** Called when the user draws a new box; return the new item, or null to ignore. */
  createItem: ((page: number, box: NormalizedBox) => T | null) | null;
  renderItem: (item: T) => ReactNode;
  describeItem: (item: T) => string;
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  disabled: boolean;
  /** Shown under the page, e.g. "Drag on the page to add a text box." */
  hint: string;
}

const MIN_SIZE = 0.01;
const clamp = (value: number, min: number, max: number) => Math.min(Math.max(value, min), max);

function clampBox(box: NormalizedBox): NormalizedBox {
  const width = clamp(box.width, MIN_SIZE, 1);
  const height = clamp(box.height, MIN_SIZE, 1);
  return { x: clamp(box.x, 0, 1 - width), y: clamp(box.y, 0, 1 - height), width, height };
}

type Gesture =
  | { kind: "draw"; startX: number; startY: number }
  | { kind: "move"; id: string; offsetX: number; offsetY: number }
  | { kind: "resize"; id: string };

/** One page at a time with draggable, resizable, keyboard-operable boxes on top. */
export function PageEditor<T extends PlacedItem>(props: PageEditorProps<T>) {
  const { renderer, items, onChange, selectedId, onSelect, disabled } = props;
  const [page, setPage] = useState(0);
  const [images, setImages] = useState<Record<number, string>>({});
  const [draft, setDraft] = useState<NormalizedBox | null>(null);
  const surface = useRef<HTMLDivElement>(null);
  const gesture = useRef<Gesture | null>(null);
  const pageCount = renderer?.pageCount ?? 0;

  useEffect(() => {
    setImages({});
    setPage(0);
  }, [renderer]);

  useEffect(() => {
    if (!renderer || images[page]) return;
    let cancelled = false;
    renderer
      .thumbnail(page + 1, 1400)
      .then((url) => !cancelled && setImages((current) => ({ ...current, [page]: url })))
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [renderer, page, images]);

  const point = (event: PointerEvent) => {
    const rect = surface.current!.getBoundingClientRect();
    return { x: clamp((event.clientX - rect.left) / rect.width, 0, 1), y: clamp((event.clientY - rect.top) / rect.height, 0, 1) };
  };

  const update = (id: string, change: (box: NormalizedBox) => NormalizedBox) =>
    onChange(items.map((item) => (item.id === id ? { ...item, box: clampBox(change(item.box)) } : item)));

  const onPointerDown = (event: PointerEvent<HTMLDivElement>) => {
    if (disabled || event.button !== 0) return;
    const target = event.target as HTMLElement;
    const itemId = target.closest<HTMLElement>("[data-item-id]")?.dataset.itemId;
    const p = point(event);
    surface.current!.setPointerCapture(event.pointerId);
    if (itemId) {
      onSelect(itemId);
      const item = items.find((candidate) => candidate.id === itemId)!;
      gesture.current = target.dataset.handle ? { kind: "resize", id: itemId } : { kind: "move", id: itemId, offsetX: p.x - item.box.x, offsetY: p.y - item.box.y };
    } else if (props.createItem) {
      onSelect(null);
      gesture.current = { kind: "draw", startX: p.x, startY: p.y };
      setDraft({ x: p.x, y: p.y, width: 0, height: 0 });
    } else {
      onSelect(null);
    }
    event.preventDefault();
  };

  const onPointerMove = (event: PointerEvent<HTMLDivElement>) => {
    const current = gesture.current;
    if (!current) return;
    const p = point(event);
    if (current.kind === "draw") {
      setDraft({ x: Math.min(p.x, current.startX), y: Math.min(p.y, current.startY), width: Math.abs(p.x - current.startX), height: Math.abs(p.y - current.startY) });
    } else if (current.kind === "move") {
      update(current.id, (box) => ({ ...box, x: p.x - current.offsetX, y: p.y - current.offsetY }));
    } else {
      update(current.id, (box) => ({ ...box, width: p.x - box.x, height: p.y - box.y }));
    }
  };

  const onPointerUp = () => {
    const current = gesture.current;
    gesture.current = null;
    if (current?.kind === "draw" && draft && props.createItem) {
      if (draft.width >= MIN_SIZE && draft.height >= MIN_SIZE) {
        const item = props.createItem(page, clampBox(draft));
        if (item) {
          onChange([...items, item]);
          onSelect(item.id);
        }
      }
      setDraft(null);
    }
  };

  const onItemKeyDown = (event: KeyboardEvent, item: T) => {
    if (disabled) return;
    const step = event.shiftKey ? 0.02 : 0.005;
    const moves: Record<string, [number, number]> = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] };
    if (event.key in moves) {
      const [dx, dy] = moves[event.key];
      update(item.id, (box) => (event.altKey ? { ...box, width: box.width + dx, height: box.height + dy } : { ...box, x: box.x + dx, y: box.y + dy }));
      event.preventDefault();
    } else if (event.key === "Delete" || event.key === "Backspace") {
      onChange(items.filter((candidate) => candidate.id !== item.id));
      onSelect(null);
      event.preventDefault();
    }
  };

  const onPage = items.filter((item) => item.page === page);

  return (
    <div className="page-editor">
      <div className="panel-toolbar">
        <button type="button" className="button button--ghost" onClick={() => setPage((p) => Math.max(0, p - 1))} disabled={page === 0}>
          ‹ Previous
        </button>
        <span className="panel-count" aria-live="polite">
          {pageCount ? `Page ${page + 1} of ${pageCount}` : "Loading…"}
          {items.length > 0 && ` · ${items.length} ${items.length === 1 ? "item" : "items"} in total`}
        </span>
        <button type="button" className="button button--ghost" onClick={() => setPage((p) => Math.min(pageCount - 1, p + 1))} disabled={page >= pageCount - 1}>
          Next ›
        </button>
      </div>
      <div className="page-stage">
        <div
          ref={surface}
          className={`page-surface ${props.createItem && !disabled ? "page-surface--draw" : ""}`}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
        >
          {images[page] ? <img src={images[page]} alt={`Page ${page + 1}`} draggable={false} /> : <div className="page-loading">Rendering page…</div>}
          {onPage.map((item) => (
            <div
              key={item.id}
              data-item-id={item.id}
              className={`page-item ${item.id === selectedId ? "page-item--selected" : ""}`}
              style={{ left: `${item.box.x * 100}%`, top: `${item.box.y * 100}%`, width: `${item.box.width * 100}%`, height: `${item.box.height * 100}%` }}
              role="button"
              tabIndex={0}
              aria-pressed={item.id === selectedId}
              aria-label={`${props.describeItem(item)}. Arrow keys move it, Alt+arrow keys resize it, Delete removes it.`}
              onFocus={() => onSelect(item.id)}
              onKeyDown={(event) => onItemKeyDown(event, item)}
            >
              {props.renderItem(item)}
              {item.id === selectedId && !disabled && <span className="page-item-handle" data-handle="resize" aria-hidden="true" />}
            </div>
          ))}
          {draft && (
            <div
              className="page-item page-item--draft"
              style={{ left: `${draft.x * 100}%`, top: `${draft.y * 100}%`, width: `${draft.width * 100}%`, height: `${draft.height * 100}%` }}
            />
          )}
        </div>
      </div>
      <p className="field-help page-editor-hint">{props.hint}</p>
    </div>
  );
}
