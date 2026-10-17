import { useEffect, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router";
import { useTranslation } from "react-i18next";
import {
  LANGUAGES,
  chooseLocale,
  i18n,
  publicPath,
  readLocale,
  isLanguagePreview,
  translate,
  translateInLocale,
  type Locale,
} from "./i18n";

export function LanguageSwitcher() {
  const { i18n: instance } = useTranslation();
  const location = useLocation();
  const navigate = useNavigate();
  const change = (locale: Locale) => {
    chooseLocale(locale);
    if (["/", "/pricing", "/tr", "/tr/pricing"].includes(location.pathname)) {
      const base = location.pathname.replace(/^\/tr/, "") || "/";
      navigate(`${publicPath(base, locale)}${location.search}${location.hash}`);
    }
  };
  return (
    <select
      aria-label={translate("Language / Dil")}
      value={
        isLanguagePreview()
          ? instance.language
          : instance.language === "tr"
            ? "tr"
            : "en"
      }
      disabled={isLanguagePreview()}
      onChange={(event) => change(event.target.value as Locale)}
      className="rounded-lg border bg-transparent px-2 py-1 text-sm"
    >
      {LANGUAGES.map((language) => (
        <option key={language.code} value={language.code}>
          {language.flag} {language.name}
        </option>
      ))}
      {isLanguagePreview() &&
        !LANGUAGES.some((language) => language.code === instance.language) && (
          <option value={instance.language}>{instance.language}</option>
        )}
    </select>
  );
}

export function LanguageChooser() {
  useTranslation();
  const location = useLocation();
  const forcePreview =
    isLanguagePreview() &&
    new URLSearchParams(location.search).get("languageChooserPreview") === "1";
  const [open, setOpen] = useState(false);
  const dialog = useRef<HTMLDialogElement>(null);
  const handled = useRef(false);
  useEffect(() => {
    if (forcePreview) {
      if (!handled.current) {
        handled.current = true;
        setOpen(true);
      }
      return;
    }
    // Authentication callbacks and account initialization must complete first.
    if (
      isLanguagePreview() ||
      location.pathname.startsWith("/designs") ||
      /^\/(auth\/callback|reset-password|app)(\/|$)/.test(location.pathname) ||
      handled.current
    )
      return;
    const restore = () => {
      if (handled.current) return;
      handled.current = true;
      const remembered = readLocale();
      if (remembered) {
        chooseLocale(remembered, false);
        if (
          ["/", "/pricing", "/tr", "/tr/pricing"].includes(location.pathname)
        ) {
          const base = location.pathname.replace(/^\/tr/, "") || "/";
          const nextPath = publicPath(base, remembered);
          if (nextPath !== location.pathname)
            navigate(`${nextPath}${location.search}${location.hash}`, {
              replace: true,
            });
        }
      } else setOpen(true);
    };
    // React hydrates Suspense boundaries after the surrounding shell's effects.
    // Wait for the public page's own effect before changing its initial language.
    if (
      /^(\/|\/pricing|\/tr|\/tr\/pricing|\/guided-journey(?:\/pricing)?)\/?$/.test(
        location.pathname,
      ) &&
      document.getElementById("root")?.dataset.publicHydrated !==
        location.pathname
    ) {
      const ready = (event: Event) => {
        if ((event as CustomEvent).detail === location.pathname) restore();
      };
      window.addEventListener("cv-public-hydrated", ready);
      return () => window.removeEventListener("cv-public-hydrated", ready);
    }
    restore();
  }, [location.pathname, forcePreview]);
  useEffect(() => {
    if (open && !dialog.current?.open) dialog.current?.showModal();
    window.dispatchEvent(
      new CustomEvent("cv-language-dialog", { detail: open }),
    );
    return () => {
      window.dispatchEvent(
        new CustomEvent("cv-language-dialog", { detail: false }),
      );
    };
  }, [open]);
  const navigate = useNavigate();
  const choose = (locale: Locale) => {
    chooseLocale(locale);
    setOpen(false);
    dialog.current?.close();
    if (["/", "/pricing", "/tr", "/tr/pricing"].includes(location.pathname)) {
      const base = location.pathname.replace(/^\/tr/, "") || "/";
      navigate(
        `${publicPath(base, locale)}${location.search}${location.hash}`,
        { replace: true },
      );
    }
  };
  return (
    <dialog
      ref={dialog}
      aria-labelledby="language-choice-title"
      onCancel={(event) => event.preventDefault()}
      className="fixed inset-0 m-auto max-h-[calc(100dvh_-_2rem)] overflow-y-auto rounded-2xl border-0 p-8 shadow-xl backdrop:bg-black/40 max-w-sm w-[calc(100%_-_2rem)]"
    >
      <h2
        id="language-choice-title"
        lang="en"
        className="text-xl font-medium mb-2"
      >
        {translateInLocale("Choose your language", "en")}
      </h2>
      <p lang="tr" className="mb-6 text-slate-600">
        {translateInLocale("Choose your language", "tr")}
      </p>
      <div className="flex gap-3">
        {LANGUAGES.map((language) => (
          <button
            key={language.code}
            type="button"
            autoFocus={language.code === (i18n.language === "tr" ? "tr" : "en")}
            onClick={() => choose(language.code)}
            className="flex-1 rounded-xl border px-4 py-4 hover:bg-teal-50"
          >
            <span aria-hidden="true">{language.flag}</span> {language.name}
          </button>
        ))}
      </div>
    </dialog>
  );
}
