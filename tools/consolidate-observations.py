"""
Observation Consolidation: applies Tier 1 category observations to spells,
synthesizes mathfinder_summary via LLM, and produces consolidated.json.

Cycle 20 — Part B (Pass 2, spell-centric) of the Decision 013 pipeline.

Usage:
    py tools/consolidate-observations.py --observations data/observations/raw_observations.json --categories data/observations/category_routing.json --spell-data data/spell-data.js [--output data/observations/consolidated.json] [--dry-run] [--single <aon_id>]
"""

import argparse
import json
import os
import re
import sys
import time
import urllib.error
import urllib.request
from datetime import datetime, timezone

OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions"

SYSTEM_PROMPT = (
    "You are synthesizing spell evaluation advice for a Pathfinder 2e spell "
    "planner tool. Your output will be shown as a tooltip when users hover "
    "over a spell. Be concise, practical, and specific to this spell."
)

USER_PROMPT_TEMPLATE = """Synthesize a tooltip summary for the PF2e spell "{spell_name}" (Rank {native_rank}, {traditions}).

The following observations come from Mathfinder's video analysis. Some are direct evaluations of this spell; others are category-level advice that applies to spells with this spell's properties.

DIRECT OBSERVATIONS:
{direct_section}

CATEGORY OBSERVATIONS (applied because this spell matches the category):
{category_section}

RULES:
1. Write a single paragraph, maximum 100 words.
2. Lead with Mathfinder's verdict on this specific spell (from direct observations).
3. Incorporate relevant category insights only if they add actionable context.
4. If direct observations contradict each other, note the disagreement briefly.
5. Do NOT include the spell name in the summary (it's already in the tooltip header).
6. Do NOT include generic advice that applies to all spells.
7. Use second person ("use this when...") not third person ("this spell is...").
8. Output ONLY the summary paragraph. No JSON, no markdown, no labels."""


def parse_args():
    parser = argparse.ArgumentParser(
        description="Consolidate Mathfinder observations into per-spell data."
    )
    parser.add_argument("--observations", required=True, help="Path to raw_observations.json")
    parser.add_argument("--categories", required=True, help="Path to category_routing.json")
    parser.add_argument("--spell-data", required=True, help="Path to spell-data.js")
    parser.add_argument("--output", default="data/observations/consolidated.json",
                        help="Output path (default: data/observations/consolidated.json)")
    parser.add_argument("--model", default="anthropic/claude-sonnet-4",
                        help="OpenRouter model ID")
    parser.add_argument("--dry-run", action="store_true",
                        help="Count spells, estimate tokens, report stats. No API calls.")
    parser.add_argument("--single", metavar="AON_ID",
                        help="Process one spell only, print result to stdout.")
    return parser.parse_args()


def load_spell_data(path):
    with open(path, encoding="utf-8") as f:
        data = f.read()
    lines = data.split("\n", 1)
    rest = lines[1] if lines[0].startswith("//") else data
    prefix = "window.SPELL_SCHEMA = "
    idx = rest.index(prefix)
    json_str = rest[idx + len(prefix):].rstrip().rstrip(";")
    obj = json.loads(json_str)
    return {str(s["aonId"]): s for s in obj["spells"]}


def evaluate_match_rule(rule, spell):
    if " AND " in rule:
        parts = rule.split(" AND ")
        return all(evaluate_match_rule(p.strip(), spell) for p in parts)
    if " OR " in rule:
        parts = rule.split(" OR ")
        return any(evaluate_match_rule(p.strip(), spell) for p in parts)

    m = re.match(r'(\w+) is true', rule)
    if m:
        return bool(spell.get(m.group(1)))

    m = re.match(r'(\w+) contains "([^"]+)"', rule)
    if m:
        field, value = m.group(1), m.group(2)
        if field == "tag_fields":
            for f in ["defense_tags", "targeting_tags", "action_tags", "reliability_tags", "special_tags"]:
                if value in (spell.get(f) or []):
                    return True
            return False
        val = spell.get(field) or []
        if isinstance(val, list):
            return value in val
        return str(val) == value

    m = re.match(r'(\w+) is non-empty', rule)
    if m:
        val = spell.get(m.group(1))
        if isinstance(val, list):
            return len(val) > 0
        return val is not None and val != "" and val != "none"

    m = re.match(r'(\w+) is not "([^"]+)"', rule)
    if m:
        return str(spell.get(m.group(1), "")) != m.group(2)

    m = re.match(r'(\w+) is "([^"]+)"', rule)
    if m:
        return str(spell.get(m.group(1), "")) == m.group(2)

    return False


