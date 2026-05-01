"""
Merge spell.json (full catalog) + curated.json (Mathfinder ratings) → data/spells.js
Outputs a browser-loadable JS file assigning window.SPELL_DATA.

Tag classification follows Mermaid A (Cycle 02 spec):
- Defense: Fort, Ref, Will, AC, Auto derived from saving_throw
- Targeting: ST, AoE (+ Burst/Line/Cone/Area subtypes) from area_type/target
- Action: 1-action, Reaction, 3-action from actions field
- Duration: Sustain-action, Persistent from duration_raw
- Incap: from Incapacitation trait
- Auto-effect: only for offensive spells with no save (role-gated for curated)
"""

import json
import os

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
PROJECT_ROOT = os.path.dirname(SCRIPT_DIR)

SPELL_JSON = os.path.join(PROJECT_ROOT, "source", "spell.json")
CURATED_JSON = os.path.join(PROJECT_ROOT, "data", "curated.json")
OUTPUT_JS = os.path.join(PROJECT_ROOT, "data", "spells.js")

OFFENSIVE_ROLES = {'damage', 'debuff', 'silverBullets'}
AOE_AREA_TYPES = {'burst', 'circle', 'emanation', 'cube', 'cuboid', 'cylinder', 'square'}
DAMAGE_TRAITS = {
    'Fire', 'Cold', 'Electricity', 'Acid', 'Force', 'Void', 'Vitality',
    'Sonic', 'Mental', 'Poison', 'Spirit', 'Light', 'Darkness'
}


def extract_aon_id(spell):
    sid = spell.get("id", "")
    if sid.startswith("spell-"):
        try:
            return int(sid[6:])
        except ValueError:
            pass
    return None


def compute_defense_tag(spell):
    save = spell.get("saving_throw") or ""
    save_lower = save.lower()
    if "fortitude" in save_lower:
        return "Fort"
    if "reflex" in save_lower:
        return "Ref"
    if "will" in save_lower:
        return "Will"
    return None


def compute_targeting_tags(spell):
    tags = []
    area_types = spell.get("area_type") or []
    target = (spell.get("target") or "").lower()

    has_area = False
    for at in area_types:
        at_lower = at.lower()
        if at_lower in ('burst', 'circle', 'emanation', 'cube', 'cuboid', 'cylinder', 'square'):
            tags.append("Burst")
            tags.append("AoE")
            has_area = True
        elif at_lower == 'line':
            tags.append("Line")
            tags.append("AoE")
            has_area = True
        elif at_lower == 'cone':
            tags.append("Cone")
            tags.append("AoE")
            has_area = True
        elif at_lower in ('other', 'varies'):
            tags.append("Area")
            tags.append("AoE")
            has_area = True

    if not has_area and ("1 creature" in target or "1 willing creature" in target):
        tags.append("ST")

    return list(dict.fromkeys(tags))


def compute_action_tag(spell):
    actions_str = (spell.get("actions") or "").lower()
    if "reaction" in actions_str:
        return "Reaction"
    if "three action" in actions_str:
        return "3-action"
    if "single action" in actions_str or actions_str == "1":
        return "1-action"
    return None


def compute_duration_tags(spell):
    tags = []
    duration = (spell.get("duration_raw") or "").lower()
    if "sustain" in duration:
        tags.append("Sustain-action")
    text = (spell.get("text") or "").lower()
    if "persistent" in duration or "persistent damage" in text[:500]:
        tags.append("Persistent")
    return tags


def has_incapacitation(spell):
    traits = spell.get("trait_raw") or []
    return "Incapacitation" in traits


def has_damage_trait(spell):
    traits = set(spell.get("trait_raw") or [])
    return bool(traits & DAMAGE_TRAITS)


def compute_auto_tags(spell):
    """Compute all auto-derivable tags from spell.json data."""
    tags = []

    defense = compute_defense_tag(spell)
    if defense:
        tags.append(defense)

    tags.extend(compute_targeting_tags(spell))

    action = compute_action_tag(spell)
    if action:
        tags.append(action)

    tags.extend(compute_duration_tags(spell))

    if has_incapacitation(spell):
        tags.append("Incap")

    return tags


def slim_spell(spell):
    return {
        "name": spell.get("name", ""),
        "aonId": extract_aon_id(spell),
        "rank": spell.get("level", 0),
        "traditions": [t.lower() for t in spell.get("tradition", [])],
        "traits": spell.get("trait_raw", []),
        "save": spell.get("saving_throw", ""),
        "actions": spell.get("actions", ""),
        "summary": spell.get("summary", ""),
        "rarity": spell.get("rarity", "common"),
        "target": spell.get("target", ""),
        "range": spell.get("range_raw", ""),
        "url": spell.get("url", ""),
        "computedTags": compute_auto_tags(spell),
    }


