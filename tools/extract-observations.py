"""
Observation Extractor: reads Mathfinder distillation files, sends each to
Claude Sonnet via the Anthropic API, extracts spell-specific observations,
category-level observations, and replacement chain signals.

Cycle 19 — Pass 1 (source-centric) of the Decision 013 pipeline.

Usage:
    py tools/extract-observations.py --source-dir <path> [options]
    py tools/extract-observations.py --source-dir <path> --dry-run
    py tools/extract-observations.py --source-dir <path> --single "Acid Grip is UNDERRATED.md"
"""

import argparse
import json
import os
import sys
import time
import urllib.error
import urllib.request
from datetime import datetime, timezone

OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions"

SYSTEM_PROMPT = """You are extracting structured spell evaluation data from a Pathfinder 2e analysis document. Your job is to identify every spell mentioned with an evaluative opinion, extract category-level observations that apply to classes of spells, and flag replacement/upgrade relationships between spells.

Output valid JSON only. No markdown, no commentary, no explanation outside the JSON structure."""

USER_PROMPT_TEMPLATE = """Extract observations from the following Mathfinder video distillation.

SOURCE FILE: {filename}

EXTRACTION RULES:

1. SPELL-SPECIFIC OBSERVATIONS
For every spell named with an accompanying evaluation, recommendation, or tactical insight, extract:
- spell_name: Exact spell name as written (preserve capitalization)
- observation: Mathfinder's conclusion or recommendation (1-3 sentences). Capture the actionable take, not supporting math.
- context: Brief tag for what angle this observation covers (e.g., "AoE damage", "force movement", "boss single-target", "fire-and-forget", "combo piece")

CAPTURE: evaluations ("criminally underrated", "premiere AoE"), tactical advice ("use from low-rank slots"), comparative takes ("better than X in Y"), warnings ("trap option against bosses"), role/usage guidance.
DO NOT CAPTURE: DPR calculations, probability math, general framework explanations (those go in category_observations), video production context.

If a spell appears in a table with an Evaluation column, the evaluation IS the observation.
If a spell appears in prose with surrounding evaluative context, extract the sentence(s) that contain the judgment.

2. CATEGORY-LEVEL OBSERVATIONS
Statements that apply to CLASSES of spells rather than individual named spells:
- applies_to: What category this applies to, using one of these forms:
  - {{"tag": "<tag_name>"}} — for spell tags (e.g., "basic_save", "Sustain-action", "Multi")
  - {{"role": "<role_name>"}} — for roles (damage, debuff, buff, control, utility, healing, reactions, oneAction, prebuffs, silverBullets)
  - {{"trait": "<trait_name>"}} — for PF2e traits (Fire, Mental, Incapacitation, etc.)
  - {{"property": "<field>", "value": "<val>"}} — for specific spell properties (e.g., {{"property": "save", "value": "reflex"}})
  - {{"custom": "<description>"}} — if none of the above fit cleanly
- observation: The category-level insight (1-2 sentences)

Examples of category observations: "All basic-save spells have a guaranteed damage floor", "Sustained spells shift DPR advantage toward longer combats", "Incapacitation spells are traps against bosses."

3. CHAIN SIGNALS
When Mathfinder explicitly states that one spell replaces, upgrades to, or is outclassed by another:
- spell_a: The earlier/lower-rank spell
- spell_b: The later/higher-rank spell
- relationship: One of "replaces", "upgrades_to", "outclassed_by", "competes_with"

Only extract when Mathfinder EXPLICITLY states the relationship. Do not infer chains from rank proximity alone.

OUTPUT FORMAT:
{{
  "source_file": "{filename}",
  "spell_observations": [
    {{"spell_name": "...", "observation": "...", "context": "..."}}
  ],
  "category_observations": [
    {{"applies_to": {{...}}, "observation": "..."}}
  ],
  "chain_signals": [
    {{"spell_a": "...", "spell_b": "...", "relationship": "..."}}
  ]
}}

---

DOCUMENT CONTENT:

{file_content}"""

