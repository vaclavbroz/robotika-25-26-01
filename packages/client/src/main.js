import * as THREE from "three";

const WORLD_SIZE = 500;
const TERRAIN_SEGMENTS = 220;
const PLAYER_HEIGHT = 1.55;
const AVATAR_BALL_RADIUS = 0.75;
const AVATAR_LABEL_Y = 1.15;
const PARACHUTE_CANOPY_Y = 2.9;
const GROUND_CONTACT_VISUAL_BIAS = 0.03;
const LABEL_PIXELS_TO_WORLD_X = 1.9 / 384;
const LABEL_PIXELS_TO_WORLD_Y = 0.48 / 96;
const AVATAR_PATTERNS = new Set(["stripes", "checker"]);
const DEFAULT_AVATAR_COLOR = "#3c74d4";
const DEFAULT_AVATAR_PATTERN = "stripes";
const DESERT_CAMP_POSITION = new THREE.Vector3(34, 0, -28);
const CRAFTING_TABLE_OFFSET = new THREE.Vector3(6, 0, 4);
const TOTAL_NIGHTS_TO_SURVIVE = 99;
const DAY_DURATION_SECONDS = 3;
const NIGHT_DURATION_SECONDS = 5;
const CAMP_INTERACT_RANGE = 7;
const RESOURCE_INTERACT_RANGE = 4.2;
const ENEMY_CONTACT_RANGE = 2.1;
const FIRE_SAFE_RADIUS = 8.5;
const PLAYER_MAX_HEALTH = 100;
const FIRE_MAX_FUEL = 100;
const STARTING_FIRE_FUEL = 65;
const FIRE_DRAIN_PER_SECOND = 3.1;
const FIRE_FEED_AMOUNT = 22;
const SACK_CAPACITY = 6;
const BARRICADE_CRAFT_COST = 2;
const CHEST_CRAFT_COST = 3;
const BARRICADE_MAX_HEALTH = 90;
const CHEST_MAX_HEALTH = 120;
const BARRICADE_SLOW_RADIUS = 3.2;
const STRUCTURE_INTERACT_RANGE = 5.4;
const PLAYER_DAMAGE_PER_SECOND = 16;
const GUN_RANGE = 34;
const GUN_CONE_DOT = 0.94;
const ENEMY_SPAWN_INTERVAL_SECONDS = 1.5;
const RESOURCE_RESPAWN_SECONDS = 9;
const ARMADILLO_DAMAGE_PER_SECOND = 28;
const ARMADILLO_WAKE_RANGE = 90;
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
const WS_PORT = parsePort(import.meta.env.VITE_WS_PORT, 9001);

const scene = new THREE.Scene();
scene.background = new THREE.Color(0xf1b36d);
scene.fog = new THREE.Fog(0xe6a45f, 70, 360);

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

const ambient = new THREE.HemisphereLight(0xffe0ad, 0x71411f, 0.9);
scene.add(ambient);

const sun = new THREE.DirectionalLight(0xffd38a, 1.55);
sun.position.set(120, 190, 60);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
sun.shadow.camera.left = -150;
sun.shadow.camera.right = 150;
sun.shadow.camera.top = 150;
sun.shadow.camera.bottom = -150;
scene.add(sun);

const bounce = new THREE.DirectionalLight(0xc96d35, 0.45);
bounce.position.set(-100, 70, -90);
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
  color: 0xc99552,
  map: terrainDetailTexture,
  bumpMap: terrainDetailTexture,
  bumpScale: 0.62,
  roughness: 0.96,
  metalness: 0.02,
});

const terrain = new THREE.Mesh(terrainGeometry, terrainMaterial);
terrain.receiveShadow = true;
scene.add(terrain);

const skyDome = new THREE.Mesh(
  new THREE.SphereGeometry(900, 32, 16),
  new THREE.MeshBasicMaterial({
    color: 0xf3bb74,
    side: THREE.BackSide,
  }),
);
scene.add(skyDome);
scene.add(createSunDisc());
const armadilloCamp = createArmadilloCamp();
scene.add(armadilloCamp);
const armadillo = armadilloCamp.userData.armadillo;
const craftingTable = armadilloCamp.userData.craftingTable;
const moon = createMoonDisc();
scene.add(moon);

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

const classes = {
  nomad: { label: "Nomad", cost: 0, maxHealth: 100, sackCapacity: 6, barricadeCost: 2 },
  scout: { label: "Scout", cost: 3, maxHealth: 90, sackCapacity: 8, barricadeCost: 2 },
  tank: { label: "Tank", cost: 4, maxHealth: 145, sackCapacity: 5, barricadeCost: 2 },
  engineer: { label: "Engineer", cost: 5, maxHealth: 110, sackCapacity: 7, barricadeCost: 1 },
};

const gameplay = {
  phase: "day",
  phaseElapsed: 0,
  nightCount: 0,
  health: PLAYER_MAX_HEALTH,
  fireFuel: STARTING_FIRE_FUEL,
  boards: 0,
  guns: 0,
  totalBoardsCollected: 0,
  sackCapacity: SACK_CAPACITY,
  barricadeKits: 0,
  chestKits: 0,
  coins: 6,
  ownedClasses: new Set(["nomad"]),
  selectedClassId: "nomad",
  lobbyOpen: true,
  enemySpawnTimer: 0,
  armadilloAwake: false,
  armadilloStunTimer: 0,
  openChest: null,
  status: "Reach the camp marker, fill your sack with boards, and keep the fire alive.",
  prompt: "",
  ended: false,
  win: false,
  resources: [],
  enemies: [],
  structures: [],
};

