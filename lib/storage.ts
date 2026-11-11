import { DEFAULT_INPUTS, DEFAULT_PRICE_LIST, DEFAULT_RULES } from "./config";
import { PriceList, RuleConfig, WarehouseInputs } from "./types";

const KEYS = {
  inputs: "wem.inputs.v2",
  rules: "wem.rules.v2",
  prices: "wem.prices.v2",
} as const;

function load<T>(key: string, fallback: T): T {
  if (typeof window === "undefined") return fallback;
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return fallback;
    return { ...fallback, ...JSON.parse(raw) };
  } catch {
    return fallback;
  }
}

function save<T>(key: string, value: T) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // storage unavailable (e.g. private browsing) — silently skip persistence
  }
}

export const loadInputs = () => load<WarehouseInputs>(KEYS.inputs, DEFAULT_INPUTS);
export const saveInputs = (v: WarehouseInputs) => save(KEYS.inputs, v);

export const loadRules = () => load<RuleConfig>(KEYS.rules, DEFAULT_RULES);
export const saveRules = (v: RuleConfig) => save(KEYS.rules, v);

export const loadPrices = () => load<PriceList>(KEYS.prices, DEFAULT_PRICE_LIST);
export const savePrices = (v: PriceList) => save(KEYS.prices, v);
