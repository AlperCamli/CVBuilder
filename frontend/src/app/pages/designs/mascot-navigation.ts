/** Keep pricing actions close to the selector and actual cards, beyond the intro. */
export function journeyScrollTarget(id: string): number | null {
  const section = document.getElementById(id);
  if (!section) return null;
  const target =
    id === "plans"
      ? (section.querySelector(".cv-billing-controls") ?? section)
      : section;
  return Math.max(
    0,
    target.getBoundingClientRect().top +
      window.scrollY -
      (id === "plans"
        ? 24
        : id === "templates"
          ? parseFloat(getComputedStyle(section).scrollMarginTop) || 0
          : 0),
  );
}

export function scrollToJourneySection(id: string, behavior?: ScrollBehavior) {
  const top = journeyScrollTarget(id);
  if (top === null) return;
  window.scrollTo({
    top,
    behavior:
      behavior ??
      (window.matchMedia("(prefers-reduced-motion: reduce)").matches
        ? "instant"
        : "smooth"),
  });
}
