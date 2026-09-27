<p align="left"><img src="public/brand/landpulse-logo.png" alt="LandPulse AI" height="72" /></p>

# LandPulse AI

**Predict Delays. Enable Action.**

Land Acquisition Intelligence · Delay-Risk Prediction · Decision Support — for infrastructure projects
across India, from central ministries to district offices. Built by **RootStack**.

National hierarchy → data integration layer → project-type authorities & dependencies → stage / case status →
land-acquisition issue profile → ML risk → explanation → recommendation → intervention → alert → role action → audit trail

> **SYNTHETIC DEMO DATA**
>
> Every project, case, parcel, village, owner, date, amount and outcome in this prototype is synthetic,
> generated for demonstration and model development. Project names describe the *kind* of work; they are
> not real government projects, and project/parcel coordinates are not real sites. Administrative
> boundaries, state/district/taluk names and statutory frameworks are real. Real-world deployment would
> require authorised acquisition records.

---

## Running it

```bash
npm install
npm run data        # one-time: generate → train → store → PDF (~10 min, needs Python)
npm run dev         # API (5179) + Vite (5178): http://localhost:5178
```

**Sign-in.** Every profile needs a password. Directory profiles start on the deployment's demo password
(`LANDPULSE_DEMO_PASSWORD`, default `LandPulse@2026`) and can set their own under *My Profile*. Five failed
attempts lock a profile for five minutes; sessions expire after 60 idle minutes or 8 hours.

Sign in with a **directory profile** (national coordination cell, MoRTH, DoLR, MoEFCC, NHAI, Southern Railway,
POWERGRID, and state / district officers in Karnataka, Maharashtra, Uttar Pradesh, Tamil Nadu and Bihar) or
**configure a position** anywhere in the national hierarchy — any ministry or central organisation, any of the
28 States and 8 Union Territories, any department or agency, division and district. The position decides
jurisdiction; the role decides permissions; the API enforces both.

| Command | What it does |
| --- | --- |
| `npm run dev` | API + Vite dev server (the API is pinned to 5179 even if `PORT` is set) |
| `npm run build` | type-check + production bundle |
| `npm start` | single process: API + built front end on `PORT` (default 5179) |
| `npm run test:smoke` | 211 end-to-end functional tests against an isolated API instance |
| `npm run data:verify` | 56 checks across corpus, model, registry, store and deliverables |
| `npm run data` | full data pipeline |
| `npm run data:geo` | rebuild boundary layers from source (downloads ~100 MB, uses mapshaper via npx) |

Python 3.10+ with `numpy`, `pandas`, `scikit-learn`, `shap` is needed for training and for the in-app
**Retrain** action (`pip install -r ml/requirements.txt`).

---

## What's in it

