// Slot management, level tabs, spell assignment
(function() {
  'use strict';

  // planState[tradition][level][rank] = [ spellObj | null, ... ]
  var planState = {};
  var selectedSlot = null; // { tradition, level, rank, slotIndex }
  var currentLevel = {}; // per tradition
  var currentClass = {}; // per tradition

  function ensureState(tradition) {
    if (planState[tradition]) return;
    planState[tradition] = {};
    currentLevel[tradition] = 0;
    currentClass[tradition] = null;
    for (var lv = 1; lv <= 20; lv++) {
      planState[tradition][lv] = {};
      var maxRank = Math.ceil(lv / 2);
      for (var r = 1; r <= maxRank; r++) {
        planState[tradition][lv][r] = [];
      }
    }
  }

  function getDefaultClass(tradition) {
    if (!window.CLASS_DATA) return null;
    var map = { arcane: 'wizard', divine: 'cleric', primal: 'druid' };
    return map[tradition] || null;
  }

  window.Planner = {
    getState: function() { return planState; },
    getSelectedSlot: function() { return selectedSlot; },
    getCurrentLevel: function(tradition) { return currentLevel[tradition] || 0; },
    getClasses: function() {
      return {
        arcane: currentClass.arcane || null,
        divine: currentClass.divine || null,
        occult: currentClass.occult || null,
        primal: currentClass.primal || null
      };
    },

    loadPlan: function(planData, classData) {
      var traditions = ['arcane', 'divine', 'occult', 'primal'];

      // Step 1: Clear selection and hide browser. Capture active view
      // BEFORE state reset (ensureState resets currentLevel to 0).
      var activeTradition = App.currentTradition ? App.currentTradition() : null;
      var activeLevel = activeTradition ? (currentLevel[activeTradition] || 0) : 0;
      selectedSlot = null;
      if (activeTradition) {
        var browser = document.getElementById('browser-' + activeTradition);
        if (browser) browser.classList.add('browser-hidden');
      }

      // Step 2: Reset planState for all traditions
      for (var i = 0; i < traditions.length; i++) {
        var t = traditions[i];
        planState[t] = null;
        ensureState(t);
      }

      // Step 3: Write loaded spell arrays into planState
      if (planData) {
        for (var i = 0; i < traditions.length; i++) {
          var t = traditions[i];
          if (!planData[t]) continue;
          for (var lv = 1; lv <= 20; lv++) {
            if (!planData[t][lv]) continue;
            for (var rank in planData[t][lv]) {
              var r = parseInt(rank);
              if (!planState[t][lv][r]) planState[t][lv][r] = [];
              var slots = planData[t][lv][rank];
              for (var s = 0; s < slots.length; s++) {
                planState[t][lv][r][s] = slots[s];
              }
            }
          }
        }
      }

      // Step 4: Set currentClass from classData
      if (classData) {
        for (var i = 0; i < traditions.length; i++) {
          var t = traditions[i];
          currentClass[t] = classData[t] || null;
        }
      }

      // Step 5: Init traditions that have data + set class selector
      for (var i = 0; i < traditions.length; i++) {
        var t = traditions[i];
        var tabBar = document.getElementById('levelTabBar-' + t);
        if (tabBar && tabBar.children.length <= 1) {
          this.initTradition(t);
        }
        var classSelect = document.getElementById('classSelect-' + t);
        if (classSelect && currentClass[t]) {
          classSelect.value = currentClass[t];
        } else if (classSelect) {
          classSelect.value = '';
        }
      }

      // Step 6: Update level tab indicators
      for (var i = 0; i < traditions.length; i++) {
        this.updateLevelTabIndicators(traditions[i]);
      }

      // Step 7: Re-render current view
      if (activeTradition && activeLevel > 0) {
        this.selectLevel(activeTradition, activeLevel);
      }
    },

    initTradition: function(tradition) {
      ensureState(tradition);

      var tabBar = document.getElementById('levelTabBar-' + tradition);
      var panels = document.getElementById('levelPanels-' + tradition);
      if (!tabBar || tabBar.children.length > 1) return;

      // Set default class
      if (!currentClass[tradition]) {
        currentClass[tradition] = getDefaultClass(tradition);
      }

      // Build class selector
      var classSelect = document.getElementById('classSelect-' + tradition);
      if (classSelect && window.CLASS_DATA) {
        classSelect.innerHTML = '<option value="">Manual (custom slots)</option>';
        var keys = Object.keys(window.CLASS_DATA);
        for (var i = 0; i < keys.length; i++) {
          var cls = window.CLASS_DATA[keys[i]];
          var trad = cls.tradition;
          if (trad === tradition || trad === 'varies') {
            var opt = document.createElement('option');
            opt.value = keys[i];
            opt.textContent = cls.name;
            if (keys[i] === currentClass[tradition]) opt.selected = true;
            classSelect.appendChild(opt);
          }
        }
        classSelect.onchange = function() {
          var previousValue = currentClass[tradition];
          var newValue = this.value || null;

          var hasSpells = false;
          for (var lv = 1; lv <= 20; lv++) {
            if (!planState[tradition][lv]) continue;
            for (var r in planState[tradition][lv]) {
              for (var s = 0; s < planState[tradition][lv][r].length; s++) {
                if (planState[tradition][lv][r][s]) { hasSpells = true; break; }
              }
              if (hasSpells) break;
            }
            if (hasSpells) break;
          }

          if (hasSpells) {
            var tradLabel = tradition.charAt(0).toUpperCase() + tradition.slice(1);
            if (!window.confirm('Changing class will clear all spell selections for ' + tradLabel + '. This affects all 20 levels. Continue?')) {
              classSelect.value = previousValue || '';
              return;
            }
            for (var lv = 1; lv <= 20; lv++) {
              if (!planState[tradition][lv]) continue;
              for (var r in planState[tradition][lv]) {
                for (var s = 0; s < planState[tradition][lv][r].length; s++) {
                  planState[tradition][lv][r][s] = null;
                }
              }
            }
            if (!newValue) {
              for (var lv = 1; lv <= 20; lv++) {
                if (!planState[tradition][lv]) continue;
                for (var r in planState[tradition][lv]) {
                  planState[tradition][lv][r] = [];
                }
              }
            }
          }

          currentClass[tradition] = newValue;

          selectedSlot = null;
          var browser = document.getElementById('browser-' + tradition);
          if (browser) browser.classList.add('browser-hidden');

          var lv = currentLevel[tradition];
          if (lv > 0) {
            Planner.rebuildSlotsForClass(tradition, lv);
            Planner.renderSlots(tradition, lv);
            Coverage.update(tradition, lv);
            Planner.updateLevelTabIndicators(tradition);
          } else {
            Planner.updateLevelTabIndicators(tradition);
          }

          var className = newValue && window.CLASS_DATA[newValue] ? window.CLASS_DATA[newValue].name : 'Manual';
          var msg = 'Changed to ' + className;
          if (hasSpells) msg += ' — cleared all spell selections';
          App.toast(msg);
        };
      }

      // Build level tabs and panels
      for (var lv = 1; lv <= 20; lv++) {
        var btn = document.createElement('button');
        btn.className = 'level-tab';
        btn.dataset.level = lv;
        btn.dataset.tradition = tradition;
        btn.textContent = 'Lv ' + lv;
        (function(t, l) {
          btn.onclick = function() { Planner.selectLevel(t, l); };
        })(tradition, lv);
        tabBar.appendChild(btn);

        var panel = document.createElement('div');
        panel.id = 'panel-' + tradition + '-' + lv;
        panel.className = 'level-panel';
        panel.style.display = 'none';
        panels.appendChild(panel);
      }
    },

    selectLevel: function(tradition, level) {
      ensureState(tradition);
      currentLevel[tradition] = level;

      // Update tab active states
      var tabs = document.querySelectorAll('#levelTabBar-' + tradition + ' .level-tab');
      for (var i = 0; i < tabs.length; i++) {
        tabs[i].classList.remove('active');
        if (parseInt(tabs[i].dataset.level) === level) tabs[i].classList.add('active');
      }

      // Also deactivate overview tab
      var overviewTab = document.querySelector('#levelTabBar-' + tradition + ' .level-tab[data-level="0"]');
      if (overviewTab) overviewTab.classList.remove('active');

      // Hide overview, show level panel
      var overview = document.getElementById('overview-' + tradition);
      if (overview) overview.style.display = 'none';

      var panels = document.querySelectorAll('#levelPanels-' + tradition + ' .level-panel');
      for (var i = 0; i < panels.length; i++) {
        panels[i].style.display = 'none';
      }

      var panel = document.getElementById('panel-' + tradition + '-' + level);
      if (panel) {
        panel.style.display = 'block';
        this.buildLevelPanel(tradition, level, panel);
      }

      // Auto-populate slots from class data
      this.autoPopulateSlots(tradition, level);
      this.renderSlots(tradition, level);
      Coverage.update(tradition, level);
    },

    showOverview: function(tradition) {
      currentLevel[tradition] = 0;
      var overview = document.getElementById('overview-' + tradition);
      if (overview) overview.style.display = 'block';

      var panels = document.querySelectorAll('#levelPanels-' + tradition + ' .level-panel');
      for (var i = 0; i < panels.length; i++) {
        panels[i].style.display = 'none';
      }

      var tabs = document.querySelectorAll('#levelTabBar-' + tradition + ' .level-tab');
      for (var i = 0; i < tabs.length; i++) {
        tabs[i].classList.remove('active');
        if (tabs[i].dataset.level === '0') tabs[i].classList.add('active');
      }

      // Hide browser
      var browser = document.getElementById('browser-' + tradition);
      if (browser) browser.classList.add('browser-hidden');
    },

    buildLevelPanel: function(tradition, level, panel) {
      if (panel.dataset.built) return;
      panel.dataset.built = 'true';

      var maxRank = Math.ceil(level / 2);
      var disabledAttr = level === 1 ? ' disabled title="No previous level."' : '';
      var disabledStyle = level === 1 ? ' style="opacity:0.4"' : '';
      var html = '<div class="level-actions">';
      html += '<button class="level-action-btn"' + disabledAttr + disabledStyle + ' onclick="Planner.copyPrevious(\'' + tradition + '\',' + level + ')">⬆ Copy Previous</button>';
      html += '<button class="level-action-btn" onclick="Planner.clearAllSpells(\'' + tradition + '\',' + level + ')">⊘ Clear All</button>';
      html += '<button class="level-action-btn" onclick="Planner.deleteAllSlots(\'' + tradition + '\',' + level + ')">🗑 Delete All</button>';
      html += '</div>';
      html += '<div class="rank-rows" id="rank-rows-' + tradition + '-' + level + '">';

      for (var r = maxRank; r >= 1; r--) {
        var tier = App.getTier(level, r);
        html += '<div class="rank-row" id="rank-row-' + tradition + '-' + level + '-' + r + '">';
        html += '<div class="rank-row-header">';
        html += '<span class="rank-label">Rank ' + r + '</span>';
        html += '<span class="tier-badge ' + tier + '">' + App.tierLabel(tier) + '</span>';
        html += '<button class="add-slot-btn" onclick="Planner.addSlot(\'' + tradition + '\',' + level + ',' + r + ')">+ Add Slot</button>';
        html += '</div>';
        html += '<div class="slots-container" id="slots-' + tradition + '-' + level + '-' + r + '"></div>';
        html += '</div>';
      }

      html += '</div>';
      panel.innerHTML = html;
    },

    autoPopulateSlots: function(tradition, level) {
      var cls = currentClass[tradition];
      if (!cls || !window.CLASS_DATA || !window.CLASS_DATA[cls]) return;

      var classData = window.CLASS_DATA[cls];
      var slots = classData.slots[level];
      if (!slots) return;

      var state = planState[tradition][level];
      var maxRank = Math.ceil(level / 2);

      for (var r = 1; r <= maxRank; r++) {
        var needed = slots[r] || 0;
        var current = state[r].length;
        if (current < needed) {
          for (var i = current; i < needed; i++) {
            state[r].push(null);
          }
        }
      }
    },

    addSlot: function(tradition, level, rank) {
      ensureState(tradition);
      planState[tradition][level][rank].push(null);
      this.renderSlots(tradition, level);
      var newIdx = planState[tradition][level][rank].length - 1;
      this.selectSlotUI(tradition, level, rank, newIdx);
    },

    selectSlotUI: function(tradition, level, rank, slotIndex) {
      selectedSlot = { tradition: tradition, level: level, rank: rank, slotIndex: slotIndex };
      this.renderSlots(tradition, level);
      Browser.show(tradition, level, rank);
    },

    clearSpell: function(tradition, level, rank, slotIndex, e) {
      if (e) e.stopPropagation();
      planState[tradition][level][rank][slotIndex] = null;
      this.renderSlots(tradition, level);
      Coverage.update(tradition, level);
      this.updateLevelTabIndicators(tradition);
    },

    deleteSlot: function(tradition, level, rank, slotIndex, e) {
      if (e) e.stopPropagation();
      if (selectedSlot && selectedSlot.tradition === tradition && selectedSlot.level === level && selectedSlot.rank === rank) {
        if (selectedSlot.slotIndex === slotIndex) {
          selectedSlot = null;
        } else if (selectedSlot.slotIndex > slotIndex) {
          selectedSlot.slotIndex--;
        }
      }
      planState[tradition][level][rank].splice(slotIndex, 1);
      if (!selectedSlot) {
        var browser = document.getElementById('browser-' + tradition);
        if (browser) browser.classList.add('browser-hidden');
      }
      this.renderSlots(tradition, level);
      Coverage.update(tradition, level);
      this.updateLevelTabIndicators(tradition);
    },

    clearAllSpells: function(tradition, level) {
      var state = planState[tradition][level];
      var hasSpell = false;
      for (var r in state) {
        for (var s = 0; s < state[r].length; s++) {
          if (state[r][s]) { hasSpell = true; break; }
        }
        if (hasSpell) break;
      }
      if (!hasSpell) { App.toast('No spells to clear'); return; }
      for (var r in state) {
        for (var s = 0; s < state[r].length; s++) {
          state[r][s] = null;
        }
      }
      selectedSlot = null;
      var browser = document.getElementById('browser-' + tradition);
      if (browser) browser.classList.add('browser-hidden');
      this.renderSlots(tradition, level);
      Coverage.update(tradition, level);
      this.updateLevelTabIndicators(tradition);
    },

    deleteAllSlots: function(tradition, level) {
      var state = planState[tradition][level];
      var hasSlots = false;
      for (var r in state) {
        if (state[r].length > 0) { hasSlots = true; break; }
      }
      if (!hasSlots) { App.toast('No slots to delete'); return; }
      if (!window.confirm('Delete all slots at Level ' + level + '? This removes all slots and any assigned spells.')) return;
      for (var r in state) {
        state[r] = [];
      }
      selectedSlot = null;
      var browser = document.getElementById('browser-' + tradition);
      if (browser) browser.classList.add('browser-hidden');
      this.renderSlots(tradition, level);
      Coverage.update(tradition, level);
      this.updateLevelTabIndicators(tradition);
    },

    copyPrevious: function(tradition, level) {
      if (level <= 1) { App.toast('No previous level to copy from'); return; }
      var prevLevel = level - 1;
      var prevState = planState[tradition][prevLevel];
      var curState = planState[tradition][level];
      if (!prevState) { App.toast('Previous level has no spells to copy'); return; }

      var hasSpells = false;
      for (var r in prevState) {
        for (var s = 0; s < prevState[r].length; s++) {
          if (prevState[r][s]) { hasSpells = true; break; }
        }
        if (hasSpells) break;
      }
      if (!hasSpells) { App.toast('Previous level has no spells to copy'); return; }

      var prevMaxRank = Math.ceil(prevLevel / 2);
      var curMaxRank = Math.ceil(level / 2);
      var minMaxRank = Math.min(prevMaxRank, curMaxRank);

      var overwriteCount = 0;
      for (var r = 1; r <= minMaxRank; r++) {
        if (!prevState[r]) continue;
        for (var i = 0; i < prevState[r].length; i++) {
          if (prevState[r][i] && curState[r] && i < curState[r].length && curState[r][i]) {
            overwriteCount++;
          }
        }
      }

      if (overwriteCount > 0) {
        if (!window.confirm('Copy will overwrite ' + overwriteCount + ' spell(s) at this level. Continue?')) return;
      }

      var copiedCount = 0;
      for (var r = 1; r <= minMaxRank; r++) {
        if (!prevState[r]) continue;
        if (!curState[r]) curState[r] = [];
        for (var i = 0; i < prevState[r].length; i++) {
          if (prevState[r][i]) {
            while (curState[r].length < i + 1) {
              curState[r].push(null);
            }
            curState[r][i] = JSON.parse(JSON.stringify(prevState[r][i]));
            copiedCount++;
          }
        }
      }

      this.renderSlots(tradition, level);
      Coverage.update(tradition, level);
      this.updateLevelTabIndicators(tradition);
      App.toast('Copied ' + copiedCount + ' spell(s) from Level ' + prevLevel);
    },

    rebuildSlotsForClass: function(tradition, level) {
      var cls = currentClass[tradition];
      if (!cls || !window.CLASS_DATA || !window.CLASS_DATA[cls]) return;
      var classSlots = window.CLASS_DATA[cls].slots[level];
      if (!classSlots) return;
      var state = planState[tradition][level];
      var maxRank = Math.ceil(level / 2);
      for (var r = 1; r <= maxRank; r++) {
        var target = classSlots[r] || 0;
        if (!state[r]) state[r] = [];
        if (target === 0) {
          state[r] = [];
        } else if (state[r].length < target) {
          while (state[r].length < target) state[r].push(null);
        } else if (state[r].length > target) {
          state[r].length = target;
        }
      }
    },

    assignSpell: function(tradition, spellObj) {
      if (!selectedSlot || selectedSlot.tradition !== tradition) return;
      var s = selectedSlot;
      planState[s.tradition][s.level][s.rank][s.slotIndex] = spellObj;
      this.renderSlots(s.tradition, s.level);
      Coverage.update(s.tradition, s.level);
      this.updateLevelTabIndicators(s.tradition);
      App.toast('Assigned: ' + spellObj.name);
    },

    renderSlots: function(tradition, level) {
      var maxRank = Math.ceil(level / 2);
      for (var r = maxRank; r >= 1; r--) {
        var container = document.getElementById('slots-' + tradition + '-' + level + '-' + r);
        if (!container) continue;
        var slots = planState[tradition][level][r];
        if (!slots || slots.length === 0) {
          container.innerHTML = '';
          continue;
        }
        var html = '<table class="slot-table"><tbody>';
        for (var idx = 0; idx < slots.length; idx++) {
          var spell = slots[idx];
          var isSel = selectedSlot && selectedSlot.tradition === tradition && selectedSlot.level === level && selectedSlot.rank === r && selectedSlot.slotIndex === idx;
          var selClass = isSel ? ' selected' : '';

          html += '<tr class="' + selClass + '" onclick="Planner.selectSlotUI(\'' + tradition + '\',' + level + ',' + r + ',' + idx + ')">';
          if (spell) {
            html += '<td class="slot-spell-name">' + spell.name;
            if (spell.aonId) {
              html += '<a href="' + App.aonUrl(spell.aonId) + '" target="_blank" class="aon-link" title="Open on Archives of Nethys" onclick="event.stopPropagation()">↗</a>';
            }
            html += '</td>';
            html += '<td class="slot-action">' + App.formatActions(spell.action_tags) + '</td>';
            html += '<td>' + App.renderTags(spell) + '</td>';
            html += '<td class="slot-actions">';
            html += '<button class="slot-clear-btn" onclick="Planner.clearSpell(\'' + tradition + '\',' + level + ',' + r + ',' + idx + ',event)" title="Clear spell (keep slot)">⊘</button>';
            html += '<button class="slot-delete-btn" onclick="Planner.deleteSlot(\'' + tradition + '\',' + level + ',' + r + ',' + idx + ',event)" title="Delete slot">🗑</button>';
            html += '</td>';
          } else {
            html += '<td colspan="3" class="slot-empty">Empty slot — click to browse spells</td>';
            html += '<td class="slot-actions">';
            html += '<button class="slot-delete-btn" onclick="Planner.deleteSlot(\'' + tradition + '\',' + level + ',' + r + ',' + idx + ',event)" title="Delete slot">🗑</button>';
            html += '</td>';
          }
          html += '</tr>';
        }
        html += '</tbody></table>';
        container.innerHTML = html;
      }
    },

    updateLevelTabIndicators: function(tradition) {
      var tabs = document.querySelectorAll('#levelTabBar-' + tradition + ' .level-tab');
      for (var i = 0; i < tabs.length; i++) {
        var lv = parseInt(tabs[i].dataset.level);
        if (!lv || !planState[tradition] || !planState[tradition][lv]) continue;
        var hasData = false;
        var state = planState[tradition][lv];
        for (var r in state) {
          for (var s = 0; s < state[r].length; s++) {
            if (state[r][s]) { hasData = true; break; }
          }
          if (hasData) break;
        }
        if (hasData) {
          tabs[i].classList.add('has-data');
        } else {
          tabs[i].classList.remove('has-data');
        }
      }
    }
  };
})();
