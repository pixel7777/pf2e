"""
Shared spell filtering logic used by both build-spell-data.py and build-search-index.py.

Provides:
  - Era classification (remaster_core / legacy_core / other)
  - Rename map loading + filtering
  - Era deduplication
  - Base spell filtering (spell_type == "Spell", level >= 1)
"""

import json
import os
from collections import defaultdict

LEGACY_SOURCES = {
    "Core Rulebook",
    "Advanced Player's Guide",
    "Secrets of Magic",
    "Dark Archive",
    "Book of the Dead",
    "Guns & Gears",
    "Gods & Magic",
}
REMASTER_SOURCES = {
    "Player Core", "Player Core 2", "GM Core", "Monster Core",
    "Howl of the Wild", "War of Immortals",
    "Divine Mysteries", "Dark Archives (Remastered)",
    "Rage of Elements",
}


def era(spell):
    ps = spell.get("primary_source", "") or ""
    if ps in REMASTER_SOURCES:
        return "remaster_core"
    if ps in LEGACY_SOURCES:
        return "legacy_core"
    return "other"


def load_rename_map(legacy_renames_path):
    with open(legacy_renames_path, "r", encoding="utf-8") as f:
        entries = json.load(f)

    seen = set()
    by_old_lower = {}
    for entry in entries:
        for field in ("old_name", "new_name", "status"):
            if field not in entry:
                raise ValueError("legacy-renames.json entry missing field %r: %r" % (field, entry))
        key = entry["old_name"].lower()
        if key in seen:
            raise ValueError("legacy-renames.json: duplicate old_name %r" % entry["old_name"])
        seen.add(key)
        by_old_lower[key] = entry
    return by_old_lower, entries


def apply_rename_filter(rank_spells, rename_map):
    names_present_lower = {s.get("name", "").lower() for s in rank_spells}

    kept = []
    dropped = []
    warnings = []
    matched_old_names = set()

    for spell in rank_spells:
        name_lower = spell.get("name", "").lower()
        entry = rename_map.get(name_lower)
        if entry is None:
            kept.append(spell)
            continue
        if era(spell) != "legacy_core":
            kept.append(spell)
            matched_old_names.add(name_lower)
            continue
        if entry["new_name"].lower() not in names_present_lower:
            warnings.append(
                "rename target missing for %r -> %r (%s); keeping legacy entry %s" % (
                    entry["old_name"], entry["new_name"], entry["status"], spell.get("id", "?"),
                )
            )
            kept.append(spell)
            matched_old_names.add(name_lower)
            continue
        dropped.append((entry["old_name"], entry["new_name"], entry["status"], spell.get("id", "")))
        matched_old_names.add(name_lower)

    unmatched = sorted(
        rename_map[k]["old_name"]
        for k in rename_map.keys()
        if k not in matched_old_names
    )
    return kept, dropped, warnings, unmatched


def dedupe_by_era(rank_spells):
    by_name = defaultdict(list)
    for s in rank_spells:
        by_name[s.get("name", "")].append(s)

    era_priority = {"remaster_core": 2, "legacy_core": 1, "other": 0}

    def aon_int(s):
        sid = s.get("id", "") or ""
        if sid.startswith("spell-"):
            try:
                return int(sid[6:])
            except ValueError:
                return 0
        return 0

    kept = []
    dropped = []
    for name, group in by_name.items():
        if len(group) == 1:
            kept.append(group[0])
            continue
        ranked = sorted(group, key=lambda s: (-era_priority[era(s)], -aon_int(s)))
        winner = ranked[0]
        kept.append(winner)
        for loser in ranked[1:]:
            dropped.append((
                name,
                loser.get("id", ""),
                winner.get("id", ""),
                era(loser),
                era(winner),
            ))
    return kept, dropped


def filter_rank_spells(all_spells):
    return [
        s for s in all_spells
        if s.get("spell_type") == "Spell" and s.get("level", 0) >= 1
    ]


def load_and_filter_spells(spell_json_path, legacy_renames_path, verbose=False):
    """Full pipeline: load spell.json, filter rank spells, apply rename filter, era dedupe.
    Returns the final list of filtered spell dicts.
    """
    with open(spell_json_path, "r", encoding="utf-8") as f:
        all_spells = json.load(f)

    if verbose:
        print("  %d total spells loaded" % len(all_spells))

    rank_spells = filter_rank_spells(all_spells)
    if verbose:
        print("  %d rank spells after filtering (spell_type='Spell', level>=1)" % len(rank_spells))

    rename_map, rename_entries = load_rename_map(legacy_renames_path)
    if verbose:
        print("  %d rename entries loaded" % len(rename_entries))

    pre_rename_count = len(rank_spells)
    rank_spells, rename_dropped, rename_warnings, rename_unmatched = apply_rename_filter(rank_spells, rename_map)
    if verbose:
        print("  %d -> %d after rename filter (%d legacy entries dropped)" % (
            pre_rename_count, len(rank_spells), len(rename_dropped)))

    pre_count = len(rank_spells)
    rank_spells, era_dropped = dedupe_by_era(rank_spells)
    if verbose:
        print("  %d -> %d after era dedupe (%d duplicates dropped)" % (
            pre_count, len(rank_spells), len(era_dropped)))

    return rank_spells
