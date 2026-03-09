import { useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  BookOpenText,
  Copy,
  ExternalLink,
  Flag,
  Info,
  MinusCircle,
  PlusCircle,
  Search,
  Trash2,
  X
} from "lucide-react";
import type { BookDraft, BookLanguage, BookType } from "../types";
import { DeweyReference } from "./DeweyReference";

const LANGUAGE_OPTIONS: BookLanguage[] = ["English", "Malay", "Chinese", "Tamil", "Others"];
const TYPE_OPTIONS: Array<{ label: string; value: BookType }> = [
  { label: "Fiction", value: "F" },
  { label: "Non-Fiction", value: "NF" },
  { label: "Reference", value: "R" }
];
const FICTION_DEWEY_BY_LANGUAGE: Record<Exclude<BookLanguage, "">, string> = {
  English: "FE",
  Malay: "FM",
  Chinese: "FC",
  Tamil: "FT",
  Others: "FO"
};
const FICTION_DEWEY_CODES = new Set(Object.values(FICTION_DEWEY_BY_LANGUAGE));

type DetailSheetProps = {
  open: boolean;
  book: BookDraft | null;
  busy: boolean;
  isCurrentlyRejected: boolean;
  onClose: () => void;
  onSave: (draft: BookDraft) => Promise<void> | void;
  onReject: (draft: BookDraft) => Promise<void> | void;
  onDelete?: () => Promise<void> | void;
};

export function DetailSheet({
  open,
  book,
  busy,
  isCurrentlyRejected,
  onClose,
  onSave,
  onReject,
  onDelete
}: DetailSheetProps) {
  const [draft, setDraft] = useState<BookDraft | null>(book);
  const [showDeweyReference, setShowDeweyReference] = useState(false);

  useEffect(() => {
    setDraft(book);
  }, [book]);

  const missingFields = useMemo(() => {
    if (!draft) {
      return [];
    }

    return [
      ["title", draft.title],
      ["author", draft.author],
      ["publisher", draft.publisher],
      ["year", draft.year],
      ["pages", draft.pages],
      ["price", draft.price],
      ["language", draft.language],
      ["type", draft.type],
      ["dewey", draft.dewey],
      ["initial", draft.initial]
    ]
      .filter(([, value]) => !value)
      .map(([field]) => field);
  }, [draft]);

  if (!open || !draft) {
    return null;
  }

  const updateField = <K extends keyof BookDraft>(field: K, value: BookDraft[K]) => {
    setDraft((current) => {
      if (!current) {
        return current;
      }

      const next = { ...current, [field]: value };

      if (field === "language" || field === "type") {
        if (next.type === "F" && next.language) {
          next.dewey = FICTION_DEWEY_BY_LANGUAGE[next.language];
        } else if (next.type !== "F" && FICTION_DEWEY_CODES.has(next.dewey)) {
          next.dewey = "";
        }
      }

      return next;
    });
  };

  const copyText = async (value: string, label: string) => {
    if (!value) {
      return;
    }

    await navigator.clipboard.writeText(value);
    window.dispatchEvent(new CustomEvent("scan-to-lms:toast", { detail: `${label} copied` }));
  };

  const openUrl = (url: string) => {
    window.open(url, "_blank", "noopener,noreferrer");
  };

  return (
    <>
      <div className="sheet-backdrop" onClick={busy ? undefined : onClose}>
        <section
          className="sheet detail-sheet"
          onClick={(event) => event.stopPropagation()}
          role="dialog"
          aria-modal="true"
          aria-label="Book details"
        >
          <div className="sheet-header">
            <div>
              <p className="sheet-kicker">Review</p>
              <h2>Book Details</h2>
              <p className="sheet-subtitle">
                {isCurrentlyRejected ? "Accept this book?" : "Is the book information correct?"}
              </p>
            </div>
            <button className="icon-button" type="button" onClick={onClose} disabled={busy}>
              <X size={18} />
            </button>
          </div>

          {isCurrentlyRejected ? (
            <div className="banner banner-danger">
              <AlertTriangle size={18} />
              <p>This book is currently rejected.</p>
            </div>
          ) : null}

          <div className="action-strip">
            <button className="secondary-button" type="button" onClick={() => copyText(draft.isbn, "ISBN")}>
              <Copy size={16} />
              Copy ISBN
            </button>
            <button
              className="secondary-button"
              type="button"
              onClick={() => openUrl(`https://isbnsearch.org/isbn/${encodeURIComponent(draft.isbn)}`)}
            >
              <Search size={16} />
              Search ISBN
            </button>
            <button
              className="secondary-button"
              type="button"
              onClick={() => openUrl(`https://www.google.com/search?q=${encodeURIComponent(draft.title || draft.isbn)}`)}
            >
              <ExternalLink size={16} />
              Google
            </button>
          </div>

          <div className="form-grid">
            <Field
              label="ISBN"
              value={draft.isbn}
              readOnly
              onChange={() => undefined}
            />
            <Field
              label="Title"
              value={draft.title}
              onChange={(value) => updateField("title", value)}
              warning={!draft.title}
            />
            <Field
              label="Author"
              value={draft.author}
              onChange={(value) => updateField("author", value)}
              warning={!draft.author}
            />
            <Field
              label="Publisher"
              value={draft.publisher}
              onChange={(value) => updateField("publisher", value)}
              warning={!draft.publisher}
            />

            <div className="split-fields">
              <Field
                label="Year"
                value={draft.year}
                inputMode="numeric"
                onChange={(value) => updateField("year", value.replace(/[^\d]/g, "").slice(0, 4))}
                warning={!draft.year}
              />
              <Field
                label="Pages"
                value={draft.pages}
                inputMode="numeric"
                onChange={(value) => updateField("pages", value.replace(/[^\d]/g, ""))}
                warning={!draft.pages}
              />
            </div>

            <Field
              label="Price (RM)"
              value={draft.price}
              inputMode="decimal"
              onChange={(value) => updateField("price", value.replace(/[^\d.]/g, ""))}
              warning={!draft.price}
            />

            <SegmentGroup
              label="Language"
              value={draft.language}
              options={LANGUAGE_OPTIONS}
              onChange={(value) => updateField("language", value)}
            />

            <SegmentGroup
              label="Type"
              value={draft.type}
              options={TYPE_OPTIONS.map((option) => option.value)}
              labels={Object.fromEntries(TYPE_OPTIONS.map((option) => [option.value, option.label]))}
              onChange={(value) => updateField("type", value)}
            />

            <div className="split-fields split-fields-bottom">
              <Field
                label="Dewey"
                value={draft.dewey}
                onChange={(value) => updateField("dewey", value.toUpperCase())}
                warning={!draft.dewey}
                trailing={
                  <button
                    className="mini-button"
                    type="button"
                    onClick={() => setShowDeweyReference(true)}
                  >
                    <Info size={15} />
                  </button>
                }
              />
              <Field
                label="Initial"
                value={draft.initial}
                onChange={(value) => updateField("initial", value.toUpperCase())}
                warning={!draft.initial}
              />
            </div>

            <div className="quantity-card">
              <div>
                <p className="field-label">Quantity</p>
                <p className="field-helper">Adjust before saving.</p>
              </div>
              <div className="quantity-controls">
                <button
                  className="mini-button"
                  type="button"
                  onClick={() => updateField("quantity", Math.max(1, draft.quantity - 1))}
                >
                  <MinusCircle size={18} />
                </button>
                <strong>{draft.quantity}</strong>
                <button
                  className="mini-button"
                  type="button"
                  onClick={() => updateField("quantity", draft.quantity + 1)}
                >
                  <PlusCircle size={18} />
                </button>
              </div>
            </div>
          </div>

          {missingFields.length > 0 ? (
            <div className="banner banner-warning">
              <BookOpenText size={18} />
              <p>Need review: {missingFields.join(", ")}</p>
            </div>
          ) : null}

          <div className="detail-actions">
            <button className="primary-button" type="button" onClick={() => onSave(draft)} disabled={busy}>
              <Flag size={18} />
              {isCurrentlyRejected ? "Accept" : "Yes"}
            </button>
            <button className="secondary-button" type="button" onClick={() => onReject(draft)} disabled={busy}>
              {isCurrentlyRejected ? "Keep Rejected" : "No"}
            </button>
          </div>

          {onDelete ? (
            <button className="danger-button delete-button" type="button" onClick={() => onDelete()} disabled={busy}>
              <Trash2 size={16} />
              Delete Book
            </button>
          ) : null}
        </section>
      </div>

      <DeweyReference open={showDeweyReference} onClose={() => setShowDeweyReference(false)} />
    </>
  );
}

