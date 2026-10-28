# Antigravity Workflow & Engineering Rules

This repository integrates four coordinated development systems:
1. **GSD (Get Shit Done)**: Structured planning, task breakdown in `.planning/`, and verification.
2. **Ponytail**: Ruthless code simplicity, reuse of existing project utilities, and zero bloat.
3. **CodeRabbit**: Systematic code reviews across security, logic, test coverage, and performance.
4. **Ralph Loop**: Bounded iterative implementation and test-driven fix loops with strict safety halts.

---

## The Coordinated Development Lifecycle

When working on features, bug fixes, or refactoring in this repository:

1. **Plan & Specify (GSD)**:
   - For multi-step tasks, define requirements and task waves under `.planning/`.
   - Keep tasks atomic and focused.

2. **Design with Simplicity (Ponytail)**:
   - Check existing modules (`packages/backend`, `packages/rustfs`, `apps/app/src/lib`) before writing new utilities.
   - Favor web platform standards and simple declarative logic over elaborate patterns.
   - Keep the diff footprint as minimal as possible.

3. **Iterate & Verify Safely (Ralph Loop)**:
   - Make atomic edits.
   - Execute project validation checks (e.g., `npm run test`, `npx biome check`, `npx tsc --noEmit`).
   - If tests fail, diagnose and fix within a strict limit of 5 iterations. Stop immediately if the same error repeats twice.
   - Never push, merge, or run destructive database commands autonomously.

4. **Review & Audit (CodeRabbit)**:
   - Review changes for logic errors, edge cases, security vulnerabilities, performance regressions, and test completeness.
   - If the CodeRabbit CLI is available, execute `coderabbit review`. Otherwise, run an in-agent review table before declaring a task complete.
