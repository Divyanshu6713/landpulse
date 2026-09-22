/**
 * API boundary.
 *
 * Every screen reads and writes through this module. The corpus and the
 * workflow state live behind the API (server/index.mjs); every data endpoint is
 * scoped to the signed-in profile, so the session token travels with each call.
 *
 * In development Vite proxies /api to the API process (see vite.config.ts). Set
 * VITE_API_BASE_URL to point at a different deployment.
 */
import type {
  AlertList,
  AuditList,
  BreakdownRow,
  CaseDetailResponse,
  CaseQueryResult,
  DashboardSummary,
  DistrictSummary,
  DocumentList,
  DocumentRecord,
  ExportManifest,
  HierarchyConfig,
  HierarchyOptionsResponse,
  IntegrationStatus,
  ParcelDataView,
  PortfolioDrilldown,
  RoleId,
  Facets,
  GeoCollection,
  InterventionItem,
  InterventionList,
  AlertItem,
  MapPoint,
  MapProject,
  Notifications,
  PortfolioSummary,
  PredictResponse,
  PredictionSpec,
  Profile,
  ProjectDetailResponse,
  ProjectQueryResult,
  ProjectSummary,
  QueueResult,
  RegistryOverview,
  RetrainStatus,
  ScenarioContext,
  ScenarioOptions,
  ScenarioResponse,
  ScenarioSeed,
  StateSummary,
  UploadResult,
  User,
  ValidationReport,
  DelayTrends,
  PerformanceIndicators,
  LearningStatus,
  DriftReport,
  RecordedOutcome,
  NotificationFeed,
  ApiClient,
  AuditVerification,
  SecurityPosture,
} from '@/data/types';

const BASE = (import.meta.env.VITE_API_BASE_URL as string | undefined)?.replace(/\/$/, '') ?? '';

/** Shown wherever figures are displayed. */
export const DATA_MODE = 'Synthetic demo data';

export const PROTOTYPE_NOTICE =
  'This prototype uses synthetic data for demonstration and model-development purposes. It does not represent ' +
  'actual government acquisition records. Real-world deployment and validation would require authorised ' +
  'historical acquisition data.';

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly details?: unknown,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

/* ---------------------------------------------------------------- session */

const TOKEN_KEY = 'bp-session';
const DOWNLOAD_KEY = 'bp-download';
const read = (key: string) => {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
};
let token: string | null = read(TOKEN_KEY);
/** A separate, download-only credential: the only one ever placed in a URL. */
let downloadToken: string | null = read(DOWNLOAD_KEY);

const unauthorizedListeners = new Set<() => void>();
export const onUnauthorized = (fn: () => void) => {
  unauthorizedListeners.add(fn);
  return () => unauthorizedListeners.delete(fn);
};

/**
 * A deliberate sign-in attempt (e.g. switching demo profile while already
 * signed in) can itself 401 on a wrong password. That must surface as an
 * inline error, not the global "your session ended" side effect, which
 * would otherwise sign the user out of their still-valid current session.
 */
let suppressUnauthorized = 0;
export function suppressUnauthorizedOnce<T>(fn: () => Promise<T>): Promise<T> {
  suppressUnauthorized++;
  return fn().finally(() => {
    suppressUnauthorized--;
  });
}

export const getToken = () => token;
export function setToken(next: string | null, nextDownload: string | null = null) {
  token = next;
  downloadToken = next ? nextDownload ?? downloadToken : null;
  try {
    if (next) localStorage.setItem(TOKEN_KEY, next);
    else localStorage.removeItem(TOKEN_KEY);
    if (downloadToken) localStorage.setItem(DOWNLOAD_KEY, downloadToken);
    else localStorage.removeItem(DOWNLOAD_KEY);
  } catch {
    /* storage unavailable — the session lasts for this tab only */
  }
}

export type Query = Record<string, string | number | boolean | undefined | null>;

const qs = (params: Query = {}) => {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null || value === '' || value === 'all') continue;
    search.set(key, String(value));
  }
  const s = search.toString();
  return s ? `?${s}` : '';
};

