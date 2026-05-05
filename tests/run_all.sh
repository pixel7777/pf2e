#!/bin/bash
# PF2e Spell Planner — Regression Test Suite
# Run all tests. Exit 0 = all pass, non-zero = failures.
# Usage: cd pf2e-spell-planner && bash tests/run_all.sh

set -e

echo "=== Pipeline Tests ==="
py tests/test_pipeline.py

echo ""
echo "=== DOM Smoke Tests ==="
npx playwright test tests/test_dom.js

echo ""
echo "✓ All tests passed"