const net = {
  socket: null,
  connected: false,
  connecting: false,
  nickname: "nomad",
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
  reconnectTimer: null,
  restartExpectedUntilMs: 0,
  reconnectEnabled: false,
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
const devOverlay = document.getElementById("dev-overlay");
const devOverlayTitle = document.getElementById("dev-overlay-title");
const devOverlayText = document.getElementById("dev-overlay-text");
const gamePhase = document.getElementById("game-phase");
const gameStatus = document.getElementById("game-status");
const healthStat = document.getElementById("health-stat");
const fireStat = document.getElementById("fire-stat");
const woodStat = document.getElementById("wood-stat");
const emberStat = document.getElementById("ember-stat");
const gunStat = document.getElementById("gun-stat");
const craftStat = document.getElementById("craft-stat");
const chestStat = document.getElementById("chest-stat");
const nightStat = document.getElementById("night-stat");
const interactionPrompt = document.getElementById("interaction-prompt");
const invBoards = document.getElementById("inv-boards");
const invGuns = document.getElementById("inv-guns");
const invBarricades = document.getElementById("inv-barricades");
const invChests = document.getElementById("inv-chests");
const invCoins = document.getElementById("inv-coins");
const chestOverlay = document.getElementById("chest-overlay");
const chestTitle = document.getElementById("chest-title");
const chestSummary = document.getElementById("chest-summary");
const chestStoreButton = document.getElementById("chest-store-btn");
const chestTakeButton = document.getElementById("chest-take-btn");
const chestCloseButton = document.getElementById("chest-close-btn");
const lobbyScreen = document.getElementById("lobby-screen");
const lobbyCoins = document.getElementById("lobby-coins");
const lobbyClassText = document.getElementById("lobby-class-text");
const lobbyTip = document.getElementById("lobby-tip");
const lobbyJoinButton = document.getElementById("lobby-join-btn");
const classCards = Array.from(document.querySelectorAll(".class-card"));
const nickInput = document.getElementById("nick-input");
const connectButton = document.getElementById("connect-btn");
const colorInput = document.getElementById("color-input");
const patternSelect = document.getElementById("pattern-select");
const avatarPreviewCanvas = document.getElementById("avatar-preview-canvas");
const CLIENT_UPDATE_OVERLAY_DEBOUNCE_MS = 160;

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
    case "KeyE":
      if (pressed) {
        handleInteraction();
      }
      break;
    case "KeyC":
      if (pressed) {
        craftBarricade();
      }
      break;
    case "KeyF":
      if (pressed) {
        placeBarricade();
      }
      break;
    case "KeyX":
      if (pressed) {
        placeChest();
      }
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
for (const card of classCards) {
  card.addEventListener("click", () => {
    onClassCardClicked(card.dataset.classId || "nomad");
  });
}
if (lobbyJoinButton) {
  lobbyJoinButton.addEventListener("click", startConnectFromUi);
}
if (chestStoreButton) {
  chestStoreButton.addEventListener("click", () => {
    if (gameplay.openChest) {
      storeBoardInOpenChest();
    }
  });
}
if (chestTakeButton) {
  chestTakeButton.addEventListener("click", () => {
    if (gameplay.openChest) {
      takeBoardFromOpenChest();
    }
  });
}
if (chestCloseButton) {
  chestCloseButton.addEventListener("click", closeChestOverlay);
}

document.addEventListener("pointerlockchange", () => {
  const locked = document.pointerLockElement === renderer.domElement;
  if (locked) {
    hasEverCapturedPointer = true;
    document.body.classList.add("playing");
    document.body.classList.remove("mouse-free");
    setHelpStatus("Mouse captured. Press Esc or L to release.", "Crossing Dunes");
    return;
  }

  document.body.classList.remove("playing");
  if (hasEverCapturedPointer) {
    document.body.classList.add("mouse-free");
    setHelpStatus("Mouse released. Click panel or press L to capture again.", "Camp Pause");
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
  if (event.button === 0 && document.pointerLockElement === renderer.domElement) {
    fireGun();
    return;
  }
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
initGameplay();
initConnectUi();
initDevNotifications();
updateGameplayHud();

function animate() {
  requestAnimationFrame(animate);

  const dt = Math.min(clock.getDelta(), 0.05);
  sendInputTicks(dt);
  syncLocalPlayerFromServer();
  syncRenderedPlayersFromServer();
  updateGameplay(dt);
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

function initGameplay() {
  spawnInitialResources();
  spawnStarterStructures();
  spawnStarterGuns();
  applySelectedClass();
  updateLobbyUi();
}

function onClassCardClicked(classId) {
  const config = classes[classId];
  if (!config) {
    return;
  }
  if (!gameplay.ownedClasses.has(classId)) {
    if (gameplay.coins < config.cost) {
      if (lobbyTip) {
        lobbyTip.textContent = `Not enough coins for ${config.label}.`;
      }
      return;
    }
    gameplay.coins -= config.cost;
    gameplay.ownedClasses.add(classId);
  }
  gameplay.selectedClassId = classId;
  applySelectedClass();
  updateLobbyUi();
}

function applySelectedClass() {
  const classConfig = classes[gameplay.selectedClassId] || classes.nomad;
  gameplay.sackCapacity = classConfig.sackCapacity;
  if (gameplay.lobbyOpen || !net.connected) {
    gameplay.health = classConfig.maxHealth;
  }
}

function updateLobbyUi() {
  if (lobbyScreen) {
    lobbyScreen.hidden = !gameplay.lobbyOpen;
  }
  if (lobbyCoins) {
    lobbyCoins.textContent = `Coins ${gameplay.coins}`;
  }
  if (lobbyClassText) {
    lobbyClassText.textContent = `Selected class: ${classes[gameplay.selectedClassId].label}`;
  }
  if (lobbyTip) {
    const classConfig = classes[gameplay.selectedClassId];
    lobbyTip.textContent = `${classConfig.label}: health ${classConfig.maxHealth}, sack ${classConfig.sackCapacity}.`;
  }
  for (const card of classCards) {
    const classId = card.dataset.classId || "nomad";
    const owned = gameplay.ownedClasses.has(classId);
    card.classList.toggle("active", gameplay.selectedClassId === classId);
    card.classList.toggle("locked", !owned);
  }
}

function updateGameplay(dt) {
  if (!net.connected || !net.playerId || gameplay.ended || gameplay.lobbyOpen) {
    if (gameplay.openChest) {
      closeChestOverlay();
    }
    if (interactionPrompt) {
      interactionPrompt.hidden = true;
    }
    updateGameplayHud();
    return;
  }

  gameplay.phaseElapsed += dt;
  updateDayNightCycle(dt);
  updateResourceNodes(dt);
  updateStructures(dt);
  updateArmadillo(dt);
  updateEnemies(dt);
  updateInteractionPrompt();
  updateGameplayHud();
  updateChestOverlay();
}

function updateDayNightCycle(dt) {
  const phaseDuration = gameplay.phase === "day" ? DAY_DURATION_SECONDS : NIGHT_DURATION_SECONDS;
  if (gameplay.phaseElapsed >= phaseDuration) {
    gameplay.phaseElapsed -= phaseDuration;
    if (gameplay.phase === "day") {
      gameplay.phase = "night";
      gameplay.nightCount += 1;
      gameplay.enemySpawnTimer = 0;
      gameplay.status = `Night ${gameplay.nightCount} begins. Keep the fire alive and defend the camp.`;
      if (gameplay.nightCount > TOTAL_NIGHTS_TO_SURVIVE) {
        winGame("You outlasted all 99 nights and the desert finally broke.");
        return;
      }
    } else {
      gameplay.phase = "day";
      gameplay.status = "Dawn. Fill the sack with boards before the next night.";
      if (gameplay.nightCount >= TOTAL_NIGHTS_TO_SURVIVE) {
        winGame("Dawn on the 100th morning. The armadillo camp survives.");
        return;
      }
    }
  }

  const cycleAlpha =
    gameplay.phase === "day"
      ? gameplay.phaseElapsed / DAY_DURATION_SECONDS
      : gameplay.phaseElapsed / NIGHT_DURATION_SECONDS;
  applyTimeOfDayLighting(gameplay.phase, cycleAlpha);

  if (gameplay.phase === "night") {
    gameplay.fireFuel = Math.max(0, gameplay.fireFuel - dt * FIRE_DRAIN_PER_SECOND);
    gameplay.enemySpawnTimer += dt;
    while (gameplay.enemySpawnTimer >= ENEMY_SPAWN_INTERVAL_SECONDS) {
      gameplay.enemySpawnTimer -= ENEMY_SPAWN_INTERVAL_SECONDS;
      spawnEnemy();
    }
  }

  if (gameplay.fireFuel <= 0) {
    if (!gameplay.armadilloAwake) {
      gameplay.armadilloAwake = true;
      gameplay.status = "The fire went out. The armadillo woke up and is hunting you.";
    }
  } else if (gameplay.armadilloAwake) {
    gameplay.armadilloAwake = false;
    gameplay.status = "The fire is back. The armadillo calms down near the camp.";
  }
}

function updateResourceNodes(dt) {
  for (const resource of gameplay.resources) {
    if (resource.available) {
      continue;
    }
    resource.respawnAt -= dt;
    if (resource.respawnAt > 0) {
      continue;
    }
    resource.available = true;
    resource.mesh.visible = true;
  }
}

function updateEnemies(dt) {
  const fireRadiusBoost = gameplay.fireFuel > 0 ? FIRE_SAFE_RADIUS : 0;
  for (let i = gameplay.enemies.length - 1; i >= 0; i -= 1) {
    const enemy = gameplay.enemies[i];
    const structureTarget = getPriorityStructureTarget(enemy.position);
    const target =
      structureTarget?.position || (gameplay.fireFuel > 0 ? DESERT_CAMP_POSITION : player.position);
    const dx = target.x - enemy.position.x;
    const dz = target.z - enemy.position.z;
    const distance = Math.hypot(dx, dz) || 1;
    let speed = gameplay.phase === "night" ? 5.1 : 2.4;
    for (const structure of gameplay.structures) {
      const distanceToStructure = horizontalDistance(enemy.position, structure.position);
      if (distanceToStructure <= BARRICADE_SLOW_RADIUS) {
        speed *= 0.42;
        structure.health = Math.max(0, structure.health - 10 * dt);
      }
    }
    enemy.position.x += (dx / distance) * speed * dt;
    enemy.position.z += (dz / distance) * speed * dt;
    const y = terrainBaseForSphereAt(enemy.position.x, enemy.position.z, 0.9) + 0.65;
    enemy.position.y = y;
    enemy.mesh.position.copy(enemy.position);
    enemy.mesh.lookAt(target.x, y + 0.3, target.z);

    const playerDistance = horizontalDistance(enemy.position, player.position);
    if (playerDistance <= ENEMY_CONTACT_RANGE) {
      gameplay.health = Math.max(0, gameplay.health - PLAYER_DAMAGE_PER_SECOND * dt);
      gameplay.status = "Enemies are on you. Fall back to the fire.";
      if (gameplay.health <= 0) {
        loseGame("You were overrun before dawn.");
        return;
      }
    }

    if (structureTarget && horizontalDistance(enemy.position, structureTarget.position) <= 1.9) {
      structureTarget.health = Math.max(0, structureTarget.health - 18 * dt);
    }

    const campDistance = horizontalDistance(enemy.position, DESERT_CAMP_POSITION);
    if (campDistance <= fireRadiusBoost) {
      enemy.health -= 32 * dt;
      enemy.mesh.userData.sharedMaterial.emissiveIntensity = 0.7;
    } else {
      enemy.mesh.userData.sharedMaterial.emissiveIntensity = 0.22;
    }

    if (enemy.health <= 0) {
      scene.remove(enemy.mesh);
      disposeMesh(enemy.mesh);
      gameplay.enemies.splice(i, 1);
      gameplay.status = "The fire burned one of the raiders down.";
    }
  }
}

function updateStructures() {
  for (let i = gameplay.structures.length - 1; i >= 0; i -= 1) {
    const structure = gameplay.structures[i];
    if (structure.health > 0) {
      continue;
    }
    if (gameplay.openChest === structure) {
      closeChestOverlay();
    }
    scene.remove(structure.mesh);
    disposeMesh(structure.mesh);
    gameplay.structures.splice(i, 1);
    gameplay.status = `A ${structure.kind} broke under the pressure.`;
  }
}

function updateArmadillo(dt) {
  if (!armadillo) {
    return;
  }

  const structureTarget = gameplay.phase === "night" ? getPriorityStructureTarget(armadillo.position) : null;
  const target =
    gameplay.armadilloAwake && structureTarget
      ? structureTarget.position
      : gameplay.armadilloAwake
        ? player.position
        : DESERT_CAMP_POSITION;
  const dx = target.x - armadillo.position.x;
  const dz = target.z - armadillo.position.z;
  const distance = Math.hypot(dx, dz) || 1;
  const speed = gameplay.armadilloAwake ? 8.4 : 2.8;

  if (gameplay.armadilloAwake || distance > 0.35) {
    const travel = Math.min(distance, speed * dt);
    armadillo.position.x += (dx / distance) * travel;
    armadillo.position.z += (dz / distance) * travel;
    armadillo.lookAt(target.x, armadillo.position.y, target.z);
  }

  const campY = terrainHeight(armadillo.position.x, armadillo.position.z);
  armadillo.position.y = campY + 0.2;

  if (!gameplay.armadilloAwake) {
    gameplay.armadilloStunTimer = 0;
    return;
  }

  if (gameplay.armadilloStunTimer > 0) {
    gameplay.armadilloStunTimer = Math.max(0, gameplay.armadilloStunTimer - dt);
    return;
  }

  const playerDistance = horizontalDistance(armadillo.position, player.position);
  if (playerDistance > ARMADILLO_WAKE_RANGE) {
    return;
  }
  if (!structureTarget && playerDistance <= ENEMY_CONTACT_RANGE + 0.9) {
    gameplay.health = Math.max(0, gameplay.health - ARMADILLO_DAMAGE_PER_SECOND * dt);
    gameplay.status = "The armadillo is mauling you. Relight the fire or run.";
    if (gameplay.health <= 0) {
      loseGame("The armadillo brought the run to an end.");
    }
  }

  for (const structure of gameplay.structures) {
    const distanceToStructure = horizontalDistance(armadillo.position, structure.position);
    if (distanceToStructure <= BARRICADE_SLOW_RADIUS) {
      structure.health = Math.max(0, structure.health - (structure.kind === "chest" ? 24 : 18) * dt);
    }
  }
}

function updateInteractionPrompt() {
  const interaction = getInteractionTarget();
  if (!interactionPrompt) {
    return;
  }
  if (!interaction) {
    interactionPrompt.hidden = true;
    return;
  }
  interactionPrompt.hidden = false;
  interactionPrompt.textContent = interaction.prompt;
}

function updateGameplayHud() {
  if (gamePhase) {
    gamePhase.textContent =
      gameplay.phase === "day" ? `Daybreak ${gameplay.nightCount + 1}` : `Night ${gameplay.nightCount}`;
  }
  if (gameStatus) {
    gameStatus.textContent = gameplay.status;
  }
  if (healthStat) {
    healthStat.textContent = `Health ${Math.round(gameplay.health)}`;
  }
  if (fireStat) {
    fireStat.textContent = `Fire ${Math.round(gameplay.fireFuel)}`;
  }
  if (woodStat) {
    woodStat.textContent = `Boards ${gameplay.boards}`;
  }
  if (emberStat) {
    emberStat.textContent = `Sack ${gameplay.boards} / ${gameplay.sackCapacity}`;
  }
  if (gunStat) {
    gunStat.textContent = `Guns ${gameplay.guns}`;
  }
  if (craftStat) {
    craftStat.textContent = `Barricades ${gameplay.barricadeKits}`;
  }
  if (chestStat) {
    chestStat.textContent = `Chests ${gameplay.chestKits}`;
  }
  if (nightStat) {
    nightStat.textContent = `Night ${Math.min(gameplay.nightCount, TOTAL_NIGHTS_TO_SURVIVE)} / ${TOTAL_NIGHTS_TO_SURVIVE}`;
  }
  if (invBoards) {
    invBoards.textContent = `Boards ${gameplay.boards}`;
  }
  if (invGuns) {
    invGuns.textContent = `Guns ${gameplay.guns}`;
  }
  if (invBarricades) {
    invBarricades.textContent = `Barricades ${gameplay.barricadeKits}`;
  }
  if (invChests) {
    invChests.textContent = `Chest Kits ${gameplay.chestKits}`;
  }
  if (invCoins) {
    invCoins.textContent = `Coins ${gameplay.coins}`;
  }
}

function handleInteraction() {
  if (!net.connected || !net.playerId || gameplay.ended) {
    return;
  }

  const interaction = getInteractionTarget();
  if (!interaction) {
    gameplay.status = "Nothing close enough to use.";
    return;
  }

  if (interaction.type === "resource") {
    collectResource(interaction.resource);
    return;
  }

  if (interaction.type === "gun") {
    collectGun(interaction.resource);
    return;
  }

  if (interaction.type === "camp") {
    feedCampfire();
    return;
  }

  if (interaction.type === "table") {
    craftAtTable();
    return;
  }

  if (interaction.type === "chest") {
    openChestOverlay(interaction.structure);
  }
}

function craftBarricade() {
  if (!net.connected || !net.playerId || gameplay.ended || gameplay.lobbyOpen) {
    return;
  }
  if (horizontalDistance(player.position, getCraftingTablePosition()) > STRUCTURE_INTERACT_RANGE) {
    gameplay.status = "Go to the crafting table to craft a barricade.";
    return;
  }
  const barricadeCost = classes[gameplay.selectedClassId]?.barricadeCost ?? BARRICADE_CRAFT_COST;
  if (gameplay.boards < barricadeCost) {
    gameplay.status = `You need ${barricadeCost} boards to craft a barricade.`;
    return;
  }
  gameplay.boards -= barricadeCost;
  gameplay.barricadeKits += 1;
  gameplay.status = "Crafted a barricade kit. Press F to place it.";
}

function placeBarricade() {
  if (!net.connected || !net.playerId || gameplay.ended || gameplay.lobbyOpen) {
    return;
  }
  if (gameplay.barricadeKits <= 0) {
    gameplay.status = "Craft a barricade first with C.";
    return;
  }

  const forwardX = Math.sin(player.courseYaw);
  const forwardZ = -Math.cos(player.courseYaw);
  const x = player.position.x + forwardX * 4;
  const z = player.position.z + forwardZ * 4;
  const y = terrainBaseForSphereAt(x, z, 0.9) + 1.1;
  const mesh = createBarricadeMesh();
  mesh.position.set(x, y, z);
  mesh.rotation.y = -player.courseYaw;
  scene.add(mesh);
  gameplay.structures.push({
    kind: "barricade",
    mesh,
    position: mesh.position.clone(),
    health: BARRICADE_MAX_HEALTH,
  });
  gameplay.barricadeKits -= 1;
  gameplay.status = "Barricade placed.";
}

function placeChest() {
  if (!net.connected || !net.playerId || gameplay.ended || gameplay.lobbyOpen) {
    return;
  }
  if (gameplay.chestKits <= 0) {
    gameplay.status = "Craft a chest first at the crafting table.";
    return;
  }

  const forwardX = Math.sin(player.courseYaw);
  const forwardZ = -Math.cos(player.courseYaw);
  const x = player.position.x + forwardX * 4.5;
  const z = player.position.z + forwardZ * 4.5;
  const y = terrainBaseForSphereAt(x, z, 0.9) + 0.8;
  const mesh = createChestMesh();
  mesh.position.set(x, y, z);
  mesh.rotation.y = -player.courseYaw;
  scene.add(mesh);
  gameplay.structures.push({
    kind: "chest",
    mesh,
    position: mesh.position.clone(),
    health: CHEST_MAX_HEALTH,
    storedBoards: 0,
  });
  gameplay.chestKits -= 1;
  gameplay.status = "Chest placed. The armadillo may attack it at night.";
}

function spawnStarterStructures() {
  const starterBarricadeA = createBarricadeMesh();
  starterBarricadeA.position.set(
    DESERT_CAMP_POSITION.x + 5,
    terrainBaseForSphereAt(DESERT_CAMP_POSITION.x + 5, DESERT_CAMP_POSITION.z - 5, 0.9) + 1.1,
    DESERT_CAMP_POSITION.z - 5,
  );
  starterBarricadeA.rotation.y = Math.PI / 6;
  scene.add(starterBarricadeA);
  gameplay.structures.push({
    kind: "barricade",
    mesh: starterBarricadeA,
    position: starterBarricadeA.position.clone(),
    health: BARRICADE_MAX_HEALTH,
  });

  const starterBarricadeB = createBarricadeMesh();
  starterBarricadeB.position.set(
    DESERT_CAMP_POSITION.x - 6,
    terrainBaseForSphereAt(DESERT_CAMP_POSITION.x - 6, DESERT_CAMP_POSITION.z - 4, 0.9) + 1.1,
    DESERT_CAMP_POSITION.z - 4,
  );
  starterBarricadeB.rotation.y = -Math.PI / 5;
  scene.add(starterBarricadeB);
  gameplay.structures.push({
    kind: "barricade",
    mesh: starterBarricadeB,
    position: starterBarricadeB.position.clone(),
    health: BARRICADE_MAX_HEALTH,
  });

  const starterChest = createChestMesh();
  starterChest.position.set(DESERT_CAMP_POSITION.x + 9, terrainBaseForSphereAt(DESERT_CAMP_POSITION.x + 9, DESERT_CAMP_POSITION.z + 3, 0.9) + 0.8, DESERT_CAMP_POSITION.z + 3);
  starterChest.rotation.y = Math.PI / 5;
  scene.add(starterChest);
  gameplay.structures.push({
    kind: "chest",
    mesh: starterChest,
    position: starterChest.position.clone(),
    health: CHEST_MAX_HEALTH,
    storedBoards: 2,
  });

  const worldChestSpawns = [
    [DESERT_CAMP_POSITION.x + 24, DESERT_CAMP_POSITION.z - 18, 3],
    [DESERT_CAMP_POSITION.x - 26, DESERT_CAMP_POSITION.z + 22, 1],
    [DESERT_CAMP_POSITION.x + 42, DESERT_CAMP_POSITION.z + 8, 4],
  ];
  for (const [x, z, storedBoards] of worldChestSpawns) {
    const chest = createChestMesh();
    chest.position.set(x, terrainBaseForSphereAt(x, z, 0.9) + 0.8, z);
    chest.rotation.y = Math.random() * Math.PI * 2;
    scene.add(chest);
    gameplay.structures.push({
      kind: "chest",
      mesh: chest,
      position: chest.position.clone(),
      health: CHEST_MAX_HEALTH,
      storedBoards,
    });
  }
}

function spawnStarterGuns() {
  const gunSpawns = [
    [DESERT_CAMP_POSITION.x + 14, DESERT_CAMP_POSITION.z - 8],
    [DESERT_CAMP_POSITION.x - 18, DESERT_CAMP_POSITION.z + 10],
    [DESERT_CAMP_POSITION.x + 4, DESERT_CAMP_POSITION.z + 20],
  ];

  for (const [x, z] of gunSpawns) {
    spawnGunPickup(x, z);
  }
}

function getInteractionTarget() {
  const campDistance = horizontalDistance(player.position, DESERT_CAMP_POSITION);
  if (campDistance <= CAMP_INTERACT_RANGE && gameplay.boards > 0) {
    return {
      type: "camp",
      prompt: "Press E to throw a board into the fire. C craft, F place barricade",
    };
  }

  const tableWorldPosition = getCraftingTablePosition();
  const tableDistance = horizontalDistance(player.position, tableWorldPosition);
  if (tableDistance <= STRUCTURE_INTERACT_RANGE) {
    return {
      type: "table",
      prompt: "Press E at crafting table. C barricade, X place chest after crafting",
    };
  }

  for (const structure of gameplay.structures) {
    if (structure.kind !== "chest") {
      continue;
    }
    if (horizontalDistance(player.position, structure.position) <= STRUCTURE_INTERACT_RANGE) {
      return {
        type: "chest",
        structure,
        prompt: "Press E to stash or withdraw boards from chest",
      };
    }
  }

  for (const resource of gameplay.resources) {
    if (!resource.available || resource.kind !== "gun") {
      continue;
    }
    if (horizontalDistance(player.position, resource.position) <= RESOURCE_INTERACT_RANGE) {
      return {
        type: "gun",
        resource,
        prompt: "Press E to pick up a gun",
      };
    }
  }

  let nearest = null;
  let nearestDistance = RESOURCE_INTERACT_RANGE;
  for (const resource of gameplay.resources) {
    if (!resource.available || resource.kind === "gun") {
      continue;
    }
    const distance = horizontalDistance(player.position, resource.position);
    if (distance < nearestDistance) {
      nearest = resource;
      nearestDistance = distance;
    }
  }

  if (!nearest) {
    return null;
  }

  return {
    type: "resource",
    resource: nearest,
    prompt: "Press E to pick up a wooden board. C craft, F place barricade",
  };
}

function craftAtTable() {
  if (gameplay.boards >= CHEST_CRAFT_COST) {
    gameplay.boards -= CHEST_CRAFT_COST;
    gameplay.chestKits += 1;
    gameplay.status = "Crafted a chest kit. Press X to place it.";
    return;
  }
  gameplay.status = "Need 3 boards at the crafting table to craft a chest.";
}

function toggleChestStorage(structure) {
  if (!structure) {
    return;
  }
  if (gameplay.boards > 0 && structure.storedBoards < 10) {
    structure.storedBoards += 1;
    gameplay.boards -= 1;
    gameplay.status = `Stored a board. Chest now holds ${structure.storedBoards}.`;
    return;
  }
  if (structure.storedBoards > 0 && gameplay.boards < gameplay.sackCapacity) {
    structure.storedBoards -= 1;
    gameplay.boards += 1;
    gameplay.status = `Took a board from chest. Chest now holds ${structure.storedBoards}.`;
    return;
  }
  gameplay.status = "Chest transfer failed. Sack may be full or chest empty.";
}

function openChestOverlay(structure) {
  gameplay.openChest = structure;
  unlockPointer();
  updateChestOverlay();
}

function closeChestOverlay() {
  gameplay.openChest = null;
  updateChestOverlay();
}

function updateChestOverlay() {
  if (!chestOverlay) {
    return;
  }
  const structure = gameplay.openChest;
  chestOverlay.hidden = !structure;
  if (!structure) {
    return;
  }
  if (chestTitle) {
    chestTitle.textContent = "World Chest";
  }
  if (chestSummary) {
    chestSummary.textContent = `Stored boards ${structure.storedBoards} | Your boards ${gameplay.boards}`;
  }
}

function storeBoardInOpenChest() {
  if (!gameplay.openChest) {
    return;
  }
  toggleChestStorage(gameplay.openChest);
  updateChestOverlay();
}

function takeBoardFromOpenChest() {
  if (!gameplay.openChest) {
    return;
  }
  if (gameplay.openChest.storedBoards > 0 && gameplay.boards < gameplay.sackCapacity) {
    gameplay.openChest.storedBoards -= 1;
    gameplay.boards += 1;
    gameplay.status = `Took a board from chest. Chest now holds ${gameplay.openChest.storedBoards}.`;
  } else {
    gameplay.status = "Cannot take board. Chest empty or sack full.";
  }
  updateChestOverlay();
}

function getPriorityStructureTarget(origin) {
  let nearest = null;
  let nearestDistance = Number.POSITIVE_INFINITY;
  for (const structure of gameplay.structures) {
    if (structure.health <= 0) {
      continue;
    }
    const distance = horizontalDistance(origin, structure.position);
    if (distance < nearestDistance) {
      nearest = structure;
      nearestDistance = distance;
    }
  }
  return nearest;
}

function collectResource(resource) {
  if (gameplay.boards >= gameplay.sackCapacity) {
    gameplay.status = "Your sack is full. Throw some boards into the fire first.";
    return;
  }
  resource.available = false;
  resource.respawnAt = RESOURCE_RESPAWN_SECONDS;
  resource.mesh.visible = false;
  gameplay.boards += 1;
  gameplay.totalBoardsCollected += 1;
  if (gameplay.totalBoardsCollected % 5 === 0) {
    spawnGunPickup(resource.position.x + 1.6, resource.position.z + 0.8);
    gameplay.status = "Collected a board. Every fifth board drops a gun nearby.";
    return;
  }
  gameplay.status = "Collected a wooden board. Bring it back before the fire dies.";
}

function collectGun(resource) {
  resource.available = false;
  resource.respawnAt = Number.POSITIVE_INFINITY;
  resource.mesh.visible = false;
  gameplay.guns += 1;
  gameplay.status = `Picked up a gun. Guns found: ${gameplay.guns}.`;
}

function fireGun() {
  if (!net.connected || !net.playerId || gameplay.ended || gameplay.lobbyOpen) {
    return;
  }
  if (gameplay.guns <= 0) {
    gameplay.status = "No guns in inventory.";
    return;
  }

  gameplay.guns -= 1;
  const aim = new THREE.Vector3(
    Math.sin(player.courseYaw) * Math.cos(player.pitch),
    Math.sin(player.pitch),
    -Math.cos(player.courseYaw) * Math.cos(player.pitch),
  ).normalize();

  let bestEnemy = null;
  let bestEnemyDistance = GUN_RANGE;
  for (const enemy of gameplay.enemies) {
    const toEnemy = new THREE.Vector3(
      enemy.position.x - player.position.x,
      enemy.position.y - player.position.y,
      enemy.position.z - player.position.z,
    );
    const distance = toEnemy.length();
    if (distance > GUN_RANGE || distance <= 0.001) {
      continue;
    }
    toEnemy.normalize();
    if (aim.dot(toEnemy) < GUN_CONE_DOT) {
      continue;
    }
    if (distance < bestEnemyDistance) {
      bestEnemy = enemy;
      bestEnemyDistance = distance;
    }
  }

  if (bestEnemy) {
    bestEnemy.health -= 120;
    gameplay.status = "Gunshot landed on an enemy.";
    return;
  }

  const toArmadillo = new THREE.Vector3(
    armadillo.position.x - player.position.x,
    armadillo.position.y - player.position.y,
    armadillo.position.z - player.position.z,
  );
  const armadilloDistance = toArmadillo.length();
  if (armadilloDistance > 0.001 && armadilloDistance <= GUN_RANGE) {
    toArmadillo.normalize();
    if (aim.dot(toArmadillo) >= GUN_CONE_DOT) {
      gameplay.armadilloStunTimer = 2.2;
      gameplay.status = "Gunshot stunned the armadillo for a moment.";
      return;
    }
  }

  gameplay.status = "Gunshot missed.";
}

function feedCampfire() {
  if (gameplay.boards <= 0) {
    gameplay.status = "You need boards in the sack before feeding the fire.";
    return;
  }

  gameplay.boards -= 1;
  gameplay.fireFuel = Math.min(FIRE_MAX_FUEL, gameplay.fireFuel + FIRE_FEED_AMOUNT);
  gameplay.status =
    gameplay.fireFuel > 0
      ? "The board catches and the fire climbs again."
      : "The board smolders, but the fire is still weak.";
}

function spawnInitialResources() {
  const resourcePlan = [
    ["board", -28, -16],
    ["board", 18, 42],
    ["board", -60, 28],
    ["board", 74, -12],
    ["board", -8, 74],
    ["board", -46, -58],
    ["board", 58, 16],
    ["board", 84, 54],
    ["board", -84, 10],
  ];

  for (const [kind, x, z] of resourcePlan) {
    const resource = createResourceNode(kind, x, z);
    gameplay.resources.push(resource);
    scene.add(resource.mesh);
  }
}

function createResourceNode(kind, x, z) {
  const isGun = kind === "gun";
  const material = new THREE.MeshStandardMaterial(
    isGun
      ? {
          color: 0x9ea6b7,
          emissive: 0xffb14a,
          emissiveIntensity: 0.55,
          roughness: 0.32,
          metalness: 0.72,
        }
      : { color: 0x9f6e3f, roughness: 0.92, metalness: 0.03 },
  );
  const mesh = new THREE.Mesh(
    isGun ? new THREE.BoxGeometry(1.4, 0.28, 0.42) : new THREE.BoxGeometry(1.9, 0.3, 0.58),
    material,
  );
  mesh.rotation.y = Math.random() * Math.PI;
  mesh.rotation.z = isGun ? Math.PI / 10 : 0;
  const y = terrainBaseForSphereAt(x, z, 0.9) + (isGun ? 0.42 : 0.45);
  mesh.position.set(x, y, z);
  mesh.castShadow = true;
  return {
    kind,
    mesh,
    position: mesh.position.clone(),
    available: true,
    respawnAt: 0,
  };
}

function spawnGunPickup(x, z) {
  const gun = createResourceNode("gun", x, z);
  gameplay.resources.push(gun);
  scene.add(gun.mesh);
}

function spawnEnemy() {
  const angle = Math.random() * Math.PI * 2;
  const radius = WORLD_SIZE * 0.42;
  const x = DESERT_CAMP_POSITION.x + Math.cos(angle) * radius;
  const z = DESERT_CAMP_POSITION.z + Math.sin(angle) * radius;
  const y = terrainBaseForSphereAt(x, z, 0.9) + 0.65;
  const mesh = createEnemyMesh();
  mesh.position.set(x, y, z);
  scene.add(mesh);
  gameplay.enemies.push({
    mesh,
    position: mesh.position.clone(),
    health: 100,
  });
}

function createEnemyMesh() {
  const group = new THREE.Group();
  const material = new THREE.MeshStandardMaterial({
    color: 0x2b1f1a,
    emissive: 0xc34e24,
    emissiveIntensity: 0.22,
    roughness: 0.72,
    metalness: 0.04,
  });
  const body = new THREE.Mesh(new THREE.SphereGeometry(0.9, 16, 14), material);
  body.scale.set(1.1, 0.75, 1.45);
  body.castShadow = true;
  group.add(body);
  const eye = new THREE.Mesh(
    new THREE.SphereGeometry(0.1, 10, 10),
    new THREE.MeshStandardMaterial({ color: 0xffc28c, emissive: 0xff8c40, emissiveIntensity: 1.1 }),
  );
  eye.position.set(-0.24, 0.12, -1.02);
  group.add(eye);
  const eyeRight = eye.clone();
  eyeRight.position.x = 0.24;
  group.add(eyeRight);
  group.userData.sharedMaterial = material;
  return group;
}

function createBarricadeMesh() {
  const group = new THREE.Group();
  const woodMaterial = new THREE.MeshStandardMaterial({
    color: 0x7d4d2a,
    roughness: 0.94,
    metalness: 0.02,
  });

  const boardA = new THREE.Mesh(new THREE.BoxGeometry(2.8, 0.24, 0.18), woodMaterial);
  boardA.position.set(0, 0.9, 0);
  boardA.rotation.z = Math.PI / 7;
  boardA.castShadow = true;
  group.add(boardA);

  const boardB = new THREE.Mesh(new THREE.BoxGeometry(2.8, 0.24, 0.18), woodMaterial);
  boardB.position.set(0, 0.9, 0);
  boardB.rotation.z = -Math.PI / 7;
  boardB.castShadow = true;
  group.add(boardB);

  const supportLeft = new THREE.Mesh(new THREE.BoxGeometry(0.2, 2.2, 0.2), woodMaterial);
  supportLeft.position.set(-0.8, 1.1, 0);
  supportLeft.castShadow = true;
  group.add(supportLeft);

  const supportRight = supportLeft.clone();
  supportRight.position.x = 0.8;
  group.add(supportRight);

  return group;
}

function createChestMesh() {
  const group = new THREE.Group();
  const woodMaterial = new THREE.MeshStandardMaterial({
    color: 0x7a4a28,
    roughness: 0.92,
    metalness: 0.02,
  });
  const bandMaterial = new THREE.MeshStandardMaterial({
    color: 0x9d8b74,
    roughness: 0.55,
    metalness: 0.22,
  });

  const base = new THREE.Mesh(new THREE.BoxGeometry(1.6, 0.9, 1), woodMaterial);
  base.castShadow = true;
  group.add(base);

  const lid = new THREE.Mesh(new THREE.BoxGeometry(1.7, 0.28, 1.08), woodMaterial);
  lid.position.y = 0.58;
  lid.castShadow = true;
  group.add(lid);

  const bandA = new THREE.Mesh(new THREE.BoxGeometry(0.12, 1.1, 1.08), bandMaterial);
  bandA.position.x = -0.48;
  group.add(bandA);
  const bandB = bandA.clone();
  bandB.position.x = 0.48;
  group.add(bandB);

  const lock = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.24, 0.12), bandMaterial);
  lock.position.set(0, 0.18, 0.56);
  group.add(lock);

  return group;
}

function applyTimeOfDayLighting(phase, alpha) {
  const phaseBlend = phase === "day" ? 1 - alpha * 0.5 : alpha;
  const fogColor = new THREE.Color().lerpColors(
    new THREE.Color(0xe6a45f),
    new THREE.Color(0x0d1830),
    THREE.MathUtils.clamp(phaseBlend, 0, 1),
  );
  scene.background.copy(fogColor);
  scene.fog.color.copy(fogColor);
  ambient.intensity = THREE.MathUtils.lerp(0.95, 0.18, phaseBlend);
  sun.intensity = THREE.MathUtils.lerp(1.55, 0.12, phaseBlend);
  bounce.intensity = THREE.MathUtils.lerp(0.45, 0.1, phaseBlend);
  skyDome.material.color.copy(new THREE.Color().lerpColors(
    new THREE.Color(0xf3bb74),
    new THREE.Color(0x10213d),
    phaseBlend,
  ));
  moon.visible = phaseBlend > 0.35;
  moon.material.opacity = THREE.MathUtils.clamp((phaseBlend - 0.25) / 0.75, 0, 0.85);
}

function loseGame(message) {
  if (gameplay.ended) {
    return;
  }
  gameplay.ended = true;
  gameplay.win = false;
  gameplay.status = message;
  showDevOverlay("Camp Lost", `${message} Reload to try the run again.`);
  unlockPointer();
}

function winGame(message) {
  if (gameplay.ended) {
    return;
  }
  gameplay.ended = true;
  gameplay.win = true;
  gameplay.status = message;
  showDevOverlay("99 Nights Cleared", `${message} Reload to start another run.`);
  unlockPointer();
}

function connectToServer() {
  clearReconnectTimer();
  const protocol = window.location.protocol === "https:" ? "wss" : "ws";
  const host = window.location.hostname || "127.0.0.1";
  const url = `${protocol}://${host}:${WS_PORT}`;

  setHelpStatus(`Calling the caravan as ${net.nickname} at ${url}...`, "Entering Desert");
  net.connecting = true;
  updateConnectUi();
  const socket = new WebSocket(url);
  net.socket = socket;

  socket.addEventListener("open", () => {
    net.connected = true;
    net.connecting = false;
    net.reconnectEnabled = true;
    net.restartExpectedUntilMs = 0;
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
    hideDevOverlay();
    setHelpStatus("Connected. Click panel or press L to capture mouse.", "Camp Linked");
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
    const reconnectExpected = isReconnectExpected();
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
    if (reconnectExpected && net.reconnectEnabled) {
      showDevOverlay("Camp Shifting", "The desert instance is reloading. Reconnecting soon.");
      scheduleReconnect(Math.max(250, net.restartExpectedUntilMs - performance.now()));
      setHelpStatus("Camp is shifting. Reconnecting soon.", "Reconnecting");
      return;
    }
    setHelpStatus("Lost contact with camp.", "Disconnected");
  });

  socket.addEventListener("error", () => {
    net.connecting = false;
    updateConnectUi();
    if (!isReconnectExpected()) {
      setHelpStatus(`Connection error. Ensure desert server is running on port ${WS_PORT}.`, "Connection Error");
    }
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
    return;
  }

  if (message.type === "serverRestarting") {
    const delayMs = Number(message.delayMs);
    net.restartExpectedUntilMs = performance.now() + (Number.isFinite(delayMs) ? Math.max(250, delayMs) : 1400);
    showDevOverlay("Camp Shifting", message.message || "Desert server update in progress. Reconnecting soon.");
    return;
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
    updateAvatarRolling(avatar, state?.parachuteActive === true);
    const yaw = Number(state?.yaw) || 0;
    const pitch = Number(state?.pitch) || 0;
    avatar.face.rotation.set(
      THREE.MathUtils.clamp(pitch, -MAX_PITCH, MAX_PITCH) + FACE_PITCH_UP_BIAS,
      -yaw,
      0,
      "YXZ",
    );
    avatar.parachute.visible = state?.parachuteActive === true;
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

  const parachute = createParachute();
  parachute.visible = false;
  root.add(parachute);

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
    parachute,
    labelName: "",
    appearanceKey: "",
    bodyPatternTexture: null,
    rollingReady: false,
  };
  net.playerAvatarsById.set(playerId, avatar);
  return avatar;
}

function updateAvatarRolling(avatar, parachuteActive = false) {
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

  if (parachuteActive) {
    return;
  }

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

function createParachute() {
  const group = new THREE.Group();

  const canopy = new THREE.Mesh(
    new THREE.SphereGeometry(1.9, 24, 16, 0, Math.PI * 2, 0, Math.PI * 0.5),
    new THREE.MeshStandardMaterial({
      color: 0xfff1d6,
      roughness: 0.72,
      metalness: 0.02,
      side: THREE.DoubleSide,
    }),
  );
  canopy.position.y = PARACHUTE_CANOPY_Y;
  canopy.scale.set(1, 0.62, 1);
  canopy.castShadow = true;
  group.add(canopy);

  const stripeGeometry = new THREE.BoxGeometry(0.18, 0.04, 1.95);
  const stripeMaterial = new THREE.MeshStandardMaterial({
    color: 0xd95a43,
    roughness: 0.58,
    metalness: 0.04,
  });
  const stripeA = new THREE.Mesh(stripeGeometry, stripeMaterial);
  stripeA.position.y = PARACHUTE_CANOPY_Y + 0.05;
  stripeA.rotation.y = Math.PI / 3;
  group.add(stripeA);
  const stripeB = stripeA.clone();
  stripeB.rotation.y = -Math.PI / 3;
  group.add(stripeB);

  const lineMaterial = new THREE.LineBasicMaterial({ color: 0xf4f8ff, transparent: true, opacity: 0.82 });
  const anchors = [
    [-0.52, 0.2, -0.52],
    [0.52, 0.2, -0.52],
    [-0.52, 0.2, 0.52],
    [0.52, 0.2, 0.52],
  ];

  for (const [x, y, z] of anchors) {
    const points = [
      new THREE.Vector3(x, y, z),
      new THREE.Vector3(x * 1.85, PARACHUTE_CANOPY_Y - 0.48, z * 1.85),
    ];
    group.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(points), lineMaterial));
  }

  return group;
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

function setHelpStatus(text, title = "99 Nights In The Desert") {
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
  setHelpStatus("Choose a nomad name and enter the desert. Then click panel or press L to capture mouse.", "Sundown Briefing");
}

function startConnectFromUi() {
  if (net.connected || net.connecting) {
    return;
  }
  gameplay.lobbyOpen = false;
  updateLobbyUi();
  net.reconnectEnabled = true;
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

function initDevNotifications() {
  if (!import.meta.hot) {
    return;
  }

  let clientUpdateOverlayTimer = null;
  import.meta.hot.on("dev:client-update-pending", (data) => {
    clearTimeout(clientUpdateOverlayTimer);
    clientUpdateOverlayTimer = setTimeout(() => {
      const delayMs = Number(data?.delayMs);
      const seconds = Math.max(1, Math.round((Number.isFinite(delayMs) ? delayMs : 1400) / 100) / 10);
      showDevOverlay("Mirage Shifting", `Client changes detected. Reloading this tab in about ${seconds}s.`);
    }, CLIENT_UPDATE_OVERLAY_DEBOUNCE_MS);
  });
}

function showDevOverlay(title, text) {
  unlockPointer();
  if (devOverlayTitle) {
    devOverlayTitle.textContent = title;
  }
  if (devOverlayText) {
    devOverlayText.textContent = text;
  }
  if (devOverlay) {
    devOverlay.hidden = false;
  }
}

function hideDevOverlay() {
  if (devOverlay) {
    devOverlay.hidden = true;
  }
}

function scheduleReconnect(delayMs) {
  if (!net.reconnectEnabled) {
    return;
  }

  clearReconnectTimer();
  net.reconnectTimer = window.setTimeout(() => {
    net.reconnectTimer = null;
    if (!net.connected && !net.connecting) {
      connectToServer();
    }
  }, delayMs);
}

function clearReconnectTimer() {
  if (net.reconnectTimer !== null) {
    window.clearTimeout(net.reconnectTimer);
    net.reconnectTimer = null;
  }
}

function isReconnectExpected() {
  return net.restartExpectedUntilMs > performance.now();
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
    connectButton.textContent = net.connecting ? "Crossing..." : "Enter Desert";
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

  const dunes = fbm(x * 0.008, z * 0.01, 4, 2.0, 0.52) * (3.6 + roughness * 6.8);
  const ridges = fbm(x * 0.021, z * 0.031, 3, 2.15, 0.52) * (1.2 + roughness * 2.7);
  const ripples = fbm(x * 0.09, z * 0.055, 2, 2.0, 0.5) * 0.6;
  const basin = -Math.max(0, 1 - distanceFromCenter / (WORLD_SIZE * 0.5)) * 1.8;

  return dunes + ridges + ripples + basin;
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
    return "nomad";
  }
  const cleaned = rawName.replace(/\s+/g, " ").trim().slice(0, 20);
  return cleaned.length > 0 ? cleaned : "nomad";
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

  ctx.fillStyle = "#d0a261";
  ctx.fillRect(0, 0, size, size);

  const macro = 32;
  for (let y = 0; y < size; y += macro) {
    for (let x = 0; x < size; x += macro) {
      const even = ((x / macro) + (y / macro)) % 2 === 0;
      ctx.fillStyle = even ? "rgba(223, 184, 119, 0.2)" : "rgba(171, 123, 70, 0.16)";
      ctx.fillRect(x, y, macro, macro);
    }
  }

  for (let i = 0; i < 3600; i += 1) {
    const x = Math.random() * size;
    const y = Math.random() * size;
    const shade = 160 + Math.floor(Math.random() * 70);
    ctx.fillStyle = `rgb(${shade}, ${shade - 38}, ${shade - 84})`;
    ctx.fillRect(x, y, 1, 1);
  }

  ctx.strokeStyle = "rgba(147, 96, 42, 0.36)";
  ctx.lineWidth = 1;
  for (let i = -size; i < size * 2; i += 20) {
    ctx.beginPath();
    ctx.moveTo(i, 0);
    ctx.lineTo(i - size, size);
    ctx.stroke();
  }

  ctx.strokeStyle = "rgba(247, 216, 161, 0.15)";
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

function createSunDisc() {
  const sunDisc = new THREE.Mesh(
    new THREE.SphereGeometry(24, 24, 18),
    new THREE.MeshBasicMaterial({
      color: 0xffd27a,
      transparent: true,
      opacity: 0.95,
    }),
  );
  sunDisc.position.set(-180, 120, -260);
  return sunDisc;
}

function createMoonDisc() {
  const moonDisc = new THREE.Mesh(
    new THREE.SphereGeometry(16, 20, 16),
    new THREE.MeshBasicMaterial({
      color: 0xc9d7ff,
      transparent: true,
      opacity: 0,
    }),
  );
  moonDisc.position.set(200, 140, -180);
  moonDisc.visible = false;
  return moonDisc;
}

function createArmadilloCamp() {
  const group = new THREE.Group();
  const campGroundY = terrainHeight(DESERT_CAMP_POSITION.x, DESERT_CAMP_POSITION.z);
  const tableWorldX = DESERT_CAMP_POSITION.x + CRAFTING_TABLE_OFFSET.x;
  const tableWorldZ = DESERT_CAMP_POSITION.z + CRAFTING_TABLE_OFFSET.z;
  const tableGroundY = terrainHeight(tableWorldX, tableWorldZ);
  const armadilloRoot = new THREE.Group();
  armadilloRoot.position.set(DESERT_CAMP_POSITION.x, campGroundY + 0.2, DESERT_CAMP_POSITION.z);
  group.add(armadilloRoot);
  group.userData.armadillo = armadilloRoot;

  const bodyMaterial = new THREE.MeshStandardMaterial({
    color: 0x8e6446,
    roughness: 0.92,
    metalness: 0.02,
  });
  const shellMaterial = new THREE.MeshStandardMaterial({
    color: 0x704629,
    roughness: 0.88,
    metalness: 0.03,
  });
  const paleMaterial = new THREE.MeshStandardMaterial({
    color: 0xd6b08a,
    roughness: 0.95,
    metalness: 0.01,
  });
  const darkMaterial = new THREE.MeshStandardMaterial({
    color: 0x22150f,
    roughness: 0.7,
    metalness: 0.02,
  });

  const shell = new THREE.Mesh(new THREE.SphereGeometry(2.2, 26, 18), shellMaterial);
  shell.scale.set(1.3, 0.82, 1);
  shell.castShadow = true;
  armadilloRoot.add(shell);

  for (let i = -2; i <= 2; i += 1) {
    const stripe = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.9, 1.98), paleMaterial);
    stripe.position.set(i * 0.55, 0.08, 0);
    stripe.rotation.z = 0.08 * i;
    stripe.castShadow = true;
    armadilloRoot.add(stripe);
  }

  const head = new THREE.Mesh(new THREE.SphereGeometry(0.7, 18, 14), bodyMaterial);
  head.position.set(0, -0.15, -2.35);
  head.scale.set(0.95, 0.8, 1.15);
  head.castShadow = true;
  armadilloRoot.add(head);

  const snout = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.3, 0.9, 10), paleMaterial);
  snout.rotation.x = Math.PI / 2;
  snout.position.set(0, -0.12, -3);
  snout.castShadow = true;
  armadilloRoot.add(snout);

  const ear = new THREE.Mesh(new THREE.ConeGeometry(0.16, 0.38, 10), bodyMaterial);
  ear.position.set(-0.32, 0.48, -2.35);
  ear.rotation.z = 0.38;
  ear.castShadow = true;
  armadilloRoot.add(ear);
  const earRight = ear.clone();
  earRight.position.x = 0.32;
  earRight.rotation.z = -0.38;
  armadilloRoot.add(earRight);

  const eye = new THREE.Mesh(new THREE.SphereGeometry(0.06, 10, 10), darkMaterial);
  eye.position.set(-0.22, 0.08, -2.92);
  armadilloRoot.add(eye);
  const eyeRight = eye.clone();
  eyeRight.position.x = 0.22;
  armadilloRoot.add(eyeRight);

  const legOffsets = [
    [-1.4, -1.15, -1.05],
    [1.4, -1.15, -1.05],
    [-1.2, -1.15, 1.15],
    [1.2, -1.15, 1.15],
  ];
  for (const [x, y, z] of legOffsets) {
    const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.14, 0.18, 0.92, 10), bodyMaterial);
    leg.position.set(x, y, z);
    leg.castShadow = true;
    armadilloRoot.add(leg);
  }

  const tail = new THREE.Mesh(new THREE.CylinderGeometry(0.11, 0.2, 2.4, 12), shellMaterial);
  tail.position.set(0, -0.3, 2.55);
  tail.rotation.x = Math.PI / 2;
  tail.rotation.z = 0.08;
  tail.castShadow = true;
  armadilloRoot.add(tail);

  const marker = new THREE.Mesh(
    new THREE.CylinderGeometry(0.12, 0.16, 4.8, 10),
    new THREE.MeshStandardMaterial({
      color: 0x6c3d20,
      roughness: 0.94,
      metalness: 0.01,
    }),
  );
  marker.position.set(DESERT_CAMP_POSITION.x - 4.1, campGroundY + 2.1, DESERT_CAMP_POSITION.z - 1.8);
  marker.castShadow = true;
  group.add(marker);

  const lantern = new THREE.Mesh(
    new THREE.SphereGeometry(0.34, 14, 12),
    new THREE.MeshStandardMaterial({
      color: 0xffc768,
      emissive: 0xff9f2f,
      emissiveIntensity: 1.3,
      roughness: 0.36,
      metalness: 0.04,
    }),
  );
  lantern.position.set(DESERT_CAMP_POSITION.x - 4.1, campGroundY + 4.6, DESERT_CAMP_POSITION.z - 1.8);
  group.add(lantern);

  const flag = new THREE.Mesh(
    new THREE.PlaneGeometry(1.8, 1.1),
    new THREE.MeshStandardMaterial({
      color: 0xc65a2a,
      side: THREE.DoubleSide,
      roughness: 0.92,
      metalness: 0.02,
    }),
  );
  flag.position.set(DESERT_CAMP_POSITION.x - 3.15, campGroundY + 4.05, DESERT_CAMP_POSITION.z - 1.8);
  flag.rotation.y = Math.PI / 8;
  group.add(flag);

  const table = createCraftingTableMesh();
  table.position.set(tableWorldX, tableGroundY + 1.05, tableWorldZ);
  group.add(table);
  group.userData.craftingTable = table;

  return group;
}

