#!/usr/bin/env bash
set -euo pipefail

# Blog Generation Pipeline
# Usage: ./pipeline.sh [transcript_id]
#
# Runs the full pipeline: pull → process → (pause for outline review) → generate draft
# Each stage saves output to output/ so you can review between steps.
# Run with --local flag for local execution (uses .env for API keys).

TRANSCRIPT_ID="${1:-}"
OUTPUT_DIR="output"
LOCAL_FLAG="--local"

mkdir -p "$OUTPUT_DIR"

echo "=== Stage 1: Pull Transcript ==="
if [ -n "$TRANSCRIPT_ID" ]; then
  ntn workers exec pullTranscript $LOCAL_FLAG \
    -d "{\"transcriptId\": \"$TRANSCRIPT_ID\"}" \
    > "$OUTPUT_DIR/01-transcript.txt"
else
  ntn workers exec pullTranscript $LOCAL_FLAG \
    -d '{"transcriptId": null}' \
    > "$OUTPUT_DIR/01-transcript.txt"
fi
echo "Transcript saved to $OUTPUT_DIR/01-transcript.txt"
echo ""

echo "=== Stage 2: Process Transcript ==="
TRANSCRIPT=$(cat "$OUTPUT_DIR/01-transcript.txt")
# Escape for JSON
TRANSCRIPT_JSON=$(printf '%s' "$TRANSCRIPT" | python3 -c 'import json,sys; print(json.dumps(sys.stdin.read()))')

SUBJECT_NAME="${2:-}"
if [ -n "$SUBJECT_NAME" ]; then
  SUBJECT_JSON=$(printf '%s' "$SUBJECT_NAME" | python3 -c 'import json,sys; print(json.dumps(sys.stdin.read()))')
  ntn workers exec processTranscript $LOCAL_FLAG \
    -d "{\"transcript\": $TRANSCRIPT_JSON, \"subjectName\": $SUBJECT_JSON, \"blogType\": null}" \
    > "$OUTPUT_DIR/02-research.txt"
else
  ntn workers exec processTranscript $LOCAL_FLAG \
    -d "{\"transcript\": $TRANSCRIPT_JSON, \"blogType\": null, \"subjectName\": null}" \
    > "$OUTPUT_DIR/02-research.txt"
fi
echo "Research saved to $OUTPUT_DIR/02-research.txt"
echo ""

echo "============================================"
echo "PAUSE: Review the research output and blog angle suggestions."
echo "  File: $OUTPUT_DIR/02-research.txt"
echo ""
echo "To continue, create/edit $OUTPUT_DIR/03-outline.txt with your chosen outline,"
echo "then run: ./pipeline-draft.sh [subject_name] [cta_focus]"
echo "============================================"
