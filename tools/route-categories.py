"""
Category Observation Router: classifies C19's 129 category observations into
three tiers (deterministic, advice, dropped) per Cycle 20 Part A spec.

Cycle 20 — Part A of the Decision 013 consolidation pipeline.

Usage:
    py tools/route-categories.py --categories data/observations/category_observations.json --spell-data data/spell-data.js [--output data/observations/category_routing.json]
"""

import argparse
import json
import re
import sys
from datetime import datetime, timezone


# --- Custom applies_to → Tier 1 match rules (from spec A1 table) ---
CUSTOM_DETERMINISTIC = {
    "aoe spells": "targeting_subtypes is non-empty",
    "aoe spells at 6+ targets": "targeting_subtypes is non-empty",
    "area damage spells": "targeting_subtypes is non-empty",
    "stationary aoe spells": "targeting_subtypes is non-empty",
    "reaction spells": 'action_tags contains "Reaction"',
    "defensive reactions": 'action_tags contains "Reaction"',
    "attack roll spells": 'defense_tags contains "AC"',
    "single-target spells": 'targeting_tags contains "ST"',
    "single-target two-action spells vs bosses": 'targeting_tags contains "ST"',
    "multi-target spells": 'targeting_tags contains "Multi"',
    "persistent damage": 'special_tags contains "Persist"',
    "persistent damage spells": 'special_tags contains "Persist"',
    "control spells": 'roles contains "control"',
    "debuff spells": 'roles contains "debuff"',
    "heightened spells": 'heighten_pattern is not "none"',
    "heightened +2 spells": 'heighten_pattern is "plus_2"',
    "sustained debuff spells": 'action_tags contains "Sustain-action" AND roles contains "debuff"',
    "auto-effect spells at low ranks": 'defense_tags contains "Auto"',
    "zone control spells": 'roles contains "control" AND targeting_subtypes is non-empty',
    "brute forcing spells": 'defense_tags contains "Auto"',
    "action-efficient spells (reactions, one-action)": 'action_tags contains "Reaction" OR action_tags contains "1-action"',
}

# Normalize keys for matching
CUSTOM_DETERMINISTIC_LOWER = {k.lower(): v for k, v in CUSTOM_DETERMINISTIC.items()}

# --- Tier 3 drops ---
CUSTOM_DROPPED = {
    "underrated spells": "Tautological — which spells?",
    "focus spells": "Out of scope — planner covers rank spells only",
    "10th rank spells": "Single rank, very small population, subjective",
    "spells that substitute for purchased items": "Requires game-economy knowledge outside spell data",
    "defensive spells that replace equipment": "Requires game-economy knowledge outside spell data",
}
CUSTOM_DROPPED_LOWER = {k.lower(): v for k, v in CUSTOM_DROPPED.items()}

# --- Trait value corrections ---
# Some C19 extractions used tradition names or boolean field names as traits.
# These need special routing since they don't appear in trait_raw.
TRAIT_OVERRIDES = {
    "arcane": ('deterministic', 'tradition contains "Arcane"'),
    "primal": ('deterministic', 'tradition contains "Primal"'),
    "occult": ('deterministic', 'tradition contains "Occult"'),
    "divine": ('deterministic', 'tradition contains "Divine"'),
    "basic_save": ('deterministic', 'basic_save is true'),
    "persistent damage": ('advice', None),  # Not a PF2e trait; no field match
}

# --- Tag value corrections ---
# C19 used slightly different tag names than spell-data.js
TAG_OVERRIDES = {
    "summoning": ('advice', None),  # Not in current trait_raw data
    "basic_save": ('deterministic', 'basic_save is true'),
    "sustained": ('deterministic', 'action_tags contains "Sustain-action"'),
    "sustain": ('deterministic', 'action_tags contains "Sustain-action"'),
}

# --- Role value corrections ---
ROLE_OVERRIDES = {
    "silverbullets": ('advice', None),  # Not a role value in spell-data.js
}

# --- Property field mappings ---
SAVE_VALUE_MAP = {
    "fortitude": "Fort",
    "reflex": "Ref",
    "will": "Will",
}

ACTIONS_VALUE_MAP = {
    "1": '"1-action"',
    "reaction": '"Reaction"',
}

ATTACK_TYPE_VALUE_MAP = {
    "spell_attack_roll": '"AC"',
    "save": None,  # Too broad
}


def parse_args():
    parser = argparse.ArgumentParser(description="Route category observations into tiers.")
    parser.add_argument("--categories", required=True, help="Path to category_observations.json")
    parser.add_argument("--spell-data", required=True, help="Path to spell-data.js")
    parser.add_argument("--output", default="data/observations/category_routing.json",
                        help="Output path (default: data/observations/category_routing.json)")
    return parser.parse_args()


