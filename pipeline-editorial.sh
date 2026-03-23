#!/usr/bin/env bash
set -euo pipefail

# Blog Generation Pipeline — Editorial Session
# Usage: ./pipeline-editorial.sh [subject_name] [direction]
#
# Requires: output/04-draft.md (or latest 04-draft-vN.md)
# Optional: output/01-transcript.md (for quote verification)
# Optional: output/02-research.md (research notes)
# Optional: subject_name — codename for Notion task tracking
# Optional: direction — focus area for the editor
#
# Flow:
#   1. Editorial Session (3 rounds of writer-editor conversation)
#   2. Python validator (deterministic) — runs on draft ONLY
#   3. IF violations → Mechanical Clean (fix flagged items)
#
# Output:
#   04-draft-vN.md          — the publishable draft (no editorial notes)
#   04-editorial-log-vN.md  — the full writer-editor conversation

OUTPUT_DIR="output"
LOCAL_FLAG="--local"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

SUBJECT_NAME="${1:-}"
DIRECTION="${2:-}"

# Build subject name JSON (used by all tools for Notion task tracking)
SUBJECT_JSON="null"
if [ -n "$SUBJECT_NAME" ]; then
  SUBJECT_JSON=$(printf '%s' "$SUBJECT_NAME" | python3 -c 'import json,sys; print(json.dumps(sys.stdin.read()))')
fi

# --- Find the latest draft version ---
LATEST_DRAFT=""
LATEST_VERSION=1

if [ -f "$OUTPUT_DIR/04-draft.md" ]; then
  LATEST_DRAFT="$OUTPUT_DIR/04-draft.md"
fi

for f in "$OUTPUT_DIR"/04-draft-v*.md; do
  [ -f "$f" ] || continue
  VERSION=$(echo "$f" | sed 's/.*04-draft-v\([0-9]*\)\.md/\1/')
  if [ "$VERSION" -gt "$LATEST_VERSION" ]; then
    LATEST_VERSION="$VERSION"
    LATEST_DRAFT="$f"
  fi
done

if [ -z "$LATEST_DRAFT" ]; then
  echo "Error: No draft found in $OUTPUT_DIR/. Run pipeline-draft.sh first."
  exit 1
fi

NEXT_VERSION=$((LATEST_VERSION + 1))
NEXT_DRAFT="$OUTPUT_DIR/04-draft-v${NEXT_VERSION}.md"
SESSION_LOG="$OUTPUT_DIR/04-editorial-log-v${NEXT_VERSION}.md"

echo "Reading draft: $LATEST_DRAFT (version $LATEST_VERSION)"
echo "Will write: $NEXT_DRAFT (version $NEXT_VERSION)"
echo ""

# --- Build JSON payloads ---
DRAFT=$(cat "$LATEST_DRAFT")
DRAFT_JSON=$(printf '%s' "$DRAFT" | python3 -c 'import json,sys; print(json.dumps(sys.stdin.read()))')

TRANSCRIPT_JSON="null"
if [ -f "$OUTPUT_DIR/01-transcript.md" ]; then
  TRANSCRIPT=$(cat "$OUTPUT_DIR/01-transcript.md")
  TRANSCRIPT_JSON=$(printf '%s' "$TRANSCRIPT" | python3 -c 'import json,sys; print(json.dumps(sys.stdin.read()))')
  echo "Including transcript for quote verification."
fi

RESEARCH_JSON="null"
if [ -f "$OUTPUT_DIR/02-research.md" ]; then
  RESEARCH=$(cat "$OUTPUT_DIR/02-research.md")
  RESEARCH_JSON=$(printf '%s' "$RESEARCH" | python3 -c 'import json,sys; print(json.dumps(sys.stdin.read()))')
  echo "Including research notes."
fi

DIRECTION_JSON="null"
if [ -n "$DIRECTION" ]; then
  DIRECTION_JSON=$(printf '%s' "$DIRECTION" | python3 -c 'import json,sys; print(json.dumps(sys.stdin.read()))')
  echo "Editor direction: $DIRECTION"
fi

# ── STAGE 1: Editorial Session (writer-editor conversation) ──
echo ""
echo "=== Stage 1: Editorial Session (up to 3 rounds) ==="
echo ""

RAW_OUTPUT=$(ntn workers exec editorialSession $LOCAL_FLAG \
  -d "{\"draft\": $DRAFT_JSON, \"transcript\": $TRANSCRIPT_JSON, \"research\": $RESEARCH_JSON, \"direction\": $DIRECTION_JSON, \"subjectName\": $SUBJECT_JSON}")

