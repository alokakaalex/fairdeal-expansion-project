"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import {
  parseOwnerInput,
  parsePaymentInput,
  parsePropertyInput,
  parseStampDutyRequest,
  type Errors,
} from "@/lib/expansion/propertyInput";
import type { Decision } from "@/lib/expansion/workflow";
import { archiveFile } from "@/lib/server/files";
import { markRead } from "@/lib/server/notifications";
import * as pipeline from "@/lib/server/pipeline";
import { createProperty, PropertyError, submitProperty, updateProperty } from "@/lib/server/properties";
import { requireUser } from "@/lib/server/session";

export interface ActionState {
  error?: string;
  success?: string;
  fieldErrors?: Errors<Record<string, unknown>>;
}

function field(formData: FormData, name: string): string {
  const v = formData.get(name);
  return typeof v === "string" ? v : "";
}

function idOf(formData: FormData): number {
  return Number(field(formData, "propertyId"));
}

/**
 * Runs a pipeline step, turning expected errors into a message for the form.
 * Steps that move the property on (so the form itself disappears) redirect
 * back with ?done=<key>, which the page shows as a banner.
 */
async function run(
  formData: FormData,
  fn: (user: Awaited<ReturnType<typeof requireUser>>, id: number) => Promise<string | void>,
  opts: { done?: (result: string | undefined) => string } = {},
): Promise<ActionState> {
  const user = await requireUser();
  const id = idOf(formData);
  let success: string | undefined;
  try {
    success = (await fn(user, id)) ?? undefined;
  } catch (error) {
    if (error instanceof PropertyError) return { error: error.message };
    throw error;
  }
  revalidatePath("/", "layout");
  if (opts.done) redirect(`/properties/${id}?done=${opts.done(success)}`);
  return { success };
}

const done = (key: string) => ({ done: () => key });

// --- Real estate manager ---------------------------------------------------------

export async function saveProperty(_: ActionState, formData: FormData): Promise<ActionState> {
  const user = await requireUser();
  const parsed = parsePropertyInput(formData);
  if (!parsed.ok) return { error: "Please fix the highlighted fields.", fieldErrors: parsed.errors };
  const existing = idOf(formData);
  let id: number;
  try {
    if (existing) {
      await updateProperty(user, existing, parsed.value);
      id = existing;
    } else id = await createProperty(user, parsed.value);
  } catch (error) {
    if (error instanceof PropertyError) return { error: error.message };
    throw error;
  }
  revalidatePath("/real-estate");
  redirect(`/properties/${id}${existing ? "?saved=1" : "?created=1"}`);
}

export async function submitForReview(_: ActionState, formData: FormData) {
  return run(formData, async (user, id) => {
    await submitProperty(user, id);
  }, done("submitted"));
}

export async function saveOwner(_: ActionState, formData: FormData): Promise<ActionState> {
  const parsed = parseOwnerInput(formData);
  if (!parsed.ok) return { error: "Please fix the highlighted fields.", fieldErrors: parsed.errors };
  const ownerId = Number(field(formData, "ownerId"));
  return run(formData, async (user, id) => {
    if (ownerId) await pipeline.updateOwner(user, id, ownerId, parsed.value);
    else await pipeline.addOwner(user, id, parsed.value);
    return ownerId ? "Owner updated." : "Owner added. Now upload their Aadhaar and PAN.";
  });
}

export async function removeOwner(_: ActionState, formData: FormData) {
  return run(formData, async (user, id) => pipeline.archiveOwner(user, id, Number(field(formData, "ownerId"))));
}

export async function completeDocuments(_: ActionState, formData: FormData) {
  return run(formData, async (user, id) => {
    await pipeline.completeDocuments(user, id);
  }, done("documents"));
}

export async function removeFile(_: ActionState, formData: FormData) {
  return run(formData, async (user) => archiveFile(user, field(formData, "fileId")));
}

// --- Reviews ---------------------------------------------------------------------

export async function recordDecision(_: ActionState, formData: FormData) {
  return run(formData, async (user, id) => {
    const decision = field(formData, "decision") as Decision;
    await pipeline.decide(user, id, decision, field(formData, "remarks"));
  }, done("decision"));
}

export async function saveVisit(_: ActionState, formData: FormData) {
  return run(formData, async (user, id) => {
    await pipeline.saveVisit(user, id, { visited: field(formData, "visited") === "on", scopeOfWork: field(formData, "scopeOfWork") });
    return "Site visit saved.";
  });
}

// --- Expansion manager -------------------------------------------------------------

export async function sendLoi(_: ActionState, formData: FormData) {
  return run(formData, async (user, id) => {
    const r = await pipeline.sendLoi(user, id);
    return r.emailConfigured ? "loi_emailed" : "loi_manual";
  }, { done: (key) => key! });
}

export async function confirmSignedLoi(_: ActionState, formData: FormData) {
  return run(formData, async (user, id) => {
    await pipeline.confirmSignedLoi(user, id);
  }, done("signed_loi"));
}

export async function confirmAgreement(_: ActionState, formData: FormData) {
  return run(formData, async (user, id) => {
    await pipeline.confirmAgreement(user, id);
  }, done("agreement"));
}

export async function requestStampDuty(_: ActionState, formData: FormData): Promise<ActionState> {
  const parsed = parseStampDutyRequest(formData);
  if (!parsed.ok) return { error: "Please fix the highlighted fields.", fieldErrors: parsed.errors };
  return run(formData, async (user, id) => {
    await pipeline.requestStampDuty(user, id, parsed.value);
  }, done("stamp_requested"));
}

// --- Finance -----------------------------------------------------------------

export async function markPaid(_: ActionState, formData: FormData): Promise<ActionState> {
  const parsed = parsePaymentInput(formData);
  if (!parsed.ok) return { error: "Please fix the highlighted fields.", fieldErrors: parsed.errors };
  const kind = field(formData, "kind");
  return run(formData, async (user, id) => {
    if (kind === "token" || kind === "balance") await pipeline.recordPayment(user, id, kind, parsed.value);
    else if (kind === "stamp_duty") await pipeline.payStampDuty(user, Number(field(formData, "paymentId")), parsed.value);
    else throw new PropertyError("Unknown payment.");
  }, done("paid"));
}

// --- Notifications -----------------------------------------------------------

export async function markNotificationsRead(formData: FormData) {
  const user = await requireUser();
  const id = field(formData, "notificationId");
  await markRead(user.id, id ? Number(id) : undefined);
  revalidatePath("/", "layout");
}
