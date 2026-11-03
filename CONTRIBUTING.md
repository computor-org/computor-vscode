# Contributing

## Setup

Follow the [Developer Guide](docs/developer-guide.md#development-setup): Node.js 24,
`npm ci`, then `F5` in VS Code to start an Extension Development Host.

## Changes

1. Branch from `main`.
2. Keep each pull request to one change. User-visible text goes through `say(en, de)`
   in code, and command titles through `package.nls.json` and `package.nls.de.json`;
   update the help pages in `docs/help/` (English and `_de`) when a label or
   behaviour they describe changes.
3. Before pushing, run the checks CI runs:

   ```bash
   npm run type-check
   npm run lint
   npm run check:assets
   npm run check:backend-compat
   npm run test:coverage
   npm run compile:fast
   ```

   `npm run test:extension-host` runs the extension host tests in a real VS Code
   (CI runs them too, under `xvfb-run` on Linux).

## Pull requests

Open the pull request against `main` with a short imperative title; it becomes the
commit message. Pull requests are merged through the merge queue as one squashed
commit, and the required checks run there. Release branches follow
[RELEASING.md](RELEASING.md).

## Licence

Code contributions are licensed under the [MIT License](LICENSE), documentation under
[CC BY 4.0](LICENSE-DOCS).
