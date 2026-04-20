import { CalendarDays, X } from "lucide-react";
import { useId, useMemo } from "react";

interface DateInputHelperProps {
  value: string;
  placeholder?: string;
  disabled?: boolean;
  onChange: (nextValue: string) => void;
}

const monthNames = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec"
];

const padMonth = (month: number): string => String(month).padStart(2, "0");

const monthValueToLabel = (value: string): string => {
  const [year, month] = value.split("-");
  const monthIndex = Number(month) - 1;

  if (!year || Number.isNaN(monthIndex) || monthIndex < 0 || monthIndex > 11) {
    return value;
  }

  return `${monthNames[monthIndex]} ${year}`;
};

const currentMonthValue = (): string => {
  const now = new Date();
  return `${now.getFullYear()}-${padMonth(now.getMonth() + 1)}`;
};

export function DateInputHelper({ value, placeholder, disabled = false, onChange }: DateInputHelperProps) {
  const datalistId = useId();

  const suggestionValues = useMemo(() => {
    const now = new Date();
    const suggestions: string[] = [];

    for (let i = 0; i < 18; i += 1) {
      const date = new Date(now.getFullYear(), now.getMonth() - i, 1);
      suggestions.push(`${monthNames[date.getMonth()]} ${date.getFullYear()}`);
    }

    return Array.from(new Set(suggestions));
  }, []);

  return (
    <div className="space-y-1">
      <input
        type="text"
        value={value || ""}
        placeholder={placeholder}
        list={datalistId}
        onChange={(event) => onChange(event.target.value)}
        disabled={disabled}
        className="w-full px-2 py-1.5 rounded border"
        style={{
          fontSize: "13px",
          borderColor: "var(--color-border-secondary)",
          opacity: disabled ? 0.6 : 1
        }}
      />

      <datalist id={datalistId}>
        {suggestionValues.map((suggestion) => (
          <option key={suggestion} value={suggestion} />
        ))}
      </datalist>

      <div className="flex items-center gap-2">
        <label
          className="inline-flex items-center gap-1 px-2 py-1 rounded border"
          style={{
            fontSize: "11px",
            borderColor: "var(--color-border-secondary)",
            color: "var(--color-text-secondary)",
            opacity: disabled ? 0.6 : 1,
            cursor: disabled ? "not-allowed" : "pointer"
          }}
        >
          <CalendarDays size={11} />
          <span>Pick month</span>
          <input
            type="month"
            value=""
            disabled={disabled}
            onChange={(event) => {
              if (!event.target.value) {
                return;
              }

              onChange(monthValueToLabel(event.target.value));
              event.currentTarget.value = "";
            }}
            className="hidden"
          />
        </label>

        <button
          type="button"
          disabled={disabled}
          onClick={() => onChange(monthValueToLabel(currentMonthValue()))}
          className="px-2 py-1 rounded border"
          style={{
            fontSize: "11px",
            borderColor: "var(--color-border-secondary)",
            color: "var(--color-text-secondary)",
            opacity: disabled ? 0.6 : 1
          }}
        >
          This month
        </button>

        <button
          type="button"
          disabled={disabled || !value}
          onClick={() => onChange("")}
          className="px-2 py-1 rounded border inline-flex items-center gap-1"
          style={{
            fontSize: "11px",
            borderColor: "var(--color-border-secondary)",
            color: "var(--color-text-secondary)",
            opacity: disabled || !value ? 0.6 : 1
          }}
        >
          <X size={11} />
          Clear
        </button>
      </div>
    </div>
  );
}
