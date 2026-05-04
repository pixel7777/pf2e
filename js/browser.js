// Spell browser — role-based browsing from spell-data.js (SPELL_SCHEMA)
(function() {
  'use strict';

  var currentRole = {};
  var renderedSpells = {};

  // 10 roles per Decision 011, in spec order
  var roleOrder = ['damage', 'debuff', 'buff', 'control', 'utility', 'healing', 'reactions', 'oneAction', 'prebuffs', 'silverBullets'];

  var roleLabels = {
    damage: 'Damage',
    debuff: 'Debuff',
    buff: 'Buff',
    control: 'Control',
    utility: 'Utility',
    healing: 'Healing',
    reactions: 'Reactions',
    oneAction: '1-Action',
    prebuffs: 'Pre-Buffs',
    silverBullets: 'Silver Bullets'
  };

  // ── Advice Text Matrix (Decision 022 — verbatim) ──

  var baseAdvice = {
    damage: {
      top: 'Your main combat damage. Native-rank blasts compete best here.  For AoE, native spells outclass heightened lower-rank alternatives. For single-target, heightened spells can work if they scale well. Prioritize spells with rider effects (persistent damage, conditions on failure) to extract more value from these expensive slots and reliability features (auto or success effects) to help them land.',
      mid: 'Sustain spells shine here. Cast one, then sustain for 1 action on later turns while using cantrips or focus spells. Coverage spells that handle both AoE and single-target situations are ideal for prepared casters. Multimodal spells (summons, elemental families) maximize slot value.',
      low: 'Two-action damage spells are poor choices for low-tier slots. You’ll almost never cast them over your top-rank options. Fill these with reaction damage (Brine Dragon’s Bile) or 1-action damage (Force Barrage). Also consider non-damage 1-Action and Reaction spells, Silver Bullets, and Pre-Buffs tabs for better uses of cheap slots.'
    },
    debuff: {
      top: 'Always native rank. Higher-rank debuffs get stronger effects by design. Vision of Death beats heightened Fear, Slow beats heightened Agitate. For single-target boss spells, prioritize options with meaningful success effects (bosses succeed their save ~50% of the time). Avoid Incapacitation trait on single-target spells aimed at bosses.',
      mid: 'Some native-rank debuffs unlock at mid-tier ranks and are worth casting at their natural level. Debuff-damage hybrids (spells that deal damage AND impose conditions) are efficient picks here when one slot serves two purposes.',
      low: 'Don’t park low-rank versions of your top-tier debuffs here. You’ll never cast them over the higher-rank versions. Reactions that fish for debuffs (Lose the Path) are ideal: low action cost means low risk when they miss. Spells with auto-effect debuffs (no save) provide guaranteed value from cheap slots.'
    },
    buff: {
      top: 'Heighten your key buffs to max rank. As you level, check whether a native-rank buff replaces a heightened older one (Heroism replaces Bless at rank 5 — keep heightening Heroism after that).',
      mid: 'Secondary buffs and backup options. Buffs with good heightening formulas live here. Dual-use spells (Greater Invisibility protects an ally AND enables off-guard for rogues) are efficient mid-tier picks.',
      low: 'Long-duration pre-buffs go here: False Vitality, Element Sense, Tailwind. Cast before combat for free in-combat value without spending combat actions. Check the Pre-Buffs tab for a dedicated view of these options.'
    },
    control: {
      top: 'Almost always native rank. Walls and major zoning at their native rank are better than any heightened alternative. Zoning spells that force enemies to choose between staying in damage or spending actions to leave are your most powerful turn-1 plays. Coordinate with your party; don’t cut off allies.',
      mid: 'Terrain and zoning that doesn’t need to scale. Entangling Flora creates automatic difficult terrain regardless of save result for guaranteed value. Containment for action denial. These spells earn their slot through riders and terrain effects, not damage numbers.',
      low: 'Control from low-rank slots provides unconditional reliability.  Many effects are automatic (difficult terrain, walls, zones). Illusory Object is a classic multimodal option: wall off sections, divide enemies, force disbelief checks, all from a rank 1 slot.'
    },
    utility: {
      top: 'High-rank utility does things no skill can replicate.  Teleport, Scouting Eye, Fly. Permission scales with rank. Selection is inherently campaign-dependent: pick spells that solve problems your party actually faces.',
      mid: 'Multimodal utility picks that address many situations from one slot. Shared Invisibility, Airlift, Clairvoyance, Translocate: each covers multiple scenarios a prepared caster might encounter.',
      low: 'Out-of-combat problem-solving is the primary use of low-rank slots: Water Breathing, Water Walking, Gecko Grip, Ant Haul. These become essentially free at high levels. Match picks to your campaign; wilderness spells are wasted in dungeons and vice versa.'
    },
    healing: {
      top: 'Heighten Heal or Soothe to max rank if you’re the primary healer. If healing is your backup role, put heals at your 2nd or 3rd highest rank and save top slots for buffs or debuffs where rank “permission” matters more.',
      mid: 'If you’re a backup healer, this is where your heals live: high enough rank to be meaningful, saving top slots for your primary role.',
      low: 'Low-rank heals can’t keep pace with incoming damage at high levels. False Vitality as a pre-buff provides temp HP without spending combat actions. Emergency healing from low slots is better handled by scrolls, potions, or Battle Medicine than prepared spells.'
    },
    reactions: {
      top: 'Rarely needed in top slots.  Reaction value comes from low action cost, not high spell rank.',
      mid: 'Some defensive reactions (Hidebound, Wooden Double) can be heightened to mid-tier for better damage mitigation. Worth it if you face frequent physical attacks.',
      low: 'Ideal home. Reactions act on enemy turns without spending your combat actions. The best use of cheap slots. Offensive reactions add damage on others’ turns. Defensive reactions let you skip repositioning and keep casting with all three actions.'
    },
    oneAction: {
      top: 'Rarely occupies top slots.',
      mid: 'Occasionally useful. Heal in 1-action mode at mid rank for efficient spot healing. Some focus spells fill this role without costing a slot.',
      low: 'Ideal. Your third action defines the difference between an okay caster and a good one. Pair a 1-action spell with your 2-action main spell for the “perfect turn.” Also consider non-spell options for your third action: Recall Knowledge, Demoralize, Bon Mot, or even a bow shot may serve better than spending a slot.'
    },
    prebuffs: {
      top: 'Almost never worth a top slot. Pre-buffs get their value from duration, not rank.',
      mid: 'Rarely valuable. Some pre-buffs with meaningful heightening (Mystic Armor in the mid-range) can justify a mid slot.',
      low: 'Ideal home. Long-duration spells cast before combat convert cheap slots into free in-combat advantages. Cast during exploration to enter combat already buffed.'
    },
    silverBullets: {
      top: 'Rarely a top tier pick. Silver bullets earn their value by working from any rank. If one IS in a top slot, it solves a high-stakes problem nothing else can (Disintegrate vs. Wall of Force).',
      mid: 'Occasionally good. Some silver bullets that heighten meaningfully (Acid Grip for better damage alongside its forced movement) can justify a mid slot.',
      low: 'Perfect home. The effect matters more than DC or rank. Spells that have their main effect from their native rank or a specific higher rank. Prepared casters excel here: swap in the right silver bullet on the day you know you need it.'
    }
  };

  var traditionOverlays = {
    arcane: {
      damage: {
        top: 'You can target all four defenses. Leverage that flexibility for wide coverage. Check that your top-tier damage picks spread across at least 3 defenses. Force Barrage (auto-hit, no save) is usually worth a slot.',
        low: 'Best tradition for low-slot damage options. Sure Strike, Force Barrage (1-action mode), Brine Dragon’s Bile, and defensive reactions all compete for these slots.'
      },
      debuff: {
        top: 'Widest debuff coverage. You can target all saves with native-rank options at every level. Will-targeting blasts (Agonizing Despair, Vision of Death) that deal damage AND debuff are uniquely available to you.'
      },
      buff: {
        top: 'Nothing like Bless or Heroism that provides universal bonuses. Your buffs are Haste, Fly, Blur, Invisibility, True Target.  Speed, stealth, and accuracy rather than raw stat bonuses.'
      },
      control: {
        top: 'Deepest control toolkit at all ranks. Walls, terrain, zoning... You have options at every spell rank.'
      },
      reactions: {
        low: 'Full reaction menu.  Everything Primal has plus Occult options like Sure Strike and Drop Dead.'
      },
      silverBullets: {}
    },
    divine: {
      damage: {
        top: 'Limited blast options without class features. If you’re a Flames Oracle, you have multiple resource pools for blasting. Otherwise, lean into Fort and Will targeting. Your damage types (void, vitality, spirit) are among the hardest to resist.'
      },
      debuff: {
        top: 'Fort and Will targeting available. Reflex debuff options are limited. Accept that gap and focus your picks on the saves you cover well.'
      },
      buff: {
        top: 'Bless → Heroism at rank 5. Best buff+heal combination.  Heighten both Heroism and Heal to max rank for maximum party impact.'
      },
      control: {
        top: 'Limited control until higher ranks. Your first real area denial options arrive at rank 5+. Consider whether Buff or Healing tabs serve your party better from top slots, especially at lower levels.'
      },
      healing: {
        top: 'Best healing tradition (tied with Primal). Heal, Restoration, Remove Disease, Breath of Life, Regenerate: the full toolkit.'
      },
      reactions: {
        low: 'Limited reaction options.  Blood Spray Curse is your main pick. Consider filling low slots with pre-buffs or silver bullets instead.'
      },
      silverBullets: {
        low: 'Fewest silver bullet options of any tradition. Consider filling remaining low slots with pre-buffs or low-rank heals instead.'
      }
    },
    occult: {
      damage: {
        top: 'Limited blast options natively. Psychic class features (Unleash Psyche) compensate. If your party needs a force multiplier more than a damage dealer, consider whether Buff or Debuff tabs serve you better from these slots.'
      },
      debuff: {
        top: 'Deepest Will-targeting debuff list in the game. Synesthesia, Phantom Pain, Hideous Laughter, Paralyze, Confusion. Lean into this strength.'
      },
      buff: {
        top: 'Best buffing tradition. Heighten Soothe, Heroism, Haste.  This is your superpower. Your buff+debuff combination is what makes Occult a party force multiplier.'
      },
      control: {
        top: 'Control options open up at higher ranks: Black Tentacles (R5), Chromatic Wall (R5), Wall of Force (R6). Lower ranks are limited.'
      },
      healing: {
        top: 'Strong options like Soothe, Restoration, Vampiric Touch/Feast. Soothe heightens well.'
      },
      reactions: {
        low: 'Drop Dead, Unexpected Transposition, Sure Strike. Smaller menu than Arcane/Primal but solid options.'
      },
      silverBullets: {}
    },
    primal: {
      damage: {
        top: 'Strong Fort and Reflex coverage, but Will targeting is your blind spot. Use attack roll spells (AC targeting) to diversify beyond saves. Dehydrate stays competitive via heightening for Fort-targeting coverage.'
      },
      debuff: {
        top: 'Fort debuffs are strong. Will targeting is your weakest area.  Only Fear and Lose the Path. Compensate with attack roll spells for AC targeting with debuff riders.'
      },
      buff: {
        top: 'No Bless or Heroism. Buff via Haste, Fly, Barkskin, Stoneskin, Moon Frenzy.  Speed, defense, and transformation.'
      },
      control: {
        top: 'Tied with Arcane for best control tradition. Walls, terrain, and zoning are core strengths alongside your damage.'
      },
      healing: {
        top: 'Best healing tradition (tied with Divine). Heal, Regenerate, Moment of Renewal. You’re the only tradition that can blast AND heal from the same list.  Use that self-sufficiency.'
      },
      reactions: {
        low: 'Best reaction variety. Interposing Earth (defense), Hidebound (party-wide mitigation), Wooden Double (self-protection), Brine Dragon’s Bile (offensive), Lose the Path (movement denial), Zephyr Slip (repositioning).'
      },
      silverBullets: {}
    }
  };

  var gapMessages = {
    arcane: {
      healing: 'No healing spells exist on the Arcane list. Items (scrolls, wands, staves) and party composition handle the gap.'
    }
  };

  var LOW_SLOT_ROLES = { silverBullets: 1, reactions: 1, oneAction: 1, prebuffs: 1 };

  function getAdvice(role, tier, tradition) {
    if (gapMessages[tradition] && gapMessages[tradition][role]) {
      return { base: gapMessages[tradition][role], overlay: null, isGap: true };
    }

    if (tier === 'mid' && LOW_SLOT_ROLES[role]) tier = 'low';

    var base = baseAdvice[role] && baseAdvice[role][tier] || '';
    var overlay = null;
    if (traditionOverlays[tradition] && traditionOverlays[tradition][role] && traditionOverlays[tradition][role][tier]) {
      overlay = traditionOverlays[tradition][role][tier];
    }

    return { base: base, overlay: overlay, isGap: false };
  }

  // ── Get spells from SPELL_SCHEMA ──
  function getSpellSchemaSpells() {
    if (!window.SPELL_SCHEMA || !window.SPELL_SCHEMA.spells) return [];
    return window.SPELL_SCHEMA.spells;
  }

  // ── Filter spells by tradition + role + rank ──
  function filterSpells(tradition, role, slotRank) {
    var allSpells = getSpellSchemaSpells();
    var tradCap = tradition.charAt(0).toUpperCase() + tradition.slice(1);
    var results = [];

    for (var i = 0; i < allSpells.length; i++) {
      var s = allSpells[i];
      if (s.tradition.indexOf(tradCap) === -1) continue;
      if (s.roles.indexOf(role) === -1) continue;
      if (s.native_rank > slotRank) continue;
      results.push(s);
    }

    // Sort: native_rank descending, then name alphabetically
    results.sort(function(a, b) {
      if (b.native_rank !== a.native_rank) return b.native_rank - a.native_rank;
      return a.name.localeCompare(b.name);
    });

    return results;
  }

  function formatActions(actionTags) { return App.formatActions(actionTags); }
  function renderTags(spell) { return App.renderTags(spell); }

  window.Browser = {
    show: function(tradition, level, rank) {
      var browser = document.getElementById('browser-' + tradition);
      if (!browser) return;
      browser.classList.remove('browser-hidden');

      if (!currentRole[tradition]) currentRole[tradition] = 'damage';

      this.buildBrowserUI(tradition, level, rank);
      this.renderSpells(tradition, level, rank);
    },

    buildBrowserUI: function(tradition, level, rank) {
      var browser = document.getElementById('browser-' + tradition);
      if (browser.dataset.built) {
        this.updateRoleTabs(tradition);
        return;
      }
      browser.dataset.built = 'true';

      var html = '<div class="browser-role-tabs" id="roleTabs-' + tradition + '">';
      for (var i = 0; i < roleOrder.length; i++) {
        var role = roleOrder[i];
        var active = role === currentRole[tradition] ? ' active' : '';
        html += '<button class="browser-role-tab' + active + '" data-role="' + role + '" onclick="Browser.setRole(\'' + tradition + '\',\'' + role + '\')">' + roleLabels[role] + '</button>';
      }
      html += '</div>';

      html += '<div class="browser-advice" id="advice-' + tradition + '"></div>';
      html += '<div class="spell-table-wrap" id="spellTable-' + tradition + '"></div>';

      browser.innerHTML = html;
      delete browser.dataset.ornamented;
      App.injectCornerOrnaments();

      var tableWrap = document.getElementById('spellTable-' + tradition);
      tableWrap.addEventListener('click', function(e) {
        // Don't intercept AoN link clicks
        if (e.target.closest('.aon-link')) return;
        var row = e.target.closest('tr[data-spell-idx]');
        if (!row) return;
        var idx = parseInt(row.dataset.spellIdx, 10);
        var list = renderedSpells[tradition];
        if (!list || !list[idx]) return;
        Browser.assignSpell(tradition, list[idx]);
      });
    },

    updateRoleTabs: function(tradition) {
      var tabs = document.querySelectorAll('#roleTabs-' + tradition + ' .browser-role-tab');
      for (var i = 0; i < tabs.length; i++) {
        tabs[i].classList.remove('active');
        if (tabs[i].dataset.role === currentRole[tradition]) tabs[i].classList.add('active');
      }
    },

    setRole: function(tradition, role) {
      currentRole[tradition] = role;
      this.updateRoleTabs(tradition);

      var slot = Planner.getSelectedSlot();
      if (slot) {
        this.renderSpells(tradition, slot.level, slot.rank);
      }
    },

    renderSpells: function(tradition, level, rank) {
      var role = currentRole[tradition] || 'damage';
      var adviceEl = document.getElementById('advice-' + tradition);
      if (adviceEl) {
        var tier = App.getTier(level, rank);
        var advice = getAdvice(role, tier, tradition);
        adviceEl.innerHTML = '';
        if (advice.isGap) {
          var em = document.createElement('em');
          em.textContent = advice.base;
          adviceEl.appendChild(em);
        } else {
          if (advice.base) {
            adviceEl.appendChild(document.createTextNode(advice.base));
          }
          if (advice.overlay) {
            adviceEl.appendChild(document.createElement('br'));
            var em = document.createElement('em');
            em.textContent = advice.overlay;
            adviceEl.appendChild(em);
          }
        }
      }

      var tableEl = document.getElementById('spellTable-' + tradition);
      if (!tableEl) return;

      var spells = filterSpells(tradition, role, rank);
      renderedSpells[tradition] = spells;

      if (spells.length === 0) {
        tableEl.innerHTML = '<div style="padding:1rem;color:var(--text-dim);text-align:center;font-style:italic;">No spells found for this role/rank combination.</div>';
        return;
      }

      var html = '<table class="spell-table"><thead><tr>';
      html += '<th>Spell</th><th>Rank</th><th>Action</th><th>Tags</th><th>Notes</th>';
      html += '</tr></thead><tbody>';

      for (var i = 0; i < spells.length; i++) {
        var s = spells[i];

        html += '<tr data-spell-idx="' + i + '" style="cursor:pointer;">';

        // Spell name (click assigns) + AoN link icon
        html += '<td>';
        html += '<span class="spell-name-link">' + s.name + '</span>';
        if (s.aonId) {
          html += '<a href="' + App.aonUrl(s.aonId) + '" target="_blank" class="aon-link" title="Open on Archives of Nethys">↗</a>';
        }
        html += '</td>';

        // Rank
        html += '<td>' + s.native_rank + '</td>';

        // Action
        html += '<td>' + formatActions(s.action_tags) + '</td>';

        // Tags
        html += '<td>' + renderTags(s) + '</td>';

        // Notes (empty this cycle)
        html += '<td class="spell-notes"></td>';

        html += '</tr>';
      }

      html += '</tbody></table>';
      tableEl.innerHTML = html;
    },

    assignSpell: function(tradition, spell) {
      var spellObj;
      if (typeof spell === 'string') {
        try { spellObj = JSON.parse(spell); } catch(e) { return; }
      } else {
        spellObj = spell;
      }
      Planner.assignSpell(tradition, spellObj);
    }
  };
})();
