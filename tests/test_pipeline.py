"""
Pipeline regression tests for PF2e Spell Planner.

Validates schema integrity, snapshot stability, and build reproducibility
of spell-data.js.

Usage:
    py tests/test_pipeline.py              # Run all tests
    py tests/test_pipeline.py --update-snapshot  # Regenerate snapshot fixture
"""

import json
import os
import shutil
import subprocess
import sys
import tempfile

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
PROJECT_ROOT = os.path.dirname(SCRIPT_DIR)
SPELL_DATA_PATH = os.path.join(PROJECT_ROOT, "data", "spell-data.js")
SNAPSHOT_PATH = os.path.join(SCRIPT_DIR, "fixtures", "snapshot_spells.json")

EXPECTED_FIELDS = [
    "action_tags", "aonId", "basic_save", "conditions_by_outcome",
    "conditions_imposed", "curated", "damage_types", "defense_tags",
    "era", "heighten_pattern", "heighten_quality", "heighten_ranks",
    "heighten_raw", "mathfinder_observations", "mathfinder_reviewed",
    "mathfinder_summary", "name", "native_rank", "rarity",
    "reliability_tags", "replaced_by", "replaces", "roles",
    "special_tags", "st_incap", "targeting_subtypes", "targeting_tags",
    "tradition", "trait_raw", "url", "weaknesses_imposed"
]

VALID_HEIGHTEN_PATTERNS = {"plus_1", "plus_2", "plus_3", "plus_4", "fixed", "none"}
VALID_ERAS = {"remaster_core", "legacy_core", "other"}
VALID_RARITIES = {"common", "uncommon", "rare"}
VALID_TRADITIONS = {"Arcane", "Divine", "Occult", "Primal", "Elemental"}
VALID_ROLES = {
    "damage", "debuff", "buff", "control", "utility",
    "healing", "reactions", "oneAction", "prebuffs", "silverBullets"
}

# Array fields that must be lists (not null, not strings)
ARRAY_FIELDS = [
    "action_tags", "conditions_imposed",
    "damage_types", "defense_tags", "heighten_ranks", "reliability_tags",
    "roles", "special_tags", "targeting_subtypes", "targeting_tags",
    "tradition", "trait_raw", "weaknesses_imposed"
]

# Nullable dict fields (null or dict)
NULLABLE_DICT_FIELDS = ["conditions_by_outcome"]

# Nullable fields that can be null or their expected type
NULLABLE_STRING_FIELDS = ["mathfinder_observations", "mathfinder_summary", "replaced_by", "replaces"]

# Boolean fields
BOOL_FIELDS = ["basic_save", "st_incap", "curated", "mathfinder_reviewed"]

# Int fields
INT_FIELDS = ["aonId", "native_rank"]

# Required non-empty string fields
REQUIRED_STRING_FIELDS = ["name"]


def load_spell_data(path=None):
    """Parse spell-data.js and return the spells array."""
    path = path or SPELL_DATA_PATH
    try:
        data = open(path, encoding="utf-8").read()
    except FileNotFoundError:
        print(f"FAIL: {path} not found")
        sys.exit(1)

    lines = data.split("\n", 1)
    rest = lines[1] if lines[0].startswith("//") else data
    prefix = "window.SPELL_SCHEMA = "
    try:
        idx = rest.index(prefix)
    except ValueError:
        print(f"FAIL: Could not find '{prefix}' in {path}")
        print(f"  First 200 chars: {data[:200]}")
        sys.exit(1)

    json_str = rest[idx + len(prefix):].rstrip().rstrip(";")
    try:
        obj = json.loads(json_str)
    except json.JSONDecodeError as e:
        print(f"FAIL: JSON parse error in {path}: {e}")
        print(f"  Content near error: {json_str[max(0,e.pos-50):e.pos+50]}")
        sys.exit(1)

    return obj


