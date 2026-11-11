"use client";

import { WarehouseInputs } from "@/lib/types";
import NumberField from "./NumberField";

interface Props {
  inputs: WarehouseInputs;
  onChange: (inputs: WarehouseInputs) => void;
}

export default function WarehouseForm({ inputs, onChange }: Props) {
  const set = <K extends keyof WarehouseInputs>(key: K, value: WarehouseInputs[K]) =>
    onChange({ ...inputs, [key]: value });

  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
      <label className="flex flex-col gap-1 text-sm">
        <span className="text-slate-600">
          Warehouse name (optional)
        </span>
        <input
          type="text"
          className="rounded border border-slate-300 bg-white px-2 py-1.5 text-slate-900 focus:border-slate-500 focus:outline-none"
          value={inputs.warehouseName}
          placeholder="e.g. Sector 12 warehouse"
          onChange={(e) => set("warehouseName", e.target.value)}
        />
      </label>
      <NumberField
        label="Total warehouse area"
        value={inputs.totalAreaSqFt}
        onChange={(v) => set("totalAreaSqFt", v)}
        suffix="sq ft"
      />
    </div>
  );
}
