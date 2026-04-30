"""
Extract curated spell data from the 4 tradition planner HTML files.
Parses the SPELL_DATA and TAG_DEFS JavaScript objects from each file.
Outputs data/curated.js and data/curated.json.
"""

import re
import json
import os

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
PROJECT_ROOT = os.path.dirname(SCRIPT_DIR)
VAULT_ROOT = os.path.dirname(PROJECT_ROOT)

PLANNER_DIR = os.path.join(VAULT_ROOT, "Gaming", "PF2e", "_Reference", "Tradition Sheets")

TRADITIONS = {
    "arcane": "arcane-planner.html",
    "divine": "divine-planner.html",
    "occult": "occult-planner.html",
    "primal": "primal-planner.html",
}

def extract_js_object(html, var_name):
    """Extract a JavaScript object literal assigned to var_name from HTML."""
    pattern = rf'(?:const|var|let)\s+{var_name}\s*=\s*(\{{)'
    match = re.search(pattern, html)
    if not match:
        return None

    start = match.start(1)
    depth = 0
    i = start
    while i < len(html):
        c = html[i]
        if c == '{':
            depth += 1
        elif c == '}':
            depth -= 1
            if depth == 0:
                return html[start:i+1]
        elif c == "'" or c == '"':
            quote = c
            i += 1
            while i < len(html) and html[i] != quote:
                if html[i] == '\\':
                    i += 1
                i += 1
        elif c == '/' and i + 1 < len(html) and html[i+1] == '/':
            while i < len(html) and html[i] != '\n':
                i += 1
        i += 1
    return None


def js_obj_to_json(js_text):
    """Convert JavaScript object literal to valid JSON."""
    # Remove single-line comments
    result = re.sub(r'//[^\n]*', '', js_text)
    # Remove multi-line comments
    result = re.sub(r'/\*.*?\*/', '', result, flags=re.DOTALL)

    # Convert single-quoted strings to double-quoted, skipping double-quoted strings
    out = []
    i = 0
    while i < len(result):
        c = result[i]
        if c == '"':
            # Already double-quoted string — pass through as-is
            out.append(c)
            i += 1
            while i < len(result) and result[i] != '"':
                if result[i] == '\\' and i + 1 < len(result):
                    out.append(result[i])
                    i += 1
                    out.append(result[i])
                    i += 1
                    continue
                out.append(result[i])
                i += 1
            if i < len(result):
                out.append(result[i])
                i += 1
        elif c == "'":
            # Single-quoted string — convert to double-quoted
            out.append('"')
            i += 1
            while i < len(result) and result[i] != "'":
                if result[i] == '\\' and i + 1 < len(result):
                    if result[i+1] == "'":
                        out.append("'")
                        i += 2
                        continue
                    out.append(result[i])
                    i += 1
                    out.append(result[i])
                    i += 1
                    continue
                if result[i] == '"':
                    out.append('\\"')
                    i += 1
                    continue
                out.append(result[i])
                i += 1
            out.append('"')
            i += 1
        else:
            out.append(c)
            i += 1
    result = ''.join(out)

    # Add quotes around unquoted keys
    result = re.sub(r'(?<=[{,\n])\s*(\w+)\s*:', r' "\1":', result)

    # Remove trailing commas before } or ]
    result = re.sub(r',\s*([}\]])', r'\1', result)

    return result


def parse_spell_data(html):
    """Parse SPELL_DATA from an HTML planner file."""
    js_text = extract_js_object(html, 'SPELL_DATA')
    if not js_text:
        raise ValueError("Could not find SPELL_DATA in HTML")

    json_text = js_obj_to_json(js_text)

    try:
        data = json.loads(json_text)
    except json.JSONDecodeError as e:
        # Debug: write the problematic JSON
        debug_path = os.path.join(PROJECT_ROOT, "tools", "debug_json.txt")
        with open(debug_path, 'w', encoding='utf-8') as f:
            # Find the error location
            lines = json_text.split('\n')
            err_line = e.lineno - 1 if e.lineno else 0
            start = max(0, err_line - 5)
            end = min(len(lines), err_line + 5)
            for idx in range(start, end):
                marker = ">>> " if idx == err_line else "    "
                f.write(f"{marker}{idx+1}: {lines[idx]}\n")
        raise ValueError(f"JSON parse error at line {e.lineno}, col {e.colno}: {e.msg}. Debug written to {debug_path}")

    return data


