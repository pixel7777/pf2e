// @ts-check
const { test, expect } = require('@playwright/test');
const path = require('path');

const APP_URL = 'file:///' + path.resolve(__dirname, '..', 'index.html').replace(/\\/g, '/');

// Helper: navigate to arcane tradition with a level selected and browser visible
async function setupArcaneWithSpells(page) {
  await page.goto(APP_URL);
  await page.waitForLoadState('domcontentloaded');

  // Click Arcane tab (C33: initTradition defaults to Manual — select wizard explicitly)
  await page.click('[data-page="arcane"]');
  await page.waitForTimeout(300);

  // Select wizard class to auto-populate slots
  await page.evaluate(() => {
    const select = document.getElementById('classSelect-arcane');
    select.value = 'wizard';
    select.dispatchEvent(new Event('change'));
  });
  await page.waitForTimeout(300);

  // Click level 5 tab (selectLevel shows slot panel with empty slots)
  await page.evaluate(() => {
    const btns = document.querySelectorAll('#levelTabBar-arcane .level-tab');
    for (const btn of btns) {
      if (btn.dataset.level === '5') { btn.click(); break; }
    }
  });
  await page.waitForTimeout(300);

  // Click an empty slot to trigger Browser.show (selectSlotUI)
  await page.evaluate(() => {
    const emptySlot = document.querySelector('.slot-empty');
    if (emptySlot) {
      emptySlot.closest('tr').click();
    }
  });
  await page.waitForTimeout(500);
}

test.describe('B1: App Loads Successfully', () => {
  test('page loads without JS errors', async ({ page }) => {
    const errors = [];
    page.on('pageerror', err => errors.push(err.message));

    await page.goto(APP_URL);
    await page.waitForLoadState('domcontentloaded');

    expect(errors).toEqual([]);
  });

  test('SPELL_SCHEMA is defined with spells array', async ({ page }) => {
    await page.goto(APP_URL);
    await page.waitForLoadState('domcontentloaded');

    const hasSpells = await page.evaluate(() => {
      return window.SPELL_SCHEMA && Array.isArray(window.SPELL_SCHEMA.spells) && window.SPELL_SCHEMA.spells.length > 0;
    });
    expect(hasSpells).toBe(true);
  });

  test('TAG_DEFINITIONS is defined and has entries', async ({ page }) => {
    await page.goto(APP_URL);
    await page.waitForLoadState('domcontentloaded');

    const keyCount = await page.evaluate(() => {
      return window.TAG_DEFINITIONS ? Object.keys(window.TAG_DEFINITIONS).length : 0;
    });
    expect(keyCount).toBeGreaterThan(50);
  });
});

test.describe('B2: Spell Tables Populate', () => {
  test('clicking tradition + level shows spells with tags', async ({ page }) => {
    await setupArcaneWithSpells(page);

    // Browser defaults to 'damage' role. Assert table has rows.
    const rowCount = await page.evaluate(() => {
      const wrap = document.querySelector('#spellTable-arcane');
      if (!wrap) return 0;
      const rows = wrap.querySelectorAll('tbody tr');
      return rows ? rows.length : 0;
    });
    expect(rowCount).toBeGreaterThan(0);

    // Assert at least one .ctag exists
    const hasCtag = await page.evaluate(() => {
      const wrap = document.querySelector('#spellTable-arcane');
      return wrap ? wrap.querySelectorAll('.ctag').length > 0 : false;
    });
    expect(hasCtag).toBe(true);
  });
});

test.describe('B3: Export Bar Visible', () => {
  test('export bar exists and is visible on tradition page', async ({ page }) => {
    await page.goto(APP_URL);
    await page.waitForLoadState('domcontentloaded');

    await page.click('[data-page="arcane"]');
    await page.waitForTimeout(200);

    const exportBar = page.locator('#page-arcane .export-bar').first();
    await expect(exportBar).toBeVisible();

    const box = await exportBar.boundingBox();
    expect(box).not.toBeNull();
    const viewport = page.viewportSize();
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.y).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(viewport.width + 5);
  });
});

test.describe('B4: Sidebar Renders', () => {
  test('sidebar is visible with correct width on tradition page', async ({ page }) => {
    await setupArcaneWithSpells(page);

    const sidebar = page.locator('.sidebar');
    await expect(sidebar).toBeVisible();

    const covGroup = page.locator('.cov-group').first();
    await expect(covGroup).toBeVisible();

    const box = await sidebar.boundingBox();
    expect(box).not.toBeNull();
    expect(box.width).toBeGreaterThanOrEqual(200);
    expect(box.width).toBeLessThanOrEqual(450);
  });
});

test.describe('B5: Corner Ornament Containment', () => {
  test('ornaments are contained within their framed parents', async ({ page }) => {
    await page.goto(APP_URL);
    await page.waitForLoadState('domcontentloaded');

    await page.click('[data-page="arcane"]');
    await page.waitForTimeout(500);

    const ornamentCount = await page.evaluate(() => {
      return document.querySelectorAll('.corner-ornament').length;
    });
    expect(ornamentCount).toBeGreaterThanOrEqual(4);

    const containmentResults = await page.evaluate(() => {
      const ornaments = document.querySelectorAll('.corner-ornament');
      const results = [];
      for (const orn of ornaments) {
        const ornBox = orn.getBoundingClientRect();
        const parent = orn.closest('.framed');
        if (!parent) { results.push({ pass: false, reason: 'no .framed parent' }); continue; }
        const parentBox = parent.getBoundingClientRect();
        const tolerance = 5;
        const contained = (
          ornBox.left >= parentBox.left - tolerance &&
          ornBox.top >= parentBox.top - tolerance &&
          ornBox.right <= parentBox.right + tolerance &&
          ornBox.bottom <= parentBox.bottom + tolerance
        );
        if (!contained) {
          results.push({
            pass: false,
            reason: `ornament (${Math.round(ornBox.left)},${Math.round(ornBox.top)},${Math.round(ornBox.right)},${Math.round(ornBox.bottom)}) outside parent (${Math.round(parentBox.left)},${Math.round(parentBox.top)},${Math.round(parentBox.right)},${Math.round(parentBox.bottom)})`
          });
        } else {
          results.push({ pass: true });
        }
      }
      return results;
    });

    for (const r of containmentResults) {
      expect(r.pass, r.reason || '').toBe(true);
    }
  });
});

