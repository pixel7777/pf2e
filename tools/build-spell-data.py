"""
Build spell-data.js from source/spell.json per Decision 016 schema.

Populates all structured-data fields. Semantic-analysis fields are present
as empty placeholders ([], null, false).

Filter: spell_type == "Spell" AND level >= 1 (excludes Cantrips, Focus, Rituals).
Rename filter (Cycle 05, Decision 018): drop legacy_core entries whose names
appear in data/legacy-renames.json — the remaster equivalent already exists
under its new name. Applied BEFORE era dedupe.
Era dedupe (Cycle 04, Decision 018): when a spell name still appears in both
legacy_core and remaster_core sources, keep only the remaster entry.
Every spell object carries an `era` field (remaster_core | legacy_core | other)
so the frontend can dim/badge/filter legacy content.
"""

import json
import os
import re
import sys
from collections import Counter, defaultdict
from datetime import datetime, timezone

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
PROJECT_ROOT = os.path.dirname(SCRIPT_DIR)
SPELL_JSON = os.path.join(PROJECT_ROOT, "source", "spell.json")
OUTPUT_JS = os.path.join(PROJECT_ROOT, "data", "spell-data.js")
LEGACY_RENAMES_JSON = os.path.join(PROJECT_ROOT, "data", "legacy-renames.json")

VERSION = "0.3.0"

# Era classification by primary_source. Adventure paths and Lost Omens books
# fall into "other" — they are not deduped against core entries.
LEGACY_SOURCES = {
    "Core Rulebook",
    "Advanced Player's Guide",
    "Secrets of Magic",
    "Dark Archive",
    "Book of the Dead",
    "Guns & Gears",
    "Gods & Magic",
}
REMASTER_SOURCES = {
    "Player Core", "Player Core 2", "GM Core", "Monster Core",
    "Howl of the Wild", "War of Immortals",
    "Divine Mysteries", "Dark Archives (Remastered)",
    "Rage of Elements",
}


def era(spell):
    ps = spell.get("primary_source", "") or ""
    if ps in REMASTER_SOURCES:
        return "remaster_core"
    if ps in LEGACY_SOURCES:
        return "legacy_core"
    return "other"


def load_rename_map():
    """Load data/legacy-renames.json. Returns a dict keyed by lowercased old_name,
    plus the raw entry list for logging.
    """
    with open(LEGACY_RENAMES_JSON, "r", encoding="utf-8") as f:
        entries = json.load(f)

    seen = set()
    by_old_lower = {}
    for entry in entries:
        for field in ("old_name", "new_name", "status"):
            if field not in entry:
                raise ValueError("legacy-renames.json entry missing field %r: %r" % (field, entry))
        key = entry["old_name"].lower()
        if key in seen:
            raise ValueError("legacy-renames.json: duplicate old_name %r" % entry["old_name"])
        seen.add(key)
        by_old_lower[key] = entry
    return by_old_lower, entries


def apply_rename_filter(rank_spells, rename_map):
    """Drop legacy_core entries whose names appear in the rename map, but only
    if a spell with the corresponding new_name actually exists in the dataset.

    Returns (kept_spells, dropped, warnings, unmatched).
      dropped: list of (old_name, new_name, status, dropped_id) tuples
      warnings: list of strings (new_name missing — kept the entry)
      unmatched: list of old_names that didn't match any spell at all
                 (expected for cantrips/focus spells/rituals not in rank set)
    """
    names_present_lower = {s.get("name", "").lower() for s in rank_spells}

    kept = []
    dropped = []
    warnings = []
    matched_old_names = set()

    for spell in rank_spells:
        name_lower = spell.get("name", "").lower()
        entry = rename_map.get(name_lower)
        if entry is None:
            kept.append(spell)
            continue
        # Name matched — but only act on legacy_core entries.
        if era(spell) != "legacy_core":
            kept.append(spell)
            matched_old_names.add(name_lower)
            continue
        # Verify the new_name exists before dropping.
        if entry["new_name"].lower() not in names_present_lower:
            warnings.append(
                "rename target missing for %r → %r (%s); keeping legacy entry %s" % (
                    entry["old_name"], entry["new_name"], entry["status"], spell.get("id", "?"),
                )
            )
            kept.append(spell)
            matched_old_names.add(name_lower)
            continue
        dropped.append((entry["old_name"], entry["new_name"], entry["status"], spell.get("id", "")))
        matched_old_names.add(name_lower)

    unmatched = sorted(
        rename_map[k]["old_name"]
        for k in rename_map.keys()
        if k not in matched_old_names
    )
    return kept, dropped, warnings, unmatched


