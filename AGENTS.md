# WorkGrid Delivery Rules

These checks are mandatory for every user-visible change and release:

1. Inspect the current Git status and preserve unrelated user changes.
2. Add or update focused tests for the changed behavior.
3. Run `npm test` for logic and data compatibility regressions.
4. Run `npm run build` for TypeScript and production-build validation.
5. Run `npm run test:ui` for desktop and mobile browser regressions.
6. Run `git diff --check` and inspect the final diff and Git status.
7. Push only after every required local check passes.
8. Wait for the GitHub Pages workflow to pass, then verify the deployed site before reporting a release as complete.

Never claim a check passed if it was skipped or did not complete. State any unrun verification and its impact explicitly.
