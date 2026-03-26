# Handoff: Notion MCP Skills for Blog Pipeline

## For the next agent working in `devdocsorg/claude-devdocs`

This document contains everything you need to implement two Claude Code skills that save blog pipeline artifacts to Notion via MCP — no Notion API key required.

## Background

The `TheChronicMonster/workers-template` repo has 9 Notion Worker tools that generate Dell/NVIDIA blog content (transcripts, research, drafts, social posts, etc.). These tools run locally via `ntn workers exec --local` and write their output to `output/*.md` files.

The tools also include `withNotionSave()` logic that can write directly to Notion using the SDK's built-in `{ notion }` client, but that requires a `NOTION_API_TOKEN` which isn't available. So `withNotionSave()` silently no-ops when the token is missing.

**The gap:** We need a way to save pipeline output to Notion without an API key.

**The solution:** Notion's hosted MCP server (`https://mcp.notion.com/mcp`) authenticates via OAuth in the browser — no API key needed. Claude Code skills use MCP tools to read/write Notion. The workers-template already has `.mcp.json` configured:

```json
{
  "mcpServers": {
    "notion": {
      "type": "http",
      "url": "https://mcp.notion.com/mcp"
    }
  }
}
```

## What to Build

Two Claude Code skills (`.claude/commands/*.md` files) in the `claude-devdocs` repo:

### Skill 1: `/save-to-notion`

**Purpose:** Read pipeline output files and save them to the Notion task board.

**Usage:** `/save-to-notion Child mind 3`

**Behavior:**

1. **Find or create the blog task** in the Notion database:
   - Database ID: `a820fe92f9bc4ea3bf9b8a350689c057`
   - Search for an existing entry where **Codename** equals the subject name argument
   - Use `notion-search` or `notion-query-data-sources` with a filter on the Codename property
   - If found: use that page ID
   - If not found: create a new entry with these properties:

   | Property | Type | Value |
   |---|---|---|
   | Blog name | title | `$ARGUMENTS` (the subject name) |
   | Codename | rich_text | `$ARGUMENTS` |
   | Request date | date | today's date |
   | Deadline | date | one week from today |
   | Assignee | people | JP Miller (look up via `notion-get-users`) |
   | Dell Owner | people | Logan Lawler (look up via `notion-get-users`) |
   | OneDrive URL | url | leave blank |
   | Interview date | date | leave blank |
   | Fireflies meet | url | leave blank |
   | Publication date | date | leave blank |
   | Publication URL | url | leave blank |

2. **Save each artifact as a sub-page** under the blog task:
   - Read each file from `output/` (if it exists)
   - Create a sub-page with the file content as markdown

   | File | Sub-page Title |
   |---|---|
   | `output/01-transcript.md` | Transcript |
   | `output/02-research.md` | Research & Analysis |
   | `output/04-draft.md` (or latest `04-draft-v*.md`) | Blog Draft |
   | `output/05-workfront.md` | Workfront Package |
   | `output/06-social-posts.md` | Social Media Posts |

   For versioned drafts (`04-draft-v2.md`, `04-draft-v3.md`), use the highest version number.

3. **Report results:** List which artifacts were saved and link to the Notion task.

### Skill 2: `/blog`

**Purpose:** Run the full blog generation pipeline AND save to Notion in one command.

**Usage:** `/blog 01KH4R5NCAW3Z5V1D2DG159HCV "Child mind 3"`

**Behavior:**

1. **Pull transcript:**
   ```bash
   ntn workers exec pullTranscript --local \
     -d '{"transcriptId": "<transcript_id>", "subjectName": null}'
   ```
   Save output to `output/01-transcript.md`.

2. **Process transcript:**
   ```bash
   ntn workers exec processTranscript --local \
     -d '{"transcript": "<content>", "subjectName": null, "blogType": null}'
   ```
   Save output to `output/02-research.md`.

3. **PAUSE — present research to user:**
   Show the research output (blog angle pitches). Ask which angle to pursue. Let the user edit/refine the outline.

4. **Generate draft** (after user picks an outline):
   ```bash
   ntn workers exec generateDraft --local \
     -d '{"transcript": "<content>", "outline": "<selected_outline>", "subjectName": null, "blogType": null, "ctaFocus": "combined"}'
   ```
   Save output to `output/04-draft.md`.

5. **Review checkpoint:** Show the draft. Ask if the user wants to revise, run an editorial session, or proceed to post-production.

6. **Post-production** (when user approves):
   ```bash
   ntn workers exec prepWorkfront --local \
     -d '{"blogPost": "<draft>", "subjectName": null}'
   ```
   ```bash
   ntn workers exec generateSocialPosts --local \
     -d '{"blogPost": "<draft>", "subjectName": null, "subjectRole": null}'
   ```

