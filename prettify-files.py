#!/usr/bin/env python3
"""
Prettify output files — decode JSON-escaped newlines to real newlines.
Usage: python3 prettify-files.py [file1] [file2] ...
       python3 prettify-files.py output/*.txt
       python3 prettify-files.py              (defaults to output/*.txt)
"""
import sys
import json
import os


def prettify(filepath):
    with open(filepath, "r") as f:
        data = f.read().strip()

    if not data:
        return

    # Try JSON string decode (handles escaped \n, \t, \", etc.)
    try:
        decoded = json.loads(data)
        if isinstance(decoded, str):
            data = decoded
    except (json.JSONDecodeError, ValueError):
        # Not valid JSON — try manual replacement of literal \n
        if data.startswith('"') and data.endswith('"'):
            data = data[1:-1]
        data = data.replace("\\n", "\n")
        data = data.replace("\\t", "\t")
        data = data.replace('\\"', '"')

    with open(filepath, "w") as f:
        f.write(data)
        if not data.endswith("\n"):
            f.write("\n")

    print(f"  Prettified: {filepath}")


if __name__ == "__main__":
    files = sys.argv[1:]
    if not files:
        output_dir = "output"
        if os.path.isdir(output_dir):
            files = [
                os.path.join(output_dir, f)
                for f in sorted(os.listdir(output_dir))
                if f.endswith(".txt")
            ]

    if not files:
        print("No files found. Pass file paths or ensure output/*.txt exists.")
        sys.exit(1)

    for f in files:
        if os.path.isfile(f):
            prettify(f)