test.describe('B6: Tier Logic Verification', () => {
  test('getTier returns correct values', async ({ page }) => {
    await page.goto(APP_URL);
    await page.waitForLoadState('domcontentloaded');

    const results = await page.evaluate(() => {
      return [
        App.getTier(16, 5),
        App.getTier(16, 4),
        App.getTier(14, 5),
        App.getTier(10, 3),
        App.getTier(6, 1),
        App.getTier(2, 1),
      ];
    });

    expect(results[0]).toBe('mid');
    expect(results[1]).toBe('low');
    expect(results[2]).toBe('mid');
    expect(results[3]).toBe('mid');
    expect(results[4]).toBe('mid');
    expect(results[5]).toBe('top');
  });
});

test.describe('B7: Tag Tooltip Shows Definition', () => {
  test('hovering a tag pill shows tooltip with definition', async ({ page }) => {
    await setupArcaneWithSpells(page);

    // Find first .ctag in the spell table
    const ctagLocator = page.locator('#spellTable-arcane .ctag').first();
    await expect(ctagLocator).toBeVisible();

    // Hover
    await ctagLocator.hover();
    await page.waitForTimeout(350);

    // Check tooltip is visible with content
    const tooltipVisible = await page.evaluate(() => {
      const el = document.querySelector('.tag-tooltip');
      if (!el) return false;
      return getComputedStyle(el).display !== 'none';
    });
    expect(tooltipVisible).toBe(true);

    const tooltipText = await page.locator('.tag-tooltip').textContent();
    expect(tooltipText.trim().length).toBeGreaterThan(0);
    expect(tooltipText).not.toBe('No definition available');
  });
});

test.describe('B8: Tag Pill Click Does Not Assign', () => {
  test('clicking a tag pill does not assign a spell', async ({ page }) => {
    await setupArcaneWithSpells(page);

    // Count current assigned spells (filled slot cells)
    const beforeCount = await page.evaluate(() => {
      const cells = document.querySelectorAll('.slot-spell-name');
      let filled = 0;
      for (const cell of cells) {
        if (cell.textContent.trim()) filled++;
      }
      return filled;
    });

    // Click a .ctag in the spell table
    const ctag = page.locator('#spellTable-arcane .ctag').first();
    await expect(ctag).toBeVisible();
    await ctag.click();
    await page.waitForTimeout(300);

    // Count after
    const afterCount = await page.evaluate(() => {
      const cells = document.querySelectorAll('.slot-spell-name');
      let filled = 0;
      for (const cell of cells) {
        if (cell.textContent.trim()) filled++;
      }
      return filled;
    });

    expect(afterCount).toBe(beforeCount);
  });
});

test.describe('B9: Search Tab Loads', () => {
  test('search returns results for "fireball"', async ({ page }) => {
    await setupArcaneWithSpells(page);

    // Click Search tab (browser UI is already built from setupArcaneWithSpells)
    await page.evaluate(() => {
      Browser.activateSearch('arcane');
    });
    await page.waitForTimeout(500);

    // Type "fireball" into search input
    const searchInput = page.locator('#searchInput-arcane');
    await expect(searchInput).toBeVisible();
    await searchInput.fill('fireball');
    await page.waitForTimeout(600);

    // Assert results table has rows
    const rowCount = await page.evaluate(() => {
      const wrap = document.querySelector('#spellTable-arcane');
      if (!wrap) return 0;
      const rows = wrap.querySelectorAll('tbody tr');
      return rows ? rows.length : 0;
    });
    expect(rowCount).toBeGreaterThan(0);

    // Assert one result contains "Fireball"
    const hasFireball = await page.evaluate(() => {
      const wrap = document.querySelector('#spellTable-arcane');
      if (!wrap) return false;
      const cells = wrap.querySelectorAll('td');
      for (const cell of cells) {
        if (cell.textContent.includes('Fireball')) return true;
      }
      return false;
    });
    expect(hasFireball).toBe(true);
  });
});

// ── Cycle 21: Curation Layer Display ──

test.describe('C21-1: Star presence', () => {
  test('reviewed spell has gold star, unreviewed spell has spacer', async ({ page }) => {
    await setupArcaneWithSpells(page);

    const result = await page.evaluate(() => {
      const rows = document.querySelectorAll('#spellTable-arcane tr[data-spell-idx]');
      let hasStar = false;
      let hasSpacer = false;
      for (const row of rows) {
        if (row.querySelector('.mathfinder-star')) hasStar = true;
        if (row.querySelector('.mathfinder-spacer')) hasSpacer = true;
        if (hasStar && hasSpacer) break;
      }
      return { hasStar, hasSpacer };
    });
    expect(result.hasStar).toBe(true);
    expect(result.hasSpacer).toBe(true);
  });
});

test.describe('C21-2: Star in planner', () => {
  test('assigning a reviewed spell shows star in slot row', async ({ page }) => {
    await setupArcaneWithSpells(page);

    const slotStar = await page.evaluate(() => {
      const list = window.Browser._getRenderedSpells('arcane');
      const reviewed = list.find(s => s.mathfinder_reviewed);
      if (!reviewed) return false;
      window.Browser.assignSpell('arcane', reviewed);
      return !!document.querySelector('.slot-table .mathfinder-star');
    });
    expect(slotStar).toBe(true);
  });
});

test.describe('C21-3: Popover content', () => {
  test('clicking star opens popover with summary text', async ({ page }) => {
    await setupArcaneWithSpells(page);

    const result = await page.evaluate(() => {
      const star = document.querySelector('#spellTable-arcane .mathfinder-star');
      if (!star) return { visible: false, hasTitle: false, hasSummary: false };
      star.click();
      const p = document.getElementById('curation-popover');
      return {
        visible: p.style.display === 'block',
        hasTitle: !!p.querySelector('.popover-title'),
        hasSummary: p.querySelector('.popover-summary') ? p.querySelector('.popover-summary').textContent.length > 10 : false
      };
    });
    expect(result.visible).toBe(true);
    expect(result.hasTitle).toBe(true);
    expect(result.hasSummary).toBe(true);
  });
});

test.describe('C21-4: Popover dismissal', () => {
  test('clicking body closes popover', async ({ page }) => {
    await setupArcaneWithSpells(page);

    const result = await page.evaluate(() => {
      const star = document.querySelector('#spellTable-arcane .mathfinder-star');
      if (!star) return { afterOpen: 'none', afterClose: 'none' };
      star.click();
      const p = document.getElementById('curation-popover');
      const afterOpen = p.style.display;
      document.body.click();
      return { afterOpen, afterClose: p.style.display };
    });
    expect(result.afterOpen).toBe('block');
    expect(result.afterClose).toBe('none');
  });
});

