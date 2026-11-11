import { randomBytes } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { PropertyInput } from "@/lib/expansion/propertyInput";
import type { Role } from "@/lib/expansion/roles";
import type { User } from "@/lib/expansion/types";

// Supabase sign-in and storage, against an in-memory stand-in for Supabase
// (the real service isn't reachable from tests). It mimics the parts of
// supabase-js the portal uses, including one-time links, bans and buckets.

process.env.SUPABASE_URL = "https://project.supabase.test";
process.env.SUPABASE_ANON_KEY = "anon-key";
process.env.SUPABASE_SERVICE_ROLE_KEY = "service-role-key";
process.env.ADMIN_EMAIL = "founder@fairdeal.test";
process.env.ADMIN_NAME = "Founder";
process.env.ADMIN_INITIAL_PASSWORD = "Initial-Passw0rd";

interface Account {
  id: string;
  email: string;
  password: string | null;
  confirmed: boolean;
  banned: boolean;
}

const sb = {
  accounts: new Map<string, Account>(),
  session: null as string | null,
  tokens: new Map<string, { type: string; authId: string }>(),
  bucket: null as { public: boolean; file_size_limit: number | null } | null,
  objects: new Map<string, { bytes: Uint8Array; contentType: string }>(),
  uploadUrls: new Map<string, string>(),
  /** Makes admin.createUser fail, e.g. a wrong service key. */
  createUserError: null as string | null,
  reset() {
    this.createUserError = null;
    this.accounts.clear();
    this.session = null;
    this.tokens.clear();
    this.bucket = null;
    this.objects.clear();
    this.uploadUrls.clear();
  },
};

const byEmail = (email: string) => [...sb.accounts.values()].find((a) => a.email === email.toLowerCase());
const fail = (message: string) => ({ data: { user: null, session: null }, error: { message } });
const newAccount = (email: string, password: string | null, confirmed: boolean): Account => {
  const a = { id: crypto.randomUUID(), email: email.toLowerCase(), password, confirmed, banned: false };
  sb.accounts.set(a.id, a);
  return a;
};
const userOf = (a: Account) => ({ id: a.id, email: a.email, email_confirmed_at: a.confirmed ? "2026-11-01T00:00:00Z" : null });

const signIn = (setSession: boolean) => async ({ email, password }: { email: string; password: string }) => {
  const a = byEmail(email);
  if (!a || a.banned || !a.password || a.password !== password) return fail("Invalid login credentials");
  if (setSession) sb.session = a.id;
  return { data: { user: userOf(a), session: {} }, error: null };
};

const bucketApi = {
  async createSignedUploadUrl(key: string) {
    const url = `https://project.supabase.test/storage/v1/object/upload/sign/expansion-files/${key}?token=${randomBytes(8).toString("hex")}`;
    sb.uploadUrls.set(url, key);
    return { data: { signedUrl: url, path: key, token: "t" }, error: null };
  },
  async info(key: string) {
    const o = sb.objects.get(key);
    return o ? { data: { size: o.bytes.length, etag: '"etag-1"' }, error: null } : { data: null, error: { message: "Object not found" } };
  },
  async createSignedUrl(key: string, seconds: number, opts?: { download?: string | false }) {
    return { data: { signedUrl: `https://project.supabase.test/sign/${key}?expires=${seconds}${opts?.download ? `&download=${opts.download}` : ""}` }, error: null };
  },
  async upload(key: string, bytes: Uint8Array, opts: { contentType: string }) {
    sb.objects.set(key, { bytes, contentType: opts.contentType });
    return { data: { path: key }, error: null };
  },
  async download(key: string) {
    const o = sb.objects.get(key);
    return o ? { data: new Blob([o.bytes as BlobPart]), error: null } : { data: null, error: { message: "Object not found" } };
  },
  async remove(keys: string[]) {
    for (const k of keys) sb.objects.delete(k);
    return { data: [], error: null };
  },
};

