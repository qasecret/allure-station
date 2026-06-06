# Allure Station

A self-hosted Allure report service with pluggable storage backends.

## Quick Start

```bash
docker compose -f docker/docker-compose.yml up
```

The service listens on port `5050`. Reports and results are stored in the `allure-data` named volume by default (local filesystem).

## Storage

Allure Station supports two storage backends, configured via environment variables.

### Local (default)

No configuration needed. Results and reports are stored on the local filesystem under `DATA_DIR/storage` (default: `./data/storage`).

| Variable | Default | Description |
|---|---|---|
| `STORAGE_DRIVER` | `local` | Storage backend (`local` or `s3`) |
| `STORAGE_ROOT` | `$DATA_DIR/storage` | Root directory for local storage |
| `DATA_DIR` | `./data` | Base data directory |

### S3-compatible (MinIO, AWS S3, etc.)

Set `STORAGE_DRIVER=s3` and configure the S3 variables:

| Variable | Default | Description |
|---|---|---|
| `STORAGE_DRIVER` | `local` | Set to `s3` to enable |
| `S3_ENDPOINT` | _(none — uses AWS)_ | Custom endpoint URL (e.g. `http://minio:9000`) |
| `S3_REGION` | `us-east-1` | S3 region |
| `S3_BUCKET` | _(required)_ | Bucket name |
| `S3_FORCE_PATH_STYLE` | `true` | Set `false` for AWS S3 virtual-hosted-style |
| `S3_ACCESS_KEY_ID` | _(SDK default chain)_ | Access key ID (optional if using IAM/instance roles) |
| `S3_SECRET_ACCESS_KEY` | _(SDK default chain)_ | Secret access key |

#### Switching docker-compose to S3/MinIO

Uncomment the `environment` block under the `allure-station` service in `docker/docker-compose.yml`:

```yaml
environment:
  STORAGE_DRIVER: s3
  S3_ENDPOINT: http://minio:9000
  S3_BUCKET: allure
  S3_ACCESS_KEY_ID: minio
  S3_SECRET_ACCESS_KEY: minio12345
```

Then `docker compose -f docker/docker-compose.yml up` will start both the app and MinIO.

## Running S3 Conformance Tests

The S3 driver has an environment-gated conformance suite that runs against a real MinIO instance.

1. Start MinIO:

```bash
docker compose -f docker/docker-compose.test.yml up -d
```

2. Run the S3 conformance tests:

```bash
S3_TEST_ENDPOINT=http://localhost:9000 \
S3_TEST_KEY=minio \
S3_TEST_SECRET=minio12345 \
pnpm --filter @allure-station/server test src/storage/s3-driver
```

Without `S3_TEST_ENDPOINT` set, the S3 suite is automatically skipped (the rest of the test suite always runs).

## Development

```bash
pnpm install
pnpm build
pnpm test
pnpm typecheck
```
