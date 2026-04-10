---
name: q9-release
description: Use when Hasan asks to "ship it", "release version", "give me the new DMG", "package a new build", or otherwise wants the latest Q9 desktop release built, verified, pushed to hhushhas/q9code, and copied into Downloads.
---

# Q9 Release

Ship Q9 desktop releases from this repo with the fork-aware workflow below.

## Use This Skill For

- Shipping the latest `main` commits to `hhushhas/q9code`
- Building a fresh macOS arm64 DMG/ZIP
- Giving Hasan a Downloads path for the installable DMG
- Releasing when the local worktree is dirty and only part of it should ship

## Workflow

1. Inspect scope first.
   - Check `git status -sb`, `git log --oneline origin/main..HEAD`, and recent commits.
   - If there are uncommitted changes unrelated to the requested release, leave them alone.
   - If the requested release depends on a narrow local fix, commit only that scope.

2. Push the intended release commit(s) to `origin main`.
   - `origin` must be `https://github.com/hhushhas/q9code.git`.
   - If push fails with `denied to msbilal01`, switch GitHub CLI back first:
     - `gh auth switch -u hhushhas`

3. Verify from a clean clone of the fork, not the dirty workspace.
   - Prefer cloning `https://github.com/hhushhas/q9code.git` into `/tmp/q9code-remote-*`.
   - This repo has fork-sensitive behavior, so release verification should come from the fork clone.
   - Run:
     - `bun install --frozen-lockfile`
     - `bun run fmt:check`
     - `bun run lint`
     - `bun run typecheck`
     - `bun run test`

4. Build the desktop release from that same clean fork clone.
   - Run:
     - `T3CODE_DESKTOP_UPDATE_REPOSITORY=hhushhas/q9code bun run dist:desktop:dmg:arm64`

5. Copy artifacts back to the main workspace.
   - Refresh:
     - `release/Q9-Code-0.0.15-arm64.dmg`
     - `release/Q9-Code-0.0.15-arm64.dmg.blockmap`
     - `release/Q9-Code-0.0.15-arm64.zip`
     - `release/Q9-Code-0.0.15-arm64.zip.blockmap`
     - `release/latest-mac.yml`
     - `release/builder-debug.yml`

6. Put a fresh DMG in Downloads with a timestamped filename.
   - Use `Q9-Code-0.0.15-arm64-YYYY-MM-DD-HHMM.dmg`
   - Do not rely on replacing an older Downloads DMG in place.

7. Report the result clearly.
   - Include pushed commit hash(es)
   - Include the clean-clone verification result
   - Include the exact Downloads DMG path
   - Mention that fork GitHub Actions may still show zero runs if they are not auto-triggering

## Notes

- Never use `bun test`; always use `bun run test`.
- Keep release commits scoped. Do not accidentally ship unrelated dirty worktree changes.
- If verification fails in a local clone because branch names still derive from `q9code`, verify from the fork clone and fix the fork-specific behavior before packaging.
