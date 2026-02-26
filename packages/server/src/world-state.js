import { PlayerState } from "./player-state.js";

export class WorldState {
  constructor() {
    this.tick = 0;
    this.players = new Map();
  }

  incrementTick() {
    this.tick += 1;
    return this.tick;
  }

  simulateTick(dtSeconds, config) {
    this.incrementTick();
    for (const player of this.players.values()) {
      player.simulateTick(dtSeconds, config);
    }
    return this.tick;
  }

  createPlayer(playerId) {
    const player = PlayerState.createInitial(playerId);
    this.players.set(playerId, player);
    return player;
  }

  getPlayer(playerId) {
    return this.players.get(playerId);
  }

  removePlayer(playerId) {
    const player = this.players.get(playerId);
    this.players.delete(playerId);
    return player;
  }

  getPlayerCount() {
    return this.players.size;
  }

  createSnapshot() {
    return {
      tick: this.tick,
      players: Array.from(this.players.values()),
    };
  }
}