| Route | Screen |
| --- | --- |
| `/login` | Directory profiles by authority level, or a progressive position builder (authority → organisation → jurisdiction → role) |
| `/hierarchy` | National Portfolio drill-down: India → sector ministry → State / UT → district → project, with oversight lenses (DoLR, MoEFCC) |
| `/data-sources` | Data provenance, the integration architecture and every provider contract with its active adapter |
| `/dashboard` | KPIs (total, High, Critical, delayed, immediate action, mean delay probability) and analytics: risk, state, district, type, stage, delay drivers, compensation, legal, R&R, timeline, department bottlenecks — every chart clicks through |
| `/projects`, `/projects/:id` | Registry with state/district/type/stage/status filters; project intelligence page: overview, authority network, AI risk, SHAP explanation, stage timeline with case backlog, next milestone, recommendations, interventions, alerts, GIS, cases, documents, audit |
| `/projects/new`, `/projects/:id/edit` | Validated create / edit; *Record milestone achieved* advances the lifecycle |
| `/cases`, `/cases/:id` | 350,000 parcel-level cases; case page shows pending department actions, case rules, case status workflow, documents |
| `/map` | GIS: India → state → district → project on real boundaries, risk/state/district/type/stage/search filters, clustering, popups, state & district summaries |
| `/predict` | Scenario scoring driven by the authority registry and the model |
| `/queue` | Intervention queue with OPEN → ACKNOWLEDGED → IN_PROGRESS → RESOLVED / DISMISSED |
| `/alerts` | Alert centre with UNREAD → ACKNOWLEDGED → RESOLVED |
| `/documents` | Document repository (upload from project / case pages; versions, review, download) |
| `/registry` | Authority & dependency registry explorer, frameworks, rule thresholds |
| `/admin` | CSV upload & validation, retraining job, model metrics, consistency validation, deleted-project restore |
| `/audit`, `/profile` | Audit trail; administrative position (hierarchy ladder), scope, portfolio KPIs, role, official information, assignments |
| `/risk`, `/analytics`, `/reports`, `/data`, `/about` | Model decomposition, analytics, MIS reports, model card, methodology |
| `/trends` | State-wise and district-wise delay trends (observed history, then model forecast — never overlapping), direction of travel, performance league tables for authorities, offices, districts and States |
| `/learning` | Model Lifecycle: recorded outcomes, prospective monitoring and calibration, PSI drift, simulation clock, CSV outcome ingestion, gated retraining, automatic retraining, model registry and rollback |
| `/integrations` | APIs & Security: API clients (scoped, rate-limited keys with jurisdiction and webhooks), OpenAPI v1 endpoints, security posture, audit hash-chain verification |

Project pages add a **stage-wise delay forecast** (P(late > 30 days) per remaining stage, P50 / P80 dates,
probability of missing the target) and recommendations carry the **risk reduction the deployed model predicts**
for each action. Case pages let officers **record milestone outcomes**. The alert centre shows **notifications and
deliveries** from the scheduled scanner.

---

## Architecture

```
server/
├─ index.mjs                 dependency-free HTTP API: auth, position scoping, all endpoints, static host
├─ integration/              data integration layer (see below)
│  ├─ contracts.mjs          provider contracts, data modes, response envelopes
│  ├─ adapters.mjs           adapter registry; synthetic adapters for every contract
│  └─ index.mjs              adapter selection (LANDPULSE_PROVIDER_*), parcel / project data views
├─ domain/                   configuration and deterministic business rules (one place each)
│  ├─ india.mjs              all 28 States + 8 UTs, zonal councils, grid regions, configured revenue divisions
│  ├─ hierarchy.mjs          administrative levels, hierarchy templates, sectors, organisation catalogue, positions
│  ├─ issues.mjs             land-acquisition issue taxonomy, project-type exposure, issue profiles
│  ├─ registry.mjs           frameworks, project types, declarative dependency rules, state profiles, networks
│  ├─ geography.mjs          districts, sub-districts, polygons, point-in-polygon
│  ├─ lifecycle.mjs          stage status vs case backlog vs parcel status
│  ├─ rules.mjs              triggers → recommendations, interventions, alerts; case-level rules
│  ├─ roles.mjs              roles, permissions, focus areas, positions → scope, demo directory
│  └─ validation.mjs         field validation shared by form, edit and CSV upload
└─ lib/
   ├─ store.mjs, query.mjs   columnar case store and query engine
   ├─ ensemble.mjs           exported deployed trees: probability, expected slip, exact TreeSHAP
   ├─ scorer.mjs             model input contract; scores records with the ensemble
   ├─ forecast.mjs           stage-wise Monte Carlo delay forecast
   ├─ impact.mjs             predicted risk reduction per recommended action
   ├─ analytics.mjs          delay trends and performance indicators
   ├─ learning.mjs           outcomes, simulation clock, monitoring, drift, registry
   ├─ notifications.mjs      scheduled alert scans, escalation, delivery channels
   ├─ security.mjs           passwords, lockout, sessions, CORS and headers
   ├─ apiClients.mjs         API keys, scopes, jurisdiction, rate limits
   ├─ externalApi.mjs        /api/v1 integration API and OpenAPI contract
   ├─ projects.mjs           effective projects = corpus + edits + additions − deletions (single source of truth)
   ├─ workflow.mjs           interventions & alerts with persisted status
   ├─ scenario.mjs           scenario scoring through the registry
   ├─ dashboard.mjs          scoped dashboard aggregation
   ├─ portfolio.mjs          national drill-down and position portfolio statistics
   ├─ documents.mjs          file repository with versions and review
   ├─ upload.mjs             CSV parse / validate / commit
   ├─ jobs.mjs               retraining job (train.py → build-store → hot reload)
   ├─ consistency.mjs        cross-screen data-consistency checks
   └─ persistence.mjs        runtime state (data/runtime/state.json) and append-only audit log
```

