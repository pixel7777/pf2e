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
      if (activeTradition === 'merged') {
        if (this.buildMergedView) this.buildMergedView();
      } else if (activeTradition && activeLevel > 0) {
        this.selectLevel(activeTradition, activeLevel);
      }
    },

    initTradition: function(tradition) {
      ensureState(tradition);

      var tabBar = document.getElementById('levelTabBar-' + tradition);
      var panels = document.getElementById('levelPanels-' + tradition);
      if (!tabBar || tabBar.children.length > 1) return;

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
      var cls = currentClass[tradition];
      if (cls && window.CLASS_DATA && window.CLASS_DATA[cls]) {
        var classSlots = window.CLASS_DATA[cls].slots[level];
        if (!classSlots || !classSlots[rank]) {
          App.toast("This class doesn't have rank " + rank + " slots at this level");
          return;
        }
      }
      planState[tradition][level][rank].push(null);
      this.renderSlots(tradition, level);
      var newIdx = planState[tradition][level][rank].length - 1;
      this.selectSlotUI(tradition, level, rank, newIdx);
    },

    selectSlotUI: function(tradition, level, rank, slotIndex) {
      selectedSlot = { tradition: tradition, level: level, rank: rank, slotIndex: slotIndex };
      this.renderSlots(tradition, level);
      Browser.show(tradition, level, rank);

      var browserEl = document.getElementById('browser-' + tradition);
      if (browserEl) {
        var rect = browserEl.getBoundingClientRect();
        if (rect.top > window.innerHeight) {
          browserEl.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }
      }
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

      var cls = currentClass[tradition];
      var classSlots = null;
      if (cls && window.CLASS_DATA && window.CLASS_DATA[cls]) {
        classSlots = window.CLASS_DATA[cls].slots[level];
      }

      var overwriteCount = 0;
      for (var r = 1; r <= minMaxRank; r++) {
        if (classSlots && !classSlots[r]) continue;
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
      var skippedCount = 0;
      for (var r = 1; r <= minMaxRank; r++) {
        if (!prevState[r]) continue;
        if (classSlots && !classSlots[r]) {
          for (var i = 0; i < prevState[r].length; i++) {
            if (prevState[r][i]) skippedCount++;
          }
          continue;
        }
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
      var msg = 'Copied ' + copiedCount + ' spell(s) from Level ' + prevLevel;
      if (skippedCount > 0) msg += ' (' + skippedCount + ' skipped — rank not available)';
      App.toast(msg);
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
      var cls = currentClass[tradition];
      var classSlots = null;
      if (cls && window.CLASS_DATA && window.CLASS_DATA[cls]) {
        classSlots = window.CLASS_DATA[cls].slots[level];
      }

      for (var r = maxRank; r >= 1; r--) {
        var rankRow = document.getElementById('rank-row-' + tradition + '-' + level + '-' + r);
        if (rankRow) {
          if (classSlots && !classSlots[r]) {
            rankRow.classList.add('rank-row-hidden');
          } else {
            rankRow.classList.remove('rank-row-hidden');
          }
        }

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
            html += '<td class="slot-spell-name">';
            if (spell.mathfinder_reviewed) {
              html += '<span class="mathfinder-star" style="cursor:default;" title="Mathfinder reviewed">★</span>';
            }
            html += spell.name;
            if (spell.aonId) {
              html += '<a href="' + App.aonUrl(spell.aonId) + '" target="_blank" class="aon-link" title="Open on Archives of Nethys" onclick="event.stopPropagation()">↗</a>';
            }
            html += '</td>';
            html += '<td class="slot-native-rank">' + (spell.native_rank || '') + '</td>';
            html += '<td class="slot-action">' + App.formatActions(spell.action_tags) + '</td>';
            html += '<td>' + App.renderTags(spell) + '</td>';
            html += '<td class="spell-notes">' + App.renderNotes(spell) + '</td>';
            html += '<td class="slot-actions">';
            html += '<button class="slot-clear-btn" onclick="Planner.clearSpell(\'' + tradition + '\',' + level + ',' + r + ',' + idx + ',event)" title="Clear spell (keep slot)">⊘</button>';
            html += '<button class="slot-delete-btn" onclick="Planner.deleteSlot(\'' + tradition + '\',' + level + ',' + r + ',' + idx + ',event)" title="Delete slot">🗑</button>';
            html += '</td>';
          } else {
            html += '<td colspan="5" class="slot-empty">Empty slot — click to browse spells</td>';
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
    },

    // ── Merged Spell List (Cycle 36) ──

    buildMergedView: function(selectedLevel) {
      var traditions = ['arcane', 'divine', 'occult', 'primal'];
      var TRAD_INITIALS = { arcane: 'A', divine: 'D', occult: 'O', primal: 'P' };
      var TRAD_LABELS = { arcane: 'Arcane', divine: 'Divine', occult: 'Occult', primal: 'Primal' };

      // Find all levels with at least one spell across any tradition
      var populatedLevels = [];
      for (var lv = 1; lv <= 20; lv++) {
        var hasSpell = false;
        for (var ti = 0; ti < traditions.length; ti++) {
          var t = traditions[ti];
          if (!planState[t] || !planState[t][lv]) continue;
          var ls = planState[t][lv];
          for (var r in ls) {
            for (var s = 0; s < ls[r].length; s++) {
              if (ls[r][s]) { hasSpell = true; break; }
            }
            if (hasSpell) break;
          }
          if (hasSpell) break;
        }
        if (hasSpell) populatedLevels.push(lv);
      }

      // Cycle 43 — levels that exist purely from planned item purchases also get a tab.
      var itemPLevels = (window.MagicItems && MagicItems.itemPurchaseLevels) ? MagicItems.itemPurchaseLevels() : [];
      for (var ip = 0; ip < itemPLevels.length; ip++) {
        if (populatedLevels.indexOf(itemPLevels[ip]) === -1) populatedLevels.push(itemPLevels[ip]);
      }
      populatedLevels.sort(function(a, b) { return a - b; });

      var emptyMsg = document.getElementById('merged-empty-msg');
      var tabBar = document.getElementById('levelTabBar-merged');
      var panels = document.getElementById('levelPanels-merged');
      var legend = document.getElementById('merged-legend');

      // Cycle 43 — show the view-only "count scrolls" toggle whenever any item exists.
      var scrollToggle = document.getElementById('merged-scroll-toggle');
      var anyItems = !!(window.MagicItems && MagicItems.getAll().length > 0);
      if (scrollToggle) {
        scrollToggle.style.display = anyItems ? '' : 'none';
        var scrollCb = document.getElementById('mergedScrollCoverage');
        if (scrollCb) scrollCb.checked = anyItems && MagicItems.getIncludeScrolls();
      }

      if (populatedLevels.length === 0) {
        if (emptyMsg) emptyMsg.style.display = '';
        if (tabBar) tabBar.innerHTML = '';
        if (panels) panels.innerHTML = '';
        if (legend) legend.innerHTML = '';
        currentLevel['merged'] = 0;
        return;
      }
      if (emptyMsg) emptyMsg.style.display = 'none';

      // Determine which level to select
      var level = selectedLevel || currentLevel['merged'] || 0;
      if (populatedLevels.indexOf(level) === -1) {
        level = populatedLevels[0];
      }
      currentLevel['merged'] = level;

      // Build level tabs
      var tabHtml = '';
      for (var i = 0; i < populatedLevels.length; i++) {
        var lv = populatedLevels[i];
        var activeClass = (lv === level) ? ' active' : '';
        tabHtml += '<button class="level-tab' + activeClass + '" data-level="' + lv + '" data-tradition="merged" onclick="Planner.selectMergedLevel(' + lv + ')">Lv ' + lv + '</button>';
      }
      tabBar.innerHTML = tabHtml;

      // Build legend — traditions with spells at this level
      var legendHtml = '';
      for (var ti = 0; ti < traditions.length; ti++) {
        var t = traditions[ti];
        if (!planState[t] || !planState[t][level]) continue;
        var tradHasSpell = false;
        var ls = planState[t][level];
        for (var r in ls) {
          for (var s = 0; s < ls[r].length; s++) {
            if (ls[r][s]) { tradHasSpell = true; break; }
          }
          if (tradHasSpell) break;
        }
        if (tradHasSpell) {
          legendHtml += '<div class="merged-legend-item">';
          legendHtml += '<span class="tradition-circle ' + t + '">' + TRAD_INITIALS[t] + '</span>';
          legendHtml += '<span>' + TRAD_LABELS[t] + '</span>';
          legendHtml += '</div>';
        }
      }
      // Cycle 43 — item sources in the legend, sorted after the traditions.
      var legendItems = (window.MagicItems && MagicItems.displayItemsForLevel) ? MagicItems.displayItemsForLevel(level) : [];
      var legHasScroll = false, legHasWand = false;
      for (var li = 0; li < legendItems.length; li++) {
        if (legendItems[li].kind === 'wand') { legHasWand = true; } else { legHasScroll = true; }
      }
      if (legHasScroll) legendHtml += '<div class="merged-legend-item"><span class="tradition-circle item-scroll">&#128220;</span><span>Scroll</span></div>';
      if (legHasWand) legendHtml += '<div class="merged-legend-item"><span class="tradition-circle item-wand">&#129668;</span><span>Wand</span></div>';
      legend.innerHTML = legendHtml;

      // Build slot display: grouped by rank (descending), traditions first, then planned items (Cycle 43)
      var maxRank = Math.ceil(level / 2);
      var itemsHere = (window.MagicItems && MagicItems.displayItemsForLevel) ? MagicItems.displayItemsForLevel(level) : [];
      var topRank = maxRank;
      for (var ih = 0; ih < itemsHere.length; ih++) {
        if (itemsHere[ih].chosenRank > topRank) topRank = itemsHere[ih].chosenRank;
      }
      var panelHtml = '';

      for (var r = topRank; r >= 1; r--) {
        var withinPrep = r <= maxRank;

        // Tradition slots at this rank (only within preparation max rank)
        var rankHasSlots = false;
        if (withinPrep) {
          for (var ti = 0; ti < traditions.length; ti++) {
            var t = traditions[ti];
            if (planState[t] && planState[t][level] && planState[t][level][r] && planState[t][level][r].length > 0) {
              rankHasSlots = true;
              break;
            }
          }
        }

        // Planned scroll/wand items at this rank
        var itemsAtRank = [];
        for (var ir = 0; ir < itemsHere.length; ir++) {
          if (itemsHere[ir].chosenRank === r) itemsAtRank.push(itemsHere[ir]);
        }

        if (!rankHasSlots && itemsAtRank.length === 0) continue;

        panelHtml += '<div class="merged-rank-header">';
        panelHtml += '<span class="rank-label">Rank ' + r + '</span>';
        if (withinPrep) {
          var tier = App.getTier(level, r);
          panelHtml += '<span class="tier-badge ' + tier + '">' + App.tierLabel(tier) + '</span>';
        }
        panelHtml += '</div>';

        if (rankHasSlots) {
          for (var ti = 0; ti < traditions.length; ti++) {
            var t = traditions[ti];
            if (!planState[t] || !planState[t][level] || !planState[t][level][r]) continue;
            var slots = planState[t][level][r];
            if (slots.length === 0) continue;

            panelHtml += '<table class="merged-slot-table"><tbody>';
            for (var idx = 0; idx < slots.length; idx++) {
              var spell = slots[idx];
              panelHtml += '<tr>';
              panelHtml += '<td class="slot-tradition-badge"><span class="tradition-circle ' + t + '">' + TRAD_INITIALS[t] + '</span></td>';
              if (spell) {
                panelHtml += '<td class="slot-spell-name">';
                if (spell.mathfinder_reviewed) {
                  panelHtml += '<span class="mathfinder-star" style="cursor:default;" title="Mathfinder reviewed">★</span>';
                }
                panelHtml += spell.name;
                if (spell.aonId) {
                  panelHtml += '<a href="' + App.aonUrl(spell.aonId) + '" target="_blank" class="aon-link" title="Open on Archives of Nethys" onclick="event.stopPropagation()">↗</a>';
                }
                panelHtml += '</td>';
                panelHtml += '<td class="slot-native-rank">' + (spell.native_rank || '') + '</td>';
                panelHtml += '<td class="slot-action">' + App.formatActions(spell.action_tags) + '</td>';
                panelHtml += '<td>' + App.renderTags(spell) + '</td>';
                panelHtml += '<td class="spell-notes">' + App.renderNotes(spell) + '</td>';
              } else {
                panelHtml += '<td colspan="5" class="slot-empty">_(empty slot)_</td>';
              }
              panelHtml += '</tr>';
            }
            panelHtml += '</tbody></table>';
          }
        }

        if (itemsAtRank.length > 0) {
          panelHtml += '<table class="merged-slot-table merged-item-table"><tbody>';
          for (var im = 0; im < itemsAtRank.length; im++) {
            var it = itemsAtRank[im];
            var glyph = it.kind === 'wand' ? '&#129668;' : '&#128220;';
            panelHtml += '<tr>';
            panelHtml += '<td class="slot-tradition-badge"><span class="tradition-circle item-' + it.kind + '" title="' + (it.kind === 'wand' ? 'Wand' : 'Scroll') + '">' + glyph + '</span></td>';
            panelHtml += '<td class="slot-spell-name">';
            if (it.mathfinder_reviewed) {
              panelHtml += '<span class="mathfinder-star" style="cursor:default;" title="Mathfinder reviewed">★</span>';
            }
            panelHtml += it.name;
            if (it.aonId) {
              panelHtml += '<a href="' + App.aonUrl(it.aonId) + '" target="_blank" class="aon-link" title="Open on Archives of Nethys" onclick="event.stopPropagation()">↗</a>';
            }
            panelHtml += ' <span class="mi-kind-note">(' + (it.kind === 'wand' ? 'wand' : 'scroll') + ')</span>';
            panelHtml += '</td>';
            panelHtml += '<td class="slot-native-rank">' + it.chosenRank + '</td>';
            panelHtml += '<td class="slot-action">' + App.formatActions(it.action_tags) + '</td>';
            panelHtml += '<td>' + App.renderTags(it) + '</td>';
            panelHtml += '<td class="spell-notes"></td>';
            panelHtml += '</tr>';
          }
          panelHtml += '</tbody></table>';
        }
      }

      panels.innerHTML = panelHtml;

      // Update coverage for merged view
      if (window.Coverage && Coverage.updateMerged) {
        Coverage.updateMerged(level);
      }
    },

    selectMergedLevel: function(level) {
      currentLevel['merged'] = level;
      this.buildMergedView(level);
    }
  };
})();
