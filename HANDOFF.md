# Blog Generation System — Agent Handoff Document

## Session Context

This document captures architecture discussions between the user and Claude Opus 4.6 across two sessions (2026-03-11 and 2026-03-14). The goal is to build a Notion Workers-based blog generation system that produces **near-final drafts** from SME interview transcripts. No code was written — this is a braindump, architecture plan, and editorial framework.

## Repositories

- **`workers-template`**: Notion Workers SDK template. Contains the scaffold for building custom worker tools (agent tools + OAuth). See `CLAUDE.md` for SDK docs, `.examples/` for capability samples.
- **`blog-generation-tool-v2`**: The user's existing blog generator with **personas and protocols** that encode editorial voice, blog structure, and writing standards. **This repo is critical** — it contains the editorial intelligence that needs to be refactored into Notion worker tools. The user found that with earlier AI models, the generator's personas/protocols were necessary for quality output. With Opus 4.6, raw chat was good enough without them. But the hypothesis is: **Opus 4.6 + refactored personas/protocols + Notion workers = near-final drafts with minimal editing**.

## Current Blog Workflow (Manual)

1. **Interview an SME** → recorded in Fireflies
2. **Download JSON transcript** (with timestamps) from Fireflies manually
3. **Attach transcript to Claude Opus 4.6 chat** with a **detailed outline** (sections, key points, structure)
4. **Iteratively workshop** the draft: whole → sections → paragraphs. The user is very opinionated about writing voice and blog progression. This is the core creative process.
5. **Fill out Workfront (Adobe) submission**: 130-character teaser, TL;DR, target market/audience
6. **Publish via Workfront UI** (locked down, no API — manual copy/paste)

## Target Workflow (With Workers)

Notion is the **hub**. Worker tools handle data flow. The workshopping phase should be dramatically shortened or eliminated if the draft quality is high enough.

```
FIREFLIES ──[OAuth]──→  NOTION (Hub)                         ──→ WORKFRONT
                         ├─ pullTranscript                        (copy/paste)
                         ├─ processTranscript → [3 thesis candidates]
                         │                       ↓
                         │                   USER approves/redirects
                         │                       ↓
                         ├─ generateDraft → [structured sections]
                         │                       ↓
                         ├─ editSection × 4-5 → [polished sections]
                         │                       ↓
                         └─ prepWorkfront → [teaser, TL;DR, audience]
```

### Pipeline Detail

The pipeline is **thesis-first** and **section-by-section**:

1. **`processTranscript`** analyzes the transcript and returns **3 ranked thesis candidates**.
2. The Notion agent presents them to the user. The user either approves one, provides editorial direction, or asks the tool to dig deeper (re-call with guidance).
3. **`generateDraft`** takes the approved thesis + transcript + outline and produces a **structured draft** — an array of sections (intro, 2-3 body, conclusion), each with 2-3 paragraphs.
4. **`editSection`** is called once per section. It applies hardcoded editorial principles (see below) to polish each section independently. Context stays tight: just the section text + thesis for coherence.
5. **`prepWorkfront`** generates submission metadata from the assembled final draft.

## Worker Tools to Build (Priority Order)

### 1. `pullTranscript` — Fireflies → Notion
- **OAuth** into Fireflies API (they have an API; need to check docs for auth flow)
- **Input**: meeting ID or search term (date, participant name)
- **Output**: raw transcript JSON with timestamps
- **Priority**: HIGH — unblocks the pipeline

### 2. `processTranscript` — Thesis extraction + transcript analysis
- **Input**: raw transcript text, optional `guidance` string (for re-analysis if user rejects initial thesis candidates)
- **Output** (structured):
  - `thesisCandidates`: array of 3 ranked thesis statements, each with a supporting rationale and key evidence from the transcript
  - `themes`: key themes identified
  - `quotableMoments`: notable/quotable moments with timestamps and speaker attribution
  - `speakerSections`: speaker-attributed sections
  - `suggestedOutline`: suggested section structure based on the strongest thesis
- **Priority**: HIGH — biggest per-blog time savings (20-30 min each)
- **Thesis-first workflow**: The thesis is the backbone. If the user rejects all 3 candidates, the tool can be re-called with `guidance` (e.g., "focus on the infrastructure angle, not the team angle") to produce new candidates informed by editorial direction.

### 3. `generateDraft` — Structured raw draft
- **Input**: approved thesis + transcript + user's outline
- **Output** (structured):
  - `sections`: array of `{ heading: string, content: string, role: "intro" | "body" | "conclusion" }`
  - Each section contains 2-3 paragraphs of raw draft content
- **Priority**: HIGH — this is where `blog-generation-tool-v2` gets refactored
- **Key task**: Analyze the personas and protocols in `blog-generation-tool-v2`, determine what's still valuable with Opus 4.6, and encode the editorial voice/structure into this tool
- **Note**: This tool produces a **raw structured draft**, not a polished blog. Polishing happens in `editSection`.

### 4. `editSection` — Section-level editorial polish
- **Input**: `{ sectionContent: string, thesis: string, role: "intro" | "body" | "conclusion", precedingContext: string (optional — summary of prior sections for flow) }`
- **Output**: polished section text
- **Priority**: HIGH — this is where editorial quality lives
- **Editorial principles are HARDCODED** into this tool (see "Editorial DNA" section below). The user does not pass them in. They are the tool's personality.
- **Context stays tight**: each call only sees one section (~2-3 paragraphs) + the thesis + optional preceding context summary. No context window bloat.

### 5. `prepWorkfront` — Generate submission metadata
- **Input**: final blog content
- **Output**:
  - 130-character teaser
  - TL;DR summary
  - Target market/audience identification
