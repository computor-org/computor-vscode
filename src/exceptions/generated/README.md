# Vendored Error Catalog

Everything in this directory is **generated upstream and copied in**. Do not edit it
by hand — changes are lost on the next refresh.

Hand-written error code lives one level up in `src/exceptions/`:

| Path | What it is |
|------|------------|
| `src/exceptions/generated/` | this directory — vendored, generated upstream |
| `src/exceptions/errors/` | our `Error` subclasses (`HttpError`, `SettingsError`, `GitExecError`) |
| `src/exceptions/*.ts` | our catalog runtime (`ErrorCatalog`, `ClientErrorCatalog`, `ErrorDisplayStrategy`, types) |
| `src/exceptions/client-error-catalog.json` | hand-authored, extension-only client errors — **not** generated |

## error-catalog.vscode.json

The backend error catalog trimmed for shipping in the `.vsix`: codes, titles,
user-facing messages (plain/markdown/HTML), HTTP status, category, severity and
retry information.

Loaded at runtime by `../ErrorCatalog.ts`. `webpack.config.js` copies it to
`dist/exceptions/generated/` — the runtime path in `ErrorCatalog.initialize()`
mirrors this layout, so move the file and you must update both.

```json
{
  "code": "AUTH_001",
  "http_status": 401,
  "category": "authentication",
  "severity": "warning",
  "title": "Authentication Required",
  "message": {
    "plain": "You must be authenticated to access this resource.",
    "markdown": "...",
    "html": "..."
  },
  "retry_after": null
}
```

## Refreshing

The source of truth is `computor-backend/error_registry.yaml`. The generator writes
to `computor-web/src/generated/errors/`, **not** here, so refreshing this copy is a
manual step:

```bash
# from the computor-fullstack root
python computor-backend/src/computor_backend/scripts/generate_error_codes.py
cp computor-web/src/generated/errors/error-catalog.vscode.json \
   ../computor-vsc-extension/src/exceptions/generated/
```

The generator also emits a full catalog (`error-catalog.json`) and a Markdown
reference (`ERROR_CODES.md`). Neither is used by the extension, so neither is
vendored here — read them in `computor-web/src/generated/errors/`.
