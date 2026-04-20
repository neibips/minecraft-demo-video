import { CHUNK_SIZE, SEA_LEVEL, WORLD_HEIGHT } from '../config'
import type { ChunkCoord, PlacedStructureRecord, StructureBounds } from '../types'
import { getVoxelIndex } from '../utils/chunk'
import { createSeededRandom, hashString } from '../utils/math'
import { getStructureSpawnConfig, STRUCTURE_SEARCH_RADIUS_CHUNKS } from './structureConfig'
import { getStructureTemplates } from './loader'
import type { StructurePlacement, StructureTemplate, StructureTerrainSample } from './types'

const REPLACEABLE_FOUNDATION_BLOCKS = ['flower', 'leaves', 'water', 'water_1', 'water_2', 'water_3', 'water_4', 'water_5', 'water_6', 'water_7', 'wood']

const getChunkBounds = (coordX: number, coordZ: number) => ({
  minX: coordX * CHUNK_SIZE,
  minZ: coordZ * CHUNK_SIZE,
  maxX: coordX * CHUNK_SIZE + CHUNK_SIZE,
  maxZ: coordZ * CHUNK_SIZE + CHUNK_SIZE,
})

const intersectsXZ = (
  bounds: Pick<StructureBounds, 'minX' | 'minZ' | 'maxX' | 'maxZ'>,
  other: Pick<StructureBounds, 'minX' | 'minZ' | 'maxX' | 'maxZ'>,
): boolean =>
  bounds.minX < other.maxX &&
  bounds.maxX > other.minX &&
  bounds.minZ < other.maxZ &&
  bounds.maxZ > other.minZ

const intersectsBounds = (bounds: StructureBounds, other: StructureBounds): boolean =>
  bounds.minX < other.maxX &&
  bounds.maxX > other.minX &&
  bounds.minY < other.maxY &&
  bounds.maxY > other.minY &&
  bounds.minZ < other.maxZ &&
  bounds.maxZ > other.minZ

const toRecord = (placement: StructurePlacement): PlacedStructureRecord => ({
  placementId: placement.placementId,
  structureName: placement.structure.name,
  sourceChunk: placement.sourceChunk,
  worldOrigin: placement.worldOrigin,
  anchorWorld: placement.anchorWorld,
  bounds: placement.bounds,
})

const createStructurePlacement = (
  seed: string,
  structure: StructureTemplate,
  sourceChunk: ChunkCoord,
  sampleTerrain: (worldX: number, worldZ: number) => StructureTerrainSample,
  isSandyColumn: (worldX: number, worldZ: number, sample: StructureTerrainSample) => boolean,
): StructurePlacement | null => {
  const config = getStructureSpawnConfig(structure.name)
  const placementRandom = createSeededRandom(
    hashString(`${seed}:structure:${structure.name}:${sourceChunk.x}:${sourceChunk.z}`),
  )
  const rarity = config.rarity || structure.rarity
  if (rarity <= 0 || placementRandom() >= rarity) {
    return null
  }

  const anchorWorldX = sourceChunk.x * CHUNK_SIZE + Math.floor(placementRandom() * CHUNK_SIZE)
  const anchorWorldZ = sourceChunk.z * CHUNK_SIZE + Math.floor(placementRandom() * CHUNK_SIZE)
  const worldOriginX = anchorWorldX - structure.anchor.x
  const worldOriginZ = anchorWorldZ - structure.anchor.z

  let minHeight = Number.POSITIVE_INFINITY
  let maxHeight = Number.NEGATIVE_INFINITY
  let hasWater = false
  let hasSand = false

  for (let localZ = 0; localZ < structure.size.z; localZ += 1) {
    for (let localX = 0; localX < structure.size.x; localX += 1) {
      const worldX = worldOriginX + localX
      const worldZ = worldOriginZ + localZ
      const sample = sampleTerrain(worldX, worldZ)
      minHeight = Math.min(minHeight, sample.height)
      maxHeight = Math.max(maxHeight, sample.height)
      if (sample.height <= SEA_LEVEL || sample.biome === 'lake') {
        hasWater = true
      }
      if (isSandyColumn(worldX, worldZ, sample)) {
        hasSand = true
      }
    }
  }

  if (maxHeight - minHeight > config.maxTerrainDelta) {
    return null
  }
  if (hasWater) {
    return null
  }
  if (structure.name === 'fortress' && hasSand) {
    return null
  }

  const worldOriginY = maxHeight + structure.groundOffset
  const bounds: StructureBounds = {
    minX: worldOriginX,
    minY: worldOriginY,
    minZ: worldOriginZ,
    maxX: worldOriginX + structure.size.x,
    maxY: worldOriginY + structure.size.y,
    maxZ: worldOriginZ + structure.size.z,
  }
  if (bounds.minY < 1 || bounds.maxY > WORLD_HEIGHT) {
    return null
  }

  return {
    placementId: `${structure.name}:${sourceChunk.x}:${sourceChunk.z}`,
    structure,
    sourceChunk,
    worldOrigin: { x: worldOriginX, y: worldOriginY, z: worldOriginZ },
    anchorWorld: { x: anchorWorldX, y: maxHeight, z: anchorWorldZ },
    bounds,
  }
}

