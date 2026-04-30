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
    }
  };

  document.addEventListener('DOMContentLoaded', function() {
    App.init();
  });
})();
