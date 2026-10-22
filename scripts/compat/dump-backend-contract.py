"""Dump the API contract of a computor-backend checkout for the compat guard.

Run inside the backend's environment (it imports the FastAPI app, which needs
no database or network to build its OpenAPI schema):

    uv run --project <backend>/computor-backend \
        python scripts/compat/dump-backend-contract.py <label> > compat/backend-<line>.json

The output keeps only what scripts/check-backend-compat.mjs compares: every
path with its methods and success-response schema, and each component's
properties. Sorted, so a refresh shows as a reviewable diff.
"""
import json
import sys

from computor_backend.server import app

KEEP = ("type", "properties", "items", "$ref", "anyOf", "oneOf", "allOf", "additionalProperties",
        "required", "enum", "const")


def trim(schema):
    if isinstance(schema, list):
        return [trim(s) for s in schema]
    if not isinstance(schema, dict):
        return schema
    out = {}
    for key in KEEP:
        if key not in schema:
            continue
        value = schema[key]
        if key == "properties":
            out[key] = {name: trim(prop) for name, prop in value.items()}
        elif key in ("required", "enum"):
            out[key] = sorted(value, key=str)
        elif key == "const":
            out[key] = value
        else:
            out[key] = trim(value)
    return out


def main():
    label = sys.argv[1] if len(sys.argv) > 1 else "unknown"
    spec = app.openapi()
    paths = {}
    for path, item in spec["paths"].items():
        methods = {}
        for method, op in item.items():
            if method not in ("get", "post", "put", "patch", "delete"):
                continue
            response = None
            for code in ("200", "201", "202"):
                content = ((op.get("responses") or {}).get(code) or {}).get("content") or {}
                body = content.get("application/json")
                if body and body.get("schema"):
                    response = trim(body["schema"])
                    break
            methods[method.upper()] = {"response": response}
        paths[path] = methods
    schemas = {name: trim(s) for name, s in spec["components"]["schemas"].items()}
    json.dump({"source": label, "paths": paths, "schemas": schemas}, sys.stdout,
              indent=1, sort_keys=True)
    sys.stdout.write("\n")


if __name__ == "__main__":
    main()
