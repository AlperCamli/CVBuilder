import { Link } from "react-router";
import { publicPath, translate as t } from "../localization/i18n";
import { supportEmailHref } from "../integration/support";

export function SupportHelp({ topic }: { topic: "Payment" | "CV upload" }) {
  return <p className="my-3 text-sm text-slate-600">
    {t("Need help?")}{" "}<a className="underline" href={supportEmailHref(topic)}>{t("Email support")}</a>
    {" · "}<Link className="underline" to={`${publicPath("/support")}#contact`} target="_blank" rel="noopener noreferrer">
      {t("Support guide")}<span className="sr-only"> {t("(opens in a new tab)")}</span>
    </Link>
  </p>;
}