def build_curated_index(curated_data):
    index_by_aon = {}
    index_by_name = {}

    for tradition, entries in curated_data.get("traditions", {}).items():
        for entry in entries:
            aon_id = entry.get("aonId")
            if aon_id:
                key = (aon_id, tradition)
                if key not in index_by_aon:
                    index_by_aon[key] = []
                index_by_aon[key].append(entry)

            name_key = (entry["name"].lower(), tradition)
            if name_key not in index_by_name:
                index_by_name[name_key] = []
            index_by_name[name_key].append(entry)

    return index_by_aon, index_by_name


SUBTYPE_TAGS = {'Emanation', 'Burst', 'Cone', 'Line', 'Area'}


def augment_aoe_in_curated(curated_data):
    """Ensure curated entries with a subtype tag (Emanation/Burst/Cone/Line/Area)
    also carry the umbrella 'AoE' tag, so the sidebar's Targeting section lights up.

    Per Mermaid A, AoE is the umbrella tag and the subtypes are subordinate.
    Some curated entries pre-date this rule and only carry the subtype.
    """
    added_count = 0
    for tradition, entries in curated_data.get("traditions", {}).items():
        for entry in entries:
            tags = entry.get("tags", [])
            has_subtype = any(t in SUBTYPE_TAGS for t in tags)
            if has_subtype and "AoE" not in tags:
                # Insert AoE right after the first subtype tag for readability
                new_tags = []
                inserted = False
                for t in tags:
                    new_tags.append(t)
                    if not inserted and t in SUBTYPE_TAGS:
                        new_tags.append("AoE")
                        inserted = True
                entry["tags"] = new_tags
                added_count += 1
    return added_count


def fix_auto_effect_in_curated(curated_data):
    """Fix Auto-effect tags in curated entries per Mermaid A.

    Auto-effect should ONLY appear on spells that:
    1. Have save = "Auto" (no save/attack roll)
    2. Are in an offensive role (damage, debuff, silverBullets)

    Buffs, prebuffs, oneAction (unless explicitly tagged by curator),
    and reactions do NOT get Auto-effect.
    """
    fixed_count = 0
    for tradition, entries in curated_data.get("traditions", {}).items():
        for entry in entries:
            tags = entry.get("tags", [])
            if "Auto-effect" not in tags:
                continue

            role = entry.get("role", "")
            save = entry.get("save", "")

            should_have = (save == "Auto" and role in OFFENSIVE_ROLES)

            if not should_have:
                entry["tags"] = [t for t in tags if t != "Auto-effect"]
                fixed_count += 1

    return fixed_count


def main():
    print("Loading spell.json...")
    with open(SPELL_JSON, 'r', encoding='utf-8') as f:
        all_spells = json.load(f)
    print(f"  {len(all_spells)} spells loaded")

    print("Loading curated.json...")
    with open(CURATED_JSON, 'r', encoding='utf-8') as f:
        curated_data = json.load(f)

    print("Fixing Auto-effect tags in curated data...")
    fixed = fix_auto_effect_in_curated(curated_data)
    print(f"  Removed Auto-effect from {fixed} non-offensive curated entries")

    print("Augmenting AoE tag where subtype is present...")
    aoe_added = augment_aoe_in_curated(curated_data)
    print(f"  Added AoE tag to {aoe_added} curated entries")

    curated_by_aon, curated_by_name = build_curated_index(curated_data)
    tag_defs = curated_data.get("tagDefs", {})

    total_curated_matches = 0
    merged = []

    for spell in all_spells:
        slim = slim_spell(spell)
        if slim["aonId"] is None:
            continue

        curated_entries = []
        for tradition in slim["traditions"]:
            key = (slim["aonId"], tradition)
            if key in curated_by_aon:
                curated_entries.extend(curated_by_aon[key])

        if curated_entries:
            slim["curated"] = True
            slim["curatedEntries"] = curated_entries
            total_curated_matches += 1
        else:
            slim["curated"] = False
            no_save = not spell.get("saving_throw")
            if no_save and has_damage_trait(spell):
                slim["computedTags"].insert(0, "Auto")
                slim["computedTags"].append("Auto-effect")

        merged.append(slim)

    merged.sort(key=lambda s: (0 if s["curated"] else 1, s["name"].lower()))

    output = {
        "spells": merged,
        "tagDefs": tag_defs,
        "curatedByTradition": curated_data.get("traditions", {}),
    }

    print(f"\nWriting {OUTPUT_JS}...")
    with open(OUTPUT_JS, 'w', encoding='utf-8') as f:
        f.write("// Auto-generated by tools/merge-spells.py — do not edit manually\n")
        f.write("window.SPELL_DATA = ")
        json.dump(output, f, ensure_ascii=False)
        f.write(";\n")

    file_size = os.path.getsize(OUTPUT_JS) / 1024 / 1024
    print(f"  {len(merged)} spells merged ({total_curated_matches} with curated data)")
    print(f"  File size: {file_size:.1f} MB")
    print("Done.")


if __name__ == "__main__":
    main()
