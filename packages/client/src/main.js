import * as THREE from "three";

const WORLD_SIZE = 500;
const TERRAIN_SEGMENTS = 220;
const PLAYER_HEIGHT = 1.55;
const MAX_PITCH = THREE.MathUtils.degToRad(75);
const LOOK_AHEAD_DISTANCE = 16.0;
const INPUT_SEND_HZ = 20;
const INPUT_SEND_DT = 1 / INPUT_SEND_HZ;
const INTERPOLATION_BACK_TICKS = 2;
const INPUT_BUTTON_JUMP = 1 << 0;
const INPUT_BUTTON_FORWARD = 1 << 1;
const INPUT_BUTTON_BACKWARD = 1 << 2;
const INPUT_BUTTON_LEFT = 1 << 3;
const INPUT_BUTTON_RIGHT = 1 << 4;
const DEBUG_NET = new URLSearchParams(window.location.search).get("debugNet") === "1";

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x87c9ff);
scene.fog = new THREE.Fog(0x87c9ff, 80, 420);

const camera = new THREE.PerspectiveCamera(
  75,
  window.innerWidth / window.innerHeight,
  0.1,
  1000,
);

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
document.body.appendChild(renderer.domElement);

const ambient = new THREE.HemisphereLight(0xe8f0ff, 0x344022, 0.62);
scene.add(ambient);

const sun = new THREE.DirectionalLight(0xfff2d9, 1.1);
sun.position.set(140, 220, 100);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
sun.shadow.camera.left = -150;
sun.shadow.camera.right = 150;
sun.shadow.camera.top = 150;
sun.shadow.camera.bottom = -150;
scene.add(sun);

const bounce = new THREE.DirectionalLight(0xbfd2ff, 0.28);
bounce.position.set(-120, 80, -130);
scene.add(bounce);

const terrainGeometry = new THREE.PlaneGeometry(
  WORLD_SIZE,
  WORLD_SIZE,
  TERRAIN_SEGMENTS,
  TERRAIN_SEGMENTS,
);
terrainGeometry.rotateX(-Math.PI / 2);

const terrainPosition = terrainGeometry.attributes.position;
for (let i = 0; i < terrainPosition.count; i += 1) {
  const x = terrainPosition.getX(i);
  const z = terrainPosition.getZ(i);
  terrainPosition.setY(i, terrainHeight(x, z));
}
terrainGeometry.computeVertexNormals();
const terrainDetailTexture = createTerrainDetailTexture(renderer);

const terrainMaterial = new THREE.MeshStandardMaterial({
  color: 0x6f8f58,
  map: terrainDetailTexture,
  bumpMap: terrainDetailTexture,
  bumpScale: 0.45,
  roughness: 0.88,
  metalness: 0.02,
});

const terrain = new THREE.Mesh(terrainGeometry, terrainMaterial);
terrain.receiveShadow = true;
scene.add(terrain);

const skyDome = new THREE.Mesh(
  new THREE.SphereGeometry(900, 32, 16),
  new THREE.MeshBasicMaterial({
    color: 0x94d6ff,
    side: THREE.BackSide,
  }),
);
scene.add(skyDome);

const keys = {
  forward: false,
  backward: false,
  left: false,
  right: false,
};

const player = {
  position: new THREE.Vector3(0, PLAYER_HEIGHT + terrainHeight(0, 0), 0),
  courseYaw: 0,
  pitch: 0,
};

const net = {
  socket: null,
  connected: false,
  playerId: null,
  tickRate: INPUT_SEND_HZ,
  interpolationDelayMs: (INTERPOLATION_BACK_TICKS / INPUT_SEND_HZ) * 1000,
  inputSeq: 0,
  inputAccumulator: 0,
  jumpQueued: false,
  playersById: new Map(),
  samplesByPlayerId: new Map(),
  latestServerTick: 0,
  lastStateAtMs: 0,
  sentInputs: 0,
  recvStates: 0,
  lastDebugLogAtMs: 0,
};

const cameraTarget = new THREE.Vector3();
const lookDirection = new THREE.Vector3();
let dragLookActive = false;

const help = document.getElementById("help");

const onKey = (pressed) => (event) => {
  switch (event.code) {
    case "KeyW":
      keys.forward = pressed;
      break;
    case "KeyS":
      keys.backward = pressed;
      break;
    case "KeyA":
      keys.left = pressed;
      break;
    case "KeyD":
      keys.right = pressed;
      break;
    case "Space":
      if (pressed) net.jumpQueued = true;
      break;
    default:
      break;
  }
};

document.addEventListener("keydown", onKey(true));
document.addEventListener("keyup", onKey(false));

