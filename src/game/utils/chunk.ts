import { CHUNK_SIZE, WORLD_HEIGHT } from '../config'
import type { ChunkCoord } from '../types'

export const getChunkCoord = (x: number, z: number): ChunkCoord => ({
  x: Math.floor(x / CHUNK_SIZE),
  z: Math.floor(z / CHUNK_SIZE),
})

export const getChunkKey = (x: number, z: number): string => `${x},${z}`

export const getChunkOrigin = (coord: ChunkCoord): { x: number; z: number } => ({
  x: coord.x * CHUNK_SIZE,
  z: coord.z * CHUNK_SIZE,
})

export const getLocalCoord = (value: number): number => {
  const floored = Math.floor(value)
  const local = floored % CHUNK_SIZE
  return local < 0 ? local + CHUNK_SIZE : local
}

export const getVoxelIndex = (x: number, y: number, z: number): number =>
  x + z * CHUNK_SIZE + y * CHUNK_SIZE * CHUNK_SIZE

export const getHeightIndex = (x: number, z: number): number => x + z * CHUNK_SIZE

export const isInsideChunk = (x: number, y: number, z: number): boolean =>
  x >= 0 && x < CHUNK_SIZE && z >= 0 && z < CHUNK_SIZE && y >= 0 && y < WORLD_HEIGHT

export const packBlockEntityKey = (x: number, y: number, z: number): string => `${x}:${y}:${z}`
