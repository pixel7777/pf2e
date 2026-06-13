// Magic Items — scroll & wand shopping list (Cycle 43)
// Cross-tradition planning of consumable spell purchases. Cost and item level are
// pure functions of spell rank (AoN Player Core); nothing here touches spell-data.
(function() {
  'use strict';

  // ── Cost / item-level engine (pure functions of spell rank) ──
  // AoN-verified. Scroll item level = 2r-1; Wand item level = 2r+1 (wand cap rank 9).
  var SCROLL_PRICE = { 1:4, 2:12, 3:30, 4:70, 5:150, 6:300, 7:600, 8:1300, 9:3000, 10:8000 };
  var WAND_PRICE   = { 1:60, 2:160, 3:360, 4:700, 5:1400, 6:3000, 7:6500, 8:15000, 9:40000 };
  // Cumulative per-character wealth (AoN "Treasure for New Characters" lump sum).
  var CHAR_WEALTH = { 1:15, 2:30, 3:75, 4:140, 5:270, 6:450, 7:720, 8:1100, 9:1600, 10:2300,
                      11:3200, 12:4500, 13:6400, 14:9300, 15:13500, 16:20000, 17:30000,
                      18:45000, 19:69000, 20:112000 };

  function unitCost(kind, rank) {
    var t = kind === 'wand' ? WAND_PRICE : SCROLL_PRICE;
    return t[rank] || 0;
  }
  function itemLevel(kind, rank) {
    return kind === 'wand' ? (2 * rank + 1) : (2 * rank - 1);
  }
  function characterWealthAt(level) { return CHAR_WEALTH[level] || 0; }

  // Legal ranks = native rank + heighten ranks, deduped/sorted; wand capped at 9.
  function legalRanks(spell, kind) {
    var set = {};
    if (spell.native_rank) set[spell.native_rank] = true;
    var hr = spell.heighten_ranks || [];
    for (var i = 0; i < hr.length; i++) set[hr[i]] = true;
    var cap = kind === 'wand' ? 9 : 10;
    var out = [];
    for (var r in set) {
      var n = parseInt(r, 10);
      if (n >= 1 && n <= cap) out.push(n);
    }
    out.sort(function(a, b) { return a - b; });
    return out;
  }

  // ── Shopping-list state ──
  // Each item snapshots its own kind + rank + the spell fields needed to render and to
  // feed merged coverage — never a live reference to the catalog spell (avoids drift).
  var items = [];
  var includeScrollsInCoverage = false; // ephemeral, view-only (merged); NOT persisted

  var COVERAGE_FIELDS = ['defense_tags','targeting_tags','damage_types','conditions_imposed',
                         'reliability_tags','action_tags','special_tags','weaknesses_imposed'];

  function snapshotSpell(spell) {
    var snap = {
      aonId: spell.aonId,
      name: spell.name,
      tradition: (spell.tradition || []).slice(),
      roles: (spell.roles || []).slice(),
      native_rank: spell.native_rank,
      heighten_ranks: (spell.heighten_ranks || []).slice(),
      basic_save: spell.basic_save || false,
      st_incap: spell.st_incap || false,
      mathfinder_reviewed: spell.mathfinder_reviewed || false
    };
    for (var i = 0; i < COVERAGE_FIELDS.length; i++) {
      snap[COVERAGE_FIELDS[i]] = (spell[COVERAGE_FIELDS[i]] || []).slice();
    }
    return snap;
  }

  function clampLevel(n) {
    n = parseInt(n, 10) || 1;
    if (n < 1) n = 1;
    if (n > 20) n = 20;
    return n;
  }

  function defaultRank(spell, kind) {
    var ranks = legalRanks(spell, kind);
    var rank = spell.native_rank || 1;
    if (kind === 'wand' && rank > 9) rank = 9;
    if (ranks.indexOf(rank) === -1 && ranks.length) rank = ranks[0];
    return rank;
  }

  // Which traditions has the user actually populated (any assigned spell)? Off-list flag basis.
  function populatedTraditions() {
    var out = {};
    if (!window.Planner) return out;
    var state = Planner.getState();
    var trads = ['arcane', 'divine', 'occult', 'primal'];
    for (var t = 0; t < trads.length; t++) {
      var tr = trads[t];
      if (!state[tr]) continue;
      var found = false;
      for (var lv = 1; lv <= 20 && !found; lv++) {
        if (!state[tr][lv]) continue;
        for (var r in state[tr][lv]) {
          var slots = state[tr][lv][r];
          for (var s = 0; s < slots.length; s++) {
            if (slots[s]) { found = true; break; }
          }
          if (found) break;
        }
      }
      if (found) out[tr.charAt(0).toUpperCase() + tr.slice(1)] = true;
    }
    return out;
  }

  function isOffList(item) {
    var populated = populatedTraditions();
    var keys = Object.keys(populated);
    if (keys.length === 0) return false; // nothing populated yet — don't nag
    var trad = item.tradition || [];
    for (var i = 0; i < trad.length; i++) {
      if (populated[trad[i]]) return false; // on at least one populated list
    }
    return true;
  }

  // ── Public API ──
  window.MagicItems = {
    // engine (exposed for tests + reuse)
    unitCost: unitCost,
    itemLevel: itemLevel,
    legalRanks: legalRanks,
    characterWealthAt: characterWealthAt,
    isOffList: isOffList,

    getAll: function() { return items; },
    setAll: function(arr) { items = Array.isArray(arr) ? arr : []; },

    getIncludeScrolls: function() { return includeScrollsInCoverage; },

    add: function(spell, kind) {
      var snap = snapshotSpell(spell);
      snap.kind = kind;
      snap.chosenRank = defaultRank(spell, kind);
      snap.qty = 1;
      snap.purchaseLevel = clampLevel(itemLevel(kind, snap.chosenRank));
      items.push(snap);
      this.renderShopping();
      App.toast('Added ' + spell.name + ' as ' + kind);
    },

    remove: function(idx) {
      if (idx < 0 || idx >= items.length) return;
      items.splice(idx, 1);
      this.renderShopping();
    },

    update: function(idx, field, value) {
      var it = items[idx];
      if (!it) return;
      if (field === 'kind') {
        it.kind = value === 'wand' ? 'wand' : 'scroll';
        // re-validate rank against new kind's legal set
        var ranks = legalRanks(it, it.kind);
        if (ranks.indexOf(it.chosenRank) === -1 && ranks.length) it.chosenRank = ranks[0];
      } else if (field === 'rank') {
        it.chosenRank = parseInt(value, 10) || it.chosenRank;
      } else if (field === 'qty') {
        var q = parseInt(value, 10);
        it.qty = (q && q > 0) ? q : 1;
      } else if (field === 'purchaseLevel') {
        it.purchaseLevel = clampLevel(value);
      }
      this.renderShopping();
    },

    // Items visible in the merged view at a given character level (display): purchaseLevel <= level.
    displayItemsForLevel: function(level) {
      var out = [];
      for (var i = 0; i < items.length; i++) {
        if (items[i].purchaseLevel <= level) out.push(items[i]);
      }
      return out;
    },

    // Item-spells that contribute to merged coverage at a level: wands always; scrolls only
    // when the ephemeral view toggle is on. Returns snapshot objects (carry coverage arrays).
    coverageSpellsForLevel: function(level) {
      var out = [];
      for (var i = 0; i < items.length; i++) {
        var it = items[i];
        if (it.purchaseLevel > level) continue;
        if (it.kind === 'wand' || includeScrollsInCoverage) out.push(it);
      }
      return out;
    },

    // Levels that should get a merged-view tab purely from item purchases.
    itemPurchaseLevels: function() {
      var out = [];
      for (var i = 0; i < items.length; i++) {
        if (out.indexOf(items[i].purchaseLevel) === -1) out.push(items[i].purchaseLevel);
      }
      return out;
    },

    setIncludeScrolls: function(on) {
      includeScrollsInCoverage = !!on;
      var lvl = Planner.getCurrentLevel('merged');
      if (window.Coverage && Coverage.updateMerged) Coverage.updateMerged(lvl);
      if (window.Planner && Planner.buildMergedView) Planner.buildMergedView(lvl);
    },

    // ── Tab UI ──
    renderTab: function() {
      var page = document.getElementById('page-magicitems');
      if (!page) return;
      if (!page.dataset.built) {
        page.dataset.built = 'true';
        var html = '';
        html += '<div class="export-bar">';
        html += '<button class="export-btn" onclick="Export.copyToClipboard()">📋 Copy Plan</button><span class="info-bubble" title="Copies your full plan, including this shopping list, as readable Markdown.">ⓘ</span>';
        html += '<button class="export-btn" onclick="Export.downloadMd()">📄 Download .md</button><span class="info-bubble" title="Downloads your full plan, including this shopping list, as a Markdown file.">ⓘ</span>';
        html += '<button class="export-btn" onclick="Export.downloadCsv()">📊 Download CSV</button><span class="info-bubble" title="Downloads just the shopping list as a spreadsheet (CSV). One-way — add your own mundane gear in your spreadsheet.">ⓘ</span>';
        html += '<button class="export-btn" onclick="Export.savePlan()">💾 Save Plan</button><span class="info-bubble" title="Saves your full plan — spells and this shopping list — as a .json file to reload later.">ⓘ</span>';
        html += '<button class="export-btn" onclick="Export.loadPlan()">📂 Load Plan</button><span class="info-bubble" title="Load a previously saved .json plan. Replaces your current selections and shopping list.">ⓘ</span>';
        html += '<input type="file" accept=".json" style="display:none" onchange="Export.handleLoadFile(this)">';
        html += '</div>';

        html += '<section class="overview-section mi-intro">';
        html += '<h2 class="section-label">Magic Items — Scroll &amp; Wand Shopping List</h2>';
        html += '<p class="section-intro">Plan the spells you\'ll buy rather than slot. A <strong>scroll</strong> suits a once-per-adventure need; a <strong>wand</strong> suits a once-per-day need. Costs and item levels are figured automatically from the spell rank.</p>';
        html += '</section>';

        html += '<div class="mi-browser-wrap">';
        html += '<input type="text" class="search-input mi-search" id="miSearch" placeholder="Search spells by name or trait to add as a scroll or wand…">';
        html += '<div class="spell-table-wrap mi-browser" id="miBrowser"></div>';
        html += '</div>';

        html += '<div class="mi-shopping" id="miShopping"></div>';

        page.innerHTML = html;
        var search = document.getElementById('miSearch');
        if (search) {
          search.addEventListener('input', function() { MagicItems.renderBrowser(search.value); });
        }
      }
      this.renderBrowser(document.getElementById('miSearch') ? document.getElementById('miSearch').value : '');
      this.renderShopping();
    },

    renderBrowser: function(query) {
      var wrap = document.getElementById('miBrowser');
      if (!wrap) return;
      var all = (window.SPELL_SCHEMA && window.SPELL_SCHEMA.spells) || [];
      var q = (query || '').toLowerCase().trim();
      var results = [];
      for (var i = 0; i < all.length; i++) {
        var s = all[i];
        if (s.era === 'legacy_core') continue; // mirror app default (hide legacy dupes)
        var match;
        if (!q) {
          match = s.mathfinder_reviewed; // default: curated picks
        } else {
          match = s.name.toLowerCase().indexOf(q) !== -1;
          if (!match && s.trait_raw) {
            for (var t = 0; t < s.trait_raw.length; t++) {
              if (s.trait_raw[t].toLowerCase().indexOf(q) !== -1) { match = true; break; }
            }
          }
        }
        if (match) results.push(s);
      }
      results.sort(function(a, b) { return a.name.localeCompare(b.name); });
      var capped = results.slice(0, 100);

      var idMap = [];
      var html = '<table class="spell-table mi-table"><thead><tr>';
      html += '<th>Spell</th><th>Rank</th><th>Tags</th><th>Add</th></tr></thead><tbody>';
      if (capped.length === 0) {
        html += '<tr><td colspan="4" class="mi-empty">' + (q ? 'No spells match “' + escapeHtml(query) + '”.' : 'No curated spells found.') + '</td></tr>';
      }
      for (var r = 0; r < capped.length; r++) {
        var sp = capped[r];
        var key = window.SPELL_SCHEMA.spells.indexOf(sp);
        idMap.push(key);
        html += '<tr>';
        html += '<td class="slot-spell-name">';
        if (sp.mathfinder_reviewed) html += '<span class="mathfinder-star" title="Mathfinder reviewed">★</span>';
        html += escapeHtml(sp.name);
        if (sp.aonId) html += '<a href="' + App.aonUrl(sp.aonId) + '" target="_blank" class="aon-link" title="Open on Archives of Nethys" onclick="event.stopPropagation()">↗</a>';
        html += '</td>';
        html += '<td class="slot-native-rank">' + (sp.native_rank || '') + '</td>';
        html += '<td>' + App.renderTags(sp) + '</td>';
        html += '<td class="mi-add-actions">';
        html += '<button class="mi-add-btn" title="Add as scroll" onclick="MagicItems.addByIndex(' + key + ',\'scroll\')">&#128220;</button>';
        html += '<button class="mi-add-btn" title="Add as wand" onclick="MagicItems.addByIndex(' + key + ',\'wand\')">&#129668;</button>';
        html += '</td>';
        html += '</tr>';
      }
      html += '</tbody></table>';
      if (results.length > capped.length) {
        html += '<div class="mi-cap-note">Showing first ' + capped.length + ' of ' + results.length + ' — refine your search.</div>';
      }
      wrap.innerHTML = html;
    },

    addByIndex: function(schemaIdx, kind) {
      var all = (window.SPELL_SCHEMA && window.SPELL_SCHEMA.spells) || [];
      var sp = all[schemaIdx];
      if (sp) this.add(sp, kind);
    },

    renderShopping: function() {
      var wrap = document.getElementById('miShopping');
      if (!wrap) return;

      if (items.length === 0) {
        wrap.innerHTML = '<div class="mi-empty-list">No planned purchases yet. Search above and add a spell as a scroll or wand.</div>';
        return;
      }

      // Sort a copy by item level (then name) for display; keep original indices for edits.
      var order = items.map(function(it, i) { return i; });
      order.sort(function(a, b) {
        var la = itemLevel(items[a].kind, items[a].chosenRank);
        var lb = itemLevel(items[b].kind, items[b].chosenRank);
        if (la !== lb) return la - lb;
        return items[a].name.localeCompare(items[b].name);
      });

      var runningTotal = 0;
      var html = '<section class="overview-section mi-list-section">';
      html += '<h2 class="section-label">Planned Purchases</h2>';
      html += '<table class="mi-shop-table"><thead><tr>';
      html += '<th></th><th>Spell</th><th>Type</th><th>Rank</th>';
      html += '<th>Item Lvl</th><th>Qty</th><th>Unit</th><th>Total</th>';
      html += '<th>Buy at Lvl <span class="info-bubble" title="The character level you plan to buy this. From this level up, the spell counts toward your Merged-view coverage (wands always; scrolls only with the toggle).">ⓘ</span></th>';
      html += '<th>Price <span class="info-bubble" title="Standard list purchase price (Player Core). Actual cost varies by settlement, region, and GM. Crafting your own can be cheaper if you have downtime and the right feats.">ⓘ</span></th>';
      html += '<th></th></tr></thead><tbody>';

      for (var o = 0; o < order.length; o++) {
        var idx = order[o];
        var it = items[idx];
        var lvl = itemLevel(it.kind, it.chosenRank);
        var unit = unitCost(it.kind, it.chosenRank);
        var lineTotal = unit * it.qty;
        runningTotal += lineTotal;
        var ranks = legalRanks(it, it.kind);

        html += '<tr>';
        html += '<td class="mi-source-cell"><span class="tradition-circle item-' + it.kind + '" title="' + (it.kind === 'wand' ? 'Wand' : 'Scroll') + '">' + (it.kind === 'wand' ? '&#129668;' : '&#128220;') + '</span></td>';
        html += '<td class="slot-spell-name">' + escapeHtml(it.name);
        if (it.aonId) html += '<a href="' + App.aonUrl(it.aonId) + '" target="_blank" class="aon-link" onclick="event.stopPropagation()">↗</a>';
        if (isOffList(it)) {
          html += ' <span class="mi-offlist" title="Spell not on one of your spell lists. Give to another party caster to carry, or consider Trick Magic Item.">&#9888;</span>';
        }
        html += '</td>';
        // kind
        html += '<td><select class="mi-input" onchange="MagicItems.update(' + idx + ',\'kind\',this.value)">';
        html += '<option value="scroll"' + (it.kind === 'scroll' ? ' selected' : '') + '>Scroll</option>';
        html += '<option value="wand"' + (it.kind === 'wand' ? ' selected' : '') + '>Wand</option>';
        html += '</select></td>';
        // rank (legal only)
        html += '<td><select class="mi-input" onchange="MagicItems.update(' + idx + ',\'rank\',this.value)">';
        for (var rk = 0; rk < ranks.length; rk++) {
          html += '<option value="' + ranks[rk] + '"' + (ranks[rk] === it.chosenRank ? ' selected' : '') + '>' + ranks[rk] + '</option>';
        }
        html += '</select></td>';
        html += '<td class="mi-num">' + lvl + '</td>';
        html += '<td><input type="number" min="1" class="mi-input mi-qty" value="' + it.qty + '" onchange="MagicItems.update(' + idx + ',\'qty\',this.value)"></td>';
        html += '<td class="mi-num">' + unit.toLocaleString() + ' gp</td>';
        html += '<td class="mi-num mi-line-total">' + lineTotal.toLocaleString() + ' gp</td>';
        // purchase level
        html += '<td><select class="mi-input" onchange="MagicItems.update(' + idx + ',\'purchaseLevel\',this.value)">';
        for (var pl = 1; pl <= 20; pl++) {
          html += '<option value="' + pl + '"' + (pl === it.purchaseLevel ? ' selected' : '') + '>' + pl + '</option>';
        }
        html += '</select></td>';
        html += '<td class="mi-num">' + characterWealthAt(it.purchaseLevel).toLocaleString() + ' gp</td>';
        html += '<td><button class="slot-delete-btn" title="Remove" onclick="MagicItems.remove(' + idx + ')">✕</button></td>';
        html += '</tr>';
      }
      html += '</tbody>';
      html += '<tfoot><tr class="mi-total-row"><td colspan="7" class="mi-num"><strong>Running total</strong></td>';
      html += '<td class="mi-num"><strong>' + runningTotal.toLocaleString() + ' gp</strong></td><td colspan="3"></td></tr></tfoot>';
      html += '</table>';
      html += '</section>';

      // Budget-by-purchase-level summary (the cash-flow view).
      html += this.renderBudget(order);

      wrap.innerHTML = html;
    },

    renderBudget: function(order) {
      // Distinct purchase levels ascending; cumulative cost vs. expected wealth at that level.
      var levels = this.itemPurchaseLevels().slice().sort(function(a, b) { return a - b; });
      if (levels.length === 0) return '';
      var html = '<section class="overview-section mi-budget-section">';
      html += '<h2 class="section-label">Budget by Purchase Level <span class="info-bubble" title="Rough sanity check. Expected wealth is the cumulative gear+gold a single character is assumed to have by this level (AoN Treasure for New Characters). It is a per-character estimate and varies widely by party size and GM — treat it as a band, not a hard limit.">ⓘ</span></h2>';
      html += '<table class="mi-budget-table"><thead><tr><th>By Level</th><th>Cumulative item cost</th><th>Expected wealth (rough)</th></tr></thead><tbody>';
      for (var i = 0; i < levels.length; i++) {
        var L = levels[i];
        var cumulative = 0;
        for (var j = 0; j < items.length; j++) {
          if (items[j].purchaseLevel <= L) {
            cumulative += unitCost(items[j].kind, items[j].chosenRank) * items[j].qty;
          }
        }
        var wealth = characterWealthAt(L);
        var over = cumulative > wealth;
        html += '<tr class="' + (over ? 'mi-over-budget' : '') + '">';
        html += '<td class="mi-num">' + L + '</td>';
        html += '<td class="mi-num">' + cumulative.toLocaleString() + ' gp</td>';
        html += '<td class="mi-num">~' + wealth.toLocaleString() + ' gp</td>';
        html += '</tr>';
      }
      html += '</tbody></table>';
      html += '</section>';
      return html;
    }
  };

  function escapeHtml(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }
})();
