# Review: Are We Using Notion Workers Naively?

## Context

The `workers-template` repo implements a Dell/NVIDIA blog generation pipeline as 9 Notion Worker tools (built on `@notionhq/workers`). These tools are attached to Notion Custom Agents, allowing an agent to call them during conversations. The `blog-generation-tool-v2` repo is a separate Python-based system with **no Notion integration** — it serves as the authoritative source for personas/rules that were distilled into the workers-template.

The core question: are we treating Notion Workers as generic cloud functions, missing the Notion-native capabilities the SDK provides?

## Answer: Yes — in three significant ways

### 1. The Notion Client Is Completely Unused (Biggest Miss)

Every `execute` handler receives a second argument: a context object containing an authenticated Notion SDK client (`{ notion }`). This is visible in the SDK's own examples:

```ts
// From .examples/tool-example.ts
execute: async (input, { notion: _notion }) => { ... }

// From .examples/automation-example.ts
execute: async (event, { notion }) => {
    await notion.pages.update({ page_id: pageId, ... });
}
```

**Our tools ignore this entirely.** All 9 tools in `src/index.ts` only destructure the first argument (input). None read from or write to Notion.

**What this means in practice:** The agent must copy/paste massive text blobs between tool calls. A transcript pulled by `pullTranscript` gets returned as a string, then the user/agent must manually pass that same string into `processTranscript`, then pass transcript + research into `generateDraft`, etc.

**What we could do instead:**
- `pullTranscript` → writes the transcript to a Notion page, returns a page ID
- `processTranscript` → reads transcript from Notion page, writes research/outlines to a Notion page
- `generateDraft` → reads transcript + outline from Notion, writes draft to a Notion page
- `prepWorkfront` / `generateSocialPosts` → reads final draft from Notion, writes deliverables to Notion
- `reviseDraft` → reads draft + feedback from Notion pages, writes revised draft back

This eliminates the "pass giant strings through the agent" pattern and makes artifacts persistent/reviewable in Notion.

### 2. `outputSchema` Is Not Used

The SDK supports `outputSchema` (visible in `.examples/tool-example.ts`), which defines a structured schema for tool return values. All 9 tools return unstructured strings.

**What we could do:**
- Return structured objects (e.g., `{ draft: string, editorialNotes: string, pipelineLog: string[], wordCount: number }`) so the Notion agent can parse and act on specific fields
- This is especially valuable for `processTranscript` (returning distinct angle pitches as an array) and `generateDraft` (separating the blog post from editorial notes and pipeline log)

### 3. No Notion-Native Workflow State

The pipeline has natural human-review checkpoints (after research, after draft, after revision). Currently these are just implicit pauses in the conversation. With the Notion client, tools could:
- Create/update a Notion database row tracking blog status (Research → Outline Review → Draft → Editorial Review → Approved)
- Write deliverables to specific Notion pages that the user can review/comment on natively in Notion
- Read human feedback from Notion page comments rather than requiring it as a tool input string

## What We Can't Use Yet (Private Alpha)

Per the SDK docs and `CLAUDE.md`:

| Capability | Status | Relevance |
|---|---|---|
| **Syncs** | Private alpha | Could auto-sync Fireflies transcripts into a Notion database on a schedule |
| **Automations** | Private alpha | Could trigger the pipeline automatically when a transcript page is created |
| **Notion-managed OAuth** | Private alpha | Not needed (we use API keys for Fireflies/Anthropic) |

These would be powerful additions when they become GA, but aren't available today.

## Recommended Changes

### Phase 1: Use the Notion Client for Artifact Storage
**Files to modify:** `src/index.ts`

For each tool's `execute` handler:
1. Accept the second `context` argument: `execute: async (input, { notion }) => { ... }`
2. Use `notion.pages.create()` to write outputs to Notion pages (transcripts, research, drafts, social posts)
3. Accept optional `pageId` inputs so tools can read from Notion pages instead of requiring raw text
4. Use `notion.pages.update()` to append editorial notes, revision history

Specific tool changes:
- **`pullTranscript`**: Add optional `notionPageId` param. If provided, write transcript to that Notion page. Return both the text and the page ID.
- **`processTranscript`**: Accept `transcriptPageId` as alternative to `transcript` string. Read from Notion if provided. Write research output to a new Notion page.
- **`generateDraft`**: Accept page IDs for transcript and outline. Write each pipeline stage's output to Notion (or at minimum the final draft). Return page ID of the draft.
- **`reviseDraft`**: Read draft from Notion page, read feedback from Notion page comments or a separate input page. Write revision back to same page as a new version.
- **`prepWorkfront` / `generateSocialPosts`**: Read final draft from Notion page. Write deliverables to Notion pages.

### Phase 2: Add `outputSchema` to All Tools
**Files to modify:** `src/index.ts`

Add structured output schemas so the Notion agent gets parseable responses:
- `pullTranscript` → `{ transcript: string, transcriptId: string, title: string, pageId?: string }`
- `processTranscript` → `{ angles: Array<{ title: string, outline: string, strength: string }>, quotes: Array<string>, storyMaterial: string, pageId?: string }`
- `generateDraft` → `{ draft: string, editorialNotes: string, pipelineLog: string[], wordCount: number, pageId?: string }`
- etc.

### Phase 3: Workflow Status Tracking (Optional, Database-Backed)
**Files to modify:** `src/index.ts`, potentially new `src/lib/notion-helpers.ts`

Create a Notion database for blog pipeline tracking:
- Each blog gets a row with status property, page links, timestamps
- Tools update the status as they complete their work
- Gives the team visibility into pipeline progress without leaving Notion

## Verification

1. `npm run check` — ensure TypeScript compiles with new context usage
2. `ntn workers exec <tool> --local` — test each tool locally with both string inputs and Notion page ID inputs
3. Verify that outputs appear correctly in Notion pages
4. Run the full pipeline end-to-end: `pullTranscript` → `processTranscript` → `generateDraft` → `prepWorkfront` + `generateSocialPosts`

## Critical Files

- `/home/user/workers-template/src/index.ts` — all 9 tool definitions (698 lines)
- `/home/user/workers-template/src/lib/claude.ts` — Anthropic SDK wrapper
- `/home/user/workers-template/.examples/tool-example.ts` — shows `outputSchema` and `{ notion }` context usage
- `/home/user/workers-template/.examples/automation-example.ts` — shows `notion.pages.update()` pattern
- `/home/user/workers-template/.agents/INSTRUCTIONS.md` — SDK reference