test.describe('C21-5: Default sort with star priority', () => {
  test('starred spells appear before unstarred at same rank', async ({ page }) => {
    await setupArcaneWithSpells(page);

    const sorted = await page.evaluate(() => {
      window.SpellFilters.sortColumn = null;
      window.SpellFilters.sortDirection = null;
      const rows = document.querySelectorAll('#spellTable-arcane tr[data-spell-idx]');
      const sameRank = [];
      let targetRank = null;
      for (const row of rows) {
        const rank = row.children[1].textContent;
        if (!targetRank) targetRank = rank;
        if (rank !== targetRank) break;
        sameRank.push({ starred: !!row.querySelector('.mathfinder-star') });
      }
      if (sameRank.length < 2) return true;
      let seenUnstarred = false;
      for (const s of sameRank) {
        if (!s.starred) seenUnstarred = true;
        if (s.starred && seenUnstarred) return false;
      }
      return true;
    });
    expect(sorted).toBe(true);
  });
});

test.describe('C21-6: Column sort ignores star', () => {
  test('clicking Name header sorts alphabetically regardless of star', async ({ page }) => {
    await setupArcaneWithSpells(page);

    const alphabetical = await page.evaluate(() => {
      const header = document.querySelector('#spellTable-arcane .sortable-header[data-sort-col="name"]');
      if (header) header.click();
      const rows = document.querySelectorAll('#spellTable-arcane tr[data-spell-idx]');
      const names = [];
      for (let i = 0; i < Math.min(10, rows.length); i++) {
        names.push(rows[i].querySelector('.spell-name-link').textContent);
      }
      for (let i = 1; i < names.length; i++) {
        if (names[i].localeCompare(names[i-1]) < 0) return false;
      }
      return true;
    });
    expect(alphabetical).toBe(true);
  });
});

test.describe('C21-7: Notes column link', () => {
  test('reviewed spell with direct source has video link in Notes', async ({ page }) => {
    await setupArcaneWithSpells(page);

    const hasLink = await page.evaluate(() => {
      const links = document.querySelectorAll('#spellTable-arcane .mathfinder-video-link');
      if (links.length === 0) return false;
      const link = links[0];
      return link.tagName === 'A' && link.href.includes('youtube.com');
    });
    expect(hasLink).toBe(true);
  });
});

test.describe('C21-8: Chain badge', () => {
  test('spell with replacement chain data shows chain badge', async ({ page }) => {
    await setupArcaneWithSpells(page);

    const badge = await page.evaluate(() => {
      const badges = document.querySelectorAll('#spellTable-arcane .chain-badge');
      if (badges.length === 0) return { exists: false, text: '' };
      return { exists: true, text: badges[0].textContent };
    });
    expect(badge.exists).toBe(true);
    expect(badge.text).toMatch(/[↑↓]/);
  });
});

test.describe('C21b-2: Silver bullet purpose note in Notes column', () => {
  test('Air Bubble shows silver bullet note in Notes column', async ({ page }) => {
    await page.goto(APP_URL);
    await page.waitForLoadState('domcontentloaded');

    await page.click('[data-page="arcane"]');
    await page.waitForTimeout(300);

    // C33: select wizard to get slots
    await page.evaluate(() => {
      const select = document.getElementById('classSelect-arcane');
      select.value = 'wizard';
      select.dispatchEvent(new Event('change'));
    });
    await page.waitForTimeout(300);

    await page.evaluate(() => {
      const btns = document.querySelectorAll('#levelTabBar-arcane .level-tab');
      for (const btn of btns) {
        if (btn.dataset.level === '1') { btn.click(); break; }
      }
    });
    await page.waitForTimeout(300);

    await page.evaluate(() => {
      const emptySlot = document.querySelector('.slot-empty');
      if (emptySlot) emptySlot.closest('tr').click();
    });
    await page.waitForTimeout(500);

    // Switch to silverBullets role tab so Air Bubble shows
    await page.evaluate(() => { window.Browser.setRole('arcane', 'silverBullets'); });
    await page.waitForTimeout(300);

    const noteText = await page.evaluate(() => {
      const rows = document.querySelectorAll('#spellTable-arcane tbody tr');
      for (const row of rows) {
        const nameCell = row.querySelector('td');
        if (nameCell && nameCell.textContent.includes('Air Bubble')) {
          const note = row.querySelector('.silver-bullet-note');
          return note ? note.textContent : null;
        }
      }
      return null;
    });
    expect(noteText).toBeTruthy();
    expect(noteText).toMatch(/breathe|airless|underwater|suffocation/i);
  });
});

test.describe('C21b-1: Silver Bullets tab shows spells', () => {
  test('Silver Bullets tab renders with >0 spells for Arcane', async ({ page }) => {
    await page.goto(APP_URL);
    await page.waitForLoadState('domcontentloaded');

    await page.click('[data-page="arcane"]');
    await page.waitForTimeout(300);

    // C33: select wizard to get slots
    await page.evaluate(() => {
      const select = document.getElementById('classSelect-arcane');
      select.value = 'wizard';
      select.dispatchEvent(new Event('change'));
    });
    await page.waitForTimeout(300);

    // Click level 1 tab to init
    await page.evaluate(() => {
      const btns = document.querySelectorAll('#levelTabBar-arcane .level-tab');
      for (const btn of btns) {
        if (btn.dataset.level === '1') { btn.click(); break; }
      }
    });
    await page.waitForTimeout(300);

    // Click an empty slot to show browser
    await page.evaluate(() => {
      const emptySlot = document.querySelector('.slot-empty');
      if (emptySlot) emptySlot.closest('tr').click();
    });
    await page.waitForTimeout(500);

    // Switch to Silver Bullets role
    await page.evaluate(() => { window.Browser.setRole('arcane', 'silverBullets'); });
    await page.waitForTimeout(300);

    const rowCount = await page.evaluate(() => {
      const table = document.querySelector('#spellTable-arcane');
      if (!table) return 0;
      return table.querySelectorAll('tbody tr').length;
    });
    expect(rowCount).toBeGreaterThan(0);
  });
});

// ════════════════════════════════════════════════════════════════════
// Cycle 22 — Advanced Filtering: trait pills, column filters, summary bar
// ════════════════════════════════════════════════════════════════════

test.describe('C22-1: Trait Filter Pills section', () => {
  test('trait section renders with grouped pills below filter controls', async ({ page }) => {
    await page.goto(APP_URL);
    await page.waitForLoadState('domcontentloaded');
    await page.click('[data-page="arcane"]');
    await page.waitForTimeout(300);

    const summary = await page.evaluate(() => {
      const section = document.getElementById('traitFiltersSection');
      if (!section) return { ok: false };
      const groups = section.querySelectorAll('.trait-group');
      const pills = section.querySelectorAll('.ctag.tag-trait');
      const filterControls = document.querySelector('.filter-controls');
      const after = filterControls && section
        ? !!(filterControls.compareDocumentPosition(section) & Node.DOCUMENT_POSITION_FOLLOWING)
        : false;
      const hasInput = !!document.getElementById('traitFilterInput');
      return { ok: true, groupCount: groups.length, pillCount: pills.length, afterFilterControls: after, hasInput };
    });
    expect(summary.ok).toBe(true);
    expect(summary.groupCount).toBeGreaterThanOrEqual(8);
    expect(summary.pillCount).toBeGreaterThan(40);
    expect(summary.afterFilterControls).toBe(true);
    expect(summary.hasInput).toBe(true);
  });
});

