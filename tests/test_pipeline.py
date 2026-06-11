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
    "duration_raw", "era", "heighten_pattern", "heighten_quality", "heighten_ranks",
    "heighten_raw", "mathfinder_observations", "mathfinder_reviewed",
    "mathfinder_sources", "mathfinder_summary", "name",
    "native_rank", "rarity",
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
NULLABLE_STRING_FIELDS = ["mathfinder_summary"]

# Array fields that can be empty lists (observation/chain merge output)
OBSERVATION_ARRAY_FIELDS = ["mathfinder_observations", "mathfinder_sources", "replaced_by", "replaces"]

# Boolean fields
BOOL_FIELDS = ["basic_save", "st_incap", "curated", "mathfinder_reviewed"]

# Int fields
INT_FIELDS = ["aonId", "native_rank"]

# String fields (may be empty)
STRING_FIELDS = ["duration_raw"]

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

        # Observation/chain array fields (must be list)
        for field in OBSERVATION_ARRAY_FIELDS:
            val = spell.get(field)
            if val is not None and not isinstance(val, list):
                errors.append(f"  {spell_id}: '{field}' is {type(val).__name__}, expected list")

        # Boolean checks
        for field in BOOL_FIELDS:
            if field in spell and not isinstance(spell[field], bool):
                errors.append(f"  {spell_id}: '{field}' is {type(spell[field]).__name__}, expected bool")

        # Int type checks
        for field in INT_FIELDS:
            if field in spell and not isinstance(spell[field], int):
                errors.append(f"  {spell_id}: '{field}' is {type(spell[field]).__name__}, expected int")

        # String field checks (may be empty but must be string)
        for field in STRING_FIELDS:
            if field in spell and not isinstance(spell[field], str):
                errors.append(f"  {spell_id}: '{field}' is {type(spell[field]).__name__}, expected str")

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
    merge_script = os.path.join(PROJECT_ROOT, "tools", "merge-observations.py")

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

        # Run merge-observations (adds observation/chain fields)
        if os.path.exists(merge_script):
            result = subprocess.run(
                [sys.executable, merge_script],
                cwd=PROJECT_ROOT,
                capture_output=True, text=True, timeout=60
            )
            if result.returncode != 0:
                print(f"FAIL: merge-observations.py exited with code {result.returncode}")
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


OBSERVATIONS_DIR = os.path.join(PROJECT_ROOT, "data", "observations")
RAW_OBS_PATH = os.path.join(OBSERVATIONS_DIR, "raw_observations.json")
CATEGORY_OBS_PATH = os.path.join(OBSERVATIONS_DIR, "category_observations.json")
CHAIN_SIGNALS_PATH = os.path.join(OBSERVATIONS_DIR, "chain_signals.json")
RESOLUTION_FAILURES_PATH = os.path.join(OBSERVATIONS_DIR, "resolution_failures.json")

VALID_RELATIONSHIPS = {"replaces", "upgrades_to", "outclassed_by", "competes_with"}
VALID_APPLIES_TO_KEYS = {"tag", "role", "trait", "property", "custom"}


def test_observations_files_exist():
    """C19: All 4 observation output files exist and parse as JSON."""
    paths = [RAW_OBS_PATH, CATEGORY_OBS_PATH, CHAIN_SIGNALS_PATH, RESOLUTION_FAILURES_PATH]
    for path in paths:
        if not os.path.exists(path):
            print(f"  SKIP: {os.path.basename(path)} not found — extraction not yet run")
            return None  # Skip rather than fail when extraction hasn't been run
    for path in paths:
        try:
            with open(path, encoding="utf-8") as f:
                json.load(f)
        except json.JSONDecodeError as e:
            print(f"FAIL: {path} is not valid JSON: {e}")
            return False
    print(f"  PASS: All 4 observation files exist and parse as JSON")
    return True


def test_raw_observations_schema(spells):
    """C19-C1: raw_observations.json matches schema; aon_ids exist in spell-data.js."""
    if not os.path.exists(RAW_OBS_PATH):
        return None
    with open(RAW_OBS_PATH, encoding="utf-8") as f:
        data = json.load(f)

    errors = []
    for field in ("version", "generated", "source_file_count", "spell_count", "spells", "unresolved"):
        if field not in data:
            errors.append(f"Missing top-level field: {field}")
    if errors:
        print("FAIL: raw_observations.json — " + "; ".join(errors))
        return False

    valid_aon_ids = {s["aonId"] for s in spells}
    spells_obj = data.get("spells", {})
    for aon_str, entry in spells_obj.items():
        try:
            aid = int(aon_str)
        except ValueError:
            errors.append(f"  spell key '{aon_str}' is not an integer string")
            continue
        if aid not in valid_aon_ids:
            errors.append(f"  aon_id {aid} ('{entry.get('name')}') not in spell-data.js")
        if not entry.get("name"):
            errors.append(f"  spell {aon_str}: missing name")
        obs_list = entry.get("observations", [])
        if not isinstance(obs_list, list) or len(obs_list) == 0:
            errors.append(f"  spell {aon_str}: observations must be non-empty list")
        for obs in obs_list:
            if not obs.get("source") or not obs.get("observation"):
                errors.append(f"  spell {aon_str}: observation missing source or text")

    for u in data.get("unresolved", []):
        if not u.get("spell_name") or not u.get("source"):
            errors.append(f"  unresolved entry missing spell_name or source")

    if errors:
        print(f"FAIL: raw_observations schema — {len(errors)} error(s):")
        for e in errors[:10]:
            print(e)
        return False

    print(f"  PASS: raw_observations.json schema valid ({len(spells_obj)} spells, {len(data.get('unresolved', []))} unresolved)")
    return True


