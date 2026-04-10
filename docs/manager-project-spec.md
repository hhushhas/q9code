# Manager-First Project Spec

## Short Version

Q9 Code should move from thread-by-thread micromanagement to one manager per project. The human talks to the manager, and the manager coordinates worker agents. The manager owns a sacred scratchpad folder and append-only session log that preserve continuity, create an audit trail, and give delegated workers a shared project-local memory surface. That turns a messy swarm of disconnected threads into a single durable control plane: one long-lived coordinator, multiple bounded executors, and far less cognitive switching for the human.

## Product Intent

The system should feel like:

- one project
- one manager
- many workers
- one place for the human to think and steer

The human should not have to manually coordinate 15 to 20 separate agent threads. Q9 should absorb that coordination burden into the manager thread.

## Core Rules

1. Each project has exactly one manager thread.
2. The default human entry point for a project is the manager, not a worker.
3. The manager is a coordinator, not a primary executor.
4. Workers are bounded executors launched by the manager to carry out specific tasks.
5. The human must be able to rename the manager.
6. The manager owns a sacred scratchpad folder for project-local coordination memory.
7. The manager owns an append-only sacred session log inside that folder.
8. Workers may read from and write to the manager folder, but only within that manager-owned scope.
9. The human may inspect workers, but should rarely need to.
10. The manager must summarize and reconcile worker progress for the human.
11. A project should never require multiple top-level managers unless explicitly designed otherwise in a future version.

## Role Model

### Manager

The manager is responsible for:

- understanding the human's request
- deciding whether to answer directly or delegate
- breaking work into bounded worker tasks
- tracking worker status
- being alerted when a worker changes state in a way that matters
- maintaining continuity through the sacred log
- summarizing outcomes back to the human
- reducing cognitive switching for the human

The manager is not supposed to:

- act like a normal execution-heavy worker by default
- expose plan mode as a user-facing control
- require the human to manually orchestrate worker threads

### Worker

The worker is responsible for:

- executing a narrow assigned task
- reporting concrete outcomes
- staying scoped to the assignment
- writing useful trace information into manager-owned memory when appropriate
- optionally using codex-app subagents for exploration, investigation, or support work when helpful

The worker is not supposed to:

- become a second manager
- launch sibling or child workers inside the Q9 manager-worker hierarchy
- own independent long-lived coordination state outside the manager system

## Memory Model

Each project manager owns:

- a manager folder under project scratchpad
- a manager session log file inside that folder

The sacred manager log should be treated as:

- append-only by default
- durable across long-running work
- the first place to preserve important coordination state that may outlive model context
- the audit trail for what the manager asked, what workers did, and what changed

The manager folder may also contain:

- worker notes
- task manifests
- summaries
- checkpoints
- implementation handoff notes

## Model and Runtime Policy

The product should express coordinator and executor policy explicitly.

Initial policy:

- manager uses the coordinator model
- worker uses the execution model
- manager gets the highest-context coordinator configuration allowed by product policy
- workers do not inherit the manager's context policy
- manager does not expose plan mode

Initial Q9 mapping:

- manager: `gpt-5.4`
- worker: `gpt-5.4`
- manager interaction mode: `default` only

Future-friendly requirement:

- this policy should eventually be represented as a first-class orchestration rule, not only as UI defaults or ad hoc prompt behavior

## User Experience Goals

The human experience should be:

- project-first, not thread-first
- calm, legible, and low-switching
- audit-friendly
- manager-centric
- understandable at a glance
- capable of showing depth without demanding attention to it

The user should feel:

- "I am steering one system"
- not "I am juggling twenty disconnected conversations"

## UI Layout

The UI should follow [design.md](/Users/macmini/Desktop/Code/t3code/design.md).

This spec should focus primarily on layout, semantics, and information hierarchy rather than restating theme tokens.

### Project Sidebar

Each project should visually center around its manager.

Rules:

- manager row appears first in the project section
- manager row uses the human-provided manager name
- manager row is clearly labeled and visually primary
- worker rows appear beneath the manager as secondary items
- worker rows are indented and nested under their manager
- worker rows may be collapsible under the manager
- the human should be able to ignore worker rows without losing understanding

