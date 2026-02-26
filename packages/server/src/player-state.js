export class PlayerState {
  constructor({
    playerId,
    position,
    velocity,
    onGround,
    name,
    jumpRequested,
    jumpCooldownRemaining,
    moveX,
    moveZ,
    yaw,
    pitch,
    avatar,
  }) {
    this.playerId = playerId;
    this.position = { ...position };
    this.velocity = { ...velocity };
    this.onGround = onGround;
    this.name = name;
    this.jumpRequested = jumpRequested;
    this.jumpCooldownRemaining = jumpCooldownRemaining;
    this.moveX = moveX;
    this.moveZ = moveZ;
    this.yaw = yaw;
    this.pitch = pitch;
    this.avatar = {
      color: normalizeAvatarColor(avatar?.color),
      pattern: sanitizeAvatarPattern(avatar?.pattern),
    };
  }

  static createInitial(playerId) {
    return new PlayerState({
      playerId,
      position: { x: 0, y: 0, z: 0 },
      velocity: { x: 0, y: 0, z: 0 },
      onGround: true,
      name: undefined,
      jumpRequested: false,
      jumpCooldownRemaining: 0,
      moveX: 0,
      moveZ: 0,
      yaw: 0,
      pitch: 0,
      avatar: {
        color: "#3c74d4",
        pattern: "stripes",
      },
    });
  }

  setName(rawName) {
    if (typeof rawName !== "string") {
      return;
    }
    this.name = rawName.slice(0, 32);
  }

  setAvatar(rawAvatar) {
    if (!rawAvatar || typeof rawAvatar !== "object") {
      return;
    }
    this.avatar = {
      color: normalizeAvatarColor(rawAvatar.color),
      pattern: sanitizeAvatarPattern(rawAvatar.pattern),
    };
  }

  requestJump() {
    this.jumpRequested = true;
  }

  applyInput(input) {
    this.yaw = normalizeAngle(input.yaw);
    this.pitch = clamp(input.pitch, -Math.PI / 2, Math.PI / 2);
    const localX = clamp(input.moveX, -1, 1);
    const localZ = clamp(input.moveZ, -1, 1);
    const normalized = normalizeStick(localX, localZ);
    const sinYaw = Math.sin(this.yaw);
    const cosYaw = Math.cos(this.yaw);

    this.moveX = normalized.x * cosYaw + normalized.z * sinYaw;
    this.moveZ = normalized.x * sinYaw - normalized.z * cosYaw;

    if (input.jumpRequested) {
      this.requestJump();
    }
  }

  simulateTick(dtSeconds, config) {
    const control = this.onGround ? 1 : config.airControl;
    const accelStep = config.maxAcceleration * control * dtSeconds;

    this.velocity.x += this.moveX * accelStep;
    this.velocity.z += this.moveZ * accelStep;

    const friction = this.onGround ? config.friction : config.airFriction;
    applyHorizontalFriction(this.velocity, friction * dtSeconds);

    clampHorizontalSpeed(this.velocity, config.maxBumpSpeed ?? config.maxSpeed);

    const cooldown = Math.max(0, this.jumpCooldownRemaining - dtSeconds);
    this.jumpCooldownRemaining = cooldown;

    if (this.jumpRequested && this.onGround && this.jumpCooldownRemaining <= 0) {
      this.velocity.y = config.jumpSpeed;
      this.onGround = false;
      this.jumpCooldownRemaining = config.jumpCooldownSeconds;
    }
    this.jumpRequested = false;

    this.velocity.y -= config.gravity * dtSeconds;
    this.position.x += this.velocity.x * dtSeconds;
    this.position.y += this.velocity.y * dtSeconds;
    this.position.z += this.velocity.z * dtSeconds;

    if (this.position.y <= config.groundY) {
      this.position.y = config.groundY;
      this.velocity.y = 0;
      this.onGround = true;
    } else {
      this.onGround = false;
    }

    this.enforceWorldBounds(config);
  }

  enforceWorldBounds(config) {
    const boundedX = clamp(this.position.x, -config.worldHalfExtent, config.worldHalfExtent);
    if (boundedX !== this.position.x) {
      this.position.x = boundedX;
      this.velocity.x = 0;
    }

    const boundedZ = clamp(this.position.z, -config.worldHalfExtent, config.worldHalfExtent);
    if (boundedZ !== this.position.z) {
      this.position.z = boundedZ;
      this.velocity.z = 0;
    }
  }

  toJSON() {
    return {
      playerId: this.playerId,
      position: this.position,
      velocity: this.velocity,
      onGround: this.onGround,
      name: this.name,
      yaw: this.yaw,
      pitch: this.pitch,
      avatar: this.avatar,
    };
  }
}

function clamp(value, min, max) {
  if (!Number.isFinite(value)) {
    return 0;
  }
  return Math.max(min, Math.min(max, value));
}

function normalizeAngle(value) {
  if (!Number.isFinite(value)) {
    return 0;
  }
  const wrapped = ((value + Math.PI) % (Math.PI * 2) + Math.PI * 2) % (Math.PI * 2) - Math.PI;
  return wrapped;
}

function applyHorizontalFriction(velocity, amount) {
  const speed = Math.hypot(velocity.x, velocity.z);
  if (speed === 0) {
    return;
  }
  const reduced = Math.max(0, speed - amount);
  if (reduced === 0) {
    velocity.x = 0;
    velocity.z = 0;
    return;
  }
  const scale = reduced / speed;
  velocity.x *= scale;
  velocity.z *= scale;
}

function clampHorizontalSpeed(velocity, maxSpeed) {
  const horizontalSpeed = Math.hypot(velocity.x, velocity.z);
  if (horizontalSpeed <= maxSpeed) {
    return;
  }
  const scale = maxSpeed / horizontalSpeed;
  velocity.x *= scale;
  velocity.z *= scale;
}

function normalizeStick(x, z) {
  const length = Math.hypot(x, z);
  if (length <= 1 || length === 0) {
    return { x, z };
  }
  return { x: x / length, z: z / length };
}

function normalizeAvatarColor(rawColor) {
  if (typeof rawColor !== "string") {
    return "#3c74d4";
  }
  const trimmed = rawColor.trim();
  if (/^#[0-9a-fA-F]{6}$/.test(trimmed)) {
    return trimmed.toLowerCase();
  }
  return "#3c74d4";
}

function sanitizeAvatarPattern(rawPattern) {
  if (rawPattern === "stripes" || rawPattern === "checker") {
    return rawPattern;
  }
  return "stripes";
}