async function request<T>(method: string, path: string, { params, body, raw, signal, contentType }: { params?: Query; body?: unknown; raw?: BodyInit; signal?: AbortSignal; contentType?: string } = {}): Promise<T> {
  const headers: Record<string, string> = {};
  if (token) headers.Authorization = `Bearer ${token}`;
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (raw !== undefined) headers['Content-Type'] = contentType ?? 'application/octet-stream';
  const res = await fetch(`${BASE}/api${path}${qs(params)}`, {
    method,
    headers,
    body: raw ?? (body !== undefined ? JSON.stringify(body) : undefined),
    signal,
  });
  if (!res.ok) {
    let detail = `${res.status} ${res.statusText}`;
    let details: unknown;
    try {
      const payload = (await res.json()) as { error?: string; details?: unknown };
      if (payload.error) detail = payload.error;
      details = payload.details;
    } catch {
      /* non-JSON error body */
    }
    if (res.status === 401 && !suppressUnauthorized) unauthorizedListeners.forEach((fn) => fn());
    throw new ApiError(detail, res.status, details);
  }
  return (await res.json()) as T;
}

const get = <T,>(path: string, params?: Query, signal?: AbortSignal) => request<T>('GET', path, { params, signal });
const post = <T,>(path: string, body?: unknown, signal?: AbortSignal) => request<T>('POST', path, { body: body ?? {}, signal });

/* ------------------------------------------------------------------- auth */

export const fetchDemoUsers = (signal?: AbortSignal) => get<{ note: string; users: User[] }>('/auth/users', undefined, signal);
export interface SessionResponse {
  token: string;
  downloadToken: string;
  expiresAt: string;
  idleMinutes: number;
  user: User;
}
export const login = (userId: string, password: string) => post<SessionResponse>('/auth/login', { userId, password });
export const loginWithPosition = (role: RoleId, position: { orgId: string; units: Record<string, string | undefined> }, password: string) =>
  post<SessionResponse>('/auth/login', { role, position, password });
export const changePassword = (currentPassword: string, newPassword: string) => post<{ ok: boolean }>('/auth/password', { currentPassword, newPassword });
export const fetchSecurityPosture = (signal?: AbortSignal) => get<SecurityPosture>('/security/posture', undefined, signal);

/* -------------------------------------------------------------- hierarchy */

export const fetchHierarchy = (signal?: AbortSignal) => get<HierarchyConfig>('/hierarchy', undefined, signal);
export const fetchHierarchyOptions = (params: Query, signal?: AbortSignal) => get<HierarchyOptionsResponse>('/hierarchy/options', params, signal);
export const fetchPortfolio = (params: Query, signal?: AbortSignal) => get<PortfolioDrilldown>('/hierarchy/portfolio', params, signal);

/* ------------------------------------------------------------ integration */

export const fetchIntegrations = (signal?: AbortSignal) => get<IntegrationStatus>('/integrations', undefined, signal);
export const fetchParcelDataView = (caseId: string, signal?: AbortSignal) => get<ParcelDataView>(`/integrations/parcel/${encodeURIComponent(caseId)}`, undefined, signal);
export const logout = () => post<{ ok: boolean }>('/auth/logout');
export const fetchProfile = (signal?: AbortSignal) => get<Profile>('/profile', undefined, signal);
export const fetchNotifications = (signal?: AbortSignal) => get<Notifications>('/notifications', undefined, signal);
export const fetchUsers = (signal?: AbortSignal) =>
  get<{ users: Array<Pick<User, 'id' | 'name' | 'designation' | 'role' | 'roleLabel' | 'state' | 'district' | 'scopeLabel'>> }>('/users', undefined, signal);

/* ------------------------------------------------------------------ reads */

export const fetchHealth = (signal?: AbortSignal) =>
  get<{ ok: boolean; rows: number; projects: number; today: string; shap: boolean; model: string | null }>('/health', undefined, signal);

