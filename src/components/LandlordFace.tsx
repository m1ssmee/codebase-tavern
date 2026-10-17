'use client';
import { motion, useReducedMotion } from 'framer-motion';

const INK = '#17110e';
const SKIN = '#e8d8c3';

export type LandlordFaceProps = {
  size?: number;
  keys?: number; // one key per module on the ring
  talking?: boolean;
  /** Same names as Character3D's expressions, for the later swap; the 2D face only tells deadpan from smug. */
  expression?: 'deadpan' | 'smug' | 'nervous' | 'furious' | 'horrified' | 'dead';
  still?: boolean;
};

/** The Landlord: owns the building (the repo), not a module. Weary, reading glasses pushed up, a key per tenant. */
export default function LandlordFace({ size = 56, keys = 5, talking = false, expression = 'deadpan', still = false }: LandlordFaceProps) {
  const reduced = useReducedMotion();
  const calm = still || !!reduced;
  const n = Math.max(1, Math.min(keys, 10));
  return (
    <svg width={size} height={size} viewBox="0 0 100 100" className="shrink-0 overflow-visible" aria-label="The Landlord">
      <ellipse cx={50} cy={97} rx={24} ry={3} fill="#000" opacity={0.3} />
      <motion.g
        style={{ originX: 0.5, originY: 1 }}
        animate={calm ? { rotate: 0 } : talking ? { rotate: [0, -1.5, 1.5, 0] } : { rotate: [0, -1, 0] }}
        transition={calm ? { duration: 0 } : { duration: talking ? 0.5 : 4, repeat: Infinity, ease: 'easeInOut' }}
      >
        {/* head, thinning hair */}
        <ellipse cx={50} cy={58} rx={29} ry={34} fill={SKIN} stroke={INK} strokeWidth={5} />
        <path d="M36 28 q4 -6 8 -1 M47 25 q4 -6 8 -1 M58 27 q4 -5 7 0" stroke={INK} strokeWidth={2.5} fill="none" strokeLinecap="round" />
        {/* reading glasses, pushed up onto the forehead */}
        <g stroke={INK} strokeWidth={3} fill="#cfe6f5" fillOpacity={0.55}>
          <circle cx={39} cy={36} r={7.5} />
          <circle cx={61} cy={36} r={7.5} />
          <path d="M46.5 36 q3.5 -3 7 0 M31.5 35 l-6 2 M68.5 35 l6 2" fill="none" strokeLinecap="round" />
        </g>
        {/* eyes: half shut, bags underneath */}
        {[38, 62].map((x) => (
          <g key={x}>
            <circle cx={x} cy={55} r={7} fill="#fff" stroke={INK} strokeWidth={2.5} />
            <circle cx={x} cy={57} r={3.2} fill={INK} />
            <path d={`M${x - 8} ${expression === 'smug' ? 56 : 54} h16 v-9 h-16 z`} fill={SKIN} />
            <line x1={x - 7.5} x2={x + 7.5} y1={expression === 'smug' ? 56 : 54} y2={expression === 'smug' ? 56 : 54} stroke={INK} strokeWidth={2.5} strokeLinecap="round" />
            <path d={`M${x - 6} 65 q6 4 12 0`} stroke={INK} strokeWidth={1.8} fill="none" opacity={0.55} strokeLinecap="round" />
          </g>
        ))}
        {/* moustache and a mouth that has explained the rules too many times */}
        <path d="M36 74 q7 -6 14 -1 q7 -5 14 1 q-7 4 -14 1 q-7 3 -14 -1 z" fill="#6f655c" stroke={INK} strokeWidth={2} />
        {talking ? (
          <motion.ellipse cx={50} cy={81} rx={6} fill={INK} initial={{ ry: 1.5 }} animate={calm ? { ry: 3 } : { ry: [1.2, 4.5, 1.2] }} transition={calm ? {} : { duration: 0.28, repeat: Infinity }} />
        ) : (
          <path d="M43 81 q7 -2 14 0" stroke={INK} strokeWidth={3.5} fill="none" strokeLinecap="round" />
        )}
      </motion.g>
      {/* key ring: one key per tenant */}
      <g transform="translate(84 84)">
        <circle r={6.5} fill="none" stroke={INK} strokeWidth={2.5} />
        {Array.from({ length: n }, (_, i) => {
          const a = -150 + (i * 120) / Math.max(1, n - 1);
          return (
            <g key={i} transform={`rotate(${a}) translate(0 10)`}>
              <rect x={-1.6} y={0} width={3.2} height={10} rx={1} fill="#d9b44a" stroke={INK} strokeWidth={1.2} />
              <rect x={1.4} y={6} width={3} height={2} fill="#d9b44a" stroke={INK} strokeWidth={1} />
            </g>
          );
        })}
      </g>
    </svg>
  );
}
