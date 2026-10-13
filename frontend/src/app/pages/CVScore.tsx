import { LANGUAGES, documentLocale, translate as t } from "../localization/i18n";
import { useTranslation } from "react-i18next";
import { personalizedGuidance } from "../onboarding/pre-signup-questions";
import { useEffect, useState } from "react";
import { useNavigate, useLocation, useSearchParams } from "react-router";
import { Sparkles, ArrowRight, Loader2 } from "lucide-react";
import { CvReviewPanel } from "../components/CvReviewPanel";
import type { CvContent, CvReview } from "../integration/api-types";
import { useAuth } from "../integration/auth-context";
import { useOnboarding } from "../contexts/OnboardingContext";
import { ApiClientError } from "../integration/api-error";
import {
  trackOnboardingStepCompleted,
  trackOnboardingStepView,
} from "../integration/analytics";

export function CVScore() {
  useTranslation();
  const navigate = useNavigate();
  const location = useLocation();
  const { api, me } = useAuth();
  const [params] = useSearchParams();
  const fromGuest = params.get("source") === "guest";
  const { completeStep } = useOnboarding();

  const importId = (location.state?.importId ??
    params.get("import") ??
    undefined) as string | undefined;
  const fileName = location.state?.fileName as string | undefined;
  const [review, setReview] = useState<CvReview | null>(null);

  const [loading, setLoading] = useState(true);
  const [converting, setConverting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [cvLanguage, setCvLanguage] = useState<string>("");
  const [availableMasters, setAvailableMasters] = useState<import("../integration/api-types").MasterCvSummary[]>([]);
  const [updateMasterId, setUpdateMasterId] = useState<string>("");
  const [parsedContent, setParsedContent] = useState<CvContent | null>(null);
  const [moduleType, setModuleType] = useState<string | undefined>(
    location.state?.moduleType as string | undefined,
  );

  useEffect(() => {
    if (!importId) {
      navigate("/app/create", { replace: true });
      return;
    }

    let cancelled = false;

    const load = async () => {
      setLoading(true);
      setError(null);

      try {
        const result = await api.getImportResult(importId);

        if (cancelled) {
          return;
        }

        setReview(result.review ?? null);
        setParsedContent(result.parsed_content);
        setCvLanguage(result.parsed_content?.metadata.needs_language_confirmation ? "" : result.parsed_content?.language ?? "");
        setAvailableMasters(await api.listMasterCvs());
        setModuleType(result.module_type);
      } catch (err) {
        if (cancelled) {
          return;
        }
        if (err instanceof ApiClientError) {
          setError(err.message);
        } else if (err instanceof Error) {
          setError(err.message);
        } else {
          setError(t("Failed to load parsed CV."));
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    };

    void load();

    return () => {
      cancelled = true;
    };
  }, [api, importId, navigate]);

  const improvements = review?.improvements ?? [];
  const parseNeedsManualReview = review?.status === "unscorable" || !review;

  useEffect(() => {
    trackOnboardingStepView({
      step: "cv_score",
      source: "upload_processing",
    });
  }, []);

  const convertImportToMasterCv = async (
    contentToSave: CvContent,
    destination: "tailor" | "editor",
  ) => {
    if (!importId) {
      return;
    }

    setError(null);

    if (fromGuest) {
      try {
        const detail = await api.getImport(importId);
        if (detail.target_master_cv) {
          navigate(`/app/cv/${detail.target_master_cv.id}`);
          return;
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : t("Couldn't load your CV."));
        return;
      }
    }
    if (!cvLanguage) { setError(t("Choose CV language")); return; }
    const matching = availableMasters.filter(cv => documentLocale(cv.language) === cvLanguage && (cv.module_type ?? "standard") === (moduleType ?? "standard"));
    const updateId = matching.length === 1 ? matching[0].id : matching.find(cv => cv.id === updateMasterId)?.id;
    if (matching.length > 1 && !updateId) { setError(t("Choose the existing master to update.")); return; }
    if (updateId && !window.confirm(t("Update the existing master with this upload? Its previous content will be saved as a revision; customized CVs will be preserved."))) return;

    setConverting(true);

    try {
      await api.patchImportResult(importId, { ...contentToSave, language: cvLanguage });
      const converted = await api.createMasterCvFromImport(importId, { language: cvLanguage, ...(updateId ? { update_master_cv_id: updateId } : {}) });

      completeStep("create_cv");

      trackOnboardingStepCompleted({
        step: "cv_score",
        destination,
        parse_needs_manual_review: parseNeedsManualReview,
      });

      if (destination === "tailor") {
        navigate(`/app/tailor/${converted.master_cv.id}`, {
          state: {
            source: "onboarding_upload",
          },
        });
        return;
      }

      navigate(`/app/cv/${converted.master_cv.id}`, {
        state: {
          cvKind: "master",
          masterCvId: converted.master_cv.id,
          isUploaded: true,
        },
      });
    } catch (err) {
      if (err instanceof Error) {
        setError(err.message);
      } else {
        setError(t("Failed to convert import to main CV."));
      }
      setConverting(false);
    }
  };

  const handleImproveWithAI = () => {
    if (!cvLanguage) { setError(t("Choose CV language")); return; }
    const matching = availableMasters.filter(cv => documentLocale(cv.language) === cvLanguage && (cv.module_type ?? "standard") === (moduleType ?? "standard"));
    const updateId = matching.length === 1 ? matching[0].id : matching.find(cv => cv.id === updateMasterId)?.id;
    if (matching.length > 1 && !updateId) { setError(t("Choose the existing master to update.")); return; }
    if (updateId && !window.confirm(t("Update the existing master with this upload? Its previous content will be saved as a revision; customized CVs will be preserved."))) return;
    if (!parsedContent || !importId || parseNeedsManualReview) {
      return;
    }

    navigate("/app/ai-improving", {
      state: {
        importId,
        parsedContent: parsedContent ? { ...parsedContent, language: cvLanguage } : parsedContent,
        updateMasterId: updateId,
        improvements,
        moduleType,
        source: "onboarding_upload",
      },
    });
  };

  const handleCustomizeForJob = () => {
    if (!parsedContent || parseNeedsManualReview) {
      return;
    }
    void convertImportToMasterCv(parsedContent, "tailor");
  };

  const handleReviewInEditor = () => {
    if (!parsedContent) {
      return;
    }
    void convertImportToMasterCv(parsedContent, "editor");
  };

  if (loading) {
    return (
      <div
        className="min-h-screen flex items-center justify-center p-8"
        style={{ background: "var(--color-background-secondary)" }}
      >
        <p style={{ fontSize: "14px", color: "var(--color-text-secondary)" }}>
          {t("Loading your CV review...")}</p>
      </div>
    );
  }

  return (
    <div
      className="min-h-screen flex items-center justify-center p-4 sm:p-8"
      style={{ background: "var(--color-background-secondary)" }}
    >
      <div className="max-w-2xl w-full">
        {parsedContent && <details className="mb-5 p-4 bg-white border rounded-xl"><summary className="cursor-pointer text-sm font-medium">{t("Review parsed content")}</summary><div className="max-h-96 overflow-y-auto mt-4" lang={cvLanguage || parsedContent.language}>{parsedContent.sections.map(section => <section className="mb-4" key={section.id}><h3 className="font-medium">{section.title}</h3>{section.blocks.map(block => <p key={block.id} className="text-sm whitespace-pre-wrap mt-1">{Object.values(block.fields).map(value => typeof value === "string" ? value : Array.isArray(value) ? value.filter(item=>typeof item==="string").join(" · ") : "").filter(Boolean).join("\n")}</p>)}</section>)}</div></details>}
        {parsedContent && moduleType !== "medical_uk" && <div className="mb-5 p-4 bg-white border rounded-xl">
          <label className="text-sm font-medium">{t("Source CV language")}
            <select value={cvLanguage} onChange={event => { setCvLanguage(event.target.value); setUpdateMasterId(""); }} className="ml-3 border rounded-lg px-3 py-2">
              <option value="">{t("Choose CV language")}</option>{LANGUAGES.map(language => <option key={language.code} value={language.code}>{language.name}</option>)}
            </select>
          </label>
          <p className="text-sm text-gray-500 mt-2">{t("Confirm the language already used in this upload. To translate it, save it first and choose Translate in My CVs.")}</p>
          {availableMasters.filter(cv => documentLocale(cv.language) === cvLanguage && cv.module_type === "standard").length > 1 && <label className="block mt-3 text-sm">{t("Update existing master")}<select value={updateMasterId} onChange={event => setUpdateMasterId(event.target.value)} className="ml-3 border rounded-lg px-3 py-2"><option value="">{t("Choose the existing master to update.")}</option>{availableMasters.filter(cv=>documentLocale(cv.language)===cvLanguage&&cv.module_type==="standard").map(cv=><option key={cv.id} value={cv.id}>{cv.title}</option>)}</select></label>}
        </div>}

        <div
          className="p-5 sm:p-8 rounded-2xl border"
          style={{
            background: "var(--color-background-primary)",
            borderColor: "var(--color-border-tertiary)",
          }}
        >
          <div className="text-center mb-8">
            <h1
              className="font-medium mb-2"
              style={{ fontSize: "24px", color: "var(--color-text-primary)" }}
            >
              {t("Your CV Score")}</h1>
            <p
              style={{ fontSize: "14px", color: "var(--color-text-secondary)" }}
            >
              {t("Based on")}{" "}{fileName || "uploaded file"}
            </p>
            <p className="mt-2 text-xs" style={{ color: "var(--color-text-secondary)" }}>{t("This score is guidance and does not guarantee employment outcomes.")}</p>
          </div>

          {fromGuest && me?.user.onboarding_answers && (
            <p
              className="mb-6 text-sm"
              style={{ color: "var(--color-text-secondary)" }}
            >
              {personalizedGuidance(me.user.onboarding_answers)[0]}
            </p>
          )}
          {error && (
            <div
              className="mb-6 p-4 rounded-xl border"
              style={{
                borderColor: "var(--color-red-200)",
                background: "var(--color-red-50)",
                color: "var(--color-red-700)",
                fontSize: "13px",
              }}
            >
              {t(error)}
            </div>
          )}

          <div className="mb-8">
            {review ? (
              <CvReviewPanel review={review} />
            ) : (
              <p role="status" style={{ color: "var(--color-text-secondary)" }}>
                {t("A reliable review is unavailable. Please try uploading your CV again.")}</p>
            )}
          </div>

          {parseNeedsManualReview ? (
            <button
              type="button"
              onClick={() => navigate("/app/create")}
              className="w-full mb-4 px-6 py-3 rounded-lg border text-sm font-medium"
              style={{
                borderColor: "var(--color-border-secondary)",
                color: "var(--color-text-primary)",
              }}
            >
              {t("Upload another CV")}</button>
          ) : null}

          <div className="space-y-3">
            {fromGuest && (
              <button
                onClick={handleReviewInEditor}
                disabled={converting || !parsedContent}
                className="w-full px-6 py-3 rounded-lg font-medium inline-flex items-center justify-center gap-2"
                style={{
                  background: "var(--color-teal-600)",
                  color: "white",
                  fontSize: "14px",
                }}
              >
                {converting ? (
                  <Loader2 size={16} className="animate-spin" />
                ) : (
                  <ArrowRight size={16} />
                )}
                {t("Continue to CV editor")}</button>
            )}
            <button
              onClick={handleCustomizeForJob}
              disabled={converting || !parsedContent || parseNeedsManualReview}
              className="w-full px-6 py-3 rounded-lg font-medium flex items-center justify-center gap-2 transition-all hover:shadow-md"
              style={{
                background: fromGuest ? "transparent" : "var(--color-teal-600)",
                color: fromGuest ? "var(--color-text-primary)" : "white",
                border: fromGuest
                  ? "1px solid var(--color-border-tertiary)"
                  : undefined,
                fontSize: "14px",
                opacity: converting || parseNeedsManualReview ? 0.7 : 1,
              }}
            >
              {converting ? (
                <Loader2 size={16} className="animate-spin" />
              ) : (
                <Sparkles size={16} />
              )}
              {t("Customize for a job")}<ArrowRight size={16} />
            </button>

            <button
              onClick={handleImproveWithAI}
              disabled={converting || !parsedContent || parseNeedsManualReview}
              className="w-full px-6 py-3 rounded-lg font-medium transition-all hover:bg-[var(--color-background-secondary)] inline-flex items-center justify-center gap-2"
              style={{
                background: "transparent",
                border: "1px solid var(--color-border-tertiary)",
                color: "var(--color-text-primary)",
                fontSize: "14px",
                opacity: converting ? 0.7 : 1,
              }}
            >
              <Sparkles size={16} />
              {t("Improve with AI")}</button>

            {!fromGuest && (
              <button
                onClick={handleReviewInEditor}
                disabled={converting || !parsedContent}
                className="w-full px-6 py-3 rounded-lg font-medium transition-all hover:bg-[var(--color-background-secondary)] inline-flex items-center justify-center gap-2"
                style={{
                  background: "transparent",
                  border: "1px solid var(--color-border-tertiary)",
                  color: "var(--color-text-secondary)",
                  fontSize: "14px",
                  opacity: converting ? 0.7 : 1,
                }}
              >
                {converting ? (
                  <Loader2 size={16} className="animate-spin" />
                ) : null}
                {t("Review parsed result in editor")}</button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
