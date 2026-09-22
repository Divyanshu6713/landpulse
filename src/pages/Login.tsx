import { lazy, Suspense, useEffect, useMemo, useRef, useState } from 'react';
import { Navigate, useSearchParams } from 'react-router-dom';
import { ArrowRight, Building2, Check, ChevronRight, Eye, EyeOff, Info, Landmark, Loader2, Search, SlidersHorizontal, TriangleAlert, Users, UserX } from 'lucide-react';
import { cn } from '@/lib/cn';
import { Badge, Button, DemoDataBadge, EmptyState, Select, Skeleton, Tabs } from '@/components/ui';
import { AdministrativeChain, PositionBreadcrumb } from '@/components/hierarchy/AdministrativeChain';
import { useApi } from '@/hooks';
import { useAuth } from '@/auth/AuthContext';
import { fetchDemoUsers, fetchHierarchy, fetchHierarchyOptions } from '@/api/client';
import { BRAND } from '@/lib/brand';
import { PortalLink, usePortal } from '@/components/transition/Portal';
import { EXPERIENCE_HOME, homePath } from '@/lib/homeView';
import { consumeSessionExpired, setDemoPassword } from '@/auth/demoSession';

// The 3D band is decorative and lazy, so the sign-in form never waits for three.js.
const LoginHero = lazy(() => import('@/cinematic/LoginHero'));
import type { AuthorityTier, HierarchyConfig, RoleId, User } from '@/data/types';

type Mode = 'directory' | 'configure';

/** The default demo password (see server/lib/security.mjs); a deployment that overrides it via env just makes this prefill wrong, same as the existing hint text below. */
const DEMO_PASSWORD = 'LandPulse@2026';
const DEMO_ACCOUNT_ID = 'u-national';
const DEMO_ACCOUNT_LABEL = 'National Administrator';

const TIER_FILTERS: Array<{ id: 'all' | AuthorityTier; label: string }> = [
  { id: 'all', label: 'All levels' },
  { id: 'national', label: 'National' },
  { id: 'region', label: 'Region / Zone' },
  { id: 'state', label: 'State / UT' },
  { id: 'district', label: 'District' },
];

/**
 * Sign-in. A user picks a directory profile or configures a position anywhere
 * in the national hierarchy and authenticates with a password (scrypt-hashed
 * on the server, 5-attempt lockout, expiring sessions). Directory profiles
 * start on the deployment's demo password and can set their own; a production
 * deployment replaces this step with government SSO. Either way the API
 * enforces the jurisdiction and permissions that come with the position.
 */
