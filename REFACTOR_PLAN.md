# Refactor Plan Toward `goal.md`

Last updated: 2026-02-26 (current state recorded)

## How to use this file in future sessions

- This is the single source of truth for long-term progress.
- Each step has `status: pending` or `status: done`.
- When a step is completed, change its status to `done` and add completion notes/date.
- Keep scope incremental: finish one step at a time, then commit.

## Current baseline (observed in repository)

- Status: `done`
- Notes:
  - Existing app is a single-player Three.js browser prototype.
  - Local input, local movement, local physics.
  - No server, no multiplayer sync, no sandbox scripting yet.
  - 2026-02-26 verification snapshot:
    - Client build is working (`npm --prefix packages/client run build`) after switching scripts to package-local `vite`.
    - Root test command runs but is still a placeholder (`No automated tests implemented yet`).
    - `server` and `sandbox` processes are placeholders with heartbeat logs only (no WebSocket/gameplay integration yet).

## Phase 1: Repository and Runtime Structure

1. Create monorepo layout (`packages/client`, `packages/server`, `packages/sandbox`).
   - status: `done`
   - completed: `2026-02-26`
   - notes: Added package folders and basic package-level `package.json` files.
2. Move current Vite app into `packages/client` and keep it runnable.
   - status: `done`
   - completed: `2026-02-26`
   - notes: Moved `index.html` and `src/` into `packages/client/`, added client scripts.
3. Add root scripts for concurrent dev (`client + server + sandbox`) and tests.
   - status: `done`
   - completed: `2026-02-26`
   - notes: Added root `dev`, `dev:*`, and `test` scripts plus `scripts/dev.mjs` orchestrator.

## Phase 2: Authoritative Server Core

4. Implement WebSocket server with player connect/disconnect lifecycle.
   - status: `done`
   - completed: `2026-02-26`
   - notes: Added Node WebSocket gateway (RFC6455 handshake + frame parsing), `welcome` on connect, and `spawn`/`despawn` lifecycle broadcasts with verified connect/disconnect smoke test.
5. Add authoritative `WorldState` and `PlayerState` models.
   - status: `done`
   - completed: `2026-02-26`
   - notes: Added dedicated `WorldState`/`PlayerState` modules in `packages/server/src/` and migrated server lifecycle/state access to model methods without changing network message flow.
6. Implement fixed tick simulation loop (20 Hz), including gravity and jump cooldown.
   - status: `done`
   - completed: `2026-02-26`
   - notes: Added fixed-step server simulation (`1/20s`) in `WorldState.simulateTick()`, including per-player gravity integration and jump cooldown enforcement in `PlayerState.simulateTick()`. Server now accepts `jump` and `input.buttonsBitmask` jump requests to exercise cooldown path.
7. Enforce server-side movement validation (acceleration/speed clamps, no client position trust).
   - status: `done`
   - completed: `2026-02-26`
   - notes: Added authoritative input intent parsing (`buttonsBitmask`, `yaw`, `pitch`) and server-side movement integration with acceleration, friction, world-bounds, and horizontal speed clamps. Server ignores any client position payloads by design and only applies validated input intents.

## Phase 3: Client/Server Networking

8. Replace local client simulation with input sending (`input { seq, buttonsBitmask, yaw, pitch }`).
   - status: `done`
   - completed: `2026-02-26`
   - notes: Client now connects to server WebSocket and sends fixed-rate `input` messages (`seq`, `buttonsBitmask`, `yaw`, `pitch`) at 20 Hz. Local movement physics loop was removed and client position is now sourced from authoritative server state messages (`welcome` snapshot + `spawn`/`despawn` cache).
9. Implement server snapshots/deltas and client-side interpolation.
   - status: `done`
   - completed: `2026-02-26`
   - notes: Server now sends periodic full `snapshot` replication and tick-level `delta` updates for changed players. Client consumes `snapshot`/`delta` messages, buffers authoritative samples, and renders local player position using time-delayed interpolation to reduce jitter.
10. Add multiplayer spawn/despawn rendering for multiple players.
   - status: `pending`

## Phase 4: Script Upload and Sandbox Isolation

11. Add `scriptUpload { code, version }` message flow and `scriptStatus` response.
   - status: `pending`
12. Build sandbox worker process protocol (`compile`, `exec`) via stdin/stdout JSON.
   - status: `pending`
13. Ensure scripts never run in main server process.
   - status: `pending`
14. Add timeout/kill/respawn behavior for sandbox workers.
   - status: `pending`

## Phase 5: Script API, Intents, and Validation

15. Implement PoC hook `onTick(ctx, api, state)` with read-only state projection.
   - status: `pending`
16. Implement intent API (`emitEffect`, `setFlag`, `requestImpulse`) in sandbox response.
   - status: `pending`
17. Validate and clamp all intents on server before applying.
   - status: `pending`
18. Add per-exec and per-player script budgets (token bucket + max intents/response size).
   - status: `pending`

## Phase 6: UI and Tooling

19. Add client script editor panel and compile/runtime status display.
   - status: `pending`
20. Add effect rendering for server-emitted effects.
   - status: `pending`
21. Add simple diagnostics panel (connection state, tick, ping, script health).
   - status: `pending`

## Phase 7: Testing and Hardening

22. Add server unit tests (movement clamps, jump cooldown, intent validation, state projection).
   - status: `pending`
23. Add sandbox unit tests (syntax/runtime errors, timeouts, intent collection).
   - status: `pending`
24. Add integration tests (mock client + script upload + malicious script resilience).
   - status: `pending`
25. Add Playwright E2E smoke test (connect, move, upload script, observe effect).
   - status: `pending`

## Milestone mapping (from `goal.md`)

- Milestone 1 (authoritative movement): steps 4-8
- Milestone 2 (multiplayer replication): steps 9-10
- Milestone 3 (script upload + compile validation): step 11 + compile part of step 12
- Milestone 4 (onTick + cosmetic flag): steps 15-17
- Milestone 5 (emitEffect + render): steps 16 + 20
- Milestone 6 (timeouts + worker respawn): step 14 + step 23
