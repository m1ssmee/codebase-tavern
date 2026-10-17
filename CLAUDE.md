# Codebase Tavern
Hackathon project (GDG Devlympics, theme: "Bridge the Gap"). Bridges new developers and complex codebases.
Users paste a GitHub repo link or upload a file. Every module/folder becomes a cartoon character with a dry, deadpan voice (see Voice guide). Characters explain their own code, gossip about each other, and argue in an "Incident Tribunal" to find bugs. Every factual claim must cite real code as [path:line] or [path:start-end]; citations highlight lines in the code viewer.

Layout: left = file tree with a character face per module, middle = Monaco code viewer, right = the transcript of the chat with the selected module's character (the characters themselves stand on the stage over the panels).
Controls: spice level (unhinged | feral | nuclear, plus hidden clean via Ctrl+Shift+C) controls language AND animations. Explain mode (beginner | expert).
Stack: Next.js App Router + TypeScript + Tailwind, Zustand for state, @google/genai (Gemini, server-side only), @monaco-editor/react, react-resizable-panels, framer-motion, jszip, three with @react-three/fiber and drei (3D cast, map), d3-force (map layout), mermaid (diagrams). Deployed on Vercel.
Rules: no database; repo data lives in client state and the relevant files are sent with each API request. All API routes use `export const runtime = 'nodejs'` and `export const maxDuration = 60`. GEMINI_API_KEY is never exposed to the client. Keep everything demo-reliable.

Phases: 1 foundation, 2 repo ingestion, 3 characters + faces, 4 chat + highlights, 5 Tribunal, 6 sound/animation/gossip, 7 demo cache + deploy.

## Voice guide
- English only.
- Dry, deadpan, observational. A tired senior engineer, not a meme page.
- Humour comes from specific facts: real line counts, TODO counts, function names, file names. A joke without a real fact gets cut.
- Answer first, joke second. The explanation must be useful on its own.
- Short: gossip 1–2 sentences; expert answers under 100 words; beginner answers up to 170 words.
- Roast the code, never people. No insults aimed at authors, users or anyone else; swearing is allowed only about code, and only at the swearing levels (unhinged, feral, nuclear; clean has none).
- Core rule: swearing adds emphasis, never replaces information. Profanity goes in the reactions and commentary; the explanation sentences stay clear. Swearing density per spice level is unchanged.
- No jargon without a definition (beginner mode and anything a beginner reads, like the Tribunal verdict; expert mode may use standard terms): replace technical terms (idempotent, middleware, async, promise, callback, payload, endpoint, schema, ORM, race condition, in-memory, upstream…) with plain words, or define them in parentheses on first use, e.g. "middleware (code that runs on every request before your handler)". Square brackets are only for citations.
- Never vague: no "handles", "manages", "deals with", "does some logic" or "stuff" without saying exactly what. Use real names and values from the code: function names, numbers like 2000ms, field names like order_id.
- Beginner mode (default): (1) one plain sentence (under 20 words) on what the code does, for someone who has never seen the codebase; (2) 2–4 numbered steps, one short sentence each, following one concrete example through the code (a customer clicking Pay, a request coming in), each step cited; (3) one "Why it matters:" sentence with a concrete failure scenario. Up to 170 words. Swearing sits in short reactions after steps; nuclear keeps its one ALL-CAPS outburst.
- Expert mode: terse, under 100 words, still concrete: exact lines, exact mechanism, exact risk. No vague summaries.
- Tribunal in beginner mode: the verdict's root cause is readable by a beginner (plain words, terms defined); turns stay short with no undefined jargon.
- Chat bubbles render simple markdown (numbered lists, **bold**, `inline code`); citation chips work inside list items.
- Banned: slang (bro, yo, fam, bhai, lowkey, no cap), emojis in dialogue, "lol", exclamation-mark spam, puns on byte/bug/code, announcing jokes ("Plot twist:", "Fun fact:"), filler ("Great question!", "Let me explain", "In summary"), alliterative joke names.
- Every level, no exceptions: English only, dry and specific, answer first and useful, every claim cited, within the mode's word limit. No slurs, hate speech or sexual content. Never name or insult real people (including the repo's authors); aim everything at the code.
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
- Beginner example (unhinged, quickcart orders; voice.ts has the same answer at every level, only the swearing changes):
  > I turn a customer's basket into a paid order by asking payments to charge their card.
  > 1. A customer clicks Pay and `checkout()` starts [orders/checkout.ts:33].
  > 2. I send payments a charge request with `order_id` and `amount` [orders/checkout.ts:20-31].
  > 3. If the gateway (the service that passes my request on to payments) stops waiting after 2000ms, I get an `UpstreamTimeoutError` and fire the same damn charge again, up to `MAX_PAYMENT_ATTEMPTS = 2` [orders/checkout.ts:44-52] [gateway/config.ts:16].
  > 4. When a charge succeeds, I mark the order paid [orders/checkout.ts:67].
  > Why it matters: payments takes about 2400ms under load [payments/processor.ts:26], so the first charge often lands after I stopped waiting, and my retry bills the card twice. No idempotency key (a unique ID that lets payments recognise a repeated request), so that retry is a fucking landmine.
- Expert example: "`checkout()` retries `requestCharge()` on `UpstreamTimeoutError` with `MAX_PAYMENT_ATTEMPTS = 2` [orders/checkout.ts:44-52]. The POST body carries `order_id` and `amount` but no idempotency key [orders/checkout.ts:20-31]. Gateway aborts at 2000ms [gateway/config.ts:16]; payments p50 is ~2400ms [payments/processor.ts:26]. Net effect: timeout-then-retry on a non-idempotent charge, so a slow success becomes a duplicate capture. Fix: send `idempotency_key: order.id` and dedupe on it in payments, or stop retrying on timeout."
- The runtime copy of this guide lives in src/lib/voice.ts; keep them in sync.
- Animations and sound by level: unhinged = cloud puff + green wobble on code smells; feral adds a red tint, steam puffs and sawtooth blips on talking faces; nuclear adds a screen shake on the verdict and culprits burst into smoke instead of falling over.

