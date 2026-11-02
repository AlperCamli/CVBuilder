import { translate as t } from "../localization/i18n";
import { useTranslation } from "react-i18next";
import { useId, type Ref, type ReactNode } from "react";
import { Link } from "react-router";
import type { PrivacyConfig } from "../integration/privacy";
import "./privacy.css";

export function AiUploadDisclosure({config, checked = true, disabled = false, onChange, collapsible = false, highlighted = false, inputRef, onHighlightEnd, extraDetails, consentOnUpload = false}: {
  extraDetails?: ReactNode; config: PrivacyConfig | null; checked?: boolean; disabled?: boolean; onChange?: (accepted: boolean) => void; collapsible?: boolean; highlighted?: boolean; inputRef?: Ref<HTMLInputElement>; onHighlightEnd?: () => void;
  /** Choosing a file is the consent: show the essentials beside the upload action instead of a checkbox. */
  consentOnUpload?: boolean;
}) {
  useTranslation();
  const hintId = useId();
  const provider = config?.ai_provider ?? t("our configured AI provider");
  const policy = config?.processors.find(row => row.name === provider);
  const details = <>
    {extraDetails}
    <p>{t("JobSpecificCV sends relevant CV information and your instructions to")}{" "}{provider} {" "}{t("to structure your CV, rate its content for your CV score and generate improvements. The score itself is calculated from those ratings using the app’s scoring rules.")}</p>
    <p>{t("Review how your information is processed, stored and protected in our")}{" "}<Link to="/privacy">{t("Privacy notice")}</Link>{"."}</p>
    {policy && <p>{policy.safeguards.split(/(?<=\.)\s/)[0]}</p>}
    <p>{config?.ai_required !== false ? t("AI processing is required for JobSpecificCV’s CV-building experience. You can withdraw this choice and enable it again at any time.") : t("Without AI, basic parsing, your guidance score and manual editing still work.")} {" "}{t("Already transmitted information cannot automatically be recalled.")}</p>
    {policy && <details><summary>{t("Provider data use and retention")}</summary><p>{policy.safeguards}</p><p>{policy.retention}</p><p>{policy.countries}</p></details>}
  </>;
  if (consentOnUpload) return <div className="ai-upload-disclosure is-upload-consent">
    <p className="ai-upload-consent">{t("By uploading, you agree that JobSpecificCV sends your CV’s content to {{provider}} to structure it and rate it for your CV score.", { provider })}{" "}<Link to="/privacy">{t("Privacy notice")}</Link></p>
    <details className="ai-upload-details"><summary>{t("How we use your data")}</summary>{details}</details>
  </div>;
  return <div className={`ai-upload-disclosure${highlighted ? " is-highlighted" : ""}`}>
    <label className="ai-upload-choice">
      {onChange && <span className="ai-upload-checkbox">
        <input ref={inputRef} type="checkbox" checked={checked} disabled={disabled} aria-describedby={highlighted ? hintId : undefined} onChange={event => onChange(event.target.checked)} />
        {highlighted && <span aria-hidden="true" className="ai-upload-warning" onAnimationEnd={onHighlightEnd} />}
      </span>}
      <strong>{onChange ? t("Enable AI-powered CV analysis") : t("AI-powered CV analysis")}</strong>
    </label>
    {highlighted && <p id={hintId} role="alert" className="sr-only">{t("To upload your CV, select “Enable AI-powered CV analysis”.")}</p>}
    {collapsible ? <details className="ai-upload-details"><summary>{t("How we use your data")}</summary>{details}</details> : details}
  </div>;
}