Dashboard, registry, GIS, scenario seeding, queue, alerts, profile and reports all read
`effectiveProjects()`; none recomputes status, risk bands or owners on its own.

### Authority & dependency logic

`buildDependencyNetwork({ projectType, subtype, state, district, subDistrict, primaryAuthority, flags })`
returns every body the acquisition depends on, grouped central / state / district / sub-district, each with
*why* it is involved, the stages it gates, whether it can block a stage, and a basis label:
**statute** (the Act and section), **configured** (a designation held in this registry — confirm against the
project notification) or **project** (named by the record).

- **Framework** follows type and subtype: RFCTLARR 2013, NH Act 1956 (ss.3A–3J), Railways Act 1989 Ch. IVA,
  PMP Act 1962 (right of user), Electricity Act RoW, KIAD Act 1966 (Karnataka industrial), MID Act 1961.
  Milestone wording, dispute forum and SIA applicability come from the framework.
- **Eligible acquiring bodies** follow type × state × district (e.g. irrigation in Mandya → CNNL / WRD
  Karnataka; industrial in Aligarh → UPSIDA; greenfield airport in Karnataka → KSIIDC). Unrelated bodies are
  never offered: AAI appears only on airport projects, and the API rejects an ineligible pair.
- **State profiles** set district head (Deputy Commissioner in Karnataka, District Magistrate in UP),
  acquisition officer (SLAO / ADM (LA)), sub-district label (Taluk / Tehsil / Mandal) and land records
  (SSLR with Bhoomi in Karnataka — shown as a land-record dependency, never as the acquiring authority; UP
  Revenue land records with Bhulekh). Karnataka and UP are detailed; 23 more states use a compact profile;
  any other state falls back to generic designations rather than invented ones.
- **Flags** pull in forest clearance, railway / highway crossing approvals and UP consolidation.

Adding a state profile is a registry entry; adding a project type is a `PROJECT_TYPES` entry. Which dependencies a
type pulls in is **data**, not branches: `BASE_DEPENDENCY_RULES` plus each type's `dependencies` override, as
any-of / all-of conditions (`always`, `linear`, `flag:forestLand`, `subtype:Reservoir submergence`, `mode:ownership`,
…). The refactor from conditionals to rules was verified output-identical across 8,528 networks (every State/UT ×
type × subtype × flag combination and all 312 corpus projects). The Registry screen shows the resulting
type × dependency matrix.

### National administrative hierarchy

Government bodies do not share one shape, so the hierarchy is configuration (`server/domain/hierarchy.mjs`):

| Template | Levels |
| --- | --- |
| National authority | Country → State → District → Project |
| Central ministry | Country → Ministry → State → District → Project |
| Central ministry with zones | Country → Ministry → Zone → State → District → Project (e.g. Ministry of Railways → Southern Railway) |
| Central organisation | Country → Ministry → Organisation → State → District → Project (e.g. MoRTH → NHAI) |
| Central organisation with regions | … → Organisation → Region → State → … (e.g. POWERGRID → Western Region) |
| State government / department / agency | Country → State → Department → Division → District → Project |

- **States & UTs**: the complete list (28 + 8) with codes, type and zonal council; LGD codes are an empty slot
  filled by the future LGD adapter, never typed by hand.
