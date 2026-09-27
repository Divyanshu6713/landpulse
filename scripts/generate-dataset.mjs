/**
 * Synthetic land-acquisition corpus generator.
 *
 * Produces ~350,000 case-level acquisition records (one row per land parcel /
 * acquisition case) plus the project registry those cases roll up into.
 *
 *   node scripts/generate-dataset.mjs [--records 350000] [--projects 312]
 *
 * Everything is derived from a fixed seed, so the corpus is byte-identical on
 * every run. No row corresponds to a real acquisition proceeding, department
 * record or landowner — see the prototype data notice in README.md.
 *
 * What is real and what is not
 * ----------------------------
 * Real:      state, district and taluk / tehsil names and district polygons
 *            (data/geo, from administrative boundaries); statutory frameworks
 *            and the dependency structure they imply (server/domain/registry.mjs).
 * Synthetic: every project, case, parcel, village, owner, date, status,
 *            amount and outcome. Coordinates are sampled inside the real
 *            district polygon; they are not surveyed parcel locations.
 *
 * Record framing
 * --------------
 * Each row is a *snapshot of one acquisition case at a point inside its current
 * statutory stage*, together with the outcome of that stage's next milestone.
 *
 *   milestone_due_date = stage_start_date + expected_stage_days
 *   next_milestone_delayed = 1 when the milestone slips by more than 30 days
 *   label_observed = 1 when milestone_due_date + 31 days is already in the past
 *
 * Rows with label_observed = 0 are the live portfolio: their outcome is not yet
 * knowable, so the target columns are blank and the model has to predict them.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  mulberry32,
  gaussFactory,
  pick,
  int,
  float,
  chance,
  weighted,
  expo,
  clamp,
  sigmoid,
  dayFromISO,
  isoFromDay,
} from './lib/rand.mjs';
import {
  VILLAGE_PREFIX,
  VILLAGE_SUFFIX,
  LIFECYCLE_STAGES,
  STAGE_PROFILE,
  LAND_TYPES,
  OWNERSHIP_LEVELS,
  COMPENSATION_BANDS,
  COMPENSATION_STATUSES,
  DISPUTE_COMPLEXITY,
  RESPONSIVENESS,
  RISK_BANDS,
  TEHSIL_FALLBACK,
} from './lib/geo-reference.mjs';
import {
  PROJECT_TYPES,
  authorityOptions,
  buildDependencyNetwork,
  coordinationScore,
  stateProfile,
  DEPENDENCY_BIT,
  DEPENDENCY_CODES,
} from '../server/domain/registry.mjs';
import {
  CORPUS_STATES,
  corpusDistricts,
  districtIndex,
  districtPolygons,
  pointInGeometry,
  resolveDistrict,
} from '../server/domain/geography.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const DATA_DIR = path.join(ROOT, 'data');

/* --------------------------------------------------------------- settings */

const args = process.argv.slice(2);
const argNum = (flag, fallback) => {
  const i = args.indexOf(flag);
  return i >= 0 && args[i + 1] ? Number(args[i + 1]) : fallback;
};

export const TODAY = '2026-09-11';
const TODAY_DAY = dayFromISO(TODAY);

const TOTAL_RECORDS = argNum('--records', 350000);
const PROJECT_COUNT = argNum('--projects', 312);

/** Share of records still inside their milestone window — the live portfolio. */
const OPEN_SHARE = Number(process.env.BP_OPEN_SHARE ?? 0.3);

/** Weight of the unobserved-heterogeneity term in the latent propensity. */
const HIDDEN_WEIGHT = Number(process.env.BP_HIDDEN ?? 0.5);

/** Overall sharpness of the mapping from signals to outcome (tuned for a ~0.84 AUC ceiling). */
const SIGNAL_GAIN = Number(process.env.BP_GAIN ?? 2.0);

const DELAY_THRESHOLD_DAYS = 30;
const RISK_BAND_CUTS = { medium: 0.3, high: 0.55, critical: 0.8 };
const TARGET_POSITIVE_RATE = 0.362;

const STAGE_INDEX = new Map(LIFECYCLE_STAGES.map((s, i) => [s, i]));
const PLANNED_DAYS = LIFECYCLE_STAGES.map((s) => STAGE_PROFILE[s].days);

const PROJECT_STAGE_WEIGHTS = [
  ['Land Identification', 6],
  ['Survey & Verification', 10],
  ['Notification', 9],
  ['Objection / Claims', 11],
  ['Valuation', 10],
  ['Compensation', 16],
  ['Possession', 12],
  ['Rehabilitation & Resettlement', 9],
  ['Closure', 17],
];

/* ------------------------------------------------------- project typology */

/** How often each project type appears in the portfolio. */
const TYPE_WEIGHTS = [
  ['National Highway', 20],
  ['Expressway', 10],
  ['Railway', 13],
  ['Metro Rail', 5],
  ['Urban Infrastructure', 8],
  ['Industrial', 12],
  ['Irrigation', 12],
  ['Power Transmission', 8],
  ['Renewable Energy', 5],
  ['Pipeline', 5],
  ['Airport', 3],
];

/** Where the geographically constrained project types can plausibly sit. */
const METRO_DISTRICTS = {
  Karnataka: ['Bengaluru Urban'],
  'Uttar Pradesh': ['Lucknow', 'Kanpur Nagar', 'Agra', 'Meerut', 'Gautam Buddha Nagar'],
  Maharashtra: ['Pune', 'Nagpur', 'Thane'],
  Gujarat: ['Ahmadabad', 'Surat'],
  'Madhya Pradesh': ['Bhopal', 'Indore'],
  'Tamil Nadu': ['Chennai', 'Coimbatore'],
  Rajasthan: ['Jaipur'],
  Telangana: ['Hyderabad', 'Medchal-Malkajgiri'],
  Kerala: ['Ernakulam'],
  'West Bengal': ['Kolkata', 'North Twenty-Four Parganas'],
  Bihar: ['Patna'],
  Delhi: ['South West', 'North West', 'West'],
  Haryana: ['Gurugram', 'Faridabad'],
};
const RENEWABLE_STATES = ['Rajasthan', 'Gujarat', 'Karnataka', 'Andhra Pradesh', 'Telangana', 'Madhya Pradesh', 'Maharashtra', 'Tamil Nadu', 'Uttar Pradesh'];
const DFC_STATES = ['Uttar Pradesh', 'Haryana', 'Punjab', 'Rajasthan', 'Gujarat', 'Maharashtra', 'Bihar', 'Jharkhand', 'West Bengal'];

function allowedSubtypes(type, state) {
  return PROJECT_TYPES[type].subtypes.filter((st) => {
    if (st === 'High-speed rail') return state === 'Gujarat' || state === 'Maharashtra';
    if (st === 'Suburban rail') return state === 'Karnataka';
    if (st === 'Dedicated freight corridor') return DFC_STATES.includes(state);
    return true;
  });
}

function typeAllowed(type, state) {
  if (type === 'Metro Rail') return Boolean(METRO_DISTRICTS[state]);
  if (type === 'Renewable Energy') return RENEWABLE_STATES.includes(state);
  return true;
}

/**
 * Anchor projects: the named scenarios the platform is demonstrated and tested
 * on. Names describe the kind of work; the projects and all their data are
 * synthetic.
 */