def test_schema_validation(spells):
    """A1: Validate all expected fields exist on every spell with correct types."""
    errors = []

    for i, spell in enumerate(spells):
        spell_id = f"{spell.get('name', '?')} (index {i})"

        # Field presence
        for field in EXPECTED_FIELDS:
            if field not in spell:
                errors.append(f"  {spell_id}: missing field '{field}'")

        extra = set(spell.keys()) - set(EXPECTED_FIELDS)
        if extra:
            errors.append(f"  {spell_id}: unexpected fields {extra}")

        # Array type checks
        for field in ARRAY_FIELDS:
            if field in spell and not isinstance(spell[field], list):
                errors.append(f"  {spell_id}: '{field}' is {type(spell[field]).__name__}, expected list")

        # Nullable dict checks
        for field in NULLABLE_DICT_FIELDS:
            val = spell.get(field)
            if val is not None and not isinstance(val, dict):
                errors.append(f"  {spell_id}: '{field}' is {type(val).__name__}, expected dict or null")

        # Nullable string checks
        for field in NULLABLE_STRING_FIELDS:
            val = spell.get(field)
            if val is not None and not isinstance(val, str):
                errors.append(f"  {spell_id}: '{field}' is {type(val).__name__}, expected str or null")

        # Boolean checks
        for field in BOOL_FIELDS:
            if field in spell and not isinstance(spell[field], bool):
                errors.append(f"  {spell_id}: '{field}' is {type(spell[field]).__name__}, expected bool")

        # Int type checks
        for field in INT_FIELDS:
            if field in spell and not isinstance(spell[field], int):
                errors.append(f"  {spell_id}: '{field}' is {type(spell[field]).__name__}, expected int")

        # Required string checks
        for field in REQUIRED_STRING_FIELDS:
            val = spell.get(field)
            if not isinstance(val, str) or not val.strip():
                errors.append(f"  {spell_id}: '{field}' must be a non-empty string, got {repr(val)}")

    if errors:
        print(f"FAIL: Schema validation — {len(errors)} error(s):")
        for e in errors[:20]:
            print(e)
        if len(errors) > 20:
            print(f"  ... and {len(errors) - 20} more")
        return False

    print(f"  PASS: All {len(spells)} spells have {len(EXPECTED_FIELDS)} expected fields with correct types")
    return True


def test_enum_validation(spells):
    """A1 continued: Validate enum fields have valid values."""
    errors = []

    for spell in spells:
        name = spell.get("name", "?")

        # heighten_pattern
        hp = spell.get("heighten_pattern")
        if hp not in VALID_HEIGHTEN_PATTERNS:
            errors.append(f"  {name}: heighten_pattern '{hp}' not in {VALID_HEIGHTEN_PATTERNS}")

        # era
        era = spell.get("era")
        if era not in VALID_ERAS:
            errors.append(f"  {name}: era '{era}' not in {VALID_ERAS}")

        # rarity
        rarity = spell.get("rarity")
        if rarity not in VALID_RARITIES:
            errors.append(f"  {name}: rarity '{rarity}' not in {VALID_RARITIES}")

        # tradition values
        for t in spell.get("tradition", []):
            if t not in VALID_TRADITIONS:
                errors.append(f"  {name}: tradition '{t}' not in {VALID_TRADITIONS}")

        # roles values
        for r in spell.get("roles", []):
            if r not in VALID_ROLES:
                errors.append(f"  {name}: role '{r}' not in {VALID_ROLES}")

    if errors:
        print(f"FAIL: Enum validation — {len(errors)} error(s):")
        for e in errors[:20]:
            print(e)
        if len(errors) > 20:
            print(f"  ... and {len(errors) - 20} more")
        return False

    print("  PASS: All enum values are valid")
    return True


def test_count_bounds(spells):
    """A1: Assert spell count is between 1,050 and 1,150."""
    count = len(spells)
    if count < 1050 or count > 1150:
        print(f"FAIL: Spell count {count} outside bounds [1050, 1150]")
        return False
    print(f"  PASS: Spell count {count} within bounds [1050, 1150]")
    return True


