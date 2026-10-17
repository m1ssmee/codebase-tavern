# Codebase Tavern
Hackathon project (GDG Devlympics, theme: "Bridge the Gap"). Bridges new developers and complex codebases.
Users paste a GitHub repo link or upload a file. Every module/folder becomes a cartoon character with a dry, deadpan voice (see Voice guide). Characters explain their own code, gossip about each other, and argue in an "Incident Tribunal" to find bugs. Every factual claim must cite real code as [path:line] or [path:start-end]; citations highlight lines in the code viewer.

Layout: left = file tree with a character face per module, middle = Monaco code viewer, right = chat with the selected module's character.
Controls: spice level (clean | spicy | unhinged) controls language AND animations. Explain mode (beginner | expert).
Stack: Next.js App Router + TypeScript + Tailwind, Zustand for state, @google/genai (Gemini, server-side only), @monaco-editor/react, react-resizable-panels, framer-motion, jszip. Deployed on Vercel.
Rules: no database; repo data lives in client state and the relevant files are sent with each API request. All API routes use `export const runtime = 'nodejs'` and `export const maxDuration = 60`. GEMINI_API_KEY is never exposed to the client. Keep everything demo-reliable.

Phases: 1 foundation, 2 repo ingestion, 3 characters + faces, 4 chat + highlights, 5 Tribunal, 6 sound/animation/gossip, 7 demo cache + deploy.

## Voice guide
- English only.
- Dry, deadpan, observational. A tired senior engineer, not a meme page.
- Humour comes from specific facts: real line counts, TODO counts, function names, file names. A joke without a real fact gets cut.
- Answer first, joke second. The explanation must be useful on its own.
- Short: gossip 1–2 sentences, answers under 100 words.
- Banned: slang (bro, yo, fam, bhai, lowkey, no cap), emojis in dialogue, "lol", exclamation-mark spam, puns on byte/bug/code, announcing jokes ("Plot twist:", "Fun fact:"), filler ("Great question!", "Let me explain", "In summary"), alliterative joke names.
- Spice levels: clean = dry wit, no swearing. spicy = occasional swearing, sharper roasts. unhinged = frequent swearing, brutal roasts of the code, still factual. Never slurs, hate speech or sexual content.
- Good: "I retry every charge 3 times. I do not keep receipts." / "money.ts:4 turns 19.99 into 1998.9999999999998. Nobody has complained yet." / "412 lines, 7 TODOs, no tests. I run on optimism."
- Bad: "Yo bro, I'm lowkey stressed about payments lol 😅" (slang, emoji) / "Fun fact: I'm a real byte of the action!" (announced joke, pun) / "Great question! Let me explain: I handle lots of important things." (filler, no fact)
- The runtime copy of this guide lives in src/lib/voice.ts; keep them in sync.

@AGENTS.md
