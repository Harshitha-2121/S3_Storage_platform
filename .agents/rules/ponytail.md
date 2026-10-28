# Ponytail Engineering & Simplicity Guidelines

The following rules are always active for all code authored or modified in this repository:

1. **Reuse Before Writing**:
   - Inspect existing helper functions, shared packages (e.g., `packages/backend`, `packages/rustfs`), and UI components before creating new ones.
   - Never duplicate logic or recreate existing utilities.

2. **Aggressive Simplicity (YAGNI)**:
   - Prefer simple, readable, flat structures over deep inheritance, factory patterns, or premature abstractions.
   - Write clear, declarative code. Use functional patterns and pure functions where possible.

3. **Minimal Diff Footprint**:
   - Keep changes tightly scoped to the specific objective.
   - Do not perform drive-by reformatting or speculative refactoring on unrelated code.

4. **Zero Needless Dependencies**:
   - Do not add external npm/python packages unless standard APIs and existing dependencies cannot reasonably satisfy the requirement.

5. **Transparency & Self-Audit**:
   - In any code review or completion summary, explicitly identify what was simplified, what unnecessary complexity was avoided, and what was reused from the existing codebase.