def test_no_duplicates(spells):
    """A1: No duplicate aonId or normalized name."""
    errors = []

    # aonId duplicates
    seen_ids = {}
    for spell in spells:
        aid = spell["aonId"]
        if aid in seen_ids:
            errors.append(f"  Duplicate aonId {aid}: '{spell['name']}' and '{seen_ids[aid]}'")
        seen_ids[aid] = spell["name"]

    # Normalized name duplicates (case-insensitive, apostrophe-normalized)
    seen_names = {}
    for spell in spells:
        norm = spell["name"].lower().replace("’", "'").replace("‘", "'")
        if norm in seen_names:
            errors.append(f"  Duplicate name '{spell['name']}' (normalized: '{norm}') conflicts with '{seen_names[norm]}'")
        seen_names[norm] = spell["name"]

    if errors:
        print(f"FAIL: Duplicate detection — {len(errors)} error(s):")
        for e in errors[:10]:
            print(e)
        return False

    print(f"  PASS: No duplicates among {len(spells)} spells")
    return True


def select_snapshot_spells(spells):
    """Select 50 representative spells covering all required categories."""
    selected = {}  # aonId -> spell

    edge_case_names = ["Brine Dragon Bile", "Calm", "Fireball", "Fear", "Familiar's Face"]

    # Helper to add up to N spells from a list
    def add_up_to(source, n, label=""):
        added = 0
        for s in source:
            if added >= n:
                break
            if s["aonId"] not in selected:
                selected[s["aonId"]] = s
                added += 1

    # 5 per tradition (Arcane, Divine, Occult, Primal) = 20
    for trad in ["Arcane", "Divine", "Occult", "Primal"]:
        trad_spells = [s for s in spells if trad in s["tradition"] and s["aonId"] not in selected]
        add_up_to(trad_spells[:20], 5)

    # 5 fixed heighten
    add_up_to([s for s in spells if s["heighten_pattern"] == "fixed"], 5)

    # 5 plus_1 heighten
    add_up_to([s for s in spells if s["heighten_pattern"] == "plus_1"], 5)

    # 5 none heighten
    add_up_to([s for s in spells if s["heighten_pattern"] == "none"], 5)

    # 5 with weaknesses_imposed non-empty
    add_up_to([s for s in spells if s["weaknesses_imposed"]], 5)

    # 5 with st_incap true
    add_up_to([s for s in spells if s["st_incap"]], 5)

    # Edge cases by name
    for name in edge_case_names:
        matches = [s for s in spells if s["name"] == name]
        if matches and matches[0]["aonId"] not in selected:
            selected[matches[0]["aonId"]] = matches[0]

    # Fill to 50 if needed
    if len(selected) < 50:
        for s in spells:
            if len(selected) >= 50:
                break
            if s["aonId"] not in selected:
                selected[s["aonId"]] = s

    # Trim to 50
    result = list(selected.values())[:50]
    return result


def build_snapshot_entry(spell):
    """Extract the fields we assert on for the snapshot."""
    return {
        "aonId": spell["aonId"],
        "name": spell["name"],
        "tradition": spell["tradition"],
        "heighten_pattern": spell["heighten_pattern"],
        "roles": sorted(spell["roles"]),
        "defense_tags": sorted(spell["defense_tags"]),
        "era": spell["era"],
    }


def update_snapshot(spells):
    """Regenerate snapshot_spells.json from current spell-data.js."""
    selected = select_snapshot_spells(spells)
    entries = [build_snapshot_entry(s) for s in selected]
    entries.sort(key=lambda x: x["aonId"])

    os.makedirs(os.path.dirname(SNAPSHOT_PATH), exist_ok=True)
    with open(SNAPSHOT_PATH, "w", encoding="utf-8") as f:
        json.dump(entries, f, indent=2, ensure_ascii=False)

    print(f"Snapshot updated: {len(entries)} spells written to {SNAPSHOT_PATH}")
    print("Re-run tests WITHOUT --update-snapshot to verify.")


