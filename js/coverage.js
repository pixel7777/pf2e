// Coverage tracking sidebar
(function() {
  'use strict';

  var coverageGroups = {
    defense: ['AC', 'Fort', 'Ref', 'Will', 'Auto'],
    damageTypes: ['Fire', 'Cold', 'Elec', 'Force', 'Mental', 'Acid', 'Void', 'Bludg', 'Pierc', 'Varies', 'Untyped'],
    spellTraits: ['Mental-trait'],
    conditions: ['Frightened', 'Slowed', 'Dazzled', 'Blinded', 'Prone', 'Stunned', 'Confused', 'Stupefied', 'Clumsy'],
    reliability: ['Auto-effect', 'Success-effect', 'Incap'],
    actionEconomy: ['1-action', 'Reaction', 'Sustain-action', '3-action'],
    special: ['Coverage', 'Multimodal', 'Silver Bullet', 'Pre-buff']
  };

  function getAssignedTags(tradition, level) {
    var state = Planner.getState();
    if (!state[tradition] || !state[tradition][level]) return {};

    var tags = {};
    var levelState = state[tradition][level];
    for (var rank in levelState) {
      var slots = levelState[rank];
      for (var i = 0; i < slots.length; i++) {
        var spell = slots[i];
        if (!spell || !spell.tags) continue;
        for (var t = 0; t < spell.tags.length; t++) {
          tags[spell.tags[t]] = true;
        }
      }
    }
    return tags;
  }

  window.Coverage = {
    update: function(tradition, level) {
      var activeTags = getAssignedTags(tradition, level);
      var ctags = document.querySelectorAll('.sidebar .ctag');
      for (var i = 0; i < ctags.length; i++) {
        var tag = ctags[i].dataset.tag;
        if (activeTags[tag]) {
          ctags[i].classList.add('lit');
        } else {
          ctags[i].classList.remove('lit');
        }
      }
    }
  };
})();
