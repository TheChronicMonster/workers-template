#!/usr/bin/env bash
set -euo pipefail

# Blog Generation Pipeline — Revision Stage
# Usage: ./pipeline-revise.sh [subject_name]
#
# Requires: output/04-draft.md (or latest 04-draft-vN.md)
# Requires: output/draft-feedback.md (your revision notes)
# Optional: output/01-transcript.md (for quote verification)
#
# Versioning: Each run creates the next version (04-draft-v2.md, 04-draft-v3.md, ...)
# Run as many times as needed. When satisfied, run pipeline-post.sh.

OUTPUT_DIR="output"
LOCAL_FLAG="--local"

SUBJECT_NAME="${1:-}"

# --- Find the latest draft version ---
LATEST_DRAFT=""
LATEST_VERSION=1

if [ -f "$OUTPUT_DIR/04-draft.md" ]; then
  LATEST_DRAFT="$OUTPUT_DIR/04-draft.md"
fi

# Check for versioned drafts (04-draft-v2.md, 04-draft-v3.md, ...)
for f in "$OUTPUT_DIR"/04-draft-v*.md; do
  [ -f "$f" ] || continue
  # Extract version number
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

# --- Check for feedback file ---
FEEDBACK_FILE="$OUTPUT_DIR/draft-feedback.md"
if [ ! -f "$FEEDBACK_FILE" ]; then
  echo "Error: $FEEDBACK_FILE not found."
  echo ""
  echo "Create this file with your revision notes, e.g.:"
  echo "  - Strengthen the opening — ground it in a specific moment"
  echo "  - The third quote feels generic, replace with something more vivid"
  echo "  - Tighten the conclusion, it repeats the intro"
  echo ""
  echo "Then run this script again."
  exit 1
fi

echo "Reading draft: $LATEST_DRAFT (version $LATEST_VERSION)"
echo "Reading feedback: $FEEDBACK_FILE"
echo "Will write: $NEXT_DRAFT (version $NEXT_VERSION)"
echo ""

# --- Build JSON payloads ---
DRAFT=$(cat "$LATEST_DRAFT")
DRAFT_JSON=$(printf '%s' "$DRAFT" | python3 -c 'import json,sys; print(json.dumps(sys.stdin.read()))')

FEEDBACK=$(cat "$FEEDBACK_FILE")
FEEDBACK_JSON=$(printf '%s' "$FEEDBACK" | python3 -c 'import json,sys; print(json.dumps(sys.stdin.read()))')

TRANSCRIPT_JSON="null"
if [ -f "$OUTPUT_DIR/01-transcript.md" ]; then
  TRANSCRIPT=$(cat "$OUTPUT_DIR/01-transcript.md")
  TRANSCRIPT_JSON=$(printf '%s' "$TRANSCRIPT" | python3 -c 'import json,sys; print(json.dumps(sys.stdin.read()))')
  echo "Including transcript for quote verification."
fi

echo ""
echo "=== Revision Pass (v${LATEST_VERSION} → v${NEXT_VERSION}) ==="
echo ""

ntn workers exec reviseDraft $LOCAL_FLAG \
  -d "{\"draft\": $DRAFT_JSON, \"feedback\": $FEEDBACK_JSON, \"transcript\": $TRANSCRIPT_JSON}" \
  > "$NEXT_DRAFT"
python3 prettify-files.py "$NEXT_DRAFT"

echo ""
echo "============================================"
echo "Revised draft: $NEXT_DRAFT"
echo ""
echo "To revise again: update $FEEDBACK_FILE, then run:"
echo "  ./pipeline-revise.sh${SUBJECT_NAME:+ $SUBJECT_NAME}"
echo ""
echo "When finalized, run: ./pipeline-post.sh${SUBJECT_NAME:+ $SUBJECT_NAME} [subject_role]"
echo "  (pipeline-post.sh reads 04-draft.md by default —"
echo "   copy your final version: cp $NEXT_DRAFT $OUTPUT_DIR/04-draft.md)"
echo "============================================"
