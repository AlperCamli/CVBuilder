import { ArrowRight, X } from "lucide-react";
import { useEffect, useState } from "react";

interface TutorialGuideProps {
  show: boolean;
  onClose: () => void;
  targetElement?: string; // CSS selector for the target element
  message: string;
  position?: "top" | "bottom" | "left" | "right";
}

export function TutorialGuide({
  show,
  onClose,
  targetElement,
  message,
  position = "right",
}: TutorialGuideProps) {
  const [coords, setCoords] = useState<{ top: number; left: number } | null>(null);

  useEffect(() => {
    if (show && targetElement) {
      const updatePosition = () => {
        const element = document.querySelector(targetElement);
        if (element) {
          const rect = element.getBoundingClientRect();
          let top = 0;
          let left = 0;

          switch (position) {
            case "right":
              top = rect.top + rect.height / 2;
              left = rect.right + 20;
              break;
            case "left":
              top = rect.top + rect.height / 2;
              left = rect.left - 20;
              break;
            case "top":
              top = rect.top - 20;
              left = rect.left + rect.width / 2;
              break;
            case "bottom":
              top = rect.bottom + 20;
              left = rect.left + rect.width / 2;
              break;
          }

          setCoords({ top, left });
        }
      };

      updatePosition();
      window.addEventListener("resize", updatePosition);
      return () => window.removeEventListener("resize", updatePosition);
    }
  }, [show, targetElement, position]);

  if (!show || !coords) return null;

  return (
    <>
      {/* Overlay */}
      <div
        className="fixed inset-0 z-50"
        style={{
          background: "rgba(0, 0, 0, 0.5)",
          backdropFilter: "blur(2px)",
        }}
        onClick={onClose}
      />

      {/* Arrow and Message */}
      <div
        className="fixed z-50"
        style={{
          top: `${coords.top}px`,
          left: `${coords.left}px`,
          transform: position === "right" || position === "left"
            ? "translateY(-50%)"
            : "translateX(-50%)",
        }}
      >
        <div className="flex items-center gap-3">
          {position === "right" && (
            <div className="animate-bounce-horizontal">
              <ArrowRight size={32} style={{ color: "var(--color-teal-400)" }} />
            </div>
          )}

          <div
            className="p-4 rounded-lg shadow-lg max-w-xs relative animate-pulse-slow"
            style={{
              background: "var(--color-teal-600)",
              color: "white",
            }}
          >
            <button
              onClick={onClose}
              className="absolute top-2 right-2 p-1 rounded hover:bg-white/20 transition-colors"
            >
              <X size={16} />
            </button>
            <p style={{ fontSize: "14px", lineHeight: "1.6", paddingRight: "20px" }}>
              {message}
            </p>
          </div>
        </div>
      </div>

      {/* Spotlight effect on target */}
      <style>{`
        @keyframes bounce-horizontal {
          0%, 100% {
            transform: translateX(0);
          }
          50% {
            transform: translateX(-10px);
          }
        }
        .animate-bounce-horizontal {
          animation: bounce-horizontal 1s ease-in-out infinite;
        }
      `}</style>
    </>
  );
}
