import { GripVertical, Eye, EyeOff, Trash2, ChevronDown, ChevronUp } from "lucide-react";
import { useRef, ReactNode } from "react";
import { useDrag, useDrop } from "react-dnd";

interface CollapsibleItemProps {
  item: any;
  index: number;
  dragType: string;
  onRemove: (index: number) => void;
  onToggleVisibility: (index: number) => void;
  onToggleCollapsed: (index: number) => void;
  onMove: (dragIndex: number, hoverIndex: number) => void;
  renderSummary: () => ReactNode;
  renderContent: () => ReactNode;
}

export function CollapsibleItem({
  item,
  index,
  dragType,
  onRemove,
  onToggleVisibility,
  onToggleCollapsed,
  onMove,
  renderSummary,
  renderContent,
}: CollapsibleItemProps) {
  const ref = useRef<HTMLDivElement>(null);

  const [{ isDragging }, drag] = useDrag({
    type: dragType,
    item: { index },
    collect: (monitor) => ({
      isDragging: monitor.isDragging(),
    }),
  });

  const [, drop] = useDrop({
    accept: dragType,
    hover: (draggedItem: { index: number }) => {
      if (draggedItem.index !== index) {
        onMove(draggedItem.index, index);
        draggedItem.index = index;
      }
    },
  });

  drag(drop(ref));

  const isCollapsed = item.collapsed;

  return (
    <div
      ref={ref}
      className="p-3 rounded-lg border space-y-2"
      style={{
        borderColor: "var(--color-border-tertiary)",
        opacity: item.hidden ? 0.5 : isDragging ? 0.5 : 1,
        cursor: isDragging ? "grabbing" : "default",
      }}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-2 flex-1 min-w-0">
          <div style={{ cursor: "grab", color: "var(--color-text-secondary)" }}>
            <GripVertical size={14} />
          </div>
          <button
            onClick={() => onToggleCollapsed(index)}
            className="hover:bg-gray-100 rounded p-1"
            style={{ color: "var(--color-text-secondary)" }}
          >
            {isCollapsed ? <ChevronDown size={14} /> : <ChevronUp size={14} />}
          </button>
          {isCollapsed && (
            <div className="flex-1 min-w-0" style={{ fontSize: "13px", color: "var(--color-text-primary)" }}>
              {renderSummary()}
            </div>
          )}
        </div>
        <div className="flex items-center gap-1">
          <button onClick={() => onToggleVisibility(index)} style={{ color: "var(--color-text-secondary)" }}>
            {item.hidden ? <EyeOff size={14} /> : <Eye size={14} />}
          </button>
          <button onClick={() => onRemove(index)} style={{ color: "var(--color-text-secondary)" }}>
            <Trash2 size={14} />
          </button>
        </div>
      </div>

      {!isCollapsed && !item.hidden && (
        <div className="space-y-2 pl-8">
          {renderContent()}
        </div>
      )}
    </div>
  );
}
