import { Link } from "react-router";
import type { PrivacyConfig } from "../integration/privacy";
import "./privacy.css";

export function AiUploadDisclosure({config, checked = true, disabled = false, onChange}: {
  config: PrivacyConfig | null; checked?: boolean; disabled?: boolean; onChange?: (accepted: boolean) => void;
}) {
  const provider = config?.ai_provider ?? "our configured AI provider";
  const policy = config?.processors.find(row => row.name === provider);
  return <div className="ai-upload-disclosure">
    <label className="ai-upload-choice">
      {onChange && <input type="checkbox" checked={checked} disabled={disabled} onChange={event => onChange(event.target.checked)} />}
      <strong>{onChange ? "Enable AI-powered CV analysis" : "AI-powered CV analysis"}</strong>
    </label>
    <p>JobSpecificCV sends relevant CV information and your instructions to {provider} to structure your CV and generate improvements. Your CV score is calculated separately using the app’s scoring rules.</p>
    <p>Review how your information is processed, stored and protected in our <Link to="/privacy">Privacy notice</Link>.</p>
    {policy && <p>{policy.safeguards.split(/(?<=\.)\s/)[0]}</p>}
    <p>{config?.ai_required !== false ? "AI processing is required for JobSpecificCV’s CV-building experience. You can withdraw this choice and enable it again at any time." : "Without AI, basic parsing, your guidance score and manual editing still work."} Already transmitted information cannot automatically be recalled.</p>
    {policy && <details><summary>Provider data use and retention</summary><p>{policy.safeguards}</p><p>{policy.retention}</p><p>{policy.countries}</p></details>}
  </div>;
}
