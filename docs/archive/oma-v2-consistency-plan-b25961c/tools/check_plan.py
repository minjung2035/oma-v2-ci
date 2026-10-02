#!/usr/bin/env python3
"""Validate this planning package only. Never run/import OMA product code."""
from __future__ import annotations
import argparse
import hashlib
import json
import re
from pathlib import Path
from urllib.parse import unquote


def validate(root: Path) -> dict:
    errors: list[str] = []
    plan = json.loads((root / "plan.json").read_text(encoding="utf-8"))
    tasks = plan["tasks"]
    tests = plan["tests"]
    sources = plan["sources"]
    task_by = {t["id"]: t for t in tasks}
    test_by = {t["id"]: t for t in tests}
    source_by = {s["id"]: s for s in sources}
    decisions = {d["id"]: d for d in plan["decisions"]}
    for label, items, ids in (("task", tasks, task_by), ("test", tests, test_by), ("source", sources, source_by)):
        if len(items) != len(ids):
            errors.append(f"Duplicate {label} IDs")
    expected_tasks = {f"WP{i:02d}" for i in range(33)}
    if set(task_by) != expected_tasks:
        errors.append("Required WP00..WP32 set differs")
    invs = set(plan["invariants"])
    used_tests: list[str] = []
    substeps = 0
    for task in tasks:
        tid = task["id"]
        path = root / task["document"]
        if not path.is_file():
            errors.append(f"{tid}: document missing")
            continue
        body = path.read_text(encoding="utf-8")
        if not body.startswith(f"# {tid} —"):
            errors.append(f"{tid}: document title mismatch")
        for number in range(1, 8):
            if f"## {number}. " not in body:
                errors.append(f"{tid}: section {number} missing")
        steps = re.findall(rf"^### {tid}\.(\d{{2}}) —", body, re.M)
        if steps != [f"{n:02d}" for n in range(1, len(steps) + 1)]:
            errors.append(f"{tid}: invalid substep sequence")
        if not steps:
            errors.append(f"{tid}: no implementation substeps")
        substeps += len(steps)
        for dep in task["depends_on"]:
            if dep not in task_by or dep == tid:
                errors.append(f"{tid}: invalid dependency {dep}")
        if len(task["depends_on"]) != len(set(task["depends_on"])):
            errors.append(f"{tid}: duplicate dependencies")
        for inv in task["invariants"]:
            if inv not in invs:
                errors.append(f"{tid}: unknown invariant {inv}")
        for source in task["sources"]:
            if source not in source_by:
                errors.append(f"{tid}: unknown source {source}")
        for dec in task["decision_dependencies"]:
            if dec not in decisions:
                errors.append(f"{tid}: unknown decision {dec}")
        for test in task["tests"]:
            used_tests.append(test)
            if test not in test_by:
                errors.append(f"{tid}: unknown test {test}")
            elif f"### {test} —" not in body:
                errors.append(f"{tid}: test details missing for {test}")
    if set(used_tests) != set(test_by) or len(used_tests) != len(set(used_tests)):
        errors.append("Each test must have exactly one task owner")
    for test in tests:
        for field in ("title", "fixture", "action", "oracle", "negative_control", "lane", "status"):
            if not test.get(field):
                errors.append(f"{test['id']}: missing {field}")
    remaining = {t["id"]: set(t["depends_on"]) for t in tasks}
    done: set[str] = set()
    order: list[str] = []
    while remaining:
        ready = sorted(k for k, v in remaining.items() if v <= done)
        if not ready:
            errors.append("Dependency cycle or unresolved dependency: " + ", ".join(sorted(remaining)))
            break
        for tid in ready:
            order.append(tid)
            done.add(tid)
            del remaining[tid]
    if order != plan["recommended_order"]:
        errors.append("Recommended order differs from dependency graph")
    inventory = (root / "production-inventory.txt").read_text(encoding="utf-8").splitlines()
    assigned = plan["production_review_assignments"]
    if len(inventory) != len(set(inventory)):
        errors.append("Duplicate inventory paths")
    if sorted(r["path"] for r in assigned) != sorted(inventory):
        errors.append("Production assignment is not the exact inventory")
    for row in assigned:
        tid = row["primary_review_task"]
        if tid not in task_by or row["path"] not in task_by[tid]["primary_review_files"]:
            errors.append("Missing primary task match: " + row["path"])
        ref = row["source_reference"]
        if ref and (ref not in source_by or source_by[ref]["path"] != row["path"]):
            errors.append("Wrong source evidence: " + row["path"])
    for finding, owner_tasks in plan["finding_to_tasks"].items():
        if not owner_tasks or any(t not in task_by for t in owner_tasks):
            errors.append("Invalid finding mapping: " + finding)
    for decision in decisions.values():
        if not (root / decision["document"]).is_file():
            errors.append("Missing ADR: " + decision["id"])
    for source in sources:
        if source["commit"] != plan["baseline_commit"]:
            errors.append("Source SHA mismatch: " + source["id"])
        if "token=" in source["url"].lower():
            errors.append("Credential-bearing source URL: " + source["id"])
    # All local Markdown links must resolve. Source anchors are explicit HTML IDs.
    md_files = sorted(root.rglob("*.md"))
    checked_links = 0
    for path in md_files:
        body = path.read_text(encoding="utf-8")
        fences = re.findall(r"^```.*$", body, re.M)
        if len(fences) % 2:
            errors.append("Unbalanced code fences: " + str(path.relative_to(root)))
        without_code = re.sub(r"```.*?```", "", body, flags=re.S)
        for target in re.findall(r"\[[^\]]*\]\(([^\s)]+)\)", without_code):
            if target.startswith(("https://", "http://", "mailto:")):
                continue
            name, _, anchor = target.partition("#")
            destination = (path.parent / unquote(name)).resolve() if name else path
            try:
                destination.relative_to(root.resolve())
            except ValueError:
                errors.append("Local link escapes package: " + target)
                continue
            checked_links += 1
            if not destination.is_file():
                errors.append(f"Broken local link in {path.relative_to(root)}: {target}")
                continue
            if anchor and destination.suffix == ".md":
                other = destination.read_text(encoding="utf-8")
                if f'id="{anchor}"' not in other:
                    errors.append(f"Unknown explicit anchor in {path.relative_to(root)}: {target}")
    if substeps != plan["summary"]["implementation_substeps"]:
        errors.append("Substep count mismatch")
    for field, actual in (("work_packages", len(tasks)), ("test_specifications", len(tests)),
                          ("production_inventory_paths", len(inventory)), ("source_references", len(sources))):
        if plan["summary"][field] != actual:
            errors.append("Summary count mismatch: " + field)
    return {
        "scope": "PLAN_STRUCTURE_ONLY_NOT_PRODUCT_VERIFICATION",
        "status": "PASS" if not errors else "FAIL",
        "baseline_commit": plan["baseline_commit"],
        "plan_json_sha256": hashlib.sha256((root / "plan.json").read_bytes()).hexdigest(),
        "counts": {"work_packages": len(tasks), "implementation_substeps": substeps,
                   "test_specifications": len(tests), "production_inventory_paths": len(inventory),
                   "source_references": len(sources), "markdown_documents": len(md_files),
                   "local_links_checked": checked_links},
        "checks": ["unique IDs", "complete task sections", "consecutive substeps", "valid dependencies", "acyclic graph",
                   "test owner and specification fields", "invariant/source/decision references", "exact production assignment",
                   "pinned source SHA", "no tokenized URLs", "local links and explicit anchors", "paired code fences", "summary counts"],
        "product_implementation": "NOT_STARTED", "product_tests": "NOT_RUN", "errors": errors,
    }


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--root", type=Path, default=Path(__file__).resolve().parents[1])
    parser.add_argument("--write-report", action="store_true", help="Write PLAN-QA.json in the package root")
    args = parser.parse_args()
    try:
        report = validate(args.root.resolve())
    except (OSError, ValueError, KeyError, TypeError) as exc:
        print(json.dumps({"scope": "PLAN_STRUCTURE_ONLY_NOT_PRODUCT_VERIFICATION", "status": "FAIL", "error": str(exc)}, ensure_ascii=False, indent=2))
        return 1
    rendered = json.dumps(report, ensure_ascii=False, indent=2) + "\n"
    if args.write_report:
        (args.root / "PLAN-QA.json").write_text(rendered, encoding="utf-8")
    print(rendered, end="")
    return 0 if report["status"] == "PASS" else 1


if __name__ == "__main__":
    raise SystemExit(main())
