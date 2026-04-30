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

  var roleAdvice = {
    damage: 'Top-tier slots: best native-rank blasts + strong heightened. Mid-tier: heightened spells that still compete. Low-tier: never put "evergreen" damage here.',
    debuff: 'Always native rank for top-tier — higher-rank debuffs have more "permission" to land. Low-tier: reactions and 1-action options only.',
    buff: 'Heighten key buffs to max rank. Low-tier slots: pre-buffs cast before combat from cheap slots.',
    silverBullets: 'These solve specific problems regardless of spell rank. Prepare them in low-tier slots — their value doesn\'t depend on rank.',
    reactions: 'React on enemy turns at no action cost. Prepare at native rank in low-tier slots.',
    oneAction: 'Pair with 2-action spells for a full turn. Low-tier slots are ideal.',
    prebuffs: 'Cast before combat from low-rank slots for free value. Duration matters more than rank.',
    search: 'Search the full spell catalog. Curated picks are highlighted with a gold star.'
  };

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

      // Event delegation for spell row clicks
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
      if (adviceEl) adviceEl.textContent = roleAdvice[role] || '';

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
        if (s.heightenedFrom && s.heightenedFrom > 0) {
          html += ' <span class="heightened-badge">H⬆' + s.rank + '</span>';
        }
        html += '</td>';

        // Rank
        html += '<td>' + (s.rank || '—') + '</td>';

        // Save
        html += '<td>' + (s.save || '—') + '</td>';

        // Tags
        html += '<td><div class="slot-tags">';
        var tags = s.tags || [];
        for (var t = 0; t < Math.min(tags.length, 5); t++) {
          html += '<span class="ctag" data-tag="' + tags[t] + '">' + tags[t] + '</span>';
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

    getCuratedForRole: function(tradition, role, maxRank) {
      var curated = getCuratedSpells(tradition);
      var results = [];

      for (var i = 0; i < curated.length; i++) {
        var s = curated[i];
        if (s.role !== role) continue;
        if (s.rank > maxRank) continue;
        var entry = {
          name: s.name,
          aonId: s.aonId,
          rank: s.rank,
          save: s.save,
          tags: s.tags,
          notes: s.notes,
          heightenedFrom: s.heightenedFrom,
          role: s.role,
          curated: true,
          _curated: true
        };
        results.push(entry);
      }

      // For ranked roles (damage, debuff, buff), sort by rank descending then name
      if (role === 'damage' || role === 'debuff' || role === 'buff') {
        results.sort(function(a, b) {
          if (b.rank !== a.rank) return b.rank - a.rank;
          return a.name.localeCompare(b.name);
        });
      } else {
        results.sort(function(a, b) {
          if (a.rank !== b.rank) return a.rank - b.rank;
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
      for (var i = 0; i < curatedSpells.length; i++) {
        var key = curatedSpells[i].aonId + '-' + curatedSpells[i].rank;
        curatedSet[key] = curatedSpells[i];
      }

      var results = [];
      for (var i = 0; i < all.length; i++) {
        var s = all[i];
        if (s.rank > maxRank) continue;

        if (tradFilter && s.traditions && s.traditions.indexOf(tradFilter) === -1) continue;
        if (saveFilter && s.save !== saveFilter) continue;
        if (query && s.name.toLowerCase().indexOf(query) === -1) continue;

        var key = s.aonId + '-' + s.rank;
        var curatedEntry = curatedSet[key];

        var entry = {
          name: s.name,
          aonId: s.aonId,
          rank: s.rank,
          save: s.save || s.saving_throw || '',
          tags: curatedEntry ? curatedEntry.tags : (s.traits || []),
          notes: curatedEntry ? curatedEntry.notes : (s.summary || ''),
          heightenedFrom: curatedEntry ? curatedEntry.heightenedFrom : 0,
          curated: !!curatedEntry,
          _curated: !!curatedEntry
        };
        results.push(entry);
      }

      // Sort: curated first, then alphabetical
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
