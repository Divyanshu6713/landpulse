import { useMemo, useRef, useState } from 'react';
import { Navigate, useNavigate, useSearchParams } from 'react-router-dom';
import { Building2, ChevronRight, Eye, EyeOff, Landmark, LineChart, Loader2, MapPin, TriangleAlert } from 'lucide-react';
import { cn } from '@/lib/cn';
import { Badge, Button, EmptyState } from '@/components/ui';
import { useAuth } from '@/auth/AuthContext';
import { Directory } from './Login';
import { useApi } from '@/hooks';
import { fetchDemoUsers } from '@/api/client';
import { BRAND } from '@/lib/brand';
import { getDemoPassword, setDemoPassword } from '@/auth/demoSession';
import { usePortal } from '@/components/transition/Portal';
import type { RoleId } from '@/data/types';

/** The demo story's four hero perspectives — real accounts and roles, see server/domain/roles.mjs. */
const HERO_IDS = ['u-national', 'u-ka-state', 'u-ka-mandya-dc', 'u-policy'];
const ROLE_ICON: Partial<Record<RoleId, typeof Landmark>> = {
  NATIONAL_ADMIN: Landmark,
  STATE_ADMIN: Building2,
  DISTRICT_ADMIN: MapPin,
  POLICY_VIEWER: LineChart,
};

/**
 * "Choose Your Demo Perspective" — reached after the simplified Enter Demo
 * sign-in, and from the account menu's Switch demo profile. Every card is a
 * real directory account; picking one re-authenticates through the same
 * /api/auth/login the full directory uses (see Login.tsx's <Directory>),
 * just curated to four roles instead of all 22.
 */
