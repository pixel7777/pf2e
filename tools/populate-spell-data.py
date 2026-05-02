"""
Populator tool: reads spell descriptions from source/spell.json, sends each to
an LLM via OpenRouter for semantic analysis, and writes results to
data/populator-results.json. A separate --merge step folds the results back
into data/spell-data.js.

Per Decision 016 schema. Per Cycle 04 spec.

Requires environment variable: OPENROUTER_API_KEY
"""

import argparse
import json
import os
import sys
import time
from datetime import datetime, timezone

try:
    import urllib.request
    import urllib.error
except ImportError:
    print("urllib required (stdlib)", file=sys.stderr)
    sys.exit(1)

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
PROJECT_ROOT = os.path.dirname(SCRIPT_DIR)

SPELL_JSON_PATH = os.path.join(PROJECT_ROOT, "source", "spell.json")
SPELL_DATA_PATH = os.path.join(PROJECT_ROOT, "data", "spell-data.js")
RESULTS_PATH = os.path.join(PROJECT_ROOT, "data", "populator-results.json")
GOLDEN_SET_PATH = os.path.join(SCRIPT_DIR, "golden-set.json")

DEFAULT_MODEL = "google/gemini-2.0-flash-001"
OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions"

VALID_DAMAGE_TYPES = {
    "Fire", "Cold", "Elec", "Acid", "Force", "Sonic",
    "Void", "Vitality", "Spirit", "Mental", "Poison",
    "Bludg", "Pierc", "Slash", "Varies",
}

VALID_ROLES = {
    "damage", "debuff", "buff", "healing", "control", "utility",
    "silverBullets", "reactions", "oneAction", "prebuffs",
}

VALID_HEIGHTEN_QUALITY = {
    "scales-well", "scales-okay", "fixed-meaningful", "fixed-minor",
    "no-heighten", "scaling-irrelevant",
}

VALID_OUTCOMES = {"critical_success", "success", "failure", "critical_failure"}

# Roles the populator may emit. silverBullets is editorial-only — never emitted
# by the populator. Auto-derived roles (healing, reactions, oneAction) are
# already in spell-data.js from Cycle 03; the populator MAY also emit them
# but the merge step unions everything regardless.
POPULATOR_ROLES = {
    "damage", "debuff", "buff", "healing", "control", "utility",
    "reactions", "oneAction", "prebuffs",
}

COMBAT_ROLES = {"damage", "debuff", "control"}

# ---------------------------------------------------------------- prompt --

