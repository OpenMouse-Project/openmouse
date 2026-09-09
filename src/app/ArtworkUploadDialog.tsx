import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { verifyArtwork, fileToDataUrl } from "../ui/artwork-verification";
import { uploadArtwork } from "../ui/artwork-storage";
import { t, type I18nKey } from "../i18n";
import type { InterfaceLocale } from "../interface-preferences";

type VerificationState =
  | { status: "idle" }
  | { status: "verifying"; fileName: string }
  | { status: "preview"; fileName: string; dataUrl: string }
  | { status: "uploading"; fileName: string; dataUrl: string }
  | { status: "done" }
  | { status: "error"; message: string };

interface ArtworkUploadDialogProps {
  isOpen: boolean;
  onClose: () => void;
  locale: InterfaceLocale;
  vendorId: number;
  productId: number;
  displayName: string;
  onArtworkUploaded: () => void;
}

export function ArtworkUploadDialog({
  isOpen,
  onClose,
  locale,
  vendorId,
  productId,
  displayName,
  onArtworkUploaded,
}: ArtworkUploadDialogProps): ReactNode {
  const dialog = useRef<HTMLDialogElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const dropZone = useRef<HTMLDivElement>(null);
  const [state, setState] = useState<VerificationState>({ status: "idle" });
  const [isDragOver, setIsDragOver] = useState(false);

  useEffect(() => {
    const element = dialog.current;
    if (!element) return;
    if (isOpen) {
      if (typeof element.showModal === "function") element.showModal();
      else element.setAttribute("open", "");
    } else if (typeof element.close === "function") {
      if (element.open) element.close();
    } else {
      element.removeAttribute("open");
    }
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) {
      setState({ status: "idle" });
      setIsDragOver(false);
    }
  }, [isOpen]);

  const processFile = useCallback(async (file: File) => {
    setState({ status: "verifying", fileName: file.name });

    const result = await verifyArtwork(file);
    if (!result.passed) {
      setState({ status: "error", message: result.reason ?? "Verification failed" });
      return;
    }

    const dataUrl = await fileToDataUrl(file);
    setState({ status: "preview", fileName: file.name, dataUrl });
  }, []);

  const handleFileChange = useCallback((event: React.ChangeEvent<HTMLInputElement>) => {
    const target = event.target as HTMLInputElement;
    const file = target.files?.[0];
    if (file) void processFile(file);
    target.value = "";
  }, [processFile]);

  const handleDrop = useCallback((event: React.DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    setIsDragOver(false);
    const file = event.dataTransfer?.files[0];
    if (file) void processFile(file);
  }, [processFile]);

  const handleDragOver = useCallback((event: React.DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    setIsDragOver(true);
  }, []);

  const handleDragLeave = useCallback(() => {
    setIsDragOver(false);
  }, []);

  const handleUpload = useCallback(async () => {
    if (state.status !== "preview") return;
    setState({ status: "uploading", fileName: state.fileName, dataUrl: state.dataUrl });

    const result = await uploadArtwork(vendorId, productId, displayName, state.dataUrl);
    if (result.ok) {
      setState({ status: "done" });
      onArtworkUploaded();
    } else {
      setState({ status: "error", message: result.error ?? "Upload failed" });
    }
  }, [state, vendorId, productId, displayName, onArtworkUploaded]);

  const handleClose = useCallback(() => {
    if (state.status === "uploading") return;
    onClose();
  }, [state.status, onClose]);

  const handleClickOutside = useCallback((event: React.MouseEvent<HTMLDialogElement>) => {
    if (event.target === dialog.current) handleClose();
  }, [handleClose]);

  return (
    <dialog
      ref={dialog}
      className="support-dialog artwork-upload-dialog"
      aria-labelledby="artwork-upload-title"
      onClose={handleClose}
      onClick={handleClickOutside}
    >
      <form
        className="support-dialog-inner artwork-upload-inner"
        onSubmit={(event) => { event.preventDefault(); void handleUpload(); }}
      >
        <header>
          <div>
            <p className="overline">{displayName}</p>
            <h2 id="artwork-upload-title">{t(locale, "artwork.uploadTitle" as I18nKey)}</h2>
          </div>
          <button type="button" onClick={handleClose} aria-label={t(locale, "common.close")}>×</button>
        </header>

        {state.status === "idle" && (
          <>
            <p className="artwork-description">{t(locale, "artwork.description" as I18nKey)}</p>
            <div
              ref={dropZone}
              className={`artwork-dropzone${isDragOver ? " is-drag-over" : ""}`}
              onDrop={handleDrop}
              onDragOver={handleDragOver}
              onDragLeave={handleDragLeave}
              onClick={() => fileInput.current?.click()}
              role="button"
              tabIndex={0}
              onKeyDown={(event) => {
                if (event.key === "Enter" || event.key === " ") {
                  event.preventDefault();
                  fileInput.current?.click();
                }
              }}
            >
              <div className="artwork-dropzone-icon">
                <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                  <polyline points="17 8 12 3 7 8" />
                  <line x1="12" y1="3" x2="12" y2="15" />
                </svg>
              </div>
              <p className="artwork-dropzone-text">{t(locale, "artwork.dragDrop" as I18nKey)}</p>
              <p className="artwork-dropzone-hint">PNG, WebP, or JPEG · Max 5MB · Min 200×200</p>
            </div>
            <input
              ref={fileInput}
              type="file"
              accept="image/png,image/webp,image/jpeg"
              className="artwork-file-input"
              onChange={handleFileChange}
            />
          </>
        )}

        {state.status === "verifying" && (
          <div className="artwork-status">
            <div className="artwork-spinner" />
            <p>{t(locale, "artwork.verifying" as I18nKey)}</p>
            <p className="artwork-status-detail">{state.fileName}</p>
          </div>
        )}

        {state.status === "preview" && (
          <>
            <div className="artwork-preview">
              <img src={state.dataUrl} alt="Preview" className="artwork-preview-image" />
            </div>
            <div className="artwork-actions">
              <button type="button" onClick={() => setState({ status: "idle" })}>
                {t(locale, "artwork.chooseDifferent" as I18nKey)}
              </button>
              <button type="submit" className="is-primary">
                {t(locale, "artwork.confirmUpload" as I18nKey)}
              </button>
            </div>
          </>
        )}

        {state.status === "uploading" && (
          <div className="artwork-status">
            <div className="artwork-spinner" />
            <p>{t(locale, "artwork.uploading" as I18nKey)}</p>
          </div>
        )}

        {state.status === "done" && (
          <div className="artwork-status artwork-success">
            <div className="artwork-check-icon">
              <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="20 6 9 17 4 12" />
              </svg>
            </div>
            <p>{t(locale, "artwork.verified" as I18nKey)}</p>
            <div className="artwork-actions">
              <button type="button" className="is-primary" onClick={handleClose}>
                {t(locale, "common.done" as I18nKey)}
              </button>
            </div>
          </div>
        )}

        {state.status === "error" && (
          <div className="artwork-status artwork-error">
            <p role="alert">{state.message}</p>
            <div className="artwork-actions">
              <button type="button" onClick={() => setState({ status: "idle" })}>
                {t(locale, "artwork.tryAgain" as I18nKey)}
              </button>
              <button type="button" onClick={handleClose}>
                {t(locale, "common.cancel" as I18nKey)}
              </button>
            </div>
          </div>
        )}
      </form>
    </dialog>
  );
}
