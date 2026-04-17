/// <reference lib="webworker" />

import { CHUNK_SIZE, SEA_LEVEL, WORLD_HEIGHT } from '../config'
import type { BiomeId, ChunkWorkerResponse, SurfaceSpawnHint } from '../types'
import { getHeightIndex, getVoxelIndex } from '../utils/chunk'
import { createSeededRandom, hashString } from '../utils/math'
import { createNoiseTools } from '../world/noise'
import type { WorldWorkerMessage, WorldWorkerResponse } from '../world/protocol'

let seed = 'default-seed'
let blockCodes: Record<string, number> = {}
let noise = createNoiseTools(seed)

interface TerrainSample {
  height: number
  moisture: number
  river: number
  mountainMask: number
  biome: BiomeId
}

const MOUNTAIN_MASK_THRESHOLD = 0.42
const MOUNTAIN_MAX_LIFT = 58
const PLAINS_DIRT_DEPTH = 5

const getSurfaceBiome = (
  height: number,
  moisture: number,
  river: number,
  mountainMask: number,
): BiomeId => {
  if (mountainMask > MOUNTAIN_MASK_THRESHOLD && height > SEA_LEVEL + 10) {
    return 'mountains'
  }
  if (height <= SEA_LEVEL + 1 && river > 0.28) {
    return 'lake'
  }
  if (height <= SEA_LEVEL + 3 || river > 0.52) {
    return 'beach'
  }
  if (moisture > 0.12) {
    return 'forest'
  }
  return 'plains'
}

const setBlock = (blocks: Uint16Array, x: number, y: number, z: number, blockId: string): void => {
  if (x < 0 || x >= CHUNK_SIZE || z < 0 || z >= CHUNK_SIZE || y < 0 || y >= WORLD_HEIGHT) {
    return
  }
  const code = blockCodes[blockId]
  if (!code) {
    return
  }
  blocks[getVoxelIndex(x, y, z)] = code
}

const getBlock = (blocks: Uint16Array, x: number, y: number, z: number): number => {
  if (x < 0 || x >= CHUNK_SIZE || z < 0 || z >= CHUNK_SIZE || y < 0 || y >= WORLD_HEIGHT) {
    return 0
  }
  return blocks[getVoxelIndex(x, y, z)]
}

const addTree = (
  blocks: Uint16Array,
  x: number,
  y: number,
  z: number,
  worldX: number,
  worldZ: number,
  random: () => number,
): void => {
  const variation = (noise.value2d(worldX * 0.23, worldZ * 0.23) + 1) * 0.5
  const extra = random() * 0.5
  const trunkHeight = 4 + Math.floor((variation * 0.7 + extra) * 6)
  for (let offset = 0; offset < trunkHeight; offset += 1) {
    setBlock(blocks, x, y + offset, z, 'wood')
  }

  const canopyRadius = trunkHeight >= 7 ? 3 : 2
  const canopyY = y + trunkHeight - 1
  for (let dz = -canopyRadius; dz <= canopyRadius; dz += 1) {
    for (let dx = -canopyRadius; dx <= canopyRadius; dx += 1) {
      for (let dy = 0; dy <= canopyRadius; dy += 1) {
        const distance = Math.abs(dx) + Math.abs(dz) + dy
        if (distance <= canopyRadius + 1) {
          if (dy === 0 && (dx !== 0 || dz !== 0) && distance === canopyRadius + 1 && random() < 0.4) {
            continue
          }
          setBlock(blocks, x + dx, canopyY + dy, z + dz, 'leaves')
        }
      }
    }
  }
}

const addFlower = (blocks: Uint16Array, x: number, y: number, z: number): void => {
  if (!getBlock(blocks, x, y, z)) {
    setBlock(blocks, x, y, z, 'flower')
  }
}

const createTerrainSampler = () => {
  const cache = new Map<string, TerrainSample>()

  return (worldX: number, worldZ: number): TerrainSample => {
    const key = `${worldX}:${worldZ}`
    const cached = cache.get(key)
    if (cached) {
      return cached
    }

    const continental = noise.fbm2d(worldX * 0.0072, worldZ * 0.0072, 5, 2, 0.5)
    const detail = noise.fbm2d(worldX * 0.042, worldZ * 0.042, 3, 2, 0.5)
    const rolling = noise.fbm2d(worldX * 0.017 + 17, worldZ * 0.017 - 43, 3, 2, 0.5)
    const ridge = 1 - Math.abs(noise.fbm2d(worldX * 0.013 + 320, worldZ * 0.013 - 190, 4, 2, 0.5))
    const mountainMaskRaw = noise.fbm2d(worldX * 0.0045 + 610, worldZ * 0.0045 - 350, 3, 2, 0.55)
    const moisture = noise.fbm2d(worldX * 0.019 + 200, worldZ * 0.019 - 150, 4, 2, 0.55)
    const riverNoise = Math.abs(noise.fbm2d(worldX * 0.006 - 540, worldZ * 0.006 + 260, 3, 2, 0.5))
    const river = Math.max(0, 1 - riverNoise / 0.12)

    let mountainLift = 0
    if (mountainMaskRaw > MOUNTAIN_MASK_THRESHOLD) {
      const normalized = (mountainMaskRaw - MOUNTAIN_MASK_THRESHOLD) / (1 - MOUNTAIN_MASK_THRESHOLD)
      const ridgeFactor = Math.max(0, (ridge - 0.35) / 0.65)
      mountainLift = Math.pow(normalized, 1.4) * Math.pow(ridgeFactor, 1.2) * MOUNTAIN_MAX_LIFT
    }

    const baseLift = continental * 3 + rolling * 2 + detail * 1.1
    const riverCut = river * 7
    const rawHeight = SEA_LEVEL + 2 + baseLift + mountainLift - riverCut
    const height = Math.max(6, Math.min(WORLD_HEIGHT - 4, Math.floor(rawHeight)))
    const biome = getSurfaceBiome(height, moisture, river, mountainMaskRaw)

    const sample: TerrainSample = {
      height,
      moisture,
      river,
      mountainMask: mountainMaskRaw,
      biome,
    }
    cache.set(key, sample)
    return sample
  }
}

