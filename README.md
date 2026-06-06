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
docker compose -f docker/docker-compose.test.yml up -d minio
```

2. Run the S3 conformance tests:

```bash
S3_TEST_ENDPOINT=http://localhost:9000 \
S3_TEST_KEY=minio \
S3_TEST_SECRET=minio12345 \
pnpm --filter @allure-station/server test src/storage/s3-driver
```

Without `S3_TEST_ENDPOINT` set, the S3 suite is automatically skipped (the rest of the test suite always runs).

## Database

Allure Station uses **SQLite by default** (zero configuration — the database file is created automatically under `DATA_DIR`). Postgres can be selected for multi-instance deployments.

### SQLite (default)

No configuration needed. The database file is created automatically.

| Variable | Default | Description |
|---|---|---|
| `DB_DRIVER` | `sqlite` | Database backend (`sqlite` or `postgres`) |
| `DB_FILE` | `$DATA_DIR/allure-station.db` | Path to the SQLite database file |
| `DATA_DIR` | `./data` | Base data directory |

### Postgres

Set `DB_DRIVER=postgres` and provide a connection URL:

| Variable | Default | Description |
|---|---|---|
| `DB_DRIVER` | `sqlite` | Set to `postgres` to enable |
| `DATABASE_URL` | _(required when `DB_DRIVER=postgres`)_ | Postgres connection string, e.g. `postgresql://user:pass@host:5432/dbname` |

#### Switching docker-compose to Postgres

The `postgres` service is included in `docker/docker-compose.yml` behind the `postgres` compose profile. To start the app with Postgres:

1. Uncomment the DB env vars in the `allure-station` service in `docker/docker-compose.yml`:

```yaml
environment:
  DB_DRIVER: postgres
  DATABASE_URL: postgresql://allure:allure@postgres:5432/allure
```

2. Start with the `postgres` profile:

```bash
docker compose -f docker/docker-compose.yml --profile postgres up
```

The default `docker compose up` (no profile) continues to use SQLite with no configuration required.

### Schema migrations

Drizzle migrations are applied automatically on startup. If you change the schema, regenerate migrations for **both** dialects:

```bash
pnpm --filter @allure-station/server db:generate:sqlite
pnpm --filter @allure-station/server db:generate:pg
```

### Running Postgres Repository Conformance Tests

The repository conformance suite is environment-gated: it always runs against SQLite (in-memory) and additionally runs against Postgres when `PG_TEST_URL` is set.

1. Start Postgres:

```bash
docker compose -f docker/docker-compose.test.yml up -d postgres
```

2. Run the conformance tests:

```bash
PG_TEST_URL=postgresql://postgres:pw@localhost:5432/allure \
pnpm --filter @allure-station/server test src/db/repositories
```

Without `PG_TEST_URL` set, the Postgres conformance suite is automatically skipped.

## Development

```bash
pnpm install
pnpm build
pnpm test
pnpm typecheck
```
