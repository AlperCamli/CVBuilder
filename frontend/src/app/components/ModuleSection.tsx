import { GripVertical, Eye, EyeOff, Trash2, Plus } from "lucide-react";
import { DateInputHelper } from "./DateInputHelper";
import { BulletTextarea } from "./BulletTextarea";
import type { FieldDescriptor, SectionTypeDefinition } from "../modules/cv-module.types";

// Descriptor-driven editor for job-module section types (e.g. medical_uk). Field
// values live in each item's rawFields so cv-mappers round-trips them into block
// fields untouched; the standard sections never render through this component.

interface ModuleSectionProps {
  definition: SectionTypeDefinition;
  data: any;
  isHidden: boolean;
  onToggleVisibility: () => void;
  onRemove: () => void;
  onChange: (data: any) => void;
}

const fieldValue = (item: any, key: string): unknown => {
  const rawFields = item?.rawFields;
  if (rawFields && typeof rawFields === "object" && key in rawFields) {
    return (rawFields as Record<string, unknown>)[key];
  }
  return undefined;
};

const asText = (value: unknown): string => {
  if (typeof value === "string") {
    return value;
  }
  if (typeof value === "number") {
    return String(value);
  }
  return "";
};

const asLines = (value: unknown): string => {
  if (Array.isArray(value)) {
    return value.map((entry) => asText(entry)).filter((entry) => entry.length > 0).join("\n");
  }
  return asText(value);
};

const titleizeOption = (value: string): string =>
  value
    .replace(/[_-]+/g, " ")
    .split(/\s+/)
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");