type FieldProps = {
  label: string;
  value: string;
  onChange: (value: string) => void;
  warning?: boolean;
  readOnly?: boolean;
  inputMode?: React.HTMLAttributes<HTMLInputElement>["inputMode"];
  trailing?: React.ReactNode;
};

function Field({
  label,
  value,
  onChange,
  warning = false,
  readOnly = false,
  inputMode,
  trailing
}: FieldProps) {
  return (
    <label className="field-card">
      <span className="field-header">
        <span className="field-label">{label}</span>
        {warning ? <AlertTriangle size={14} /> : null}
      </span>
      <span className="field-input-wrap">
        <input
          value={value}
          readOnly={readOnly}
          inputMode={inputMode}
          onChange={(event) => onChange(event.target.value)}
        />
        {!readOnly && value ? (
          <button className="mini-button" type="button" onClick={() => onChange("")}>
            <X size={14} />
          </button>
        ) : null}
        {trailing}
      </span>
    </label>
  );
}

type SegmentGroupProps<T extends string> = {
  label: string;
  value: T;
  options: readonly T[];
  onChange: (value: T) => void;
  labels?: Record<string, string>;
};

function SegmentGroup<T extends string>({
  label,
  value,
  options,
  onChange,
  labels
}: SegmentGroupProps<T>) {
  return (
    <div className="segment-card">
      <p className="field-label">{label}</p>
      <div className="segment-grid">
        {options.map((option) => (
          <button
            key={option}
            className={option === value ? "segment-button active" : "segment-button"}
            type="button"
            onClick={() => onChange(option)}
          >
            {labels?.[option] ?? option}
          </button>
        ))}
      </div>
    </div>
  );
}
