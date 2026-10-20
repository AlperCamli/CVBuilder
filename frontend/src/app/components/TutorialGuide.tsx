import { translate as t } from "../localization/i18n";
import { useTranslation } from "react-i18next";
import { ArrowDown, ArrowLeft, ArrowRight, ArrowUp, X } from "lucide-react";
import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { GUIDE_GAP, positionGuide, type GuideSide } from "../onboarding/tutorial-position";

interface TutorialGuideProps {
  show: boolean;
  onClose: () => void;
  targetElement?: string;
  message: string;
  position?: GuideSide;
}

const ARROW_SIZE = 18;

export function TutorialGuide({ show, onClose, targetElement, message, position = "right" }: TutorialGuideProps) {
  useTranslation();
  const [targetRect, setTargetRect] = useState<DOMRect | null>(null);
  const [cardPos, setCardPos] = useState<ReturnType<typeof positionGuide> | null>(null);
  const cardRef = useRef<HTMLDivElement>(null);
  const messageId = useId();

  useEffect(() => {
    if (!show || !targetElement) {
      setTargetRect(null);
      setCardPos(null);
      return;
    }
    const element = document.querySelector(targetElement);
    if (!element) return;
    const update = () => setTargetRect(element.getBoundingClientRect());
    const escape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        onClose();
      }
    };
    update();
    const observer = new ResizeObserver(update);
    observer.observe(element);
    window.addEventListener("resize", update);
    window.addEventListener("scroll", update, true);
    window.addEventListener("keydown", escape, true);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", update);
      window.removeEventListener("scroll", update, true);
      window.removeEventListener("keydown", escape, true);
    };
  }, [show, targetElement, onClose]);

  useLayoutEffect(() => {
    if (!show || !targetRect || !cardRef.current) return;
    setCardPos(positionGuide(targetRect, cardRef.current.offsetWidth, cardRef.current.offsetHeight, innerWidth, innerHeight, position));
  }, [show, targetRect, position, message]);

  if (!show || !targetRect) return null;
  const side = cardPos?.side ?? position;
  const centerX = targetRect.left + targetRect.width / 2;
  const centerY = targetRect.top + targetRect.height / 2;
  const arrowOffset = (GUIDE_GAP - ARROW_SIZE) / 2;
  const arrow = side === "right"
    ? { Icon: ArrowLeft, top: centerY - ARROW_SIZE / 2, left: targetRect.right + arrowOffset }
    : side === "left"
      ? { Icon: ArrowRight, top: centerY - ARROW_SIZE / 2, left: targetRect.left - GUIDE_GAP + arrowOffset }
      : side === "bottom"
        ? { Icon: ArrowUp, top: targetRect.bottom + arrowOffset, left: centerX - ARROW_SIZE / 2 }
        : { Icon: ArrowDown, top: targetRect.top - GUIDE_GAP + arrowOffset, left: centerX - ARROW_SIZE / 2 };
  const ArrowIcon = arrow.Icon;
  const holeTop = Math.max(0, Math.min(innerHeight, targetRect.top - 6));
  const holeBottom = Math.max(holeTop, Math.min(innerHeight, targetRect.bottom + 6));
  const holeLeft = Math.max(0, Math.min(innerWidth, targetRect.left - 6));
  const holeRight = Math.max(holeLeft, Math.min(innerWidth, targetRect.right + 6));

  return <>
    {/* Four click-away regions leave the highlighted button interactive. */}
    <div className="fixed inset-0 z-50 pointer-events-none tutorial-backdrop" aria-hidden="true">
      <div className="absolute pointer-events-auto" style={{ top: 0, left: 0, right: 0, height: holeTop }} onClick={onClose} />
      <div className="absolute pointer-events-auto" style={{ top: holeBottom, left: 0, right: 0, bottom: 0 }} onClick={onClose} />
      <div className="absolute pointer-events-auto" style={{ top: holeTop, left: 0, width: holeLeft, height: holeBottom - holeTop }} onClick={onClose} />
      <div className="absolute pointer-events-auto" style={{ top: holeTop, left: holeRight, right: 0, height: holeBottom - holeTop }} onClick={onClose} />
    </div>
    <div className="fixed z-50 pointer-events-none tutorial-spotlight" style={{
      top: targetRect.top - 6, left: targetRect.left - 6, width: targetRect.width + 12, height: targetRect.height + 12,
      borderRadius: 12, border: "2px solid var(--color-teal-400)",
      boxShadow: "0 0 0 4000px rgba(15,23,42,0.36), 0 0 16px rgba(20,184,166,0.25)",
    }} />
    <div className="fixed z-50 pointer-events-none" style={{ top: arrow.top, left: arrow.left, color: "var(--color-teal-600)", visibility: cardPos ? "visible" : "hidden" }}>
      <ArrowIcon size={ARROW_SIZE} />
    </div>
    <div ref={cardRef} role="dialog" aria-label={t("CV editor guide")} aria-describedby={messageId} data-onboarding-guide={targetElement}
      className="fixed z-50 rounded-xl p-4" style={{
        top: cardPos?.top ?? -9999, left: cardPos?.left ?? -9999, width: "min(320px, calc(100vw - 24px))",
        maxHeight: "calc(100dvh - 24px)", overflowY: "auto", visibility: cardPos ? "visible" : "hidden",
        background: "var(--color-background-primary)", border: "1px solid var(--color-border-secondary)",
        boxShadow: "0 20px 40px -12px rgba(0,0,0,0.25)",
      }}>
      <button type="button" onClick={onClose} aria-label={t("Dismiss guide")} className="absolute top-1 right-1 flex items-center justify-center rounded-lg hover:bg-gray-100"
        style={{ width: 44, height: 44, color: "var(--color-text-secondary)" }}>
        <X size={18} />
      </button>
      <p id={messageId} style={{ fontSize: 13, lineHeight: 1.6, color: "var(--color-text-primary)", paddingRight: 32 }}>{message}</p>
    </div>
  </>;
}