VALID_RELATIONSHIPS = {"replaces", "upgrades_to", "outclassed_by", "competes_with"}
VALID_APPLIES_TO_KEYS = {"tag", "role", "trait", "property", "custom"}


def parse_args():
    parser = argparse.ArgumentParser(
        description="Extract Mathfinder observations from distillation files."
    )
    parser.add_argument(
        "--source-dir", required=True,
        help="Path to the distillation files directory"
    )
    parser.add_argument(
        "--output-dir", default="data/observations",
        help="Where to write output JSON files (default: data/observations)"
    )
    parser.add_argument(
        "--spell-data", default="data/spell-data.js",
        help="Path to spell-data.js for name resolution (default: data/spell-data.js)"
    )
    parser.add_argument(
        "--spell-json", default="source/spell.json",
        help="Path to source spell.json for cantrip/focus detection (default: source/spell.json)"
    )
    parser.add_argument(
        "--model", default="anthropic/claude-sonnet-4",
        help="OpenRouter model ID (default: anthropic/claude-sonnet-4)"
    )
    parser.add_argument(
        "--dry-run", action="store_true",
        help="Parse and validate inputs without making API calls"
    )
    parser.add_argument(
        "--single", metavar="FILENAME",
        help="Process only one file (filename only, not full path)"
    )
    return parser.parse_args()


def load_spell_data(path):
    """Parse spell-data.js and return spell list."""
    with open(path, encoding="utf-8") as f:
        data = f.read()

    lines = data.split("\n", 1)
    rest = lines[1] if lines[0].startswith("//") else data
    prefix = "window.SPELL_SCHEMA = "
    idx = rest.index(prefix)
    json_str = rest[idx + len(prefix):].rstrip().rstrip(";")
    obj = json.loads(json_str)
    return obj["spells"]


def load_source_spell_json(path):
    """Load source/spell.json for cantrip/focus spell detection."""
    with open(path, encoding="utf-8") as f:
        return json.load(f)


def build_name_index(spells):
    """Build a case-insensitive, apostrophe-normalized name → spell lookup."""
    index = {}
    for spell in spells:
        name = spell["name"]
        norm = normalize_name(name)
        index[norm] = spell
    return index


def normalize_name(name):
    """Normalize for matching: lowercase + straight apostrophes."""
    return name.lower().replace("‘", "'").replace("’", "'").replace("′", "'")


def build_source_spell_index(source_spells):
    """Build a name→entry index from source/spell.json for failure classification."""
    index = {}
    for entry in source_spells:
        norm = normalize_name(entry.get("name", ""))
        index[norm] = entry
    return index


def resolve_spell_name(spell_name, name_index):
    """Resolve a spell name to (aon_id, canonical_name) or (None, None)."""
    norm = normalize_name(spell_name)
    if norm in name_index:
        sp = name_index[norm]
        return sp["aonId"], sp["name"]
    return None, None


def classify_failure(spell_name, source_spell_index):
    """Classify why a spell name failed resolution."""
    norm = normalize_name(spell_name)
    if norm in source_spell_index:
        entry = source_spell_index[norm]
        spell_type = entry.get("spell_type", "")
        level = entry.get("level", 1)
        if spell_type == "Cantrip" or level == 0:
            return "cantrip"
        if spell_type == "Focus":
            return "focus_spell"
    known_legacy = {
        "acid arrow", "cone of cold", "magic missile", "mage armor",
        "mage hand", "ray of frost", "shocking grasp", "true strike",
        "phantom steed", "mirror image", "dispel magic", "dimension door",
        "black tentacles", "dominate", "feeblemind", "finger of death",
        "power word kill", "power word stun", "power word blind",
        "telekinetic projectile", "detect magic",
    }
    if norm in known_legacy:
        return "legacy_rename"
    return "no_match"