test.describe('C22-2: Trait pill click applies include filter', () => {
  test('clicking Fire pill narrows arcane spell table', async ({ page }) => {
    await setupArcaneWithSpells(page);

    const baseline = await page.evaluate(() =>
      document.querySelectorAll('#spellTable-arcane tr[data-spell-idx]').length);

    const result = await page.evaluate(() => {
      const pill = document.querySelector('.ctag.tag-trait[data-trait="Fire"]');
      ['mousedown','mouseup','click'].forEach(function(evt) {
        pill.dispatchEvent(new MouseEvent(evt, { bubbles: true, cancelable: true, view: window }));
      });
      return {
        included: pill.classList.contains('filter-included'),
        traitInclude: window.SpellFilters.traitInclude,
        narrowedCount: document.querySelectorAll('#spellTable-arcane tr[data-spell-idx]').length
      };
    });
    expect(result.included).toBe(true);
    expect(result.traitInclude).toContain('Fire');
    expect(result.narrowedCount).toBeLessThan(baseline);
    expect(result.narrowedCount).toBeGreaterThan(0);
  });
});

test.describe('C22-3: Column rank filter dropdown', () => {
  test('rank dropdown opens with checkboxes scoped to slot rank', async ({ page }) => {
    await setupArcaneWithSpells(page);

    const info = await page.evaluate(() => {
      const icon = document.querySelector('#spellTable-arcane .col-filter-icon[data-col-filter="rank"]');
      icon.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: window }));
      const dropdown = document.querySelector('.column-filter-dropdown');
      return {
        present: !!dropdown,
        checkboxes: dropdown ? dropdown.querySelectorAll('input[type=checkbox]').length : 0,
        hasInfo: !!(dropdown && dropdown.querySelector('.cfd-info')),
        hasSelectAll: !!(dropdown && dropdown.querySelector('[data-action="select-all"]'))
      };
    });
    expect(info.present).toBe(true);
    expect(info.checkboxes).toBe(3); // level 5 → max rank 3
    expect(info.hasInfo).toBe(true);
    expect(info.hasSelectAll).toBe(true);
  });
});

test.describe('C22-4: Star toggle filters to mathfinder_reviewed', () => {
  test('clicking star icon toggles columnStarredOnly and narrows results', async ({ page }) => {
    await setupArcaneWithSpells(page);

    const result = await page.evaluate(() => {
      const baseline = document.querySelectorAll('#spellTable-arcane tr[data-spell-idx]').length;
      const star = document.querySelector('#spellTable-arcane .col-filter-icon.star-toggle');
      star.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: window }));
      const after = document.querySelectorAll('#spellTable-arcane tr[data-spell-idx]').length;
      const starredRows = document.querySelectorAll('#spellTable-arcane tr[data-spell-idx] .mathfinder-star').length;
      return {
        baseline: baseline,
        afterToggle: after,
        starActive: window.SpellFilters.columnStarredOnly,
        allStarred: starredRows === after && after > 0
      };
    });
    expect(result.starActive).toBe(true);
    expect(result.afterToggle).toBeLessThanOrEqual(result.baseline);
    expect(result.allStarred).toBe(true);
  });
});

test.describe('C22-5: Active Filter Summary Bar', () => {
  test('bar shows chip when trait active and Clear all resets state', async ({ page }) => {
    await setupArcaneWithSpells(page);

    const initialDisplay = await page.evaluate(() =>
      document.getElementById('activeFilterBar-arcane').style.display);
    expect(initialDisplay).toBe('none');

    const afterApply = await page.evaluate(() => {
      const pill = document.querySelector('.ctag.tag-trait[data-trait="Fire"]');
      ['mousedown','mouseup','click'].forEach(function(evt) {
        pill.dispatchEvent(new MouseEvent(evt, { bubbles: true, cancelable: true, view: window }));
      });
      const star = document.querySelector('#spellTable-arcane .col-filter-icon.star-toggle');
      star.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: window }));
      const bar = document.getElementById('activeFilterBar-arcane');
      return {
        display: bar.style.display,
        text: bar.textContent.trim(),
        chipCount: bar.querySelectorAll('.filter-chip').length,
        hasClearAll: !!bar.querySelector('.afb-clear')
      };
    });
    expect(afterApply.display).toBe('');
    expect(afterApply.text).toContain('Fire');
    expect(afterApply.text).toContain('★ only');
    expect(afterApply.chipCount).toBe(2);
    expect(afterApply.hasClearAll).toBe(true);

    const afterClear = await page.evaluate(() => {
      document.querySelector('#activeFilterBar-arcane .afb-clear').dispatchEvent(
        new MouseEvent('click', { bubbles: true, cancelable: true, view: window }));
      return {
        traitInclude: window.SpellFilters.traitInclude,
        starredOnly: window.SpellFilters.columnStarredOnly,
        barDisplay: document.getElementById('activeFilterBar-arcane').style.display,
        firePillCls: document.querySelector('.ctag.tag-trait[data-trait="Fire"]').className
      };
    });
    expect(afterClear.traitInclude).toEqual([]);
    expect(afterClear.starredOnly).toBe(false);
    expect(afterClear.barDisplay).toBe('none');
    expect(afterClear.firePillCls).not.toContain('filter-included');
  });
});

test.describe('C22-6: Legacy toggle YES/NO labels', () => {
  test('legacy button reads NO by default and YES when toggled on', async ({ page }) => {
    await setupArcaneWithSpells(page);

    const result = await page.evaluate(() => {
      const btn = document.getElementById('legacyToggle');
      const initial = btn.textContent;
      btn.click();
      const onText = btn.textContent;
      const bar = document.getElementById('activeFilterBar-arcane');
      const chipText = (bar.querySelector('.filter-chip') || {}).textContent || '';
      btn.click();
      const offText = btn.textContent;
      return { initial: initial, onText: onText, chipText: chipText, offText: offText };
    });
    expect(result.initial).toContain('NO');
    expect(result.onText).toContain('YES');
    expect(result.chipText).toContain('Legacy: shown');
    expect(result.offText).toContain('NO');
  });
});

