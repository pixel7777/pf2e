// Unified tag definitions — single authoritative source for all tag tooltips.
// Merged from SPELL_DATA.tagDefs (curated.js) and TAG_TOOLTIPS (coverage.js).
// Cycle 17, B3.
window.TAG_DEFINITIONS = {
  // ── Defense ──
  "AC": "Targets AC via attack roll. Benefits from teamwork stacking (off-guard, Bless, fortune effects).",
  "Fort": "Targets Fortitude save. Availability varies by tradition.",
  "Ref": "Targets Reflex save. Most blast spells target Reflex.",
  "Will": "Targets Will save. Availability varies sharply by tradition — Occult excels, Primal struggles.",
  "Auto": "Bypasses saves and attack rolls entirely. The effect just happens. Rare and valuable for reliability.",
  "Basic": "Basic saving throw — guaranteed half damage on a success, double on critical failure.",

  // ── Targeting ──
  "ST": "Can effectively target a single enemy. Your boss-fight tools.",
  "Multi": "Can effectively target multiple enemies. Your mob-fight tools. Includes area spells, multi-target spells, and zone effects.",
  "AoE": "Area of Effect — hits multiple targets in a defined shape.",
  "Line": "Line area shape.",
  "Wall": "Creates a wall — blocks movement, line of sight, or deals damage to creatures passing through.",
  "Cone": "Cone area shape.",
  "Burst": "Burst area shape.",
  "Emanation": "Emanation area shape.",

  // ── Damage Types ──
  "Acid": "Acid damage. Less commonly resisted than Fire.",
  "Cold": "Cold damage. Good complement to Fire — fire-immune creatures often have cold weakness.",
  "Elec": "Electricity damage.",
  "Fire": "Fire damage. Most common blast type — also most commonly resisted.",
  "Force": "Force damage. Practically irresistible — premium coverage type.",
  "Mental": "Mental damage. Key occult damage type. Doesn’t work on mindless creatures.",
  "Poison": "Poison damage. Many creatures are immune — tracking this warns you about the gap.",
  "Sonic": "Sonic damage. Rarely resisted.",
  "Spirit": "Spirit damage. Hard to resist. Key divine damage type.",
  "Vitality": "Vitality damage (formerly Positive). Hits undead.",
  "Void": "Void damage (formerly Negative). Hits all living creatures. One of the hardest-to-resist types.",
  "Bludg": "Bludgeoning damage.",
  "Pierc": "Piercing damage.",
  "Slash": "Slashing damage.",
  "Bleed": "Persistent bleed damage. Bypasses most resistances — stopped only by a DC 15 flat check or healing.",
  "Varies": "Damage type chosen on cast. Excellent for coverage — one slot, multiple type options.",
  "Unspecified": "Spell deals damage but names no type (Disintegrate, Power Word Kill). Can’t be resisted by type-specific resistance — but also can’t exploit type-specific weakness.",

  // ── Conditions ──
  "Blinded": "Total visual shutdown. Target is off-guard to everything and can’t target anything it can’t precisely sense.",
  "Dazzled": "20% miss chance on all visual targeting. Stronger than it looks.",
  "Frightened": "Penalizes ALL checks, DCs, attacks, and saves. The workhorse debuff — even Frightened 1 on a successful save is meaningful.",
  "Off-Guard": "−2 AC. Enables sneak attack and other flat-footed-dependent features from allies.",
  "Paralyzed": "Complete action denial. Target drops everything, falls prone, can’t act.",
  "Prone": "Costs an action to stand up — pseudo action denial. −2 to attack rolls while down.",
  "Restrained": "Immobilized + off-guard + clumsy combined. Comprehensive shutdown.",
  "Sickened": "Penalizes all checks and DCs. Broad-spectrum debuff.",
  "Slowed": "Removes actions. Taking one action from a 3-action boss is massive action economy.",
  "Stunned": "Stronger than Slowed but shorter duration. Devastating when it sticks.",
  "Unconscious": "Target drops everything, falls prone, can’t act, off-guard.",
  "Clumsy": "Anti-Dex martial. Penalizes AC, Reflex saves, and Dex-based skills.",
  "Enfeebled": "Anti-Str martial. Penalizes melee attacks, Athletics checks, and damage.",
  "Confused": "Near-equivalent to removal from combat. Target attacks randomly, including allies.",
  "Stupefied": "Anti-caster silver bullet. Penalizes spell DCs, spell attacks, and risks losing spells on cast.",
  "Immobilized": "Movement denial. Target can still attack but can’t reposition.",

  // ── Weakness ──
  "Imposes Weakness": "At least one assigned spell forces enemies to become weak to a damage type. Look for ★ markers on your damage type tags — those show which types you can impose weakness TO. Pairing a weakness-imposing spell with a damage spell of that type is a powerful combo.",

  // ── Reliability ──
  "Auto-effect": "Always does something — no save, no attack roll. Guaranteed output regardless of enemy defenses.",
  "Success-effect": "Meaningful effect even when the enemy succeeds on their save — includes basic-save spells (guaranteed half damage) and spells with condition riders on success. Especially important for single-target boss spells where the boss succeeds ~50% of the time.",

  // ── Action Economy ──
  "1-action": "Has a 1-action casting mode. Pairs with 2-action spells for the “perfect turn.” Best from low-rank slots.",
  "Reaction": "Cast as a reaction — acts on enemy turns without spending your combat actions. Doubles your action economy.",
  "Sustain-action": "Sustain for ongoing effect. Front-load value on turn 1, then sustain for 1 action on later turns — freeing 2 actions for more offense.",
  "3-action": "Has a 3-action casting mode. Uses your entire turn — maximum tempo investment. Worth it when the payoff justifies giving up your +1 action.",
  "Free": "Free action — costs nothing to use.",
  "Action Efficiency": "Gives you more actions than you spend. Summon spells are the classic example — 1 action to command your summon, which then gets 2 actions. Turns your 3-action turn into effectively 4+ actions of output.",

  // ── Special / Role Tags ──
  "Silver Bullet": "Dominates a narrow situation regardless of spell rank. Revealing Light vs. invisibility. Laughing Fit vs. dangerous reactions. Acid Grip vs. grabs. Worth preparing from any rank slot and an excellent use of low tier slots.",
  "Pre-buff": "Long-duration spell cast before combat. Converts a low-rank slot into free in-combat value without spending combat actions.",
  "Healing": "Restores ally HP. “Do I have any way to keep allies alive at this rank?” Arcane casters will never fill this — that’s a known tradition limitation, not a gap to fix.",

  // ── ST-Incap ──
  "ST-Incap": "Single-target spell with the Incapacitation trait. Against higher-level enemies (bosses), the target gets a degree-of-success upgrade on their save, making critical failures nearly impossible. Effective against on-level or lower enemies.",

  // ── Weakness subtypes (W:Type) ──
  "W:Fire": "This spell imposes weakness to Fire damage on the target. Pair with spells or allies that deal Fire damage for amplified effect.",
  "W:Cold": "This spell imposes weakness to Cold damage on the target. Pair with spells or allies that deal Cold damage for amplified effect.",
  "W:Acid": "This spell imposes weakness to Acid damage on the target. Pair with spells or allies that deal Acid damage for amplified effect.",
  "W:Elec": "This spell imposes weakness to Electricity damage on the target. Pair with spells or allies that deal Electricity damage for amplified effect.",
  "W:Force": "This spell imposes weakness to Force damage on the target. Pair with spells or allies that deal Force damage for amplified effect.",
  "W:Mental": "This spell imposes weakness to Mental damage on the target. Pair with spells or allies that deal Mental damage for amplified effect.",
  "W:Sonic": "This spell imposes weakness to Sonic damage on the target. Pair with spells or allies that deal Sonic damage for amplified effect.",
  "W:Spirit": "This spell imposes weakness to Spirit damage on the target. Pair with spells or allies that deal Spirit damage for amplified effect.",
  "W:Vitality": "This spell imposes weakness to Vitality damage on the target. Pair with spells or allies that deal Vitality damage for amplified effect.",
  "W:Void": "This spell imposes weakness to Void damage on the target. Pair with spells or allies that deal Void damage for amplified effect.",
  "W:Bludg": "This spell imposes weakness to Bludgeoning damage on the target. Pair with spells or allies that deal Bludgeoning damage for amplified effect.",
  "W:Pierc": "This spell imposes weakness to Piercing damage on the target. Pair with spells or allies that deal Piercing damage for amplified effect.",
  "W:Slash": "This spell imposes weakness to Slashing damage on the target. Pair with spells or allies that deal Slashing damage for amplified effect.",

  // ── Role pills (shown when hovering role pills in option tables) ──
  "Damage": "This spell is categorized as a damage dealer — its primary purpose is dealing hit point damage to enemies.",
  "Debuff": "This spell is categorized as a debuffer — its primary purpose is imposing negative conditions or penalties on enemies.",
  "Buff": "This spell is categorized as a buff — its primary purpose is enhancing allies’ capabilities.",
  "Control": "This spell is categorized as control — its primary purpose is restricting enemy movement or actions through terrain, walls, or zones; or placing another actor on the battlefield (summon spells — the summoned creature blocks, tanks, flanks, and reshapes positioning).",
  "Utility": "This spell is categorized as utility — its primary purpose is solving non-combat problems or providing out-of-combat benefits.",
  "Silver Bullets": "This spell is categorized as a silver bullet — it dominates a narrow situation regardless of spell rank.",

  // ── Legacy curated.js entries not in coverage tracker ──
  "Spike": "Immediate burst damage (not sustained over turns).",
  "Sustain": "Sustained damage over multiple turns via the Sustain action.",
  "Persistent": "Persistent damage — ticks each turn until the target passes a DC 15 flat check or receives healing."
};
