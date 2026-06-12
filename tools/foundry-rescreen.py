#!/usr/bin/env python3
"""Foundry VTT verification oracle — report-only rescreen of spell-data.js.

Cross-checks our catalog against structured data from the Foundry VTT pf2e system
(github.com/foundryvtt/pf2e), an independent oracle that breaks the LLM-checking-LLM
correlated-error loop. Introduced by Cycle 40; design + lane precision measurements in
`Apps/PF2e Spell Planner/Research/Foundry VTT Verification Oracle — Spike Results.md`.

REPORT-ONLY: this tool never edits anything and is not wired into the test suite
(same status as validate-spell-data.py). Flagged rows are leads for human/editorial
adjudication — the oracle itself has known errors and known coverage gaps.

Usage:
    py tools/foundry-rescreen.py                # rescreen against vendored extract
    py tools/foundry-rescreen.py --extract DIR  # refresh tools/foundry-extract.json
                                                # from a sparse clone of foundryvtt/pf2e

Refresh procedure (manual, rare — same cadence as source/spell.json refreshes):
    git clone --filter=blob:none --sparse --depth 1 \
        https://github.com/foundryvtt/pf2e.git <tempdir>
    cd <tempdir> && git sparse-checkout set packs/pf2e/spells packs/pf2e/spell-effects
    py tools/foundry-rescreen.py --extract <tempdir>

Lanes (see the spike report for hand-checked precision):
  A  defense missing       — Foundry save/attack absent from our defense_tags (~75-85% real)
  B  defense conflict      — disjoint save sets (rare, high-value)
  C  basic_save mismatch   — structured boolean comparison (highest precision)
  D  damage type missing   — Foundry structured damage we lack (missing-direction only)
  F  condition missing     — outcome-block conditions absent from conditions_by_outcome
  E  (informational)       — our damage types Foundry lacks: NOT actionable; ours is more
                             complete (persistent/conditional damage is prose-only there)
  G  (informational)       — condition linked anywhere vs conditions_imposed: ~40-50% noise

Known oracle limitations: single save statistic per spell (multi-save spells never fully
match); attack-trait coverage is weak; healing-kind damage entries are filtered out;
condition links fire on removals/negations (outcome-block lane mitigates).
"""
import argparse
import json
import os
import re
import sys
import unicodedata

sys.stdout.reconfigure(encoding="utf-8", errors="replace")
SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(SCRIPT_DIR)
EXTRACT_PATH = os.path.join(SCRIPT_DIR, "foundry-extract.json")
SPELL_DATA = os.path.join(ROOT, "data", "spell-data.js")

SAVE_MAP = {"fortitude": "Fort", "reflex": "Ref", "will": "Will"}
DMG_MAP = {
    "fire": "Fire", "cold": "Cold", "acid": "Acid", "electricity": "Elec",
    "sonic": "Sonic", "force": "Force", "vitality": "Vitality", "void": "Void",
    "mental": "Mental", "poison": "Poison", "bleed": "Bleed", "spirit": "Spirit",
    "piercing": "Pierc", "bludgeoning": "Bludg", "slashing": "Slash",
}
COND_VOCAB = {
    "Blinded", "Clumsy", "Concealed", "Confused", "Controlled", "Dazzled", "Deafened",
    "Doomed", "Drained", "Dying", "Encumbered", "Enfeebled", "Fascinated", "Fatigued",
    "Fleeing", "Frightened", "Grabbed", "Hidden", "Immobilized", "Off-Guard", "Paralyzed",
    "Petrified", "Prone", "Pushed", "Restrained", "Sickened", "Slowed", "Stunned",
    "Stupefied", "Unconscious",
}
COND_NAME_MAP = {"Flat-Footed": "Off-Guard"}
OUTCOMES = ["critical_success", "success", "failure", "critical_failure"]
UUID_RE = re.compile(r"@UUID\[([^\]]+)\](?:\{([^}]*)\})?")


