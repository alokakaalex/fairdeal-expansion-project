import fs from "node:fs";
import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { parseOwnerInput, parsePaymentInput, parsePropertyInput, type OwnerInput, type PropertyInput } from "@/lib/expansion/propertyInput";
import type { Role } from "@/lib/expansion/roles";
import type { User } from "@/lib/expansion/types";
import type { FileCategory } from "@/lib/expansion/workflow";

const sent: { to: string; subject: string; attachments?: unknown[] }[] = [];
vi.mock("./mailer", () => ({
  emailEnabled: () => true,
  sendEmail: (e: { to: string; subject: string; attachments?: unknown[] }) => sent.push(e),
}));

const { run, resetDbForTests } = await import("./db");
const { listNotifications } = await import("./notifications");
const { createProperty, getProperty, listProperties, actionQueue, submitProperty, updateProperty } = await import("./properties");
const pipeline = await import("./pipeline");
const { storeBytes, archiveFile, viewableFile, beginUpload, uploadChunk, completeUpload } = await import("./files");
const { runBackup, listBackups } = await import("./backups");
const { updateSettings } = await import("./settings");
const { authenticate, inviteUser, redeemToken, changeRole, setUserEnabled } = await import("./users");

const INPUT: PropertyInput = {
  storeName: "Rohini Sec-7 Dark Store",
  address: "Plot 12, Sector 7, Rohini, Delhi",
  mapUrl: "https://www.google.com/maps/@28.7041,77.1025,17z",
  latitude: 28.7041,
  longitude: 77.1025,
  totalAreaSqft: 6500,
  carpetAreaSqft: 6000,
  askingRent: 185000,
  securityDeposit: 555000,
  advanceRent: 185000,
  lockInMonths: 36,
  structureType: "rcc",
  structureHeightFt: 18,
  rentFreeDays: 30,
  handoverDate: "2026-11-01",
  leaseTenureMonths: 108,
  rentEscalationPct: 5,
  notes: "Owner open to 45 rent-free days.",
};

const OWNER: OwnerInput = {
  name: "R. K. Sharma",
  email: "rk.sharma@example.com",
  phone: "9876543210",
  isOrganisation: false,
  gstNumber: "",
  panNumber: "ABCDE1234F",
  bankAccountName: "R K Sharma",
  bankAccountNumber: "123456789012",
  bankIfsc: "HDFC0001234",
  bankName: "HDFC Bank",
};

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4]);
const PDF = new TextEncoder().encode("%PDF-1.7\n1 0 obj\n");

let seq = 0;
async function makeUser(role: Role, name: string = role, salesApprover = role === "sales"): Promise<User> {
  const id = `user-${++seq}`;
  await run(
    "INSERT INTO users (id, email, name, role, status, sales_approver, created_at) VALUES (?, ?, ?, ?, 'active', ?, ?)",
    id,
    `${id}@example.com`,
    name,
    role,
    salesApprover ? 1 : 0,
    new Date().toISOString(),
  );
  return { id, email: `${id}@example.com`, name, role, status: "active", salesApprover, lastLoginAt: null, createdAt: "" };
}

function upload(user: User, propertyId: number, category: FileCategory, opts: { ownerId?: number; pdf?: boolean } = {}) {
  return storeBytes(user, propertyId, {
    category,
    ownerId: opts.ownerId ?? null,
    mime: opts.pdf ? "application/pdf" : "image/png",
    name: `${category}.${opts.pdf ? "pdf" : "png"}`,
    bytes: opts.pdf ? PDF : PNG,
  });
}

const payment = (utr: string, amount = 100000) =>
  (parsePaymentInput(new Map(Object.entries({ amount: String(amount), utr, paidOn: "2026-10-01", notes: "" }))) as { ok: true; value: never })
    .value;

let admin: User, em: User, re: User, bl: User, sales: User, sales2: User, ops: User, founder: User, finance: User;
const dataDir = path.resolve(".test-data");

