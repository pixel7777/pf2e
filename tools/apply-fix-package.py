#!/usr/bin/env python3
"""Apply a fix package to editorial-overrides.json with field-level merge."""
import json
import sys
import os

def main():
    if len(sys.argv) < 2:
        print("Usage: apply-fix-package.py <fix-package.json>")
        sys.exit(1)

    fix_path = sys.argv[1]
    overrides_path = os.path.join(os.path.dirname(__file__), '..', 'data', 'editorial-overrides.json')

    with open(overrides_path, 'r', encoding='utf-8') as f:
        overrides = json.load(f)

    with open(fix_path, 'r', encoding='utf-8') as f:
        fixes = json.load(f)

    existing_map = {}
    for i, entry in enumerate(overrides):
        existing_map[entry['aonId']] = i

    merged_count = 0
    appended_count = 0

    for fix in fixes:
        aid = fix['aonId']
        if aid in existing_map:
            idx = existing_map[aid]
            entry = overrides[idx]
            for field, value in fix['overrides'].items():
                entry['overrides'][field] = value
            if fix.get('reason'):
                entry['reason'] += ' | ' + fix['reason']
            merged_count += 1
            print(f"  MERGED: {fix['name']} ({aid})")
        else:
            overrides.append(fix)
            existing_map[aid] = len(overrides) - 1
            appended_count += 1
            print(f"  APPEND: {fix['name']} ({aid})")

    with open(overrides_path, 'w', encoding='utf-8') as f:
        json.dump(overrides, f, indent=2, ensure_ascii=False)
        f.write('\n')

    print(f"\nDone. Merged: {merged_count}, Appended: {appended_count}, Total: {len(overrides)}")

if __name__ == '__main__':
    main()