export const fetchSummary = (signal?: AbortSignal) => get<PortfolioSummary>('/summary', undefined, signal);
export const fetchFacets = (signal?: AbortSignal) => get<Facets>('/facets', undefined, signal);
export const fetchRegistry = (signal?: AbortSignal) => get<RegistryOverview>('/registry', undefined, signal);
export const fetchDashboard = (params: Query, signal?: AbortSignal) => get<DashboardSummary>('/dashboard/summary', params, signal);

export const fetchProjects = (params: Query, signal?: AbortSignal) => get<ProjectQueryResult>('/projects', params, signal);
export const fetchProjectMap = (signal?: AbortSignal) => get<{ dataSource: string; projects: MapProject[] }>('/projects/map', undefined, signal);
export const fetchProject = (id: string, signal?: AbortSignal) =>
  get<ProjectDetailResponse>(`/projects/${encodeURIComponent(id)}`, undefined, signal);
export const fetchProjectCases = (id: string, params: Query, signal?: AbortSignal) =>
  get<CaseQueryResult>(`/projects/${encodeURIComponent(id)}/cases`, params, signal);
export const fetchDeletedProjects = (signal?: AbortSignal) =>
  get<{ projects: Array<{ id: string; name: string; at: string; by: string; reason: string | null }> }>('/projects/deleted', undefined, signal);

export const fetchCases = (params: Query, signal?: AbortSignal) => get<CaseQueryResult>('/cases', params, signal);
export const fetchCase = (id: string, signal?: AbortSignal) => get<CaseDetailResponse>(`/cases/${encodeURIComponent(id)}`, undefined, signal);

export const fetchQueue = (params: Query, signal?: AbortSignal) => get<QueueResult>('/queue', params, signal);

export const fetchMapPoints = (params: Query, signal?: AbortSignal) =>
  get<{ total: number; returned: number; points: MapPoint[] }>('/map/points', params, signal);

export const fetchGeo = (signal?: AbortSignal) =>
  get<{ districts: DistrictSummary[]; states: StateSummary[]; today: string }>('/geo', undefined, signal);

export const fetchBoundaries = (level: 'outline' | 'states' | 'districts', state?: string, signal?: AbortSignal) =>
  get<GeoCollection>('/geo/boundaries', { level, state }, signal);

export const fetchBreakdown = (params: Query, signal?: AbortSignal) =>
  get<{ dimension: string; rows: BreakdownRow[] }>('/breakdown', params, signal);

export const fetchContributors = (params: Query, signal?: AbortSignal) =>
  get<{
    cases: number;
    groups: Array<{ name: string; value: number; share: number }>;
    features: Array<{ name: string; value: number; share: number }>;
  }>('/contributors', params, signal);

export const fetchModel = (signal?: AbortSignal) =>
  get<{
    metrics: Record<string, unknown>;
    importance: {
      permutation: Array<{ feature: string; group: string; label: string; aucDrop: number }>;
      shap: Array<{ feature: string; group: string; label: string; meanAbsShap: number }>;
      shapByGroup: Array<{ group: string; value: number }>;
    };
    dataset: Record<string, any>;
    featureSpec: Array<{ name: string; group: string; label: string; op: string; source: string }>;
  }>('/model', undefined, signal);

export const fetchPredictionSpec = (signal?: AbortSignal) => get<PredictionSpec>('/predict/spec', undefined, signal);

export const fetchCaseScenario = (caseId: string, signal?: AbortSignal) =>
  get<{
    record: Record<string, string | number>;
    ensemble: { probability: number; riskScore: number; contributors: Array<{ group: string; value: number }> };
    surrogate: PredictResponse['result'];
  }>('/predict/case', { caseId }, signal);

export const fetchScenarioOptions = (params: Query, signal?: AbortSignal) => get<ScenarioOptions>('/scenario/options', params, signal);
export const fetchScenarioSeed = (projectId: string, signal?: AbortSignal) =>
  get<{ project: ProjectSummary; seed: ScenarioSeed }>('/scenario/seed', { projectId }, signal);