test.describe('C25-1: Header utility links', () => {
  test('About, Feedback, and Support Me links are present in header', async ({ page }) => {
    await page.goto(APP_URL);
    await page.waitForSelector('.header-utility-links');
    const result = await page.evaluate(() => {
      var container = document.querySelector('.header-utility-links');
      var about = container.querySelector('a[href="#page-about"]');
      var feedback = container.querySelector('a[target="_blank"]');
      var support = container.querySelector('.utility-link-inert');
      return {
        aboutText: about ? about.textContent.trim() : null,
        feedbackText: feedback ? feedback.textContent.trim() : null,
        supportText: support ? support.textContent.trim() : null
      };
    });
    expect(result.aboutText).toBe('About');
    expect(result.feedbackText).toContain('Feedback');
    expect(result.supportText).toBe('Support Me');
  });
});

test.describe('C25-2: About page loads', () => {
  test('clicking About link shows about page with TOC and content sections', async ({ page }) => {
    await page.goto(APP_URL);
    await page.waitForSelector('.header-utility-links');
    const result = await page.evaluate(() => {
      App.switchTab('about');
      var aboutPage = document.getElementById('page-about');
      var toc = aboutPage.querySelector('.about-toc');
      var tocLinks = toc.querySelectorAll('.about-toc-link');
      var sections = aboutPage.querySelectorAll('.overview-section[id]');
      var firstSection = sections[0];
      return {
        pageActive: aboutPage.classList.contains('active'),
        tocExists: !!toc,
        tocLinkCount: tocLinks.length,
        sectionCount: sections.length,
        firstSectionId: firstSection ? firstSection.id : null,
        firstSectionHeading: firstSection ? firstSection.querySelector('h2').textContent : null,
        sidebarHidden: document.querySelector('.sidebar').style.display === 'none'
      };
    });
    expect(result.pageActive).toBe(true);
    expect(result.tocExists).toBe(true);
    expect(result.tocLinkCount).toBe(14);
    expect(result.sectionCount).toBe(14);
    expect(result.firstSectionId).toBe('about-what');
    expect(result.firstSectionHeading).toBe('What Is This Tool?');
    expect(result.sidebarHidden).toBe(true);
  });
});

test.describe('C28: Copy Previous ghost slot prevention for bounded casters', () => {
  test('Magus Copy Previous skips ranks the class lacks at target level', async ({ page }) => {
    await page.goto(APP_URL);
    await page.waitForLoadState('domcontentloaded');

    await page.click('[data-page="arcane"]');
    await page.waitForTimeout(300);

    // Switch to Magus
    await page.evaluate(() => {
      const select = document.getElementById('classSelect-arcane');
      select.value = 'magus';
      select.dispatchEvent(new Event('change'));
    });
    await page.waitForTimeout(300);

    // Go to level 6 (Magus slots: {2:2, 3:2}) and assign a spell at rank 2
    await page.evaluate(() => {
      const btns = document.querySelectorAll('#levelTabBar-arcane .level-tab');
      for (const btn of btns) {
        if (btn.dataset.level === '6') { btn.click(); break; }
      }
    });
    await page.waitForTimeout(300);

    // Manually place a fake spell in rank 2 at level 6
    await page.evaluate(() => {
      const state = window.Planner.getState();
      state.arcane[6][2][0] = { name: 'TestSpell', aonId: 999, action_tags: ['2-action'], roles: ['damage'], defense_tags: [], targeting_tags: [], damage_types: [], conditions_imposed: [], reliability_tags: [], special_tags: [], weaknesses_imposed: [], mathfinder_reviewed: false };
    });

    // Go to level 7 (Magus slots: {3:2, 4:2} — NO rank 2)
    await page.evaluate(() => {
      const btns = document.querySelectorAll('#levelTabBar-arcane .level-tab');
      for (const btn of btns) {
        if (btn.dataset.level === '7') { btn.click(); break; }
      }
    });
    await page.waitForTimeout(300);

    // Copy Previous
    await page.evaluate(() => {
      window.Planner.copyPrevious('arcane', 7);
    });
    await page.waitForTimeout(300);

    const result = await page.evaluate(() => {
      const state = window.Planner.getState();
      const rank2 = state.arcane[7][2];
      const hasGhostSpells = rank2 && rank2.some(s => s !== null);
      const rankRowHidden = document.getElementById('rank-row-arcane-7-2');
      return {
        rank2Length: rank2 ? rank2.length : 0,
        hasGhostSpells: hasGhostSpells,
        rankRowIsHidden: rankRowHidden ? rankRowHidden.classList.contains('rank-row-hidden') : null
      };
    });

    // Rank 2 should NOT have ghost spells from Copy Previous
    expect(result.hasGhostSpells).toBe(false);
    // Rank 2 row should be hidden for Magus at level 7
    expect(result.rankRowIsHidden).toBe(true);
  });

  test('Manual mode Copy Previous still copies all ranks', async ({ page }) => {
    await page.goto(APP_URL);
    await page.waitForLoadState('domcontentloaded');

    await page.click('[data-page="arcane"]');
    await page.waitForTimeout(300);

    // Switch to Manual mode
    await page.evaluate(() => {
      const select = document.getElementById('classSelect-arcane');
      select.value = '';
      select.dispatchEvent(new Event('change'));
    });
    await page.waitForTimeout(300);

    // Go to level 6, add a slot at rank 2, assign a spell
    await page.evaluate(() => {
      const btns = document.querySelectorAll('#levelTabBar-arcane .level-tab');
      for (const btn of btns) {
        if (btn.dataset.level === '6') { btn.click(); break; }
      }
    });
    await page.waitForTimeout(300);

    await page.evaluate(() => {
      window.Planner.addSlot('arcane', 6, 2);
      const state = window.Planner.getState();
      state.arcane[6][2][0] = { name: 'ManualSpell', aonId: 998, action_tags: ['2-action'], roles: ['buff'], defense_tags: [], targeting_tags: [], damage_types: [], conditions_imposed: [], reliability_tags: [], special_tags: [], weaknesses_imposed: [], mathfinder_reviewed: false };
    });

    // Go to level 7, Copy Previous
    await page.evaluate(() => {
      const btns = document.querySelectorAll('#levelTabBar-arcane .level-tab');
      for (const btn of btns) {
        if (btn.dataset.level === '7') { btn.click(); break; }
      }
    });
    await page.waitForTimeout(300);

    await page.evaluate(() => {
      window.Planner.copyPrevious('arcane', 7);
    });
    await page.waitForTimeout(300);

    const result = await page.evaluate(() => {
      const state = window.Planner.getState();
      const rank2 = state.arcane[7][2];
      return {
        hasSpell: rank2 && rank2.some(s => s !== null),
        spellName: rank2 && rank2[0] ? rank2[0].name : null
      };
    });

    // Manual mode should copy all ranks including rank 2
    expect(result.hasSpell).toBe(true);
    expect(result.spellName).toBe('ManualSpell');
  });
});

