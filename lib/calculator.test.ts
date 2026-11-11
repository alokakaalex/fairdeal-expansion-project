import { describe, expect, it } from "vitest";
import { computeAssets } from "./calculator";
import { CATALOG, DEFAULT_PRICE_LIST, DEFAULT_RULES } from "./config";
import { PriceList, WarehouseInputs } from "./types";

describe("computeAssets", () => {
  it("produces one line per catalog item with non-negative quantities", () => {
    const inputs: WarehouseInputs = { warehouseName: "", totalAreaSqFt: 6000 };
    const lines = computeAssets(inputs, DEFAULT_RULES);
    expect(lines).toHaveLength(CATALOG.length);
    for (const line of lines) {
      expect(line.quantity).toBeGreaterThanOrEqual(0);
      expect(Number.isFinite(line.quantity)).toBe(true);
    }
  });

  it("scales per-1000-sqft items with area", () => {
    const small = computeAssets(
      { warehouseName: "", totalAreaSqFt: 5000 },
      DEFAULT_RULES,
    );
    const large = computeAssets(
      { warehouseName: "", totalAreaSqFt: 10000 },
      DEFAULT_RULES,
    );
    const getQty = (lines: typeof small, id: string) =>
      lines.find((l) => l.id === id)!.quantity;
    expect(getQty(large, "led-bulb-35w")).toBeGreaterThan(
      getQty(small, "led-bulb-35w"),
    );
  });

  it("keeps fixed-quantity items constant regardless of area", () => {
    const small = computeAssets(
      { warehouseName: "", totalAreaSqFt: 1000 },
      DEFAULT_RULES,
    );
    const large = computeAssets(
      { warehouseName: "", totalAreaSqFt: 50000 },
      DEFAULT_RULES,
    );
    expect(small.find((l) => l.id === "mcb-32a")!.quantity).toBe(2);
    expect(large.find((l) => l.id === "mcb-32a")!.quantity).toBe(2);
    expect(small.find((l) => l.id === "surface-gangbox")!.quantity).toBe(1);
  });

  it("sets area-allowance items' quantity equal to the raw area", () => {
    const lines = computeAssets(
      { warehouseName: "", totalAreaSqFt: 7000 },
      DEFAULT_RULES,
    );
    expect(lines.find((l) => l.id === "site-misc-allowance")!.quantity).toBe(
      7000,
    );
    expect(lines.find((l) => l.id === "labour-installation")!.quantity).toBe(
      7000,
    );
  });

  it("defaults the alternative LED tube-light scheme to zero cost so it doesn't double-count against the LED-bulb scheme", () => {
    expect(DEFAULT_PRICE_LIST["led-tube-light-22w"]).toBe(0);
    expect(DEFAULT_PRICE_LIST["led-bulb-35w"]).toBeGreaterThan(0);
  });

  it("respects a custom rule override for a single item", () => {
    const customRules = {
      ...DEFAULT_RULES,
      "ceiling-fan": { qtyPer1000SqFt: 10 },
    };
    const lines = computeAssets(
      { warehouseName: "", totalAreaSqFt: 1000 },
      customRules,
    );
    expect(lines.find((l) => l.id === "ceiling-fan")!.quantity).toBe(10);
  });

  // Ashok Vihar and Naraina's quotes were materials-only (no labour line),
  // so the labour-installation allowance is excluded from comparisons
  // against their actual totals.
  const estimateMaterialsTotal = (areaSqFt: number) => {
    const lines = computeAssets({ warehouseName: "", totalAreaSqFt: areaSqFt }, DEFAULT_RULES);
    return lines
      .filter((l) => l.id !== "labour-installation")
      .reduce((sum, l) => sum + l.quantity * (DEFAULT_PRICE_LIST[l.id] ?? 0), 0);
  };

  it("is unbiased in aggregate across the two bulb-scheme calibration sites", () => {
    // Ashok Vihar: 7000 sqft, actual total Rs 264,985
    // Naraina: 5400 sqft, actual total Rs 159,255
    // Both used the LED-bulb lighting scheme, which is what DEFAULT_PRICE_LIST
    // costs by default (the tube-light alternative defaults to Rs 0). Because
    // ratios are averaged across sites with different per-sqft intensities,
    // any one site's estimate can be off by 15-30%, but the combined
    // estimate stays close to the combined actual.
    const estimated = estimateMaterialsTotal(7000) + estimateMaterialsTotal(5400);
    const actual = 264985 + 159255;
    expect(Math.abs(estimated - actual) / actual).toBeLessThan(0.1);
  });

  it("stays within a loose bound per individual calibration site", () => {
    expect(Math.abs(estimateMaterialsTotal(7000) - 264985) / 264985).toBeLessThan(0.3);
    expect(Math.abs(estimateMaterialsTotal(5400) - 159255) / 159255).toBeLessThan(0.3);
  });

  it("stays within a loose bound for the tube-light calibration site (Jahangirpuri) once its scheme and labour are priced in", () => {
    // Jahangirpuri (5400 sqft) used the tube-light scheme and separately
    // itemized Rs 30,310 of installation labour; total incl. labour was
    // Rs 199,500. Swap the lighting scheme's pricing to check its own ratios,
    // since the default pricing favors the bulb scheme.
    const lines = computeAssets({ warehouseName: "", totalAreaSqFt: 5400 }, DEFAULT_RULES);
    const prices: PriceList = {
      ...DEFAULT_PRICE_LIST,
      "led-bulb-35w": 0,
      "led-bulb-shade": 0,
      "bulb-holder": 0,
      "led-tube-light-22w": 235,
    };
    const estimated = lines.reduce((sum, l) => sum + l.quantity * (prices[l.id] ?? 0), 0);
    expect(Math.abs(estimated - 199500) / 199500).toBeLessThan(0.3);
  });
});
