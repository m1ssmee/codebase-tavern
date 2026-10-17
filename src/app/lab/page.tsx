'use client';
import dynamic from 'next/dynamic';

// three.js only loads on this page, on the client.
const Lab = dynamic(() => import('@/components/cast/Lab'), {
  ssr: false,
  loading: () => <p className="p-6 text-sm text-muted">Loading the cast.</p>,
});

export default function LabPage() {
  return <Lab />;
}
