#!/bin/bash
# Self-driving NSW 3-trade reverify chain: waits for electrician(2707) completion,
# then fires carpenter -> plumber sequentially with a hard scope guard.
# Removes Jack from the critical path (launches need konnex-data SSH; Jack keeps context-exiting).
set -u
set -a; source /home/jack/.env; set +a

ORCH=/home/jack/projects/pipeline-orchestrator/v2-pilot/lib/v2-verification-worker.js
CHAINLOG=/home/jack/nsw-chain.log
CHAINOUT=/home/jack/nsw-chain.outcome

log(){ echo "$(date -u +%FT%TZ) $*" | tee -a "$CHAINLOG"; }

# No /home/shared on konnex-data, so no agent-bus from here. Co-witnessing + the
# final Matt report come from Grace's pipeline_events monitor. We just record
# notable events to a notify file (Jack tails it from the main box as backstop).
NOTIFY=/home/jack/nsw-chain.notify
ping_team(){ echo "$(date -u +%FT%TZ) $*" >> "$NOTIFY"; }

# launch a trade with scope guard. args: TRADE GUARD_MAX EXPECTED
launch_trade(){
  local TRADE=$1 GUARD=$2 EXP=$3 JOB LOG PID RT ST i
  # -q suppresses the psql command tag ("INSERT 0 1"); grep extracts only the
  # leading numeric id — robust even where psql concatenates the id and tag on
  # one line (the konnex-data psql version, which produced 'NNNNINSERT01').
  JOB=$(psql "$MARKET_INTEL_DB_URI" -tAq -c "INSERT INTO pipeline_jobs (industry_id,stage,status,priority,target_server,worker_count,claimed_by,claimed_at,started_at,heartbeat_at,timeout_minutes) VALUES ('${TRADE}_au','v2_verification','running',100,'data',5,'jack-nsw-${TRADE}',NOW(),NOW(),NOW(),360) RETURNING id;" | grep -oE '[0-9]+' | head -1)
  if ! [[ "$JOB" =~ ^[0-9]+$ ]]; then
    log "ABORT $TRADE — could not provision pipeline_jobs row (got '$JOB')"
    ping_team "[chain] ABORT $TRADE: pipeline_jobs INSERT failed. Chain stopped. Jack check."
    return 1
  fi
  LOG=/home/jack/nsw-${TRADE}-run-${JOB}.log
  log "LAUNCH $TRADE job=$JOB (expect ~$EXP NSW, guard<=$GUARD)"
  nohup env PIPELINE_JOB_ID=$JOB V2V_STATE=NSW V2V_CYCLE_COST_CAP_AUD=3 LLM_ENABLED=true BD_ENABLED=false \
    node "$ORCH" --industry ${TRADE}_au --workers 5 > "$LOG" 2>&1 </dev/null &
  PID=$!
  # wait up to ~90s for the scope-proof line
  RT=""; ST=""; i=0
  while [ $i -lt 45 ]; do
    RT=$(grep -oE '"records_total":[0-9]+' "$LOG" 2>/dev/null | head -1 | grep -oE '[0-9]+')
    ST=$(grep -oE '"scope_state":"[A-Za-z]+"' "$LOG" 2>/dev/null | head -1 | grep -oE '[A-Z]+')
    [ -n "$RT" ] && break
    kill -0 "$PID" 2>/dev/null || break
    sleep 2; i=$((i+1))
  done
  log "SCOPEPROOF $TRADE job=$JOB records_total=${RT:-none} scope_state=${ST:-none}"
  # --- hard scope guard ---
  if [ -z "$RT" ]; then
    kill -TERM "$PID" 2>/dev/null
    psql "$MARKET_INTEL_DB_URI" -c "UPDATE pipeline_jobs SET status='failed', completed_at=NOW(), error_message='no scope proof in 90s' WHERE id=$JOB;" >/dev/null 2>&1
    log "ABORT $TRADE job=$JOB — no scope proof in 90s; killed"
    ping_team "[chain] ABORT $TRADE job=$JOB: no scope proof in 90s. Killed, chain stopped. Jack check."
    return 1
  fi
  if [ "$ST" != "NSW" ] || [ "$RT" -gt "$GUARD" ]; then
    kill -TERM "$PID" 2>/dev/null
    psql "$MARKET_INTEL_DB_URI" -c "UPDATE pipeline_jobs SET status='failed', completed_at=NOW(), error_message='scope guard rt=${RT} st=${ST}' WHERE id=$JOB;" >/dev/null 2>&1
    log "ABORT $TRADE job=$JOB — SCOPE GUARD tripped rt=$RT st=$ST (want NSW<=$GUARD); killed"
    ping_team "[chain] ABORT $TRADE job=$JOB: SCOPE GUARD tripped records_total=$RT scope_state=$ST (expected NSW<=$GUARD). Killed, chain stopped. Jack check NOW."
    return 1
  fi
  log "SCOPE OK $TRADE job=$JOB rt=$RT st=$ST"
  ping_team "[chain] FIRED $TRADE job=$JOB — scope proof records_total=$RT scope_state=$ST (NSW OK, expected ~$EXP). Co-witness please."
  # wait for worker exit, then reconcile on cycle.complete
  while kill -0 "$PID" 2>/dev/null; do sleep 30; done
  sleep 3
  if grep -qiE "cycle.complete|cycle_complete" "$LOG"; then
    psql "$MARKET_INTEL_DB_URI" -c "UPDATE pipeline_jobs SET status='completed', completed_at=NOW() WHERE id=$JOB AND status IN ('running','claimed','timeout');" >/dev/null 2>&1
    local COST; COST=$(grep -oiE 'cost_aud["'"'"': ]+[0-9.]+' "$LOG" | tail -1)
    log "DONE $TRADE job=$JOB completed ${COST:-cost=?}"
    ping_team "[chain] COMPLETE $TRADE job=$JOB (reconciled). ${COST:-cost=?}"
    return 0
  fi
  psql "$MARKET_INTEL_DB_URI" -c "UPDATE pipeline_jobs SET status='failed', completed_at=NOW(), error_message='exited without cycle.complete' WHERE id=$JOB AND status IN ('running','claimed');" >/dev/null 2>&1
  log "FAIL $TRADE job=$JOB — exited without cycle.complete"
  ping_team "[chain] $TRADE job=$JOB exited WITHOUT cycle.complete — marked failed. Chain stopped. Jack check."
  return 1
}