def parse_tag_defs(html):
    """Parse TAG_DEFS from an HTML planner file."""
    js_text = extract_js_object(html, 'TAG_DEFS')
    if not js_text:
        return None
    json_text = js_obj_to_json(js_text)
    try:
        return json.loads(json_text)
    except json.JSONDecodeError:
        return None


def extract_overview_html(html, tradition):
    """Extract the tradition overview content (panel-0) from HTML."""
    match = re.search(r'<div id="panel-0"[^>]*>(.*?)</div>\s*<!--\s*Level panels', html, re.DOTALL)
    if match:
        return match.group(1).strip()
    return None


def normalize_curated_data(tradition, spell_data):
    """Normalize spell data into a consistent structure per tradition."""
    entries = []
    total = 0

    for role in ['damage', 'debuff', 'buff']:
        if role not in spell_data:
            continue
        role_data = spell_data[role]
        for rank_str, spells in role_data.items():
            rank = int(rank_str)
            for spell in spells:
                entry = {
                    "name": spell["name"],
                    "aonId": spell.get("aonId"),
                    "tradition": tradition,
                    "role": role,
                    "rank": rank,
                    "save": spell.get("save", "—"),
                    "tags": spell.get("tags", []),
                    "notes": spell.get("notes", ""),
                    "heightenedFrom": spell.get("heightenedFrom", 0),
                }
                entries.append(entry)
                total += 1

    for role in ['silverBullets', 'reactions', 'oneAction', 'prebuffs']:
        if role not in spell_data:
            continue
        for spell in spell_data[role]:
            entry = {
                "name": spell["name"],
                "aonId": spell.get("aonId"),
                "tradition": tradition,
                "role": role,
                "rank": spell.get("rank", 0),
                "save": spell.get("save", "—"),
                "tags": spell.get("tags", []),
                "notes": spell.get("notes", ""),
                "heightenedFrom": spell.get("heightenedFrom", 0),
            }
            entries.append(entry)
            total += 1

    return entries, total


def main():
    all_curated = {}
    tag_defs = None
    overviews = {}
    grand_total = 0

    for tradition, filename in TRADITIONS.items():
        filepath = os.path.join(PLANNER_DIR, filename)
        print(f"Parsing {filename}...")

        with open(filepath, 'r', encoding='utf-8') as f:
            html = f.read()

        spell_data = parse_spell_data(html)
        entries, count = normalize_curated_data(tradition, spell_data)
        all_curated[tradition] = entries
        grand_total += count
        print(f"  Extracted {count} curated entries from {tradition}")

        if tag_defs is None:
            tag_defs = parse_tag_defs(html)

        overview = extract_overview_html(html, tradition)
        if overview:
            overviews[tradition] = overview

    # Write curated.json (source of truth)
    output = {
        "traditions": all_curated,
        "tagDefs": tag_defs or {},
        "overviews": overviews,
    }

    json_path = os.path.join(PROJECT_ROOT, "data", "curated.json")
    with open(json_path, 'w', encoding='utf-8') as f:
        json.dump(output, f, indent=2, ensure_ascii=False)
    print(f"\nWrote {json_path}")

    # Write curated.js (browser-loadable)
    js_path = os.path.join(PROJECT_ROOT, "data", "curated.js")
    with open(js_path, 'w', encoding='utf-8') as f:
        f.write("// Auto-generated by tools/extract-curated.py — do not edit manually\n")
        f.write("window.CURATED_DATA = ")
        json.dump({"traditions": all_curated, "tagDefs": tag_defs or {}}, f, indent=2, ensure_ascii=False)
        f.write(";\n")
    print(f"Wrote {js_path}")

    print(f"\nTotal curated entries across all traditions: {grand_total}")

    # Summary per tradition
    for tradition, entries in all_curated.items():
        roles = {}
        for e in entries:
            roles[e['role']] = roles.get(e['role'], 0) + 1
        role_summary = ", ".join(f"{r}: {c}" for r, c in sorted(roles.items()))
        print(f"  {tradition}: {len(entries)} entries ({role_summary})")


if __name__ == "__main__":
    main()
