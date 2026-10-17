'use client';
import { useEffect, useState, useSyncExternalStore } from 'react';
import { usePanelRef } from 'react-resizable-panels';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Group, Panel, Separator } from 'react-resizable-panels';
import { X } from 'lucide-react';
import { loadSavedDemo, summonRepo, useTavern } from '@/lib/store';

const DEMO_URL = 'https://github.com/m1ssmee/quickcart';
import { mockCharacters, mockRepo } from '@/lib/mockRepo';
import { capNote, CAP_REASON, parseGitHubUrl } from '@/lib/analyze';
import TopBar from '@/components/TopBar';
import TreePanel from '@/components/TreePanel';
import CodePanel from '@/components/CodePanel';
import ChatPanel from '@/components/ChatPanel';
import TribunalPanel from '@/components/TribunalPanel';
import WhatIfPanel from '@/components/WhatIfPanel';
import TenantsLoader from '@/components/TenantsLoader';
import CharacterFace from '@/components/CharacterFace';
import dynamic from 'next/dynamic';

// html-to-image and the QR code only load when someone opens the roast.
const RoastPanel = dynamic(() => import('@/components/RoastPanel'), { ssr: false });

const handle = 'w-px bg-edge transition-colors hover:bg-amber data-[separator=active]:bg-amber';
const never = () => () => {};
// Read the URL directly instead of useSearchParams (no Suspense needed). Server snapshot = null → render nothing.
const readSearch = () => window.location.search;

export default function TavernPage() {
  const router = useRouter();
  const repo = useTavern((s) => s.repo);
  const tribunal = useTavern((s) => s.tribunal);
  const whatIf = useTavern((s) => s.whatIf);
  const roastOpen = useTavern((s) => s.roastOpen);
  const rightPanel = usePanelRef();
  const search = useSyncExternalStore(never, readSearch, () => null);
  const [error, setError] = useState<string | null>(null);
  const [bannerHidden, setBannerHidden] = useState(false);
  const params = search === null ? null : new URLSearchParams(search);
  const slug = params?.get('repo') ?? (params?.get('demo') === '1' ? 'm1ssmee/quickcart' : null);

  // Pre-warm the chat and Tribunal functions so the first click doesn't pay a cold start. Failures don't matter.
  useEffect(() => {
    for (const route of ['tribunal', 'chat', 'whatif', 'roast']) fetch(`/api/${route}?warm=1`, { cache: 'no-store' }).catch(() => {});
  }, []);

  useEffect(() => {
    const q = new URLSearchParams(window.location.search);
    const s = useTavern.getState();
    if (q.get('demo') === '1') {
      // Emergency route (not linked anywhere): saved quickcart + saved cast, no GitHub or AI calls to load.
      loadSavedDemo().then(() => useTavern.setState({ demo: true }));
    } else if (q.get('mock') === '1') {
      s.loadRepo(mockRepo);
      s.setCharacters(mockCharacters);
    } else if (q.get('repo')) {
      // Refresh / shared link: store is empty (or holds another repo), so ingest from the URL.
      const want = parseGitHubUrl(q.get('repo')!)?.url;
      // saved=1 ("Try the demo repo"): a refresh reloads the bundled quickcart instead of the slow live path.
      if (s.repo?.url !== want && q.get('saved') === '1' && want === DEMO_URL) loadSavedDemo();
      else if (s.repo?.url !== want) summonRepo(q.get('repo')!).catch((e: Error) => setError(e.message));
    } else if (!s.repo) {
      router.replace('/');
    }
  }, [router]);

  // Tribunal and What-if widen the right panel; the middle panel stays visible so citations can highlight.
  const wide = tribunal || !!whatIf;
  useEffect(() => {
    rightPanel.current?.resize(wide ? '40%' : '30%');
  }, [wide, rightPanel]);

  if (error) {
    return (
      <div className="flex h-screen flex-col">
        <TopBar />
        <div className="grid flex-1 place-items-center px-6 text-center">
          <div>
            <div className="mb-4 flex justify-center">
              <CharacterFace size={80} name="payments" mood="guilty" />
            </div>
            <p className="font-display text-2xl text-tomato italic">{error}</p>
            <Link href="/" className="mt-4 inline-block text-sm text-muted underline underline-offset-4 hover:text-cream">
              Back to the entrance
            </Link>
          </div>
        </div>
      </div>
    );
  }

  if (!repo) return slug ? <TenantsLoader what={slug} /> : null;

  const sk = repo.skipped;
  return (
    <div className="flex h-screen flex-col overflow-hidden">
      <TopBar />
      {sk && !bannerHidden && (
        <div className="flex items-center gap-3 border-b border-edge bg-wood px-4 py-1.5 text-sm text-cream">
          <span>
            Loaded <b>{repo.files.length}</b> {repo.files.length === 1 ? 'file' : 'files'} across <b>{repo.modules.length}</b>{' '}
            {repo.modules.length === 1 ? 'module' : 'modules'}.{' '}
            {sk.count ? (
              <>
                Skipped <b>{sk.count}</b> ({Object.entries(sk.reasons).sort((a, b) => b[1] - a[1]).map(([r]) => r).join(', ')}).
              </>
            ) : (
              'Skipped nothing.'
            )}
            {sk.reasons[CAP_REASON] ? <span className="ml-2 font-display italic">The Landlord: &ldquo;{capNote(repo.files.length)}&rdquo;</span> : null}
          </span>
          <button type="button" onClick={() => setBannerHidden(true)} aria-label="Dismiss" className="ml-auto text-muted hover:text-cream">
            <X size={18} />
          </button>
        </div>
      )}
      <Group orientation="horizontal" className="min-h-0 flex-1">
        <Panel defaultSize="22%" minSize="12%">
          <TreePanel />
        </Panel>
        <Separator className={handle} />
        <Panel minSize="25%">
          <CodePanel />
        </Panel>
        <Separator className={handle} />
        <Panel defaultSize="30%" minSize="18%" panelRef={rightPanel}>
          {tribunal ? <TribunalPanel /> : whatIf ? <WhatIfPanel key={whatIf.id} /> : <ChatPanel />}
        </Panel>
      </Group>
      {roastOpen && <RoastPanel />}
    </div>
  );
}