def validate_extraction(data, filename):
    """Validate LLM extraction output against schema. Returns (valid, errors)."""
    errors = []

    if not isinstance(data, dict):
        return False, ["Response is not a JSON object"]

    if data.get("source_file") != filename:
        errors.append(f"source_file mismatch: got '{data.get('source_file')}', expected '{filename}'")

    obs = data.get("spell_observations", [])
    if not isinstance(obs, list):
        errors.append("spell_observations is not an array")
    else:
        for i, entry in enumerate(obs):
            if not isinstance(entry, dict):
                errors.append(f"spell_observations[{i}] is not an object")
                continue
            if not entry.get("spell_name") or not isinstance(entry.get("spell_name"), str):
                errors.append(f"spell_observations[{i}].spell_name missing or empty")
            if not entry.get("observation") or not isinstance(entry.get("observation"), str):
                errors.append(f"spell_observations[{i}].observation missing or empty")
            if "context" not in entry or not isinstance(entry.get("context"), str):
                errors.append(f"spell_observations[{i}].context missing or not a string")

    cat_obs = data.get("category_observations", [])
    if not isinstance(cat_obs, list):
        errors.append("category_observations is not an array")
    else:
        for i, entry in enumerate(cat_obs):
            if not isinstance(entry, dict):
                errors.append(f"category_observations[{i}] is not an object")
                continue
            applies_to = entry.get("applies_to")
            if not isinstance(applies_to, dict):
                errors.append(f"category_observations[{i}].applies_to is not an object")
            else:
                keys = set(applies_to.keys())
                valid_keys = keys & VALID_APPLIES_TO_KEYS
                if len(valid_keys) == 0:
                    errors.append(f"category_observations[{i}].applies_to has no valid key")
                elif len(valid_keys) > 1 and "property" in valid_keys:
                    pass  # property has two sub-keys (property + value), that's valid
                elif len(keys) > 1 and "property" not in keys:
                    errors.append(f"category_observations[{i}].applies_to has multiple keys: {keys}")
            if not entry.get("observation") or not isinstance(entry.get("observation"), str):
                errors.append(f"category_observations[{i}].observation missing or empty")

    chains = data.get("chain_signals", [])
    if not isinstance(chains, list):
        errors.append("chain_signals is not an array")
    else:
        for i, entry in enumerate(chains):
            if not isinstance(entry, dict):
                errors.append(f"chain_signals[{i}] is not an object")
                continue
            if not entry.get("spell_a") or not isinstance(entry.get("spell_a"), str):
                errors.append(f"chain_signals[{i}].spell_a missing or empty")
            if not entry.get("spell_b") or not isinstance(entry.get("spell_b"), str):
                errors.append(f"chain_signals[{i}].spell_b missing or empty")
            rel = entry.get("relationship")
            if rel not in VALID_RELATIONSHIPS:
                errors.append(f"chain_signals[{i}].relationship '{rel}' not valid")

    return len(errors) == 0, errors


def estimate_tokens(text):
    """Rough token estimate: ~4 chars per token for English."""
    return len(text) // 4


def _strip_code_fences(text):
    """Strip markdown code fences if present."""
    text = text.strip()
    if text.startswith("```"):
        text = text.strip("`")
        if text.startswith("json"):
            text = text[4:].strip()
        if text.endswith("```"):
            text = text[:-3].strip()
    return text


def call_openrouter(api_key, model, messages, response_format_json=True):
    """Send a chat completion request to OpenRouter. Returns (content, usage) or raises."""
    payload = {
        "model": model,
        "messages": messages,
        "temperature": 0.0,
    }
    if response_format_json:
        payload["response_format"] = {"type": "json_object"}

    body = json.dumps(payload).encode("utf-8")
    req = urllib.request.Request(
        OPENROUTER_URL,
        data=body,
        headers={
            "Authorization": "Bearer " + api_key,
            "Content-Type": "application/json",
            "HTTP-Referer": "https://github.com/pixel7777/pf2e",
            "X-Title": "pf2e-spell-planner observation extractor",
        },
        method="POST",
    )
    with urllib.request.urlopen(req, timeout=180) as resp:
        data = json.loads(resp.read().decode("utf-8"))

    content = data["choices"][0]["message"]["content"]
    usage = data.get("usage", {}) or {}
    return content, usage


