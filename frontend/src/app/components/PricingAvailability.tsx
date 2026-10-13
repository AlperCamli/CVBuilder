import { translate as t } from "../localization/i18n";
export function PricingAvailability({
  loading,
  ready,
  error,
  retry,
}: {
  loading: boolean;
  ready: boolean;
  error: string | null;
  retry: () => unknown;
}) {
  if (ready) return null;
  return (
    <p role="status" className="my-3 text-sm text-slate-600">
      {loading ? (
        t("Loading prices…")
      ) : (
        <>
          {error || t("Pricing is temporarily unavailable")}{" "}
          <button type="button" onClick={() => retry()} className="underline">
            {t("Retry")}
          </button>
        </>
      )}
    </p>
  );
}
