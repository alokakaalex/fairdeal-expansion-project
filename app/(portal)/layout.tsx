import { logout } from "@/app/actions/auth";
import AppShell from "@/components/portal/AppShell";
import { config } from "@/lib/server/config";
import { requireUser } from "@/lib/server/session";

// Every page in this group also checks its own role; this layout supplies
// the branded shell (sidebar, top bar).
export default async function PortalLayout({ children }: LayoutProps<"/">) {
  const user = await requireUser();
  const banner = config.demoMode ? (
    <div className="flex flex-wrap items-center justify-center gap-x-2 bg-brand-400 px-4 py-1.5 text-center text-xs font-semibold text-navy-950">
      <span>Demo environment — sample data that resets from time to time. Don&apos;t upload real documents.</span>
      <form action={logout}>
        <button type="submit" className="underline underline-offset-2">
          Switch role
        </button>
      </form>
    </div>
  ) : null;
  return (
    <AppShell user={user} banner={banner}>
      {children}
    </AppShell>
  );
}
