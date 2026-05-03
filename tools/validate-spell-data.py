"""
Validator: cross-field consistency checks over data/spell-data.js.

No LLM calls. Pure logic. Runs in seconds. Per Cycle 04 spec.

Hard rules FAIL → indicate bad analysis. Soft rules WARN → review candidates.
"""

import argparse
import json
import os
import sys
from collections import Counter

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
PROJECT_ROOT = os.path.dirname(SCRIPT_DIR)
SPELL_DATA_PATH = os.path.join(PROJECT_ROOT, "data", "spell-data.js")

VALID_DAMAGE_TYPES = {
    "Fire", "Cold", "Elec", "Acid", "Force", "Sonic",
    "Void", "Vitality", "Spirit", "Mental", "Poison",
    "Bludg", "Pierc", "Slash", "Bleed", "Varies", "Unspecified",
}

VALID_ROLES = {
    "damage", "debuff", "buff", "healing", "control", "utility",
    "silverBullets", "reactions", "oneAction", "prebuffs",
}

COMBAT_ROLES = {"damage", "debuff", "control"}


def load_spell_data():
    with open(SPELL_DATA_PATH, "r", encoding="utf-8") as f:
        content = f.read()
    body = content.split("\n", 1)[1]
    prefix = "window.SPELL_SCHEMA = "
    return json.loads(body[len(prefix):-2])


def label(spell):
    return "%s [aonId=%s, rank=%s]" % (spell.get("name", "?"), spell.get("aonId"), spell.get("native_rank"))


# ------------------------------------------------------- hard rules ------

def hard_rule_1(spell):
    """damage_types non-empty → 'damage' in roles."""
    if spell.get("damage_types") and "damage" not in spell.get("roles", []):
        return False, "has damage_types %s but no 'damage' role" % spell["damage_types"]
    return True, None


def hard_rule_2(spell):
    """conditions at failure or success → 'debuff' in roles."""
    cbo = spell.get("conditions_by_outcome")
    if cbo is None:
        return True, None
    if cbo.get("failure") or cbo.get("success"):
        if "debuff" not in spell.get("roles", []):
            return False, "imposes conditions at success/failure but no 'debuff' role"
    return True, None


def hard_rule_3(spell):
    """conditions_imposed must equal deduplicated union of conditions_by_outcome."""
    cbo = spell.get("conditions_by_outcome")
    if cbo is None:
        if spell.get("conditions_imposed"):
            return False, "conditions_imposed is non-empty but conditions_by_outcome is null"
        return True, None
    union = set()
    for v in cbo.values():
        union.update(v)
    if set(spell.get("conditions_imposed", [])) != union:
        return False, "conditions_imposed (%s) != union(conditions_by_outcome)=%s" % (
            spell.get("conditions_imposed"), sorted(union))
    return True, None


def hard_rule_4(spell):
    """defense_tags empty → conditions_by_outcome=null AND damage_types=[] AND conditions_imposed=[]."""
    if spell.get("defense_tags"):
        return True, None
    issues = []
    if spell.get("conditions_by_outcome") is not None:
        issues.append("conditions_by_outcome is not null")
    if spell.get("damage_types"):
        issues.append("damage_types is non-empty: %s" % spell["damage_types"])
    if spell.get("conditions_imposed"):
        issues.append("conditions_imposed is non-empty: %s" % spell["conditions_imposed"])
    if issues:
        return False, "no defense_tags but " + "; ".join(issues)
    return True, None


def hard_rule_5(spell):
    """'Auto' in defense_tags → 'Auto-effect' in reliability_tags."""
    if "Auto" in spell.get("defense_tags", []):
        if "Auto-effect" not in spell.get("reliability_tags", []):
            return False, "has Auto defense tag but no Auto-effect reliability tag"
    return True, None


def hard_rule_6(spell):
    """basic_save=true → 'Success-effect' in reliability_tags."""
    if spell.get("basic_save"):
        if "Success-effect" not in spell.get("reliability_tags", []):
            return False, "basic_save=true but no Success-effect reliability tag"
    return True, None