const ANCHOR_PROJECTS = [
  { name: 'Cauvery Basin Lift Irrigation Scheme — Mandya', state: 'Karnataka', type: 'Irrigation', subtype: 'Lift irrigation scheme', districts: ['Mandya'] },
  { name: 'NH-275 Four-Laning — Mandya–Mysuru Section', state: 'Karnataka', type: 'National Highway', subtype: 'Four-laning', districts: ['Mandya', 'Mysuru'] },
  { name: 'NH-19 Six-Laning — Kanpur–Fatehpur Package', state: 'Uttar Pradesh', type: 'National Highway', subtype: 'Six-laning', districts: ['Kanpur Nagar', 'Fatehpur'] },
  { name: 'Aligarh Industrial Area — Phase II', state: 'Uttar Pradesh', type: 'Industrial', subtype: 'Industrial park', districts: ['Aligarh'] },
  { name: 'Lucknow Outer Ring Road — Urban Segment', state: 'Uttar Pradesh', type: 'Urban Infrastructure', subtype: 'Ring road', districts: ['Lucknow'] },
  { name: 'Vijayapura Greenfield Airport — Land Pool', state: 'Karnataka', type: 'Airport', subtype: 'Greenfield airport', districts: ['Vijayapura'] },
  { name: 'Bengaluru Suburban Rail — Corridor 2', state: 'Karnataka', type: 'Railway', subtype: 'Suburban rail', districts: ['Bengaluru Urban', 'Bengaluru Rural'] },
  { name: 'Eastern Dedicated Freight Corridor — Link 9', state: 'Uttar Pradesh', type: 'Railway', subtype: 'Dedicated freight corridor', districts: ['Kanpur Dehat', 'Etawah'] },
  { name: 'Access-Controlled Expressway — Package 7 (Rajasthan)', state: 'Rajasthan', type: 'Expressway', subtype: 'Greenfield expressway', districts: ['Dausa', 'Sawai Madhopur'] },
  { name: 'Bengaluru–Mysuru Access-Controlled Corridor', state: 'Karnataka', type: 'Expressway', subtype: 'Access-controlled upgrade', districts: ['Ramanagara', 'Mandya'] },
  { name: 'High-Speed Rail — Gujarat Section', state: 'Gujarat', type: 'Railway', subtype: 'High-speed rail', districts: ['Valsad', 'Navsari', 'Surat'] },
  { name: 'NH-48 Six-Laning — Vadodara Section', state: 'Gujarat', type: 'National Highway', subtype: 'Six-laning', districts: ['Vadodara', 'Anand'] },
  { name: 'Industrial Corridor Node — Ujjain–Dewas', state: 'Madhya Pradesh', type: 'Industrial', subtype: 'Industrial corridor node', districts: ['Ujjain', 'Dewas'] },
  { name: 'Ludhiana–Bathinda Railway Doubling', state: 'Punjab', type: 'Railway', subtype: 'Doubling / tripling', districts: ['Ludhiana', 'Moga', 'Bathinda'] },
  { name: 'Chennai Peripheral Ring Road — Phase II', state: 'Tamil Nadu', type: 'Expressway', subtype: 'Greenfield expressway', districts: ['Kanchipuram', 'Chengalpattu'], primaryIndex: 1 },
  { name: 'Hyderabad Regional Ring Road — North Arc', state: 'Telangana', type: 'National Highway', subtype: 'Greenfield corridor', districts: ['Sangareddy', 'Medak', 'Siddipet'] },
  { name: 'Meerut–Bulandshahr Greenfield Expressway — Package 2', state: 'Uttar Pradesh', type: 'Expressway', subtype: 'Greenfield expressway', districts: ['Meerut', 'Hapur', 'Bulandshahr'] },
  { name: 'Nagpur–Wardha Expressway Link', state: 'Maharashtra', type: 'Expressway', subtype: 'Greenfield expressway', districts: ['Nagpur', 'Wardha'], primaryIndex: 1 },
  { name: 'Raigarh Greenfield Airport Influence Area', state: 'Maharashtra', type: 'Airport', subtype: 'Greenfield airport', districts: ['Raigarh'] },
  { name: 'Bhopal Metro — Orange Line Extension', state: 'Madhya Pradesh', type: 'Metro Rail', subtype: 'Elevated corridor', districts: ['Bhopal'] },
  { name: 'Kanpur Metro — Phase 2 Alignment', state: 'Uttar Pradesh', type: 'Metro Rail', subtype: 'Elevated corridor', districts: ['Kanpur Nagar'] },
  { name: 'Narmada Canal Command Expansion', state: 'Gujarat', type: 'Irrigation', subtype: 'Canal network', districts: ['Banas Kantha', 'Mahesana'] },
  { name: '765 kV Transmission Line — Western Grid', state: 'Maharashtra', type: 'Power Transmission', subtype: '765 kV line', districts: ['Nashik', 'Ahmednagar'], primaryIndex: 1 },
  { name: 'Chitradurga–Davanagere Industrial Area', state: 'Karnataka', type: 'Industrial', subtype: 'Industrial park', districts: ['Chitradurga', 'Davanagere'] },
  { name: 'Left Main Canal Modernisation — Reach 3', state: 'Andhra Pradesh', type: 'Irrigation', subtype: 'Canal network', districts: ['Guntur', 'Prakasam'] },
  { name: 'Tumakuru Solar Park Extension', state: 'Karnataka', type: 'Renewable Energy', subtype: 'Solar park', districts: ['Tumakuru'], primaryIndex: 1 },
  { name: 'Natural Gas Trunk Pipeline — Kota–Bhilwara Spur', state: 'Rajasthan', type: 'Pipeline', subtype: 'Natural gas trunk line', districts: ['Kota', 'Bhilwara'] },
  { name: 'Yamuna Expressway Logistics Park', state: 'Uttar Pradesh', type: 'Industrial', subtype: 'Logistics park', districts: ['Gautam Buddha Nagar'] },
  { name: '400 kV Line — Tumakuru–Chitradurga', state: 'Karnataka', type: 'Power Transmission', subtype: '400 kV line', districts: ['Tumakuru', 'Chitradurga'] },
  { name: 'Upper Krishna Canal Extension — Vijayapura', state: 'Karnataka', type: 'Irrigation', subtype: 'Canal network', districts: ['Vijayapura', 'Bagalkote'] },
];

const GENERIC_TEMPLATES = {
  'National Highway': ['NH-{h} Four-Laning — {d} Section', 'NH-{h} Bypass — {d}', 'NH-{h} Widening — Package {n}{s}'],
  Expressway: ['{d} Expressway — Package {n}{s}', 'Access-Controlled Expressway — {d} Reach'],
  Railway: ['{d} Railway Doubling', '{d} New Line Project', 'Freight Corridor Link — {d}'],
  'Metro Rail': ['{d} Metro — Phase {n} Corridor', '{d} Metro — Depot & Alignment Land'],
  'Urban Infrastructure': ['{d} Ring Road — Segment {n}', '{d} Planned Layout — Phase {n}', '{d} Water Supply Trunk Main'],
  Industrial: ['{d} Industrial Area — Phase {n}', '{d} Integrated Manufacturing Cluster', '{d} Logistics Park'],
  Irrigation: ['{d} Lift Irrigation Scheme', '{d} Canal Network Expansion', '{d} Reservoir Submergence Area'],
  'Power Transmission': ['{d} 400 kV Transmission Corridor', 'Substation & Line Corridor — {d}'],
  'Renewable Energy': ['{d} Solar Park — Phase {n}', '{d} Wind-Solar Hybrid Park'],
  Pipeline: ['{d} Gas Pipeline Spur', 'Product Pipeline — {d} Section'],
  Airport: ['{d} Greenfield Airport — Phase {n}', '{d} Airport Expansion Land'],
};

/* ------------------------------------------------------- reference tables */

const refRng = mulberry32(26017_2016);
const INDEX = districtIndex();
const POLYGONS = districtPolygons();

/** Historical delay profile per district, assigned in a fixed order so it is stable. */
const DISTRICT_RATE = new Map();
for (const s of CORPUS_STATES) {
  for (const d of INDEX.byState.get(s.state) ?? []) DISTRICT_RATE.set(d.key, Number((0.13 + refRng() * 0.48).toFixed(3)));
}

const AUTHORITY_RATE = new Map();
const authorityRate = (name) => {
  if (!AUTHORITY_RATE.has(name)) {
    // Seeded from the name so the rate does not depend on draw order.
    let h = 2166136261;
    for (let i = 0; i < name.length; i++) h = Math.imul(h ^ name.charCodeAt(i), 16777619);
    AUTHORITY_RATE.set(name, Number((0.17 + mulberry32(h >>> 0)() * 0.36).toFixed(3)));
  }
  return AUTHORITY_RATE.get(name);
};

const dist2 = (a, b) => (a.centroid[0] - b.centroid[0]) ** 2 + (a.centroid[1] - b.centroid[1]) ** 2;

