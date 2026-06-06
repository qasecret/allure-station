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
```

Outputs: `run-id`, `status` (`ready`|`failed`|`generating`), `report-url`.

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
      BASE="https://allure.example.com"; PROJECT="my-app"
      AUTH="Authorization: Bearer $ALLURE_TOKEN"
      FILES=(); for f in allure-results/*; do FILES+=(-F "files=@$f"); done
      RUN=$(curl -fsS -H "$AUTH" "${FILES[@]}" "$BASE/api/projects/$PROJECT/send-results" | jq -r .runId)
      curl -fsS -X POST -H "$AUTH" "$BASE/api/projects/$PROJECT/generate"
      until [ "$(curl -fsS -H "$AUTH" "$BASE/api/projects/$PROJECT/runs/$RUN" | jq -r .status)" != "generating" ]; do sleep 3; done
```

### Jenkins (shell step)

```bash
BASE="https://allure.example.com"; PROJECT="my-app"
RUN=$(curl -fsS -H "Authorization: Bearer $ALLURE_TOKEN" $(printf ' -F files=@%s' allure-results/*) \
  "$BASE/api/projects/$PROJECT/send-results" | jq -r .runId)
curl -fsS -X POST -H "Authorization: Bearer $ALLURE_TOKEN" "$BASE/api/projects/$PROJECT/generate"
while [ "$(curl -fsS -H "Authorization: Bearer $ALLURE_TOKEN" "$BASE/api/projects/$PROJECT/runs/$RUN" | jq -r .status)" = "generating" ]; do sleep 3; done
```

(Omit the `Authorization` header for open projects — see the [auth section](../README.md#authentication-scoped-api-tokens).)