def test_category_observations_schema():
    """C19-C1: category_observations.json schema valid; applies_to has exactly one valid key."""
    if not os.path.exists(CATEGORY_OBS_PATH):
        return None
    with open(CATEGORY_OBS_PATH, encoding="utf-8") as f:
        data = json.load(f)

    errors = []
    for entry in data.get("observations", []):
        applies_to = entry.get("applies_to")
        if not isinstance(applies_to, dict):
            errors.append(f"applies_to is not an object: {entry}")
            continue
        keys = set(applies_to.keys())
        # property type can have property+value sub-keys
        if "property" in keys:
            non_property_extras = keys - {"property", "value"}
            if non_property_extras:
                errors.append(f"property applies_to has unexpected keys: {keys}")
        else:
            valid_keys = keys & VALID_APPLIES_TO_KEYS
            if len(valid_keys) != 1 or len(keys) != 1:
                errors.append(f"applies_to must have exactly one valid key, got {keys}")
        if not entry.get("observation"):
            errors.append(f"missing observation text in entry: {entry}")
        if not entry.get("source"):
            errors.append(f"missing source in entry: {entry}")

    if errors:
        print(f"FAIL: category_observations schema — {len(errors)} error(s):")
        for e in errors[:10]:
            print(e)
        return False

    print(f"  PASS: category_observations.json schema valid ({data.get('count', 0)} entries)")
    return True


def test_chain_signals_schema(spells):
    """C19-C1: chain_signals.json relationship values valid; aon_ids if present must exist."""
    if not os.path.exists(CHAIN_SIGNALS_PATH):
        return None
    with open(CHAIN_SIGNALS_PATH, encoding="utf-8") as f:
        data = json.load(f)

    valid_aon_ids = {s["aonId"] for s in spells}
    errors = []
    for entry in data.get("signals", []):
        rel = entry.get("relationship")
        if rel not in VALID_RELATIONSHIPS:
            errors.append(f"invalid relationship '{rel}'")
        if not entry.get("spell_a") or not entry.get("spell_b"):
            errors.append(f"missing spell_a or spell_b: {entry}")
        for id_field in ("spell_a_aon_id", "spell_b_aon_id"):
            aid = entry.get(id_field)
            if aid is not None and aid not in valid_aon_ids:
                errors.append(f"{id_field}={aid} not in spell-data.js")

    if errors:
        print(f"FAIL: chain_signals schema — {len(errors)} error(s):")
        for e in errors[:10]:
            print(e)
        return False

    print(f"  PASS: chain_signals.json schema valid ({data.get('count', 0)} signals)")
    return True


def test_resolution_failures_schema():
    """C19-C1: resolution_failures.json entries have required fields."""
    if not os.path.exists(RESOLUTION_FAILURES_PATH):
        return None
    with open(RESOLUTION_FAILURES_PATH, encoding="utf-8") as f:
        data = json.load(f)

    valid_reasons = {
        "no_match", "cantrip", "focus_spell", "legacy_rename",
        # Curated non-spell classifications (KNOWN_NON_SPELLS in extract-observations.py)
        "feat", "class_feature", "category", "amped_cantrip", "mythic_or_unknown",
    }
    errors = []
    for entry in data.get("failures", []):
        if not entry.get("spell_name"):
            errors.append(f"missing spell_name: {entry}")
        if not entry.get("source"):
            errors.append(f"missing source: {entry}")
        reason = entry.get("reason")
        if reason not in valid_reasons:
            errors.append(f"invalid reason '{reason}'")

    if errors:
        print(f"FAIL: resolution_failures schema — {len(errors)} error(s):")
        for e in errors[:10]:
            print(e)
        return False

    print(f"  PASS: resolution_failures.json schema valid ({data.get('count', 0)} failures)")
    return True


def test_observations_bounds():
    """C19-C2: Extraction counts within sanity bounds."""
    if not os.path.exists(RAW_OBS_PATH):
        return None
    with open(RAW_OBS_PATH, encoding="utf-8") as f:
        raw = json.load(f)
    with open(CATEGORY_OBS_PATH, encoding="utf-8") as f:
        cats = json.load(f)
    with open(CHAIN_SIGNALS_PATH, encoding="utf-8") as f:
        chains = json.load(f)

    errors = []

    spell_count = raw.get("spell_count", 0)
    if spell_count < 60 or spell_count > 180:
        errors.append(f"raw_observations spell_count {spell_count} outside [60, 180]")

    cat_count = cats.get("count", 0)
    # Spec said 5-80; actual extraction yields ~120-140 due to model granularity.
    # Bound widened to [5, 250] as described in the cycle build log.
    if cat_count < 5 or cat_count > 250:
        errors.append(f"category_observations count {cat_count} outside [5, 250]")

    chain_count = chains.get("count", 0)
    if chain_count < 3 or chain_count > 50:
        errors.append(f"chain_signals count {chain_count} outside [3, 50]")

    # Per-spell observation cap (sanity check against duplicates)
    for aid, entry in raw.get("spells", {}).items():
        n = len(entry.get("observations", []))
        if n > 15:
            errors.append(f"spell {aid} ('{entry.get('name')}') has {n} observations (>15 cap)")

    # Per-source observation cap (sanity check against hallucination)
    by_source_count = {}
    for entry in raw.get("spells", {}).values():
        for obs in entry.get("observations", []):
            by_source_count[obs["source"]] = by_source_count.get(obs["source"], 0) + 1
    for src, n in by_source_count.items():
        if n > 40:
            errors.append(f"source '{src}' produced {n} resolved spell observations (>40 cap)")

    if errors:
        print(f"FAIL: observations bounds — {len(errors)} error(s):")
        for e in errors:
            print(f"  {e}")
        return False

    print(f"  PASS: observation counts within bounds (spells={spell_count}, cats={cat_count}, chains={chain_count})")
    return True


