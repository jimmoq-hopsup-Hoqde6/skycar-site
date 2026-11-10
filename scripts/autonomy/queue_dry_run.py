#!/usr/bin/env python3
"""Skycar staged agent queue planner. No network, credentials, code execution, or writes."""
import argparse
import json
from pathlib import Path

ROLES = ("project-manager", "product", "ux-ui", "mobile", "backend", "ai-specialist", "qa", "security", "release")
ROUTES = {
    "backlog": "project-manager", "specified": "product", "design": "ux-ui",
    "mobile-ready": "mobile", "backend-ready": "backend", "ai-ready": "ai-specialist",
    "ci-passed": "qa", "qa-passed": "security", "security-passed": "release"
}
BLOCKED = {"production", "payment", "customer-data", "secrets", "deployment", "permission-change"}
def plan(issue):
    labels = set(issue.get("labels", []))
    if labels & BLOCKED:
        return {"issue": issue.get("number"), "decision": "BLOCK", "reason": "protected task"}
    if "agent-approved" not in labels:
        return {"issue": issue.get("number"), "decision": "SKIP", "reason": "not approved for agent queue"}
    matched = [ROUTES[x] for x in ROUTES if x in labels]
    if len(matched) != 1:
        return {"issue": issue.get("number"), "decision": "BLOCK", "reason": "exactly one stage label required"}
    return {"issue": issue.get("number"), "decision": "DRY_RUN_ONLY", "agent": matched[0],
            "reason": "staged; no executor connected"}

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("issues_json", type=Path)
    args = parser.parse_args()
    data = json.loads(args.issues_json.read_text(encoding="utf-8"))
    if not isinstance(data, list):
        parser.error("Expected JSON list of issue snapshots")
    print(json.dumps({"mode": "dry-run", "roles": list(ROLES), "tasks": [plan(i) for i in data]}, indent=2))
if __name__ == "__main__":
    main()