/** A random point inside the district polygon (rejection sampling in its bbox). */
function pointInside(rng, d) {
  const geom = POLYGONS.get(d.key);
  const [x0, y0, x1, y1] = d.bbox;
  for (let i = 0; i < 400; i++) {
    const x = x0 + rng() * (x1 - x0);
    const y = y0 + rng() * (y1 - y0);
    if (pointInGeometry(x, y, geom)) return [x, y];
  }
  return [d.centroid[0], d.centroid[1]];
}

/* -------------------------------------------------------------- projects */

function parcelCountDraw(rng) {
  return weighted(rng, [
    [int(rng, 180, 520), 26],
    [int(rng, 520, 1200), 34],
    [int(rng, 1200, 2400), 24],
    [int(rng, 2400, 4600), 12],
    [int(rng, 4600, 8200), 4],
  ]);
}

function chooseDistricts(rng, state, type, preferred) {
  if (preferred) {
    const resolved = preferred.map((n) => resolveDistrict(state, n)).filter(Boolean);
    if (resolved.length) return resolved;
  }
  if (type === 'Metro Rail') {
    const names = METRO_DISTRICTS[state] ?? [];
    const pool = names.map((n) => resolveDistrict(state, n)).filter(Boolean);
    if (pool.length) return [pick(rng, pool)];
  }
  const pool = corpusDistricts(state);
  const first = pick(rng, pool);
  if (!PROJECT_TYPES[type].linear) return [first];
  // Linear works run through neighbouring districts, not random ones.
  const neighbours = (INDEX.byState.get(state) ?? [])
    .filter((d) => d.key !== first.key && Math.sqrt(dist2(d, first)) < 1.7)
    .sort((a, b) => dist2(a, first) - dist2(b, first));
  const count = Math.min(neighbours.length, int(rng, 0, 2));
  return [first, ...neighbours.slice(0, count)];
}

function buildProjects() {
  const rng = mulberry32(20260911);
  const gauss = gaussFactory(rng);
  const projects = [];
  const stateWeights = CORPUS_STATES.map((s) => [s.state, s.weight]);

  for (let i = 0; i < PROJECT_COUNT; i++) {
    const anchor = ANCHOR_PROJECTS[i];
    let state;
    let type;
    if (anchor) {
      state = anchor.state;
      type = anchor.type;
    } else {
      do {
        state = weighted(rng, stateWeights);
        type = weighted(rng, TYPE_WEIGHTS);
      } while (!typeAllowed(type, state));
    }
    const subtype = anchor?.subtype ?? pick(rng, allowedSubtypes(type, state));
    const districts = chooseDistricts(rng, state, type, anchor?.districts);
    const profile = stateProfile(state);
    const zone = CORPUS_STATES.find((s) => s.state === state)?.zone ?? 'North';

    const options = authorityOptions({ projectType: type, subtype, state, district: districts[0].district });
    const primary = anchor ? options[Math.min(anchor.primaryIndex ?? 0, options.length - 1)] : weighted(rng, options.map((o, k) => [o, k === 0 ? 3 : 1]));

    const linear = PROJECT_TYPES[type].linear;
    const hilly = ['Himachal Pradesh', 'Uttarakhand', 'Jammu & Kashmir', 'Assam', 'Meghalaya', 'Kerala', 'Tripura'].includes(state);
    const flags = {
      forestLand: chance(rng, ({ 'Power Transmission': 0.35, Pipeline: 0.3, 'National Highway': 0.22, Expressway: 0.2, Railway: 0.22, Irrigation: 0.25, 'Renewable Energy': 0.1 }[type] ?? 0.05) + (hilly ? 0.25 : 0)),
      crossesRailway: linear && type !== 'Railway' && chance(rng, 0.45),
      crossesHighway: linear && type !== 'National Highway' && type !== 'Expressway' && chance(rng, 0.5),
      consolidationOpen: state === 'Uttar Pradesh' && chance(rng, 0.3),
    };

    const subDistricts = districts.map((d) => {
      const list = d.subDistricts.length ? d.subDistricts : TEHSIL_FALLBACK.map((t) => `${d.district} ${t}`);
      const n = linear ? Math.min(list.length, int(rng, 1, 3)) : 1;
      const start = int(rng, 0, list.length - 1);
      return Array.from({ length: n }, (_, k) => list[(start + k) % list.length]);
    });

    const network = buildDependencyNetwork({
      projectType: type,
      subtype,
      state,
      district: districts[0].district,
      subDistrict: subDistricts[0][0],
      primaryAuthority: primary,
      affectedFamilies: 1, // refined from the case rows when the registry is written
      flags,
    });

    const name =
      anchor?.name ??
      pick(rng, GENERIC_TEMPLATES[type])
        .replace('{d}', districts[0].district)
        .replace('{h}', String(int(rng, 2, 766)))
        .replace('{n}', String(int(rng, 1, 6)))
        .replace('{s}', pick(rng, ['A', 'B', 'C', '']));

    const stageName = weighted(rng, PROJECT_STAGE_WEIGHTS);
    const stageIdx = STAGE_INDEX.get(stageName);
    const parcels = parcelCountDraw(rng);
    const sizeFactor = clamp(0.72 + Math.log10(parcels / 180) * 0.55, 0.72, 1.85);
    const plannedDays = PLANNED_DAYS.map((d) => Math.round(d * sizeFactor));
    const plannedTotal = plannedDays.reduce((a, b) => a + b, 0);

    const authRate = authorityRate(primary);
    const districtRate = districts.reduce((s, d) => s + (DISTRICT_RATE.get(d.key) ?? 0.33), 0) / districts.length;
    const coordination = coordinationScore(network, authRate);
    const frictionBase = (authRate + districtRate) / 2 + (70 - coordination) / 400;

    const slipDays = LIFECYCLE_STAGES.map((s, si) => {
      if (si > stageIdx) return 0;
      const slipped = rng() < STAGE_PROFILE[s].slip * (0.65 + frictionBase);
      if (!slipped) return int(rng, -9, 6);
      return Math.round(plannedDays[si] * float(rng, 0.12, 0.85));
    });

    let consumed = 0;
    for (let si = 0; si < stageIdx; si++) consumed += plannedDays[si] + slipDays[si];
    const intoCurrent = Math.max(6, Math.round(plannedDays[stageIdx] * float(rng, 0.12, 1.55)));
    const startDay = TODAY_DAY - consumed - intoCurrent;

    const stageActualStart = [];
    let cursor = startDay;
    for (let si = 0; si < LIFECYCLE_STAGES.length; si++) {
      stageActualStart.push(cursor);
      cursor += plannedDays[si] + slipDays[si];
    }
    const plannedStart = [];
    let pcursor = startDay;
    for (let si = 0; si < LIFECYCLE_STAGES.length; si++) {
      plannedStart.push(pcursor);
      pcursor += plannedDays[si];
    }

    // Case geography: a site (area works) or a corridor (linear works) inside each district.
    const sites = districts.map((d) => {
      const a = pointInside(rng, d);
      const b = linear ? pointInside(rng, d) : a;
      return { a, b, spread: linear ? 0.012 : clamp(Math.sqrt(d.areaKm2) / 1400, 0.012, 0.06) };
    });

    projects.push({
      index: i,
      id: `LAP-${1000 + i}`,
      name,
      state,
      stateCode: profile.code,
      zone,
      districts,
      subDistricts,
      sites,
      type,
      subtype,
      framework: network.framework,
      network,
      flags,
      authority: primary,
      authorityRate: authRate,
      districtRate: Number(districtRate.toFixed(3)),
      coordination,
      priority: weighted(rng, [
        ['Routine', 42],
        ['Important', 40],
        ['Critical', 18],
      ]),
      parcels,
      plannedDays,
      plannedTotal,
      slipDays,
      stageActualStart,
      plannedStart,
      stageIdx,
      stageName,
      startDay,
      startDate: isoFromDay(startDay),
      targetCompletionDate: isoFromDay(startDay + plannedTotal),
      landRequirementHa: 0,
      stakeholderResponsiveness: weighted(rng, [
        ['High', 34 - Math.round(frictionBase * 30)],
        ['Moderate', 44],
        ['Low', 14 + Math.round(frictionBase * 34)],
      ]),
      budgetCr: Math.round(parcels * float(rng, 0.9, 4.4) + float(rng, 120, 900)),
      rowFramework: network.framework.mode !== 'ownership',
      gaussSeed: gauss(0, 1),
    });
  }

  const raw = projects.reduce((s, p) => s + p.parcels, 0);
  const scale = TOTAL_RECORDS / raw;
  let running = 0;
  projects.forEach((p, i) => {
    if (i === projects.length - 1) {
      p.parcels = Math.max(40, TOTAL_RECORDS - running);
    } else {
      p.parcels = Math.max(40, Math.round(p.parcels * scale));
      running += p.parcels;
    }
    p.landRequirementHa = Number((p.parcels * float(rng, 0.88, 1.18)).toFixed(1));
  });

  return projects;
}