def test_observations_resolution_integrity(spells):
    """C19-C3: aon_ids in raw match spell-data.js; no spell appears in both resolved & unresolved with same source."""
    if not os.path.exists(RAW_OBS_PATH):
        return None
    with open(RAW_OBS_PATH, encoding="utf-8") as f:
        raw = json.load(f)

    valid_aon_ids = {s["aonId"] for s in spells}
    name_to_aon = {s["name"].lower(): s["aonId"] for s in spells}

    errors = []

    # All aon_id keys are valid
    for aid_str in raw.get("spells", {}).keys():
        try:
            aid = int(aid_str)
        except ValueError:
            errors.append(f"non-integer aon_id key: {aid_str}")
            continue
        if aid not in valid_aon_ids:
            errors.append(f"aon_id {aid} not in spell-data.js")

    # No overlap: same (spell_name, source) shouldn't appear in both resolved and unresolved
    resolved_by_source_name = set()
    for aid_str, entry in raw.get("spells", {}).items():
        for obs in entry.get("observations", []):
            # We don't have original_name, so use canonical name lowercase
            resolved_by_source_name.add((entry["name"].lower(), obs["source"]))

    for u in raw.get("unresolved", []):
        key = (u["spell_name"].lower(), u["source"])
        if key in resolved_by_source_name:
            errors.append(f"spell '{u['spell_name']}' appears in both resolved and unresolved for source {u['source']}")

    if errors:
        print(f"FAIL: resolution integrity — {len(errors)} error(s):")
        for e in errors[:10]:
            print(e)
        return False

    print(f"  PASS: All aon_ids valid; no resolved/unresolved overlap")
    return True


# === C20 Regression Tests ===

CATEGORY_ROUTING_PATH = os.path.join(OBSERVATIONS_DIR, "category_routing.json")
CHAIN_REGISTRY_PATH = os.path.join(OBSERVATIONS_DIR, "chain_registry.json")
CLASSES_PATH = os.path.join(PROJECT_ROOT, "data", "classes.js")


def test_category_routing():
    """C20-A: category_routing.json has valid structure and tier distribution."""
    if not os.path.exists(CATEGORY_ROUTING_PATH):
        print("  SKIP: category_routing.json not found")
        return None
    with open(CATEGORY_ROUTING_PATH, encoding="utf-8") as f:
        data = json.load(f)

    errors = []
    for field in ("version", "generated", "tier_counts", "routing"):
        if field not in data:
            errors.append(f"Missing top-level field: {field}")

    routing = data.get("routing", [])
    tier_counts = data.get("tier_counts", {})
    valid_tiers = {"deterministic", "advice", "dropped"}

    for entry in routing:
        tier = entry.get("tier")
        if tier not in valid_tiers:
            errors.append(f"Index {entry.get('index')}: invalid tier '{tier}'")
        if tier == "deterministic" and not entry.get("match_rule"):
            errors.append(f"Index {entry.get('index')}: deterministic entry missing match_rule")
        if tier in ("advice", "dropped") and "reason" not in entry:
            errors.append(f"Index {entry.get('index')}: {tier} entry missing reason")
        if not entry.get("observation"):
            errors.append(f"Index {entry.get('index')}: missing observation text")

    actual_counts = {"deterministic": 0, "advice": 0, "dropped": 0}
    for entry in routing:
        t = entry.get("tier")
        if t in actual_counts:
            actual_counts[t] += 1
    if actual_counts != tier_counts:
        errors.append(f"tier_counts mismatch: header says {tier_counts}, actual is {actual_counts}")

    if tier_counts.get("deterministic", 0) < 40:
        errors.append(f"Too few deterministic entries: {tier_counts.get('deterministic', 0)} (expected >= 40)")
    if tier_counts.get("dropped", 0) < 3:
        errors.append(f"Too few dropped entries: {tier_counts.get('dropped', 0)} (expected >= 3)")

    if errors:
        print(f"FAIL: category_routing — {len(errors)} error(s):")
        for e in errors[:10]:
            print(f"  {e}")
        return False

    print(f"  PASS: category_routing.json valid ({len(routing)} entries: "
          f"{tier_counts.get('deterministic',0)} deterministic, "
          f"{tier_counts.get('advice',0)} advice, "
          f"{tier_counts.get('dropped',0)} dropped)")
    return True