def call_llm(api_key, model, filename, file_content):
    """Send extraction prompt to LLM, parse JSON, retry once on malformed JSON."""
    user_msg = USER_PROMPT_TEMPLATE.format(filename=filename, file_content=file_content)
    messages = [
        {"role": "system", "content": SYSTEM_PROMPT},
        {"role": "user", "content": user_msg},
    ]

    try:
        raw_text, _usage = call_openrouter(api_key, model, messages)
    except (urllib.error.HTTPError, urllib.error.URLError, KeyError, IndexError) as e:
        return None, f"API error: {e}"

    raw_text_clean = _strip_code_fences(raw_text)
    try:
        return json.loads(raw_text_clean), None
    except json.JSONDecodeError:
        pass

    # Retry once with correction message
    retry_messages = messages + [
        {"role": "assistant", "content": raw_text},
        {"role": "user", "content": "Your response was not valid JSON. Please output ONLY valid JSON matching the schema."},
    ]
    try:
        retry_text, _usage = call_openrouter(api_key, model, retry_messages)
    except (urllib.error.HTTPError, urllib.error.URLError, KeyError, IndexError) as e:
        return None, f"Retry API error: {e}"

    retry_text_clean = _strip_code_fences(retry_text)
    try:
        return json.loads(retry_text_clean), None
    except json.JSONDecodeError as e:
        return None, f"Malformed JSON after retry: {e}"


def process_file(api_key, model, filename, file_content, name_index, source_spell_index):
    """Process a single distillation file. Returns (result_dict, error_string)."""
    data, error = call_llm(api_key, model, filename, file_content)
    if error:
        return None, error

    valid, validation_errors = validate_extraction(data, filename)
    if not valid:
        return None, f"Validation failed: {'; '.join(validation_errors[:5])}"

    # Run name resolution on spell observations
    resolved_obs = []
    unresolved_obs = []
    for obs in data.get("spell_observations", []):
        spell_name = obs["spell_name"]
        aon_id, canonical_name = resolve_spell_name(spell_name, name_index)
        if aon_id is not None:
            resolved_obs.append({
                "aon_id": aon_id,
                "canonical_name": canonical_name,
                "original_name": spell_name,
                "source": filename,
                "observation": obs["observation"],
                "context": obs["context"],
            })
        else:
            reason = classify_failure(spell_name, source_spell_index)
            unresolved_obs.append({
                "spell_name": spell_name,
                "source": filename,
                "observation": obs["observation"],
                "context": obs["context"],
                "reason": reason,
            })

    # Resolve chain signal spell names
    chain_signals = []
    for chain in data.get("chain_signals", []):
        a_id, _ = resolve_spell_name(chain["spell_a"], name_index)
        b_id, _ = resolve_spell_name(chain["spell_b"], name_index)
        chain_signals.append({
            "spell_a": chain["spell_a"],
            "spell_b": chain["spell_b"],
            "spell_a_aon_id": a_id,
            "spell_b_aon_id": b_id,
            "relationship": chain["relationship"],
            "source": filename,
        })

    category_observations = []
    for cat in data.get("category_observations", []):
        category_observations.append({
            "source": filename,
            "applies_to": cat["applies_to"],
            "observation": cat["observation"],
        })

    return {
        "resolved": resolved_obs,
        "unresolved": unresolved_obs,
        "category_observations": category_observations,
        "chain_signals": chain_signals,
        "spell_observation_count": len(data.get("spell_observations", [])),
    }, None