const authApi = {
  signInWithPassword: signIn(true),
  async signOut() {
    sb.session = null;
    return { error: null };
  },
  async getClaims() {
    const a = sb.session ? sb.accounts.get(sb.session) : undefined;
    return a && !a.banned ? { data: { claims: { sub: a.id, email: a.email } }, error: null } : { data: null, error: { message: "no session" } };
  },
  async getUser() {
    const a = sb.session ? sb.accounts.get(sb.session) : undefined;
    return { data: { user: a ? userOf(a) : null }, error: a ? null : { message: "no session" } };
  },
  async verifyOtp({ type, token_hash }: { type: string; token_hash: string }) {
    const t = sb.tokens.get(token_hash);
    if (!t || t.type !== type) return fail("Email link is invalid or has expired");
    sb.tokens.delete(token_hash);
    const a = sb.accounts.get(t.authId)!;
    a.confirmed = true;
    sb.session = a.id;
    return { data: { user: userOf(a), session: {} }, error: null };
  },
  async exchangeCodeForSession(code: string) {
    const a = byEmail(code);
    if (!a) return fail("invalid code");
    sb.session = a.id;
    return { data: { user: userOf(a), session: {} }, error: null };
  },
  async signInWithOAuth() {
    return { data: { url: "https://accounts.google.test/o/oauth2" }, error: null };
  },
  async updateUser({ password }: { password: string }) {
    const a = sb.session ? sb.accounts.get(sb.session) : undefined;
    if (!a) return fail("Auth session missing!");
    a.password = password;
    return { data: { user: userOf(a) }, error: null };
  },
  admin: {
    async generateLink({ type, email }: { type: string; email: string }) {
      let a = byEmail(email);
      if (type === "invite") {
        if (a) return fail("A user with this email address has already been registered");
        a = newAccount(email, null, false);
      } else if (!a) return fail("User not found");
      const token = randomBytes(16).toString("hex");
      sb.tokens.set(token, { type, authId: a.id });
      return { data: { user: userOf(a), properties: { hashed_token: token } }, error: null };
    },
    async createUser({ email, password, email_confirm }: { email: string; password: string; email_confirm: boolean }) {
      if (sb.createUserError) return fail(sb.createUserError);
      if (byEmail(email)) return fail("A user with this email address has already been registered");
      return { data: { user: userOf(newAccount(email, password, email_confirm)) }, error: null };
    },
    async updateUserById(id: string, changes: { ban_duration?: string; password?: string; email_confirm?: boolean }) {
      const a = sb.accounts.get(id);
      if (!a) return fail("User not found");
      if (changes.ban_duration !== undefined) a.banned = changes.ban_duration !== "none";
      if (changes.password !== undefined) a.password = changes.password;
      if (changes.email_confirm) a.confirmed = true;
      return { data: { user: userOf(a) }, error: null };
    },
  },
};

vi.mock("./supabase", () => ({
  authClient: async () => ({ auth: authApi }),
  anonClient: () => ({ auth: { signInWithPassword: signIn(false) } }),
  adminClient: () => ({
    auth: authApi,
    storage: {
      async getBucket() {
        return sb.bucket ? { data: { ...sb.bucket }, error: null } : { data: null, error: { message: "Bucket not found" } };
      },
      async createBucket(_: string, o: { public: boolean; fileSizeLimit: number }) {
        sb.bucket = { public: o.public, file_size_limit: o.fileSizeLimit };
        return { data: {}, error: null };
      },
      async updateBucket(_: string, o: { public: boolean; fileSizeLimit: number }) {
        sb.bucket = { public: o.public, file_size_limit: o.fileSizeLimit };
        return { data: {}, error: null };
      },
      from: () => bucketApi,
    },
  }),
}));

const sent: { to: string; subject: string; text: string }[] = [];
vi.mock("./mailer", () => ({
  emailEnabled: () => true,
  sendEmail: (e: { to: string; subject: string; text: string }) => sent.push(e),
}));

// Signed download URLs are fetched to read a file's first bytes.
vi.stubGlobal("fetch", async (url: string, init?: { headers?: Record<string, string> }) => {
  const key = decodeURIComponent(new URL(url).pathname.replace(/^\/sign\//, ""));
  const o = sb.objects.get(key);
  if (!o) return new Response("not found", { status: 404 });
  const m = init?.headers?.Range?.match(/bytes=(\d+)-(\d+)/);
  const bytes = m ? o.bytes.subarray(Number(m[1]), Number(m[2]) + 1) : o.bytes;
  return new Response(bytes as BodyInit, { status: m ? 206 : 200 });
});

const { config } = await import("./config");
const { run, one, resetDbForTests } = await import("./db");
const users = await import("./users");
const { currentUser, sessionUserAnyStatus } = await import("./session");
const supabaseAuth = await import("./supabaseAuth");
const storage = await import("./storage");
const { beginUpload, completeUpload, emailAttachment, viewableFile } = await import("./files");
const { createProperty } = await import("./properties");

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
  notes: "",
};
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4, 5, 6, 7, 8]);

