import { CalendarDays, ChevronDown } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Calendar } from "./ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "./ui/popover";

interface DateInputHelperProps {
  value: string;
  placeholder?: string;
  disabled?: boolean;
  onChange: (nextValue: string) => void;
}

interface DateParts {
  day: number | null;
  month: number | null;
  year: number | null;
}

const monthNamesShort = [
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

const monthNamesLong = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December"
];

const monthAliasToIndex = new Map<string, number>(
  monthNamesLong.flatMap((month, index) => [
    [month.toLowerCase(), index + 1],
    [monthNamesShort[index].toLowerCase(), index + 1]
  ])
);

const clampDay = (day: number | null, month: number | null, year: number | null): number | null => {
  if (!day) {
    return null;
  }

  if (!month) {
    return Math.min(Math.max(day, 1), 31);
  }

  const normalizedYear = year || new Date().getFullYear();
  const maxDay = new Date(normalizedYear, month, 0).getDate();
  return Math.min(Math.max(day, 1), maxDay);
};

const toDisplayValue = (parts: DateParts): string => {
  const segments: string[] = [];

  if (parts.day) {
    segments.push(String(parts.day));
  }

  if (parts.month) {
    segments.push(monthNamesShort[parts.month - 1]);
  }

  if (parts.year) {
    segments.push(String(parts.year));
  }

  return segments.join(" ");
};

const parseDateParts = (rawValue: string): DateParts => {
  const value = rawValue.trim();
  if (!value) {
    return { day: null, month: null, year: null };
  }

  const isoMatch = value.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (isoMatch) {
    return {
      year: Number(isoMatch[1]),
      month: Number(isoMatch[2]),
      day: Number(isoMatch[3])
    };
  }

  const compactMatch = value.match(/^(\d{1,2})\s+([A-Za-z]+)\s+(\d{4})$/);
  if (compactMatch) {
    const monthIndex = monthAliasToIndex.get(compactMatch[2].toLowerCase());
    if (monthIndex) {
      return {
        day: Number(compactMatch[1]),
        month: monthIndex,
        year: Number(compactMatch[3])
      };
    }
  }

  const longMatch = value.match(/^([A-Za-z]+)\s+(\d{1,2}),?\s+(\d{4})$/);
  if (longMatch) {
    const monthIndex = monthAliasToIndex.get(longMatch[1].toLowerCase());
    if (monthIndex) {
      return {
        day: Number(longMatch[2]),
        month: monthIndex,
        year: Number(longMatch[3])
      };
    }
  }

  const monthYearMatch = value.match(/^([A-Za-z]+)\s+(\d{4})$/);
  if (monthYearMatch) {
    const monthIndex = monthAliasToIndex.get(monthYearMatch[1].toLowerCase());
    if (monthIndex) {
      return {
        day: null,
        month: monthIndex,
        year: Number(monthYearMatch[2])
      };
    }
  }

  const yearMatch = value.match(/^(\d{4})$/);
  if (yearMatch) {
    return { day: null, month: null, year: Number(yearMatch[1]) };
  }

  return { day: null, month: null, year: null };
};

const monthFromParts = (parts: DateParts): Date => {
  const now = new Date();

  return new Date(
    parts.year || now.getFullYear(),
    parts.month ? parts.month - 1 : now.getMonth(),
    1
  );
};

