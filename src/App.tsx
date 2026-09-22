import { lazy, Suspense, useEffect, useMemo, type ReactNode } from 'react';
import { BrowserRouter, Link, Navigate, Route, Routes, useLocation, useParams } from 'react-router-dom';
import { Lock } from 'lucide-react';
import { AppShell } from '@/components/layout/AppShell';
import { LogoMark } from '@/components/layout/Logo';
import { AuthProvider, useAuth } from '@/auth/AuthContext';
import { PortalProvider } from '@/components/transition/Portal';
import { Button, Card, EmptyState, PageSkeleton } from '@/components/ui';
import Landing from '@/pages/Landing';
import Login from '@/pages/Login';
import LoginProfile from '@/pages/LoginProfile';
import { EXPERIENCE_HOME, applyViewParam, homePath } from '@/lib/homeView';

// "/" opens the standard homepage by default; the immersive 3D experience ("Explore in 3D", /experience) loads on its own,
// so the standard homepage and signed-in screens never pay for it.
const CinematicLanding = lazy(() => import('@/cinematic/CinematicLanding'));

/** "/" opens the view the visitor last chose (standard by default, see lib/homeView). */
function Home() {
  const { search } = useLocation();
  const home = useMemo(() => {
    applyViewParam(search);
    return homePath();
  }, [search]);
  return home === EXPERIENCE_HOME ? <Navigate to={EXPERIENCE_HOME} replace /> : <Landing />;
}

// Signed-in screens load on demand so the landing and sign-in pages stay light.
const Dashboard = lazy(() => import('@/pages/Dashboard'));
const Projects = lazy(() => import('@/pages/Projects'));
const ProjectDetail = lazy(() => import('@/pages/ProjectDetail'));
const ProjectForm = lazy(() => import('@/pages/ProjectForm'));
const Cases = lazy(() => import('@/pages/Cases'));
const CaseDetail = lazy(() => import('@/pages/CaseDetail'));
const Prediction = lazy(() => import('@/pages/Prediction'));
const RiskAnalysis = lazy(() => import('@/pages/RiskAnalysis'));
const Queue = lazy(() => import('@/pages/Queue'));
const GeographicMap = lazy(() => import('@/pages/GeographicMap'));
const Analytics = lazy(() => import('@/pages/Analytics'));
const DataAndModel = lazy(() => import('@/pages/DataAndModel'));
const Alerts = lazy(() => import('@/pages/Alerts'));
const Reports = lazy(() => import('@/pages/Reports'));
const About = lazy(() => import('@/pages/About'));
const Admin = lazy(() => import('@/pages/Admin'));
const Audit = lazy(() => import('@/pages/Audit'));
const Documents = lazy(() => import('@/pages/Documents'));
const Profile = lazy(() => import('@/pages/Profile'));
const Registry = lazy(() => import('@/pages/Registry'));
const PortfolioHierarchy = lazy(() => import('@/pages/PortfolioHierarchy'));
const DataSources = lazy(() => import('@/pages/DataSources'));
const Trends = lazy(() => import('@/pages/Trends'));
const ModelLifecycle = lazy(() => import('@/pages/ModelLifecycle'));
const Integrations = lazy(() => import('@/pages/Integrations'));

function ScrollToTop() {
  const { pathname } = useLocation();
  useEffect(() => {
    window.scrollTo({ top: 0, behavior: 'instant' as ScrollBehavior });
  }, [pathname]);
  return null;
}

function ParcelsRedirect() {
  const { search } = useLocation();
  return <Navigate to={`/cases${search}`} replace />;
}

function ParcelRedirect() {
  const { id = '' } = useParams();
  return <Navigate to={`/cases/${id}`} replace />;
}

