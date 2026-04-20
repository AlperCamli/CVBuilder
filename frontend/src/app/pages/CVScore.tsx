import { useEffect, useMemo, useState } from "react";
import { useNavigate, useLocation } from "react-router";
import { TrendingUp, AlertCircle, Sparkles, ArrowRight, Loader2 } from "lucide-react";
import type { CvContent, ParseSummary } from "../integration/api-types";
import { useAuth } from "../integration/auth-context";
import { ApiClientError } from "../integration/api-error";

const countBlocks = (content: CvContent): number =>
  content.sections.reduce((sum, section) => sum + section.blocks.length, 0);

const computeScore = (content: CvContent): number => {
  const sectionCount = content.sections.length;
  const blockCount = countBlocks(content);
  const hasSummary = content.sections.some((section) => section.type === "summary");
  const hasExperience = content.sections.some((section) => section.type === "experience");
  const hasSkills = content.sections.some((section) => section.type === "skills");

  let score = 40;
  score += Math.min(sectionCount, 8) * 5;
  score += Math.min(blockCount, 18) * 2;
  if (hasSummary) score += 7;
  if (hasExperience) score += 8;
  if (hasSkills) score += 5;

  return Math.max(10, Math.min(97, score));
};

const buildImprovements = (content: CvContent): string[] => {
  const improvements: string[] = [];
  const hasSummary = content.sections.some((section) => section.type === "summary");
  const hasExperience = content.sections.some((section) => section.type === "experience");
  const hasEducation = content.sections.some((section) => section.type === "education");
  const hasSkills = content.sections.some((section) => section.type === "skills");

  if (!hasSummary) {
    improvements.push("Add a concise professional summary.");
  }
  if (!hasExperience) {
    improvements.push("Include at least one work experience section.");
  }
  if (!hasEducation) {
    improvements.push("Add education details for recruiter context.");
  }
  if (!hasSkills) {
    improvements.push("Add a skills section with role-relevant keywords.");
  }

  if (countBlocks(content) < 5) {
    improvements.push("Expand section content with measurable achievements.");
  }

  improvements.push("Review wording for ATS-friendly role-specific keywords.");

  return improvements.slice(0, 5);
};