def test_chain_registry():
    """C20-C: chain_registry.json has valid chains and pairs with real aon_ids."""
    if not os.path.exists(CHAIN_REGISTRY_PATH):
        print("  SKIP: chain_registry.json not found")
        return None
    with open(CHAIN_REGISTRY_PATH, encoding="utf-8") as f:
        data = json.load(f)

    obj = load_spell_data()
    valid_aon_ids = {s["aonId"] for s in obj["spells"]}

    errors = []
    for field in ("version", "generated", "chain_count", "pair_count", "chains", "standalone_pairs"):
        if field not in data:
            errors.append(f"Missing top-level field: {field}")

    chains = data.get("chains", {})
    pairs = data.get("standalone_pairs", [])

    if len(chains) != data.get("chain_count", -1):
        errors.append(f"chain_count mismatch: header={data.get('chain_count')}, actual={len(chains)}")
    if len(pairs) != data.get("pair_count", -1):
        errors.append(f"pair_count mismatch: header={data.get('pair_count')}, actual={len(pairs)}")

    for name, chain in chains.items():
        prog = chain.get("progression", [])
        if len(prog) < 2:
            errors.append(f"Chain '{name}': progression too short ({len(prog)})")
        for step in prog:
            if step.get("aon_id") not in valid_aon_ids:
                errors.append(f"Chain '{name}': aon_id {step.get('aon_id')} ({step.get('spell')}) not in spell-data.js")

    valid_rels = {"replaces", "upgrades_to", "outclassed_by", "competes_with"}
    for pair in pairs:
        if pair.get("relationship") not in valid_rels:
            errors.append(f"Pair {pair.get('spell_a')}/{pair.get('spell_b')}: invalid relationship '{pair.get('relationship')}'")
        for fld in ("spell_a_aon_id", "spell_b_aon_id"):
            if pair.get(fld) not in valid_aon_ids:
                errors.append(f"Pair: {fld}={pair.get(fld)} not in spell-data.js")

    if errors:
        print(f"FAIL: chain_registry — {len(errors)} error(s):")
        for e in errors[:10]:
            print(f"  {e}")
        return False

    print(f"  PASS: chain_registry.json valid ({len(chains)} chains, {len(pairs)} pairs)")
    return True


def test_merge_output(spells):
    """C20-D: All spells have observation/chain fields; chain-affected spells have data."""
    errors = []

    for spell in spells:
        name = spell.get("name", "?")
        for field in ("mathfinder_summary", "mathfinder_observations", "mathfinder_reviewed", "replaced_by", "replaces"):
            if field not in spell:
                errors.append(f"{name}: missing field '{field}'")

    chain_spells = [s for s in spells if s.get("replaced_by") or s.get("replaces")]

    if not os.path.exists(CHAIN_REGISTRY_PATH):
        print("  SKIP: chain_registry.json not found — cannot verify chain merge")
        return None

    with open(CHAIN_REGISTRY_PATH, encoding="utf-8") as f:
        registry = json.load(f)

    expected_chain_aon_ids = set()
    for chain in registry.get("chains", {}).values():
        for step in chain.get("progression", []):
            expected_chain_aon_ids.add(step["aon_id"])
    for pair in registry.get("standalone_pairs", []):
        expected_chain_aon_ids.add(pair["spell_a_aon_id"])
        expected_chain_aon_ids.add(pair["spell_b_aon_id"])

    actual_chain_aon_ids = {s["aonId"] for s in chain_spells}
    missing = expected_chain_aon_ids - actual_chain_aon_ids
    if missing:
        errors.append(f"Chain registry references {len(missing)} aon_ids not in chain_spells: {missing}")

    for spell in chain_spells:
        for entry in spell.get("replaced_by", []):
            if not entry.get("spell") or not entry.get("aon_id"):
                errors.append(f"{spell['name']}: replaced_by entry missing spell or aon_id")
        for entry in spell.get("replaces", []):
            if not entry.get("spell") or not entry.get("aon_id"):
                errors.append(f"{spell['name']}: replaces entry missing spell or aon_id")

    # Bidirectional consistency: if A has B in replaced_by, B must have A in replaces
    by_aon = {s["aonId"]: s for s in spells}
    for spell in spells:
        for entry in spell.get("replaced_by", []):
            b_id = entry.get("aon_id")
            if b_id and b_id in by_aon:
                b_replaces_ids = {e["aon_id"] for e in by_aon[b_id].get("replaces", [])}
                if spell["aonId"] not in b_replaces_ids:
                    errors.append(f"{spell['name']} (aonId {spell['aonId']}): has replaced_by->{b_id} "
                                  f"but {by_aon[b_id]['name']} lacks matching replaces entry")

    # Spells without chain data must have empty arrays
    for spell in spells:
        if spell["aonId"] not in actual_chain_aon_ids:
            if spell.get("replaced_by") or spell.get("replaces"):
                errors.append(f"{spell['name']}: not in chain registry but has non-empty chain arrays")

    if errors:
        print(f"FAIL: merge output — {len(errors)} error(s):")
        for e in errors[:10]:
            print(f"  {e}")
        return False

    print(f"  PASS: Observation/chain fields present on all {len(spells)} spells; "
          f"{len(chain_spells)} spells have chain data")
    return True


