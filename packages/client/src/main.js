import * as THREE from "three";

const WORLD_SIZE = 500;
const TERRAIN_SEGMENTS = 220;
const PLAYER_HEIGHT = 1.55;
const AVATAR_BALL_RADIUS = 0.75;
const AVATAR_LABEL_Y = 1.15;
const GROUND_CONTACT_VISUAL_BIAS = 0.03;
const LABEL_PIXELS_TO_WORLD_X = 1.9 / 384;
const LABEL_PIXELS_TO_WORLD_Y = 0.48 / 96;
const AVATAR_PATTERNS = new Set(["stripes", "checker"]);
const DEFAULT_AVATAR_COLOR = "#3c74d4";
const DEFAULT_AVATAR_PATTERN = "stripes";
const MAX_PITCH = THREE.MathUtils.degToRad(75);
const FACE_PITCH_UP_BIAS = THREE.MathUtils.degToRad(4);
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
const WS_PORT = parsePort(import.meta.env.VITE_WS_PORT, 8010);

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

const audio = {
  context: null,
};

const net = {
  socket: null,
  connected: false,
  connecting: false,
  nickname: "pilot",
  avatarColor: DEFAULT_AVATAR_COLOR,
  avatarPattern: DEFAULT_AVATAR_PATTERN,
  playerId: null,
  tickRate: INPUT_SEND_HZ,
  interpolationDelayMs: (INTERPOLATION_BACK_TICKS / INPUT_SEND_HZ) * 1000,
  inputSeq: 0,
  inputAccumulator: 0,
  jumpQueued: false,
  playersById: new Map(),
  samplesByPlayerId: new Map(),
  playerAvatarsById: new Map(),
  latestServerTick: 0,
  lastStateAtMs: 0,
  sentInputs: 0,
  recvStates: 0,
  lastDebugLogAtMs: 0,
};

const cameraTarget = new THREE.Vector3();
const lookDirection = new THREE.Vector3();
const rollDelta = new THREE.Vector3();
const rollAxis = new THREE.Vector3();
const rollQuat = new THREE.Quaternion();
let dragLookActive = false;
let hasEverCapturedPointer = false;

const help = document.getElementById("help");
const helpTitle = document.getElementById("help-title");
const helpText = document.getElementById("help-text");
const nickInput = document.getElementById("nick-input");
const connectButton = document.getElementById("connect-btn");
const colorInput = document.getElementById("color-input");
const patternSelect = document.getElementById("pattern-select");
const avatarPreviewCanvas = document.getElementById("avatar-preview-canvas");

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
    case "KeyL":
      if (pressed) togglePointerLock();
      break;
    default:
      break;
  }
};

document.addEventListener("keydown", onKey(true));
document.addEventListener("keyup", onKey(false));

function lockPointer() {
  if (!net.connected) {
    return;
  }
  ensureAudioContext();
  renderer.domElement.requestPointerLock();
}

function unlockPointer() {
  if (document.pointerLockElement === renderer.domElement) {
    document.exitPointerLock();
  }
}

function togglePointerLock() {
  if (document.pointerLockElement === renderer.domElement) {
    unlockPointer();
  } else {
    lockPointer();
  }
}

help.addEventListener("click", lockPointer);
if (connectButton) {
  connectButton.addEventListener("click", startConnectFromUi);
}
if (nickInput) {
  nickInput.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      startConnectFromUi();
    }
  });
}
if (colorInput) {
  colorInput.addEventListener("input", onAvatarOptionsChanged);
}
if (patternSelect) {
  patternSelect.addEventListener("change", onAvatarOptionsChanged);
}