/** Screens that need a permission render a clear refusal instead of a dead page. */
function RequirePermission({ permission, children }: { permission: string; children: ReactNode }) {
  const { can, user } = useAuth();
  if (!can(permission)) {
    return (
      <Card>
        <EmptyState
          icon={<Lock />}
          title="Not available for your role"
          description={
            <>
              {user?.roleLabel} does not include the <code className="rounded bg-surface-3 px-1 font-mono text-xs">{permission}</code> permission. Sign in with a profile that
              holds it to use this screen.
            </>
          }
          action={
            <Link to="/dashboard">
              <Button variant="secondary" size="sm" tabIndex={-1}>
                Back to overview
              </Button>
            </Link>
          }
        />
      </Card>
    );
  }
  return <>{children}</>;
}

function BootScreen() {
  return (
    <div className="grid min-h-screen place-items-center bg-bg" aria-busy="true" aria-label="Loading LandPulse AI">
      <div className="flex flex-col items-center gap-3">
        <LogoMark className="h-9 w-9" />
        <div className="h-0.5 w-24 overflow-hidden rounded-full bg-surface-3">
          <div className="h-full w-1/3 animate-indeterminate bg-brand" />
        </div>
      </div>
    </div>
  );
}

function Shell() {
  const { user, loading } = useAuth();
  const location = useLocation();
  if (loading) return <BootScreen />;
  if (!user) return <Navigate to={`/login?next=${encodeURIComponent(location.pathname + location.search)}`} replace />;
  return (
    <AppShell>
      <Suspense fallback={<PageSkeleton />}>
        <Routes>
          <Route path="/dashboard" element={<Dashboard />} />
          <Route path="/projects" element={<Projects />} />
          <Route path="/projects/new" element={<RequirePermission permission="project.create"><ProjectForm /></RequirePermission>} />
          <Route path="/projects/:id/edit" element={<RequirePermission permission="project.edit"><ProjectForm /></RequirePermission>} />
          <Route path="/projects/:id" element={<ProjectDetail />} />
          <Route path="/cases" element={<Cases />} />
          <Route path="/cases/:id" element={<CaseDetail />} />
          <Route path="/parcels" element={<ParcelsRedirect />} />
          <Route path="/parcels/:id" element={<ParcelRedirect />} />
          <Route path="/predict" element={<Prediction />} />
          <Route path="/risk" element={<RiskAnalysis />} />
          <Route path="/queue" element={<Queue />} />
          <Route path="/interventions" element={<Navigate to="/queue" replace />} />
          <Route path="/map" element={<GeographicMap />} />
          <Route path="/analytics" element={<Analytics />} />
          <Route path="/trends" element={<Trends />} />
          <Route path="/learning" element={<RequirePermission permission="admin.view"><ModelLifecycle /></RequirePermission>} />
          <Route path="/integrations" element={<Integrations />} />
          <Route path="/data" element={<DataAndModel />} />
          <Route path="/alerts" element={<Alerts />} />
          <Route path="/reports" element={<Reports />} />
          <Route path="/documents" element={<Documents />} />
          <Route path="/registry" element={<Registry />} />
          <Route path="/hierarchy" element={<PortfolioHierarchy />} />
          <Route path="/data-sources" element={<DataSources />} />
          <Route path="/profile" element={<Profile />} />
          <Route path="/admin" element={<RequirePermission permission="admin.view"><Admin /></RequirePermission>} />
          <Route path="/audit" element={<RequirePermission permission="audit.view"><Audit /></RequirePermission>} />
          <Route path="/about" element={<About />} />
          <Route path="*" element={<Navigate to="/dashboard" replace />} />
        </Routes>
      </Suspense>
    </AppShell>
  );
}

export default function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <PortalProvider>
        <ScrollToTop />
        <Routes>
          <Route path="/" element={<Home />} />
          <Route
            path="/experience"
            element={
              <Suspense fallback={<div className="min-h-screen bg-[#05070a]" />}>
                <CinematicLanding />
              </Suspense>
            }
          />
          <Route path="/login" element={<Login />} />
          <Route path="/login/profile" element={<LoginProfile />} />
          <Route path="/*" element={<Shell />} />
        </Routes>
        </PortalProvider>
      </BrowserRouter>
    </AuthProvider>
  );
}