## AI temperature and safety
- Provider chain for every route: OpenAI gpt-5.4-mini (when OPENAI_API_KEY is set), then gemini-3.8-flash, then gemini-3.5-flash, then the routes' templates. Keep that order. LLM_PROVIDER=openai forces OpenAI and LLM_PROVIDER=gemini forces Gemini, for testing.
- Spend guard: OPENAI_DAILY_BUDGET_USD (default 2.50) per server instance, metered from each call's token usage at gpt-5.4-mini's prices, with an estimate held while a call runs so concurrent calls and streams that end without usage still count (src/lib/spend.ts); once reached, OpenAI is skipped until 00:00 UTC and it is logged. It is approximate (every instance counts on its own); the account balance is the hard stop.
- One temperature for every call, set in src/lib/llm.ts (provisional 1.4 for Gemini; LLM_TEMPERATURE 0-2 overrides it). A model that rejects a temperature gets its default, logged once; gpt-5.4-mini only takes its default. The comedy editor passes its own, lower temperature: it judges, it doesn't invent.
- High temperature is only allowed behind the safeguards. Pure-joke lines (roast lines, gossip, the Landlord, What-if reactions, the judge's closing remark) get 3 candidates, the deterministic filter in src/lib/guards.ts (blocklist of slurs, hate, sexual content and self-harm; swearing only at swearing levels; the voice guide's banned words; lines aimed at people; non-English text; invented numbers, names and files) and a comedy-editor call, with templates behind them.
- Facts: citations in chat, Tribunal and What-if are checked against the lines they cite, then re-anchored or dropped; the checker's work on client-sent code is bounded. Structured output is retried once on a parse or schema failure; fix diffs must apply to the real file or are regenerated once.
- Tribunal root causes and What-if reasons and summaries stay free of swearing at every level.
- Every LLM call logs its token counts.
- Roast cards are signed only when the server inspected the repo itself (a GitHub link); uploaded zips are never signed.
- src/data/demoCandidates/ holds alternative saved roasts and hearings. The saved roast is roast-3 and the saved hearing is tribunal-4 (one innocent, so the verdict shows the innocent ducking); the rest are not wired in.

## 3D cast
- Every module gets one of ten archetypes (src/lib/cast.ts, assignCast): a module that is 60% or more docs and config is the Librarian; otherwise its folder name, then its main files' names, are matched against keywords (head noun first); a repeat takes its next-best match before the alternate variant; with no match, the largest unmatched module is the Hoarder, one with 5 or more TODOs and no tests the Junk Drawer, anything else the Clerk.
- The Landlord (the narrator, one key per module) and the Judge (Tribunal only, behind its bench) are never assigned to a module; scripts/check.mjs enforces it.
- Everything is procedural (no downloaded models), on one shared rig. Full detail for single big views (the chat header, /lab); lite for small or crowded ones (map, Tribunal, tour). Lite stays under 15k triangles including outlines and 25 draw calls per character.
- 3D only ever renders inside CastCanvas with CastLights; the 2D face is always the fallback. The "3D characters" setting and the automatic switch to 2D (fps under 30 for 5 seconds) apply everywhere 3D appears.
- Gags follow the comedy rules in src/components/cast/anim: deadpan faces, cartoon only (no realistic weapons, blood or injury), crude but never sexual, one crude gag on screen at a time, a 30-second cooldown per character per gag, spice-gated with a clean fallback; prefers-reduced-motion gets still poses and no screen shake.
- /lab and /lab?board=1 are review pages, not linked from the app.

## The stage
- The cast stands over the three panels (src/components/stage): one transparent full-window CastCanvas (orthographic, lite, shared lights) under a DOM layer that takes the pointer only on the characters (real buttons, keyboard accessible). On stage: the speaker and up to 2 others; scenes bring up to 5. Hidden on the Map tab and during the Landlord's tour. "Tenants: on stage / parked / off" in the top bar; 3D off shows the 2D faces in the same places; reduced motion and parked: no walking, an arrow points at the line.
- A line named in a message ("line 29", "lines 40-52", [path:a-b]) opens, lights up and gets pointed at before the reply; /api/chat gets it as `focus` and answers about exactly those lines (as an outsider, "Not mine.", when the code belongs to another module). The answer hops to every line it cites (1.2 s or more per stop), opening files as needed.
- No spontaneous gossip: it comes from a character's click menu (Explain yourself, Who needs you?, Roast me, What if I change you?, Gossip, Pick a fight with...). Drag a character onto a code line (it explains it) or onto another character (/api/argue: 4 turns grounded in their real imports and calls; "We've never even met." from stats when nothing connects them, no AI). Flinging, pestering, peeks, groans, dizziness, waves and boredom are deterministic.
- The Tribunal sits on the stage over the dimmed code panel; What-if passes the change as a hot potato along the ripple order. Grudges (roasts and pesterings in the last 10 minutes) make a character sulky, never rude to the user.
- Demo route (?demo=1, zero AI calls): saved argument (src/data/demoArgue.json, orders vs payments) and saved line explanation (src/data/demoLines.json, the retry at orders/checkout.ts:50); anything else that needs AI answers with one in-character "live AI is off" line.
- Citations the model writes unreadably ([path:1-?], [path:?], [path:abc]) are normalised or dropped in parseCitations, everywhere.

## Commits
- No Co-Authored-By or any other trailer lines in commit messages in this repo.

@AGENTS.md
