#!/usr/bin/env python3
"""
Draft Validator — Deterministic compliance checks for blog drafts.

Consolidated from blog-generation-tool-v2 validators. Checks things
Python can verify without ambiguity: banned words, dashes, quote count,
title length, word count, and structural patterns.

Usage:
    python3 validate-draft.py <file>
    python3 validate-draft.py <file> --json

Exit codes:
    0 = clean (no violations)
    1 = violations found (details in stdout)
"""

import re
import json
import sys
import argparse
from typing import List, Dict, Tuple


# ---------------------------------------------------------------------------
# Banned words & phrases — mirrors src/lib/writing-rules.ts exactly
# ---------------------------------------------------------------------------

BANNED_WORDS = [
    "crucial", "ensuring", "critical", "optimized", "intensive", "featuring",
    "dramatically", "powerful", "groundbreaking", "robust", "key", "enhanced",
    "suddenly", "cutting-edge", "state-of-the-art", "next-generation",
    "unparalleled", "leading-edge", "best-in-class", "industry-leading",
    "world-class", "synergy", "leverage", "solution", "ecosystem",
    "game-changing", "pioneering", "visionary", "transformative", "transformed",
    "revolutionizing", "seamlessly", "partnership", "innovation",
    "reconceptualize", "demassification", "attitudinally", "judgmentally",
    "utilization", "ameliorate", "facilitate", "synergize", "paradigm",
    "optimize", "streamline", "innovate", "transform", "revolutionize",
]

BANNED_PHRASES = [
    "In conclusion", "To summarize", "As mentioned earlier",
    "As previously stated", "It is important to note that",
    "Keep in mind that", "One of the main advantages is",
    "One key aspect is", "This process can be broken down into steps",
    "This brings us to", "Moving forward, let's discuss",
    "Broadly speaking", "To better understand", "To put it simply",
    "A comprehensive approach", "A holistic view", "The key takeaway is",
    "It's not X—it's about Y", "From the X to the Y",
    "More than just X—they Y", "At the forefront of this change",
    "Particularly those in X", "for work on the go",
    "In today's rapidly evolving technological landscape",
    "Imagine this", "picture this", "get this",
    "In today's digital landscape", "The result speaks for itself",
    "enters the picture", "The screen flickered to life",
    "In the beginning", "Picture this", "Once upon a time",
    "The future of", "Welcome to the world of", "In a world where",
    "In this age of", "had no idea what was coming",
]

# ---------------------------------------------------------------------------
# Limits
# ---------------------------------------------------------------------------

TITLE_MAX_WORDS = 9
QUOTE_MAX = 5
WORD_COUNT_MIN = 600
WORD_COUNT_MAX = 900


# ---------------------------------------------------------------------------
# Checks
# ---------------------------------------------------------------------------

def find_title(content: str) -> Tuple[str, int]:
    """Return (title_text, line_number). Line number is 1-indexed."""
    for i, line in enumerate(content.splitlines(), 1):
        stripped = line.strip()
        if stripped:
            if stripped.startswith("#"):
                return re.sub(r"^#+\s*", "", stripped), i
            return stripped, i
    return "", 0


def check_title_length(content: str) -> List[Dict]:
    title, line = find_title(content)
    if not title:
        return []
    words = title.split()
    if len(words) > TITLE_MAX_WORDS:
        return [{
            "check": "title_length",
            "severity": "error",
            "line": line,
            "message": f"Title is {len(words)} words (max {TITLE_MAX_WORDS}): \"{title}\"",
        }]
    return []


