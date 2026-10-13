import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useAuth } from "../integration/auth-context";
import type { MasterDocumentRevision } from "../integration/backend-api";
import { localeCode, translate as t } from "../localization/i18n";

export function MasterRevisionDialog({
  masterId,
  onClose,
  onRestored,
}: {
  masterId: string;
  onClose: () => void;
  onRestored: () => void;
}) {
  useTranslation();
  const { api } = useAuth();
  const dialog = useRef<HTMLDialogElement>(null);
  const [revisions, setRevisions] = useState<MasterDocumentRevision[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    dialog.current?.showModal();
    let active = true;
    void api
      .getMasterDocumentRevisions(masterId)
      .then((rows) => {
        if (active) setRevisions(rows);
      })
      .catch(() => {
        if (active) setError(t("Could not load document revisions"));
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [api, masterId]);
  const restore = async (revision: MasterDocumentRevision) => {
    if (
      !window.confirm(
        t(
          "Restore this revision? Your current content will also be saved as a revision.",
        ),
      )
    )
      return;
    setBusy(true);
    setError(null);
    try {
      await api.restoreMasterDocumentRevision(masterId, revision.id);
      onRestored();
    } catch {
      setError(t("Could not restore this document revision"));
      setBusy(false);
    }
  };
  return (
    <dialog
      ref={dialog}
      aria-labelledby="master-history-title"
      onCancel={(event) => {
        event.preventDefault();
        if (!busy) onClose();
      }}
      className="rounded-2xl border-0 p-6 shadow-xl backdrop:bg-black/40 w-[min(620px,calc(100%-2rem))] max-h-[85vh] overflow-y-auto"
    >
      <h2 id="master-history-title" className="text-xl font-medium mb-4">
        {t("Document revision history")}
      </h2>
      {error && (
        <p role="alert" className="text-red-700 mb-3">
          {error}
        </p>
      )}
      {loading ? (
        <p role="status">{t("Loading…")}</p>
      ) : revisions.length === 0 ? (
        <p>{t("No revisions found yet.")}</p>
      ) : (
        revisions.map((revision) => (
          <div
            key={revision.id}
            className="border rounded-xl p-4 mb-3 flex items-center justify-between gap-4"
          >
            <p className="text-sm">
              #{revision.revision_number} ·{" "}
              {new Date(revision.created_at).toLocaleString(localeCode())}
            </p>
            <button
              type="button"
              disabled={busy}
              onClick={() => void restore(revision)}
              className="rounded-lg border px-3 py-2 text-sm"
            >
              {t("Restore")}
            </button>
          </div>
        ))
      )}
      <button
        type="button"
        disabled={busy}
        onClick={onClose}
        className="rounded-lg border px-4 py-2 mt-4"
      >
        {t("Close")}
      </button>
    </dialog>
  );
}
