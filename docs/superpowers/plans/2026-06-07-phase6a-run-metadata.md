# Slice 6a — Run metadata (branch / commit / environment / CI URL)

**Goal:** Capture and surface CI context on each run, so trends/comparison/PR checks can be scoped
and runs can link back to their build. Gap #1 in `docs/FUTURE-WORK.md`.

**Decisions (sensible defaults):**
- Fields: `branch`, `commit`, `environment`, `ciUrl` — all **optional, nullable** text.
- Provided on `send-results` as **multipart text fields** (alongside the file parts the route already
  reads). Trimmed + length-capped (256) defensively; empty → null.
- This slice **captures, stores, displays, and filters runs by branch**. Branch-aware *trend deltas*
  remain a follow-up (depends on this).

## Tasks
1. **Schema** (`schema.sqlite.ts` + `schema.pg.ts`): add `branch`, `commit`, `environment`, `ci_url`
   (nullable text) to `runs`. Generate migrations (sqlite 0010, pg 0009). Index `(project_id, branch)`
   for the branch filter.
2. **Contracts** (`contracts.ts`): `runSchema` gains `branch/commit/environment/ciUrl` (nullable,
   optional for back-compat). Add a `runMetadataSchema` (the 4 fields, each `string.max(256)` optional)
   for ingest validation.
3. **RunRepository**: `create(projectId, id, reportName, now, metadata?)` persists the 4 fields;
   `#toRun` returns them; `#selectRuns`/`listByProject`/`countByProject` accept an optional `branch`
   filter. (`get`/others unchanged besides `#toRun`.)
4. **send-results route**: collect text parts `branch/commit/environment/ciUrl` while iterating
   `req.parts()`; validate via `runMetadataSchema`; pass to `runs.create`. Publish unchanged.
5. **runs route**: accept `?branch=` (passed to `listByProject`/`countByProject`); keep `X-Total-Count`.
6. **Web**: enrich the run `<option>` label with `branch@commit · env` when present; show a one-line
   metadata caption (with a CI link) for the selected run. (Client `listRuns` already passes opts.)
7. **GitHub Action**: add an `environment` input; auto-derive branch/commit/ci_url from GitHub context
   and pass them as `-F` fields on the upload. Document in the action README.
8. **Tests**: repo conformance (persist+return metadata; branch filter + count; both dialects);
   send-results route (metadata round-trips; empty omitted). Verify all + live smoke.
9. **Code-review → fix → push → memory**; tick gap #1 in FUTURE-WORK.

## Notes
- Back-compat: existing runs have NULL metadata; the optional contract fields keep them parsing.
- Length cap guards against abusive field sizes (these flow into the UI/JSON).
