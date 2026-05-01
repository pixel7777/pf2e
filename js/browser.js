// Spell browser — role-based browsing, search/filter, curated highlighting
(function() {
  'use strict';

  var currentRole = {};
  var searchTimeout = null;
  var renderedSpells = {};

  function getCuratedSpells(tradition) {
    if (!window.SPELL_DATA || !window.SPELL_DATA.curatedByTradition) return [];
    return window.SPELL_DATA.curatedByTradition[tradition] || [];
  }

  function getAllSpells() {
    if (!window.SPELL_DATA || !window.SPELL_DATA.spells) return [];
    return window.SPELL_DATA.spells;
  }

  var roleLabels = {
    damage: 'Damage',
    debuff: 'Debuff/Control',
    buff: 'Buff/Support',
    silverBullets: 'Silver Bullets',
    reactions: 'Reactions',
    oneAction: '1-Action',
    prebuffs: 'Pre-Buffs',
    search: 'Search All'
  };

  // ── Mermaid B3: Context-Dependent Advice Matrix ──
  // Indexed by [role][tier] → base advice
  var adviceMatrix = {
    damage: {
      top: 'Your main combat damage. Native-rank blasts compete best here. Compare native options vs heightened — for AoE, native often wins (Chain Lightning > heightened Fireball). For single-target, heightening can work (Thunderstrike).',
      mid: 'Transition zone. Heightened damage spells that still compete. Backup healing at 2nd-highest rank.',
      low: 'Do NOT put "evergreen" damage here. Use for: 1-action damage (Force Barrage), sustained (Floating Flame), or reactions (Brine Dragon\'s Bile).'
    },
    debuff: {
      top: 'Always native rank. Higher-rank debuffs have more "permission" — Vision of Death beats heightened Fear, Slow beats heightened Agitate. This is where native rank matters most.',
      mid: 'Heightened debuffs that still compete. Some native-rank debuffs unlock here.',
      low: 'Reactions and 1-action options only. Don\'t waste on evergreen debuffs at low rank.'
    },
    buff: {
      top: 'Heighten your reliable buffs to max rank. As you level, check if a native buff replaces a heightened older one.',
      mid: 'Backup buffs and heals. Buffs with good heightening formulas.',
      low: 'Pre-buffs cast before combat. Duration matters more than rank here.'
    },
    silverBullets: {
      top: 'Rarely — silver bullets are most efficient in low slots. If one IS here, it solves a specific high-value problem.',
      mid: 'Occasionally.',
      low: 'Perfect home. Effect matters more than DC/rank. Acid Grip, Laughing Fit, Earthbind, Revealing Light.'
    },
    reactions: {
      top: 'Rarely occupies top slots.',
      mid: 'Occasionally.',
      low: 'Ideal. No action cost = great value from cheap slots. Interposing Earth, Hidebound, Lose the Path.'
    },
    oneAction: {
      top: 'Rarely.',
      mid: 'Occasionally.',
      low: 'Ideal. Pair with 2-action main spell. Force Barrage (1-action mode), Sure Strike, Timely Tutor.'
    },
    prebuffs: {
      top: 'Almost never.',
      mid: 'Rarely.',
      low: 'Ideal. Cast before combat for free value. False Vitality, Element Sense, Tailwind.'
    },
    search: {
      top: 'Search the full spell catalog. Curated picks are highlighted with a gold star.',
      mid: 'Search the full spell catalog. Curated picks are highlighted with a gold star.',
      low: 'Search the full spell catalog. Curated picks are highlighted with a gold star.'
    }
  };

  // Tradition-specific additions, indexed by [tradition][role][tier]
  // Per spec Mermaid B3 — additions are role-specific.
  // Arcane's "Any tier — All four defenses available" applies to damage role.
  var traditionAdvice = {
    arcane: {
      damage: {
        top: 'Arcane has widest damage type coverage — prioritize filling defense gaps over raw power.',
        mid: 'All four defenses available. Lean into that variety.',
        low: 'All four defenses available. Lean into that variety.'
      },
      buff: { '*': 'No healing (no Heal, no Soothe) and no Bless/Heroism. Lean on Haste, Fly, Blur, Invisibility, True Target — speed, stealth, accuracy.' }
    },
    divine: {
      damage: { top: 'Limited blast options natively. Flames Oracle compensates. Otherwise lean into Fort/Will targeting.' },
      debuff: { '*': 'Strong Fort and Will targeting. Reflex options are limited — consider attack roll spells.' },
      buff:   { top: 'Heighten Heal to max rank. Bless → Heroism at R5; keep heightening Heroism. Best buff+heal combo (9/10).' }
    },
    occult: {
      damage: { top: 'Limited blast options. Psychic class features compensate. Otherwise use buff/debuff as primary.' },
      buff:   { '*': 'Best buff tradition (10/10). Heighten Soothe (no Heal). Bless → Heroism at R5. Lean in — this is your superpower.' }
    },
    primal: {
      debuff: { '*': 'Will targeting is your gap. Use attack roll spells (AC) to work around it.' },
      damage: { top: 'Strong Fort and Reflex coverage. Will gap means attack rolls are important for diversity.' },
      buff:   { top: 'Heighten Heal to max rank. No Bless/Heroism — buff via Haste, Fly, Barkskin, Stoneskin, Moon Frenzy.' }
    }
  };

  // Roles whose value is mostly defined by being in cheap slots — for these,
  // the "mid" tier is functionally the same as "low" (e.g., at Lv 5–6 there's
  // no proper low tier, so R1 is mid by the field-guide table, but a silver
  // bullet at R1 should still get the substantive low-tier guidance).
  var LOW_SLOT_ROLES = { silverBullets: 1, reactions: 1, oneAction: 1, prebuffs: 1 };

  function getAdvice(role, tier, tradition) {
    var roleAdvice = adviceMatrix[role];
    if (!roleAdvice) return '';
    // Fall through to low text for low-slot-focused roles when at mid tier.
    if (tier === 'mid' && LOW_SLOT_ROLES[role]) tier = 'low';
    var base = roleAdvice[tier] || roleAdvice['low'] || '';

    var tradAdv = traditionAdvice[tradition];
    if (!tradAdv || !tradAdv[role]) return base;

    var roleSlice = tradAdv[role];
    var addition = roleSlice[tier] || roleSlice['*'];

    if (addition) return base + ' ' + addition;
    return base;
  }

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

      var roles = ['damage', 'debuff', 'buff', 'silverBullets', 'reactions', 'oneAction', 'prebuffs', 'search'];
      var html = '<div class="browser-role-tabs" id="roleTabs-' + tradition + '">';
      for (var i = 0; i < roles.length; i++) {
        var active = roles[i] === currentRole[tradition] ? ' active' : '';
        html += '<button class="browser-role-tab' + active + '" data-role="' + roles[i] + '" onclick="Browser.setRole(\'' + tradition + '\',\'' + roles[i] + '\')">' + roleLabels[roles[i]] + '</button>';
      }
      html += '</div>';

      html += '<div class="browser-advice" id="advice-' + tradition + '"></div>';

      html += '<div class="search-bar" id="searchBar-' + tradition + '" style="display:none;">';
      html += '<input type="text" placeholder="Search spell name..." id="searchInput-' + tradition + '" oninput="Browser.onSearch(\'' + tradition + '\')">';
      html += '<select id="filterTradition-' + tradition + '" onchange="Browser.onSearch(\'' + tradition + '\')">';
      html += '<option value="">All Traditions</option>';
      html += '<option value="' + tradition + '" selected>' + tradition.charAt(0).toUpperCase() + tradition.slice(1) + '</option>';
      html += '<option value="arcane">Arcane</option><option value="divine">Divine</option><option value="occult">Occult</option><option value="primal">Primal</option>';
      html += '</select>';
      html += '<select id="filterSave-' + tradition + '" onchange="Browser.onSearch(\'' + tradition + '\')">';
      html += '<option value="">Any Save</option>';
      html += '<option value="Fortitude">Fort</option><option value="Reflex">Reflex</option><option value="Will">Will</option><option value="">None/Auto</option>';
      html += '</select>';
      html += '</div>';

      html += '<div class="spell-table-wrap" id="spellTable-' + tradition + '"></div>';

      browser.innerHTML = html;

      var tableWrap = document.getElementById('spellTable-' + tradition);
      tableWrap.addEventListener('click', function(e) {
        if (e.target.closest('.spell-name-link') && e.target.tagName === 'A') return;
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

      var searchBar = document.getElementById('searchBar-' + tradition);
      if (searchBar) searchBar.style.display = (role === 'search') ? 'flex' : 'none';

      var slot = Planner.getSelectedSlot();
      if (slot) {
        this.renderSpells(tradition, slot.level, slot.rank);
      }
    },

    onSearch: function(tradition) {
      if (searchTimeout) clearTimeout(searchTimeout);
      searchTimeout = setTimeout(function() {
        var slot = Planner.getSelectedSlot();
        if (slot) {
          Browser.renderSpells(tradition, slot.level, slot.rank);
        }
      }, 200);
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

      var spells;

      if (role === 'search') {
        spells = this.getSearchResults(tradition, level, rank);
      } else {
        spells = this.getCuratedForRole(tradition, role, rank);
      }

      renderedSpells[tradition] = spells || [];

      if (!spells || spells.length === 0) {
        tableEl.innerHTML = '<div style="padding:1rem;color:var(--text-dim);text-align:center;font-style:italic;">No spells found for this role/rank combination.</div>';
        return;
      }

      var html = '<table class="spell-table"><thead><tr>';
      html += '<th>Spell</th><th>Rank</th><th>Save</th><th>Tags</th><th>Notes</th>';
      html += '</tr></thead><tbody>';

      for (var i = 0; i < spells.length; i++) {
        var s = spells[i];
        var isCurated = s.curated || s._curated;
        var rowClass = isCurated ? ' curated-row' : '';
        if (s._parked) rowClass += ' parked-row';

        html += '<tr class="' + rowClass + '" data-spell-idx="' + i + '" style="cursor:pointer;">';

        // Name
        var aonId = s.aonId;
        html += '<td>';
        if (isCurated) html += '<span class="curated-star" title="Mathfinder curated pick">★</span>';
        if (aonId) {
          html += '<a href="' + App.aonUrl(aonId) + '" target="_blank" class="spell-name-link">' + s.name + '</a>';
        } else {
          html += '<span class="spell-name-link">' + s.name + '</span>';
        }
        // Heighten badge — meaningful vs parked vs native
        if (s._displayRank && s._displayRank > (s._nativeRank || 0)) {
          if (s._parked) {
            html += ' <span class="heightened-badge parked" title="Parked: no curated entry at slot rank — heightening to slot rank with no extra benefit">H⬆' + s._displayRank + ' (parked)</span>';
          } else {
            html += ' <span class="heightened-badge" title="Meaningful heighten: curated entry confirms value at this rank">H⬆' + s._displayRank + '</span>';
          }
        } else if (s.heightenedFrom && s.heightenedFrom > 0 && !s._displayRank) {
          // Search-tab fallback: catalog spells at native rank
          html += ' <span class="heightened-badge">H⬆' + s.rank + '</span>';
        }
        html += '</td>';

        // Rank — show display rank for parked entries
        var displayRank = s._displayRank || s.rank || '—';
        html += '<td>' + displayRank + '</td>';

        // Save
        html += '<td>' + (s.save || '—') + '</td>';

        // Tags
        html += '<td><div class="slot-tags">';
        var tags = s.tags || [];
        for (var t = 0; t < Math.min(tags.length, 5); t++) {
          var groupClass = Coverage.getGroupClass(tags[t]);
          html += '<span class="ctag ' + groupClass + '" data-tag="' + tags[t] + '">' + tags[t] + '</span>';
        }
        if (tags.length > 5) html += '<span class="ctag">+' + (tags.length - 5) + '</span>';
        html += '</div></td>';

        // Notes
        html += '<td class="spell-notes">' + (s.notes || s.summary || '') + '</td>';

        html += '</tr>';
      }

      html += '</tbody></table>';
      tableEl.innerHTML = html;
    },

    // ── Mermaid B2: Heighten Deduplication ──
    // Group curated entries by aonId (per tradition + role).
    // For a slot at rank N, show ONE entry per group: the highest entry with rank <= N.
    // Tag the displayed entry as either "meaningful" or "parked".
    getCuratedForRole: function(tradition, role, slotRank) {
      var curated = getCuratedSpells(tradition);

      // Step 1: filter to (this role, rank <= slotRank)
      var roleEntries = [];
      for (var i = 0; i < curated.length; i++) {
        var s = curated[i];
        if (s.role !== role) continue;
        if (s.rank > slotRank) continue;
        roleEntries.push(s);
      }

      // Step 2: group by aonId
      var groups = {};
      for (var i = 0; i < roleEntries.length; i++) {
        var s = roleEntries[i];
        var key = s.aonId || ('name:' + s.name.toLowerCase());
        if (!groups[key]) groups[key] = [];
        groups[key].push(s);
      }

      // Step 3: for each group, pick the entry with the highest rank
      var results = [];
      for (var key in groups) {
        var entries = groups[key];
        // Sort by rank descending
        entries.sort(function(a, b) { return (b.rank || 0) - (a.rank || 0); });
        var best = entries[0];

        // Determine if meaningful or parked
        // Meaningful: best.rank == slotRank (curated entry exists exactly at slot rank)
        // Parked: best.rank < slotRank (no curated entry at slot rank — would be heightened with no extra benefit)
        // Native: best.rank == slotRank AND heightenedFrom == 0 (no heighten badge at all)
        var isParked = (best.rank < slotRank);
        var displayRank = isParked ? slotRank : best.rank;
        var nativeRank = best.heightenedFrom || best.rank;

        var entry = {
          name: best.name,
          aonId: best.aonId,
          rank: best.rank,
          save: best.save,
          tags: best.tags,
          notes: best.notes,
          heightenedFrom: best.heightenedFrom,
          role: best.role,
          curated: true,
          _curated: true,
          _displayRank: displayRank,
          _nativeRank: nativeRank,
          _parked: isParked
        };
        results.push(entry);
      }

      // Sort results
      if (role === 'damage' || role === 'debuff' || role === 'buff') {
        // Rank descending (display rank), then meaningful before parked, then name
        results.sort(function(a, b) {
          if (b._displayRank !== a._displayRank) return b._displayRank - a._displayRank;
          if (a._parked !== b._parked) return a._parked ? 1 : -1;
          return a.name.localeCompare(b.name);
        });
      } else {
        results.sort(function(a, b) {
          if (a.rank !== b.rank) return a.rank - b.rank;
          if (a._parked !== b._parked) return a._parked ? 1 : -1;
          return a.name.localeCompare(b.name);
        });
      }

      return results;
    },

    getSearchResults: function(tradition, level, maxRank) {
      var input = document.getElementById('searchInput-' + tradition);
      var filterTrad = document.getElementById('filterTradition-' + tradition);
      var filterSave = document.getElementById('filterSave-' + tradition);

      var query = input ? input.value.toLowerCase().trim() : '';
      var tradFilter = filterTrad ? filterTrad.value.toLowerCase() : '';
      var saveFilter = filterSave ? filterSave.value : '';

      var all = getAllSpells();
      var curatedSet = {};
      var curatedSpells = getCuratedSpells(tradition);
      // Index curated by aonId only (not rank) so we can find the best curated overlay for any catalog entry
      for (var i = 0; i < curatedSpells.length; i++) {
        var aid = curatedSpells[i].aonId;
        if (!aid) continue;
        if (!curatedSet[aid] || curatedSpells[i].rank > curatedSet[aid].rank) {
          curatedSet[aid] = curatedSpells[i];
        }
      }

      var results = [];
      for (var i = 0; i < all.length; i++) {
        var s = all[i];
        if (s.rank > maxRank) continue;

        if (tradFilter && s.traditions && s.traditions.indexOf(tradFilter) === -1) continue;
        if (saveFilter && s.save !== saveFilter) continue;
        if (query && s.name.toLowerCase().indexOf(query) === -1) continue;

        var curatedEntry = curatedSet[s.aonId];

        var entry = {
          name: s.name,
          aonId: s.aonId,
          rank: s.rank,
          save: s.save || s.saving_throw || '',
          tags: curatedEntry ? curatedEntry.tags : (s.computedTags || s.traits || []),
          notes: curatedEntry ? curatedEntry.notes : (s.summary || ''),
          heightenedFrom: curatedEntry ? curatedEntry.heightenedFrom : 0,
          curated: !!curatedEntry,
          _curated: !!curatedEntry
        };
        results.push(entry);
      }

      results.sort(function(a, b) {
        if (a.curated !== b.curated) return a.curated ? -1 : 1;
        return a.name.localeCompare(b.name);
      });

      return results.slice(0, 200);
    },

    assignSpell: function(tradition, spellStr) {
      var spell;
      if (typeof spellStr === 'string') {
        try { spell = JSON.parse(spellStr); } catch(e) { return; }
      } else {
        spell = spellStr;
      }
      Planner.assignSpell(tradition, spell);
    }
  };
})();
