import { useMemo } from 'react';
import { Link } from 'react-router-dom';
import { Bar, BarChart, CartesianGrid, Cell, Line, LineChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { ArrowRight, ChevronRight, SearchX } from 'lucide-react';
import { cn } from '@/lib/cn';
import { Card, CardHeader, EmptyState, InfoDot, MetricStrip, PageSection, PageSkeleton, Skeleton } from '@/components/ui';
import { ChartLegend, ChartTooltip } from '@/components/charts';
import { ErrorState, RiskPill } from '@/components/ui/primitives';
import { ContributorBars } from '@/components/explain/Contributors';
import { FilterBar, allOption, toOptions } from '@/components/ui/FilterBar';
import { AXIS_TICK, CASE_RISK_BAND_CUTS, CHART_COLORS, CHART_CURSOR, RISK_CLASS, RISK_HEX } from '@/lib/risk';
import { formatCompact, formatNumber } from '@/lib/format';
import { useApi, useFilters } from '@/hooks';
import { fetchContributors, fetchFacets, fetchModel, fetchProjects, fetchSummary } from '@/api/client';
import type { RiskLevel } from '@/data/types';

const BANDS: RiskLevel[] = ['Low', 'Medium', 'High', 'Critical'];

export default function RiskAnalysis() {
  const { values, set, reset, activeCount } = useFilters({ state: 'all', stage: 'all', risk: 'all' });

  const summary = useApi((signal) => fetchSummary(signal), []);
  const facets = useApi((signal) => fetchFacets(signal), []);
  const model = useApi((signal) => fetchModel(signal), []);
  const contributors = useApi((signal) => fetchContributors({ state: values.state, stage: values.stage, risk: values.risk }, signal), [values.state, values.stage, values.risk]);
  const topProjects = useApi((signal) => fetchProjects({ state: values.state, stage: values.stage, sort: 'risk', pageSize: 8 }, signal), [values.state, values.stage]);

  const s = summary.data;

  const histogram = useMemo(() => {
    if (!s) return [];
    return s.scoreHistogram.map((count, i) => {
      const from = i * 5;
      const mid = from + 2.5;
      return { bucket: `${from}`, count, band: mid >= CASE_RISK_BAND_CUTS.critical ? 'Critical' : mid >= CASE_RISK_BAND_CUTS.high ? 'High' : mid >= CASE_RISK_BAND_CUTS.medium ? 'Medium' : 'Low' };
    });
  }, [s]);

  const calibration = useMemo(() => {
    const rows = (model.data?.metrics as { calibration?: Array<{ bin: string; predicted: number; observed: number; count: number }> })?.calibration;
    return (rows ?? []).map((r) => ({ bin: r.bin, predicted: Number((r.predicted * 100).toFixed(1)), observed: Number((r.observed * 100).toFixed(1)), count: r.count }));
  }, [model.data]);

  if (summary.error) return <ErrorState error={summary.error} onRetry={summary.reload} />;
  if (summary.loading || !s) return <PageSkeleton />;

  const stageRows = [...s.stages].sort((a, b) => b.riskScore - a.riskScore);

  return (
    <div className="space-y-8">
      <MetricStrip
        items={[
          { label: 'Open cases scored', value: formatCompact(s.totals.openCases) },
          { label: 'Mean predicted risk', value: `${avgRisk(s)}%` },
          { label: 'Critical band', value: formatCompact(s.riskDistribution.Critical), hint: 'cases', tone: 'danger' },
          { label: 'High band', value: formatCompact(s.riskDistribution.High), hint: 'cases', tone: 'orange' },
          { label: 'Riskiest stage', value: <span className="text-md">{stageRows[0]?.stage ?? '—'}</span>, hint: stageRows[0] ? `${stageRows[0].riskScore}% mean risk` : undefined },
          { label: 'Leading factor', value: <span className="text-md">{s.contributors[0]?.group ?? '—'}</span>, hint: s.contributors[0] ? `${Math.round(s.contributors[0].share * 100)}% of contribution` : undefined },
        ]}
      />

      <Card>
        <CardHeader title="Risk by lifecycle stage" subtitle="Predicted milestone risk for open cases in each statutory stage, against the delay rate observed historically" />
        {/* Desktop table */}
        <div className="relative hidden overflow-x-auto md:block">
          <table className="w-full min-w-[860px]">
            <thead>
              <tr className="border-y border-line bg-surface-2 text-xs text-ink-3">
                <th scope="col" className="py-2 pl-5 pr-3 text-left font-medium">Stage</th>
                <th scope="col" className="px-3 py-2 text-right font-medium">Open cases</th>
                <th scope="col" className="px-3 py-2 text-left font-medium">Predicted risk</th>
                <th scope="col" className="px-3 py-2 text-left font-medium">Band mix</th>
                <th scope="col" className="px-3 py-2 text-right font-medium">Observed delay rate</th>
                <th scope="col" className="px-3 py-2 text-right font-medium">Avg slip</th>
                <th scope="col" className="py-2 pl-3 pr-5">
                  <span className="sr-only">Open cases</span>
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {stageRows.map((st) => (
                <tr key={st.stage} className="transition-colors hover:bg-surface-2">
                  <td className="py-3 pl-5 pr-3">
                    <p className="text-sm font-medium text-ink">{st.stage}</p>
                    <p className="max-w-[300px] truncate text-xs text-ink-3" title={st.milestone}>
                      {st.milestone}
                    </p>
                  </td>
                  <td className="px-3 py-3 text-right text-sm text-ink num">{formatNumber(st.openCases)}</td>
                  <td className="px-3 py-3">
                    <RiskPill level={st.riskBand} score={st.riskScore} size="sm" />
                  </td>
                  <td className="px-3 py-3">
                    <BandMix mix={st.mix} total={st.openCases} />
                  </td>
                  <td className="px-3 py-3 text-right text-sm text-ink num">{(st.observedDelayRate * 100).toFixed(0)}%</td>
                  <td className="px-3 py-3 text-right text-sm text-ink-2 num">{st.avgObservedDelayDays} d</td>
                  <td className="py-3 pl-3 pr-5 text-right">
                    <Link to={`/cases?stage=${encodeURIComponent(st.stage)}`} className="link inline-flex items-center gap-0.5 whitespace-nowrap text-sm">
                      Cases <ChevronRight className="h-3.5 w-3.5" />
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {/* Mobile list */}
        <ul className="divide-y divide-line border-t border-line md:hidden">
          {stageRows.map((st) => (
            <li key={st.stage}>
              <Link to={`/cases?stage=${encodeURIComponent(st.stage)}`} className="block px-4 py-3.5 hover:bg-surface-2">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-ink">{st.stage}</p>
                    <p className="text-xs text-ink-3 num">
                      {formatNumber(st.openCases)} open · observed {(st.observedDelayRate * 100).toFixed(0)}% · {st.avgObservedDelayDays} d avg slip
                    </p>
                  </div>
                  <RiskPill level={st.riskBand} score={st.riskScore} size="sm" />
                </div>
                <BandMix mix={st.mix} total={st.openCases} className="mt-2.5" />
              </Link>
            </li>
          ))}
        </ul>
        <p className="border-t border-line px-5 py-3 text-xs text-ink-3">Stages where predicted risk and observed slip are both high are reproducing a pattern already in the history — not one the model invented.</p>
      </Card>

      <div className="grid gap-5 xl:grid-cols-5">
        <Card className="xl:col-span-3">
          <CardHeader title="What is driving predicted delay" subtitle={contributors.data ? `Aggregated over ${formatNumber(contributors.data.cases)} open cases in the current filter` : 'Aggregating contributions…'} />
          <FilterBar
            selects={[
              { key: 'state', label: 'State', value: values.state, width: 'w-[160px]', options: [allOption('All States'), ...toOptions(facets.data?.states)] },
              { key: 'stage', label: 'Stage', value: values.stage, width: 'w-[180px]', options: [allOption('All stages'), ...toOptions(facets.data?.stages)] },
              { key: 'risk', label: 'Risk band', value: values.risk, width: 'w-[140px]', options: [allOption('All bands'), ...toOptions(BANDS)] },
            ]}
            onChange={(key, value) => set({ [key]: value })}
            onReset={reset}
            activeCount={activeCount}
          />
          <div className={cn('border-t border-line px-5 py-5', contributors.refreshing && 'opacity-70 transition-opacity')}>
            {contributors.data && contributors.data.groups.length > 0 ? (
              <ContributorBars contributors={contributors.data.groups.map((g) => ({ group: g.name, value: g.value, share: g.share }))} max={8} />
            ) : contributors.loading ? (
              <div className="space-y-4">
                {Array.from({ length: 6 }).map((_, i) => (
                  <Skeleton key={i} className="h-5" style={{ width: `${95 - i * 10}%` }} />
                ))}
              </div>
            ) : (
              <EmptyState icon={<SearchX />} title="No open cases in this filter" description="Widen the State, stage or risk band to see which factors are driving predicted delay." />
            )}
          </div>
        </Card>

        <Card className="xl:col-span-2">
          <CardHeader
            title="Highest-risk projects"
            subtitle="In the selected State and stage"
            action={
              <Link to="/queue" className="link inline-flex items-center gap-1 text-sm">
                Interventions <ArrowRight className="h-3.5 w-3.5" />
              </Link>
            }
          />
          {topProjects.loading ? (
            <div className="space-y-3 px-5 pb-5">
              {Array.from({ length: 6 }).map((_, i) => (
                <Skeleton key={i} className="h-10" />
              ))}
            </div>
          ) : (topProjects.data?.projects.length ?? 0) === 0 ? (
            <EmptyState title="No projects in this filter" description="Clear the State or stage filter to rank projects." />
          ) : (
            <ol className="divide-y divide-line border-t border-line">
              {(topProjects.data?.projects ?? []).map((p, i) => (
                <li key={p.id}>
                  <Link to={`/projects/${p.id}`} className="flex items-start gap-3 px-5 py-3 transition-colors hover:bg-surface-2">
                    <span className="mt-0.5 w-4 shrink-0 text-xs text-ink-3 num">{i + 1}</span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium text-ink">{p.name}</span>
                      <span className="block truncate text-xs text-ink-3">
                        {p.state} · {p.currentStage} · <span className="num">{p.daysRemaining < 0 ? `${Math.abs(p.daysRemaining)} d overdue` : `${p.daysRemaining} d to milestone`}</span>
                      </span>
                      {p.topContributor && <span className="mt-0.5 block truncate text-xs text-ink-2">Driven by {p.topContributor.toLowerCase()}</span>}
                    </span>
                    <RiskPill level={p.riskBand} score={p.riskScore} size="sm" />
                  </Link>
                </li>
              ))}
            </ol>
          )}
        </Card>
      </div>

      <PageSection title="Model behaviour" description="How predictions are spread, and whether stated probabilities match what actually happened">
        <div className="grid gap-5 lg:grid-cols-2">
          <Card>
            <CardHeader
              title="Score distribution"
              subtitle="Cases by predicted risk, across the whole dataset"
              action={<InfoDot text={`Band cut-offs: Medium ${Math.round(s.model.riskBands.medium * 100)}%, High ${Math.round(s.model.riskBands.high * 100)}%, Critical ${Math.round(s.model.riskBands.critical * 100)}%.`} />}
            />
            <div className="px-5">
              <ChartLegend items={BANDS.map((b) => ({ label: b, color: RISK_HEX[b] }))} />
            </div>
            <div className="h-[220px] px-2 pb-4 pt-2">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={histogram} margin={{ top: 8, right: 16, left: -4, bottom: 0 }}>
                  <CartesianGrid vertical={false} stroke="rgb(var(--c-line))" />
                  <XAxis dataKey="bucket" tickLine={false} axisLine={false} tick={AXIS_TICK} interval={3} unit="%" />
                  <YAxis tickLine={false} axisLine={false} tick={AXIS_TICK} width={44} tickFormatter={(v) => formatCompact(v as number)} />
                  <Tooltip cursor={CHART_CURSOR} content={<ChartTooltip formatter={(v) => `${formatNumber(v as number)} cases`} labelFormatter={(l) => `${l}–${Number(l) + 5}% predicted risk`} />} />
                  <Bar dataKey="count" name="Cases" radius={[2, 2, 0, 0]} isAnimationActive={false}>
                    {histogram.map((d, i) => (
                      <Cell key={i} fill={RISK_HEX[d.band as RiskLevel]} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          </Card>

          <Card>
            <CardHeader title="Calibration on held-out data" subtitle="Predicted probability against the delay rate actually observed, by decile" />
            <div className="px-5">
              <ChartLegend
                items={[
                  { label: 'Observed delay rate', color: CHART_COLORS.brand },
                  { label: 'Perfect calibration', color: 'rgb(var(--c-ink-3))', dashed: true },
                ]}
              />
            </div>
            <div className="h-[220px] px-2 pb-4 pt-2">
              {model.loading ? (
                <div className="h-full animate-shimmer rounded-lg bg-surface-2" />
              ) : (
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={calibration} margin={{ top: 8, right: 16, left: -4, bottom: 0 }}>
                    <CartesianGrid stroke="rgb(var(--c-line))" />
                    <XAxis dataKey="predicted" type="number" domain={[0, 100]} tickLine={false} axisLine={false} tick={AXIS_TICK} unit="%" />
                    <YAxis tickLine={false} axisLine={false} tick={AXIS_TICK} unit="%" width={44} domain={[0, 100]} />
                    <Tooltip content={<ChartTooltip formatter={(v) => `${v}%`} labelFormatter={(l) => `Predicted ${l}%`} />} />
                    <ReferenceLine segment={[{ x: 0, y: 0 }, { x: 100, y: 100 }]} stroke="rgb(var(--c-ink-3))" strokeDasharray="4 4" />
                    <Line type="monotone" dataKey="observed" name="Observed" stroke={CHART_COLORS.brand} strokeWidth={2} dot={{ r: 3, fill: CHART_COLORS.brand, strokeWidth: 0 }} isAnimationActive={false} />
                  </LineChart>
                </ResponsiveContainer>
              )}
            </div>
            <p className="border-t border-line px-5 py-3 text-xs text-ink-3">
              Points on the diagonal mean a stated 60% risk corresponded to roughly 60% of those milestones slipping. Brier score <span className="num">{s.model.test.brier.toFixed(3)}</span>.
            </p>
          </Card>
        </div>
      </PageSection>
    </div>
  );
}

function BandMix({ mix, total, className }: { mix: Record<RiskLevel, number>; total: number; className?: string }) {
  return (
    <div className={cn('flex h-1.5 min-w-[120px] overflow-hidden rounded-full bg-surface-3', className)} role="img" aria-label={BANDS.map((b) => `${b} ${mix[b]}`).join(', ')}>
      {BANDS.map((band) => {
        const width = (mix[band] / Math.max(1, total)) * 100;
        return width > 0 ? <span key={band} className={RISK_CLASS[band].bar} style={{ width: `${width}%` }} title={`${band}: ${formatNumber(mix[band])}`} /> : null;
      })}
    </div>
  );
}

function avgRisk(s: { riskDistribution: Record<RiskLevel, number>; scoreHistogram: number[] }) {
  const total = s.scoreHistogram.reduce((a, b) => a + b, 0) || 1;
  const weighted = s.scoreHistogram.reduce((acc, count, i) => acc + count * (i * 5 + 2.5), 0);
  return Math.round(weighted / total);
}
