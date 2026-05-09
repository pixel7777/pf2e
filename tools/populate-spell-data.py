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
import re
import sys
import time
from collections import Counter
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
EDITORIAL_OVERRIDES_PATH = os.path.join(PROJECT_ROOT, "data", "editorial-overrides.json")
GOLDEN_SET_PATH = os.path.join(SCRIPT_DIR, "golden-set.json")

DEFAULT_MODEL = "anthropic/claude-sonnet-4-6"
OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions"

VALID_DAMAGE_TYPES = {
    "Fire", "Cold", "Elec", "Acid", "Force", "Sonic",
    "Void", "Vitality", "Spirit", "Mental", "Poison",
    "Bludg", "Pierc", "Slash", "Bleed", "Varies", "Unspecified",
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
  "weaknesses_imposed": [],
  "roles_added": [],
  "defense_tags_added": [],
  "reliability_tags_added": [],
  "targeting_tags_added": [],
  "heighten_quality": null
}}
```

## ANTI-X RULE (READ CAREFULLY)

If a spell's PURPOSE is to counter, prevent, remove, or protect against a condition or effect,
it does NOT impose that condition. The spell is the CURE, not the DISEASE.

Examples — these spells do NOT impose the listed conditions:
- Scouring Pulse (removes concealment from area) → does NOT impose Concealed
- Freedom of Movement (prevents immobilize/grab/restrain) → does NOT impose Immobilized, Grabbed, or Restrained
- Remove Curse (counteracts curses) → does NOT impose any curse-related conditions
- Calm (suppresses emotion effects) → does NOT impose any emotion conditions
- Cleanse Affliction (treats diseases) → does NOT impose Sickened
- See the Unseen (reveals invisible creatures) → does NOT impose Invisible or Hidden
- Earthbind (forces flying creature down) → does NOT impose Immobilized (it reduces fly Speed to 0, a mechanical effect, not the Immobilized condition)

The test: "Does this spell INFLICT this condition on an unwilling enemy as a harmful effect?"
If the answer is no — if the spell is removing, preventing, counteracting, or suppressing — leave it out.

## LITERAL TEXT RULE (REINFORCED)

A condition goes in conditions_imposed ONLY if the spell text uses the EXACT condition name.

YES — the spell literally says the condition:
- "The target is slowed 1" → Slowed ✓
- "The target becomes frightened 2" → Frightened ✓
- "Creatures in the area are concealed" → Concealed ✓

NO — mechanical effects that RESEMBLE a condition but don't name it:
- "The target takes a -10-foot status penalty to Speed" → NOT Slowed (no "slowed" word)
- "The area is filled with smoke, obscuring vision" → NOT Concealed (smoke/fire/obscurement language describes terrain, not the Concealed condition imposed on targets)
- "Wall of Fire's smoke obscures sight" → NOT Concealed (terrain effect, not a condition)
- "The target can't fly" or "fly Speed is reduced to 0" → NOT Immobilized (flight restriction, not the Immobilized condition)
- "The target is unable to act" → NOT Stunned UNLESS "stunned" literally appears
- "The target treats everyone as enemies" or "the target attacks its allies" → NOT Confused (behavioral override is not the Confused condition unless the word "Confused" literally appears in the spell text)
- "The target loses its senses" / "the target is overwhelmed" → NOT a condition unless a canonical condition word appears
- "The target is dying" or "the target dies" → NOT a condition (death is not on the canonical list)

When in doubt: search the spell text for the exact condition name as a word. If it's not there, don't tag it.

⚠️ ZERO TOLERANCE: If you find yourself reasoning "the spell does X which is LIKE the Y condition," STOP. The literal text rule means the rule. No paraphrasing, no inference, no "effectively this is...". Only the literal word.

## REMASTER DAMAGE TYPES

PF2e Remaster replaced alignment damage types. The following are INVALID and must not appear:
- Evil → use "Spirit" instead
- Good → use "Spirit" instead
- Chaotic → use "Spirit" instead
- Lawful → use "Spirit" instead

If the spell text mentions "spirit damage", "vitality damage", or "void damage", use the
remaster names (Spirit, Vitality, Void). If old text says "evil damage" or "good damage",
emit "Spirit".

## POLYMORPH / BATTLE FORM RULE

Spells with the Polymorph trait that grant the caster a battle form are BUFF spells.
The damage dealt while in the form is a consequence of the buff, not the spell's function.

- Polymorph trait + "battle form" or "You gain the following statistics" → roles_added: ["buff"]
- Do NOT add "damage" role just because the form has attack statistics.
- The spell's damage_types should be EMPTY (the form attacks, not the spell).
- conditions_imposed should only include conditions the SPELL imposes (transformation effects on
  the caster's enemies), not conditions the form's attacks might inflict.

Examples:
- Dragon Form → buff (you become a dragon; the breath weapon is the form's, not the spell's)
- Monstrosity Form → buff
- Corrosive Body → buff
- Insect Form → buff

## WEAPON ENHANCEMENT RULE

Spells that enhance a weapon (add damage types, bonus damage, special properties) are BUFF spells.
The extra damage comes from the enhanced weapon attacks, not from the spell itself.

- "target weapon" or "weapon deals additional" or "strikes with the weapon" → roles_added: ["buff"]
- damage_types: EMPTY (the weapon deals the damage, not the spell)
- Exception: if the spell ALSO deals instantaneous spell damage (like a burst on cast), that
  portion earns "damage" role and its damage_types.

Examples:
- Bone Flense (adds bleed to weapon strikes) → buff
- Runic Weapon (adds property rune effects) → buff
- Blazing Armory (conjures fire weapons + deals fire damage to grabbers) → buff

## SUMMON SPELL RULE

Spells with the Summon trait place another actor on the battlefield. This is CONTROL.
The summoned creature can tank, block, flank, and attack — but categorizing every possible
creature action would tag the spell for every role. Instead:

- Summon trait → roles_added: ["control"]
- Do NOT add damage, debuff, buff, or utility based on what the creature MIGHT do.
- damage_types: EMPTY (the creature deals damage, not the spell)
- conditions_imposed: EMPTY (the creature imposes conditions, not the spell)
- Incarnate spells (Summon Draconic Legion, Summon Elemental Herald) follow the same rule: control.

Exception: If the summon spell itself (not the creature) has additional effects beyond summoning
(e.g., an arrival burst that deals area damage), tag those effects normally in addition to control.

## HEALING vs. BUFF BOUNDARY

If the spell has the Healing trait:
- Check: does the spell ALSO target enemies with damage, saves, or conditions?
- If YES (dual-purpose): analyze offense fields normally. The Healing trait means it ALSO heals,
  not that offense analysis is skipped. Examples: Blood-Feasting Breath, Siphon Life.
- If NO (pure healing): skip offense analysis. Examples: Heal, Soothe, Restoration.

Spells with the Healing trait that restore HP are HEALING, not buff.
Only add "buff" if the spell grants a non-healing mechanical advantage:
- Stat bonuses (AC, saves, attack rolls) → buff
- New abilities (fly, see invisible, resistance) → buff
- Temporary HP → buff (this IS a mechanical advantage beyond HP restoration)
- Extra actions → buff

Just restoring HP or removing conditions is healing, NOT buff.
Just having a sustained duration doesn't make it buff.

Examples:
- Spirit Link (transfers HP) → healing only, NOT buff
- Soothe (heals + gives bonus to saves vs mental) → healing + buff (the save bonus is non-healing)

## damage_types — array

Valid values (18): Fire, Cold, Elec, Acid, Force, Sonic, Void, Vitality, Spirit, Mental, Poison, Bludg, Pierc, Slash, Bleed, Varies, Unspecified

Rules (Decision 005):
1. Only tag damage dealt TO ENEMIES. "Deals 4d6 fire damage" → Fire. "Grants resistance 5 to fire" → NOT Fire. "Immune to acid" → NOT Acid.
2. Include both initial and persistent damage. Cinder Swarm (piercing initial + persistent fire) → ["Pierc", "Fire"].
3. Variable-type spells: tag "Varies" PLUS each chooseable type. Elemental Breath → ["Varies", "Fire", "Cold", "Elec", "Acid"].
4. Multi-damage spells: tag every type. Thunderstrike (electricity + sonic) → ["Elec", "Sonic"].
5. Ignore resistance/immunity language and damage types appearing only as triggers or qualifiers.
6. Ignore incidental/conditional damage that wouldn't motivate spell selection.
7. Physical types (Bludg, Pierc, Slash) are valid when the spell deals them directly. But see POLYMORPH and SUMMON rules above — form/creature damage doesn't count.
8. Use the abbreviations exactly: Elec (not Electricity), Bludg, Pierc, Slash.
9. Excluded: Light, Darkness, Holy, Unholy, Untyped — these are qualifiers, not damage types.
10. Spells with no damage to enemies → [].
11. Bleed: tag "Bleed" ONLY when the spell text contains the literal phrase "persistent bleed damage" or "bleed damage". Persistent damage of OTHER types (e.g., "persistent piercing damage", "persistent fire damage", "persistent acid damage") is NOT Bleed — tag the named type. Examples:
    - Blood Vendetta: "1d6 persistent bleed damage" → ["Bleed"] ✓
    - Cinder Swarm: "1d6 persistent piercing damage" → ["Pierc"] (NOT Bleed)
    - Brine Dragon Bile: "1d6 persistent acid damage" → ["Acid"] (NOT Bleed)
    - Acid Storm: "persistent acid damage" → ["Acid"] (NOT Bleed)
    The word "bleed" must literally appear in the damage description, not be inferred from "persistent" + "piercing/slashing".
13. ZERO TOLERANCE for damage type hallucination: damage_types comes ONLY from explicit damage statements in the spell text — phrases like "deals 4d6 fire damage" or "[type] damage". Do NOT add a damage type because:
    - The spell mentions a creature type (e.g., undead, fiend) — that's a target descriptor, not damage
    - The spell mentions a trait (e.g., the Vitality trait on a healing spell) — traits are not damage statements
    - The spell could plausibly relate to a type — only literal text counts
    - Examples of LLM errors to avoid: tagging Vitality on Scouring Pulse (no "vitality damage" in text), tagging Void on Blood-Feasting Breath (its damage is piercing per text), tagging Bleed when text says "persistent piercing"
12. Unspecified: tag "Unspecified" when the spell deals damage but names no damage type. The text says "the target takes Xd10 damage" with no type word. Examples: Disintegrate ("12d10 damage (no damage type)"), Power Word Kill. Do NOT tag Unspecified if any named type is present.

## conditions_imposed — array of canonical PF2e remaster condition names

Rules (Decision 006):
1. ⚠️ ONLY tag ADVERSE conditions imposed on HOSTILE targets. The two-part test:
   (a) Is the spell's target an ENEMY (the caster wants this target to suffer), AND
   (b) Is the condition HARMFUL to that target?
   If either answer is "no," DO NOT TAG. Buff and utility spells almost always have conditions_imposed = [].
   - "Target is Frightened 1 on a failed save" → tag (adverse, on enemy).
   - Haste targets willing creatures and grants Quickened. Quickened is a BUFF given to an ALLY. Even though "Quickened" is the name of a PF2e condition, granting it to a willing ally is NOT imposing a condition. DO NOT TAG. conditions_imposed for Haste = [].
   - Invisibility makes the target Undetected/Hidden. Target is willing/self → ALLY. Condition is beneficial → BUFF. DO NOT TAG. conditions_imposed for Invisibility = [].
   - Mage Armor / Mystic Armor / Runic Body grants the target a bonus → DO NOT TAG (the target is an ally).
   - "You are immune to frightened" → DO NOT TAG (no enemy involved).
   - "Removes blinded from an ally" → DO NOT TAG (ally, beneficial).
   - Heuristic: if the spell's defense_tags is empty (no enemy save/AC), conditions_imposed should almost always be []. The spell is targeting allies/self/objects, not imposing on enemies.
2. Tag at every save outcome where the condition appears on the enemy. If Stunned on crit fail and Slowed on fail, tag both.
3. Include conditions from persistent/lingering effects (e.g., persistent damage that imposes Sickened — Sickened is the condition, NOT "Persistent Damage").
4. ⚠️ Use CANONICAL PF2e remaster condition names ONLY. "Persistent Damage" is NOT a condition — it's a damage state. "Dying" is a condition but only tag it if the spell explicitly imposes the Dying condition (not just "the creature dies"). If a spell's text says "the creature dies," do NOT tag any condition for that effect — death is not a condition. Drop severity numbers ("Sickened 2" → "Sickened"). "Flat-footed" → "Off-Guard". The valid condition names are: Blinded, Clumsy, Concealed, Confused, Controlled, Dazzled, Deafened, Doomed, Drained, Dying, Encumbered, Enfeebled, Fascinated, Fatigued, Fleeing, Frightened, Grabbed, Hidden, Immobilized, Invisible, Off-Guard, Paralyzed, Petrified, Prone, Quickened, Restrained, Sickened, Slowed, Stunned, Stupefied, Unconscious, Undetected, Unnoticed, Wounded. Do not invent names not on this list.
5. Spells with no adverse conditions imposed on enemies → [].
6. ⚠️ See LITERAL TEXT RULE and ANTI-X RULE above. These take precedence for condition tagging.
7. ⚠️ Only tag conditions imposed on the TARGET (enemies). Never tag caster-side penalties. Examples of caster-side effects to IGNORE: stunned on failed counteract, drained after casting, fatigued from overexertion. conditions_imposed tracks what happens to enemies only.
8. ⚠️ Attitude states are NOT conditions for this tool. Friendly, Helpful, Indifferent, Unfriendly, and Hostile are NPC social attitudes (from the social encounter rules) — they are NOT mechanical combat conditions. **NEVER include "Unfriendly", "Hostile", "Friendly", "Helpful", or "Indifferent" in conditions_imposed or conditions_by_outcome under ANY circumstance.** They are not on the canonical condition list above.
9. ⚠️ Weakness, Resistance, and Immunity are NOT conditions. Never tag these in conditions_imposed. Weakness imposed on enemies goes in the separate `weaknesses_imposed` field.

## weaknesses_imposed — array of damage type strings

Valid values: same set as damage_types (18 values listed above).

If the spell causes the target to become weak to a damage type, list those damage types here. Most spells will have an empty array. ~10 spells impose weakness.

Examples:
- Blood Vendetta: "weakness 1 to piercing and slashing damage" → ["Pierc", "Slash"]
- Void Warp: weakness to void → ["Void"]
- Fireball: deals fire damage but does NOT impose weakness → []

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

Valid populator roles to EMIT (6): damage, debuff, buff, control, utility, prebuffs.

DO NOT EMIT: healing, reactions, oneAction, silverBullets. Reasons:
- healing/reactions/oneAction are auto-derived from structured data (Healing trait, Reaction action, Single Action) by the prior pipeline pass. Re-emitting them creates noise. They are already correct; leave them alone.
- silverBullets is editorial-only — never emit it.

If your analysis suggests one of those four roles applies, simply do not include it in roles_added. The structured pass handles it.

Definitions (Decision 011):
- damage: spell deals meaningful HP damage to enemies as a primary or significant function. Includes instantaneous AoE damage spells (Fireball, Lightning Bolt, Eclipse Burst). The fact that damage covers an area does NOT make it control — it's still damage. See POLYMORPH, WEAPON ENHANCEMENT, and SUMMON rules — damage from forms/weapons/creatures doesn't qualify.
- debuff: spell imposes adverse conditions on enemies OR imposes weakness as a primary/significant function. Weakness imposition qualifies for debuff even without condition imposition — weakness degrades enemy survivability. SAVE-OUTCOME THRESHOLD:
   * Auto-effect (no save): debuff = yes (always plannable).
   * Success: debuff = yes (~50%+ trigger rate).
   * Failure: debuff = yes IF significant function. Slow (Slowed on fail) = yes. Dehydrate (damage + Enfeebled on fail) = yes (also gets damage).
   * ⚠️ Critical Failure ONLY: debuff = NO. The condition is a "jackpot," not a plannable function. CANONICAL EXAMPLE: Eclipse Burst has Blinded on critical failure and NOTHING on failure or success. Its roles_added is exactly ["damage"] — NOT ["damage", "debuff"]. Same logic for any damage spell whose only condition is on critical failure.
   * EXCEPTION: Critical-fail-only with Incapacitation AND no other function = yes. Sleep is a debuff despite the crit-fail gate because the entire spell is the condition.
- buff: spell targets allies and enhances capabilities (stat bonuses, new abilities, protective effects). Damage prevention/reduction = buff. Polymorph battle forms = buff (see rule above). Weapon enhancements = buff (see rule above).
- control: spell creates a PERSISTENT terrain effect, zone, or barrier with a duration (rounds/minutes/hours) that shapes the battlefield over time. The hallmark is duration + spatial constraint. Examples: Wall of Stone (persistent barrier — control only), Wall of Fire (persistent damage zone — control AND damage). ALSO: spells that force enemies to attack their allies or override target behavior to cause friendly fire (Paranoia, Confusion) are control. ALSO: spells with the Summon trait place another actor on the battlefield — the summoned creature blocks, tanks, flanks, and reshapes positioning. INSTANTANEOUS AREA DAMAGE IS NOT CONTROL: Fireball, Lightning Bolt, Eclipse Burst — none are control.
- utility: spell solves out-of-combat problems — movement, scouting, environmental adaptation, information. Fly = utility + buff. Invisibility = utility + buff.
- prebuffs: long-duration (≥10 min) self/ally buff cast before combat. Must also qualify as buff.

## PREBUFFS ROLE

A spell qualifies for the "prebuffs" role if ALL of:
1. Duration is 10 minutes or longer (check the Duration field — "1 hour", "10 minutes",
   "8 hours", "until the next time you make your daily preparations")
2. The spell benefits allies or self (buff-like effect)
3. Casting it before combat is the intended use pattern (you wouldn't waste combat actions on it)

If a spell qualifies, add BOTH "buff" AND "prebuffs" to roles_added.

Common prebuffs that must be tagged (if you encounter them):
- Mystic Armor (1 hour) → buff + prebuffs
- False Vitality (8 hours) → buff + prebuffs
- Darkvision (1 hour) → buff + prebuffs
- Water Breathing (1 hour) → buff + prebuffs + utility
- Environmental Endurance (until next daily prep) → buff + prebuffs
- Tongues (1 hour) → buff + prebuffs + utility
- See the Unseen (10 minutes) → buff + prebuffs + utility
- Tailwind (8 hours) → buff + prebuffs
- Resist Energy (1 hour or varies) → buff + prebuffs
- Freedom of Movement (10 minutes) → buff + prebuffs + utility

Watch for duration text! "10 minutes", "1 hour", "8 hours", "24 hours", "until your next daily
preparations" all qualify. "Sustained up to 1 minute" does NOT qualify.

⚠️ DURATION CUTOFF IS STRICT. Less than 10 minutes → NO prebuffs. Examples:
- Fly: 5 minutes → NOT prebuffs (too short)
- Haste: 1 minute → NOT prebuffs
- Heroism: 10 minutes → IS prebuffs ✓
- Bless: 1 minute → NOT prebuffs
Anything 1-9 minutes is too short for the pre-combat prep pattern.

## defense_tags_added — array

The populator augments defense_tags with two possible values: "AC" and "Auto". NOTHING ELSE.

⚠️ FORBIDDEN VALUES: Fort, Ref, Will. These come from the structured pass and you MUST NOT emit them. If you find yourself about to write "Fort", "Ref", or "Will" in defense_tags_added, STOP — the only valid values are "AC" and "Auto". The validator WILL reject your response and you will be retried.

### MANDATORY: Add "AC" if ALL of:
1. The spell's existing defense_tags does NOT already include "AC", AND
2. The description text contains any of: "spell attack", "ranged spell attack", "melee spell attack", "make a spell attack roll", "attack roll against AC", "automatically hits" + creature target without save.

⚠️ HIGH-VALUE AC additions (the structured pass MISSES these because reactions and some spells don't carry the Attack trait in spell.json):
- **Brine Dragon Bile**: text says "Make a ranged spell attack against the triggering creature's AC" → defense_tags_added: ["AC"] ✓
- **Acid Splash / Telekinetic Projectile**: spell attack rolls → ["AC"] ✓

If you see "spell attack" in the text and AC isn't already in defense_tags, you MUST emit AC. The phrase "Make a ranged spell attack" or "Make a melee spell attack" is the trigger.

### MANDATORY: Add "Auto" if ALL of:
1. The spell's existing defense_tags is empty AND you did NOT add "AC" above, AND
2. The spell is offensive — has a combat role you're emitting (damage, debuff, or control), AND
3. The text confirms the spell affects enemies without any save and without an attack roll.

⚠️ HIGH-VALUE Auto additions (LLM has historically missed these — DO NOT MISS THEM):
- **Force Barrage**: text says "It **automatically hits** the target and deals 1d4+1 force damage" — literal "automatically hits" + no save + no attack → defense_tags_added: ["Auto"] ✓
- **Wall of Stone**: creates a stone wall on the battlefield, no save, no attack roll, control role → ["Auto"] ✓
- **Floating Flame**: places persistent flame, no save → ["Auto"] ✓
- **Magic Missile** (legacy): auto-hit force damage → ["Auto"] ✓

The trigger phrases for Auto are: "automatically hits", "no save" with a damage/debuff effect, or a control/wall/zone spell that just exists on the battlefield without requiring a save.

NOT Auto (existing defense_tags is non-empty — the structured pass already classified):
- Fireball (basic Reflex) → defense_tags has "Ref", do NOT add Auto
- Wall of Fire (Reflex on pass-through) → defense_tags has "Ref", do NOT add Auto
- Fear (non-basic Will) → defense_tags has "Will", do NOT add Auto

⚠️ NOT Auto for SUMMON spells: Spells with the Summon trait do NOT get "Auto" even though they have no save and no attack roll. The summon spell creates an ALLY (the summoned creature) — it does not affect enemies directly. The "control" role captures its battlefield impact. Summon Animal, Summon Construct, Summon Dragon, Summon Plant or Fungus, and all other Summon-trait spells → defense_tags_added: []

Otherwise → [].
AC and Auto are mutually exclusive — never both.

## reliability_tags_added — array

Valid values: "Auto-effect", "Success-effect"

Add "Auto-effect" if AND ONLY IF you added "Auto" to defense_tags_added (above).

Add "Success-effect" if AND ONLY IF ALL of:
1. basic_save is FALSE, AND
2. The spell text contains an explicit "Success" entry in its degrees-of-success block, AND
3. That Success entry describes a HARMFUL effect on the enemy (a condition like Frightened/Slowed, partial damage, a tactical consequence). "The target is unaffected" or "no effect" or absence of a Success entry means NO Success-effect.

⚠️ ABSOLUTE RULE — basic_save=TRUE: DO NOT emit Success-effect. Ever. Basic-save spells get Success-effect from the structured pass automatically. Re-emitting it is a HARD ERROR. Check basic_save FIRST in SPELL CONTEXT — if true, your reliability_tags_added list cannot contain "Success-effect".

NEGATIVE EXAMPLES (basic_save=TRUE → NEVER emit Success-effect):
- **Fireball** (basic Reflex) → reliability_tags_added: [] — DO NOT emit Success-effect.
- **Chilling Spray** (basic Reflex) → reliability_tags_added: [] — DO NOT emit Success-effect (the half-damage on success is captured by the basic-save mechanic, not by this tag).
- **Cinder Swarm** (basic Fortitude or basic Reflex) → reliability_tags_added: [] — DO NOT emit.
- **Dehydrate** (basic Fortitude) → reliability_tags_added: [] — DO NOT emit even though Failure adds Enfeebled.
- **Blood Vendetta** (Will, NOT basic) → may emit if Success has a meaningful rider. Check rule below.

POSITIVE EXAMPLES (basic_save=FALSE AND Success has a harmful rider → DO emit):
- **Fear** (Will, not basic) — Success = "Frightened 1" → reliability_tags_added: ["Success-effect"] ✓
- **Slow** (Fort, not basic) — Success = "Slowed 1 for 1 round" → ["Success-effect"] ✓
- **Vision of Death** (Will, not basic) — Success = "half damage and is frightened 1" → ["Success-effect"] ✓
- **Synesthesia** (Will, not basic) — Success = "affected for 1 round" with conditions → ["Success-effect"] ✓

NEGATIVE EXAMPLES (basic_save=FALSE but Success is "unaffected" or absent → do NOT emit):
- **Earthbind** (Fort, not basic) — Success = "Falls safely up to 120 feet" (no debuff on success) → []
- **Paranoia** (Will, not basic) — Critical Success = unaffected; Success = unfriendly attitude (per Decision 006, attitude states are NOT conditions; per the literal text rule, this isn't a tagged condition either) → debatable, but golden set says []
- **Enfeeble** (Fort, not basic) — Success = "enfeebled 1 until start of your next turn" → ["Success-effect"] ✓ (note: this IS a condition on Success)

DECISION TEST: open the spell's degrees-of-success block.
- Step 1: Is basic_save TRUE? If yes → []. STOP HERE.
- Step 2: Does the Success line name a PF2e condition, deal damage, or describe a tactical effect on the target? If yes → ["Success-effect"]. If no → [].

## targeting_tags_added — array

Valid values: "ST", "Multi"

The "_added" suffix means "what THIS pass is contributing on top of what's already there." Default is [].

### MANDATORY two-step procedure

STEP 1: Read SPELL CONTEXT.targeting_tags. Note what's already there (typically "ST" or "Multi", sometimes both).

STEP 2: Scan the spell description for evidence of an UNTAGGED targeting mode. Specifically look for:

(a) **Heightened multi-target modes** — `**Heightened (Nth)**` text saying "up to N creatures", "all creatures in [area]", "X targets". If found AND "Multi" is not already in SPELL CONTEXT.targeting_tags → add "Multi".

(b) **Variable-action multi-target modes** — 3-action or higher mode that expands to multiple creatures (e.g., Heal's 3-action 30-ft emanation). If found AND "Multi" is not already there → add "Multi".

(c) **Multi-shard / multi-projectile mechanics** — Force Barrage shoots up to 3 shards "to a maximum of three shards for 3 actions" with "You choose the target for each shard individually" → add "Multi".

(d) **Emanation centered on target** — spell creates an aura on the target that affects nearby enemies (e.g., "5-foot emanation around the target"). If structured area_type is null but text describes an emanation → add "Multi" (note: if the structured pass set area_type, Multi is already there).

⚠️ ABSOLUTE RULE: "Do not re-emit" means do not REPEAT a tag that's already present. It does NOT mean "the spell is fully tagged, so add nothing." If the structured pass tagged "ST" because target=1 creature, and a heightened entry adds multi-targeting, you MUST add "Multi". This is the WHOLE POINT of this populator pass for these spells.

### Canonical examples — MEMORIZE these

These are the HIGH-VALUE Multi additions. The LLM has historically missed them. Get these right:

| Spell | SPELL CONTEXT targeting_tags | Heightened text | targeting_tags_added | Why |
|---|---|---|---|---|
| Fear | ["ST"] | Heightened (3rd): "up to five creatures" | ["Multi"] | base ST + heightened Multi |
| Slow | ["ST"] | Heightened (6th): "up to 10 creatures" | ["Multi"] | base ST + heightened Multi |
| Synesthesia | ["ST"] | Heightened (7th): "up to 5 creatures" | ["Multi"] | base ST + heightened Multi |
| Paranoia | ["ST"] | Heightened (6th): "up to 5 creatures" | ["Multi"] | base ST + heightened Multi |
| Force Barrage | ["ST"] | "to a maximum of three shards... target for each shard individually" | ["Multi"] | multi-shard mechanic |
| Heal | [] | 3-action: "all living and undead creatures in the burst" | ["Multi"] | variable-action multi |
| Phantasmal Killer (legacy) | ["ST"] | (no heightened multi-mode) | [] | strictly single-target |

### Re-emission errors to AVOID

- Earthbind has target=1 creature → SPELL CONTEXT shows ST already. Do NOT add ST again.
- Brine Dragon Bile has target=the creature that took damage → ST already there. Do NOT add ST.
- Runic Weapon has target=1 weapon → ST already there. Do NOT add ST.
- Fly has target=1 creature → ST already there. Do NOT add ST.

Canonical heightened-Multi examples (the structured pass shows ST; you must add Multi):
- Fear: Heightened (3rd) targets up to 5 creatures → add "Multi" ✓
- Slow: Heightened (6th) targets up to 10 creatures → add "Multi" ✓
- Synesthesia: Heightened (7th) targets up to 5 creatures → add "Multi" ✓
- Paranoia: Heightened (6th) targets up to 5 creatures → add "Multi" ✓
- Phantasmal Killer: targets 1 creature with no heightened multi-mode → do NOT add Multi

ALSO add "Multi" when a spell has a 3-action mode (or other variable-action mode) that targets multiple creatures, even if the base mode is single-target.

Canonical re-emission errors to AVOID:
- Earthbind has target=1 creature → SPELL CONTEXT shows ST already. Do NOT add ST again.
- Brine Dragon Bile has target=1 creature → ST already there. Do NOT add ST.
- Runic Weapon has target=1 weapon → ST already there. Do NOT add ST.

## heighten_quality (REQUIRED — never null)

Valid values: scales-well, scales-okay, fixed-meaningful, fixed-minor, no-heighten, scaling-irrelevant

DETERMINISTIC RULE: If heighten_pattern is "none", you MUST output "no-heighten". No exceptions.

Assess how well this spell scales when heightened:

- "scales-well": Plus-pattern (+1, +2) with meaningful per-rank improvement. Stays competitive at higher ranks.
   Examples: Fireball (+2d6/rank), Force Barrage (+1 missile/2 ranks), Lightning Bolt (+1d12/rank), Scouring Pulse (+1d6/rank), Wall of Fire (+2d6/rank), Eclipse Burst (+1d8/rank), Blood-Feasting Breath (+1d10/rank).

- "scales-okay": Plus-pattern but improvement is marginal (e.g., +1d4/rank on a low base) OR damage scales but the spell is outclassed by higher-rank alternatives. Wall of Stone (+15 HP per wall section per +2 ranks) — modest, outclassed.

- "fixed-meaningful": Fixed heightened entries that add SIGNIFICANT capability — new modes, new targets, new effects, larger bonuses, or qualitatively different durations.
   Examples: Fear (3rd: 1→5 targets), Slow (6th: 1→10 targets), Fly (7th: 5 min → 1 hour), Haste (7th: adds Quickened to multiple), Synesthesia (7th: 1→5 targets), Mystic Armor (4th/6th/8th/10th: AC bonus +1/+2/+2/+3 and saves +1/+1/+2/+3 — significant defensive gains per heighten step), Water Breathing (3rd: 1hr→8hr; 4th: until daily prep — qualitative duration jumps), Environmental Endurance (3rd: severe both temps; 5th: severe + extreme — protection scope expands), Summon Animal (each rank summons a different creature tier — qualitatively different), Monstrosity Form (each rank unlocks new forms with new abilities).

   **Prebuffs that scale meaningfully via fixed heighten entries are fixed-meaningful, NOT scaling-irrelevant.** AC/save bonuses, duration extensions, and protection-scope expansions are all meaningful gains.

- "fixed-minor": Fixed heightened entries with truly marginal improvement (e.g., +5 ft range, +1 to a single check, no other change). RARE — most fixed heightening is meaningful.

- "no-heighten": Spell has no heightened entry. MANDATORY if heighten_pattern is "none".

- "scaling-irrelevant": The spell's primary value is independent of scaling. Pure-utility spells where the function is binary (Comprehend Language, Detect Magic, Sigil), silver bullets (Revealing Light) that work equally at any rank by design, or spells where heighten entries genuinely change nothing meaningful. **Most prebuffs are NOT scaling-irrelevant** — if the heighten entries improve the bonus, duration, or scope, use fixed-meaningful instead.

CALIBRATION: Most plus-pattern damage spells are scales-well. Most prebuffs that have heighten entries are fixed-meaningful (the bonus, duration, or scope grows). Only mark a prebuff scaling-irrelevant if its heighten entries truly change nothing strategic. Most condition spells with target-count heightening are fixed-meaningful. Most polymorph/summon spells are fixed-meaningful. fixed-minor is rare — only use when scaling is genuinely trivial.

DAMAGE-ONLY H+2 RULE: If the spell's only combat role is damage (ignore prebuffs — that's a timing classification, not a combat function) AND heighten_pattern is +2, output "scales-okay" — not "scales-well". Damage has a tight power curve; +2 scaling leaves dead levels where the spell is below-curve compared to +1 competitors. This does NOT apply to multi-role spells (damage + debuff, damage + control, etc.) — those provide value independent of the damage curve, and the LLM should assess them on their full merit.

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


def load_editorial_overrides():
    """Load editorial overrides — manual fixes that apply during --merge.

    Each entry's `overrides` dict directly replaces fields on the merged spell-data
    spell object (NOT populator output — the values are spell-data field names).
    Applied AFTER populator merge but BEFORE consistency rules, so the rules can
    re-derive role consistency from edited values.

    File format:
    [
      {
        "aonId": 1436,
        "name": "Acid Grip",
        "reason": "Why this override exists",
        "overrides": {
          "conditions_imposed": [],
          "conditions_by_outcome": null,
          ...
        }
      }
    ]

    Returns a dict keyed by aonId for fast lookup. Returns {} if the file does
    not exist (overrides are optional).
    """
    if not os.path.exists(EDITORIAL_OVERRIDES_PATH):
        return {}
    with open(EDITORIAL_OVERRIDES_PATH, "r", encoding="utf-8") as f:
        entries = json.load(f)
    return {e["aonId"]: e for e in entries}


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
        "weaknesses_imposed",
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

    if not isinstance(result.get("weaknesses_imposed", []), list):
        return None, "weaknesses_imposed not list"
    for v in result.get("weaknesses_imposed", []):
        if v not in VALID_DAMAGE_TYPES:
            return None, "invalid weaknesses_imposed type: %r" % v

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
        # Auto-fix: conditions_imposed is the deduplicated union of outcome arrays.
        # The LLM occasionally produces inconsistent output (e.g., listing a condition in
        # conditions_imposed but not in any outcome, or vice versa). Rather than failing,
        # we derive conditions_imposed deterministically from the outcomes — they're the
        # source of truth, conditions_imposed is just a flattened view.
        union = set()
        for v in cbo.values():
            union.update(v)
        result["conditions_imposed"] = sorted(union)

    if not isinstance(result["roles_added"], list):
        return None, "roles_added not list"
    for v in result["roles_added"]:
        if v not in POPULATOR_ROLES:
            return None, "invalid role: %r" % v

    if not isinstance(result["defense_tags_added"], list):
        return None, "defense_tags_added not list"
    for v in result["defense_tags_added"]:
        if v not in ("Auto", "AC"):
            return None, "defense_tags_added may only contain 'Auto' or 'AC', got %r" % v
    # Mutual exclusion: AC and Auto contradict each other.
    if "AC" in result["defense_tags_added"] and "Auto" in result["defense_tags_added"]:
        return None, "defense_tags_added cannot contain both AC and Auto"

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


LEGACY_DAMAGE_REMAP = {
    'Evil': 'Spirit', 'Good': 'Spirit',
    'Chaotic': 'Spirit', 'Lawful': 'Spirit',
    'Holy': 'Spirit',
}

PREBUFF_DURATION_PATTERNS = [
    r'\d+\s*hours?', r'\d+\s*days?',
    r'(\d+)\s*minutes',
    r'until.*(next|daily\s*prep)',
]

def likely_prebuff_duration(duration_raw):
    """Returns True if duration_raw suggests >=10 minutes."""
    if not duration_raw:
        return False
    text = duration_raw.lower()
    if 'sustained' in text:
        return False
    for pattern in PREBUFF_DURATION_PATTERNS:
        m = re.search(pattern, text)
        if m:
            if 'minutes' in pattern:
                if int(m.group(1)) >= 10:
                    return True
            else:
                return True
    return False


def post_process(result, spell_data_entry):
    """Apply deterministic cleanup rules after LLM produces a valid response.
    Catches systematic LLM errors that resist prompt instruction.
    """
    existing_defense = set(spell_data_entry.get("defense_tags") or [])

    # Rule: Auto is only valid when existing defense_tags is empty. If Fort/Ref/Will/AC
    # is already there, the spell is not an "Auto" spell — strip Auto and Auto-effect.
    if existing_defense and "Auto" in result.get("defense_tags_added", []):
        result["defense_tags_added"] = [v for v in result["defense_tags_added"] if v != "Auto"]
        result["reliability_tags_added"] = [v for v in result.get("reliability_tags_added", []) if v != "Auto-effect"]

    # Post-process: remap legacy alignment damage types to Spirit
    result["damage_types"] = [LEGACY_DAMAGE_REMAP.get(dt, dt) for dt in result.get("damage_types", [])]
    result["weaknesses_imposed"] = [LEGACY_DAMAGE_REMAP.get(w, w) for w in result.get("weaknesses_imposed", [])]

    trait_raw = spell_data_entry.get("trait_raw") or []

    # Summon trait → control role
    if 'Summon' in trait_raw:
        if 'control' not in result.get('roles_added', []):
            result['roles_added'] = result.get('roles_added', []) + ['control']

    return result


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
        markdown=raw_spell.get("markdown", "")[:12000],
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
            parsed = post_process(parsed, spell_data_entry)
            return parsed, usage
        last_error = "validation: %s" % err
        time.sleep(backoff)
        backoff = min(backoff * 2, 16.0)

    raise LLMError("after %d attempts: %s" % (max_retries, last_error))


# ---------------------------------------------------------- merge --------

def _apply_consistency_rules(spell):
    """Apply deterministic consistency cleanup after merging populator output.
    Catches systematic LLM errors so the validator doesn't trip.
    """
    fixes = []

    # Rule: heighten_pattern=none implies heighten_quality=no-heighten
    # (except scaling-irrelevant, which is valid for no-heighten spells via editorial override).
    if spell.get("heighten_pattern") == "none" and spell.get("heighten_quality") not in ("no-heighten", "scaling-irrelevant"):
        spell["heighten_quality"] = "no-heighten"
        fixes.append("forced heighten_quality=no-heighten")

    # Rule: Damage-only spells with +2 heighten pattern cap at scales-okay.
    # Damage has a tight power curve — +2 scaling leaves dead levels.
    # Multi-role spells are exempt (other roles provide non-damage value).
    populator_roles = set(spell.get("roles", [])) - {"healing", "reactions", "oneAction", "silverBullets", "prebuffs"}
    if (spell.get("heighten_pattern") == "plus_2"
            and spell.get("heighten_quality") == "scales-well"
            and populator_roles == {"damage"}):
        spell["heighten_quality"] = "scales-okay"
        fixes.append("capped heighten_quality=scales-okay (damage-only +2 rule)")

    # Rule: Auto defense tag requires a combat role. Otherwise strip Auto + Auto-effect.
    combat_roles = {"damage", "debuff", "control"}
    has_combat = any(r in combat_roles for r in spell.get("roles", []))
    if "Auto" in spell.get("defense_tags", []) and not has_combat:
        spell["defense_tags"] = [t for t in spell["defense_tags"] if t != "Auto"]
        spell["reliability_tags"] = [t for t in spell.get("reliability_tags", []) if t != "Auto-effect"]
        fixes.append("stripped Auto (no combat role)")

    # Rule: conditions_imposed non-empty but conditions_by_outcome null → likely Auto-effect
    # conditions. Per prompt convention, put them in failure slot.
    cbo = spell.get("conditions_by_outcome")
    ci = spell.get("conditions_imposed", []) or []
    if ci and cbo is None:
        spell["conditions_by_outcome"] = {
            "critical_success": [],
            "success": [],
            "failure": list(ci),
            "critical_failure": list(ci),
        }
        fixes.append("derived conditions_by_outcome from imposed (auto-effect convention)")

    # Rule: damage_types non-empty implies damage role.
    if spell.get("damage_types") and "damage" not in spell.get("roles", []):
        spell["roles"] = sorted(set(spell.get("roles", []) + ["damage"]))
        fixes.append("added damage role")

    # Rule: conditions at success/failure (not crit-fail-only) imply debuff role.
    cbo = spell.get("conditions_by_outcome")
    if cbo is not None:
        non_critfail = bool(cbo.get("success") or cbo.get("failure"))
        if non_critfail and "debuff" not in spell.get("roles", []):
            spell["roles"] = sorted(set(spell.get("roles", []) + ["debuff"]))
            fixes.append("added debuff role (conditions at success/failure)")

    # Rule: Multi requires offensive output (damage_types or conditions_imposed non-empty).
    # Area_type alone is insufficient — pure zone-control spells are battlefield reshaping,
    # not "mob-fight options." Decision 004, Cycle 07.
    if "Multi" in spell.get("targeting_tags", []):
        if not spell.get("damage_types") and not spell.get("conditions_imposed"):
            spell["targeting_tags"] = [t for t in spell["targeting_tags"] if t != "Multi"]
            fixes.append("stripped Multi (no offensive output)")

    # Rule: weaknesses_imposed non-empty implies debuff role. Decision 011.
    if spell.get("weaknesses_imposed") and "debuff" not in spell.get("roles", []):
        spell["roles"] = sorted(set(spell.get("roles", []) + ["debuff"]))
        fixes.append("added debuff role (weaknesses_imposed non-empty)")

    # Rule: Summon trait → control role
    if 'Summon' in spell.get('trait_raw', []):
        if 'control' not in spell.get('roles', []):
            spell['roles'] = sorted(set(spell.get('roles', []) + ['control']))
            fixes.append("added control role (Summon trait)")

    # Rule: prebuffs heuristic safety net — long-duration buff spells get prebuffs
    if likely_prebuff_duration(spell.get('duration_raw', '')) and 'buff' in spell.get('roles', []):
        if 'prebuffs' not in spell.get('roles', []):
            spell['roles'] = sorted(set(spell.get('roles', []) + ['prebuffs']))
            fixes.append("added prebuffs role (heuristic: duration=%s)" % spell.get('duration_raw', ''))

    # Rule: every spell must have at least one role. If empty, default to utility.
    if not spell.get("roles"):
        spell["roles"] = ["utility"]
        fixes.append("defaulted roles=[utility] (was empty)")

    return fixes


def merge_into_spell_data():
    print("Loading spell-data.js and populator-results.json...")
    spell_data = load_spell_data()
    results = load_results()
    overrides = load_editorial_overrides()
    if overrides:
        print("  loaded %d editorial overrides from data/editorial-overrides.json" % len(overrides))
    if not results:
        print("  populator-results.json is empty or missing — nothing to merge")
        return

    by_aon = {s["aonId"]: s for s in spell_data["spells"]}
    merged_count = 0
    skipped = []
    fix_counter = Counter()

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
        spell["weaknesses_imposed"] = list(populated.get("weaknesses_imposed", []))
        spell["heighten_quality"] = populated.get("heighten_quality", None)

        # Augmented (union) fields.
        spell["roles"] = sorted(set(spell.get("roles", []) + list(populated.get("roles_added", []))))
        spell["defense_tags"] = sorted(set(spell.get("defense_tags", []) + list(populated.get("defense_tags_added", []))))
        spell["reliability_tags"] = sorted(set(spell.get("reliability_tags", []) + list(populated.get("reliability_tags_added", []))))
        spell["targeting_tags"] = sorted(set(spell.get("targeting_tags", []) + list(populated.get("targeting_tags_added", []))))

        # Offense Evaluation gate: if defense_tags ended up empty, clear offense fields.
        # C23 §G: targeting_tags + targeting_subtypes + st_incap are Offense Evaluation
        # outputs too — buffs/utility/healing must not carry ST/Multi.
        if not spell["defense_tags"]:
            spell["damage_types"] = []
            spell["conditions_imposed"] = []
            spell["conditions_by_outcome"] = None
            spell["weaknesses_imposed"] = []
            spell["reliability_tags"] = [t for t in spell["reliability_tags"] if t == "Auto-effect"]
            spell["targeting_tags"] = []
            spell["targeting_subtypes"] = []
            spell["st_incap"] = False

        merged_count += 1

    # Apply editorial overrides BEFORE consistency rules. Manual fixes take precedence
    # over the populator's output but still get fed through the consistency pipeline so
    # role/role-completeness invariants are re-derived from the edited values.
    override_count = 0
    by_aon = {s["aonId"]: s for s in spell_data["spells"]}
    for aon_id, entry in overrides.items():
        spell = by_aon.get(aon_id)
        if spell is None:
            print("  WARN: editorial override aonId=%s not found in spell-data — skipping" % aon_id)
            continue
        for field, value in entry.get("overrides", {}).items():
            spell[field] = value
        override_count += 1
    if override_count:
        print("  applied %d editorial overrides" % override_count)

    # Apply consistency rules across ALL spells (including skipped ones with no populator data).
    cleanup_count = 0
    for spell in spell_data["spells"]:
        fixes = _apply_consistency_rules(spell)
        if fixes:
            cleanup_count += 1
        for f in fixes:
            fix_counter[f] += 1

    # Re-apply editorial heighten_quality overrides — editorial judgment wins over
    # consistency rules (e.g., Force Barrage keeps scales-well per Heidi decision).
    for aon_id, entry in overrides.items():
        if "heighten_quality" in entry.get("overrides", {}):
            spell = by_aon.get(aon_id)
            if spell and spell["heighten_quality"] != entry["overrides"]["heighten_quality"]:
                spell["heighten_quality"] = entry["overrides"]["heighten_quality"]

    # Re-apply offense gate: consistency rules may have stripped Auto, leaving
    # defense_tags empty. In that case, offense fields must be cleared per Decision 016.
    for spell in spell_data["spells"]:
        if not spell.get("defense_tags"):
            if spell.get("damage_types") or spell.get("conditions_imposed") or spell.get("conditions_by_outcome") or spell.get("weaknesses_imposed"):
                spell["damage_types"] = []
                spell["conditions_imposed"] = []
                spell["conditions_by_outcome"] = None
                spell["weaknesses_imposed"] = []
                spell["reliability_tags"] = [t for t in spell.get("reliability_tags", []) if t == "Auto-effect"]
                fix_counter["re-applied offense gate after Auto strip"] += 1

    spell_data["generated"] = datetime.now(timezone.utc).isoformat()
    write_spell_data(spell_data)
    print("  merged %d results into spell-data.js" % merged_count)
    print("  applied consistency cleanup to %d spells:" % cleanup_count)
    for fix, n in fix_counter.most_common():
        print("    %d × %s" % (n, fix))
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


def _values_match(exp_val, act_val):
    """Order-tolerant equality. Lists are compared as sets. Dicts whose values
    are lists are compared key-by-key with set semantics. Everything else uses ==.
    """
    if isinstance(exp_val, list) and isinstance(act_val, list):
        return set(exp_val) == set(act_val)
    if isinstance(exp_val, dict) and isinstance(act_val, dict):
        if set(exp_val.keys()) != set(act_val.keys()):
            return False
        for k in exp_val:
            if not _values_match(exp_val[k], act_val[k]):
                return False
        return True
    return exp_val == act_val


def golden_set_diff(expected, actual, tolerance_fields):
    """Compare expected and actual populator outputs. Returns (status, details)."""
    diffs = []
    fuzzy = []
    for field, exp_val in expected.items():
        act_val = actual.get(field)
        if not _values_match(exp_val, act_val):
            msg = "%s: expected %s, got %s" % (field, exp_val, act_val)
            if field in tolerance_fields:
                fuzzy.append(msg)
            else:
                diffs.append(msg)

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