export default function LoginProfile() {
  const { user, loading, signIn } = useAuth();
  const { go } = usePortal();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const next = params.get('next') || '/dashboard';
  const isSwitch = params.get('switch') === '1';
  const users = useApi((signal) => fetchDemoUsers(signal), []);
  const [password, setPassword] = useState(() => getDemoPassword() ?? '');
  const [showPasswordField, setShowPasswordField] = useState(() => !getDemoPassword());
  const [reveal, setReveal] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [browseAll, setBrowseAll] = useState(false);
  const passwordInput = useRef<HTMLInputElement>(null);
  const heroes = useMemo(() => HERO_IDS.map((id) => users.data?.users.find((u) => u.id === id)).filter((u): u is NonNullable<typeof u> => Boolean(u)), [users.data]);

  if (loading) {
    return (
      <div className="grid min-h-screen place-items-center bg-bg" aria-busy="true" aria-label="Loading">
        <Loader2 className="h-6 w-6 animate-spin text-ink-3" />
      </div>
    );
  }
  if (!user) return <Navigate to={`/login?next=${encodeURIComponent(next)}`} replace />;

  const finish = () => {
    if (isSwitch) {
      // A different account means a different server-side scope: reload so every
      // page's data hooks refetch, instead of auditing each one for staleness.
      window.location.assign(next);
    } else {
      go(next, 'rise');
    }
  };

  const requirePassword = () => {
    if (password) return true;
    setShowPasswordField(true);
    passwordInput.current?.focus();
    return false;
  };

  const choose = async (id: string) => {
    if (id === user.id) {
      finish();
      return;
    }
    if (!requirePassword()) return;
    setBusyId(id);
    setError(null);
    try {
      await signIn(id, password);
      setDemoPassword(password);
      finish();
    } catch (err) {
      setError((err as Error).message);
      setBusyId(null);
    }
  };

  return (
    <div className="flex min-h-screen flex-col bg-bg">
      <header className="border-b border-line">
        <div className="mx-auto flex h-16 max-w-5xl items-center px-4 sm:px-6">
          <span className="font-grotesk text-base font-semibold text-ink">{BRAND.product}</span>
        </div>
      </header>
      <main className="mx-auto w-full max-w-5xl flex-1 px-4 py-10 sm:px-6 sm:py-14">
        <h1 className="font-grotesk text-3xl font-semibold tracking-tight text-ink sm:text-4xl">Choose Your Demo Perspective</h1>
        <p className="mt-2 max-w-2xl text-md text-ink-2">Explore LandPulse from different administrative levels.</p>
        <p className="mt-1 text-xs text-ink-3">National → State → District — every level sees the same platform, scoped to its own jurisdiction.</p>

        {browseAll ? (
          <div className="mt-8">
            <Directory next={next} password={password} requirePassword={requirePassword} />
            <button type="button" onClick={() => setBrowseAll(false)} className="mt-6 text-sm font-medium text-ink-3 hover:text-ink hover:underline">
              Back to the four perspectives
            </button>
          </div>
        ) : (
          <>
            {users.loading && (
              <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-4" aria-busy="true" aria-label="Loading perspectives">
                {Array.from({ length: 4 }).map((_, i) => (
                  <div key={i} className="card h-44 animate-pulse p-5" />
                ))}
              </div>
            )}

            {users.error && (
              <div className="card mt-8">
                <EmptyState
                  icon={<TriangleAlert />}
                  title="Perspectives could not be loaded"
                  description="The sign-in service is not reachable. Check that the API is running, then try again."
                  action={
                    <Button variant="secondary" size="sm" onClick={users.reload}>
                      Try again
                    </Button>
                  }
                />
              </div>
            )}

            {!users.loading && !users.error && (
              <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                {heroes.map((u) => {
                  const Icon = ROLE_ICON[u.role] ?? Landmark;
                  const isCurrent = u.id === user.id;
                  const busy = busyId === u.id;
                  return (
                    <button
                      key={u.id}
                      type="button"
                      disabled={busyId !== null}
                      onClick={() => choose(u.id)}
                      className={cn(
                        'group card flex flex-col items-start p-5 text-left transition-[transform,box-shadow,border-color] duration-200 ease-out hover:border-brand/50 hover:shadow-card-hover motion-safe:hover:-translate-y-1 focus-ring disabled:cursor-wait',
                        isCurrent && 'border-brand',
                      )}
                    >
                      <span className="grid h-10 w-10 place-items-center rounded-lg bg-brand-soft text-brand transition-transform duration-200 motion-safe:group-hover:-translate-y-0.5">
                        <Icon className="h-5 w-5" />
                      </span>
                      <p className="mt-3 text-base font-semibold text-ink">{u.roleLabel}</p>
                      <p className="mt-1.5 text-sm leading-snug text-ink-2">{u.roleSummary}</p>
                      <div className="mt-3 flex flex-wrap gap-1.5">
                        <Badge tone="brand">{u.position.tierLabel} Level</Badge>
                        {isCurrent && <Badge>Current</Badge>}
                      </div>
                      <span className="mt-4 flex items-center gap-1 text-sm font-medium text-brand">
                        {busy ? (
                          <>
                            <Loader2 className="h-3.5 w-3.5 animate-spin" /> Signing in…
                          </>
                        ) : (
                          <>
                            {isCurrent ? 'Continue' : 'Explore'} <ChevronRight className="h-3.5 w-3.5 transition-transform group-hover:translate-x-0.5" />
                          </>
                        )}
                      </span>
                    </button>
                  );
                })}
              </div>
            )}

            {showPasswordField && (
              <div className="mt-6 max-w-sm">
                <label htmlFor="profile-password" className="mb-1.5 block text-sm font-medium text-ink">
                  Password
                </label>
                <div className="relative">
                  <input
                    id="profile-password"
                    ref={passwordInput}
                    type={reveal ? 'text' : 'password'}
                    autoComplete="current-password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    className="input h-10 pr-10"
                  />
                  <button type="button" onClick={() => setReveal((r) => !r)} aria-label={reveal ? 'Hide password' : 'Show password'} className="absolute right-1 top-1/2 grid h-8 w-8 -translate-y-1/2 place-items-center rounded-md text-ink-3 hover:text-ink focus-ring">
                    {reveal ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </button>
                </div>
              </div>
            )}

            {error && (
              <p role="alert" className="mt-4 flex items-start gap-1.5 text-sm text-red-700 dark:text-red-300">
                <TriangleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" /> {error}
              </p>
            )}

            <div className="mt-8 flex flex-wrap items-center gap-4">
              <button type="button" onClick={() => setBrowseAll(true)} className="text-sm font-medium text-ink-3 hover:text-ink hover:underline">
                Browse full directory instead
              </button>
              {isSwitch && (
                <Button variant="ghost" size="sm" onClick={() => navigate(-1)}>
                  Cancel
                </Button>
              )}
            </div>
          </>
        )}
      </main>
    </div>
  );
}