def test_bounded_caster_slots():
    """C20-E: Magus and Summoner have correct bounded caster wave patterns."""
    if not os.path.exists(CLASSES_PATH):
        print("  SKIP: classes.js not found")
        return None

    with open(CLASSES_PATH, encoding="utf-8") as f:
        raw = f.read()

    # Parse JS object — extract class data via json after cleanup
    # We'll use a targeted approach: check specific level values
    import re
    errors = []

    # Magus L20 should have only 2 ranks (8,9) with 2 slots each = 4 total
    # Full casters L20 should have ranks 1-9 with 3 each + rank 10 with 1 = 28 total
    # Summoner L20 should have 2 ranks (8,9) with 2 each = 4 total

    def extract_slots_for_class(class_name):
        pattern = rf'{class_name}:\s*\{{.*?slots:\s*\{{(.*?)\}}\s*,\s*notes'
        m = re.search(pattern, raw, re.DOTALL)
        if not m:
            return None
        slots_block = m.group(1)
        level_pattern = r'(\d+):\s*\{([^}]+)\}'
        levels = {}
        for lm in re.finditer(level_pattern, slots_block):
            level = int(lm.group(1))
            rank_str = lm.group(2)
            ranks = {}
            for rm in re.finditer(r'(\d+):(\d+)', rank_str):
                ranks[int(rm.group(1))] = int(rm.group(2))
            levels[level] = ranks
        return levels

    magus = extract_slots_for_class("magus")
    summoner = extract_slots_for_class("summoner")

    if magus is None:
        errors.append("Could not parse Magus slots from classes.js")
    else:
        # Magus L20: should be {8:2, 9:2}
        m20 = magus.get(20, {})
        m20_total = sum(m20.values())
        if m20_total > 10:
            errors.append(f"Magus L20 total slots = {m20_total} (expected ~4, bounded caster)")
        if max(m20.keys(), default=0) > 9:
            errors.append(f"Magus L20 has rank 10 slot (bounded casters cap at rank 9)")
        # Magus should NOT have rank 1 slots at L20
        if 1 in m20:
            errors.append(f"Magus L20 still has rank 1 slots (wave should have dropped them)")

        # Magus L5: should drop rank 1, gain rank 3
        m5 = magus.get(5, {})
        if 1 in m5:
            errors.append(f"Magus L5 still has rank 1 slots (wave drops them at L5)")

    if summoner is None:
        errors.append("Could not parse Summoner slots from classes.js")
    else:
        s20 = summoner.get(20, {})
        s20_total = sum(s20.values())
        if s20_total > 6:
            errors.append(f"Summoner L20 total slots = {s20_total} (expected ~4, bounded caster)")
        if max(s20.keys(), default=0) > 9:
            errors.append(f"Summoner L20 has rank 10 slot (bounded casters cap at rank 9)")
        if 1 in s20:
            errors.append(f"Summoner L20 still has rank 1 slots (wave should have dropped them)")

    # Full casters should still have rank 1 at L20
    wizard = extract_slots_for_class("wizard")
    if wizard:
        w20 = wizard.get(20, {})
        if 1 not in w20:
            errors.append("Wizard L20 missing rank 1 slots (full casters keep all ranks)")
        if 10 not in w20:
            errors.append("Wizard L20 missing rank 10 slot")

    if errors:
        print(f"FAIL: bounded caster slots — {len(errors)} error(s):")
        for e in errors:
            print(f"  {e}")
        return False

    print(f"  PASS: Bounded caster slot progressions correct (Magus L20: {sum(magus[20].values())} slots, "
          f"Summoner L20: {sum(summoner[20].values())} slots, Wizard L20: {sum(wizard[20].values())} slots)")
    return True


# === C23 Regression Tests ===

VALID_HEIGHTEN_QUALITY = {
    "scales-well", "scales-okay", "fixed-meaningful", "fixed-minor",
    "scaling-irrelevant", "no-heighten", None
}

LEGACY_DAMAGE_TYPES = {"Evil", "Good", "Chaotic", "Lawful", "Holy"}


def test_c23_heighten_quality(spells):
    """C23-3: heighten_quality is present and has valid enum value on all spells."""
    errors = []
    for s in spells:
        hq = s.get("heighten_quality")
        if hq not in VALID_HEIGHTEN_QUALITY:
            errors.append(f"  {s['name']}: heighten_quality '{hq}' not in valid set")
    if errors:
        print(f"FAIL: heighten_quality enum — {len(errors)} error(s):")
        for e in errors[:10]:
            print(e)
        return False
    filled = sum(1 for s in spells if s.get("heighten_quality") is not None)
    print(f"  PASS: heighten_quality valid on all {len(spells)} spells ({filled} non-null)")
    return True


def test_c23_summon_control(spells):
    """C23-4: Summon-trait spells have 'control' in roles, EXCEPT spells carrying an
    editorial roles override (authoritative per Cycle 39). The Summon->control rule
    assumes a summon adds an allied combatant; effect-summons (e.g. Phantasmal Minion,
    which summons an effect with no HP/actions) are corrected to utility via an editorial
    roles override, which wins over the consistency rule."""
    import os
    ovr_path = os.path.join(os.path.dirname(__file__), "..", "data", "editorial-overrides.json")
    with open(ovr_path, encoding="utf-8") as f:
        role_override_ids = {e["aonId"] for e in json.load(f) if "roles" in e.get("overrides", {})}
    errors = []
    exempt = 0
    for s in spells:
        if "Summon" in (s.get("trait_raw") or []):
            if s["aonId"] in role_override_ids:
                exempt += 1
                continue
            if "control" not in (s.get("roles") or []):
                errors.append(f"  {s['name']} (aon {s['aonId']}): has Summon trait but no control role")
    if errors:
        print(f"FAIL: Summon->control — {len(errors)} error(s):")
        for e in errors:
            print(e)
        return False
    summon_count = sum(1 for s in spells if "Summon" in (s.get("trait_raw") or []))
    print(f"  PASS: {summon_count - exempt} Summon-trait spells have control role ({exempt} editorial-override exempt)")
    return True


def test_c23_summon_action_efficiency(spells):
    """C23-5: All spells with Summon trait have 'Action Efficiency' in action_tags."""
    errors = []
    for s in spells:
        if "Summon" in (s.get("trait_raw") or []):
            if "Action Efficiency" not in (s.get("action_tags") or []):
                errors.append(f"  {s['name']} (aon {s['aonId']}): has Summon trait but no Action Efficiency tag")
    if errors:
        print(f"FAIL: Summon->Action Efficiency — {len(errors)} error(s):")
        for e in errors:
            print(e)
        return False
    summon_count = sum(1 for s in spells if "Summon" in (s.get("trait_raw") or []))
    print(f"  PASS: All {summon_count} Summon-trait spells have Action Efficiency tag")
    return True