def hard_rule_7(spell):
    """Every value in damage_types must be from the valid set."""
    invalid = [t for t in spell.get("damage_types", []) if t not in VALID_DAMAGE_TYPES]
    if invalid:
        return False, "invalid damage_types: %s" % invalid
    return True, None


def hard_rule_8(spell):
    """Every value in roles must be from the valid set."""
    invalid = [r for r in spell.get("roles", []) if r not in VALID_ROLES]
    if invalid:
        return False, "invalid roles: %s" % invalid
    return True, None


def hard_rule_9(spell):
    """Every spell must have at least one role."""
    if not spell.get("roles"):
        return False, "no roles assigned"
    return True, None


def hard_rule_10(spell):
    """heighten_pattern='none' → heighten_quality='no-heighten'."""
    if spell.get("heighten_pattern") == "none":
        if spell.get("heighten_quality") != "no-heighten":
            return False, "heighten_pattern=none but heighten_quality=%r" % spell.get("heighten_quality")
    return True, None


def hard_rule_11(spell):
    """'Auto' in defense_tags → spell must have at least one combat role."""
    if "Auto" in spell.get("defense_tags", []):
        if not (set(spell.get("roles", [])) & COMBAT_ROLES):
            return False, "Auto defense tag but no combat role (damage/debuff/control)"
    return True, None


def hard_rule_12(spell):
    """weaknesses_imposed must be present and a valid array of damage types."""
    wi = spell.get("weaknesses_imposed")
    if wi is None:
        return False, "weaknesses_imposed field is missing"
    if not isinstance(wi, list):
        return False, "weaknesses_imposed is not a list"
    invalid = [t for t in wi if t not in VALID_DAMAGE_TYPES]
    if invalid:
        return False, "invalid weaknesses_imposed types: %s" % invalid
    return True, None


def hard_rule_13(spell):
    """defense_tags empty → weaknesses_imposed must be []."""
    if not spell.get("defense_tags") and spell.get("weaknesses_imposed"):
        return False, "no defense_tags but weaknesses_imposed is non-empty: %s" % spell["weaknesses_imposed"]
    return True, None


HARD_RULES = [
    (1, "damage_types non-empty implies 'damage' role", hard_rule_1),
    (2, "conditions at success/failure imply 'debuff' role", hard_rule_2),
    (3, "conditions_imposed equals union of conditions_by_outcome", hard_rule_3),
    (4, "no defense_tags implies no offense fields", hard_rule_4),
    (5, "Auto defense implies Auto-effect reliability", hard_rule_5),
    (6, "basic_save implies Success-effect reliability", hard_rule_6),
    (7, "all damage_types are valid", hard_rule_7),
    (8, "all roles are valid", hard_rule_8),
    (9, "every spell has at least one role", hard_rule_9),
    (10, "heighten_pattern=none implies heighten_quality=no-heighten", hard_rule_10),
    (11, "Auto defense requires a combat role", hard_rule_11),
    (12, "weaknesses_imposed is valid array of damage types", hard_rule_12),
    (13, "no defense_tags implies no weaknesses_imposed", hard_rule_13),
]


# ------------------------------------------------------- soft rules ------

def soft_rule_12(spell):
    if spell.get("damage_types") and spell.get("conditions_imposed"):
        roles = set(spell.get("roles", []))
        if not ({"damage", "debuff"} <= roles):
            return False, "damage_types + conditions but missing damage or debuff role: roles=%s" % sorted(roles)
    return True, None


def soft_rule_13(spell):
    if "Healing" in spell.get("special_tags", []):
        if "healing" not in spell.get("roles", []):
            return False, "Healing tag but no healing role"
    return True, None


def soft_rule_14(spell):
    pattern = spell.get("heighten_pattern", "")
    if pattern.startswith("plus_") and spell.get("heighten_quality") == "no-heighten":
        return False, "scaling pattern %s but heighten_quality=no-heighten" % pattern
    return True, None


