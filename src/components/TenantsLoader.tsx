'use client';
// "Tenants moving in": the loading screen while a repo downloads and is analysed. The Landlord stands at the
// tavern door reading out the real steps from /api/ingest; once the modules are known, each tenant walks in with
// its luggage. The 3D scene loads on its own (never in the landing page's bundle); with 3D off, reduced motion or
// no WebGL it is the 2D Landlord and faces, standing still, with the same progress text.
import dynamic from 'next/dynamic';
import { useMemo } from 'react';
import { useReducedMotion } from 'framer-motion';
import { useTavern } from '@/lib/store';
import { assignColors } from '@/lib/characters';
import { CAP_NOTE_START } from '@/lib/analyze';
import LandlordFace from './LandlordFace';
import CharacterFace from './CharacterFace';
import type { Module } from '@/lib/types';

const MoveInScene = dynamic(() => import('./MoveInScene'), { ssr: false, loading: () => null });

function Still({ tenants }: { tenants: Module[] | null }) {
  const colors = useMemo(() => assignColors(tenants ?? []), [tenants]);
  return (
    <div className="flex items-end justify-center gap-3">
      <LandlordFace size={88} keys={tenants?.length ?? 3} talking />
      {tenants?.map((m) => <CharacterFace key={m.id} name={m.name} stats={m.stats} color={colors[m.id]} size={44} still />)}
    </div>
  );
}

export default function TenantsLoader({ what }: { what?: string }) {
  const ingest = useTavern((s) => s.ingest);
  const reduce = useReducedMotion();
  const steps = ingest?.steps ?? [];
  const tenants = ingest?.tenants ?? null;
  const capped = steps.find((s) => s.startsWith(CAP_NOTE_START));
  const recent = steps.filter((s) => s !== capped).slice(-4);
  return (
    <div className="fixed inset-0 z-50 flex flex-col items-center justify-center overflow-hidden bg-ink px-6 text-center" role="status" aria-live="polite">
      <div className="h-[min(46vh,360px)] w-full max-w-3xl">
        {reduce ? (
          <div className="flex h-full items-end justify-center pb-4">
            <Still tenants={tenants} />
          </div>
        ) : (
          <MoveInScene tenants={tenants} fallback={<div className="flex h-full items-end justify-center pb-4"><Still tenants={tenants} /></div>} />
        )}
      </div>
      <p className="mt-2 text-[15px] font-medium tracking-tight">Tenants moving in…</p>
      {(ingest?.slug ?? what) && <p className="mt-1 font-mono text-xs text-muted">{ingest?.slug ?? what}</p>}
      <div className="mt-4 min-h-[6.5rem] w-full max-w-md">
        {recent.length ? (
          <ol className="space-y-0.5">
            {recent.map((s, i) => (
              <li key={`${steps.indexOf(s)}-${s}`} className={i === recent.length - 1 ? 'font-display text-lg text-cream italic' : 'text-sm text-muted'}>
                {s}
              </li>
            ))}
          </ol>
        ) : (
          <p className="font-display text-lg text-cream/70 italic">The Landlord is looking for the keys</p>
        )}
        {capped && <p className="mt-2 text-sm text-cream">The Landlord: &ldquo;{capped}&rdquo;</p>}
      </div>
    </div>
  );
}
