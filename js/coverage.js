// Coverage tracking sidebar — three-tier hierarchy + tooltips + weakness synergy
(function() {
  'use strict';

  // Field → coverage tag mapping. Reads SPELL_SCHEMA per-field arrays.
  // Decision 010 + Decision 016.
  var SPELL_FIELDS = [
    'defense_tags',
    'targeting_tags',
    'damage_types',
    'conditions_imposed',
    'reliability_tags',
    'action_tags',
    'special_tags'
  ];

  // Tag tooltip text — verbatim from Decision 010.
  var TAG_TOOLTIPS = {
    // Defense Coverage
    'AC':            'Targets AC via attack roll. Benefits from teamwork stacking (off-guard, Bless, fortune effects).',
    'Fort':          'Targets Fortitude save. Availability varies by tradition.',
    'Ref':           'Targets Reflex save. Most blast spells target Reflex.',
    'Will':          'Targets Will save. Availability varies sharply by tradition — Occult excels, Primal struggles.',
    'Auto':          'Bypasses saves and attack rolls entirely. The effect just happens. Rare and valuable for reliability.',

    // Targeting
    'ST':            'Can effectively target a single enemy. Your boss-fight tools.',
    'Multi':         'Can effectively target multiple enemies. Your mob-fight tools. Includes area spells, multi-target spells, and zone effects.',

    // Damage Types
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

    // Conditions — Premier
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

    // Conditions — Standard
    'Clumsy':        'Anti-Dex martial. Penalizes AC, Reflex saves, and Dex-based skills.',
    'Enfeebled':     'Anti-Str martial. Penalizes melee attacks, Athletics checks, and damage.',
    'Confused':      'Near-equivalent to removal from combat. Target attacks randomly, including allies.',
    'Stupefied':     'Anti-caster silver bullet. Penalizes spell DCs, spell attacks, and risks losing spells on cast.',
    'Immobilized':   'Movement denial. Target can still attack but can\'t reposition.',

    // Weakness
    'Imposes Weakness': 'At least one assigned spell forces enemies to become weak to a damage type. Look for ★ markers on your damage type tags — those show which types you can impose weakness TO. Pairing a weakness-imposing spell with a damage spell of that type is a powerful combo.',

    // Reliability
    'Auto-effect':    'Always does something — no save, no attack roll. Guaranteed output regardless of enemy defenses.',
    'Success-effect': 'Meaningful effect even when the enemy succeeds on their save — includes basic-save spells (guaranteed half damage) and spells with condition riders on success. Especially important for single-target boss spells where the boss succeeds ~50% of the time.',

    // Action Efficiency
    '1-action':       'Has a 1-action casting mode. Pairs with 2-action spells for the "perfect turn." Best from low-rank slots.',
    'Reaction':       'Cast as a reaction — acts on enemy turns without spending your combat actions. Doubles your action economy.',
    'Sustain-action': 'Sustain for ongoing effect. Front-load value on turn 1, then sustain for 1 action on later turns — freeing 2 actions for more offense.',
    '3-action':       'Has a 3-action casting mode. Uses your entire turn — maximum tempo investment. Worth it when the payoff justifies giving up your +1 action.',

    // Special Coverage
    'Coverage':      'Good in most encounters — not embarrassing in either AoE or single-target. A safe pick when you don\'t know what you\'ll face.',
    'Multimodal':    'Multiple distinct modes or uses within one spell slot. A Swiss Army knife — adapts to what you encounter. Summon spells are the classic example.',
    'Silver Bullet': 'Dominates a narrow situation regardless of spell rank. Revealing Light vs. invisibility. Laughing Fit vs. dangerous reactions. Acid Grip vs. grabs. Worth preparing from any rank slot and an excellent use of low tier slots.',
    'Pre-buff':      'Long-duration spell cast before combat. Converts a low-rank slot into free in-combat value without spending combat actions.',
    'Healing':       'Restores ally HP. "Do I have any way to keep allies alive at this rank?" Arcane casters will never fill this — that\'s a known tradition limitation, not a gap to fix.'
  };

  // Section / group info-icon tooltips — verbatim from Decision 010.
  var INFO_TOOLTIPS = {
    'section-offense':   'After picking spells, scan these areas. Each tradition page tags every spell and highlights gaps for every character level. Gaps = swap candidates.',
    'section-action':    'Action economy tracking for ALL spells — not just offensive ones. A defensive reaction is just as much an action efficiency concern as an offensive 1-action spell. The standard caster turn is a 2-action spell + a 1-action something. The +1 is what separates a good caster from an okay one.',
    'section-special':   'These track whether key non-offensive concerns are present in your spell list. Intended to help you track if your spell list has any of these frequently-useful elements.',
    'group-defense':     'Only offensive spells (damage and debuff) are evaluated in this section. Which enemy defenses can you target? Diversify so no single strong defense shuts you down.',
    'group-variety':     'Are you too one-dimensional? Mix your damage types, debuff conditions, and targeting modes so resistances and immunities don\'t shut you down.',
    'group-reliability': 'Will you ever have turns where you do literally nothing? Mix guaranteed-output options with save-based spells for consistent performance.'
  };

  // Damage-type data values that can also appear in weaknesses_imposed.
  // Used to find matching damage tag elements for ★ overlay.
  var DAMAGE_TYPE_VALUES = [
    'Acid','Cold','Elec','Fire','Force','Mental','Poison','Sonic','Spirit',
    'Vitality','Void','Bludg','Pierc','Slash','Bleed','Varies','Unspecified'
  ];

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
      // Imposes Weakness binary indicator
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

  function showTooltip(targetEl, text) {
    if (!text) return;
    var el = ensureTooltip();
    if (tooltipTimer) clearTimeout(tooltipTimer);
    tooltipTimer = setTimeout(function() {
      el.textContent = text;
      el.style.display = 'block';
      el.style.visibility = 'hidden';
      el.style.left = '0px';
      el.style.top = '0px';
      // Measure after content set
      var rect = targetEl.getBoundingClientRect();
      var sidebar = document.querySelector('.sidebar');
      var sidebarRect = sidebar ? sidebar.getBoundingClientRect() : null;
      var tipRect = el.getBoundingClientRect();
      var left = rect.left;
      var top = rect.bottom + 6;
      // Right-edge anchor if tag is near the right edge of sidebar
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
      var ctag = e.target.closest('.ctag');
      if (ctag && sidebar.contains(ctag)) {
        var tag = ctag.dataset.tag;
        showTooltip(ctag, TAG_TOOLTIPS[tag] || '');
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
        // Don't toggle when clicking the info icon
        if (e.target.closest('.cov-info')) {
          e.stopPropagation();
          return;
        }
        var section = this.parentElement;
        section.classList.toggle('collapsed');
      });
    }
    // Prevent info-icon clicks from bubbling to header
    var infos = document.querySelectorAll('.sidebar .cov-info');
    for (var j = 0; j < infos.length; j++) {
      infos[j].addEventListener('click', function(e) {
        e.stopPropagation();
      });
    }
  }

  var bound = false;
  function ensureBindings() {
    if (bound) return;
    if (!document.querySelector('.sidebar .cov-section-header')) return;
    bindTooltips();
    bindCollapsibles();
    bound = true;
  }

  // ── Public API ──

  window.Coverage = {
    update: function(tradition, level) {
      ensureBindings();

      var spells = collectAssignedSpells(tradition, level || 0);
      var activeTags = collectActiveTags(spells);
      var weaknessTypes = collectWeaknessTypes(spells);

      var ctags = document.querySelectorAll('.sidebar .ctag');
      for (var i = 0; i < ctags.length; i++) {
        var el = ctags[i];
        var tag = el.dataset.tag;

        // Lit / unlit
        if (activeTags[tag]) {
          el.classList.add('lit');
        } else {
          el.classList.remove('lit');
        }

        // ★ overlay on damage type tags matching weaknesses_imposed
        el.classList.remove('has-weakness');
        if (el.classList.contains('tag-damage') && weaknessTypes[tag]) {
          el.classList.add('has-weakness');
        }
      }
    }
  };

  // Bind on DOM ready (sidebar is hidden initially but in the DOM)
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', ensureBindings);
  } else {
    ensureBindings();
  }
})();