def soft_rule_15(spell):
    cbo = spell.get("conditions_by_outcome")
    if cbo is not None:
        if not any(cbo.get(k) for k in ("critical_success", "success", "failure", "critical_failure")):
            return False, "conditions_by_outcome is not null but all outcome arrays are empty"
    return True, None


def soft_rule_16(spell):
    """prebuffs role implies duration ≥10 minutes. We can't reliably parse duration_raw here
    since it lives only in spell.json, not spell-data.js. Skipped — flagged as informational."""
    # The validator only sees spell-data.js; duration_raw is not propagated. Treat this as
    # a no-op rule and document in the build log as a future enhancement.
    return True, None


def soft_rule_17_aggregate(spells):
    """Statistical: no single role accounts for >40% of all spells."""
    role_counts = Counter()
    for s in spells:
        for r in s.get("roles", []):
            role_counts[r] += 1
    threshold = 0.40 * len(spells)
    over = []
    for role, count in role_counts.items():
        if count > threshold:
            over.append((role, count, count / len(spells)))
    return over, role_counts


def soft_rule_18_aggregate(spells):
    """Damage type distribution: Fire should be the most common energy type."""
    dt_counts = Counter()
    for s in spells:
        for t in s.get("damage_types", []):
            dt_counts[t] += 1
    energy_types = ["Fire", "Cold", "Elec", "Acid", "Force", "Sonic"]
    energy_counts = [(t, dt_counts.get(t, 0)) for t in energy_types]
    energy_counts.sort(key=lambda x: -x[1])
    fire_is_top = bool(energy_counts) and energy_counts[0][0] == "Fire"
    return fire_is_top, dt_counts, energy_counts


def soft_rule_19(spell):
    if "damage" in spell.get("roles", []) and spell.get("defense_tags"):
        if not spell.get("damage_types"):
            return False, "damage role + defense_tags but no damage_types"
    return True, None


def soft_rule_20(spell):
    """weaknesses_imposed non-empty implies debuff role."""
    if spell.get("weaknesses_imposed") and "debuff" not in spell.get("roles", []):
        return False, "weaknesses_imposed=%s but no debuff role" % spell["weaknesses_imposed"]
    return True, None


PER_SPELL_SOFT_RULES = [
    (14, "damage+condition spell should have both damage and debuff roles", soft_rule_12),
    (15, "Healing tag implies healing role", soft_rule_13),
    (16, "scaling pattern with no-heighten quality", soft_rule_14),
    (17, "non-null conditions_by_outcome should have at least one populated outcome", soft_rule_15),
    (18, "prebuffs role implies duration ≥10 minutes (skipped — duration not in spell-data.js)", soft_rule_16),
    (19, "damage role with defense_tags should have damage_types", soft_rule_19),
    (20, "weaknesses_imposed non-empty implies debuff role", soft_rule_20),
]


# ------------------------------------------------------- main ------------