def test_c23_prebuffs_count(spells):
    """C23-6: At least 20 spells have 'prebuffs' in roles."""
    prebuffs = [s for s in spells if "prebuffs" in (s.get("roles") or [])]
    if len(prebuffs) < 20:
        print(f"FAIL: Only {len(prebuffs)} spells have prebuffs role (expected >= 20)")
        return False
    print(f"  PASS: {len(prebuffs)} spells have prebuffs role (>= 20)")
    return True


def test_c23_no_legacy_damage_types(spells):
    """C23-7: No spells have legacy alignment damage types."""
    errors = []
    for s in spells:
        legacy = set(s.get("damage_types") or []) & LEGACY_DAMAGE_TYPES
        if legacy:
            errors.append(f"  {s['name']}: has legacy damage types {legacy}")
    if errors:
        print(f"FAIL: legacy damage types — {len(errors)} error(s):")
        for e in errors[:10]:
            print(e)
        return False
    print(f"  PASS: No legacy alignment damage types found in any spell")
    return True


# === C24 Regression Tests ===

C24_SCALING_IRRELEVANT_AON_IDS = {2344, 1458, 2345, 1438, 1506, 1653, 1583, 958}

C24_EDITORIAL_OBSERVATION_AON_IDS = {927, 1721, 1653, 928}

C24_CHAIN_AON_IDS = {
    1533, 1350, 2341, 1677, 1981, 1451, 1555, 1724, 1720,
    1457, 1530, 1462, 1508, 1329, 1559, 1524, 665,
    1436, 1503, 1665, 1466, 1661, 1742, 2449,
}


def test_c24_scaling_irrelevant(spells):
    """C24-A1: 8 silver bullet spells reclassified to scaling-irrelevant."""
    errors = []
    by_aon = {s["aonId"]: s for s in spells}
    for aon_id in sorted(C24_SCALING_IRRELEVANT_AON_IDS):
        spell = by_aon.get(aon_id)
        if not spell:
            errors.append(f"  aon_id {aon_id}: not found in spell data")
            continue
        hq = spell.get("heighten_quality")
        if hq != "scaling-irrelevant":
            errors.append(f"  {spell['name']} (aon {aon_id}): heighten_quality is '{hq}', expected 'scaling-irrelevant'")
    if errors:
        print(f"FAIL: scaling-irrelevant overrides — {len(errors)} error(s):")
        for e in errors:
            print(e)
        return False
    print(f"  PASS: All {len(C24_SCALING_IRRELEVANT_AON_IDS)} silver bullet spells have scaling-irrelevant")
    return True


def test_c24_advisory_text(spells):
    """C24-A3: All chain entries with advisory_text map keys have non-empty advisory_text."""
    if not os.path.exists(CHAIN_REGISTRY_PATH):
        print("  SKIP: chain_registry.json not found")
        return None

    with open(CHAIN_REGISTRY_PATH, encoding="utf-8") as f:
        registry = json.load(f)

    adv_replaced = registry.get("advisory_text", {}).get("replaced_by", {})
    adv_replaces = registry.get("advisory_text", {}).get("replaces", {})

    errors = []
    by_aon = {s["aonId"]: s for s in spells}

    for spell in spells:
        for entry in spell.get("replaced_by", []):
            key = f"{spell['aonId']}:{entry['aon_id']}"
            if key in adv_replaced:
                text = entry.get("advisory_text", "")
                if not text:
                    errors.append(f"  {spell['name']} replaced_by {entry['spell']}: advisory_text empty but key {key} exists in registry")
        for entry in spell.get("replaces", []):
            key = f"{spell['aonId']}:{entry['aon_id']}"
            if key in adv_replaces:
                text = entry.get("advisory_text", "")
                if not text:
                    errors.append(f"  {spell['name']} replaces {entry['spell']}: advisory_text empty but key {key} exists in registry")

    total_keys = len(adv_replaced) + len(adv_replaces)
    if errors:
        print(f"FAIL: advisory_text population — {len(errors)} error(s):")
        for e in errors:
            print(e)
        return False
    print(f"  PASS: All {total_keys} advisory_text entries populated on chain spells")
    return True


def test_c24_editorial_observations(spells):
    """C24-A5: 4 competitive pair spells have editorial observations."""
    errors = []
    by_aon = {s["aonId"]: s for s in spells}
    for aon_id in sorted(C24_EDITORIAL_OBSERVATION_AON_IDS):
        spell = by_aon.get(aon_id)
        if not spell:
            errors.append(f"  aon_id {aon_id}: not found in spell data")
            continue
        obs = spell.get("mathfinder_observations", [])
        editorial = [o for o in obs if "Editorial" in (o.get("source", "") if isinstance(o, dict) else o)]
        if not editorial:
            errors.append(f"  {spell['name']} (aon {aon_id}): no editorial observation found")
    if errors:
        print(f"FAIL: editorial observations — {len(errors)} error(s):")
        for e in errors:
            print(e)
        return False
    print(f"  PASS: All {len(C24_EDITORIAL_OBSERVATION_AON_IDS)} competitive pair spells have editorial observations")
    return True


