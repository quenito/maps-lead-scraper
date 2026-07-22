---
task_id: dedup-remediation-nsw-trades-v1
agent: jack
session_id: auto-relaunch-2026-07-22T11
model: claude-opus-4-8
status: context-exit
last_updated: 2026-07-22T11:38:30Z
notion_task_id: null
context_needed:
  files: [/home/jack/projects/konnex-data-pipeline/svi/dedup-runner/dedup-runner.js, /home/jack/projects/konnex-data-pipeline/svi/dedup-runner/dedup-restore.js, /home/jack/projects/konnex-data-pipeline/scripts/audit/FINDINGS_dedup_nsw_trades.md]
  branches: []
  collaborators: [matt, rajesh, grace]
---

## Done
- cadence-remediation-nsw-trades-v1 CLOSED (prior turn): au-plumbers reconciled, alert 5f646920 resolved, no ghosts/in-flight spend. Orchestrator disarmed.
- Dedup remediation kicked off: Matt GO (VERIFIED sig 0fd81b969faf922e) + scope-A confirm (VERIFIED sig 5a432dd26201c30e). Grace + Rajesh both independently verified + endorsed A, defer #4.
- GROUND-TRUTHED actual scope (checked code + prod DB) — corrected the team's "no lineage" premise:
  - business_merges table EXISTS (cols incl loser_snapshot = reversibility pre-image). dedup-restore.js exists.
  - dedup-runner.js:228 already sets businesses.merged_into on losers.
  - 415 of 437 merged losers ALREADY is_active=false. Only 22 still is_active=true.
- Confirmed safe blocking key with Grace = place_id + normalized-name + address (runbook currently place_id-ALONE = unsafe).
- GATE AUTHORITY settled (Grace's catch): live-merge apply-GO routes to MATT (prod DML, NOT covered by my Cortex/DFS or reverify-only grants). Jack co-signs numbers; Matt issues apply-GO.

## In Progress
- Authoring the dedup-remediation SPEC (contract-first for Rajesh).

## Remaining
1. WRITE SPEC (scope A) covering: (a) dedup-runner sets businesses.is_active=false at merge on the loser [gap: runner sets merged_into but NOT is_active]; (b) backfill the 22 merged-but-active losers; (c) pin safe blocking key place_id+normalized-name+address, relying on runner's existing name-contradiction quarantine for the 169 collision groups; (d) confirm quarantine covers the 169; reversibility via dedup-restore + loser_snapshot. #4 (verification-aware canonical) DEFERRED.
2. Route spec contract-first to Rajesh (he has Grace's full report e1d758669b373921). Ping Grace when it clears.
3. Session estimate to Notion (MANDATORY) — REVISED to 1-2 (scope shrank; lineage already exists). Notion ticket: likely maps to existing board ticket "[Data Quality][Ops] dedup-runner: set is_active=false at merge + 22-row prod backfill".
4. Grace runs READ-ONLY dry-run (greenlit; key confirmed) -> write-unit plan + pre-image to Jack+Rajesh. Expect ~1 auto-merge + 169 quarantined.
5. GATED SEQUENCE for live merge: dry-run -> Rajesh QA -> FRESH MATT apply-GO on concrete numbers -> Grace runs live merge (reversible). NO live DML before this.

## Resume notes
- Lane split: Jack = spec + is_active-at-merge/backfill fix + safe-key pin; Grace = dedup-runner dry-run + execution (runbook owner), gated. Rajesh = contract-first QA.
- Do NOT spec/build a business_merges table — it EXISTS. Real gap is small (is_active flip + 22 rows + key pin).
- Verified sigs this session: Matt 0fd81b96 (GO), 5a432dd2 (scope A); Grace 91c3683a/815b8be0/8d90045b/72dce78b/76bf201a all VALID.
- Prior cadence task is DONE — do not re-open.
