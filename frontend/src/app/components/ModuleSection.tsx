import { translate as t } from "../localization/i18n";
import { useTranslation } from "react-i18next";
import { GripVertical, Eye, EyeOff, Trash2, Plus, Sparkles } from "lucide-react";
import { DateInputHelper } from "./DateInputHelper";
import { BulletTextarea } from "./BulletTextarea";
import { useContext, type ComponentProps } from "react";
import { AIVersionNavigator, type AiVersionNavigatorState } from "./CVSections";
import { EditorItemHighlightContext, editorItemAnchorProps } from "./SpecializedSections";
import type { FieldDescriptor, SectionTypeDefinition } from "../modules/cv-module.types";
import { isNarrativeEditorField, narrativeTextFromValue } from "../integration/narrative-fields";

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
  onAIAssist?: (blockId?: string, anchor?: HTMLElement) => void;
  getAiVersionNavigator?: (blockId?: string) => AiVersionNavigatorState | undefined;
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

// "bullets"-kind fields are stored as arrays but edited as "• " lines. While the user
// types, the raw text is kept in rawFields (so Enter, spaces and empty bullets survive);
// cv-mappers turns it back into an array (markers stripped, blank lines dropped) on save.
const asLines = (value: unknown): string => {
  if (Array.isArray(value)) {
    return narrativeTextFromValue(value);
  }
  return asText(value);
};

function PlainTextarea({
  value,
  onValueChange,
  ...rest
}: Omit<ComponentProps<"textarea">, "value" | "onChange"> & { value: string; onValueChange: (next: string) => void }) {
  return <textarea {...rest} value={value} onChange={(e) => onValueChange(e.target.value)} />;
}

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
  onChange,
  onAIAssist,
  getAiVersionNavigator
}: ModuleSectionProps) {
  useTranslation();
  const items = Array.isArray(data?.items) ? data.items : [];
  const highlightedItemIds = useContext(EditorItemHighlightContext);

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
          {t(field.label)}
        </label>
      );
    }

    if (field.kind === "select") {
      return (
        <div key={field.key}>
          <label className="block mb-1" style={{ fontSize: "12px", color: "var(--color-text-secondary)" }}>
            {t(field.label)}
            {field.required ? " *" : ""}
          </label>
          <select
            value={asText(value)}
            onChange={(e) => updateItemField(index, field.key, e.target.value)}
            className="w-full px-2 py-1.5 rounded border"
            style={inputStyle}
          >
            <option value="">{t("Select...")}</option>
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
            {t(field.label)}
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
            {t(field.label)}
            {field.required ? " *" : ""} {" "}{t("(one per line)")}</label>
          <BulletTextarea
            rows={6}
            placeholder={field.placeholder ?? field.label}
            value={asLines(value)}
            onValueChange={(next) => updateItemField(index, field.key, next)}
            className="w-full px-2 py-1.5 rounded border resize-y min-h-[140px]"
            style={{ ...inputStyle, lineHeight: "1.6" }}
          />
        </div>
      );
    }

    if (field.kind === "textarea") {
      // Narrative text fields (shared rule in narrative-fields.ts: qualification notes,
      // career-gap explanation, additional-skill context, teaching evaluation) get the same
      // bullet-list behavior as the standard descriptions; the raw "• " string is stored.
      // Other textareas (e.g. other registrations, interests) stay plain multi-line text.
      const isBulletField = isNarrativeEditorField(
        { sectionType: definition.type, blockType: item?.blockType ?? definition.blockType },
        field.key
      );
      const TextareaComponent = isBulletField ? BulletTextarea : PlainTextarea;
      return (
        <div key={field.key}>
          <label className="block mb-1" style={{ fontSize: "12px", color: "var(--color-text-secondary)" }}>
            {t(field.label)}
            {field.required ? " *" : ""}
          </label>
          <TextareaComponent
            rows={6}
            placeholder={field.placeholder ?? field.label}
            value={asText(value)}
            onValueChange={(next) => updateItemField(index, field.key, next)}
            className="w-full px-2 py-1.5 rounded border resize-y min-h-[140px]"
            style={{ ...inputStyle, lineHeight: "1.6" }}
          />
        </div>
      );
    }

    return (
      <div key={field.key}>
        <label className="block mb-1" style={{ fontSize: "12px", color: "var(--color-text-secondary)" }}>
          {t(field.label)}
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
              {...editorItemAnchorProps(item, highlightedItemIds)}
              className="p-3 rounded-lg border"
              style={{
                borderColor: "var(--color-border-tertiary)",
                opacity: item.hidden ? 0.5 : 1
              }}
            >
              <div className="flex items-start justify-between">
                <div className="flex-1 space-y-2">
                  {!item.hidden && definition.fieldSchema.map((field) => renderField(item, index, field))}
                  {!item.hidden && definition.aiSuggest && onAIAssist ? (
                    <div className="flex items-center gap-2">
                      <button
                        onClick={(event) => onAIAssist(item.blockId ?? String(item.id ?? ""), event.currentTarget)}
                        className="px-3 py-1 rounded-lg flex items-center gap-1.5"
                        style={{
                          fontSize: "12px",
                          background: "var(--color-teal-50)",
                          color: "var(--color-teal-800)"
                        }}
                      >
                        <Sparkles size={12} />
                        {t("Improve with AI")}</button>
                      <AIVersionNavigator
                        state={getAiVersionNavigator?.(
                          typeof item.blockId === "string" ? item.blockId : undefined
                        )}
                      />
                    </div>
                  ) : null}
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
            <span style={{ fontSize: "13px", fontWeight: 500 }}>{t("Add entry")}</span>
          </button>
        </div>
      )}
    </div>
  );
}
