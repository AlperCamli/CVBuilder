import { translate as t } from "../localization/i18n";
import { useTranslation } from "react-i18next";
import { ArrowRight, TrendingUp } from "lucide-react";

const RADIUS = 52;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;
const tone = (score: number) => score >= 80 ? "var(--color-teal-600)" : score >= 60 ? "var(--color-yellow-700)" : "var(--color-red-600)";

/** Shown after Improve with AI when the CV score went up: the score change and one way forward. */
export function ScoreImprovementResult({ before, after, onContinue }: { before: number; after: number; onContinue: () => void }) {
  useTranslation();
  const color = tone(after);
  return (
    <div className="text-center" role="status">
      <div className="mx-auto mb-3 w-10 h-10 rounded-full flex items-center justify-center" style={{ background: "var(--color-teal-50)" }}>
        <TrendingUp size={20} style={{ color: "var(--color-teal-700)" }} aria-hidden="true" />
      </div>
      <h1 style={{ fontSize: "24px", color: "var(--color-text-primary)", fontWeight: 600 }}>{t("Your CV score went up")}</h1>
      <div className="mt-6 flex items-center justify-center gap-5" role="img" aria-label={t("CV score went from {{before}} to {{after}} out of 100", { before, after })}>
        <div className="text-center" aria-hidden="true">
          <p className="font-medium text-3xl line-through" style={{ color: "var(--color-text-secondary)" }}>{before}</p>
          <p className="text-xs mt-1" style={{ color: "var(--color-text-secondary)" }}>{t("out of 100")}</p>
        </div>
        <ArrowRight size={22} style={{ color: "var(--color-text-secondary)" }} aria-hidden="true" />
        <div className="relative h-[120px] w-[120px]" aria-hidden="true">
          <svg className="-rotate-90" width="120" height="120">
            <circle cx="60" cy="60" r={RADIUS} fill="none" stroke="var(--color-border-secondary)" strokeWidth="10" />
            <circle cx="60" cy="60" r={RADIUS} fill="none" stroke={color} strokeWidth="10" strokeLinecap="round"
              strokeDasharray={`${(Math.max(0, Math.min(100, after)) / 100) * CIRCUMFERENCE} ${CIRCUMFERENCE}`} />
          </svg>
          <div className="absolute inset-0 flex flex-col items-center justify-center">
            <p className="font-medium text-4xl" style={{ color }}>{after}</p>
            <p className="text-xs mt-1" style={{ color: "var(--color-text-secondary)" }}>{t("out of 100")}</p>
          </div>
        </div>
      </div>
      <p className="mt-5" style={{ fontSize: "14px", color: "var(--color-text-secondary)" }}>{t("Your improvements are saved to your Main CV.")}</p>
      <button
        type="button"
        onClick={onContinue}
        className="mt-6 inline-flex items-center justify-center gap-2 px-6 py-2.5 rounded-lg"
        style={{ fontSize: "14px", fontWeight: 600, background: "var(--color-teal-600)", color: "white" }}
      >
        {t("Continue")}
        <ArrowRight size={16} aria-hidden="true" />
      </button>
    </div>
  );
}
