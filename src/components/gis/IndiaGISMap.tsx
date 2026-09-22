import { useCallback, useEffect, useMemo, useRef, useState, type PointerEvent as RPointerEvent, type WheelEvent as RWheelEvent } from 'react';
import { ExternalLink, Layers, LocateFixed, Minus, Plus, X } from 'lucide-react';
import { cn } from '@/lib/cn';
import { RISK_HEX, riskFromScore } from '@/lib/risk';
import { STAGE_STATUS_LABEL } from '@/lib/status';
import type { GeoCollection, GeoFeature, MapPoint, MapProject, RiskLevel } from '@/data/types';

/**
 * India administrative GIS canvas.
 *
 * Layers, bottom to top:
 *   national boundary   (Survey of India depiction, incl. the whole of J&K and Ladakh)
 *   states              choropleth by mean project risk, clickable
 *   districts           loaded for the selected state, choropleth, clickable
 *   case / parcel layer optional thinned points (project screens)
 *   project markers     one per project, clustered at low zoom
 *
 * Boundaries come from /api/geo/boundaries (data/geo, built by
 * scripts/build-geo.mjs). Project and case positions are synthetic demo
 * locations sampled inside the real district polygon — they are not surveyed
 * project sites, and the legend says so.
 *
 * Projection: equirectangular with longitude scaled by cos(23.5°), which keeps
 * India's proportions within a few percent without a projection library.
 */

const K = Math.cos((23.5 * Math.PI) / 180);
const LON0 = 68;
const LAT_TOP = 37.6;
const project = (lon: number, lat: number): [number, number] => [(lon - LON0) * K, LAT_TOP - lat];
const unproject = (x: number, y: number): [number, number] => [x / K + LON0, LAT_TOP - y];

const FULL = (() => {
  const [x0, y0] = project(67.8, 37.6);
  const [x1, y1] = project(97.8, 6.2);
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
})();

type View = { x: number; y: number; w: number; h: number };

function ringsOf(g: GeoFeature['geometry']): number[][][] {
  return g.type === 'Polygon' ? (g.coordinates as number[][][]) : (g.coordinates as number[][][][]).flat();
}

function pathOf(f: GeoFeature) {
  let d = '';
  for (const ring of ringsOf(f.geometry)) {
    ring.forEach(([lon, lat], i) => {
      const [x, y] = project(lon, lat);
      d += `${i === 0 ? 'M' : 'L'}${x.toFixed(3)} ${y.toFixed(3)}`;
    });
    d += 'Z';
  }
  return d;
}

function bboxOf(features: GeoFeature[]): View | null {
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (const f of features) {
    for (const ring of ringsOf(f.geometry)) {
      for (const [lon, lat] of ring) {
        const [x, y] = project(lon, lat);
        if (x < x0) x0 = x;
        if (y < y0) y0 = y;
        if (x > x1) x1 = x;
        if (y > y1) y1 = y;
      }
    }
  }
  return Number.isFinite(x0) ? { x: x0, y: y0, w: x1 - x0, h: y1 - y0 } : null;
}

const BAND_ORDER: RiskLevel[] = ['Low', 'Medium', 'High', 'Critical'];

export interface MapStateStat {
  state: string;
  projects: number;
  avgRisk: number;
  highOrCritical: number;
}
export interface MapDistrictStat {
  key: string;
  district: string;
  state: string;
  projects: number;
  avgRisk: number;
  openCases: number;
}

