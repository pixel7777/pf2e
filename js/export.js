// Plan export — markdown generation, clipboard, download, save/load
(function() {
  'use strict';

  var TRADITIONS = ['arcane', 'divine', 'occult', 'primal'];

  function traditionHasData(state, tradition) {
    if (!state[tradition]) return false;
    for (var lv = 1; lv <= 20; lv++) {
      if (!state[tradition][lv]) continue;
      var levelState = state[tradition][lv];
      for (var rank in levelState) {
        for (var i = 0; i < levelState[rank].length; i++) {
          if (levelState[rank][i]) return true;
        }
      }
    }
    return false;
  }

  function generateMarkdownForTradition(state, tradition) {
    var lines = [];
    lines.push('## ' + tradition.charAt(0).toUpperCase() + tradition.slice(1));
    lines.push('');

    for (var lv = 1; lv <= 20; lv++) {
      if (!state[tradition][lv]) continue;
      var levelState = state[tradition][lv];
      var levelHasData = false;

      for (var rank in levelState) {
        for (var i = 0; i < levelState[rank].length; i++) {
          if (levelState[rank][i]) { levelHasData = true; break; }
        }
        if (levelHasData) break;
      }

      if (!levelHasData) continue;

      var maxRank = Math.ceil(lv / 2);
      lines.push('### Level ' + lv + ' (Max Rank ' + maxRank + ')');

      for (var r = maxRank; r >= 1; r--) {
        var slots = levelState[r];
        if (!slots || slots.length === 0) continue;

        var hasSpell = false;
        for (var i = 0; i < slots.length; i++) {
          if (slots[i]) { hasSpell = true; break; }
        }
        if (!hasSpell) continue;

        var tier = App.getTier(lv, r);
        var tierStr = tier === 'top' ? '◆ Top' : tier === 'mid' ? '◇ Mid' : '○ Low';
        lines.push('#### Rank ' + r + ' (' + tierStr + ')');

        for (var i = 0; i < slots.length; i++) {
          var spell = slots[i];
          if (spell) {
            var line = '- **' + spell.name + '**';
            if (spell.heightenedFrom && spell.heightenedFrom > 0) {
              line += ' (H⬆' + r + ')';
            }
            if (spell.save && spell.save !== '—') {
              line += ' [' + spell.save + ']';
            }
            if (spell.aonId) {
              line += ' — [AoN](' + App.aonUrl(spell.aonId) + ')';
            }
            lines.push(line);
          } else {
            lines.push('- _(empty slot)_');
          }
        }
        lines.push('');
      }
    }

    return lines.join('\n');
  }

  function generateAllTraditionsMarkdown() {
    var state = Planner.getState();
    var sections = [];

    for (var i = 0; i < TRADITIONS.length; i++) {
      var t = TRADITIONS[i];
      if (traditionHasData(state, t)) {
        sections.push(generateMarkdownForTradition(state, t));
      }
    }

    var mi = generateMagicItemsMarkdown();
    if (sections.length === 0 && !mi) {
      return '# Spell Plan\n\n_No spells assigned yet._\n';
    }

    var body = sections.join('\n');
    if (mi) body += (body ? '\n' : '') + mi + '\n';
    return '# Spell Plan\n\n' + body;
  }

  function generateMergedMarkdown() {
    var state = Planner.getState();
    var level = Planner.getCurrentLevel('merged');
    if (!level || level <= 0) {
      return '# Merged Spell Plan\n\nNo spells assigned.\n';
    }

    var maxRank = Math.ceil(level / 2);
    var lines = ['# Merged Spell Plan — Level ' + level, ''];
    var hasAnyContent = false;

    for (var r = maxRank; r >= 1; r--) {
      var rankHasSlots = false;
      for (var ti = 0; ti < TRADITIONS.length; ti++) {
        var t = TRADITIONS[ti];
        if (state[t] && state[t][level] && state[t][level][r] && state[t][level][r].length > 0) {
          rankHasSlots = true;
          break;
        }
      }
      if (!rankHasSlots) continue;

      var tier = App.getTier(level, r);
      var tierStr = tier === 'top' ? '◆ Top' : tier === 'mid' ? '◇ Mid' : '○ Low';
      lines.push('## Rank ' + r + ' (' + tierStr + ')');
      lines.push('');

      for (var ti = 0; ti < TRADITIONS.length; ti++) {
        var t = TRADITIONS[ti];
        if (!state[t] || !state[t][level] || !state[t][level][r]) continue;
        var slots = state[t][level][r];
        if (slots.length === 0) continue;

        lines.push('### ' + t.charAt(0).toUpperCase() + t.slice(1));
        for (var i = 0; i < slots.length; i++) {
          var spell = slots[i];
          if (spell) {
            hasAnyContent = true;
            var line = '- **' + spell.name + '**';
            if (spell.heightenedFrom && spell.heightenedFrom > 0) {
              line += ' (H⬆' + r + ')';
            }
            if (spell.save && spell.save !== '—') {
              line += ' [' + spell.save + ']';
            }
            if (spell.aonId) {
              line += ' — [AoN](' + App.aonUrl(spell.aonId) + ')';
            }
            lines.push(line);
          } else {
            lines.push('- _(empty slot)_');
          }
        }
        lines.push('');
      }
    }

    var miMerged = generateMagicItemsMarkdown();
    if (!hasAnyContent && !miMerged) {
      return '# Merged Spell Plan\n\nNo spells assigned.\n';
    }

    var out = lines.join('\n');
    if (miMerged) out += '\n' + miMerged + '\n';
    return out;
  }

  function countSpellsAndTraditions(state) {
    var spellCount = 0;
    var tradCount = 0;
    for (var i = 0; i < TRADITIONS.length; i++) {
      var t = TRADITIONS[i];
      if (!traditionHasData(state, t)) continue;
      tradCount++;
      for (var lv = 1; lv <= 20; lv++) {
        if (!state[t][lv]) continue;
        for (var rank in state[t][lv]) {
          var slots = state[t][lv][rank];
          for (var s = 0; s < slots.length; s++) {
            if (slots[s]) spellCount++;
          }
        }
      }
    }
    return { spells: spellCount, traditions: tradCount };
  }

  function anySpellsAssigned(state) {
    for (var i = 0; i < TRADITIONS.length; i++) {
      if (traditionHasData(state, TRADITIONS[i])) return true;
    }
    return false;
  }

  // ── Cycle 43 — Magic Items shopping list (shared by markdown + CSV) ──

  function getSortedItems() {
    var items = (window.MagicItems && MagicItems.getAll) ? MagicItems.getAll().slice() : [];
    items.sort(function(a, b) {
      var la = MagicItems.itemLevel(a.kind, a.chosenRank);
      var lb = MagicItems.itemLevel(b.kind, b.chosenRank);
      if (la !== lb) return la - lb;
      return a.name.localeCompare(b.name);
    });
    return items;
  }

  function generateMagicItemsMarkdown() {
    if (!window.MagicItems) return '';
    var items = getSortedItems();
    if (!items.length) return '';
    var lines = ['## Magic Items (Shopping List)', ''];
    lines.push('| Type | Spell | Rank | Item Lvl | Qty | Unit (gp) | Total (gp) | Buy at Lvl |');
    lines.push('|---|---|---|---|---|---|---|---|');
    var running = 0;
    for (var i = 0; i < items.length; i++) {
      var it = items[i];
      var unit = MagicItems.unitCost(it.kind, it.chosenRank);
      var total = unit * it.qty;
      running += total;
      lines.push('| ' + (it.kind === 'wand' ? 'Wand' : 'Scroll') + ' | ' + it.name + ' | ' +
        it.chosenRank + ' | ' + MagicItems.itemLevel(it.kind, it.chosenRank) + ' | ' + it.qty +
        ' | ' + unit + ' | ' + total + ' | ' + it.purchaseLevel + ' |');
    }
    lines.push('');
    lines.push('**Running total: ' + running + ' gp**');
    return lines.join('\n');
  }

  function csvCell(v) {
    v = (v === undefined || v === null) ? '' : String(v);
    if (/[",\r\n]/.test(v)) v = '"' + v.replace(/"/g, '""') + '"';
    return v;
  }

  window.Export = {
    copyToClipboard: function() {
      var isMerged = window.App && App.currentTradition() === 'merged';
      var md = isMerged ? generateMergedMarkdown() : generateAllTraditionsMarkdown();
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(md).then(function() {
          App.toast('Plan copied to clipboard!');
        });
      } else {
        var ta = document.createElement('textarea');
        ta.value = md;
        ta.style.position = 'fixed';
        ta.style.left = '-9999px';
        document.body.appendChild(ta);
        ta.select();
        document.execCommand('copy');
        document.body.removeChild(ta);
        App.toast('Plan copied to clipboard!');
      }
    },

    downloadMd: function() {
      var isMerged = window.App && App.currentTradition() === 'merged';
      var md = isMerged ? generateMergedMarkdown() : generateAllTraditionsMarkdown();
      var filename = isMerged ? 'merged-spell-plan.md' : 'spell-plan.md';
      var blob = new Blob([md], { type: 'text/markdown;charset=utf-8' });
      var url = URL.createObjectURL(blob);
      var a = document.createElement('a');
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      App.toast('Downloaded ' + filename);
    },

    downloadCsv: function() {
      var items = getSortedItems();
      var rows = [['Type', 'Spell', 'Rank', 'Item Level', 'Quantity', 'Unit Cost (gp)', 'Line Total (gp)', 'Buy at Level']];
      var running = 0;
      for (var i = 0; i < items.length; i++) {
        var it = items[i];
        var unit = MagicItems.unitCost(it.kind, it.chosenRank);
        var total = unit * it.qty;
        running += total;
        rows.push([it.kind === 'wand' ? 'Wand' : 'Scroll', it.name, it.chosenRank,
          MagicItems.itemLevel(it.kind, it.chosenRank), it.qty, unit, total, it.purchaseLevel]);
      }
      rows.push([]);
      rows.push(['', '', '', '', '', '', 'Running Total', running]);

      var csv = rows.map(function(r) { return r.map(csvCell).join(','); }).join('\r\n');
      var blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
      var url = URL.createObjectURL(blob);
      var a = document.createElement('a');
      a.href = url;
      a.download = 'shopping-list.csv';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      App.toast(items.length ? 'Downloaded shopping-list.csv' : 'Shopping list is empty — exported an empty CSV');
    },

    savePlan: function() {
      var now = new Date();
      var dateStr = now.toISOString().slice(0, 10);

      var saveData = {
        formatVersion: 2,
        appVersion: 'pf2e-spell-planner',
        savedAt: now.toISOString(),
        classes: Planner.getClasses(),
        plan: Planner.getState(),
        magicItems: (window.MagicItems && MagicItems.getAll) ? MagicItems.getAll() : []
      };

      var json = JSON.stringify(saveData, null, 2);
      var blob = new Blob([json], { type: 'application/json;charset=utf-8' });
      var url = URL.createObjectURL(blob);
      var a = document.createElement('a');
      a.href = url;
      a.download = 'spell-plan-' + dateStr + '.json';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);

      var counts = countSpellsAndTraditions(Planner.getState());
      App.toast('Plan saved — ' + counts.spells + ' spells across ' + counts.traditions + ' traditions');
    },

    loadPlan: function() {
      var activePage = document.querySelector('.tradition-page.active');
      var input = activePage
        ? activePage.querySelector('.export-bar input[type="file"]')
        : document.querySelector('.export-bar input[type="file"]');
      if (input) {
        input.value = '';
        input.click();
      }
    },

    handleLoadFile: function(input) {
      var file = input.files[0];
      if (!file) return;

      var reader = new FileReader();
      reader.onload = function(e) {
        var data;
        try {
          data = JSON.parse(e.target.result);
        } catch (err) {
          App.toast("This doesn't look like a Spell Planner save file");
          return;
        }

        if (data.appVersion !== 'pf2e-spell-planner') {
          App.toast("This doesn't look like a Spell Planner save file");
          return;
        }

        if (data.formatVersion !== 1 && data.formatVersion !== 2) {
          App.toast("This save file is from a newer version and can't be loaded");
          return;
        }

        var hasItems = window.MagicItems && MagicItems.getAll && MagicItems.getAll().length > 0;
        if (anySpellsAssigned(Planner.getState()) || hasItems) {
          if (!window.confirm('Loading this plan will replace your current selections. Continue?')) {
            return;
          }
        }

        // Cycle 43 — restore the shopping list (v1 files have none → empty). Set BEFORE
        // Planner.loadPlan so the merged-view rebuild sees the items.
        if (window.MagicItems && MagicItems.setAll) {
          MagicItems.setAll((data.formatVersion >= 2 && Array.isArray(data.magicItems)) ? data.magicItems : []);
        }

        Planner.loadPlan(data.plan, data.classes);

        if (window.App && App.currentTradition && App.currentTradition() === 'magicitems' &&
            window.MagicItems && MagicItems.renderTab) {
          MagicItems.renderTab();
        }

        var counts = countSpellsAndTraditions(Planner.getState());
        App.toast('Plan loaded — ' + counts.spells + ' spells across ' + counts.traditions + ' traditions');
      };
      reader.readAsText(file);
    }
  };
})();