beforeEach(async () => {
  await resetDbForTests();
  fs.rmSync(dataDir, { recursive: true, force: true });
  sent.length = 0;
  admin = await makeUser("admin", "Asha Admin");
  em = await makeUser("expansion_manager", "Esha EM");
  re = await makeUser("real_estate", "Ravi RE");
  bl = await makeUser("business", "Bina BL");
  sales = await makeUser("sales", "Sonal Sales");
  sales2 = await makeUser("sales", "Sam Sales");
  ops = await makeUser("ops", "Om Ops");
  founder = await makeUser("founder", "Farhan Founder");
  finance = await makeUser("finance", "Fiona Finance");
});

async function submitted(): Promise<number> {
  const id = await createProperty(re, INPUT);
  await upload(re, id, "property_media");
  await submitProperty(re, id);
  return id;
}

async function toDocuments(id: number) {
  await pipeline.decide(em, id, "approved", "Good location");
  await pipeline.decide(bl, id, "approved", "Rent fits budget");
  await pipeline.decide(sales, id, "approved", "Strong catchment");
  await upload(ops, id, "ops_media");
  await pipeline.saveVisit(ops, id, { visited: true, scopeOfWork: "Repaint, 2 new shutters, 63A 3-phase connection" });
  await pipeline.decide(ops, id, "approved", "Structure sound");
}

async function uploadDocuments(id: number) {
  const ownerId = await pipeline.addOwner(re, id, OWNER);
  for (const c of ["aadhaar_front", "aadhaar_back", "pan_card"] as const) await upload(re, id, c, { ownerId });
  for (const c of ["electricity_bill", "lease_deed", "property_tax_receipt"] as const) await upload(re, id, c, { pdf: true });
  return ownerId;
}

const stageOf = async (id: number) => {
  const p = (await getProperty(admin, id))!;
  return `${p.state}:${p.stage}`;
};