function lockPointer() {
  renderer.domElement.requestPointerLock();
}

help.addEventListener("click", lockPointer);
renderer.domElement.addEventListener("click", lockPointer);

document.addEventListener("pointerlockchange", () => {
  const locked = document.pointerLockElement === renderer.domElement;
  document.body.classList.toggle("playing", locked);
});

document.addEventListener("mousemove", (event) => {
  const pointerLocked = document.pointerLockElement === renderer.domElement;
  if (!pointerLocked && !dragLookActive) return;

  const sensitivity = 0.0022;
  player.courseYaw += event.movementX * sensitivity;
  player.pitch -= event.movementY * sensitivity;
  player.pitch = Math.max(-MAX_PITCH, Math.min(MAX_PITCH, player.pitch));
});

renderer.domElement.addEventListener("mousedown", (event) => {
  if (event.button === 0 && document.pointerLockElement !== renderer.domElement) {
    dragLookActive = true;
  }
});

window.addEventListener("mouseup", () => {
  dragLookActive = false;
});

const clock = new THREE.Clock();
connectToServer();

function animate() {
  requestAnimationFrame(animate);

  const dt = Math.min(clock.getDelta(), 0.05);
  sendInputTicks(dt);
  syncLocalPlayerFromServer();
  updateNetDebug();

  lookDirection.set(
    Math.sin(player.courseYaw) * Math.cos(player.pitch),
    Math.sin(player.pitch),
    -Math.cos(player.courseYaw) * Math.cos(player.pitch),
  );
  camera.position.copy(player.position);
  cameraTarget.copy(camera.position).addScaledVector(lookDirection, LOOK_AHEAD_DISTANCE);
  camera.lookAt(cameraTarget);

  renderer.render(scene, camera);
}

animate();

function connectToServer() {
  const protocol = window.location.protocol === "https:" ? "wss" : "ws";
  const host = window.location.hostname || "127.0.0.1";
  const url = `${protocol}://${host}:2567`;

  setHelpStatus(`Connecting to ${url}...`);
  const socket = new WebSocket(url);
  net.socket = socket;

  socket.addEventListener("open", () => {
    net.connected = true;
    socket.send(JSON.stringify({ type: "hello", name: "pilot" }));
    setHelpStatus("Connected. Click to lock pointer; input is now sent to server.");
  });

  socket.addEventListener("message", (event) => {
    let message;
    try {
      message = JSON.parse(event.data);
    } catch {
      return;
    }
    onServerMessage(message);
  });

  socket.addEventListener("close", () => {
    net.connected = false;
    setHelpStatus("Disconnected from server.");
  });

  socket.addEventListener("error", () => {
    setHelpStatus("Connection error. Ensure server is running on port 2567.");
  });
}

function onServerMessage(message) {
  if (!message || typeof message !== "object") {
    return;
  }

  if (message.type === "welcome") {
    net.playerId = message.playerId;
    if (typeof message.tickRate === "number" && Number.isFinite(message.tickRate) && message.tickRate > 0) {
      net.tickRate = message.tickRate;
      net.interpolationDelayMs = (INTERPOLATION_BACK_TICKS / net.tickRate) * 1000;
    }
    net.playersById.clear();
    net.samplesByPlayerId.clear();

    const snapshotPlayers = Array.isArray(message.snapshot?.players) ? message.snapshot.players : [];
    applyServerPlayerStates(snapshotPlayers, message.snapshot?.tick, { replaceAll: true });
    return;
  }

  if (message.type === "spawn") {
    if (message.state && typeof message.state.playerId === "string") {
      applyServerPlayerStates([message.state], message.tick);
    }
    return;
  }

  if (message.type === "despawn" && typeof message.playerId === "string") {
    net.playersById.delete(message.playerId);
    net.samplesByPlayerId.delete(message.playerId);
    return;
  }

  if (message.type === "snapshot") {
    const nextPlayers = Array.isArray(message.players) ? message.players : [];
    applyServerPlayerStates(nextPlayers, message.tick, { replaceAll: true });
    return;
  }

  if (message.type === "delta") {
    const nextPlayers = Array.isArray(message.players) ? message.players : [];
    applyServerPlayerStates(nextPlayers, message.tick);
    return;
  }

  if (message.type === "state") {
    const nextPlayers = Array.isArray(message.players) ? message.players : [];
    applyServerPlayerStates(nextPlayers, message.tick);
  }
}

