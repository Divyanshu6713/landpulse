import { useEffect, useRef, useState } from 'react';
import { ECOSYSTEM, OUTPUTS } from '../lib/content';
import { InApp } from '../components/InApp';
import { useStore } from '../lib/store';
import { Reveal } from '../components/Interactive';

const W = 1000;
const SRC_Y = 470;
const LAYER_TOP = 250;
const LAYER_BOT = 320;
const OUT_Y = 88;
const sx = (i: number) => 90 + i * ((W - 180) / (ECOSYSTEM.length - 1));
const ox = (i: number) => 170 + i * ((W - 340) / (OUTPUTS.length - 1));

export function Ecosystem() {
  const [hover, setHover] = useState<number | null>(null);
  const reduced = useStore((s) => s.reduced);
  const svg = useRef<SVGSVGElement>(null);
  const hoverRef = useRef<number | null>(null);
  hoverRef.current = hover;

  useEffect(() => {
    const root = svg.current!;
    const paths = [...root.querySelectorAll<SVGPathElement>('path[data-flow]')];
    const layer = root.querySelector('#eco-dots')!;
    const dots = paths.flatMap((p, pi) =>
      [0, 0.5].map((off) => {
        const el = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
        el.setAttribute('r', '2.8');
        layer.appendChild(el);
        return { p, pi, t: off + Math.random() * 0.2, len: p.getTotalLength(), el, up: p.dataset.flow === 'out' };
      }),
    );
    let raf = 0;
    let last = performance.now();
    let visible = false;
    const io = new IntersectionObserver(([e]) => (visible = e.isIntersecting));
    io.observe(root);
    const loop = (now: number) => {
      raf = requestAnimationFrame(loop);
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      if (!visible) return;
      dots.forEach((d) => {
        if (!reduced) d.t = (d.t + dt * 0.28) % 1;
        const pt = d.p.getPointAtLength(d.t * d.len);
        d.el.setAttribute('cx', String(pt.x));
        d.el.setAttribute('cy', String(pt.y));
        const h = hoverRef.current;
        const on = h == null || (!d.up && d.pi === h) || d.up;
        d.el.setAttribute('fill', d.up ? '#e1a43c' : '#9fd3df');
        d.el.setAttribute('opacity', on ? String(0.9 * Math.sin(d.t * Math.PI)) : '0.08');
      });
    };
    raf = requestAnimationFrame(loop);
    return () => {
      cancelAnimationFrame(raf);
      io.disconnect();
      dots.forEach((d) => d.el.remove());
    };
  }, [reduced]);

  const sel = hover != null ? ECOSYSTEM[hover] : null;
  return (
    <section id="ecosystem" className="relative py-28 md:py-36" aria-labelledby="eco-title">
      <div className="absolute inset-0 bg-cine-950/80" />
      <div className="relative mx-auto max-w-content px-4 md:px-8">
        <Reveal className="grid gap-6 md:grid-cols-[1fr_360px] md:items-end">
          <div>
            <p className="cine-eyebrow">Existing government ecosystem</p>
            <h2 id="eco-title" className="h-section mt-3">
              A layer above.
              <br />
              <span className="text-mist-400">Not a replacement.</span>
            </h2>
          </div>
          <p className="lede">
            Land Pulse is designed as an analytics layer that can sit above existing systems where integration is permitted — reading status, never
            re-running their workflows.
          </p>
          <InApp to="/data-sources" className="md:col-span-2 md:justify-self-start">
            Data sources — the same systems, each marked &ldquo;not connected&rdquo;
          </InApp>
        </Reveal>

        <div className="pe relative mt-12">
          <svg ref={svg} viewBox={`0 0 ${W} 560`} className="w-full" role="img" aria-labelledby="eco-desc">
            <desc id="eco-desc">
              Seven source systems — {ECOSYSTEM.map((e) => e.name).join(', ')} — feed the Land Pulse analytics layer through API-ready adapters. The layer
              produces {OUTPUTS.join(', ')}.
            </desc>
            <defs>
              <linearGradient id="eco-layer" x1="0" x2="1">
                <stop offset="0" stopColor="#72b8c8" stopOpacity="0.05" />
                <stop offset="0.5" stopColor="#72b8c8" stopOpacity="0.16" />
                <stop offset="1" stopColor="#72b8c8" stopOpacity="0.05" />
              </linearGradient>
            </defs>
            {ECOSYSTEM.map((e, i) => {
              const x = sx(i);
              const tx = 200 + i * (600 / (ECOSYSTEM.length - 1));
              return (
                <path
                  key={e.id}
                  data-flow="in"
                  d={`M${x},${SRC_Y - 28} C${x},${(SRC_Y + LAYER_BOT) / 2} ${tx},${(SRC_Y + LAYER_BOT) / 2 + 20} ${tx},${LAYER_BOT}`}
                  fill="none"
                  stroke={hover === i ? '#9fd3df' : 'rgba(159,211,223,0.18)'}
                  strokeWidth={hover === i ? 1.6 : 1}
                  strokeDasharray="4 5"
                />
              );
            })}
            {OUTPUTS.map((o, i) => {
              const x = ox(i);
              const fx = 260 + i * (480 / (OUTPUTS.length - 1));
              return (
                <path
                  key={o}
                  data-flow="out"
                  d={`M${fx},${LAYER_TOP} C${fx},${(LAYER_TOP + OUT_Y) / 2} ${x},${(LAYER_TOP + OUT_Y) / 2} ${x},${OUT_Y + 22}`}
                  fill="none"
                  stroke="rgba(225,164,60,0.25)"
                />
              );
            })}
            <g id="eco-dots" />
            <rect x="120" y={LAYER_TOP} width="760" height={LAYER_BOT - LAYER_TOP} rx="18" fill="url(#eco-layer)" stroke="rgba(159,211,223,0.45)" />
            <text x="500" y={LAYER_TOP + 32} textAnchor="middle" fill="#f2f6f8" style={{ font: '600 20px Poppins, sans-serif', letterSpacing: '0.16em' }}>
              LAND PULSE ANALYTICS LAYER
            </text>
            <text x="500" y={LAYER_TOP + 54} textAnchor="middle" fill="#8d9ba6" style={{ font: '500 11px JetBrains Mono, monospace', letterSpacing: '0.14em' }}>
              READ-ONLY · PSEUDONYMISED · AUDITED
            </text>
            {OUTPUTS.map((o, i) => (
              <g key={o}>
                <rect x={ox(i) - 74} y={OUT_Y - 22} width="148" height="44" rx="22" fill="#0b1016" stroke="rgba(225,164,60,0.5)" />
                <text x={ox(i)} y={OUT_Y + 5} textAnchor="middle" fill="#f0c77f" style={{ font: '600 13px Inter Variable, sans-serif' }}>
                  {o}
                </text>
              </g>
            ))}
            {ECOSYSTEM.map((e, i) => (
              <g
                key={e.id}
                tabIndex={0}
                role="button"
                aria-label={`${e.name}: ${e.what}. API-ready, not connected.`}
                onMouseEnter={() => setHover(i)}
                onMouseLeave={() => setHover(null)}
                onFocus={() => setHover(i)}
                onBlur={() => setHover(null)}
                style={{ cursor: 'pointer', outline: 'none' }}
              >
                <rect
                  x={sx(i) - 62}
                  y={SRC_Y - 28}
                  width="124"
                  height="56"
                  rx="12"
                  fill={hover === i ? '#111a22' : '#0b1016'}
                  stroke={hover === i ? '#9fd3df' : 'rgba(159,211,223,0.25)'}
                />
                <text x={sx(i)} y={SRC_Y - 3} textAnchor="middle" fill="#e3eaee" style={{ font: `600 ${e.name.length > 14 ? 11.5 : 13}px Inter Variable, sans-serif` }}>
                  {e.name}
                </text>
                <text x={sx(i)} y={SRC_Y + 15} textAnchor="middle" fill="#72b8c8" style={{ font: '600 9px JetBrains Mono, monospace', letterSpacing: '0.14em' }}>
                  API-READY
                </text>
              </g>
            ))}
          </svg>
          <div className="mx-auto mt-6 min-h-[92px] max-w-[560px] text-center" aria-live="polite">
            {sel ? (
              <div key={sel.id} className="fx-in">
                <p className="font-grotesk text-xl font-semibold text-mist-50">{sel.name}</p>
                <p className="mt-1 text-[14px] text-mist-200">{sel.what}</p>
                <p className="mt-1 text-[13px] text-mist-400">Would provide: {sel.gives}</p>
                <p className="mt-2 font-mono text-[10.5px] uppercase tracking-[0.14em] text-gis-400">API-ready · adapter interface only · not connected</p>
              </div>
            ) : (
              <p className="text-[13.5px] text-mist-400">
                Hover a system. <b className="text-mist-200">API-ready</b> means an adapter interface is designed for permitted integration — this prototype has no
                live connection to any government system.
              </p>
            )}
          </div>
        </div>
      </div>
    </section>
  );
}