PROMPT_TEMPLATE = """You analyze Pathfinder 2e spell descriptions and extract structured tags. Return ONLY valid JSON matching the requested schema. No prose, no markdown fences, no commentary.

# SPELL CONTEXT

Name: {name}
Rank: {rank}
Traditions: {tradition}
Existing structured tags (from prior pipeline pass):
  defense_tags: {defense_tags}
  targeting_tags: {targeting_tags}
  basic_save: {basic_save}
  action_tags: {action_tags}
  heighten_pattern: {heighten_pattern}
  heighten_raw: {heighten_raw}
Traits: {trait_raw}
Saving Throw (raw): {saving_throw}
Target (raw): {target}
Area (raw): {area_type}
Duration (raw): {duration_raw}

Description (markdown from Archives of Nethys):
---
{markdown}
---

# YOUR TASK

Return a JSON object with these fields:

```
{{
  "damage_types": [],
  "conditions_imposed": [],
  "conditions_by_outcome": null,
  "roles_added": [],
  "defense_tags_added": [],
  "reliability_tags_added": [],
  "targeting_tags_added": [],
  "heighten_quality": null
}}
```

## damage_types — array

Valid values (16): Fire, Cold, Elec, Acid, Force, Sonic, Void, Vitality, Spirit, Mental, Poison, Bludg, Pierc, Slash, Varies

Rules (Decision 005):
1. Only tag damage dealt TO ENEMIES. "Deals 4d6 fire damage" → Fire. "Grants resistance 5 to fire" → NOT Fire. "Immune to acid" → NOT Acid.
2. Include both initial and persistent damage. Cinder Swarm (piercing initial + persistent fire) → ["Pierc", "Fire"].
3. Variable-type spells: tag "Varies" PLUS each chooseable type. Elemental Breath → ["Varies", "Fire", "Cold", "Elec", "Acid"].
4. Multi-damage spells: tag every type. Thunderstrike (electricity + sonic) → ["Elec", "Sonic"].
5. Ignore resistance/immunity language and damage types appearing only as triggers or qualifiers.
6. Ignore incidental/conditional damage that wouldn't motivate spell selection.
7. Physical types (Bludg, Pierc, Slash) are valid when the spell deals them — polymorph attacks, summoned-creature attacks, weapon-summoning effects.
8. Use the abbreviations exactly: Elec (not Electricity), Bludg, Pierc, Slash.
9. Excluded: Light, Darkness, Holy, Unholy, Untyped — these are qualifiers, not damage types.
10. Spells with no damage to enemies → [].

## conditions_imposed — array of canonical PF2e remaster condition names

Rules (Decision 006):
1. Only tag conditions imposed ON ENEMIES. "Target is Frightened 1" → tag. "You are immune to frightened" → don't tag. "Removes blinded from an ally" → don't tag.
2. Tag at every save outcome where the condition appears. If Stunned on crit fail and Slowed on fail, tag both.
3. Include conditions from persistent/lingering effects.
4. Use canonical remaster names. "Flat-footed" → "Off-Guard". Drop severity numbers — "Sickened 2" → "Sickened".
5. Spells with no conditions imposed on enemies → [].

## conditions_by_outcome — object or null

If the spell has a saving throw or attack roll AND imposes conditions, return:
{{
  "critical_success": ["..."],
  "success": ["..."],
  "failure": ["..."],
  "critical_failure": ["..."]
}}
Each array lists conditions imposed AT THAT OUTCOME. Empty arrays are fine. Auto-effect conditions (no save) belong in "failure" by convention (they trigger guaranteed).
If the spell imposes no conditions, OR has no save/attack roll AND no auto conditions → null.
conditions_imposed must be the deduplicated union of all four arrays.

## roles_added — array of NEW roles the populator contributes

Valid populator roles (9): damage, debuff, buff, healing, control, utility, reactions, oneAction, prebuffs
(silverBullets is editorial-only — never emit it.)

Note: healing/reactions/oneAction may have been auto-derived by the prior pass from traits/actions. You may still emit them if the text confirms — duplicates are merged.

Definitions (Decision 011):
- damage: spell deals meaningful HP damage to enemies as a primary or significant function.
- debuff: spell imposes conditions on enemies as a primary/significant function. SAVE-OUTCOME THRESHOLD:
   * Auto-effect (no save): debuff = yes (always plannable).
   * Success: debuff = yes (~50%+ trigger rate).
   * Failure: debuff = yes IF significant function. Slow (Slowed on fail) = yes. Dehydrate (damage + Enfeebled on fail) = yes (also gets damage).
   * Critical Failure ONLY: debuff = NO. Eclipse Burst's Blinded on crit fail is a jackpot, not a function.
   * EXCEPTION: Critical-fail-only with Incapacitation AND no other function = yes. Sleep is a debuff despite the crit-fail gate because the entire spell is the condition.
- buff: spell targets allies and enhances capabilities (stat bonuses, new abilities, protective effects). Damage prevention/reduction = buff.
- healing: spell restores ally HP or removes harmful conditions. (Healing trait → very high confidence.)
- control: spell creates terrain, zones, barriers, or movement denial that shapes the battlefield. Wall spells, difficult terrain, zoning. Wall of Stone = control. Wall of Fire = control + damage.
- utility: spell solves out-of-combat problems — movement, scouting, environmental adaptation, information. Fly = utility + buff. Invisibility = utility + buff.
- reactions: cast as a Reaction.
- oneAction: has a 1-action casting mode.
- prebuffs: long-duration (≥10 min) self/ally buff cast before combat. Mystic Armor = buff + prebuffs.

Every spell must end up with at least one role. Emit whatever roles apply.

## defense_tags_added — array

The populator augments defense_tags with ONLY one value: "Auto".

Add "Auto" if AND ONLY IF:
1. The spell's existing defense_tags is empty (no Fort/Ref/Will/AC), AND
2. The spell is offensive — has a combat role you're emitting (damage, debuff, or control).

Otherwise → [].
NEVER add Fort, Ref, Will, or AC — those are computed upstream from structured fields.

## reliability_tags_added — array

Valid values: "Auto-effect", "Success-effect"

Add "Auto-effect" if AND ONLY IF you added "Auto" to defense_tags_added (above).

Add "Success-effect" if AND ONLY IF basic_save is FALSE AND the Success degree-of-success outcome produces a strategically meaningful effect — a condition rider, partial damage, or tactical consequence beyond "no effect". Examples:
- Fear (non-basic Will, "Frightened 1" on success) → add Success-effect.
- Synesthesia (non-basic Will, Clumsy 1 + Stupefied 1 on success) → add Success-effect.
- Slow (non-basic Fort, "Slowed 1 for 1 round" on success) → add Success-effect (1-round Slowed is meaningful).
- Phantasmal Killer (non-basic Will, "frightened 1" on success) → add Success-effect.
- Spell where Success = "no effect" or "spell ends" → don't add.

Do NOT emit Success-effect for basic_save spells — those are handled upstream.

## targeting_tags_added — array

Valid values: "ST", "Multi"

The Cycle 03 pass already added ST/Multi from area_type and the "1 creature"/"the triggering creature" target patterns. Augment ONLY when text analysis reveals a mode the structured pass missed:
- "ST" if existing targeting_tags lacks ST AND the spell can target a single creature (e.g., variable-action spells with a single-target mode).
- "Multi" if existing targeting_tags lacks Multi AND the spell text shows multi-target mode (e.g., "up to 5 creatures", heightened versions that target multiple, "each creature in the area" without an area_type field).

Otherwise → [].

## heighten_quality — string enum or null

Valid values: scales-well, scales-okay, fixed-meaningful, fixed-minor, no-heighten, scaling-irrelevant

Rules (Decision 014):
- heighten_pattern == "none" → "no-heighten" (always).
- Pre-buff or silver-bullet style spells where rank doesn't gate the value → "scaling-irrelevant" (Mystic Armor, Revealing Light).
- Plus-pattern with meaningful per-rank improvement that stays competitive at higher ranks → "scales-well" (Fireball +2d6/rank, Dehydrate +2d6 persistent).
- Plus-pattern but outclassed at higher ranks (or poor scaling magnitude) → "scales-okay" (Floating Flame +1d6/rank).
- Fixed pattern that meaningfully changes function/scope → "fixed-meaningful" (Fear at 3rd: 1 → 5 targets; Slow at 6th: 1 → 10 targets; Fly at 7th: longer duration).
- Fixed pattern with marginal improvement only → "fixed-minor".

# RESPONSE FORMAT

Return ONLY a single JSON object. No surrounding text. No markdown code fences. No commentary.
"""

