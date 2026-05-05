// SPA shell — tab routing, init, utilities
(function() {
  'use strict';

  var currentTradition = 'overview';

  window.App = {
    currentTradition: function() { return currentTradition; },

    init: function() {
      this.bindTabs();
      this.switchTab('overview');
      this.initTagTooltips();
      this.initInfoBubbleTooltips();
      this.markFramedPanels();
      this.injectCornerOrnaments();
      this.initSidebarResize();
    },

    markFramedPanels: function() {
      // Major panels that should have corner ornaments per Decision 017
      var selectors = [
        '.hero',
        '.overview-hero',
        '.tier-card',
        '.tier-table-wrap',
        '.data-table-wrap',
        '#page-arcane',
        '#page-divine',
        '#page-occult',
        '#page-primal'
      ];
      for (var s = 0; s < selectors.length; s++) {
        var els = document.querySelectorAll(selectors[s]);
        for (var i = 0; i < els.length; i++) {
          els[i].classList.add('framed');
        }
      }
    },

    initSidebarResize: function() {
      var sidebar = document.querySelector('.sidebar');
      if (!sidebar) return;
      var handle = document.createElement('div');
      handle.className = 'sidebar-resize-handle';
      sidebar.appendChild(handle);

      var dragging = false;
      var startX = 0;
      var startWidth = 0;

      handle.addEventListener('mousedown', function(e) {
        dragging = true;
        startX = e.clientX;
        startWidth = sidebar.getBoundingClientRect().width;
        handle.classList.add('dragging');
        document.body.classList.add('resizing-sidebar');
        e.preventDefault();
      });

      document.addEventListener('mousemove', function(e) {
        if (!dragging) return;
        var newWidth = startWidth + (e.clientX - startX);
        if (newWidth < 220) newWidth = 220;
        if (newWidth > 400) newWidth = 400;
        document.documentElement.style.setProperty('--sidebar-width', newWidth + 'px');
      });

      document.addEventListener('mouseup', function() {
        if (!dragging) return;
        dragging = false;
        handle.classList.remove('dragging');
        document.body.classList.remove('resizing-sidebar');
      });
    },

    bindTabs: function() {
      var tabs = document.querySelectorAll('.tab-btn[data-page]');
      for (var i = 0; i < tabs.length; i++) {
        (function(btn) {
          btn.addEventListener('click', function(e) {
            e.preventDefault();
            App.switchTab(btn.dataset.page);
          });
        })(tabs[i]);
      }
    },

    switchTab: function(page) {
      currentTradition = page;

      var tabs = document.querySelectorAll('.tab-btn');
      for (var i = 0; i < tabs.length; i++) {
        tabs[i].classList.remove('active');
        if (tabs[i].dataset.page === page) tabs[i].classList.add('active');
      }

      var pages = document.querySelectorAll('.tradition-page');
      for (var i = 0; i < pages.length; i++) {
        pages[i].classList.remove('active');
      }
      var target = document.getElementById('page-' + page);
      if (target) target.classList.add('active');

      var sidebar = document.querySelector('.sidebar');
      if (sidebar) {
        sidebar.style.display = (page === 'overview') ? 'none' : '';
      }

      if (page !== 'overview') {
        Planner.initTradition(page);
      }

      // Reset sort on tradition switch
      if (window.Browser && Browser.resetSort) Browser.resetSort();

      window.scrollTo({ top: 0, behavior: 'smooth' });
    },

    initTagTooltips: function() {
      var tooltipEl = document.createElement('div');
      tooltipEl.className = 'tag-tooltip';
      tooltipEl.style.display = 'none';
      document.body.appendChild(tooltipEl);

      var hoverTimer = null;

      document.addEventListener('mouseover', function(e) {
        var el = e.target.closest('.ctag');
        if (!el) return;
        // Sidebar tags use their own tooltip system from coverage.js
        if (el.closest('.sidebar')) return;

        var tag = el.dataset.tag;
        var defs = window.TAG_DEFINITIONS || {};
        var def = defs[tag];
        if (!def) return;

        if (hoverTimer) clearTimeout(hoverTimer);
        hoverTimer = setTimeout(function() {
          tooltipEl.textContent = def;
          tooltipEl.style.display = 'block';
          var rect = el.getBoundingClientRect();
          tooltipEl.style.left = rect.left + 'px';
          tooltipEl.style.top = (rect.bottom + 6) + 'px';
        }, 200);
      });

      document.addEventListener('mouseout', function(e) {
        var el = e.target.closest('.ctag');
        if (el && !el.closest('.sidebar')) {
          if (hoverTimer) { clearTimeout(hoverTimer); hoverTimer = null; }
          tooltipEl.style.display = 'none';
        }
      });

      // Prevent pill clicks from bubbling to spell-assignment row handlers
      document.addEventListener('click', function(e) {
        var el = e.target.closest('.ctag');
        if (el && el.closest('.spell-table-wrap')) {
          e.stopPropagation();
        }
      }, true);
    },

    initInfoBubbleTooltips: function() {
      var tooltipEl = document.querySelector('.tag-tooltip') || document.createElement('div');
      if (!tooltipEl.parentNode) {
        tooltipEl.className = 'tag-tooltip';
        tooltipEl.style.display = 'none';
        document.body.appendChild(tooltipEl);
      }

      var hoverTimer = null;

      document.addEventListener('mouseover', function(e) {
        var el = e.target.closest('.info-bubble');
        if (!el) return;
        var text = el.getAttribute('title') || el.dataset.tooltip;
        if (!text) return;
        // Suppress native title tooltip by temporarily removing it
        if (el.getAttribute('title')) {
          el.dataset.tooltip = el.getAttribute('title');
          el.removeAttribute('title');
        }

        if (hoverTimer) clearTimeout(hoverTimer);
        hoverTimer = setTimeout(function() {
          tooltipEl.textContent = text;
          tooltipEl.style.display = 'block';
          var rect = el.getBoundingClientRect();
          tooltipEl.style.left = rect.left + 'px';
          tooltipEl.style.top = (rect.bottom + 6) + 'px';
        }, 200);
      });

      document.addEventListener('mouseout', function(e) {
        var el = e.target.closest('.info-bubble');
        if (el) {
          if (hoverTimer) { clearTimeout(hoverTimer); hoverTimer = null; }
          tooltipEl.style.display = 'none';
        }
      });
    },

    toast: function(msg) {
      var t = document.getElementById('toast');
      t.textContent = msg;
      t.classList.add('show');
      setTimeout(function() { t.classList.remove('show'); }, 2000);
    },

    getTier: function(level, rank) {
      var maxRank = Math.ceil(level / 2);
      if (rank >= maxRank - 1) return 'top';
      if (rank === maxRank - 2) return 'mid';
      return 'low';
    },

    tierLabel: function(tier) {
      if (tier === 'top') return '<span class="tier-sym">◆</span> Top';
      if (tier === 'mid') return '<span class="tier-sym">◇</span> Mid';
      return '<span class="tier-sym">◯</span> Low';
    },

    aonUrl: function(aonId) {
      return 'https://2e.aonprd.com/Spells.aspx?ID=' + aonId;
    },

    formatActions: function(actionTags) {
      if (!actionTags || actionTags.length === 0) return '◆◆';

      var hasSustain = actionTags.indexOf('Sustain-action') !== -1;
      var costs = [];

      if (actionTags.indexOf('1-action') !== -1) costs.push('◆');
      if (actionTags.indexOf('3-action') !== -1) costs.push('◆◆◆');
      if (actionTags.indexOf('Reaction') !== -1) costs.push('◈');

      if (costs.length === 0) costs.push('◆◆');

      var display = costs.join(' / ');
      if (hasSustain) display += ' (Sus)';
      return display;
    },

    renderTags: function(spell) {
      var pills = [];

      // Role pills first (hollow, white fill) — fixed display order
      var roleOrder = ['damage', 'debuff', 'buff', 'control', 'healing', 'utility', 'silverBullets'];
      var roleLabels = { damage: 'Damage', debuff: 'Debuff', buff: 'Buff', control: 'Control', healing: 'Healing', utility: 'Utility', silverBullets: 'Silver Bullet' };
      var roleCls = { damage: 'role-damage', debuff: 'role-debuff', buff: 'role-buff', control: 'role-control', healing: 'role-healing', utility: 'role-utility', silverBullets: 'role-silverbullet' };

      if (spell.roles) {
        for (var r = 0; r < roleOrder.length; r++) {
          var role = roleOrder[r];
          if (spell.roles.indexOf(role) !== -1) {
            pills.push({ text: roleLabels[role], tag: roleLabels[role], cls: 'role-pill ' + roleCls[role] });
          }
        }
      }

      // Property pills (filled, tinted) — defense → targeting → damage → conditions → weakness → reliability
      if (spell.defense_tags) {
        for (var i = 0; i < spell.defense_tags.length; i++) {
          pills.push({ text: spell.defense_tags[i], cls: 'tag-defense' });
        }
      }
      if (spell.targeting_tags) {
        for (var i = 0; i < spell.targeting_tags.length; i++) {
          pills.push({ text: spell.targeting_tags[i], cls: 'tag-targeting' });
        }
      }
      if (spell.basic_save) {
        pills.push({ text: 'Basic', cls: 'tag-defense' });
      }
      if (spell.damage_types) {
        for (var i = 0; i < spell.damage_types.length; i++) {
          pills.push({ text: spell.damage_types[i], cls: 'tag-damage' });
        }
      }
      if (spell.conditions_imposed) {
        for (var i = 0; i < spell.conditions_imposed.length; i++) {
          pills.push({ text: spell.conditions_imposed[i], cls: 'tag-condition' });
        }
      }
      if (spell.weaknesses_imposed) {
        for (var i = 0; i < spell.weaknesses_imposed.length; i++) {
          pills.push({ text: 'W:' + spell.weaknesses_imposed[i], tag: 'W:' + spell.weaknesses_imposed[i], cls: 'tag-weakness' });
        }
      }
      if (spell.reliability_tags) {
        for (var i = 0; i < spell.reliability_tags.length; i++) {
          pills.push({ text: spell.reliability_tags[i], cls: 'tag-reliability' });
        }
      }
      if (spell.st_incap) {
        pills.push({ text: '⚠️ ST-Incap', tag: 'ST-Incap', cls: 'danger' });
      }
      // action_tags and special_tags are NOT rendered as pills in the spell browser

      var html = '<div class="slot-tags">';
      for (var i = 0; i < pills.length; i++) {
        var tagKey = pills[i].tag || pills[i].text;
        html += '<span class="ctag ' + pills[i].cls + '" data-tag="' + tagKey + '">' + pills[i].text + '</span>';
      }
      html += '</div>';
      return html;
    },

    injectCornerOrnaments: function() {
      var framed = document.querySelectorAll('.framed');
      for (var i = 0; i < framed.length; i++) {
        if (framed[i].dataset.ornamented) continue;
        framed[i].dataset.ornamented = 'true';
        var corners = ['corner-tl', 'corner-tr', 'corner-bl', 'corner-br'];
        for (var c = 0; c < corners.length; c++) {
          var img = document.createElement('img');
          img.src = 'assets/corner-ornament.svg';
          img.className = 'corner-ornament ' + corners[c];
          img.alt = '';
          framed[i].appendChild(img);
        }
      }
    }
  };

  document.addEventListener('DOMContentLoaded', function() {
    App.init();
  });
})();
