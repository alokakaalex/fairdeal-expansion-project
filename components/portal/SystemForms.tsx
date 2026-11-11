"use client";

import { useActionState } from "react";
import { backupNow, saveSettings, verifyStorage, type SystemState } from "@/app/actions/admin";
import type { Settings } from "@/lib/server/settings";
import { Alert, buttonClass, Card, inputClass } from "./ui";

function Result({ state }: { state: SystemState }) {
  if (state.error) return <Alert tone="error">{state.error}</Alert>;
  if (state.success) return <Alert tone="success">{state.success}</Alert>;
  return null;
}

export function SystemPanel({ settings, approvers }: { settings: Settings; approvers: number }) {
  const [saved, save, saving] = useActionState<SystemState, FormData>(saveSettings, {});
  const [backup, runBackup, backingUp] = useActionState<SystemState>(backupNow, {});
  const [verified, verify, verifying] = useActionState<SystemState>(verifyStorage, {});
  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <Card title="Sales team voting">
        <form action={save} className="space-y-3">
          <Result state={saved} />
          <p className="text-sm text-slate-500">
            Only sales members with approval access vote (set per person on Access &amp; roles; currently {approvers}). A
            property moves to Ops once this many approve, or is rejected once this many reject — whichever comes first.
          </p>
          {settings.salesApprovalsRequired > approvers ? (
            <Alert tone="warning">
              {approvers === 0 ? "No sales member has approval access yet" : `Only ${approvers} sales member(s) can approve`}, so properties
              can&apos;t pass Sales review. Give more people approval access or lower the number.
            </Alert>
          ) : null}
          <div className="grid grid-cols-2 gap-3">
            <label className="flex flex-col gap-1 text-sm">
              <span className="font-medium">Approvals needed</span>
              <input name="salesApprovalsRequired" type="number" min={1} max={50} defaultValue={settings.salesApprovalsRequired} className={inputClass} />
            </label>
            <label className="flex flex-col gap-1 text-sm">
              <span className="font-medium">Rejections needed</span>
              <input name="salesRejectionsRequired" type="number" min={1} max={50} defaultValue={settings.salesRejectionsRequired} className={inputClass} />
            </label>
          </div>
          <button type="submit" disabled={saving} className={buttonClass.primary}>
            Save
          </button>
        </form>
      </Card>
      <Card title="Maintenance">
        <div className="space-y-3">
          <Result state={backup} />
          <Result state={verified} />
          <div className="flex flex-wrap gap-3">
            <form action={runBackup}>
              <button type="submit" disabled={backingUp} className={buttonClass.primary}>
                {backingUp ? "Backing up…" : "Back up now"}
              </button>
            </form>
            <form action={verify}>
              <button type="submit" disabled={verifying} className={buttonClass.secondary}>
                {verifying ? "Checking every file…" : "Verify all files"}
              </button>
            </form>
          </div>
          <p className="text-xs text-slate-500">
            Verify checks every stored file is still there at its original size; files on the server&apos;s disk are also re-checked against the SHA-256 fingerprint taken at upload.
          </p>
        </div>
      </Card>
    </div>
  );
}
