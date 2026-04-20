import type { BlockDefinition, BlockFacing } from '../types'

export interface LocalBlockBox {
  minX: number
  minY: number
  minZ: number
  maxX: number
  maxY: number
  maxZ: number
}

const FULL_BLOCK_BOX: LocalBlockBox = {
  minX: 0,
  minY: 0,
  minZ: 0,
  maxX: 1,
  maxY: 1,
  maxZ: 1,
}

const STAIR_TOP_BOXES: Record<BlockFacing, LocalBlockBox> = {
  north: {
    minX: 0,
    minY: 0.5,
    minZ: 0,
    maxX: 1,
    maxY: 1,
    maxZ: 0.5,
  },
  south: {
    minX: 0,
    minY: 0.5,
    minZ: 0.5,
    maxX: 1,
    maxY: 1,
    maxZ: 1,
  },
  east: {
    minX: 0.5,
    minY: 0.5,
    minZ: 0,
    maxX: 1,
    maxY: 1,
    maxZ: 1,
  },
  west: {
    minX: 0,
    minY: 0.5,
    minZ: 0,
    maxX: 0.5,
    maxY: 1,
    maxZ: 1,
  },
}

export const isOpaqueCube = (block: BlockDefinition): boolean =>
  block.collidable &&
  block.shape === 'cube' &&
  !block.fluid &&
  !block.crossPlane &&
  !block.transparent &&
  !block.translucent

export const getBlockLocalCollisionBoxes = (block: BlockDefinition): LocalBlockBox[] => {
  if (!block.collidable || block.fluid || block.crossPlane || block.shape === 'torch') {
    return []
  }
  if (block.shape === 'stairs') {
    return [
      {
        minX: 0,
        minY: 0,
        minZ: 0,
        maxX: 1,
        maxY: 0.5,
        maxZ: 1,
      },
      STAIR_TOP_BOXES[block.facing ?? 'south'],
    ]
  }
  return [FULL_BLOCK_BOX]
}

export const getHorizontalFacingFromYaw = (yaw: number): BlockFacing => {
  const sin = Math.sin(yaw)
  const cos = Math.cos(yaw)
  if (Math.abs(sin) > Math.abs(cos)) {
    return sin >= 0 ? 'east' : 'west'
  }
  return cos >= 0 ? 'south' : 'north'
}

export const resolveStairBlockId = (itemId: string, facing: BlockFacing): string | null => {
  if (itemId === 'wood_stairs' || itemId === 'cobblestone_stairs') {
    return `${itemId}_${facing}`
  }
  return null
}