def apply_tier1_categories(routing_data, spell_index):
    """Apply Tier 1 category observations to matching spells.

    Returns:
        category_by_spell: {aon_id: [{source, observation, applies_to}, ...]}
        Updated routing entries with match_count.
    """
    category_by_spell = {}

    for entry in routing_data["routing"]:
        if entry["tier"] != "deterministic":
            continue

        rule = entry["match_rule"]
        match_count = 0
        for aon_id, spell in spell_index.items():
            if evaluate_match_rule(rule, spell):
                match_count += 1
                if aon_id not in category_by_spell:
                    category_by_spell[aon_id] = []
                category_by_spell[aon_id].append({
                    "source": entry["source"],
                    "observation": entry["observation"],
                    "source_type": "category",
                    "applies_to": entry["applies_to"],
                })
        entry["match_count"] = match_count

    return category_by_spell


def estimate_tokens(text):
    return len(text) // 4


def call_openrouter(api_key, model, messages):
    payload = {
        "model": model,
        "messages": messages,
        "temperature": 0.2,
    }
    body = json.dumps(payload).encode("utf-8")
    req = urllib.request.Request(
        OPENROUTER_URL,
        data=body,
        headers={
            "Authorization": "Bearer " + api_key,
            "Content-Type": "application/json",
            "HTTP-Referer": "https://github.com/pixel7777/pf2e",
            "X-Title": "pf2e-spell-planner consolidation",
        },
        method="POST",
    )
    with urllib.request.urlopen(req, timeout=120) as resp:
        data = json.loads(resp.read().decode("utf-8"))
    content = data["choices"][0]["message"]["content"]
    usage = data.get("usage", {}) or {}
    return content, usage


def synthesize_summary(api_key, model, spell_name, native_rank, traditions,
                       direct_obs, category_obs):
    """Call LLM to synthesize a summary. Returns (summary_text, usage)."""
    direct_lines = []
    for obs in direct_obs:
        direct_lines.append(f"- [{obs['source']}]: {obs['observation']}")
    direct_section = "\n".join(direct_lines) if direct_lines else "(none)"

    cat_lines = []
    for obs in category_obs:
        at = obs.get("applies_to", {})
        at_str = json.dumps(at) if at else "general"
        cat_lines.append(f"- [{obs['source']}, applies to: {at_str}]: {obs['observation']}")
    category_section = "\n".join(cat_lines) if cat_lines else "(none)"

    traditions_str = ", ".join(traditions)
    user_msg = USER_PROMPT_TEMPLATE.format(
        spell_name=spell_name,
        native_rank=native_rank,
        traditions=traditions_str,
        direct_section=direct_section,
        category_section=category_section,
    )

    messages = [
        {"role": "system", "content": SYSTEM_PROMPT},
        {"role": "user", "content": user_msg},
    ]

    content, usage = call_openrouter(api_key, model, messages)
    summary = content.strip().strip('"').strip("'")

    # Validate: non-empty
    if not summary:
        # Retry once
        retry_msgs = messages + [
            {"role": "assistant", "content": content},
            {"role": "user", "content": "Your response was empty. Please output ONLY the summary paragraph, maximum 100 words."},
        ]
        content, usage = call_openrouter(api_key, model, retry_msgs)
        summary = content.strip().strip('"').strip("'")

    return summary, usage


def word_count(text):
    return len(text.split())


