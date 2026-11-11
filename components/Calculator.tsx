"use client";

import { useEffect, useMemo, useState } from "react";
import { computeAssets } from "@/lib/calculator";
import { DEFAULT_INPUTS, DEFAULT_PRICE_LIST, DEFAULT_RULES } from "@/lib/config";
import { loadInputs, loadPrices, loadRules, saveInputs, savePrices, saveRules } from "@/lib/storage";
import { PriceList, RuleConfig, WarehouseInputs } from "@/lib/types";
import WarehouseForm from "./WarehouseForm";
import ResultsPanel from "./ResultsPanel";
import FormulaSettings from "./FormulaSettings";

type Tab = "calculator" | "formulas";

interface PersistedState {
  hydrated: boolean;
  inputs: WarehouseInputs;
  rules: RuleConfig;
  prices: PriceList;
}

export default function Calculator() {
  const [tab, setTab] = useState<Tab>("calculator");
  const [state, setState] = useState<PersistedState>({
    hydrated: false,
    inputs: DEFAULT_INPUTS,
    rules: DEFAULT_RULES,
    prices: DEFAULT_PRICE_LIST,
  });
  const { hydrated, inputs, rules, prices } = state;
  const setInputs = (value: WarehouseInputs) =>
    setState((prev) => ({ ...prev, inputs: value }));
  const setRules = (value: RuleConfig) =>
    setState((prev) => ({ ...prev, rules: value }));
  const setPrices = (updater: (prev: PriceList) => PriceList) =>
    setState((prev) => ({ ...prev, prices: updater(prev.prices) }));

  // Saved state lives in localStorage, which isn't available during server
  // rendering, so the initial render always uses defaults and this effect
  // swaps in the real values once mounted on the client. `hydrated` gates
  // the persistence effects below so they don't immediately overwrite
  // storage with the defaults before this load completes.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- bridges external localStorage into React state on mount; runs once.
    setState({
      hydrated: true,
      inputs: loadInputs(),
      rules: loadRules(),
      prices: loadPrices(),
    });
  }, []);

  useEffect(() => {
    if (hydrated) saveInputs(inputs);
  }, [inputs, hydrated]);
  useEffect(() => {
    if (hydrated) saveRules(rules);
  }, [rules, hydrated]);
  useEffect(() => {
    if (hydrated) savePrices(prices);
  }, [prices, hydrated]);

  const lines = useMemo(() => computeAssets(inputs, rules), [inputs, rules]);

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-6 px-6 py-10">
      <header>
        <h1 className="text-2xl font-semibold text-slate-900">
          Warehouse Electrical Asset Model
        </h1>
        <p className="mt-1 text-sm text-slate-500">
          Enter the warehouse area to get an asset count and cost estimate,
          calibrated from three real fit-outs (Ashok Vihar, Naraina &amp;
          Jahangirpuri). Add more of your own project data on the Formulas
          tab to sharpen it further.
        </p>
      </header>

      <nav className="flex gap-2 border-b border-slate-200">
        {(
          [
            ["calculator", "Calculator"],
            ["formulas", "Formulas"],
          ] as [Tab, string][]
        ).map(([key, label]) => (
          <button
            key={key}
            onClick={() => setTab(key)}
            className={`-mb-px border-b-2 px-3 py-2 text-sm font-medium ${
              tab === key
                ? "border-slate-900 text-slate-900"
                : "border-transparent text-slate-500 hover:text-slate-700"
            }`}
          >
            {label}
          </button>
        ))}
      </nav>

      {tab === "calculator" ? (
        <div className="flex flex-col gap-8">
          <section className="rounded border border-slate-200 p-4">
            <h2 className="mb-4 text-sm font-semibold uppercase tracking-wide text-slate-500">
              Warehouse parameters
            </h2>
            <WarehouseForm inputs={inputs} onChange={setInputs} />
          </section>

          <section>
            <h2 className="mb-4 text-sm font-semibold uppercase tracking-wide text-slate-500">
              Asset count & cost estimate
            </h2>
            <ResultsPanel
              lines={lines}
              prices={prices}
              onPriceChange={(id, unitCost) =>
                setPrices((prev) => ({ ...prev, [id]: unitCost }))
              }
            />
          </section>
        </div>
      ) : (
        <FormulaSettings
          rules={rules}
          onChange={setRules}
          onReset={() => setRules(DEFAULT_RULES)}
        />
      )}
    </div>
  );
}