function applyServerPlayerStates(playerStates, tick, options = {}) {
  const replaceAll = options.replaceAll === true;
  const now = performance.now();

  if (replaceAll) {
    net.playersById.clear();
  }

  for (const state of playerStates) {
    if (!state || typeof state.playerId !== "string") {
      continue;
    }
    net.playersById.set(state.playerId, state);
    pushSample(state.playerId, state, tick, now);
  }

  if (typeof tick === "number" && Number.isFinite(tick)) {
    net.latestServerTick = Math.max(net.latestServerTick, tick);
  }

  if (replaceAll) {
    for (const playerId of net.samplesByPlayerId.keys()) {
      if (!net.playersById.has(playerId)) {
        net.samplesByPlayerId.delete(playerId);
      }
    }
  }

  net.lastStateAtMs = now;
  net.recvStates += 1;
}

function pushSample(playerId, state, tick, nowMs) {
  const position = state?.position;
  if (!position) {
    return;
  }

  const sample = {
    tick: Number.isFinite(tick) ? tick : net.latestServerTick,
    atMs: nowMs,
    x: Number(position.x) || 0,
    y: Number(position.y) || 0,
    z: Number(position.z) || 0,
  };

  let samples = net.samplesByPlayerId.get(playerId);
  if (!samples) {
    samples = [];
    net.samplesByPlayerId.set(playerId, samples);
  }

  const last = samples[samples.length - 1];
  if (last && last.tick === sample.tick) {
    samples[samples.length - 1] = sample;
  } else {
    samples.push(sample);
  }

  if (samples.length > 40) {
    samples.splice(0, samples.length - 40);
  }
}

function sendInputTicks(frameDt) {
  if (!net.connected || !net.socket || net.socket.readyState !== WebSocket.OPEN) {
    return;
  }

  net.inputAccumulator += frameDt;
  while (net.inputAccumulator >= INPUT_SEND_DT) {
    net.inputAccumulator -= INPUT_SEND_DT;
    const buttonsBitmask = buildButtonsBitmask();
    net.inputSeq += 1;
    net.socket.send(
      JSON.stringify({
        type: "input",
        seq: net.inputSeq,
        buttonsBitmask,
        yaw: player.courseYaw,
        pitch: player.pitch,
      }),
    );
    net.sentInputs += 1;
    net.jumpQueued = false;
  }
}

function buildButtonsBitmask() {
  let mask = 0;
  if (net.jumpQueued) mask |= INPUT_BUTTON_JUMP;
  if (keys.forward) mask |= INPUT_BUTTON_FORWARD;
  if (keys.backward) mask |= INPUT_BUTTON_BACKWARD;
  if (keys.left) mask |= INPUT_BUTTON_LEFT;
  if (keys.right) mask |= INPUT_BUTTON_RIGHT;
  return mask;
}

function syncLocalPlayerFromServer() {
  if (!net.playerId) {
    return;
  }
  const authoritative = net.playersById.get(net.playerId);
  const sample = sampleInterpolatedPosition(net.playerId);
  if (!sample && !authoritative?.position) {
    if (DEBUG_NET && net.connected) {
      const now = performance.now();
      if (net.lastStateAtMs > 0 && now - net.lastStateAtMs > 2000) {
        setHelpStatus("Connected, but no fresh state updates from server (>2s).");
      }
    }
    return;
  }

  const x = sample ? sample.x : Number(authoritative.position.x) || 0;
  const z = sample ? sample.z : Number(authoritative.position.z) || 0;
  const y = sample ? sample.y : Number(authoritative.position.y) || 0;
  const terrainY = terrainHeight(x, z);
  const worldY = terrainY + Math.max(0, y);
  player.position.set(x, worldY + PLAYER_HEIGHT, z);
}

function sampleInterpolatedPosition(playerId) {
  const samples = net.samplesByPlayerId.get(playerId);
  if (!samples || samples.length < 2) {
    return null;
  }

  const renderAtMs = performance.now() - net.interpolationDelayMs;
  if (renderAtMs <= samples[0].atMs) {
    return samples[0];
  }

  const lastSample = samples[samples.length - 1];
  if (renderAtMs >= lastSample.atMs) {
    return lastSample;
  }

  for (let i = 1; i < samples.length; i += 1) {
    const current = samples[i];
    if (renderAtMs > current.atMs) {
      continue;
    }
    const previous = samples[i - 1];
    const spanMs = Math.max(1, current.atMs - previous.atMs);
    const alpha = THREE.MathUtils.clamp((renderAtMs - previous.atMs) / spanMs, 0, 1);
    return {
      x: THREE.MathUtils.lerp(previous.x, current.x, alpha),
      y: THREE.MathUtils.lerp(previous.y, current.y, alpha),
      z: THREE.MathUtils.lerp(previous.z, current.z, alpha),
    };
  }

  return lastSample;
}