def test_snapshot(spells):
    """A2: Compare current data against snapshot fixture."""
    if not os.path.exists(SNAPSHOT_PATH):
        print("FAIL: Snapshot file not found. Run with --update-snapshot first.")
        return False

    with open(SNAPSHOT_PATH, encoding="utf-8") as f:
        snapshot = json.load(f)

    # Index current spells by aonId
    by_id = {s["aonId"]: s for s in spells}

    errors = []
    for entry in snapshot:
        aid = entry["aonId"]
        if aid not in by_id:
            errors.append(f"  aonId {aid} ({entry['name']}): not found in current data")
            continue

        current = build_snapshot_entry(by_id[aid])

        if current["name"] != entry["name"]:
            errors.append(f"  aonId {aid}: name '{current['name']}' != snapshot '{entry['name']}'")
        if current["tradition"] != entry["tradition"]:
            errors.append(f"  aonId {aid} ({entry['name']}): tradition {current['tradition']} != snapshot {entry['tradition']}")
        if current["heighten_pattern"] != entry["heighten_pattern"]:
            errors.append(f"  aonId {aid} ({entry['name']}): heighten_pattern '{current['heighten_pattern']}' != snapshot '{entry['heighten_pattern']}'")
        if sorted(current["roles"]) != sorted(entry["roles"]):
            errors.append(f"  aonId {aid} ({entry['name']}): roles {current['roles']} != snapshot {entry['roles']}")
        if sorted(current["defense_tags"]) != sorted(entry["defense_tags"]):
            errors.append(f"  aonId {aid} ({entry['name']}): defense_tags {current['defense_tags']} != snapshot {entry['defense_tags']}")
        if current["era"] != entry["era"]:
            errors.append(f"  aonId {aid} ({entry['name']}): era '{current['era']}' != snapshot '{entry['era']}'")

    if errors:
        print(f"FAIL: Snapshot comparison — {len(errors)} mismatch(es):")
        for e in errors[:20]:
            print(e)
        if len(errors) > 20:
            print(f"  ... and {len(errors) - 20} more")
        return False

    print(f"  PASS: All {len(snapshot)} snapshot spells match current data")
    return True


def test_build_reproducibility():
    """A3: Run build pipeline and verify output passes validation."""
    build_script = os.path.join(PROJECT_ROOT, "tools", "build-spell-data.py")
    populate_script = os.path.join(PROJECT_ROOT, "tools", "populate-spell-data.py")

    if not os.path.exists(build_script):
        print(f"FAIL: Build script not found: {build_script}")
        return False
    if not os.path.exists(populate_script):
        print(f"FAIL: Populate script not found: {populate_script}")
        return False

    # Stash current spell-data.js
    backup_path = SPELL_DATA_PATH + ".backup"
    try:
        shutil.copy2(SPELL_DATA_PATH, backup_path)

        # Run build
        result = subprocess.run(
            [sys.executable, build_script],
            cwd=PROJECT_ROOT,
            capture_output=True, text=True, timeout=60
        )
        if result.returncode != 0:
            print(f"FAIL: build-spell-data.py exited with code {result.returncode}")
            print(f"  stderr: {result.stderr[:500]}")
            return False

        # Run populate --merge
        result = subprocess.run(
            [sys.executable, populate_script, "--merge"],
            cwd=PROJECT_ROOT,
            capture_output=True, text=True, timeout=60
        )
        if result.returncode != 0:
            print(f"FAIL: populate-spell-data.py --merge exited with code {result.returncode}")
            print(f"  stderr: {result.stderr[:500]}")
            return False

        # Validate output
        obj = load_spell_data(SPELL_DATA_PATH)
        spells = obj["spells"]

        if not test_schema_validation(spells):
            return False
        if not test_enum_validation(spells):
            return False
        if not test_snapshot(spells):
            return False

        print("  PASS: Build reproducibility — pipeline output passes all validations")
        return True

    finally:
        # Restore original
        if os.path.exists(backup_path):
            shutil.copy2(backup_path, SPELL_DATA_PATH)
            os.remove(backup_path)


def main():
    if "--update-snapshot" in sys.argv:
        obj = load_spell_data()
        update_snapshot(obj["spells"])
        return

    print("=== A1: Schema Validation ===")
    obj = load_spell_data()
    spells = obj["spells"]

    passed = True

    if not test_schema_validation(spells):
        passed = False
    if not test_enum_validation(spells):
        passed = False
    if not test_count_bounds(spells):
        passed = False
    if not test_no_duplicates(spells):
        passed = False

    print()
    print("=== A2: Snapshot Comparison ===")
    if not test_snapshot(spells):
        passed = False

    print()
    print("=== A3: Build Reproducibility ===")
    if not test_build_reproducibility():
        passed = False

    print()
    if passed:
        print("All pipeline tests PASSED")
    else:
        print("Some pipeline tests FAILED")
        sys.exit(1)


if __name__ == "__main__":
    main()