7. **Save everything to Notion** — same logic as `/save-to-notion`.

**Important:** All `ntn workers exec` calls use `--local` and set `"subjectName": null` (since Notion saves are handled by the skill via MCP, not by the worker tools directly). The `subjectName` field is required in the schema but `null` skips the built-in Notion save.

## Notion MCP Tools Reference

The MCP server provides these tools (the ones relevant to our use case):

| Tool | Purpose | Key Parameters |
|---|---|---|
| `notion-search` | Find pages/databases by text | query string |
| `notion-query-data-sources` | Query database with property filters | database_id, filter |
| `notion-create-pages` | Create page(s) with properties + content | parent, properties, content (markdown) |
| `notion-update-page` | Modify page properties or content | page_id, properties |
| `notion-get-users` | List workspace members | (none) |
| `notion-fetch` | Read page content | page_id or url |

### Creating a database entry

Use `notion-create-pages` with:
- `parent`: the database ID (`a820fe92f9bc4ea3bf9b8a350689c057`)
- `properties`: object with property name → value mappings
- Property types follow Notion API format:
  - Title: `{"title": [{"text": {"content": "value"}}]}`
  - Rich text: `{"rich_text": [{"text": {"content": "value"}}]}`
  - Date: `{"date": {"start": "2026-03-26"}}`
  - People: `{"people": [{"id": "<user_id>"}]}`
  - URL: `{"url": "https://..."}`

### Creating a sub-page

Use `notion-create-pages` with:
- `parent`: the blog task's page ID (not the database ID)
- `properties`: just a title
- Content: pass the markdown content directly — the MCP server handles block conversion

### Querying by property

Use `notion-query-data-sources` with a filter:
```json
{
  "database_id": "a820fe92f9bc4ea3bf9b8a350689c057",
  "filter": {
    "property": "Codename",
    "rich_text": { "equals": "Child mind 3" }
  }
}
```

## Pipeline Shell Scripts (for reference)

The existing pipeline scripts in `workers-template/` are:

| Script | Purpose | Arguments |
|---|---|---|
| `pipeline.sh` | Pull transcript + research | `[transcript_id] [subject_name]` |
| `pipeline-draft.sh` | Generate 5-stage draft | `[subject_name] [cta_focus]` |
| `pipeline-revise.sh` | Revise from feedback + validate | `[subject_name]` |
| `pipeline-editorial.sh` | Writer-editor conversation loop | `[subject_name] [direction]` |
| `pipeline-post.sh` | Workfront + social posts | `[subject_name] [subject_role]` |

The `/blog` skill replaces all of these with an interactive Claude Code session.

## Output File Structure

After a pipeline run, `output/` contains:

```
output/
├── 01-transcript.md          # Raw transcript with speaker labels
├── 02-research.md            # Story material, quotes, blog angle pitches
├── 03-outline.md             # User's chosen/edited outline (manual)
├── 04-draft.md               # Blog draft from 5-stage pipeline
├── 04-draft-v2.md            # Revised draft (if revised)
├── 04-draft-v3.md            # Further revision (if revised again)
├── 04-editorial-log-v*.md    # Editorial session logs (if editorial run)
├── 05-workfront.md           # Blog page teasers, TL;DR, audience
├── 06-social-posts.md        # 4 LinkedIn posts from 4 personas
└── draft-feedback.md         # Human revision notes (manual input)
```

## Testing

1. **MCP connection:** From Claude Code in the workers-template directory, ask Claude to search the Notion task board database. The OAuth flow should trigger in the browser on first use.

2. **`/save-to-notion` test:**
   - Run `./pipeline.sh "01KH4R5NCAW3Z5V1D2DG159HCV" "Test subject"` first to generate output files
   - Then run `/save-to-notion Test subject`
   - Verify in Notion: task created with correct properties, artifacts as sub-pages

3. **`/blog` test:**
   - Run `/blog 01KH4R5NCAW3Z5V1D2DG159HCV "Test subject 2"`
   - Walk through the interactive flow
   - Verify all artifacts land in Notion

## Notes

- The `.mcp.json` config is already in the workers-template repo root. If skills live in claude-devdocs, that repo will also need its own `.mcp.json` with the same Notion MCP config (or the user opens Claude Code from the workers-template directory).
- The `notion-query-data-sources` tool may require a Notion Business plan. If it's not available, fall back to `notion-search` with the codename as the query string, then filter results client-side.
- Rate limit: 180 requests/minute (3/second). A full pipeline save involves ~7-8 MCP calls (1 search + 1 create task + 5-6 sub-pages), well within limits.
- The worker tools still accept `subjectName` in their schemas (required but nullable). Always pass `null` when calling from the skill — the skill handles Notion writes via MCP instead.