// Helper: setup Arcane Damage at a given level with spells showing
async function setupArcaneAtLevel(page, level) {
  await page.goto(APP_URL);
  await page.waitForLoadState('domcontentloaded');

  await page.click('[data-page="arcane"]');
  await page.waitForTimeout(300);

  // C33: initTradition defaults to Manual — select wizard explicitly
  await page.evaluate(() => {
    const select = document.getElementById('classSelect-arcane');
    select.value = 'wizard';
    select.dispatchEvent(new Event('change'));
  });
  await page.waitForTimeout(300);

  await page.evaluate((lvl) => {
    const btns = document.querySelectorAll('#levelTabBar-arcane .level-tab');
    for (const btn of btns) {
      if (btn.dataset.level === String(lvl)) { btn.click(); break; }
    }
  }, level);
  await page.waitForTimeout(300);

  await page.evaluate(() => {
    const emptySlot = document.querySelector('.slot-empty');
    if (emptySlot) emptySlot.closest('tr').click();
  });
  await page.waitForTimeout(500);
}

test.describe('C29-1: Three-group default sort order', () => {
  test('G1 spell appears before G2 spell, G2 before G3 at high-rank slot', async ({ page }) => {
    await setupArcaneAtLevel(page, 13);

    const order = await page.evaluate(() => {
      // Find spells and classify by group using the same logic as applySortOrder
      const rows = document.querySelectorAll('#spellTable-arcane tr[data-spell-idx]');
      var sel = window.Planner ? window.Planner.getSelectedSlot() : null;
      const slotRank = sel ? sel.rank : 7;
      let g1Index = -1, g2Index = -1, g3Index = -1;

      for (let i = 0; i < rows.length; i++) {
        const nameEl = rows[i].querySelector('.spell-name-link');
        if (!nameEl) continue;
        const name = nameEl.textContent;
        const hasStar = !!rows[i].querySelector('.mathfinder-star');
        const rankText = rows[i].children[1] ? rows[i].children[1].textContent.trim() : '';
        const rank = parseInt(rankText, 10);

        // G1: native rank == slotRank AND starred
        if (rank === slotRank && hasStar && g1Index === -1) g1Index = i;
        // G3: unstarred native spell (not MF reviewed) — guaranteed G3
        if (rank === slotRank && !hasStar && g3Index === -1) g3Index = i;
      }

      // Find a G2 spell: starred, non-native rank, should be between G1 and G3
      for (let i = 0; i < rows.length; i++) {
        const hasStar = !!rows[i].querySelector('.mathfinder-star');
        const rankText = rows[i].children[1] ? rows[i].children[1].textContent.trim() : '';
        const rank = parseInt(rankText, 10);
        if (hasStar && rank < slotRank && g2Index === -1) { g2Index = i; break; }
      }

      return { g1Index, g2Index, g3Index };
    });

    // G1 should come before G2, G2 before G3
    if (order.g1Index >= 0 && order.g2Index >= 0) {
      expect(order.g1Index).toBeLessThan(order.g2Index);
    }
    if (order.g2Index >= 0 && order.g3Index >= 0) {
      expect(order.g2Index).toBeLessThan(order.g3Index);
    }
    // At least G1 and G2 should exist
    expect(order.g1Index).toBeGreaterThanOrEqual(0);
    expect(order.g2Index).toBeGreaterThanOrEqual(0);
  });
});

test.describe('C29-2: Column sort suppresses three-group logic', () => {
  test('Name header click produces flat alphabetical order', async ({ page }) => {
    await setupArcaneAtLevel(page, 13);

    const result = await page.evaluate(() => {
      const header = document.querySelector('#spellTable-arcane .sortable-header[data-sort-col="name"]');
      if (header) header.click();
      const rows = document.querySelectorAll('#spellTable-arcane tr[data-spell-idx]');
      const names = [];
      for (let i = 0; i < Math.min(20, rows.length); i++) {
        const el = rows[i].querySelector('.spell-name-link');
        if (el) names.push(el.textContent);
      }
      // Check that a G3 spell with early alphabet sorts before a G1 spell with late alphabet
      let isAlphabetical = true;
      for (let i = 1; i < names.length; i++) {
        if (names[i].localeCompare(names[i-1]) < 0) { isAlphabetical = false; break; }
      }
      return { isAlphabetical, count: names.length };
    });

    expect(result.isAlphabetical).toBe(true);
    expect(result.count).toBeGreaterThan(5);
  });
});

test.describe('C29-3: Default sort restoration after column sort cycle', () => {
  test('cycling Name header asc→desc→default restores three-group sort', async ({ page }) => {
    await page.goto(APP_URL);
    await page.waitForLoadState('domcontentloaded');

    await page.click('[data-page="arcane"]');
    await page.waitForTimeout(300);

    // C33: select wizard to get slots
    await page.evaluate(() => {
      const select = document.getElementById('classSelect-arcane');
      select.value = 'wizard';
      select.dispatchEvent(new Event('change'));
    });
    await page.waitForTimeout(300);

    // Select level 13
    await page.evaluate(() => {
      const btns = document.querySelectorAll('#levelTabBar-arcane .level-tab');
      for (const btn of btns) {
        if (btn.dataset.level === '13') { btn.click(); break; }
      }
    });
    await page.waitForTimeout(300);

    // Click a slot at the highest rank (rank 7) to get a high slot rank
    await page.evaluate(() => {
      const rows = document.querySelectorAll('.slot-row');
      for (const row of rows) {
        const rankLabel = row.closest('.rank-row');
        if (rankLabel) {
          const label = rankLabel.querySelector('.rank-label');
          if (label && label.textContent.includes('7')) {
            const emptySlot = row.querySelector('.slot-empty');
            if (emptySlot) { row.click(); return; }
          }
        }
      }
      // Fallback: click any empty slot
      const any = document.querySelector('.slot-empty');
      if (any) any.closest('tr').click();
    });
    await page.waitForTimeout(500);

    // Cycle sort: asc → desc → default (separate clicks with re-render time)
    await page.evaluate(() => {
      document.querySelector('#spellTable-arcane .sortable-header[data-sort-col="name"]').click();
    });
    await page.waitForTimeout(200);
    await page.evaluate(() => {
      document.querySelector('#spellTable-arcane .sortable-header[data-sort-col="name"]').click();
    });
    await page.waitForTimeout(200);
    await page.evaluate(() => {
      document.querySelector('#spellTable-arcane .sortable-header[data-sort-col="name"]').click();
    });
    await page.waitForTimeout(300);

    const result = await page.evaluate(() => {
      const rows = document.querySelectorAll('#spellTable-arcane tr[data-spell-idx]');
      var sel = window.Planner ? window.Planner.getSelectedSlot() : null;
      var slotRank = sel ? sel.rank : 7;

      // After restoring default, G1 (starred + native) should precede G2 (starred + non-native scalers)
      let firstG1Idx = -1;
      let firstNonNativeStarredIdx = -1;

      for (let i = 0; i < rows.length; i++) {
        const hasStar = !!rows[i].querySelector('.mathfinder-star');
        const rankText = rows[i].children[1] ? rows[i].children[1].textContent.trim() : '';
        const rank = parseInt(rankText, 10);
        if (hasStar && rank === slotRank && firstG1Idx === -1) firstG1Idx = i;
        if (hasStar && rank < slotRank && firstNonNativeStarredIdx === -1) firstNonNativeStarredIdx = i;
      }

      return { firstG1Idx, firstNonNativeStarredIdx, slotRank };
    });

    // G1 native starred should appear before any non-native starred
    if (result.firstG1Idx >= 0 && result.firstNonNativeStarredIdx >= 0) {
      expect(result.firstG1Idx).toBeLessThan(result.firstNonNativeStarredIdx);
    }
    expect(result.firstG1Idx).toBeGreaterThanOrEqual(0);
  });
});