- **Organisations**: Government of India, an illustrative central coordination cell, 14 ministries / departments
  (MoRTH, Railways, Power, MNRE, MoHUA, Jal Shakti, Commerce & Industry, Petroleum, Civil Aviation, Ports, Coal,
  Defence, DoLR, MoEFCC) and central organisations (NHAI, DFCCIL, NHSRCL, POWERGRID, SECI, AAI, CWC, NICDC, GAIL,
  IOCL). For **every** State / UT the catalogue generates its government, nine departments (revenue, land records,
  law, roads, urban, water, industries, energy, forest) and the agencies the authority registry names.
- **Portfolio matchers** decide what an organisation is concerned with: project types (sector ministries), frameworks
  (DoLR → RFCTLARR proceedings), named authorities (NHAI), dependency codes (MoEFCC → forest clearance) or all.
- **Positions**: a user holds an organisation plus the units chosen under it (zone, state, division, district).
  `resolvePosition` returns the display ladder, the tier (national / region / state / division / district) and
  the concrete scope. `inScope` = geography ∩ portfolio. No separate code path exists for any state.
- **Sectors** (Roads, Railways, Urban, Water, Power, Renewables, Industry, Petroleum, Aviation; Ports, Coal, Defence
  registered without project types yet) group projects under exactly one sector ministry for the national drill-down.

### Land-acquisition issue taxonomy

`server/domain/issues.mjs` names 19 recurring causes of delay — ownership disputes, compensation, documentation,
administrative approvals, litigation, notifications, objections, R&R, forest & environment clearances, utility
shifting, encroachments & encumbrances, mutation / record-of-rights, survey, multiple authorities, slow processes,
coordination, right of way / user, interface approvals and municipal processes — and reads each from evidence the
platform holds: dependency nodes and pending actions, model-vocabulary signals, framework and stage. Thresholds
come from `RULE_THRESHOLDS`, so an issue agrees with the recommendation engine. Issues that cannot arise in a context
are excluded with a reason (a highway never shows right-of-way; a transmission line never shows municipal processes).
Where no signal exists (encumbrances) the profile says *not captured* and names the integration that would supply it.
Profiles appear on project pages, in Scenario Scoring and as a type × issue matrix in the Registry.

### Data integration layer

```
Frontend → LandPulse AI API → Data Integration Layer → Government / external sources (future)
```

Nine provider contracts — land records, registration & encumbrance, court cases, compensation, notifications,
project status, clearances, GIS and administrative units — each with methods, return shapes and the kind of official
system that would sit behind it (e.g. DILRMP-era record-of-rights systems, NGDRS, eCourts / NJDG, PFMS, e-Gazette and
Bhoomi Rashi, PARIVESH, PM Gati Shakti, LGD). **None is connected.** Every slot runs a synthetic adapter over the demo
corpus, and every response carries a provenance envelope (`mode: synthetic`). To connect a source: implement the
contract, register the adapter in `server/integration/adapters.mjs`, start the API with
`LANDPULSE_PROVIDER_<KIND>=<adapter id>`. Nothing above the layer changes.

### Data provenance

Four modes are shown where they matter — **Synthetic demo data**, **User-entered**, **Model-generated** and
**Integration-ready (not connected)**. An *Official source* mode exists in the contract; no adapter produces it.

### Lifecycle: stage status ≠ case status

A statutory stage is **COMPLETED** when its milestone is achieved; individual cases attached to it can
remain open. The engine reports both, separately:

> Objection / Claims — Stage: COMPLETED on 24 Apr 2026 · Case backlog: 27 residual open · 81.1% of 143 resolved

Rules (server/domain/lifecycle.mjs): actual completion ⇒ COMPLETED; frontier past its working deadline ⇒
DELAYED; a gating dependency pending on ≥ 40% of the frontier's open cases with approvals ≥ 45 days
outstanding (or the deadline passed) ⇒ BLOCKED; otherwise IN_PROGRESS; stages ahead ⇒ PENDING (with any
parcels already progressing ahead counted and explained).

### GIS

