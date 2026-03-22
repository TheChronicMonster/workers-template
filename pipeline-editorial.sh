#!/usr/bin/env bash
set -euo pipefail

# Blog Generation Pipeline — Editorial Session
# Usage: ./pipeline-editorial.sh [direction]
#
# Requires: output/04-draft.md (or latest 04-draft-vN.md)
# Optional: output/01-transcript.md (for quote verification)
# Optional: output/02-research.md (research notes)
# Optional: direction argument — focus area for the editor
#
# Flow:
#   1. Editorial Session (3 rounds of writer-editor conversation)
#   2. Python validator (deterministic)
#   3. IF violations → Mechanical Clean (fix flagged items)
#
# Creates the next version (04-draft-vN.md) like pipeline-revise.sh.

OUTPUT_DIR="output"
LOCAL_FLAG="--local"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

DIRECTION="${1:-}"

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

ntn workers exec editorialSession $LOCAL_FLAG \
  -d "{\"draft\": $DRAFT_JSON, \"transcript\": $TRANSCRIPT_JSON, \"research\": $RESEARCH_JSON, \"direction\": $DIRECTION_JSON}" \
  > "$NEXT_DRAFT"
python3 prettify-files.py "$NEXT_DRAFT"

# ── STAGE 2: Python Validator (deterministic) ──
echo ""
echo "=== Stage 2: Python Validation ==="

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
    -d "{\"draft\": $REVISED_JSON, \"violationReport\": $REPORT_JSON}" \
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
echo "Editorial session draft: $NEXT_DRAFT"
echo ""
echo "The editorial session log is appended to the draft file."
echo ""
echo "To run another editorial session:"
echo "  ./pipeline-editorial.sh \"focus on opening and quote selection\""
echo ""
echo "To do a targeted revision instead:"
echo "  Update $OUTPUT_DIR/draft-feedback.md, then: ./pipeline-revise.sh"
echo ""
echo "When finalized: cp $NEXT_DRAFT $OUTPUT_DIR/04-draft.md"
echo "Then: ./pipeline-post.sh [subject_name] [subject_role]"
echo "============================================"
