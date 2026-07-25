#!/usr/bin/env python3
"""Survivor-pick preview for the 169 quarantined NSW+3 dedup clusters.

Input : dedup-nsw3-quarantine-namepairs-2026-07-21.jsonl (clusters, member ids)
Output: a human-scannable .md preview + a machine .jsonl (one rec per cluster).

For each cluster (same google_place_id, distinct_names>=2) it:
  - enriches every member from businesses (read-only)
  - ranks members by survivor preference (alive > active > verification >
    enrichment > completeness > review_count > last_seen)
  - recommends a survivor and surfaces a MERGE-vs-DISTINCT hint (name
    similarity + whether phone/street match) so Grace can make the human call.

Read-only. No DML. Zero spend.
"""
import json, os, re, subprocess, sys
from difflib import SequenceMatcher

QUAR = "/home/shared/dedup-nsw3-quarantine-namepairs-2026-07-21.jsonl"
OUT_MD = "/home/shared/dedup-nsw3-survivor-preview-2026-07-21.md"
OUT_JSONL = "/home/shared/dedup-nsw3-survivor-preview-2026-07-21.jsonl"

COLS = [
    "id", "name", "phone", "email", "website_url", "address_street",
    "address_suburb", "address_state", "rating", "review_count", "is_active",
    "last_seen", "enrichment_status", "verification_status",
    "regulator_verified", "website_verified", "phone_verified",
    "website_live", "maps_business_status", "archived_at", "merged_into",
    "google_place_id", "industry",
]

LEGAL = re.compile(r"\b(pty|ltd|limited|inc|co|the|and)\b", re.I)


def norm_name(s):
    s = (s or "").lower()
    s = LEGAL.sub(" ", s)
    s = re.sub(r"[^a-z0-9]+", " ", s)
    return " ".join(s.split())


def norm_phone(s):
    return re.sub(r"\D", "", s or "")


def name_sim(a, b):
    na, nb = norm_name(a), norm_name(b)
    if not na or not nb:
        return 0.0
    ratio = SequenceMatcher(None, na, nb).ratio()
    ta, tb = set(na.split()), set(nb.split())
    jac = len(ta & tb) / len(ta | tb) if (ta | tb) else 0.0
    return max(ratio, jac)


def fetch(ids):
    """Read-only pull of member rows from businesses, returned as {id: row}."""
    db = os.environ["MARKET_INTEL_DB_URI"]
    arr = "{" + ",".join(ids) + "}"
    sql = (
        "select coalesce(json_agg(row_to_json(t)), '[]') from (select "
        + ", ".join(COLS)
        + " from businesses where id = any(%s::uuid[])) t"
    )
    # pass the id array via a psql variable to avoid quoting issues
    q = sql.replace("%s", "'" + arr + "'")
    r = subprocess.run(
        ["psql", db, "-tAc", q], capture_output=True, text=True, timeout=120
    )
    if r.returncode != 0:
        sys.exit("psql failed: " + r.stderr[:500])
    rows = json.loads(r.stdout.strip() or "[]")
    return {row["id"]: row for row in rows}


def completeness(r):
    keys = ["phone", "email", "website_url", "address_street", "address_suburb"]
    n = sum(1 for k in keys if r.get(k))
    if (r.get("review_count") or 0) > 0:
        n += 1
    return n  # out of 6


def verif_rank(r):
    if r.get("regulator_verified"):
        return 3
    if (r.get("verification_status") or "").lower() in ("verified", "gold"):
        return 2
    if r.get("website_verified") or r.get("phone_verified"):
        return 1
    return 0


def enrich_rank(r):
    return 1 if (r.get("enrichment_status") or "").lower() in ("enriched", "complete", "done") else 0


def alive(r):
    return not r.get("archived_at") and not r.get("merged_into")


def sort_key(r):
    return (
        1 if alive(r) else 0,
        1 if r.get("is_active") else 0,
        verif_rank(r),
        enrich_rank(r),
        completeness(r),
        r.get("review_count") or 0,
        r.get("last_seen") or "",
    )


def merge_hint(members):
    names = [m.get("name") for m in members]
    sims = [name_sim(names[i], names[j]) for i in range(len(names)) for j in range(i + 1, len(names))]
    min_sim = min(sims) if sims else 0.0
    phones = {norm_phone(m.get("phone")) for m in members if norm_phone(m.get("phone"))}
    streets = {norm_name(m.get("address_street")) for m in members if m.get("address_street")}
    phones_match = len(phones) == 1
    streets_match = len(streets) == 1
    if phones_match and min_sim >= 0.6:
        tag = "LIKELY SAME → merge"
    elif phones_match and streets_match:
        tag = "SAME CONTACT, diff name → rebrand? HUMAN"
    elif not phones_match and min_sim < 0.34:
        tag = "POSSIBLE DISTINCT TENANTS → HUMAN"
    else:
        tag = "REVIEW"
    return tag, min_sim, phones_match, streets_match


