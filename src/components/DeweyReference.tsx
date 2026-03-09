import { X } from "lucide-react";

const DEWEY_SECTIONS = [
  ["000", "Computer science, information and general works"],
  ["100", "Philosophy and psychology"],
  ["200", "Religion"],
  ["300", "Social sciences, education, law, business"],
  ["400", "Language and linguistics"],
  ["500", "Science and mathematics"],
  ["600", "Technology, medicine, engineering, cooking"],
  ["700", "Arts, recreation, sports"],
  ["800", "Literature, rhetoric, criticism"],
  ["900", "History, geography, biography, travel"]
] as const;

const FICTION_CODES = [
  ["FE", "English Fiction"],
  ["FM", "Malay Fiction"],
  ["FC", "Chinese Fiction"],
  ["FT", "Tamil Fiction"],
  ["FO", "Other Language Fiction"]
] as const;

type DeweyReferenceProps = {
  open: boolean;
  onClose: () => void;
};

export function DeweyReference({ open, onClose }: DeweyReferenceProps) {
  if (!open) {
    return null;
  }

  return (
    <div className="sheet-backdrop" onClick={onClose}>
      <section
        className="sheet sheet-wide"
        onClick={(event) => event.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label="Dewey reference"
      >
        <div className="sheet-header">
          <div>
            <p className="sheet-kicker">Reference</p>
            <h2>Dewey Classification</h2>
          </div>
          <button className="icon-button" type="button" onClick={onClose}>
            <X size={18} />
          </button>
        </div>

        <div className="reference-grid">
          {DEWEY_SECTIONS.map(([code, title]) => (
            <article key={code} className="reference-card">
              <div className="reference-code">{code}</div>
              <p>{title}</p>
            </article>
          ))}
        </div>

        <div className="reference-footer">
          <h3>Fiction Codes</h3>
          <div className="chip-wrap">
            {FICTION_CODES.map(([code, label]) => (
              <span className="status-pill neutral" key={code}>
                <strong>{code}</strong> {label}
              </span>
            ))}
          </div>
        </div>
      </section>
    </div>
  );
}