function setHelpStatus(text) {
  if (help) {
    help.textContent = text;
  }
}

function updateNetDebug() {
  if (!DEBUG_NET) {
    return;
  }

  const now = performance.now();
  if (now - net.lastDebugLogAtMs < 1000) {
    return;
  }
  net.lastDebugLogAtMs = now;

  const stateAgeMs = net.lastStateAtMs > 0 ? Math.round(now - net.lastStateAtMs) : -1;
  console.debug(
    "[client][net]",
    `connected=${net.connected}`,
    `inputsSent=${net.sentInputs}`,
    `statesRecv=${net.recvStates}`,
    `stateAgeMs=${stateAgeMs}`,
  );
}

window.addEventListener("resize", () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

function terrainHeight(x, z) {
  const distanceFromCenter = Math.hypot(x, z);
  const centerRadius = WORLD_SIZE * 0.2;
  const transition = WORLD_SIZE * 0.25;
  const t = THREE.MathUtils.clamp((distanceFromCenter - centerRadius) / transition, 0, 1);
  const roughness = smoothstep(t);

  const mountains = fbm(x * 0.01, z * 0.01, 4, 2.0, 0.5) * (6.0 + roughness * 11.0);
  const hills = fbm(x * 0.03, z * 0.03, 3, 2.1, 0.55) * (2.8 + roughness * 3.4);
  const ripples = fbm(x * 0.085, z * 0.085, 2, 2.0, 0.5) * 0.9;

  return mountains + hills + ripples;
}

function fbm(x, z, octaves, lacunarity, gain) {
  let sum = 0;
  let amp = 1;
  let freq = 1;

  for (let i = 0; i < octaves; i += 1) {
    sum += amp * valueNoise(x * freq, z * freq);
    freq *= lacunarity;
    amp *= gain;
  }

  return sum;
}

function valueNoise(x, z) {
  const x0 = Math.floor(x);
  const z0 = Math.floor(z);
  const tx = x - x0;
  const tz = z - z0;

  const u = smoothstep(tx);
  const v = smoothstep(tz);

  const n00 = rand2(x0, z0);
  const n10 = rand2(x0 + 1, z0);
  const n01 = rand2(x0, z0 + 1);
  const n11 = rand2(x0 + 1, z0 + 1);

  const nx0 = THREE.MathUtils.lerp(n00, n10, u);
  const nx1 = THREE.MathUtils.lerp(n01, n11, u);
  return THREE.MathUtils.lerp(nx0, nx1, v) * 2 - 1;
}

function smoothstep(t) {
  return t * t * (3 - 2 * t);
}

function rand2(x, z) {
  const s = Math.sin(x * 127.1 + z * 311.7) * 43758.5453123;
  return s - Math.floor(s);
}

function createTerrainDetailTexture(rendererInstance) {
  const size = 256;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;

  const ctx = canvas.getContext("2d");
  if (!ctx) {
    return null;
  }

  ctx.fillStyle = "#8aac70";
  ctx.fillRect(0, 0, size, size);

  // Macro checker gives better motion perception than fine noise alone.
  const macro = 32;
  for (let y = 0; y < size; y += macro) {
    for (let x = 0; x < size; x += macro) {
      const even = ((x / macro) + (y / macro)) % 2 === 0;
      ctx.fillStyle = even ? "rgba(120, 152, 96, 0.22)" : "rgba(86, 120, 68, 0.22)";
      ctx.fillRect(x, y, macro, macro);
    }
  }

  for (let i = 0; i < 3600; i += 1) {
    const x = Math.random() * size;
    const y = Math.random() * size;
    const shade = 112 + Math.floor(Math.random() * 72);
    ctx.fillStyle = `rgb(${shade - 22}, ${shade}, ${shade - 28})`;
    ctx.fillRect(x, y, 1, 1);
  }

  ctx.strokeStyle = "rgba(55, 82, 44, 0.45)";
  ctx.lineWidth = 1;
  for (let i = -size; i < size * 2; i += 20) {
    ctx.beginPath();
    ctx.moveTo(i, 0);
    ctx.lineTo(i - size, size);
    ctx.stroke();
  }

  ctx.strokeStyle = "rgba(132, 170, 108, 0.22)";
  for (let i = 0; i <= size; i += 32) {
    ctx.beginPath();
    ctx.moveTo(0, i);
    ctx.lineTo(size, i);
    ctx.stroke();
  }

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(56, 56);
  texture.anisotropy = rendererInstance.capabilities.getMaxAnisotropy();
  return texture;
}