Recommended presentation:

- manager row uses the existing bordered, archive-card-like emphasis
- worker rows use lighter visual weight
- worker metadata is compact: status, last activity, branch/worktree if relevant

### Main Conversation Area: The Split Workstation

When a Manager thread is active, the main pane transitions into a **Split Workstation** layout. This layout physically separates project-level monitoring (Console) from strategic communication (Conversation), ensuring the manager's overview is always actionable and persistent.

#### 1. Unified Manager Header

The top application header reflects the project context. The "Manager Console" label is placed directly next to the project name to save vertical space.

- **Project Name**: Left-aligned, primary weight.
- **Manager Badge**: A distinct, high-contrast badge (e.g., `#fb7185` background) indicating "Manager Console" or "Coordinator Mode."
- **Actions**: "Add Action," "Open," and "Commit & Push" remain pinned to the right.

#### 2. Project Console (Left Pane)

A persistent, high-density dashboard that stays visible while the conversation scrolls.

- **Semantics**:
  - **Resizable**: The pane can be horizontally resized via a drag-divider.
  - **Collapsible**: A dedicated toggle allows the console to be hidden, expanding the conversation to full width.
- **Content Sections**:
  - **Project Swarm (Health)**: A summary of worker states (e.g., "2 Active," "1 Blocked").
  - **Sacred Memory**: Direct shortcuts to `session-log.md` and the `scratchpad/` folder.
  - **Worker List**: A vertical stack of delegated workers with their status indicators (Pulse for working, Red for blocked).
  - **Quick Actions**: Buttons for "+ Delegate Worker" and "Reconcile Logs."

#### 3. Manager Conversation (Right Pane)

The primary steering surface where the human interacts with the coordinator.

- **Conversation Feed**: Summarized worker activity (completion chips) is injected into the timeline as rich cards, not raw text.
- **Delegation Composer**: A specialized input area locked to the Coordinator model (`GPT-5.4`).

#### 4. ASCII Mockup (Split View)

```text
+---------------------------------------------------------------------------------------+
|  Q9 Code [ALPHA] | Project: hasan-hq [ MANAGER CONSOLE ]            [ Open ] [ Push ] |
+------------------+--------------------------------------------------------------------+
| PROJECTS     + |                                                                    |
| > hasan-hq     | [ PROJECT CONSOLE ] (30%)     | [ MANAGER CONVERSATION ] (70%)     |
|   [*] MGR      | <Resizers/Toggle Available>    |                                    |
|   [ ] worker-1 |                                | [BOT] Worker 'auth-patch' is       |
|   [ ] worker-2 | [ PROJECT SWARM ]              | approximately 80% done.            |
|                | 2 Active | 1 Blocked           |                                    |
| > q9code       |                                | [USER] What is blocking 'db-fix'?  |
|   [*] MGR      | [ SACRED MEMORY ]              |                                    |
|                | [F] session-log.md             | [BOT] 'db-fix' needs a schema      |
|                | [D] scratchpad/                | migration approval.                |
|                |                                |                                    |
|                | [ WORKERS ]                    | +--------------------------------+ |
|                | @ auth-patch   [ WORKING ]     | | [ WORKER ACTIVITY ]            | |
|                | ! db-fix       [ BLOCKED ]     | | 'ui-polish' finished tests.    | |
|                | . ui-polish    [ IDLE    ]     | | [ View Output ] [ Summarize ]  | |
|                |                                | +--------------------------------+ |
|                | [ ACTIONS ]                    |                                    |
|                | [ + DELEGATE WORKER ]          | [ DELEGATION COMPOSER ]            |
|                | [ RECONCILE LOGS    ]          | [ Ask for a change...        ] [^] |
+----------------+--------------------------------+------------------------------------+
```

#### 5. Behavioral Rules