/** What the browser does with an upload plan: PUT the file to the signed URL. */
function browserUploads(url: string, bytes: Uint8Array, contentType: string) {
  sb.objects.set(sb.uploadUrls.get(url)!, { bytes, contentType });
}

function tokenFrom(link: string): { type: string; tokenHash: string } {
  const u = new URL(link);
  expect(u.pathname).toBe("/auth/confirm");
  return { type: u.searchParams.get("type")!, tokenHash: u.searchParams.get("token_hash")! };
}

let seq = 0;
async function member(role: Role): Promise<User> {
  const id = `user-${++seq}`;
  const email = `${id}@fairdeal.test`;
  await run("INSERT INTO users (id, email, name, role, status, created_at) VALUES (?, ?, ?, ?, 'active', ?)", id, email, `${role} person`, role, new Date().toISOString());
  const a = newAccount(email, "Member-Passw0rd", true);
  await run("UPDATE users SET auth_id = ? WHERE id = ?", a.id, id);
  return (await users.getUser(id))!;
}

let founder: User;

beforeEach(async () => {
  sb.reset();
  sent.length = 0;
  await resetDbForTests();
  // The first access manager signs in with ADMIN_INITIAL_PASSWORD; that creates their Supabase account.
  founder = await users.authenticate("founder@fairdeal.test", "Initial-Passw0rd");
});

