import { afterEach, describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { i18n } from "../localization/i18n";
import { scoreGain } from "../integration/import-improve";
import { ScoreImprovementResult } from "./ScoreImprovementResult";

afterEach(async () => { await i18n.changeLanguage("en"); });

describe("score result after Improve with AI", () => {
  it("is shown only when the server reports a higher score", () => {
    expect(scoreGain({ before: 62, after: 71 })).toEqual({ before: 62, after: 71 });
    expect(scoreGain({ before: 62, after: 62 })).toBeNull();
    expect(scoreGain({ before: 62, after: 60 })).toBeNull();
    expect(scoreGain(null)).toBeNull();
    expect(scoreGain(undefined)).toBeNull();
    expect(scoreGain({ before: Number.NaN, after: 70 })).toBeNull();
  });

  it("shows the score going from before to after with one Continue button, and nothing else", () => {
    const html = renderToStaticMarkup(<ScoreImprovementResult before={62} after={71} onContinue={() => undefined} />);
    expect(html).toContain("Your CV score went up");
    expect(html).toContain('aria-label="Your CV score went from 62 to 71 out of 100"');
    expect(html).toMatch(/line-through[^>]*>62</);
    expect(html).toMatch(/>71</);
    expect(html.match(/<button/g)).toHaveLength(1);
    expect(html).toContain("Continue");
    // No per-area breakdown, formula or explanation.
    expect(html).not.toMatch(/Wording|Experience depth|Role focus|Measurable results|formula|breakdown|How we evaluate/i);
  });

  it("speaks Turkish in the informal form", async () => {
    await i18n.changeLanguage("tr");
    const html = renderToStaticMarkup(<ScoreImprovementResult before={48} after={57} onContinue={() => undefined} />);
    expect(html).toContain("CV puanın yükseldi");
    expect(html).toContain("CV puanın 100 üzerinden 48 iken 57 oldu");
    expect(html).toContain("İyileştirmeler ana CV’ne kaydedildi.");
    expect(html).toContain("Devam et");
  });
});
