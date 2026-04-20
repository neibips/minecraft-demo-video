import type { BiomeId, ChunkCoord, StructureBounds } from '../types'

export interface RawStructurePaletteEntry {
  id: number
  block: string
}

export interface RawStructureBlockEntry {
  pos: [number, number, number]
  state: number
}

export interface RawStructureAsset {
  name: string
  size: [number, number, number]
  palette: RawStructurePaletteEntry[]
  blocks: RawStructureBlockEntry[]
  anchor: [number, number, number]
  groundOffset?: number
  rarity?: number
}

export interface StructureBlock {
  x: number
  y: number
  z: number
  blockId: string
}

export interface StructureColumnSupport {
  x: number
  z: number
  minY: number
  foundationBlockId: string
}

export interface StructureTemplate {
  name: string
  size: { x: number; y: number; z: number }
  anchor: { x: number; y: number; z: number }
  groundOffset: number
  rarity: number
  blocks: StructureBlock[]
  supportColumns: StructureColumnSupport[]
}

export interface StructureTerrainSample {
  height: number
  biome: BiomeId
}

export interface StructurePlacement {
  placementId: string
  structure: StructureTemplate
  sourceChunk: ChunkCoord
  worldOrigin: { x: number; y: number; z: number }
  anchorWorld: { x: number; y: number; z: number }
  bounds: StructureBounds
}