def dedupe_by_era(rank_spells):
    """For each spell name with duplicates, prefer remaster_core > legacy_core > other.
    Within the same era, prefer the highest aonId (most recently added).

    Returns (kept_spells, dropped_summary) where dropped_summary is a list of
    (name, dropped_id, kept_id, era_dropped, era_kept) tuples.
    """
    by_name = defaultdict(list)
    for s in rank_spells:
        by_name[s.get("name", "")].append(s)

    era_priority = {"remaster_core": 2, "legacy_core": 1, "other": 0}

    def aon_int(s):
        sid = s.get("id", "") or ""
        if sid.startswith("spell-"):
            try:
                return int(sid[6:])
            except ValueError:
                return 0
        return 0

    kept = []
    dropped = []
    for name, group in by_name.items():
        if len(group) == 1:
            kept.append(group[0])
            continue
        # Sort: highest era_priority first, then highest aonId first
        ranked = sorted(group, key=lambda s: (-era_priority[era(s)], -aon_int(s)))
        winner = ranked[0]
        kept.append(winner)
        for loser in ranked[1:]:
            dropped.append((
                name,
                loser.get("id", ""),
                winner.get("id", ""),
                era(loser),
                era(winner),
            ))
    return kept, dropped


def extract_aon_id(spell):
    sid = spell.get("id", "")
    if sid.startswith("spell-"):
        try:
            return int(sid[6:])
        except ValueError:
            pass
    return None


def compute_defense_tags(spell):
    tags = []
    st = (spell.get("saving_throw") or "").lower()
    traits = spell.get("trait_raw") or []
    if "fortitude" in st:
        tags.append("Fort")
    if "reflex" in st:
        tags.append("Ref")
    if "will" in st:
        tags.append("Will")
    if "ac" in st or "Attack" in traits:
        tags.append("AC")
    return tags


def compute_targeting_tags(spell):
    tags = []
    area_types = spell.get("area_type") or []
    target = spell.get("target") or ""
    trait_raw = spell.get("trait_raw") or []
    spell_name = spell.get("name") or ""
    is_wall = spell_name.startswith("Wall of")

    if area_types or is_wall:
        tags.append("Multi")

    if re.search(r"\b1 (creature|willing creature|living creature|creature or object)\b", target, re.IGNORECASE):
        tags.append("ST")
    elif re.search(r"\bthe triggering creature\b", target, re.IGNORECASE):
        tags.append("ST")

    return tags


def compute_targeting_subtypes(spell):
    subtypes = []
    area_types = spell.get("area_type") or []
    trait_raw = spell.get("trait_raw") or []
    spell_name = spell.get("name") or ""

    for at in area_types:
        at_lower = at.lower()
        if "burst" in at_lower:
            subtypes.append("Burst")
        if "cone" in at_lower:
            subtypes.append("Cone")
        if "line" in at_lower:
            subtypes.append("Line")
        if "emanation" in at_lower:
            subtypes.append("Emanation")
        if "wall" in at_lower:
            subtypes.append("Wall")
        if "cylinder" in at_lower:
            subtypes.append("Cylinder")
        if at_lower in ("square", "cube", "cuboid"):
            subtypes.append("Cube")

    if not subtypes and spell_name.startswith("Wall of"):
        subtypes.append("Wall")

    return list(dict.fromkeys(subtypes))


def compute_basic_save(spell):
    return "basic" in (spell.get("saving_throw") or "").lower()


def compute_st_incap(spell, targeting_tags):
    traits = spell.get("trait_raw") or []
    return (
        "Incapacitation" in traits
        and "ST" in targeting_tags
        and "Multi" not in targeting_tags
    )


def compute_action_tags(spell):
    tags = []
    actions = (spell.get("actions") or "").lower()
    duration = (spell.get("duration_raw") or "").lower()
    if "reaction" in actions:
        tags.append("Reaction")
    if "single action" in actions:
        tags.append("1-action")
    if "three action" in actions:
        tags.append("3-action")
    if "sustain" in duration:
        tags.append("Sustain-action")
    return tags


def compute_heighten_pattern(spell):
    h = spell.get("heighten") or []
    if not h:
        return "none"
    if h[0].startswith("+"):
        return "plus_" + h[0][1:]
    return "fixed"


def compute_roles(spell):
    roles = []
    traits = spell.get("trait_raw") or []
    actions = spell.get("actions") or ""
    if "Healing" in traits:
        roles.append("healing")
    if "Reaction" in actions:
        roles.append("reactions")
    if "Single Action" in actions:
        roles.append("oneAction")
    return roles


def compute_special_tags(spell):
    tags = []
    traits = spell.get("trait_raw") or []
    if "Healing" in traits:
        tags.append("Healing")
    return tags


