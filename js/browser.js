// Spell browser — role-based browsing + search + filter pipeline (Cycle 16)
(function() {
  'use strict';

  var currentRole = {};
  var renderedSpells = {};
  var searchIndexLoaded = false;
  var searchIndexLoading = false;
  var searchDebounceTimer = null;
  var activeTab = {}; // per tradition: 'role' or 'search'

  // 10 roles per Decision 011, in spec order
  var roleOrder = ['damage', 'debuff', 'buff', 'control', 'utility', 'healing', 'reactions', 'oneAction', 'prebuffs', 'silverBullets'];

  // Cycle 21b: silver bullet purpose notes — keyed by aonId. Verbatim from
  // Spell Planner Feature Description.md (Heidi-approved 2026-05-06).
  var SILVER_BULLET_NOTES = {
    1436: 'Anti-grab. Forcibly moves enemy 5ft, ends grab. Emergency rescue for grabbed allies.',
    1506: 'Anti-flying. Specialized tool for flying enemies.',
    1653: 'Anti-invisible. Directly counters invisibility-reliant threats.',
    1583: 'Anti-reaction. Shuts down dangerous counterattacks from reaction-heavy enemies.',
    1348: 'Anti-regeneration. Prepared caster exploit for Hydras and regenerating enemies.',
    1574: 'Anti-undead. Game-changing in undead encounters, one-action cast.',
    2344: 'Anti-spellcaster. Inflicts Stupefied, undermines enemy casting.',
    1350: 'Anti-grab (multimodal). Fire ants mode forces movement to break grabs at higher rank.',
    1458: 'Anti-emotion effects. Counters rage, fear, and hostile emotion-based abilities.',
    1517: 'Anti-environment. Protects from extreme temperatures, toxic atmospheres.',
    2345: 'Anti-enemy-debuffs. Sustained protection buff for encounters needing sustained defense.',
    1651: 'Anti-elemental damage. Prepare when expecting dragons, elementals, energy-heavy encounters.',
    1663: 'Anti-invisible/ethereal. Longer-duration alternative to Revealing Light.',
    128:  'Anti-immobilize/grab/restrain. Blanket immunity to movement-restriction effects.',
    250:  'Anti-curse. Only reliable way to remove curses.',
    1467: 'Anti-disease. Critical when facing disease-inflicting undead, oozes, or environmental threats.',
    1534: 'Anti-ground-only. Solves vertical encounters, aerial enemies, terrain hazards.',
    1438: 'Anti-underwater/gas. Essential for underwater encounters or inhaled poisons/gases.',
    958:  'Anti-everything (at apex rank). Shuts down enemy abilities completely.',
    709:  'Anti-fire creatures/elementals.',
    711:  'Anti-metal creatures/equipment.',
    1727: 'Anti-invisibility/illusions.',
    2027: 'Anti-caster (spell reflection).',
    1981: 'Single-target removal.'
  };

  var roleLabels = {
    damage: 'Damage',
    debuff: 'Debuff',
    buff: 'Buff',
    control: 'Control',
    utility: 'Utility',
    healing: 'Healing',
    reactions: 'Reactions',
    oneAction: '1-Action',
    prebuffs: 'Pre-Buffs',
    silverBullets: 'Silver Bullets'
  };

  // ── Global filter state (session-scoped, no localStorage) ──
  window.SpellFilters = {
    rarity: { Common: true, Uncommon: true, Rare: false, Unique: false },
    showLegacy: true,
    coverageMode: false,
    coverageInclude: [],
    coverageExclude: [],
    sortColumn: null,
    sortDirection: null,
    searchQuery: '',
    searchFiltersDisabled: false,
    // Cycle 38 — role filters (gated by coverageMode)
    roleInclude: [],    // AND — spell must have ALL of these roles
    roleExclude: [],    // AND-NOT — spell must have NONE of these roles
    // Cycle 22 — trait filters (always active, not gated by coverageMode)
    traitInclude: [],   // ["Fire", ...] — spell must have ALL
    traitExclude: [],   // ["Mental", ...] — spell must have NONE
    // Cycle 22 — column filters (suspended in Search tab)
    columnNameFilter: '',
    columnRankFilter: null,    // null = all, or array of allowed ranks
    columnActionFilter: null,  // null = all, or array of allowed action labels
    columnStarredOnly: false,
    // Cycle 24 — heightening display filters
    hideParked: false,
    indicatorFilter: null      // null = all, or array of allowed types: ['green','orange','grey']
  };

  // Defaults snapshot for "is filter active?" comparisons (Feature 3)
  var RARITY_DEFAULT = { Common: true, Uncommon: true, Rare: false, Unique: false };

  // ── Advice Text Matrix (Decision 022 — verbatim) ──

  var baseAdvice = {
    damage: {
      top: 'Your main combat damage. Native-rank blasts compete best here.  For AoE, native spells outclass heightened lower-rank alternatives. For single-target, heightened spells can work if they scale well. Prioritize spells with rider effects (persistent damage, conditions on failure) to extract more value from these expensive slots and reliability features (auto or success effects) to help them land.',
      mid: 'Sustain spells shine here. Cast one, then sustain for 1 action on later turns while using cantrips or focus spells. Coverage spells that handle both AoE and single-target situations are ideal for prepared casters. Multimodal spells (summons, elemental families) maximize slot value.',
      low: 'Two-action damage spells are poor choices for low-tier slots. You\'ll almost never cast them over your top-rank options. Fill these with reaction damage (Brine Dragon\'s Bile) or 1-action damage (Force Barrage). Also consider non-damage 1-Action and Reaction spells, Silver Bullets, and Pre-Buffs tabs for better uses of cheap slots.'
    },
    debuff: {
      top: 'Always native rank. Higher-rank debuffs get stronger effects by design. Vision of Death beats heightened Fear, Slow beats heightened Agitate. For single-target boss spells, prioritize options with meaningful success effects (bosses succeed their save ~50% of the time). Avoid Incapacitation trait on single-target spells aimed at bosses.',
      mid: 'Some native-rank debuffs unlock at mid-tier ranks and are worth casting at their natural level. Debuff-damage hybrids (spells that deal damage AND impose conditions) are efficient picks here when one slot serves two purposes.',
      low: 'Don\'t park low-rank versions of your top-tier debuffs here. You\'ll never cast them over the higher-rank versions. Reactions that fish for debuffs (Lose the Path) are ideal: low action cost means low risk when they miss. Spells with auto-effect debuffs (no save) provide guaranteed value from cheap slots.'
    },
    buff: {
      top: 'Heighten your key buffs to max rank. As you level, check whether a native-rank buff replaces a heightened older one (Heroism replaces Bless at rank 5 — keep heightening Heroism after that).',
      mid: 'Secondary buffs and backup options. Buffs with good heightening formulas live here. Dual-use spells (Greater Invisibility protects an ally AND enables off-guard for rogues) are efficient mid-tier picks.',
      low: 'Long-duration pre-buffs go here: False Vitality, Element Sense, Tailwind. Cast before combat for free in-combat value without spending combat actions. Check the Pre-Buffs tab for a dedicated view of these options.'
    },
    control: {
      top: 'Almost always native rank. Walls and major zoning at their native rank are better than any heightened alternative. Zoning spells that force enemies to choose between staying in damage or spending actions to leave are your most powerful turn-1 plays. Coordinate with your party; don\'t cut off allies.',
      mid: 'Terrain and zoning that doesn\'t need to scale. Entangling Flora creates automatic difficult terrain regardless of save result for guaranteed value. Containment for action denial. These spells earn their slot through riders and terrain effects, not damage numbers.',
      low: 'Control from low-rank slots provides unconditional reliability.  Many effects are automatic (difficult terrain, walls, zones). Illusory Object is a classic multimodal option: wall off sections, divide enemies, force disbelief checks, all from a rank 1 slot.'
    },
    utility: {
      top: 'High-rank utility does things no skill can replicate.  Teleport, Scouting Eye, Fly. Permission scales with rank. Selection is inherently campaign-dependent: pick spells that solve problems your party actually faces.',
      mid: 'Multimodal utility picks that address many situations from one slot. Shared Invisibility, Airlift, Clairvoyance, Translocate: each covers multiple scenarios a prepared caster might encounter.',
      low: 'Out-of-combat problem-solving is the primary use of low-rank slots: Water Breathing, Water Walking, Gecko Grip, Ant Haul. These become essentially free at high levels. Match picks to your campaign; wilderness spells are wasted in dungeons and vice versa.'
    },
    healing: {
      top: 'Heighten Heal or Soothe to max rank if you\'re the primary healer. If healing is your backup role, put heals at your 2nd or 3rd highest rank and save top slots for buffs or debuffs where rank "permission" matters more.',
      mid: 'If you\'re a backup healer, this is where your heals live: high enough rank to be meaningful, saving top slots for your primary role.',
      low: 'Low-rank heals can\'t keep pace with incoming damage at high levels. False Vitality as a pre-buff provides temp HP without spending combat actions. Emergency healing from low slots is better handled by scrolls, potions, or Battle Medicine than prepared spells.'
    },
    reactions: {
      top: 'Rarely needed in top slots.  Reaction value comes from low action cost, not high spell rank.',
      mid: 'Some defensive reactions (Hidebound, Wooden Double) can be heightened to mid-tier for better damage mitigation. Worth it if you face frequent physical attacks.',
      low: 'Ideal home. Reactions act on enemy turns without spending your combat actions. The best use of cheap slots. Offensive reactions add damage on others\' turns. Defensive reactions let you skip repositioning and keep casting with all three actions.'
    },
    oneAction: {
      top: 'Rarely occupies top slots.',
      mid: 'Occasionally useful. Heal in 1-action mode at mid rank for efficient spot healing. Some focus spells fill this role without costing a slot.',
      low: 'Ideal. Your third action defines the difference between an okay caster and a good one. Pair a 1-action spell with your 2-action main spell for the "perfect turn." Also consider non-spell options for your third action: Recall Knowledge, Demoralize, Bon Mot, or even a bow shot may serve better than spending a slot.'
    },
    prebuffs: {
      top: 'Almost never worth a top slot. Pre-buffs get their value from duration, not rank.',
      mid: 'Rarely valuable. Some pre-buffs with meaningful heightening (Mystic Armor in the mid-range) can justify a mid slot.',
      low: 'Ideal home. Long-duration spells cast before combat convert cheap slots into free in-combat advantages. Cast during exploration to enter combat already buffed.'
    },
    silverBullets: {
      top: 'Rarely a top tier pick. Silver bullets earn their value by working from any rank. If one IS in a top slot, it solves a high-stakes problem nothing else can (Disintegrate vs. Wall of Force).',
      mid: 'Occasionally good. Some silver bullets that heighten meaningfully (Acid Grip for better damage alongside its forced movement) can justify a mid slot.',
      low: 'Perfect home. The effect matters more than DC or rank. Spells that have their main effect from their native rank or a specific higher rank. Prepared casters excel here: swap in the right silver bullet on the day you know you need it.'
    }
  };

  var traditionOverlays = {
    arcane: {
      damage: {
        top: 'You can target all four defenses. Leverage that flexibility for wide coverage. Check that your top-tier damage picks spread across at least 3 defenses. Force Barrage (auto-hit, no save) is usually worth a slot.',
        low: 'Best tradition for low-slot damage options. Sure Strike, Force Barrage (1-action mode), Brine Dragon\'s Bile, and defensive reactions all compete for these slots.'
      },
      debuff: {
        top: 'Widest debuff coverage. You can target all saves with native-rank options at every level. Will-targeting blasts (Agonizing Despair, Vision of Death) that deal damage AND debuff are uniquely available to you.'
      },
      buff: {
        top: 'Nothing like Bless or Heroism that provides universal bonuses. Your buffs are Haste, Fly, Blur, Invisibility, True Target.  Speed, stealth, and accuracy rather than raw stat bonuses.'
      },
      control: {
        top: 'Deepest control toolkit at all ranks. Walls, terrain, zoning... You have options at every spell rank.'
      },
      reactions: {
        low: 'Full reaction menu.  Everything Primal has plus Occult options like Sure Strike and Drop Dead.'
      },
      silverBullets: {}
    },
    divine: {
      damage: {
        top: 'Limited blast options without class features. If you\'re a Flames Oracle, you have multiple resource pools for blasting. Otherwise, lean into Fort and Will targeting. Your damage types (void, vitality, spirit) are among the hardest to resist.'
      },
      debuff: {
        top: 'Fort and Will targeting available. Reflex debuff options are limited. Accept that gap and focus your picks on the saves you cover well.'
      },
      buff: {
        top: 'Bless → Heroism at rank 5. Best buff+heal combination.  Heighten both Heroism and Heal to max rank for maximum party impact.'
      },
      control: {
        top: 'Limited control until higher ranks. Your first real area denial options arrive at rank 5+. Consider whether Buff or Healing tabs serve your party better from top slots, especially at lower levels.'
      },
      healing: {
        top: 'Best healing tradition (tied with Primal). Heal, Restoration, Remove Disease, Breath of Life, Regenerate: the full toolkit.'
      },
      reactions: {
        low: 'Limited reaction options.  Blood Spray Curse is your main pick. Consider filling low slots with pre-buffs or silver bullets instead.'
      },
      silverBullets: {
        low: 'Fewest silver bullet options of any tradition. Consider filling remaining low slots with pre-buffs or low-rank heals instead.'
      }
    },
    occult: {
      damage: {
        top: 'Limited blast options natively. Psychic class features (Unleash Psyche) compensate. If your party needs a force multiplier more than a damage dealer, consider whether Buff or Debuff tabs serve you better from these slots.'
      },
      debuff: {
        top: 'Deepest Will-targeting debuff list in the game. Synesthesia, Phantom Pain, Hideous Laughter, Paralyze, Confusion. Lean into this strength.'
      },
      buff: {
        top: 'Best buffing tradition. Heighten Soothe, Heroism, Haste.  This is your superpower. Your buff+debuff combination is what makes Occult a party force multiplier.'
      },
      control: {
        top: 'Control options open up at higher ranks: Slither (R5), Chromatic Wall (R5), Wall of Force (R6). Lower ranks are limited.'
      },
      healing: {
        top: 'Strong options like Soothe, Restoration, Vampiric Touch/Feast. Soothe heightens well.'
      },
      reactions: {
        low: 'Drop Dead, Unexpected Transposition, Sure Strike. Smaller menu than Arcane/Primal but solid options.'
      },
      silverBullets: {}
    },
    primal: {
      damage: {
        top: 'Strong Fort and Reflex coverage, but Will targeting is your blind spot. Use attack roll spells (AC targeting) to diversify beyond saves. Dehydrate stays competitive via heightening for Fort-targeting coverage.'
      },
      debuff: {
        top: 'Fort debuffs are strong. Will targeting is your weakest area.  Only Fear and Lose the Path. Compensate with attack roll spells for AC targeting with debuff riders.'
      },
      buff: {
        top: 'No Bless or Heroism. Buff via Haste, Fly, Barkskin, Stoneskin, Moon Frenzy.  Speed, defense, and transformation.'
      },
      control: {
        top: 'Tied with Arcane for best control tradition. Walls, terrain, and zoning are core strengths alongside your damage.'
      },
      healing: {
        top: 'Best healing tradition (tied with Divine). Heal, Regenerate, Moment of Renewal. You\'re the only tradition that can blast AND heal from the same list.  Use that self-sufficiency.'
      },
      reactions: {
        low: 'Best reaction variety. Interposing Earth (defense), Hidebound (party-wide mitigation), Wooden Double (self-protection), Brine Dragon\'s Bile (offensive), Lose the Path (movement denial), Zephyr Slip (repositioning).'
      },
      silverBullets: {}
    }
  };

  var gapMessages = {
    arcane: {
      healing: 'No healing spells exist on the Arcane list. Items (scrolls, wands, staves) and party composition handle the gap.'
    }
  };

  var LOW_SLOT_ROLES = { silverBullets: 1, reactions: 1, oneAction: 1, prebuffs: 1 };

  function getAdvice(role, tier, tradition) {
    if (gapMessages[tradition] && gapMessages[tradition][role]) {
      return { base: gapMessages[tradition][role], overlay: null, isGap: true };
    }

    if (tier === 'mid' && LOW_SLOT_ROLES[role]) tier = 'low';

    var base = baseAdvice[role] && baseAdvice[role][tier] || '';
    var overlay = null;
    if (traditionOverlays[tradition] && traditionOverlays[tradition][role] && traditionOverlays[tradition][role][tier]) {
      overlay = traditionOverlays[tradition][role][tier];
    }

    return { base: base, overlay: overlay, isGap: false };
  }

  // ── Get spells from SPELL_SCHEMA ──
  function getSpellSchemaSpells() {
    if (!window.SPELL_SCHEMA || !window.SPELL_SCHEMA.spells) return [];
    return window.SPELL_SCHEMA.spells;
  }

  // ── Rarity/legacy filter check ──
  function passesRarityLegacy(spell) {
    var r = spell.rarity || 'common';
    var rCap = r.charAt(0).toUpperCase() + r.slice(1).toLowerCase();
    if (!window.SpellFilters.rarity[rCap]) return false;
    if (spell.era === 'legacy_core' && !window.SpellFilters.showLegacy) return false;
    return true;
  }

  // ── Role filter check (Cycle 38 — gated by coverageMode) ──
  function passesRoleFilters(spell) {
    if (!SpellFilters.coverageMode) return true;
    var roles = spell.roles || [];
    for (var i = 0; i < SpellFilters.roleInclude.length; i++) {
      if (roles.indexOf(SpellFilters.roleInclude[i]) === -1) return false;
    }
    for (var i = 0; i < SpellFilters.roleExclude.length; i++) {
      if (roles.indexOf(SpellFilters.roleExclude[i]) !== -1) return false;
    }
    return true;
  }

  // ── Coverage filter check ──
  function passesCoverageFilters(spell) {
    var f = window.SpellFilters;
    if (!f.coverageMode) return true;
    if (f.coverageInclude.length === 0 && f.coverageExclude.length === 0) return true;

    for (var i = 0; i < f.coverageInclude.length; i++) {
      var entry = f.coverageInclude[i];
      var fieldValues = spell[entry.field];
      if (!fieldValues || fieldValues.indexOf(entry.tag) === -1) return false;
    }
    for (var i = 0; i < f.coverageExclude.length; i++) {
      var entry = f.coverageExclude[i];
      var fieldValues = spell[entry.field];
      if (fieldValues && fieldValues.indexOf(entry.tag) !== -1) return false;
    }
    return true;
  }

  // ── Trait filter check (Cycle 22 — always active) ──
  function passesTraitFilters(spell) {
    var f = window.SpellFilters;
    if (f.traitInclude.length === 0 && f.traitExclude.length === 0) return true;
    var traits = spell.trait_raw || [];
    for (var i = 0; i < f.traitInclude.length; i++) {
      if (traits.indexOf(f.traitInclude[i]) === -1) return false;
    }
    for (var i = 0; i < f.traitExclude.length; i++) {
      if (traits.indexOf(f.traitExclude[i]) !== -1) return false;
    }
    return true;
  }

  // ── Action label derivation (Cycle 22 — column filter) ──
  // Returns the set of label values a spell matches: ['1-action','2-action',...]
  function getSpellActionLabels(spell) {
    var tags = spell.action_tags || [];
    var labels = [];
    if (tags.length === 0) {
      labels.push('2-action');
    } else {
      if (tags.indexOf('1-action') !== -1) labels.push('1-action');
      if (tags.indexOf('3-action') !== -1) labels.push('3-action');
      if (tags.indexOf('Reaction') !== -1) labels.push('Reaction');
      if (tags.indexOf('Free') !== -1) labels.push('Free');
      // No standard cost tag means 2-action default (alongside any modifiers)
      if (tags.indexOf('1-action') === -1 && tags.indexOf('3-action') === -1 &&
          tags.indexOf('Reaction') === -1 && tags.indexOf('Free') === -1) {
        labels.push('2-action');
      }
    }
    if (tags.indexOf('Sustain-action') !== -1) labels.push('Sustained');
    return labels;
  }

  // ── Column filter check (Cycle 22 — skipped in Search tab) ──
  function passesColumnFilters(spell, tradition) {
    var tab = activeTab[tradition] || 'role';
    if (tab === 'search') return true; // pass-through in search

    var f = window.SpellFilters;

    // Name substring (case-insensitive)
    if (f.columnNameFilter && f.columnNameFilter.length > 0) {
      var needle = f.columnNameFilter.toLowerCase();
      if (spell.name.toLowerCase().indexOf(needle) === -1) return false;
    }
    // Rank
    if (f.columnRankFilter && f.columnRankFilter.length > 0) {
      if (f.columnRankFilter.indexOf(spell.native_rank) === -1) return false;
    }
    // Action
    if (f.columnActionFilter && f.columnActionFilter.length > 0) {
      var labels = getSpellActionLabels(spell);
      var any = false;
      for (var i = 0; i < labels.length; i++) {
        if (f.columnActionFilter.indexOf(labels[i]) !== -1) { any = true; break; }
      }
      if (!any) return false;
    }
    // Starred
    if (f.columnStarredOnly && !spell.mathfinder_reviewed) return false;

    return true;
  }

  // ── Filter spells by tradition + role + rank + rarity/legacy + coverage + traits + columns ──
  // Returns { results, baseCount } — baseCount = passes tradition+role+rank only (for no-results UX)
  function filterSpells(tradition, role, slotRank, opts) {
    opts = opts || {};
    var allSpells = getSpellSchemaSpells();
    var tradCap = tradition.charAt(0).toUpperCase() + tradition.slice(1);
    var results = [];
    var baseCount = 0;

    for (var i = 0; i < allSpells.length; i++) {
      var s = allSpells[i];
      if (s.tradition.indexOf(tradCap) === -1) continue;
      if (s.roles.indexOf(role) === -1) continue;
      if (s.native_rank > slotRank) continue;
      baseCount++;
      if (!passesRarityLegacy(s)) continue;
      if (!passesRoleFilters(s)) continue;
      if (!passesCoverageFilters(s)) continue;
      if (!passesTraitFilters(s)) continue;
      if (!passesColumnFilters(s, tradition)) continue;
      results.push(s);
    }

    var sorted = applySortOrder(results, slotRank);
    if (opts.withMeta) return { results: sorted, baseCount: baseCount };
    return sorted;
  }

  // ── Sort logic ──
  function getActionSortValue(spell) {
    var tags = spell.action_tags || [];
    var lowest = 99;
    for (var i = 0; i < tags.length; i++) {
      var m = tags[i].match(/^(\d)-action$/);
      if (m) {
        var val = parseInt(m[1], 10);
        if (val < lowest) lowest = val;
      }
      if (tags[i] === 'Free' && 0 < lowest) lowest = 0;
    }
    if (lowest === 99) {
      for (var i = 0; i < tags.length; i++) {
        if (tags[i] === 'Reaction') { lowest = 4; break; }
      }
    }
    return lowest;
  }

  function isParked(spell, slotRank) {
    if (spell.native_rank === slotRank) return false;
    return (spell.heighten_ranks || []).indexOf(slotRank) === -1;
  }

  function isReplacedAt(spell, slotRank) {
    var rb = spell.replaced_by || [];
    for (var i = 0; i < rb.length; i++) {
      if (rb[i].at_rank <= slotRank) return true;
    }
    return false;
  }

  function getSortGroup(spell, slotRank) {
    if (spell.native_rank === slotRank && spell.mathfinder_reviewed) return 1;
    if (spell.mathfinder_reviewed
        && (spell.heighten_quality === 'scales-well' || spell.heighten_quality === 'fixed-meaningful')
        && !isParked(spell, slotRank)
        && !isReplacedAt(spell, slotRank)) return 2;
    return 3;
  }

  function applySortOrder(results, slotRank) {
    var f = window.SpellFilters;
    if (!f.sortColumn || !f.sortDirection) {
      results.sort(function(a, b) {
        var ga = getSortGroup(a, slotRank);
        var gb = getSortGroup(b, slotRank);
        if (ga !== gb) return ga - gb;

        if (ga === 1) {
          return a.name.localeCompare(b.name);
        }

        if (ga === 2) {
          if (b.native_rank !== a.native_rank) return b.native_rank - a.native_rank;
          return a.name.localeCompare(b.name);
        }

        // Group 3: native-first, then starred-first within non-native, then rank DESC, then name ASC
        var aNative = a.native_rank === slotRank ? 0 : 1;
        var bNative = b.native_rank === slotRank ? 0 : 1;
        if (aNative !== bNative) return aNative - bNative;
        if (aNative === 1) {
          var aStarred = a.mathfinder_reviewed ? 0 : 1;
          var bStarred = b.mathfinder_reviewed ? 0 : 1;
          if (aStarred !== bStarred) return aStarred - bStarred;
        }
        if (b.native_rank !== a.native_rank) return b.native_rank - a.native_rank;
        return a.name.localeCompare(b.name);
      });
      return results;
    }

    var col = f.sortColumn;
    var dir = f.sortDirection === 'asc' ? 1 : -1;

    results.sort(function(a, b) {
      var cmp = 0;
      if (col === 'name') {
        cmp = a.name.localeCompare(b.name);
      } else if (col === 'rank') {
        cmp = a.native_rank - b.native_rank;
      } else if (col === 'action') {
        cmp = getActionSortValue(a) - getActionSortValue(b);
      }
      if (cmp !== 0) return cmp * dir;
      return a.name.localeCompare(b.name);
    });

    return results;
  }

  // ── Sort header cycling ──
  function cycleSortColumn(col) {
    var f = window.SpellFilters;
    if (f.sortColumn === col) {
      if (f.sortDirection === 'asc') {
        f.sortDirection = 'desc';
      } else if (f.sortDirection === 'desc') {
        f.sortColumn = null;
        f.sortDirection = null;
      }
    } else {
      f.sortColumn = col;
      f.sortDirection = 'asc';
    }
  }

  function sortIndicator(col) {
    var f = window.SpellFilters;
    if (f.sortColumn !== col) return ' <span class="sort-indicator dim">⇕</span>';
    if (f.sortDirection === 'asc') return ' <span class="sort-indicator">▲</span>';
    return ' <span class="sort-indicator">▼</span>';
  }

  // ── Search ──
  var STOP_WORDS = {to:1,the:1,a:1,an:1,of:1,'in':1,on:1,'for':1,and:1,or:1,is:1,it:1,as:1,at:1,by:1,be:1,no:1,not:1};

  function searchSpells(query) {
    if (!window.SPELL_SEARCH_INDEX) return [];
    var q = (query || '').toLowerCase().trim();
    if (q.length < 2) return null; // signal: too short

    var rawTerms = q.split(/\s+/);
    var terms = [];
    for (var i = 0; i < rawTerms.length; i++) {
      var t = rawTerms[i];
      if (t.length < 3) continue;
      if (STOP_WORDS[t]) continue;
      terms.push(t);
    }
    if (terms.length === 0) return []; // signal: no valid terms

    var index = window.SPELL_SEARCH_INDEX;
    var scored = [];

    for (var i = 0; i < index.length; i++) {
      var entry = index[i];
      var score = 0;
      var nameLower = entry.name.toLowerCase();
      var allInText = true;

      for (var t = 0; t < terms.length; t++) {
        var term = terms[t];
        if (nameLower.indexOf(term) !== -1) score += 100;
        if (entry.text.indexOf(term) !== -1) {
          score += 10;
        } else {
          allInText = false;
        }
        for (var tr = 0; tr < entry.traits.length; tr++) {
          if (entry.traits[tr].indexOf(term) !== -1) score += 15;
        }
      }

      if (terms.length > 0 && nameLower.indexOf(terms[0]) === 0) score += 80;
      if (allInText && terms.length > 1) score += 30;

      if (score > 0) {
        scored.push({ entry: entry, score: score });
      }
    }

    scored.sort(function(a, b) {
      if (b.score !== a.score) return b.score - a.score;
      return a.entry.name.localeCompare(b.entry.name);
    });

    if (scored.length > 100) scored.length = 100;
    return scored;
  }

  function lookupSpellByAonId(aonId) {
    var spells = getSpellSchemaSpells();
    for (var i = 0; i < spells.length; i++) {
      if (spells[i].aonId === aonId) return spells[i];
    }
    return null;
  }

  function loadSearchIndex(callback) {
    if (searchIndexLoaded) { callback(); return; }
    if (searchIndexLoading) return;
    searchIndexLoading = true;

    var script = document.createElement('script');
    script.src = 'data/search-index.js?v=3';

    var timer = setTimeout(function() {
      if (!window.SPELL_SEARCH_INDEX) {
        searchIndexLoading = false;
        callback('timeout');
      }
    }, 5000);

    script.onload = function() {
      clearTimeout(timer);
      if (window.SPELL_SEARCH_INDEX) {
        searchIndexLoaded = true;
        searchIndexLoading = false;
        callback();
      } else {
        searchIndexLoading = false;
        callback('empty');
      }
    };
    script.onerror = function() {
      clearTimeout(timer);
      searchIndexLoading = false;
      callback('error');
    };
    document.head.appendChild(script);
  }

  function formatActions(actionTags) { return App.formatActions(actionTags); }
  function renderTags(spell) { return App.renderTags(spell); }

  // ── Cycle 24 — Heightening display helpers ──

  function formatHeightenRanks(ranks, nativeRank) {
    var filtered = [];
    for (var i = 0; i < ranks.length; i++) {
      if (ranks[i] !== nativeRank) filtered.push(ranks[i]);
    }
    if (filtered.length === 0) return '';
    filtered.sort(function(a, b) { return a - b; });
    // Collapse consecutive sequences into ranges
    var parts = [];
    var start = filtered[0], end = filtered[0];
    for (var i = 1; i < filtered.length; i++) {
      if (filtered[i] === end + 1) {
        end = filtered[i];
      } else {
        parts.push(start === end ? '' + start : start + '–' + end);
        start = end = filtered[i];
      }
    }
    parts.push(start === end ? '' + start : start + '–' + end);
    return parts.join(', ');
  }

  function evaluateChartA(spell, slotRank) {
    var ranks = spell.heighten_ranks || [];
    var native = spell.native_rank;
    var content = formatHeightenRanks(ranks, native);
    if (!content) content = '—';
    var isParked = (slotRank !== native) && (ranks.indexOf(slotRank) === -1);
    return { content: content, parked: isParked };
  }

  function evaluateChartB(spell) {
    var q = spell.heighten_quality;
    if (q === 'scales-well') return { indicator: 'green', tooltip: 'Scales well — gains power at every heightened rank' };
    if (q === 'fixed-meaningful') return { indicator: 'green', tooltip: 'Has meaningful breakpoints — see Heightens At column for specific ranks' };
    if (q === 'no-heighten') return { indicator: 'grey', tooltip: "This spell doesn’t heighten — consider whether this slot is the best use" };
    return { indicator: null, tooltip: null };
  }

  function evaluateChartC(spell, slotRank) {
    var orangeNotes = [];
    var greenNotes = [];
    if (spell.replaced_by) {
      for (var i = 0; i < spell.replaced_by.length; i++) {
        var entry = spell.replaced_by[i];
        if (entry.at_rank != null && entry.at_rank <= slotRank) {
          orangeNotes.push(entry.advisory_text || '');
        }
      }
    }
    if (spell.replaces) {
      for (var i = 0; i < spell.replaces.length; i++) {
        var entry = spell.replaces[i];
        if (entry.at_rank != null && entry.at_rank <= slotRank) {
          greenNotes.push(entry.advisory_text || '');
        }
      }
    }
    return { orangeNotes: orangeNotes, greenNotes: greenNotes };
  }

  // ── Render helpers ──

  function renderSpellRow(spell, idx, opts) {
    opts = opts || {};
    var slotRank = opts.slotRank || null;
    var isLegacy = spell.era === 'legacy_core';
    var chartA = slotRank ? evaluateChartA(spell, slotRank) : null;
    var rowCls = isLegacy ? ' legacy-row' : '';
    if (spell.mathfinder_reviewed) rowCls += ' mathfinder-row';
    var html = '<tr data-spell-idx="' + idx + '" style="cursor:pointer;" class="' + rowCls + '">';

    // Spell name with star/spacer
    html += '<td>';
    if (spell.mathfinder_reviewed) {
      html += '<span class="mathfinder-star" title="Mathfinder reviewed — click for details">★</span>';
    } else {
      html += '<span class="mathfinder-spacer"></span>';
    }
    html += '<span class="spell-name-link">' + spell.name + '</span>';
    if (isLegacy) html += '<span class="legacy-badge">Legacy</span>';
    if (spell.aonId) {
      html += '<a href="' + App.aonUrl(spell.aonId) + '" target="_blank" class="aon-link" title="Open on Archives of Nethys">↗</a>';
    }
    if (opts.warnings) {
      for (var w = 0; w < opts.warnings.length; w++) {
        html += '<span class="search-warning-badge">' + opts.warnings[w] + '</span>';
      }
    }
    html += '</td>';

    // Native Rank
    html += '<td>' + spell.native_rank + '</td>';

    // Heightens At + quality indicator (only in role view with slot context)
    if (slotRank) {
      var haCls = (chartA && chartA.parked) ? ' class="heighten-cell parked"' : ' class="heighten-cell"';
      var haContent = chartA ? chartA.content : '—';
      var chartB = evaluateChartB(spell);
      var indicatorHtml = '';
      if (chartB.indicator === 'green') {
        indicatorHtml = ' <span class="indicator-icon indicator-green" title="' + chartB.tooltip + '">▲</span>';
      } else if (chartB.indicator === 'grey') {
        indicatorHtml = ' <span class="indicator-icon indicator-grey" title="' + chartB.tooltip + '">△</span>';
      }
      html += '<td' + haCls + '>' + haContent + indicatorHtml + '</td>';
    }

    // Action
    html += '<td>' + formatActions(spell.action_tags) + '</td>';

    // Tags
    html += '<td>' + renderTags(spell) + '</td>';

    // Notes — video link + silver bullet + Chart C advisory text
    html += '<td class="spell-notes">';
    var directSrc = null;
    if (spell.mathfinder_sources) {
      for (var s = 0; s < spell.mathfinder_sources.length; s++) {
        if (spell.mathfinder_sources[s].source_type === 'direct') {
          directSrc = spell.mathfinder_sources[s];
          break;
        }
      }
    }
    if (directSrc) {
      html += '<a href="' + directSrc.url + '" target="_blank" rel="noopener" class="mathfinder-video-link">▶ ' + directSrc.name + '</a>';
    }
    var sbNote = SILVER_BULLET_NOTES[spell.aonId];
    if (sbNote) {
      html += '<div class="silver-bullet-note">' + sbNote + '</div>';
    }
    // Chart C — replacement chain advisory notes
    if (slotRank) {
      var chartC = evaluateChartC(spell, slotRank);
      for (var n = 0; n < chartC.orangeNotes.length; n++) {
        if (chartC.orangeNotes[n]) {
          html += '<div class="chain-note chain-note-orange" title="A stronger option exists at this rank — see notes">';
          html += '<span class="chain-note-icon">◆</span> ' + chartC.orangeNotes[n];
          html += '</div>';
        }
      }
      for (var n = 0; n < chartC.greenNotes.length; n++) {
        if (chartC.greenNotes[n]) {
          html += '<div class="chain-note chain-note-green" title="This spell upgrades a lower-rank option — see notes">';
          html += '<span class="chain-note-icon">◆</span> ' + chartC.greenNotes[n];
          html += '</div>';
        }
      }
    }
    html += '</td>';

    html += '</tr>';
    return html;
  }

  // Funnel SVG (visually distinct from sort arrows). 12x12, currentColor.
  var FUNNEL_SVG = '<svg class="cf-funnel" viewBox="0 0 16 16" width="11" height="11" aria-hidden="true"><path d="M2 3.5C2 3.22 2.22 3 2.5 3h11c.28 0 .5.22.5.5v.79c0 .27-.11.53-.3.72L10 9.21V13c0 .19-.11.36-.28.45l-2 1A.5.5 0 0 1 7 14V9.21L2.3 5.01A.99.99 0 0 1 2 4.29V3.5z" fill="currentColor"/></svg>';

  function colFilterIcon(col) {
    var f = window.SpellFilters;
    var active = false;
    if (col === 'name') active = !!(f.columnNameFilter && f.columnNameFilter.length > 0);
    else if (col === 'rank') active = !!(f.columnRankFilter && f.columnRankFilter.length > 0);
    else if (col === 'action') active = !!(f.columnActionFilter && f.columnActionFilter.length > 0);
    else if (col === 'starred') active = !!f.columnStarredOnly;
    else if (col === 'heighten') active = !!(f.hideParked || f.indicatorFilter);
    var cls = 'col-filter-icon' + (active ? ' active' : '');
    return ' <button type="button" class="' + cls + '" data-col-filter="' + col + '" title="Filter this column" aria-label="Filter column">' + FUNNEL_SVG + '</button>';
  }

  function buildTableHeader(isSearch) {
    var html = '<table class="spell-table"><thead><tr>';
    if (isSearch) {
      html += '<th>Spell</th><th>Native Rank</th><th>Action</th><th>Tags</th><th>Notes</th>';
    } else {
      var starActive = window.SpellFilters.columnStarredOnly ? ' active' : '';
      html += '<th class="sortable-header" data-sort-col="name"><span class="col-label">Spell</span>' + sortIndicator('name') + colFilterIcon('name') + ' <span class="col-filter-icon star-toggle' + starActive + '" data-col-filter="starred" title="Show only starred (Mathfinder-reviewed) spells">&#9733;</span></th>';
      html += '<th class="sortable-header" data-sort-col="rank"><span class="col-label">Native Rank</span>' + sortIndicator('rank') + colFilterIcon('rank') + '</th>';
      html += '<th data-col="heighten"><span class="col-label">Heightens At</span>' + colFilterIcon('heighten') + '</th>';
      html += '<th class="sortable-header" data-sort-col="action"><span class="col-label">Action</span>' + sortIndicator('action') + colFilterIcon('action') + '</th>';
      html += '<th data-col="tags"><span class="col-label">Tags</span> <span class="info-bubble" title="Tag filtering is available in the sidebar. Turn on Filter Mode to use coverage tags as filters, or use Trait Filters below for PF2e spell traits.">ⓘ</span></th>';
      html += '<th data-col="notes"><span class="col-label">Notes</span></th>';
    }
    html += '</tr></thead><tbody>';
    return html;
  }

  // ── Cycle 22 — Column Filter Dropdowns ──

  var openDropdownEl = null;

  function closeColumnDropdown() {
    if (openDropdownEl && openDropdownEl.parentNode) {
      openDropdownEl.parentNode.removeChild(openDropdownEl);
    }
    openDropdownEl = null;
  }

  function getMaxRankForTradition(tradition) {
    // Use current selected slot's rank as upper bound
    var slot = Planner.getSelectedSlot();
    return slot ? slot.rank : 10;
  }

  function getActionOptionsForTradition(tradition) {
    // Standard 5 + conditional Free
    var standard = ['1-action', '2-action', '3-action', 'Reaction', 'Sustained'];
    var hasFree = false;
    if (window.SPELL_SCHEMA && window.SPELL_SCHEMA.spells) {
      var tradCap = tradition.charAt(0).toUpperCase() + tradition.slice(1);
      var spells = window.SPELL_SCHEMA.spells;
      for (var i = 0; i < spells.length; i++) {
        if (spells[i].tradition.indexOf(tradCap) === -1) continue;
        if ((spells[i].action_tags || []).indexOf('Free') !== -1) { hasFree = true; break; }
      }
    }
    if (hasFree) standard.push('Free');
    return standard;
  }

  function openColumnDropdown(tradition, col, anchorEl) {
    closeColumnDropdown();

    var dropdown = document.createElement('div');
    dropdown.className = 'column-filter-dropdown';
    dropdown.dataset.col = col;

    var f = window.SpellFilters;
    var html = '';

    if (col === 'name') {
      html += '<div class="cfd-row"><input type="text" class="cfd-name-input" placeholder="Filter by name..." value="' + (f.columnNameFilter || '').replace(/"/g, '&quot;') + '"></div>';
    } else if (col === 'rank') {
      var maxRank = getMaxRankForTradition(tradition);
      html += '<div class="cfd-info">Spells shown are already limited to your slot\'s maximum rank. This filter further narrows which ranks appear.</div>';
      html += '<div class="cfd-controls"><button type="button" class="cfd-btn" data-action="select-all">Select All</button><button type="button" class="cfd-btn" data-action="clear-all">Clear All</button></div>';
      html += '<div class="cfd-checks">';
      var selected = f.columnRankFilter;
      for (var r = 1; r <= maxRank; r++) {
        var checked = !selected || selected.indexOf(r) !== -1;
        html += '<label class="cfd-check"><input type="checkbox" data-val="' + r + '"' + (checked ? ' checked' : '') + '> ' + r + '</label>';
      }
      html += '</div>';
    } else if (col === 'action') {
      var opts = getActionOptionsForTradition(tradition);
      var labels = { '1-action': '1-action (◆)', '2-action': '2-action (◆◆)', '3-action': '3-action (◆◆◆)', 'Reaction': 'Reaction (◈)', 'Sustained': 'Sustained', 'Free': 'Free' };
      html += '<div class="cfd-controls"><button type="button" class="cfd-btn" data-action="select-all">Select All</button><button type="button" class="cfd-btn" data-action="clear-all">Clear All</button></div>';
      html += '<div class="cfd-checks">';
      var selectedA = f.columnActionFilter;
      for (var i = 0; i < opts.length; i++) {
        var v = opts[i];
        var c = !selectedA || selectedA.indexOf(v) !== -1;
        html += '<label class="cfd-check"><input type="checkbox" data-val="' + v + '"' + (c ? ' checked' : '') + '> ' + labels[v] + '</label>';
      }
      html += '</div>';
    } else if (col === 'heighten') {
      var hOpts = [
        { val: 'green', label: '▲ Scales well / breakpoints' },
        { val: 'orange', label: '◆ Stronger option exists' },
        { val: 'grey', label: '△ No heightening' }
      ];
      var selectedH = f.indicatorFilter;
      html += '<div class="cfd-info">Filter by heightening quality or hide parked spells.</div>';
      html += '<div class="cfd-controls"><button type="button" class="cfd-btn" data-action="select-all">Select All</button><button type="button" class="cfd-btn" data-action="clear-all">Clear All</button></div>';
      html += '<div class="cfd-checks">';
      for (var i = 0; i < hOpts.length; i++) {
        var hChecked = !selectedH || selectedH.indexOf(hOpts[i].val) !== -1;
        html += '<label class="cfd-check"><input type="checkbox" data-val="' + hOpts[i].val + '"' + (hChecked ? ' checked' : '') + '> ' + hOpts[i].label + '</label>';
      }
      html += '</div>';
      html += '<hr class="cfd-divider">';
      html += '<div class="cfd-checks">';
      html += '<label class="cfd-check"><input type="checkbox" data-val="hideParked"' + (f.hideParked ? ' checked' : '') + '> Hide parked spells</label>';
      html += '</div>';
    }

    dropdown.innerHTML = html;
    document.body.appendChild(dropdown);
    openDropdownEl = dropdown;

    // Position
    var rect = anchorEl.getBoundingClientRect();
    var ddRect = dropdown.getBoundingClientRect();
    var left = rect.left;
    if (left + ddRect.width > window.innerWidth - 8) {
      left = rect.right - ddRect.width;
    }
    if (left < 4) left = 4;
    dropdown.style.left = left + 'px';
    dropdown.style.top = (rect.bottom + 4) + 'px';

    // Wire interactions
    if (col === 'name') {
      var input = dropdown.querySelector('.cfd-name-input');
      input.focus();
      input.addEventListener('input', function() {
        f.columnNameFilter = input.value;
        reRenderCurrentView(tradition);
      });
    } else if (col === 'rank' || col === 'action') {
      var checks = dropdown.querySelectorAll('input[type="checkbox"]');
      function readChecks() {
        var allowed = [];
        for (var i = 0; i < checks.length; i++) {
          if (checks[i].checked) {
            var raw = checks[i].dataset.val;
            allowed.push(col === 'rank' ? parseInt(raw, 10) : raw);
          }
        }
        // null when all selected (= no filter)
        var fullCount = checks.length;
        if (allowed.length === fullCount) {
          if (col === 'rank') f.columnRankFilter = null;
          else f.columnActionFilter = null;
        } else {
          if (col === 'rank') f.columnRankFilter = allowed;
          else f.columnActionFilter = allowed;
        }
        reRenderCurrentView(tradition);
      }
      for (var i = 0; i < checks.length; i++) {
        checks[i].addEventListener('change', readChecks);
      }
      var btns = dropdown.querySelectorAll('.cfd-btn');
      for (var b = 0; b < btns.length; b++) {
        btns[b].addEventListener('click', function() {
          var action = this.dataset.action;
          for (var i = 0; i < checks.length; i++) {
            checks[i].checked = (action === 'select-all');
          }
          readChecks();
        });
      }
    } else if (col === 'heighten') {
      var hChecks = dropdown.querySelectorAll('input[type="checkbox"]:not([data-val="hideParked"])');
      function readHChecks() {
        var allowed = [];
        for (var i = 0; i < hChecks.length; i++) {
          if (hChecks[i].checked) allowed.push(hChecks[i].dataset.val);
        }
        f.indicatorFilter = (allowed.length === hChecks.length) ? null : allowed;
        reRenderCurrentView(tradition);
      }
      for (var i = 0; i < hChecks.length; i++) {
        hChecks[i].addEventListener('change', readHChecks);
      }
      var hBtns = dropdown.querySelectorAll('.cfd-btn');
      for (var b = 0; b < hBtns.length; b++) {
        hBtns[b].addEventListener('click', function() {
          var action = this.dataset.action;
          for (var i = 0; i < hChecks.length; i++) {
            hChecks[i].checked = (action === 'select-all');
          }
          readHChecks();
        });
      }
      var parkedCheck = dropdown.querySelector('input[data-val="hideParked"]');
      if (parkedCheck) {
        parkedCheck.addEventListener('change', function() {
          f.hideParked = this.checked;
          reRenderCurrentView(tradition);
        });
      }
    }

    // Outside-click handler
    setTimeout(function() {
      function outsideClick(e) {
        if (openDropdownEl && !openDropdownEl.contains(e.target) && !e.target.closest('.col-filter-icon')) {
          closeColumnDropdown();
          document.removeEventListener('click', outsideClick, true);
        }
      }
      document.addEventListener('click', outsideClick, true);
    }, 0);
  }

  // Reconcile column rank filter when slot rank changes
  function reconcileColumnRankFilter() {
    var f = window.SpellFilters;
    if (!f.columnRankFilter) return;
    var slot = Planner.getSelectedSlot();
    if (!slot) return;
    var max = slot.rank;
    var kept = [];
    for (var i = 0; i < f.columnRankFilter.length; i++) {
      if (f.columnRankFilter[i] >= 1 && f.columnRankFilter[i] <= max) kept.push(f.columnRankFilter[i]);
    }
    if (kept.length === 0) f.columnRankFilter = null;
    else f.columnRankFilter = kept;
  }

  // ── Cycle 22 — Active Filter Summary Bar ──

  function rarityDiff() {
    var f = window.SpellFilters;
    var added = [], removed = [];
    var rarities = ['Common', 'Uncommon', 'Rare', 'Unique'];
    for (var i = 0; i < rarities.length; i++) {
      var r = rarities[i];
      var def = RARITY_DEFAULT[r];
      var cur = f.rarity[r];
      if (cur && !def) added.push(r);
      if (!cur && def) removed.push(r);
    }
    return { added: added, removed: removed };
  }

  function isAnyFilterActive() {
    var f = window.SpellFilters;
    if (!f.showLegacy) return true;
    if (f.roleInclude.length > 0 || f.roleExclude.length > 0) return true;
    if (f.coverageInclude.length > 0 || f.coverageExclude.length > 0) return true;
    if (f.traitInclude.length > 0 || f.traitExclude.length > 0) return true;
    if (f.columnNameFilter && f.columnNameFilter.length > 0) return true;
    if (f.columnRankFilter && f.columnRankFilter.length > 0) return true;
    if (f.columnActionFilter && f.columnActionFilter.length > 0) return true;
    if (f.columnStarredOnly) return true;
    if (f.hideParked) return true;
    if (f.indicatorFilter) return true;
    return false;
  }

  function renderActiveFilterBar(tradition) {
    var bar = document.getElementById('activeFilterBar-' + tradition);
    if (!bar) return;

    if (!isAnyFilterActive()) {
      bar.style.display = 'none';
      bar.innerHTML = '';
      return;
    }

    var f = window.SpellFilters;
    var inSearch = (activeTab[tradition] || 'role') === 'search';
    var chips = [];

    // Rarity — no chips (Cycle 38: sidebar toggles are the sole indicator)

    // Legacy — chip only when showLegacy is false (non-default)
    if (!f.showLegacy) {
      chips.push({ kind: 'legacy', label: '−Legacy', neg: true });
    }
    // Role filters (Cycle 38)
    if (f.coverageMode) {
      var roleLabelsMap = { damage: 'Damage', debuff: 'Debuff', buff: 'Buff', control: 'Control', healing: 'Healing', utility: 'Utility', silverBullets: 'Silver Bullet' };
      for (var i = 0; i < f.roleInclude.length; i++) {
        var rl = roleLabelsMap[f.roleInclude[i]] || f.roleInclude[i];
        var chipObj = { kind: 'role-inc', payload: f.roleInclude[i], label: 'Role: +' + rl, neg: false };
        if (inSearch) { chipObj.paused = true; }
        chips.push(chipObj);
      }
      for (var i = 0; i < f.roleExclude.length; i++) {
        var rl = roleLabelsMap[f.roleExclude[i]] || f.roleExclude[i];
        var chipObj = { kind: 'role-exc', payload: f.roleExclude[i], label: 'Role: −' + rl, neg: true };
        if (inSearch) { chipObj.paused = true; }
        chips.push(chipObj);
      }
    }
    // Coverage
    for (var i = 0; i < f.coverageInclude.length; i++) {
      var e = f.coverageInclude[i];
      chips.push({ kind: 'coverage-inc', payload: e, label: 'Coverage: ' + e.tag, neg: false });
    }
    for (var i = 0; i < f.coverageExclude.length; i++) {
      var e = f.coverageExclude[i];
      chips.push({ kind: 'coverage-exc', payload: e, label: 'Coverage: NOT ' + e.tag, neg: true });
    }
    // Trait
    for (var i = 0; i < f.traitInclude.length; i++) {
      chips.push({ kind: 'trait-inc', payload: f.traitInclude[i], label: 'Trait: ' + f.traitInclude[i], neg: false });
    }
    for (var i = 0; i < f.traitExclude.length; i++) {
      chips.push({ kind: 'trait-exc', payload: f.traitExclude[i], label: 'Trait: NOT ' + f.traitExclude[i], neg: true });
    }
    // Column filters
    var colChips = [];
    if (f.columnNameFilter && f.columnNameFilter.length > 0) {
      colChips.push({ kind: 'col-name', label: 'Name: "' + f.columnNameFilter + '"', neg: false });
    }
    if (f.columnRankFilter && f.columnRankFilter.length > 0) {
      var ranks = f.columnRankFilter.slice().sort(function(a, b) { return a - b; });
      colChips.push({ kind: 'col-rank', label: 'Rank: ' + ranks.join(', '), neg: false });
    }
    if (f.columnActionFilter && f.columnActionFilter.length > 0) {
      colChips.push({ kind: 'col-action', label: 'Action: ' + f.columnActionFilter.join(', '), neg: false });
    }
    if (f.columnStarredOnly) {
      colChips.push({ kind: 'col-starred', label: '★ only', neg: false });
    }
    if (f.hideParked) {
      colChips.push({ kind: 'hide-parked', label: 'Hiding parked spells', neg: false });
    }
    if (f.indicatorFilter) {
      var iLabels = { green: '▲ Green', orange: '◆ Orange', grey: '△ Grey' };
      var iParts = [];
      for (var ii = 0; ii < f.indicatorFilter.length; ii++) {
        iParts.push(iLabels[f.indicatorFilter[ii]] || f.indicatorFilter[ii]);
      }
      colChips.push({ kind: 'indicator', label: iParts.join(' + '), neg: false });
    }

    var html = '<span class="afb-label">Active filters:</span>';
    for (var i = 0; i < chips.length; i++) {
      var c = chips[i];
      var cls = 'filter-chip' + (c.neg ? ' neg' : '') + (c.paused ? ' paused' : '');
      var chipLabel = c.label + (c.paused ? ' (paused)' : '');
      html += '<span class="' + cls + '" data-chip-kind="' + c.kind + '"' +
        (typeof c.payload === 'string' ? ' data-chip-payload="' + c.payload.replace(/"/g, '&quot;') + '"' : '') +
        (c.payload && typeof c.payload === 'object' ? ' data-chip-tag="' + c.payload.tag + '" data-chip-field="' + c.payload.field + '"' : '') +
        '>' + chipLabel + ' <span class="afb-x">×</span></span>';
    }
    for (var i = 0; i < colChips.length; i++) {
      var c = colChips[i];
      var cls = 'filter-chip col-chip' + (c.neg ? ' neg' : '') + (inSearch ? ' paused' : '');
      var label = c.label + (inSearch ? ' (paused)' : '');
      html += '<span class="' + cls + '" data-chip-kind="' + c.kind + '">' + label + ' <span class="afb-x">×</span></span>';
    }
    html += '<button type="button" class="afb-clear" data-action="clear-all">Clear all</button>';

    bar.innerHTML = html;
    bar.style.display = '';
  }

  function clearChip(kind, payload, tag, field) {
    var f = window.SpellFilters;
    if (kind === 'rarity') {
      f.rarity = { Common: true, Uncommon: true, Rare: false, Unique: false };
      var btns = document.querySelectorAll('.rarity-btn');
      for (var i = 0; i < btns.length; i++) {
        var rar = btns[i].dataset.rarity;
        if (f.rarity[rar]) btns[i].classList.add('active');
        else btns[i].classList.remove('active');
      }
    } else if (kind === 'legacy') {
      f.showLegacy = true;
      var btn = document.getElementById('legacyToggle');
      if (btn) {
        btn.textContent = 'Show Legacy: YES';
        btn.classList.add('active');
      }
    } else if (kind === 'coverage-inc' || kind === 'coverage-exc') {
      var arr = (kind === 'coverage-inc') ? f.coverageInclude : f.coverageExclude;
      for (var i = 0; i < arr.length; i++) {
        if (arr[i].tag === tag && arr[i].field === field) { arr.splice(i, 1); break; }
      }
      // Update sidebar pill visuals
      var sel = '.sidebar [data-field="' + field + '"] .ctag[data-tag="' + tag + '"], .sidebar .ctag[data-tag="' + tag + '"]';
      var pills = document.querySelectorAll(sel);
      for (var i = 0; i < pills.length; i++) {
        pills[i].classList.remove(kind === 'coverage-inc' ? 'filter-included' : 'filter-excluded');
      }
    } else if (kind === 'role-inc') {
      var idx = f.roleInclude.indexOf(payload);
      if (idx !== -1) f.roleInclude.splice(idx, 1);
      if (window.Coverage && Coverage.updateRolePillVisuals) Coverage.updateRolePillVisuals();
    } else if (kind === 'role-exc') {
      var idx = f.roleExclude.indexOf(payload);
      if (idx !== -1) f.roleExclude.splice(idx, 1);
      if (window.Coverage && Coverage.updateRolePillVisuals) Coverage.updateRolePillVisuals();
    } else if (kind === 'trait-inc') {
      var idx = f.traitInclude.indexOf(payload);
      if (idx !== -1) f.traitInclude.splice(idx, 1);
      if (window.Coverage && Coverage.updateTraitPillVisuals) Coverage.updateTraitPillVisuals();
    } else if (kind === 'trait-exc') {
      var idx = f.traitExclude.indexOf(payload);
      if (idx !== -1) f.traitExclude.splice(idx, 1);
      if (window.Coverage && Coverage.updateTraitPillVisuals) Coverage.updateTraitPillVisuals();
    } else if (kind === 'col-name') {
      f.columnNameFilter = '';
    } else if (kind === 'col-rank') {
      f.columnRankFilter = null;
    } else if (kind === 'col-action') {
      f.columnActionFilter = null;
    } else if (kind === 'col-starred') {
      f.columnStarredOnly = false;
    } else if (kind === 'hide-parked') {
      f.hideParked = false;
    } else if (kind === 'indicator') {
      f.indicatorFilter = null;
    }
  }

  function clearAllFilterValues() {
    var f = window.SpellFilters;
    f.rarity = { Common: true, Uncommon: true, Rare: false, Unique: false };
    f.showLegacy = true;
    f.roleInclude = [];
    f.roleExclude = [];
    f.coverageInclude = [];
    f.coverageExclude = [];
    f.traitInclude = [];
    f.traitExclude = [];
    f.columnNameFilter = '';
    f.columnRankFilter = null;
    f.columnActionFilter = null;
    f.columnStarredOnly = false;
    f.hideParked = false;
    f.indicatorFilter = null;

    // Reflect rarity buttons
    var rb = document.querySelectorAll('.rarity-btn');
    for (var i = 0; i < rb.length; i++) {
      var rar = rb[i].dataset.rarity;
      if (f.rarity[rar]) rb[i].classList.add('active'); else rb[i].classList.remove('active');
    }
    // Legacy button
    var lb = document.getElementById('legacyToggle');
    if (lb) { lb.textContent = 'Show Legacy: YES'; lb.classList.add('active'); }
    // Sidebar pill visuals
    if (window.Coverage && Coverage.clearAllSidebarFilterStates) Coverage.clearAllSidebarFilterStates();
    if (window.Coverage && Coverage.updateTraitPillVisuals) Coverage.updateTraitPillVisuals();
    if (window.Coverage && Coverage.updateRolePillVisuals) Coverage.updateRolePillVisuals();
  }

  // ── Re-render current view ──
  function reRenderCurrentView(tradition) {
    var slot = Planner.getSelectedSlot();
    if (!slot) return;
    var tab = activeTab[tradition] || 'role';
    if (tab === 'search') {
      renderSearchResults(tradition);
    } else {
      Browser.renderSpells(tradition, slot.level, slot.rank);
    }
  }

  // ── Search rendering ──
  function renderSearchResults(tradition) {
    var tableEl = document.getElementById('spellTable-' + tradition);
    if (!tableEl) return;

    renderActiveFilterBar(tradition);

    var f = window.SpellFilters;
    var query = f.searchQuery;

    if (!query || query.trim().length < 2) {
      tableEl.innerHTML = '<div class="search-message">Enter at least 2 characters</div>';
      hideFilterNotice(tradition);
      return;
    }

    var results = searchSpells(query);

    if (results === null) {
      tableEl.innerHTML = '<div class="search-message">Enter at least 2 characters</div>';
      hideFilterNotice(tradition);
      return;
    }

    if (results.length === 0) {
      tableEl.innerHTML = '<div class="search-message">No results found. Try more specific search terms.</div>';
      hideFilterNotice(tradition);
      return;
    }

    var tradCap = tradition.charAt(0).toUpperCase() + tradition.slice(1);
    var slot = Planner.getSelectedSlot();
    var slotRank = slot ? slot.rank : null;

    // Split results into passing vs hidden by filters
    var passing = [];
    var hidden = [];
    for (var i = 0; i < results.length; i++) {
      var entry = results[i].entry;
      var spell = lookupSpellByAonId(entry.aonId);
      if (!spell) continue;

      var passesFilter = passesRarityLegacy(spell);

      if (!passesFilter && !f.searchFiltersDisabled) {
        hidden.push({ spell: spell, entry: entry, score: results[i].score });
      } else {
        passing.push({ spell: spell, entry: entry, score: results[i].score });
      }
    }

    // Show filter notice
    if (hidden.length > 0 && !f.searchFiltersDisabled) {
      showFilterNotice(tradition, hidden.length);
    } else {
      hideFilterNotice(tradition);
    }

    // Build display list
    var displayList = f.searchFiltersDisabled ? passing.concat(hidden) : passing;
    // Re-sort by score desc then name
    displayList.sort(function(a, b) {
      if (b.score !== a.score) return b.score - a.score;
      return a.spell.name.localeCompare(b.spell.name);
    });

    renderedSpells[tradition] = [];
    var html = buildTableHeader(true);
    for (var i = 0; i < displayList.length; i++) {
      var spell = displayList[i].spell;
      renderedSpells[tradition].push(spell);
      var warnings = [];

      if (spell.tradition.indexOf(tradCap) === -1) {
        warnings.push('Not in ' + tradCap);
      }
      if (slotRank !== null && spell.native_rank > slotRank) {
        warnings.push('Rank ' + spell.native_rank + ' — above selected slot');
      }
      html += renderSpellRow(spell, i, { warnings: warnings });
    }
    html += '</tbody></table>';

    if (displayList.length === 0) {
      tableEl.innerHTML = '<div class="search-message">All results hidden by active filters.</div>';
    } else {
      tableEl.innerHTML = html;
    }
  }

  function showFilterNotice(tradition, count) {
    var noticeEl = document.getElementById('filterNotice-' + tradition);
    if (!noticeEl) return;
    noticeEl.style.display = 'flex';
    noticeEl.querySelector('.filter-notice-text').textContent = count + ' result(s) hidden by active filters — ';
  }

  function hideFilterNotice(tradition) {
    var noticeEl = document.getElementById('filterNotice-' + tradition);
    if (noticeEl) noticeEl.style.display = 'none';
  }

  window.Browser = {
    SILVER_BULLET_NOTES: SILVER_BULLET_NOTES,

    getCurrentRole: function(tradition) {
      return currentRole[tradition] || 'damage';
    },

    getActiveTab: function(tradition) {
      return activeTab[tradition] || 'role';
    },

    _getRenderedSpells: function(tradition) {
      return renderedSpells[tradition] || null;
    },

    show: function(tradition, level, rank) {
      var browser = document.getElementById('browser-' + tradition);
      if (!browser) return;
      browser.classList.remove('browser-hidden');

      if (!currentRole[tradition]) currentRole[tradition] = 'damage';
      if (!activeTab[tradition]) activeTab[tradition] = 'role';

      // Cycle 22 — reconcile column rank filter against new slot rank
      reconcileColumnRankFilter();
      closeColumnDropdown();

      this.buildBrowserUI(tradition, level, rank);
      if (activeTab[tradition] === 'search') {
        this.showSearchUI(tradition);
      } else {
        this.renderSpells(tradition, level, rank);
      }
    },

    buildBrowserUI: function(tradition, level, rank) {
      var browser = document.getElementById('browser-' + tradition);
      if (browser.dataset.built) {
        this.updateRoleTabs(tradition);
        return;
      }
      browser.dataset.built = 'true';

      // B2 — Slot context header
      var html = '<div class="slot-context-header" id="slotHeader-' + tradition + '" style="display:none;"></div>';
      html += '<div class="browser-role-tabs" id="roleTabs-' + tradition + '">';
      for (var i = 0; i < roleOrder.length; i++) {
        var role = roleOrder[i];
        var active = role === currentRole[tradition] ? ' active' : '';
        html += '<button class="browser-role-tab' + active + '" data-role="' + role + '" onclick="Browser.setRole(\'' + tradition + '\',\'' + role + '\')">' + roleLabels[role] + '</button>';
      }
      // Search tab
      html += '<button class="browser-role-tab search-tab-btn" data-role="search" onclick="Browser.activateSearch(\'' + tradition + '\')">&#128269; Search</button>';
      html += '</div>';

      html += '<div class="browser-advice" id="advice-' + tradition + '"></div>';

      // Cycle 22 — Active filter summary bar (hidden when no filters active)
      html += '<div class="active-filter-bar" id="activeFilterBar-' + tradition + '" style="display:none;"></div>';

      // Search UI (hidden by default)
      html += '<div class="search-ui" id="searchUI-' + tradition + '" style="display:none;">';
      html += '<input type="text" class="search-input" id="searchInput-' + tradition + '" placeholder="Search spells by name, description, traits...">';
      html += '<div class="search-info">Searches all spell text. Results may include spells outside your current tradition or rank.</div>';
      html += '</div>';

      // Filter notice (hidden by default)
      html += '<div class="filter-notice" id="filterNotice-' + tradition + '" style="display:none;">';
      html += '<span class="filter-notice-text"></span>';
      html += '<button class="filter-notice-btn" onclick="Browser.searchShowThem(\'' + tradition + '\')">Show them</button>';
      html += '<button class="filter-notice-btn secondary" onclick="Browser.searchKeepFilters(\'' + tradition + '\')">Keep filters</button>';
      html += '</div>';

      html += '<div class="spell-table-wrap" id="spellTable-' + tradition + '"></div>';

      browser.innerHTML = html;
      delete browser.dataset.ornamented;
      App.injectCornerOrnaments();

      // Bind search input
      var searchInput = document.getElementById('searchInput-' + tradition);
      if (searchInput) {
        searchInput.addEventListener('input', function() {
          if (searchDebounceTimer) clearTimeout(searchDebounceTimer);
          searchDebounceTimer = setTimeout(function() {
            window.SpellFilters.searchQuery = searchInput.value;
            window.SpellFilters.searchFiltersDisabled = false;
            renderSearchResults(tradition);
          }, 300);
        });
      }

      // Bind table clicks (spell assignment + sort headers + column filters)
      var tableWrap = document.getElementById('spellTable-' + tradition);
      tableWrap.addEventListener('click', function(e) {
        if (e.target.closest('.aon-link')) return;
        if (e.target.closest('.mathfinder-star')) return;
        if (e.target.closest('.mathfinder-video-link')) return;

        // Cycle 22 — Column filter icon → open dropdown OR toggle starred
        var filterIcon = e.target.closest('.col-filter-icon');
        if (filterIcon) {
          e.stopPropagation();
          var col = filterIcon.dataset.colFilter;
          if (col === 'starred') {
            window.SpellFilters.columnStarredOnly = !window.SpellFilters.columnStarredOnly;
            reRenderCurrentView(tradition);
          } else {
            // Toggle: clicking same icon while dropdown open closes it
            if (openDropdownEl && openDropdownEl.dataset.col === col) {
              closeColumnDropdown();
            } else {
              openColumnDropdown(tradition, col, filterIcon);
            }
          }
          return;
        }

        // Sort header click (but ignore if click was on filter icon)
        var header = e.target.closest('.sortable-header');
        if (header) {
          var col = header.dataset.sortCol;
          cycleSortColumn(col);
          var slot = Planner.getSelectedSlot();
          if (slot) Browser.renderSpells(tradition, slot.level, slot.rank);
          return;
        }

        var row = e.target.closest('tr[data-spell-idx]');
        if (!row) return;
        var idx = parseInt(row.dataset.spellIdx, 10);
        var list = renderedSpells[tradition];
        if (!list || !list[idx]) return;
        Browser.assignSpell(tradition, list[idx]);
      });

      // Cycle 22 — Active filter bar interactions
      var bar = document.getElementById('activeFilterBar-' + tradition);
      if (bar) {
        bar.addEventListener('click', function(e) {
          var clearBtn = e.target.closest('[data-action="clear-all"]');
          if (clearBtn) {
            clearAllFilterValues();
            reRenderCurrentView(tradition);
            return;
          }
          var x = e.target.closest('.afb-x');
          if (!x) return;
          var chip = x.closest('.filter-chip');
          if (!chip) return;
          var kind = chip.dataset.chipKind;
          var payload = chip.dataset.chipPayload;
          var tag = chip.dataset.chipTag;
          var field = chip.dataset.chipField;
          clearChip(kind, payload, tag, field);
          reRenderCurrentView(tradition);
        });
      }
    },

    updateRoleTabs: function(tradition) {
      var tabs = document.querySelectorAll('#roleTabs-' + tradition + ' .browser-role-tab');
      var tab = activeTab[tradition] || 'role';
      for (var i = 0; i < tabs.length; i++) {
        tabs[i].classList.remove('active');
        if (tab === 'search' && tabs[i].dataset.role === 'search') {
          tabs[i].classList.add('active');
        } else if (tab === 'role' && tabs[i].dataset.role === currentRole[tradition]) {
          tabs[i].classList.add('active');
        }
      }
    },

    setRole: function(tradition, role) {
      var wasSearch = activeTab[tradition] === 'search';
      currentRole[tradition] = role;
      activeTab[tradition] = 'role';

      closeColumnDropdown();

      // Reset sort on tab switch
      window.SpellFilters.sortColumn = null;
      window.SpellFilters.sortDirection = null;

      // Cycle 38 — clean up role filters for the new tab's role
      var pillRoles = ['damage','debuff','buff','control','healing','utility','silverBullets'];
      if (pillRoles.indexOf(role) !== -1) {
        SpellFilters.roleInclude = SpellFilters.roleInclude.filter(function(r) { return r !== role; });
        SpellFilters.roleExclude = SpellFilters.roleExclude.filter(function(r) { return r !== role; });
      }
      if (window.Coverage && Coverage.updateRolePillVisuals) Coverage.updateRolePillVisuals();

      this.updateRoleTabs(tradition);

      // Hide search UI, show advice
      var searchUI = document.getElementById('searchUI-' + tradition);
      if (searchUI) searchUI.style.display = 'none';
      hideFilterNotice(tradition);
      var adviceEl = document.getElementById('advice-' + tradition);
      if (adviceEl) adviceEl.style.display = '';

      // Reset search state when leaving search tab
      if (wasSearch) {
        window.SpellFilters.searchFiltersDisabled = false;
      }

      var slot = Planner.getSelectedSlot();
      if (slot) {
        this.renderSpells(tradition, slot.level, slot.rank);
      }
    },

    activateSearch: function(tradition) {
      activeTab[tradition] = 'search';

      closeColumnDropdown();

      // Reset sort on tab switch
      window.SpellFilters.sortColumn = null;
      window.SpellFilters.sortDirection = null;
      window.SpellFilters.searchFiltersDisabled = false;

      // Hide slot header
      var slotHeaderEl = document.getElementById('slotHeader-' + tradition);
      if (slotHeaderEl) slotHeaderEl.style.display = 'none';

      this.updateRoleTabs(tradition);

      // Show search UI, hide advice
      var searchUI = document.getElementById('searchUI-' + tradition);
      if (searchUI) searchUI.style.display = '';
      var adviceEl = document.getElementById('advice-' + tradition);
      if (adviceEl) adviceEl.style.display = 'none';

      // Lazy-load search index
      var tableEl = document.getElementById('spellTable-' + tradition);
      if (!searchIndexLoaded) {
        if (tableEl) tableEl.innerHTML = '<div class="search-message">Loading search index...</div>';
        loadSearchIndex(function(err) {
          if (err) {
            if (tableEl) tableEl.innerHTML = '<div class="search-message search-error">Search index failed to load. Try regenerating with <code>python tools/build-search-index.py</code>.</div>';
            var input = document.getElementById('searchInput-' + tradition);
            if (input) input.disabled = true;
          } else {
            var input = document.getElementById('searchInput-' + tradition);
            if (input) input.disabled = false;
            renderSearchResults(tradition);
          }
        });
      } else {
        renderSearchResults(tradition);
      }

      // Focus input
      var input = document.getElementById('searchInput-' + tradition);
      if (input) setTimeout(function() { input.focus(); }, 50);
    },

    searchShowThem: function(tradition) {
      window.SpellFilters.searchFiltersDisabled = true;
      renderSearchResults(tradition);
    },

    searchKeepFilters: function(tradition) {
      hideFilterNotice(tradition);
    },

    showSearchUI: function(tradition) {
      var searchUI = document.getElementById('searchUI-' + tradition);
      if (searchUI) searchUI.style.display = '';
      var adviceEl = document.getElementById('advice-' + tradition);
      if (adviceEl) adviceEl.style.display = 'none';

      if (searchIndexLoaded) {
        renderSearchResults(tradition);
      }
    },

    renderSpells: function(tradition, level, rank) {
      var role = currentRole[tradition] || 'damage';

      // B2 — Slot context header
      var slotHeaderEl = document.getElementById('slotHeader-' + tradition);
      if (slotHeaderEl) {
        var tier = App.getTier(level, rank);
        var tierLabel = tier.charAt(0).toUpperCase() + tier.slice(1);
        var tradLabel = tradition.charAt(0).toUpperCase() + tradition.slice(1);
        slotHeaderEl.textContent = 'Spell Options for ' + tradLabel + ' Rank ' + rank + ' ' + tierLabel + ' Tier Slot';
        slotHeaderEl.style.display = '';
      }

      var adviceEl = document.getElementById('advice-' + tradition);
      if (adviceEl) {
        adviceEl.style.display = '';
        var tier = App.getTier(level, rank);
        var advice = getAdvice(role, tier, tradition);
        adviceEl.innerHTML = '';
        if (advice.isGap) {
          var em = document.createElement('em');
          em.textContent = advice.base;
          adviceEl.appendChild(em);
        } else {
          if (advice.base) {
            adviceEl.appendChild(document.createTextNode(advice.base));
          }
          if (advice.overlay) {
            adviceEl.appendChild(document.createElement('br'));
            var em = document.createElement('em');
            em.textContent = advice.overlay;
            adviceEl.appendChild(em);
          }
        }
      }

      var tableEl = document.getElementById('spellTable-' + tradition);
      if (!tableEl) return;

      var meta = filterSpells(tradition, role, rank, { withMeta: true });
      var spells = meta.results;

      // B9 — Apply heightening filters
      var f = window.SpellFilters;
      if (f.hideParked || f.indicatorFilter) {
        var filtered = [];
        for (var i = 0; i < spells.length; i++) {
          var sp = spells[i];
          if (f.hideParked) {
            var ca = evaluateChartA(sp, rank);
            if (ca.parked) continue;
          }
          if (f.indicatorFilter) {
            var match = false;
            if (f.indicatorFilter.indexOf('green') !== -1) {
              var cb = evaluateChartB(sp);
              if (cb.indicator === 'green') match = true;
              var cc = evaluateChartC(sp, rank);
              if (cc.greenNotes.length > 0) match = true;
            }
            if (f.indicatorFilter.indexOf('orange') !== -1) {
              var cc2 = evaluateChartC(sp, rank);
              if (cc2.orangeNotes.length > 0) match = true;
            }
            if (f.indicatorFilter.indexOf('grey') !== -1) {
              var cb2 = evaluateChartB(sp);
              if (cb2.indicator === 'grey') match = true;
            }
            if (!match) continue;
          }
          filtered.push(sp);
        }
        spells = filtered;
      }

      renderedSpells[tradition] = spells;

      renderActiveFilterBar(tradition);

      if (spells.length === 0) {
        if (meta.baseCount > 0) {
          tableEl.innerHTML = '<div class="no-results-msg">No spells match your current filters. <a href="#" class="clear-filters-link" data-action="clear-all">Clear all filters</a></div>';
          var link = tableEl.querySelector('.clear-filters-link');
          if (link) {
            link.addEventListener('click', function(ev) {
              ev.preventDefault();
              clearAllFilterValues();
              reRenderCurrentView(tradition);
            });
          }
        } else {
          tableEl.innerHTML = '<div style="padding:1rem;color:var(--text-dim);text-align:center;font-style:italic;">No spells found for this role/rank combination.</div>';
        }
        return;
      }

      var html = buildTableHeader(false);

      for (var i = 0; i < spells.length; i++) {
        html += renderSpellRow(spells[i], i, { slotRank: rank });
      }

      html += '</tbody></table>';
      tableEl.innerHTML = html;
    },

    assignSpell: function(tradition, spell) {
      var spellObj;
      if (typeof spell === 'string') {
        try { spellObj = JSON.parse(spell); } catch(e) { return; }
      } else {
        spellObj = spell;
      }
      Planner.assignSpell(tradition, spellObj);
    },

    // Called by filter controls when rarity/legacy toggles change
    onFiltersChanged: function() {
      var tradition = App.currentTradition();
      if (!tradition || tradition === 'overview' || tradition === 'merged' || tradition === 'about') return;
      var tab = activeTab[tradition] || 'role';

      if (tab === 'search') {
        window.SpellFilters.searchFiltersDisabled = false;
        renderSearchResults(tradition);
      } else {
        reRenderCurrentView(tradition);
      }
    },

    // Called by coverage.js when coverage filter state changes
    onCoverageFiltersChanged: function() {
      var tradition = App.currentTradition();
      if (!tradition || tradition === 'overview' || tradition === 'merged' || tradition === 'about') return;
      var tab = activeTab[tradition] || 'role';
      if (tab === 'role') {
        reRenderCurrentView(tradition);
      }
    },

    // Reset sort when switching traditions (called from App.switchTab)
    resetSort: function() {
      window.SpellFilters.sortColumn = null;
      window.SpellFilters.sortDirection = null;
    },

    // Cycle 22 — exposed for app.js (tradition switch) and planner.js (slot change)
    reconcileColumnRankFilter: function() {
      reconcileColumnRankFilter();
      closeColumnDropdown();
    },

    // Cycle 22 — close any open column-filter dropdown (used on navigation events)
    closeColumnDropdown: function() {
      closeColumnDropdown();
    }
  };

  // Global Escape key handler for column filter dropdown
  document.addEventListener('keydown', function(e) {
    if (e.key === 'Escape' && openDropdownEl) {
      closeColumnDropdown();
    }
  });
})();
