"use client";

import { CATALOG, DEFAULT_RULES } from "@/lib/config";
import { AssetCategory, RuleConfig } from "@/lib/types";
import NumberField from "./NumberField";

interface Props {
  rules: RuleConfig;
  onChange: (rules: RuleConfig) => void;
  onReset: () => void;
}

const CATEGORY_ORDER: AssetCategory[] = [
  "Lighting",
  "Fans",
  "Wiring & Conduit",
  "Switches, Sockets & Distribution",
  "Site Conditions & Miscellaneous",
  "Labour & Installation",
];

export default function FormulaSettings({ rules, onChange, onReset }: Props) {
  const setRatio = (id: string, qtyPer1000SqFt: number) =>
    onChange({ ...rules, [id]: { ...rules[id], qtyPer1000SqFt } });
  const setFixed = (id: string, fixedQty: number) =>
    onChange({ ...rules, [id]: { ...rules[id], fixedQty } });

  return (
    <div className="flex flex-col gap-8">
      <div className="flex items-start justify-between gap-4 rounded border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
        <p>
          These ratios are calibrated from three real warehouse fit-outs
          (7,000 sq ft and two at 5,400 sq ft). Add data from more of your own
          sites and adjust these to tighten the model, especially for items
          flagged below as low-confidence.
        </p>
        <button
          onClick={onReset}
          className="whitespace-nowrap rounded border border-amber-400 px-2 py-1 text-xs font-medium hover:bg-amber-100"
        >
          Reset to defaults
        </button>
      </div>

      {CATEGORY_ORDER.map((category) => {
        const items = CATALOG.filter((i) => i.category === category);
        if (items.length === 0) return null;
        return (
          <div key={category}>
            <h3 className="mb-3 text-sm font-semibold text-slate-900">
              {category}
            </h3>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {items.map((item) => {
                const rule = rules[item.id] ?? {};
                const isFixed = item.fixedQty != null;
                const isAllowance = item.isAreaAllowance;
                return (
                  <div key={item.id} className="flex flex-col gap-1">
                    {isAllowance ? (
                      <p className="text-sm text-slate-500">
                        {item.name}: priced per sq ft directly (see Calculator
                        tab unit cost).
                      </p>
                    ) : isFixed ? (
                      <NumberField
                        label={`${item.name} — fixed quantity`}
                        value={rule.fixedQty ?? DEFAULT_RULES[item.id]?.fixedQty ?? 0}
                        onChange={(v) => setFixed(item.id, v)}
                        suffix={item.unit}
                      />
                    ) : (
                      <NumberField
                        label={item.name}
                        value={
                          rule.qtyPer1000SqFt ??
                          DEFAULT_RULES[item.id]?.qtyPer1000SqFt ??
                          0
                        }
                        onChange={(v) => setRatio(item.id, v)}
                        suffix={`${item.unit} / 1000 sq ft`}
                        step={0.01}
                      />
                    )}
                    {item.note ? (
                      <p className="text-xs text-amber-700">
                        {item.note}
                      </p>
                    ) : null}
                  </div>
                );
              })}
            </div>
          </div>
        );
      })}
    </div>
  );
}