# ---------------------------------------------------------------- I/O ----

def load_spell_json():
    with open(SPELL_JSON_PATH, "r", encoding="utf-8") as f:
        return json.load(f)


def load_spell_data():
    with open(SPELL_DATA_PATH, "r", encoding="utf-8") as f:
        content = f.read()
    body = content.split("\n", 1)[1]
    prefix = "window.SPELL_SCHEMA = "
    if not body.startswith(prefix) or not body.endswith(";\n"):
        raise RuntimeError("spell-data.js does not match expected wrapper")
    return json.loads(body[len(prefix):-2])


def write_spell_data(data):
    with open(SPELL_DATA_PATH, "w", encoding="utf-8") as f:
        f.write("// Auto-generated by tools/build-spell-data.py — do not edit manually\n")
        f.write("window.SPELL_SCHEMA = ")
        json.dump(data, f, ensure_ascii=False, indent=None)
        f.write(";\n")


def load_results():
    if not os.path.exists(RESULTS_PATH):
        return {}
    with open(RESULTS_PATH, "r", encoding="utf-8") as f:
        return json.load(f)


def save_results(results):
    tmp = RESULTS_PATH + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(results, f, ensure_ascii=False, indent=2)
    os.replace(tmp, RESULTS_PATH)


def load_golden_set():
    with open(GOLDEN_SET_PATH, "r", encoding="utf-8") as f:
        return json.load(f)


# ---------------------------------------------------------- LLM call -----

class LLMError(Exception):
    pass