test.describe('C26-1: Version indicator on About page', () => {
  test('About page shows version indicator at the bottom', async ({ page }) => {
    await page.goto(APP_URL);
    await page.waitForLoadState('domcontentloaded');

    await page.evaluate(() => App.switchTab('about'));
    await page.waitForTimeout(300);

    const result = await page.evaluate(() => {
      const version = document.querySelector('#page-about .app-version');
      if (!version) return { exists: false };
      const style = window.getComputedStyle(version);
      return {
        exists: true,
        text: version.textContent.trim(),
        textAlign: style.textAlign,
        opacity: parseFloat(style.opacity)
      };
    });
    expect(result.exists).toBe(true);
    expect(result.text).toBe('v1.0.0');
    expect(result.textAlign).toBe('center');
    expect(result.opacity).toBeLessThan(1);
  });
});

// ════════════════════════════════════════════════════════════════════
// Cycle 33 — Default tradition pages to Manual mode
// ════════════════════════════════════════════════════════════════════

const fs = require('fs');

test.describe('C33-1: Load plan with Manual slots preserves slot count', () => {
  test('loading a saved plan with null class keeps manual slot layout', async ({ page }) => {
    await page.goto(APP_URL);
    await page.waitForLoadState('domcontentloaded');

    // Click Arcane tab to init it
    await page.click('[data-page="arcane"]');
    await page.waitForTimeout(300);

    // Load the fixture plan via Planner.loadPlan
    const fixturePath = path.resolve(__dirname, 'fixtures', 'manual-slots-plan.json');
    const fixtureData = JSON.parse(fs.readFileSync(fixturePath, 'utf8'));

    await page.evaluate((data) => {
      window.Planner.loadPlan(data.plan, data.classes);
    }, fixtureData);
    await page.waitForTimeout(300);

    // Navigate to arcane level 3
    await page.evaluate(() => {
      const btns = document.querySelectorAll('#levelTabBar-arcane .level-tab');
      for (const btn of btns) {
        if (btn.dataset.level === '3') { btn.click(); break; }
      }
    });
    await page.waitForTimeout(300);

    const result = await page.evaluate(() => {
      const state = window.Planner.getState();
      const rank1Slots = state.arcane[3][1];
      const classSelect = document.getElementById('classSelect-arcane');
      return {
        slotCount: rank1Slots ? rank1Slots.length : 0,
        firstSpellName: rank1Slots && rank1Slots[0] ? rank1Slots[0].name : null,
        secondSpellName: rank1Slots && rank1Slots[1] ? rank1Slots[1].name : null,
        classValue: classSelect ? classSelect.value : 'MISSING'
      };
    });

    // Manual slots preserved: exactly 2 slots, not expanded by a class progression
    expect(result.slotCount).toBe(2);
    expect(result.firstSpellName).toBe('TestSpellA');
    expect(result.secondSpellName).toBe('TestSpellB');
    expect(result.classValue).toBe('');
  });
});

test.describe('C33-2: Cross-tab init stays Manual', () => {
  test('setting class on one tradition does not auto-assign class on another', async ({ page }) => {
    await page.goto(APP_URL);
    await page.waitForLoadState('domcontentloaded');

    // Init Arcane — should default to Manual
    await page.click('[data-page="arcane"]');
    await page.waitForTimeout(300);

    // Select wizard on Arcane
    await page.evaluate(() => {
      const select = document.getElementById('classSelect-arcane');
      select.value = 'wizard';
      select.dispatchEvent(new Event('change'));
    });
    await page.waitForTimeout(300);

    // Switch to Divine tab (first visit — triggers initTradition)
    await page.click('[data-page="divine"]');
    await page.waitForTimeout(300);

    const result = await page.evaluate(() => {
      const divineSelect = document.getElementById('classSelect-divine');
      const classes = window.Planner.getClasses();
      // Check level 1 rank 1 slots — Manual mode means no auto-populated slots
      const state = window.Planner.getState();
      const rank1Slots = state.divine && state.divine[1] && state.divine[1][1] ? state.divine[1][1] : [];
      return {
        divineClassValue: divineSelect ? divineSelect.value : 'MISSING',
        divineClassState: classes.divine,
        slotCount: rank1Slots.length
      };
    });

    // Divine should be in Manual mode — no class auto-assigned, no slots auto-populated
    expect(result.divineClassValue).toBe('');
    expect(result.divineClassState).toBeNull();
    expect(result.slotCount).toBe(0);
  });
});

