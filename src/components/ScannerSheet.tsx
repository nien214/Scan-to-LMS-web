import { useEffect, useMemo, useRef, useState } from "react";
import { BarcodeFormat, DecodeHintType } from "@zxing/library";
import { BrowserMultiFormatReader } from "@zxing/browser";
import { Camera, LoaderCircle, ScanLine, X } from "lucide-react";
import { normalizeIsbn } from "../lib/utils";

type ScannerSheetProps = {
  open: boolean;
  busy: boolean;
  statusMessage: string;
  onClose: () => void;
  onDetected: (isbn: string) => Promise<void> | void;
};

export function ScannerSheet({
  open,
  busy,
  statusMessage,
  onClose,
  onDetected
}: ScannerSheetProps) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const controlsRef = useRef<{ stop: () => void } | null>(null);
  const lockRef = useRef(false);
  const [manualIsbn, setManualIsbn] = useState("");
  const [cameraError, setCameraError] = useState<string | null>(null);

  const hints = useMemo(() => {
    const nextHints = new Map();
    nextHints.set(DecodeHintType.POSSIBLE_FORMATS, [
      BarcodeFormat.EAN_13,
      BarcodeFormat.EAN_8,
      BarcodeFormat.UPC_A,
      BarcodeFormat.UPC_E
    ]);
    return nextHints;
  }, []);

  useEffect(() => {
    if (!open) {
      lockRef.current = false;
      controlsRef.current?.stop();
      BrowserMultiFormatReader.releaseAllStreams();
      return;
    }

    lockRef.current = false;
    setCameraError(null);
    const video = videoRef.current;
    if (!video) {
      return;
    }

    video.setAttribute("playsinline", "true");
    const reader = new BrowserMultiFormatReader(hints, {
      delayBetweenScanAttempts: 250
    });

    let active = true;

    void reader
      .decodeFromConstraints(
        {
          audio: false,
          video: {
            facingMode: { ideal: "environment" },
            width: { ideal: 1280 }
          }
        },
        video,
        (result, error, controls) => {
          controlsRef.current = controls;

          if (!active || lockRef.current) {
            return;
          }

          if (result) {
            lockRef.current = true;
            controls.stop();
            void onDetected(result.getText());
            return;
          }

          if (
            error &&
            !String(error.name ?? "").includes("NotFoundException") &&
            !String(error.message ?? "").includes("No MultiFormat Readers")
          ) {
            setCameraError("Camera is active, but barcode detection needs a clearer frame.");
          }
        }
      )
      .catch(() => {
        if (active) {
          setCameraError("Camera access failed. Use manual ISBN entry below.");
        }
      });

    return () => {
      active = false;
      controlsRef.current?.stop();
      BrowserMultiFormatReader.releaseAllStreams();
    };
  }, [hints, onDetected, open]);

  const submitManualIsbn = async (event: React.FormEvent) => {
    event.preventDefault();
    const isbn = normalizeIsbn(manualIsbn);
    if (!isbn) {
      setCameraError("Enter a valid ISBN before continuing.");
      return;
    }

    lockRef.current = true;
    controlsRef.current?.stop();
    await onDetected(isbn);
  };

  if (!open) {
    return null;
  }

  return (
    <div className="sheet-backdrop" onClick={busy ? undefined : onClose}>
      <section
        className="sheet scanner-sheet"
        onClick={(event) => event.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label="Scan ISBN barcode"
      >
        <div className="sheet-header">
          <div>
            <p className="sheet-kicker">Scanner</p>
            <h2>Scan ISBN Barcode</h2>
            <p className="sheet-subtitle">{statusMessage}</p>
          </div>
          <button
            className="icon-button"
            type="button"
            onClick={onClose}
            disabled={busy}
            aria-label="Close scanner"
          >
            <X size={18} />
          </button>
        </div>

        <div className="scanner-stage">
          <video ref={videoRef} muted autoPlay />
          <div className="scanner-frame" aria-hidden="true">
            <ScanLine size={22} />
          </div>
          {busy ? (
            <div className="scanner-overlay">
              <LoaderCircle className="spin" size={28} />
              <p>Looking up book...</p>
            </div>
          ) : null}
        </div>

        {cameraError ? <p className="inline-error">{cameraError}</p> : null}

        <form className="manual-entry" onSubmit={submitManualIsbn}>
          <label htmlFor="manual-isbn">Manual ISBN</label>
          <div className="manual-entry-row">
            <input
              id="manual-isbn"
              inputMode="numeric"
              autoComplete="off"
              placeholder="978..."
              value={manualIsbn}
              onChange={(event) => setManualIsbn(normalizeIsbn(event.target.value))}
              disabled={busy}
            />
            <button className="primary-button" type="submit" disabled={busy}>
              <Camera size={18} />
              Use ISBN
            </button>
          </div>
        </form>
      </section>
    </div>
  );
}