const isSandyColumn = (
  sampleTerrain: (worldX: number, worldZ: number) => TerrainSample,
  worldX: number,
  worldZ: number,
  sample: TerrainSample,
): boolean => {
  if (sample.height <= SEA_LEVEL + 2 || sample.river > 0.45) {
    return true
  }

  if (sample.height > SEA_LEVEL + 4) {
    return false
  }

  for (let dz = -1; dz <= 1; dz += 1) {
    for (let dx = -1; dx <= 1; dx += 1) {
      if (sampleTerrain(worldX + dx, worldZ + dz).height <= SEA_LEVEL + 1) {
        return true
      }
    }
  }

  return false
}

const shouldCarveCave = (worldX: number, y: number, worldZ: number, surfaceY: number): boolean => {
  if (y <= 3 || y >= surfaceY - 5) {
    return false
  }

  const cavernNoise = noise.fbm3d(worldX * 0.055, y * 0.078, worldZ * 0.055, 3, 2, 0.5)
  const tunnelNoise = Math.abs(noise.value3d(worldX * 0.028 + 160, y * 0.044 - 120, worldZ * 0.028 - 240))

  return cavernNoise > 0.72 || (tunnelNoise < 0.04 && cavernNoise > 0.4)
}

const carveOre = (blocks: Uint16Array, x: number, y: number, z: number, blockId: string, radius: number): void => {
  for (let dz = -radius; dz <= radius; dz += 1) {
    for (let dx = -radius; dx <= radius; dx += 1) {
      for (let dy = -radius; dy <= radius; dy += 1) {
        if (dx * dx + dy * dy + dz * dz > radius * radius) {
          continue
        }
        const current = getBlock(blocks, x + dx, y + dy, z + dz)
        if (current === blockCodes.stone) {
          setBlock(blocks, x + dx, y + dy, z + dz, blockId)
        }
      }
    }
  }
}

