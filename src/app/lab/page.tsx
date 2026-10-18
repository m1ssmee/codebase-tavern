'use client';
import { Suspense } from 'react';
import dynamic from 'next/dynamic';
import { useSearchParams } from 'next/navigation';

// three.js only loads on this page, on the client.
const Lab = dynamic(() => import('@/components/cast/Lab'), {
  ssr: false,
  loading: () => <p className="p-6 text-sm text-muted">Loading the cast.</p>,
});
// /lab?portraits=1: the sheet `npm run portraits` captures.
const Portraits = dynamic(() => import('@/components/cast/Portraits'), { ssr: false });

function Pick() {
  return useSearchParams().has('portraits') ? <Portraits /> : <Lab />;
}

export default function LabPage() {
  return (
    <Suspense fallback={null}>
      <Pick />
    </Suspense>
  );
}
