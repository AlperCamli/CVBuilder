const baseLanguage = (language: string) =>
  language.toLowerCase().split(/[-_]/)[0];

// Keep the newest item in each initial language ahead of older versions.
// The API returns CVs in most-recently-updated order.
export const prioritizeMasterLanguages = <T extends { language: string }>(
  masters: T[],
) => {
  if (masters.length === 0) return { items: masters, initialCount: 0 };
  const english = masters.findIndex((cv) => baseLanguage(cv.language) === "en");
  const first = english === -1 ? 0 : english;
  const second = masters.findIndex(
    (cv) => baseLanguage(cv.language) !== baseLanguage(masters[first].language),
  );
  const preferred = second === -1 ? [first] : [first, second];
  return {
    items: [
      ...preferred.map((index) => masters[index]),
      ...masters.filter((_, index) => !preferred.includes(index)),
    ],
    initialCount: preferred.length,
  };
};
