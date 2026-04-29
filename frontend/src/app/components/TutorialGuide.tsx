import { ArrowRight, ArrowLeft, ArrowUp, ArrowDown, X } from "lucide-react";
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
  const [targetRect, setTargetRect] = useState<DOMRect | null>(null);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (show && targetElement) {
      const updatePosition = () => {
        const element = document.querySelector(targetElement);
        if (element) {
          const rect = element.getBoundingClientRect();
          setTargetRect(rect);
          let top = 0;
          let left = 0;

          switch (position) {
            case "right":
              top = rect.top + rect.height / 2;
              left = rect.right + 16;
              break;
            case "left":
              top = rect.top + rect.height / 2;
              left = rect.left - 16;
              break;
            case "top":
              top = rect.top - 16;
              left = rect.left + rect.width / 2;
              break;
            case "bottom":
              top = rect.bottom + 16;
              left = rect.left + rect.width / 2;
              break;
          }

          setCoords({ top, left });
        }
      };

      updatePosition();
      // Trigger entrance animation
      requestAnimationFrame(() => setVisible(true));

      window.addEventListener("resize", updatePosition);
      window.addEventListener("scroll", updatePosition, true);
      return () => {
        window.removeEventListener("resize", updatePosition);
        window.removeEventListener("scroll", updatePosition, true);
        setVisible(false);
      };
    }

    setVisible(false);
  }, [show, targetElement, position]);

  const handleClose = () => {
    setVisible(false);
    setTimeout(onClose, 200);
  };

  if (!show || !coords) return null;

  const ArrowIcon =
    position === "right" ? ArrowRight :
    position === "left" ? ArrowLeft :
    position === "top" ? ArrowUp :
    ArrowDown;

  const transformOrigin =
    position === "right" ? "left center" :
    position === "left" ? "right center" :
    position === "top" ? "bottom center" :
    "top center";

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 z-50 tutorial-backdrop"
        style={{
          background: "rgba(0, 0, 0, 0.4)",
          backdropFilter: "blur(1px)",
          opacity: visible ? 1 : 0,
          transition: "opacity 0.2s ease"
        }}
        onClick={handleClose}
      />

      {/* Spotlight ring around target */}
      {targetRect && (
        <div
          className="fixed z-50 pointer-events-none tutorial-spotlight"
          style={{
            top: targetRect.top - 6,
            left: targetRect.left - 6,
            width: targetRect.width + 12,
            height: targetRect.height + 12,
            borderRadius: "12px",
            border: "2px solid rgba(20, 184, 166, 0.6)",
            boxShadow: "0 0 0 4000px rgba(0, 0, 0, 0.35), 0 0 20px rgba(20, 184, 166, 0.3)",
            opacity: visible ? 1 : 0,
            transition: "opacity 0.3s ease"
          }}
        />
      )}

      {/* Tooltip */}
      <div
        className="fixed z-50 tutorial-tooltip"
        style={{
          top: `${coords.top}px`,
          left: `${coords.left}px`,
          transform:
            position === "right" || position === "left"
              ? `translateY(-50%) scale(${visible ? 1 : 0.9})`
              : `translateX(-50%) scale(${visible ? 1 : 0.9})`,
          transformOrigin,
          opacity: visible ? 1 : 0,
          transition: "opacity 0.25s ease, transform 0.25s cubic-bezier(0.34, 1.56, 0.64, 1)"
        }}
      >
        <div className="flex items-center gap-3">
          {position === "right" && (
            <div className="tutorial-arrow-bounce">
              <ArrowIcon size={24} style={{ color: "#2dd4bf" }} />
            </div>
          )}

          {position === "left" && (
            <div
              className="p-5 rounded-xl shadow-xl max-w-xs relative"
              style={{
                background: "linear-gradient(135deg, #0f766e 0%, #0d9488 100%)",
                color: "white",
                border: "1px solid rgba(255, 255, 255, 0.15)",
                boxShadow: "0 20px 40px -8px rgba(0, 0, 0, 0.3), 0 0 30px rgba(20, 184, 166, 0.2)"
              }}
            >
              <button
                onClick={handleClose}
                className="absolute top-2.5 right-2.5 p-1.5 rounded-lg hover:bg-white/15 transition-colors"
              >
                <X size={14} />
              </button>
              <p style={{ fontSize: "14px", lineHeight: "1.7", paddingRight: "24px" }}>
                {message}
              </p>
            </div>
          )}

          {(position === "right" || position === "top" || position === "bottom") && (
            <>
              {position !== "right" && (
                <div className="tutorial-arrow-bounce">
                  <ArrowIcon size={24} style={{ color: "#2dd4bf" }} />
                </div>
              )}
              <div
                className="p-5 rounded-xl shadow-xl max-w-xs relative"
                style={{
                  background: "linear-gradient(135deg, #0f766e 0%, #0d9488 100%)",
                  color: "white",
                  border: "1px solid rgba(255, 255, 255, 0.15)",
                  boxShadow: "0 20px 40px -8px rgba(0, 0, 0, 0.3), 0 0 30px rgba(20, 184, 166, 0.2)"
                }}
              >
                <button
                  onClick={handleClose}
                  className="absolute top-2.5 right-2.5 p-1.5 rounded-lg hover:bg-white/15 transition-colors"
                >
                  <X size={14} />
                </button>
                <p style={{ fontSize: "14px", lineHeight: "1.7", paddingRight: "24px" }}>
                  {message}
                </p>
              </div>
            </>
          )}

          {position === "left" && (
            <div className="tutorial-arrow-bounce">
              <ArrowIcon size={24} style={{ color: "#2dd4bf" }} />
            </div>
          )}
        </div>
      </div>

      <style>{`
        @keyframes tutorialArrowBounce {
          0%, 100% {
            transform: translateX(0);
          }
          50% {
            transform: translateX(-8px);
          }
        }
        .tutorial-arrow-bounce {
          animation: tutorialArrowBounce 1.2s ease-in-out infinite;
        }
        @keyframes spotlightPulse {
          0%, 100% {
            box-shadow: 0 0 0 4000px rgba(0, 0, 0, 0.35), 0 0 20px rgba(20, 184, 166, 0.3);
          }
          50% {
            box-shadow: 0 0 0 4000px rgba(0, 0, 0, 0.35), 0 0 30px rgba(20, 184, 166, 0.5);
          }
        }
        .tutorial-spotlight {
          animation: spotlightPulse 2s ease-in-out infinite;
        }
      `}</style>
    </>
  );
}