def call_openrouter(api_key, model, prompt):
    """Single OpenRouter call. Raises LLMError on transport failure or non-200."""
    payload = {
        "model": model,
        "messages": [{"role": "user", "content": prompt}],
        "temperature": 0.0,
        "response_format": {"type": "json_object"},
    }
    body = json.dumps(payload).encode("utf-8")
    req = urllib.request.Request(
        OPENROUTER_URL,
        data=body,
        headers={
            "Authorization": "Bearer " + api_key,
            "Content-Type": "application/json",
            "HTTP-Referer": "https://github.com/pixel7777/pf2e",
            "X-Title": "pf2e-spell-planner populator",
        },
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=120) as resp:
            data = json.loads(resp.read().decode("utf-8"))
    except urllib.error.HTTPError as e:
        retry_after = e.headers.get("Retry-After") if e.headers else None
        raise LLMError("HTTP %d: %s (Retry-After=%s)" % (e.code, e.reason, retry_after))
    except urllib.error.URLError as e:
        raise LLMError("URLError: %s" % e.reason)

    try:
        content = data["choices"][0]["message"]["content"]
    except (KeyError, IndexError):
        raise LLMError("malformed response: %s" % json.dumps(data)[:300])

    usage = data.get("usage", {}) or {}
    return content, usage


def parse_and_validate(content):
    """Parse the LLM response and validate field types/values. Returns (parsed, error_or_None)."""
    text = content.strip()
    if text.startswith("```"):
        text = text.strip("`")
        if text.startswith("json"):
            text = text[4:].strip()
        if text.endswith("```"):
            text = text[:-3].strip()

    try:
        result = json.loads(text)
    except json.JSONDecodeError as e:
        return None, "JSON parse error: %s" % e

    required = {
        "damage_types", "conditions_imposed", "conditions_by_outcome",
        "roles_added", "defense_tags_added", "reliability_tags_added",
        "targeting_tags_added", "heighten_quality",
    }
    missing = required - set(result.keys())
    if missing:
        return None, "missing fields: %s" % sorted(missing)

    if not isinstance(result["damage_types"], list):
        return None, "damage_types not list"
    for v in result["damage_types"]:
        if v not in VALID_DAMAGE_TYPES:
            return None, "invalid damage_type: %r" % v

    if not isinstance(result["conditions_imposed"], list):
        return None, "conditions_imposed not list"

    cbo = result["conditions_by_outcome"]
    if cbo is not None:
        if not isinstance(cbo, dict):
            return None, "conditions_by_outcome not object/null"
        if set(cbo.keys()) != VALID_OUTCOMES:
            return None, "conditions_by_outcome keys must be exactly %s" % sorted(VALID_OUTCOMES)
        for k, v in cbo.items():
            if not isinstance(v, list):
                return None, "conditions_by_outcome[%s] not list" % k
        # Consistency: conditions_imposed == union of outcome arrays (deduplicated, set equality)
        union = set()
        for v in cbo.values():
            union.update(v)
        if set(result["conditions_imposed"]) != union:
            return None, "conditions_imposed != union(conditions_by_outcome)"

    if not isinstance(result["roles_added"], list):
        return None, "roles_added not list"
    for v in result["roles_added"]:
        if v not in POPULATOR_ROLES:
            return None, "invalid role: %r" % v

    if not isinstance(result["defense_tags_added"], list):
        return None, "defense_tags_added not list"
    for v in result["defense_tags_added"]:
        if v != "Auto":
            return None, "defense_tags_added must only contain 'Auto', got %r" % v

    if not isinstance(result["reliability_tags_added"], list):
        return None, "reliability_tags_added not list"
    for v in result["reliability_tags_added"]:
        if v not in ("Auto-effect", "Success-effect"):
            return None, "invalid reliability tag: %r" % v

    if not isinstance(result["targeting_tags_added"], list):
        return None, "targeting_tags_added not list"
    for v in result["targeting_tags_added"]:
        if v not in ("ST", "Multi"):
            return None, "invalid targeting tag: %r" % v

    hq = result["heighten_quality"]
    if hq is not None and hq not in VALID_HEIGHTEN_QUALITY:
        return None, "invalid heighten_quality: %r" % hq

    # Cross-field consistency: Auto in defense_tags_added → Auto-effect in reliability_tags_added.
    if "Auto" in result["defense_tags_added"] and "Auto-effect" not in result["reliability_tags_added"]:
        return None, "Auto in defense_tags_added requires Auto-effect in reliability_tags_added"

    return result, None


