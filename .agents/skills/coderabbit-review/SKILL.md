---
name: coderabbit-review
description: >-
  CodeRabbit: Automated and agentic code review workflow inspecting git diffs for bugs, logic errors,
  security vulnerabilities, missing input validation, performance issues, and missing tests.
---

# CodeRabbit Code Review Skill for Antigravity

This skill integrates CodeRabbit's automated code review standards into Antigravity, guiding both agent self-reviews and native CodeRabbit CLI executions.

---

## 1. Review Domains

Every review must evaluate changed files against the following 6 pillars:

1. **Bugs & Logic Errors**:
   - Check edge cases, off-by-one errors, null/undefined pointer dereferences, unhandled async promises, race conditions.
2. **Security & Input Validation**:
   - Verify boundary sanitization, injection vectors (SQL/NoSQL/command injection), authentication/authorization guards, timing attacks, secret leaks.
3. **Performance & Scalability**:
   - Identify unindexed lookups, redundant re-renders, N+1 queries, memory leaks, unneeded allocations in hot loops.
4. **Test Coverage & Quality**:
   - Verify that critical business logic, edge conditions, and error paths have corresponding unit or integration tests.
5. **Maintainability & Idiomatic Design**:
   - Check compliance with project guidelines, clear naming, and avoidance of anti-patterns.
6. **Ponytail Simplicity Alignment**:
   - Ensure the implementation reused existing functions and avoided needless abstractions.

---

## 2. Review Modes

### Mode A: Native CodeRabbit CLI
When the native CodeRabbit CLI is installed (`coderabbit` or `cr`) and authenticated:
- **Review staged/uncommitted changes**:
  ```powershell
  coderabbit review
  ```
- **Review specific files**:
  ```powershell
  coderabbit review --files <path>
  ```
- **Review against a base branch**:
  ```powershell
  coderabbit review --base main
  ```

### Mode B: Agent CodeRabbit Audit
When the CLI is unauthenticated or in offline mode, the agent executes the structured review process directly:
1. Run `git diff` on target files or staged changes.
2. Generate a structured CodeRabbit Review Table:
   | File | Line(s) | Category | Severity | Issue Description & Recommended Fix |
   |------|---------|----------|----------|-------------------------------------|
3. Provide actionable, minimal diff fixes for any high or critical findings.
