# Codebase Tavern

Codebase Tavern turns every folder of a GitHub repo into a character that explains its own code, cites the exact lines, and argues with the other modules about who caused a bug. It is built for the first day on an unfamiliar codebase, when nobody has time to explain it to you.

**Live:** https://codebase-tavern.vercel.app

**Try it:** paste a GitHub link or click "Try the demo repo".

<!-- Screenshot: replace with docs/screenshot.png (tavern view: file tree, code panel, a character answering with citations) -->
_Screenshot to be added._

## What it does

- **Cited answers with live highlights.** Ask any module a question. Every claim in the answer cites `[path:line]`, invalid citations are dropped, and the cited lines light up in the code viewer while the character is still talking.
- **Characters generated from code stats.** Each module gets a face and a voice derived from real numbers: line count sets its width, 5 or more TODOs give it shifty eyes, a file over 300 lines makes it sweat, nesting 6 levels deep gives it spiral eyes, no tests make it shiver.
- **The Incident Tribunal.** Describe a bug ("Customers are being charged twice"). Two to four suspect modules argue in turns, each citing only its own code, and the judge returns a verdict: culprits, root cause, evidence and a small fix diff.
- **Spice levels.** Unhinged (default), Feral and Nuclear change how hard the characters swear at their own code. The roasting is aimed at code only, never at people.
- **Beginner and Expert modes.** Beginner answers use a fixed shape: one plain sentence, two to four numbered steps following one example through the code, and why it matters. Technical terms are defined on first use. Expert answers are under 100 words: exact lines, mechanism, risk.

## How it bridges the gap

New developers usually meet a codebase as a wall of files with no one to ask. The tavern gives each part of the code a voice that has to answer specific questions, show the lines it is talking about, and admit what it does badly. The Tribunal shows how a real bug crosses module boundaries, which is the part documentation rarely covers. Beginner mode explains in plain words and defines its terms; Expert mode gets out of the way.

## Tech stack

- Next.js (App Router) and TypeScript, Tailwind CSS, Zustand
- OpenAI (`gpt-5.4-mini`, capped by a daily budget, `OPENAI_DAILY_BUDGET_USD`, default $2.50), then Gemini (`gemini-3.8-flash`, then `gemini-3.5-flash`), then templates
- Monaco editor for the code viewer and line highlights
- Web Audio for the character voices and the verdict airhorn; Framer Motion for the faces
- Deployed on Vercel. No database: the repo lives in the browser and only the relevant files are sent with each request.

## Running locally

```bash
npm install
cp .env.example .env.local   # add GEMINI_API_KEY, OPENAI_API_KEY, GITHUB_TOKEN
npm run dev
npm run check                # self-checks for parsing and analysis
```