export function IndiaGISMap({
  outline,
  states,
  districts,
  projects,
  points,
  stateStats,
  districtStats,
  selectedState,
  selectedDistrict,
  selectedProjectId,
  onSelectState,
  onSelectDistrict,
  onOpenProject,
  onSelectCase,
  focusBounds,
  height = 620,
  showLayersControl = true,
  className,
}: {
  outline?: GeoCollection | null;
  states?: GeoCollection | null;
  districts?: GeoCollection | null;
  projects: MapProject[];
  points?: MapPoint[];
  stateStats?: Map<string, MapStateStat>;
  districtStats?: Map<string, MapDistrictStat>;
  selectedState?: string | null;
  selectedDistrict?: string | null;
  selectedProjectId?: string | null;
  onSelectState?: (state: string | null) => void;
  onSelectDistrict?: (key: string | null) => void;
  onOpenProject?: (id: string) => void;
  onSelectCase?: (caseId: string) => void;
  focusBounds?: { lat0: number; lon0: number; lat1: number; lon1: number } | null;
  height?: number;
  showLayersControl?: boolean;
  className?: string;
}) {
  const wrap = useRef<HTMLDivElement>(null);
  const [px, setPx] = useState({ w: 800, h: height });
  const [view, setView] = useState<View>(FULL);
  const [hover, setHover] = useState<{ kind: 'state' | 'district'; label: string; sub: string; x: number; y: number } | null>(null);
  const [popup, setPopup] = useState<MapProject | null>(null);
  const [layers, setLayers] = useState({ choropleth: true, districts: true, markers: true, clusters: true, parcels: true });
  const [layersOpen, setLayersOpen] = useState(false);
  const drag = useRef<{ x: number; y: number; view: View; moved: boolean } | null>(null);
  const [reducedMotion] = useState(() => window.matchMedia('(prefers-reduced-motion: reduce)').matches);

  useEffect(() => {
    const el = wrap.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => setPx({ w: entry.contentRect.width, h: entry.contentRect.height }));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  /** Fit a projected box into the viewport, preserving aspect, with padding. */
  const fit = useCallback(
    (box: View, pad = 0.08) => {
      const aspect = px.w / Math.max(1, px.h);
      let w = box.w * (1 + pad * 2);
      let h = box.h * (1 + pad * 2);
      if (w / h > aspect) h = w / aspect;
      else w = h * aspect;
      setView({ x: box.x + box.w / 2 - w / 2, y: box.y + box.h / 2 - h / 2, w, h });
    },
    [px.w, px.h],
  );

  const stateFeatures = useMemo(() => states?.features ?? [], [states]);
  const statePaths = useMemo(() => stateFeatures.map((f) => ({ f, d: pathOf(f) })), [stateFeatures]);
  const districtPaths = useMemo(() => (districts?.features ?? []).map((f) => ({ f, d: pathOf(f) })), [districts]);
  const outlinePath = useMemo(() => (outline?.features ?? []).map(pathOf).join(''), [outline]);

  const focusKey = focusBounds ? `${focusBounds.lat0}|${focusBounds.lon0}|${focusBounds.lat1}|${focusBounds.lon1}` : "";

  // Follow selection: zoom to the chosen state or explicit bounds; back out to India when cleared.
  useEffect(() => {
    if (focusBounds) {
      const [x0, y0] = project(focusBounds.lon0, focusBounds.lat1);
      const [x1, y1] = project(focusBounds.lon1, focusBounds.lat0);
      fit({ x: x0, y: y0, w: Math.max(0.3, x1 - x0), h: Math.max(0.3, y1 - y0) }, 0.25);
      return;
    }
    if (selectedState) {
      const f = stateFeatures.filter((s) => s.properties.state === selectedState);
      const box = bboxOf(f);
      if (box) fit(box);
    } else {
      fit(FULL, 0);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedState, stateFeatures, fit, focusKey]);

  const unitsPerPx = view.w / Math.max(1, px.w);
  const zoom = FULL.w / view.w;

  const toScreen = (lon: number, lat: number) => {
    const [x, y] = project(lon, lat);
    return { left: ((x - view.x) / view.w) * px.w, top: ((y - view.y) / view.h) * px.h };
  };

  /* ---------------------------------------------------------- markers */
  const clustered = layers.clusters && zoom < 3.2;
  const markerGroups = useMemo(() => {
    if (!clustered) return projects.map((p) => ({ key: p.id, items: [p] }));
    const cell = 46 * unitsPerPx; // ~46 px grid cells
    const map = new Map<string, MapProject[]>();
    for (const p of projects) {
      const [x, y] = project(p.lon, p.lat);
      const k = `${Math.floor(x / cell)}:${Math.floor(y / cell)}`;
      if (!map.has(k)) map.set(k, []);
      map.get(k)!.push(p);
    }
    return Array.from(map.entries()).map(([key, items]) => ({ key, items }));
  }, [projects, clustered, unitsPerPx]);

  /* ------------------------------------------------------- interaction */
  const zoomAt = (factor: number, cx = px.w / 2, cy = px.h / 2) => {
    setView((v) => {
      const w = Math.min(FULL.w * 1.3, Math.max(0.15, v.w / factor));
      const h = w * (v.h / v.w);
      const ux = v.x + (cx / px.w) * v.w;
      const uy = v.y + (cy / px.h) * v.h;
      return { x: ux - (cx / px.w) * w, y: uy - (cy / px.h) * h, w, h };
    });
  };

  const onWheel = (e: RWheelEvent) => {
    const rect = wrap.current!.getBoundingClientRect();
    zoomAt(e.deltaY < 0 ? 1.25 : 0.8, e.clientX - rect.left, e.clientY - rect.top);
  };

  useEffect(() => {
    // React's onWheel is passive; block page scroll while the pointer is over the map.
    const el = wrap.current;
    if (!el) return;
    const stop = (e: WheelEvent) => e.preventDefault();
    el.addEventListener('wheel', stop, { passive: false });
    return () => el.removeEventListener('wheel', stop);
  }, []);

  const onPointerDown = (e: RPointerEvent) => {
    if ((e.target as HTMLElement).closest('[data-map-ui]')) return;
    drag.current = { x: e.clientX, y: e.clientY, view, moved: false };
  };
  const onPointerMove = (e: RPointerEvent) => {
    const d = drag.current;
    if (!d) return;
    const dx = e.clientX - d.x;
    const dy = e.clientY - d.y;
    if (Math.abs(dx) + Math.abs(dy) > 3) {
      d.moved = true;
      if (!(e.currentTarget as HTMLElement).hasPointerCapture(e.pointerId)) (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    }
    if (d.moved) setView({ ...d.view, x: d.view.x - dx * (d.view.w / px.w), y: d.view.y - dy * (d.view.h / px.h) });
  };
  const endDrag = (e: RPointerEvent) => {
    if ((e.currentTarget as HTMLElement).hasPointerCapture?.(e.pointerId)) (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId);
    setTimeout(() => (drag.current = null), 0);
  };
  const clickable = () => !drag.current?.moved;

  const hoverAt = (e: RPointerEvent, kind: 'state' | 'district', label: string, sub: string) => {
    const rect = wrap.current!.getBoundingClientRect();
    setHover({ kind, label, sub, x: e.clientX - rect.left, y: e.clientY - rect.top });
  };

  const stroke = (pxWidth: number) => pxWidth * unitsPerPx;
  const riskFill = (score: number | undefined, alpha: number) => (score === undefined ? 'rgb(var(--c-surface-2))' : `${RISK_HEX[riskFromScore(score)]}${Math.round(alpha * 255).toString(16).padStart(2, '0')}`);

  return (
    <div
      ref={wrap}
      className={cn(
        'relative w-full touch-none select-none overflow-hidden rounded-xl border border-line bg-gradient-to-br from-[rgb(var(--c-surface))] via-[rgb(var(--c-surface-2))] to-[rgb(var(--c-surface-3))]',
        className,
      )}
      style={{ height }}
      onWheel={onWheel}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={endDrag}
      onPointerLeave={(e) => {
        endDrag(e);
        setHover(null);
      }}
    >
      <svg width="100%" height="100%" preserveAspectRatio="none" viewBox={`${view.x} ${view.y} ${view.w} ${view.h}`} className={cn('block', drag.current?.moved ? 'cursor-grabbing' : 'cursor-grab')} role="img" aria-label="Map of India with acquisition project risk">
        <defs>
          {/* A soft top-left highlight over every state's flat choropleth fill, for a gently raised feel. */}
          <linearGradient id="map-soft-light" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor="#ffffff" stopOpacity={0.22} />
            <stop offset="55%" stopColor="#ffffff" stopOpacity={0.04} />
            <stop offset="100%" stopColor="#ffffff" stopOpacity={0} />
          </linearGradient>
          {/* Elevation cue for the hovered/selected state only — offsets are in the same scaled units as strokeWidth, so the lift reads consistently at any zoom level. */}
          <filter id="map-state-lift" x="-40%" y="-40%" width="180%" height="180%">
            <feDropShadow dx={stroke(1.5)} dy={stroke(2.5)} stdDeviation={stroke(2.5)} floodColor="rgb(15,23,42)" floodOpacity="0.25" />
          </filter>
        </defs>

        {/* national boundary */}
        {outlinePath && <path d={outlinePath} fill="rgb(var(--c-surface))" stroke="rgb(var(--c-ink-2))" strokeWidth={stroke(1.6)} strokeLinejoin="round" />}

        {/* states */}
        {statePaths.map(({ f, d }) => {
          const name = f.properties.state;
          const stat = stateStats?.get(name);
          const isSel = selectedState === name;
          const isHover = hover?.kind === 'state' && hover.label === name;
          const dim = Boolean(selectedState && !isSel);
          return (
            <g key={name} filter={(isHover || isSel) && !reducedMotion ? 'url(#map-state-lift)' : undefined}>
              <path
                d={d}
                fill={layers.choropleth && stat ? riskFill(stat.avgRisk, isSel ? 0.12 : 0.28) : 'transparent'}
                fillOpacity={dim ? 0.35 : 1}
                stroke={isSel ? 'rgb(var(--c-brand))' : 'rgb(var(--c-line-strong))'}
                strokeWidth={stroke(isSel ? 1.8 : isHover ? 1.3 : 0.8)}
                strokeLinejoin="round"
                className={cn(onSelectState && 'cursor-pointer transition-[fill-opacity,stroke-width] duration-150 hover:fill-opacity-70')}
                onPointerMove={(e) => hoverAt(e, 'state', name, stat ? `${stat.projects} project${stat.projects === 1 ? '' : 's'} · mean risk ${stat.avgRisk}%` : 'No projects in view')}
                onPointerLeave={() => setHover(null)}
                onClick={() => clickable() && onSelectState?.(isSel ? null : name)}
              />
              {layers.choropleth && stat && <path d={d} fill="url(#map-soft-light)" fillOpacity={dim ? 0.35 : 1} pointerEvents="none" />}
            </g>
          );
        })}

        {/* districts of the selected state */}
        {layers.districts &&
          districtPaths.map(({ f, d }) => {
            const key = f.properties.key!;
            const stat = districtStats?.get(key);
            const isSel = selectedDistrict === key;
            return (
              <path
                key={key}
                d={d}
                fill={layers.choropleth && stat ? riskFill(stat.avgRisk, isSel ? 0.5 : 0.3) : 'rgba(0,0,0,0)'}
                stroke={isSel ? 'rgb(var(--c-brand))' : 'rgb(var(--c-ink-3))'}
                strokeWidth={stroke(isSel ? 2 : 0.5)}
                strokeOpacity={isSel ? 1 : 0.6}
                className={cn(onSelectDistrict && 'cursor-pointer')}
                onPointerMove={(e) => hoverAt(e, 'district', f.properties.district!, stat ? `${stat.projects} project${stat.projects === 1 ? '' : 's'} · mean risk ${stat.avgRisk}% · ${stat.openCases.toLocaleString('en-IN')} open cases` : 'No projects in this district')}
                onPointerLeave={() => setHover(null)}
                onClick={(e) => {
                  e.stopPropagation();
                  if (clickable()) onSelectDistrict?.(isSel ? null : key);
                }}
              />
            );
          })}

        {/* selected state outline on top of its districts */}
        {selectedState &&
          statePaths
            .filter(({ f }) => f.properties.state === selectedState)
            .map(({ f, d }) => <path key={`sel-${f.properties.state}`} d={d} fill="none" stroke="rgb(var(--c-brand))" strokeWidth={stroke(2)} pointerEvents="none" />)}

        {/* case / parcel layer */}
        {layers.parcels &&
          points?.map((p) => {
            const [x, y] = project(p.lon, p.lat);
            const band = BAND_ORDER[p.b];
            return (
              <circle
                key={p.r}
                cx={x}
                cy={y}
                r={(p.b >= 2 ? 2.6 : 1.8) * unitsPerPx}
                fill={RISK_HEX[band]}
                fillOpacity={p.b >= 2 ? 0.9 : 0.5}
                className={onSelectCase ? 'cursor-pointer' : undefined}
                onClick={() => clickable() && onSelectCase?.(p.id)}
              >
                <title>{`${p.id} · ${p.s}% ${band}`}</title>
              </circle>
            );
          })}

        {/* project markers */}
        {layers.markers &&
          markerGroups.map((g) => {
            if (g.items.length === 1) {
              const p = g.items[0];
              const [x, y] = project(p.lon, p.lat);
              const r = (5 + Math.min(7, Math.sqrt(p.openCases || 1) / 6)) * unitsPerPx;
              const sel = selectedProjectId === p.id || popup?.id === p.id;
              return (
                <g key={g.key} className="cursor-pointer" onClick={(e) => {
                  e.stopPropagation();
                  if (clickable()) setPopup(p);
                }}>
                  <circle cx={x} cy={y} r={r + (sel ? 3 : 1.5) * unitsPerPx} fill="white" fillOpacity={0.9} />
                  <circle cx={x} cy={y} r={r} fill={RISK_HEX[p.riskBand]} stroke={sel ? 'rgb(var(--c-ink))' : 'white'} strokeWidth={stroke(sel ? 2 : 1)} />
                  <title>{`${p.name} — ${p.riskScore}% ${p.riskBand}`}</title>
                </g>
              );
            }
            const lat = g.items.reduce((s, p) => s + p.lat, 0) / g.items.length;
            const lon = g.items.reduce((s, p) => s + p.lon, 0) / g.items.length;
            const [x, y] = project(lon, lat);
            const worst = g.items.reduce((w, p) => (BAND_ORDER.indexOf(p.riskBand) > BAND_ORDER.indexOf(w) ? p.riskBand : w), 'Low' as RiskLevel);
            const high = g.items.filter((p) => p.riskBand === 'High' || p.riskBand === 'Critical').length;
            const r = (11 + Math.min(12, Math.sqrt(g.items.length) * 3)) * unitsPerPx;
            return (
              <g
                key={g.key}
                className="cursor-pointer"
                onClick={(e) => {
                  e.stopPropagation();
                  if (!clickable()) return;
                  const xs = g.items.map((p) => project(p.lon, p.lat));
                  const bx0 = Math.min(...xs.map((q) => q[0]));
                  const by0 = Math.min(...xs.map((q) => q[1]));
                  const bx1 = Math.max(...xs.map((q) => q[0]));
                  const by1 = Math.max(...xs.map((q) => q[1]));
                  fit({ x: bx0, y: by0, w: Math.max(0.6, bx1 - bx0), h: Math.max(0.6, by1 - by0) }, 0.4);
                }}
              >
                <circle cx={x} cy={y} r={r} fill={RISK_HEX[worst]} fillOpacity={0.22} stroke={RISK_HEX[worst]} strokeWidth={stroke(1.5)} />
                <circle cx={x} cy={y} r={r * 0.62} fill={RISK_HEX[worst]} />
                <text x={x} y={y} dy="0.35em" textAnchor="middle" fontSize={10 * unitsPerPx} fontWeight={700} fill="white" pointerEvents="none">
                  {g.items.length}
                </text>
                <title>{`${g.items.length} projects · ${high} High/Critical — click to zoom`}</title>
              </g>
            );
          })}
      </svg>

      {/* hover readout */}
      {hover && !popup && (
        <div className="pointer-events-none absolute z-10 rounded-lg border border-line bg-surface/95 px-3 py-2 shadow-pop backdrop-blur" style={{ left: Math.min(px.w - 220, hover.x + 14), top: Math.max(8, hover.y - 10) }}>
          <p className="text-sm font-bold text-ink">{hover.label}</p>
          <p className="text-xs text-ink-3">{hover.sub}</p>
        </div>
      )}

      {/* project popup */}
      {popup && (() => {
        const pos = toScreen(popup.lon, popup.lat);
        const left = Math.max(8, Math.min(px.w - 296, pos.left - 140));
        const top = pos.top > px.h / 2 ? Math.max(8, pos.top - 272) : Math.min(px.h - 280, pos.top + 16);
        return (
          <div data-map-ui className="absolute z-20 w-[288px] rounded-lg border border-line bg-surface p-3.5 shadow-pop animate-scale-in" style={{ left, top }}>
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <p className="font-mono text-xs font-semibold text-ink-3">{popup.id}</p>
                <p className="text-sm font-bold leading-snug text-ink">{popup.name}</p>
              </div>
              <button onClick={() => setPopup(null)} className="grid h-6 w-6 shrink-0 place-items-center rounded-md text-ink-3 hover:bg-surface-2" aria-label="Close">
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
            <dl className="mt-2.5 grid grid-cols-2 gap-x-3 gap-y-1.5 text-xs">
              {[
                ['State', popup.state],
                ['District', popup.district],
                ['Project type', popup.type],
                ['Current stage', `${popup.stage} · ${STAGE_STATUS_LABEL[popup.stageStatus]}`],
                ['Risk score', `${popup.riskScore}/100`],
                ['Delay probability', `${Math.round(popup.delayProbability * 100)}%`],
                ['Risk category', popup.riskBand],
                ['Expected delay (current step)', popup.predictedDelayDays !== null ? `${popup.predictedDelayDays} days` : '—'],
              ].map(([k, v]) => (
                <div key={k} className="min-w-0">
                  <dt className="eyebrow">{k}</dt>
                  <dd className="truncate font-semibold text-ink" style={k === 'Risk category' ? { color: RISK_HEX[popup.riskBand] } : undefined} title={String(v)}>
                    {v}
                  </dd>
                </div>
              ))}
              <div className="col-span-2 min-w-0">
                <dt className="eyebrow">Primary authority</dt>
                <dd className="font-semibold leading-snug text-ink">{popup.primaryAuthority}</dd>
              </div>
            </dl>
            {onOpenProject && (
              <button onClick={() => onOpenProject(popup.id)} className="mt-3 flex w-full items-center justify-center gap-1.5 rounded-lg bg-brand py-2 text-xs font-semibold text-white hover:bg-brand/90">
                Open project <ExternalLink className="h-3.5 w-3.5" />
              </button>
            )}
          </div>
        );
      })()}

      {/* controls */}
      <div data-map-ui className="absolute right-3 top-3 z-10 flex flex-col gap-1.5">
        <button onClick={() => zoomAt(1.5)} className="grid h-8 w-8 place-items-center rounded-lg border border-line bg-surface text-ink-2 shadow-card hover:text-ink" aria-label="Zoom in">
          <Plus className="h-4 w-4" />
        </button>
        <button onClick={() => zoomAt(1 / 1.5)} className="grid h-8 w-8 place-items-center rounded-lg border border-line bg-surface text-ink-2 shadow-card hover:text-ink" aria-label="Zoom out">
          <Minus className="h-4 w-4" />
        </button>
        <button
          onClick={() => {
            setPopup(null);
            if (selectedState) onSelectState?.(null);
            else fit(FULL, 0);
          }}
          className="grid h-8 w-8 place-items-center rounded-lg border border-line bg-surface text-ink-2 shadow-card hover:text-ink"
          aria-label="Reset to India"
          title="Reset to all India"
        >
          <LocateFixed className="h-4 w-4" />
        </button>
        {showLayersControl && (
          <div className="relative">
            <button onClick={() => setLayersOpen((o) => !o)} className={cn('grid h-8 w-8 place-items-center rounded-lg border border-line bg-surface shadow-card hover:text-ink', layersOpen ? 'text-brand' : 'text-ink-2')} aria-label="Layers">
              <Layers className="h-4 w-4" />
            </button>
            {layersOpen && (
              <div className="absolute right-10 top-0 w-48 rounded-lg border border-line bg-surface p-2.5 shadow-pop">
                <p className="label-xs mb-1.5">Layers</p>
                {(
                  [
                    ['choropleth', 'Risk shading'],
                    ['districts', 'District boundaries'],
                    ['markers', 'Project markers'],
                    ['clusters', 'Cluster at low zoom'],
                    ['parcels', 'Case / parcel points'],
                  ] as const
                ).map(([k, label]) => (
                  <label key={k} className="flex cursor-pointer items-center gap-2 rounded-md px-1.5 py-1 text-xs text-ink-2 hover:bg-surface-2">
                    <input type="checkbox" checked={layers[k]} onChange={(e) => setLayers((l) => ({ ...l, [k]: e.target.checked }))} className="accent-[rgb(var(--c-brand))]" />
                    {label}
                  </label>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      {/* coordinates of the view centre and attribution */}
      <div className="pointer-events-none absolute bottom-2 left-3 right-3 flex flex-wrap items-end justify-between gap-2">
        <span className="rounded-md bg-surface/85 px-2 py-1 text-2xs font-medium text-ink-3 backdrop-blur num">
          {(() => {
            const [lon, lat] = unproject(view.x + view.w / 2, view.y + view.h / 2);
            return `${lat.toFixed(2)}°N ${lon.toFixed(2)}°E · ×${zoom.toFixed(1)}`;
          })()}
        </span>
        <span className="max-w-[70%] rounded-md bg-surface/85 px-2 py-1 text-right text-2xs leading-snug text-ink-3 backdrop-blur">
          Boundaries: INDIAN-SHAPEFILES (Survey of India depiction). Project and parcel positions are synthetic demo locations.
        </span>
      </div>
    </div>
  );
}

export function GISLegend({ className }: { className?: string }) {
  return (
    <div className={cn('flex flex-wrap items-center gap-x-4 gap-y-2', className)}>
      {BAND_ORDER.map((lvl) => (
        <span key={lvl} className="flex items-center gap-1.5">
          <span className="h-3 w-3 rounded-full border-2 border-white shadow" style={{ background: RISK_HEX[lvl] }} />
          <span className="text-xs font-medium text-ink-2">{lvl}</span>
        </span>
      ))}
      <span className="flex items-center gap-1.5 text-xs text-ink-3">
        <span className="grid h-4 w-4 place-items-center rounded-full bg-red-500 text-2xs font-bold text-white">4</span>
        cluster (worst band) — click to zoom
      </span>
      <span className="text-xs text-ink-3">Area shading = mean project risk</span>
    </div>
  );
}
