import type { Mood } from '@/lib/types';

// ponytail: placeholder face, Phase 3 replaces it with real characters.
export default function CharacterFace({
  color = '#f5a524',
  mood = 'idle',
  size = 32,
}: {
  color?: string;
  mood?: Mood;
  size?: number;
}) {
  const happy = mood === 'happy';
  const sad = mood === 'guilty';
  return (
    <svg width={size} height={size} viewBox="0 0 100 100" className="shrink-0 drop-shadow-[0_2px_0_rgba(0,0,0,0.5)]" aria-hidden>
      <circle cx="50" cy="50" r="46" fill={color} stroke="#17110e" strokeWidth="6" />
      {/* eyes */}
      {happy ? (
        <g stroke="#17110e" strokeWidth="6" strokeLinecap="round" fill="none">
          <path d="M28 44 q7 -9 14 0" />
          <path d="M58 44 q7 -9 14 0" />
        </g>
      ) : (
        <g fill="#17110e">
          <circle cx="35" cy={sad ? 46 : 42} r={mood === 'accused' ? 9 : 6} />
          <circle cx="65" cy={sad ? 46 : 42} r={mood === 'accused' ? 9 : 6} />
        </g>
      )}
      {mood === 'accused' && (
        <g stroke="#17110e" strokeWidth="5" strokeLinecap="round">
          <line x1="24" y1="26" x2="44" y2="32" />
          <line x1="76" y1="26" x2="56" y2="32" />
        </g>
      )}
      {sad && <path d="M80 30 q6 10 0 14 q-6 -4 0 -14z" fill="#8ad4ff" />}
      {/* mouth */}
      {mood === 'talking' ? (
        <ellipse
          cx="50"
          cy="70"
          rx="12"
          ry="9"
          fill="#17110e"
          style={{ transformOrigin: '50px 70px', animation: 'tavern-talk 0.25s infinite' }}
        />
      ) : mood === 'accused' ? (
        <circle cx="50" cy="72" r="7" fill="#17110e" />
      ) : (
        <path
          d={happy ? 'M30 62 q20 22 40 0' : sad ? 'M34 76 q16 -12 32 0' : 'M34 66 q16 10 32 0'}
          stroke="#17110e"
          strokeWidth="6"
          strokeLinecap="round"
          fill={happy ? '#17110e' : 'none'}
        />
      )}
    </svg>
  );
}