export default function Login() {
  const { user } = useAuth();
  const [params] = useSearchParams();
  const [mode, setMode] = useState<Mode>((params.get('mode') as Mode) === 'configure' ? 'configure' : 'directory');
  // A deep link to ?mode=... goes straight to the advanced form; everyone else starts simple.
  const [view, setView] = useState<'simple' | 'advanced'>(params.get('mode') ? 'advanced' : 'simple');
  const next = params.get('next') || '/dashboard';
  const [password, setPassword] = useState('');
  const [reveal, setReveal] = useState(false);
  const [showHint, setShowHint] = useState(false);
  const [needPassword, setNeedPassword] = useState(false);
  const passwordInput = useRef<HTMLInputElement>(null);
  // Already signed in when the page opened: go straight on. A fresh sign-in
  // plays the transition instead (see choose / submit below).
  const signedInOnArrival = useRef(!!user);
  // The logo returns to whichever homepage the visitor came from (standard or 3D).
  const home = useMemo(homePath, []);
  const expiredNotice = useMemo(consumeSessionExpired, []);

  if (user && signedInOnArrival.current) return <Navigate to={next} replace />;

  const requirePassword = () => {
    if (password) return true;
    setNeedPassword(true);
    passwordInput.current?.focus();
    return false;
  };

  return (
    <div className="flex min-h-screen flex-col bg-bg">
      <Suspense fallback={<div className="h-[300px] bg-[#05070a]" />}>
        <LoginHero>
          <div className="mx-auto flex h-16 max-w-6xl items-center justify-between gap-3 px-4 sm:px-6">
            <PortalLink to={home} variant={home === EXPERIENCE_HOME ? 'dive' : 'rise'} className="rounded-md focus-ring" aria-label={`${BRAND.product} home`}>
              <img src="/brand/landpulse-logo-on-dark.png" alt={BRAND.product} className="h-10 w-auto" width={560} height={221} />
            </PortalLink>
            <DemoDataBadge />
          </div>
          {view === 'simple' ? (
            <div className="mx-auto max-w-6xl px-4 pb-10 pt-10 sm:px-6 sm:pb-14 sm:pt-14">
              <p className="font-mono text-2xs uppercase tracking-[0.16em] text-[#72b8c8]">Welcome to {BRAND.product}</p>
              <h1 className="mt-3 font-grotesk text-5xl font-semibold tracking-tight text-white">Predictive intelligence for proactive land acquisition monitoring.</h1>
            </div>
          ) : (
            <div className="mx-auto max-w-6xl px-4 pb-10 pt-10 sm:px-6 sm:pb-14 sm:pt-14">
              <p className="font-mono text-2xs uppercase tracking-[0.16em] text-[#72b8c8]">{BRAND.product} · sign in</p>
              <h1 className="mt-3 font-grotesk text-5xl font-semibold tracking-tight text-white">Sign in</h1>
              <p className="mt-3 max-w-2xl text-md text-[#c3ced6]">
                Your administrative position decides what you see — a national authority sees every State and UT, a district officer sees their district. The API enforces the
                same scope.
              </p>
            </div>
          )}
        </LoginHero>
      </Suspense>
      <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-8 sm:px-6 sm:py-10">
        {view === 'simple' ? (
          <SimpleSignIn next={next} expiredNotice={expiredNotice} onUseAnother={() => setView('advanced')} />
        ) : (
          <ol className="space-y-8">
            <li>
              <StepHeading n={1} title="Enter your password" />
              <div className="mt-3 max-w-md">
                <label htmlFor="login-password" className="sr-only">
                  Password
                </label>
                <div className="relative">
                  <input
                    id="login-password"
                    ref={passwordInput}
                    type={reveal ? 'text' : 'password'}
                    autoComplete="current-password"
                    value={password}
                    onChange={(e) => {
                      setPassword(e.target.value);
                      if (e.target.value) setNeedPassword(false);
                    }}
                    aria-invalid={needPassword || undefined}
                    aria-describedby="login-password-help"
                    placeholder="Password"
                    className={cn('input h-10 pr-10', needPassword && 'border-red-500 focus:border-red-500 focus:ring-red-500/15')}
                  />
                  <button type="button" onClick={() => setReveal((r) => !r)} aria-label={reveal ? 'Hide password' : 'Show password'} className="absolute right-1 top-1/2 grid h-8 w-8 -translate-y-1/2 place-items-center rounded-md text-ink-3 hover:text-ink focus-ring">
                    {reveal ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </button>
                </div>
                <div id="login-password-help" className="mt-1.5">
                  {needPassword ? (
                    <p role="alert" className="flex items-center gap-1.5 text-sm text-red-700 dark:text-red-300">
                      <TriangleAlert className="h-3.5 w-3.5" /> Enter your password before choosing a profile.
                    </p>
                  ) : (
                    <button type="button" onClick={() => setShowHint((v) => !v)} aria-expanded={showHint} className="text-sm font-medium text-brand hover:underline">
                      {showHint ? 'Hide demo access details' : 'Using the demo deployment?'}
                    </button>
                  )}
                </div>
                {showHint && (
                  <div className="mt-3 flex gap-2.5 rounded-lg border border-line bg-surface px-3.5 py-3 text-sm text-ink-2">
                    <Info className="mt-0.5 h-4 w-4 shrink-0 text-ink-3" />
                    <p>
                      Every directory profile starts on the shared demo password <code className="rounded bg-surface-3 px-1.5 py-0.5 font-mono text-xs text-ink">LandPulse@2026</code> and can set its
                      own from My profile. Five wrong attempts lock a profile for five minutes; sessions expire after 60 idle minutes.
                    </p>
                  </div>
                )}
              </div>
            </li>

            <li>
              <StepHeading n={2} title="Choose who you are signing in as" />
              <div className="mt-3 inline-flex rounded-lg bg-surface-3 p-0.5" role="tablist" aria-label="Sign-in method">
                {(
                  [
                    ['directory', 'Directory profiles', Users],
                    ['configure', 'Configure a position', SlidersHorizontal],
                  ] as const
                ).map(([id, label, Icon]) => (
                  <button
                    key={id}
                    type="button"
                    role="tab"
                    aria-selected={mode === id}
                    onClick={() => setMode(id)}
                    className={cn('flex h-8 items-center gap-2 rounded-md px-3 text-sm font-medium transition-colors focus-ring', mode === id ? 'bg-surface text-ink shadow-xs' : 'text-ink-3 hover:text-ink')}
                  >
                    <Icon className="h-4 w-4" /> {label}
                  </button>
                ))}
              </div>
              <div className="mt-5">{mode === 'directory' ? <Directory next={next} password={password} requirePassword={requirePassword} /> : <Configure next={next} password={password} requirePassword={requirePassword} />}</div>
            </li>
          </ol>
        )}
      </main>

      <footer className="border-t border-line">
        <div className="mx-auto flex max-w-6xl flex-col gap-1.5 px-4 py-4 text-xs text-ink-3 sm:flex-row sm:items-center sm:justify-between sm:px-6">
          <p>Demonstration profiles and synthetic data. Names are illustrative personas, not real officials; no government identity system (SSO) is connected.</p>
          <p className="shrink-0">
            {BRAND.product} · {BRAND.attribution}
          </p>
        </div>
      </footer>
    </div>
  );
}

/* ------------------------------------------------------------ simple sign-in */

function SimpleSignIn({ next, expiredNotice, onUseAnother }: { next: string; expiredNotice: boolean; onUseAnother: () => void }) {
  const { signIn } = useAuth();
  const { go } = usePortal();
  const [password, setPassword] = useState(DEMO_PASSWORD);
  const [reveal, setReveal] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const enterDemo = async () => {
    setBusy(true);
    setError(null);
    try {
      await signIn(DEMO_ACCOUNT_ID, password);
      setDemoPassword(password);
      go(next === '/dashboard' ? '/login/profile' : `/login/profile?next=${encodeURIComponent(next)}`, 'dive');
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  };

  return (
    <div className="mx-auto max-w-md">
      {expiredNotice && (
        <p className="mb-4 flex items-center gap-1.5 rounded-lg border border-line bg-surface px-3.5 py-2.5 text-sm text-ink-2">
          <Info className="h-4 w-4 shrink-0 text-ink-3" /> Your demo session ended — sign in again.
        </p>
      )}
      <div className="card p-6">
        <p className="text-sm text-ink-2">
          You'll start as <span className="font-medium text-ink">{DEMO_ACCOUNT_LABEL}</span> — you'll choose a different perspective next.
        </p>

        <div className="mt-5">
          <label htmlFor="demo-password" className="mb-1.5 block text-sm font-medium text-ink">
            Password
          </label>
          <div className="relative">
            <input
              id="demo-password"
              type={reveal ? 'text' : 'password'}
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="input h-11 pr-10"
            />
            <button type="button" onClick={() => setReveal((r) => !r)} aria-label={reveal ? 'Hide password' : 'Show password'} className="absolute right-1 top-1/2 grid h-9 w-9 -translate-y-1/2 place-items-center rounded-md text-ink-3 hover:text-ink focus-ring">
              {reveal ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
            </button>
          </div>
        </div>

        {error && (
          <p role="alert" className="mt-3 flex items-start gap-1.5 text-sm text-red-700 dark:text-red-300">
            <TriangleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" /> {error}
          </p>
        )}

        <Button className="mt-5 w-full" size="lg" loading={busy} onClick={enterDemo}>
          {!busy && <ArrowRight className="h-4 w-4" />} Enter Demo
        </Button>
      </div>

      <button type="button" onClick={onUseAnother} className="mt-4 block w-full text-center text-sm font-medium text-ink-3 hover:text-ink hover:underline">
        Use another account
      </button>
    </div>
  );
}

function StepHeading({ n, title }: { n: number; title: string }) {
  return (
    <h2 className="flex items-center gap-2.5 text-md font-semibold text-ink">
      <span className="grid h-6 w-6 place-items-center rounded-full border border-line-strong bg-surface text-xs font-medium text-ink-2 num" aria-hidden>
        {n}
      </span>
      {title}
    </h2>
  );
}

/* ---------------------------------------------------------------- directory */

export function Directory({ next, password, requirePassword }: { next: string; password: string; requirePassword: () => boolean }) {
  const { signIn } = useAuth();
  const { go } = usePortal();
  const users = useApi((signal) => fetchDemoUsers(signal), []);
  const [tier, setTier] = useState<'all' | AuthorityTier>('all');
  const [query, setQuery] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const list = users.data?.users ?? [];
  const counts = useMemo(() => {
    const c: Record<string, number> = { all: list.length };
    for (const u of list) c[u.scope === 'division' ? 'district' : u.scope] = (c[u.scope === 'division' ? 'district' : u.scope] ?? 0) + 1;
    return c;
  }, [list]);

  const grouped = useMemo(() => {
    const q = query.trim().toLowerCase();
    const out = new Map<string, User[]>();
    for (const u of list) {
      const t = u.scope === 'division' ? 'district' : u.scope;
      if (tier !== 'all' && t !== tier) continue;
      if (q && !`${u.name} ${u.designation} ${u.department} ${u.roleLabel} ${u.scopeLabel}`.toLowerCase().includes(q)) continue;
      const key = u.position.governmentLevel === 'central' ? 'Government of India' : u.position.lineage.find((l) => l.kind === 'state_government')?.name ?? 'State governments';
      if (!out.has(key)) out.set(key, []);
      out.get(key)!.push(u);
    }
    return Array.from(out.entries()).sort((a, b) => (a[0] === 'Government of India' ? -1 : b[0] === 'Government of India' ? 1 : a[0].localeCompare(b[0])));
  }, [list, tier, query]);

  const choose = async (id: string) => {
    if (!requirePassword()) return;
    setBusy(id);
    setError(null);
    try {
      await signIn(id, password);
      go(next, 'rise');
    } catch (err) {
      setError((err as Error).message);
      setBusy(null);
    }
  };

  return (
    <div>
      <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <Tabs tabs={TIER_FILTERS.map((t) => ({ id: t.id, label: t.label, count: counts[t.id] ?? 0 }))} active={tier} onChange={(id) => setTier(id as 'all' | AuthorityTier)} />
        <div className="relative w-full md:w-72">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-3" aria-hidden />
          <input type="search" aria-label="Search profiles" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search ministry, State, role…" className="input pl-8" />
        </div>
      </div>

      {error && (
        <p role="alert" className="mt-4 flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 px-3.5 py-2.5 text-sm text-red-800 dark:border-red-400/25 dark:bg-red-400/10 dark:text-red-200">
          <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" /> {error}
        </p>
      )}

      {users.loading && (
        <div className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-3" aria-busy="true" aria-label="Loading profiles">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="card p-4">
              <Skeleton className="h-4 w-32" />
              <Skeleton className="mt-2 h-3 w-48" />
              <Skeleton className="mt-4 h-5 w-24" />
            </div>
          ))}
        </div>
      )}
      {users.error && (
        <div className="card mt-6">
          <EmptyState
            icon={<TriangleAlert />}
            title="Profiles could not be loaded"
            description="The sign-in service is not reachable. Check that the API is running, then try again."
            action={
              <Button variant="secondary" size="sm" onClick={users.reload}>
                Try again
              </Button>
            }
          />
        </div>
      )}
      {!users.loading && grouped.length === 0 && list.length > 0 && (
        <div className="card mt-6">
          <EmptyState icon={<UserX />} title="No profile matches" description="Try another administrative level or search term — or configure a position of your own." />
        </div>
      )}

      <div className="mt-6 space-y-7">
        {grouped.map(([group, members]) => (
          <section key={group} aria-label={group}>
            <h3 className="mb-2.5 flex items-center gap-2 text-sm font-medium text-ink-2">
              {group === 'Government of India' ? <Landmark className="h-4 w-4 text-ink-3" /> : <Building2 className="h-4 w-4 text-ink-3" />} {group}
              <span className="text-ink-3 num">{members.length}</span>
            </h3>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {members.map((u) => (
                <button
                  key={u.id}
                  type="button"
                  onClick={() => choose(u.id)}
                  disabled={busy !== null}
                  className={cn('group card flex flex-col p-4 text-left transition-[border-color,box-shadow] hover:border-brand/50 hover:shadow-card-hover focus-ring disabled:cursor-wait', busy === u.id && 'border-brand')}
                >
                  <div className="flex w-full items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="text-base font-semibold text-ink">{u.name}</p>
                      <p className="mt-0.5 text-sm text-ink-2">{u.designation}</p>
                    </div>
                    {busy === u.id ? <Loader2 className="h-4 w-4 shrink-0 animate-spin text-brand" /> : <ChevronRight className="h-4 w-4 shrink-0 text-ink-3 transition-transform group-hover:translate-x-0.5 group-hover:text-brand" />}
                  </div>
                  <p className="mt-1 text-xs text-ink-3">{u.department}</p>
                  <div className="mt-3 flex flex-wrap gap-1.5">
                    <Badge tone="brand">{u.roleLabel}</Badge>
                    <Badge>{u.position.tierLabel}</Badge>
                    {!u.permissions.length && <Badge>Read-only</Badge>}
                  </div>
                  <PositionBreadcrumb position={u.position} className="mt-2.5" />
                </button>
              ))}
            </div>
          </section>
        ))}
      </div>
    </div>
  );
}

