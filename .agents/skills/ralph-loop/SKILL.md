---
name: ralph-loop
description: >-
  Ralph Loop: Iterative task implementation, verification, test execution, and safe fix cycle.
  Executes coding tasks until explicit completion criteria are satisfied or safety boundaries are reached.
---

# Ralph Loop Workflow for Antigravity

Ralph Loop provides a disciplined, bounded iterative cycle that guides task execution, runs verifications, analyzes errors, and applies targeted fixes without unbounded autonomous risk.

---

## 1. Safety Guardrails (Non-Negotiable)

1. **Iteration Limit**:
   - Default maximum iterations: **5 iterations**.
   - Under no circumstances will the loop run indefinitely.
2. **Git Checkpoint Requirement**:
   - The working tree must be in a clean or checkpointed state before initiating major changes.
3. **Repeated Failure Halt**:
   - If the same error or test failure occurs across 2 consecutive iterations without progress, the loop **halts immediately** and reports the blocker.
4. **Prohibited Autonomous Actions**:
   - The loop will **never**:
     - Push or merge code to remote repositories.
     - Delete database records, drop tables, or run destructive drop/truncate commands.
     - Deploy applications to cloud environments without explicit confirmation.
     - Invoke unmetered paid third-party APIs.

---

## 2. Iteration Loop Structure

```
[Start Task]
    │
    ▼
┌──────────────────────────────────────────────┐
│ Iteration N <= MaxIterations                │
│                                              │
│ 1. Read Task Spec (from .planning/wave-XX)   │
│ 2. Apply Targeted Code Modification          │
│ 3. Execute Automated Verification / Tests   │
│ 4. Check Criteria Pass / Fail                │
└──────────────────────────────────────────────┘
    │
    ├─► [PASSED] ──► Checkpoint Git ──► Complete Task & Proceed to Next
    │
    └─► [FAILED]
           │
           ├─► Same failure 2x OR N == MaxIterations? ──► HALT & Request Review
           │
           └─► New failure? ──► Increment N ──► Apply Targeted Fix
```

---

## 3. State & Progress Tracking

Track loop state in `.planning/ralph-progress.md`:
- Current Task ID & Description
- Iteration count (e.g., `Iteration 2/5`)
- Command run (e.g., `npm run test` or `npx biome check`)
- Failure symptoms / stack trace
- Fix hypothesis & adjustments made
- Final outcome: `SATISFIED`, `MAX_ITERATIONS_REACHED`, or `HALTED_ON_REPEATED_ERROR`
