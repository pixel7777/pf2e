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
    958:  'Anti-everything (at apex rank). Shuts down enemy abilities completely.'
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
    showLegacy: false,
    coverageMode: false,
    coverageInclude: [],
    coverageExclude: [],
    sortColumn: null,
    sortDirection: null,
    searchQuery: '',
    searchFiltersDisabled: false
  };

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
        top: 'Control options open up at higher ranks: Black Tentacles (R5), Chromatic Wall (R5), Wall of Force (R6). Lower ranks are limited.'
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

  // ── Filter spells by tradition + role + rank + rarity/legacy + coverage ──
  function filterSpells(tradition, role, slotRank) {
    var allSpells = getSpellSchemaSpells();
    var tradCap = tradition.charAt(0).toUpperCase() + tradition.slice(1);
    var results = [];

    for (var i = 0; i < allSpells.length; i++) {
      var s = allSpells[i];
      if (s.tradition.indexOf(tradCap) === -1) continue;
      if (s.roles.indexOf(role) === -1) continue;
      if (s.native_rank > slotRank) continue;
      if (!passesRarityLegacy(s)) continue;
      if (!passesCoverageFilters(s)) continue;
      results.push(s);
    }

    return applySortOrder(results);
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

  function applySortOrder(results) {
    var f = window.SpellFilters;
    if (!f.sortColumn || !f.sortDirection) {
      results.sort(function(a, b) {
        if (b.native_rank !== a.native_rank) return b.native_rank - a.native_rank;
        var aStarred = a.mathfinder_reviewed ? 1 : 0;
        var bStarred = b.mathfinder_reviewed ? 1 : 0;
        if (aStarred !== bStarred) return bStarred - aStarred;
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
    script.src = 'data/search-index.js';

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

  // ── Render helpers ──

  function renderSpellRow(spell, idx, opts) {
    opts = opts || {};
    var isLegacy = spell.era === 'legacy_core';
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
    // Chain badges
    if (spell.replaces && spell.replaces.length > 0) {
      var rep = spell.replaces[0];
      html += '<span class="chain-badge chain-replaces">↑ Replaces ' + rep.spell + '</span>';
    } else if (spell.replaced_by && spell.replaced_by.length > 0) {
      var rb = spell.replaced_by[0];
      html += '<span class="chain-badge chain-replaced-by">↓ See ' + rb.spell + ' at rank ' + rb.at_rank + '</span>';
    }
    if (opts.warnings) {
      for (var w = 0; w < opts.warnings.length; w++) {
        html += '<span class="search-warning-badge">' + opts.warnings[w] + '</span>';
      }
    }
    html += '</td>';

    // Rank
    html += '<td>' + spell.native_rank + '</td>';

    // Action
    html += '<td>' + formatActions(spell.action_tags) + '</td>';

    // Tags
    html += '<td>' + renderTags(spell) + '</td>';

    // Notes — video link for spells with direct Mathfinder source + silver bullet purpose note
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
    html += '</td>';

    html += '</tr>';
    return html;
  }

  function buildTableHeader(isSearch) {
    var html = '<table class="spell-table"><thead><tr>';
    if (isSearch) {
      html += '<th>Spell</th><th>Rank</th><th>Action</th><th>Tags</th><th>Notes</th>';
    } else {
      html += '<th class="sortable-header" data-sort-col="name">Spell' + sortIndicator('name') + '</th>';
      html += '<th class="sortable-header" data-sort-col="rank">Rank' + sortIndicator('rank') + '</th>';
      html += '<th class="sortable-header" data-sort-col="action">Action' + sortIndicator('action') + '</th>';
      html += '<th>Tags</th><th>Notes</th>';
    }
    html += '</tr></thead><tbody>';
    return html;
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
    _getRenderedSpells: function(tradition) {
      return renderedSpells[tradition] || null;
    },

    show: function(tradition, level, rank) {
      var browser = document.getElementById('browser-' + tradition);
      if (!browser) return;
      browser.classList.remove('browser-hidden');

      if (!currentRole[tradition]) currentRole[tradition] = 'damage';
      if (!activeTab[tradition]) activeTab[tradition] = 'role';

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

      var html = '<div class="browser-role-tabs" id="roleTabs-' + tradition + '">';
      for (var i = 0; i < roleOrder.length; i++) {
        var role = roleOrder[i];
        var active = role === currentRole[tradition] ? ' active' : '';
        html += '<button class="browser-role-tab' + active + '" data-role="' + role + '" onclick="Browser.setRole(\'' + tradition + '\',\'' + role + '\')">' + roleLabels[role] + '</button>';
      }
      // Search tab
      html += '<button class="browser-role-tab search-tab-btn" data-role="search" onclick="Browser.activateSearch(\'' + tradition + '\')">&#128269; Search</button>';
      html += '</div>';

      html += '<div class="browser-advice" id="advice-' + tradition + '"></div>';

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

      // Bind table clicks (spell assignment + sort headers)
      var tableWrap = document.getElementById('spellTable-' + tradition);
      tableWrap.addEventListener('click', function(e) {
        if (e.target.closest('.aon-link')) return;
        if (e.target.closest('.mathfinder-star')) return;
        if (e.target.closest('.mathfinder-video-link')) return;

        // Sort header click
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

      // Reset sort on tab switch
      window.SpellFilters.sortColumn = null;
      window.SpellFilters.sortDirection = null;

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

      // Reset sort on tab switch
      window.SpellFilters.sortColumn = null;
      window.SpellFilters.sortDirection = null;
      window.SpellFilters.searchFiltersDisabled = false;

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

      var spells = filterSpells(tradition, role, rank);
      renderedSpells[tradition] = spells;

      if (spells.length === 0) {
        tableEl.innerHTML = '<div style="padding:1rem;color:var(--text-dim);text-align:center;font-style:italic;">No spells found for this role/rank combination.</div>';
        return;
      }

      var html = buildTableHeader(false);

      for (var i = 0; i < spells.length; i++) {
        html += renderSpellRow(spells[i], i);
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
      if (!tradition || tradition === 'overview') return;
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
      if (!tradition || tradition === 'overview') return;
      var tab = activeTab[tradition] || 'role';
      if (tab === 'role') {
        reRenderCurrentView(tradition);
      }
    },

    // Reset sort when switching traditions (called from App.switchTab)
    resetSort: function() {
      window.SpellFilters.sortColumn = null;
      window.SpellFilters.sortDirection = null;
    }
  };
})();