def build_output_files(all_results):
    """Assemble the 4 output JSON structures from accumulated per-file results."""
    now = datetime.now(timezone.utc).strftime("%Y-%m-%d")

    # raw_observations.json
    spells_by_id = {}
    all_unresolved = []
    source_count = len(all_results)

    for result in all_results:
        for obs in result["resolved"]:
            aid = str(obs["aon_id"])
            if aid not in spells_by_id:
                spells_by_id[aid] = {
                    "name": obs["canonical_name"],
                    "observations": []
                }
            spells_by_id[aid]["observations"].append({
                "source": obs["source"],
                "observation": obs["observation"],
                "context": obs["context"],
            })
        for obs in result["unresolved"]:
            all_unresolved.append({
                "spell_name": obs["spell_name"],
                "source": obs["source"],
                "observation": obs["observation"],
                "context": obs["context"],
            })

    raw_observations = {
        "version": "1.0.0",
        "generated": now,
        "source_file_count": source_count,
        "spell_count": len(spells_by_id),
        "spells": spells_by_id,
        "unresolved": all_unresolved,
    }

    # category_observations.json
    all_cat_obs = []
    for result in all_results:
        all_cat_obs.extend(result["category_observations"])

    category_observations = {
        "version": "1.0.0",
        "generated": now,
        "count": len(all_cat_obs),
        "observations": all_cat_obs,
    }

    # chain_signals.json
    all_chains = []
    for result in all_results:
        all_chains.extend(result["chain_signals"])

    chain_signals = {
        "version": "1.0.0",
        "generated": now,
        "count": len(all_chains),
        "signals": all_chains,
    }

    # resolution_failures.json
    all_failures = []
    for result in all_results:
        for obs in result["unresolved"]:
            all_failures.append({
                "spell_name": obs["spell_name"],
                "source": obs["source"],
                "observation": obs["observation"],
                "reason": obs["reason"],
            })

    resolution_failures = {
        "version": "1.0.0",
        "generated": now,
        "count": len(all_failures),
        "failures": all_failures,
    }

    return raw_observations, category_observations, chain_signals, resolution_failures


def write_output(output_dir, raw_obs, cat_obs, chains, failures):
    """Write the 4 output JSON files."""
    os.makedirs(output_dir, exist_ok=True)

    files = {
        "raw_observations.json": raw_obs,
        "category_observations.json": cat_obs,
        "chain_signals.json": chains,
        "resolution_failures.json": failures,
    }

    for name, data in files.items():
        path = os.path.join(output_dir, name)
        with open(path, "w", encoding="utf-8") as f:
            json.dump(data, f, indent=2, ensure_ascii=False)
        print(f"  Wrote {path} ({data.get('count', data.get('spell_count', '?'))} entries)")