- **Priority**: MEDIUM — quick to build, saves time on every publish

### 6. `researchSME` — Background lookup (nice-to-have)
- **Input**: person name, company name
- **Output**: brief bio, company overview, relevant context
- **Priority**: LOW — minimal research is typically needed

## Editorial DNA (Hardcoded in `editSection`)

These principles are baked into `editSection` as its core editorial logic. They are NOT configurable per-blog — they represent the user's writing standards.

### Structure
- **Structure follows importance, not narrative convenience.** Lead with what matters. Don't bury the point under setup.
- **One idea per paragraph.** If a paragraph serves two masters, split it.

### Voice
- **Say the thing. Don't announce that you're about to say the thing.** No throat-clearing ("In this section, we'll explore..."). Just say it.
- **Show, don't tell.** Demonstrate through evidence and example, not assertion.
- **Don't restate what a quote already said.** If a quote makes the point, let it. Don't parrot it back in your own words before or after.

### Rhythm
- **Vary your sentence entries.** When consecutive sentences share the same structure (noun-verb-object, noun-verb-object), the reader's ear goes numb. That's the staccato problem. Mix the rhythm. Let some sentences run. Let others stop short.
- **Dashes are a decision you haven't made yet.** If you reach for a dash, decide: is this a comma, a colon, a period, or parentheses? Pick one.

### Discipline
- **Cut before you add.** Remove throat-clearing, sections that don't support or advance the thesis. Every paragraph must earn its place.
- **Emotional weight belongs where it's earned, not where it's safe.** Don't front-load sentiment. Build to it.
- **Trust the reader.** They're smart, overstimulated, and consuming too much. They don't need you to set up the point, make the point, and then confirm that you made the point. Make it once. Move on.

## Key Architectural Decisions

1. **Notion is the hub** — project management, content storage, agent orchestration.
2. **Thesis-first pipeline** — no drafting begins until the user approves a thesis. This is the single highest-leverage decision for draft quality.
3. **Section-by-section editing** — solves the context window problem. Each `editSection` call has tight context (~2-3 paragraphs + thesis). No drift, no bloat.
4. **Editorial principles are hardcoded, not configurable** — the user's writing standards don't change blog-to-blog. They're the tool's DNA.
5. **Workfront is locked down** — no API. The `prepWorkfront` tool generates the text; user copy/pastes into Workfront.
6. **Content source is almost entirely from transcripts** — minimal external research needed.
7. **The user provides detailed outlines** — sections, key points, structure. The `processTranscript` tool can suggest outlines, but editorial direction is the user's domain.
8. **Blog structure**: typically intro + 2-3 body sections + conclusion, each with 2-3 paragraphs. This makes section-by-section editing very practical (4-5 `editSection` calls per blog).

## Content Details

- **Volume**: currently 3-5 blogs/month, goal is 8+/month
- **Content type**: primarily from SME interviews — thought leadership, technical, news/reporting mix
- **Almost all context** comes from the Fireflies transcript; occasional technical jargon lookups or SME background research

## What the Next Agent Should Do

1. **Read `blog-generation-tool-v2`** thoroughly — understand the personas, protocols, and generation logic.
2. **Assess what's still valuable** with Opus 4.6 vs. what the model handles natively now. The editorial principles above are already extracted from the user's guidance — but `blog-generation-tool-v2` may have additional voice/structure patterns worth preserving.
3. **Investigate the Fireflies API** — auth method (OAuth2?), transcript endpoints, data format.
4. **Design the Notion database schema** for the blog pipeline (status tracking, one page per blog, transcript storage).
5. **Build tools in priority order**: `pullTranscript` → `processTranscript` → `generateDraft` → `editSection` → `prepWorkfront`.
6. **`editSection` is where quality lives.** The editorial principles above must be encoded as the tool's core logic. `generateDraft` produces raw structure; `editSection` produces publishable prose.
7. **Test the thesis-first flow end-to-end.** The biggest risk is thesis quality — if `processTranscript` can't extract a strong thesis, everything downstream suffers.

## SDK Quick Reference

Workers use `@notionhq/workers`. Generally available capabilities: **Agent tools** and **OAuth**. See `CLAUDE.md` in `workers-template` for full SDK docs.

```ts
// Tool pattern
worker.tool("toolName", {
  title: "...",
  description: "...",
  schema: j.object({ /* fields */ }),
  execute: (input, context) => { /* return result */ },
});

// OAuth pattern
const fireflies = worker.oauth("fireflies", {
  name: "fireflies",
  authorizationEndpoint: "...",
  tokenEndpoint: "...",
  clientId: "...",
  clientSecret: process.env.FIREFLIES_CLIENT_SECRET ?? "",
  scope: "...",
});
```

## Open Questions for Next Session

- What auth flow does Fireflies use? (Need to check their API docs)
- What's in `blog-generation-tool-v2`? (Personas, protocols, prompts — need to analyze for anything not captured in the Editorial DNA section above)
- How should the Notion database be structured for the blog pipeline?
- How should `editSection` handle the `precedingContext` parameter? Options: (a) agent passes a 1-2 sentence summary of prior sections, (b) tool receives headings of prior sections, (c) nothing — each section is edited in isolation. Tradeoff: more context = better flow, but more tokens per call.
- Should `generateDraft` also receive the editorial principles to produce a better raw draft, or should it intentionally stay "raw" and let `editSection` do all the polishing? (Current design: raw draft → polish. But front-loading some editorial awareness in `generateDraft` might reduce the delta `editSection` has to cover.)
