'use client';
import { useEffect, useSyncExternalStore } from 'react';
import Link from 'next/link';
import { Group, Panel, Separator } from 'react-resizable-panels';
import { useTavern } from '@/lib/store';
import { mockCharacters, mockRepo } from '@/lib/mockRepo';
import TopBar from '@/components/TopBar';
import TreePanel from '@/components/TreePanel';
import CodePanel from '@/components/CodePanel';
import ChatPanel from '@/components/ChatPanel';

const handle = 'w-1.5 bg-edge transition-colors hover:bg-amber data-[separator=active]:bg-amber';
const never = () => () => {};
// Server snapshot = true so the prerendered HTML doesn't flash the empty state before the mock loads.
const readMockParam = () => new URLSearchParams(window.location.search).get('mock') === '1';

export default function TavernPage() {
  const repo = useTavern((s) => s.repo);
  // Read the URL directly instead of useSearchParams, so no Suspense boundary is needed.
  const wantsMock = useSyncExternalStore(never, readMockParam, () => true);

  useEffect(() => {
    // Re-read the URL: during hydration wantsMock is still the server snapshot (true).
    if (!readMockParam()) return;
    useTavern.getState().loadRepo(mockRepo);
    useTavern.getState().setCharacters(mockCharacters);
  }, []);

  return (
    <div className="flex h-screen flex-col overflow-hidden">
      <TopBar />
      {repo ? (
        <Group orientation="horizontal" className="min-h-0 flex-1">
          <Panel defaultSize="22%" minSize="12%">
            <TreePanel />
          </Panel>
          <Separator className={handle} />
          <Panel minSize="25%">
            <CodePanel />
          </Panel>
          <Separator className={handle} />
          <Panel defaultSize="30%" minSize="18%">
            <ChatPanel />
          </Panel>
        </Group>
      ) : (
        !wantsMock && (
          <div className="grid flex-1 place-items-center text-center">
            <div>
              <p className="font-display text-3xl tracking-wide text-amber">The tavern is empty.</p>
              <p className="mt-2 text-muted">
                <Link href="/" className="underline hover:text-cream">Summon a codebase</Link> or{' '}
                <a href="/tavern?mock=1" className="underline hover:text-cream">open the mock repo</a>.
              </p>
            </div>
          </div>
        )
      )}
    </div>
  );
}
