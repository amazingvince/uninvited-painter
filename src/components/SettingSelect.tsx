import { useId } from "react";
import type { SettingOption } from "../lib/settingsOptions";

export function SettingSelect<T extends string | number>({
  label,
  value,
  options,
  onChange,
  disabled = false,
}: {
  label: string;
  value: T;
  options: readonly SettingOption<T>[];
  onChange: (value: T) => void;
  disabled?: boolean;
}) {
  const id = useId();
  return (
    <label className="setting-select" htmlFor={id}>
      <span className="kicker">{label}</span>
      <select
        id={id}
        value={String(value)}
        disabled={disabled}
        onChange={(event) => {
          const next = options.find(
            (option) => String(option.value) === event.target.value,
          );
          if (next) onChange(next.value);
        }}
      >
        {options.map((option) => (
          <option key={String(option.value)} value={String(option.value)}>
            {option.label}
          </option>
        ))}
      </select>
    </label>
  );
}
