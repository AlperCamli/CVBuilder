export type GuideSide = "top" | "bottom" | "left" | "right";
type TargetRect = Pick<DOMRect, "top" | "right" | "bottom" | "left" | "width" | "height">;
const EDGE = 12;
export const GUIDE_GAP = 28;

export function positionGuide(target: TargetRect, width: number, height: number, viewportWidth: number, viewportHeight: number, preferred: GuideSide) {
  const centerX = target.left + target.width / 2;
  const centerY = target.top + target.height / 2;
  const opposite: Record<GuideSide, GuideSide> = { top: "bottom", bottom: "top", left: "right", right: "left" };
  const sides = [...new Set<GuideSide>([preferred, opposite[preferred], "bottom", "top", "right", "left"])];
  const clamp = (value: number, max: number) => Math.max(EDGE, Math.min(value, Math.max(EDGE, max - EDGE)));
  const candidates = sides.map(side => {
    const left = side === "right" ? target.right + GUIDE_GAP : side === "left" ? target.left - GUIDE_GAP - width : centerX - width / 2;
    const top = side === "bottom" ? target.bottom + GUIDE_GAP : side === "top" ? target.top - GUIDE_GAP - height : centerY - height / 2;
    const boundedLeft = clamp(left, viewportWidth - width);
    const boundedTop = clamp(top, viewportHeight - height);
    const overlap = Math.max(0, Math.min(boundedLeft + width, target.right + 6) - Math.max(boundedLeft, target.left - 6))
      * Math.max(0, Math.min(boundedTop + height, target.bottom + 6) - Math.max(boundedTop, target.top - 6));
    return { left: boundedLeft, top: boundedTop, side, overlap };
  });
  return candidates.reduce((best, candidate) => candidate.overlap < best.overlap ? candidate : best);
}