document.addEventListener("pointerlockchange", () => {
  const locked = document.pointerLockElement === renderer.domElement;
  if (locked) {
    hasEverCapturedPointer = true;
    document.body.classList.add("playing");
    document.body.classList.remove("mouse-free");
    setHelpStatus("Mouse captured. Press Esc or L to release.", "Playing");
    return;
  }

  document.body.classList.remove("playing");
  if (hasEverCapturedPointer) {
    document.body.classList.add("mouse-free");
    setHelpStatus("Mouse released. Click panel or press L to capture again.", "Mouse Free");
  }
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

window.addEventListener("blur", () => {
  keys.forward = false;
  keys.backward = false;
  keys.left = false;
  keys.right = false;
  dragLookActive = false;
  net.jumpQueued = false;
});

const clock = new THREE.Clock();
initConnectUi();

function animate() {
  requestAnimationFrame(animate);

  const dt = Math.min(clock.getDelta(), 0.05);
  sendInputTicks(dt);
  syncLocalPlayerFromServer();
  syncRenderedPlayersFromServer();
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
  const url = `${protocol}://${host}:${WS_PORT}`;

  setHelpStatus(`Connecting as ${net.nickname} to ${url}...`, "Connecting");
  net.connecting = true;
  updateConnectUi();
  const socket = new WebSocket(url);
  net.socket = socket;

  socket.addEventListener("open", () => {
    net.connected = true;
    net.connecting = false;
    updateConnectUi();
    socket.send(
      JSON.stringify({
        type: "hello",
        name: net.nickname,
        avatar: {
          color: net.avatarColor,
          pattern: net.avatarPattern,
        },
      }),
    );
    setHelpStatus("Connected. Click panel or press L to capture mouse.", "Connected");
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
    net.connecting = false;
    net.playerId = null;
    net.playersById.clear();
    net.samplesByPlayerId.clear();
    for (const playerId of net.playerAvatarsById.keys()) {
      removePlayerAvatar(playerId);
    }
    document.body.classList.remove("connected");
    document.body.classList.remove("playing");
    updateConnectUi();
    setHelpStatus("Disconnected from server.", "Disconnected");
  });

  socket.addEventListener("error", () => {
    net.connecting = false;
    updateConnectUi();
    setHelpStatus(`Connection error. Ensure server is running on port ${WS_PORT}.`, "Connection Error");
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
    for (const playerId of net.playerAvatarsById.keys()) {
      removePlayerAvatar(playerId);
    }

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
    removePlayerAvatar(message.playerId);
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
    return;
  }

  if (message.type === "collisions") {
    handleCollisionAudio(message.collisions);
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
    for (const playerId of net.playerAvatarsById.keys()) {
      if (!net.playersById.has(playerId)) {
        removePlayerAvatar(playerId);
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
  const terrainY = terrainBaseForSphereAt(x, z, AVATAR_BALL_RADIUS);
  const worldY = terrainY + Math.max(0, y);
  player.position.set(x, worldY + PLAYER_HEIGHT, z);
}

function syncRenderedPlayersFromServer() {
  for (const [playerId, state] of net.playersById) {
    if (playerId === net.playerId) {
      continue;
    }

    const sample = sampleInterpolatedPosition(playerId);
    const position = sample ?? state?.position;
    if (!position) {
      continue;
    }

    const x = Number(position.x) || 0;
    const y = Number(position.y) || 0;
    const z = Number(position.z) || 0;
    const terrainY = terrainBaseForSphereAt(x, z, AVATAR_BALL_RADIUS);
    const worldY = terrainY + Math.max(0, y);
    const avatar = getOrCreatePlayerAvatar(playerId);
    avatar.root.position.set(x, worldY + AVATAR_BALL_RADIUS, z);
    updateAvatarRolling(avatar);
    const yaw = Number(state?.yaw) || 0;
    const pitch = Number(state?.pitch) || 0;
    avatar.face.rotation.set(
      THREE.MathUtils.clamp(pitch, -MAX_PITCH, MAX_PITCH) + FACE_PITCH_UP_BIAS,
      -yaw,
      0,
      "YXZ",
    );
    applyAvatarAppearance(avatar, state?.avatar);
    updateAvatarLabel(avatar, state?.name);
  }
}

function getOrCreatePlayerAvatar(playerId) {
  const existing = net.playerAvatarsById.get(playerId);
  if (existing) {
    return existing;
  }

  const root = new THREE.Group();
  const ball = new THREE.Group();
  root.add(ball);

  const bodyGeometry = new THREE.SphereGeometry(AVATAR_BALL_RADIUS, 28, 22);
  const bodyMaterial = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    roughness: 0.42,
    metalness: 0.08,
  });
  const body = new THREE.Mesh(bodyGeometry, bodyMaterial);
  body.castShadow = true;
  ball.add(body);

  const face = new THREE.Group();
  root.add(face);

  const eyeGeometry = new THREE.SphereGeometry(0.1, 16, 14);
  const eyeMaterial = new THREE.MeshStandardMaterial({
    color: 0xf6fbff,
    emissive: 0x93cfff,
    emissiveIntensity: 0.65,
    roughness: 0.18,
    metalness: 0.02,
  });
  const leftEye = new THREE.Mesh(eyeGeometry, eyeMaterial);
  leftEye.position.set(-0.23, 0.13, -AVATAR_BALL_RADIUS + 0.03);
  const rightEye = leftEye.clone();
  rightEye.position.x = 0.23;
  face.add(leftEye, rightEye);

  const mouthGeometry = new THREE.BoxGeometry(0.34, 0.07, 0.028);
  const mouthMaterial = new THREE.MeshStandardMaterial({ color: 0xc77b82, roughness: 0.28, metalness: 0.02 });
  const mouth = new THREE.Mesh(mouthGeometry, mouthMaterial);
  mouth.position.set(0, -0.2, -AVATAR_BALL_RADIUS + 0.043);
  mouth.rotation.z = 0.05;
  face.add(mouth);

  const toothGeometry = new THREE.BoxGeometry(0.05, 0.07, 0.025);
  const toothMaterial = new THREE.MeshStandardMaterial({ color: 0xf8fbff, roughness: 0.2, metalness: 0.01 });
  const leftTooth = new THREE.Mesh(toothGeometry, toothMaterial);
  leftTooth.position.set(-0.07, -0.19, -AVATAR_BALL_RADIUS + 0.052);
  leftTooth.rotation.z = 0.1;
  const midTooth = leftTooth.clone();
  midTooth.position.x = 0;
  midTooth.rotation.z = 0;
  const rightTooth = leftTooth.clone();
  rightTooth.position.x = 0.07;
  rightTooth.rotation.z = -0.1;
  face.add(leftTooth, midTooth, rightTooth);

  const browGeometry = new THREE.BoxGeometry(0.2, 0.03, 0.03);
  const browMaterial = new THREE.MeshStandardMaterial({ color: 0x101010, roughness: 0.45, metalness: 0.02 });
  const leftBrow = new THREE.Mesh(browGeometry, browMaterial);
  leftBrow.position.set(-0.23, 0.27, -AVATAR_BALL_RADIUS + 0.045);
  leftBrow.rotation.z = -0.55;
  const rightBrow = leftBrow.clone();
  rightBrow.position.x = 0.23;
  rightBrow.rotation.z = 0.55;
  face.add(leftBrow, rightBrow);

  const label = createAvatarLabelSprite();
  label.position.set(0, AVATAR_LABEL_Y, 0);
  root.add(label);

  scene.add(root);
  const avatar = {
    root,
    ball,
    face,
    bodyMaterial,
    label,
    labelTexture: label.material.map,
    labelCanvas: label.userData.labelCanvas,
    labelCtx: label.userData.labelCtx,
    labelName: "",
    appearanceKey: "",
    bodyPatternTexture: null,
    rollingReady: false,
  };
  net.playerAvatarsById.set(playerId, avatar);
  return avatar;
}

function updateAvatarRolling(avatar) {
  if (!avatar.rollingReady) {
    avatar.rollingReady = true;
    avatar.lastX = avatar.root.position.x;
    avatar.lastZ = avatar.root.position.z;
    return;
  }

  const dx = avatar.root.position.x - avatar.lastX;
  const dz = avatar.root.position.z - avatar.lastZ;
  avatar.lastX = avatar.root.position.x;
  avatar.lastZ = avatar.root.position.z;

  rollDelta.set(dx, 0, dz);
  const distance = rollDelta.length();
  if (distance <= 1e-6) {
    return;
  }

  rollAxis.set(rollDelta.z, 0, -rollDelta.x).normalize();
  const angle = distance / AVATAR_BALL_RADIUS;
  rollQuat.setFromAxisAngle(rollAxis, angle);
  avatar.ball.quaternion.premultiply(rollQuat);
}

function handleCollisionAudio(rawCollisions) {
  if (!Array.isArray(rawCollisions) || rawCollisions.length === 0) {
    return;
  }

  const context = ensureAudioContext();
  if (!context || context.state !== "running") {
    return;
  }

  const listenerX = player.position.x;
  const listenerY = player.position.y;
  const listenerZ = player.position.z;
  const maxDistance = 36;

  for (const collision of rawCollisions) {
    if (!collision || typeof collision !== "object") {
      continue;
    }

    const x = Number(collision.x) || 0;
    const y = Number(collision.y) || 0;
    const z = Number(collision.z) || 0;
    const intensity = Number(collision.intensity) || 0;
    if (intensity <= 0) {
      continue;
    }

    const distance = Math.hypot(x - listenerX, y - listenerY, z - listenerZ);
    if (distance > maxDistance) {
      continue;
    }

    const distanceGain = THREE.MathUtils.clamp(1 - distance / maxDistance, 0, 1);
    const gain = THREE.MathUtils.clamp(distanceGain * distanceGain * (0.08 + intensity * 0.065), 0, 0.42);
    if (gain <= 0.001) {
      continue;
    }

    playCollisionClick(context, gain, intensity);
  }
}

function ensureAudioContext() {
  if (!audio.context) {
    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    if (!AudioCtx) {
      return null;
    }
    audio.context = new AudioCtx();
  }

  if (audio.context.state === "suspended") {
    audio.context.resume().catch(() => {});
  }

  return audio.context;
}

function playCollisionClick(context, gainAmount, intensity) {
  const now = context.currentTime;
  const duration = 0.055;
  const oscillator = context.createOscillator();
  const gainNode = context.createGain();
  const highpass = context.createBiquadFilter();
  const pitch = 220 + Math.min(420, intensity * 120);

  oscillator.type = "sine";
  oscillator.frequency.setValueAtTime(pitch, now);
  oscillator.frequency.exponentialRampToValueAtTime(Math.max(90, pitch * 0.58), now + duration);

  highpass.type = "highpass";
  highpass.frequency.setValueAtTime(110, now);

  gainNode.gain.setValueAtTime(0.0001, now);
  gainNode.gain.exponentialRampToValueAtTime(gainAmount, now + 0.006);
  gainNode.gain.exponentialRampToValueAtTime(0.0001, now + duration);

  oscillator.connect(highpass);
  highpass.connect(gainNode);
  gainNode.connect(context.destination);

  oscillator.start(now);
  oscillator.stop(now + duration + 0.01);
}

function applyAvatarAppearance(avatar, rawAvatarStyle) {
  const colorHex = normalizeAvatarColor(rawAvatarStyle?.color);
  const pattern = sanitizeAvatarPattern(rawAvatarStyle?.pattern);
  const key = `${colorHex}|${pattern}`;
  if (avatar.appearanceKey === key) {
    return;
  }
  avatar.appearanceKey = key;

  if (avatar.bodyPatternTexture) {
    avatar.bodyPatternTexture.dispose();
    avatar.bodyPatternTexture = null;
  }

  const texture = createAvatarBodyTexture(colorHex, pattern);
  avatar.bodyPatternTexture = texture;
  avatar.bodyMaterial.color.set(0xffffff);
  avatar.bodyMaterial.map = texture;
  avatar.bodyMaterial.needsUpdate = true;
}

function createAvatarBodyTexture(colorHex, pattern) {
  const size = 128;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    return null;
  }

  const base = new THREE.Color(colorHex);
  const dark = base.clone().multiplyScalar(0.42);
  const light = base.clone().lerp(new THREE.Color(0xffffff), 0.16);
  ctx.fillStyle = `#${base.getHexString()}`;
  ctx.fillRect(0, 0, size, size);

  ctx.fillStyle = `#${dark.getHexString()}`;
  if (pattern === "stripes") {
    const stripe = 14;
    for (let x = 0; x < size; x += stripe * 2) {
      ctx.fillRect(x, 0, stripe, size);
    }
    ctx.fillStyle = `#${light.getHexString()}`;
    for (let x = stripe; x < size; x += stripe * 2) {
      ctx.fillRect(x, 0, Math.max(2, Math.floor(stripe * 0.24)), size);
    }
  } else if (pattern === "checker") {
    const cell = 14;
    for (let y = 0; y < size; y += cell) {
      for (let x = 0; x < size; x += cell) {
        if (((x / cell) + (y / cell)) % 2 === 0) {
          ctx.fillRect(x, y, cell, cell);
        }
      }
    }
    ctx.strokeStyle = `#${light.getHexString()}`;
    ctx.lineWidth = 1;
    for (let n = 0; n <= size; n += cell) {
      ctx.beginPath();
      ctx.moveTo(n, 0);
      ctx.lineTo(n, size);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(0, n);
      ctx.lineTo(size, n);
      ctx.stroke();
    }
  }

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(1.4, 1.4);
  return texture;
}

function updateAvatarLabel(avatar, rawName) {
  const safeName = sanitizeNickname(rawName);
  if (avatar.labelName === safeName) {
    return;
  }
  avatar.labelName = safeName;

  const ctx = avatar.labelCtx;
  const canvas = avatar.labelCanvas;
  if (!ctx || !canvas) {
    return;
  }

  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.font = "bold 60px Segoe UI";
  const textWidth = ctx.measureText(safeName).width;
  const boxWidth = Math.max(120, Math.min(canvas.width - 8, Math.ceil(textWidth + 40)));
  const boxHeight = 92;
  const boxX = Math.floor((canvas.width - boxWidth) * 0.5);
  const boxY = Math.floor((canvas.height - boxHeight) * 0.5);

  drawRoundRect(ctx, boxX, boxY, boxWidth, boxHeight, 14);
  ctx.fillStyle = "rgba(7, 12, 20, 0.72)";
  ctx.fill();
  ctx.strokeStyle = "rgba(210, 232, 255, 0.7)";
  ctx.lineWidth = 2;
  ctx.stroke();
  ctx.fillStyle = "#f3f8ff";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(safeName, canvas.width / 2, canvas.height / 2);
  avatar.label.scale.set(boxWidth * LABEL_PIXELS_TO_WORLD_X, boxHeight * LABEL_PIXELS_TO_WORLD_Y, 1);
  avatar.labelTexture.needsUpdate = true;
}

function createAvatarLabelSprite() {
  const canvas = document.createElement("canvas");
  canvas.width = 384;
  canvas.height = 96;
  const ctx = canvas.getContext("2d");
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.generateMipmaps = false;
  texture.minFilter = THREE.LinearFilter;
  texture.magFilter = THREE.LinearFilter;
  const material = new THREE.SpriteMaterial({
    map: texture,
    transparent: true,
    depthTest: false,
    depthWrite: false,
  });
  const sprite = new THREE.Sprite(material);
  sprite.scale.set(1.9, 0.48, 1);
  sprite.renderOrder = 3;
  sprite.userData.labelCanvas = canvas;
  sprite.userData.labelCtx = ctx;
  return sprite;
}

function removePlayerAvatar(playerId) {
  const avatar = net.playerAvatarsById.get(playerId);
  if (!avatar) {
    return;
  }

  scene.remove(avatar.root);
  avatar.root.traverse((node) => {
    if (node.geometry) {
      node.geometry.dispose();
    }
    if (node.material) {
      if (Array.isArray(node.material)) {
        for (const material of node.material) {
          if (material.map) {
            material.map.dispose();
          }
          material.dispose();
        }
      } else {
        if (node.material.map) {
          node.material.map.dispose();
        }
        node.material.dispose();
      }
    }
  });
  if (avatar.labelTexture) {
    avatar.labelTexture.dispose();
  }
  net.playerAvatarsById.delete(playerId);
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

function setHelpStatus(text, title = "Click to Play") {
  const nextText = text;
  const nextTitle = title;

  if (helpTitle) {
    helpTitle.textContent = nextTitle;
  }
  if (helpText) {
    helpText.textContent = nextText;
  }
}

function initConnectUi() {
  const savedNickname = window.localStorage.getItem("hra.nickname");
  const savedAvatarColor = window.localStorage.getItem("hra.avatarColor");
  const savedAvatarPattern = window.localStorage.getItem("hra.avatarPattern");
  if (typeof savedNickname === "string" && savedNickname.trim() !== "") {
    net.nickname = sanitizeNickname(savedNickname);
  }
  if (typeof savedAvatarColor === "string") {
    net.avatarColor = normalizeAvatarColor(savedAvatarColor);
  }
  if (typeof savedAvatarPattern === "string") {
    net.avatarPattern = sanitizeAvatarPattern(savedAvatarPattern);
  }
  if (nickInput) {
    nickInput.value = net.nickname;
  }
  if (colorInput) {
    colorInput.value = net.avatarColor;
  }
  if (patternSelect) {
    patternSelect.value = net.avatarPattern;
  }
  renderAvatarPreview(net.avatarColor, net.avatarPattern);
  updateConnectUi();
  setHelpStatus("Enter nickname and connect. Then click panel or press L to capture mouse.", "Ready");
}

function startConnectFromUi() {
  if (net.connected || net.connecting) {
    return;
  }
  ensureAudioContext();
  net.nickname = sanitizeNickname(nickInput?.value);
  net.avatarColor = normalizeAvatarColor(colorInput?.value);
  net.avatarPattern = sanitizeAvatarPattern(patternSelect?.value);
  renderAvatarPreview(net.avatarColor, net.avatarPattern);
  if (nickInput) {
    nickInput.value = net.nickname;
  }
  if (colorInput) {
    colorInput.value = net.avatarColor;
  }
  if (patternSelect) {
    patternSelect.value = net.avatarPattern;
  }
  window.localStorage.setItem("hra.nickname", net.nickname);
  window.localStorage.setItem("hra.avatarColor", net.avatarColor);
  window.localStorage.setItem("hra.avatarPattern", net.avatarPattern);
  connectToServer();
}

function onAvatarOptionsChanged() {
  const color = normalizeAvatarColor(colorInput?.value);
  const pattern = sanitizeAvatarPattern(patternSelect?.value);
  renderAvatarPreview(color, pattern);
}

function renderAvatarPreview(colorHex, pattern) {
  if (!(avatarPreviewCanvas instanceof HTMLCanvasElement)) {
    return;
  }

  const ctx = avatarPreviewCanvas.getContext("2d");
  if (!ctx) {
    return;
  }

  const size = avatarPreviewCanvas.width;
  ctx.clearRect(0, 0, size, size);
  ctx.save();
  ctx.beginPath();
  ctx.arc(size * 0.5, size * 0.5, size * 0.5 - 1, 0, Math.PI * 2);
  ctx.clip();

  const base = new THREE.Color(colorHex);
  const dark = base.clone().multiplyScalar(0.42);
  const light = base.clone().lerp(new THREE.Color(0xffffff), 0.16);

  ctx.fillStyle = `#${base.getHexString()}`;
  ctx.fillRect(0, 0, size, size);

  if (pattern === "stripes") {
    const stripe = 10;
    ctx.fillStyle = `#${dark.getHexString()}`;
    for (let x = 0; x < size; x += stripe * 2) {
      ctx.fillRect(x, 0, stripe, size);
    }
    ctx.fillStyle = `#${light.getHexString()}`;
    for (let x = stripe; x < size; x += stripe * 2) {
      ctx.fillRect(x, 0, 2, size);
    }
  } else if (pattern === "checker") {
    const cell = 9;
    ctx.fillStyle = `#${dark.getHexString()}`;
    for (let y = 0; y < size; y += cell) {
      for (let x = 0; x < size; x += cell) {
        if (((x / cell) + (y / cell)) % 2 === 0) {
          ctx.fillRect(x, y, cell, cell);
        }
      }
    }
  }

  const gloss = ctx.createRadialGradient(size * 0.34, size * 0.28, 2, size * 0.34, size * 0.28, size * 0.46);
  gloss.addColorStop(0, "rgba(255,255,255,0.42)");
  gloss.addColorStop(1, "rgba(255,255,255,0)");
  ctx.fillStyle = gloss;
  ctx.fillRect(0, 0, size, size);

  ctx.restore();
}

function updateConnectUi() {
  document.body.classList.toggle("connected", net.connected);
  const disabled = net.connected || net.connecting;
  if (nickInput) {
    nickInput.disabled = disabled;
  }
  if (colorInput) {
    colorInput.disabled = disabled;
  }
  if (patternSelect) {
    patternSelect.disabled = disabled;
  }
  if (connectButton) {
    connectButton.disabled = disabled;
    connectButton.textContent = net.connecting ? "Connecting..." : "Connect";
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

function terrainBaseForSphereAt(x, z, radius) {
  let requiredCenterY = terrainHeight(x, z) + radius;

  const rings = [
    { scale: 0.5, samples: 8 },
    { scale: 0.95, samples: 12 },
  ];

  for (const ring of rings) {
    const d = radius * ring.scale;
    const centerLift = Math.sqrt(Math.max(0, radius * radius - d * d));
    for (let i = 0; i < ring.samples; i += 1) {
      const angle = (i / ring.samples) * Math.PI * 2;
      const sx = x + Math.cos(angle) * d;
      const sz = z + Math.sin(angle) * d;
      const h = terrainHeight(sx, sz);
      requiredCenterY = Math.max(requiredCenterY, h + centerLift);
    }
  }

  return requiredCenterY - radius - GROUND_CONTACT_VISUAL_BIAS;
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

function sanitizeNickname(rawName) {
  if (typeof rawName !== "string") {
    return "pilot";
  }
  const cleaned = rawName.replace(/\s+/g, " ").trim().slice(0, 20);
  return cleaned.length > 0 ? cleaned : "pilot";
}

function normalizeAvatarColor(rawColor) {
  if (typeof rawColor !== "string") {
    return DEFAULT_AVATAR_COLOR;
  }
  const trimmed = rawColor.trim();
  if (/^#[0-9a-fA-F]{6}$/.test(trimmed)) {
    return trimmed.toLowerCase();
  }
  return DEFAULT_AVATAR_COLOR;
}

function sanitizeAvatarPattern(rawPattern) {
  if (typeof rawPattern !== "string") {
    return DEFAULT_AVATAR_PATTERN;
  }
  return AVATAR_PATTERNS.has(rawPattern) ? rawPattern : DEFAULT_AVATAR_PATTERN;
}

function parsePort(value, fallback) {
  const parsed = Number(value);
  if (Number.isInteger(parsed) && parsed >= 1 && parsed <= 65535) {
    return parsed;
  }
  return fallback;
}

function drawRoundRect(ctx, x, y, width, height, radius) {
  const r = Math.min(radius, width * 0.5, height * 0.5);
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + width, y, x + width, y + height, r);
  ctx.arcTo(x + width, y + height, x, y + height, r);
  ctx.arcTo(x, y + height, x, y, r);
  ctx.arcTo(x, y, x + width, y, r);
  ctx.closePath();
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