def compute_reliability_tags(basic_save):
    tags = []
    if basic_save:
        tags.append("Success-effect")
    return tags


def build_spell_object(spell):
    aon_id = extract_aon_id(spell)
    if aon_id is None:
        return None

    defense_tags = compute_defense_tags(spell)
    targeting_tags = compute_targeting_tags(spell)
    targeting_subtypes = compute_targeting_subtypes(spell)
    basic_save = compute_basic_save(spell)
    st_incap = compute_st_incap(spell, targeting_tags)
    action_tags = compute_action_tags(spell)
    heighten_pattern = compute_heighten_pattern(spell)
    roles = compute_roles(spell)
    special_tags = compute_special_tags(spell)
    reliability_tags = compute_reliability_tags(basic_save)

    return {
        "aonId": aon_id,
        "name": spell.get("name", ""),
        "native_rank": spell.get("level", 0),
        "tradition": spell.get("tradition") or [],
        "rarity": spell.get("rarity", "Common"),
        "url": spell.get("url", ""),
        "era": era(spell),
        "roles": roles,
        "defense_tags": defense_tags,
        "targeting_tags": targeting_tags,
        "targeting_subtypes": targeting_subtypes,
        "damage_types": [],
        "conditions_imposed": [],
        "conditions_by_outcome": None,
        "weaknesses_imposed": [],
        "reliability_tags": reliability_tags,
        "basic_save": basic_save,
        "st_incap": st_incap,
        "action_tags": action_tags,
        "special_tags": special_tags,
        "heighten_pattern": heighten_pattern,
        "heighten_raw": spell.get("heighten") or [],
        "heighten_ranks": spell.get("heighten_level") or [],
        "heighten_quality": None,
        "replaced_by": None,
        "replaces": None,
        "mathfinder_observations": None,
        "mathfinder_summary": None,
        "mathfinder_reviewed": False,
        "curated": False,
    }


def print_verify_stats(spell_objects):
    print("\n=== Verification Stats ===\n")

    print("Total spells: %d" % len(spell_objects))

    rank_counts = Counter(s["native_rank"] for s in spell_objects)
    print("\nSpells per rank:")
    for r in sorted(rank_counts):
        print("  Rank %d: %d" % (r, rank_counts[r]))

    trad_counts = Counter()
    for s in spell_objects:
        for t in s["tradition"]:
            trad_counts[t] += 1
    print("\nSpells per tradition:")
    for t in sorted(trad_counts):
        print("  %s: %d" % (t, trad_counts[t]))

    era_counts = Counter(s["era"] for s in spell_objects)
    print("\nEra distribution:")
    for e in sorted(era_counts):
        print("  %s: %d" % (e, era_counts[e]))

    pattern_counts = Counter(s["heighten_pattern"] for s in spell_objects)
    print("\nHeighten patterns:")
    for p in sorted(pattern_counts):
        print("  %s: %d" % (p, pattern_counts[p]))

    role_counts = Counter()
    for s in spell_objects:
        for r in s["roles"]:
            role_counts[r] += 1
    print("\nAuto-derived roles:")
    for r in sorted(role_counts):
        print("  %s: %d" % (r, role_counts[r]))

    defense_counts = Counter()
    for s in spell_objects:
        for d in s["defense_tags"]:
            defense_counts[d] += 1
    print("\nDefense tags:")
    for d in sorted(defense_counts):
        print("  %s: %d" % (d, defense_counts[d]))

    targeting_counts = Counter()
    for s in spell_objects:
        for t in s["targeting_tags"]:
            targeting_counts[t] += 1
    print("\nTargeting tags:")
    for t in sorted(targeting_counts):
        print("  %s: %d" % (t, targeting_counts[t]))

    action_counts = Counter()
    for s in spell_objects:
        for a in s["action_tags"]:
            action_counts[a] += 1
    print("\nAction tags:")
    for a in sorted(action_counts):
        print("  %s: %d" % (a, action_counts[a]))

    special_counts = Counter()
    for s in spell_objects:
        for t in s["special_tags"]:
            special_counts[t] += 1
    print("\nSpecial tags:")
    for t in sorted(special_counts):
        print("  %s: %d" % (t, special_counts[t]))

    print("\nBasic save: %d" % sum(1 for s in spell_objects if s["basic_save"]))
    print("ST Incap: %d" % sum(1 for s in spell_objects if s["st_incap"]))
    print("Success-effect (from basic save): %d" % sum(1 for s in spell_objects if "Success-effect" in s["reliability_tags"]))


