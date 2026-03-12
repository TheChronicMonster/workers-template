#!/usr/bin/env bash
set -euo pipefail

# Blog Generation Pipeline — Post-Production Stage
# Usage: ./pipeline-post.sh [subject_name] [subject_role]
#
# Requires: output/04-draft.txt (finalized blog post)
# Generates: Workfront package + 4 social posts

OUTPUT_DIR="output"
LOCAL_FLAG="--local"

prettify() {
  python3 << 'PYEOF'
import sys, json
data = sys.stdin.read().strip()
try:
    decoded = json.loads(data)
    if isinstance(decoded, str):
        print(decoded)
    else:
        print(data)
except (json.JSONDecodeError, ValueError):
    if data.startswith('"') and data.endswith('"'):
        data = data[1:-1]
    data = data.replace('\\n', '\n').replace('\\t', '\t').replace('\\"', '"')
    print(data)
PYEOF
}

SUBJECT_NAME="${1:-}"
SUBJECT_ROLE="${2:-}"

if [ ! -f "$OUTPUT_DIR/04-draft.txt" ]; then
  echo "Error: $OUTPUT_DIR/04-draft.txt not found. Run pipeline-draft.sh first."
  exit 1
fi

BLOG=$(cat "$OUTPUT_DIR/04-draft.txt")
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
  -d "{\"blogPost\": $BLOG_JSON}" \
  | prettify > "$OUTPUT_DIR/05-workfront.txt"
echo "Workfront package saved to $OUTPUT_DIR/05-workfront.txt"
echo ""

echo "=== Stage 4b: Generate Social Posts ==="
ntn workers exec generateSocialPosts $LOCAL_FLAG \
  -d "{\"blogPost\": $BLOG_JSON, \"subjectName\": $SUBJECT_JSON, \"subjectRole\": $ROLE_JSON}" \
  | prettify > "$OUTPUT_DIR/06-social-posts.txt"
echo "Social posts saved to $OUTPUT_DIR/06-social-posts.txt"
echo ""

echo "============================================"
echo "All outputs in $OUTPUT_DIR/:"
echo "  01-transcript.txt    — Raw transcript"
echo "  02-research.txt      — Researcher analysis"
echo "  03-outline.txt       — Your chosen outline (if created)"
echo "  04-draft.txt         — Final blog post"
echo "  05-workfront.txt     — Teasers + TL;DR + audience"
echo "  06-social-posts.txt  — 4 LinkedIn posts"
echo "============================================"
