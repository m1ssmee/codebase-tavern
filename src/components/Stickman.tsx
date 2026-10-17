'use client';
import { motion } from 'framer-motion';

/** Backflips along the bottom edge of the nearest positioned parent, left to right, forever. Hidden for reduced motion. */
export default function Stickman() {
  return (
    <motion.div
      aria-hidden
      className="pointer-events-none absolute bottom-6 left-0 text-cream motion-reduce:hidden"
      animate={{ x: ['-10vw', '105vw'] }}
      transition={{ duration: 14, repeat: Infinity, ease: 'linear' }}
    >
      <motion.svg
        width={30}
        height={45}
        viewBox="0 0 40 60"
        fill="none"
        stroke="currentColor"
        strokeWidth={3}
        strokeLinecap="round"
        // crouch, jump, rotate backwards (counter-clockwise when facing right), land, absorb
        animate={{ y: [0, 0, -56, 0, 0], rotate: [0, 0, -180, -360, -360], scaleY: [1, 0.8, 1, 0.85, 1] }}
        transition={{ duration: 1.6, repeat: Infinity, times: [0, 0.15, 0.5, 0.85, 1] }}
      >
        <circle cx={20} cy={8} r={6} />
        <path d="M20 14v22 M20 20l-11-9 M20 20l11-9 M20 36l-8 18 M20 36l8 18" />
      </motion.svg>
    </motion.div>
  );
}