def spot_check(spell_objects):
    by_name = {s["name"]: s for s in spell_objects}
    checks = ["Fireball", "Fear", "Heal", "Wall of Stone", "Fly"]
    print("\n=== Spot Check ===\n")
    for name in checks:
        s = by_name.get(name)
        if not s:
            print("WARNING: %s not found!" % name)
            continue
        print("%s (aonId=%d, rank=%d):" % (s["name"], s["aonId"], s["native_rank"]))
        print("  tradition=%s rarity=%s" % (s["tradition"], s["rarity"]))
        print("  defense_tags=%s targeting_tags=%s targeting_subtypes=%s" % (s["defense_tags"], s["targeting_tags"], s["targeting_subtypes"]))
        print("  basic_save=%s st_incap=%s reliability_tags=%s" % (s["basic_save"], s["st_incap"], s["reliability_tags"]))
        print("  action_tags=%s roles=%s special_tags=%s" % (s["action_tags"], s["roles"], s["special_tags"]))
        print("  heighten_pattern=%s heighten_raw=%s heighten_ranks=%s" % (s["heighten_pattern"], s["heighten_raw"], s["heighten_ranks"]))
        print("  curated=%s mathfinder_reviewed=%s" % (s["curated"], s["mathfinder_reviewed"]))
        print()


def main():
    verify_mode = "--verify" in sys.argv

    print("Loading source/spell.json...")
    with open(SPELL_JSON, "r", encoding="utf-8") as f:
        all_spells = json.load(f)
    print("  %d total spells loaded" % len(all_spells))

    rank_spells = [
        s for s in all_spells
        if s.get("spell_type") == "Spell" and s.get("level", 0) >= 1
    ]
    print("  %d rank spells after filtering (spell_type='Spell', level>=1)" % len(rank_spells))
    print("  Excluded: %d cantrips, %d focus spells" % (
        sum(1 for s in all_spells if s.get("spell_type") == "Cantrip"),
        sum(1 for s in all_spells if s.get("spell_type") == "Focus"),
    ))

    print("\nLoading data/legacy-renames.json...")
    rename_map, rename_entries = load_rename_map()
    print("  %d rename entries loaded" % len(rename_entries))

    pre_rename_count = len(rank_spells)
    rank_spells, rename_dropped, rename_warnings, rename_unmatched = apply_rename_filter(rank_spells, rename_map)
    print("  %d -> %d after rename filter (%d legacy entries dropped)" % (
        pre_rename_count, len(rank_spells), len(rename_dropped),
    ))
    if rename_warnings:
        print("  WARNINGS (new_name missing — entry kept):")
        for w in rename_warnings:
            print("    " + w)
    if rename_unmatched:
        print("  Unmatched old_names (expected — focus/cantrip/ritual not in rank set, or already absent):")
        print("    %d entries: %s" % (len(rename_unmatched), ", ".join(rename_unmatched[:8]) + ("..." if len(rename_unmatched) > 8 else "")))

    pre_count = len(rank_spells)
    rank_spells, dropped = dedupe_by_era(rank_spells)
    print("  %d -> %d after era dedupe (%d duplicates dropped)" % (pre_count, len(rank_spells), len(dropped)))
    drop_eras = Counter("%s -> %s" % (d_era, k_era) for (_, _, _, d_era, k_era) in dropped)
    for transition, n in drop_eras.most_common():
        print("    %s: %d" % (transition, n))

    spell_objects = []
    skipped = 0
    for spell in rank_spells:
        obj = build_spell_object(spell)
        if obj is None:
            skipped += 1
            continue
        spell_objects.append(obj)

    if skipped:
        print("  WARNING: skipped %d spells with no parseable aonId" % skipped)

    spell_objects.sort(key=lambda s: (s["native_rank"], s["name"].lower()))

    if verify_mode:
        print_verify_stats(spell_objects)
        spot_check(spell_objects)
        return

    output = {
        "version": VERSION,
        "generated": datetime.now(timezone.utc).isoformat(),
        "spellCount": len(spell_objects),
        "spells": spell_objects,
        "chainRegistry": {},
        "categoryObservations": [],
    }

    print("\nWriting %s..." % OUTPUT_JS)
    with open(OUTPUT_JS, "w", encoding="utf-8") as f:
        f.write("// Auto-generated by tools/build-spell-data.py — do not edit manually\n")
        f.write("window.SPELL_SCHEMA = ")
        json.dump(output, f, ensure_ascii=False, indent=None)
        f.write(";\n")

    file_size = os.path.getsize(OUTPUT_JS) / 1024 / 1024
    print("  %d spells written" % len(spell_objects))
    print("  File size: %.1f MB" % file_size)
    print("Done.")

    spot_check(spell_objects)


if __name__ == "__main__":
    main()
