"use client";

import { AssetCategory, AssetLine, PriceList } from "@/lib/types";

interface Props {
  lines: AssetLine[];
  prices: PriceList;
  onPriceChange: (id: string, unitCost: number) => void;
}

const CATEGORY_ORDER: AssetCategory[] = [
  "Lighting",
  "Fans",
  "Wiring & Conduit",
  "Switches, Sockets & Distribution",
  "Site Conditions & Miscellaneous",
  "Labour & Installation",
];

const currency = new Intl.NumberFormat("en-IN", {
  style: "currency",
  currency: "INR",
  maximumFractionDigits: 0,
});

export default function ResultsPanel({ lines, prices, onPriceChange }: Props) {
  const grandTotal = lines.reduce(
    (sum, line) => sum + line.quantity * (prices[line.id] ?? 0),
    0,
  );

  return (
    <div className="flex flex-col gap-8">
      {CATEGORY_ORDER.map((category) => {
        const items = lines.filter((l) => l.category === category);
        if (items.length === 0) return null;
        const categoryTotal = items.reduce(
          (sum, line) => sum + line.quantity * (prices[line.id] ?? 0),
          0,
        );
        return (
          <div key={category}>
            <div className="mb-2 flex items-baseline justify-between">
              <h3 className="text-base font-semibold text-slate-900">
                {category}
              </h3>
              <span className="text-sm text-slate-500">
                {currency.format(categoryTotal)}
              </span>
            </div>
            <div className="overflow-x-auto rounded border border-slate-200">
              <table className="w-full text-left text-sm">
                <thead className="bg-slate-50 text-xs uppercase text-slate-500">
                  <tr>
                    <th className="px-3 py-2">Asset</th>
                    <th className="px-3 py-2">Qty</th>
                    <th className="px-3 py-2">Unit</th>
                    <th className="px-3 py-2">Unit cost (Rs)</th>
                    <th className="px-3 py-2">Total</th>
                    <th className="px-3 py-2">How it&apos;s derived</th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((line) => {
                    const unitCost = prices[line.id] ?? 0;
                    return (
                      <tr
                        key={line.id}
                        className="border-t border-slate-100"
                      >
                        <td className="px-3 py-2 font-medium text-slate-800">
                          {line.name}
                          {line.note ? (
                            <div className="mt-0.5 max-w-xs text-xs font-normal text-amber-700">
                              {line.note}
                            </div>
                          ) : null}
                        </td>
                        <td className="px-3 py-2 tabular-nums">{line.quantity}</td>
                        <td className="px-3 py-2 text-slate-500">{line.unit}</td>
                        <td className="px-3 py-2">
                          <input
                            type="number"
                            className="w-24 rounded border border-slate-300 bg-white px-1.5 py-1 tabular-nums"
                            value={unitCost}
                            min={0}
                            onChange={(e) =>
                              onPriceChange(line.id, e.target.valueAsNumber || 0)
                            }
                          />
                        </td>
                        <td className="px-3 py-2 tabular-nums">
                          {currency.format(line.quantity * unitCost)}
                        </td>
                        <td className="px-3 py-2 text-xs text-slate-500">
                          {line.formula}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        );
      })}

      <div className="flex items-center justify-between rounded border border-slate-900 bg-slate-900 px-4 py-3 text-white">
        <span className="text-sm font-medium">Estimated total project cost</span>
        <span className="text-lg font-semibold tabular-nums">
          {currency.format(grandTotal)}
        </span>
      </div>
      <p className="text-xs text-slate-500">
        Counts and prices are calibrated from three real warehouse fit-outs
        (Ashok Vihar &amp; Naraina using an LED-bulb lighting scheme,
        Jahangirpuri using LED tube lights). Items marked with an amber note
        had inconsistent counts between sites, weren&apos;t itemized by every
        vendor, or are single-site data &mdash; double-check those manually.
        Edit ratios on the Formulas tab as you add more real project data.
      </p>
    </div>
  );
}