export function CVScore() {
  const navigate = useNavigate();
  const location = useLocation();
  const { api } = useAuth();

  const importId = location.state?.importId as string | undefined;
  const fileName = location.state?.fileName as string | undefined;
  const parseSummary = location.state?.parseSummary as ParseSummary | undefined;

  const [loading, setLoading] = useState(true);
  const [converting, setConverting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [parsedContent, setParsedContent] = useState<CvContent | null>(null);

  useEffect(() => {
    if (!importId) {
      navigate("/app/create", { replace: true });
      return;
    }

    let cancelled = false;

    const load = async () => {
      setLoading(true);
      setError(null);

      try {
        const result = await api.getImportResult(importId);

        if (cancelled) {
          return;
        }

        if (!result.parsed_content) {
          throw new Error("Parsed content is not available yet.");
        }

        setParsedContent(result.parsed_content);
      } catch (err) {
        if (cancelled) {
          return;
        }
        if (err instanceof ApiClientError) {
          setError(err.message);
        } else if (err instanceof Error) {
          setError(err.message);
        } else {
          setError("Failed to load parsed CV.");
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    };

    void load();

    return () => {
      cancelled = true;
    };
  }, [api, importId, navigate]);

  const score = useMemo(() => (parsedContent ? computeScore(parsedContent) : 0), [parsedContent]);

  const scoreColor =
    score >= 80 ? "var(--color-teal-600)" : score >= 60 ? "var(--color-yellow-600)" : "var(--color-red-600)";
  const scoreBackground =
    score >= 80 ? "var(--color-teal-50)" : score >= 60 ? "var(--color-yellow-50)" : "var(--color-red-50)";

  const improvements = useMemo(() => {
    if (!parsedContent) {
      return [];
    }
    return buildImprovements(parsedContent);
  }, [parsedContent]);

  const parseNeedsManualReview = useMemo(() => {
    if (!parseSummary?.diagnostics) {
      return false;
    }

    const diagnostics = parseSummary.diagnostics;
    const lowConfidence = diagnostics.quality.low_confidence;
    const unsafeFallback = diagnostics.final_stage === "utf8_decode";
    const nonPrimaryPdfStage =
      diagnostics.mime_type.toLowerCase() === "application/pdf" &&
      diagnostics.final_stage !== "pdfjs_text";

    return lowConfidence || unsafeFallback || nonPrimaryPdfStage;
  }, [parseSummary]);

  const convertImportToMasterCv = async (contentToSave: CvContent) => {
    if (!importId) {
      return;
    }

    setConverting(true);
    setError(null);

    try {
      await api.patchImportResult(importId, contentToSave);
      const converted = await api.createMasterCvFromImport(importId, {});

      navigate(`/app/cv/${converted.master_cv.id}`, {
        state: {
          cvKind: "master",
          masterCvId: converted.master_cv.id,
          isUploaded: true
        }
      });
    } catch (err) {
      if (err instanceof Error) {
        setError(err.message);
      } else {
        setError("Failed to convert import to master CV.");
      }
      setConverting(false);
    }
  };

  const handleImproveWithAI = () => {
    if (!parsedContent || !importId) {
      return;
    }

    navigate("/app/ai-improving", {
      state: {
        importId,
        parsedContent,
        improvements
      }
    });
  };

  const handleContinueWithoutAI = () => {
    if (!parsedContent) {
      return;
    }
    void convertImportToMasterCv(parsedContent);
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center p-8" style={{ background: "var(--color-background-secondary)" }}>
        <p style={{ fontSize: "14px", color: "var(--color-text-secondary)" }}>Loading parsed CV...</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center p-8" style={{ background: "var(--color-background-secondary)" }}>
      <div className="max-w-2xl w-full">
        <div
          className="p-8 rounded-2xl border"
          style={{
            background: "var(--color-background-primary)",
            borderColor: "var(--color-border-tertiary)"
          }}
        >
          <div className="text-center mb-8">
            <h1 className="font-medium mb-2" style={{ fontSize: "24px", color: "var(--color-text-primary)" }}>
              Your CV Score
            </h1>
            <p style={{ fontSize: "14px", color: "var(--color-text-secondary)" }}>
              Based on {fileName || "uploaded file"}
            </p>
          </div>

          {error && (
            <div
              className="mb-6 p-4 rounded-xl border"
              style={{
                borderColor: "var(--color-red-200)",
                background: "var(--color-red-50)",
                color: "var(--color-red-700)",
                fontSize: "13px"
              }}
            >
              {error}
            </div>
          )}

          <div className="flex justify-center mb-8">
            <div className="relative">
              <svg className="transform -rotate-90" width="200" height="200">
                <circle cx="100" cy="100" r="90" fill="none" stroke="var(--color-border-secondary)" strokeWidth="12" />
                <circle
                  cx="100"
                  cy="100"
                  r="90"
                  fill="none"
                  stroke={scoreColor}
                  strokeWidth="12"
                  strokeDasharray={`${(score / 100) * 565.48} 565.48`}
                  strokeLinecap="round"
                />
              </svg>
              <div className="absolute inset-0 flex flex-col items-center justify-center">
                <div className="font-medium" style={{ fontSize: "48px", color: scoreColor }}>
                  {score}
                </div>
                <div style={{ fontSize: "16px", color: "var(--color-text-secondary)" }}>out of 100</div>
              </div>
            </div>
          </div>

          <div className="p-4 rounded-xl mb-6 flex items-start gap-3" style={{ background: scoreBackground }}>
            <TrendingUp size={20} style={{ color: scoreColor, flexShrink: 0, marginTop: "2px" }} />
            <div>
              <h3 className="font-medium mb-1" style={{ fontSize: "15px", color: "var(--color-text-primary)" }}>
                {score >= 80 ? "Great CV foundation" : score >= 60 ? "Good foundation" : "Needs improvement"}
              </h3>
              <p style={{ fontSize: "13px", lineHeight: "1.6", color: "var(--color-text-secondary)" }}>
                Parsed result review is complete. You can continue directly or apply AI-assisted improvements before converting to your master CV.
              </p>
            </div>
          </div>

          {parseNeedsManualReview ? (
            <div
              className="p-4 rounded-xl mb-6 border"
              style={{
                borderColor: "var(--color-yellow-200)",
                background: "var(--color-yellow-50)",
                color: "var(--color-yellow-900)"
              }}
            >
              <p className="font-medium" style={{ fontSize: "13px" }}>
                Parse quality needs manual review before conversion.
              </p>
              <p style={{ fontSize: "12px", marginTop: "6px", lineHeight: "1.5" }}>
                Final stage: {parseSummary?.diagnostics?.final_stage ?? "-"} | Confidence:{" "}
                {parseSummary?.diagnostics?.quality.confidence ?? "-"} (score {parseSummary?.diagnostics?.quality.score ?? "-"}).
              </p>
              {parseSummary?.warnings?.length ? (
                <p style={{ fontSize: "12px", marginTop: "6px", lineHeight: "1.5" }}>
                  {parseSummary.warnings[0]}
                </p>
              ) : null}
            </div>
          ) : null}

          <div className="mb-8">
            <h3 className="font-medium mb-3 flex items-center gap-2" style={{ fontSize: "15px", color: "var(--color-text-primary)" }}>
              <AlertCircle size={16} style={{ color: "var(--color-text-secondary)" }} />
              Suggested Improvements
            </h3>
            <div className="space-y-2">
              {improvements.map((improvement, index) => (
                <div
                  key={improvement}
                  className="flex items-start gap-3 px-4 py-3 rounded-lg"
                  style={{ background: "var(--color-background-secondary)" }}
                >
                  <div
                    className="w-5 h-5 rounded-full flex items-center justify-center flex-shrink-0"
                    style={{
                      background: "var(--color-teal-100)",
                      color: "var(--color-teal-700)",
                      fontSize: "11px",
                      fontWeight: 500,
                      marginTop: "1px"
                    }}
                  >
                    {index + 1}
                  </div>
                  <p style={{ fontSize: "13px", color: "var(--color-text-secondary)", lineHeight: "1.5" }}>
                    {improvement}
                  </p>
                </div>
              ))}
            </div>
          </div>

          <div className="space-y-3">
            <button
              onClick={handleImproveWithAI}
              disabled={converting || !parsedContent}
              className="w-full px-6 py-3 rounded-lg font-medium flex items-center justify-center gap-2 transition-all hover:shadow-md"
              style={{
                background: "var(--color-teal-600)",
                color: "white",
                fontSize: "14px",
                opacity: converting ? 0.7 : 1
              }}
            >
              <Sparkles size={16} />
              Improve with AI
              <ArrowRight size={16} />
            </button>

            <button
              onClick={handleContinueWithoutAI}
              disabled={converting || !parsedContent || parseNeedsManualReview}
              className="w-full px-6 py-3 rounded-lg font-medium transition-all hover:bg-gray-50 inline-flex items-center justify-center gap-2"
              style={{
                background: "transparent",
                border: "1px solid var(--color-border-tertiary)",
                color: "var(--color-text-secondary)",
                fontSize: "14px",
                opacity: converting || parseNeedsManualReview ? 0.7 : 1
              }}
            >
              {converting ? <Loader2 size={16} className="animate-spin" /> : null}
              Continue with parsed result
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
