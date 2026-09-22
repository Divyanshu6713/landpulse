import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Link, NavLink, useLocation, useNavigate } from 'react-router-dom';
import {
  BarChart3,
  Bell,
  BookOpen,
  BrainCircuit,
  ChevronRight,
  ChevronsLeft,
  ChevronsRight,
  ClipboardList,
  Database,
  FileBarChart,
  FileStack,
  FlaskConical,
  Globe2,
  History,
  KeyRound,
  LayoutDashboard,
  Layers3,
  LineChart,
  ListChecks,
  Loader2,
  LogOut,
  Map,
  Menu,
  Moon,
  Network,
  PlugZap,
  Repeat,
  Search,
  Settings2,
  ShieldAlert,
  Sun,
  FolderKanban,
  UserRound,
  X,
} from 'lucide-react';
import { cn } from '@/lib/cn';
import { Button, DemoDataBadge } from '@/components/ui';
import { RiskPill } from '@/components/ui/primitives';
import { Logo, LogoMark } from '@/components/layout/Logo';
import { ErrorBoundary } from '@/components/ui/ErrorBoundary';
import { useApi, useDebounced, useOnClickOutside, useTheme } from '@/hooks';
import { useAuth } from '@/auth/AuthContext';
import { fetchAlerts, fetchCases, fetchHealth, fetchNotifications, fetchProjects } from '@/api/client';
import { SEVERITY_CLASS } from '@/lib/status';
import { formatDate } from '@/lib/format';
import { BRAND } from '@/lib/brand';
import { PositionBreadcrumb } from '@/components/hierarchy/AdministrativeChain';

/* ------------------------------------------------------------ navigation */

interface NavItem {
  to: string;
  label: string;
  icon: typeof LayoutDashboard;
  badge?: number;
  urgent?: boolean;
  permission?: string;
}

interface NavGroupDef {
  label: string;
  items: NavItem[];
}

const NAV: NavGroupDef[] = [
  {
    label: 'Monitor',
    items: [
      { to: '/dashboard', label: 'Overview', icon: LayoutDashboard },
      { to: '/hierarchy', label: 'Portfolio', icon: Layers3 },
      { to: '/map', label: 'Risk map', icon: Globe2 },
    ],
  },
  {
    label: 'Acquisition',
    items: [
      { to: '/projects', label: 'Projects', icon: FolderKanban },
      { to: '/cases', label: 'Cases & parcels', icon: Map },
      { to: '/documents', label: 'Documents', icon: FileStack },
    ],
  },
  {
    label: 'Risk & action',
    items: [
      { to: '/risk', label: 'Risk analysis', icon: ShieldAlert },
      { to: '/predict', label: 'Scenario scoring', icon: FlaskConical },
      { to: '/queue', label: 'Interventions', icon: ListChecks },
      { to: '/alerts', label: 'Alerts', icon: Bell },
    ],
  },
  {
    label: 'Insights',
    items: [
      { to: '/trends', label: 'Trends & KPIs', icon: LineChart },
      { to: '/analytics', label: 'Analytics', icon: BarChart3 },
      { to: '/reports', label: 'Reports', icon: FileBarChart },
    ],
  },
  {
    label: 'Platform',
    items: [
      { to: '/data', label: 'Data & model', icon: Database },
      { to: '/data-sources', label: 'Data sources', icon: PlugZap },
      { to: '/registry', label: 'Authority registry', icon: Network },
      { to: '/integrations', label: 'APIs & security', icon: KeyRound },
    ],
  },
  {
    label: 'Administration',
    items: [
      { to: '/admin', label: 'Settings', icon: Settings2, permission: 'admin.view' },
      { to: '/learning', label: 'Model lifecycle', icon: BrainCircuit, permission: 'admin.view' },
      { to: '/audit', label: 'Audit trail', icon: History, permission: 'audit.view' },
    ],
  },
];