def norm(name):
    n = unicodedata.normalize("NFKD", name)
    n = "".join(c for c in n if not unicodedata.combining(c))
    n = re.sub(r"[’']", "", n.lower().strip())
    return re.sub(r"[^a-z0-9]+", " ", n).strip()


# ---------------------------------------------------------------- extract mode
def extract_from_clone(clone_dir):
    spells_dir = os.path.join(clone_dir, "packs", "pf2e", "spells", "spells")
    if not os.path.isdir(spells_dir):
        sys.exit(f"not found: {spells_dir} — is this a sparse clone of foundryvtt/pf2e?")

    def uuid_kind_name(path):
        parts = path.split(".")
        if len(parts) >= 5 and parts[0] == "Compendium" and parts[1] == "pf2e":
            return parts[2], parts[-1]
        return None, None

    def conditions_in(text):
        out = set()
        for m in UUID_RE.finditer(text):
            kind, name = uuid_kind_name(m.group(1))
            if kind == "conditionitems":
                out.add(name)
        return sorted(out)

    def outcome_blocks(desc):
        marks = [(m.start(), m.group(1)) for m in re.finditer(
            r"<strong>(Critical Success|Success|Failure|Critical Failure)</strong>", desc)]
        keys = {"Critical Success": "critical_success", "Success": "success",
                "Failure": "failure", "Critical Failure": "critical_failure"}
        blocks = {}
        for i, (pos, header) in enumerate(marks):
            end = marks[i + 1][0] if i + 1 < len(marks) else len(desc)
            seg = desc[pos:end]
            hr = seg.find("<hr")
            blocks[keys[header]] = seg[:hr] if hr != -1 else seg
        return blocks

    def dmg_types(dmg_dict):
        out = set()
        for entry in (dmg_dict or {}).values():
            kinds = entry.get("kinds")
            if kinds is not None and "damage" not in kinds:
                continue  # healing-kind roll (Heal-spell HP restoration) — not damage
            t = entry.get("type")
            if t:
                out.add(t)
        return out

    spells = []
    for rank_dir in sorted(os.listdir(spells_dir)):
        full = os.path.join(spells_dir, rank_dir)
        if not os.path.isdir(full) or rank_dir == "cantrip":
            continue
        for fn in sorted(os.listdir(full)):
            if not fn.endswith(".json"):
                continue
            with open(os.path.join(full, fn), encoding="utf-8") as f:
                d = json.load(f)
            s = d["system"]
            desc = s.get("description", {}).get("value", "")
            traits = s.get("traits", {})
            dmg = dmg_types(s.get("damage"))
            for ov in (s.get("overlays") or {}).values():
                dmg |= dmg_types((ov.get("system") or {}).get("damage"))
            save = (s.get("defense") or {}).get("save") or {}
            blocks = outcome_blocks(desc)
            spells.append({
                "name": d["name"],
                "rank": s.get("level", {}).get("value"),
                "attack_trait": "attack" in traits.get("value", []),
                "save_statistic": save.get("statistic"),
                "save_basic": save.get("basic"),
                "damage_types": sorted(dmg),
                "conditions_by_outcome": {k: conditions_in(v) for k, v in blocks.items()},
                "conditions_anywhere": conditions_in(desc),
            })
    with open(EXTRACT_PATH, "w", encoding="utf-8") as f:
        json.dump({"spells": spells}, f, indent=0, ensure_ascii=False)
    print(f"extracted {len(spells)} leveled spells -> {EXTRACT_PATH}")


