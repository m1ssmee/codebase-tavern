'use client';
import { useEffect, useRef, useState, type ReactNode } from 'react';

/** Scales a fixed-size card down to the available width. */
export default function FitCard({ width, height, children }: { width: number; height: number; children: ReactNode }) {
  const box = useRef<HTMLDivElement>(null);
  const [w, setW] = useState(width);
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setW(el.clientWidth));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const s = Math.min(1, w / width);
  return (
    <div ref={box} className="w-full">
      <div style={{ width: width * s, height: height * s, margin: '0 auto' }}>
        <div style={{ width, height, transform: `scale(${s})`, transformOrigin: 'top left' }}>{children}</div>
      </div>
    </div>
  );
}
