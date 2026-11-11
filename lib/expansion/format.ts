// Display helpers shared by server and client components.

const TIME_ZONE = "Asia/Kolkata";

const inr = new Intl.NumberFormat("en-IN", {
  style: "currency",
  currency: "INR",
  maximumFractionDigits: 0,
});
const num = new Intl.NumberFormat("en-IN", { maximumFractionDigits: 2 });

export function formatINR(value: number | null | undefined): string {
  return value == null ? "—" : inr.format(value);
}

export function formatNumber(value: number | null | undefined, suffix = ""): string {
  return value == null ? "—" : `${num.format(value)}${suffix}`;
}

export function formatMonths(value: number | null | undefined): string {
  if (value == null) return "—";
  const years = value / 12;
  return Number.isInteger(years) && value > 0
    ? `${value} months (${years} yr${years === 1 ? "" : "s"})`
    : `${value} months`;
}

export function formatDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  // Plain calendar dates (handover date) have no time zone to convert.
  if (/^\d{4}-\d{2}-\d{2}$/.test(iso)) {
    const [y, m, d] = iso.split("-").map(Number);
    return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString("en-IN", {
      timeZone: "UTC",
      day: "numeric",
      month: "short",
      year: "numeric",
    });
  }
  return new Date(iso).toLocaleDateString("en-IN", {
    timeZone: TIME_ZONE,
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

export function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleString("en-IN", {
    timeZone: TIME_ZONE,
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

export function propertyCode(id: number): string {
  return `PR-${String(id).padStart(4, "0")}`;
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  if (bytes < 1024 ** 3) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / 1024 ** 3).toFixed(2)} GB`;
}
