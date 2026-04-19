import { useEffect, useMemo, useState } from "react";
import { useNavigate, useLocation } from "react-router";
import { FileText, CheckCircle, Loader2 } from "lucide-react";
import { useAuth } from "../integration/auth-context";
import { integrationConfig } from "../integration/config";
import { supabase } from "../integration/supabase-client";

interface UploadStep {
  label: string;
  progress: number;
}

const steps: UploadStep[] = [
  { label: "Uploading file", progress: 25 },
  { label: "Creating import session", progress: 45 },
  { label: "Parsing content", progress: 75 },
  { label: "Finalizing import", progress: 100 }
];

export function UploadProcessing() {
  const navigate = useNavigate();
  const location = useLocation();
  const file = location.state?.file as File | undefined;
  const { api, me } = useAuth();
  const [progress, setProgress] = useState(0);
  const [currentStep, setCurrentStep] = useState(0);
  const [error, setError] = useState<string | null>(null);

  const fileName = useMemo(() => file?.name ?? "Unknown file", [file]);

  useEffect(() => {
    if (!file) {
      navigate("/app/create", { replace: true });
      return;
    }

    let cancelled = false;

    const run = async () => {
      setError(null);

      try {
        setCurrentStep(0);
        setProgress(steps[0].progress);

        const storageBucket = integrationConfig.importsStorageBucket;
        const userId = me?.user.id ?? "anonymous";
        const storagePath = `users/${userId}/imports/${Date.now()}-${file.name}`;

        const { error: uploadError } = await supabase.storage
          .from(storageBucket)
          .upload(storagePath, file, {
            contentType: file.type || "application/octet-stream",
            upsert: false
          });

        if (uploadError) {
          throw new Error(uploadError.message);
        }

        if (cancelled) {
          return;
        }

        setCurrentStep(1);
        setProgress(steps[1].progress);

        const importSession = await api.createImportSession({
          original_filename: file.name,
          mime_type: file.type || "application/octet-stream",
          size_bytes: file.size,
          storage_bucket: storageBucket,
          storage_path: storagePath,
          checksum: null
        });

        await api.markImportUploadComplete(importSession.import.id);

        if (cancelled) {
          return;
        }

        setCurrentStep(2);
        setProgress(steps[2].progress);

        const parseResponse = await api.parseImport(importSession.import.id);

        if (cancelled) {
          return;
        }

        setCurrentStep(3);
        setProgress(steps[3].progress);

        setTimeout(() => {
          if (cancelled) {
            return;
          }
          navigate("/app/cv-score", {
            state: {
              importId: importSession.import.id,
              fileName: file.name,
              parseSummary: parseResponse.parse_summary
            }
          });
        }, 250);
      } catch (err) {
        if (cancelled) {
          return;
        }

        if (err instanceof Error) {
          setError(err.message);
        } else {
          setError("Upload failed.");
        }
      }
    };

    void run();

    return () => {
      cancelled = true;
    };
  }, [api, file, navigate, me?.user.id]);

  return (
    <div className="min-h-screen flex items-center justify-center p-8" style={{ background: "var(--color-background-secondary)" }}>
      <div className="max-w-md w-full">
        <div
          className="p-8 rounded-2xl border text-center"
          style={{
            background: "var(--color-background-primary)",
            borderColor: "var(--color-border-tertiary)"
          }}
        >
          <div className="flex justify-center mb-6">
            <div className="w-16 h-16 rounded-2xl flex items-center justify-center" style={{ background: "var(--color-teal-50)" }}>
              <FileText size={32} style={{ color: "var(--color-teal-600)" }} />
            </div>
          </div>

          <h2 className="font-medium mb-2" style={{ fontSize: "20px", color: "var(--color-text-primary)" }}>
            Processing your CV
          </h2>
          <p className="mb-8" style={{ fontSize: "14px", color: "var(--color-text-secondary)" }}>
            {fileName}
          </p>

          {error && (
            <div
              className="mb-5 p-3 rounded-lg border text-left"
              style={{
                borderColor: "var(--color-red-200)",
                background: "var(--color-red-50)",
                color: "var(--color-red-700)",
                fontSize: "13px"
              }}
            >
              {error}
              <button
                type="button"
                className="ml-3 underline"
                style={{ color: "var(--color-red-700)" }}
                onClick={() => navigate("/app/create")}
              >
                Back
              </button>
            </div>
          )}

          <div className="mb-6">
            <div className="h-2 rounded-full overflow-hidden" style={{ background: "var(--color-border-secondary)" }}>
              <div
                className="h-full transition-all duration-300 rounded-full"
                style={{
                  width: `${progress}%`,
                  background: "var(--color-teal-600)"
                }}
              />
            </div>
            <p className="mt-2" style={{ fontSize: "13px", color: "var(--color-text-secondary)" }}>
              {Math.round(progress)}% complete
            </p>
          </div>

          <div className="space-y-3">
            {steps.map((step, index) => (
              <div
                key={step.label}
                className="flex items-center gap-3 px-4 py-2 rounded-lg transition-all"
                style={{ background: index === currentStep ? "var(--color-teal-50)" : "transparent" }}
              >
                {index < currentStep ? (
                  <CheckCircle size={16} style={{ color: "var(--color-teal-600)" }} />
                ) : index === currentStep && !error ? (
                  <Loader2 size={16} className="animate-spin" style={{ color: "var(--color-teal-600)" }} />
                ) : (
                  <div className="w-4 h-4 rounded-full" style={{ background: "var(--color-border-secondary)" }} />
                )}
                <span
                  style={{
                    fontSize: "13px",
                    color: index <= currentStep ? "var(--color-text-primary)" : "var(--color-text-secondary)",
                    fontWeight: index === currentStep ? 500 : 400
                  }}
                >
                  {step.label}
                </span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
