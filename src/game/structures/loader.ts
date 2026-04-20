import type { RawStructureAsset, StructureBlock, StructureColumnSupport, StructureTemplate } from './types'

const structureAssetImports = import.meta.glob('../../../assets/buildings/*.json', {
  eager: true,
  import: 'default',
}) as Record<string, RawStructureAsset>

const NON_SUPPORT_BLOCKS = new Set(['glass', 'leaves', 'flower', 'torch'])

const assertIntegerTuple = (
  value: unknown,
  label: string,
): [number, number, number] => {
  if (!Array.isArray(value) || value.length !== 3 || value.some((entry) => !Number.isInteger(entry))) {
    throw new Error(`Invalid ${label} in structure asset`)
  }
  return value as [number, number, number]
}

const buildSupportColumns = (blocks: StructureBlock[]): StructureColumnSupport[] => {
  const baseLayerY = blocks.reduce((lowest, block) => {
    if (NON_SUPPORT_BLOCKS.has(block.blockId)) {
      return lowest
    }
    return Math.min(lowest, block.y)
  }, Number.POSITIVE_INFINITY)
  if (!Number.isFinite(baseLayerY)) {
    return []
  }

  const columns = new Map<string, StructureBlock[]>()
  for (const block of blocks) {
    const key = `${block.x}:${block.z}`
    const existing = columns.get(key)
    if (existing) {
      existing.push(block)
    } else {
      columns.set(key, [block])
    }
  }

  return Array.from(columns.values())
    .flatMap((columnBlocks) => {
      const ordered = [...columnBlocks].sort((left, right) => left.y - right.y)
      const support = ordered.find(
        (block) => !NON_SUPPORT_BLOCKS.has(block.blockId) && block.y === baseLayerY,
      )
      return support
        ? [{
            x: support.x,
            z: support.z,
            minY: support.y,
            foundationBlockId: support.blockId,
          }]
        : []
    })
    .sort((left, right) => left.z - right.z || left.x - right.x || left.minY - right.minY)
}

const parseStructureAsset = (raw: RawStructureAsset): StructureTemplate => {
  if (!raw || typeof raw !== 'object') {
    throw new Error('Invalid structure asset payload')
  }
  if (typeof raw.name !== 'string' || !raw.name.trim()) {
    throw new Error('Structure asset is missing a valid name')
  }

  const [sizeX, sizeY, sizeZ] = assertIntegerTuple(raw.size, `size for ${raw.name}`)
  const [anchorX, anchorY, anchorZ] = assertIntegerTuple(raw.anchor, `anchor for ${raw.name}`)
  const paletteEntries = Array.isArray(raw.palette) ? raw.palette : []
  const blockEntries = Array.isArray(raw.blocks) ? raw.blocks : []
  if (paletteEntries.length === 0 || blockEntries.length === 0) {
    throw new Error(`Structure ${raw.name} must define a palette and at least one block`)
  }

  const palette = new Map<number, string>()
  for (const entry of paletteEntries) {
    if (!entry || typeof entry !== 'object' || !Number.isInteger(entry.id) || typeof entry.block !== 'string') {
      throw new Error(`Structure ${raw.name} has an invalid palette entry`)
    }
    palette.set(entry.id, entry.block)
  }

  const seenPositions = new Set<string>()
  const blocks: StructureBlock[] = blockEntries.map((entry) => {
    if (!entry || typeof entry !== 'object' || !Number.isInteger(entry.state)) {
      throw new Error(`Structure ${raw.name} has an invalid block entry`)
    }
    const [x, y, z] = assertIntegerTuple(entry.pos, `block position for ${raw.name}`)
    if (x < 0 || x >= sizeX || y < 0 || y >= sizeY || z < 0 || z >= sizeZ) {
      throw new Error(`Structure ${raw.name} has a block outside its declared size`)
    }
    const blockId = palette.get(entry.state)
    if (!blockId) {
      throw new Error(`Structure ${raw.name} references an unknown palette state ${entry.state}`)
    }
    const key = `${x}:${y}:${z}`
    if (seenPositions.has(key)) {
      throw new Error(`Structure ${raw.name} defines duplicate block position ${key}`)
    }
    seenPositions.add(key)
    return { x, y, z, blockId }
  })

  blocks.sort((left, right) => left.y - right.y || left.z - right.z || left.x - right.x)

  return {
    name: raw.name,
    size: { x: sizeX, y: sizeY, z: sizeZ },
    anchor: { x: anchorX, y: anchorY, z: anchorZ },
    groundOffset: Number.isFinite(raw.groundOffset) ? Number(raw.groundOffset) : 0,
    rarity: Number.isFinite(raw.rarity) ? Number(raw.rarity) : 0,
    blocks,
    supportColumns: buildSupportColumns(blocks),
  }
}

const loadedStructures = Object.values(structureAssetImports)
  .map((asset) => parseStructureAsset(asset))
  .sort((left, right) => left.name.localeCompare(right.name))

export const getStructureTemplates = (): StructureTemplate[] => loadedStructures
