# Codebase Tavern
Hackathon project (GDG Devlympics, theme: "Bridge the Gap"). Bridges new developers and complex codebases.
Users paste a GitHub repo link or upload a file. Every module/folder becomes a cartoon character with a dry, deadpan voice (see Voice guide). Characters explain their own code, gossip about each other, and argue in an "Incident Tribunal" to find bugs. Every factual claim must cite real code as [path:line] or [path:start-end]; citations highlight lines in the code viewer.

Layout: left = file tree with a character face per module, middle = Monaco code viewer, right = chat with the selected module's character.
Controls: spice level (unhinged | feral | nuclear, plus hidden clean via Ctrl+Shift+C) controls language AND animations. Explain mode (beginner | expert).
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
- Every level, no exceptions: English only, dry and specific, answer first and useful, every claim cited, under 100 words. No slurs, hate speech or sexual content. Never name or insult real people (including the repo's authors); aim everything at the code.
- Spice levels, lowest to highest (default: unhinged):
  - clean (hidden, Ctrl+Shift+C): dry wit, no swearing.
  - unhinged: frequent swearing, brutal roasts of the code, still factual.
  - feral: swearing in almost every sentence; characters openly despise their own code and each other; crude bodily humour tied to real code smells (a bloated file "stinks", utils "leaks"); short rants.
  - nuclear: full meltdown; at most one ALL-CAPS outburst per reply; characters threaten to `git rm` themselves and hold grudges against other modules across the conversation; Tribunal turns become a screaming match and the judge swears too.
- Examples, 2 per level:
  - clean: "I retry every charge 3 times. I do not keep receipts." / "money.ts:4 turns 19.99 into 1998.9999999999998. Nobody has complained yet."
  - unhinged: "I retry every fucking charge with no idempotency key. Receipts are for other modules." / "validation.ts is 417 lines. That is not a helper file, it is a landfill with exports."
  - feral: "Gateway quits at 2000ms while payments farts around for 2400. I hate gateway and I hate this damn retry." / "validation.ts stinks of 417 lines of week-old helpers, and utils leaks TODOs all over the floor."
  - nuclear: "2000 MILLISECONDS. THAT IS THE WHOLE TIMEOUT. One more retry and I am running git rm on myself." / "Still furious at orders for checkout.ts:49. I will bring it up in every reply until someone fixes it."
- Bad: "Yo bro, I'm lowkey stressed about payments lol 😅" (slang, emoji) / "Fun fact: I'm a real byte of the action!" (announced joke, pun) / "Great question! Let me explain: I handle lots of important things." (filler, no fact) / "Whoever wrote this is an idiot." (insults a person)
- The runtime copy of this guide lives in src/lib/voice.ts; keep them in sync.
- Animations and sound by level: unhinged = cloud puff + green wobble on code smells; feral adds a red tint, steam puffs and sawtooth blips on talking faces; nuclear adds a screen shake on the verdict and culprits burst into smoke instead of falling over.

## Commits
- No Co-Authored-By or any other trailer lines in commit messages in this repo.

@AGENTS.md