test.describe('C34: Coverage Refresh on Tab Switch', () => {
  test('C34-1: coverage pills refresh when returning to a tradition tab with assigned spells', async ({ page }) => {
    await setupArcaneWithSpells(page);

    // Assign a spell with known tags via the API
    const litCountBefore = await page.evaluate(() => {
      const list = window.Browser._getRenderedSpells('arcane');
      const spell = list.find(s => s.defense_tags && s.defense_tags.length > 0);
      if (!spell) return -1;
      window.Browser.assignSpell('arcane', spell);
      return document.querySelectorAll('.sidebar .ctag.lit').length;
    });
    expect(litCountBefore).toBeGreaterThan(0);

    // Switch to Divine
    await page.click('[data-page="divine"]');
    await page.waitForTimeout(300);

    // Switch back to Arcane
    await page.click('[data-page="arcane"]');
    await page.waitForTimeout(300);

    // Coverage pills should be lit again
    const litCountAfter = await page.evaluate(() => {
      return document.querySelectorAll('.sidebar .ctag.lit').length;
    });
    expect(litCountAfter).toBe(litCountBefore);
  });

  test('C34-2: switching to tradition with no level selected does not cause errors', async ({ page }) => {
    const errors = [];
    page.on('pageerror', err => errors.push(err.message));

    await page.goto(APP_URL);
    await page.waitForLoadState('domcontentloaded');

    // Visit Arcane (no class, no level selected — level 0)
    await page.click('[data-page="arcane"]');
    await page.waitForTimeout(300);

    // Switch to Divine
    await page.click('[data-page="divine"]');
    await page.waitForTimeout(300);

    // Switch back to Arcane (level 0 — Coverage.update should NOT be called)
    await page.click('[data-page="arcane"]');
    await page.waitForTimeout(300);

    expect(errors).toHaveLength(0);
  });
});

// ── Helper: load multi-tradition plan fixture ──
const MULTI_TRAD_FIXTURE = JSON.parse(
  fs.readFileSync(path.resolve(__dirname, 'fixtures', 'multi-tradition-plan.json'), 'utf8')
);

async function loadMultiTraditionPlan(page) {
  await page.goto(APP_URL);
  await page.waitForLoadState('domcontentloaded');
  await page.evaluate((fixture) => {
    Planner.loadPlan(fixture.plan, fixture.classes);
  }, MULTI_TRAD_FIXTURE);
  await page.waitForTimeout(300);
}

test.describe('C36-1: Merged tab appears and shows combined spells', () => {
  test('Merged tab button exists in tab bar', async ({ page }) => {
    await page.goto(APP_URL);
    await page.waitForLoadState('domcontentloaded');

    const mergedBtn = await page.$('[data-page="merged"]');
    expect(mergedBtn).not.toBeNull();

    const text = await mergedBtn.textContent();
    expect(text).toBe('Merged');
  });

  test('Merged page shows spells from multiple traditions after plan load', async ({ page }) => {
    const errors = [];
    page.on('pageerror', err => errors.push(err.message));

    await loadMultiTraditionPlan(page);

    // Switch to merged tab
    await page.click('[data-page="merged"]');
    await page.waitForTimeout(500);

    // Page should be active
    const isActive = await page.evaluate(() => {
      return document.getElementById('page-merged').classList.contains('active');
    });
    expect(isActive).toBe(true);

    // Should see spell names from both traditions
    const spellNames = await page.evaluate(() => {
      const cells = document.querySelectorAll('#page-merged .merged-slot-table .slot-spell-name');
      return Array.from(cells).map(c => c.textContent.replace('★', '').replace('↗', '').trim());
    });
    expect(spellNames).toContain('Fireball');
    expect(spellNames).toContain('Heal');

    // Tradition badges should be present
    const badges = await page.evaluate(() => {
      return document.querySelectorAll('#page-merged .tradition-circle').length;
    });
    expect(badges).toBeGreaterThan(0);

    // No JS errors
    expect(errors).toHaveLength(0);
  });
});

test.describe('C36-2: Merged coverage tracker shows combined tags', () => {
  test('coverage sidebar lights up tags from multiple traditions', async ({ page }) => {
    await loadMultiTraditionPlan(page);

    await page.click('[data-page="merged"]');
    await page.waitForTimeout(500);

    // Fireball contributes Ref + Multi + Fire; Heal contributes Auto-effect + Healing
    const litTags = await page.evaluate(() => {
      const lit = document.querySelectorAll('.sidebar .ctag.lit');
      return Array.from(lit).map(el => el.dataset.tag);
    });
    expect(litTags).toContain('Ref');
    expect(litTags).toContain('Fire');
    expect(litTags).toContain('Auto-effect');
    expect(litTags).toContain('Healing');
  });
});

test.describe('C36-3: Merged view is read-only', () => {
  test('no clear or delete buttons on merged page slots', async ({ page }) => {
    await loadMultiTraditionPlan(page);

    await page.click('[data-page="merged"]');
    await page.waitForTimeout(500);

    const actionBtns = await page.evaluate(() => {
      const btns = document.querySelectorAll('#page-merged .slot-clear-btn, #page-merged .slot-delete-btn');
      return btns.length;
    });
    expect(actionBtns).toBe(0);
  });
});

test.describe('C36-4: Merged level tabs only show populated levels', () => {
  test('empty plan shows no level tabs and empty message', async ({ page }) => {
    await page.goto(APP_URL);
    await page.waitForLoadState('domcontentloaded');

    await page.click('[data-page="merged"]');
    await page.waitForTimeout(300);

    const tabCount = await page.evaluate(() => {
      return document.querySelectorAll('#levelTabBar-merged .level-tab').length;
    });
    expect(tabCount).toBe(0);

    const emptyVisible = await page.evaluate(() => {
      const msg = document.getElementById('merged-empty-msg');
      return msg && msg.style.display !== 'none';
    });
    expect(emptyVisible).toBe(true);
  });

  test('loaded plan shows only level tabs for populated levels', async ({ page }) => {
    await loadMultiTraditionPlan(page);

    await page.click('[data-page="merged"]');
    await page.waitForTimeout(500);

    const tabLevels = await page.evaluate(() => {
      const tabs = document.querySelectorAll('#levelTabBar-merged .level-tab');
      return Array.from(tabs).map(t => parseInt(t.dataset.level));
    });
    // Fixture has spells only at level 5
    expect(tabLevels).toEqual([5]);
  });
});

test.describe('C36-5: Filter mode disabled on merged page', () => {
  test('filter controls are hidden when on merged tab', async ({ page }) => {
    await loadMultiTraditionPlan(page);

    await page.click('[data-page="merged"]');
    await page.waitForTimeout(500);

    const filtersHidden = await page.evaluate(() => {
      const sidebar = document.querySelector('.sidebar');
      return sidebar && sidebar.classList.contains('merged-filters-hidden');
    });
    expect(filtersHidden).toBe(true);

    // Switching back to a tradition page restores filters
    await page.click('[data-page="arcane"]');
    await page.waitForTimeout(300);

    const filtersRestored = await page.evaluate(() => {
      const sidebar = document.querySelector('.sidebar');
      return sidebar && !sidebar.classList.contains('merged-filters-hidden');
    });
    expect(filtersRestored).toBe(true);
  });
});