export const fetchInterventions = (params: Query, signal?: AbortSignal) => get<InterventionList>('/interventions', params, signal);
export const fetchAlerts = (params: Query, signal?: AbortSignal) => get<AlertList>('/alerts', params, signal);
export const fetchDocuments = (params: Query, signal?: AbortSignal) => get<DocumentList>('/documents', params, signal);
export const fetchAudit = (params: Query, signal?: AbortSignal) => get<AuditList>('/audit', params, signal);
export const fetchValidation = (signal?: AbortSignal) => get<ValidationReport>('/validation', undefined, signal);
export const fetchRetrainStatus = (signal?: AbortSignal) => get<RetrainStatus>('/retrain/status', undefined, signal);
export const fetchExportManifest = (signal?: AbortSignal) => get<ExportManifest>('/export/manifest', undefined, signal);

/* ----------------------------------------------------------------- writes */

export const requestPrediction = (record: Record<string, string | number>, baseline?: Record<string, string | number>, signal?: AbortSignal) =>
  post<PredictResponse>('/predict', { record, baseline }, signal);

export const scoreScenario = (
  body: { context: ScenarioContext; pending: string[]; signals: Record<string, string | number>; seedProjectId?: string; baseline?: { context: ScenarioContext; pending: string[]; signals: Record<string, string | number> } },
  signal?: AbortSignal,
) => post<ScenarioResponse>('/scenario/score', body, signal);

export const createProject = (input: Record<string, unknown>) => post<{ project: ProjectSummary }>('/projects', input);
export const updateProject = (id: string, patch: Record<string, unknown>) => request<{ project: ProjectSummary }>('PUT', `/projects/${encodeURIComponent(id)}`, { body: patch });
export const deleteProject = (id: string, reason: string) => request<{ ok: boolean }>('DELETE', `/projects/${encodeURIComponent(id)}`, { body: { reason } });
export const restoreProject = (id: string) => post<{ project: ProjectSummary }>(`/projects/${encodeURIComponent(id)}/restore`);
export const advanceProjectStage = (id: string, body: { completedOn: string; note?: string }) =>
  post<{ project: ProjectSummary }>(`/projects/${encodeURIComponent(id)}/advance-stage`, body);

export const updateInterventionStatus = (id: string, patch: { status?: string; note?: string; assignedRole?: string; assigneeId?: string | null; escalate?: boolean }) =>
  request<{ intervention: InterventionItem }>('PATCH', `/interventions/${encodeURIComponent(id)}`, { body: patch });
export const updateAlertStatus = (id: string, status: string) => request<{ alert: AlertItem }>('PATCH', `/alerts/${encodeURIComponent(id)}`, { body: { status } });
export const updateCaseStatus = (caseId: string, body: { status: string; note: string }) =>
  request<{ caseId: string; status: string }>('PATCH', `/cases/${encodeURIComponent(caseId)}/status`, { body });

export const uploadDocument = (meta: { projectId: string; title: string; type: string; stage?: string; caseId?: string }, file: File) =>
  request<{ document: DocumentRecord }>('POST', '/documents', { params: { ...meta, fileName: file.name }, raw: file, contentType: file.type || 'application/octet-stream' });
export const uploadDocumentVersion = (id: string, file: File) =>
  request<{ document: DocumentRecord }>('POST', `/documents/${encodeURIComponent(id)}/versions`, { params: { fileName: file.name }, raw: file, contentType: file.type || 'application/octet-stream' });
export const reviewDocument = (id: string, body: { status: 'VERIFIED' | 'REJECTED'; note?: string }) =>
  request<{ document: DocumentRecord }>('PATCH', `/documents/${encodeURIComponent(id)}`, { body });

export const uploadProjectsCsv = (text: string, commit: boolean) =>
  request<UploadResult>('POST', '/upload', { params: { commit: commit ? 1 : 0 }, raw: text, contentType: 'text/csv' });
export const startRetrain = () => post<{ started: boolean; reason?: string; job: RetrainStatus['job'] }>('/retrain');