def main():
    args = parse_args()

    api_key = os.environ.get("OPENROUTER_API_KEY", "")
    if not args.dry_run and not api_key:
        print("ERROR: OPENROUTER_API_KEY environment variable not set.")
        print("Set it to run LLM summary synthesis, or use --dry-run.")
        return 1

    with open(args.observations, encoding="utf-8") as f:
        raw_obs = json.load(f)
    with open(args.categories, encoding="utf-8") as f:
        routing_data = json.load(f)
    spell_index = load_spell_data(args.spell_data)

    # Step 0 + Step 1: Apply Tier 1 categories
    category_by_spell = apply_tier1_categories(routing_data, spell_index)

    # Write updated match_counts back to category_routing.json
    with open(args.categories, "w", encoding="utf-8") as f:
        json.dump(routing_data, f, indent=2, ensure_ascii=False)

    # Gather all spells with observations
    direct_spells = raw_obs["spells"]  # {aon_id: {name, observations: [...]}}

    # Build combined observation sets
    all_spell_ids = set(direct_spells.keys()) | set(category_by_spell.keys())

    # Spells with direct observations (get summaries)
    summary_spells = set(direct_spells.keys())
    # Spells with only category observations (no summary)
    category_only_spells = all_spell_ids - summary_spells

    # Value verification: check Tier 1 zero-match entries
    zero_matches = []
    for entry in routing_data["routing"]:
        if entry["tier"] == "deterministic" and entry.get("match_count", 0) == 0:
            zero_matches.append(entry)

    # Stats
    tier1_total_applications = sum(
        len(v) for v in category_by_spell.values()
    )
    spells_with_categories = len(category_by_spell)

    print(f"Raw observations: {len(direct_spells)} spells with direct observations")
    print(f"Category applications: {tier1_total_applications} across {spells_with_categories} spells")
    print(f"Category-only spells (no direct obs): {len(category_only_spells)}")
    print(f"Total spells with any data: {len(all_spell_ids)}")

    if zero_matches:
        print(f"\nValue verification: {len(zero_matches)} Tier 1 entries matched 0 spells:")
        for e in zero_matches:
            print(f"  [{e['index']}] {e['applies_to']} -> {e['match_rule']}")

    if args.dry_run:
        # Estimate token cost
        total_input_tokens = 0
        for aon_id in summary_spells:
            spell = spell_index.get(aon_id)
            if not spell:
                continue
            direct = direct_spells[aon_id]["observations"]
            cats = category_by_spell.get(aon_id, [])
            obs_text = " ".join(o["observation"] for o in direct + cats)
            total_input_tokens += estimate_tokens(SYSTEM_PROMPT) + estimate_tokens(obs_text) + 300
        est_cost = (total_input_tokens / 1_000_000) * 3.0 + (len(summary_spells) * 150 / 1_000_000) * 15.0
        print(f"\n--- DRY RUN ---")
        print(f"Spells needing summaries: {len(summary_spells)}")
        print(f"Estimated input tokens: ~{total_input_tokens:,}")
        print(f"Estimated cost: ~${est_cost:.2f}")
        return 0

    if args.single:
        aon_id = args.single
        if aon_id not in spell_index:
            print(f"ERROR: aon_id {aon_id} not found in spell-data.js")
            return 1
        spell = spell_index[aon_id]
        direct = direct_spells.get(aon_id, {}).get("observations", [])
        cats = category_by_spell.get(aon_id, [])
        if not direct:
            print(f"No direct observations for {spell['name']} (aon_id={aon_id}). Category-only spell.")
            if cats:
                print(f"Has {len(cats)} category observations.")
            return 0

        summary, usage = synthesize_summary(
            api_key, args.model, spell["name"], spell["native_rank"],
            spell["tradition"], direct, cats,
        )
        wc = word_count(summary)
        print(f"Spell: {spell['name']} (aon_id={aon_id}, rank {spell['native_rank']})")
        print(f"Direct observations: {len(direct)}")
        print(f"Category observations: {len(cats)}")
        print(f"Summary ({wc} words):")
        print(summary)
        if wc > 100:
            print(f"\nWARNING: Summary exceeds 100-word soft limit ({wc} words)")
        if usage:
            print(f"\nUsage: {usage}")
        return 0

    # Full run
    print(f"\nProcessing {len(summary_spells)} spells with direct observations...")

    consolidated = {}
    category_enriched = []
    warnings = []
    fallback_count = 0
    total_usage = {"prompt_tokens": 0, "completion_tokens": 0}

    for i, aon_id in enumerate(sorted(summary_spells, key=int)):
        spell = spell_index.get(aon_id)
        if not spell:
            warnings.append(f"aon_id {aon_id} not found in spell-data.js")
            continue

        direct = direct_spells[aon_id]["observations"]
        cats = category_by_spell.get(aon_id, [])

        all_obs = []
        for obs in direct:
            all_obs.append({
                "source": obs["source"],
                "observation": obs["observation"],
                "source_type": "direct",
            })
        for obs in cats:
            all_obs.append({
                "source": obs["source"],
                "observation": obs["observation"],
                "source_type": "category",
                "applies_to": obs["applies_to"],
            })

        # Synthesize summary
        try:
            summary, usage = synthesize_summary(
                api_key, args.model, spell["name"], spell["native_rank"],
                spell["tradition"], direct, cats,
            )
            if usage:
                total_usage["prompt_tokens"] += usage.get("prompt_tokens", 0)
                total_usage["completion_tokens"] += usage.get("completion_tokens", 0)
        except Exception as e:
            summary = None
            warnings.append(f"{spell['name']} (aon_id={aon_id}): API error: {e}")

        # Validate summary
        if not summary or not summary.strip():
            # Fallback to first direct observation
            summary = direct[0]["observation"]
            if word_count(summary) > 100:
                summary = " ".join(summary.split()[:100])
            fallback_count += 1
            warnings.append(f"{spell['name']}: Used fallback (first observation)")

        wc = word_count(summary)
        if wc > 100:
            warnings.append(f"{spell['name']}: Summary exceeds 100-word soft limit ({wc} words)")

        consolidated[aon_id] = {
            "name": spell["name"],
            "mathfinder_summary": summary,
            "mathfinder_reviewed": True,
            "observations": all_obs,
        }

        # Progress
        if (i + 1) % 10 == 0 or (i + 1) == len(summary_spells):
            print(f"  [{i+1}/{len(summary_spells)}] {spell['name']} ({wc}w)")

        # Rate limiting
        time.sleep(0.5)

    # Add category-only spells
    for aon_id in sorted(category_only_spells, key=lambda x: int(x) if x.isdigit() else 0):
        spell = spell_index.get(aon_id)
        if not spell:
            continue
        cats = category_by_spell.get(aon_id, [])
        all_obs = []
        for obs in cats:
            all_obs.append({
                "source": obs["source"],
                "observation": obs["observation"],
                "source_type": "category",
                "applies_to": obs["applies_to"],
            })
        consolidated[aon_id] = {
            "name": spell["name"],
            "mathfinder_summary": None,
            "mathfinder_reviewed": False,
            "observations": all_obs,
        }
        category_enriched.append(aon_id)

    # Write output
    output = {
        "version": "1.0.0",
        "generated": datetime.now(timezone.utc).strftime("%Y-%m-%d"),
        "summary_count": len(summary_spells),
        "category_only_count": len(category_enriched),
        "spells": consolidated,
        "category_enriched": category_enriched,
    }

    with open(args.output, "w", encoding="utf-8") as f:
        json.dump(output, f, indent=2, ensure_ascii=False)

    # Report
    print(f"\nConsolidation complete:")
    print(f"  Spells with summaries: {len(summary_spells)}")
    print(f"  Category-only spells: {len(category_enriched)}")
    print(f"  Fallbacks used: {fallback_count}")
    print(f"  Tokens: {total_usage['prompt_tokens']:,} input, {total_usage['completion_tokens']:,} output")
    est_cost = (
        total_usage["prompt_tokens"] / 1_000_000 * 3.0
        + total_usage["completion_tokens"] / 1_000_000 * 15.0
    )
    print(f"  Estimated cost: ~${est_cost:.2f}")

    if warnings:
        print(f"\nWarnings ({len(warnings)}):")
        for w in warnings:
            print(f"  - {w}")

    print(f"\nWrote {args.output}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