export const collectStructuresForChunk = (
  seed: string,
  coordX: number,
  coordZ: number,
  sampleTerrain: (worldX: number, worldZ: number) => StructureTerrainSample,
  isSandyColumn: (worldX: number, worldZ: number, sample: StructureTerrainSample) => boolean,
): StructurePlacement[] => {
  const currentChunkBounds = getChunkBounds(coordX, coordZ)
  const candidates: StructurePlacement[] = []

  for (let sourceZ = coordZ - STRUCTURE_SEARCH_RADIUS_CHUNKS; sourceZ <= coordZ + STRUCTURE_SEARCH_RADIUS_CHUNKS; sourceZ += 1) {
    for (let sourceX = coordX - STRUCTURE_SEARCH_RADIUS_CHUNKS; sourceX <= coordX + STRUCTURE_SEARCH_RADIUS_CHUNKS; sourceX += 1) {
      for (const structure of getStructureTemplates()) {
        const placement = createStructurePlacement(
          seed,
          structure,
          { x: sourceX, z: sourceZ },
          sampleTerrain,
          isSandyColumn,
        )
        if (placement) {
          candidates.push(placement)
        }
      }
    }
  }

  candidates.sort((left, right) => {
    const priorityDelta =
      getStructureSpawnConfig(right.structure.name).priority - getStructureSpawnConfig(left.structure.name).priority
    if (priorityDelta !== 0) {
      return priorityDelta
    }
    return left.placementId.localeCompare(right.placementId)
  })

  const accepted: StructurePlacement[] = []
  for (const candidate of candidates) {
    if (accepted.some((existing) => intersectsBounds(candidate.bounds, existing.bounds))) {
      continue
    }
    accepted.push(candidate)
  }

  return accepted.filter((placement) =>
    intersectsXZ(placement.bounds, currentChunkBounds),
  )
}

const getReplaceableFoundationCodes = (blockCodes: Record<string, number>): Set<number> => {
  const codes = new Set<number>()
  for (const id of REPLACEABLE_FOUNDATION_BLOCKS) {
    const code = blockCodes[id]
    if (code) {
      codes.add(code)
    }
  }
  return codes
}

const setLocalBlock = (
  blocks: Uint16Array,
  localX: number,
  y: number,
  localZ: number,
  code: number,
): void => {
  if (localX < 0 || localX >= CHUNK_SIZE || localZ < 0 || localZ >= CHUNK_SIZE || y < 0 || y >= WORLD_HEIGHT) {
    return
  }
  blocks[getVoxelIndex(localX, y, localZ)] = code
}

const getLocalBlock = (
  blocks: Uint16Array,
  localX: number,
  y: number,
  localZ: number,
): number => {
  if (localX < 0 || localX >= CHUNK_SIZE || localZ < 0 || localZ >= CHUNK_SIZE || y < 0 || y >= WORLD_HEIGHT) {
    return 0
  }
  return blocks[getVoxelIndex(localX, y, localZ)]
}

export const applyStructuresToChunk = (
  blocks: Uint16Array,
  coordX: number,
  coordZ: number,
  placements: StructurePlacement[],
  blockCodes: Record<string, number>,
): PlacedStructureRecord[] => {
  const chunkOriginX = coordX * CHUNK_SIZE
  const chunkOriginZ = coordZ * CHUNK_SIZE
  const replaceableFoundationCodes = getReplaceableFoundationCodes(blockCodes)

  for (const placement of placements) {
    const intersectMinX = Math.max(chunkOriginX, placement.bounds.minX)
    const intersectMaxX = Math.min(chunkOriginX + CHUNK_SIZE, placement.bounds.maxX)
    const intersectMinZ = Math.max(chunkOriginZ, placement.bounds.minZ)
    const intersectMaxZ = Math.min(chunkOriginZ + CHUNK_SIZE, placement.bounds.maxZ)
    const clearFromY = Math.max(0, placement.worldOrigin.y + 1)
    const clearToY = Math.min(WORLD_HEIGHT - 1, placement.bounds.maxY - 1)

    for (let worldZ = intersectMinZ; worldZ < intersectMaxZ; worldZ += 1) {
      for (let worldX = intersectMinX; worldX < intersectMaxX; worldX += 1) {
        const localX = worldX - chunkOriginX
        const localZ = worldZ - chunkOriginZ
        for (let y = clearFromY; y <= clearToY; y += 1) {
          setLocalBlock(blocks, localX, y, localZ, 0)
        }
      }
    }

    for (const support of placement.structure.supportColumns) {
      const worldX = placement.worldOrigin.x + support.x
      const worldZ = placement.worldOrigin.z + support.z
      if (worldX < chunkOriginX || worldX >= chunkOriginX + CHUNK_SIZE || worldZ < chunkOriginZ || worldZ >= chunkOriginZ + CHUNK_SIZE) {
        continue
      }
      const supportCode = blockCodes[support.foundationBlockId]
      if (!supportCode) {
        continue
      }
      const localX = worldX - chunkOriginX
      const localZ = worldZ - chunkOriginZ
      for (let y = placement.worldOrigin.y + support.minY - 1; y >= 0; y -= 1) {
        const current = getLocalBlock(blocks, localX, y, localZ)
        if (current !== 0 && !replaceableFoundationCodes.has(current)) {
          break
        }
        setLocalBlock(blocks, localX, y, localZ, supportCode)
      }
    }

    for (const block of placement.structure.blocks) {
      const worldX = placement.worldOrigin.x + block.x
      const worldY = placement.worldOrigin.y + block.y
      const worldZ = placement.worldOrigin.z + block.z
      if (
        worldX < chunkOriginX ||
        worldX >= chunkOriginX + CHUNK_SIZE ||
        worldZ < chunkOriginZ ||
        worldZ >= chunkOriginZ + CHUNK_SIZE
      ) {
        continue
      }
      const code = blockCodes[block.blockId]
      if (!code) {
        continue
      }
      setLocalBlock(blocks, worldX - chunkOriginX, worldY, worldZ - chunkOriginZ, code)
    }
  }

  return placements.map((placement) => toRecord(placement))
}