const PAGE_TITLES: Record<string, { title: string; subtitle: string }> = {
  '/dashboard': { title: 'Overview', subtitle: 'Where land acquisition is likely to slip in your jurisdiction, and what needs attention first.' },
  '/hierarchy': { title: 'Portfolio', subtitle: 'Drill from India to sector, State, district and project on the same prediction engine.' },
  '/data-sources': { title: 'Data sources', subtitle: 'Where the data comes from, provider contracts, and the path to official government sources.' },
  '/projects': { title: 'Projects', subtitle: 'Every acquisition project in scope, ranked by the risk of missing its next statutory milestone.' },
  '/projects/new': { title: 'New project', subtitle: 'Validated against the authority registry, geography and lifecycle rules before it is scored.' },
  '/cases': { title: 'Cases & parcels', subtitle: 'Parcel-level acquisition cases with predicted milestone risk.' },
  '/predict': { title: 'Scenario scoring', subtitle: 'Describe a project, adjust its signals, and see how the predicted risk responds.' },
  '/risk': { title: 'Risk analysis', subtitle: 'Which stages, factors and projects are driving predicted delay.' },
  '/queue': { title: 'Interventions', subtitle: 'Recommended actions with owners, due dates and workflow status.' },
  '/alerts': { title: 'Alerts', subtitle: 'Rule-driven alerts on risk, deadlines, blockages and backlogs in your jurisdiction.' },
  '/map': { title: 'Risk map', subtitle: 'Risk concentration from State to district to project, on administrative boundaries.' },
  '/analytics': { title: 'Analytics', subtitle: 'Stage throughput, district performance and model behaviour.' },
  '/trends': { title: 'Trends & KPIs', subtitle: 'Observed delay history and model forecast by State and district, with performance indicators.' },
  '/learning': { title: 'Model lifecycle', subtitle: 'New outcomes, live monitoring, drift, gated retraining, version registry and rollback.' },
  '/integrations': { title: 'APIs & security', subtitle: 'Integration API, API keys, security posture and audit integrity.' },
  '/data': { title: 'Data & model', subtitle: 'Dataset composition, data quality, model card and exports.' },
  '/reports': { title: 'Reports', subtitle: 'Review packs and dataset exports.' },
  '/documents': { title: 'Documents', subtitle: 'Notifications, awards, land records and survey documents by project, stage and case.' },
  '/registry': { title: 'Authority registry', subtitle: 'Frameworks, project-type dependencies, issues and State profiles that decide who owns each step.' },
  '/admin': { title: 'Settings', subtitle: 'Projects, CSV upload, retraining, model metrics and data consistency.' },
  '/audit': { title: 'Audit trail', subtitle: 'Every recorded change, with user, role, before and after.' },
  '/profile': { title: 'My profile', subtitle: 'Your administrative position, scope, portfolio and assignments.' },
  '/about': { title: 'Methodology', subtitle: 'How LandPulse AI produces, explains and bounds its forecasts.' },
};

const COLLAPSE_KEY = 'bp-sidebar-collapsed';

function readCollapsed() {
  try {
    return localStorage.getItem(COLLAPSE_KEY) === '1';
  } catch {
    return false;
  }
}