export function DateInputHelper({ value, placeholder, disabled = false, onChange }: DateInputHelperProps) {
  const initialParts = useMemo(() => parseDateParts(value || ""), [value]);
  const [open, setOpen] = useState(false);
  const [parts, setParts] = useState<DateParts>(initialParts);
  const [viewMonth, setViewMonth] = useState<Date>(monthFromParts(initialParts));

  useEffect(() => {
    if (!open) {
      const nextParts = parseDateParts(value || "");
      setParts(nextParts);
      setViewMonth(monthFromParts(nextParts));
    }
  }, [open, value]);

  const selectedDate = useMemo(() => {
    if (!parts.day || !parts.month || !parts.year) {
      return undefined;
    }

    return new Date(parts.year, parts.month - 1, parts.day);
  }, [parts.day, parts.month, parts.year]);

  const updateParts = (nextParts: DateParts) => {
    const normalized: DateParts = {
      day: clampDay(nextParts.day, nextParts.month, nextParts.year),
      month: nextParts.month,
      year: nextParts.year
    };

    setParts(normalized);
    onChange(toDisplayValue(normalized));
  };

  const yearOptions = useMemo(() => {
    const currentYear = new Date().getFullYear();
    const startYear = currentYear - 70;
    const endYear = currentYear + 20;
    const years: number[] = [];

    for (let year = endYear; year >= startYear; year -= 1) {
      years.push(year);
    }

    return years;
  }, []);

  const dayOptions = useMemo(() => {
    const maxDay = parts.month ? new Date(parts.year || new Date().getFullYear(), parts.month, 0).getDate() : 31;
    return Array.from({ length: maxDay }, (_, index) => index + 1);
  }, [parts.month, parts.year]);

  return (
    <Popover open={open && !disabled} onOpenChange={(nextOpen) => setOpen(nextOpen)}>
      <PopoverTrigger asChild>
        <button
          type="button"
          disabled={disabled}
          className="w-full px-2 py-1.5 rounded border flex items-center justify-between gap-2 text-left"
          style={{
            fontSize: "13px",
            borderColor: "var(--color-border-secondary)",
            opacity: disabled ? 0.6 : 1
          }}
        >
          <span
            className="truncate"
            style={{ color: value ? "var(--color-text-primary)" : "var(--color-text-secondary)" }}
          >
            {value || placeholder || "Select date"}
          </span>
          <span className="flex items-center gap-1" style={{ color: "var(--color-text-secondary)" }}>
            <CalendarDays size={13} />
            <ChevronDown size={12} />
          </span>
        </button>
      </PopoverTrigger>

      <PopoverContent
        align="start"
        sideOffset={6}
        className="w-[292px] p-3"
        style={{
          borderColor: "var(--color-border-tertiary)",
          background: "var(--color-background-primary)"
        }}
      >
        <div className="space-y-3">
          <div className="grid grid-cols-3 gap-2">
            <select
              value={parts.day ?? ""}
              onChange={(event) =>
                updateParts({
                  ...parts,
                  day: event.target.value ? Number(event.target.value) : null
                })
              }
              className="w-full px-2 py-1.5 rounded border"
              style={{
                fontSize: "12px",
                borderColor: "var(--color-border-secondary)",
                color: "var(--color-text-primary)",
                background: "var(--color-background-primary)"
              }}
            >
              <option value="">Day</option>
              {dayOptions.map((day) => (
                <option key={day} value={day}>
                  {day}
                </option>
              ))}
            </select>

            <select
              value={parts.month ?? ""}
              onChange={(event) => {
                const month = event.target.value ? Number(event.target.value) : null;
                const nextParts = { ...parts, month };
                updateParts(nextParts);
                setViewMonth(monthFromParts(nextParts));
              }}
              className="w-full px-2 py-1.5 rounded border"
              style={{
                fontSize: "12px",
                borderColor: "var(--color-border-secondary)",
                color: "var(--color-text-primary)",
                background: "var(--color-background-primary)"
              }}
            >
              <option value="">Month</option>
              {monthNamesLong.map((month, index) => (
                <option key={month} value={index + 1}>
                  {month}
                </option>
              ))}
            </select>

            <select
              value={parts.year ?? ""}
              onChange={(event) => {
                const year = event.target.value ? Number(event.target.value) : null;
                const nextParts = { ...parts, year };
                updateParts(nextParts);
                setViewMonth(monthFromParts(nextParts));
              }}
              className="w-full px-2 py-1.5 rounded border"
              style={{
                fontSize: "12px",
                borderColor: "var(--color-border-secondary)",
                color: "var(--color-text-primary)",
                background: "var(--color-background-primary)"
              }}
            >
              <option value="">Year</option>
              {yearOptions.map((year) => (
                <option key={year} value={year}>
                  {year}
                </option>
              ))}
            </select>
          </div>

          <div className="rounded border" style={{ borderColor: "var(--color-border-tertiary)" }}>
            <Calendar
              mode="single"
              month={viewMonth}
              onMonthChange={setViewMonth}
              selected={selectedDate}
              onSelect={(selected) => {
                if (!selected) {
                  return;
                }

                updateParts({
                  day: selected.getDate(),
                  month: selected.getMonth() + 1,
                  year: selected.getFullYear()
                });
                setViewMonth(new Date(selected.getFullYear(), selected.getMonth(), 1));
              }}
            />
          </div>

          <div className="flex items-center justify-between">
            <button
              type="button"
              onClick={() => updateParts({ day: null, month: null, year: null })}
              className="px-2 py-1 rounded border"
              style={{
                fontSize: "11px",
                borderColor: "var(--color-border-secondary)",
                color: "var(--color-text-secondary)"
              }}
            >
              Clear
            </button>
            <button
              type="button"
              onClick={() => {
                const today = new Date();
                updateParts({
                  day: today.getDate(),
                  month: today.getMonth() + 1,
                  year: today.getFullYear()
                });
                setViewMonth(new Date(today.getFullYear(), today.getMonth(), 1));
              }}
              className="px-2 py-1 rounded border"
              style={{
                fontSize: "11px",
                borderColor: "var(--color-border-secondary)",
                color: "var(--color-text-secondary)"
              }}
            >
              Today
            </button>
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}
