"use client";

interface NumberFieldProps {
  label: string;
  value: number;
  onChange: (value: number) => void;
  suffix?: string;
  min?: number;
  step?: number;
}

export default function NumberField({
  label,
  value,
  onChange,
  suffix,
  min = 0,
  step = 1,
}: NumberFieldProps) {
  return (
    <label className="flex flex-col gap-1 text-sm">
      <span className="text-slate-600">{label}</span>
      <div className="flex items-center gap-2">
        <input
          type="number"
          className="w-full rounded border border-slate-300 bg-white px-2 py-1.5 text-slate-900 focus:border-slate-500 focus:outline-none"
          value={Number.isFinite(value) ? value : 0}
          min={min}
          step={step}
          onChange={(e) => onChange(e.target.valueAsNumber || 0)}
        />
        {suffix ? (
          <span className="whitespace-nowrap text-xs text-slate-500">{suffix}</span>
        ) : null}
      </div>
    </label>
  );
}
