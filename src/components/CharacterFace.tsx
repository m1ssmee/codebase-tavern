'use client';
import { motion, useReducedMotion, type TargetAndTransition, type Transition } from 'framer-motion';
import { faceTraits, hash, PALETTE } from '@/lib/characters';
import type { ModuleStats, Mood } from '@/lib/types';
import { useTavern } from '@/lib/store';

const INK = '#17110e';
const loop = (duration: number, extra: Transition = {}): Transition => ({ duration, repeat: Infinity, ease: 'easeInOut', ...extra });

/**
 * Procedural face, deterministic from the module name + stats.
 * Traits: width ∝ totalLines, shifty eyes (TODOs ≥ 5), sweat (biggest file > 300 lines),
 * spiral eyes (nesting ≥ 6), shiver (no tests), smug (small, clean, tested).
 * What-if moods: horrified (jolt, wide eyes), fainted (falls over), nervous (darting eyes, sweat), shrug (one shrug, half lids).
 */
export default function CharacterFace({
  name,
  stats,
  color,
  mood = 'idle',
  size = 32,
  still = false,
}: {
  name: string;
  stats?: ModuleStats;
  color?: string; // character colour (deduped per repo); defaults to the name hash
  mood?: Mood;
  size?: number;
  still?: boolean; // no idle loops (chat avatars, lists)
}) {
  const reduced = useReducedMotion();
  const calm = still || !!reduced;
  const h = hash(name);
  const t = faceTraits(stats);
  const fill = color ?? PALETTE[h % PALETTE.length];
  const rx = 28 + 18 * t.width; // chubbier = bigger module
  const ry = 34 + (h % 5);
  const cy = 94 - ry;
  const ex = rx * 0.4;
  const ey = cy - ry * 0.12;
  const accessory = (h >> 3) % 4;
  const sweat = t.sweaty || mood === 'accused' || mood === 'nervous' || mood === 'horrified';
  // Spice-driven extras: feral+ talking faces go red and steam; nuclear culprits burst into smoke.
  const spice = useTavern((s) => s.spice);
  const heated = mood === 'talking' && (spice === 'feral' || spice === 'nuclear');
  const poof = mood === 'guilty' && spice === 'nuclear';

  // Body motion per mood (outer group), shiver for untested modules (inner group).
  const body: { animate: TargetAndTransition; transition: Transition } =
    poof
      ? { animate: { rotate: 0, x: 0, y: 0, scale: reduced ? 0 : [1, 1.25, 0] }, transition: reduced ? { duration: 0 } : { duration: 0.45, times: [0, 0.4, 1] } }
      : mood === 'guilty' || mood === 'fainted'
      ? { animate: { rotate: 90, x: 0, y: 4 }, transition: reduced ? { duration: 0 } : { type: 'spring', stiffness: 120, damping: 9 } }
      : calm
        ? { animate: { rotate: 0, x: 0, y: 0 }, transition: { duration: 0.2 } }
        : mood === 'horrified'
          ? { animate: { rotate: 0, x: 0, y: [0, -9, 0], scale: [1, 1.14, 1] }, transition: { duration: 0.35 } }
        : mood === 'nervous'
          ? { animate: { rotate: 0, x: [0, -1.6, 1.6, -1, 0], y: 0 }, transition: loop(0.3, { ease: 'linear' }) }
        : mood === 'shrug'
          ? { animate: { rotate: [0, -7, 7, 0], x: 0, y: [0, -5, 0, 0] }, transition: { duration: 0.6 } }
        : mood === 'happy'
          ? { animate: { rotate: 0, x: 0, y: [0, -10, 0] }, transition: loop(0.5, { repeatDelay: 0.35 }) }
          : mood === 'talking'
            ? { animate: { rotate: 0, x: 0, y: [0, -2, 0] }, transition: loop(0.45) }
            : { animate: { rotate: 0, x: 0, y: [0, -3, 0] }, transition: loop(2.4, { delay: (h % 10) / 10 }) };

  const eyes = () => {
    if (mood === 'guilty' || mood === 'fainted') return [-ex, ex].map((dx) => <XEye key={dx} x={50 + dx} y={ey} />);
    if (mood === 'happy')
      return [-ex, ex].map((dx) => (
        <path key={dx} d={`M${50 + dx - 7} ${ey + 2} q7 -9 14 0`} stroke={INK} strokeWidth={5} strokeLinecap="round" fill="none" />
      ));
    if (t.dizzy && !['accused', 'horrified', 'nervous', 'shrug'].includes(mood))
      return [-ex, ex].map((dx) => (
        <g key={dx} transform={`translate(${50 + dx} ${ey})`}>
          <circle r={9.5} fill="#fff" stroke={INK} strokeWidth={3} />
          <motion.path
            d="M0 0 m-1 0 a1 1 0 1 1 2 0 a2.5 2.5 0 1 1 -5 0 a4 4 0 1 1 8 0 a5.5 5.5 0 1 1 -11 0"
            stroke={INK}
            strokeWidth={1.8}
            fill="none"
            animate={calm ? { rotate: 0 } : { rotate: 360 }}
            transition={calm ? { duration: 0 } : { duration: 1.6, repeat: Infinity, ease: 'linear' }}
          />
        </g>
      ));
    // Pupils: accused rolls its eyes, shifty glances side to side, smug looks down its nose.
    const pupil: { animate: TargetAndTransition; transition: Transition } =
      mood === 'accused' && !calm
        ? { animate: { x: [0, 3, 0, -3, 0], y: [0, -3, -5, -3, 0] }, transition: loop(1.4, { repeatDelay: 0.8 }) }
        : mood === 'nervous'
          ? { animate: { x: calm ? -3 : [-3, 3, -2, 3, -3], y: 1 }, transition: calm ? {} : loop(0.9) }
        : mood === 'horrified' || mood === 'shrug'
          ? { animate: { x: mood === 'shrug' ? 3.5 : 0, y: mood === 'shrug' ? 1 : 0 }, transition: {} }
        : t.shifty
          ? { animate: { x: calm ? -3.5 : [-3.5, -3.5, 3.5, 3.5, -3.5], y: 1 }, transition: calm ? {} : loop(3.2) }
          : { animate: { x: 0, y: t.smug ? 3 : 0 }, transition: {} };
    const wide = mood === 'horrified';
    const lid = mood === 'shrug' ? 'smug' : wide || mood === 'accused' || mood === 'nervous' ? null : t.smug ? 'smug' : t.shifty ? 'shifty' : null;
    // Occasional blink, staggered per name so a room of faces never blinks in unison.
    const blink = !calm && (mood === 'idle' || mood === 'talking');
    return (
      <motion.g
        animate={{ scaleY: blink ? [1, 0.1, 1] : 1 }}
        transition={blink ? { duration: 0.2, repeat: Infinity, repeatDelay: 2.5 + (h % 5) * 0.7, delay: (h % 7) * 0.4 } : { duration: 0.1 }}
      >
        {[-ex, ex].map((dx) => (
          <g key={dx}>
            <circle cx={50 + dx} cy={ey} r={wide ? 11.5 : 9.5} fill="#fff" stroke={INK} strokeWidth={3} />
            <motion.circle cx={50 + dx} cy={ey} r={wide ? 2.4 : 4.5} fill={INK} {...pupil} />
            {lid && (
              // eyelid: covers the top half (smug) or top third (shifty)
              <path
                d={lid === 'smug' ? `M${50 + dx - 11} ${ey + 1} h22 v-12 h-22 z` : `M${50 + dx - 11} ${ey - 3} h22 v-9 h-22 z`}
                fill={fill}
                stroke={INK}
                strokeWidth={0}
              />
            )}
            {lid && <line x1={50 + dx - 9.5} x2={50 + dx + 9.5} y1={ey + (lid === 'smug' ? 1 : -3)} y2={ey + (lid === 'smug' ? 1 : -3)} stroke={INK} strokeWidth={3} strokeLinecap="round" />}
          </g>
        ))}
      </motion.g>
    );
  };

  const my = cy + ry * 0.38;
  const mouth = () => {
    if (mood === 'talking')
      return (
        <motion.ellipse
          cx={50}
          cy={my}
          rx={8}
          fill={INK}
          initial={{ ry: 2 }}
          animate={reduced ? { ry: 4 } : { ry: [1.5, 6, 1.5] }}
          transition={reduced ? {} : loop(0.28)}
        />
      );
    if (mood === 'accused') return <circle cx={50} cy={my + 1} r={5} fill={INK} />;
    if (mood === 'horrified') return <ellipse cx={50} cy={my + 2} rx={6.5} ry={8.5} fill={INK} />;
    if (mood === 'nervous') return <path d={`M39 ${my} q2.75 -3 5.5 0 q2.75 3 5.5 0 q2.75 -3 5.5 0 q2.75 3 5.5 0`} stroke={INK} strokeWidth={3.5} fill="none" strokeLinecap="round" />;
    if (mood === 'shrug') return <path d={`M41 ${my + 1} q9 -2 18 2`} stroke={INK} strokeWidth={4} fill="none" strokeLinecap="round" />;
    if (mood === 'guilty' || mood === 'fainted') return <path d={`M38 ${my + 3} q4 -5 8 0 q4 5 8 0 q4 -5 8 0`} stroke={INK} strokeWidth={4} fill="none" strokeLinecap="round" />;
    if (mood === 'happy') return <path d={`M37 ${my - 3} q13 16 26 0 z`} fill={INK} stroke={INK} strokeWidth={3} strokeLinejoin="round" />;
    if (t.smug) return <path d={`M40 ${my} q10 3 20 -5`} stroke={INK} strokeWidth={4} fill="none" strokeLinecap="round" />;
    const curve = [0, 4, -3][h % 3]; // flat / slight smile / slight frown
    return <path d={`M40 ${my} q10 ${curve} 20 0`} stroke={INK} strokeWidth={4} fill="none" strokeLinecap="round" />;
  };

  return (
    <svg width={size} height={size} viewBox="0 0 100 100" className="shrink-0 overflow-visible" aria-hidden>
      <ellipse cx={50} cy={97} rx={rx * 0.75} ry={3} fill="#000" opacity={0.35} />
      {/* guilty pivots on its centre so the fallen face stays inside its own box */}
      <motion.g style={{ originX: 0.5, originY: mood === 'guilty' ? 0.55 : 1 }} initial={false} {...body}>
        <motion.g
          animate={t.shivers && !calm && mood !== 'guilty' ? { x: [0, -0.9, 0.9, -0.6, 0] } : { x: 0 }}
          transition={t.shivers && !calm ? loop(0.32, { ease: 'linear' }) : {}}
        >
          {accessory === 1 && (
            <path d={`M44 ${cy - ry + 2} l-3 -9 M50 ${cy - ry} v-10 M56 ${cy - ry + 2} l3 -9`} stroke={INK} strokeWidth={4} strokeLinecap="round" />
          )}
          {accessory === 2 && (
            <g>
              <line x1={50} y1={cy - ry} x2={50} y2={cy - ry - 11} stroke={INK} strokeWidth={3.5} />
              <circle cx={50} cy={cy - ry - 13} r={4.5} fill={fill} stroke={INK} strokeWidth={3} />
            </g>
          )}
          {accessory === 3 &&
            [-1, 1].map((d) => <circle key={d} cx={50 + d * rx * 0.62} cy={cy - ry * 0.78} r={8} fill={fill} stroke={INK} strokeWidth={4} />)}
          <ellipse cx={50} cy={cy} rx={rx} ry={ry} fill={fill} stroke={INK} strokeWidth={5} />
          {heated && <ellipse cx={50} cy={cy} rx={rx - 2.5} ry={ry - 2.5} fill="#ff2a1a" opacity={0.38} />}
          <ellipse cx={50 - rx * 0.45} cy={cy - ry * 0.5} rx={6} ry={3.5} fill="#fff" opacity={0.28} />
          {eyes()}
          {mouth()}
          {sweat && (
            <motion.path
              d={`M${50 + rx - 2} ${cy - ry * 0.55} q5 8 0 11 q-5 -3 0 -11z`}
              fill="#8ad4ff"
              stroke={INK}
              strokeWidth={2}
              animate={calm ? { y: 0, opacity: 1 } : { y: [0, 9], opacity: [1, 0] }}
              transition={calm ? {} : loop(1.3, { ease: 'easeIn' })}
            />
          )}
          {heated &&
            !calm &&
            [-1, 1].map((d) => (
              <motion.circle
                key={d}
                cx={50 + d * rx * 0.55}
                cy={cy - ry + 2}
                r={4.5}
                fill="#f6efe6"
                initial={{ opacity: 0 }}
                animate={{ y: [0, -18], opacity: [0.85, 0], scale: [0.6, 1.7] }}
                transition={loop(0.9, { ease: 'easeOut', delay: d > 0 ? 0.45 : 0 })}
              />
            ))}
        </motion.g>
      </motion.g>
      {poof && (
        // Cartoon smoke puff where the culprit used to be.
        <motion.g
          style={{ originX: 0.5, originY: 0.5 }}
          initial={reduced ? false : { scale: 0.2, opacity: 0 }}
          animate={{ scale: reduced ? 1 : [0.2, 1.3, 1.05], opacity: reduced ? 0.9 : [0, 1, 0.9] }}
          transition={{ duration: 0.6, delay: reduced ? 0 : 0.3 }}
        >
          {[[-16, -4, 15], [0, -16, 16], [16, -4, 15], [-10, 12, 14], [10, 12, 14], [0, 2, 16]].map(([dx, dy, r], i) => (
            <circle key={i} cx={50 + dx} cy={60 + dy} r={r} fill="#d8cfc4" stroke={INK} strokeWidth={3} />
          ))}
          {[[-16, -4, 15], [0, -16, 16], [16, -4, 15], [-10, 12, 14], [10, 12, 14], [0, 2, 16]].map(([dx, dy, r], i) => (
            <circle key={`f${i}`} cx={50 + dx} cy={60 + dy} r={r - 3} fill="#d8cfc4" />
          ))}
        </motion.g>
      )}
    </svg>
  );
}

function XEye({ x, y }: { x: number; y: number }) {
  return (
    <path d={`M${x - 6} ${y - 6} l12 12 M${x + 6} ${y - 6} l-12 12`} stroke={INK} strokeWidth={4.5} strokeLinecap="round" />
  );
}