def main():
    args = parse_args()

    # Validate source directory
    if not os.path.isdir(args.source_dir):
        print(f"ERROR: Source directory not found: {args.source_dir}")
        sys.exit(1)

    md_files = sorted([f for f in os.listdir(args.source_dir) if f.endswith(".md")])
    if not md_files:
        print(f"ERROR: No .md files found in {args.source_dir}")
        sys.exit(1)

    # Filter to single file if requested
    if args.single:
        if args.single not in md_files:
            print(f"ERROR: File '{args.single}' not found in {args.source_dir}")
            print(f"  Available: {', '.join(md_files[:5])}...")
            sys.exit(1)
        md_files = [args.single]

    # Load spell data for name resolution
    if not os.path.exists(args.spell_data):
        print(f"ERROR: spell-data.js not found: {args.spell_data}")
        sys.exit(1)

    spells = load_spell_data(args.spell_data)
    name_index = build_name_index(spells)
    print(f"Loaded {len(spells)} spells from {args.spell_data}")

    # Load source/spell.json for failure classification
    source_spell_index = {}
    if os.path.exists(args.spell_json):
        source_spells = load_source_spell_json(args.spell_json)
        source_spell_index = build_source_spell_index(source_spells)
        print(f"Loaded {len(source_spells)} entries from {args.spell_json} for failure classification")

    # Estimate tokens
    total_tokens = 0
    print(f"\nFiles to process: {len(md_files)}")
    for f in md_files:
        path = os.path.join(args.source_dir, f)
        content = open(path, encoding="utf-8").read()
        tokens = estimate_tokens(content)
        total_tokens += tokens
        if args.dry_run:
            print(f"  {f}: ~{tokens:,} input tokens ({len(content):,} chars)")

    prompt_overhead = estimate_tokens(SYSTEM_PROMPT + USER_PROMPT_TEMPLATE) * len(md_files)
    total_with_overhead = total_tokens + prompt_overhead
    estimated_output = 2000 * len(md_files)

    print(f"\nEstimated total input tokens: ~{total_with_overhead:,}")
    print(f"Estimated total output tokens: ~{estimated_output:,}")
    est_cost = (total_with_overhead * 3 / 1_000_000) + (estimated_output * 15 / 1_000_000)
    print(f"Estimated cost (Sonnet): ~${est_cost:.2f}")

    if args.dry_run:
        print("\n--dry-run: No API calls made.")
        sys.exit(0)

    # Check API key (OpenRouter, consistent with populate-spell-data.py)
    api_key = os.environ.get("OPENROUTER_API_KEY") or os.environ.get("ANTHROPIC_API_KEY")
    if not api_key:
        print("\nERROR: OPENROUTER_API_KEY environment variable is not set.")
        print("Set it with: set OPENROUTER_API_KEY=your-key-here (Windows)")
        print("         or: export OPENROUTER_API_KEY=your-key-here (Linux/Mac)")
        sys.exit(1)

    # Process files
    all_results = []
    failed_files = []
    zero_observation_files = []

    for i, filename in enumerate(md_files):
        path = os.path.join(args.source_dir, filename)
        content = open(path, encoding="utf-8").read()

        print(f"\n[{i+1}/{len(md_files)}] Processing: {filename}")
        start = time.time()

        result, error = process_file(
            api_key, args.model, filename, content,
            name_index, source_spell_index
        )

        elapsed = time.time() - start

        if error:
            print(f"  FAILED ({elapsed:.1f}s): {error}")
            failed_files.append((filename, error))
            continue

        obs_count = result["spell_observation_count"]
        resolved = len(result["resolved"])
        unresolved = len(result["unresolved"])
        cats = len(result["category_observations"])
        chains = len(result["chain_signals"])

        print(f"  OK ({elapsed:.1f}s): {obs_count} spell obs ({resolved} resolved, {unresolved} unresolved), {cats} category obs, {chains} chains")

        if obs_count == 0:
            zero_observation_files.append(filename)

        all_results.append(result)

        # --single mode: print to stdout, don't write files
        if args.single:
            output = {
                "source_file": filename,
                "resolved_observations": result["resolved"],
                "unresolved_observations": result["unresolved"],
                "category_observations": result["category_observations"],
                "chain_signals": result["chain_signals"],
            }
            print("\n" + json.dumps(output, indent=2, ensure_ascii=False))
            sys.exit(0)

    # Build and write output files
    if all_results:
        print("\n--- Writing output files ---")
        raw_obs, cat_obs, chains, failures = build_output_files(all_results)
        write_output(args.output_dir, raw_obs, cat_obs, chains, failures)

    # Summary
    total_spell_obs = sum(r["spell_observation_count"] for r in all_results)
    total_resolved = sum(len(r["resolved"]) for r in all_results)
    total_unresolved = sum(len(r["unresolved"]) for r in all_results)
    total_cats = sum(len(r["category_observations"]) for r in all_results)
    total_chains = sum(len(r["chain_signals"]) for r in all_results)

    # Count unique resolved spells
    unique_spells = set()
    for r in all_results:
        for obs in r["resolved"]:
            unique_spells.add(obs["aon_id"])

    print("\n=== EXTRACTION SUMMARY ===")
    print(f"Files processed: {len(all_results)}/{len(md_files)}")
    print(f"Total spell observations: {total_spell_obs} ({total_resolved} resolved, {total_unresolved} unresolved)")
    print(f"Unique resolved spells: {len(unique_spells)}")
    print(f"Category observations: {total_cats}")
    print(f"Chain signals: {total_chains}")
    print(f"Resolution failure rate: {total_unresolved}/{total_spell_obs} ({100*total_unresolved/max(1,total_spell_obs):.1f}%)")

    if failed_files:
        print(f"\nFailed files ({len(failed_files)}):")
        for fname, err in failed_files:
            print(f"  {fname}: {err}")

    if zero_observation_files:
        print(f"\nZero-observation files ({len(zero_observation_files)}):")
        for fname in zero_observation_files:
            print(f"  {fname}")

    # Exit code
    if failed_files and all_results:
        sys.exit(2)  # partial success
    elif failed_files and not all_results:
        sys.exit(1)  # total failure
    else:
        sys.exit(0)


if __name__ == "__main__":
    main()