log "CHAIN START — waiting for electrician 2707 outcome file"
while [ ! -f /home/jack/nsw-elec-run-2707.outcome ]; do sleep 30; done
ELEC=$(cat /home/jack/nsw-elec-run-2707.outcome)
log "ELEC OUTCOME: $ELEC"
if ! echo "$ELEC" | grep -q "RECONCILED=completed"; then
  log "ELEC did not complete cleanly — HOLDING carp/plumb"
  ping_team "[chain] electrician 2707 did NOT complete cleanly ($ELEC). Carp/plumb HELD. Jack check."
  echo "CHAIN ABORTED at electrician: $ELEC at=$(date -u +%FT%TZ)" > "$CHAINOUT"
  exit 1
fi

# carpenter: expect ~4,965 NSW; national ~9,901 -> guard 6500
launch_trade carpenter 6500 4965 || { echo "CHAIN ABORTED at carpenter at=$(date -u +%FT%TZ)" > "$CHAINOUT"; exit 1; }
# plumber: expect ~1,082 NSW; national ~2,185 -> guard 1500
launch_trade plumber 1500 1082 || { echo "CHAIN ABORTED at plumber at=$(date -u +%FT%TZ)" > "$CHAINOUT"; exit 1; }

log "CHAIN COMPLETE — all 3 NSW trades reconciled"
echo "CHAIN COMPLETE all-3 (elec 2707 + carp + plumb) at=$(date -u +%FT%TZ)" > "$CHAINOUT"
ping_team "[chain] ALL-3 NSW trades cycle.complete (elec 2707 + carp + plumb). Grace: read final rows+cost from cycle.complete events + report to Matt."
