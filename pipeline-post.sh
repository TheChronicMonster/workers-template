#!/usr/bin/env bash
set -euo pipefail

# Blog Generation Pipeline — Post-Production Stage
# Usage: ./pipeline-post.sh [subject_name] [subject_role]
#
# Requires: output/04-draft.md (finalized blog post)
# Generates: Workfront package + 4 social posts

OUTPUT_DIR="output"
LOCAL_FLAG="--local"

SUBJECT_NAME="${1:-}"
SUBJECT_ROLE="${2:-}"

if [ ! -f "$OUTPUT_DIR/04-draft.md" ]; then
  echo "Error: $OUTPUT_DIR/04-draft.md not found. Run pipeline-draft.sh first."
  exit 1
fi

BLOG=$(cat "$OUTPUT_DIR/04-draft.md")
BLOG_JSON=$(printf '%s' "$BLOG" | python3 -c 'import json,sys; print(json.dumps(sys.stdin.read()))')

SUBJECT_JSON="null"
if [ -n "$SUBJECT_NAME" ]; then
  SUBJECT_JSON=$(printf '%s' "$SUBJECT_NAME" | python3 -c 'import json,sys; print(json.dumps(sys.stdin.read()))')
fi

ROLE_JSON="null"
if [ -n "$SUBJECT_ROLE" ]; then
  ROLE_JSON=$(printf '%s' "$SUBJECT_ROLE" | python3 -c 'import json,sys; print(json.dumps(sys.stdin.read()))')
fi

echo "=== Stage 4a: Prep Workfront ==="
ntn workers exec prepWorkfront $LOCAL_FLAG \
  -d "{\"blogPost\": $BLOG_JSON, \"subjectName\": $SUBJECT_JSON}" \
  > "$OUTPUT_DIR/05-workfront.md"
python3 prettify-files.py "$OUTPUT_DIR/05-workfront.md"
echo ""

echo "=== Stage 4b: Generate Social Posts ==="
ntn workers exec generateSocialPosts $LOCAL_FLAG \
  -d "{\"blogPost\": $BLOG_JSON, \"subjectName\": $SUBJECT_JSON, \"subjectRole\": $ROLE_JSON}" \
  > "$OUTPUT_DIR/06-social-posts.md"
python3 prettify-files.py "$OUTPUT_DIR/06-social-posts.md"
echo ""

echo "============================================"
echo "All outputs in $OUTPUT_DIR/:"
echo "  01-transcript.md    — Raw transcript"
echo "  02-research.md      — Researcher analysis"
echo "  03-outline.md       — Your chosen outline (if created)"
echo "  04-draft.md         — Final blog post"
echo "  05-workfront.md     — Teasers + TL;DR + audience"
echo "  06-social-posts.md  — 4 LinkedIn posts"
echo "============================================"
