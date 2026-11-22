# Contributing

Thank you for your help with the DATALYR React Native SDK.

## Run the checks

You must use Node.js 22. These are the same commands that CI runs:

```bash
npm ci --legacy-peer-deps
npm run build
npm run lint
npm test -- --ci
```

## Pull requests

- Open an issue first for a large change.
- Keep each pull request to one change.
- Add or change tests for a change in behavior.
- Add an entry to `CHANGELOG.md` for a change that users can see.
- Make sure all checks pass before you ask for a review.
- Do not include secrets or customer data.

Report security problems as described in [SECURITY.md](SECURITY.md).