describe("full pipeline", () => {
  it("runs from scouting to balance payment, notifying the right people at each step", async () => {
    const id = await submitted();
    expect(await stageOf(id)).toBe("active:em_review");
    expect((await listNotifications(em.id))[0].title).toMatch(/New property/);
    expect(await getProperty(bl, id)).toBeNull();

    await pipeline.decide(em, id, "approved", "Good location");
    expect(await stageOf(id)).toBe("active:bl_review");
    expect((await listNotifications(re.id))[0].title).toMatch(/Expansion Manager \(Esha EM\) approved/);
    expect((await listNotifications(bl.id))[0].title).toMatch(/Awaiting your review/);

    await pipeline.decide(bl, id, "hold", "Waiting for Q3 budget");
    expect(await stageOf(id)).toBe("on_hold:bl_review");
    expect((await listNotifications(em.id))[0].title).toMatch(/put on hold/);
    expect((await listNotifications(re.id))[0].title).toMatch(/put on hold/);
    await pipeline.decide(bl, id, "approved", "Budget cleared");
    expect(await stageOf(id)).toBe("active:sales_review");
    expect(await listNotifications(sales.id)).toHaveLength(1);
    expect(await listNotifications(sales2.id)).toHaveLength(1);

    await pipeline.decide(sales2, id, "approved", "Good catchment");
    expect(await stageOf(id)).toBe("active:ops_review");
    expect((await listNotifications(ops.id))[0].title).toMatch(/Site visit needed/);

    await upload(ops, id, "ops_media");
    await expect(pipeline.decide(ops, id, "approved", "ok fine")).rejects.toThrow(/Mark the property as visited/);
    await pipeline.saveVisit(ops, id, { visited: true, scopeOfWork: "Repaint; 63A connection" });
    expect((await listNotifications(em.id))[0].title).toMatch(/Ops visited/);
    await pipeline.decide(ops, id, "approved", "Structure sound");
    expect(await stageOf(id)).toBe("active:documents");
    expect((await listNotifications(re.id))[0].title).toMatch(/upload documents/);

    await expect(pipeline.completeDocuments(re, id)).rejects.toThrow(/Still missing/);
    await uploadDocuments(id);
    await pipeline.completeDocuments(re, id);
    expect(await stageOf(id)).toBe("active:loi");
    expect((await listNotifications(em.id))[0].title).toMatch(/Documents uploaded/);

    await expect(pipeline.sendLoi(em, id)).rejects.toThrow(/Upload the LOI first/);
    await upload(em, id, "loi", { pdf: true });
    const loi = await pipeline.sendLoi(em, id);
    expect(loi.emailedTo).toEqual(["rk.sharma@example.com"]);
    const loiMail = sent.find((m) => m.to === "rk.sharma@example.com")!;
    expect(loiMail.subject).toMatch(/Letter of Intent/);
    expect(loiMail.attachments).toHaveLength(1);
    expect(await stageOf(id)).toBe("active:signed_loi");
    expect((await listNotifications(re.id))[0].title).toMatch(/LOI issued/);

    await upload(em, id, "signed_loi", { pdf: true });
    await pipeline.confirmSignedLoi(em, id);
    expect(await stageOf(id)).toBe("active:founder_review");
    expect((await listNotifications(founder.id))[0].title).toMatch(/Approval needed/);

    await pipeline.decide(founder, id, "approved", "Go ahead");
    expect(await stageOf(id)).toBe("active:token_payment");
    expect((await listNotifications(finance.id))[0].title).toMatch(/Release token/);

    await expect(pipeline.recordPayment(finance, id, "token", payment("UTR0000000001"))).rejects.toThrow(/Upload the token payment/i);
    await upload(finance, id, "token_receipt", { pdf: true });
    await pipeline.recordPayment(finance, id, "token", payment("UTR0000000001", 50000));
    expect(await stageOf(id)).toBe("active:agreement");
    expect((await listNotifications(founder.id))[0].title).toMatch(/Token paid/);
    expect((await listNotifications(em.id))[0].title).toMatch(/Token paid/);

    await upload(em, id, "agreement", { pdf: true });
    await pipeline.confirmAgreement(em, id);
    expect(await stageOf(id)).toBe("active:balance_payment");
    expect((await listNotifications(finance.id))[0].title).toMatch(/Release balance/);

    await upload(finance, id, "balance_receipt", { pdf: true });
    await expect(pipeline.recordPayment(finance, id, "balance", payment("UTR0000000001"))).rejects.toThrow(/already recorded/);
    await pipeline.recordPayment(finance, id, "balance", payment("UTR0000000002", 690000));
    const done = (await getProperty(admin, id))!;
    expect(done.state).toBe("completed");
    expect(done.completedAt).not.toBeNull();
    expect(done.payments!.map((p) => [p.kind, p.amount])).toEqual([
      ["token", 50000],
      ["balance", 690000],
    ]);
    expect(done.decisions.map((d) => `${d.stage}:${d.decision}`)).toEqual([
      "em_review:approved",
      "bl_review:hold",
      "bl_review:approved",
      "sales_review:approved",
      "ops_review:approved",
      "founder_review:approved",
    ]);
  });

  it("handles stamp duty as a side request to finance and the founder", async () => {
    const id = await submitted();
    await toDocuments(id);
    await expect(pipeline.requestStampDuty(em, id, { amount: 42000, remarks: "" })).rejects.toThrow(/once the Founder has approved/);
    await uploadDocuments(id);
    await pipeline.completeDocuments(re, id);
    await upload(em, id, "loi", { pdf: true });
    await pipeline.sendLoi(em, id);
    await upload(em, id, "signed_loi", { pdf: true });
    await pipeline.confirmSignedLoi(em, id);
    await pipeline.decide(founder, id, "approved", "Go ahead");

    await expect(pipeline.requestStampDuty(em, id, { amount: 42000, remarks: "" })).rejects.toThrow(/calculation PDF/);
    await upload(em, id, "stamp_duty_calculation", { pdf: true });
    await pipeline.requestStampDuty(em, id, { amount: 42000, remarks: "Owner wants a registered lease" });
    expect((await listNotifications(finance.id))[0].title).toMatch(/Stamp duty requested/);
    expect((await listNotifications(founder.id))[0].title).toMatch(/Stamp duty requested/);
    const request = (await getProperty(finance, id))!.payments!.find((p) => p.kind === "stamp_duty")!;
    expect(request.status).toBe("requested");
    expect((await actionQueue(finance)).map((p) => p.id)).toContain(id);

    await upload(finance, id, "stamp_duty_receipt", { pdf: true });
    await pipeline.payStampDuty(finance, request.id, payment("STAMPUTR12345", 42000));
    expect((await listNotifications(em.id))[0].title).toMatch(/Stamp duty paid/);
    await expect(pipeline.payStampDuty(finance, request.id, payment("STAMPUTR99999"))).rejects.toThrow(/already paid/);
    // The main pipeline is unaffected.
    expect(await stageOf(id)).toBe("active:token_payment");
  });
});

