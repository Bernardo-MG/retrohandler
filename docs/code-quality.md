# Code quality

The TypeScript conventions follow Ucronia App Frontend's `develop` branch where
applicable to an Electron/React application. Angular-specific conventions do not apply.

- Use two spaces, single quotes and the repository's Prettier configuration.
- Prefer descriptive names, explicit class member visibility, readonly dependencies,
  explicit public service return types and braces for control flow.
- Keep comments focused on contracts, invariants and non-obvious decisions; remove
  historical implementation notes when they no longer explain current behavior.
- Keep Electron and React dependencies at their respective boundaries. Test controllers
  and services with small injected dependencies rather than launching the application.
- Group tests by responsibility. Assert observable results, failure paths and state
  changes; clean up temporary files and subscriptions.

## Automated checks

`npm run validate` runs formatting, lint, type checking, coverage and the application build.
The pull request workflow runs the same gates. ESLint uses TypeScript recommended rules,
explicit class member accessibility, braces and React hook rules. Unused variables,
explicit `any` and hook dependency recommendations are reported as warnings for initial
adoption. Review warnings before merging. Prettier and ESLint use pinned direct tool
versions via `npm exec`, not application runtime dependencies.

## Coverage scope

The Node suite measures executable compiled application JavaScript (not TypeScript
source-map coverage). Initial regression floors are 90% lines, 85% branches and 90%
functions. The runner checks source/compiled test discovery and fails if executable
compiled application modules were never loaded, or an unexpected source file is outside
its test build. Type-only modules have no executable behavior to cover.

The explicit exclusion inventory lists native Electron and React/browser integration
files. Exclusions must not be added merely to improve percentages. Build and packaging
checks supplement but do not replace runtime integration tests. The installer must be
validated in Windows before release. Coverage does not establish that every behavior
or edge case has been tested.
