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
5. The manager owns a sacred scratchpad folder for project-local coordination memory.
6. The manager owns an append-only sacred session log inside that folder.
7. Workers may read from and write to the manager folder, but only within that manager-owned scope.
8. The human may inspect workers, but should rarely need to.
9. The manager must summarize and reconcile worker progress for the human.
10. A project should never require multiple top-level managers unless explicitly designed otherwise in a future version.

## Role Model

### Manager

The manager is responsible for:

- understanding the human's request
- deciding whether to answer directly or delegate
- breaking work into bounded worker tasks
- tracking worker status
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

The worker is not supposed to:

- become a second manager
- launch other workers by default
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
- worker: `gpt-5-codex`
- manager interaction mode: `default` only

Future-friendly requirement:

- this policy should eventually be represented as a first-class orchestration rule, not only as UI defaults or ad hoc prompt behavior

## User Experience Goals

The human experience should be:

- project-first, not thread-first
- calm, legible, and low-switching
- audit-friendly
- manager-centric
- capable of showing depth without demanding attention to it

The user should feel:

- "I am steering one system"
- not "I am juggling twenty disconnected conversations"

## UI Layout

The UI should follow the existing design system:

- restrained dark archive/editorial feel
- dense but calm
- thin borders, not heavy surfaces
- mono-first labeling and metadata
- one warm accent for active state

### Project Sidebar

Each project should visually center around its manager.

Rules:

- manager row appears first in the project section
- manager row is clearly labeled and visually primary
- worker rows appear beneath the manager as secondary items
- worker rows may be collapsible under the manager
- the human should be able to ignore worker rows without losing understanding

Recommended presentation:

- manager row uses the existing bordered, archive-card-like emphasis
- worker rows use lighter visual weight
- worker metadata is compact: status, last activity, branch/worktree if relevant

### Main Conversation Area

When the manager is open, the main pane should feel like the control center for the project.

Recommended sections:

1. Manager conversation timeline
2. Current worker strip or table
3. Sacred memory shortcuts
4. Delegation composer state

Behavior:

- the manager conversation remains the default focus
- worker activity appears as summarized operational context, not as primary conversation clutter
- the sacred log and manager folder should be one click away

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

## Delegation Flow

The ideal flow is:

1. Human tells manager what they want.
2. Manager decides whether delegation is needed.
3. Manager launches one or more bounded workers when execution is required.
4. Workers execute and report progress.
5. Key lifecycle events are captured in the sacred log.
6. Manager reconciles outcomes and reports back to the human.

The human should not need to:

- manually pick which worker to message next
- manually reconcile conflicting worker outputs
- manually remember which worker did what

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

## Acceptance Criteria

This feature is successful when:

1. A human can treat the manager as the default project interface.
2. A project has one obvious managerial control plane.
3. Workers can execute in the background without forcing human micromanagement.
4. The sacred log provides durable managerial continuity.
5. Manager and worker roles are clearly different in both behavior and UI.
6. The UI makes the system feel more organized, not more complicated.

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