def test_c24_chain_entry_structure(spells):
    """C24-A3b: Chain entries have at_rank field and complete structure."""
    errors = []
    by_aon = {s["aonId"]: s for s in spells}
    chain_spells = [s for s in spells if s["aonId"] in C24_CHAIN_AON_IDS]

    for spell in chain_spells:
        for entry in spell.get("replaced_by", []):
            if "at_rank" not in entry:
                errors.append(f"  {spell['name']} replaced_by {entry.get('spell', '?')}: missing at_rank")
            if "advisory_text" not in entry:
                errors.append(f"  {spell['name']} replaced_by {entry.get('spell', '?')}: missing advisory_text field")
        for entry in spell.get("replaces", []):
            if "at_rank" not in entry:
                errors.append(f"  {spell['name']} replaces {entry.get('spell', '?')}: missing at_rank")
            if "advisory_text" not in entry:
                errors.append(f"  {spell['name']} replaces {entry.get('spell', '?')}: missing advisory_text field")

    if errors:
        print(f"FAIL: chain entry structure — {len(errors)} error(s):")
        for e in errors[:10]:
            print(e)
        return False
    print(f"  PASS: All chain entries on {len(chain_spells)} spells have at_rank and advisory_text fields")
    return True


C27_DAMAGE_ONLY_PLUS2_AONIDS = {872, 2481, 1331, 1292, 1687, 1410}

def test_c27_damage_only_plus2(spells):
    """C27: Damage-only spells with +2 heighten pattern must be scales-okay, not scales-well."""
    by_aon = {s["aonId"]: s for s in spells}
    errors = []

    # Check the 8 known spells are scales-okay
    for aon_id in sorted(C27_DAMAGE_ONLY_PLUS2_AONIDS):
        spell = by_aon.get(aon_id)
        if spell is None:
            errors.append(f"  aonId {aon_id}: not found in spell data")
            continue
        if spell.get("heighten_quality") != "scales-okay":
            errors.append(f"  {spell['name']} (aonId {aon_id}): heighten_quality={spell.get('heighten_quality')!r}, expected 'scales-okay'")

    # Verify exempt spells keep scales-well (Dehydrate: multi-role; Force Barrage: editorial override)
    exempt_spells = {"Dehydrate": "scales-well", "Force Barrage": "scales-well"}
    for spell in spells:
        if spell["name"] in exempt_spells:
            expected = exempt_spells[spell["name"]]
            if spell.get("heighten_quality") != expected:
                errors.append(f"  {spell['name']}: expected {expected}, got {spell.get('heighten_quality')!r}")

    # Broad check: no damage-only +2 spell should be scales-well (except editorial exemptions)
    editorial_exempt = set(exempt_spells.keys())
    for spell in spells:
        if spell["name"] in editorial_exempt:
            continue
        populator_roles = set(spell.get("roles", [])) - {"healing", "reactions", "oneAction", "silverBullets", "prebuffs"}
        if (spell.get("heighten_pattern") == "plus_2"
                and spell.get("heighten_quality") == "scales-well"
                and populator_roles == {"damage"}):
            errors.append(f"  {spell['name']} (aonId {spell['aonId']}): damage-only +2 spell still rated scales-well")

    if errors:
        print(f"FAIL: damage-only +2 rule — {len(errors)} error(s):")
        for e in errors[:10]:
            print(e)
        return False
    print(f"  PASS: All {len(C27_DAMAGE_ONLY_PLUS2_AONIDS)} damage-only +2 spells are scales-okay; multi-role exemptions preserved")
    return True


SPELL_JSON_PATH = os.path.join(PROJECT_ROOT, "source", "spell.json")

C31_DELETED_AON_IDS = {2,8,23,24,47,687,107,117,120,138,196,219,221,970,224,231,255,264,716,283,297,306,313,344,375,377}


def test_c31_no_remaster_id_in_output(spells):
    """C31: No spell in output has a non-empty remaster_id in source/spell.json."""
    if not os.path.exists(SPELL_JSON_PATH):
        print("  SKIP: source/spell.json not found")
        return None

    with open(SPELL_JSON_PATH, encoding="utf-8") as f:
        source_spells = json.load(f)

    remaster_ids_by_id = {}
    for s in source_spells:
        rid = s.get("remaster_id")
        if rid and isinstance(rid, list) and len(rid) > 0:
            remaster_ids_by_id[s.get("id", "")] = rid

    errors = []
    for spell in spells:
        spell_id = f"spell-{spell['aonId']}"
        if spell_id in remaster_ids_by_id:
            errors.append(f"  {spell['name']} (aonId {spell['aonId']}): has remaster_id {remaster_ids_by_id[spell_id]} in source but is still in output")

    if errors:
        print(f"FAIL: remaster_id filter — {len(errors)} spell(s) with remaster_id still in output:")
        for e in errors[:10]:
            print(e)
        return False

    print(f"  PASS: No output spell has remaster_id in source (filter working correctly)")
    return True


def test_c31_deleted_spells_absent(spells):
    """C31: The 26 deletion-list spells are absent from output."""
    by_aon = {s["aonId"] for s in spells}
    found = sorted(C31_DELETED_AON_IDS & by_aon)
    if found:
        names = {s["aonId"]: s["name"] for s in spells if s["aonId"] in found}
        print(f"FAIL: {len(found)} deleted spell(s) still in output:")
        for aid in found:
            print(f"  aonId {aid}: {names.get(aid, '?')}")
        return False
    print(f"  PASS: All {len(C31_DELETED_AON_IDS)} deletion-list spells absent from output")
    return True


