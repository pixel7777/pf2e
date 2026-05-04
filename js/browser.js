// Spell browser — role-based browsing from spell-data.js (SPELL_SCHEMA)
(function() {
  'use strict';

  var currentRole = {};
  var renderedSpells = {};

  // 10 roles per Decision 011, in spec order
  var roleOrder = ['damage', 'debuff', 'buff', 'control', 'utility', 'healing', 'reactions', 'oneAction', 'prebuffs', 'silverBullets'];

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

  // ── Context-Dependent Advice Matrix ──
  var adviceMatrix = {
    damage: {
      top: 'Your main combat damage. Native-rank blasts compete best here. Compare native options vs heightened — for AoE, native often wins.',
      mid: 'Transition zone. Heightened damage spells that still compete. Backup options.',
      low: 'Do NOT put "evergreen" damage here. Use for: 1-action damage, sustained, or reactions.'
    },
    debuff: {
      top: 'Always native rank. Higher-rank debuffs have more "permission" — this is where native rank matters most.',
      mid: 'Heightened debuffs that still compete. Some native-rank debuffs unlock here.',
      low: 'Reactions and 1-action options only. Don\'t waste on evergreen debuffs at low rank.'
    },
    buff: {
      top: 'Heighten your reliable buffs to max rank. As you level, check if a native buff replaces a heightened older one.',
      mid: 'Backup buffs. Buffs with good heightening formulas.',
      low: 'Pre-buffs cast before combat. Duration matters more than rank here.'
    },
    control: {
      top: 'Native-rank control spells outclass anything heightened. Walls, zones, terrain at maximum rank.',
      mid: 'Heightened control that still reshapes the battlefield. Transition-rank terrain options.',
      low: 'Low-rank control is rarely worth it. Consider utility or prebuffs instead.'
    },
    utility: {
      top: 'Rarely — utility is most efficient from low slots.',
      mid: 'Occasionally — movement or scouting that needs higher rank.',
      low: 'Ideal home. Fly, Teleport, scouting, environmental adaptation.'
    },
    healing: {
      top: 'Heighten Heal to max rank for maximum burst healing.',
      mid: 'Backup healing. Restoration, condition removal.',
      low: 'Low-rank healing is inefficient in combat. Use for out-of-combat recovery.'
    },
    silverBullets: {
      top: 'Rarely — silver bullets are most efficient in low slots.',
      mid: 'Occasionally.',
      low: 'Perfect home. Effect matters more than DC/rank.'
    },
    reactions: {
      top: 'Rarely occupies top slots.',
      mid: 'Occasionally.',
      low: 'Ideal. No action cost = great value from cheap slots.'
    },
    oneAction: {
      top: 'Rarely.',
      mid: 'Occasionally.',
      low: 'Ideal. Pair with 2-action main spell.'
    },
    prebuffs: {
      top: 'Almost never.',
      mid: 'Rarely.',
      low: 'Ideal. Cast before combat for free value.'
    }
  };

  var traditionAdvice = {
    arcane: {
      damage: { top: 'Arcane has widest damage type coverage — prioritize filling defense gaps over raw power.' },
      buff: { '*': 'No healing (no Heal, no Soothe) and no Bless/Heroism. Lean on Haste, Fly, Blur, Invisibility, True Target.' }
    },
    divine: {
      damage: { top: 'Limited blast options natively. Flames Oracle compensates. Otherwise lean into Fort/Will targeting.' },
      buff: { top: 'Heighten Heal to max rank. Bless → Heroism at R5. Best buff+heal combo.' }
    },
    occult: {
      damage: { top: 'Limited blast options. Psychic class features compensate. Lean into buff/debuff as primary.' },
      buff: { '*': 'Best buff tradition (10/10). Heighten Soothe (no Heal). Bless → Heroism at R5.' }
    },
    primal: {
      debuff: { '*': 'Will targeting is your gap. Use attack roll spells (AC) to work around it.' },
      damage: { top: 'Strong Fort and Reflex coverage. Will gap means attack rolls are important for diversity.' },
      buff: { top: 'Heighten Heal to max rank. No Bless/Heroism — buff via Haste, Fly, Barkskin, Stoneskin.' }
    }
  };

  var LOW_SLOT_ROLES = { silverBullets: 1, reactions: 1, oneAction: 1, prebuffs: 1 };

  function getAdvice(role, tier, tradition) {
    var roleAdvice = adviceMatrix[role];
    if (!roleAdvice) return '';
    if (tier === 'mid' && LOW_SLOT_ROLES[role]) tier = 'low';
    var base = roleAdvice[tier] || roleAdvice['low'] || '';

    var tradAdv = traditionAdvice[tradition];
    if (!tradAdv || !tradAdv[role]) return base;

    var roleSlice = tradAdv[role];
    var addition = roleSlice[tier] || roleSlice['*'];

    if (addition) return base + ' ' + addition;
    return base;
  }

  // ── Get spells from SPELL_SCHEMA ──
  function getSpellSchemaSpells() {
    if (!window.SPELL_SCHEMA || !window.SPELL_SCHEMA.spells) return [];
    return window.SPELL_SCHEMA.spells;
  }

  // ── Filter spells by tradition + role + rank ──
  function filterSpells(tradition, role, slotRank) {
    var allSpells = getSpellSchemaSpells();
    var tradCap = tradition.charAt(0).toUpperCase() + tradition.slice(1);
    var results = [];

    for (var i = 0; i < allSpells.length; i++) {
      var s = allSpells[i];
      if (s.tradition.indexOf(tradCap) === -1) continue;
      if (s.roles.indexOf(role) === -1) continue;
      if (s.native_rank > slotRank) continue;
      results.push(s);
    }

    // Sort: native_rank descending, then name alphabetically
    results.sort(function(a, b) {
      if (b.native_rank !== a.native_rank) return b.native_rank - a.native_rank;
      return a.name.localeCompare(b.name);
    });

    return results;
  }

  function formatActions(actionTags) { return App.formatActions(actionTags); }
  function renderTags(spell) { return App.renderTags(spell); }

  window.Browser = {
    show: function(tradition, level, rank) {
      var browser = document.getElementById('browser-' + tradition);
      if (!browser) return;
      browser.classList.remove('browser-hidden');

      if (!currentRole[tradition]) currentRole[tradition] = 'damage';

      this.buildBrowserUI(tradition, level, rank);
      this.renderSpells(tradition, level, rank);
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
      html += '</div>';

      html += '<div class="browser-advice" id="advice-' + tradition + '"></div>';
      html += '<div class="spell-table-wrap" id="spellTable-' + tradition + '"></div>';

      browser.innerHTML = html;
      delete browser.dataset.ornamented;
      App.injectCornerOrnaments();

      var tableWrap = document.getElementById('spellTable-' + tradition);
      tableWrap.addEventListener('click', function(e) {
        // Don't intercept AoN link clicks
        if (e.target.closest('.aon-link')) return;
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
      for (var i = 0; i < tabs.length; i++) {
        tabs[i].classList.remove('active');
        if (tabs[i].dataset.role === currentRole[tradition]) tabs[i].classList.add('active');
      }
    },

    setRole: function(tradition, role) {
      currentRole[tradition] = role;
      this.updateRoleTabs(tradition);

      var slot = Planner.getSelectedSlot();
      if (slot) {
        this.renderSpells(tradition, slot.level, slot.rank);
      }
    },

    renderSpells: function(tradition, level, rank) {
      var role = currentRole[tradition] || 'damage';
      var adviceEl = document.getElementById('advice-' + tradition);
      if (adviceEl) {
        var tier = App.getTier(level, rank);
        adviceEl.textContent = getAdvice(role, tier, tradition);
      }

      var tableEl = document.getElementById('spellTable-' + tradition);
      if (!tableEl) return;

      var spells = filterSpells(tradition, role, rank);
      renderedSpells[tradition] = spells;

      if (spells.length === 0) {
        tableEl.innerHTML = '<div style="padding:1rem;color:var(--text-dim);text-align:center;font-style:italic;">No spells found for this role/rank combination.</div>';
        return;
      }

      var html = '<table class="spell-table"><thead><tr>';
      html += '<th>Spell</th><th>Rank</th><th>Action</th><th>Tags</th><th>Notes</th>';
      html += '</tr></thead><tbody>';

      for (var i = 0; i < spells.length; i++) {
        var s = spells[i];

        html += '<tr data-spell-idx="' + i + '" style="cursor:pointer;">';

        // Spell name (click assigns) + AoN link icon
        html += '<td>';
        html += '<span class="spell-name-link">' + s.name + '</span>';
        if (s.aonId) {
          html += '<a href="' + App.aonUrl(s.aonId) + '" target="_blank" class="aon-link" title="Open on Archives of Nethys">↗</a>';
        }
        html += '</td>';

        // Rank
        html += '<td>' + s.native_rank + '</td>';

        // Action
        html += '<td>' + formatActions(s.action_tags) + '</td>';

        // Tags
        html += '<td>' + renderTags(s) + '</td>';

        // Notes (empty this cycle)
        html += '<td class="spell-notes"></td>';

        html += '</tr>';
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
    }
  };
})();