def analyze_spell(api_key, model, raw_spell, spell_data_entry, max_retries=5):
    """Send one spell to the LLM, retry on transport/validation failures.

    Returns (result_dict, usage_dict) on success; raises LLMError after max_retries.
    """
    prompt = PROMPT_TEMPLATE.format(
        name=raw_spell.get("name", ""),
        rank=raw_spell.get("level", 0),
        tradition=json.dumps(raw_spell.get("tradition") or []),
        defense_tags=json.dumps(spell_data_entry.get("defense_tags", [])),
        targeting_tags=json.dumps(spell_data_entry.get("targeting_tags", [])),
        basic_save=json.dumps(spell_data_entry.get("basic_save", False)),
        action_tags=json.dumps(spell_data_entry.get("action_tags", [])),
        heighten_pattern=spell_data_entry.get("heighten_pattern", "none"),
        heighten_raw=json.dumps(spell_data_entry.get("heighten_raw", [])),
        trait_raw=json.dumps(raw_spell.get("trait_raw") or []),
        saving_throw=json.dumps(raw_spell.get("saving_throw") or ""),
        target=json.dumps(raw_spell.get("target") or ""),
        area_type=json.dumps(raw_spell.get("area_type") or []),
        duration_raw=json.dumps(raw_spell.get("duration_raw") or ""),
        markdown=raw_spell.get("markdown", "")[:8000],
    )

    last_error = None
    backoff = 1.0
    for attempt in range(max_retries):
        try:
            content, usage = call_openrouter(api_key, model, prompt)
        except LLMError as e:
            last_error = "transport: %s" % e
            time.sleep(backoff)
            backoff = min(backoff * 2, 16.0)
            continue

        parsed, err = parse_and_validate(content)
        if parsed is not None:
            return parsed, usage
        last_error = "validation: %s" % err
        time.sleep(backoff)
        backoff = min(backoff * 2, 16.0)

    raise LLMError("after %d attempts: %s" % (max_retries, last_error))


# ---------------------------------------------------------- merge --------

def merge_into_spell_data():
    print("Loading spell-data.js and populator-results.json...")
    spell_data = load_spell_data()
    results = load_results()
    if not results:
        print("  populator-results.json is empty or missing — nothing to merge")
        return

    by_aon = {s["aonId"]: s for s in spell_data["spells"]}
    merged_count = 0
    skipped = []

    for key, populated in results.items():
        if not key.startswith("spell-"):
            skipped.append(key)
            continue
        try:
            aon_id = int(key[6:])
        except ValueError:
            skipped.append(key)
            continue
        spell = by_aon.get(aon_id)
        if spell is None:
            skipped.append(key)
            continue

        # Owned-by-populator fields: replace.
        spell["damage_types"] = list(populated.get("damage_types", []))
        spell["conditions_imposed"] = list(populated.get("conditions_imposed", []))
        spell["conditions_by_outcome"] = populated.get("conditions_by_outcome", None)
        spell["heighten_quality"] = populated.get("heighten_quality", None)

        # Augmented (union) fields.
        spell["roles"] = sorted(set(spell.get("roles", []) + list(populated.get("roles_added", []))))
        spell["defense_tags"] = sorted(set(spell.get("defense_tags", []) + list(populated.get("defense_tags_added", []))))
        spell["reliability_tags"] = sorted(set(spell.get("reliability_tags", []) + list(populated.get("reliability_tags_added", []))))
        spell["targeting_tags"] = sorted(set(spell.get("targeting_tags", []) + list(populated.get("targeting_tags_added", []))))

        # Offense Evaluation gate: if defense_tags ended up empty, clear offense fields.
        if not spell["defense_tags"]:
            spell["damage_types"] = []
            spell["conditions_imposed"] = []
            spell["conditions_by_outcome"] = None
            spell["reliability_tags"] = [t for t in spell["reliability_tags"] if t == "Auto-effect"]

        merged_count += 1

    spell_data["generated"] = datetime.now(timezone.utc).isoformat()
    write_spell_data(spell_data)
    print("  merged %d results into spell-data.js" % merged_count)
    if skipped:
        print("  skipped %d unknown keys: %s" % (len(skipped), skipped[:5]))


