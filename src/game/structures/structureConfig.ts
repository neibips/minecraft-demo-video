export const HUT_RARITY = 1 / 64
export const MANSION_RARITY = 1 / 128
export const FORTRESS_RARITY = 1 / 64

export const STRUCTURE_SEARCH_RADIUS_CHUNKS = 6

export interface StructureSpawnConfig {
  rarity: number
  maxTerrainDelta: number
  priority: number
}

const DEFAULT_STRUCTURE_CONFIG: StructureSpawnConfig = {
  rarity: 0,
  maxTerrainDelta: 2,
  priority: 0,
}

export const STRUCTURE_SPAWN_CONFIG: Record<string, StructureSpawnConfig> = {
  hut: {
    rarity: HUT_RARITY,
    maxTerrainDelta: 2,
    priority: 1,
  },
  mansion: {
    rarity: MANSION_RARITY,
    maxTerrainDelta: 4,
    priority: 2,
  },
  fortress: {
    rarity: FORTRESS_RARITY,
    maxTerrainDelta: 6,
    priority: 3,
  },
}

export const getStructureSpawnConfig = (name: string): StructureSpawnConfig =>
  STRUCTURE_SPAWN_CONFIG[name] ?? DEFAULT_STRUCTURE_CONFIG