/* ------------------------------------------------------ case-level fields */

const LEVEL = {
  ownership: new Map(OWNERSHIP_LEVELS.map((v, i) => [v, i])),
  dispute: new Map(DISPUTE_COMPLEXITY.map((v, i) => [v, i])),
  responsiveness: new Map(RESPONSIVENESS.map((v, i) => [v, i])),
};

const LAND_TYPE_EFFECT = {
  'Irrigated Agricultural': 0.1,
  'Dry Agricultural': 0,
  Barren: -0.18,
  Residential: 0.3,
  Commercial: 0.26,
  'Orchard/Plantation': 0.16,
  'Grazing/Common': 0.08,
};

const PRIORITY_EFFECT = { Routine: 0.16, Important: 0, Critical: -0.22 };

/** Base chance a dependency relevant to the case's stage still has an action pending. */
const PENDING_BASE = {
  acquiring_body: 0.16,
  district_administration: 0.14,
  acquisition_officer: 0.18,
  land_records: 0.26,
  clearance: 0.22,
  supporting: 0.15,
  dispute_forum: 0.12,
};

function makeCase(rng, gauss, project, seq) {
  const di = Math.floor(rng() * project.districts.length);
  const district = project.districts[di];
  const tehsil = pick(rng, project.subDistricts[di]);
  const vSuffix = pick(rng, VILLAGE_SUFFIX);
  const village = `${pick(rng, VILLAGE_PREFIX)}${vSuffix ? ` ${vSuffix}` : ''}`;
  const districtRate = DISTRICT_RATE.get(district.key) ?? project.districtRate;

  const openShare = project.stageIdx === 8 ? OPEN_SHARE * 0.35 : OPEN_SHARE;
  const wantOpen = rng() < openShare;

  let stageIdx;
  if (wantOpen) {
    stageIdx = clamp(Math.round(project.stageIdx + gauss(-0.35, 1.15)), 0, 8);
  } else {
    stageIdx = weighted(rng, project.plannedDays.slice(0, project.stageIdx + 1).map((d, i) => [i, d]));
  }
  const stage = LIFECYCLE_STAGES[stageIdx];

  const expectedStageDays = Math.max(14, Math.round(project.plannedDays[stageIdx] * float(rng, 0.8, 1.25)));
  const latestObservableStart = TODAY_DAY - (DELAY_THRESHOLD_DAYS + 1) - expectedStageDays;
  const firstOpenStart = latestObservableStart + 1;
  let stageStartDay = project.stageActualStart[stageIdx] + int(rng, -45, 30);

  const canBeHistorical = latestObservableStart >= project.startDay;
  if (wantOpen || !canBeHistorical) {
    const lo = Math.max(firstOpenStart, project.startDay);
    const hi = Math.max(lo, TODAY_DAY - 4);
    if (stageStartDay < lo || stageStartDay > hi) stageStartDay = int(rng, lo, hi);
  } else {
    if (stageStartDay > latestObservableStart) {
      stageStartDay = latestObservableStart - int(rng, 0, Math.round(expectedStageDays * 0.5));
    }
    if (stageStartDay < project.startDay) stageStartDay = project.startDay;
  }
  if (stageStartDay < project.startDay) stageStartDay = project.startDay;

  let elapsed = Math.max(2, Math.round(expectedStageDays * float(rng, 0.15, 1.05)));
  if (stageStartDay + elapsed > TODAY_DAY) elapsed = Math.max(2, TODAY_DAY - stageStartDay);

  const scheduleConsumed = elapsed / expectedStageDays;
  const work = clamp(scheduleConsumed * float(rng, 0.45, 1.28) + gauss(0, 0.11), 0.02, 1);
  const slack = scheduleConsumed - work;

  const urbanWork = project.type === 'Metro Rail' || project.type === 'Urban Infrastructure';
  const landType = weighted(rng, [
    ['Irrigated Agricultural', urbanWork ? 6 : 26],
    ['Dry Agricultural', urbanWork ? 8 : 30],
    ['Barren', 10],
    ['Residential', urbanWork ? 40 : 12],
    ['Commercial', urbanWork ? 22 : 5],
    ['Orchard/Plantation', urbanWork ? 2 : 9],
    ['Grazing/Common', 8],
  ]);

  const areaHa = Number(
    clamp(Math.exp(gauss(-0.35, 0.95)) * (landType === 'Commercial' || landType === 'Residential' ? 0.45 : 1), 0.04, 14.5).toFixed(3),
  );

  const ownership = weighted(rng, [
    ['Single', 30],
    ['Joint', 37],
    ['Fragmented', 22],
    ['Disputed', 11],
  ]);
  const ownershipLevel = LEVEL.ownership.get(ownership);
  const owners = ownership === 'Single' ? 1 : ownership === 'Joint' ? int(rng, 2, 5) : int(rng, 4, 28);

  // Right-of-way and right-of-user corridors displace almost nobody.
  const familiesScale = project.rowFramework ? 0.15 : 1;
  const familiesRaw =
    landType === 'Barren' || landType === 'Grazing/Common'
      ? chance(rng, 0.82) ? 0 : int(rng, 1, 2)
      : landType === 'Residential'
        ? int(rng, 1, 14)
        : landType === 'Commercial'
          ? int(rng, 0, 6)
          : chance(rng, 0.45) ? 0 : int(rng, 1, 9);
  const families = Math.round(familiesRaw * familiesScale);

  /* ------------------------------------------------------- compensation */
  let compensationStatus;
  if (stageIdx < 3) compensationStatus = 'Not Initiated';
  else if (stageIdx === 3) compensationStatus = chance(rng, 0.55) ? 'Not Initiated' : 'Assessed';
  else if (stageIdx === 4) compensationStatus = work > 0.6 ? 'Awarded' : 'Assessed';
  else if (stageIdx === 5) compensationStatus = work > 0.85 ? 'Paid' : work > 0.5 ? 'Partially Paid' : 'Awarded';
  else compensationStatus = work > 0.4 || stageIdx >= 7 ? 'Paid' : 'Partially Paid';

  // Completion only starts moving once an award exists, so early-stage cases stay at 0%.
  const compCompletion =
    compensationStatus === 'Not Initiated' || compensationStatus === 'Assessed'
      ? 0
      : compensationStatus === 'Awarded'
        ? Math.round(float(rng, 6, 34))
        : compensationStatus === 'Partially Paid'
          ? Math.round(float(rng, 32, 78))
          : Math.round(float(rng, 88, 100));

  const compPendingDays =
    compensationStatus === 'Not Initiated' || compensationStatus === 'Paid'
      ? 0
      : Math.round(clamp(expo(rng, 55 + 130 * (1 - work)), 4, 520));

  const valueLakh = areaHa * (landType === 'Commercial' ? 180 : landType === 'Residential' ? 120 : 22) * float(rng, 0.6, 1.7);
  const compBand =
    valueLakh < 5 ? COMPENSATION_BANDS[0]
      : valueLakh < 15 ? COMPENSATION_BANDS[1]
        : valueLakh < 40 ? COMPENSATION_BANDS[2]
          : valueLakh < 100 ? COMPENSATION_BANDS[3]
            : COMPENSATION_BANDS[4];

  /* -------------------------------------------------------------- legal */
  const legalPressure =
    0.1 +
    0.1 * (ownership === 'Disputed' ? 1 : ownership === 'Fragmented' ? 0.45 : 0) +
    (stageIdx === 3 || stageIdx === 5 ? 0.09 : 0) +
    districtRate * 0.12 +
    (landType === 'Commercial' || landType === 'Residential' ? 0.04 : 0);
  const legalDispute = chance(rng, clamp(legalPressure, 0.03, 0.48)) ? 1 : 0;
  const legalCases = legalDispute ? weighted(rng, [[1, 44], [2, 24], [int(rng, 3, 5), 20], [int(rng, 6, 12), 12]]) : 0;
  const disputeComplexity = !legalDispute ? 'None' : legalCases >= 6 ? 'High' : legalCases >= 3 ? 'Moderate' : 'Low';

  /* ----------------------------------------------------------------- R&R */
  const rrRequired = !project.rowFramework && families >= 2 && chance(rng, landType === 'Residential' ? 0.86 : 0.42) ? 1 : 0;
  const rrProgress = rrRequired
    ? Math.round(clamp((stageIdx >= 7 ? 55 : stageIdx >= 6 ? 28 : 8) + work * 40 + gauss(0, 9), 0, 100))
    : 0;
  const rehabCases = rrRequired ? Math.max(1, Math.round(families * float(rng, 0.4, 1.05))) : 0;

  /* ----------------------------------------------- administrative signals */
  const responsiveness = weighted(rng, [
    ['High', 30 + (project.stakeholderResponsiveness === 'High' ? 34 : 0)],
    ['Moderate', 44],
    ['Low', 20 + (project.stakeholderResponsiveness === 'Low' ? 30 : 0) + Math.round(districtRate * 24)],
  ]);
  const respLevel = LEVEL.responsiveness.get(responsiveness);

  const deptResponseDays = Math.round(clamp(10 + (2 - respLevel) * 14 + districtRate * 32 + gauss(0, 9), 3, 120));
  const docCompleteness = Math.round(clamp(34 + 62 * work + gauss(0, 9), 10, 100));
  const verificationStatus = docCompleteness > 82 && work > 0.7 ? 'Verified' : work > 0.32 ? 'In Progress' : 'Pending';
  const approvalStatus =
    stageIdx >= 6 ? 'Approved' : work > 0.82 ? 'Approved' : work > 0.5 ? 'Under Review' : work > 0.25 ? 'Submitted' : 'Not Submitted';
  const inactivityDays = Math.round(
    clamp(expo(rng, 6 + 62 * (1 - work) + 26 * districtRate + (2 - respLevel) * 7), 0, 400),
  );

  const possessionStatus =
    stageIdx >= 8 ? 'Complete'
      : stageIdx === 7 ? (chance(rng, 0.8) ? 'Complete' : 'Partial')
        : stageIdx === 6 ? (work > 0.7 ? 'Partial' : 'Notice Issued')
          : stageIdx === 5 ? (chance(rng, 0.25) ? 'Notice Issued' : 'Not Initiated')
            : 'Not Initiated';
  const rrStatus = !rrRequired ? 'Not Applicable' : rrProgress >= 97 ? 'Complete' : rrProgress > 5 ? 'In Progress' : 'Not Started';

  /* ------------------------------------------------ department dependencies */
  // Every dependency that gates this stage may still have an action pending on
  // this parcel. Friction from the district, the authority and weak
  // coordination raises the chance; work already done lowers it.
  const friction = 0.55 + districtRate + project.authorityRate * 0.6 + (70 - project.coordination) / 120;
  let pendingMask = 0;
  let pendingGates = 0;
  for (const node of project.network.nodes) {
    if (!node.stages.includes(stage)) continue;
    let p = (PENDING_BASE[node.category] ?? 0.15) * friction * (1.15 - work * 0.85);
    if (node.gate) p *= 1.1;
    if (node.code === 'LAND_RECORDS' && ownershipLevel >= 2) p *= 1.35;
    if (node.code === 'DISPUTE_FORUM' && legalDispute) p *= 2.2;
    if (node.code === 'RR_ADMIN' && !rrRequired) continue;
    if (node.code === 'TREASURY' && (compensationStatus === 'Paid' || compensationStatus === 'Not Initiated')) continue;
    if (rng() < clamp(p, 0.01, 0.85)) {
      pendingMask |= DEPENDENCY_BIT[node.code];
      if (node.gate) pendingGates++;
    }
  }
  let pendingCount = 0;
  for (let m = pendingMask; m; m &= m - 1) pendingCount++;
  const approvalDelayDays = pendingGates
    ? Math.round(clamp(expo(rng, 22 + 60 * districtRate + 18 * pendingGates) + 10 * pendingGates, 4, 365))
    : pendingCount && chance(rng, 0.35)
      ? Math.round(clamp(expo(rng, 12), 1, 90))
      : 0;

  /* --------------------------------------------------- historical signals */
  const historicalStageRate = Number(clamp(STAGE_PROFILE[stage].slip + gauss(0, 0.055), 0.02, 0.88).toFixed(3));

  /* ------------------------------------------------------------ geography */
  const site = project.sites[di];
  const t = rng();
  let lon;
  let lat;
  const geom = POLYGONS.get(district.key);
  for (let attempt = 0; attempt < 12; attempt++) {
    const bx = site.a[0] + (site.b[0] - site.a[0]) * t;
    const by = site.a[1] + (site.b[1] - site.a[1]) * t;
    lon = bx + gauss(0, site.spread);
    lat = by + gauss(0, site.spread);
    if (pointInGeometry(lon, lat, geom)) break;
    if (attempt === 11) {
      lon = site.a[0];
      lat = site.a[1];
    }
  }

  const milestoneDueDay = stageStartDay + expectedStageDays;
  const assessmentDay = stageStartDay + elapsed;

  return {
    seq,
    district: district.district,
    tehsil,
    village,
    lat: Number(lat.toFixed(5)),
    lon: Number(lon.toFixed(5)),
    stage,
    stageIdx,
    stageStartDay,
    expectedStageDays,
    elapsed,
    milestoneDueDay,
    assessmentDay,
    landType,
    areaHa,
    ownership,
    ownershipLevel,
    owners,
    families,
    compensationStatus,
    compCompletion,
    compPendingDays,
    compBand,
    legalDispute,
    legalCases,
    disputeComplexity,
    rrRequired,
    rrProgress,
    rehabCases,
    responsiveness,
    respLevel,
    deptResponseDays,
    docCompleteness,
    verificationStatus,
    approvalStatus,
    inactivityDays,
    possessionStatus,
    rrStatus,
    historicalStageRate,
    districtRate,
    pendingMask,
    pendingCount,
    approvalDelayDays,
    work,
    slack,
    surveyNo: `${int(rng, 12, 899)}/${int(rng, 1, 24)}${chance(rng, 0.3) ? pick(rng, ['A', 'B', 'C']) : ''}`,
  };
}