# --- Split output into draft and session log ---
# Extract content between XML-style markers
python3 -c "
import sys, json

raw = sys.stdin.read().strip()

# Decode JSON-escaped string if needed (ntn workers exec may wrap output in quotes)
try:
    decoded = json.loads(raw)
    if isinstance(decoded, str):
        raw = decoded
except (json.JSONDecodeError, ValueError):
    # Try manual unescaping if it looks JSON-wrapped
    if raw.startswith('\"') and raw.endswith('\"'):
        raw = raw[1:-1]
    raw = raw.replace('\\\\n', '\n').replace('\\\\t', '\t').replace('\\\\\"', '\"')

draft_start = raw.find('<EDITORIAL_SESSION_DRAFT>')
draft_end = raw.find('</EDITORIAL_SESSION_DRAFT>')
log_start = raw.find('<EDITORIAL_SESSION_LOG>')
log_end = raw.find('</EDITORIAL_SESSION_LOG>')

if draft_start == -1 or draft_end == -1:
    # Fallback: no markers found, treat entire output as draft
    print(raw, end='')
    sys.exit(0)

draft = raw[draft_start + len('<EDITORIAL_SESSION_DRAFT>'):draft_end].strip()
print(draft, end='')

if log_start != -1 and log_end != -1:
    log = raw[log_start + len('<EDITORIAL_SESSION_LOG>'):log_end].strip()
    with open('${SESSION_LOG}', 'w') as f:
        f.write(log + '\n')
" <<< "$RAW_OUTPUT" > "$NEXT_DRAFT"

python3 prettify-files.py "$NEXT_DRAFT"
if [ -f "$SESSION_LOG" ]; then
  python3 prettify-files.py "$SESSION_LOG"
  echo "  Session log saved: $SESSION_LOG"
fi

# ── STAGE 2: Python Validator (deterministic) — draft only ──
echo ""
echo "=== Stage 2: Python Validation (draft only) ==="

VALIDATION_REPORT=""
VALIDATION_EXIT=0
VALIDATION_REPORT=$(python3 "$SCRIPT_DIR/validate-draft.py" "$NEXT_DRAFT" 2>&1) || VALIDATION_EXIT=$?

if [ "$VALIDATION_EXIT" -eq 0 ]; then
  echo "  [PASS] No violations found."
else
  echo "$VALIDATION_REPORT"
  echo ""

  # ── STAGE 3: Mechanical Clean ──
  echo "=== Stage 3: Mechanical Clean (fixing flagged violations) ==="
  echo ""

  REVISED=$(cat "$NEXT_DRAFT")
  REVISED_JSON=$(printf '%s' "$REVISED" | python3 -c 'import json,sys; print(json.dumps(sys.stdin.read()))')
  REPORT_JSON=$(printf '%s' "$VALIDATION_REPORT" | python3 -c 'import json,sys; print(json.dumps(sys.stdin.read()))')

  ntn workers exec mechanicalClean $LOCAL_FLAG \
    -d "{\"draft\": $REVISED_JSON, \"violationReport\": $REPORT_JSON, \"subjectName\": $SUBJECT_JSON}" \
    > "$NEXT_DRAFT"
  python3 prettify-files.py "$NEXT_DRAFT"

  # Re-validate
  echo ""
  echo "=== Re-validating after mechanical clean ==="
  REVALIDATION=""
  REVAL_EXIT=0
  REVALIDATION=$(python3 "$SCRIPT_DIR/validate-draft.py" "$NEXT_DRAFT" 2>&1) || REVAL_EXIT=$?

  if [ "$REVAL_EXIT" -eq 0 ]; then
    echo "  [PASS] All violations resolved."
  else
    echo "$REVALIDATION"
    echo ""
    echo "  [NOTE] Some violations remain. Review the draft and revise again if needed."
  fi
fi

echo ""
echo "============================================"
echo "Draft:       $NEXT_DRAFT"
echo "Session log: $SESSION_LOG"
echo ""
echo "To run another editorial session:"
echo "  ./pipeline-editorial.sh${SUBJECT_NAME:+ \"$SUBJECT_NAME\"} \"focus on opening and quote selection\""
echo ""
echo "To do a targeted revision instead:"
echo "  Update $OUTPUT_DIR/draft-feedback.md, then: ./pipeline-revise.sh${SUBJECT_NAME:+ \"$SUBJECT_NAME\"}"
echo ""
echo "When finalized: cp $NEXT_DRAFT $OUTPUT_DIR/04-draft.md"
echo "Then: ./pipeline-post.sh${SUBJECT_NAME:+ \"$SUBJECT_NAME\"} [subject_role]"
echo "============================================"
