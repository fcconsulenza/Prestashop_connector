# Isolated dependency remediation

This branch updates the root Zod dependency to ^4.6.7 and records the audit-time lockfile. GHSA-mrhx-c7xc-m3w5 was reported against the baseline dependency resolution. The candidate pnpm audit reports no vulnerabilities at the time of the audit; this is not a permanent guarantee or proof of production deployment.

Ten tests pass with synthetic credentials, fake store gateways and local MCP transports. The added server test checks absent/incorrect bearer rejection, schema discovery and invalid store identity types. No real store keys are provided and no store requests are needed.

Reproduce in an isolated environment with Node >=20 and pnpm: `pnpm install --frozen-lockfile --ignore-scripts`, `node --test test/*.test.js`, `pnpm audit --json`. Check the test filename extensions in the repository; use `node --test test` if the shell does not expand globs. No merge or deployment is authorized by this branch.
