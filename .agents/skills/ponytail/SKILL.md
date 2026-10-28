---
name: ponytail
description: >-
  Ponytail: Enforces minimal, clean, maintainable code, maximizes reuse of existing utilities,
  and eliminates unnecessary abstractions and dependencies. Use when designing, writing, or refactoring code.
---

# Ponytail — The Minimalist Senior Engineering Skill

> **"The best code is the code you never wrote."**

Ponytail enforces simplicity, aggressive pragmatism, and strict avoidance of over-engineering across all implementation, refactoring, and pair-programming tasks.

---

## 1. Core Principles & Decision Ladder

When designing or modifying code, always evaluate options in this strict order:

1. **Do not write code**: Can this requirement be solved by reusing an existing internal utility, existing React component, or standard library helper?
2. **Use platform natives**: Rely on Web Standards (HTML5 semantics, CSS, standard JavaScript/TypeScript APIs) before considering any external library or complex abstraction.
3. **Keep it flat & readable**: Avoid unnecessary design patterns (factories, managers, abstract wrappers) when a straightforward pure function or simple component suffices.
4. **Small, focused changes**: Touch the minimum number of lines and files required to achieve the goal. Avoid unrelated refactoring.
5. **Zero unnecessary dependencies**: Do not install packages for trivial tasks (e.g., date formatting, class merging, string manipulation) if standard library or existing project packages already solve it.

---

## 2. Intensity Levels

- **Lite**: Gently highlights potential over-engineering and suggests existing utilities.
- **Full (Default)**: Rejects bloated designs, insists on existing codebase helpers, and eliminates redundant abstractions.
- **Ultra**: Strictly restricts new files, enforces minimal diff footprint, and requires explicit justification for any new helper function.

---

## 3. Pre-Commit / Pre-Review Checklist

Before finalizing any implementation, verify:
- [ ] Are any newly added helper functions duplicates of existing utilities in `packages/` or `apps/`?
- [ ] Can any new abstraction or wrapper be collapsed into a direct, standard call?
- [ ] Are all added dependencies strictly necessary, or can native runtime capabilities replace them?
- [ ] Is the diff as small and legible as possible?