def fmt_member(r, star):
    mark = "★ SURVIVOR" if star else "  loser   "
    vr = {3: "regulator", 2: "verified", 1: "web/phone", 0: "none"}[verif_rank(r)]
    flags = []
    if not r.get("is_active"):
        flags.append("INACTIVE")
    if r.get("archived_at"):
        flags.append("ARCHIVED")
    if r.get("merged_into"):
        flags.append("ALREADY-MERGED")
    mbs = r.get("maps_business_status")
    if mbs and mbs.upper() != "OPERATIONAL":
        flags.append(f"maps={mbs}")
    ls = (r.get("last_seen") or "")[:10]
    return (
        f"    {mark}  {r.get('name') or '(no name)'}\n"
        f"        id={r['id']}  rev={r.get('review_count') or 0} rating={r.get('rating') or '-'}  "
        f"complete={completeness(r)}/6  verif={vr}  enriched={'y' if enrich_rank(r) else 'n'}  last_seen={ls}\n"
        f"        phone={r.get('phone') or '-'}  web={'y' if r.get('website_url') else 'n'}  "
        f"email={'y' if r.get('email') else 'n'}  street={r.get('address_street') or '-'}, {r.get('address_suburb') or '-'}"
        + (f"  [{', '.join(flags)}]" if flags else "")
        + "\n"
    )


def main():
    clusters = [json.loads(l) for l in open(QUAR) if l.strip()]
    all_ids = [m["id"] for c in clusters for m in c["members"]]
    rows = fetch(all_ids)

    by_ind = {}
    for c in clusters:
        by_ind.setdefault(c["industry"], []).append(c)

    md = []
    md.append("# NSW+3 dedup — survivor-pick preview (169 quarantined clusters)")
    md.append(f"_Generated {os.popen('date -u +%FT%TZ').read().strip()} — READ-ONLY. Recommendation only; merge & survivor are the human call._\n")
    md.append("Legend: ★=recommended survivor. Sort within cluster = alive > active > verification > enriched > completeness > reviews > last_seen.")
    md.append("MERGE-hint is a heuristic on name-similarity + phone/street match, NOT a decision. `HUMAN` = genuinely ambiguous (e.g. JIRAH/Jireh).\n")

    jsonl = []
    hint_counts = {}
    for ind in sorted(by_ind):
        cl = by_ind[ind]
        md.append(f"\n## {ind}  ({len(cl)} clusters)\n")
        for c in cl:
            members = [rows.get(m["id"], {"id": m["id"], "name": m.get("name")}) for m in c["members"]]
            members.sort(key=sort_key, reverse=True)
            survivor = members[0]
            tag, min_sim, ph, st = merge_hint(members)
            hint_counts[tag] = hint_counts.get(tag, 0) + 1
            md.append(
                f"### {ind} · place_id={c['google_place_id']} · size={c['size']} · distinct_names={c['distinct_names']}\n"
                f"    MERGE-HINT: {tag}  (name_sim={min_sim:.2f}, phones_match={ph}, streets_match={st})\n"
            )
            for i, r in enumerate(members):
                md.append(fmt_member(r, i == 0))
            md.append("")
            jsonl.append({
                "google_place_id": c["google_place_id"],
                "industry": ind,
                "size": c["size"],
                "merge_hint": tag,
                "name_sim_min": round(min_sim, 3),
                "phones_match": ph,
                "streets_match": st,
                "recommended_survivor_id": survivor["id"],
                "recommended_survivor_name": survivor.get("name"),
                "loser_ids": [m["id"] for m in members[1:]],
                "ranked": [
                    {"id": m["id"], "name": m.get("name"), "review_count": m.get("review_count") or 0,
                     "completeness": completeness(m), "verif_rank": verif_rank(m),
                     "enriched": bool(enrich_rank(m)), "alive": alive(m), "is_active": bool(m.get("is_active"))}
                    for m in members
                ],
            })

    with open(OUT_MD, "w") as f:
        f.write("\n".join(md))
    with open(OUT_JSONL, "w") as f:
        for j in jsonl:
            f.write(json.dumps(j) + "\n")

    print(f"clusters={len(clusters)} members_fetched={len(rows)}/{len(all_ids)}")
    print("merge-hint breakdown:", json.dumps(hint_counts, indent=0))
    print("wrote", OUT_MD, "and", OUT_JSONL)


if __name__ == "__main__":
    main()