/* ---------------------------------------------------------------- configure */

type Government = 'central' | 'state';

function Configure({ next, password, requirePassword }: { next: string; password: string; requirePassword: () => boolean }) {
  const { signInWithPosition } = useAuth();
  const { go } = usePortal();
  const config = useApi((signal) => fetchHierarchy(signal), []);
  const [government, setGovernment] = useState<Government>('central');
  const [ministry, setMinistry] = useState('in:morth');
  const [centralOrg, setCentralOrg] = useState('');
  const [stateName, setStateName] = useState('');
  const [stateOrg, setStateOrg] = useState('');
  const [units, setUnits] = useState<{ region?: string; state?: string; division?: string; district?: string }>({});
  const [role, setRole] = useState<RoleId | ''>('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const orgId = government === 'central' ? centralOrg || ministry : stateOrg || (stateName ? `st:${config.data?.states.find((s) => s.id === stateName)?.code}` : '');

  const options = useApi(
    (signal) => (orgId ? fetchHierarchyOptions({ orgId, ...units }, signal) : Promise.resolve(null)),
    [orgId, units.region, units.state, units.division, units.district],
  );

  // A role that is not held at the chosen tier is dropped rather than silently kept.
  useEffect(() => {
    const roles = options.data?.roles ?? [];
    if (roles.length && !roles.some((r) => r.id === role)) setRole(roles[0].id);
  }, [options.data?.roles, role]);

  const setUnit = (level: 'region' | 'state' | 'division' | 'district', value: string) => {
    setUnits((u) => {
      const order = ['region', 'state', 'division', 'district'] as const;
      const nextUnits = { ...u, [level]: value || undefined };
      for (const lv of order.slice(order.indexOf(level) + 1)) delete nextUnits[lv];
      return nextUnits;
    });
  };

  const submit = async () => {
    if (!orgId || !role) return;
    if (!requirePassword()) return;
    setBusy(true);
    setError(null);
    try {
      await signInWithPosition(role, { orgId, units }, password);
      go(next, 'rise');
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  };

  if (config.error)
    return (
      <div className="card">
        <EmptyState
          icon={<TriangleAlert />}
          title="The national hierarchy could not be loaded"
          description="Check that the API is running, then try again."
          action={
            <Button variant="secondary" size="sm" onClick={config.reload}>
              Try again
            </Button>
          }
        />
      </div>
    );
  if (!config.data)
    return (
      <div className="card space-y-4 p-5" aria-busy="true" aria-label="Loading hierarchy">
        <Skeleton className="h-4 w-40" />
        <Skeleton className="h-9 w-full" />
        <Skeleton className="h-9 w-2/3" />
      </div>
    );
  const h = config.data;

  return (
    <div className="grid gap-5 lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
      <div className="card divide-y divide-line">
        <Step title="Government" hint="Which government the position belongs to">
          <div className="grid gap-2 sm:grid-cols-2">
            {(
              [
                ['central', 'Central Government', 'Ministries and central organisations'],
                ['state', 'State / UT Government', 'All 28 States and 8 Union Territories'],
              ] as const
            ).map(([id, label, desc]) => (
              <button
                key={id}
                type="button"
                aria-pressed={government === id}
                onClick={() => {
                  setGovernment(id);
                  setUnits({});
                }}
                className={cn('rounded-lg border px-3 py-2.5 text-left transition-colors focus-ring', government === id ? 'border-brand bg-brand-soft/60' : 'border-line hover:border-line-strong hover:bg-surface-2')}
              >
                <span className="flex items-center justify-between gap-2 text-sm font-medium text-ink">
                  {label}
                  {government === id && <Check className="h-4 w-4 text-brand" />}
                </span>
                <span className="block text-xs text-ink-3">{desc}</span>
              </button>
            ))}
          </div>
        </Step>

        <Step title="Organisation" hint={government === 'central' ? 'Ministry, then optionally an organisation under it' : 'State or UT, then the department or agency'}>
          {government === 'central' ? (
            <CentralPicker
              h={h}
              ministry={ministry}
              centralOrg={centralOrg}
              onMinistry={(v) => {
                setMinistry(v);
                setCentralOrg('');
                setUnits({});
              }}
              onCentralOrg={(v) => {
                setCentralOrg(v);
                setUnits({});
              }}
            />
          ) : (
            <StatePicker
              h={h}
              stateName={stateName}
              stateOrg={stateOrg}
              onState={(v) => {
                setStateName(v);
                setStateOrg('');
                setUnits({});
              }}
              onStateOrg={(v) => {
                setStateOrg(v);
                setUnits({});
              }}
            />
          )}
        </Step>

        <Step title="Jurisdiction" hint="Leave a level on “All” to hold the position above it">
          {!orgId ? (
            <p className="text-sm text-ink-3">Choose an organisation first.</p>
          ) : !options.data ? (
            options.error ? <p className="text-sm text-red-700 dark:text-red-300">Levels for this organisation could not be loaded.</p> : <Skeleton className="h-9 w-full" />
          ) : (
            <div className="grid gap-3 sm:grid-cols-2">
              {(['region', 'state', 'division', 'district'] as const)
                .filter((lv) => options.data!.options[lv] !== undefined && (lv !== 'district' || options.data!.options.district!.length > 0))
                .map((lv) => {
                  const opts = options.data!.options[lv]!;
                  const fixed = lv === 'state' && government === 'state';
                  const label = lv === 'region' ? options.data!.position.chain.find((r) => r.level === 'region')?.label ?? 'Region / Zone' : lv === 'state' ? 'State / UT' : lv === 'division' ? 'Division' : 'District';
                  if (fixed) return null;
                  if (lv === 'division' && opts.length === 0) return null;
                  return (
                    <Select
                      key={lv}
                      label={label}
                      value={units[lv] ?? ''}
                      onChange={(v) => setUnit(lv, v)}
                      options={[
                        { label: { region: 'All regions / zones', state: 'All States & UTs', division: 'All divisions', district: 'All districts' }[lv], value: '' },
                        ...opts.map((o) => ({ label: `${o.label}${o.projects ? ` · ${o.projects} project${o.projects === 1 ? '' : 's'}` : ' · no demo projects'}`, value: o.id })),
                      ]}
                    />
                  );
                })}
            </div>
          )}
        </Step>

        <Step title="Role" hint="Roles normally held at this level">
          <Select label="Role" value={role} onChange={(v) => setRole(v as RoleId)} options={(options.data?.roles ?? []).map((r) => ({ label: r.permissions || /read-only/.test(r.label) ? r.label : `${r.label} (read-only)`, value: r.id }))} />
          {options.data && role && <p className="mt-1.5 text-xs text-ink-3">{options.data.roles.find((r) => r.id === role)?.summary}</p>}
        </Step>
      </div>

      <aside className="card flex flex-col p-5 lg:sticky lg:top-6 lg:self-start">
        <p className="text-xs font-medium text-ink-3">Position preview</p>
        {options.data ? (
          <>
            <p className="mt-1.5 text-md font-semibold text-ink">{options.data.position.organisation.name}</p>
            <div className="mt-2 flex flex-wrap gap-1.5">
              <Badge tone="brand">{options.data.position.tierLabel} scope</Badge>
              <Badge>{options.data.position.organisation.kindLabel}</Badge>
            </div>
            <AdministrativeChain position={options.data.position} className="mt-4" />
            <div className="mt-4 border-t border-line pt-3 text-sm text-ink-2">
              <p>
                <span className="text-lg font-semibold text-ink num">{options.data.projectsInPosition}</span> demo project{options.data.projectsInPosition === 1 ? '' : 's'} in this scope
              </p>
              <p className="mt-0.5 text-xs text-ink-3">Portfolio: {options.data.position.portfolio.label}</p>
              {options.data.projectsInPosition === 0 && <p className="mt-2 text-xs text-amber-800 dark:text-amber-300">The synthetic dataset has no projects here. The position still works; screens will show empty states.</p>}
            </div>
            {options.data.position.organisation.illustrative && <p className="mt-2 text-xs text-ink-3">{options.data.position.organisation.description}</p>}
          </>
        ) : (
          <p className="mt-2 text-sm text-ink-3">Choose an organisation to preview the position.</p>
        )}
        {error && (
          <p role="alert" className="mt-3 flex items-start gap-1.5 text-sm text-red-700 dark:text-red-300">
            <TriangleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" /> {error}
          </p>
        )}
        <div className="mt-auto pt-5">
          <Button className="w-full" size="lg" disabled={!options.data || !role} loading={busy} onClick={submit}>
            {!busy && <ArrowRight className="h-4 w-4" />} Sign in with this position
          </Button>
          <p className="mt-2 text-center text-xs text-ink-3">Session-only demo officer. National administration is available from the directory.</p>
        </div>
      </aside>
    </div>
  );
}

function Step({ title, hint, children }: { title: string; hint: string; children: React.ReactNode }) {
  return (
    <section className="p-5">
      <div className="mb-3">
        <h3 className="text-base font-semibold text-ink">{title}</h3>
        <p className="text-xs text-ink-3">{hint}</p>
      </div>
      {children}
    </section>
  );
}

function CentralPicker({ h, ministry, centralOrg, onMinistry, onCentralOrg }: { h: HierarchyConfig; ministry: string; centralOrg: string; onMinistry: (v: string) => void; onCentralOrg: (v: string) => void }) {
  const tops = h.organisations.filter((o) => o.kind === 'ministry' || o.kind === 'coordinating_authority');
  const children = h.organisations.filter((o) => o.parentId === ministry && o.kind === 'central_organisation');
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      <Select label="Ministry / national authority" value={ministry} onChange={onMinistry} options={tops.map((o) => ({ label: `${o.name}${o.lens === 'oversight' ? ' (oversight)' : ''}`, value: o.id }))} />
      <Select label="Organisation (optional)" value={centralOrg} onChange={onCentralOrg} options={[{ label: children.length ? 'Ministry level' : 'No organisations configured', value: '' }, ...children.map((o) => ({ label: o.name, value: o.id }))]} />
      <p className="text-xs text-ink-3 sm:col-span-2">{h.organisations.find((o) => o.id === (centralOrg || ministry))?.description ?? `Portfolio: ${h.organisations.find((o) => o.id === (centralOrg || ministry))?.portfolio ?? ''}`}</p>
    </div>
  );
}

function StatePicker({ h, stateName, stateOrg, onState, onStateOrg }: { h: HierarchyConfig; stateName: string; stateOrg: string; onState: (v: string) => void; onStateOrg: (v: string) => void }) {
  const state = h.states.find((s) => s.id === stateName);
  const govId = state ? `st:${state.code}` : '';
  const departments = h.organisations.filter((o) => o.parentId === govId && o.kind === 'state_department');
  const agencies = h.organisations.filter((o) => o.parentId === govId && o.kind === 'state_agency');
  const states = h.states.filter((s) => s.type === 'State');
  const uts = h.states.filter((s) => s.type !== 'State');
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      <Select label="State / Union Territory" value={stateName} onChange={onState} options={[{ label: 'Select a State or UT', value: '' }, ...states.map((s) => ({ label: s.label, value: s.id })), ...uts.map((s) => ({ label: `${s.label} (UT)`, value: s.id }))]} />
      <Select
        label="Department / agency"
        value={stateOrg}
        onChange={onStateOrg}
        disabled={!state}
        options={state ? [{ label: `${state.government} (whole government)`, value: '' }, ...departments.map((o) => ({ label: o.name, value: o.id })), ...agencies.map((o) => ({ label: `Agency · ${o.name}`, value: o.id }))] : [{ label: 'Select a State or UT first', value: '' }]}
      />
      {state && (
        <p className="text-xs text-ink-3 sm:col-span-2">
          {state.officialName} · {state.type} · {state.zonalCouncil} zone · {state.profile === 'configured' ? 'State profile configured in the registry' : 'generic designations (no State profile configured yet)'}
          {state.divisions ? ` · ${state.divisions} revenue divisions` : ''}
        </p>
      )}
    </div>
  );
}