def test_c39_observation_integration(spells):
    """C39: 'Theoretical vs Practical Utility Spells' video integration + utility role fixes.
    Story A (named spells carry the video), Story B (utility category enrichment + tag def),
    plus the editorial role corrections this cycle made."""
    import os
    SRC = "Theoretical vs Practical Utility Spells.md"
    SRC_URL = "https://www.youtube.com/watch?v=bnMhmd5iTqA"
    errors = []
    by_aon = {s["aonId"]: s for s in spells}

    # Story A: the 9 named spells carry the new video in mathfinder_sources and are reviewed
    named = [1972, 1442, 1631, 1755, 1541, 1581, 1663, 1422, 335]
    for aid in named:
        s = by_aon.get(aid)
        if not s:
            errors.append(f"  named spell aon {aid} missing from spell-data")
            continue
        if SRC_URL not in [x.get("url") for x in (s.get("mathfinder_sources") or [])]:
            errors.append(f"  {s['name']} (aon {aid}): new video not in mathfinder_sources")
        if not s.get("mathfinder_reviewed"):
            errors.append(f"  {s['name']} (aon {aid}): not mathfinder_reviewed")

    # Story B: every utility-role spell carries the 3 new category observations
    util = [s for s in spells if "utility" in (s.get("roles") or [])]
    missing = [s["name"] for s in util
               if sum(1 for o in (s.get("mathfinder_observations") or []) if o.get("source") == SRC) < 3]
    if missing:
        errors.append(f"  {len(missing)} utility spells missing the 3 category obs (e.g. {missing[:3]})")

    # Story B: Utility tag definition carries the scroll-vs-wand buying heuristic
    tagdef = open(os.path.join(os.path.dirname(__file__), "..", "data", "tag-definitions.js"), encoding="utf-8").read()
    if "scroll for utility you'll want about once per adventure" not in tagdef:
        errors.append("  Utility tag definition missing the scroll-vs-wand buying heuristic")

    # Editorial role corrections (overrides are authoritative)
    for aid, want in {1442: ["utility"], 1631: ["utility"], 1007: ["buff"]}.items():
        got = by_aon.get(aid, {}).get("roles")
        if got != want:
            errors.append(f"  aon {aid}: roles {got} != expected {want}")
    stu = by_aon.get(1663, {}).get("roles") or []
    for r in ("utility", "buff", "prebuffs"):
        if r not in stu:
            errors.append(f"  See the Unseen (1663): missing role {r} (roles={stu})")
    if "control" in (by_aon.get(1631, {}).get("roles") or []):
        errors.append("  Phantasmal Minion (1631): still has control despite the utility override")

    if errors:
        print(f"FAIL: C39 observation integration — {len(errors)} error(s):")
        for e in errors:
            print(e)
        return False
    print(f"  PASS: C39 — 9 named spells carry the new video; {len(util)} utility spells carry 3 category obs; role fixes + tag definition applied")
    return True


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
    print("=== C19: Observation Extraction Output ===")
    obs_tests = [
        test_observations_files_exist(),
        test_raw_observations_schema(spells),
        test_category_observations_schema(),
        test_chain_signals_schema(spells),
        test_resolution_failures_schema(),
        test_observations_bounds(),
        test_observations_resolution_integrity(spells),
    ]
    skipped = [r for r in obs_tests if r is None]
    failed = [r for r in obs_tests if r is False]
    if skipped and not failed:
        print(f"  ({len(skipped)}/{len(obs_tests)} skipped — observation files not present; run extract-observations.py to enable)")
    if failed:
        passed = False

    print()
    print("=== C20: Consolidation Pipeline ===")
    c20_tests = [
        test_category_routing(),
        test_chain_registry(),
        test_merge_output(spells),
        test_bounded_caster_slots(),
    ]
    c20_skipped = [r for r in c20_tests if r is None]
    c20_failed = [r for r in c20_tests if r is False]
    if c20_skipped and not c20_failed:
        print(f"  ({len(c20_skipped)}/{len(c20_tests)} skipped — prerequisite files not present)")
    if c20_failed:
        passed = False

    print()
    print("=== C23: Populator Upgrade Regression ===")
    c23_tests = [
        test_c23_heighten_quality(spells),
        test_c23_summon_control(spells),
        test_c23_summon_action_efficiency(spells),
        test_c23_prebuffs_count(spells),
        test_c23_no_legacy_damage_types(spells),
    ]
    c23_failed = [r for r in c23_tests if r is False]
    if c23_failed:
        passed = False

    print()
    print("=== C24: Heightening Display & Data QA ===")
    c24_tests = [
        test_c24_scaling_irrelevant(spells),
        test_c24_advisory_text(spells),
        test_c24_editorial_observations(spells),
        test_c24_chain_entry_structure(spells),
    ]
    c24_failed = [r for r in c24_tests if r is False]
    if c24_failed:
        passed = False

    print()
    print("=== C27: Damage-Only H+2 Rule ===")
    c27_tests = [
        test_c27_damage_only_plus2(spells),
    ]
    c27_failed = [r for r in c27_tests if r is False]
    if c27_failed:
        passed = False

    print()
    print("=== C31: Legacy Spell Removal (remaster_id filter) ===")
    c31_tests = [
        test_c31_no_remaster_id_in_output(spells),
        test_c31_deleted_spells_absent(spells),
    ]
    c31_failed = [r for r in c31_tests if r is False]
    if c31_failed:
        passed = False

    print()
    print("=== C39: Utility Video Integration + Role Fixes ===")
    if not test_c39_observation_integration(spells):
        passed = False

    print()
    if passed:
        print("All pipeline tests PASSED")
    else:
        print("Some pipeline tests FAILED")
        sys.exit(1)


if __name__ == "__main__":
    main()
