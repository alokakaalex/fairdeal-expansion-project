import { CATALOG } from "./config";
import { AssetLine, RuleConfig, WarehouseInputs } from "./types";

const ceil = (n: number) => Math.max(0, Math.ceil(n));

export function computeAssets(
  inputs: WarehouseInputs,
  rules: RuleConfig,
): AssetLine[] {
  return CATALOG.map((item) => {
    const rule = rules[item.id] ?? {};

    if (item.isAreaAllowance) {
      return {
        id: item.id,
        category: item.category,
        name: item.name,
        unit: item.unit,
        quantity: Math.max(0, inputs.totalAreaSqFt),
        formula: `total area (${inputs.totalAreaSqFt} sq ft) × allowance per sq ft`,
        note: item.note,
      };
    }

    if (rule.fixedQty != null) {
      return {
        id: item.id,
        category: item.category,
        name: item.name,
        unit: item.unit,
        quantity: rule.fixedQty,
        formula: `fixed at ${rule.fixedQty}, regardless of area`,
        note: item.note,
      };
    }

    const ratio = rule.qtyPer1000SqFt ?? 0;
    const quantity = ceil((inputs.totalAreaSqFt / 1000) * ratio);
    return {
      id: item.id,
      category: item.category,
      name: item.name,
      unit: item.unit,
      quantity,
      formula: `ceil(${inputs.totalAreaSqFt} sq ft / 1000 × ${ratio} per 1000 sq ft)`,
      note: item.note,
    };
  });
}
