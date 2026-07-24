# Marinate GitHub Action

Fail CI when a retired or breaking AI model configuration is about to ship.

```yaml
# .github/workflows/marinate.yml
name: Marinate
on: [pull_request]

permissions:
  contents: read

jobs:
  models:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: marinate-dev/action@v1
        with:
          fail-on: breaks        # breaks | upgrade | behavior | stale | none
          version: '0.1.0'       # pin in security-sensitive CI (recommended)
```

## Inputs

| Input | Default | Description |
|---|---|---|
| `path` | `.` | Directory to scan |
| `fail-on` | `breaks` | Fail the job at this severity or above |
| `version` | `latest` | `@marinate/cli` version — **pin it** in sensitive CI |
| `comment` | `false` | Reserved for PR comments (needs `pull-requests: write`) |

The action writes a findings table to the job summary and exits non-zero only when
findings meet the `fail-on` threshold. Marinate runs entirely locally — no code,
paths, or results leave the runner.