Boundaries come from **INDIAN-SHAPEFILES** (github.com/datta07/INDIAN-SHAPEFILES, MIT licence), which follows
the Survey of India depiction of the national boundary — the whole of Jammu & Kashmir and Ladakh included —
with LGD / Census codes. `scripts/build-geo.mjs` simplifies them (mapshaper, ~600 m) and repairs broken
transliterated names; outputs in `data/geo/` are committed. The map renders national, state and district
layers with an equirectangular projection, zoom/pan, choropleth, clustering and project popups linking to
the project page. The corpus samples case coordinates inside the real district polygon, and every project
location is verified to fall inside its state.

### Roles

| Role | Scope | Can |
| --- | --- | --- |
| National Administrator | national position | everything, including retraining and deletion |
| Ministry / Organisation Nodal Officer | national, zone or state position, narrowed by the organisation's portfolio | assign / update interventions, review documents, audit |
| State Administrator | state | create/edit projects, CSV upload, assign interventions, review documents |
| District Administrator | district | edit, advance stages, assign interventions, review documents |
| Land Acquisition Officer | district | advance stages, update interventions / cases, file awards & compensation documents |
| Project Implementing Agency | own authority's projects | update interventions, file survey documents |
| Legal Officer | state | legal interventions, case status, legal documents |
| Revenue / Land Records Officer | district | documentation interventions, land-record documents, reviews |
| Field Verification Officer | district | field interventions, case status, survey / R&R documents |
| Policy Viewer | All India | read-only |

Scope comes from the **position**, not the role (the table shows where each role is normally held), and filters every
data endpoint server-side; focus areas route alerts and "my actions". Configured positions refuse roles not held at
that tier (a Land Acquisition Officer cannot be national).

---

## The model

**Task.** Will this case's next statutory milestone slip by more than 30 days? Scored per case, aggregated to
stage and project. **Expected slip days** = P(delay) × a conditional slip regressor trained on delayed,
resolved milestones.

**Split.** Chronological on `assessment_date`: earliest 70% train, next 15% validation, last 15% test. The
metrics below come from the fit on the training window; after passing the gate the same configuration is
refitted on every labelled row, and that refit is what is served.

| Model | ROC-AUC | PR-AUC | Precision | Recall | F1 | Brier |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Gradient boosting (deployed) | 0.834 | 0.716 | 0.610 | 0.707 | 0.655 | 0.146 |
| Logistic regression (baseline) | 0.830 | 0.712 | 0.589 | 0.725 | 0.650 | 0.148 |
| Random forest (comparison) | 0.817 | 0.689 | 0.597 | 0.674 | 0.633 | 0.155 |

Serving model `v20260914-071608` · 83 features · threshold 0.3337 chosen on validation.
State, authority and coordinates are **not** features: geography acts only through recorded district / authority
history, so an unseen State or district is scored on its signals. Conditional slip MAE
55.45 days vs 58.31 for a median baseline (right-censored).

**Served from exported trees.** `ml/train.py` exports the deployed classifier and slip regressor to
`data/model/ensemble.json` (parity with scikit-learn checked before publishing: max difference
0.0). The API scores scenarios, edits, form / CSV / API projects with the
real model — no surrogate, no Python at serve time.

**Explainability.** TreeSHAP on the deployed model for all 350,000 cases (top six per case) and exact TreeSHAP
computed in the API for any new record (a port of the reference algorithm, verified against the SHAP library
to 1e-7). A contribution explains a prediction; it is not a finding of cause.

