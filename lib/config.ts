import { CatalogItem, PriceList, RuleConfig, WarehouseInputs } from "./types";

// Calibrated from three real warehouse electrical fit-outs:
//   Ashok Vihar    — 7000 sq ft — total Rs 264,985 (Bakshi Enterprises)
//   Naraina        — 5400 sq ft — total Rs 159,255 (Bakshi Enterprises)
//   Jahangirpuri   — 5400 sq ft — total Rs 199,500, incl. Rs 30,310 labour (Bakshi Associate)
// qtyPer1000SqFt is the average of each site's (quantity / area-in-1000-sqft),
// using only the sites that itemized a given item (see per-item notes below
// for what's excluded and why). Unit costs are the vendor's price where
// sites agreed, or a quantity-weighted blend where they used different
// sizes/brands.
export const CATALOG: CatalogItem[] = [
  // ---- Lighting ----
  {
    id: "led-bulb-35w",
    category: "Lighting",
    name: "LED bulb, 35W",
    unit: "pc",
    qtyPer1000SqFt: 4.92,
    defaultUnitCost: 450,
    note: "This is a point-bulb lighting scheme. Jahangirpuri used LED tube lights instead (see below) — pick one scheme for your design, don't add both.",
  },
  {
    id: "led-tube-light-22w",
    category: "Lighting",
    name: "LED tube light, 22W",
    unit: "pc",
    qtyPer1000SqFt: 13.15,
    defaultUnitCost: 0,
    note: "⚠️ Alternative to the LED-bulb scheme above, not additional to it — defaulted to Rs 0 so the two schemes don't get double-counted. If your design uses tube lights, set a unit cost here (Rs 235 at the one sample site, Jahangirpuri) and zero out the LED bulb line instead.",
  },
  {
    id: "led-bulb-shade",
    category: "Lighting",
    name: "LED bulb shade",
    unit: "pc",
    qtyPer1000SqFt: 4.78,
    defaultUnitCost: 85,
    note: "Only relevant with the LED-bulb scheme; not itemized at Jahangirpuri (tube-light scheme).",
  },
  {
    id: "bulb-holder",
    category: "Lighting",
    name: "Bulb holder",
    unit: "pc",
    qtyPer1000SqFt: 4.92,
    defaultUnitCost: 45,
    note: "Only relevant with the LED-bulb scheme; not itemized at Jahangirpuri (tube-light scheme).",
  },
  {
    id: "halogen-100w",
    category: "Lighting",
    name: "Halogen lamp, 100W",
    unit: "pc",
    qtyPer1000SqFt: 0.56,
    defaultUnitCost: 1310,
  },

  // ---- Fans ----
  {
    id: "ceiling-fan",
    category: "Fans",
    name: "Ceiling fan (with rod, copper base)",
    unit: "pc",
    qtyPer1000SqFt: 2.13,
    defaultUnitCost: 2874,
  },
  {
    id: "wall-exhaust-fan",
    category: "Fans",
    name: "Wall / exhaust ventilation fan",
    unit: "pc",
    qtyPer1000SqFt: 1.43,
    defaultUnitCost: 6166,
    note: "Unit cost varies a lot by size (12\"–24\") and brand — sample sites paid anywhere from Rs 1,600 to Rs 10,200 per fan.",
  },

  // ---- Wiring & Conduit ----
  {
    id: "copper-wire-2.5mm",
    category: "Wiring & Conduit",
    name: "Copper wire, 2.5mm (roll)",
    unit: "roll",
    qtyPer1000SqFt: 1.09,
    defaultUnitCost: 4750,
  },
  {
    id: "copper-wire-1.5mm",
    category: "Wiring & Conduit",
    name: "Copper wire, 1.5mm (roll)",
    unit: "roll",
    qtyPer1000SqFt: 1.03,
    defaultUnitCost: 2825,
  },
  {
    id: "flex-wire-5qmm",
    category: "Wiring & Conduit",
    name: "Flexible wire, 5qmm (roll)",
    unit: "roll",
    qtyPer1000SqFt: 0.24,
    defaultUnitCost: 4019,
    note: "Not itemized at Jahangirpuri — ratio is from the other two sites only.",
  },
  {
    id: "wire-1mm-bulk",
    category: "Wiring & Conduit",
    name: "Wire, 1mm (bulk roll)",
    unit: "roll",
    qtyPer1000SqFt: 0.14,
    defaultUnitCost: 1995,
    note: "Only one of three sample sites needed this — treat as an optional/site-specific item.",
  },
  {
    id: "pvc-conduit",
    category: "Wiring & Conduit",
    name: "PVC flexible pipe / conduit (mixed sizes)",
    unit: "pc",
    qtyPer1000SqFt: 7.06,
    defaultUnitCost: 115,
    note: "Blended across 20mm/25mm conduit and flexible pipe. Jahangirpuri's quote listed the same item at ~Rs 1,550/unit (30x this) — almost certainly a bulk coil vs. single-length mismatch rather than a real price difference, so it's excluded from this ratio. Confirm the purchase unit with your vendor before trusting this line.",
  },
  {
    id: "pvc-tape",
    category: "Wiring & Conduit",
    name: "PVC insulation tape",
    unit: "pc",
    qtyPer1000SqFt: 1.27,
    defaultUnitCost: 12,
    note: "Not itemized at Jahangirpuri — ratio is from the other two sites only.",
  },

  // ---- Switches, Sockets & Distribution ----
  {
    id: "junction-box",
    category: "Switches, Sockets & Distribution",
    name: "Junction box (PVC)",
    unit: "pc",
    qtyPer1000SqFt: 1.54,
    defaultUnitCost: 15,
    note: "Not itemized at Jahangirpuri — ratio is from the other two sites only.",
  },
  {
    id: "compound-box-16a",
    category: "Switches, Sockets & Distribution",
    name: "Compound box, 16A",
    unit: "pc",
    qtyPer1000SqFt: 1.59,
    defaultUnitCost: 310,
  },
  {
    id: "pvc-box-8x3",
    category: "Switches, Sockets & Distribution",
    name: "PVC box, 8x3",
    unit: "pc",
    qtyPer1000SqFt: 0.71,
    defaultUnitCost: 65,
    note: "Not itemized at Jahangirpuri — ratio is from the other two sites only.",
  },
  {
    id: "switch-16a",
    category: "Switches, Sockets & Distribution",
    name: "Switch, 16A 1-way",
    unit: "pc",
    qtyPer1000SqFt: 3.78,
    defaultUnitCost: 72,
    note: "Counts differed 2x between the two sites that itemized this (2 vs ~5.5 per 1000 sqft); not itemized at Jahangirpuri at all (may be bundled into its ‘sockets’ line). Verify against your actual circuit/point plan.",
  },
  {
    id: "switch-10a",
    category: "Switches, Sockets & Distribution",
    name: "Switch, 10A 1-way",
    unit: "pc",
    qtyPer1000SqFt: 8.13,
    defaultUnitCost: 25,
    note: "⚠️ Low confidence: one sample site used 1 of these, another used 87, for similarly sized spaces; a third didn't itemize this separately at all. Set this manually from your circuit plan.",
  },
  {
    id: "socket-6a",
    category: "Switches, Sockets & Distribution",
    name: "Socket, 6A universal",
    unit: "pc",
    qtyPer1000SqFt: 3.92,
    defaultUnitCost: 80,
    note: "⚠️ Low confidence: counts ranged from 2 to 37 across sample sites. Jahangirpuri also priced its ‘sockets’ at ~Rs 510 each (a heavier-duty spec, not blended into this default) — set both quantity and price manually from your circuit plan and socket spec.",
  },
  {
    id: "mcb-32a",
    category: "Switches, Sockets & Distribution",
    name: "MCB, 32A",
    unit: "pc",
    fixedQty: 2,
    defaultUnitCost: 160,
    note: "Two sites agreed on exactly 2, regardless of area, so it's modeled as a fixed count. Not itemized at Jahangirpuri (likely bundled elsewhere in that vendor's quote, not necessarily absent).",
  },
  {
    id: "mcb-25a",
    category: "Switches, Sockets & Distribution",
    name: "MCB, 25A",
    unit: "pc",
    fixedQty: 2,
    defaultUnitCost: 148,
    note: "Two sites agreed on exactly 2, regardless of area, so it's modeled as a fixed count. Not itemized at Jahangirpuri (likely bundled elsewhere in that vendor's quote, not necessarily absent).",
  },
  {
    id: "surface-gangbox",
    category: "Switches, Sockets & Distribution",
    name: "Surface gangbox",
    unit: "pc",
    fixedQty: 1,
    defaultUnitCost: 60,
    note: "Not itemized at Jahangirpuri (likely bundled elsewhere in that vendor's quote, not necessarily absent).",
  },

  // ---- Site Conditions & Miscellaneous ----
  {
    id: "site-misc-allowance",
    category: "Site Conditions & Miscellaneous",
    name: "Site conditions & hardware allowance",
    unit: "sq ft",
    isAreaAllowance: true,
    defaultUnitCost: 2.56,
    note: "Lump-sum allowance covering screws, cable ties, fasteners, PVC clips, and one-off site costs (scaffolding/ladder rental, welding, etc). Ranged from Rs 2,051 to Rs 3,135 per 1000 sqft across the three sample sites depending on ceiling height and site difficulty — adjust up for high-ceiling or hard-access sites.",
  },

  // ---- Labour & Installation ----
  {
    id: "labour-installation",
    category: "Labour & Installation",
    name: "Installation labour",
    unit: "sq ft",
    isAreaAllowance: true,
    defaultUnitCost: 5.61,
    note: "⚠️ Confirmed: labour is billed separately from materials at all three sites — Ashok Vihar and Naraina's quotes were materials-only by design, not because installation was free. This ratio is still based on a single data point (Jahangirpuri, Rs 30,310 for 5,400 sqft, ~15% of that project's total), so treat it as a rough placeholder. Keep this line if you're estimating the full cost of the rollout; set it to 0 only if you're tracking material and labour costs in separate tools/quotes and don't want this total to include labour.",
  },
];

export const DEFAULT_RULES: RuleConfig = Object.fromEntries(
  CATALOG.map((item) => [
    item.id,
    { fixedQty: item.fixedQty, qtyPer1000SqFt: item.qtyPer1000SqFt },
  ]),
);

export const DEFAULT_PRICE_LIST: PriceList = Object.fromEntries(
  CATALOG.map((item) => [item.id, item.defaultUnitCost]),
);

export const DEFAULT_INPUTS: WarehouseInputs = {
  warehouseName: "",
  totalAreaSqFt: 6000,
};
