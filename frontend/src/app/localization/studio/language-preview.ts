import { setLanguagePreview } from "../i18n";
import { languageCode } from "./language-catalog";
import { applyPreviewCatalog } from "./preview-catalog";

/** Same-origin, session-bound preview bridge; loaded only in review builds. */
export function installLanguagePreview() {
  const parameters = new URLSearchParams(window.location.search);
  const session = parameters.get("previewSession");
  if (!session || !/^[\w-]{8,80}$/.test(session) || window.parent === window)
    return;
  let initial = "tr";
  try {
    initial = languageCode(parameters.get("previewLocale") ?? "tr");
  } catch {
    /* default */
  }
  const rendered = new Map<string, string[]>();
  let inspection = true;
  let selected = "";
  let scheduled = 0;
  const post = (message: object) =>
    window.parent.postMessage({ ...message, session }, window.location.origin);
  const keyForText = (value: string | null) =>
    rendered.get(value?.trim() ?? "")?.[0];
  const scan = () => {
    scheduled = 0;
    const present = new Set<string>();
    const markers = new Map<HTMLElement, string[]>();
    const mark = (element: HTMLElement, key: string) => {
      const keys = markers.get(element) ?? [];
      if (!keys.includes(key)) markers.set(element, [...keys, key]);
      present.add(key);
    };
    for (const element of document.querySelectorAll<HTMLElement>(
      "[data-language-text]",
    )) {
      element.removeAttribute("data-language-text");
      element.removeAttribute("data-language-keys");
      element.removeAttribute("data-language-selected");
    }
    const walker = document.createTreeWalker(
      document.body,
      NodeFilter.SHOW_TEXT,
    );
    while (walker.nextNode()) {
      const node = walker.currentNode;
      const key = keyForText(node.textContent);
      const parent = node.parentElement;
      if (
        !key ||
        !parent ||
        parent.closest("script, style, textarea, [contenteditable=true]")
      )
        continue;
      mark(parent, key);
    }
    for (const element of document.querySelectorAll<HTMLElement>(
      "[placeholder], [aria-label], [title]",
    )) {
      const key =
        keyForText(element.getAttribute("placeholder")) ??
        keyForText(element.getAttribute("aria-label")) ??
        keyForText(element.getAttribute("title"));
      if (key) {
        mark(element, key);
      }
    }
    for (const [element, keys] of markers) {
      element.dataset.languageText = keys[0];
      element.dataset.languageKeys = JSON.stringify(keys);
      if (keys.includes(selected)) element.dataset.languageSelected = "true";
    }
    document.documentElement.dataset.languageInspect = String(inspection);
    post({
      type: "language:rendered",
      keys: Array.from(present),
      path: `${window.location.pathname}${window.location.hash}`,
    });
  };
  const schedule = () => {
    if (!scheduled) scheduled = requestAnimationFrame(scan);
  };
  const observe = (key: string, result: string) => {
    const text = result.trim();
    const values = rendered.get(text) ?? [];
    if (!values.includes(key)) {
      rendered.set(text, [...values, key]);
      schedule();
    }
  };
  setLanguagePreview(initial, observe);
  const style = document.createElement("style");
  style.textContent =
    'html[data-language-inspect="true"] [data-language-text]:hover { outline: 2px dashed #8b5cf6 !important; outline-offset: 3px; cursor: crosshair !important; } [data-language-selected] { outline: 2px solid #8b5cf6 !important; outline-offset: 4px; }';
  document.head.appendChild(style);
  new MutationObserver(schedule).observe(document.body, {
    childList: true,
    subtree: true,
    characterData: true,
  });
  window.addEventListener("hashchange", schedule);
  window.addEventListener("message", async (event) => {
    if (
      event.origin !== window.location.origin ||
      event.source !== window.parent ||
      event.data?.session !== session
    )
      return;
    if (event.data.type === "language:configure") {
      try {
        rendered.clear();
        const config = await applyPreviewCatalog(
          event.data.configuration,
          observe,
        );
        document.documentElement.lang = config.code;
        document.documentElement.dir = config.direction;
        inspection = event.data.inspect !== false;
        selected =
          typeof event.data.selectedKey === "string"
            ? event.data.selectedKey
            : "";
        schedule();
        post({ type: "language:applied", code: config.code });
      } catch {
        post({
          type: "language:error",
          message: "The preview configuration could not be applied.",
        });
      }
    } else if (
      event.data.type === "language:focus" &&
      typeof event.data.key === "string"
    ) {
      selected = event.data.key;
      scan();
      Array.from(document.querySelectorAll<HTMLElement>("[data-language-text]"))
        .find((element) =>
          JSON.parse(element.dataset.languageKeys ?? "[]").includes(selected),
        )
        ?.scrollIntoView({ block: "center", behavior: "smooth" });
    }
  });
  document.addEventListener(
    "click",
    (event) => {
      if (!inspection || !(event.target instanceof Element)) return;
      const target = event.target.closest<HTMLElement>("[data-language-text]");
      if (!target) return;
      // Resolve the exact text node for headings with several translated fragments.
      const caret = (
        document as Document & {
          caretRangeFromPoint?: (x: number, y: number) => Range | null;
        }
      ).caretRangeFromPoint?.(event.clientX, event.clientY);
      const key =
        (caret?.startContainer.nodeType === Node.TEXT_NODE && target.contains(caret.startContainer)
          ? keyForText(caret.startContainer.textContent)
          : null) ?? target.dataset.languageText;
      if (!key) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      selected = key;
      post({ type: "language:select", key });
      schedule();
    },
    true,
  );
  post({ type: "language:ready" });
}