describe("rejections, holds and votes", () => {
  it("lets the real estate manager revise and resubmit after a rejection", async () => {
    const id = await submitted();
    await pipeline.decide(em, id, "approved", "ok go");
    await pipeline.decide(bl, id, "rejected", "Rent too high");
    expect(await stageOf(id)).toBe("rejected:bl_review");
    expect((await listNotifications(re.id))[0].title).toMatch(/rejected/);
    expect((await listNotifications(em.id))[0].title).toMatch(/rejected/);
    await updateProperty(re, id, { ...INPUT, askingRent: 160000 });
    await submitProperty(re, id);
    const p = (await getProperty(admin, id))!;
    expect(`${p.state}:${p.stage}:${p.round}`).toBe("active:em_review:2");
    // Business keeps access to what it reviewed before.
    expect(await getProperty(bl, id)).not.toBeNull();
  });

  it("requires remarks, the right role and the right stage", async () => {
    const id = await submitted();
    await expect(pipeline.decide(em, id, "approved", " ")).rejects.toThrow(/Remarks are required/);
    await expect(pipeline.decide(em, id, "hold", "not now")).rejects.toThrow(/can't hold/);
    await expect(pipeline.decide(bl, id, "approved", "ok go")).rejects.toThrow(/not found|isn't waiting/);
    await expect(pipeline.decide(re, id, "approved", "ok go")).rejects.toThrow(/doesn't review/);
    await pipeline.decide(em, id, "approved", "ok go");
    await expect(pipeline.decide(em, id, "rejected", "changed mind")).rejects.toThrow(/isn't waiting/);
  });

  it("counts sales votes against the configured thresholds", async () => {
    await updateSettings(admin, { salesApprovalsRequired: 2, salesRejectionsRequired: 2 });
    const id = await submitted();
    await pipeline.decide(em, id, "approved", "ok go");
    await pipeline.decide(bl, id, "approved", "ok go");
    await pipeline.decide(sales, id, "approved", "Good market");
    expect(await stageOf(id)).toBe("active:sales_review");
    expect((await listNotifications(re.id))[0].body).toMatch(/1 approve, 0 reject/);
    await expect(pipeline.decide(sales, id, "rejected", "again")).rejects.toThrow(/already given/);
    expect(await actionQueue(sales)).toHaveLength(0);
    expect((await actionQueue(sales2)).map((p) => p.id)).toEqual([id]);
    await pipeline.decide(sales2, id, "approved", "Agree");
    expect(await stageOf(id)).toBe("active:ops_review");
  });

  it("lets only designated sales approvers decide; the rest of sales can view", async () => {
    const viewer = await makeUser("sales", "Vik Viewer", false);
    const id = await submitted();
    await pipeline.decide(em, id, "approved", "ok go");
    await pipeline.decide(bl, id, "approved", "ok go");
    expect((await listNotifications(viewer.id))[0].title).toMatch(/For your review/);
    expect((await listNotifications(sales.id))[0].title).toMatch(/Awaiting your decision/);
    expect((await getProperty(viewer, id))!.files).toHaveLength(1);
    expect(await actionQueue(viewer)).toHaveLength(0);
    await expect(pipeline.decide(viewer, id, "approved", "Looks good")).rejects.toThrow(/view access/);
    await pipeline.decide(sales, id, "approved", "Looks good");
    expect(await stageOf(id)).toBe("active:ops_review");
  });

  it("lets the access manager raise a stamp duty request too", async () => {
    const id = await submitted();
    await run("UPDATE properties SET furthest_stage = 8, stage = 'token_payment' WHERE id = ?", id);
    await upload(admin, id, "stamp_duty_calculation", { pdf: true });
    await pipeline.requestStampDuty(admin, id, { amount: 30000, remarks: "" });
    expect((await listNotifications(finance.id))[0].title).toMatch(/Stamp duty requested/);
    await expect(pipeline.requestStampDuty(re, id, { amount: 1, remarks: "" })).rejects.toThrow(/Your role/);
  });

  it("locks editing while in review", async () => {
    const id = await createProperty(re, INPUT);
    await expect(submitProperty(re, id)).rejects.toThrow(/at least one photo or video/);
    await upload(re, id, "property_media");
    await submitProperty(re, id);
    await expect(updateProperty(re, id, INPUT)).rejects.toThrow(/in review/);
    await expect(upload(re, id, "property_media")).rejects.toThrow(/can't upload/);
    await expect(createProperty(sales, INPUT)).rejects.toThrow(/Your role/);
  });
});

describe("what each role can see", () => {
  it("gives business leaders only store name, area, rent, deposit, rent-free days and advance", async () => {
    const id = await submitted();
    await pipeline.decide(em, id, "approved", "ok go");
    const p = (await getProperty(bl, id))!;
    expect([p.storeName, p.totalAreaSqft, p.carpetAreaSqft, p.askingRent, p.securityDeposit, p.rentFreeDays, p.advanceRent]).toEqual([
      "Rohini Sec-7 Dark Store", 6500, 6000, 185000, 555000, 30, 185000,
    ]);
    expect([p.address, p.mapUrl, p.lockInMonths, p.structureType, p.handoverDate, p.notes]).toEqual([null, null, null, null, null, null]);
    expect(p.files).toEqual([]);
    expect(p.owners).toBeNull();
    expect(p.payments).toBeNull();
  });

  it("gives sales and ops all property details and media, but not owner documents", async () => {
    const id = await submitted();
    await toDocuments(id);
    await uploadDocuments(id);
    for (const viewer of [sales, ops]) {
      const p = (await getProperty(viewer, id))!;
      expect(p.structureType).toBe("rcc");
      expect(p.files.map((f) => f.category).sort()).toEqual(["ops_media", "property_media"]);
      expect(p.owners).toBeNull();
      expect(p.visit?.scopeOfWork).toMatch(/Repaint/);
    }
    const kyc = (await getProperty(admin, id))!.files.find((f) => f.category === "aadhaar_front")!;
    expect(await viewableFile(sales, kyc.id)).toBeNull();
    expect(await viewableFile(founder, kyc.id)).not.toBeNull();
    expect(await viewableFile(re, kyc.id)).not.toBeNull();
  });

  it("gives finance the deal summary, signed LOI, agreement and bank details, but not KYC", async () => {
    const id = await submitted();
    await toDocuments(id);
    await uploadDocuments(id);
    await pipeline.completeDocuments(re, id);
    expect(await getProperty(finance, id)).toBeNull();
    await upload(em, id, "loi", { pdf: true });
    await pipeline.sendLoi(em, id);
    await upload(em, id, "signed_loi", { pdf: true });
    await pipeline.confirmSignedLoi(em, id);
    await pipeline.decide(founder, id, "approved", "Go ahead");
    const p = (await getProperty(finance, id))!;
    expect([p.totalAreaSqft, p.advanceRent, p.securityDeposit]).toEqual([6500, 185000, 555000]);
    expect(p.askingRent).toBeNull();
    expect(p.files.map((f) => f.category)).toEqual(["signed_loi"]);
    expect(p.owners![0].bank).toMatchObject({ accountNumber: "123456789012", ifsc: "HDFC0001234" });
    expect(p.decisions).toHaveLength(5);
    // Business leaders never see bank details.
    expect((await getProperty(bl, id))!.owners).toBeNull();
  });

  it("shows real estate managers only their own properties", async () => {
    const id = await submitted();
    const other = await makeUser("real_estate", "Other RE");
    expect(await getProperty(other, id)).toBeNull();
    expect(await listProperties(other)).toHaveLength(0);
    expect(await listProperties(em)).toHaveLength(1);
  });
});

describe("nothing is ever lost", () => {
  it("archives files instead of deleting them, and the database refuses deletes", async () => {
    const id = await createProperty(re, INPUT);
    const { id: fileId } = await upload(re, id, "property_media");
    await archiveFile(re, fileId);
    expect((await getProperty(re, id))!.files).toHaveLength(0);
    const archived = (await getProperty(admin, id))!.files;
    expect(archived).toHaveLength(1);
    expect(archived[0].archivedAt).not.toBeNull();
    expect(fs.existsSync(path.join(dataDir, "uploads", String(id), fileId))).toBe(true);
    expect(archived[0].sha256).toMatch(/^[0-9a-f]{64}$/);

    await expect(run("DELETE FROM properties WHERE id = ?", id)).rejects.toThrow(/never deleted/);
    await expect(run("DELETE FROM files")).rejects.toThrow(/never deleted/);
    await expect(run("DELETE FROM audit_log")).rejects.toThrow(/never deleted/);
    await upload(re, id, "property_media");
    await submitProperty(re, id);
    await pipeline.decide(em, id, "approved", "ok go");
    await expect(run("UPDATE decisions SET remarks = 'x'")).rejects.toThrow(/never changed/);
  });

  it("rejects files whose contents don't match their type", async () => {
    const id = await createProperty(re, INPUT);
    // A script disguised as a photo, sent through the normal chunked upload.
    const evil = new TextEncoder().encode("<script>alert(1)</script>");
    const plan = await beginUpload(re, { propertyId: id, category: "property_media", ownerId: null, name: "evil.png", mime: "image/png", size: evil.length });
    await uploadChunk(re, plan.uploadId, 0, new Blob([evil]).stream());
    await expect(completeUpload(re, plan.uploadId)).rejects.toThrow(/don't match/);
    expect((await getProperty(re, id))!.files).toHaveLength(0);
    await expect(upload(re, id, "property_media", { pdf: true })).rejects.toThrow(/Only photos/);
    await expect(
      beginUpload(re, { propertyId: id, category: "property_media", ownerId: null, name: "x.exe", mime: "application/x-msdownload", size: 10 }),
    ).rejects.toThrow(/Only photos/);
  });

  it("accepts a large video in chunks of any number, and resumes after a retried chunk", async () => {
    const id = await createProperty(re, INPUT);
    // A 2.5 MB "video" (MP4 header + filler) sent in 1 MB chunks (UPLOAD_CHUNK_MB=1 in tests).
    const size = 2.5 * 1024 * 1024;
    const bytes = new Uint8Array(size);
    bytes.set([0, 0, 0, 0x18, ...new TextEncoder().encode("ftypmp42")]);
    for (let i = 16; i < size; i++) bytes[i] = i % 251;
    const plan = await beginUpload(re, { propertyId: id, category: "property_media", ownerId: null, name: "walkthrough.mp4", mime: "video/mp4", size });
    expect(plan.mode).toBe("local");
    const chunk = plan.mode === "local" ? plan.chunkBytes : 0;
    let offset = 0;
    while (offset < size) {
      const part = bytes.subarray(offset, offset + chunk);
      offset = await uploadChunk(re, plan.uploadId, offset, new Blob([part]).stream());
      // Re-sending a chunk the server already has is harmless.
      expect(await uploadChunk(re, plan.uploadId, 0, new Blob([part]).stream())).toBe(offset);
    }
    const { id: fileId } = await completeUpload(re, plan.uploadId);
    const stored = (await getProperty(re, id))!.files.find((f) => f.id === fileId)!;
    expect(stored).toMatchObject({ kind: "video", sizeBytes: size, mime: "video/mp4" });
    const { createHash } = await import("node:crypto");
    expect(stored.sha256).toBe(createHash("sha256").update(bytes).digest("hex"));
    await expect(uploadChunk(re, plan.uploadId, 0, new Blob([bytes]).stream())).rejects.toThrow(/already finished/);
    // Someone else can't continue another person's upload.
    const plan2 = await beginUpload(re, { propertyId: id, category: "property_media", ownerId: null, name: "a.mp4", mime: "video/mp4", size: 100 });
    await expect(uploadChunk(admin, plan2.uploadId, 0, new Blob([bytes.subarray(0, 100)]).stream())).rejects.toThrow(/not found/);
  });

  it("writes a verifiable database backup", async () => {
    const id = await submitted();
    const b = await runBackup("manual");
    expect(b.error).toBeNull();
    expect(b.sizeBytes).toBeGreaterThan(0);
    expect((await listBackups())[0].id).toBe(b.id);
    const { gunzipSync } = await import("node:zlib");
    const snapshot = JSON.parse(gunzipSync(fs.readFileSync(path.join(dataDir, "backups", b.fileName))).toString());
    expect(snapshot.tables.properties.find((p: { id: number }) => p.id === id).store_name).toBe(INPUT.storeName);
    expect(snapshot.tables.files.length).toBeGreaterThan(0);
  });
});

describe("access management", () => {
  it("invites a user who sets a password and signs in", async () => {
    const { user, link } = await inviteUser(admin, { email: "New.Person@Example.com", name: "New Person", role: "finance" });
    expect((await inviteUser(admin, { email: "s@example.com", name: "S", role: "sales", salesApprover: true })).user.salesApprover).toBe(true);
    await redeemToken(link.url.split("/invite/")[1], "correct horse 42");
    expect((await authenticate("new.person@example.com", "correct horse 42")).role).toBe("finance");
    expect(user.status).toBe("invited");
  });

  it("keeps at least one admin and blocks disabled users", async () => {
    await expect(changeRole(admin, admin.id, "sales")).rejects.toThrow(/own role/);
    const { user, link } = await inviteUser(admin, { email: "d@example.com", name: "D", role: "sales" });
    await redeemToken(link.url.split("/invite/")[1], "good password 1");
    await setUserEnabled(admin, user.id, false);
    await expect(authenticate(user.email, "good password 1")).rejects.toThrow(/disabled/);
  });
});

describe("form validation", () => {
  const form = (o: Record<string, string> = {}) =>
    new Map(
      Object.entries({
        storeName: "X", address: "Y", mapUrl: "28.61, 77.20", totalAreaSqft: "5,400", carpetAreaSqft: "5000",
        askingRent: "100000", securityDeposit: "300000", advanceRent: "100000", lockInMonths: "12",
        structureType: "shed", structureHeightFt: "20", rentFreeDays: "15", handoverDate: "2026-12-01", ...o,
      }),
    );

  it("accepts a complete property form", () => {
    const r = parsePropertyInput(form());
    expect(r.ok && r.value).toMatchObject({ totalAreaSqft: 5400, structureType: "shed", leaseTenureMonths: null, latitude: 28.61 });
  });

  it("reports invalid property fields", () => {
    const r = parsePropertyInput(form({ carpetAreaSqft: "6000", structureType: "brick", mapUrl: "javascript:alert(1)" }));
    expect(!r.ok && Object.keys(r.errors).sort()).toEqual(["carpetAreaSqft", "mapUrl", "structureType"]);
  });

  it("validates owner KYC and bank formats", () => {
    const r = parseOwnerInput(new Map(Object.entries({ name: "A", panNumber: "abc", bankAccountNumber: "12", isOrganisation: "on" })));
    expect(!r.ok && Object.keys(r.errors).sort()).toEqual(["bankAccountName", "bankAccountNumber", "bankIfsc", "bankName", "gstNumber", "panNumber"]);
  });
});