/**
 * Latent delay propensity, built from combinations of signals with an
 * unobserved heterogeneity term so no single column determines the outcome.
 */
function latentLogit(c, project, hidden) {
  const compPendingFrac = c.stageIdx >= 4 ? (100 - c.compCompletion) / 100 : 0.22;
  const rrPendingFrac = c.rrRequired ? (100 - c.rrProgress) / 100 : 0;

  return SIGNAL_GAIN * (
    2.0 * clamp(c.slack, -0.5, 1.2) +
    0.9 * compPendingFrac +
    0.75 * Math.min(1, c.legalCases / 5) +
    0.4 * (LEVEL.dispute.get(c.disputeComplexity) / 3) +
    0.5 * (c.ownershipLevel / 3) +
    0.8 * Math.min(1, c.inactivityDays / 150) +
    0.65 * (1 - c.docCompleteness / 100) +
    0.38 * ((2 - c.respLevel) / 2) +
    0.45 * (c.deptResponseDays / 120) +
    1.05 * (c.historicalStageRate - 0.28) +
    1.1 * (c.districtRate - 0.33) +
    0.9 * (project.authorityRate - 0.33) +
    0.28 * (Math.log1p(c.families) / 2.7) +
    0.32 * rrPendingFrac +
    // department dependencies
    0.6 * Math.min(1, c.pendingCount / 3) +
    0.55 * Math.min(1, c.approvalDelayDays / 150) +
    0.03 * (project.network.dependencyCount - 11) +
    0.6 * ((65 - project.coordination) / 100) +
    // interactions
    0.5 * compPendingFrac * Math.min(1, c.legalCases / 5) +
    0.4 * (c.ownershipLevel / 3) * (1 - c.docCompleteness / 100) +
    0.35 * (c.stage === 'Compensation' ? compPendingFrac : 0) +
    0.28 * (c.stage === 'Objection / Claims' ? Math.min(1, c.legalCases / 4) : 0) +
    0.3 * (c.pendingMask & DEPENDENCY_BIT.LAND_RECORDS ? c.ownershipLevel / 3 : 0) +
    PRIORITY_EFFECT[project.priority] +
    LAND_TYPE_EFFECT[c.landType] +
    HIDDEN_WEIGHT * hidden
  );
}