# ---------------------------------------------------------------- rescreen mode
def rescreen():
    if not os.path.exists(EXTRACT_PATH):
        sys.exit(f"missing {EXTRACT_PATH} — run with --extract <clone-dir> first (see header)")
    with open(EXTRACT_PATH, encoding="utf-8") as f:
        foundry = json.load(f)["spells"]
    with open(SPELL_DATA, encoding="utf-8") as f:
        raw = f.read()
    ours = json.loads(raw[raw.index("{"): raw.rindex("}") + 1])["spells"]
    fidx = {norm(fs["name"]): fs for fs in foundry}

    rows = {k: [] for k in "ABCDF"}
    lane_e = lane_g = 0
    unmatched = []

    for s in ours:
        fs = fidx.get(norm(s["name"]))
        if not fs:
            unmatched.append(s["name"])
            continue
        f_def = set()
        if fs["save_statistic"]:
            f_def.add(SAVE_MAP[fs["save_statistic"]])
        if fs["attack_trait"]:
            f_def.add("AC")
        o_def = set(s["defense_tags"]) - {"Auto"}
        missing = f_def - o_def
        if missing:
            rows["A"].append((s["name"], f"ours={sorted(o_def)} foundry={sorted(f_def)}"))
        if f_def and o_def and not (f_def & o_def):
            rows["B"].append((s["name"], f"ours={sorted(o_def)} foundry={sorted(f_def)}"))
        if fs["save_statistic"] is not None and fs["save_basic"] is not None:
            if bool(fs["save_basic"]) != bool(s["basic_save"]):
                rows["C"].append((s["name"], f"ours={s['basic_save']} foundry={fs['save_basic']}"))
        f_dmg = {DMG_MAP[t] for t in fs["damage_types"] if t in DMG_MAP}
        o_dmg = set(s["damage_types"]) - {"Varies", "Unspecified"}
        if f_dmg - o_dmg and "Varies" not in s["damage_types"]:
            rows["D"].append((s["name"], f"missing={sorted(f_dmg - o_dmg)}"))
        if o_dmg - f_dmg and f_dmg:
            lane_e += 1
        o_cbo = s.get("conditions_by_outcome") or {}
        for outcome in OUTCOMES:
            f_conds = {COND_NAME_MAP.get(c, c) for c in fs["conditions_by_outcome"].get(outcome, [])} & COND_VOCAB
            miss = f_conds - set(o_cbo.get(outcome) or [])
            if miss:
                rows["F"].append((s["name"], f"{outcome}: missing={sorted(miss)}"))
        f_any = {COND_NAME_MAP.get(c, c) for c in fs["conditions_anywhere"]} & COND_VOCAB
        if f_any - set(s.get("conditions_imposed") or []):
            lane_g += 1

    titles = {
        "A": "defense missing (Foundry save/attack absent from defense_tags)",
        "B": "defense conflict (disjoint sets)",
        "C": "basic_save mismatch",
        "D": "damage type missing (Foundry structured damage we lack)",
        "F": "condition missing from conditions_by_outcome (outcome-block lane)",
    }
    total = 0
    for lane in "ABCDF":
        print(f"\n=== Lane {lane} — {titles[lane]}: {len(rows[lane])} ===")
        for name, detail in rows[lane]:
            print(f"  {name}: {detail}")
        total += len(rows[lane])
    print(f"\n--- informational (NOT actionable fix queues) ---")
    print(f"Lane E (our damage types Foundry lacks — ours is more complete): {lane_e} spells")
    print(f"Lane G (condition mentioned anywhere vs conditions_imposed — ~40-50% noise): {lane_g} spells")
    print(f"Unmatched by name (outside the oracle): {len(unmatched)}: {unmatched}")
    print(f"\nActionable rows (lanes A-D/F): {total}")
    print("Reminder: rows are leads for editorial adjudication, never auto-fixes. The oracle")
    print("has known errors; rubric-rejections (harm rubric, wall/Auto class, weapon-buff")
    print("convention, Noise Blast basic rule) are EXPECTED to keep appearing here.")


def main():
    ap = argparse.ArgumentParser(description="Foundry VTT verification oracle rescreen (report-only)")
    ap.add_argument("--extract", metavar="CLONE_DIR",
                    help="regenerate tools/foundry-extract.json from a sparse clone of foundryvtt/pf2e")
    args = ap.parse_args()
    if args.extract:
        extract_from_clone(args.extract)
    else:
        rescreen()


if __name__ == "__main__":
    main()
