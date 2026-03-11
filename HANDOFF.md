# Notion Workers Blog Generation System — Handoff

## What This Is

A set of 6 Notion worker tools that automate the Dell/NVIDIA blog production pipeline. Built on `@notionhq/workers` with Claude Opus 4.6 as the LLM backend.

**Before:** Fireflies transcript → manual download → Claude chat → iterative workshopping → Workfront submission. The workshopping phase took hours per blog.

**After:** Fireflies transcript → `pullTranscript` → `processTranscript` → select outline → `generateDraft` (5-stage pipeline) → review → `prepWorkfront` + `generateSocialPosts`.

## Architecture

```
src/
├── index.ts                    # 6 worker tools
├── lib/
│   ├── claude.ts               # Anthropic SDK wrapper (Opus 4.6, temp 0.4)
│   └── writing-rules.ts        # Dell/NVIDIA rules, banned words/phrases
├── prompts/
│   ├── personas.ts             # 5 personas: Researcher, Writer, 3 sub-editors
│   └── social-personas.ts      # 4 social post personas + orchestrator
└── reference/
    └── voice-profile.json      # JP Miller style rules (placeholder — needs real samples)
```

## The 6 Tools

### 1. `pullTranscript`
Fetches a meeting transcript from Fireflies.ai via GraphQL API.
- Input: `transcriptId` (optional — defaults to most recent)
- Output: Formatted transcript with speaker labels, summary, keywords

### 2. `processTranscript`
Researcher persona analyzes a transcript for blog potential.
- Input: `transcript`, optional `blogType`, `subjectName`
- Output: Human interest moments, conflict-resolution arc, candidate quotes, themes, 2-3 blog angle outlines
- **Next step:** You review the output and select/modify an outline before passing to `generateDraft`

### 3. `generateDraft` (THE CORE)
5-stage chained Claude pipeline producing near-final blog posts.
- Input: `transcript`, optional `outline`, `subjectName`, `blogType`, `ctaFocus`
- Pipeline: Researcher → Writer → Mechanical Editor → Voice & Rhythm Editor → Final Editor
- Output: Publication-ready blog + editorial notes

The 5 stages:
1. **Researcher** — extracts story foundation from transcript
2. **Writer** — writes 600-750 word draft using research + outline
3. **Mechanical Editor** — deterministic rule enforcement (banned words, AP Style, quote count, em dashes)
4. **Voice & Rhythm Editor** — applies JP Miller cadence, removes AIisms, enforces stochastic rhythm
5. **Final Editor** — story flow, thesis progression, quote verification, corporate contamination check

### 4. `prepWorkfront`
Generates Workfront submission metadata from a **final approved** blog.
- Input: `blogPost` (final copy only)
- Output: 2 blog page teasers (~130 chars), TL;DR summary, target audience (primary + secondary)

### 5. `generateSocialPosts`
Creates 4 standalone LinkedIn posts from distinct personas.
- Input: `blogPost`, optional `subjectName`, `subjectRole`
- Output: 4 posts from Author (JP Miller), Marketing Support, SME, and Third-Party Observer

### 6. `researchSME`
Background briefing on a subject matter expert.
- Input: `smeName`, optional `smeRole`, `transcript`, `additionalContext`
- Output: Professional profile focused on authentic details for blog writing

## Environment Variables

Set these before deploying:

```bash
ntn workers env set ANTHROPIC_API_KEY <your-key>
ntn workers env set FIREFLIES_API_KEY <your-key>
```

For local testing, create a `.env` file in the project root (auto-loaded by `ntn workers exec --local`).

## Typical Workflow

```bash
# 1. Pull latest transcript
ntn workers exec pullTranscript --local

# 2. Analyze it (copy transcript text from step 1)
ntn workers exec processTranscript --local -d '{"transcript": "...", "subjectName": "Jane Doe"}'

# 3. Review the output, pick/modify an outline, then generate
ntn workers exec generateDraft --local -d '{"transcript": "...", "outline": "...", "subjectName": "Jane Doe"}'

# 4. Review the draft. When finalized:
ntn workers exec prepWorkfront --local -d '{"blogPost": "..."}'
ntn workers exec generateSocialPosts --local -d '{"blogPost": "...", "subjectName": "Jane Doe", "subjectRole": "VFX Supervisor at ILM"}'
```

## Voice Profile — How to Populate

The file `src/reference/voice-profile.json` ships with placeholder style rules. To calibrate it to your actual writing:

1. Create a `reference/samples/` folder
2. Add 3-5 of your best published blog posts as `.txt` or `.md` files
3. Use Claude to extract style patterns: sentence length distribution, paragraph rhythm, word choice tendencies, opening/closing patterns
4. Update `voice-profile.json` with concrete, actionable directives (not vague descriptions)
5. Rebuild: `npm run build`

The voice profile is rules only — no blog content enters the prompts at runtime.

## Key Design Decisions

- **Writer, not Storyteller:** Renamed to reflect the actual job — writing from research, not discovering the story
- **3 sub-editors instead of 1:** Mechanical (rules), Voice (cadence), Final (story). Prevents one editor from regressing another's fixes
- **prepWorkfront decoupled:** Only runs on final copy. 2 teasers for blog page clicks, not 10 social posts
- **4 social personas:** Author, Marketing, SME, Third-Party — each a standalone LinkedIn post, not a teaser
- **Voice profile as rules:** Style directives extracted from samples, not example content fed to prompts
- **All properties use `.nullable()`:** The SDK requires all schema properties in `required`. Optional fields use `nullable()` (anyOf with null type) per SDK conventions

## Source of Truth

The persona prompts are distilled from `blog-generation-tool-v2`. That repo remains the authoritative reference for:
- Full persona definitions (14 personas)
- Writing rules (781 lines in `rules/writing-rules.json`)
- Editorial protocols and validation frameworks
- Workflow phase definitions

This worker system distills that knowledge into 5 focused personas optimized for single-pass execution with Opus 4.6.