# ---------------------------------------------------------- CLI ----------

def parse_spells_arg(arg):
    """Accepts 'spell-1530', '1530', or comma-separated combinations. Returns set of integer aonIds."""
    out = set()
    for tok in arg.split(","):
        tok = tok.strip()
        if not tok:
            continue
        if tok.startswith("spell-"):
            tok = tok[6:]
        try:
            out.add(int(tok))
        except ValueError:
            print("Invalid --spells token: %s" % tok, file=sys.stderr)
            sys.exit(2)
    return out


def golden_set_diff(expected, actual, tolerance_fields):
    """Compare expected and actual populator outputs. Returns (status, details)."""
    diffs = []
    fuzzy = []
    for field, exp_val in expected.items():
        act_val = actual.get(field)
        # Normalize array comparisons to sets when arrays.
        if isinstance(exp_val, list) and isinstance(act_val, list):
            if set(exp_val) != set(act_val):
                if field in tolerance_fields:
                    fuzzy.append("%s: expected %s, got %s" % (field, exp_val, act_val))
                else:
                    diffs.append("%s: expected %s, got %s" % (field, exp_val, act_val))
        elif exp_val != act_val:
            if field in tolerance_fields:
                fuzzy.append("%s: expected %r, got %r" % (field, exp_val, act_val))
            else:
                diffs.append("%s: expected %r, got %r" % (field, exp_val, act_val))

    if diffs:
        return "FAIL", diffs + fuzzy
    if fuzzy:
        return "TOLERANCE", fuzzy
    return "PASS", []


