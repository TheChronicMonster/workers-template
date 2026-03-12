#!/usr/bin/env bash
set -euo pipefail

# Blog Generation Pipeline
# Usage: ./pipeline.sh [transcript_id] [subject_name]
#
# Runs: pull transcript → process with researcher → pause for outline review
# Each stage saves to output/. Prettified automatically.

TRANSCRIPT_ID="${1:-}"
OUTPUT_DIR="output"
LOCAL_FLAG="--local"

mkdir -p "$OUTPUT_DIR"

echo "=== Stage 1: Pull Transcript ==="
if [ -n "$TRANSCRIPT_ID" ]; then
  ntn workers exec pullTranscript $LOCAL_FLAG \
    -d "{\"transcriptId\": \"$TRANSCRIPT_ID\"}" \
    > "$OUTPUT_DIR/01-transcript.md"
else
  ntn workers exec pullTranscript $LOCAL_FLAG \
    -d '{"transcriptId": null}' \
    > "$OUTPUT_DIR/01-transcript.md"
fi
python3 prettify-files.py "$OUTPUT_DIR/01-transcript.md"
echo ""

echo "=== Stage 2: Process Transcript ==="
TRANSCRIPT=$(cat "$OUTPUT_DIR/01-transcript.md")
TRANSCRIPT_JSON=$(printf '%s' "$TRANSCRIPT" | python3 -c 'import json,sys; print(json.dumps(sys.stdin.read()))')

SUBJECT_NAME="${2:-}"
if [ -n "$SUBJECT_NAME" ]; then
  SUBJECT_JSON=$(printf '%s' "$SUBJECT_NAME" | python3 -c 'import json,sys; print(json.dumps(sys.stdin.read()))')
  ntn workers exec processTranscript $LOCAL_FLAG \
    -d "{\"transcript\": $TRANSCRIPT_JSON, \"subjectName\": $SUBJECT_JSON, \"blogType\": null}" \
    > "$OUTPUT_DIR/02-research.md"
else
  ntn workers exec processTranscript $LOCAL_FLAG \
    -d "{\"transcript\": $TRANSCRIPT_JSON, \"blogType\": null, \"subjectName\": null}" \
    > "$OUTPUT_DIR/02-research.md"
fi
python3 prettify-files.py "$OUTPUT_DIR/02-research.md"
echo ""

echo "============================================"
echo "PAUSE: Review the research output and blog angle suggestions."
echo "  File: $OUTPUT_DIR/02-research.md"
echo ""
echo "To continue, create/edit $OUTPUT_DIR/03-outline.md with your chosen outline,"
echo "then run: ./pipeline-draft.sh [subject_name] [cta_focus]"
echo "============================================"
