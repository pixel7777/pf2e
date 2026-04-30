// Coverage tracking sidebar
(function() {
  'use strict';

  var coverageGroups = {
    defense: ['AC', 'Fort', 'Ref', 'Will', 'Auto'],
    targeting: ['ST', 'AoE'],
    damageTypes: ['Fire', 'Cold', 'Elec', 'Force', 'Mental', 'Acid', 'Void', 'Bludg', 'Pierc', 'Varies', 'Untyped'],
    conditions: ['Frightened', 'Slowed', 'Dazzled', 'Blinded', 'Prone', 'Stunned', 'Confused', 'Stupefied', 'Clumsy'],
    reliability: ['Auto-effect', 'Success-effect', 'Incap'],
    actionEconomy: ['1-action', 'Reaction', 'Sustain-action', '3-action'],
    special: ['Coverage', 'Multimodal', 'Silver Bullet', 'Pre-buff']
  };

  var TAG_TO_GROUP = {};
  (function() {
    for (var group in coverageGroups) {
      var tags = coverageGroups[group];
      for (var i = 0; i < tags.length; i++) {
        TAG_TO_GROUP[tags[i]] = group;
      }
    }
  })();

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
    groups: coverageGroups,
    tagToGroup: TAG_TO_GROUP,

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
    },

    getGroupClass: function(tag) {
      var group = TAG_TO_GROUP[tag];
      if (!group) return '';
      var map = {
        defense: 'tag-defense',
        targeting: 'tag-targeting',
        damageTypes: 'tag-damage',
        conditions: 'tag-condition',
        reliability: 'tag-reliability',
        actionEconomy: 'tag-action',
        special: 'tag-special'
      };
      return map[group] || '';
    }
  };
})();