function calibrateIntercept(projects) {
  const rng = mulberry32(555_1234);
  const gauss = gaussFactory(rng);
  const sample = [];
  for (let i = 0; i < 40000; i++) {
    const project = projects[Math.floor(rng() * projects.length)];
    const c = makeCase(rng, gauss, project, i);
    sample.push(latentLogit(c, project, gauss(0, 1)));
  }
  let lo = -6;
  let hi = 4;
  for (let it = 0; it < 60; it++) {
    const mid = (lo + hi) / 2;
    let mean = 0;
    for (const z of sample) mean += sigmoid(z + mid);
    mean /= sample.length;
    if (mean > TARGET_POSITIVE_RATE) hi = mid;
    else lo = mid;
  }
  return Number(((lo + hi) / 2).toFixed(5));
}

/* ------------------------------------------------------------ CSV writing */

export const CSV_COLUMNS = [
  'case_id',
  'project_id',
  'parcel_id',
  'state',
  'district',
  'tehsil',
  'village',
  'latitude',
  'longitude',
  'project_name',
  'project_type',
  'project_subtype',
  'acquisition_framework',
  'authority',
  'project_priority',
  'project_land_requirement_ha',
  'project_start_date',
  'target_completion_date',
  'survey_number',
  'land_area_ha',
  'land_type',
  'current_stage',
  'stage_start_date',
  'expected_stage_days',
  'elapsed_stage_days',
  'milestone_due_date',
  'assessment_date',
  'affected_families',
  'ownership_complexity',
  'number_of_owners',
  'compensation_status',
  'compensation_amount_band',
  'compensation_pending_days',
  'compensation_completion_percentage',
  'legal_dispute',
  'legal_case_count',
  'dispute_complexity',
  'rr_required',
  'rr_progress_percentage',
  'rehabilitation_cases',
  'stakeholder_responsiveness',
  'department_response_days',
  'document_completeness',
  'verification_status',
  'approval_status',
  'inactivity_days',
  'possession_status',
  'rr_status',
  'authority_dependency_count',
  'pending_dependency_actions',
  'pending_dependency_codes',
  'approval_delay_days',
  'department_coordination_score',
  'historical_stage_delay_rate',
  'district_historical_delay_rate',
  'authority_historical_delay_rate',
  'label_observed',
  'next_milestone_delayed',
  'delay_risk_category',
  'actual_stage_delay_days',
];

const MISSING_RATES = {
  affected_families: 0.021,
  compensation_amount_band: 0.034,
  document_completeness: 0.028,
  stakeholder_responsiveness: 0.017,
  department_response_days: 0.042,
  number_of_owners: 0.012,
  rr_progress_percentage: 0.019,
};

const csvCell = (v) => {
  if (v === null || v === undefined) return '';
  const s = String(v);
  return s.includes(',') || s.includes('"') ? `"${s.replace(/"/g, '""')}"` : s;
};

const codesOf = (mask) => DEPENDENCY_CODES.filter((_, i) => mask & (1 << i)).join(';');

/* ------------------------------------------------------------------- main */

