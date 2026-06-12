# PF2e Spell Planner

A static-file web app for Pathfinder 2e prepared-caster spell selection planning.
Production: https://pf2e-spell-planner.pages.dev (deploys from `main`) ·
Dev preview: https://dev.pf2e-spell-planner.pages.dev (deploys from `dev`).

**This repo is intentionally documentation-light — the design authority lives in the
Obsidian vault** at `Apps/PF2e Spell Planner/` (sibling of this repo at the vault root).

Before editing spell data or anything in `tools/`, read:

- **`Apps/PF2e Spell Planner/Data Pipeline.md`** — the authoritative edit/rebuild/ship
  pipeline. Key rules: `data/spell-data.js` and `data/search-index.js` are generated
  (never hand-edit); if `tools/build-spell-data.py` runs at all, the full three-step
  rebuild is mandatory before commit; human corrections go in
  `data/editorial-overrides.json`.
- **`Apps/PF2e Spell Planner/CLAUDE.md`** — project working rules, branch model, testing.

Tests: `bash tests/run_all.sh` from the repo root (must be green before any cycle closes).
