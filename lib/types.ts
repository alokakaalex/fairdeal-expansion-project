export interface WarehouseInputs {
  warehouseName: string;
  totalAreaSqFt: number;
}

export type AssetCategory =
  | "Lighting"
  | "Fans"
  | "Wiring & Conduit"
  | "Switches, Sockets & Distribution"
  | "Site Conditions & Miscellaneous"
  | "Labour & Installation";

export interface CatalogItem {
  id: string;
  category: AssetCategory;
  name: string;
  unit: string;
  /** Quantity per 1000 sq ft of warehouse area, calibrated from real sites. */
  qtyPer1000SqFt?: number;
  /** Used instead of qtyPer1000SqFt for items that didn't scale with area
   * in the calibration data (e.g. a warehouse only ever needs ~2 main MCBs
   * regardless of size). */
  fixedQty?: number;
  /** True for the single "site conditions" allowance line, whose quantity
   * is the raw area (sq ft) rather than a per-1000-sqft count. */
  isAreaAllowance?: boolean;
  defaultUnitCost: number;
  /** Shown in the UI when the two calibration sites disagreed sharply on
   * this item, so the count shouldn't be trusted at face value. */
  note?: string;
}

export interface AssetLine {
  id: string;
  category: AssetCategory;
  name: string;
  unit: string;
  quantity: number;
  formula: string;
  note?: string;
}

export interface AssetResult extends AssetLine {
  unitCost: number;
  totalCost: number;
}

export type RuleEntry = { fixedQty?: number; qtyPer1000SqFt?: number };
export type RuleConfig = Record<string, RuleEntry>;
export type PriceList = Record<string, number>;