**Risk bands.** Case risk (one parcel's probability): Medium ≥ 0.3, High ≥ 0.55,
Critical ≥ 0.8. Project risk is the expected share of open current-stage parcels that slip (the
mean case probability), with its own bands: Medium ≥ 0.3, High ≥ 0.45,
Critical ≥ 0.6.

**Stage-wise forecast** (`server/lib/forecast.mjs`). The current stage uses the model's risk; later stages use each
stage's observed delay rate shifted by the project's risk (log-odds effect, decaying ×0.8 per stage). A seeded
2,000-run Monte Carlo draws late / on-time and slip days from the observed distributions and chains them on planned
durations → P(late) per stage, P50 / P80 completion, probability of missing the target.

**Predictive recommendations** (`server/lib/impact.mjs`). Rules decide which actions apply and who owns them
(with framework- and type-specific threshold overrides); each action's change is applied to the project inputs and
re-scored with the deployed model, and actions are ranked by severity and predicted risk reduction.

### Continuous learning

```
outcome (officer entry · CSV · API v1 · simulation release)
  → validated against the case, stored with the prediction made before it (data/learning/outcomes.jsonl)
  → prospective monitoring (live ROC-AUC, precision / recall, Brier, calibration) + PSI drift
  → retrain (manual, or automatic past an outcome threshold)
  → challenger vs champion on the same latest test window (PR-AUC and Brier tolerance 0.01)
  → promote → refit on all labelled rows → export, SHAP, store rebuild, hot reload
  → registry (data/model/registry.json) + archived versions (data/model/versions/) → rollback
```

`data/simulation/future_outcomes.csv` holds the withheld outcomes of the open cases; advancing the simulation clock
releases those that would have become knowable — labelled `simulation` everywhere. 2 model version(s)
are currently registered; champion `v20260914-071608`.

### Alerts and notifications

A scheduler (`LANDPULSE_ALERT_SCAN_MINUTES`, default 15) evaluates every rule, notifies the owning officers of new
alerts, escalates overdue interventions one level up (LAO → District Administrator → State Administrator → National),
and delivers one digest per officer: in-app (delivered), email and SMS (rendered to `data/runtime/outbox/` — no
gateway connected), webhooks (real HTTP POST to `LANDPULSE_WEBHOOK_URL` and to API clients that registered one).

### Integration API and security

`/api/v1` (OpenAPI 3 at `/api/v1/openapi.json`): list projects with risk, risk + drivers + forecast +
recommendations, push project status updates (re-scored immediately), create projects, score a record, record
outcomes, read alerts and interventions. Keys are `X-API-Key`, stored as SHA-256 hashes, with scopes, a jurisdiction
(the same position model as users) and a per-key rate limit.

Passwords are scrypt-hashed with lockout; bearer tokens are 256-bit, hash-stored, header-only, with idle and absolute
expiry; export links use a separate download-only token; CORS is an allowlist (`LANDPULSE_CORS_ORIGINS`); the audit
log is SHA-256 hash-chained and verifiable (`/api/audit/verify`), and records failed sign-ins, exports, downloads and
API writes.

---

## The synthetic corpus

`data/land_acquisition_synthetic_350k.csv` — **350,000 rows × 60 columns**, 312 projects, 25 states, 265
districts, 11 project types. 237,746 labelled rows (positive rate 36.5%); 112,254 open rows scored live.
Real district and taluk names; coordinates sampled inside real district polygons; authorities from the
registry; per-case pending dependency codes and approval delays drive both the outcome and the model.
Everything is seeded and byte-identical on every run.

---

## Verification

```bash
npm run data:verify   # 56 corpus / model / registry / store / deliverable checks
npm run test:smoke    # 211 functional checks: hierarchy & positions, drill-down, issues, integration, roles, CRUD, CSV, documents, workflow,
                      # security, exported model & TreeSHAP, stage forecast, recommendation impact, trends & KPIs, notifications,
                      # continuous learning, API v1, audit chain, consistency
```

The Administration screen runs the same 16 consistency checks live (case counts equal the store, no
aviation bodies outside airports, state-specific authority sets, coordinates inside state and district,
stage-status order, residual backlog explained, project risk bands on cut-offs, stage forecasts coherent, recommendation impacts present, workflow references valid).

## Stack

React 18 · TypeScript · Vite 5 · Tailwind CSS 3 · Recharts · Lucide · React Router 6 · Node HTTP API with
**zero runtime dependencies** · Python (scikit-learn, SHAP) offline pipeline.

---

**LandPulse AI** · Predict Delays. Enable Action. · Built by **RootStack**
