import type { Metadata } from "next";
import { SystemPanel } from "@/components/portal/SystemForms";
import { Alert, Card, PageHeader } from "@/components/portal/ui";
import { formatBytes, formatDateTime } from "@/lib/expansion/format";
import { backupIsStale, listBackups, storageStatus } from "@/lib/server/backups";
import { config } from "@/lib/server/config";
import { emailEnabled } from "@/lib/server/mailer";
import { requireRole } from "@/lib/server/session";
import { getSettings } from "@/lib/server/settings";
import { salesApproverCount } from "@/lib/server/users";

export const metadata: Metadata = { title: "Data & backups" };

function Fact({ label, value, ok }: { label: string; value: string; ok: boolean }) {
  return (
    <div className="flex items-start gap-3">
      <span className={`mt-1 h-2.5 w-2.5 shrink-0 rounded-full ${ok ? "bg-emerald-500" : "bg-amber-400"}`} aria-hidden />
      <div>
        <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">{label}</div>
        <div className="text-sm text-navy-900">{value}</div>
      </div>
    </div>
  );
}

export default async function SystemPage() {
  await requireRole("admin");
  const [s, backups, settings, stale, approvers] = await Promise.all([storageStatus(), listBackups(30), getSettings(), backupIsStale(), salesApproverCount()]);
  const last = backups[0];
  const durableDb = s.database === "postgres";
  const durableFiles = s.storage !== "local";

  return (
    <>
      <PageHeader eyebrow="Access Manager" title="Data & backups" subtitle="Where every record and document is kept, and how it's protected." />

      {config.demoMode ? (
        <Alert tone="warning">This is the demo environment: data lives in a temporary embedded database and resets from time to time.</Alert>
      ) : !durableDb || !durableFiles ? (
        <Alert tone="warning">
          <strong>Not fully protected yet.</strong>{" "}
          {!durableDb ? "Records are in the embedded database on this server — set DATABASE_URL to a managed Postgres (Neon, Supabase…). " : ""}
          {!durableFiles ? "Files are on this server's disk — set the Supabase (or S3_*) variables to keep them in a private cloud bucket. " : ""}
          See the README → Going live.
        </Alert>
      ) : null}
      {stale && !config.demoMode ? <Alert tone="error">No successful backup recently. Check the server logs, or back up now.</Alert> : null}

      <div className="grid gap-6 lg:grid-cols-3">
        <Card title="Where data lives">
          <div className="space-y-4">
            <Fact label="Records" ok={durableDb} value={durableDb ? "Managed PostgreSQL (DATABASE_URL)" : "Embedded PostgreSQL on this server"} />
            <Fact label="Photos, videos & documents" ok={durableFiles} value={durableFiles ? (s.storage === "s3" ? `Cloud bucket ${s.bucket}` : s.bucket!) : "This server's disk"} />
            <Fact label="Sign-in" ok value={s.authProvider === "supabase" ? "Supabase Auth (passwords, email links" + (config.supabase?.google ? ", Google" : "") + ")" : "Built-in accounts"} />
            <Fact label="Email" ok={emailEnabled()} value={emailEnabled() ? "SMTP configured — invites, alerts and LOIs are emailed" : "Not configured — in-app only"} />
          </div>
        </Card>
        <Card title="Stored files">
          <p className="text-3xl font-semibold text-navy-950" style={{ fontFamily: "var(--font-display)" }}>
            {s.files}
          </p>
          <p className="text-sm text-slate-500">
            {formatBytes(s.bytes)} in total · {s.maxFileBytes ? `up to ${formatBytes(s.maxFileBytes)} per file` : "no size limit per file"} · never deleted
          </p>
        </Card>
        <Card title="Backups">
          <p className="text-sm text-navy-900">
            A snapshot of every table, every {s.intervalHours} hours on a server (daily on Vercel), saved to {durableFiles ? "the bucket" : s.backupsDir}.
          </p>
          <p className="mt-2 text-sm text-slate-500">Last: {last ? `${formatDateTime(last.createdAt)}${last.error ? " (failed)" : ""}` : "never"}</p>
        </Card>
      </div>

      <SystemPanel settings={settings} approvers={approvers} />

      <Card title="Recent backups">
        {backups.length === 0 ? (
          <p className="text-sm text-slate-500">No backups yet.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead>
                <tr className="text-left text-[0.7rem] uppercase tracking-wider text-slate-500">
                  <th className="py-2 pr-4">When</th>
                  <th className="py-2 pr-4">File</th>
                  <th className="py-2 pr-4">Size</th>
                  <th className="py-2 pr-4">Saved to</th>
                  <th className="py-2 pr-4">Trigger</th>
                  <th className="py-2">Status</th>
                </tr>
              </thead>
              <tbody>
                {backups.map((b) => (
                  <tr key={b.id} className="border-t border-slate-100">
                    <td className="whitespace-nowrap py-2 pr-4">{formatDateTime(b.createdAt)}</td>
                    <td className="py-2 pr-4 font-mono text-xs">{b.fileName}</td>
                    <td className="py-2 pr-4">{formatBytes(b.sizeBytes)}</td>
                    <td className="py-2 pr-4">{b.location}</td>
                    <td className="py-2 pr-4">{b.trigger}</td>
                    <td className={`py-2 ${b.error ? "text-rose-600" : "text-emerald-700"}`}>{b.error ?? "OK"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </>
  );
}