def check_word_count(content: str) -> List[Dict]:
    # Strip markdown headers and pipeline log from count
    body = re.sub(r"^#.*$", "", content, flags=re.MULTILINE)
    body = re.split(r"---\s*\n##\s*(?:Pipeline Log|Final Editorial Notes|Revision Notes)", body)[0]
    words = body.split()
    count = len(words)
    violations = []
    if count < WORD_COUNT_MIN:
        violations.append({
            "check": "word_count",
            "severity": "warning",
            "line": 0,
            "message": f"Word count {count} is below minimum {WORD_COUNT_MIN}",
        })
    if count > WORD_COUNT_MAX:
        violations.append({
            "check": "word_count",
            "severity": "warning",
            "line": 0,
            "message": f"Word count {count} exceeds maximum {WORD_COUNT_MAX}",
        })
    return violations


def check_banned_words(content: str) -> List[Dict]:
    violations = []
    lines = content.splitlines()
    for line_num, line in enumerate(lines, 1):
        # Skip pipeline log / editorial notes sections
        if line.strip().startswith("---") or line.strip().startswith("## Pipeline Log"):
            break
        lower = line.lower()
        for word in BANNED_WORDS:
            pattern = r"\b" + re.escape(word.lower()) + r"\b"
            for match in re.finditer(pattern, lower):
                # Get surrounding context
                start = max(0, match.start() - 20)
                end = min(len(line), match.end() + 20)
                violations.append({
                    "check": "banned_word",
                    "severity": "error",
                    "line": line_num,
                    "message": f"Banned word \"{word}\" found",
                    "context": line[start:end].strip(),
                })
    return violations


def check_banned_phrases(content: str) -> List[Dict]:
    violations = []
    lines = content.splitlines()
    for line_num, line in enumerate(lines, 1):
        if line.strip().startswith("---") or line.strip().startswith("## Pipeline Log"):
            break
        lower = line.lower()
        for phrase in BANNED_PHRASES:
            if phrase.lower() in lower:
                violations.append({
                    "check": "banned_phrase",
                    "severity": "error",
                    "line": line_num,
                    "message": f"Banned phrase \"{phrase}\" found",
                    "context": line.strip()[:120],
                })
    return violations


def check_dashes(content: str) -> List[Dict]:
    """Check for em dashes, en dashes, and Unicode dash variants."""
    violations = []
    dash_patterns = [
        ("\u2014", "em dash"),       # —
        ("\u2013", "en dash"),       # –
        ("\u2015", "horizontal bar"),
        ("\u2212", "Unicode minus"),
        ("--", "double dash"),
    ]
    lines = content.splitlines()
    for line_num, line in enumerate(lines, 1):
        if line.strip().startswith("---"):
            continue  # Skip markdown horizontal rules and section dividers
        for char, name in dash_patterns:
            if char in line:
                idx = line.index(char)
                start = max(0, idx - 20)
                end = min(len(line), idx + len(char) + 20)
                violations.append({
                    "check": "dash",
                    "severity": "error",
                    "line": line_num,
                    "message": f"{name.capitalize()} found — restructure with periods or commas",
                    "context": line[start:end].strip(),
                })
    return violations


def extract_quotes(content: str) -> List[Tuple[str, int]]:
    """Extract direct quotes with line numbers."""
    quotes = []
    lines = content.splitlines()
    quote_patterns = [
        r'\u201c([^\u201d]+)\u201d',  # Smart double quotes ""
        r'"([^"]+)"',                  # Straight double quotes
    ]
    for line_num, line in enumerate(lines, 1):
        stripped = line.strip()
        if stripped.startswith("#") or not stripped:
            continue
        for pattern in quote_patterns:
            for match in re.finditer(pattern, line):
                text = match.group(1)
                if len(text.strip()) > 10:  # Filter short non-dialogue quotes
                    quotes.append((text, line_num))
    return quotes


def check_quote_count(content: str) -> List[Dict]:
    quotes = extract_quotes(content)
    violations = []
    if len(quotes) > QUOTE_MAX:
        violations.append({
            "check": "quote_count",
            "severity": "error",
            "line": 0,
            "message": f"Found {len(quotes)} quotes (max {QUOTE_MAX}). Excess quotes at lines: {', '.join(str(q[1]) for q in quotes[QUOTE_MAX:])}",
        })
    return violations


