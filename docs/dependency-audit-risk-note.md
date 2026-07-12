# Dependency Audit Risk Note

Date: 2026-06-08
Branch: feat/route-collection

## Summary

After direct dependency upgrades and targeted transitive overrides, npm audit reports 10 moderate vulnerabilities remaining.

Remaining buckets:

- next -> nested postcss in Next's dependency tree
- firebase-admin/google-cloud chain -> transitive uuid in gaxios/google-gax/teeny-request/retry-request paths

Resolved in this pass:

- protobufjs and @protobufjs/utf8 findings
- @tootallnate/once finding
- brace-expansion findings

## What Was Changed

Added package overrides in package.json:

- protobufjs: 7.5.9
- @protobufjs/utf8: 1.1.1
- @tootallnate/once: 2.0.1
- minimatch@^3.1.5 -> brace-expansion: 1.1.13
- minimatch@^10.2.2 -> brace-expansion: 5.0.6

Validation after change:

- npx tsc --noEmit: pass
- npx eslint .: pass
- targeted vitest suite: pass
- npm audit: 10 moderate remaining

## Risk Decision

Current residual findings are accepted temporarily because they are transitive/upstream constrained and npm's suggested force fix paths are not safe for this repository.

Not approved in this pass:

- npm audit fix --force

Reason:

- It proposes incompatible/breaking dependency transitions and inaccurate downgrade paths.

## Revisit Triggers

Re-run and reassess immediately when any of the following changes:

- next patch/minor release that updates nested postcss path
- firebase-admin or @google-cloud/firestore/@google-cloud/storage release that updates transitive uuid chain
- security advisory severity increases or exploitability guidance changes
- planned dependency maintenance sprint

## Ongoing Policy

For dependency security updates in this repo:

1. Update direct dependencies first
2. Use targeted overrides only when necessary and compatible
3. Validate after each batch: typecheck, lint, tests, build
4. Avoid global force upgrades in regular feature work
5. Keep this note updated with date, remaining findings, and rationale