const generateChunk = (coordX: number, coordZ: number): ChunkWorkerResponse => {
  const blocks = new Uint16Array(CHUNK_SIZE * CHUNK_SIZE * WORLD_HEIGHT)
  const heights = new Uint8Array(CHUNK_SIZE * CHUNK_SIZE)
  const biomes: BiomeId[] = new Array(CHUNK_SIZE * CHUNK_SIZE).fill('plains')
  const terrain: TerrainSample[] = new Array(CHUNK_SIZE * CHUNK_SIZE)
  const spawns: SurfaceSpawnHint[] = []
  const sampleTerrain = createTerrainSampler()
  const random = createSeededRandom(hashString(`${seed}:${coordX}:${coordZ}`))

  for (let localZ = 0; localZ < CHUNK_SIZE; localZ += 1) {
    for (let localX = 0; localX < CHUNK_SIZE; localX += 1) {
      const worldX = coordX * CHUNK_SIZE + localX
      const worldZ = coordZ * CHUNK_SIZE + localZ
      const index = getHeightIndex(localX, localZ)
      const sample = sampleTerrain(worldX, worldZ)
      terrain[index] = sample
      heights[index] = Math.min(255, sample.height)
      biomes[index] = sample.biome
    }
  }

  for (let localZ = 0; localZ < CHUNK_SIZE; localZ += 1) {
    for (let localX = 0; localX < CHUNK_SIZE; localX += 1) {
      const worldX = coordX * CHUNK_SIZE + localX
      const worldZ = coordZ * CHUNK_SIZE + localZ
      const index = getHeightIndex(localX, localZ)
      const sample = terrain[index]
      const surfaceY = sample.height
      const sandyColumn = isSandyColumn(sampleTerrain, worldX, worldZ, sample)
      const isMountain = sample.biome === 'mountains'
      const dirtDepth = sandyColumn ? 4 : isMountain ? 2 : PLAINS_DIRT_DEPTH

      for (let y = 0; y <= surfaceY; y += 1) {
        if (y === 0) {
          setBlock(blocks, localX, y, localZ, 'stone')
          continue
        }

        if (shouldCarveCave(worldX, y, worldZ, surfaceY)) {
          continue
        }

        const depth = surfaceY - y
        if (depth === 0) {
          if (isMountain && surfaceY > SEA_LEVEL + 24) {
            setBlock(blocks, localX, y, localZ, 'stone')
          } else if (sandyColumn) {
            setBlock(blocks, localX, y, localZ, 'sand')
          } else {
            setBlock(blocks, localX, y, localZ, 'ground')
          }
        } else if (depth <= dirtDepth) {
          if (isMountain && depth > 1) {
            setBlock(blocks, localX, y, localZ, 'stone')
          } else {
            setBlock(blocks, localX, y, localZ, sandyColumn ? 'sand' : 'dirt')
          }
        } else {
          setBlock(blocks, localX, y, localZ, 'stone')
        }
      }

      for (let y = surfaceY + 1; y <= SEA_LEVEL; y += 1) {
        if (!getBlock(blocks, localX, y, localZ)) {
          setBlock(blocks, localX, y, localZ, 'water')
        }
      }
    }
  }

  for (let localZ = 1; localZ < CHUNK_SIZE - 1; localZ += 1) {
    for (let localX = 1; localX < CHUNK_SIZE - 1; localX += 1) {
      const index = getHeightIndex(localX, localZ)
      const biome = biomes[index]
      const surfaceY = heights[index]
      const worldX = coordX * CHUNK_SIZE + localX
      const worldZ = coordZ * CHUNK_SIZE + localZ
      const surfaceBlock = getBlock(blocks, localX, surfaceY, localZ)
      const blockAbove = getBlock(blocks, localX, surfaceY + 1, localZ)

      if (!surfaceBlock || blockAbove) {
        continue
      }

      if (surfaceBlock === blockCodes.ground && biome === 'forest' && random() > 0.945) {
        addTree(blocks, localX, surfaceY + 1, localZ, worldX, worldZ, random)
      } else if (surfaceBlock === blockCodes.ground && biome === 'plains' && random() > 0.988) {
        addTree(blocks, localX, surfaceY + 1, localZ, worldX, worldZ, random)
      } else if (surfaceBlock === blockCodes.ground && (biome === 'forest' || biome === 'plains') && random() > 0.91) {
        addFlower(blocks, localX, surfaceY + 1, localZ)
      }

      if (surfaceY > SEA_LEVEL + 1) {
        if ((biome === 'forest' || biome === 'plains') && random() > 0.982) {
          spawns.push({ x: worldX + 0.5, y: surfaceY + 1, z: worldZ + 0.5, entityId: 'chicken' })
        }

        // Spiders: much rarer, only some biomes, randomized per-chunk
        const spiderBaseChance =
          biome === 'mountains' ? 0.997 : biome === 'forest' ? 0.995 : biome === 'plains' ? 0.997 : 1
        if (biome !== 'beach' && biome !== 'lake' && random() > spiderBaseChance) {
          spawns.push({ x: worldX + 0.5, y: surfaceY + 1, z: worldZ + 0.5, entityId: 'spider' })
        }
      }
    }
  }

  for (let vein = 0; vein < 10; vein += 1) {
    carveOre(
      blocks,
      Math.floor(random() * CHUNK_SIZE),
      6 + Math.floor(random() * 22),
      Math.floor(random() * CHUNK_SIZE),
      'coal_ore',
      1 + Math.floor(random() * 2),
    )
  }

  for (let vein = 0; vein < 6; vein += 1) {
    carveOre(
      blocks,
      Math.floor(random() * CHUNK_SIZE),
      5 + Math.floor(random() * 18),
      Math.floor(random() * CHUNK_SIZE),
      'iron_ore',
      1,
    )
  }

  if (random() > 0.55) {
    carveOre(
      blocks,
      Math.floor(random() * CHUNK_SIZE),
      4 + Math.floor(random() * 14),
      Math.floor(random() * CHUNK_SIZE),
      'glowing_ore',
      1,
    )
  }

  if (random() > 0.72) {
    carveOre(
      blocks,
      Math.floor(random() * CHUNK_SIZE),
      3 + Math.floor(random() * 10),
      Math.floor(random() * CHUNK_SIZE),
      'diamond_ore',
      1,
    )
  }

  return {
    coord: { x: coordX, z: coordZ },
    blocks,
    heights,
    biomes,
    spawns,
  }
}

self.onmessage = (event: MessageEvent<WorldWorkerMessage>) => {
  const message = event.data
  if (message.type === 'init') {
    seed = message.payload.seed
    blockCodes = message.payload.blockCodes
    noise = createNoiseTools(seed)
    return
  }

  if (message.type === 'generate-chunk') {
    const response: WorldWorkerResponse = {
      type: 'chunk-generated',
      payload: generateChunk(message.payload.coord.x, message.payload.coord.z),
    }
    self.postMessage(response, [response.payload.blocks.buffer, response.payload.heights.buffer])
  }
}