- **One-Click Recovery**: Clicking a "Sacred Memory" shortcut opens the file/folder in the user's preferred editor immediately.
- **Status Persistence**: If a worker becomes "Blocked," the corresponding indicator in the Project Console must turn red and optionally pulse to alert the manager.
- **Summarized Operational Context**: Detailed worker tool-calls are hidden from the Manager timeline by default; only managerial-level summaries and "Worker Activity" chips are shown.
- **No Plan Mode**: The "Plan Mode" toggle is hidden in the Manager thread to emphasize steering over local execution.

### Worker Visibility

Worker detail should be available but de-emphasized.

Rules:

- workers are inspectable
- workers are not the default interaction surface
- the manager should summarize worker outcomes in the main manager thread
- worker sprawl should not dominate the sidebar or main pane

### Composer and Controls

When viewing a manager thread:

- plan mode toggle is hidden
- coordinator model is fixed by policy
- the UI should reinforce that this thread is for steering and delegation

When viewing a worker thread:

- controls may remain normal
- the worker should still visually indicate that it belongs to a manager

## Prompt and Instruction Layering

Manager and worker instructions should be injectable through `AGENTS.md`, but the instruction system must preserve role integrity.

Requirements:

- shared project guidance may come from `AGENTS.md`
- manager-specific instructions must remain authoritative for manager behavior
- worker-specific instructions must remain authoritative for worker behavior
- injected instructions must compose rather than conflict
- the system should avoid producing ambiguous blended prompts that make a manager behave like a worker or vice versa

Practical rule:

- `AGENTS.md` should provide project-level guidance
- role prompts should provide manager-versus-worker behavioral policy
- if the two conflict, role policy should win for role-specific behavior

## Delegation Flow

The ideal flow is:

1. Human tells manager what they want.
2. Manager decides whether delegation is needed.
3. Manager launches one or more bounded workers when execution is required.
4. Workers execute and report progress.
5. Key lifecycle events are captured in the sacred log.
6. When a worker finishes, fails, or materially changes state, the manager is alerted automatically.
7. Manager reconciles outcomes and reports back to the human.

The human should not need to:

- manually pick which worker to message next
- manually reconcile conflicting worker outputs
- manually remember which worker did what
- manually ping the manager just to make it notice worker completion

## Status Model

At minimum, workers should surface:

- idle
- queued
- running
- waiting
- blocked
- completed
- failed

The manager should be able to summarize:

- what is active
- what is blocked
- what is complete
- what needs human input

The manager should also receive internal alerts for:

- worker completed
- worker failed
- worker blocked
- worker waiting on human input
- worker produced a result that requires managerial synthesis

## Failure and Recovery

The system should remain understandable when things go wrong.

Requirements:

- if a worker fails, the manager should surface that clearly
- if a worker stalls, the manager should be able to detect and respond
- if the app restarts, the manager log should preserve coordination continuity
- the sacred log should be sufficient to recover project context at a managerial level

## Non-Goals For This Version

This spec does not require:

- multiple top-level managers per project
- fully autonomous recursive worker spawning
- full replacement of all thread views with manager-only abstractions
- advanced memory retrieval or semantic search over sacred logs
- automatic conflict resolution between workers beyond manager mediation
- worker-created Q9 workers beneath the manager-worker hierarchy

This spec does allow:

- workers to use codex-app's own subagent primitives for exploration, investigation, or support work, so long as those do not become first-class Q9 workers in the manager hierarchy

## Acceptance Criteria

This feature is successful when:

1. A human can treat the manager as the default project interface.
2. A project has one obvious managerial control plane.
3. Workers can execute in the background without forcing human micromanagement.
4. Worker completion or blockage is surfaced back to the manager automatically.
5. The sacred log provides durable managerial continuity.
6. Manager and worker roles are clearly different in both behavior and UI.
7. The UI makes the system feel more organized, not more complicated.
8. The human can understand what is going on at a glance.

## Implementation Guidance

Build for explicitness over cleverness.

Prefer:

- first-class manager and worker policy
- server-enforced invariants
- durable auditability
- manager-first UI hierarchy

Avoid:

- treating the manager as just another normal thread with a special prompt
- letting workers inherit coordinator settings accidentally
- making the user manually manage delegation plumbing
- allowing UI affordances that contradict the role model