async function main() {
  const t0 = Date.now();
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.mkdirSync(path.join(DATA_DIR, 'model'), { recursive: true });

  const projects = buildProjects();
  const intercept = calibrateIntercept(projects);
  console.log(`[generate] ${projects.length} projects · intercept ${intercept}`);

  const csvPath = path.join(DATA_DIR, 'land_acquisition_synthetic_350k.csv');
  const out = fs.createWriteStream(csvPath, { encoding: 'utf8', highWaterMark: 1 << 22 });
  const write = (chunk) => (out.write(chunk) ? Promise.resolve() : new Promise((r) => out.once('drain', r)));
  await write(`${CSV_COLUMNS.join(',')}\n`);

  const rng = mulberry32(77120926);
  const gauss = gaussFactory(rng);

  const stats = {
    records: 0,
    observed: 0,
    positives: 0,
    riskBand: Object.fromEntries(RISK_BANDS.map((b) => [b, 0])),
    stage: Object.fromEntries(LIFECYCLE_STAGES.map((s) => [s, 0])),
    state: {},
    projectType: {},
    landType: Object.fromEntries(LAND_TYPES.map((s) => [s, 0])),
    ownership: Object.fromEntries(OWNERSHIP_LEVELS.map((s) => [s, 0])),
    compensation: Object.fromEntries(COMPENSATION_STATUSES.map((s) => [s, 0])),
    legalDispute: 0,
    rrRequired: 0,
    missing: Object.fromEntries(Object.keys(MISSING_RATES).map((k) => [k, 0])),
    delayDaysSum: 0,
    delayDaysCount: 0,
    areaSum: 0,
    familiesSum: 0,
    assessmentMonth: {},
    pendingDependency: Object.fromEntries(DEPENDENCY_CODES.map((c) => [c, 0])),
  };

  const districtAgg = new Map();
  let buffer = [];
  let caseSeq = 0;

  // Outcomes of the open cases, withheld from the corpus. They let the platform
  // demonstrate continuous learning honestly: "advancing the simulation clock"
  // releases the outcomes that would have become knowable by then, exactly as
  // newly completed milestones would arrive from the field. Writing this file
  // does not consume random draws, so the corpus stays byte-identical.
  const simDir = path.join(DATA_DIR, 'simulation');
  fs.mkdirSync(simDir, { recursive: true });
  const futureRows = ['case_id,milestone_due_date,outcome_knowable_date,next_milestone_delayed,actual_stage_delay_days'];

  for (const project of projects) {
    const agg = {
      parcels: 0,
      areaHa: 0,
      families: 0,
      legalCases: 0,
      legalDisputes: 0,
      compCompletionSum: 0,
      possessionComplete: 0,
      possessionPartial: 0,
      rrRequired: 0,
      rrProgressSum: 0,
      rrCases: 0,
      openCases: 0,
      observedCases: 0,
      observedPositives: 0,
      inactivitySum: 0,
      docSum: 0,
      approvalDelaySum: 0,
      approvalDelayN: 0,
      stageCounts: Object.fromEntries(LIFECYCLE_STAGES.map((s) => [s, 0])),
      stageOpen: Object.fromEntries(LIFECYCLE_STAGES.map((s) => [s, 0])),
      districtCounts: {},
      latSum: 0,
      lonSum: 0,
      ownershipCounts: Object.fromEntries(OWNERSHIP_LEVELS.map((s) => [s, 0])),
      riskBandTruth: Object.fromEntries(RISK_BANDS.map((b) => [b, 0])),
      firstRow: caseSeq,
    };

    for (let k = 0; k < project.parcels; k++) {
      const c = makeCase(rng, gauss, project, caseSeq);
      const hidden = gauss(0, 1);
      const z = latentLogit(c, project, hidden) + intercept;
      const p = sigmoid(z);
      const delayed = rng() < p ? 1 : 0;

      const delayDays = delayed
        ? // How far a delayed milestone slips depends on what is holding it: pending
          // clearances, litigation and unpaid compensation stretch the tail.
          DELAY_THRESHOLD_DAYS + 1 + Math.round(expo(rng, 12 + 60 * p + 0.4 * c.approvalDelayDays + 7 * Math.min(6, c.legalCases) + 9 * c.pendingCount + (c.stageIdx >= 4 ? 0.25 * (100 - c.compCompletion) : 0)))
        : Math.round(clamp(gauss(-3, 9), -28, DELAY_THRESHOLD_DAYS - 2));

      const observed = c.milestoneDueDay + DELAY_THRESHOLD_DAYS + 1 <= TODAY_DAY ? 1 : 0;
      const resolved = observed && c.milestoneDueDay + Math.max(0, delayDays) <= TODAY_DAY;
      const band = p >= RISK_BAND_CUTS.critical ? 'Critical' : p >= RISK_BAND_CUTS.high ? 'High' : p >= RISK_BAND_CUTS.medium ? 'Medium' : 'Low';

      const caseId = `LAC-${String(500000 + caseSeq)}`;
      if (!observed) {
        futureRows.push(`${caseId},${isoFromDay(c.milestoneDueDay)},${isoFromDay(c.milestoneDueDay + DELAY_THRESHOLD_DAYS + 1)},${delayed},${delayDays}`);
      }
      const parcelId = `${project.stateCode}-${c.district.slice(0, 3).toUpperCase().replace(/[^A-Z]/g, 'X')}-${String(10000 + (caseSeq % 89999))}`;

      const miss = (key) => rng() < MISSING_RATES[key];
      const mFamilies = miss('affected_families');
      const mBand = miss('compensation_amount_band');
      const mDoc = miss('document_completeness');
      const mResp = miss('stakeholder_responsiveness');
      const mDept = miss('department_response_days');
      const mOwners = miss('number_of_owners');
      const mRR = c.rrRequired ? miss('rr_progress_percentage') : false;
      if (mFamilies) stats.missing.affected_families++;
      if (mBand) stats.missing.compensation_amount_band++;
      if (mDoc) stats.missing.document_completeness++;
      if (mResp) stats.missing.stakeholder_responsiveness++;
      if (mDept) stats.missing.department_response_days++;
      if (mOwners) stats.missing.number_of_owners++;
      if (mRR) stats.missing.rr_progress_percentage++;

      buffer.push(
        [
          caseId,
          project.id,
          parcelId,
          csvCell(project.state),
          csvCell(c.district),
          csvCell(c.tehsil),
          csvCell(c.village),
          c.lat,
          c.lon,
          csvCell(project.name),
          csvCell(project.type),
          csvCell(project.subtype),
          project.framework.id,
          csvCell(project.authority),
          project.priority,
          project.landRequirementHa,
          project.startDate,
          project.targetCompletionDate,
          c.surveyNo,
          c.areaHa,
          csvCell(c.landType),
          csvCell(c.stage),
          isoFromDay(c.stageStartDay),
          c.expectedStageDays,
          c.elapsed,
          isoFromDay(c.milestoneDueDay),
          isoFromDay(c.assessmentDay),
          mFamilies ? '' : c.families,
          c.ownership,
          mOwners ? '' : c.owners,
          csvCell(c.compensationStatus),
          mBand ? '' : c.compBand,
          c.compPendingDays,
          c.compCompletion,
          c.legalDispute,
          c.legalCases,
          c.disputeComplexity,
          c.rrRequired,
          c.rrRequired ? (mRR ? '' : c.rrProgress) : '',
          c.rehabCases,
          mResp ? '' : c.responsiveness,
          mDept ? '' : c.deptResponseDays,
          mDoc ? '' : c.docCompleteness,
          c.verificationStatus,
          csvCell(c.approvalStatus),
          c.inactivityDays,
          csvCell(c.possessionStatus),
          csvCell(c.rrStatus),
          project.network.dependencyCount,
          c.pendingCount,
          codesOf(c.pendingMask),
          c.approvalDelayDays,
          project.coordination,
          c.historicalStageRate,
          c.districtRate,
          project.authorityRate,
          observed,
          observed ? delayed : '',
          observed ? band : '',
          resolved ? delayDays : '',
        ].join(','),
      );

      agg.parcels++;
      agg.areaHa += c.areaHa;
      agg.families += c.families;
      agg.legalCases += c.legalCases;
      agg.legalDisputes += c.legalDispute;
      agg.compCompletionSum += c.compCompletion;
      if (c.possessionStatus === 'Complete') agg.possessionComplete++;
      if (c.possessionStatus === 'Partial') agg.possessionPartial++;
      agg.rrRequired += c.rrRequired;
      agg.rrProgressSum += c.rrRequired ? c.rrProgress : 0;
      agg.rrCases += c.rehabCases;
      agg.inactivitySum += c.inactivityDays;
      agg.docSum += c.docCompleteness;
      if (c.approvalDelayDays > 0) {
        agg.approvalDelaySum += c.approvalDelayDays;
        agg.approvalDelayN++;
      }
      agg.stageCounts[c.stage]++;
      agg.ownershipCounts[c.ownership]++;
      agg.districtCounts[c.district] = (agg.districtCounts[c.district] ?? 0) + 1;
      agg.latSum += c.lat;
      agg.lonSum += c.lon;
      agg.riskBandTruth[band]++;
      if (observed) {
        agg.observedCases++;
        agg.observedPositives += delayed;
      } else {
        agg.openCases++;
        agg.stageOpen[c.stage]++;
      }

      stats.records++;
      stats.observed += observed;
      stats.positives += observed ? delayed : 0;
      stats.riskBand[band]++;
      stats.stage[c.stage]++;
      stats.state[project.state] = (stats.state[project.state] ?? 0) + 1;
      stats.projectType[project.type] = (stats.projectType[project.type] ?? 0) + 1;
      stats.landType[c.landType]++;
      stats.ownership[c.ownership]++;
      stats.compensation[c.compensationStatus]++;
      stats.legalDispute += c.legalDispute;
      stats.rrRequired += c.rrRequired;
      stats.areaSum += c.areaHa;
      stats.familiesSum += c.families;
      for (let b = 0; b < DEPENDENCY_CODES.length; b++) if (c.pendingMask & (1 << b)) stats.pendingDependency[DEPENDENCY_CODES[b]]++;
      if (resolved) {
        stats.delayDaysSum += delayDays;
        stats.delayDaysCount++;
      }
      const ym = isoFromDay(c.assessmentDay).slice(0, 7);
      stats.assessmentMonth[ym] = (stats.assessmentMonth[ym] ?? 0) + 1;

      const dkey = `${project.state}|${c.district}`;
      let d = districtAgg.get(dkey);
      if (!d) {
        d = { state: project.state, district: c.district, cases: 0, open: 0, areaHa: 0, legal: 0, lat: 0, lon: 0 };
        districtAgg.set(dkey, d);
      }
      d.cases++;
      if (!observed) d.open++;
      d.areaHa += c.areaHa;
      d.legal += c.legalDispute;
      d.lat += c.lat;
      d.lon += c.lon;

      caseSeq++;
      if (buffer.length >= 4000) {
        await write(`${buffer.join('\n')}\n`);
        buffer = [];
      }
    }

    project.agg = agg;
    if (project.index % 40 === 0) console.log(`[generate] ${stats.records.toLocaleString('en-IN')} rows…`);
  }

  if (buffer.length) await write(`${buffer.join('\n')}\n`);
  await new Promise((r) => out.end(r));
  fs.writeFileSync(path.join(simDir, 'future_outcomes.csv'), `${futureRows.join('\n')}\n`);
  console.log(`[generate] ${(futureRows.length - 1).toLocaleString('en-IN')} withheld future outcomes → data/simulation/future_outcomes.csv`);

  /* --------------------------------------------------- project registry */
  // Stage statuses are not written here: the lifecycle engine
  // (server/domain/lifecycle.mjs) derives them from these dates and the case
  // data, in one place, for every consumer.
  const registry = projects.map((p) => {
    const a = p.agg;
    const network = buildDependencyNetwork({
      projectType: p.type,
      subtype: p.subtype,
      state: p.state,
      district: p.districts[0].district,
      subDistrict: p.subDistricts[0][0],
      primaryAuthority: p.authority,
      affectedFamilies: a.families,
      flags: p.flags,
    });
    const stages = LIFECYCLE_STAGES.map((name, i) => {
      const baselineEndDay = p.plannedStart[i] + p.plannedDays[i];
      const actualStartDay = p.stageActualStart[i];
      const expectedEndDay = actualStartDay + p.plannedDays[i];
      const actualEndDay = expectedEndDay + p.slipDays[i];
      return {
        name,
        index: i,
        plannedStart: isoFromDay(p.plannedStart[i]),
        baselineCompletion: isoFromDay(baselineEndDay),
        expectedCompletion: isoFromDay(expectedEndDay),
        actualStart: i <= p.stageIdx ? isoFromDay(actualStartDay) : null,
        actualCompletion: i < p.stageIdx ? isoFromDay(actualEndDay) : null,
        slipDays: i < p.stageIdx ? p.slipDays[i] : 0,
        plannedDays: p.plannedDays[i],
        openCases: a.stageOpen[name],
        totalCases: a.stageCounts[name],
        milestone: network.milestones[name],
      };
    });

    const current = stages[p.stageIdx];
    const compensationPct = Number((a.compCompletionSum / Math.max(1, a.parcels)).toFixed(1));
    const possessionPct = Number((((a.possessionComplete + a.possessionPartial * 0.5) / Math.max(1, a.parcels)) * 100).toFixed(1));
    const rrPct = Number((a.rrProgressSum / Math.max(1, a.rrRequired)).toFixed(1));
    const topDistrict = Object.entries(a.districtCounts).sort((x, y) => y[1] - x[1])[0][0];

    return {
      id: p.id,
      name: p.name,
      type: p.type,
      subtype: p.subtype,
      framework: network.framework,
      state: p.state,
      stateCode: p.stateCode,
      zone: p.zone,
      districts: p.districts.map((d) => d.district),
      district: topDistrict,
      subDistricts: Array.from(new Set(p.subDistricts.flat())),
      subDistrict: p.subDistricts[0][0],
      subDistrictLabel: network.stateProfile.subDistrictLabel,
      authority: p.authority,
      flags: p.flags,
      network: { ...network, milestones: undefined },
      coordinationScore: p.coordination,
      priority: p.priority,
      startDate: p.startDate,
      targetCompletionDate: p.targetCompletionDate,
      totalParcels: a.parcels,
      openCases: a.openCases,
      observedCases: a.observedCases,
      observedDelayRate: Number((a.observedPositives / Math.max(1, a.observedCases)).toFixed(4)),
      landRequirementHa: p.landRequirementHa,
      parcelAreaHa: Number(a.areaHa.toFixed(1)),
      affectedFamilies: a.families,
      legalCases: a.legalCases,
      legalDisputeParcels: a.legalDisputes,
      compensationCompletionPct: compensationPct,
      compensationStatus:
        compensationPct > 92 ? 'Paid' : compensationPct > 55 ? 'Partially Paid' : compensationPct > 18 ? 'Awarded' : compensationPct > 3 ? 'Assessed' : 'Not Initiated',
      possessionCompletionPct: possessionPct,
      possessionStatus: possessionPct > 90 ? 'Complete' : possessionPct > 25 ? 'Partial' : p.stageIdx >= 6 ? 'Notice Issued' : 'Not Initiated',
      rrRequiredParcels: a.rrRequired,
      rrCases: a.rrCases,
      rrProgressPct: a.rrRequired ? rrPct : null,
      rrStatus: a.rrRequired === 0 ? 'Not Applicable' : rrPct > 95 ? 'Complete' : rrPct > 5 ? 'In Progress' : 'Not Started',
      dominantOwnership: Object.entries(a.ownershipCounts).sort((x, y) => y[1] - x[1])[0][0],
      stakeholderResponsiveness: p.stakeholderResponsiveness,
      avgInactivityDays: Number((a.inactivitySum / Math.max(1, a.parcels)).toFixed(1)),
      avgDocumentCompleteness: Number((a.docSum / Math.max(1, a.parcels)).toFixed(1)),
      approvalDelayDays: a.approvalDelayN ? Math.round(a.approvalDelaySum / a.approvalDelayN) : 0,
      districtDelayRate: p.districtRate,
      authorityDelayRate: p.authorityRate,
      budgetCr: p.budgetCr,
      currentStage: current.name,
      currentStageIndex: p.stageIdx,
      currentMilestone: current.milestone,
      milestoneDeadline: current.expectedCompletion,
      stages,
      lat: Number((a.latSum / Math.max(1, a.parcels)).toFixed(4)),
      lon: Number((a.lonSum / Math.max(1, a.parcels)).toFixed(4)),
      rowRange: [a.firstRow, a.firstRow + a.parcels - 1],
      truthRiskMix: a.riskBandTruth,
      dataSource: 'synthetic',
    };
  });

  fs.writeFileSync(
    path.join(DATA_DIR, 'projects.raw.json'),
    JSON.stringify({ generatedAt: new Date().toISOString(), today: TODAY, projects: registry }, null, 1),
  );

  const districts = Array.from(districtAgg.values()).map((d) => ({
    state: d.state,
    district: d.district,
    cases: d.cases,
    openCases: d.open,
    areaHa: Number(d.areaHa.toFixed(1)),
    legalDisputes: d.legal,
    lat: Number((d.lat / d.cases).toFixed(4)),
    lon: Number((d.lon / d.cases).toFixed(4)),
  }));

  const meta = {
    datasetName: 'land_acquisition_synthetic_350k',
    generatedAt: new Date().toISOString(),
    snapshotDate: TODAY,
    records: stats.records,
    projects: registry.length,
    states: Object.keys(stats.state).length,
    districts: districts.length,
    columns: CSV_COLUMNS.length,
    delayThresholdDays: DELAY_THRESHOLD_DAYS,
    interceptCalibration: intercept,
    geography: districtIndex().attribution,
    labels: {
      observed: stats.observed,
      open: stats.records - stats.observed,
      positives: stats.positives,
      positiveRate: Number((stats.positives / Math.max(1, stats.observed)).toFixed(4)),
    },
    distributions: {
      riskBand: stats.riskBand,
      stage: stats.stage,
      state: stats.state,
      projectType: stats.projectType,
      landType: stats.landType,
      ownership: stats.ownership,
      compensation: stats.compensation,
      assessmentMonth: stats.assessmentMonth,
      pendingDependency: stats.pendingDependency,
    },
    aggregates: {
      legalDisputeParcels: stats.legalDispute,
      rrRequiredParcels: stats.rrRequired,
      totalAreaHa: Number(stats.areaSum.toFixed(1)),
      totalAffectedFamilies: stats.familiesSum,
      avgObservedStageDelayDays: Number((stats.delayDaysSum / Math.max(1, stats.delayDaysCount)).toFixed(2)),
      resolvedStageOutcomes: stats.delayDaysCount,
    },
    missing: stats.missing,
    missingRates: Object.fromEntries(Object.entries(stats.missing).map(([k, v]) => [k, Number((v / stats.records).toFixed(5))])),
    districtsTable: districts,
  };

  fs.writeFileSync(path.join(DATA_DIR, 'dataset-meta.json'), JSON.stringify(meta, null, 1));

  const bytes = fs.statSync(csvPath).size;
  console.log(
    `[generate] ${stats.records.toLocaleString('en-IN')} rows · ${(bytes / 1048576).toFixed(1)} MB · ` +
      `observed ${stats.observed.toLocaleString('en-IN')} (${((stats.observed / stats.records) * 100).toFixed(1)}%) · ` +
      `positive rate ${(meta.labels.positiveRate * 100).toFixed(2)}% · ${((Date.now() - t0) / 1000).toFixed(1)}s`,
  );
  console.log(`[generate] risk band mix: ${JSON.stringify(stats.riskBand)}`);
  console.log(`[generate] project types: ${JSON.stringify(stats.projectType)}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