def main():
    p = argparse.ArgumentParser(description="Populate semantic fields in data/spell-data.js")
    p.add_argument("--golden-set", action="store_true", help="Process only golden-set.json spells, compare to expected")
    p.add_argument("--batch-size", type=int, default=50, help="Save results after every N spells (default: 50)")
    p.add_argument("--resume", action="store_true", help="Skip spells already in populator-results.json")
    p.add_argument("--merge", action="store_true", help="Merge populator-results.json into spell-data.js (no LLM calls)")
    p.add_argument("--spells", type=str, default=None, help="Comma-separated aonIds to process (e.g., spell-1530,1524)")
    p.add_argument("--model", type=str, default=DEFAULT_MODEL, help="OpenRouter model (default: %s)" % DEFAULT_MODEL)
    p.add_argument("--clean", action="store_true", help="Delete populator-results.json and exit")
    p.add_argument("--max-retries", type=int, default=5, help="Max retries per spell (default: 5)")
    args = p.parse_args()

    if args.clean:
        if os.path.exists(RESULTS_PATH):
            os.remove(RESULTS_PATH)
            print("Removed %s" % RESULTS_PATH)
        else:
            print("No populator-results.json to remove")
        return

    if args.merge:
        merge_into_spell_data()
        return

    api_key = os.environ.get("OPENROUTER_API_KEY")
    if not api_key:
        print("ERROR: OPENROUTER_API_KEY environment variable not set", file=sys.stderr)
        sys.exit(2)

    print("Loading spell.json and spell-data.js...")
    raw_spells = load_spell_json()
    raw_by_aon = {}
    for s in raw_spells:
        sid = s.get("id", "")
        if sid.startswith("spell-"):
            try:
                raw_by_aon[int(sid[6:])] = s
            except ValueError:
                pass

    spell_data = load_spell_data()
    sd_by_aon = {s["aonId"]: s for s in spell_data["spells"]}

    results = load_results()

    # Determine target set.
    if args.golden_set:
        golden = load_golden_set()
        target_aons = [g["aonId"] for g in golden]
        golden_by_aon = {g["aonId"]: g for g in golden}
    elif args.spells:
        target_aons = sorted(parse_spells_arg(args.spells))
        golden_by_aon = {}
    else:
        target_aons = [s["aonId"] for s in spell_data["spells"]]
        golden_by_aon = {}

    # Filter to spells we have raw markdown for AND that are in spell-data.
    queue = []
    for aon_id in target_aons:
        if aon_id not in raw_by_aon:
            print("  WARN: aonId %d not in spell.json — skipping" % aon_id)
            continue
        if aon_id not in sd_by_aon:
            print("  WARN: aonId %d not in spell-data.js — skipping" % aon_id)
            continue
        key = "spell-%d" % aon_id
        if args.resume and key in results:
            continue
        if not args.resume and not args.golden_set and not args.spells and key in results:
            # default behavior: skip already-done. Use --clean to start fresh.
            continue
        queue.append(aon_id)

    print("Queue: %d spells to process (model=%s)" % (len(queue), args.model))
    if args.golden_set:
        print("Mode: GOLDEN SET — will compare results to expected values")
    if not queue:
        print("Nothing to do.")
        if args.golden_set:
            evaluate_golden_set(results, golden_by_aon)
        return

    total_input_tokens = 0
    total_output_tokens = 0
    skipped_spells = []
    processed = 0
    start = time.time()

    for aon_id in queue:
        raw = raw_by_aon[aon_id]
        sd_entry = sd_by_aon[aon_id]
        key = "spell-%d" % aon_id

        try:
            result, usage = analyze_spell(api_key, args.model, raw, sd_entry, max_retries=args.max_retries)
        except LLMError as e:
            print("  SKIPPED %s (%s): %s" % (key, raw.get("name", "?"), e))
            skipped_spells.append((key, raw.get("name", "?"), str(e)))
            continue

        results[key] = result
        total_input_tokens += int(usage.get("prompt_tokens", 0) or 0)
        total_output_tokens += int(usage.get("completion_tokens", 0) or 0)
        processed += 1

        if processed % 10 == 0:
            elapsed = time.time() - start
            rate = processed / elapsed if elapsed > 0 else 0
            print("  [%d/%d] %s (rate=%.1f/s)" % (processed, len(queue), raw.get("name", "?"), rate))

        if processed % args.batch_size == 0:
            save_results(results)
            print("  -- checkpoint saved (%d results) --" % len(results))

    save_results(results)
    elapsed = time.time() - start
    print("\nDone. Processed %d spells in %.1fs" % (processed, elapsed))
    print("Tokens: %d input + %d output = %d total" % (total_input_tokens, total_output_tokens, total_input_tokens + total_output_tokens))

    if skipped_spells:
        print("\n%d SKIPPED spells:" % len(skipped_spells))
        for key, name, reason in skipped_spells:
            print("  %s (%s): %s" % (key, name, reason))

    if args.golden_set:
        evaluate_golden_set(results, golden_by_aon)


def evaluate_golden_set(results, golden_by_aon):
    print("\n=== Golden Set Evaluation ===")
    pass_count = 0
    tolerance_count = 0
    fail_count = 0
    fails = []
    tolerances = []

    for aon_id, expected_entry in golden_by_aon.items():
        key = "spell-%d" % aon_id
        if key not in results:
            print("  MISSING %s (%s)" % (key, expected_entry["name"]))
            fail_count += 1
            fails.append((expected_entry["name"], ["not in results"]))
            continue
        actual = results[key]
        tolerance = set(expected_entry.get("tolerance", []))
        status, details = golden_set_diff(expected_entry["expected"], actual, tolerance)
        if status == "PASS":
            pass_count += 1
        elif status == "TOLERANCE":
            tolerance_count += 1
            tolerances.append((expected_entry["name"], details))
        else:
            fail_count += 1
            fails.append((expected_entry["name"], details))

    total = len(golden_by_aon)
    print("Result: %d PASS, %d TOLERANCE, %d FAIL (of %d)" % (pass_count, tolerance_count, fail_count, total))
    if fails:
        print("\nFAILS:")
        for name, details in fails:
            print("  %s:" % name)
            for d in details:
                print("    - %s" % d)
    if tolerances:
        print("\nTOLERANCE matches (review-able):")
        for name, details in tolerances:
            print("  %s:" % name)
            for d in details:
                print("    - %s" % d)

    if fail_count == 0 and tolerance_count <= 2:
        print("\n[OK] Golden set passes (0 FAIL, <=2 TOLERANCE). Ready for full run.")
    else:
        print("\n[WARN] Tune the prompt and re-run.")


if __name__ == "__main__":
    main()
