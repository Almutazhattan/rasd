import Link from 'next/link';
import { redirect } from 'next/navigation';
import type { ReactNode } from 'react';
import { currentSession, requireAuth } from '@/server/http/context';
import { LogoutButton } from '@/components/client/forms';
import { unreadCount } from '@/server/notifications';
import { userWorkspaces } from '@/lib/tenancy';
import { ROLE_LABELS } from '@/lib/rbac';
import { aiState } from '@/lib/env';
import { IntegrationBadge } from '@/components/ui';

export const dynamic = 'force-dynamic';

const NAV: { href: string; label: string; group: string }[] = [
  { href: '/app/dashboard', label: 'اللوحة', group: 'العمل' },
  { href: '/app/opportunities', label: 'الفرص', group: 'العمل' },
  { href: '/app/reports', label: 'التقارير', group: 'العمل' },
  { href: '/app/approvals', label: 'الموافقات', group: 'المراجعة' },
  { href: '/app/agents', label: 'الوكلاء', group: 'المراجعة' },
  { href: '/app/notifications', label: 'التنبيهات', group: 'المراجعة' },
  { href: '/app/company', label: 'المنشأة', group: 'الإعداد' },
  { href: '/app/company/documents', label: 'وثائق المنشأة', group: 'الإعداد' },
  { href: '/app/team', label: 'الفريق', group: 'الإعداد' },
  { href: '/app/settings', label: 'الإعدادات', group: 'الإعداد' },
];

const GROUPS = ['العمل', 'المراجعة', 'الإعداد'];

export default async function AppLayout({ children }: { children: ReactNode }) {
  const session = await currentSession();
  if (!session) redirect('/login');
  if (!session.orgId) redirect('/onboarding');

  const ctx = await requireAuth();
  const [unread, workspaces] = await Promise.all([
    unreadCount(ctx, ctx.userId),
    userWorkspaces(ctx.userId),
  ]);
  const workspace = workspaces.find((w) => w.id === ctx.orgId);

  return (
    <div className="min-h-screen lg:grid lg:grid-cols-[17rem,1fr]">
      <aside className="panel sticky top-0 z-40 lg:h-screen lg:overflow-y-auto">
        <div className="flex items-center justify-between gap-4 px-6 py-6">
          <Link href="/app/dashboard" className="flex items-baseline gap-2.5">
            <span className="text-lg font-semibold">RASD</span>
            <span className="font-light text-blue-soft">رَصْد</span>
          </Link>
          <LogoutButton />
        </div>

        <div className="px-6">
          <div className="rounded-xl border border-white/[.07] bg-white/[.02] p-4">
            <div className="lbl text-[10px]">مساحة العمل</div>
            <div className="mt-2 truncate text-sm">{workspace?.name ?? '—'}</div>
            <div className="mt-2 text-xs text-muted">{ROLE_LABELS[ctx.role].ar}</div>
          </div>
        </div>

        <nav className="px-3 py-7">
          {GROUPS.map((group) => (
            <div key={group} className="mb-7">
              <div className="lbl px-3 text-[10px]">{group}</div>
              <ul className="mt-3 space-y-1">
                {NAV.filter((n) => n.group === group).map((item) => (
                  <li key={item.href}>
                    <Link
                      href={item.href}
                      className="flex items-center justify-between rounded-xl px-3 py-2.5 text-sm text-muted transition-colors hover:bg-white/[.04] hover:text-ink"
                    >
                      <span>{item.label}</span>
                      {item.href === '/app/notifications' && unread > 0 && (
                        <span className="chip border border-blue/40 text-[10px] text-blue-soft tnum">{unread}</span>
                      )}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </nav>

        <div className="px-6 pb-8">
          <IntegrationBadge state={aiState()} label="مزوّد الذكاء" />
        </div>
      </aside>

      <main className="min-w-0 px-6 py-10 lg:px-10 lg:py-14">{children}</main>
    </div>
  );
}