function createCraftingTableMesh() {
  const group = new THREE.Group();
  const woodMaterial = new THREE.MeshStandardMaterial({
    color: 0x88532d,
    roughness: 0.94,
    metalness: 0.02,
  });
  const metalMaterial = new THREE.MeshStandardMaterial({
    color: 0x9a8d77,
    roughness: 0.52,
    metalness: 0.18,
  });

  const top = new THREE.Mesh(new THREE.BoxGeometry(2.6, 0.24, 1.6), woodMaterial);
  top.castShadow = true;
  group.add(top);

  const leg = new THREE.Mesh(new THREE.BoxGeometry(0.18, 1.5, 0.18), woodMaterial);
  leg.position.set(-1, -0.82, -0.55);
  leg.castShadow = true;
  group.add(leg);
  const leg2 = leg.clone();
  leg2.position.set(1, -0.82, -0.55);
  group.add(leg2);
  const leg3 = leg.clone();
  leg3.position.set(-1, -0.82, 0.55);
  group.add(leg3);
  const leg4 = leg.clone();
  leg4.position.set(1, -0.82, 0.55);
  group.add(leg4);

  const tool = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.08, 0.18), metalMaterial);
  tool.position.set(0.4, 0.18, 0.24);
  tool.rotation.z = Math.PI / 7;
  group.add(tool);

  return group;
}

function getCraftingTablePosition() {
  if (craftingTable) {
    return craftingTable.position;
  }
  return new THREE.Vector3(
    DESERT_CAMP_POSITION.x + CRAFTING_TABLE_OFFSET.x,
    0,
    DESERT_CAMP_POSITION.z + CRAFTING_TABLE_OFFSET.z,
  );
}

function horizontalDistance(a, b) {
  return Math.hypot((a.x || 0) - (b.x || 0), (a.z || 0) - (b.z || 0));
}

function disposeMesh(root) {
  root.traverse((node) => {
    if (node.geometry) {
      node.geometry.dispose();
    }
    if (!node.material) {
      return;
    }
    if (Array.isArray(node.material)) {
      for (const material of node.material) {
        if (material.map) {
          material.map.dispose();
        }
        material.dispose();
      }
      return;
    }
    if (node.material.map) {
      node.material.map.dispose();
    }
    node.material.dispose();
  });
}
