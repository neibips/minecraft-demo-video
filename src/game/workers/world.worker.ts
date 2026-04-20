/// <reference lib="webworker" />

import { CHUNK_SIZE, SEA_LEVEL, WORLD_HEIGHT } from '../config'
import type { BiomeId, ChunkWorkerResponse, SurfaceSpawnHint } from '../types'
import { applyStructuresToChunk, collectStructuresForChunk } from '../structures/generator'
import { getHeightIndex, getVoxelIndex } from '../utils/chunk'
import { clamp, createSeededRandom, hashString } from '../utils/math'
import { createNoiseTools } from '../world/noise'
import type { WorldWorkerMessage, WorldWorkerResponse } from '../world/protocol'

let seed = 'default-seed'
let blockCodes: Record<string, number> = {}
let noise = createNoiseTools(seed)

interface TerrainSample {
  height: number
  temperature: number
  humidity: number
  continentalness: number
  mountainMask: number
  biome: BiomeId
}

const CONTINENTAL_LAND_THRESHOLD = 0.02
const CONTINENTAL_COAST_FADE = 0.18
const MOUNTAIN_INTERSECTION_THRESHOLD = 0.68
const PLAINS_DIRT_DEPTH = 4
const FOREST_TREE_THRESHOLD = 0.6
const PLAINS_TREE_THRESHOLD = 0.7
const FOREST_TREE_SPACING = 4
const PLAINS_TREE_SPACING = 5
const FLOWER_FOREST_THRESHOLD = 0.72
const FLOWER_PLAINS_THRESHOLD = 0.78
const SHALLOW_WATER_MAX_DEPTH = 3

const normalizeNoise = (value: number): number => value * 0.5 + 0.5

const remap01 = (value: number, min: number, max: number): number => {
  if (max <= min) {
    return value >= max ? 1 : 0
  }
  return clamp((value - min) / (max - min), 0, 1)
}

const isDominatedByNeighbor = (score: number, neighborScore: number, dx: number, dz: number): boolean =>
  neighborScore > score + 1e-6 ||
  (Math.abs(neighborScore - score) <= 1e-6 && (dz < 0 || (dz === 0 && dx < 0)))