def load_spell_data(path):
    with open(path, encoding="utf-8") as f:
        data = f.read()
    lines = data.split("\n", 1)
    rest = lines[1] if lines[0].startswith("//") else data
    prefix = "window.SPELL_SCHEMA = "
    idx = rest.index(prefix)
    json_str = rest[idx + len(prefix):].rstrip().rstrip(";")
    obj = json.loads(json_str)
    return obj["spells"]


def classify_trait(applies_to, obs):
    trait_val = applies_to["trait"]
    override = TRAIT_OVERRIDES.get(trait_val.lower())
    if override:
        tier, rule = override
        if tier == "advice":
            return {"tier": "advice", "reason": f'"{trait_val}" is not a matchable trait in spell-data.js'}
        return {"tier": "deterministic", "match_rule": rule, "match_count": None}
    return {
        "tier": "deterministic",
        "match_rule": f'trait_raw contains "{trait_val}"',
        "match_count": None,
    }


def classify_role(applies_to, obs):
    role_val = applies_to["role"]
    override = ROLE_OVERRIDES.get(role_val.lower())
    if override:
        tier, rule = override
        if tier == "advice":
            return {"tier": "advice", "reason": f'"{role_val}" is not a role value in spell-data.js'}
        return {"tier": "deterministic", "match_rule": rule, "match_count": None}
    return {
        "tier": "deterministic",
        "match_rule": f'roles contains "{role_val}"',
        "match_count": None,
    }


def classify_tag(applies_to, obs):
    tag_val = applies_to["tag"]
    override = TAG_OVERRIDES.get(tag_val.lower())
    if override:
        tier, rule = override
        if tier == "advice":
            return {"tier": "advice", "reason": f'"{tag_val}" tag not found in spell-data.js fields'}
        return {"tier": "deterministic", "match_rule": rule, "match_count": None}
    return {
        "tier": "deterministic",
        "match_rule": f'tag_fields contains "{tag_val}"',
        "match_count": None,
    }


def classify_property(applies_to, obs):
    prop = applies_to.get("property", "")
    val = applies_to.get("value", "")

    if prop == "rank":
        return {
            "tier": "advice",
            "reason": f'rank={val} is relative to character level, not a static spell property',
        }
    if prop == "multimodal":
        return {
            "tier": "advice",
            "reason": 'No multimodal field in spell-data.js',
        }
    if prop == "save":
        mapped = SAVE_VALUE_MAP.get(val.lower(), val.capitalize()[:4])
        return {
            "tier": "deterministic",
            "match_rule": f'defense_tags contains "{mapped}"',
            "match_count": None,
        }
    if prop == "area":
        cap_val = val.capitalize()
        return {
            "tier": "deterministic",
            "match_rule": f'targeting_subtypes contains "{cap_val}"',
            "match_count": None,
        }
    if prop == "actions":
        mapped = ACTIONS_VALUE_MAP.get(val)
        if mapped:
            return {
                "tier": "deterministic",
                "match_rule": f'action_tags contains {mapped}',
                "match_count": None,
            }
        return {"tier": "advice", "reason": f'actions={val} has no clear field mapping'}
    if prop == "attack_type":
        mapped = ATTACK_TYPE_VALUE_MAP.get(val)
        if mapped is None:
            return {
                "tier": "advice",
                "reason": f'attack_type={val} is too broad or unmapped',
            }
        return {
            "tier": "deterministic",
            "match_rule": f'defense_tags contains {mapped}',
            "match_count": None,
        }

    return {"tier": "advice", "reason": f'Unmapped property: {prop}={val}'}


def classify_custom(applies_to, obs):
    custom_val = applies_to["custom"]
    lower = custom_val.lower().strip()

    # Also try without trailing 's' and with 's' for pluralization matching
    variants = [lower]
    if lower.endswith("s"):
        variants.append(lower[:-1])
    else:
        variants.append(lower + "s")

    # Check dropped first
    for v in variants:
        if v in CUSTOM_DROPPED_LOWER:
            return {
                "tier": "dropped",
                "reason": CUSTOM_DROPPED_LOWER[v],
            }

    # Check deterministic mappings
    for v in variants:
        if v in CUSTOM_DETERMINISTIC_LOWER:
            return {
                "tier": "deterministic",
                "match_rule": CUSTOM_DETERMINISTIC_LOWER[v],
                "match_count": None,
            }

    # Also check with "aoe" → "aoe" normalization
    aoe_lower = lower.replace("aoe", "aoe")
    if aoe_lower in CUSTOM_DETERMINISTIC_LOWER:
        return {
            "tier": "deterministic",
            "match_rule": CUSTOM_DETERMINISTIC_LOWER[aoe_lower],
            "match_count": None,
        }

    # Default: advice
    return {
        "tier": "advice",
        "reason": "General spell selection philosophy, not per-spell applicable",
    }


