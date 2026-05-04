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
      this.injectCornerOrnaments();
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

      window.scrollTo({ top: 0, behavior: 'smooth' });
    },

    initTagTooltips: function() {
      var tooltipEl = document.createElement('div');
      tooltipEl.className = 'tag-tooltip';
      tooltipEl.style.display = 'none';
      document.body.appendChild(tooltipEl);

      document.addEventListener('click', function(e) {
        var el = e.target.closest('.ctag');
        // Sidebar tags use hover tooltips from coverage.js — skip click handler.
        if (el && el.closest('.sidebar')) {
          tooltipEl.style.display = 'none';
          return;
        }
        if (el) {
          var tag = el.dataset.tag;
          var tagDefs = (window.SPELL_DATA && window.SPELL_DATA.tagDefs) || {};
          var def = tagDefs[tag] || 'No definition available.';
          tooltipEl.textContent = def;
          tooltipEl.style.display = 'block';
          var rect = el.getBoundingClientRect();
          tooltipEl.style.left = rect.left + 'px';
          tooltipEl.style.top = (rect.bottom + 6) + 'px';
          setTimeout(function() { tooltipEl.style.display = 'none'; }, 3000);
          e.stopPropagation();
        } else {
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
      if (tier === 'top') return '◆ Top';
      if (tier === 'mid') return '◇ Mid';
      return '○ Low';
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
            pills.push({ text: roleLabels[role], cls: 'role-pill ' + roleCls[role] });
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
          pills.push({ text: 'W:' + spell.weaknesses_imposed[i], cls: 'tag-weakness' });
        }
      }
      if (spell.reliability_tags) {
        for (var i = 0; i < spell.reliability_tags.length; i++) {
          pills.push({ text: spell.reliability_tags[i], cls: 'tag-reliability' });
        }
      }
      if (spell.st_incap) {
        pills.push({ text: '⚠️ ST-Incap', cls: 'danger' });
      }
      // action_tags and special_tags are NOT rendered as pills in the spell browser

      var html = '<div class="slot-tags">';
      for (var i = 0; i < pills.length; i++) {
        html += '<span class="ctag ' + pills[i].cls + '">' + pills[i].text + '</span>';
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
