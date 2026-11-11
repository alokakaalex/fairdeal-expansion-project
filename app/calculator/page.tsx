import type { Metadata } from "next";
import Calculator from "@/components/Calculator";

export const metadata: Metadata = {
  title: "Warehouse Electrical Asset Model",
  description: "Estimate electrical asset counts and costs for a new warehouse rollout.",
};

export default function CalculatorPage() {
  return <Calculator />;
}