describe("Supabase sign-in", () => {
  it("is used when Supabase is configured", () => {
    expect(config.authProvider).toBe("supabase");
    expect(storage.storageKind()).toBe("supabase");
  });

  it("creates the first access manager's account on first sign-in and keeps them signed in", async () => {
    expect(byEmail("founder@fairdeal.test")?.confirmed).toBe(true);
    expect((await currentUser())?.email).toBe("founder@fairdeal.test");
    await users.authenticate("founder@fairdeal.test", "Initial-Passw0rd"); // again, now via Supabase only
    await expect(users.authenticate("founder@fairdeal.test", "wrong-password-1")).rejects.toThrow(/Incorrect email or password/);
    expect((await one<{ failed_logins: number }>("SELECT failed_logins FROM users WHERE id = ?", founder.id))!.failed_logins).toBe(1);
  });

  it("accepts the current ADMIN_INITIAL_PASSWORD until the first access manager's first sign-in", async () => {
    // As if the password in the host's settings had been changed after the database was created.
    sb.reset();
    await run("UPDATE users SET auth_id = NULL, password_hash = 'scrypt$old' WHERE id = ?", founder.id);
    expect((await users.authenticate("founder@fairdeal.test", "Initial-Passw0rd")).id).toBe(founder.id);
    // Once their Supabase account exists, only Supabase's password counts.
    await users.changePassword(founder, "Initial-Passw0rd", "Changed-Passw0rd-9");
    await expect(users.authenticate("founder@fairdeal.test", "Initial-Passw0rd")).rejects.toThrow(/Incorrect/);
  });

  it("repairs a Supabase account left over from an earlier attempt for the first access manager", async () => {
    sb.reset();
    await run("UPDATE users SET auth_id = NULL WHERE id = ?", founder.id);
    const leftover = newAccount("founder@fairdeal.test", "something-else-1", false);
    leftover.banned = true;
    expect((await users.authenticate("founder@fairdeal.test", "Initial-Passw0rd")).id).toBe(founder.id);
    expect(leftover).toMatchObject({ password: "Initial-Passw0rd", confirmed: true, banned: false });
    expect((await one<{ auth_id: string }>("SELECT auth_id FROM users WHERE id = ?", founder.id))!.auth_id).toBe(leftover.id);
  });

  it("explains first sign-in problems instead of saying 'wrong password'", async () => {
    sb.reset();
    await run("UPDATE users SET auth_id = NULL, failed_logins = 0 WHERE id = ?", founder.id);
    const { firstAdminStatus } = users;
    expect(await firstAdminStatus()).toMatch(/ready for first sign-in/);
    await expect(users.authenticate("founder@fairdeal.test", "not-the-initial-1")).rejects.toThrow(/ADMIN_INITIAL_PASSWORD exactly as saved/);
    sb.createUserError = "User not allowed";
    await expect(users.authenticate("founder@fairdeal.test", "Initial-Passw0rd")).rejects.toThrow(/SUPABASE_SERVICE_ROLE_KEY/);
    sb.createUserError = null;
    // Typed with a stray space: still recognised.
    expect((await users.authenticate("founder@fairdeal.test", " Initial-Passw0rd ")).id).toBe(founder.id);
    expect(await firstAdminStatus()).toBe("signed in before");
  });

  it("invites someone by email link; they choose a password and can then sign in", async () => {
    const { user, link } = await users.inviteUser(founder, { email: "Neha@Fairdeal.test", name: "Neha", role: "finance" });
    expect(link.emailed).toBe(true);
    expect(sent.at(-1)!.text).toContain(link.url);
    const { type, tokenHash } = tokenFrom(link.url);
    expect(type).toBe("invite");

    sb.session = null;
    await expect(users.authenticate("neha@fairdeal.test", "anything-123")).rejects.toThrow(/invite link/);
    expect(await supabaseAuth.confirmLink("invite", tokenHash)).toBe(true);
    expect(await currentUser()).toBeNull(); // not active until a password is set
    const pending = (await sessionUserAnyStatus())!;
    expect(pending).toMatchObject({ id: user.id, status: "invited" });
    await expect(users.finishPasswordSetup(pending, "short")).rejects.toThrow(/at least 10/);
    await users.finishPasswordSetup(pending, "Neha-Passw0rd-1");
    expect((await currentUser())?.id).toBe(user.id);

    // The link works once.
    sb.session = null;
    expect(await supabaseAuth.confirmLink("invite", tokenHash)).toBe(false);
    expect((await users.authenticate("neha@fairdeal.test", "Neha-Passw0rd-1")).role).toBe("finance");
  });

  it("re-inviting someone who already has a Supabase account sends a reset-style link", async () => {
    const { user } = await users.inviteUser(founder, { email: "ravi@fairdeal.test", name: "Ravi", role: "real_estate" });
    const link = await users.issueAccessLink(founder, user.id);
    expect(tokenFrom(link.url).type).toBe("recovery");
  });

  it("emails sign-in and reset links only to active people, without revealing who has access", async () => {
    const ops = await member("ops");
    await users.requestEmailLink("nobody@elsewhere.test", "signin");
    expect(sent).toHaveLength(0);
    await users.requestEmailLink(ops.email, "signin");
    const { type, tokenHash } = tokenFrom(sent.at(-1)!.text.match(/https?:\/\/\S+/)![0]);
    expect(type).toBe("magiclink");
    sb.session = null;
    await supabaseAuth.confirmLink("magiclink", tokenHash);
    expect((await currentUser())?.id).toBe(ops.id);

    await users.requestEmailLink(ops.email, "reset");
    expect(tokenFrom(sent.at(-1)!.text.match(/https?:\/\/\S+/)![0]).type).toBe("recovery");
  });

  it("blocks a disabled person at Supabase and in the portal, and lets them back when re-enabled", async () => {
    const sales = await member("sales");
    await users.authenticate(sales.email, "Member-Passw0rd");
    expect((await currentUser())?.id).toBe(sales.id);
    await users.setUserEnabled(founder, sales.id, false);
    expect(sb.accounts.get((await one<{ auth_id: string }>("SELECT auth_id FROM users WHERE id = ?", sales.id))!.auth_id)!.banned).toBe(true);
    expect(await currentUser()).toBeNull();
    await expect(users.authenticate(sales.email, "Member-Passw0rd")).rejects.toThrow(/disabled/);
    await users.setUserEnabled(founder, sales.id, true);
    expect((await users.authenticate(sales.email, "Member-Passw0rd")).id).toBe(sales.id);
  });

  it("gives a Supabase account nothing unless an access manager added that email", async () => {
    const stranger = newAccount("stranger@gmail.test", "Stranger-Passw0rd", true);
    sb.session = stranger.id; // e.g. after "Continue with Google"
    expect(await currentUser()).toBeNull();
    expect(await sessionUserAnyStatus()).toBeNull();
  });

  it("matches a first Google sign-in to the account added for that confirmed email", async () => {
    await run("INSERT INTO users (id, email, name, role, status, created_at) VALUES ('u-g', 'gita@fairdeal.test', 'Gita', 'ops', 'active', ?)", new Date().toISOString());
    const google = newAccount("gita@fairdeal.test", null, false);
    sb.session = google.id;
    expect(await currentUser()).toBeNull(); // email not confirmed yet
    google.confirmed = true;
    expect((await currentUser())?.id).toBe("u-g");
    expect((await one<{ auth_id: string }>("SELECT auth_id FROM users WHERE id = 'u-g'"))!.auth_id).toBe(google.id);
  });

  it("won't let a different Supabase account with the same email borrow someone's access", async () => {
    const fin = await member("finance");
    const account = byEmail(fin.email)!;
    await run("UPDATE users SET auth_id = 'some-other-account' WHERE id = ?", fin.id);
    sb.session = null;
    await expect(users.authenticate(fin.email, account.password!)).rejects.toThrow(/Incorrect/);
    expect(sb.session).toBeNull();
  });

  it("changes a password only with the current one", async () => {
    await expect(users.changePassword(founder, "not-it-123", "New-Passw0rd-22")).rejects.toThrow(/Current password/);
    await users.changePassword(founder, "Initial-Passw0rd", "New-Passw0rd-22");
    expect(byEmail(founder.email)!.password).toBe("New-Passw0rd-22");
  });
});

