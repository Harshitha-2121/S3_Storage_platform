---
name: gsd-workflow
description: >-
  Get Shit Done (GSD): Structured spec-driven planning, wave task breakdown, atomic execution,
  and verification workflow for Antigravity. Use when planning features, initializing projects,
  or executing multi-step engineering tasks.
---

# GSD (Get Shit Done) Workflow for Antigravity

The GSD framework enforces context hygiene, spec-driven development, atomic execution waves, and explicit verification steps to prevent context rot and hallucination during multi-step implementations.

---

## 1. Core Principles

1. **Context Protection**: Keep conversational context lightweight. State lives on disk in `.planning/`.
2. **Spec-Driven**: Never jump straight into code. Produce a requirement spec and task waves first.
3. **Atomic Execution**: Complete exactly one task at a time, verify it against acceptance criteria, and checkpoint state before moving on.
4. **Verification Gates**: An implementation is incomplete until its automated checks, tests, or static validations pass.

---

## 2. Directory Structure (`.planning/`)

Maintain task state in `.planning/` at the root of the workspace:

```
.planning/
├── requirements.md      # Problem statement, requirements, and constraints
├── roadmap.md          # High-level architecture, milestones, and phases
├── waves/              # Task waves (atomic, ordered breakdown)
│   ├── wave-01.md
│   └── wave-02.md
└── verification.md     # Test commands, criteria, and verification results
```

---

## 3. Workflow Phases

### Phase A: Initialize & Specify
- Create `.planning/requirements.md` capturing goals, user stories, non-functional requirements, and safety boundaries.
- Formulate `.planning/roadmap.md` defining phases and dependencies.

### Phase B: Wave Breakdown
- Break phases into discrete "Waves".
- Each wave (`.planning/waves/wave-XX.md`) contains:
  - Target files
  - Step-by-step atomic modifications
  - Explicit acceptance criteria
  - Commands to verify correctness (e.g., `npm run test`, `npx tsc --noEmit`)

### Phase C: Wave Execution
- Execute one task from the current wave.
- Favor existing utilities, maintain strict type checking, and follow the project's coding standards.
- Run the wave's verification command immediately after implementation.

### Phase D: Verification & Handoff
- Record execution output in `.planning/verification.md`.
- Mark task as completed in the wave file.
- Checkpoint changes via Git before moving to the next task or wave.
