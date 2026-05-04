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

    if (sections.length === 0) {
      return '# Spell Plan\n\n_No spells assigned yet._\n';
    }

    return '# Spell Plan\n\n' + sections.join('\n');
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

  window.Export = {
    copyToClipboard: function() {
      var md = generateAllTraditionsMarkdown();
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
      var md = generateAllTraditionsMarkdown();
      var blob = new Blob([md], { type: 'text/markdown;charset=utf-8' });
      var url = URL.createObjectURL(blob);
      var a = document.createElement('a');
      a.href = url;
      a.download = 'spell-plan.md';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      App.toast('Downloaded spell-plan.md');
    },

    savePlan: function() {
      var now = new Date();
      var dateStr = now.toISOString().slice(0, 10);

      var saveData = {
        formatVersion: 1,
        appVersion: 'pf2e-spell-planner',
        savedAt: now.toISOString(),
        classes: Planner.getClasses(),
        plan: Planner.getState()
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
      var input = document.querySelector('.export-bar input[type="file"]');
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

        if (data.formatVersion !== 1) {
          App.toast("This save file is from a newer version and can't be loaded");
          return;
        }

        if (anySpellsAssigned(Planner.getState())) {
          if (!window.confirm('Loading this plan will replace your current selections. Continue?')) {
            return;
          }
        }

        Planner.loadPlan(data.plan, data.classes);

        var counts = countSpellsAndTraditions(Planner.getState());
        App.toast('Plan loaded — ' + counts.spells + ' spells across ' + counts.traditions + ' traditions');
      };
      reader.readAsText(file);
    }
  };
})();
