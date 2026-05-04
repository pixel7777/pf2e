// Coverage tracking sidebar — three-tier hierarchy + tooltips + weakness synergy + filter mode (Cycle 16)
(function() {
  'use strict';

  var SPELL_FIELDS = [
    'defense_tags',
    'targeting_tags',
    'damage_types',
    'conditions_imposed',
    'reliability_tags',
    'action_tags',
    'special_tags'
  ];

  var TAG_TOOLTIPS = {
    'AC':            'Targets AC via attack roll. Benefits from teamwork stacking (off-guard, Bless, fortune effects).',
    'Fort':          'Targets Fortitude save. Availability varies by tradition.',
    'Ref':           'Targets Reflex save. Most blast spells target Reflex.',
    'Will':          'Targets Will save. Availability varies sharply by tradition — Occult excels, Primal struggles.',
    'Auto':          'Bypasses saves and attack rolls entirely. The effect just happens. Rare and valuable for reliability.',
    'ST':            'Can effectively target a single enemy. Your boss-fight tools.',
    'Multi':         'Can effectively target multiple enemies. Your mob-fight tools. Includes area spells, multi-target spells, and zone effects.',
    'Acid':          'Acid damage. Less commonly resisted than Fire.',
    'Cold':          'Cold damage. Good complement to Fire — fire-immune creatures often have cold weakness.',
    'Elec':          'Electricity damage.',
    'Fire':          'Fire damage. Most common blast type — also most commonly resisted.',
    'Force':         'Force damage. Practically irresistible — premium coverage type.',
    'Mental':        'Mental damage. Key occult damage type. Doesn\'t work on mindless creatures.',
    'Poison':        'Poison damage. Many creatures are immune — tracking this warns you about the gap.',
    'Sonic':         'Sonic damage. Rarely resisted.',
    'Spirit':        'Spirit damage. Hard to resist. Key divine damage type.',
    'Vitality':      'Vitality damage (formerly Positive). Hits undead.',
    'Void':          'Void damage (formerly Negative). Hits all living creatures. One of the hardest-to-resist types.',
    'Bludg':         'Bludgeoning damage.',
    'Pierc':         'Piercing damage.',
    'Slash':         'Slashing damage.',
    'Bleed':         'Persistent bleed damage. Bypasses most resistances — stopped only by a DC 15 flat check or healing.',
    'Varies':        'Damage type chosen on cast. Excellent for coverage — one slot, multiple type options.',
    'Unspecified':   'Spell deals damage but names no type (Disintegrate, Power Word Kill). Can\'t be resisted by type-specific resistance — but also can\'t exploit type-specific weakness.',
    'Blinded':       'Total visual shutdown. Target is off-guard to everything and can\'t target anything it can\'t precisely sense.',
    'Dazzled':       '20% miss chance on all visual targeting. Stronger than it looks.',
    'Frightened':    'Penalizes ALL checks, DCs, attacks, and saves. The workhorse debuff — even Frightened 1 on a successful save is meaningful.',
    'Off-Guard':     '−2 AC. Enables sneak attack and other flat-footed-dependent features from allies.',
    'Paralyzed':     'Complete action denial. Target drops everything, falls prone, can\'t act.',
    'Prone':         'Costs an action to stand up — pseudo action denial. −2 to attack rolls while down.',
    'Restrained':    'Immobilized + off-guard + clumsy combined. Comprehensive shutdown.',
    'Sickened':      'Penalizes all checks and DCs. Broad-spectrum debuff.',
    'Slowed':        'Removes actions. Taking one action from a 3-action boss is massive action economy.',
    'Stunned':       'Stronger than Slowed but shorter duration. Devastating when it sticks.',
    'Unconscious':   'Target drops everything, falls prone, can\'t act, off-guard.',
    'Clumsy':        'Anti-Dex martial. Penalizes AC, Reflex saves, and Dex-based skills.',
    'Enfeebled':     'Anti-Str martial. Penalizes melee attacks, Athletics checks, and damage.',
    'Confused':      'Near-equivalent to removal from combat. Target attacks randomly, including allies.',
    'Stupefied':     'Anti-caster silver bullet. Penalizes spell DCs, spell attacks, and risks losing spells on cast.',
    'Immobilized':   'Movement denial. Target can still attack but can\'t reposition.',
    'Imposes Weakness': 'At least one assigned spell forces enemies to become weak to a damage type. Look for ★ markers on your damage type tags — those show which types you can impose weakness TO. Pairing a weakness-imposing spell with a damage spell of that type is a powerful combo.',
    'Auto-effect':    'Always does something — no save, no attack roll. Guaranteed output regardless of enemy defenses.',
    'Success-effect': 'Meaningful effect even when the enemy succeeds on their save — includes basic-save spells (guaranteed half damage) and spells with condition riders on success. Especially important for single-target boss spells where the boss succeeds ~50% of the time.',
    '1-action':       'Has a 1-action casting mode. Pairs with 2-action spells for the "perfect turn." Best from low-rank slots.',
    'Reaction':       'Cast as a reaction — acts on enemy turns without spending your combat actions. Doubles your action economy.',
    'Sustain-action': 'Sustain for ongoing effect. Front-load value on turn 1, then sustain for 1 action on later turns — freeing 2 actions for more offense.',
    '3-action':       'Has a 3-action casting mode. Uses your entire turn — maximum tempo investment. Worth it when the payoff justifies giving up your +1 action.',
    'Coverage':      'Good in most encounters — not embarrassing in either AoE or single-target. A safe pick when you don\'t know what you\'ll face.',
    'Multimodal':    'Multiple distinct modes or uses within one spell slot. A Swiss Army knife — adapts to what you encounter. Summon spells are the classic example.',
    'Silver Bullet': 'Dominates a narrow situation regardless of spell rank. Revealing Light vs. invisibility. Laughing Fit vs. dangerous reactions. Acid Grip vs. grabs. Worth preparing from any rank slot and an excellent use of low tier slots.',
    'Pre-buff':      'Long-duration spell cast before combat. Converts a low-rank slot into free in-combat value without spending combat actions.',
    'Healing':       'Restores ally HP. "Do I have any way to keep allies alive at this rank?" Arcane casters will never fill this — that\'s a known tradition limitation, not a gap to fix.'
  };

  var INFO_TOOLTIPS = {
    'section-offense':   { body: 'After picking spells, scan these areas. Each tradition page tags every spell and highlights gaps for every character level. Gaps = swap candidates.' },
    'section-action':    { body: 'Action economy tracking for ALL spells — not just offensive ones. A defensive reaction is just as much an action efficiency concern as an offensive 1-action spell. The standard caster turn is a 2-action spell + a 1-action something. The +1 is what separates a good caster from an okay one.',
                           note: 'Very class/subclass dependent. You may use non-MAP skills (Recall Knowledge, Demoralize, Bon Mot) instead of 1-action spells.' },
    'section-special':   { body: 'These track whether key non-offensive concerns are present in your spell list. Intended to help you track if your spell list has any of these frequently-useful elements.' },
    'group-defense':     { body: 'Only offensive spells (damage and debuff) are evaluated in this section. Which enemy defenses can you target? Diversify so no single strong defense shuts you down.',
                           note: 'Aim to cover at least 3 of 4 defenses in your top-tier slots. Prioritize avoiding the target\'s highest defense over chasing their lowest.' },
    'group-variety':     { body: 'Are you too one-dimensional? Mix your damage types, debuff conditions, and targeting modes so resistances and immunities don\'t shut you down.',
                           note: 'Don\'t just target different saves with the same type of effect. Mix your outcomes — damage types, conditions imposed, and single-target vs. multi-target options all serve different tactical needs.' },
    'group-reliability': { body: 'Will you ever have turns where you do literally nothing? Mix guaranteed-output options with save-based spells for consistent performance.',
                           note: 'Your list should never have turns where you might do literally nothing. Mix auto-effects with save-based options for consistent output.' },
    'sub-targeting':     { body: 'Can you handle both boss fights and mob fights?',
                           note: 'Spells tagged both ST and Multi are premium picks for prepared casters — one slot covers both situations.' },
    'sub-damage':        { body: 'Diversity guards against resistance and immunity. Aim for 3-4 types across your top-tier slots.',
                           note: 'Void + Force covers nearly everything: void hits all living creatures, force covers constructs and undead.' },
    'sub-conditions':    { body: 'Variety over repetition. Different conditions answer different tactical problems. The 11 premier conditions (above the divider) are the most impactful combat debuffs; the 5 standard conditions are also strategically valuable.' },
    'sub-weakness':      { body: 'A small number of spells degrade enemy survivability by imposing damage type weaknesses. This tracks whether you have any — and shows synergy with your damage type coverage.',
                           note: '★ markers on damage type tags mean an assigned spell imposes weakness to that type. A ★ on Fire + a lit Fire tag = you can exploit the weakness you\'re creating.' }
  };

  var DAMAGE_TYPE_VALUES = [
    'Acid','Cold','Elec','Fire','Force','Mental','Poison','Sonic','Spirit',
    'Vitality','Void','Bludg','Pierc','Slash','Bleed','Varies','Unspecified'
  ];

  var TAG_NOTES = {
    'ST':                'Spells tagged both ST and Multi are premium picks for prepared casters — one slot covers both situations.',
    'Multi':             'Spells tagged both ST and Multi are premium picks for prepared casters — one slot covers both situations.',
    'Void':              'Void + Force covers nearly everything: void hits all living creatures, force covers constructs and undead.',
    'Force':             'Void + Force covers nearly everything: void hits all living creatures, force covers constructs and undead.',
    'Imposes Weakness':  '★ markers on damage type tags mean an assigned spell imposes weakness to that type. A ★ on Fire + a lit Fire tag = you can exploit the weakness you\'re creating.'
  };

  // ── Data extraction ──

  function collectAssignedSpells(tradition, level) {
    var state = Planner.getState();
    if (!state[tradition] || !state[tradition][level]) return [];
    var out = [];
    var levelState = state[tradition][level];
    for (var rank in levelState) {
      var slots = levelState[rank];
      for (var i = 0; i < slots.length; i++) {
        if (slots[i]) out.push(slots[i]);
      }
    }
    return out;
  }

  function collectActiveTags(spells) {
    var tags = {};
    for (var i = 0; i < spells.length; i++) {
      var spell = spells[i];
      for (var f = 0; f < SPELL_FIELDS.length; f++) {
        var field = SPELL_FIELDS[f];
        var values = spell[field];
        if (!values || !values.length) continue;
        for (var v = 0; v < values.length; v++) {
          tags[values[v]] = true;
        }
      }
      if (spell.weaknesses_imposed && spell.weaknesses_imposed.length > 0) {
        tags['Imposes Weakness'] = true;
      }
    }
    return tags;
  }

  function collectWeaknessTypes(spells) {
    var types = {};
    for (var i = 0; i < spells.length; i++) {
      var w = spells[i].weaknesses_imposed;
      if (!w || !w.length) continue;
      for (var j = 0; j < w.length; j++) {
        types[w[j]] = true;
      }
    }
    return types;
  }

  // ── Tooltip system ──

  var tooltipEl = null;
  var tooltipTimer = null;

  function ensureTooltip() {
    if (tooltipEl) return tooltipEl;
    tooltipEl = document.createElement('div');
    tooltipEl.className = 'cov-tooltip';
    tooltipEl.style.display = 'none';
    document.body.appendChild(tooltipEl);
    return tooltipEl;
  }

  function escapeHtml(s) {
    return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
  }

  function showTooltip(targetEl, content) {
    if (!content) return;
    var body = (typeof content === 'string') ? content : content.body;
    var note = (typeof content === 'string') ? null : content.note;
    if (!body && !note) return;
    var el = ensureTooltip();
    if (tooltipTimer) clearTimeout(tooltipTimer);
    tooltipTimer = setTimeout(function() {
      var html = '';
      if (body) html += '<div class="cov-tip-body">' + escapeHtml(body) + '</div>';
      if (note) html += '<div class="cov-tip-note">' + escapeHtml(note) + '</div>';
      el.innerHTML = html;
      el.style.display = 'block';
      el.style.visibility = 'hidden';
      el.style.left = '0px';
      el.style.top = '0px';
      var rect = targetEl.getBoundingClientRect();
      var sidebar = document.querySelector('.sidebar');
      var sidebarRect = sidebar ? sidebar.getBoundingClientRect() : null;
      var tipRect = el.getBoundingClientRect();
      var left = rect.left;
      var top = rect.bottom + 6;
      if (sidebarRect && (rect.left + tipRect.width) > (sidebarRect.right - 6)) {
        left = rect.right - tipRect.width;
        if (left < sidebarRect.left + 4) left = sidebarRect.left + 4;
      }
      el.style.left = left + 'px';
      el.style.top = top + 'px';
      el.style.visibility = 'visible';
    }, 200);
  }

  function hideTooltip() {
    if (tooltipTimer) { clearTimeout(tooltipTimer); tooltipTimer = null; }
    if (tooltipEl) tooltipEl.style.display = 'none';
  }

  function bindTooltips() {
    var sidebar = document.querySelector('.sidebar');
    if (!sidebar) return;
    sidebar.addEventListener('mouseover', function(e) {
      if (window.SpellFilters && window.SpellFilters.coverageMode) return;
      var ctag = e.target.closest('.ctag');
      if (ctag && sidebar.contains(ctag)) {
        var tag = ctag.dataset.tag;
        var body = TAG_TOOLTIPS[tag] || '';
        var note = TAG_NOTES[tag];
        showTooltip(ctag, note ? { body: body, note: note } : body);
        return;
      }
      var info = e.target.closest('.cov-info');
      if (info && sidebar.contains(info)) {
        var key = info.dataset.info;
        showTooltip(info, INFO_TOOLTIPS[key] || '');
        return;
      }
    });
    sidebar.addEventListener('mouseout', function(e) {
      var rel = e.relatedTarget;
      var leaving = e.target.closest('.ctag, .cov-info');
      if (leaving && (!rel || !leaving.contains(rel))) {
        hideTooltip();
      }
    });
  }

  // ── Collapsible sections ──

  function bindCollapsibles() {
    var headers = document.querySelectorAll('.sidebar .cov-section-header');
    for (var i = 0; i < headers.length; i++) {
      headers[i].addEventListener('click', function(e) {
        if (e.target.closest('.cov-info')) {
          e.stopPropagation();
          return;
        }
        var section = this.parentElement;
        section.classList.toggle('collapsed');
      });
    }
    var infos = document.querySelectorAll('.sidebar .cov-info');
    for (var j = 0; j < infos.length; j++) {
      infos[j].addEventListener('click', function(e) {
        e.stopPropagation();
      });
    }
  }

  // ── Coverage Filter Mode ──

  var longPressTimer = null;
  var longPressTriggered = false;
  var touchStartPos = null;

  function getFieldForPill(pillEl) {
    var ancestor = pillEl.closest('[data-field]');
    return ancestor ? ancestor.dataset.field : null;
  }

  function findCoverageEntry(arr, tag, field) {
    for (var i = 0; i < arr.length; i++) {
      if (arr[i].tag === tag && arr[i].field === field) return i;
    }
    return -1;
  }

  function getPillFilterState(tag, field) {
    var f = window.SpellFilters;
    if (findCoverageEntry(f.coverageInclude, tag, field) !== -1) return 'included';
    if (findCoverageEntry(f.coverageExclude, tag, field) !== -1) return 'excluded';
    return 'neutral';
  }

  function setPillFilterState(tag, field, state) {
    var f = window.SpellFilters;
    var iIdx = findCoverageEntry(f.coverageInclude, tag, field);
    var eIdx = findCoverageEntry(f.coverageExclude, tag, field);
    if (iIdx !== -1) f.coverageInclude.splice(iIdx, 1);
    if (eIdx !== -1) f.coverageExclude.splice(eIdx, 1);
    if (state === 'included') f.coverageInclude.push({ tag: tag, field: field });
    if (state === 'excluded') f.coverageExclude.push({ tag: tag, field: field });
  }

  function updatePillVisuals() {
    var sidebar = document.querySelector('.sidebar');
    if (!sidebar) return;
    var pills = sidebar.querySelectorAll('.ctag');
    var f = window.SpellFilters;
    var hasAny = f.coverageInclude.length > 0 || f.coverageExclude.length > 0;

    for (var i = 0; i < pills.length; i++) {
      var pill = pills[i];
      var tag = pill.dataset.tag;
      var field = getFieldForPill(pill);
      if (!field) continue;

      pill.classList.remove('filter-included', 'filter-excluded');
      var state = getPillFilterState(tag, field);
      if (state === 'included') pill.classList.add('filter-included');
      if (state === 'excluded') pill.classList.add('filter-excluded');
    }

    var clearBtn = document.getElementById('coverageClearFilters');
    if (clearBtn) {
      clearBtn.style.display = hasAny ? '' : 'none';
    }
  }

  function handlePillClick(pill) {
    var tag = pill.dataset.tag;
    var field = getFieldForPill(pill);
    if (!field) return;

    var current = getPillFilterState(tag, field);
    if (current === 'neutral') {
      setPillFilterState(tag, field, 'included');
    } else {
      setPillFilterState(tag, field, 'neutral');
    }
    updatePillVisuals();
    if (window.Browser && Browser.onCoverageFiltersChanged) Browser.onCoverageFiltersChanged();
  }

  function handlePillLongPress(pill) {
    var tag = pill.dataset.tag;
    var field = getFieldForPill(pill);
    if (!field) return;

    var current = getPillFilterState(tag, field);
    if (current === 'neutral' || current === 'included') {
      setPillFilterState(tag, field, 'excluded');
    }
    updatePillVisuals();
    if (window.Browser && Browser.onCoverageFiltersChanged) Browser.onCoverageFiltersChanged();
  }

  function bindFilterMode() {
    var sidebar = document.querySelector('.sidebar');
    if (!sidebar) return;

    sidebar.addEventListener('mousedown', function(e) {
      if (!window.SpellFilters.coverageMode) return;
      var pill = e.target.closest('.ctag');
      if (!pill || !sidebar.contains(pill)) return;
      if (!getFieldForPill(pill)) return;

      longPressTriggered = false;
      longPressTimer = setTimeout(function() {
        longPressTriggered = true;
        handlePillLongPress(pill);
      }, 500);
    });

    sidebar.addEventListener('mouseup', function(e) {
      if (longPressTimer) { clearTimeout(longPressTimer); longPressTimer = null; }
    });

    sidebar.addEventListener('click', function(e) {
      if (!window.SpellFilters.coverageMode) return;
      var pill = e.target.closest('.ctag');
      if (!pill || !sidebar.contains(pill)) return;
      if (!getFieldForPill(pill)) return;

      e.stopPropagation();
      if (longPressTriggered) {
        longPressTriggered = false;
        return;
      }
      handlePillClick(pill);
    });

    // Touch support
    sidebar.addEventListener('touchstart', function(e) {
      if (!window.SpellFilters.coverageMode) return;
      var pill = e.target.closest('.ctag');
      if (!pill || !sidebar.contains(pill)) return;
      if (!getFieldForPill(pill)) return;

      var touch = e.touches[0];
      touchStartPos = { x: touch.clientX, y: touch.clientY };
      longPressTriggered = false;

      longPressTimer = setTimeout(function() {
        longPressTriggered = true;
        e.preventDefault();
        handlePillLongPress(pill);
      }, 500);
    }, { passive: false });

    sidebar.addEventListener('touchmove', function(e) {
      if (!longPressTimer || !touchStartPos) return;
      var touch = e.touches[0];
      var dx = touch.clientX - touchStartPos.x;
      var dy = touch.clientY - touchStartPos.y;
      if (Math.sqrt(dx * dx + dy * dy) > 10) {
        clearTimeout(longPressTimer);
        longPressTimer = null;
      }
    });

    sidebar.addEventListener('touchend', function(e) {
      if (longPressTimer) { clearTimeout(longPressTimer); longPressTimer = null; }
      if (!window.SpellFilters.coverageMode) return;
      var pill = e.target.closest('.ctag');
      if (!pill || !sidebar.contains(pill)) return;
      if (!getFieldForPill(pill)) return;

      if (longPressTriggered) {
        longPressTriggered = false;
        e.preventDefault();
        return;
      }
      e.preventDefault();
      handlePillClick(pill);
    });
  }

  var bound = false;
  function ensureBindings() {
    if (bound) return;
    if (!document.querySelector('.sidebar .cov-section-header')) return;
    bindTooltips();
    bindCollapsibles();
    bindFilterMode();

    // Inject Clear Filters button in sidebar
    var filterControls = document.querySelector('.filter-controls');
    if (filterControls && !document.getElementById('coverageClearFilters')) {
      var clearBtn = document.createElement('button');
      clearBtn.id = 'coverageClearFilters';
      clearBtn.className = 'filter-toggle-btn';
      clearBtn.textContent = 'Clear Coverage Filters';
      clearBtn.style.display = 'none';
      clearBtn.onclick = function() {
        window.SpellFilters.coverageInclude = [];
        window.SpellFilters.coverageExclude = [];
        updatePillVisuals();
        if (window.Browser && Browser.onCoverageFiltersChanged) Browser.onCoverageFiltersChanged();
      };
      var filterModeBtn = document.getElementById('filterModeToggle');
      if (filterModeBtn) {
        filterModeBtn.parentNode.insertBefore(clearBtn, filterModeBtn.nextSibling);
      }
    }

    bound = true;
  }

  // ── Public API ──

  window.Coverage = {
    update: function(tradition, level) {
      ensureBindings();

      if (window.SpellFilters && window.SpellFilters.coverageMode) return;

      var spells = collectAssignedSpells(tradition, level || 0);
      var activeTags = collectActiveTags(spells);
      var weaknessTypes = collectWeaknessTypes(spells);

      var ctags = document.querySelectorAll('.sidebar .ctag');
      for (var i = 0; i < ctags.length; i++) {
        var el = ctags[i];
        var tag = el.dataset.tag;

        if (activeTags[tag]) {
          el.classList.add('lit');
        } else {
          el.classList.remove('lit');
        }

        el.classList.remove('has-weakness');
        if (el.classList.contains('tag-damage') && weaknessTypes[tag]) {
          el.classList.add('has-weakness');
        }
      }
    },

    toggleRarity: function(rarity, btn) {
      ensureBindings();
      var f = window.SpellFilters;
      f.rarity[rarity] = !f.rarity[rarity];
      if (f.rarity[rarity]) {
        btn.classList.add('active');
      } else {
        btn.classList.remove('active');
      }
      if (window.Browser && Browser.onFiltersChanged) Browser.onFiltersChanged();
    },

    toggleLegacy: function() {
      ensureBindings();
      var f = window.SpellFilters;
      f.showLegacy = !f.showLegacy;
      var btn = document.getElementById('legacyToggle');
      if (btn) {
        btn.textContent = 'Show Legacy: ' + (f.showLegacy ? 'ON' : 'OFF');
        if (f.showLegacy) { btn.classList.add('active'); } else { btn.classList.remove('active'); }
      }
      if (window.Browser && Browser.onFiltersChanged) Browser.onFiltersChanged();
    },

    toggleFilterMode: function() {
      ensureBindings();
      var f = window.SpellFilters;
      f.coverageMode = !f.coverageMode;

      var btn = document.getElementById('filterModeToggle');
      if (btn) {
        btn.textContent = 'Filter Mode: ' + (f.coverageMode ? 'ON' : 'OFF');
        if (f.coverageMode) { btn.classList.add('active'); } else { btn.classList.remove('active'); }
      }

      var sidebar = document.querySelector('.sidebar');
      if (!sidebar) return;

      if (f.coverageMode) {
        sidebar.classList.add('coverage-filter-mode');
        // Remove lit/has-weakness visualization
        var ctags = sidebar.querySelectorAll('.ctag');
        for (var i = 0; i < ctags.length; i++) {
          ctags[i].classList.remove('lit', 'has-weakness');
        }
      } else {
        sidebar.classList.remove('coverage-filter-mode');
        // Clear all coverage filter selections
        f.coverageInclude = [];
        f.coverageExclude = [];
        // Remove filter visual states
        var ctags = sidebar.querySelectorAll('.ctag');
        for (var i = 0; i < ctags.length; i++) {
          ctags[i].classList.remove('filter-included', 'filter-excluded');
        }
        var clearBtn = document.getElementById('coverageClearFilters');
        if (clearBtn) clearBtn.style.display = 'none';
        // Restore coverage visualization
        var tradition = App.currentTradition();
        if (tradition && tradition !== 'overview') {
          var level = Planner.getCurrentLevel(tradition);
          this.update(tradition, level);
        }
      }

      if (window.Browser && Browser.onCoverageFiltersChanged) Browser.onCoverageFiltersChanged();
    }
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', ensureBindings);
  } else {
    ensureBindings();
  }
})();
