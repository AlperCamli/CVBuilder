import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
} from "react";
import { Link } from "react-router";
import {
  ArrowLeft,
  Check,
  Download,
  Languages,
  MousePointer2,
  Plus,
  Redo2,
  RotateCcw,
  Search,
  Undo2,
  Upload,
} from "lucide-react";
import {
  areasForKey,
  TEXT_AREAS,
} from "../../localization/studio/catalog-context";
import {
  BUILT_IN_CATALOGS,
  LANGUAGE_DRAFT_KEY,
  MAX_IMPORT_BYTES,
  SOURCE_CATALOG,
  catalogKeys,
  createLanguage,
  exportCatalog,
  importLanguageFile,
  initialWorkspace,
  parseWorkspace,
  placeholderProblem,
  placeholders,
  type LanguageConfiguration,
  type LanguageWorkspace,
} from "../../localization/studio/language-catalog";
import "./language-studio.css";
import { CvLanguageSettings } from "./CvLanguageSettings";
import { exportCvLanguageCatalog } from "../../localization/studio/cv-language-catalog";

const PREVIEW_PAGES = [
  [
    "language-chooser",
    "First-visit language chooser",
    "/?languageChooserPreview=1",
  ],
  ["landing", "Landing page", "/"],
  ["pricing", "Public pricing", "/pricing"],
  ["signin", "Sign in", "/signin"],
  ["signup", "Sign up", "/signup"],
  ["forgot", "Forgot password", "/forgot-password"],
  ["email", "Email confirmation", "/email-sent"],
  ["onboarding", "Onboarding", "/onboarding"],
  ["privacy", "Privacy notice", "/privacy"],
  ["dashboard", "Dashboard · demo", "/app"],
  ["cvs", "My CVs · demo", "/app/resumes"],
  ["editor", "CV editor · English document", "/app/cv/demo-master-en"],
  ["editor-tr", "CV editor · Turkish document", "/app/cv/demo-master-tr"],
  ["create", "Create or upload · demo", "/app/create"],
  ["tailor", "Tailoring · demo", "/app/tailor/demo-master-en"],
  ["billing", "App pricing · demo", "/app/pricing"],
  ["applications", "Applications · demo", "/app/job-tracker"],
  ["letters", "Cover letters · demo", "/app/cover-letters"],
  [
    "letter-editor",
    "Cover letter editor · English",
    "/app/cover-letter/demo-job-0",
  ],
  [
    "letter-editor-tr",
    "Cover letter editor · Turkish",
    "/app/cover-letter/demo-job-1",
  ],
  ["profile", "Profile · demo", "/app/profile"],
] as const;
function download(name: string, value: unknown) {
  const url = URL.createObjectURL(
    new Blob([`${JSON.stringify(value, null, 2)}\n`], {
      type: "application/json;charset=utf-8",
    }),
  );
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
function loadWorkspace() {
  try {
    const raw = localStorage.getItem(LANGUAGE_DRAFT_KEY);
    if (raw) return parseWorkspace(JSON.parse(raw));
  } catch {
    /* Built-in catalogs remain available. */
  }
  return initialWorkspace();
}
export default function LanguageStudio() {
  const [editorMode, setEditorMode] = useState<"interface" | "cv">("interface");
  const [workspace, setWorkspace] = useState<LanguageWorkspace>(loadWorkspace);
  const current = useRef(workspace);
  const past = useRef<LanguageWorkspace[]>([]),
    future = useRef<LanguageWorkspace[]>([]);
  const group = useRef({ key: "", at: 0 });
  const [key, setKey] = useState("Tailor your CV to any");
  const [search, setSearch] = useState(""),
    [area, setArea] = useState("All areas"),
    [status, setStatus] = useState("preview");
  const [limit, setLimit] = useState(100);
  const [page, setPage] = useState("landing"),
    [width, setWidth] = useState(1440),
    [inspect, setInspect] = useState(true);
  const [demoState, setDemoState] = useState("populated"),
    [demoPlan, setDemoPlan] = useState("monthly"),
    [demoMarket, setDemoMarket] = useState("TR"),
    [demoReset, setDemoReset] = useState(0);
  const [ready, setReady] = useState(false),
    [saved, setSaved] = useState(false);
  const [notice, setNotice] = useState(""),
    [error, setError] = useState("");
  const [previewKeys, setPreviewKeys] = useState<string[]>([]),
    [bounds, setBounds] = useState({ width: 1000, height: 850 });
  const [adding, setAdding] = useState(false),
    [newCode, setNewCode] = useState(""),
    [newName, setNewName] = useState(""),
    [newDirection, setNewDirection] = useState<"ltr" | "rtl">("ltr");
  const session = useRef(crypto.randomUUID());
  const frame = useRef<HTMLIFrameElement>(null),
    stage = useRef<HTMLDivElement>(null),
    file = useRef<HTMLInputElement>(null);
  const options = useRef({ key, inspect });
  options.current = { key, inspect };
  const configuration = workspace.languages.find(
    (language) => language.code === workspace.selectedLanguage,
  )!;
  const keys = useMemo(() => catalogKeys(configuration), [configuration]);
  const reviewed = useMemo(
    () => new Set(configuration.reviewed),
    [configuration.reviewed],
  );
  const previewSet = useMemo(() => new Set(previewKeys), [previewKeys]);
  const problems = useMemo(
    () =>
      keys.filter((key) =>
        placeholderProblem(key, configuration.translations[key] ?? ""),
      ),
    [keys, configuration.translations],
  );
  const missing = keys.filter(
    (key) => !configuration.translations[key]?.trim(),
  ).length;
  const filtered = useMemo(() => {
    const query = search.trim().toLocaleLowerCase();
    return keys.filter((key) => {
      const value = configuration.translations[key] ?? "";
      if (
        query &&
        !`${key} ${SOURCE_CATALOG[key] ?? ""} ${value}`
          .toLocaleLowerCase()
          .includes(query)
      )
        return false;
      if (area !== "All areas" && !areasForKey(key).includes(area))
        return false;
      if (status === "missing" && value.trim()) return false;
      if (
        status === "changed" &&
        value === (BUILT_IN_CATALOGS[configuration.code]?.[key] ?? "")
      )
        return false;
      if (status === "reviewed" && !reviewed.has(key)) return false;
      if (status === "unreviewed" && reviewed.has(key)) return false;
      if (status === "warnings" && !placeholderProblem(key, value))
        return false;
      if (status === "preview" && !previewSet.has(key)) return false;
      return true;
    });
  }, [keys, configuration, search, area, status, reviewed, previewSet]);
  useEffect(
    () => setLimit(100),
    [search, area, status, workspace.selectedLanguage],
  );
  const commit = useCallback(
    (
      update: (value: LanguageWorkspace) => LanguageWorkspace,
      historyKey = "change",
    ) => {
      const previous = current.current;
      const next = update(previous);
      if (JSON.stringify(previous) === JSON.stringify(next)) return;
      const now = Date.now();
      if (group.current.key !== historyKey || now - group.current.at > 800)
        past.current = [...past.current.slice(-59), previous];
      group.current = { key: historyKey, at: now };
      future.current = [];
      current.current = next;
      setWorkspace(next);
      setSaved(false);
      setError("");
      setNotice("");
    },
    [],
  );
  const editLanguage = (
    update: (language: LanguageConfiguration) => LanguageConfiguration,
    historyKey: string,
  ) =>
    commit(
      (value) => ({
        ...value,
        languages: value.languages.map((language) =>
          language.code === value.selectedLanguage
            ? update(language)
            : language,
        ),
      }),
      historyKey,
    );
  const save = useCallback(() => {
    try {
      localStorage.setItem(LANGUAGE_DRAFT_KEY, JSON.stringify(current.current));
      setSaved(true);
    } catch {
      setSaved(false);
      setError(
        "Browser storage is unavailable. Export workspace to keep your changes.",
      );
    }
  }, []);
  useEffect(() => {
    const timer = setTimeout(save, 250);
    return () => clearTimeout(timer);
  }, [workspace, save]);
  useEffect(() => {
    const flush = () => {
      try {
        localStorage.setItem(
          LANGUAGE_DRAFT_KEY,
          JSON.stringify(current.current),
        );
      } catch {
        /* export remains available */
      }
    };
    window.addEventListener("pagehide", flush);
    return () => {
      window.removeEventListener("pagehide", flush);
      flush();
    };
  }, []);
  const send = useCallback(
    (data: object) =>
      frame.current?.contentWindow?.postMessage(
        { ...data, session: session.current },
        window.location.origin,
      ),
    [],
  );
  const configure = useCallback(() => {
    const value = current.current;
    send({
      type: "language:configure",
      configuration: value.languages.find(
        (language) => language.code === value.selectedLanguage,
      ),
      selectedKey: options.current.key,
      inspect: options.current.inspect,
    });
  }, [send]);
  useEffect(() => {
    const listener = (event: MessageEvent) => {
      if (
        event.origin !== window.location.origin ||
        event.source !== frame.current?.contentWindow ||
        event.data?.session !== session.current
      )
        return;
      if (event.data.type === "language:ready") configure();
      if (
        event.data.type === "language:applied" &&
        event.data.code === current.current.selectedLanguage
      )
        setReady(true);
      if (
        event.data.type === "language:select" &&
        typeof event.data.key === "string"
      ) {
        setKey(event.data.key);
        setArea("All areas");
        setSearch("");
        setStatus("preview");
      }
      if (
        event.data.type === "language:rendered" &&
        Array.isArray(event.data.keys)
      )
        setPreviewKeys((previous) =>
          JSON.stringify(previous) === JSON.stringify(event.data.keys)
            ? previous
            : event.data.keys.filter(
                (key: unknown): key is string => typeof key === "string",
              ),
        );
      if (event.data.type === "language:error")
        setError(
          "The preview could not apply this configuration. Check the language code and try reloading the preview.",
        );
    };
    window.addEventListener("message", listener);
    return () => window.removeEventListener("message", listener);
  }, [configure]);
  useEffect(() => {
    const timer = setTimeout(configure, 120);
    return () => clearTimeout(timer);
  }, [workspace, key, inspect, configure]);
  useEffect(() => {
    if (!stage.current) return;
    const observer = new ResizeObserver(([entry]) =>
      setBounds({
        width: Math.max(220, entry.contentRect.width - 40),
        height: Math.max(280, entry.contentRect.height - 40),
      }),
    );
    observer.observe(stage.current);
    return () => observer.disconnect();
  }, []);
  const history = (direction: "undo" | "redo") => {
    const source = direction === "undo" ? past : future,
      target = direction === "undo" ? future : past;
    const next = source.current.pop();
    if (!next) return;
    target.current.push(current.current);
    current.current = next;
    setWorkspace(next);
    setSaved(false);
    group.current = { key: "", at: 0 };
  };
  const selectKey = (next: string) => {
    setKey(next);
    send({ type: "language:focus", key: next });
  };
  const addLanguage = () => {
    try {
      if (!newName.trim() || newName.trim().length > 80)
        throw new Error("Enter a language name of up to 80 characters.");
      const language = createLanguage(newCode.trim(), newName, newDirection);
      if (workspace.languages.some((value) => value.code === language.code))
        throw new Error(
          "This language already exists. Select it above to edit its catalog.",
        );
      commit(
        (value) => ({
          ...value,
          languages: [...value.languages, language],
          selectedLanguage: language.code,
        }),
        "add-language",
      );
      setReady(false);
      setAdding(false);
      setNewCode("");
      setNewName("");
      setStatus("missing");
    } catch (error) {
      setError(
        error instanceof Error ? error.message : "Could not add this language.",
      );
    }
  };
  const importFile = async (event: ChangeEvent<HTMLInputElement>) => {
    const chosen = event.target.files?.[0];
    event.target.value = "";
    if (!chosen) return;
    try {
      if (chosen.size > MAX_IMPORT_BYTES)
        throw new Error("Choose a JSON file smaller than 2 MB.");
      const imported = importLanguageFile(await chosen.text(), configuration);
      commit(
        (value) =>
          "kind" in imported
            ? imported
            : {
                ...value,
                selectedLanguage: imported.code,
                languages: value.languages.some(
                  (language) => language.code === imported.code,
                )
                  ? value.languages.map((language) =>
                      language.code === imported.code ? imported : language,
                    )
                  : [...value.languages, imported],
              },
        "import",
      );
      setSearch("");
      setStatus("all");
      setNotice("Imported. Your previous draft is available with Undo.");
    } catch (error) {
      setError(
        error instanceof Error ? error.message : "Could not import this file.",
      );
    }
  };
  const exportFile = () => {
    try {
      download(`${configuration.code}.json`, exportCatalog(configuration));
      setNotice(
        `Exported ${configuration.code}.json. Save it as frontend/src/app/localization/${configuration.code}.json when you are ready to publish.`,
      );
    } catch (error) {
      setError(
        error instanceof Error
          ? error.message
          : "Could not export this catalog.",
      );
    }
  };
  const previewPath = PREVIEW_PAGES.find(([id]) => id === page)?.[2] ?? "/";
  // Switching the draft language updates the existing frame, preserving forms.
  const previewUrl = new URL(previewPath, window.location.origin);
  previewUrl.searchParams.set("languagePreview", "1");
  previewUrl.searchParams.set("previewSession", session.current);
  previewUrl.searchParams.set("demoState", demoState);
  previewUrl.searchParams.set("demoPlan", demoPlan);
  previewUrl.searchParams.set("demoMarket", demoMarket);
  previewUrl.searchParams.set("demoReset", String(demoReset));
  const src = `${previewUrl.pathname}${previewUrl.search}`;
  const height = width < 700 ? 844 : 950;
  const scale = Math.min(1, bounds.width / width, bounds.height / height);
  const text = configuration.translations[key] ?? "";
  const warning = placeholderProblem(key, text);
  const required = placeholders(SOURCE_CATALOG[key] ?? key);
  return (
    <div className="language-studio">
      <header className="ls-header">
        <div className="ls-brand">
          <Link to="/designs/guided-journey" aria-label="Back to design review">
            <ArrowLeft size={19} />
          </Link>
          <span className="ls-logo">
            <Languages size={23} />
          </span>
          <div>
            <span>JOBSPECIFICCV · DESIGN TOOLS</span>
            <h1>Language Studio</h1>
          </div>
        </div>
        <div className="ls-actions">
          <span className="ls-save">
            <span className={saved ? "is-saved" : ""} />
            {saved ? "Saved on this browser" : "Saving draft…"}
          </span>
          <button onClick={() => file.current?.click()}>
            <Upload size={15} />
            Import JSON
          </button>
          <button
            onClick={() => {
              download("language-workspace.json", workspace);
              setNotice(
                "Exported all languages, review marks, and unfinished drafts.",
              );
            }}
          >
            <Download size={15} />
            Export workspace
          </button>
          <button className="ls-primary" onClick={exportFile}>
            <Download size={15} />
            Export catalog
          </button>
          <button onClick={() => {
            try {
              download("cv-languages.json", exportCvLanguageCatalog(workspace));
              setNotice("Exported CV languages. Import this catalog with the backend languages:import command to make it available to users.");
            } catch (error) { setError(error instanceof Error ? error.message : "Could not export CV languages."); }
          }}><Download size={15} />Export CV languages</button>
          <input
            hidden
            type="file"
            accept="application/json,.json"
            ref={file}
            onChange={importFile}
          />
        </div>
      </header>
      <div className="ls-workspace">
        <aside className="ls-inspector" aria-label="Language configuration">
          <div className="ls-intro">
            <span className="ls-eyebrow">EVERY WORD, IN YOUR VOICE</span>
            <h2>Make it sound right.</h2>
            <p>
              Edit the copy. See it on the actual page. Export when it feels
              ready.
            </p>
          </div>
          <div className="ls-language-row">
            <label htmlFor="ls-language">
              Editing language
              <select
                id="ls-language"
                value={workspace.selectedLanguage}
                onChange={(event) => {
                  commit(
                    (value) => ({
                      ...value,
                      selectedLanguage: event.target.value,
                    }),
                    "select-language",
                  );
                  setReady(false);
                }}
              >
                {workspace.languages.map((language) => (
                  <option key={language.code} value={language.code}>
                    {language.name} · {language.code}
                  </option>
                ))}
              </select>
            </label>
            <button
              aria-label="Add a language"
              aria-expanded={adding}
              onClick={() => setAdding(!adding)}
            >
              <Plus size={18} />
            </button>
          </div>
          {adding && (
            <div className="ls-add-language">
              <label>
                Language code
                <input
                  value={newCode}
                  placeholder="de, fr, ar, pt-BR"
                  onChange={(event) => setNewCode(event.target.value)}
                />
              </label>
              <label>
                Display name
                <input
                  value={newName}
                  placeholder="Deutsch"
                  onChange={(event) => setNewName(event.target.value)}
                />
              </label>
              <label>
                Text direction
                <select
                  value={newDirection}
                  onChange={(event) =>
                    setNewDirection(event.target.value as "ltr" | "rtl")
                  }
                >
                  <option value="ltr">Left to right</option>
                  <option value="rtl">Right to left</option>
                </select>
              </label>
              <button onClick={addLanguage}>Create language draft</button>
            </div>
          )}
          <div className="ls-progress">
            <div>
              <strong>
                {keys.length - missing}
                <span> / {keys.length}</span>
              </strong>
              <span>texts filled</span>
            </div>
            <div>
              <strong>{reviewed.size}</strong>
              <span>reviewed by you</span>
            </div>
            <progress
              value={keys.length - missing}
              max={keys.length}
              aria-label="Translation completeness"
            />
          </div>
          <label className="ls-search">
            <span className="ls-sr-only">Search source or translated text</span>
            <Search size={16} />
            <input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search any word or phrase…"
            />
          </label>
          <div className="ls-filters">
            <label>
              Area
              <select
                value={area}
                onChange={(event) => setArea(event.target.value)}
              >
                <option>All areas</option>
                {TEXT_AREAS.map((area) => (
                  <option key={area}>{area}</option>
                ))}
              </select>
            </label>
            <label>
              Show
              <select
                value={status}
                onChange={(event) => setStatus(event.target.value)}
              >
                <option value="all">All texts</option>
                <option value="preview">On preview page</option>
                <option value="missing">Missing translations</option>
                <option value="changed">Changed by you</option>
                <option value="unreviewed">Not reviewed</option>
                <option value="reviewed">Reviewed</option>
                <option value="warnings">Placeholder warnings</option>
              </select>
            </label>
          </div>
          <div className="ls-list-title">
            <span>{filtered.length} texts</span>
            {problems.length > 0 && (
              <button
                onClick={() => {
                  setArea("All areas");
                  setSearch("");
                  setStatus("warnings");
                }}
              >
                {problems.length} warnings
              </button>
            )}
          </div>
          <div className="ls-text-list" aria-label="Translation entries">
            {filtered.slice(0, limit).map((entry) => (
              <button
                key={entry}
                aria-pressed={entry === key}
                className={entry === key ? "is-active" : ""}
                onClick={() => selectKey(entry)}
              >
                <span
                  className={`ls-text-dot ${!configuration.translations[entry]?.trim() ? "is-missing" : reviewed.has(entry) ? "is-reviewed" : ""}`}
                />
                <span>
                  <strong>{SOURCE_CATALOG[entry] ?? entry}</strong>
                  <small>
                    {configuration.translations[entry]?.trim() ||
                      "Translation needed"}
                  </small>
                </span>
                {reviewed.has(entry) && <Check size={13} />}
              </button>
            ))}
            {!filtered.length && (
              <p className="ls-empty">
                No matching texts. Try another search or filter.
              </p>
            )}
            {filtered.length > limit && (
              <button className="ls-more" onClick={() => setLimit(limit + 100)}>
                Show 100 more
              </button>
            )}
          </div>
          <footer className="ls-inspector-footer">
            <span>Drafts stay on this browser.</span>
            <Link to="/designs/guided-journey/editor">Companion Studio →</Link>
          </footer>
        </aside>
        <main className="ls-main">
          <div className="ls-preview-toolbar">
            <span className="ls-live-dot" />
            <strong>LIVE PREVIEW</strong>
            <label>
              <span className="ls-sr-only">Preview page</span>
              <select
                value={page}
                onChange={(event) => {
                  setReady(false);
                  setPreviewKeys([]);
                  setPage(event.target.value);
                }}
              >
                {PREVIEW_PAGES.map(([id, name]) => (
                  <option key={id} value={id}>
                    {name}
                  </option>
                ))}
              </select>
            </label>
            <label>
              <span className="ls-sr-only">Preview viewport</span>
              <select
                value={width}
                onChange={(event) => setWidth(Number(event.target.value))}
              >
                <option value={1440}>Desktop · 1440</option>
                <option value={768}>Tablet · 768</option>
                <option value={390}>Phone · 390</option>
                <option value={320}>Phone · 320</option>
              </select>
            </label>
            <button
              className={inspect ? "is-active" : ""}
              aria-pressed={inspect}
              onClick={() => setInspect(!inspect)}
            >
              <MousePointer2 size={15} />
              {inspect ? "Click text to edit" : "Interact with page"}
            </button>
            <div className="ls-history">
              <button
                aria-label="Undo language change"
                disabled={!past.current.length}
                onClick={() => history("undo")}
              >
                <Undo2 size={16} />
              </button>
              <button
                aria-label="Redo language change"
                disabled={!future.current.length}
                onClick={() => history("redo")}
              >
                <Redo2 size={16} />
              </button>
            </div>
          </div>
          <div className="ls-demo-toolbar">
            <span>Demo data · no sign-in needed</span>
            <label>
              State{" "}
              <select
                aria-label="Demo state"
                value={demoState}
                onChange={(event) => {
                  setReady(false);
                  setPreviewKeys([]);
                  setDemoState(event.target.value);
                }}
              >
                <option value="populated">Populated</option>
                <option value="empty">Empty</option>
                <option value="loading">Loading</option>
                <option value="error">Error</option>
              </select>
            </label>
            <label>
              Account{" "}
              <select
                aria-label="Demo account plan"
                value={demoPlan}
                onChange={(event) => {
                  setReady(false);
                  setDemoPlan(event.target.value);
                }}
              >
                <option value="monthly">Paid plan</option>
                <option value="free">Free plan</option>
              </select>
            </label>
            <label>
              Prices{" "}
              <select
                aria-label="Demo pricing market"
                value={demoMarket}
                onChange={(event) => {
                  setReady(false);
                  setDemoMarket(event.target.value);
                }}
              >
                <option value="TR">Turkey · TRY</option>
                <option value="GLOBAL">Global · USD</option>
              </select>
            </label>
            <button
              type="button"
              onClick={() => {
                setReady(false);
                setDemoReset((value) => value + 1);
              }}
            >
              Reset demo
            </button>
          </div>
          <div className="ls-canvas" ref={stage}>
            <div
              className="ls-frame"
              style={{ width: width * scale, height: height * scale }}
            >
              <iframe
                ref={frame}
                title="Live language preview"
                src={src}
                width={width}
                height={height}
                style={{ transform: `scale(${scale})` }}
                onLoad={configure}
              />
              {!ready && (
                <div className="ls-loading">Opening your preview…</div>
              )}
            </div>
          </div>
          <div className="ls-editor-tabs" role="group" aria-label="Language settings">
            <button type="button" aria-pressed={editorMode === "interface"} onClick={() => setEditorMode("interface")}>Interface text</button>
            <button type="button" aria-pressed={editorMode === "cv"} onClick={() => setEditorMode("cv")}>CV languages & headings</button>
          </div>
          {editorMode === "cv" && (
            <CvLanguageSettings
              configuration={configuration}
              onChange={(cvDocument, key) => editLanguage(language => ({ ...language, cvDocument }), key)}
            />
          )}
          {editorMode === "interface" && <section className="ls-editor" aria-label="Edit selected translation">
            <div className="ls-editor-heading">
              <div>
                <span className="ls-eyebrow">
                  SELECTED TEXT · {areasForKey(key).join(" / ")}
                </span>
                <h2>{configuration.name} translation</h2>
              </div>
              <button
                disabled={!previewSet.has(key)}
                onClick={() => send({ type: "language:focus", key })}
              >
                Find on page
              </button>
            </div>
            <div className="ls-copy-columns">
              <div>
                <label htmlFor="ls-source">English reference</label>
                <textarea
                  id="ls-source"
                  value={SOURCE_CATALOG[key] ?? key}
                  readOnly
                />
                <details>
                  <summary>Translation key</summary>
                  <code>{key}</code>
                </details>
              </div>
              <div>
                <label htmlFor="ls-translation">
                  Your text <span>{text.length} characters</span>
                </label>
                <textarea
                  id="ls-translation"
                  lang={configuration.code}
                  dir={configuration.direction}
                  value={text}
                  placeholder="Write your translation…"
                  onChange={(event) =>
                    editLanguage(
                      (language) => ({
                        ...language,
                        translations: {
                          ...language.translations,
                          [key]: event.target.value,
                        },
                        reviewed: language.reviewed.filter(
                          (entry) => entry !== key,
                        ),
                      }),
                      `text:${configuration.code}:${key}`,
                    )
                  }
                />
                {warning ? (
                  <p className="ls-warning" role="alert">
                    {warning}
                  </p>
                ) : required.length > 0 ? (
                  <p className="ls-placeholder-note">
                    Keep these placeholders:{" "}
                    {required.map((value) => (
                      <code key={value}>{`{{${value}}}`}</code>
                    ))}
                  </p>
                ) : (
                  <p className="ls-placeholder-note">
                    {previewSet.has(key)
                      ? "Updates appear in the preview as you type."
                      : "Open the relevant page or dialog to preview this text."}
                  </p>
                )}
              </div>
            </div>
            <div className="ls-editor-footer">
              <button
                onClick={() =>
                  editLanguage(
                    (language) => ({
                      ...language,
                      translations: {
                        ...language.translations,
                        [key]: BUILT_IN_CATALOGS[language.code]?.[key] ?? "",
                      },
                      reviewed: language.reviewed.filter(
                        (entry) => entry !== key,
                      ),
                    }),
                    "reset-text",
                  )
                }
              >
                <RotateCcw size={14} />
                Reset this text
              </button>
              <label className="ls-reviewed">
                <input
                  type="checkbox"
                  checked={reviewed.has(key)}
                  disabled={!text.trim() || Boolean(warning)}
                  onChange={(event) =>
                    editLanguage(
                      (language) => ({
                        ...language,
                        reviewed: event.target.checked
                          ? [...language.reviewed, key]
                          : language.reviewed.filter((entry) => entry !== key),
                      }),
                      "review-text",
                    )
                  }
                />
                Reviewed by me
              </label>
              <span>
                UI copy only · CV content and billing amounts keep their own
                settings.
              </span>
            </div>
          </section>}
          {(error || notice) && (
            <div
              className={`ls-notice ${error ? "is-error" : ""}`}
              role={error ? "alert" : "status"}
            >
              {error || notice}
              <button
                aria-label="Dismiss message"
                onClick={() => {
                  setError("");
                  setNotice("");
                }}
              >
                ×
              </button>
            </div>
          )}
        </main>
      </div>
    </div>
  );
}
