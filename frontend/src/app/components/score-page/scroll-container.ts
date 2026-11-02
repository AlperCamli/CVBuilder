/** What a page scrolls in: the app shell's <main> (overflow: auto), or the window outside it. */
export function scrollContainerOf(element: Element | null): HTMLElement | Window {
  for (let node = element?.parentElement ?? null; node && node !== document.body; node = node.parentElement) {
    const { overflowY } = getComputedStyle(node);
    if (overflowY === "auto" || overflowY === "scroll") return node;
  }
  return window;
}

/** The visible band of a scroll container, in viewport coordinates. */
export function visibleBand(container: HTMLElement | Window): { top: number; bottom: number } {
  if (container === window) return { top: 0, bottom: window.innerHeight };
  const rect = (container as HTMLElement).getBoundingClientRect();
  return { top: Math.max(0, rect.top), bottom: Math.min(window.innerHeight, rect.bottom) };
}