/* ------------------------------------------------ trends, learning & more */

export const fetchTrends = (params: Query, signal?: AbortSignal) => get<DelayTrends>('/analytics/trends', params, signal);
export const fetchPerformance = (params: Query, signal?: AbortSignal) => get<PerformanceIndicators>('/analytics/performance', params, signal);

export const fetchLearningStatus = (signal?: AbortSignal) => get<LearningStatus>('/learning/status', undefined, signal);
export const fetchDrift = (params: Query, signal?: AbortSignal) => get<DriftReport>('/learning/drift', params, signal);
export const recordCaseOutcome = (caseId: string, body: { completedOn?: string; stillPendingOn?: string; note?: string }) =>
  post<{ outcome: RecordedOutcome }>(`/cases/${encodeURIComponent(caseId)}/outcome`, body);
export const uploadOutcomesCsv = (text: string, commit: boolean) =>
  request<{ summary: { rows: number; valid: number; invalid: number; delayed: number; committed: boolean }; errors: Array<{ row: number; error: string }> }>('POST', '/learning/outcomes', { params: { commit: commit ? 1 : 0 }, raw: text, contentType: 'text/csv' });
export const advanceSimulationClock = (days: number) =>
  post<{ from: string; to: string; released: number; delayed: number; scan: NotificationFeed['lastScan'] }>('/learning/simulate', { days });
export const updateLearningSettings = (patch: { autoRetrain?: boolean; autoRetrainMinOutcomes?: number }) => request<{ learning: unknown }>('PATCH', '/learning/settings', { body: patch });
export const rollbackModel = (versionId: string) => post<{ started: boolean; reason?: string; job: RetrainStatus['job'] }>(`/learning/rollback/${encodeURIComponent(versionId)}`);

export const fetchNotificationFeed = (params: Query, signal?: AbortSignal) => get<NotificationFeed>('/notifications/feed', params, signal);
export const markNotificationsRead = (ids?: string[]) => post<{ changed: number }>('/notifications/read', { ids });
export const runNotificationScan = () => post<{ scan: NotificationFeed['lastScan'] }>('/notifications/scan');

export const fetchApiClients = (signal?: AbortSignal) => get<{ clients: ApiClient[]; scopes: Record<string, string>; openapi: string }>('/integrations/clients', undefined, signal);
export const createApiClient = (body: { name: string; scopes: string[]; position?: { orgId: string; units: Record<string, string | undefined> }; rateLimitPerMinute?: number; webhookUrl?: string | null }) =>
  post<{ client: ApiClient; key: string }>('/integrations/clients', body);
export const revokeApiClient = (id: string) => request<{ client: ApiClient }>('DELETE', `/integrations/clients/${encodeURIComponent(id)}`);
export const fetchOpenApi = (signal?: AbortSignal) => get<{ info: { title: string; version: string; description: string }; paths: Record<string, Record<string, { summary: string; description: string }>> }>('/v1/openapi.json', undefined, signal);
export const verifyAudit = (signal?: AbortSignal) => get<AuditVerification>('/audit/verify', undefined, signal);

/* ---------------------------------------------------------------- exports */

/** Download links carry the download-only token, since a plain anchor cannot send headers. */
export const exportUrl = (path: string, params?: Query) => `${BASE}/api${path}${qs({ ...params, dl: downloadToken ?? undefined })}`;
export const outcomesTemplateUrl = () => exportUrl('/learning/outcomes/template');

export const casesCsvUrl = (params: Query) => exportUrl('/export/cases.csv', params);
export const projectsCsvUrl = (params: Query) => exportUrl('/export/projects.csv', params);
export const datasetCsvUrl = () => exportUrl('/export/dataset.csv');
export const datasetPdfUrl = () => exportUrl('/export/dataset.pdf');
export const uploadTemplateUrl = () => exportUrl('/upload/template');
export const documentDownloadUrl = (id: string, version?: number) => exportUrl(`/documents/${encodeURIComponent(id)}/download`, { version });
