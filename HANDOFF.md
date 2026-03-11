# Blog Generation System — Agent Handoff Document

## Session Context

This document captures the architecture discussion between the user and Claude Opus 4.6 on 2026-03-11. The goal is to build a Notion Workers-based blog generation system that produces **near-final drafts** from SME interview transcripts. No code was written — this is a braindump and architecture plan.

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
FIREFLIES ──[OAuth]──→  NOTION (Hub)                    ──→ WORKFRONT
                         ├─ pullTranscript                   (copy/paste)
                         ├─ processTranscript
                         ├─ generateDraft (personas/protocols from blog-generation-tool-v2)
                         └─ prepWorkfront
```

## Worker Tools to Build (Priority Order)

### 1. `pullTranscript` — Fireflies → Notion
- **OAuth** into Fireflies API (they have an API; need to check docs for auth flow)
- **Input**: meeting ID or search term (date, participant name)
- **Output**: raw transcript JSON with timestamps
- **Priority**: HIGH — unblocks the pipeline

### 2. `processTranscript` — Structure raw transcript
- **Input**: raw transcript text
- **Output**:
  - Key themes identified
  - Notable/quotable moments with timestamps
  - Speaker-attributed sections
  - Suggested outline structure
- **Priority**: HIGH — biggest per-blog time savings (20-30 min each)

### 3. `generateDraft` — The core product
- **Input**: processed transcript + user's detailed outline + personas/protocols
- **Output**: near-final blog draft
- **Priority**: HIGH — this is where `blog-generation-tool-v2` gets refactored
- **Key task**: Analyze the personas and protocols in `blog-generation-tool-v2`, determine what's still valuable with Opus 4.6, and encode the editorial voice/structure into this tool
- **Quality bar**: The user wants drafts good enough to publish with **light editing only**

### 4. `prepWorkfront` — Generate submission metadata
- **Input**: final blog content
- **Output**:
  - 130-character teaser
  - TL;DR summary
  - Target market/audience identification
- **Priority**: MEDIUM — quick to build, saves time on every publish

### 5. `researchSME` — Background lookup (nice-to-have)
- **Input**: person name, company name
- **Output**: brief bio, company overview, relevant context
- **Priority**: LOW — minimal research is typically needed

## Key Architectural Decisions

1. **Notion is the hub** — project management, content storage, agent orchestration
2. **Workshopping may stay in Claude chat** — but only if the `generateDraft` tool can't produce near-final quality. The ideal outcome is drafts good enough that workshopping is minimal or unnecessary.
3. **Workfront is locked down** — no API. The `prepWorkfront` tool generates the text; user copy/pastes into Workfront.
4. **Content source is almost entirely from transcripts** — minimal external research needed
5. **The user provides detailed outlines** — sections, key points, structure. The `processTranscript` tool can suggest outlines, but editorial direction is the user's domain.

## Content Details

- **Volume**: currently 3-5 blogs/month, goal is 8+/month
- **Content type**: primarily from SME interviews — thought leadership, technical, news/reporting mix
- **Almost all context** comes from the Fireflies transcript; occasional technical jargon lookups or SME background research

## What the Next Agent Should Do

1. **Read `blog-generation-tool-v2`** thoroughly — understand the personas, protocols, and generation logic
2. **Assess what's still valuable** with Opus 4.6 vs. what the model handles natively now
3. **Investigate the Fireflies API** — auth method (OAuth2?), transcript endpoints, data format
4. **Design the Notion database schema** for the blog pipeline (status tracking, one page per blog, transcript storage)
5. **Build tools in priority order**: `pullTranscript` → `processTranscript` → `generateDraft` → `prepWorkfront`
6. **The `generateDraft` tool is the product** — everything else is plumbing. Invest the most design effort here.

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
- What's in `blog-generation-tool-v2`? (Personas, protocols, prompts — need to analyze)
- How should the Notion database be structured for the blog pipeline?
- Can the processed transcript + outline be structured well enough that `generateDraft` produces near-final output?
- Is there a clean way to pass context from Notion into Claude chat if workshopping is still needed?