function SideNav({ groups, collapsed, onNavigate }: { groups: NavGroupDef[]; collapsed: boolean; onNavigate?: () => void }) {
  return (
    <nav aria-label="Main" className="space-y-5">
      {groups.map((group) => (
        <div key={group.label}>
          {collapsed ? <div className="mx-3 mb-2 border-t border-line" aria-hidden /> : <p className="mb-1 px-3 text-2xs font-medium text-ink-3">{group.label}</p>}
          <ul className="space-y-px">
            {group.items.map(({ to, label, icon: Icon, badge, urgent }) => (
              <li key={to}>
                <NavLink
                  to={to}
                  onClick={onNavigate}
                  title={collapsed ? label : undefined}
                  aria-label={collapsed ? label : undefined}
                  className={({ isActive }) =>
                    cn(
                      'group relative flex h-8 items-center gap-2.5 rounded-md text-sm transition-colors duration-150 focus-ring',
                      collapsed ? 'mx-auto w-9 justify-center' : 'px-2.5',
                      isActive ? 'bg-brand-soft font-medium text-brand-ink' : 'text-ink-2 hover:bg-surface-3 hover:text-ink',
                    )
                  }
                >
                  {({ isActive }) => (
                    <>
                      <Icon className={cn('h-4 w-4 shrink-0', isActive ? 'text-brand' : 'text-ink-3 group-hover:text-ink-2')} aria-hidden />
                      {!collapsed && <span className="truncate">{label}</span>}
                      {typeof badge === 'number' && badge > 0 &&
                        (collapsed ? (
                          <span className={cn('absolute right-1 top-1 h-1.5 w-1.5 rounded-full', urgent ? 'bg-red-500' : 'bg-brand')} aria-hidden />
                        ) : (
                          <span className={cn('ml-auto rounded px-1.5 text-2xs font-medium leading-4 num', urgent ? 'bg-red-50 text-red-700 dark:bg-red-400/10 dark:text-red-300' : 'bg-surface-3 text-ink-2')}>
                            {badge > 999 ? `${(badge / 1000).toFixed(1)}k` : badge}
                          </span>
                        ))}
                    </>
                  )}
                </NavLink>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </nav>
  );
}

/* ---------------------------------------------------------------- search */

function GlobalSearch({ autoFocus = false, onDone }: { autoFocus?: boolean; onDone?: () => void }) {
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const navigate = useNavigate();
  const input = useRef<HTMLInputElement>(null);
  const ref = useOnClickOutside<HTMLDivElement>(() => setOpen(false));
  const debounced = useDebounced(query.trim(), 260);
  const enabled = debounced.length >= 2;

  const projects = useApi((signal) => (enabled ? fetchProjects({ q: debounced, pageSize: 5 }, signal) : Promise.resolve(null)), [debounced, enabled]);
  const cases = useApi((signal) => (enabled ? fetchCases({ q: debounced, pageSize: 4, status: 'all' }, signal) : Promise.resolve(null)), [debounced, enabled]);

  useEffect(() => {
    if (autoFocus) input.current?.focus();
  }, [autoFocus]);

  // "/" or Ctrl/⌘+K focuses search from anywhere outside a form field.
  useEffect(() => {
    if (autoFocus) return;
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      const typing = /input|textarea|select/i.test(target.tagName) || target.isContentEditable;
      if ((e.key === 'k' && (e.metaKey || e.ctrlKey)) || (e.key === '/' && !typing)) {
        e.preventDefault();
        input.current?.focus();
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [autoFocus]);

  const hasResults = (projects.data?.projects.length ?? 0) > 0 || (cases.data?.rows.length ?? 0) > 0;
  const busy = enabled && (projects.loading || cases.loading || projects.refreshing || cases.refreshing);
  const go = (to: string) => {
    navigate(to);
    setOpen(false);
    setQuery('');
    onDone?.();
  };

  return (
    <div ref={ref} className="relative w-full" onKeyDown={(e) => e.key === 'Escape' && (setOpen(false), input.current?.blur(), onDone?.())}>
      <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-3" aria-hidden />
      <input
        ref={input}
        type="search"
        value={query}
        onChange={(e) => {
          setQuery(e.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        aria-label="Search projects and cases"
        placeholder="Search projects, districts, case IDs…"
        className="h-9 w-full rounded-lg border border-line bg-surface-2 pl-8 pr-12 text-sm text-ink placeholder:text-ink-3 transition-colors hover:border-line-strong focus:border-brand focus:bg-surface focus:outline-none focus:ring-[3px] focus:ring-brand/15"
      />
      {busy ? (
        <Loader2 className="absolute right-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 animate-spin text-ink-3" />
      ) : (
        !autoFocus && <kbd className="pointer-events-none absolute right-2 top-1/2 hidden -translate-y-1/2 rounded border border-line bg-surface px-1.5 font-sans text-2xs text-ink-3 lg:block">Ctrl K</kbd>
      )}

      {open && enabled && (
        <div className="absolute left-0 right-0 top-11 z-50 max-h-[420px] overflow-y-auto rounded-lg border border-line bg-surface p-1 shadow-pop animate-scale-in">
          {!hasResults && !busy && <p className="px-3 py-6 text-center text-sm text-ink-3">No projects or cases match “{debounced}” in your jurisdiction.</p>}
          {(projects.data?.projects.length ?? 0) > 0 && (
            <>
              <p className="px-2.5 pb-1 pt-2 text-2xs font-medium text-ink-3">Projects</p>
              {projects.data!.projects.map((p) => (
                <button key={p.id} type="button" onClick={() => go(`/projects/${p.id}`)} className="flex w-full items-center gap-3 rounded-md px-2.5 py-2 text-left transition-colors hover:bg-surface-3 focus:bg-surface-3 focus:outline-none">
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm text-ink">{p.name}</span>
                    <span className="block truncate text-xs text-ink-3">
                      {p.id} · {p.state}
                    </span>
                  </span>
                  <RiskPill level={p.riskBand} score={p.riskScore} size="sm" />
                </button>
              ))}
            </>
          )}
          {(cases.data?.rows.length ?? 0) > 0 && (
            <>
              <p className="px-2.5 pb-1 pt-2 text-2xs font-medium text-ink-3">Cases</p>
              {cases.data!.rows.map((c) => (
                <button key={c.caseId} type="button" onClick={() => go(`/cases/${c.caseId}`)} className="flex w-full items-center gap-3 rounded-md px-2.5 py-2 text-left transition-colors hover:bg-surface-3 focus:bg-surface-3 focus:outline-none">
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm text-ink">
                      {c.village}, {c.district}
                    </span>
                    <span className="block truncate font-mono text-xs text-ink-3">{c.caseId}</span>
                  </span>
                  <RiskPill level={c.riskBand} score={c.riskScore} size="sm" />
                </button>
              ))}
            </>
          )}
        </div>
      )}
    </div>
  );
}

/* --------------------------------------------------------- notifications */

function NotificationsMenu({ total, summary }: { total: number; summary: string }) {
  const [open, setOpen] = useState(false);
  const ref = useOnClickOutside<HTMLDivElement>(() => setOpen(false));
  const alerts = useApi((signal) => (open ? fetchAlerts({ status: 'UNREAD', focus: '1', pageSize: 6 }, signal) : Promise.resolve(null)), [open]);

  return (
    <div ref={ref} className="relative" onKeyDown={(e) => e.key === 'Escape' && setOpen(false)}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-label={`Notifications, ${total} unread`}
        aria-expanded={open}
        className="relative grid h-9 w-9 place-items-center rounded-lg text-ink-2 transition-colors hover:bg-surface-3 hover:text-ink focus-ring"
      >
        <Bell className="h-[18px] w-[18px]" />
        {total > 0 && <span className="absolute right-1.5 top-1.5 h-2 w-2 rounded-full bg-red-500 ring-2 ring-surface" aria-hidden />}
      </button>

      {open && (
        <div className="absolute right-0 top-11 z-50 w-[360px] max-w-[calc(100vw-1.5rem)] overflow-hidden rounded-lg border border-line bg-surface shadow-pop animate-scale-in">
          <div className="border-b border-line px-4 py-3">
            <p className="text-sm font-semibold text-ink">Notifications</p>
            <p className="mt-0.5 text-xs text-ink-3">{summary}</p>
          </div>
          <div className="max-h-[340px] overflow-y-auto">
            {(alerts.data?.items ?? []).map((a) => (
              <Link key={a.id} to={a.link} onClick={() => setOpen(false)} className="flex gap-3 border-b border-line px-4 py-3 transition-colors last:border-0 hover:bg-surface-2">
                <span className={cn('mt-0.5 h-fit rounded border px-1.5 text-2xs font-medium leading-4', SEVERITY_CLASS[a.severity])}>{a.severity}</span>
                <div className="min-w-0">
                  <p className="truncate text-sm text-ink">{a.title}</p>
                  <p className="truncate text-xs text-ink-3">
                    {a.project.name} · {formatDate(a.date)}
                  </p>
                </div>
              </Link>
            ))}
            {alerts.loading && (
              <div className="flex justify-center py-6">
                <Loader2 className="h-4 w-4 animate-spin text-ink-3" />
              </div>
            )}
            {!alerts.loading && (alerts.data?.items.length ?? 0) === 0 && <p className="px-4 py-8 text-center text-sm text-ink-3">You're all caught up — no unread alerts in your focus areas.</p>}
          </div>
          <div className="grid grid-cols-2 divide-x divide-line border-t border-line bg-surface-2">
            <Link to="/alerts" onClick={() => setOpen(false)} className="flex items-center justify-center gap-1 px-4 py-2.5 text-sm font-medium text-brand hover:bg-surface-3">
              All alerts <ChevronRight className="h-3.5 w-3.5" />
            </Link>
            <Link to="/queue?mine=1" onClick={() => setOpen(false)} className="flex items-center justify-center gap-1 px-4 py-2.5 text-sm font-medium text-brand hover:bg-surface-3">
              My actions <ChevronRight className="h-3.5 w-3.5" />
            </Link>
          </div>
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------- user menu */

function UserMenu() {
  const [open, setOpen] = useState(false);
  const ref = useOnClickOutside<HTMLDivElement>(() => setOpen(false));
  const { user, signOut } = useAuth();
  const { theme, toggle } = useTheme();
  const navigate = useNavigate();
  if (!user) return null;
  const initials = user.name
    .split(/[\s.]+/)
    .filter(Boolean)
    .map((w) => w[0])
    .join('')
    .slice(0, 2)
    .toUpperCase();

  const item = 'flex w-full items-center gap-2.5 rounded-md px-2.5 py-2 text-sm text-ink-2 hover:bg-surface-3 hover:text-ink focus:bg-surface-3 focus:outline-none';

  return (
    <div ref={ref} className="relative" onKeyDown={(e) => e.key === 'Escape' && setOpen(false)}>
      <button type="button" onClick={() => setOpen((o) => !o)} aria-expanded={open} aria-label="Account menu" className="flex items-center gap-2 rounded-lg py-1 pl-1 pr-1 transition-colors hover:bg-surface-3 focus-ring lg:pr-2.5">
        <span className="grid h-7 w-7 place-items-center rounded-full bg-slate-700 text-2xs font-semibold text-white dark:bg-slate-600">{initials}</span>
        <span className="hidden max-w-[180px] text-left leading-tight lg:block">
          <span className="block truncate text-sm font-medium text-ink">{user.name}</span>
          <span className="block truncate text-2xs text-ink-3">Demo · {user.roleLabel}</span>
        </span>
      </button>

      {open && (
        <div className="absolute right-0 top-11 z-50 w-72 overflow-hidden rounded-lg border border-line bg-surface p-1 shadow-pop animate-scale-in">
          <div className="border-b border-line px-2.5 pb-3 pt-2">
            <p className="text-sm font-medium text-ink">{user.name}</p>
            <p className="text-xs text-ink-3">{user.designation}</p>
            <p className="mt-1 text-xs text-ink-2">
              {user.roleLabel} · {user.scopeLabel}
            </p>
            <PositionBreadcrumb position={user.position} className="mt-1 text-2xs" />
          </div>
          <div className="py-1">
            <button
              type="button"
              onClick={() => {
                setOpen(false);
                navigate('/profile');
              }}
              className={item}
            >
              <UserRound className="h-4 w-4" /> Profile & assignments
            </button>
            <Link to="/about" onClick={() => setOpen(false)} className={item}>
              <BookOpen className="h-4 w-4" /> Methodology
            </Link>
            <button type="button" onClick={toggle} className={item}>
              {theme === 'dark' ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />} {theme === 'dark' ? 'Light' : 'Dark'} appearance
            </button>
          </div>
          <div className="border-t border-line pt-1">
            <button
              type="button"
              onClick={() => {
                setOpen(false);
                navigate('/login/profile?switch=1');
              }}
              className={item}
            >
              <Repeat className="h-4 w-4" /> Switch demo profile
            </button>
            <button
              type="button"
              onClick={async () => {
                setOpen(false);
                await signOut();
                navigate('/login');
              }}
              className={item}
            >
              <LogOut className="h-4 w-4" /> Sign out
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

/* ----------------------------------------------------------------- shell */

export function AppShell({ children }: { children: ReactNode }) {
  const [mobileOpen, setMobileOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [collapsed, setCollapsed] = useState(readCollapsed);
  const { pathname } = useLocation();
  const { can } = useAuth();

  // Theme is applied here too so a saved preference holds on every screen.
  useTheme();

  const health = useApi((signal) => fetchHealth(signal), []);
  const notifications = useApi((signal) => fetchNotifications(signal), [pathname]);

  useEffect(() => {
    setMobileOpen(false);
    setSearchOpen(false);
  }, [pathname]);

  useEffect(() => {
    if (!mobileOpen) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setMobileOpen(false);
    document.addEventListener('keydown', onKey);
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = '';
    };
  }, [mobileOpen]);

  const toggleCollapsed = useCallback(() => {
    setCollapsed((c) => {
      try {
        localStorage.setItem(COLLAPSE_KEY, c ? '0' : '1');
      } catch {
        /* preference simply does not persist */
      }
      return !c;
    });
  }, []);

  const groups = useMemo(() => {
    const openAssigned = notifications.data?.openAssigned ?? 0;
    const unreadAlerts = notifications.data?.unreadAlerts ?? 0;
    return NAV.map((g) => ({
      ...g,
      items: g.items
        .filter((n) => !n.permission || can(n.permission))
        .map((n) => (n.to === '/queue' ? { ...n, badge: openAssigned } : n.to === '/alerts' ? { ...n, badge: unreadAlerts, urgent: true } : n)),
    })).filter((g) => g.items.length > 0);
  }, [notifications.data, can]);

  const page =
    PAGE_TITLES[pathname] ??
    (pathname.endsWith('/edit')
      ? { title: 'Edit project', subtitle: 'Changes are validated, re-scored and written to the audit trail.' }
      : pathname.startsWith('/projects/') || pathname.startsWith('/cases/')
        ? null // detail screens render their own header
        : { title: BRAND.product, subtitle: BRAND.descriptor });

  const n = notifications.data;
  const notificationSummary = `${n?.unreadAlerts ?? 0} unread alerts · ${n?.openAssigned ?? 0} actions assigned to your role · ${n?.unreadMessages ?? 0} messages`;
  const online = Boolean(health.data?.ok);

  const status = (
    <div className={cn('flex items-center gap-2 text-2xs text-ink-3', collapsed && 'justify-center')} title={health.data ? `${health.data.rows.toLocaleString('en-IN')} cases · ${health.data.projects} projects` : undefined}>
      <span className={cn('h-1.5 w-1.5 shrink-0 rounded-full', online ? 'bg-emerald-500' : health.loading ? 'bg-slate-400' : 'bg-red-500')} aria-hidden />
      {!collapsed && <span className="truncate">{online ? `Service online · ${health.data?.today ? formatDate(health.data.today) : ''}` : health.loading ? 'Connecting…' : 'Service unreachable'}</span>}
    </div>
  );

  return (
    <div className="min-h-screen bg-bg">
      <a href="#main" className="sr-only focus:not-sr-only focus:fixed focus:left-3 focus:top-3 focus:z-[100] focus:rounded-md focus:bg-surface focus:px-3 focus:py-2 focus:text-sm focus:shadow-pop">
        Skip to content
      </a>

      {/* Desktop sidebar */}
      <aside className={cn('fixed inset-y-0 left-0 z-30 hidden flex-col border-r border-line bg-surface transition-[width] duration-200 lg:flex', collapsed ? 'w-[60px]' : 'w-60')}>
        <div className={cn('flex h-14 shrink-0 items-center border-b border-line', collapsed ? 'justify-center' : 'px-4')}>
          <Link to="/dashboard" className="rounded-md focus-ring" aria-label={`${BRAND.product} overview`}>
            {collapsed ? <LogoMark className="h-7 w-7" /> : <Logo />}
          </Link>
        </div>
        <div className={cn('flex-1 overflow-y-auto py-4', collapsed ? 'px-2' : 'px-3')}>
          <SideNav groups={groups} collapsed={collapsed} />
        </div>
        <div className={cn('space-y-2 border-t border-line py-3', collapsed ? 'px-2' : 'px-4')}>
          {status}
          <button
            type="button"
            onClick={toggleCollapsed}
            aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
            className={cn('flex h-8 items-center gap-2 rounded-md text-xs text-ink-3 transition-colors hover:bg-surface-3 hover:text-ink focus-ring', collapsed ? 'mx-auto w-9 justify-center' : '-mx-1.5 px-1.5')}
          >
            {collapsed ? <ChevronsRight className="h-4 w-4" /> : <ChevronsLeft className="h-4 w-4" />}
            {!collapsed && 'Collapse'}
          </button>
        </div>
      </aside>

      {/* Mobile drawer */}
      {mobileOpen && (
        <div className="fixed inset-0 z-[60] lg:hidden" role="dialog" aria-modal="true" aria-label="Navigation">
          <div className="absolute inset-0 bg-slate-900/40 animate-fade-in" onClick={() => setMobileOpen(false)} aria-hidden />
          <div className="absolute inset-y-0 left-0 flex w-[280px] max-w-[85vw] flex-col bg-surface shadow-pop animate-slide-in-left">
            <div className="flex h-14 shrink-0 items-center justify-between border-b border-line px-4">
              <Logo />
              <button type="button" onClick={() => setMobileOpen(false)} className="grid h-9 w-9 place-items-center rounded-lg text-ink-2 hover:bg-surface-3 focus-ring" aria-label="Close navigation">
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="flex-1 overflow-y-auto px-3 py-4">
              <SideNav groups={groups} collapsed={false} onNavigate={() => setMobileOpen(false)} />
            </div>
            <div className="border-t border-line px-4 py-3">{status}</div>
          </div>
        </div>
      )}

      <div className={cn('flex min-h-screen min-w-0 flex-col transition-[padding] duration-200', collapsed ? 'lg:pl-[60px]' : 'lg:pl-60')}>
        <header className="sticky top-0 z-40 border-b border-line bg-surface/95 backdrop-blur supports-[backdrop-filter]:bg-surface/85">
          <div className="flex h-14 items-center gap-2 px-3 sm:px-6">
            <button type="button" onClick={() => setMobileOpen(true)} className="grid h-9 w-9 shrink-0 place-items-center rounded-lg text-ink-2 hover:bg-surface-3 focus-ring lg:hidden" aria-label="Open navigation">
              <Menu className="h-5 w-5" />
            </button>
            <Link to="/dashboard" className="rounded-md focus-ring lg:hidden" aria-label={`${BRAND.product} overview`}>
              <LogoMark className="h-7 w-7 sm:hidden" />
              <Logo className="hidden sm:flex" />
            </Link>
            <div className="ml-2 hidden w-full max-w-md md:block lg:ml-0">
              <GlobalSearch />
            </div>
            <div className="flex-1" />
            <div className="flex shrink-0 items-center gap-1">
              <DemoDataBadge className="mr-2 hidden xl:inline-flex" />
              <button type="button" onClick={() => setSearchOpen((o) => !o)} className="grid h-9 w-9 place-items-center rounded-lg text-ink-2 hover:bg-surface-3 focus-ring md:hidden" aria-label="Search" aria-expanded={searchOpen}>
                <Search className="h-[18px] w-[18px]" />
              </button>
              <NotificationsMenu total={(n?.unreadAlerts ?? 0) + (n?.unreadMessages ?? 0)} summary={notificationSummary} />
              <UserMenu />
            </div>
          </div>
          {searchOpen && (
            <div className="border-t border-line px-3 py-2 md:hidden">
              <GlobalSearch autoFocus onDone={() => setSearchOpen(false)} />
            </div>
          )}
        </header>

        <main id="main" tabIndex={-1} className="mx-auto w-full max-w-[1440px] flex-1 px-4 pb-12 pt-6 outline-none sm:px-6 lg:px-8 lg:pt-8">
          {page && (
            <div className="mb-6 flex flex-wrap items-end justify-between gap-x-6 gap-y-3">
              <div className="min-w-0 max-w-3xl">
                <h1 className="text-2xl font-semibold tracking-tight text-ink">{page.title}</h1>
                {page.subtitle && <p className="mt-1 text-base text-ink-3">{page.subtitle}</p>}
              </div>
              {(n?.openAssigned ?? 0) > 0 && pathname !== '/queue' && (
                <Link to="/queue?mine=1" className="shrink-0">
                  <Button size="sm" variant="secondary" tabIndex={-1}>
                    <ClipboardList className="h-3.5 w-3.5" /> My actions
                    <span className="rounded bg-surface-3 px-1.5 text-xs text-ink-2 num">{n?.openAssigned}</span>
                  </Button>
                </Link>
              )}
            </div>
          )}
          <ErrorBoundary resetKey={pathname}>{children}</ErrorBoundary>
        </main>

        <footer className="border-t border-line">
          <div className="mx-auto flex max-w-[1440px] flex-col gap-1.5 px-4 py-4 text-xs text-ink-3 sm:flex-row sm:items-center sm:justify-between sm:px-6 lg:px-8">
            <p>
              Synthetic demonstration data — not an official acquisition record; no government system is connected.{' '}
              <Link to="/data-sources" className="link">
                About the data
              </Link>
            </p>
            <p className="shrink-0">
              {BRAND.product} {BRAND.version} · {BRAND.attribution}
            </p>
          </div>
        </footer>
      </div>
    </div>
  );
}
