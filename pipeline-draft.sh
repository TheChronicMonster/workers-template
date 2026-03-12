#!/usr/bin/env bash
set -euo pipefail

# Blog Generation Pipeline — Draft Stage
# Usage: ./pipeline-draft.sh [subject_name] [cta_focus]
#
# Requires: output/01-transcript.txt (from pipeline.sh)
# Optional: output/03-outline.txt (your chosen/edited outline)
#
# cta_focus: "dell", "nvidia", or "combined" (default: "combined")

OUTPUT_DIR="output"
LOCAL_FLAG="--local"

SUBJECT_NAME="${1:-}"
CTA_FOCUS="${2:-combined}"

if [ ! -f "$OUTPUT_DIR/01-transcript.txt" ]; then
  echo "Error: $OUTPUT_DIR/01-transcript.txt not found. Run pipeline.sh first."
  exit 1
fi

# Read transcript
TRANSCRIPT=$(cat "$OUTPUT_DIR/01-transcript.txt")
TRANSCRIPT_JSON=$(printf '%s' "$TRANSCRIPT" | python3 -c 'import json,sys; print(json.dumps(sys.stdin.read()))')

# Read outline if it exists
OUTLINE_JSON="null"
if [ -f "$OUTPUT_DIR/03-outline.txt" ]; then
  OUTLINE=$(cat "$OUTPUT_DIR/03-outline.txt")
  OUTLINE_JSON=$(printf '%s' "$OUTLINE" | python3 -c 'import json,sys; print(json.dumps(sys.stdin.read()))')
  echo "Using outline from $OUTPUT_DIR/03-outline.txt"
else
  echo "No outline file found — system will choose the strongest angle from research."
fi

# Build subject name JSON
SUBJECT_JSON="null"
if [ -n "$SUBJECT_NAME" ]; then
  SUBJECT_JSON=$(printf '%s' "$SUBJECT_NAME" | python3 -c 'import json,sys; print(json.dumps(sys.stdin.read()))')
fi

CTA_JSON=$(printf '%s' "$CTA_FOCUS" | python3 -c 'import json,sys; print(json.dumps(sys.stdin.read()))')

echo ""
echo "=== Stage 3: Generate Draft (5-stage pipeline) ==="
echo "This will take a few minutes (5 Claude calls in sequence)..."
echo ""

ntn workers exec generateDraft $LOCAL_FLAG \
  -d "{\"transcript\": $TRANSCRIPT_JSON, \"outline\": $OUTLINE_JSON, \"subjectName\": $SUBJECT_JSON, \"blogType\": null, \"ctaFocus\": $CTA_JSON}" \
  > "$OUTPUT_DIR/04-draft.txt"

echo "Draft saved to $OUTPUT_DIR/04-draft.txt"
echo ""
echo "============================================"
echo "Review the draft in $OUTPUT_DIR/04-draft.txt"
echo ""
echo "When finalized, run: ./pipeline-post.sh [subject_name] [subject_role]"
echo "to generate Workfront package + social posts."
echo "============================================"