def check_say_then_quote(content: str) -> List[Dict]:
    """Detect 'X said: "..."' anti-pattern."""
    violations = []
    attribution_verbs = (
        "said|says|explained|noted|mentioned|commented|remarked|observed|"
        "stated|declared|responded|replied|added|continued|concluded|"
        "told|shared|revealed|admitted|announced|indicated"
    )
    pattern = rf'\w+\s+(?:{attribution_verbs})\s*[:.]?\s*["\u201c]'
    lines = content.splitlines()
    for line_num, line in enumerate(lines, 1):
        if re.search(pattern, line, re.IGNORECASE):
            violations.append({
                "check": "say_then_quote",
                "severity": "warning",
                "line": line_num,
                "message": "Say-then-quote anti-pattern detected — weave quote into narrative",
                "context": line.strip()[:120],
            })
    return violations


def check_duplicate_paragraph_openings(content: str) -> List[Dict]:
    """Check for paragraphs starting with the same two words."""
    violations = []
    openings: Dict[str, int] = {}
    lines = content.splitlines()

    for i, line in enumerate(lines):
        stripped = line.strip()
        if not stripped or stripped.startswith("#"):
            continue
        words = stripped.split()
        if len(words) >= 2:
            opening = " ".join(words[:2]).lower()
            if opening in openings:
                violations.append({
                    "check": "duplicate_opening",
                    "severity": "warning",
                    "line": i + 1,
                    "message": f"Duplicate paragraph opening \"{opening}\" (also at line {openings[opening]})",
                })
            else:
                openings[opening] = i + 1
    return violations


# ---------------------------------------------------------------------------
# Runner
# ---------------------------------------------------------------------------

ALL_CHECKS = [
    check_title_length,
    check_word_count,
    check_banned_words,
    check_banned_phrases,
    check_dashes,
    check_quote_count,
    check_say_then_quote,
    check_duplicate_paragraph_openings,
]


def validate(filepath: str) -> Dict:
    with open(filepath, "r", encoding="utf-8") as f:
        content = f.read()

    violations = []
    for check_fn in ALL_CHECKS:
        violations.extend(check_fn(content))

    errors = [v for v in violations if v["severity"] == "error"]
    warnings = [v for v in violations if v["severity"] == "warning"]

    return {
        "file": filepath,
        "status": "FAIL" if errors else "PASS",
        "error_count": len(errors),
        "warning_count": len(warnings),
        "violations": violations,
    }


def format_text_report(result: Dict) -> str:
    lines = []
    status = result["status"]
    marker = "PASS" if status == "PASS" else "FAIL"
    lines.append(f"\n[{marker}] Draft Validation: {result['file']}")
    lines.append(f"  Errors: {result['error_count']}  Warnings: {result['warning_count']}")

    if not result["violations"]:
        lines.append("  No violations found.")
        return "\n".join(lines)

    lines.append("")

    # Group by check type
    by_check: Dict[str, List[Dict]] = {}
    for v in result["violations"]:
        by_check.setdefault(v["check"], []).append(v)

    for check, items in by_check.items():
        severity = items[0]["severity"].upper()
        lines.append(f"  [{severity}] {check} ({len(items)})")
        for item in items:
            loc = f"line {item['line']}" if item["line"] else "document"
            lines.append(f"    {loc}: {item['message']}")
            if "context" in item:
                lines.append(f"      > {item['context']}")
        lines.append("")

    return "\n".join(lines)


def main():
    parser = argparse.ArgumentParser(description="Validate blog draft against editorial rules")
    parser.add_argument("file", help="Path to the draft file")
    parser.add_argument("--json", action="store_true", help="Output as JSON")
    args = parser.parse_args()

    result = validate(args.file)

    if args.json:
        print(json.dumps(result, indent=2))
    else:
        print(format_text_report(result))

    sys.exit(0 if result["status"] == "PASS" else 1)


if __name__ == "__main__":
    main()
