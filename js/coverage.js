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

  function getTagTooltips() {
    return window.TAG_DEFINITIONS || {};
  }

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
                           note: '★ markers on damage type tags mean an assigned spell imposes weakness to that type. A ★ on Fire + a lit Fire tag = you can exploit the weakness you\'re creating.' },
    'trait-section':     { body: 'Below are additional traits (PF2e official spell traits; not derived) you can filter by at any time. Click on a trait to filter for it in the spell option tables. Multi-select functions as a logical AND. Long click to turn a tag into a NOT.' }
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
        var tooltips = getTagTooltips();
        var body = tooltips[tag] || '';
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

  // ── Cycle 22 — Trait Filter Pills ──

  var TRAIT_GROUPS = [
    { label: 'Damage/Energy', traits: ['Acid','Cold','Electricity','Fire','Force','Negative','Positive','Sonic','Spirit','Vitality','Void'] },
    { label: 'Elements', traits: ['Air','Earth','Metal','Water','Wood'] },
    { label: 'Mechanical', traits: ['Attack','Aura','Concentrate','Contingency','Consecration','Flourish','Manipulate','Metamagic','Move','Spellshape','Stance','Subtle'] },
    { label: 'Schools', traits: ['Abjuration','Conjuration','Divination','Enchantment','Evocation','Illusion','Necromancy','Transmutation'] },
    { label: 'Conditions/Effects', traits: ['Curse','Darkness','Death','Disease','Emotion','Fear','Fortune','Healing','Incapacitation','Light','Mental','Misfortune','Poison','Sleep'] },
    { label: 'Sensory', traits: ['Auditory','Linguistic','Olfactory','Visual'] },
    { label: 'Form/Transformation', traits: ['Incarnate','Morph','Polymorph','Possession','Summon'] },
    { label: 'Movement/Space', traits: ['Extradimensional','Teleportation'] },
    { label: 'Detection/Information', traits: ['Detection','Prediction','Scrying'] },
    { label: 'Alignment/Sanctification', traits: ['Chaotic','Evil','Good','Holy','Lawful','Sanctified','Unholy'] },
    { label: 'Other', traits: [] } // populated dynamically with leftovers
  ];

  var TRAIT_EXCLUDES = {
    // Rarity (already toggle-controlled)
    'Uncommon':1, 'Rare':1, 'Unique':1,
    // Traditions (already filtered by tradition tab)
    'Arcane':1, 'Divine':1, 'Primal':1, 'Occult':1,
    // Class traits
    'Animist':1, 'Bard':1, 'Champion':1, 'Cleric':1, 'Druid':1, 'Magus':1, 'Monk':1,
    'Oracle':1, 'Psychic':1, 'Ranger':1, 'Sorcerer':1, 'Summoner':1, 'Witch':1, 'Wizard':1,
    // Meta/structural
    'Archetype':1, 'Cantrip':1, 'Focus':1, 'Eidolon':1, 'Mythic':1
  };

  var traitInfoText = "Below are additional traits (PF2e official spell traits; not derived) you can filter by at any time. Click on a trait to filter for it in the spell option tables. Multi-select functions as a logical AND. Long click to turn a tag into a NOT.";

  var traitLongPressTimer = null;
  var traitLongPressTriggered = false;

  function getAllSpellTraits() {
    if (!window.SPELL_SCHEMA || !window.SPELL_SCHEMA.spells) return {};
    var seen = {};
    var spells = window.SPELL_SCHEMA.spells;
    for (var i = 0; i < spells.length; i++) {
      var t = spells[i].trait_raw;
      if (!t) continue;
      for (var j = 0; j < t.length; j++) {
        seen[t[j]] = true;
      }
    }
    return seen;
  }

  function getTraitsForTradition(tradition) {
    if (!window.SPELL_SCHEMA || !window.SPELL_SCHEMA.spells) return {};
    var seen = {};
    var tradCap = tradition.charAt(0).toUpperCase() + tradition.slice(1);
    var spells = window.SPELL_SCHEMA.spells;
    for (var i = 0; i < spells.length; i++) {
      if (spells[i].tradition.indexOf(tradCap) === -1) continue;
      var t = spells[i].trait_raw;
      if (!t) continue;
      for (var j = 0; j < t.length; j++) {
        seen[t[j]] = true;
      }
    }
    return seen;
  }

  function buildTraitFilterSection() {
    var sidebar = document.querySelector('.sidebar .sidebar-inner');
    if (!sidebar) return;
    if (document.getElementById('traitFiltersSection')) return;

    var available = getAllSpellTraits();
    // Build a set of traits already placed in named groups
    var inNamedGroup = {};
    for (var g = 0; g < TRAIT_GROUPS.length - 1; g++) {
      for (var t = 0; t < TRAIT_GROUPS[g].traits.length; t++) {
        inNamedGroup[TRAIT_GROUPS[g].traits[t]] = true;
      }
    }
    // Populate "Other" group with leftovers
    var otherTraits = [];
    for (var trait in available) {
      if (TRAIT_EXCLUDES[trait]) continue;
      if (!inNamedGroup[trait]) otherTraits.push(trait);
    }
    otherTraits.sort();
    TRAIT_GROUPS[TRAIT_GROUPS.length - 1].traits = otherTraits;

    var html = '<div class="cov-section trait-section" id="traitFiltersSection">';
    html += '<div class="cov-section-header">';
    html += '<span class="cov-chevron">&#9662;</span>';
    html += '<span class="cov-section-label">Trait Filters</span>';
    html += '<span class="cov-info" data-info="trait-section" title="' + traitInfoText.replace(/"/g, '&quot;') + '">&#9432;</span>';
    html += '</div>';
    html += '<div class="cov-section-body">';
    html += '<input type="text" class="trait-filter-input" id="traitFilterInput" placeholder="Type to filter traits...">';
    html += '<div class="trait-empty-msg" id="traitEmptyMsg" style="display:none;">No matching traits.</div>';

    for (var gi = 0; gi < TRAIT_GROUPS.length; gi++) {
      var group = TRAIT_GROUPS[gi];
      // Filter group traits to those present in data
      var present = [];
      for (var ti = 0; ti < group.traits.length; ti++) {
        if (available[group.traits[ti]]) present.push(group.traits[ti]);
      }
      if (present.length === 0) continue;

      html += '<div class="cov-group trait-group">';
      html += '<div class="cov-group-header">';
      html += '<span class="cov-group-label">' + group.label + '</span>';
      html += '</div>';
      html += '<div class="coverage-tags">';
      for (var pi = 0; pi < present.length; pi++) {
        var tname = present[pi];
        html += '<span class="ctag tag-trait" data-trait="' + tname + '">' + tname + '</span>';
      }
      html += '</div>';
      html += '</div>';
    }

    html += '</div></div>';

    var section = document.createElement('div');
    section.innerHTML = html;
    sidebar.appendChild(section.firstChild);

    bindTraitFilterEvents();
  }

  function bindTraitFilterEvents() {
    var section = document.getElementById('traitFiltersSection');
    if (!section) return;

    // Collapsible header
    var header = section.querySelector('.cov-section-header');
    if (header) {
      header.addEventListener('click', function(e) {
        if (e.target.closest('.cov-info')) { e.stopPropagation(); return; }
        section.classList.toggle('collapsed');
      });
    }

    // Type-to-filter input
    var input = document.getElementById('traitFilterInput');
    if (input) {
      input.addEventListener('input', function() {
        applyTraitTypeFilter(input.value);
      });
    }

    // Pill click + long-press (always active, NOT gated by coverageMode)
    section.addEventListener('mousedown', function(e) {
      var pill = e.target.closest('.ctag.tag-trait');
      if (!pill) return;
      traitLongPressTriggered = false;
      traitLongPressTimer = setTimeout(function() {
        traitLongPressTriggered = true;
        handleTraitLongPress(pill);
      }, 500);
    });

    section.addEventListener('mouseup', function() {
      if (traitLongPressTimer) { clearTimeout(traitLongPressTimer); traitLongPressTimer = null; }
    });

    section.addEventListener('mouseleave', function() {
      if (traitLongPressTimer) { clearTimeout(traitLongPressTimer); traitLongPressTimer = null; }
    });

    section.addEventListener('click', function(e) {
      var pill = e.target.closest('.ctag.tag-trait');
      if (!pill) return;
      e.stopPropagation();
      if (traitLongPressTriggered) {
        traitLongPressTriggered = false;
        return;
      }
      handleTraitClick(pill);
    });

    // Touch support
    var touchStart = null;
    section.addEventListener('touchstart', function(e) {
      var pill = e.target.closest('.ctag.tag-trait');
      if (!pill) return;
      var touch = e.touches[0];
      touchStart = { x: touch.clientX, y: touch.clientY };
      traitLongPressTriggered = false;
      traitLongPressTimer = setTimeout(function() {
        traitLongPressTriggered = true;
        e.preventDefault();
        handleTraitLongPress(pill);
      }, 500);
    }, { passive: false });

    section.addEventListener('touchmove', function(e) {
      if (!traitLongPressTimer || !touchStart) return;
      var touch = e.touches[0];
      var dx = touch.clientX - touchStart.x;
      var dy = touch.clientY - touchStart.y;
      if (Math.sqrt(dx*dx + dy*dy) > 10) {
        clearTimeout(traitLongPressTimer);
        traitLongPressTimer = null;
      }
    });

    section.addEventListener('touchend', function(e) {
      if (traitLongPressTimer) { clearTimeout(traitLongPressTimer); traitLongPressTimer = null; }
      var pill = e.target.closest('.ctag.tag-trait');
      if (!pill) return;
      if (traitLongPressTriggered) {
        traitLongPressTriggered = false;
        e.preventDefault();
        return;
      }
      e.preventDefault();
      handleTraitClick(pill);
    });

    updateTraitPillVisuals();
  }

  function handleTraitClick(pill) {
    var trait = pill.dataset.trait;
    var f = window.SpellFilters;
    var inIdx = f.traitInclude.indexOf(trait);
    var exIdx = f.traitExclude.indexOf(trait);
    if (inIdx !== -1) {
      f.traitInclude.splice(inIdx, 1);
    } else if (exIdx !== -1) {
      f.traitExclude.splice(exIdx, 1);
    } else {
      f.traitInclude.push(trait);
    }
    updateTraitPillVisuals();
    if (window.Browser && Browser.onFiltersChanged) Browser.onFiltersChanged();
  }

  function handleTraitLongPress(pill) {
    var trait = pill.dataset.trait;
    var f = window.SpellFilters;
    var inIdx = f.traitInclude.indexOf(trait);
    if (inIdx !== -1) f.traitInclude.splice(inIdx, 1);
    if (f.traitExclude.indexOf(trait) === -1) f.traitExclude.push(trait);
    updateTraitPillVisuals();
    if (window.Browser && Browser.onCoverageFiltersChanged) Browser.onCoverageFiltersChanged();
  }

  function updateTraitPillVisuals() {
    var section = document.getElementById('traitFiltersSection');
    if (!section) return;
    var f = window.SpellFilters;
    var pills = section.querySelectorAll('.ctag.tag-trait');
    for (var i = 0; i < pills.length; i++) {
      var pill = pills[i];
      var trait = pill.dataset.trait;
      pill.classList.remove('filter-included', 'filter-excluded');
      if (f.traitInclude.indexOf(trait) !== -1) pill.classList.add('filter-included');
      if (f.traitExclude.indexOf(trait) !== -1) pill.classList.add('filter-excluded');
    }
  }

  function applyTraitTypeFilter(query) {
    var section = document.getElementById('traitFiltersSection');
    if (!section) return;
    var q = (query || '').toLowerCase().trim();
    var groups = section.querySelectorAll('.trait-group');
    var anyVisible = false;

    for (var g = 0; g < groups.length; g++) {
      var group = groups[g];
      var pills = group.querySelectorAll('.ctag.tag-trait');
      var groupHasVisible = false;
      for (var p = 0; p < pills.length; p++) {
        var trait = pills[p].dataset.trait;
        var match = !q || trait.toLowerCase().indexOf(q) !== -1;
        pills[p].style.display = match ? '' : 'none';
        if (match) { groupHasVisible = true; anyVisible = true; }
      }
      group.style.display = groupHasVisible ? '' : 'none';
    }

    var emptyMsg = document.getElementById('traitEmptyMsg');
    if (emptyMsg) emptyMsg.style.display = (q && !anyVisible) ? '' : 'none';
  }

  function updateTraitDimming(tradition) {
    var section = document.getElementById('traitFiltersSection');
    if (!section || !tradition || tradition === 'overview') return;
    var present = getTraitsForTradition(tradition);
    var pills = section.querySelectorAll('.ctag.tag-trait');
    for (var i = 0; i < pills.length; i++) {
      if (present[pills[i].dataset.trait]) {
        pills[i].classList.remove('trait-dimmed');
      } else {
        pills[i].classList.add('trait-dimmed');
      }
    }
  }

  // ── Cycle 38 — Role Filter Pills ──

  var ROLE_PILL_ROLES = ['damage','debuff','buff','control','healing','utility','silverBullets'];

  var roleLongPressTimer = null;
  var roleLongPressTriggered = false;

  function updateRolePillVisuals() {
    var pills = document.querySelectorAll('.role-filter-pill');
    if (!pills.length) return;
    var f = window.SpellFilters;
    var tradition = window.App ? App.currentTradition() : null;
    var tabRole = null;
    var isSearch = false;
    if (tradition && tradition !== 'overview' && tradition !== 'merged' && tradition !== 'about' && window.Browser) {
      var tab = Browser.getActiveTab(tradition);
      if (tab === 'search') {
        isSearch = true;
      } else {
        tabRole = Browser.getCurrentRole(tradition);
      }
    }
    var isTactical = tabRole && ROLE_PILL_ROLES.indexOf(tabRole) === -1;

    for (var i = 0; i < pills.length; i++) {
      var pill = pills[i];
      var role = pill.dataset.role;
      pill.classList.remove('filter-included', 'filter-excluded', 'role-locked', 'role-inert');

      if (tradition === 'merged') continue;

      if (!isSearch && !isTactical && role === tabRole) {
        pill.classList.add('role-locked');
        continue;
      }

      if (!f.coverageMode || isSearch) {
        pill.classList.add('role-inert');
      }

      if (f.roleInclude.indexOf(role) !== -1) pill.classList.add('filter-included');
      if (f.roleExclude.indexOf(role) !== -1) pill.classList.add('filter-excluded');
    }
  }

  function handleRolePillClick(pill) {
    var f = window.SpellFilters;
    if (!f.coverageMode) return;

    var role = pill.dataset.role;
    var tradition = window.App ? App.currentTradition() : null;
    if (!tradition || tradition === 'overview' || tradition === 'merged' || tradition === 'about') return;

    if (window.Browser) {
      var tab = Browser.getActiveTab(tradition);
      if (tab === 'search') return;
      var tabRole = Browser.getCurrentRole(tradition);
      if (role === tabRole && ROLE_PILL_ROLES.indexOf(tabRole) !== -1) return;
    }

    var inIdx = f.roleInclude.indexOf(role);
    var exIdx = f.roleExclude.indexOf(role);
    if (inIdx !== -1) {
      f.roleInclude.splice(inIdx, 1);
    } else if (exIdx !== -1) {
      f.roleExclude.splice(exIdx, 1);
    } else {
      f.roleInclude.push(role);
    }
    updateRolePillVisuals();
    if (window.Browser && Browser.onCoverageFiltersChanged) Browser.onCoverageFiltersChanged();
  }

  function handleRolePillLongPress(pill) {
    var f = window.SpellFilters;
    if (!f.coverageMode) return;

    var role = pill.dataset.role;
    var tradition = window.App ? App.currentTradition() : null;
    if (!tradition || tradition === 'overview' || tradition === 'merged' || tradition === 'about') return;

    if (window.Browser) {
      var tab = Browser.getActiveTab(tradition);
      if (tab === 'search') return;
      var tabRole = Browser.getCurrentRole(tradition);
      if (role === tabRole && ROLE_PILL_ROLES.indexOf(tabRole) !== -1) return;
    }

    var inIdx = f.roleInclude.indexOf(role);
    if (inIdx !== -1) f.roleInclude.splice(inIdx, 1);
    if (f.roleExclude.indexOf(role) === -1) f.roleExclude.push(role);
    updateRolePillVisuals();
    if (window.Browser && Browser.onCoverageFiltersChanged) Browser.onCoverageFiltersChanged();
  }

  function bindRoleFilterPills() {
    var section = document.getElementById('roleFilterSection');
    if (!section) return;

    section.addEventListener('mousedown', function(e) {
      var pill = e.target.closest('.role-filter-pill');
      if (!pill) return;
      roleLongPressTriggered = false;
      roleLongPressTimer = setTimeout(function() {
        roleLongPressTriggered = true;
        handleRolePillLongPress(pill);
      }, 500);
    });

    section.addEventListener('mouseup', function() {
      if (roleLongPressTimer) { clearTimeout(roleLongPressTimer); roleLongPressTimer = null; }
    });

    section.addEventListener('mouseleave', function() {
      if (roleLongPressTimer) { clearTimeout(roleLongPressTimer); roleLongPressTimer = null; }
    });

    section.addEventListener('click', function(e) {
      var pill = e.target.closest('.role-filter-pill');
      if (!pill) return;
      e.stopPropagation();
      if (roleLongPressTriggered) {
        roleLongPressTriggered = false;
        return;
      }
      handleRolePillClick(pill);
    });

    // Touch support
    var touchStart = null;
    section.addEventListener('touchstart', function(e) {
      var pill = e.target.closest('.role-filter-pill');
      if (!pill) return;
      var touch = e.touches[0];
      touchStart = { x: touch.clientX, y: touch.clientY };
      roleLongPressTriggered = false;
      roleLongPressTimer = setTimeout(function() {
        roleLongPressTriggered = true;
        e.preventDefault();
        handleRolePillLongPress(pill);
      }, 500);
    }, { passive: false });

    section.addEventListener('touchmove', function(e) {
      if (!roleLongPressTimer || !touchStart) return;
      var touch = e.touches[0];
      var dx = touch.clientX - touchStart.x;
      var dy = touch.clientY - touchStart.y;
      if (Math.sqrt(dx*dx + dy*dy) > 10) {
        clearTimeout(roleLongPressTimer);
        roleLongPressTimer = null;
      }
    });

    section.addEventListener('touchend', function(e) {
      if (roleLongPressTimer) { clearTimeout(roleLongPressTimer); roleLongPressTimer = null; }
      var pill = e.target.closest('.role-filter-pill');
      if (!pill) return;
      if (roleLongPressTriggered) {
        roleLongPressTriggered = false;
        e.preventDefault();
        return;
      }
      e.preventDefault();
      handleRolePillClick(pill);
    });

    updateRolePillVisuals();
  }

  var bound = false;
  function ensureBindings() {
    if (bound) return;
    if (!document.querySelector('.sidebar .cov-section-header')) return;
    bindTooltips();
    bindCollapsibles();
    bindFilterMode();
    bindRoleFilterPills();
    buildTraitFilterSection();

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

    toggleRarity: function(rarity, label) {
      ensureBindings();
      var f = window.SpellFilters;
      var cb = label.querySelector('input[type="checkbox"]');
      f.rarity[rarity] = cb ? cb.checked : !f.rarity[rarity];
      if (window.Browser && Browser.onFiltersChanged) Browser.onFiltersChanged();
    },

    toggleLegacy: function() {
      ensureBindings();
      var f = window.SpellFilters;
      f.showLegacy = !f.showLegacy;
      var btn = document.getElementById('legacyToggle');
      if (btn) {
        btn.textContent = 'Show Legacy: ' + (f.showLegacy ? 'YES' : 'NO');
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
        updateRolePillVisuals();
      } else {
        sidebar.classList.remove('coverage-filter-mode');
        // Clear all coverage and role filter selections
        f.coverageInclude = [];
        f.coverageExclude = [];
        f.roleInclude = [];
        f.roleExclude = [];
        // Remove filter visual states
        var ctags = sidebar.querySelectorAll('.ctag');
        for (var i = 0; i < ctags.length; i++) {
          ctags[i].classList.remove('filter-included', 'filter-excluded');
        }
        updateRolePillVisuals();
        var clearBtn = document.getElementById('coverageClearFilters');
        if (clearBtn) clearBtn.style.display = 'none';
        // Restore coverage visualization
        var tradition = App.currentTradition();
        if (tradition && tradition !== 'overview' && tradition !== 'about') {
          var level = Planner.getCurrentLevel(tradition);
          if (tradition === 'merged') {
            this.updateMerged(level);
          } else if (tradition === 'magicitems') {
            this.updateMagicItems();
          } else {
            this.update(tradition, level);
          }
        }
      }

      if (window.Browser && Browser.onCoverageFiltersChanged) Browser.onCoverageFiltersChanged();
    },

    updateMerged: function(level) {
      ensureBindings();

      var traditions = ['arcane', 'divine', 'occult', 'primal'];
      var allSpells = [];
      for (var i = 0; i < traditions.length; i++) {
        var spells = collectAssignedSpells(traditions[i], level || 0);
        for (var j = 0; j < spells.length; j++) {
          allSpells.push(spells[j]);
        }
      }

      // Cycle 43 — planned item-spells contribute here only: wands always, scrolls with the view toggle.
      if (window.MagicItems && MagicItems.coverageSpellsForLevel) {
        var itemSpells = MagicItems.coverageSpellsForLevel(level || 0);
        for (var k = 0; k < itemSpells.length; k++) {
          allSpells.push(itemSpells[k]);
        }
      }

      var activeTags = collectActiveTags(allSpells);
      var weaknessTypes = collectWeaknessTypes(allSpells);

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

    // Cycle 43 — coverage of the planned shopping list, shown on the Magic Items tab.
    updateMagicItems: function() {
      ensureBindings();
      if (window.SpellFilters && window.SpellFilters.coverageMode) return;
      var items = (window.MagicItems && MagicItems.getAll) ? MagicItems.getAll() : [];
      var activeTags = collectActiveTags(items);
      var weaknessTypes = collectWeaknessTypes(items);
      var ctags = document.querySelectorAll('.sidebar .ctag');
      for (var i = 0; i < ctags.length; i++) {
        var el = ctags[i];
        var tag = el.dataset.tag;
        if (activeTags[tag]) { el.classList.add('lit'); } else { el.classList.remove('lit'); }
        el.classList.remove('has-weakness');
        if (el.classList.contains('tag-damage') && weaknessTypes[tag]) { el.classList.add('has-weakness'); }
      }
    },

    // Cycle 22 — exposed for app.js / browser.js to refresh on tradition switch
    updateTraitDimming: updateTraitDimming,
    updateTraitPillVisuals: updateTraitPillVisuals,

    // Cycle 38 — role filter pill visuals
    updateRolePillVisuals: updateRolePillVisuals,

    // Cycle 22 — clear all sidebar pill filter states (coverage + trait)
    clearAllSidebarFilterStates: function() {
      var sidebar = document.querySelector('.sidebar');
      if (!sidebar) return;
      var pills = sidebar.querySelectorAll('.ctag.filter-included, .ctag.filter-excluded');
      for (var i = 0; i < pills.length; i++) {
        pills[i].classList.remove('filter-included', 'filter-excluded');
      }
      var clearBtn = document.getElementById('coverageClearFilters');
      if (clearBtn) clearBtn.style.display = 'none';
    }
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', ensureBindings);
  } else {
    ensureBindings();
  }
})();
