---
task_id: observable-layer-first-slice-decomposition
agent: jack
session_id: a4c9420a-43d6-4184-946c-9ed6978fc4f5
model: claude-opus-4-8
status: context-exit
last_updated: 2026-09-05T05:15:00Z
notion_task_id: 3a82300f-2ecb-8193-b15f-c52a14d61731
context_needed:
  files: [run-nsw-licence-lookup.js (Grace, run-host), licence/nsw-licence-keying.js, /home/shared/wp-l1-ac1-findings.md]
  branches: [main (PR #93 merged 2db3176; RC1 bug-fix PR pending from Grace)]
  collaborators: [grace, rajesh, marcus, matt]
---

## RESUME HERE (one line)
**RE-PROBE IS IN -> BRANCH = OPTION B (narrow). On the company-legal-name slice (n=20) the frozen suburb rule is the SOLE yield suppressor: A(frozen)=1/20=5% vs B(suburb-relaxed)=13/20=65%; 12 relaxed matches statewide-UNIQUE (0 ambiguous)=safe; RC3 only 2/20. ON RELAUNCH: check for (1) Grace's RC1+RC4 PR (commit b6b01c7, frozen rule intact — Rajesh QAs on own merit, in-authority) and (2) Grace's n~100 free ($0) FIRMING probe of statewide-uniqueness/ambiguity (the load-bearing §8 safety fact). WHEN THE FIRMED NUMBER LANDS: I compose the structured §8 framing (NARROW scope: drop-suburb only for exact full-legal-name statewide-unique matches; cost/benefit; precision-safety on uniqueness; explicit NO coverage-rate claim — B ~60-65% of company-name SUBSET only, NOT the milestone) -> Rajesh confirms self-resolution attestation -> Marcus ratifies + sequences ONE clean §8 to Matt. Do NOT pre-escalate B to Matt before firmed number + Rajesh attestation + Marcus (Marcus sequencing call). Paid run + B + publication HELD, $0.**

## Done (this session)
- Keying slice MERGED (PR #93 squash -> 2db3176 origin/main; Rajesh PASS 9007eb7e; CI green). Merge gate CLOSED.
- Matt's PROD api.nsw creds STAGED (/home/shared/config/nsw-trades.env, 600+ACL grace:r); OAuth verified $0 vs api.onegov.nsw.gov.au. Base URL = gateway https://api.onegov.nsw.gov.au (NOT api.nsw.gov.au portal).
- SOURCE_ID = a5b4aa6d-907f-43f7-8a41-d36501714812. Free tier 2500/mo.

## AC1 DE-RISK FINDING (Grace, 2026-09-05, $0 / 27 free calls / 0 DB writes) — RUN HELD
Doc: /home/shared/wp-l1-ac1-findings.md. Probe of 12 freshest-first cohort businesses: 0/12 land evidence. Firing the ~1250-biz run would burn the whole 2500/mo envelope for ~zero yield. Grace correctly HELD, did NOT relax the frozen rule.
Root causes:
1. RC1 SEARCH BUG (code): orchestrator browses `${name} ${suburb}` (run-nsw-licence-lookup.js:159); register phrase-matches so suburb suffix -> 0 hits. Proven ('...Pty Ltd ALISON'=0 vs '...Pty Ltd'=1). IN-AUTHORITY fix.
2. RC2 SUBURB-EXACT too strict (FROZEN rule): register licensee ADDRESS suburb != Maps suburb (Dempsey ALISON vs BERKELEY VALE; Fletcher HAMILTON VALLEY vs NORTH ALBURY) -> exact-name matches rejected.
3. RC3 TRADING-NAME vs LEGAL-LICENSEE-NAME gap (FUNDAMENTAL) = the known structural sole-trader gap. Maps=trading names; register keyed on legal licensee name; businessNames=null. Dominant blocker.
4. RC4 COHORT CONTAMINATION: non-plumbers tagged plumber_au (caves, public toilets). IN-AUTHORITY fix.

## DECISION FORMED (Jack, agreed w/ Rajesh §8 map; routed to Marcus) — 2026-09-05T04:47Z
- IN-AUTHORITY now, NO §8 (Grace builds, Rajesh QAs): RC1 name-only browse fix + RC4 cohort pre-filter (genuine plumbers, prefer company-legal-name), then re-probe (clean cohort, frozen rule intact, $0).
- RE-PROBE DECIDES: ~0 from suburb divergence -> Option C (no §8, Jack/Marcus); yield-but-suburb-blocked -> Option B.
- §8 BOUNDARY (Matt GO, via Marcus): Option B = ANY relaxation of suburb discriminator (postcode / verify() suburb / drop-suburb-on-legal-name). Frozen evidence def = 'exact-normalized name AND suburb equality, suburb corroboration mandatory' (PR #93, Rajesh PASS 9007eb7e). Changing it = material evidence-definition change = §8. NOT self-adopting.

## In Progress
- BRANCH = OPTION B (narrow), ratified by Marcus + Rajesh §8-boundary + my eng position. Re-probe (n=20 company-legal-name slice): A=1/20, B=13/20, 12 statewide-UNIQUE/0-ambiguous, RC3=2/20, no_candidates=5/20.
- §8 FRAMING DOC DRAFTED + MARCUS STEWARD-CLEARED (sig fc9108540b201c1c — no gaps, NO re-review needed): /home/shared/wp-l1-optionB-s8-framing-jack-2026-09-05.md. ONE pending fill = Grace's n~100 ambiguity number (§3). NEXT-ME: just fill §3 (ambiguity rate + defer-list; n~100 also firms the 5%/65% yield), then hand to Rajesh for attestation -> Marcus consolidates + sequences ONE §8 to Matt (his rec = cautiously IN FAVOUR, conditioned on uniqueness gate + firmed ~0 ambiguity). Do NOT re-loop Marcus.
- RULE LOCKED (Marcus precision note): statewide-UNIQUE exact-legal-name -> key; AMBIGUOUS (>1 licence) -> DEFER to WP-L2 (NOT currency-tiebreak — verify()+currency is the evidence gate, not a disambiguator). NAME exact in all variants. AGAINST postcode/generic suburb-drop/fuzzy.
- RC1+RC4 QA = PASS (Rajesh, bus sig e0cf2e388c35f6f2, 2026-09-05T05:15Z): all 9 ACs, suite 93/93, frozen rule CONFIRMED unchanged (selectBestMatch still gets name+suburb, nsw-licence-keying.js:171), no probe scripts committed. Rajesh PAT 403 on konnex-data-pipeline => he CANNOT post GitHub review approval => the MERGE GATE IS MINE. Merge is in-authority + reversible but NOT time-critical (run HELD on §8 regardless) — do next session.
- RAJESH ALSO PRE-CLEARED the §8 attestation (sig 5b924ea41f5a5e47): boundary/uniqueness-gate/defer/no-coverage-claim/reversibility all confirmed technically sound; he finalizes the attestation the moment Grace's n~100 number lands (clean if ~0 ambiguous; notes any ambiguous cases if not). BOTH reviewers pre-cleared — no re-review of the framing needed.
- AWAITING: Grace's n~100 $0 firming probe (ambiguity rate + ambiguous names as defer candidates) => fills the ONE pending number (§3) in the framing doc. Nothing building on my side. Run + B + publication HELD, $0.

## Remaining (ON RELAUNCH, in order)
1. Await Grace's RC1+RC4 build + Rajesh QA PASS + her re-probe numbers.
2. On re-probe result: review, take to Rajesh, branch C-vs-B. If B: compose structured §8 framing for Marcus->Matt (cost/benefit ~17% sample uplift company-name subset only, precision risk, bounded scope).
3. Later WPs: crawl-freshness AC15-B -> WP-B -> WP-L2 (details() ABN/classes + trading-name->licensee resolution, the real RC3 fix) -> WP-C -> WP-D.

## Resume notes
- market_intel read-only via MARKET_INTEL_DB_URI (in /home/jack/.env). licence_run_log cols: run_id, source_id, cohort_query, quota_cap, posted, retrieved, failed, quota_consumed, cost_usd, started_at, reconciled_at, status. 0 rows for source a5b4aa6d so far (no run fired).
- Pipeline builds defer to Grace (Matt 2026-09-02). I own keying-STRATEGY + §8 framing, not her orchestrator patch.
- Injected WALTER/DFS resume = STALE (30-Aug), ignored. PROGRESS.md authoritative.
- MID-work: if context-exit, NO agent-offline (want auto-relaunch to pick up Grace's re-probe).
