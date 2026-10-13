import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useAuth } from "../integration/auth-context";
import type { TranslationRun } from "../integration/backend-api";
import type { MasterCvSummary } from "../integration/api-types";
import { translate as t } from "../localization/i18n";
import { ApiClientError } from "../integration/api-error";

export function TranslationDialog({
  source,
  onClose,
  onCreated,
}: {
  source: MasterCvSummary;
  onClose: () => void;
  onCreated: (id: string) => void;
}) {
  useTranslation();
  const { api } = useAuth();
  const dialog = useRef<HTMLDialogElement>(null);
  const [run, setRun] = useState<TranslationRun | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [existingId, setExistingId] = useState<string | null>(null);
  const target = source.language.startsWith("tr") ? "en" : "tr";
  useEffect(() => {
    dialog.current?.showModal();
  }, []);
  const handleError = (error: unknown) => {
    setError(
      error instanceof Error
        ? t(error.message)
        : t("Translation failed. Please retry."),
    );
    if (
      error instanceof ApiClientError &&
      typeof error.details?.existing_master_cv_id === "string"
    )
      setExistingId(error.details.existing_master_cv_id);
  };
  const start = async () => {
    setBusy(true);
    setError(null);
    try {
      const started = await api.startTranslation(source.id, target);
      setRun(await api.getTranslation(source.id, started.ai_run_id));
      await api.executeTranslation(source.id, started.ai_run_id);
      setRun(await api.getTranslation(source.id, started.ai_run_id));
    } catch (error) {
      handleError(error);
    } finally {
      setBusy(false);
    }
  };
  useEffect(() => {
    if (!run || run.status !== "pending") return;
    const timer = window.setInterval(() => {
      void api
        .getTranslation(source.id, run.id)
        .then(setRun)
        .catch(handleError);
    }, 1500);
    return () => window.clearInterval(timer);
  }, [api, run?.id, run?.status, source.id]);
  const apply = async () => {
    if (!run || run.status !== "completed") return;
    setBusy(true);
    try {
      const created = await api.applyTranslation(source.id, run.id);
      onCreated(created.id);
    } catch (error) {
      handleError(error);
      setBusy(false);
    }
  };
  return (
    <dialog
      ref={dialog}
      aria-labelledby="translation-title"
      onCancel={(event) => {
        event.preventDefault();
        if (!busy) onClose();
      }}
      className="rounded-2xl border-0 p-6 shadow-xl backdrop:bg-black/40 w-[min(700px,calc(100%-2rem))] max-h-[85vh]"
    >
      <h2 id="translation-title" className="text-xl font-medium mb-3">
        {t(target === "tr" ? "Translate to Turkish" : "Translate to English")}
      </h2>
      <p className="text-sm text-slate-600 mb-4">
        {t(
          "Your original CV stays unchanged. The translated master is an independent copy and uses one AI action.",
        )}
      </p>
      {error && (
        <p role="alert" className="text-red-700 mb-3">
          {t(error)}
        </p>
      )}
      {run?.status === "pending" && (
        <p role="status">{t("Translating your CV…")}</p>
      )}
      {run?.status === "failed" && (
        <p role="alert">{t("Translation failed. Please retry.")}</p>
      )}
      {run?.status === "completed" && run.output_payload && (
        <div
          className="overflow-y-auto max-h-[50vh] border rounded-xl p-4 mb-4"
          lang={target}
        >
          {run.output_payload.current_content.sections.map((section) => (
            <section key={section.id} className="mb-4">
              <h3 className="font-semibold">{section.title}</h3>
              {section.blocks.map((block) => (
                <p key={block.id} className="whitespace-pre-wrap text-sm mt-2">
                  {Object.values(block.fields)
                    .map((value) =>
                      Array.isArray(value)
                        ? value.join(" · ")
                        : typeof value === "string"
                          ? value
                          : "",
                    )
                    .filter(Boolean)
                    .join("\n")}
                </p>
              ))}
            </section>
          ))}
        </div>
      )}
      <div className="flex gap-3 justify-end mt-4">
        <button
          type="button"
          disabled={busy}
          onClick={onClose}
          className="border rounded-lg px-4 py-2"
        >
          {t("Cancel")}
        </button>
        {existingId ? (
          <button
            type="button"
            onClick={() => onCreated(existingId)}
            className="bg-teal-700 text-white rounded-lg px-4 py-2"
          >
            {t("Open existing master")}
          </button>
        ) : run?.status === "completed" ? (
          <button
            type="button"
            disabled={busy}
            onClick={() => void apply()}
            className="bg-teal-700 text-white rounded-lg px-4 py-2"
          >
            {t("Create translated master")}
          </button>
        ) : (
          <button
            type="button"
            disabled={busy || run?.status === "pending"}
            onClick={() => void start()}
            className="bg-teal-700 text-white rounded-lg px-4 py-2"
          >
            {t("Translate")}
          </button>
        )}
      </div>
    </dialog>
  );
}
