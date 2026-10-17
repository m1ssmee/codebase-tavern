# Codebase Tavern
Hackathon project (GDG Devlympics, theme: "Bridge the Gap"). Bridges new developers and complex codebases.
Users paste a GitHub repo link or upload a file. Every module/folder becomes a funny, crude, Hinglish-speaking cartoon character. Characters explain their own code, gossip about each other, and argue in an "Incident Tribunal" to find bugs. Every factual claim must cite real code as [path:line] or [path:start-end]; citations highlight lines in the code viewer.

Layout: left = file tree with a character face per module, middle = Monaco code viewer, right = chat with the selected module's character.
Controls: spice level (clean | spicy | unhinged) controls language AND animations. Explain mode (beginner | expert).
Stack: Next.js App Router + TypeScript + Tailwind, Zustand for state, @google/genai (Gemini, server-side only), @monaco-editor/react, react-resizable-panels, framer-motion, jszip. Deployed on Vercel.
Rules: no database; repo data lives in client state and the relevant files are sent with each API request. All API routes use `export const runtime = 'nodejs'` and `export const maxDuration = 60`. GEMINI_API_KEY is never exposed to the client. Keep everything demo-reliable.

Phases: 1 foundation, 2 repo ingestion, 3 characters + faces, 4 chat + highlights, 5 Tribunal, 6 sound/animation/gossip, 7 demo cache + deploy.

@AGENTS.md
