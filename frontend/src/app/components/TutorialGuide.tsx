import { ArrowDown, ArrowLeft, ArrowRight, ArrowUp, X } from "lucide-react";
import { useEffect, useLayoutEffect, useRef, useState } from "react";

interface TutorialGuideProps {
  show: boolean;
  onClose: () => void;
  targetElement?: string; // CSS selector for the target element
  message: string;
  position?: "top" | "bottom" | "left" | "right";
}

// Space reserved between the target edge and the card; the arrow lives here.
const ARROW_ZONE = 44;
const ARROW_SIZE = 22;
const EDGE_MARGIN = 12;

const clamp = (value: number, min: number, max: number): number =>
  Math.max(min, Math.min(value, Math.max(min, max)));

export function TutorialGuide({
  show,
  onClose,
  targetElement,
  message,
  position = "right",
}: TutorialGuideProps) {
  const [targetRect, setTargetRect] = useState<DOMRect | null>(null);
  const [cardPos, setCardPos] = useState<{ top: number; left: number } | null>(null);
  const [visible, setVisible] = useState(false);
  const cardRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!show || !targetElement) {
      setVisible(false);
      setTargetRect(null);
      setCardPos(null);
      return;
    }

    const updateTarget = () => {
      const element = document.querySelector(targetElement);
      setTargetRect(element ? element.getBoundingClientRect() : null);
    };

    updateTarget();
    window.addEventListener("resize", updateTarget);
    window.addEventListener("scroll", updateTarget, true);
    return () => {
      window.removeEventListener("resize", updateTarget);
      window.removeEventListener("scroll", updateTarget, true);
      setVisible(false);
    };
  }, [show, targetElement]);

  // The card is rendered invisibly first, then measured, so it can be placed
  // fully outside the target and clamped to the viewport. The arrow is
  // positioned separately, aligned to the target's center, so viewport
  // clamping of the card never drags the arrow off the button.
  useLayoutEffect(() => {
    if (!targetRect || !cardRef.current) {
      return;
    }

    const cardWidth = cardRef.current.offsetWidth;
    const cardHeight = cardRef.current.offsetHeight;
    const viewportWidth = window.innerWidth;
    const viewportHeight = window.innerHeight;
    const targetCenterX = targetRect.left + targetRect.width / 2;
    const targetCenterY = targetRect.top + targetRect.height / 2;

    let top = 0;
    let left = 0;

    switch (position) {
      case "right":
        left = targetRect.right + ARROW_ZONE;
        top = targetCenterY - cardHeight / 2;
        break;
      case "left":
        left = targetRect.left - ARROW_ZONE - cardWidth;
        top = targetCenterY - cardHeight / 2;
        break;
      case "bottom":
        top = targetRect.bottom + ARROW_ZONE;
        left = targetCenterX - cardWidth / 2;
        break;
      case "top":
        top = targetRect.top - ARROW_ZONE - cardHeight;
        left = targetCenterX - cardWidth / 2;
        break;
    }

    setCardPos({
      top: clamp(top, EDGE_MARGIN, viewportHeight - cardHeight - EDGE_MARGIN),
      left: clamp(left, EDGE_MARGIN, viewportWidth - cardWidth - EDGE_MARGIN)
    });
    requestAnimationFrame(() => setVisible(true));
  }, [targetRect, position, message]);

  const handleClose = () => {
    setVisible(false);
    setTimeout(onClose, 150);
  };

  if (!show || !targetRect) return null;

  const targetCenterX = targetRect.left + targetRect.width / 2;
  const targetCenterY = targetRect.top + targetRect.height / 2;
  const arrowGapOffset = (ARROW_ZONE - ARROW_SIZE) / 2;

  // Arrow points AT the target from the space between target and card.
  const arrow =
    position === "right"
      ? {
          Icon: ArrowLeft,
          top: targetCenterY - ARROW_SIZE / 2,
          left: targetRect.right + arrowGapOffset,
          bounceClass: "tutorial-arrow-bounce-left"
        }
      : position === "left"
        ? {
            Icon: ArrowRight,
            top: targetCenterY - ARROW_SIZE / 2,
            left: targetRect.left - ARROW_ZONE + arrowGapOffset,
            bounceClass: "tutorial-arrow-bounce-right"
          }
        : position === "bottom"
          ? {
              Icon: ArrowUp,
              top: targetRect.bottom + arrowGapOffset,
              left: targetCenterX - ARROW_SIZE / 2,
              bounceClass: "tutorial-arrow-bounce-up"
            }
          : {
              Icon: ArrowDown,
              top: targetRect.top - ARROW_ZONE + arrowGapOffset,
              left: targetCenterX - ARROW_SIZE / 2,
              bounceClass: "tutorial-arrow-bounce-down"
            };

  const ArrowIcon = arrow.Icon;

  return (
    <>
      {/* Click-away backdrop; dimming comes from the spotlight shadow. */}
      <div className="fixed inset-0 z-50 tutorial-backdrop" onClick={handleClose} />

      {/* Spotlight ring around target */}
      <div
        className="fixed z-50 pointer-events-none tutorial-spotlight"
        style={{
          top: targetRect.top - 6,
          left: targetRect.left - 6,
          width: targetRect.width + 12,
          height: targetRect.height + 12,
          borderRadius: "12px",
          border: "2px solid var(--color-teal-400)",
          opacity: visible ? 1 : 0,
          transition: "opacity 0.3s ease"
        }}
      />

      {/* Arrow, aligned to the target's center */}
      <div
        className={`fixed z-50 pointer-events-none ${arrow.bounceClass}`}
        style={{
          top: arrow.top,
          left: arrow.left,
          opacity: visible ? 1 : 0,
          transition: "opacity 0.25s ease"
        }}
      >
        <ArrowIcon size={ARROW_SIZE} style={{ color: "var(--color-teal-600)" }} />
      </div>

      {/* Card */}
      <div
        ref={cardRef}
        className="fixed z-50 p-4 rounded-xl max-w-xs"
        style={{
          top: cardPos?.top ?? -9999,
          left: cardPos?.left ?? -9999,
          background: "var(--color-background-primary)",
          border: "1px solid var(--color-border-secondary)",
          boxShadow: "0 20px 40px -12px rgba(0, 0, 0, 0.25)",
          opacity: visible ? 1 : 0,
          transform: `scale(${visible ? 1 : 0.95})`,
          transition: "opacity 0.25s ease, transform 0.25s cubic-bezier(0.34, 1.56, 0.64, 1)"
        }}
      >
        <button
          onClick={handleClose}
          aria-label="Dismiss guide"
          className="absolute top-2.5 right-2.5 p-1.5 rounded-lg transition-colors"
          style={{ color: "var(--color-text-secondary)" }}
          onMouseEnter={(event) => {
            event.currentTarget.style.background = "var(--color-background-secondary)";
          }}
          onMouseLeave={(event) => {
            event.currentTarget.style.background = "transparent";
          }}
        >
          <X size={14} />
        </button>
        <p
          style={{
            fontSize: "13px",
            lineHeight: "1.6",
            color: "var(--color-text-primary)",
            paddingRight: "24px"
          }}
        >
          {message}
        </p>
      </div>

      <style>{`
        @keyframes tutorialArrowBounceLeft {
          0%, 100% { transform: translateX(0); }
          50% { transform: translateX(-6px); }
        }
        @keyframes tutorialArrowBounceRight {
          0%, 100% { transform: translateX(0); }
          50% { transform: translateX(6px); }
        }
        @keyframes tutorialArrowBounceUp {
          0%, 100% { transform: translateY(0); }
          50% { transform: translateY(-6px); }
        }
        @keyframes tutorialArrowBounceDown {
          0%, 100% { transform: translateY(0); }
          50% { transform: translateY(6px); }
        }
        .tutorial-arrow-bounce-left { animation: tutorialArrowBounceLeft 1.2s ease-in-out infinite; }
        .tutorial-arrow-bounce-right { animation: tutorialArrowBounceRight 1.2s ease-in-out infinite; }
        .tutorial-arrow-bounce-up { animation: tutorialArrowBounceUp 1.2s ease-in-out infinite; }
        .tutorial-arrow-bounce-down { animation: tutorialArrowBounceDown 1.2s ease-in-out infinite; }
        @keyframes spotlightPulse {
          0%, 100% {
            box-shadow: 0 0 0 4000px rgba(15, 23, 42, 0.4), 0 0 16px rgba(20, 184, 166, 0.25);
          }
          50% {
            box-shadow: 0 0 0 4000px rgba(15, 23, 42, 0.4), 0 0 26px rgba(20, 184, 166, 0.45);
          }
        }
        .tutorial-spotlight {
          animation: spotlightPulse 2s ease-in-out infinite;
        }
      `}</style>
    </>
  );
}