const getSurfaceBiome = (sample: TerrainSample): BiomeId => {
  if (sample.height <= SEA_LEVEL) {
    return 'lake'
  }

  const coastBlend = remap01(
    sample.continentalness,
    CONTINENTAL_LAND_THRESHOLD,
    CONTINENTAL_LAND_THRESHOLD + CONTINENTAL_COAST_FADE,
  )
  if (sample.height <= SEA_LEVEL + 3 || coastBlend < 0.34) {
    return 'beach'
  }

  if (sample.mountainMask > 0.2 && sample.height >= SEA_LEVEL + 14) {
    return 'mountains'
  }

  const forestSuitability =
    sample.humidity * 0.72 +
    clamp(1 - Math.abs(sample.temperature - 0.56) * 1.4, 0, 1) * 0.28

  return forestSuitability > 0.58 ? 'forest' : 'plains'
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
  const variation = (noise.value2d(worldX * 0.18, worldZ * 0.18) + 1) * 0.5
  const extra = random() * 0.45
  const trunkHeight = 4 + Math.floor((variation * 0.65 + extra) * 6)

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

    const warpX = noise.value2d(worldX * 0.0018 + 140, worldZ * 0.0018 - 210) * 88
    const warpZ = noise.value2d(worldX * 0.0018 - 630, worldZ * 0.0018 + 470) * 88
    const warpedX = worldX + warpX
    const warpedZ = worldZ + warpZ

    const continentalBase = noise.fbm2d(warpedX * 0.00155, warpedZ * 0.00155, 5, 2.04, 0.52)
    const continentalSecondary = noise.value2d(warpedX * 0.00072 + 390, warpedZ * 0.00072 - 250)
    const spawnBias = Math.max(0, 1 - Math.hypot(worldX, worldZ) / 720) * 0.16
    const continentalness = continentalBase * 0.74 + continentalSecondary * 0.26 + spawnBias
    const inlandness = remap01(continentalness, CONTINENTAL_LAND_THRESHOLD + 0.03, 0.52)
    const landRise = remap01(continentalness, CONTINENTAL_LAND_THRESHOLD - 0.16, 0.36)

    const macroRelief = noise.fbm2d(warpedX * 0.0058, warpedZ * 0.0058, 5, 2, 0.52)
    const hills = noise.fbm2d(warpedX * 0.0128 + 140, warpedZ * 0.0128 - 90, 5, 2.06, 0.49)
    const surfaceDetail = noise.fbm2d(warpedX * 0.028 - 360, warpedZ * 0.028 + 220, 4, 2.12, 0.45)
    const oceanRelief = noise.fbm2d(warpedX * 0.0096 - 920, warpedZ * 0.0096 + 760, 4, 2.08, 0.5)

    const mountainMaskA = normalizeNoise(
      noise.fbm2d(warpedX * 0.00118 + 910, warpedZ * 0.00118 - 810, 4, 2.02, 0.56),
    )
    const mountainMaskB = normalizeNoise(
      noise.fbm2d(warpedX * 0.00105 - 1410, warpedZ * 0.00105 + 1280, 4, 2.04, 0.55),
    )
    const mountainIntersection = Math.min(mountainMaskA, mountainMaskB)
    const mountainMask =
      remap01(mountainIntersection, MOUNTAIN_INTERSECTION_THRESHOLD, 0.91) *
      remap01(inlandness, 0.08, 1)
    const mountainShape = noise.ridged2d(warpedX * 0.0078 + 220, warpedZ * 0.0078 - 310, 5, 2.08, 0.52)
    const mountainPeaks = noise.ridged2d(warpedX * 0.0164 - 540, warpedZ * 0.0164 + 430, 4, 2.18, 0.48)

    let rawHeight = SEA_LEVEL - 6
    if (continentalness < CONTINENTAL_LAND_THRESHOLD) {
      const oceanDepth = remap01(CONTINENTAL_LAND_THRESHOLD - continentalness, 0, 0.6)
      rawHeight = SEA_LEVEL - 4 - oceanDepth * 18 + oceanRelief * 3 + macroRelief * 2
    } else {
      const baseLandHeight = SEA_LEVEL + 3 + landRise * 12 + macroRelief * 10 + hills * 6 + surfaceDetail * 2.5
      const mountainLiftFactor = mountainMask > 0 ? Math.pow(mountainMask, 0.72) : 0
      const mountainTargetLift = 80 + mountainPeaks * 40
      const mountainLift = Math.min(
        Math.max(0, WORLD_HEIGHT - 6 - baseLandHeight),
        mountainTargetLift * mountainLiftFactor * (0.4 + mountainShape * 0.6),
      )
      rawHeight = baseLandHeight + mountainLift
    }

    const coastDistance = Math.abs(continentalness - CONTINENTAL_LAND_THRESHOLD)
    const coastInfluence = 1 - remap01(coastDistance, 0.05, 0.23)
    if (coastInfluence > 0) {
      const shorelineBlend = remap01(
        continentalness,
        CONTINENTAL_LAND_THRESHOLD - 0.08,
        CONTINENTAL_LAND_THRESHOLD + 0.14,
      )
      const shorelineHeight =
        SEA_LEVEL - 2 + shorelineBlend * 5 + macroRelief * 1.4 + surfaceDetail * 0.8
      rawHeight = rawHeight * (1 - coastInfluence) + shorelineHeight * coastInfluence
    }

    const height = Math.max(5, Math.min(WORLD_HEIGHT - 4, Math.floor(rawHeight)))

    const temperatureNoise = noise.fbm2d(worldX * 0.0022 - 720, worldZ * 0.0022 + 640, 5, 2.02, 0.55)
    const temperatureCell = noise.value2d(worldX * 0.0009 + 1080, worldZ * 0.0009 - 1140)
    const temperature = clamp(
      normalizeNoise(temperatureNoise) * 0.78 +
        normalizeNoise(temperatureCell) * 0.22 -
        remap01(height, SEA_LEVEL + 18, WORLD_HEIGHT - 10) * 0.18,
      0,
      1,
    )

    const humidityNoise = noise.fbm2d(worldX * 0.0025 + 250, worldZ * 0.0025 - 510, 5, 2.04, 0.56)
    const humidityCell = noise.value2d(worldX * 0.0062 - 370, worldZ * 0.0062 + 820)
    const humidity = clamp(
      normalizeNoise(humidityNoise) * 0.74 + normalizeNoise(humidityCell) * 0.26,
      0,
      1,
    )

    const sample: TerrainSample = {
      height,
      temperature,
      humidity,
      continentalness,
      mountainMask,
      biome: 'plains',
    }
    sample.biome = getSurfaceBiome(sample)

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
  if (sample.biome === 'beach' || sample.biome === 'lake') {
    return true
  }

  if (sample.height > SEA_LEVEL + 5) {
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

const getTreePlacementScore = (
  sample: TerrainSample,
  biome: BiomeId,
  worldX: number,
  worldZ: number,
): number => {
  const grove = normalizeNoise(noise.value2d(worldX * 0.052 + 280, worldZ * 0.052 - 470))
  const cluster = normalizeNoise(noise.value2d(worldX * 0.018 - 910, worldZ * 0.018 + 660))
  if (biome === 'forest') {
    return grove * 0.58 + cluster * 0.22 + sample.humidity * 0.2
  }
  return grove * 0.48 + cluster * 0.18 + sample.humidity * 0.34
}

const canPlaceTree = (
  sampleTerrain: (worldX: number, worldZ: number) => TerrainSample,
  sample: TerrainSample,
  biome: BiomeId,
  worldX: number,
  worldZ: number,
): boolean => {
  if (biome !== 'forest' && biome !== 'plains') {
    return false
  }

  const score = getTreePlacementScore(sample, biome, worldX, worldZ)
  const threshold = biome === 'forest' ? FOREST_TREE_THRESHOLD : PLAINS_TREE_THRESHOLD
  if (score < threshold) {
    return false
  }

  const spacing = biome === 'forest' ? FOREST_TREE_SPACING : PLAINS_TREE_SPACING
  for (let dz = -spacing; dz <= spacing; dz += 1) {
    for (let dx = -spacing; dx <= spacing; dx += 1) {
      if ((dx === 0 && dz === 0) || dx * dx + dz * dz > spacing * spacing) {
        continue
      }

      const neighbor = sampleTerrain(worldX + dx, worldZ + dz)
      if ((neighbor.biome !== 'forest' && neighbor.biome !== 'plains') || neighbor.height <= SEA_LEVEL + 1) {
        continue
      }

      const neighborScore = getTreePlacementScore(neighbor, neighbor.biome, worldX + dx, worldZ + dz)
      if (isDominatedByNeighbor(score, neighborScore, dx, dz)) {
        return false
      }
    }
  }

  return true
}

const getFlowerPlacementScore = (sample: TerrainSample, worldX: number, worldZ: number): number => {
  const patch = normalizeNoise(noise.value2d(worldX * 0.051 - 320, worldZ * 0.051 + 540))
  const scatter = normalizeNoise(noise.value2d(worldX * 0.123 + 880, worldZ * 0.123 - 710))
  return patch * 0.54 + scatter * 0.14 + sample.humidity * 0.32
}

const shouldPlaceFlower = (sample: TerrainSample, biome: BiomeId, worldX: number, worldZ: number): boolean => {
  if (biome !== 'forest' && biome !== 'plains') {
    return false
  }

  const threshold = biome === 'forest' ? FLOWER_FOREST_THRESHOLD : FLOWER_PLAINS_THRESHOLD
  return getFlowerPlacementScore(sample, worldX, worldZ) > threshold
}

const getClayPatchScore = (worldX: number, worldZ: number): number => {
  const patch = normalizeNoise(noise.value2d(worldX * 0.072 + 720, worldZ * 0.072 - 930))
  const variation = normalizeNoise(noise.value2d(worldX * 0.024 - 1840, worldZ * 0.024 + 1570))
  return patch * 0.68 + variation * 0.32
}

const canStartClayPatch = (
  sampleTerrain: (worldX: number, worldZ: number) => TerrainSample,
  worldX: number,
  worldZ: number,
  sample: TerrainSample,
  sandyColumn: boolean,
): boolean => {
  const waterDepth = SEA_LEVEL - sample.height
  if (!sandyColumn || waterDepth < 1 || waterDepth > SHALLOW_WATER_MAX_DEPTH) {
    return false
  }

  const score = getClayPatchScore(worldX, worldZ)
  if (score < 0.84) {
    return false
  }

  let shallowSandCount = 0
  let totalCount = 0
  for (let dz = -3; dz <= 3; dz += 1) {
    for (let dx = -3; dx <= 3; dx += 1) {
      if (dx * dx + dz * dz > 9) {
        continue
      }
      totalCount += 1
      const neighbor = sampleTerrain(worldX + dx, worldZ + dz)
      const neighborDepth = SEA_LEVEL - neighbor.height
      if (
        neighborDepth >= 0 &&
        neighborDepth <= SHALLOW_WATER_MAX_DEPTH &&
        isSandyColumn(sampleTerrain, worldX + dx, worldZ + dz, neighbor)
      ) {
        shallowSandCount += 1
      }
    }
  }
  if (shallowSandCount < Math.ceil(totalCount * 0.75)) {
    return false
  }

  for (let dz = -4; dz <= 4; dz += 1) {
    for (let dx = -4; dx <= 4; dx += 1) {
      if ((dx === 0 && dz === 0) || dx * dx + dz * dz > 16) {
        continue
      }

      const neighbor = sampleTerrain(worldX + dx, worldZ + dz)
      const neighborDepth = SEA_LEVEL - neighbor.height
      if (
        neighborDepth < 1 ||
        neighborDepth > SHALLOW_WATER_MAX_DEPTH ||
        !isSandyColumn(sampleTerrain, worldX + dx, worldZ + dz, neighbor)
      ) {
        continue
      }

      const neighborScore = getClayPatchScore(worldX + dx, worldZ + dz)
      if (isDominatedByNeighbor(score, neighborScore, dx, dz)) {
        return false
      }
    }
  }

  return true
}

const paintClayPatch = (
  blocks: Uint16Array,
  terrain: TerrainSample[],
  sampleTerrain: (worldX: number, worldZ: number) => TerrainSample,
  coordX: number,
  coordZ: number,
  centerLocalX: number,
  centerLocalZ: number,
): void => {
  const centerWorldX = coordX * CHUNK_SIZE + centerLocalX
  const centerWorldZ = coordZ * CHUNK_SIZE + centerLocalZ
  const radius = 2 + Math.floor(normalizeNoise(noise.value2d(centerWorldX * 0.16 + 110, centerWorldZ * 0.16 - 170)) * 2)
  const fillRadius = Math.max(1, radius - 1)
  const fillRadiusSq = fillRadius * fillRadius

  for (let dz = -radius; dz <= radius; dz += 1) {
    for (let dx = -radius; dx <= radius; dx += 1) {
      if (dx * dx + dz * dz > fillRadiusSq) {
        continue
      }

      const localX = centerLocalX + dx
      const localZ = centerLocalZ + dz
      if (localX < 0 || localX >= CHUNK_SIZE || localZ < 0 || localZ >= CHUNK_SIZE) {
        continue
      }

      const index = getHeightIndex(localX, localZ)
      const sample = terrain[index]
      const worldX = coordX * CHUNK_SIZE + localX
      const worldZ = coordZ * CHUNK_SIZE + localZ
      const waterDepth = SEA_LEVEL - sample.height
      if (
        waterDepth < 1 ||
        waterDepth > SHALLOW_WATER_MAX_DEPTH ||
        !isSandyColumn(sampleTerrain, worldX, worldZ, sample)
      ) {
        continue
      }

      if (getBlock(blocks, localX, sample.height, localZ) === blockCodes.sand) {
        setBlock(blocks, localX, sample.height, localZ, 'clay')
      }
    }
  }
}

const shouldCarveCave = (worldX: number, y: number, worldZ: number, surfaceY: number): boolean => {
  const burialDepth = surfaceY - y
  if (y <= 4 || burialDepth < 2) {
    return false
  }

  const depthMask = remap01(burialDepth, 3, 44)
  const caveDensity = normalizeNoise(
    noise.fbm2d(worldX * 0.0082 + 540, worldZ * 0.0082 - 620, 3, 2.04, 0.55),
  )

  const tunnelA = Math.abs(noise.value3d(worldX * 0.034, y * 0.03, worldZ * 0.034))
  const tunnelB = Math.abs(
    noise.value3d(worldX * 0.024 + 190, y * 0.022 - 120, worldZ * 0.024 - 260),
  )
  const tunnelWarp = noise.fbm3d(
    worldX * 0.017 - 480,
    y * 0.019 + 340,
    worldZ * 0.017 + 210,
    3,
    2.08,
    0.52,
  )
  const spaghetti = Math.min(tunnelA, Math.abs(tunnelB + tunnelWarp * 0.35))
  const tunnelThreshold = 0.034 + depthMask * 0.018 + caveDensity * 0.01

  const chamberNoise = noise.fbm3d(worldX * 0.021, y * 0.025, worldZ * 0.021, 4, 2.02, 0.5)
  const chamberShape = noise.ridged3d(
    worldX * 0.016 + 310,
    y * 0.019 - 140,
    worldZ * 0.016 - 270,
    3,
    2.06,
    0.5,
  )
  const chamberThreshold = 0.61 - depthMask * 0.04
  const chamber = chamberNoise > chamberThreshold && chamberShape > 0.46 + (1 - caveDensity) * 0.06

  const nearSurface = burialDepth <= 7 && y > SEA_LEVEL - 6
  const entranceMask = noise.ridged2d(worldX * 0.026 + 180, worldZ * 0.026 - 320, 3, 2.08, 0.52)
  const entrance =
    nearSurface &&
    caveDensity > 0.5 &&
    entranceMask > 0.72 &&
    spaghetti < tunnelThreshold + 0.014

  if (burialDepth < 3 && !entrance) {
    return false
  }

  return spaghetti < tunnelThreshold || chamber || entrance
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

const isInsideStructureFootprint = (
  worldX: number,
  worldZ: number,
  structures: ChunkWorkerResponse['structures'],
): boolean =>
  structures.some(
    (structure) =>
      worldX >= structure.bounds.minX &&
      worldX < structure.bounds.maxX &&
      worldZ >= structure.bounds.minZ &&
      worldZ < structure.bounds.maxZ,
  )

const generateChunk = (coordX: number, coordZ: number): ChunkWorkerResponse => {
  const blocks = new Uint16Array(CHUNK_SIZE * CHUNK_SIZE * WORLD_HEIGHT)
  const heights = new Uint8Array(CHUNK_SIZE * CHUNK_SIZE)
  const biomes: BiomeId[] = new Array(CHUNK_SIZE * CHUNK_SIZE).fill('plains')
  const terrain: TerrainSample[] = new Array(CHUNK_SIZE * CHUNK_SIZE)
  const spawns: SurfaceSpawnHint[] = []
  const sampleTerrain = createTerrainSampler()
  const spawnRandom = createSeededRandom(hashString(`${seed}:spawns:${coordX}:${coordZ}`))
  const oreRandom = createSeededRandom(hashString(`${seed}:ores:${coordX}:${coordZ}`))

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
          if (isMountain && surfaceY > SEA_LEVEL + 18) {
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
      const worldX = coordX * CHUNK_SIZE + localX
      const worldZ = coordZ * CHUNK_SIZE + localZ
      const index = getHeightIndex(localX, localZ)
      const sample = terrain[index]
      if (canStartClayPatch(sampleTerrain, worldX, worldZ, sample, isSandyColumn(sampleTerrain, worldX, worldZ, sample))) {
        paintClayPatch(blocks, terrain, sampleTerrain, coordX, coordZ, localX, localZ)
      }
    }
  }

  for (let vein = 0; vein < 10; vein += 1) {
    carveOre(
      blocks,
      Math.floor(oreRandom() * CHUNK_SIZE),
      6 + Math.floor(oreRandom() * 22),
      Math.floor(oreRandom() * CHUNK_SIZE),
      'coal_ore',
      1 + Math.floor(oreRandom() * 2),
    )
  }

  for (let vein = 0; vein < 6; vein += 1) {
    carveOre(
      blocks,
      Math.floor(oreRandom() * CHUNK_SIZE),
      5 + Math.floor(oreRandom() * 18),
      Math.floor(oreRandom() * CHUNK_SIZE),
      'iron_ore',
      1,
    )
  }

  if (oreRandom() > 0.55) {
    carveOre(
      blocks,
      Math.floor(oreRandom() * CHUNK_SIZE),
      4 + Math.floor(oreRandom() * 14),
      Math.floor(oreRandom() * CHUNK_SIZE),
      'glowing_ore',
      1,
    )
  }

  if (oreRandom() > 0.72) {
    carveOre(
      blocks,
      Math.floor(oreRandom() * CHUNK_SIZE),
      3 + Math.floor(oreRandom() * 10),
      Math.floor(oreRandom() * CHUNK_SIZE),
      'diamond_ore',
      1,
    )
  }

  for (let localZ = 1; localZ < CHUNK_SIZE - 1; localZ += 1) {
    for (let localX = 1; localX < CHUNK_SIZE - 1; localX += 1) {
      const index = getHeightIndex(localX, localZ)
      const biome = biomes[index]
      const sample = terrain[index]
      const surfaceY = heights[index]
      const worldX = coordX * CHUNK_SIZE + localX
      const worldZ = coordZ * CHUNK_SIZE + localZ
      const surfaceBlock = getBlock(blocks, localX, surfaceY, localZ)
      const blockAbove = getBlock(blocks, localX, surfaceY + 1, localZ)

      if (!surfaceBlock || blockAbove) {
        continue
      }

      if (surfaceBlock === blockCodes.ground && canPlaceTree(sampleTerrain, sample, biome, worldX, worldZ)) {
        addTree(
          blocks,
          localX,
          surfaceY + 1,
          localZ,
          worldX,
          worldZ,
          createSeededRandom(hashString(`${seed}:tree:${worldX}:${worldZ}`)),
        )
      } else if (
        surfaceBlock === blockCodes.ground &&
        shouldPlaceFlower(sample, biome, worldX, worldZ)
      ) {
        addFlower(blocks, localX, surfaceY + 1, localZ)
      }
    }
  }

  const structurePlacements = collectStructuresForChunk(
    seed,
    coordX,
    coordZ,
    sampleTerrain,
    (worldX, worldZ) => isSandyColumn(sampleTerrain, worldX, worldZ, sampleTerrain(worldX, worldZ)),
  )
  const structures = applyStructuresToChunk(blocks, coordX, coordZ, structurePlacements, blockCodes)

  for (let localZ = 1; localZ < CHUNK_SIZE - 1; localZ += 1) {
    for (let localX = 1; localX < CHUNK_SIZE - 1; localX += 1) {
      const index = getHeightIndex(localX, localZ)
      const biome = biomes[index]
      const surfaceY = heights[index]
      const worldX = coordX * CHUNK_SIZE + localX
      const worldZ = coordZ * CHUNK_SIZE + localZ
      if (isInsideStructureFootprint(worldX, worldZ, structures)) {
        continue
      }

      if (surfaceY > SEA_LEVEL + 1) {
        if ((biome === 'forest' || biome === 'plains') && spawnRandom() > 0.984) {
          spawns.push({ x: worldX + 0.5, y: surfaceY + 1, z: worldZ + 0.5, entityId: 'chicken' })
        }

        const spiderBaseChance =
          biome === 'mountains' ? 0.998 : biome === 'forest' ? 0.996 : biome === 'plains' ? 0.998 : 1
        if (biome !== 'beach' && biome !== 'lake' && spawnRandom() > spiderBaseChance) {
          spawns.push({ x: worldX + 0.5, y: surfaceY + 1, z: worldZ + 0.5, entityId: 'spider' })
        }
      }
    }
  }

  return {
    coord: { x: coordX, z: coordZ },
    blocks,
    heights,
    biomes,
    spawns,
    structures,
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
