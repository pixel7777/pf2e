// Plan export — markdown generation, clipboard, download
(function() {
  'use strict';

  function generateMarkdown(tradition) {
    var state = Planner.getState();
    if (!state[tradition]) return '';

    var lines = [];
    lines.push('# ' + tradition.charAt(0).toUpperCase() + tradition.slice(1) + ' Spell Plan');
    lines.push('');

    var hasAny = false;

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
      hasAny = true;

      var maxRank = Math.ceil(lv / 2);
      lines.push('## Level ' + lv + ' (Max Rank ' + maxRank + ')');
      lines.push('');

      for (var r = maxRank; r >= 1; r--) {
        var slots = levelState[r];
        if (!slots || slots.length === 0) continue;

        var tier = App.getTier(lv, r);
        var tierStr = tier === 'top' ? '◆ Top' : tier === 'mid' ? '◇ Mid' : '○ Low';
        lines.push('### Rank ' + r + ' (' + tierStr + ')');

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

    if (!hasAny) {
      lines.push('_No spells assigned yet._');
    }

    return lines.join('\n');
  }

  window.Export = {
    copyToClipboard: function(tradition) {
      var md = generateMarkdown(tradition);
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(md).then(function() {
          App.toast('Plan copied to clipboard!');
        });
      } else {
        // Fallback
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

    downloadMd: function(tradition) {
      var md = generateMarkdown(tradition);
      var blob = new Blob([md], { type: 'text/markdown;charset=utf-8' });
      var url = URL.createObjectURL(blob);
      var a = document.createElement('a');
      a.href = url;
      a.download = tradition + '-spell-plan.md';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      App.toast('Downloaded ' + tradition + '-spell-plan.md');
    }
  };
})();
