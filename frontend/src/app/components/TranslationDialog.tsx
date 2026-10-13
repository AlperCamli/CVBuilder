import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useAuth } from "../integration/auth-context";
import type { CvLanguage, TranslationRun } from "../integration/backend-api";
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
  const [languages, setLanguages] = useState<CvLanguage[]>([]);
  const [loadingLanguages, setLoadingLanguages] = useState(true);
  const [target, setTarget] = useState("");
  const issues = run?.output_payload?.validation_issues ?? [];
  const failureMessage = error ?? (run?.status === "failed"
    ? issues.length ? t("Some numbers could not be verified. Review the affected text below.") : t("Translation failed. Please retry.")
    : null);
  useEffect(() => {
    dialog.current?.showModal();
  }, []);
  useEffect(() => {
    let active = true;
    setLoadingLanguages(true);
    void api.getCvLanguages().then(({ languages }) => {
      if (!active) return;
      setLanguages(languages.filter(language => language.code !== source.language.toLowerCase().replace(/_/g, "-")));
    }).catch(error => {
      if (active) setError(error instanceof Error ? error.message : t("Failed to load CV languages"));
    }).finally(() => { if (active) setLoadingLanguages(false); });
    return () => { active = false; };
  }, [api, source.language]);
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
    if (!languages.some(language => language.code === target)) return;
    setBusy(true);
    setError(null);
    setExistingId(null);
    setRun(null);
    try {
      const started = await api.startTranslation(source.id, target);
      setRun(await api.getTranslation(source.id, started.ai_run_id));
      setRun(await api.executeTranslation(source.id, started.ai_run_id));
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
      className="m-auto rounded-2xl border-0 p-6 shadow-xl backdrop:bg-black/40 w-[min(700px,calc(100%-2rem))] max-h-[85vh]"
    >
      <h2 id="translation-title" className="text-xl font-medium mb-3">
        {t("Translate")}
      </h2>
      <p className="text-sm text-slate-600 mb-4">
        {t(
          "Your original CV stays unchanged. The translated master is an independent copy and uses one AI action.",
        )}
      </p>
      <label className="block text-sm font-medium mb-4" htmlFor="translation-language">
        {t("Translate into")}
        <select id="translation-language" value={target} disabled={loadingLanguages || busy || run?.status === "pending" || run?.status === "completed"}
          onChange={event => { setTarget(event.target.value); setRun(null); setError(null); setExistingId(null); }}
          className="block w-full border rounded-lg px-3 py-2 mt-2">
          <option value="">{t(loadingLanguages ? "Loading CV languages…" : "Choose CV language")}</option>
          {languages.map(language => <option key={language.code} value={language.code}>{language.name}</option>)}
        </select>
      </label>
      {!loadingLanguages && !languages.length && !error && <p role="status">{t("No other CV languages are available.")}</p>}
      {failureMessage && (
        <p role="alert" className="text-red-700 mb-3">
          {failureMessage}
        </p>
      )}
      {run?.status === "pending" && (
        <p role="status">{t("Translating your CV…")}</p>
      )}
      {issues.length > 0 && (
        <div className="overflow-y-auto max-h-[45vh] space-y-4" aria-label={t("Translation comparison")}>
          <p className="text-sm text-slate-600">{t("This attempt wasn't saved to a CV. No AI action was charged.")}</p>
          {issues.map((issue, index) => (
            <section key={`${issue.path}:${index}`} className="border rounded-xl p-4">
              <h3 className="font-semibold mb-3">{[issue.section_title, issue.block_title, t(issue.field_label ?? "Content")].filter(Boolean).join(" · ")}</h3>
              <div className="grid gap-4 sm:grid-cols-2">
                <div lang={source.language}>
                  <h4 className="text-sm font-medium mb-1">{t("Original text")}</h4>
                  <p className="whitespace-pre-wrap break-words text-sm">{issue.original_text}</p>
                  <p className="text-sm mt-2"><strong>{t("Numbers in original")}:</strong> {issue.original_numbers.join(" · ") || t("No numbers found")}</p>
                </div>
                <div lang={target} dir={run?.output_payload?.target_direction}>
                  <h4 className="text-sm font-medium mb-1">{t("Attempted translation")}</h4>
                  <p className="whitespace-pre-wrap break-words text-sm">{issue.translated_text || t("No text returned")}</p>
                  <p className="text-sm mt-2"><strong>{t("Numbers in translation")}:</strong> {issue.translated_numbers.join(" · ") || t("No numbers found")}</p>
                </div>
              </div>
            </section>
          ))}
        </div>
      )}
      {run?.status === "completed" && run.output_payload?.current_content && (
        <div
          className="overflow-y-auto max-h-[50vh] border rounded-xl p-4 mb-4"
          lang={target}
          dir={run.output_payload.target_direction ?? languages.find(language => language.code === target)?.direction}
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
            disabled={busy || loadingLanguages || !target || run?.status === "pending"}
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
