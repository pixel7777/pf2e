// @ts-check
const { test, expect } = require('@playwright/test');
const path = require('path');

const APP_URL = 'file:///' + path.resolve(__dirname, '..', 'index.html').replace(/\\/g, '/');

// Helper: navigate to arcane tradition with a level selected and browser visible
async function setupArcaneWithSpells(page) {
  await page.goto(APP_URL);
  await page.waitForLoadState('domcontentloaded');

  // Click Arcane tab (initTradition auto-sets wizard class and builds level tabs)
  await page.click('[data-page="arcane"]');
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

test.describe('C21b-1: Silver Bullets tab shows spells', () => {
  test('Silver Bullets tab renders with >0 spells for Arcane', async ({ page }) => {
    await page.goto(APP_URL);
    await page.waitForLoadState('domcontentloaded');

    await page.click('[data-page="arcane"]');
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

    // Click Silver Bullets role tab
    await page.evaluate(() => {
      const tabs = document.querySelectorAll('#spellBrowser-arcane .role-tab, .role-tab');
      for (const tab of tabs) {
        if (tab.dataset.role === 'silverBullets') { tab.click(); break; }
      }
    });
    await page.waitForTimeout(300);

    const rowCount = await page.evaluate(() => {
      const table = document.querySelector('#spellTable-arcane');
      if (!table) return 0;
      return table.querySelectorAll('tbody tr').length;
    });
    expect(rowCount).toBeGreaterThan(0);
  });
});