describe("Supabase Storage", () => {
  it("uploads straight to a private bucket through a signed URL, then checks the file", async () => {
    sb.bucket = { public: true, file_size_limit: null }; // someone made it public by mistake
    const re = await member("real_estate");
    const propertyId = await createProperty(re, INPUT);
    const plan = await beginUpload(re, { propertyId, category: "property_media", ownerId: null, name: "front.png", mime: "image/png", size: PNG.length });
    expect(plan.mode).toBe("supabase");
    expect(sb.bucket).toEqual({ public: false, file_size_limit: 50 * 1024 * 1024 });
    if (plan.mode !== "supabase") return;
    expect(plan.mime).toBe("image/png");

    browserUploads(plan.url, PNG, "image/png");
    const { id } = await completeUpload(re, plan.uploadId);
    const file = (await viewableFile(re, id))!;
    expect(file).toMatchObject({ storage: "supabase", size_bytes: PNG.length, etag: "etag-1" });
    const link = await storage.signedDownloadUrl("supabase", file.storage_key, file.original_name, file.mime, true);
    expect(link).toContain("expires=600");
    expect(link).toContain("download=front.png");
    expect((await emailAttachment(file)).href).toContain("expires=600");
  });

  it("refuses files over the plan's size limit and files whose contents don't match", async () => {
    const re = await member("real_estate");
    const propertyId = await createProperty(re, INPUT);
    await expect(
      beginUpload(re, { propertyId, category: "property_media", ownerId: null, name: "walkthrough.mp4", mime: "video/mp4", size: 60 * 1024 * 1024 }),
    ).rejects.toThrow(/50 MB per-file limit/);

    const plan = await beginUpload(re, { propertyId, category: "property_media", ownerId: null, name: "evil.png", mime: "image/png", size: 16 });
    if (plan.mode !== "supabase") throw new Error("expected Supabase");
    const key = sb.uploadUrls.get(plan.url)!;
    browserUploads(plan.url, new TextEncoder().encode("<script>alert(1)"), "image/png");
    await expect(completeUpload(re, plan.uploadId)).rejects.toThrow(/don't match/);
    expect(sb.objects.has(key)).toBe(false);
  });

  it("notices an upload that never arrived", async () => {
    const re = await member("real_estate");
    const propertyId = await createProperty(re, INPUT);
    const plan = await beginUpload(re, { propertyId, category: "property_media", ownerId: null, name: "a.png", mime: "image/png", size: 16 });
    await expect(completeUpload(re, plan.uploadId)).rejects.toThrow(/didn't arrive/);
  });
});