def classify_observation(obs):
    applies_to = obs["applies_to"]
    keys = set(applies_to.keys())

    if "trait" in keys:
        return classify_trait(applies_to, obs)
    elif "role" in keys:
        return classify_role(applies_to, obs)
    elif "tag" in keys:
        return classify_tag(applies_to, obs)
    elif "property" in keys:
        return classify_property(applies_to, obs)
    elif "custom" in keys:
        return classify_custom(applies_to, obs)
    else:
        return {
            "tier": "advice",
            "reason": f"Unknown applies_to structure: {applies_to}",
        }


def evaluate_match_rule(rule, spell):
    """Evaluate a match rule against a single spell. Returns True/False."""
    if " AND " in rule:
        parts = rule.split(" AND ")
        return all(evaluate_match_rule(p.strip(), spell) for p in parts)
    if " OR " in rule:
        parts = rule.split(" OR ")
        return any(evaluate_match_rule(p.strip(), spell) for p in parts)

    # Format: field is true
    m = re.match(r'(\w+) is true', rule)
    if m:
        field = m.group(1)
        return bool(spell.get(field))

    # Format: field contains "value"
    m = re.match(r'(\w+) contains "([^"]+)"', rule)
    if m:
        field, value = m.group(1), m.group(2)
        if field == "tag_fields":
            for f in ["defense_tags", "targeting_tags", "action_tags", "reliability_tags", "special_tags"]:
                val = spell.get(f) or []
                if value in val:
                    return True
            return False
        val = spell.get(field) or []
        if isinstance(val, list):
            return value in val
        return str(val) == value

    # Format: field is non-empty
    m = re.match(r'(\w+) is non-empty', rule)
    if m:
        field = m.group(1)
        val = spell.get(field)
        if isinstance(val, list):
            return len(val) > 0
        return val is not None and val != "" and val != "none"

    # Format: field is not "value"
    m = re.match(r'(\w+) is not "([^"]+)"', rule)
    if m:
        field, value = m.group(1), m.group(2)
        val = spell.get(field, "")
        return str(val) != value

    # Format: field is "value"
    m = re.match(r'(\w+) is "([^"]+)"', rule)
    if m:
        field, value = m.group(1), m.group(2)
        val = spell.get(field, "")
        return str(val) == value

    return False


def fix_match_rule_for_tags(rule):
    """Adjust 'tag fields contain X' to use the specific search logic."""
    if rule.startswith('tag fields contain "'):
        return rule.replace("tag fields contain", "tag_fields contains")
    return rule


def main():
    args = parse_args()

    with open(args.categories, encoding="utf-8") as f:
        cat_data = json.load(f)

    spells = load_spell_data(args.spell_data)
    observations = cat_data["observations"]
    print(f"Loaded {len(observations)} category observations")
    print(f"Loaded {len(spells)} spells from spell-data.js")

    routing = []
    counts = {"deterministic": 0, "advice": 0, "dropped": 0}

    for i, obs in enumerate(observations):
        result = classify_observation(obs)
        entry = {
            "index": i,
            "source": obs["source"],
            "applies_to": obs["applies_to"],
            "observation": obs["observation"],
        }
        entry["tier"] = result["tier"]

        if result["tier"] == "deterministic":
            rule = fix_match_rule_for_tags(result["match_rule"])
            entry["match_rule"] = rule
            entry["match_count"] = result.get("match_count")
        elif result["tier"] == "advice":
            entry["reason"] = result.get("reason", "")
        elif result["tier"] == "dropped":
            entry["reason"] = result["reason"]

        routing.append(entry)
        counts[result["tier"]] += 1

    # Value verification: count matches for all Tier 1 entries
    zero_matches = []
    for entry in routing:
        if entry["tier"] != "deterministic":
            continue
        rule = entry["match_rule"]
        match_count = sum(1 for s in spells if evaluate_match_rule(rule, s))
        entry["match_count"] = match_count
        if match_count == 0:
            zero_matches.append((entry["index"], entry["applies_to"], rule))

    output = {
        "version": "1.0.0",
        "generated": datetime.now(timezone.utc).strftime("%Y-%m-%d"),
        "tier_counts": counts,
        "routing": routing,
    }

    with open(args.output, "w", encoding="utf-8") as f:
        json.dump(output, f, indent=2, ensure_ascii=False)

    print(f"\nTier distribution:")
    print(f"  Deterministic: {counts['deterministic']}")
    print(f"  Advice: {counts['advice']}")
    print(f"  Dropped: {counts['dropped']}")
    print(f"  Total: {sum(counts.values())}")

    if zero_matches:
        print(f"\nWARNING: Zero-match warnings ({len(zero_matches)} Tier 1 entries matched 0 spells):")
        for idx, applies_to, rule in zero_matches:
            print(f"  [{idx}] {applies_to} -> {rule}")

    print(f"\nWrote {args.output}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
