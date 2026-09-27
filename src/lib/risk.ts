import { CircleCheck, CircleAlert, TriangleAlert, OctagonAlert, type LucideIcon } from 'lucide-react';
import type { RiskLevel } from '@/data/types';
import { TONE_CHIP, TONE_DOT, TONE_PANEL, TONE_TEXT, type Tone } from './tone';

/**
 * Risk banding.
 *
 * The API bands every record itself. These helpers are for values the UI
 * colours locally, which are all aggregates — mean project risk of a state,
 * district, type or stage — so they use the project-level cut-offs
 * (ml/train.py PROJECT_RISK_BAND_THRESHOLDS). A single case uses
 * CASE_RISK_BAND_CUTS (RISK_BAND_THRESHOLDS).
 */
export const RISK_BAND_CUTS = { medium: 30, high: 45, critical: 60 } as const;
export const CASE_RISK_BAND_CUTS = { medium: 30, high: 55, critical: 80 } as const;

export const riskFromScore = (score: number): RiskLevel =>
  score >= RISK_BAND_CUTS.critical
    ? 'Critical'
    : score >= RISK_BAND_CUTS.high
      ? 'High'
      : score >= RISK_BAND_CUTS.medium
        ? 'Medium'
        : 'Low';

export const RISK_ORDER: RiskLevel[] = ['Low', 'Medium', 'High', 'Critical'];

/** Chart fills. Muted enough to sit together; red is reserved for Critical. */
export const RISK_HEX: Record<RiskLevel, string> = {
  Low: '#2F9E6E',
  Medium: '#D99A1E',
  High: '#E0702A',
  Critical: '#D43D3D',
};

export const RISK_TONE: Record<RiskLevel, Tone> = {
  Low: 'success',
  Medium: 'warning',
  High: 'orange',
  Critical: 'danger',
};

/** Risk is never communicated by colour alone: each band has its own glyph. */
export const RISK_ICON: Record<RiskLevel, LucideIcon> = {
  Low: CircleCheck,
  Medium: CircleAlert,
  High: TriangleAlert,
  Critical: OctagonAlert,
};

/** Plain-language reading of each band, for result panels. */
export const RISK_MEANING: Record<RiskLevel, string> = {
  Low: 'The next milestone is likely to be met. Routine monitoring is sufficient.',
  Medium: 'A slip is possible. Review the leading factors at the next progress meeting.',
  High: 'A slip is more likely than not for many parcels. Assign owners to the leading factors now.',
  Critical: 'A slip is expected for most open parcels. Escalate and act on the top factors immediately.',
};

/** Tailwind class bundles for each risk level (chips, dots, bars). */
export const RISK_CLASS: Record<RiskLevel, { chip: string; dot: string; bar: string; text: string; ring: string; panel: string }> = {
  Low: { chip: TONE_CHIP.success, dot: TONE_DOT.success, bar: 'bg-[#2F9E6E]', text: TONE_TEXT.success, ring: 'ring-emerald-500/30', panel: TONE_PANEL.success },
  Medium: { chip: TONE_CHIP.warning, dot: TONE_DOT.warning, bar: 'bg-[#D99A1E]', text: TONE_TEXT.warning, ring: 'ring-amber-500/30', panel: TONE_PANEL.warning },
  High: { chip: TONE_CHIP.orange, dot: TONE_DOT.orange, bar: 'bg-[#E0702A]', text: TONE_TEXT.orange, ring: 'ring-orange-500/30', panel: TONE_PANEL.orange },
  Critical: { chip: TONE_CHIP.danger, dot: TONE_DOT.danger, bar: 'bg-[#D43D3D]', text: TONE_TEXT.danger, ring: 'ring-red-500/30', panel: TONE_PANEL.danger },
};

/** Stage status colours live with the other workflow statuses. */
export { STAGE_STATUS_CLASS } from './status';

export const OUTCOME_CLASS: Record<string, string> = {
  Delayed: TONE_CHIP.danger,
  'On time': TONE_CHIP.success,
  Pending: TONE_CHIP.info,
};

export const PRIORITY_CLASS: Record<string, string> = {
  Critical: TONE_CHIP.danger,
  Important: TONE_CHIP.warning,
  Routine: TONE_CHIP.neutral,
};

/** Chart palette: one accent, one neutral, and a few supporting hues used sparingly. */
export const CHART_COLORS = {
  brand: '#2563EB',
  brandLight: '#9DB8F2',
  teal: '#0E8C7F',
  violet: '#6D63D6',
  saffron: '#C98512',
  slate: '#98A2B3',
  grid: 'rgb(var(--c-line))',
};

/** Shared axis/tooltip styling so every Recharts chart reads the same way. */
export const AXIS_TICK = { fill: 'rgb(var(--c-ink-3))', fontSize: 11 } as const;
export const AXIS_TICK_STRONG = { fill: 'rgb(var(--c-ink-2))', fontSize: 12 } as const;
export const CHART_CURSOR = { fill: 'rgb(var(--c-surface-3))', opacity: 0.6 } as const;

/** Stable colour per contributor group, so a factor keeps its colour everywhere. */
const GROUP_PALETTE = ['#2563EB', '#0E8C7F', '#C98512', '#6D63D6', '#D4573D', '#3E7CB1', '#5F8F3E', '#98A2B3', '#B4538A', '#4B5563'];

const groupColorCache = new Map<string, string>();

export function groupColor(group: string): string {
  const cached = groupColorCache.get(group);
  if (cached) return cached;
  let hash = 0;
  for (let i = 0; i < group.length; i++) hash = (hash * 31 + group.charCodeAt(i)) | 0;
  const color = GROUP_PALETTE[Math.abs(hash) % GROUP_PALETTE.length];
  groupColorCache.set(group, color);
  return color;
}

/** First word of a lifecycle stage name, for axis ticks where the full name will not fit. */
export const shortStage = (stage: string | number) => String(stage).split(/[\s/]/)[0];
