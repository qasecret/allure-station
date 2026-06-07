# Allure Station — GitHub Action

Upload Allure results to an [Allure Station](../README.md) instance, trigger report generation, and (optionally) wait for the report to be ready — failing the job if generation fails.

## Usage

```yaml
- uses: qasecret/allure-station/github-action@v1
  with:
    url: https://allure.example.com
    project: my-app
    results: allure-results        # default
    token: ${{ secrets.ALLURE_TOKEN }}   # only if the project is token-protected
    wait: "true"                   # default — fail the job if generation fails
    timeout: "300"                 # seconds
    environment: "staging"         # optional — labels the run
```

Outputs: `run-id`, `status` (`ready`|`failed`|`generating`), `report-url`.

**Run metadata** — the action automatically attaches `branch`, `commit`, and the `ciUrl` (a link back to this workflow run) from the GitHub context, plus the optional `environment` input. These show up on the run in the UI/API and power the `?branch=` run filter. In other CI systems, send them yourself as form fields: `-F branch=… -F commit=… -F environment=… -F ciUrl=…` on the `send-results` call.

## Pull-request status checks & comments

On `pull_request` events the action posts a **commit status** and an (upserted) **PR comment** with pass/fail, the **quality-gate verdict**, run stats, and the **trend delta vs the previous run**. It fails the job if generation failed or the quality gate breached.

> For a **private** project, the PR-comment step reads `/summary` and `/compare`, so it needs the `token` input (a project-scoped token grants read of its own project). Public projects need no token to read.

```yaml
permissions:
  pull-requests: write   # PR comment
  statuses: write        # commit status
jobs:
  test:
    steps:
      - uses: qasecret/allure-station/github-action@v1
        with:
          url: https://allure.example.com
          project: my-app
          token: ${{ secrets.ALLURE_TOKEN }}
          # comment: "true"                 # default; set "false" to skip PR posting
          # github-token: ${{ github.token }}  # default
```

Configure the gate once per project (write-gated if the project is token-protected):

```bash
curl -XPUT host/api/projects/my-app/quality-gate -H 'content-type: application/json' \
  -d '{"maxFailures":0,"minPassRate":0.95,"minTests":1}'
```

Rules: `maxFailures` (failed+broken ≤ N), `minTests` (total ≥ N), `minPassRate` (0..1), `maxDurationMs`. All configured rules must pass.

```yaml
- uses: qasecret/allure-station/github-action@v1
  id: allure
  with: { url: https://allure.example.com, project: my-app, token: ${{ secrets.ALLURE_TOKEN }} }
- run: echo "Report: ${{ steps.allure.outputs.report-url }}"
```

Requires `curl` and `jq` (both present on GitHub-hosted runners).

## Status badge

Embed the latest-run badge in your README:

```markdown
![tests](https://allure.example.com/api/projects/my-app/badge.svg)
```

## Other CI systems

The action is a thin wrapper over three HTTP calls. The equivalent in any CI:

### GitLab CI

```yaml
publish-allure:
  image: alpine
  before_script: [ "apk add --no-cache curl jq" ]
  script:
    - |
      set -eu; shopt -s nullglob
      BASE="https://allure.example.com"; PROJECT="my-app"
      AUTH="Authorization: Bearer $ALLURE_TOKEN"   # omit -H "$AUTH" entirely for an open project
      FILES=(); for f in allure-results/*; do FILES+=(-F "files=@$f"); done
      RUN=$(curl -fsS -H "$AUTH" "${FILES[@]}" "$BASE/api/projects/$PROJECT/send-results" | jq -r .runId)
      curl -fsS -X POST -H "$AUTH" "$BASE/api/projects/$PROJECT/generate?runId=$RUN"
      until [ "$(curl -fsS -H "$AUTH" "$BASE/api/projects/$PROJECT/runs/$RUN" | jq -r .status)" != "generating" ]; do sleep 3; done
```

### Jenkins (shell step)

```bash
set -eu; shopt -s nullglob
BASE="https://allure.example.com"; PROJECT="my-app"; AUTH="Authorization: Bearer $ALLURE_TOKEN"
FILES=(); for f in allure-results/*; do FILES+=(-F "files=@$f"); done
[ ${#FILES[@]} -gt 0 ] || { echo "no results"; exit 1; }
RUN=$(curl -fsS -H "$AUTH" "${FILES[@]}" "$BASE/api/projects/$PROJECT/send-results" | jq -r .runId)
curl -fsS -X POST -H "$AUTH" "$BASE/api/projects/$PROJECT/generate?runId=$RUN"
while [ "$(curl -fsS -H "$AUTH" "$BASE/api/projects/$PROJECT/runs/$RUN" | jq -r .status)" = "generating" ]; do sleep 3; done
```

(Omit the `Authorization` header for open projects — see the [auth section](../README.md#authentication-scoped-api-tokens).)