export function ModuleSection({
  definition,
  data,
  isHidden,
  onToggleVisibility,
  onRemove,
  onChange
}: ModuleSectionProps) {
  const items = Array.isArray(data?.items) ? data.items : [];

  const updateItemField = (index: number, key: string, value: unknown) => {
    const newItems = [...items];
    const item = newItems[index];
    newItems[index] = {
      ...item,
      rawFields: { ...(item?.rawFields ?? {}), [key]: value }
    };
    onChange({ ...data, items: newItems });
  };

  const addItem = () => {
    onChange({
      ...data,
      items: [
        ...items,
        {
          id: `module-item-${Date.now()}`,
          blockType: definition.blockType,
          hidden: false,
          rawFields: { ...definition.defaultBlockFields },
          rawMeta: {}
        }
      ]
    });
  };

  const removeItem = (index: number) => {
    onChange({ ...data, items: items.filter((_: any, i: number) => i !== index) });
  };

  const toggleItemVisibility = (index: number) => {
    const newItems = [...items];
    newItems[index] = { ...newItems[index], hidden: !newItems[index].hidden };
    onChange({ ...data, items: newItems });
  };

  const renderField = (item: any, index: number, field: FieldDescriptor) => {
    const value = fieldValue(item, field.key);
    const inputStyle = {
      fontSize: "13px",
      borderColor: "var(--color-border-secondary)"
    } as const;

    if (field.kind === "boolean") {
      return (
        <label
          key={field.key}
          className="flex items-center gap-2"
          style={{ fontSize: "13px", color: "var(--color-text-primary)" }}
        >
          <input
            type="checkbox"
            checked={value === true || value === "true"}
            onChange={(e) => updateItemField(index, field.key, e.target.checked)}
          />
          {field.label}
        </label>
      );
    }

    if (field.kind === "select") {
      return (
        <div key={field.key}>
          <label className="block mb-1" style={{ fontSize: "12px", color: "var(--color-text-secondary)" }}>
            {field.label}
            {field.required ? " *" : ""}
          </label>
          <select
            value={asText(value)}
            onChange={(e) => updateItemField(index, field.key, e.target.value)}
            className="w-full px-2 py-1.5 rounded border"
            style={inputStyle}
          >
            <option value="">Select...</option>
            {(field.options ?? []).map((option) => (
              <option key={option} value={option}>
                {titleizeOption(option)}
              </option>
            ))}
          </select>
        </div>
      );
    }

    if (field.kind === "date") {
      return (
        <div key={field.key}>
          <label className="block mb-1" style={{ fontSize: "12px", color: "var(--color-text-secondary)" }}>
            {field.label}
            {field.required ? " *" : ""}
          </label>
          <DateInputHelper
            value={asText(value)}
            placeholder={field.placeholder ?? field.label}
            onChange={(nextValue) => updateItemField(index, field.key, nextValue)}
          />
        </div>
      );
    }

    if (field.kind === "bullets") {
      return (
        <div key={field.key}>
          <label className="block mb-1" style={{ fontSize: "12px", color: "var(--color-text-secondary)" }}>
            {field.label}
            {field.required ? " *" : ""} (one per line)
          </label>
          <BulletTextarea
            rows={3}
            placeholder={field.placeholder ?? field.label}
            value={asLines(value)}
            onValueChange={(next) =>
              updateItemField(
                index,
                field.key,
                next
                  .split("\n")
                  .map((line) => line.replace(/^[-•*]\s*/, "").trim())
                  .filter((line) => line.length > 0)
              )
            }
            className="w-full px-2 py-1.5 rounded border resize-none"
            style={{ ...inputStyle, lineHeight: "1.6" }}
          />
        </div>
      );
    }

    if (field.kind === "textarea") {
      return (
        <div key={field.key}>
          <label className="block mb-1" style={{ fontSize: "12px", color: "var(--color-text-secondary)" }}>
            {field.label}
            {field.required ? " *" : ""}
          </label>
          <textarea
            rows={2}
            placeholder={field.placeholder ?? field.label}
            value={asText(value)}
            onChange={(e) => updateItemField(index, field.key, e.target.value)}
            className="w-full px-2 py-1.5 rounded border resize-none"
            style={{ ...inputStyle, lineHeight: "1.6" }}
          />
        </div>
      );
    }

    return (
      <div key={field.key}>
        <label className="block mb-1" style={{ fontSize: "12px", color: "var(--color-text-secondary)" }}>
          {field.label}
          {field.required ? " *" : ""}
        </label>
        <input
          type="text"
          placeholder={field.placeholder ?? field.label}
          value={asText(value)}
          onChange={(e) => updateItemField(index, field.key, e.target.value)}
          className="w-full px-2 py-1.5 rounded border"
          style={inputStyle}
        />
      </div>
    );
  };

  return (
    <div
      className="p-4 rounded-xl border"
      style={{
        background: "var(--color-background-primary)",
        borderColor: "var(--color-border-tertiary)",
        opacity: isHidden ? 0.5 : 1
      }}
    >
      <div className="flex items-start justify-between mb-4">
        <h3
          className="font-medium flex items-center gap-2"
          style={{ fontSize: "15px", color: "var(--color-text-primary)" }}
        >
          <GripVertical size={14} style={{ color: "var(--color-text-secondary)", cursor: "grab" }} />
          {definition.title}
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
            <div
              key={item.id}
              className="p-3 rounded-lg border"
              style={{
                borderColor: "var(--color-border-tertiary)",
                opacity: item.hidden ? 0.5 : 1
              }}
            >
              <div className="flex items-start justify-between">
                <div className="flex-1 space-y-2">
                  {!item.hidden && definition.fieldSchema.map((field) => renderField(item, index, field))}
                </div>
                <div className="ml-2 flex flex-col gap-1">
                  <button onClick={() => toggleItemVisibility(index)} style={{ color: "var(--color-text-secondary)" }}>
                    {item.hidden ? <EyeOff size={14} /> : <Eye size={14} />}
                  </button>
                  <button onClick={() => removeItem(index)} style={{ color: "var(--color-text-secondary)" }}>
                    <Trash2 size={14} />
                  </button>
                </div>
              </div>
            </div>
          ))}

          <button
            onClick={addItem}
            className="w-full py-2 rounded-lg border-2 border-dashed flex items-center justify-center gap-2"
            style={{ borderColor: "var(--color-border-tertiary)", color: "var(--color-teal-600)" }}
          >
            <Plus size={14} />
            <span style={{ fontSize: "13px", fontWeight: 500 }}>Add entry</span>
          </button>
        </div>
      )}
    </div>
  );
}