def main():
    p = argparse.ArgumentParser()
    p.add_argument("--verbose", action="store_true", help="Print passing checks too")
    args = p.parse_args()

    data = load_spell_data()
    spells = data["spells"]

    print("=== Spell Data Validation Report ===")
    print("Spells checked: %d" % len(spells))
    print()

    # Hard rules
    hard_results = {n: {"pass": 0, "fail": [], "title": title} for (n, title, _) in HARD_RULES}
    for spell in spells:
        for n, title, fn in HARD_RULES:
            ok, msg = fn(spell)
            if ok:
                hard_results[n]["pass"] += 1
            else:
                hard_results[n]["fail"].append((label(spell), msg))

    hard_fail_total = sum(len(r["fail"]) for r in hard_results.values())
    hard_pass_rules = sum(1 for r in hard_results.values() if not r["fail"])
    print("Hard rules: %d checked, %d FAIL violations across %d spells, %d/%d rules clean" % (
        len(HARD_RULES), hard_fail_total, hard_fail_total, hard_pass_rules, len(HARD_RULES)))

    for n, info in sorted(hard_results.items()):
        if info["fail"]:
            print("  Rule %d (%s): %d violations" % (n, info["title"], len(info["fail"])))
            for lbl, msg in info["fail"][:10]:
                print("    %s: %s" % (lbl, msg))
            if len(info["fail"]) > 10:
                print("    ... and %d more" % (len(info["fail"]) - 10))
        elif args.verbose:
            print("  Rule %d (%s): PASS (%d spells)" % (n, info["title"], info["pass"]))

    # Per-spell soft rules
    print()
    soft_results = {n: {"pass": 0, "warn": [], "title": title} for (n, title, _) in PER_SPELL_SOFT_RULES}
    for spell in spells:
        for n, title, fn in PER_SPELL_SOFT_RULES:
            ok, msg = fn(spell)
            if ok:
                soft_results[n]["pass"] += 1
            else:
                soft_results[n]["warn"].append((label(spell), msg))

    # Aggregate soft rules
    rule_17_over, role_counts = soft_rule_17_aggregate(spells)
    rule_18_top, dt_counts, energy_counts = soft_rule_18_aggregate(spells)

    soft_warn_total = sum(len(r["warn"]) for r in soft_results.values())
    if rule_17_over:
        soft_warn_total += len(rule_17_over)
    if not rule_18_top and dt_counts:
        soft_warn_total += 1

    print("Soft rules: %d total warnings" % soft_warn_total)
    for n, info in sorted(soft_results.items()):
        if info["warn"]:
            print("  Rule %d (%s): %d warnings" % (n, info["title"], len(info["warn"])))
            for lbl, msg in info["warn"][:10]:
                print("    %s: %s" % (lbl, msg))
            if len(info["warn"]) > 10:
                print("    ... and %d more" % (len(info["warn"]) - 10))
        elif args.verbose:
            print("  Rule %d (%s): PASS" % (n, info["title"]))

    if rule_17_over:
        print("  Rule 17 (no role >40%%):")
        for role, count, pct in rule_17_over:
            print("    %s: %d spells (%.1f%%)" % (role, count, pct * 100))
    elif args.verbose:
        print("  Rule 17 (no role >40%%): PASS")

    if dt_counts:
        if rule_18_top:
            if args.verbose:
                print("  Rule 18 (Fire is top energy type): PASS — %s" % energy_counts)
        else:
            print("  Rule 18 (Fire is top energy type): WARN")
            print("    Energy types: %s" % energy_counts)

    # Statistics
    print()
    print("=== Statistics ===")
    print("Roles: %s" % ", ".join("%s=%d" % (r, c) for r, c in sorted(role_counts.items(), key=lambda x: -x[1])))
    print("Damage types: %s" % ", ".join("%s=%d" % (t, c) for t, c in sorted(dt_counts.items(), key=lambda x: -x[1])))

    cond_counts = Counter()
    for s in spells:
        for c in s.get("conditions_imposed", []):
            cond_counts[c] += 1
    print("Top conditions: %s" % ", ".join("%s=%d" % (c, n) for c, n in cond_counts.most_common(15)))

    auto_count = sum(1 for s in spells if "Auto" in s.get("defense_tags", []))
    print("Spells with Auto defense tag: %d" % auto_count)

    hq_counts = Counter(s.get("heighten_quality") for s in spells)
    print("heighten_quality breakdown: %s" % dict(hq_counts))

    cbo_count = sum(1 for s in spells if s.get("conditions_by_outcome") is not None)
    print("Spells with conditions_by_outcome populated: %d" % cbo_count)

    print()
    if hard_fail_total == 0:
        print("[OK] All hard rules PASS.")
    else:
        print("[FAIL] %d hard-rule violations -- see above." % hard_fail_total)
        sys.exit(1)


if __name__ == "__main__":
    main()
