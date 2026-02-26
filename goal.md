Browser Based 3D Multiplayer Game with Server Side User Scripting
Full Goal and First PoC Implementation Plan

Vision

Build a browser based multiplayer 3D game where:

Players connect via browser.
Movement and physics are server authoritative.
Players can inject custom JavaScript into predefined server side hooks.
Scripts are executed on the server safely.
Scripts can modify limited parts of the game state.
The server enforces strict validation and anti cheat constraints.

The system must remain stable even if players upload malicious, broken, or computationally heavy scripts.

Core Architectural Principles

Server authoritative simulation
Clients only send input events.
Server owns physics, position, velocity, cooldowns, and validation.
Clients never send positions or trusted state.

Untrusted script execution
Player scripts are hostile by default.
They must never execute inside the main server process.
They must be isolated and resource limited.

Deterministic tick loop
Server runs a fixed tick loop, for example 20 Hz.

Each tick performs:
Process buffered inputs.
Advance physics.
Execute player scripts within budget.
Validate and apply script intents.
Broadcast state updates.

System Architecture

Monorepo layout

packages/client
Vite based browser app with Three.js rendering and script editor

packages/server
Node.js authoritative simulation and WebSocket gateway

packages/sandbox
Node.js child process worker that executes user scripts

Root scripts

dev
Runs server, sandbox worker pool, and Vite concurrently

test
Runs unit and integration tests

Networking Design

Transport

WebSocket for realtime bidirectional communication.
JSON message format for PoC.

Client to server messages

hello { name }

input { seq, buttonsBitmask, yaw, pitch }

scriptUpload { code, version }

Server to client messages

welcome { playerId, tickRate, snapshot }

spawn { playerId, state }

despawn { playerId }

stateDelta { tick, players }

scriptStatus { version, ok, error }

effect { type, params }

Server Design

Core modules

WorldState
Map of playerId to PlayerState
Tick counter

PlayerState
position vector
velocity vector
onGround boolean
cooldowns
flags for cosmetic or limited attributes
activeScriptVersion
scriptQuotaTokens
failureCounters
lastInputSequence

Simulation module
Fixed timestep, for example 20 Hz
Gravity
Flat ground plane at y = 0
Acceleration from input
Speed clamp
Jump impulse with cooldown

Player Lifecycle

On connect

Client connects via WebSocket.
Server assigns playerId.
Create PlayerState.
Choose spawn position.
Send welcome message with initial snapshot.
Broadcast spawn event to other players.

On disconnect

Remove player from world state.
Broadcast despawn event.

Script System

Hooks

Only one hook for initial PoC

onTick(ctx, api, state)

Context object

ctx contains
tick number
delta time
playerId

State projection

state contains

self
position
velocity
onGround
flags

nearby
List of nearby players with id and position only

world
current tick

State object must be read only.

API surface

api.emitEffect(type, params)
api.setFlag(name, value)
api.requestImpulse(vec3)

No direct mutation of world state allowed.
API calls collect intents.

Sandbox Design

Isolation strategy

Separate Node child processes.
No script runs inside main server process.
Communication via JSON over stdin and stdout.
Use a fixed worker pool, not per user processes.

Worker protocol

Compile request

type compile
playerId
version
code

Execute request

type exec
playerId
version
ctx
state

Response

ok true with intents array
or
ok false with error

Execution safety

Hard wall clock timeout per execution, for example 3 ms.
If timeout occurs, kill worker process and respawn.
Limit Node heap size via startup flags.
Limit max output size.
Limit number of intents per call.

Worker crashes are tolerated and expected.

Script Budget Enforcement

Per execution limits

Timeout 2 to 5 ms wall clock.
Maximum intents per execution, for example 10.
Maximum serialized response size, for example 16 KB.

Per player quota

Token bucket model.
Tokens refill at fixed rate, for example 10 ms of script time per second.
Each execution consumes fixed cost.
If insufficient tokens, skip execution for that tick.

Global per tick cap

Maximum number of scripts executed per tick.
Remaining players are deferred round robin.

This protects the simulation loop from overload.

Validation Rules

Movement

Clamp maximum horizontal speed.
Clamp acceleration.
Enforce jump cooldown.
Ignore client supplied delta time.

Scripting

Limit code size, for example 30 KB.
Limit compilation frequency per player.
Allowlist flag names and value ranges.
Clamp impulse magnitude.
Rate limit effects per player.
Drop invalid intents.

Client Design

Built with Vite and Three.js.

UI panels

Connect panel
3D canvas
Script editor panel with save button
Status display for compile or runtime errors

Client runtime

Capture keyboard input.
Send input messages at fixed rate, for example 30 Hz.
Receive stateDelta messages.
Interpolate positions between server ticks.
Render simple boxes or capsules for players.
Render effects emitted by server.

Script editor

Textarea or code editor.
On save, send scriptUpload.
Display scriptStatus result.

Testing Strategy

Unit tests server

Speed clamp logic.
Jump cooldown logic.
Intent validation.
State projection correctness.
Input rate limiting.

Unit tests sandbox

Syntax error handling.
Runtime error handling.
Intent collection.
Timeout handling and worker kill.

Integration test

Start server and sandbox worker.
Connect mock client.
Upload valid script.
Verify effect or flag change applied.
Upload infinite loop script.
Verify server remains responsive and script is ignored.

End to end

Use Playwright to automate browser.
Connect, move, upload script, observe visual result.

Development Milestones

Milestone 1
Client connects and spawns.
Authoritative movement and flat ground physics.

Milestone 2
Multiple players replicate state and interpolate.

Milestone 3
Script upload and compile validation only.

Milestone 4
Script execution onTick that changes cosmetic flag.

Milestone 5
Add emitEffect and render effects.

Milestone 6
Add timeout enforcement and worker respawn logic.

Explicit Non Goals for PoC

No persistent storage.
No advanced terrain or collision.
No rollback netcode.
No complex anti cheat beyond clamps.
No production grade scaling.

Final PoC Outcome

A working multiplayer browser game where:

Multiple players connect and move.
The server controls all movement and validation.
Players upload server side JavaScript.
Scripts execute safely in sandbox workers.
Invalid or malicious scripts cannot crash or freeze the server.

This establishes the foundation for a scalable programmable multiplayer environment.