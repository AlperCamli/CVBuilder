import { GripVertical, Eye, EyeOff, Trash2, Plus, ChevronUp, ChevronDown } from "lucide-react";
import { CollapsibleItem } from "./CollapsibleItem";
import { DateInputHelper } from "./DateInputHelper";
import { useRef } from "react";
import { useDrag, useDrop } from "react-dnd";

// Certificates section with specialized fields
interface CertificatesSectionProps {
  data: any;
  isHidden: boolean;
  onToggleVisibility: () => void;
  onRemove: () => void;
  onChange: (data: any) => void;
}

interface CertificateItemProps {
  item: any;
  index: number;
  updateItem: (index: number, item: any) => void;
  removeItem: (index: number) => void;
  toggleItemVisibility: (index: number) => void;
  toggleItemCollapsed: (index: number) => void;
  moveItem: (dragIndex: number, hoverIndex: number) => void;
}

function CertificateItem({ item, index, updateItem, removeItem, toggleItemVisibility, toggleItemCollapsed, moveItem }: CertificateItemProps) {
  const ref = useRef<HTMLDivElement>(null);

  const [{ isDragging }, drag] = useDrag({
    type: "CERTIFICATE_ITEM",
    item: { index },
    collect: (monitor) => ({
      isDragging: monitor.isDragging(),
    }),
  });

  const [, drop] = useDrop({
    accept: "CERTIFICATE_ITEM",
    hover: (draggedItem: { index: number }) => {
      if (draggedItem.index !== index) {
        moveItem(draggedItem.index, index);
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
            onClick={() => toggleItemCollapsed(index)}
            className="hover:bg-gray-100 rounded p-1"
            style={{ color: "var(--color-text-secondary)" }}
          >
            {isCollapsed ? <ChevronDown size={14} /> : <ChevronUp size={14} />}
          </button>
          {isCollapsed && (
            <div className="flex-1 min-w-0" style={{ fontSize: "13px", color: "var(--color-text-primary)" }}>
              <div className="truncate font-medium">
                {item.name || "Untitled Certificate"}
              </div>
              {item.verificationId && (
                <div className="text-xs truncate" style={{ color: "var(--color-text-secondary)" }}>
                  {item.verificationId}
                </div>
              )}
            </div>
          )}
        </div>
        <div className="flex items-center gap-1">
          <button onClick={() => toggleItemVisibility(index)} style={{ color: "var(--color-text-secondary)" }}>
            {item.hidden ? <EyeOff size={14} /> : <Eye size={14} />}
          </button>
          <button onClick={() => removeItem(index)} style={{ color: "var(--color-text-secondary)" }}>
            <Trash2 size={14} />
          </button>
        </div>
      </div>

      {!isCollapsed && !item.hidden && (
        <div className="space-y-2 pl-8">
          <input
            type="text"
            placeholder="Certificate Name"
            value={item.name}
            onChange={(e) => updateItem(index, { ...item, name: e.target.value })}
            className="w-full px-2 py-1.5 rounded border"
            style={{
              fontSize: "13px",
              borderColor: "var(--color-border-secondary)",
            }}
          />
          <input
            type="url"
            placeholder="URL (optional)"
            value={item.url || ""}
            onChange={(e) => updateItem(index, { ...item, url: e.target.value })}
            className="w-full px-2 py-1.5 rounded border"
            style={{
              fontSize: "13px",
              borderColor: "var(--color-border-secondary)",
            }}
          />
          <input
            type="text"
            placeholder="Verification ID / Additional Info (optional)"
            value={item.verificationId || ""}
            onChange={(e) => updateItem(index, { ...item, verificationId: e.target.value })}
            className="w-full px-2 py-1.5 rounded border"
            style={{
              fontSize: "13px",
              borderColor: "var(--color-border-secondary)",
            }}
          />
        </div>
      )}
    </div>
  );
}

export function CertificatesSection({ data, isHidden, onToggleVisibility, onRemove, onChange }: CertificatesSectionProps) {
  const items = data.items || [];

  const addItem = () => {
    onChange({
      ...data,
      items: [...items, { id: Date.now(), name: "", url: "", verificationId: "", hidden: false, collapsed: false }],
    });
  };

  const updateItem = (index: number, updatedItem: any) => {
    const newItems = [...items];
    newItems[index] = updatedItem;
    onChange({ ...data, items: newItems });
  };

  const removeItem = (index: number) => {
    onChange({ ...data, items: items.filter((_: any, i: number) => i !== index) });
  };

  const toggleItemVisibility = (index: number) => {
    const newItems = [...items];
    newItems[index] = { ...newItems[index], hidden: !newItems[index].hidden };
    onChange({ ...data, items: newItems });
  };

  const toggleItemCollapsed = (index: number) => {
    const newItems = [...items];
    newItems[index] = { ...newItems[index], collapsed: !newItems[index].collapsed };
    onChange({ ...data, items: newItems });
  };

  const moveItem = (dragIndex: number, hoverIndex: number) => {
    const newItems = [...items];
    const draggedItem = newItems[dragIndex];
    newItems.splice(dragIndex, 1);
    newItems.splice(hoverIndex, 0, draggedItem);
    onChange({ ...data, items: newItems });
  };

  return (
    <div
      className="p-4 rounded-xl border"
      style={{
        background: "var(--color-background-primary)",
        borderColor: "var(--color-border-tertiary)",
        opacity: isHidden ? 0.5 : 1,
      }}
    >
      <div className="flex items-start justify-between mb-4">
        <h3 className="font-medium flex items-center gap-2" style={{ fontSize: "15px", color: "var(--color-text-primary)" }}>
          <GripVertical size={14} style={{ color: "var(--color-text-secondary)", cursor: "grab" }} />
          Certifications
        </h3>
        <div className="flex items-center gap-2">
          <button onClick={onToggleVisibility} style={{ color: "var(--color-text-secondary)" }}>
            {isHidden ? <EyeOff size={14} /> : <Eye size={14} />}
          </button>
          <button onClick={onRemove} style={{ color: "var(--color-text-secondary)" }}>
            <Trash2 size={14} />
          </button>
        </div>
      </div>

      {!isHidden && (
        <div className="space-y-4">
          {items.map((item: any, index: number) => (
            <CertificateItem
              key={item.id}
              item={item}
              index={index}
              updateItem={updateItem}
              removeItem={removeItem}
              toggleItemVisibility={toggleItemVisibility}
              toggleItemCollapsed={toggleItemCollapsed}
              moveItem={moveItem}
            />
          ))}

          <button
            onClick={addItem}
            className="w-full py-2 rounded-lg border-2 border-dashed flex items-center justify-center gap-2"
            style={{ borderColor: "var(--color-border-tertiary)", color: "var(--color-teal-600)" }}
          >
            <Plus size={14} />
            <span style={{ fontSize: "13px", fontWeight: 500 }}>Add certificate</span>
          </button>
        </div>
      )}
    </div>
  );
}

// Courses section
interface CoursesSectionProps {
  data: any;
  isHidden: boolean;
  onToggleVisibility: () => void;
  onRemove: () => void;
  onChange: (data: any) => void;
}

interface CourseItemProps {
  item: any;
  index: number;
  updateItem: (index: number, item: any) => void;
  removeItem: (index: number) => void;
  toggleItemVisibility: (index: number) => void;
  toggleItemCollapsed: (index: number) => void;
  moveItem: (dragIndex: number, hoverIndex: number) => void;
}

function CourseItem({ item, index, updateItem, removeItem, toggleItemVisibility, toggleItemCollapsed, moveItem }: CourseItemProps) {
  const ref = useRef<HTMLDivElement>(null);

  const [{ isDragging }, drag] = useDrag({
    type: "COURSE_ITEM",
    item: { index },
    collect: (monitor) => ({
      isDragging: monitor.isDragging(),
    }),
  });

  const [, drop] = useDrop({
    accept: "COURSE_ITEM",
    hover: (draggedItem: { index: number }) => {
      if (draggedItem.index !== index) {
        moveItem(draggedItem.index, index);
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
            onClick={() => toggleItemCollapsed(index)}
            className="hover:bg-gray-100 rounded p-1"
            style={{ color: "var(--color-text-secondary)" }}
          >
            {isCollapsed ? <ChevronDown size={14} /> : <ChevronUp size={14} />}
          </button>
          {isCollapsed && (
            <div className="flex-1 min-w-0" style={{ fontSize: "13px", color: "var(--color-text-primary)" }}>
              <div className="truncate font-medium">
                {item.title || "Untitled Course"}
              </div>
              {item.institution && (
                <div className="text-xs truncate" style={{ color: "var(--color-text-secondary)" }}>
                  {item.institution}
                </div>
              )}
            </div>
          )}
        </div>
        <div className="flex items-center gap-1">
          <button onClick={() => toggleItemVisibility(index)} style={{ color: "var(--color-text-secondary)" }}>
            {item.hidden ? <EyeOff size={14} /> : <Eye size={14} />}
          </button>
          <button onClick={() => removeItem(index)} style={{ color: "var(--color-text-secondary)" }}>
            <Trash2 size={14} />
          </button>
        </div>
      </div>

      {!isCollapsed && !item.hidden && (
        <div className="space-y-2 pl-8">
          <input
            type="text"
            placeholder="Course Title"
            value={item.title}
            onChange={(e) => updateItem(index, { ...item, title: e.target.value })}
            className="w-full px-2 py-1.5 rounded border"
            style={{
              fontSize: "13px",
              borderColor: "var(--color-border-secondary)",
            }}
          />
          <input
            type="text"
            placeholder="Institution"
            value={item.institution || ""}
            onChange={(e) => updateItem(index, { ...item, institution: e.target.value })}
            className="w-full px-2 py-1.5 rounded border"
            style={{
              fontSize: "13px",
              borderColor: "var(--color-border-secondary)",
            }}
          />
          <input
            type="url"
            placeholder="URL (optional)"
            value={item.url || ""}
            onChange={(e) => updateItem(index, { ...item, url: e.target.value })}
            className="w-full px-2 py-1.5 rounded border"
            style={{
              fontSize: "13px",
              borderColor: "var(--color-border-secondary)",
            }}
          />
          <textarea
            rows={2}
            placeholder="Description (optional)"
            value={item.description || ""}
            onChange={(e) => updateItem(index, { ...item, description: e.target.value })}
            className="w-full px-2 py-1.5 rounded border resize-none"
            style={{
              fontSize: "13px",
              lineHeight: "1.6",
              borderColor: "var(--color-border-secondary)",
            }}
          />
        </div>
      )}
    </div>
  );
}

export function CoursesSection({ data, isHidden, onToggleVisibility, onRemove, onChange }: CoursesSectionProps) {
  const items = data.items || [];

  const addItem = () => {
    onChange({
      ...data,
      items: [...items, { id: Date.now(), title: "", url: "", institution: "", description: "", hidden: false, collapsed: false }],
    });
  };

  const updateItem = (index: number, updatedItem: any) => {
    const newItems = [...items];
    newItems[index] = updatedItem;
    onChange({ ...data, items: newItems });
  };

  const removeItem = (index: number) => {
    onChange({ ...data, items: items.filter((_: any, i: number) => i !== index) });
  };

  const toggleItemVisibility = (index: number) => {
    const newItems = [...items];
    newItems[index] = { ...newItems[index], hidden: !newItems[index].hidden };
    onChange({ ...data, items: newItems });
  };

  const toggleItemCollapsed = (index: number) => {
    const newItems = [...items];
    newItems[index] = { ...newItems[index], collapsed: !newItems[index].collapsed };
    onChange({ ...data, items: newItems });
  };

  const moveItem = (dragIndex: number, hoverIndex: number) => {
    const newItems = [...items];
    const draggedItem = newItems[dragIndex];
    newItems.splice(dragIndex, 1);
    newItems.splice(hoverIndex, 0, draggedItem);
    onChange({ ...data, items: newItems });
  };

  return (
    <div
      className="p-4 rounded-xl border"
      style={{
        background: "var(--color-background-primary)",
        borderColor: "var(--color-border-tertiary)",
        opacity: isHidden ? 0.5 : 1,
      }}
    >
      <div className="flex items-start justify-between mb-4">
        <h3 className="font-medium flex items-center gap-2" style={{ fontSize: "15px", color: "var(--color-text-primary)" }}>
          <GripVertical size={14} style={{ color: "var(--color-text-secondary)", cursor: "grab" }} />
          Courses
        </h3>
        <div className="flex items-center gap-2">
          <button onClick={onToggleVisibility} style={{ color: "var(--color-text-secondary)" }}>
            {isHidden ? <EyeOff size={14} /> : <Eye size={14} />}
          </button>
          <button onClick={onRemove} style={{ color: "var(--color-text-secondary)" }}>
            <Trash2 size={14} />
          </button>
        </div>
      </div>

      {!isHidden && (
        <div className="space-y-4">
          {items.map((item: any, index: number) => (
            <CourseItem
              key={item.id}
              item={item}
              index={index}
              updateItem={updateItem}
              removeItem={removeItem}
              toggleItemVisibility={toggleItemVisibility}
              toggleItemCollapsed={toggleItemCollapsed}
              moveItem={moveItem}
            />
          ))}

          <button
            onClick={addItem}
            className="w-full py-2 rounded-lg border-2 border-dashed flex items-center justify-center gap-2"
            style={{ borderColor: "var(--color-border-tertiary)", color: "var(--color-teal-600)" }}
          >
            <Plus size={14} />
            <span style={{ fontSize: "13px", fontWeight: 500 }}>Add course</span>
          </button>
        </div>
      )}
    </div>
  );
}

// Projects section with specialized fields
interface ProjectsSectionProps {
  data: any;
  isHidden: boolean;
  onToggleVisibility: () => void;
  onRemove: () => void;
  onChange: (data: any) => void;
}

interface ProjectItemProps {
  item: any;
  index: number;
  updateItem: (index: number, item: any) => void;
  removeItem: (index: number) => void;
  toggleItemVisibility: (index: number) => void;
  toggleItemCollapsed: (index: number) => void;
  moveItem: (dragIndex: number, hoverIndex: number) => void;
}

function ProjectItem({ item, index, updateItem, removeItem, toggleItemVisibility, toggleItemCollapsed, moveItem }: ProjectItemProps) {
  const ref = useRef<HTMLDivElement>(null);

  const [{ isDragging }, drag] = useDrag({
    type: "PROJECT_ITEM",
    item: { index },
    collect: (monitor) => ({
      isDragging: monitor.isDragging(),
    }),
  });

  const [, drop] = useDrop({
    accept: "PROJECT_ITEM",
    hover: (draggedItem: { index: number }) => {
      if (draggedItem.index !== index) {
        moveItem(draggedItem.index, index);
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
            onClick={() => toggleItemCollapsed(index)}
            className="hover:bg-gray-100 rounded p-1"
            style={{ color: "var(--color-text-secondary)" }}
          >
            {isCollapsed ? <ChevronDown size={14} /> : <ChevronUp size={14} />}
          </button>
          {isCollapsed && (
            <div className="flex-1 min-w-0" style={{ fontSize: "13px", color: "var(--color-text-primary)" }}>
              <div className="truncate font-medium">
                {item.title || "Untitled Project"}
              </div>
              <div className="text-xs" style={{ color: "var(--color-text-secondary)" }}>
                {item.startDate || "Start"} - {item.endDate || "End"}
              </div>
            </div>
          )}
        </div>
        <div className="flex items-center gap-1">
          <button onClick={() => toggleItemVisibility(index)} style={{ color: "var(--color-text-secondary)" }}>
            {item.hidden ? <EyeOff size={14} /> : <Eye size={14} />}
          </button>
          <button onClick={() => removeItem(index)} style={{ color: "var(--color-text-secondary)" }}>
            <Trash2 size={14} />
          </button>
        </div>
      </div>

      {!isCollapsed && !item.hidden && (
        <div className="space-y-2 pl-8">
          <input
            type="text"
            placeholder="Project Title"
            value={item.title}
            onChange={(e) => updateItem(index, { ...item, title: e.target.value })}
            className="w-full px-2 py-1.5 rounded border"
            style={{
              fontSize: "13px",
              borderColor: "var(--color-border-secondary)",
            }}
          />
          <input
            type="text"
            placeholder="Project Subtitle (optional)"
            value={item.subtitle || ""}
            onChange={(e) => updateItem(index, { ...item, subtitle: e.target.value })}
            className="w-full px-2 py-1.5 rounded border"
            style={{
              fontSize: "13px",
              borderColor: "var(--color-border-secondary)",
            }}
          />
          <div className="grid grid-cols-2 gap-2">
            <DateInputHelper
              value={item.startDate || ""}
              placeholder="Start Date"
              onChange={(nextValue) => updateItem(index, { ...item, startDate: nextValue })}
            />
            <DateInputHelper
              value={item.endDate || ""}
              placeholder="End Date"
              onChange={(nextValue) => updateItem(index, { ...item, endDate: nextValue })}
            />
          </div>
          <textarea
            rows={3}
            placeholder="Description"
            value={item.description || ""}
            onChange={(e) => updateItem(index, { ...item, description: e.target.value })}
            className="w-full px-2 py-1.5 rounded border resize-none"
            style={{
              fontSize: "13px",
              lineHeight: "1.6",
              borderColor: "var(--color-border-secondary)",
            }}
          />
        </div>
      )}
    </div>
  );
}

export function ProjectsSection({ data, isHidden, onToggleVisibility, onRemove, onChange }: ProjectsSectionProps) {
  const items = data.items || [];

  const addItem = () => {
    onChange({
      ...data,
      items: [...items, { id: Date.now(), title: "", subtitle: "", startDate: "", endDate: "", description: "", hidden: false, collapsed: false }],
    });
  };

  const updateItem = (index: number, updatedItem: any) => {
    const newItems = [...items];
    newItems[index] = updatedItem;
    onChange({ ...data, items: newItems });
  };

  const removeItem = (index: number) => {
    onChange({ ...data, items: items.filter((_: any, i: number) => i !== index) });
  };

  const toggleItemVisibility = (index: number) => {
    const newItems = [...items];
    newItems[index] = { ...newItems[index], hidden: !newItems[index].hidden };
    onChange({ ...data, items: newItems });
  };

  const toggleItemCollapsed = (index: number) => {
    const newItems = [...items];
    newItems[index] = { ...newItems[index], collapsed: !newItems[index].collapsed };
    onChange({ ...data, items: newItems });
  };

  const moveItem = (dragIndex: number, hoverIndex: number) => {
    const newItems = [...items];
    const draggedItem = newItems[dragIndex];
    newItems.splice(dragIndex, 1);
    newItems.splice(hoverIndex, 0, draggedItem);
    onChange({ ...data, items: newItems });
  };

  return (
    <div
      className="p-4 rounded-xl border"
      style={{
        background: "var(--color-background-primary)",
        borderColor: "var(--color-border-tertiary)",
        opacity: isHidden ? 0.5 : 1,
      }}
    >
      <div className="flex items-start justify-between mb-4">
        <h3 className="font-medium flex items-center gap-2" style={{ fontSize: "15px", color: "var(--color-text-primary)" }}>
          <GripVertical size={14} style={{ color: "var(--color-text-secondary)", cursor: "grab" }} />
          Projects
        </h3>
        <div className="flex items-center gap-2">
          <button onClick={onToggleVisibility} style={{ color: "var(--color-text-secondary)" }}>
            {isHidden ? <EyeOff size={14} /> : <Eye size={14} />}
          </button>
          <button onClick={onRemove} style={{ color: "var(--color-text-secondary)" }}>
            <Trash2 size={14} />
          </button>
        </div>
      </div>

      {!isHidden && (
        <div className="space-y-4">
          {items.map((item: any, index: number) => (
            <ProjectItem
              key={item.id}
              item={item}
              index={index}
              updateItem={updateItem}
              removeItem={removeItem}
              toggleItemVisibility={toggleItemVisibility}
              toggleItemCollapsed={toggleItemCollapsed}
              moveItem={moveItem}
            />
          ))}

          <button
            onClick={addItem}
            className="w-full py-2 rounded-lg border-2 border-dashed flex items-center justify-center gap-2"
            style={{ borderColor: "var(--color-border-tertiary)", color: "var(--color-teal-600)" }}
          >
            <Plus size={14} />
            <span style={{ fontSize: "13px", fontWeight: 500 }}>Add project</span>
          </button>
        </div>
      )}
    </div>
  );
}

// Awards section
interface AwardsSectionProps {
  data: any;
  isHidden: boolean;
  onToggleVisibility: () => void;
  onRemove: () => void;
  onChange: (data: any) => void;
}

interface AwardItemProps {
  item: any;
  index: number;
  updateItem: (index: number, item: any) => void;
  removeItem: (index: number) => void;
  toggleItemVisibility: (index: number) => void;
  toggleItemCollapsed: (index: number) => void;
  moveItem: (dragIndex: number, hoverIndex: number) => void;
}

function AwardItem({ item, index, updateItem, removeItem, toggleItemVisibility, toggleItemCollapsed, moveItem }: AwardItemProps) {
  const ref = useRef<HTMLDivElement>(null);

  const [{ isDragging }, drag] = useDrag({
    type: "AWARD_ITEM",
    item: { index },
    collect: (monitor) => ({
      isDragging: monitor.isDragging(),
    }),
  });

  const [, drop] = useDrop({
    accept: "AWARD_ITEM",
    hover: (draggedItem: { index: number }) => {
      if (draggedItem.index !== index) {
        moveItem(draggedItem.index, index);
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
            onClick={() => toggleItemCollapsed(index)}
            className="hover:bg-gray-100 rounded p-1"
            style={{ color: "var(--color-text-secondary)" }}
          >
            {isCollapsed ? <ChevronDown size={14} /> : <ChevronUp size={14} />}
          </button>
          {isCollapsed && (
            <div className="flex-1 min-w-0" style={{ fontSize: "13px", color: "var(--color-text-primary)" }}>
              <div className="truncate font-medium">
                {item.name || "Untitled Award"}
              </div>
              {(item.issuer || item.date) && (
                <div className="text-xs truncate" style={{ color: "var(--color-text-secondary)" }}>
                  {item.issuer} {item.date && `• ${item.date}`}
                </div>
              )}
            </div>
          )}
        </div>
        <div className="flex items-center gap-1">
          <button onClick={() => toggleItemVisibility(index)} style={{ color: "var(--color-text-secondary)" }}>
            {item.hidden ? <EyeOff size={14} /> : <Eye size={14} />}
          </button>
          <button onClick={() => removeItem(index)} style={{ color: "var(--color-text-secondary)" }}>
            <Trash2 size={14} />
          </button>
        </div>
      </div>

      {!isCollapsed && !item.hidden && (
        <div className="space-y-2 pl-8">
          <input
            type="text"
            placeholder="Award Name"
            value={item.name}
            onChange={(e) => updateItem(index, { ...item, name: e.target.value })}
            className="w-full px-2 py-1.5 rounded border"
            style={{
              fontSize: "13px",
              borderColor: "var(--color-border-secondary)",
            }}
          />
          <input
            type="text"
            placeholder="Issuer"
            value={item.issuer || ""}
            onChange={(e) => updateItem(index, { ...item, issuer: e.target.value })}
            className="w-full px-2 py-1.5 rounded border"
            style={{
              fontSize: "13px",
              borderColor: "var(--color-border-secondary)",
            }}
          />
          <DateInputHelper
            value={item.date || ""}
            placeholder="Date (e.g. 2023)"
            onChange={(nextValue) => updateItem(index, { ...item, date: nextValue })}
          />
          <textarea
            rows={2}
            placeholder="Description (optional)"
            value={item.description || ""}
            onChange={(e) => updateItem(index, { ...item, description: e.target.value })}
            className="w-full px-2 py-1.5 rounded border resize-none"
            style={{
              fontSize: "13px",
              lineHeight: "1.6",
              borderColor: "var(--color-border-secondary)",
            }}
          />
        </div>
      )}
    </div>
  );
}

export function AwardsSection({ data, isHidden, onToggleVisibility, onRemove, onChange }: AwardsSectionProps) {
  const items = data.items || [];

  const addItem = () => {
    onChange({
      ...data,
      items: [...items, { id: Date.now(), name: "", issuer: "", date: "", description: "", hidden: false, collapsed: false }],
    });
  };

  const updateItem = (index: number, updatedItem: any) => {
    const newItems = [...items];
    newItems[index] = updatedItem;
    onChange({ ...data, items: newItems });
  };

  const removeItem = (index: number) => {
    onChange({ ...data, items: items.filter((_: any, i: number) => i !== index) });
  };

  const toggleItemVisibility = (index: number) => {
    const newItems = [...items];
    newItems[index] = { ...newItems[index], hidden: !newItems[index].hidden };
    onChange({ ...data, items: newItems });
  };

  const toggleItemCollapsed = (index: number) => {
    const newItems = [...items];
    newItems[index] = { ...newItems[index], collapsed: !newItems[index].collapsed };
    onChange({ ...data, items: newItems });
  };

  const moveItem = (dragIndex: number, hoverIndex: number) => {
    const newItems = [...items];
    const draggedItem = newItems[dragIndex];
    newItems.splice(dragIndex, 1);
    newItems.splice(hoverIndex, 0, draggedItem);
    onChange({ ...data, items: newItems });
  };

  return (
    <div
      className="p-4 rounded-xl border"
      style={{
        background: "var(--color-background-primary)",
        borderColor: "var(--color-border-tertiary)",
        opacity: isHidden ? 0.5 : 1,
      }}
    >
      <div className="flex items-start justify-between mb-4">
        <h3 className="font-medium flex items-center gap-2" style={{ fontSize: "15px", color: "var(--color-text-primary)" }}>
          <GripVertical size={14} style={{ color: "var(--color-text-secondary)", cursor: "grab" }} />
          Awards
        </h3>
        <div className="flex items-center gap-2">
          <button onClick={onToggleVisibility} style={{ color: "var(--color-text-secondary)" }}>
            {isHidden ? <EyeOff size={14} /> : <Eye size={14} />}
          </button>
          <button onClick={onRemove} style={{ color: "var(--color-text-secondary)" }}>
            <Trash2 size={14} />
          </button>
        </div>
      </div>

      {!isHidden && (
        <div className="space-y-4">
          {items.map((item: any, index: number) => (
            <AwardItem
              key={item.id}
              item={item}
              index={index}
              updateItem={updateItem}
              removeItem={removeItem}
              toggleItemVisibility={toggleItemVisibility}
              toggleItemCollapsed={toggleItemCollapsed}
              moveItem={moveItem}
            />
          ))}

          <button
            onClick={addItem}
            className="w-full py-2 rounded-lg border-2 border-dashed flex items-center justify-center gap-2"
            style={{ borderColor: "var(--color-border-tertiary)", color: "var(--color-teal-600)" }}
          >
            <Plus size={14} />
            <span style={{ fontSize: "13px", fontWeight: 500 }}>Add award</span>
          </button>
        </div>
      )}
    </div>
  );
}

// Publications section
interface PublicationsSectionProps {
  data: any;
  isHidden: boolean;
  onToggleVisibility: () => void;
  onRemove: () => void;
  onChange: (data: any) => void;
}

interface PublicationItemProps {
  item: any;
  index: number;
  updateItem: (index: number, item: any) => void;
  removeItem: (index: number) => void;
  toggleItemVisibility: (index: number) => void;
  toggleItemCollapsed: (index: number) => void;
  moveItem: (dragIndex: number, hoverIndex: number) => void;
}

function PublicationItem({ item, index, updateItem, removeItem, toggleItemVisibility, toggleItemCollapsed, moveItem }: PublicationItemProps) {
  const ref = useRef<HTMLDivElement>(null);

  const [{ isDragging }, drag] = useDrag({
    type: "PUBLICATION_ITEM",
    item: { index },
    collect: (monitor) => ({
      isDragging: monitor.isDragging(),
    }),
  });

  const [, drop] = useDrop({
    accept: "PUBLICATION_ITEM",
    hover: (draggedItem: { index: number }) => {
      if (draggedItem.index !== index) {
        moveItem(draggedItem.index, index);
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
            onClick={() => toggleItemCollapsed(index)}
            className="hover:bg-gray-100 rounded p-1"
            style={{ color: "var(--color-text-secondary)" }}
          >
            {isCollapsed ? <ChevronDown size={14} /> : <ChevronUp size={14} />}
          </button>
          {isCollapsed && (
            <div className="flex-1 min-w-0" style={{ fontSize: "13px", color: "var(--color-text-primary)" }}>
              <div className="truncate font-medium">
                {item.title || "Untitled Publication"}
              </div>
              {(item.publisher || item.date) && (
                <div className="text-xs truncate" style={{ color: "var(--color-text-secondary)" }}>
                  {item.publisher} {item.date && `• ${item.date}`}
                </div>
              )}
            </div>
          )}
        </div>
        <div className="flex items-center gap-1">
          <button onClick={() => toggleItemVisibility(index)} style={{ color: "var(--color-text-secondary)" }}>
            {item.hidden ? <EyeOff size={14} /> : <Eye size={14} />}
          </button>
          <button onClick={() => removeItem(index)} style={{ color: "var(--color-text-secondary)" }}>
            <Trash2 size={14} />
          </button>
        </div>
      </div>

      {!isCollapsed && !item.hidden && (
        <div className="space-y-2 pl-8">
          <input
            type="text"
            placeholder="Title"
            value={item.title}
            onChange={(e) => updateItem(index, { ...item, title: e.target.value })}
            className="w-full px-2 py-1.5 rounded border"
            style={{
              fontSize: "13px",
              borderColor: "var(--color-border-secondary)",
            }}
          />
          <input
            type="text"
            placeholder="Publisher"
            value={item.publisher || ""}
            onChange={(e) => updateItem(index, { ...item, publisher: e.target.value })}
            className="w-full px-2 py-1.5 rounded border"
            style={{
              fontSize: "13px",
              borderColor: "var(--color-border-secondary)",
            }}
          />
          <DateInputHelper
            value={item.date || ""}
            placeholder="Date (e.g. 2023)"
            onChange={(nextValue) => updateItem(index, { ...item, date: nextValue })}
          />
          <textarea
            rows={2}
            placeholder="Description (optional)"
            value={item.description || ""}
            onChange={(e) => updateItem(index, { ...item, description: e.target.value })}
            className="w-full px-2 py-1.5 rounded border resize-none"
            style={{
              fontSize: "13px",
              lineHeight: "1.6",
              borderColor: "var(--color-border-secondary)",
            }}
          />
        </div>
      )}
    </div>
  );
}

export function PublicationsSection({ data, isHidden, onToggleVisibility, onRemove, onChange }: PublicationsSectionProps) {
  const items = data.items || [];

  const addItem = () => {
    onChange({
      ...data,
      items: [...items, { id: Date.now(), title: "", publisher: "", date: "", description: "", hidden: false, collapsed: false }],
    });
  };

  const updateItem = (index: number, updatedItem: any) => {
    const newItems = [...items];
    newItems[index] = updatedItem;
    onChange({ ...data, items: newItems });
  };

  const removeItem = (index: number) => {
    onChange({ ...data, items: items.filter((_: any, i: number) => i !== index) });
  };

  const toggleItemVisibility = (index: number) => {
    const newItems = [...items];
    newItems[index] = { ...newItems[index], hidden: !newItems[index].hidden };
    onChange({ ...data, items: newItems });
  };

  const toggleItemCollapsed = (index: number) => {
    const newItems = [...items];
    newItems[index] = { ...newItems[index], collapsed: !newItems[index].collapsed };
    onChange({ ...data, items: newItems });
  };

  const moveItem = (dragIndex: number, hoverIndex: number) => {
    const newItems = [...items];
    const draggedItem = newItems[dragIndex];
    newItems.splice(dragIndex, 1);
    newItems.splice(hoverIndex, 0, draggedItem);
    onChange({ ...data, items: newItems });
  };

  return (
    <div
      className="p-4 rounded-xl border"
      style={{
        background: "var(--color-background-primary)",
        borderColor: "var(--color-border-tertiary)",
        opacity: isHidden ? 0.5 : 1,
      }}
    >
      <div className="flex items-start justify-between mb-4">
        <h3 className="font-medium flex items-center gap-2" style={{ fontSize: "15px", color: "var(--color-text-primary)" }}>
          <GripVertical size={14} style={{ color: "var(--color-text-secondary)", cursor: "grab" }} />
          Publications
        </h3>
        <div className="flex items-center gap-2">
          <button onClick={onToggleVisibility} style={{ color: "var(--color-text-secondary)" }}>
            {isHidden ? <EyeOff size={14} /> : <Eye size={14} />}
          </button>
          <button onClick={onRemove} style={{ color: "var(--color-text-secondary)" }}>
            <Trash2 size={14} />
          </button>
        </div>
      </div>

      {!isHidden && (
        <div className="space-y-4">
          {items.map((item: any, index: number) => (
            <PublicationItem
              key={item.id}
              item={item}
              index={index}
              updateItem={updateItem}
              removeItem={removeItem}
              toggleItemVisibility={toggleItemVisibility}
              toggleItemCollapsed={toggleItemCollapsed}
              moveItem={moveItem}
            />
          ))}

          <button
            onClick={addItem}
            className="w-full py-2 rounded-lg border-2 border-dashed flex items-center justify-center gap-2"
            style={{ borderColor: "var(--color-border-tertiary)", color: "var(--color-teal-600)" }}
          >
            <Plus size={14} />
            <span style={{ fontSize: "13px", fontWeight: 500 }}>Add publication</span>
          </button>
        </div>
      )}
    </div>
  );
}

// References section
interface ReferencesSectionProps {
  data: any;
  isHidden: boolean;
  onToggleVisibility: () => void;
  onRemove: () => void;
  onChange: (data: any) => void;
}

interface ReferenceItemProps {
  item: any;
  index: number;
  updateItem: (index: number, item: any) => void;
  removeItem: (index: number) => void;
  toggleItemVisibility: (index: number) => void;
  toggleItemCollapsed: (index: number) => void;
  moveItem: (dragIndex: number, hoverIndex: number) => void;
}

function ReferenceItem({ item, index, updateItem, removeItem, toggleItemVisibility, toggleItemCollapsed, moveItem }: ReferenceItemProps) {
  const ref = useRef<HTMLDivElement>(null);

  const [{ isDragging }, drag] = useDrag({
    type: "REFERENCE_ITEM",
    item: { index },
    collect: (monitor) => ({
      isDragging: monitor.isDragging(),
    }),
  });

  const [, drop] = useDrop({
    accept: "REFERENCE_ITEM",
    hover: (draggedItem: { index: number }) => {
      if (draggedItem.index !== index) {
        moveItem(draggedItem.index, index);
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
            onClick={() => toggleItemCollapsed(index)}
            className="hover:bg-gray-100 rounded p-1"
            style={{ color: "var(--color-text-secondary)" }}
          >
            {isCollapsed ? <ChevronDown size={14} /> : <ChevronUp size={14} />}
          </button>
          {isCollapsed && (
            <div className="flex-1 min-w-0" style={{ fontSize: "13px", color: "var(--color-text-primary)" }}>
              <div className="truncate font-medium">
                {item.name || "Untitled Reference"}
              </div>
              {(item.jobTitle || item.organization) && (
                <div className="text-xs truncate" style={{ color: "var(--color-text-secondary)" }}>
                  {item.jobTitle} {item.organization && `at ${item.organization}`}
                </div>
              )}
            </div>
          )}
        </div>
        <div className="flex items-center gap-1">
          <button onClick={() => toggleItemVisibility(index)} style={{ color: "var(--color-text-secondary)" }}>
            {item.hidden ? <EyeOff size={14} /> : <Eye size={14} />}
          </button>
          <button onClick={() => removeItem(index)} style={{ color: "var(--color-text-secondary)" }}>
            <Trash2 size={14} />
          </button>
        </div>
      </div>

      {!isCollapsed && !item.hidden && (
        <div className="space-y-2 pl-8">
          <input
            type="text"
            placeholder="Name"
            value={item.name}
            onChange={(e) => updateItem(index, { ...item, name: e.target.value })}
            className="w-full px-2 py-1.5 rounded border"
            style={{
              fontSize: "13px",
              borderColor: "var(--color-border-secondary)",
            }}
          />
          <div className="grid grid-cols-2 gap-2">
            <input
              type="text"
              placeholder="Job Title"
              value={item.jobTitle || ""}
              onChange={(e) => updateItem(index, { ...item, jobTitle: e.target.value })}
              className="px-2 py-1.5 rounded border"
              style={{
                fontSize: "13px",
                borderColor: "var(--color-border-secondary)",
              }}
            />
            <input
              type="text"
              placeholder="Organization"
              value={item.organization || ""}
              onChange={(e) => updateItem(index, { ...item, organization: e.target.value })}
              className="px-2 py-1.5 rounded border"
              style={{
                fontSize: "13px",
                borderColor: "var(--color-border-secondary)",
              }}
            />
          </div>
          <div className="grid grid-cols-2 gap-2">
            <input
              type="email"
              placeholder="Email"
              value={item.email || ""}
              onChange={(e) => updateItem(index, { ...item, email: e.target.value })}
              className="px-2 py-1.5 rounded border"
              style={{
                fontSize: "13px",
                borderColor: "var(--color-border-secondary)",
              }}
            />
            <input
              type="tel"
              placeholder="Phone Number"
              value={item.phone || ""}
              onChange={(e) => updateItem(index, { ...item, phone: e.target.value })}
              className="px-2 py-1.5 rounded border"
              style={{
                fontSize: "13px",
                borderColor: "var(--color-border-secondary)",
              }}
            />
          </div>
        </div>
      )}
    </div>
  );
}

export function ReferencesSection({ data, isHidden, onToggleVisibility, onRemove, onChange }: ReferencesSectionProps) {
  const items = data.items || [];

  const addItem = () => {
    onChange({
      ...data,
      items: [...items, { id: Date.now(), name: "", jobTitle: "", organization: "", email: "", phone: "", hidden: false, collapsed: false }],
    });
  };

  const updateItem = (index: number, updatedItem: any) => {
    const newItems = [...items];
    newItems[index] = updatedItem;
    onChange({ ...data, items: newItems });
  };

  const removeItem = (index: number) => {
    onChange({ ...data, items: items.filter((_: any, i: number) => i !== index) });
  };

  const toggleItemVisibility = (index: number) => {
    const newItems = [...items];
    newItems[index] = { ...newItems[index], hidden: !newItems[index].hidden };
    onChange({ ...data, items: newItems });
  };

  const toggleItemCollapsed = (index: number) => {
    const newItems = [...items];
    newItems[index] = { ...newItems[index], collapsed: !newItems[index].collapsed };
    onChange({ ...data, items: newItems });
  };

  const moveItem = (dragIndex: number, hoverIndex: number) => {
    const newItems = [...items];
    const draggedItem = newItems[dragIndex];
    newItems.splice(dragIndex, 1);
    newItems.splice(hoverIndex, 0, draggedItem);
    onChange({ ...data, items: newItems });
  };

  return (
    <div
      className="p-4 rounded-xl border"
      style={{
        background: "var(--color-background-primary)",
        borderColor: "var(--color-border-tertiary)",
        opacity: isHidden ? 0.5 : 1,
      }}
    >
      <div className="flex items-start justify-between mb-4">
        <h3 className="font-medium flex items-center gap-2" style={{ fontSize: "15px", color: "var(--color-text-primary)" }}>
          <GripVertical size={14} style={{ color: "var(--color-text-secondary)", cursor: "grab" }} />
          References
        </h3>
        <div className="flex items-center gap-2">
          <button onClick={onToggleVisibility} style={{ color: "var(--color-text-secondary)" }}>
            {isHidden ? <EyeOff size={14} /> : <Eye size={14} />}
          </button>
          <button onClick={onRemove} style={{ color: "var(--color-text-secondary)" }}>
            <Trash2 size={14} />
          </button>
        </div>
      </div>

      {!isHidden && (
        <div className="space-y-4">
          {items.map((item: any, index: number) => (
            <ReferenceItem
              key={item.id}
              item={item}
              index={index}
              updateItem={updateItem}
              removeItem={removeItem}
              toggleItemVisibility={toggleItemVisibility}
              toggleItemCollapsed={toggleItemCollapsed}
              moveItem={moveItem}
            />
          ))}

          <button
            onClick={addItem}
            className="w-full py-2 rounded-lg border-2 border-dashed flex items-center justify-center gap-2"
            style={{ borderColor: "var(--color-border-tertiary)", color: "var(--color-teal-600)" }}
          >
            <Plus size={14} />
            <span style={{ fontSize: "13px", fontWeight: 500 }}>Add reference</span>
          </button>
        </div>
      )}
    </div>
  );
}

// Volunteer Work section - mirrors Work Experience
interface VolunteerSectionProps {
  data: any;
  isHidden: boolean;
  onToggleVisibility: () => void;
  onRemove: () => void;
  onChange: (data: any) => void;
}

interface VolunteerItemProps {
  item: any;
  index: number;
  updateItem: (index: number, item: any) => void;
  removeItem: (index: number) => void;
  toggleItemVisibility: (index: number) => void;
  toggleItemCollapsed: (index: number) => void;
  moveItem: (dragIndex: number, hoverIndex: number) => void;
}

function VolunteerItem({ item, index, updateItem, removeItem, toggleItemVisibility, toggleItemCollapsed, moveItem }: VolunteerItemProps) {
  const ref = useRef<HTMLDivElement>(null);

  const [{ isDragging }, drag] = useDrag({
    type: "VOLUNTEER_ITEM",
    item: { index },
    collect: (monitor) => ({
      isDragging: monitor.isDragging(),
    }),
  });

  const [, drop] = useDrop({
    accept: "VOLUNTEER_ITEM",
    hover: (draggedItem: { index: number }) => {
      if (draggedItem.index !== index) {
        moveItem(draggedItem.index, index);
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
            onClick={() => toggleItemCollapsed(index)}
            className="hover:bg-gray-100 rounded p-1"
            style={{ color: "var(--color-text-secondary)" }}
          >
            {isCollapsed ? <ChevronDown size={14} /> : <ChevronUp size={14} />}
          </button>
          {isCollapsed && (
            <div className="flex-1 min-w-0" style={{ fontSize: "13px", color: "var(--color-text-primary)" }}>
              <div className="truncate font-medium">
                {item.role || "Untitled Position"} {item.organization && `at ${item.organization}`}
              </div>
              <div className="text-xs" style={{ color: "var(--color-text-secondary)" }}>
                {item.startDate || "Start Date"} - {item.currentRole ? "Present" : (item.endDate || "End Date")}
              </div>
            </div>
          )}
        </div>
        <div className="flex items-center gap-1">
          <button onClick={() => toggleItemVisibility(index)} style={{ color: "var(--color-text-secondary)" }}>
            {item.hidden ? <EyeOff size={14} /> : <Eye size={14} />}
          </button>
          <button onClick={() => removeItem(index)} style={{ color: "var(--color-text-secondary)" }}>
            <Trash2 size={14} />
          </button>
        </div>
      </div>

      {!isCollapsed && !item.hidden && (
        <div className="space-y-2 pl-8">
          <div className="grid grid-cols-2 gap-2">
            <input
              type="text"
              placeholder="Organization"
              value={item.organization}
              onChange={(e) => updateItem(index, { ...item, organization: e.target.value })}
              className="px-2 py-1.5 rounded border"
              style={{
                fontSize: "13px",
                borderColor: "var(--color-border-secondary)",
              }}
            />
            <input
              type="text"
              placeholder="Role"
              value={item.role}
              onChange={(e) => updateItem(index, { ...item, role: e.target.value })}
              className="px-2 py-1.5 rounded border"
              style={{
                fontSize: "13px",
                borderColor: "var(--color-border-secondary)",
              }}
            />
          </div>
          <input
            type="text"
            placeholder="Country"
            value={item.country || ""}
            onChange={(e) => updateItem(index, { ...item, country: e.target.value })}
            className="w-full px-2 py-1.5 rounded border"
            style={{
              fontSize: "13px",
              borderColor: "var(--color-border-secondary)",
            }}
          />
          <div className="grid grid-cols-2 gap-2">
            <DateInputHelper
              value={item.startDate || ""}
              placeholder="Start Date (e.g. Jan 2020)"
              onChange={(nextValue) => updateItem(index, { ...item, startDate: nextValue })}
            />
            <DateInputHelper
              value={item.endDate || ""}
              placeholder="End Date (e.g. Dec 2023)"
              disabled={item.currentRole}
              onChange={(nextValue) => updateItem(index, { ...item, endDate: nextValue })}
            />
          </div>
          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={item.currentRole || false}
              onChange={(e) =>
                updateItem(index, {
                  ...item,
                  currentRole: e.target.checked,
                  endDate: e.target.checked
                    ? "Present"
                    : item.endDate === "Present"
                      ? ""
                      : item.endDate
                })
              }
              className="w-4 h-4 rounded"
              style={{
                accentColor: "var(--color-teal-600)",
              }}
            />
            <span style={{ fontSize: "13px", color: "var(--color-text-secondary)" }}>
              I currently volunteer here
            </span>
          </label>
          <textarea
            rows={3}
            placeholder="Responsibilities, Impact, Activities…"
            value={item.description}
            onChange={(e) => updateItem(index, { ...item, description: e.target.value })}
            className="w-full px-2 py-1.5 rounded border resize-none"
            style={{
              fontSize: "13px",
              lineHeight: "1.6",
              borderColor: "var(--color-border-secondary)",
            }}
          />
        </div>
      )}
    </div>
  );
}

export function VolunteerSection({ data, isHidden, onToggleVisibility, onRemove, onChange }: VolunteerSectionProps) {
  const items = data.items || [];

  const addItem = () => {
    onChange({
      ...data,
      items: [...items, { id: Date.now(), organization: "", role: "", country: "", startDate: "", endDate: "", currentRole: false, description: "", hidden: false, collapsed: false }],
    });
  };

  const updateItem = (index: number, updatedItem: any) => {
    const newItems = [...items];
    newItems[index] = updatedItem;
    onChange({ ...data, items: newItems });
  };

  const removeItem = (index: number) => {
    onChange({ ...data, items: items.filter((_: any, i: number) => i !== index) });
  };

  const toggleItemVisibility = (index: number) => {
    const newItems = [...items];
    newItems[index] = { ...newItems[index], hidden: !newItems[index].hidden };
    onChange({ ...data, items: newItems });
  };

  const toggleItemCollapsed = (index: number) => {
    const newItems = [...items];
    newItems[index] = { ...newItems[index], collapsed: !newItems[index].collapsed };
    onChange({ ...data, items: newItems });
  };

  const moveItem = (dragIndex: number, hoverIndex: number) => {
    const newItems = [...items];
    const draggedItem = newItems[dragIndex];
    newItems.splice(dragIndex, 1);
    newItems.splice(hoverIndex, 0, draggedItem);
    onChange({ ...data, items: newItems });
  };

  return (
    <div
      className="p-4 rounded-xl border"
      style={{
        background: "var(--color-background-primary)",
        borderColor: "var(--color-border-tertiary)",
        opacity: isHidden ? 0.5 : 1,
      }}
    >
      <div className="flex items-start justify-between mb-4">
        <h3 className="font-medium flex items-center gap-2" style={{ fontSize: "15px", color: "var(--color-text-primary)" }}>
          <GripVertical size={14} style={{ color: "var(--color-text-secondary)", cursor: "grab" }} />
          Volunteer Work
        </h3>
        <div className="flex items-center gap-2">
          <button onClick={onToggleVisibility} style={{ color: "var(--color-text-secondary)" }}>
            {isHidden ? <EyeOff size={14} /> : <Eye size={14} />}
          </button>
          <button onClick={onRemove} style={{ color: "var(--color-text-secondary)" }}>
            <Trash2 size={14} />
          </button>
        </div>
      </div>

      {!isHidden && (
        <div className="space-y-4">
          {items.map((item: any, index: number) => (
            <VolunteerItem
              key={item.id || `vol-item-${index}`}
              item={item}
              index={index}
              updateItem={updateItem}
              removeItem={removeItem}
              toggleItemVisibility={toggleItemVisibility}
              toggleItemCollapsed={toggleItemCollapsed}
              moveItem={moveItem}
            />
          ))}

          <button
            onClick={addItem}
            className="w-full py-2 rounded-lg border-2 border-dashed flex items-center justify-center gap-2"
            style={{ borderColor: "var(--color-border-tertiary)", color: "var(--color-teal-600)" }}
          >
            <Plus size={14} />
            <span style={{ fontSize: "13px", fontWeight: 500 }}>Add volunteer position</span>
          </button>
        </div>
      )}
    </div>
  );
}
