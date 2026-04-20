import { Mesh, VertexData } from '@babylonjs/core'
import type { Scene, StandardMaterial } from '@babylonjs/core'
import { CHUNK_SIZE, WORLD_HEIGHT } from '../config'
import type { BlockDefinition, ChunkData, ChunkMeshHandle, RegistryBundle } from '../types'
import { getVoxelIndex } from '../utils/chunk'
import { getBlockLocalCollisionBoxes, isOpaqueCube } from './blockShape'

type GetBlockAt = (x: number, y: number, z: number) => number

interface ChunkMaterialSet {
  solid: (textureUrl: string, emitsLight?: number) => StandardMaterial
  cutout: (textureUrl: string, emitsLight?: number) => StandardMaterial
  fluid: StandardMaterial
}

interface MeshBuffers {
  positions: number[]
  indices: number[]
  uvs: number[]
  normals: number[]
}

type MeshLayer = keyof ChunkMeshHandle
type Vertex = readonly [number, number, number]

const FLUID_SURFACE_HEIGHT = 0.88

const faceNormals = [
  { x: 1, y: 0, z: 0 },
  { x: -1, y: 0, z: 0 },
  { x: 0, y: 1, z: 0 },
  { x: 0, y: -1, z: 0 },
  { x: 0, y: 0, z: 1 },
  { x: 0, y: 0, z: -1 },
] as const

const faceVertices = [
  [
    [1, 0, 0],
    [1, 1, 0],
    [1, 1, 1],
    [1, 0, 1],
  ],
  [
    [0, 0, 1],
    [0, 1, 1],
    [0, 1, 0],
    [0, 0, 0],
  ],
  [
    [0, 1, 1],
    [1, 1, 1],
    [1, 1, 0],
    [0, 1, 0],
  ],
  [
    [0, 0, 0],
    [1, 0, 0],
    [1, 0, 1],
    [0, 0, 1],
  ],
  [
    [0, 0, 1],
    [1, 0, 1],
    [1, 1, 1],
    [0, 1, 1],
  ],
  [
    [1, 0, 0],
    [0, 0, 0],
    [0, 1, 0],
    [1, 1, 0],
  ],
] as const

const createBuffers = (): MeshBuffers => ({
  positions: [],
  indices: [],
  uvs: [],
  normals: [],
})

const getBlockFaceTexture = (block: BlockDefinition, faceIndex: number): string | undefined => {
  switch (faceIndex) {
    case 0:
      return (
        block.textures.right ??
        block.textures.side ??
        block.textures.all ??
        block.textures.front ??
        block.textures.back ??
        block.textures.top
      )
    case 1:
      return (
        block.textures.left ??
        block.textures.side ??
        block.textures.all ??
        block.textures.back ??
        block.textures.front ??
        block.textures.top
      )
    case 2:
      return block.textures.top ?? block.textures.all ?? block.textures.side ?? block.textures.front
    case 3:
      return block.textures.bottom ?? block.textures.all ?? block.textures.side ?? block.textures.front
    case 4:
      return (
        block.textures.front ??
        block.textures.side ??
        block.textures.all ??
        block.textures.right ??
        block.textures.left ??
        block.textures.top
      )
    case 5:
      return (
        block.textures.back ??
        block.textures.side ??
        block.textures.all ??
        block.textures.left ??
        block.textures.right ??
        block.textures.top
      )
    default:
      return block.textures.side ?? block.textures.all ?? block.textures.front ?? block.textures.top
  }
}

const shouldRenderFace = (current: BlockDefinition, neighbor: BlockDefinition | undefined): boolean => {
  if (!neighbor) {
    return true
  }
  if (current.fluid) {
    return !neighbor.fluid && !isOpaqueCube(neighbor)
  }
  if (neighbor.fluid || !neighbor.collidable || neighbor.crossPlane) {
    return true
  }
  return !isOpaqueCube(neighbor)
}

const pushQuad = (buffers: MeshBuffers, vertices: readonly Vertex[], uvRect: readonly number[]): void => {
  const startIndex = buffers.positions.length / 3
  for (const [vx, vy, vz] of vertices) {
    buffers.positions.push(vx, vy, vz)
  }

  buffers.indices.push(
    startIndex,
    startIndex + 2,
    startIndex + 1,
    startIndex,
    startIndex + 3,
    startIndex + 2,
  )

  buffers.uvs.push(...uvRect)
}

const getFaceUvRect = (faceIndex: number): readonly number[] =>
  faceIndex === 0 || faceIndex === 1
    ? [0, 1, 0, 0, 1, 0, 1, 1]
    : faceIndex === 3
      ? [0, 0, 1, 0, 1, 1, 0, 1]
      : [0, 1, 1, 1, 1, 0, 0, 0]

const pushTexturedFace = (
  buffers: MeshBuffers,
  x: number,
  y: number,
  z: number,
  faceIndex: number,
): void => {
  const vertices = faceVertices[faceIndex].map(([vx, vy, vz]) => [x + vx, y + vy, z + vz] as const)
  pushQuad(buffers, vertices, getFaceUvRect(faceIndex))
}

const getBoxFaceVertices = (
  minX: number,
  minY: number,
  minZ: number,
  maxX: number,
  maxY: number,
  maxZ: number,
  faceIndex: number,
): readonly Vertex[] => {
  switch (faceIndex) {
    case 0:
      return [
        [maxX, minY, minZ],
        [maxX, maxY, minZ],
        [maxX, maxY, maxZ],
        [maxX, minY, maxZ],
      ]
    case 1:
      return [
        [minX, minY, maxZ],
        [minX, maxY, maxZ],
        [minX, maxY, minZ],
        [minX, minY, minZ],
      ]
    case 2:
      return [
        [minX, maxY, maxZ],
        [maxX, maxY, maxZ],
        [maxX, maxY, minZ],
        [minX, maxY, minZ],
      ]
    case 3:
      return [
        [minX, minY, minZ],
        [maxX, minY, minZ],
        [maxX, minY, maxZ],
        [minX, minY, maxZ],
      ]
    case 4:
      return [
        [minX, minY, maxZ],
        [maxX, minY, maxZ],
        [maxX, maxY, maxZ],
        [minX, maxY, maxZ],
      ]
    case 5:
      return [
        [maxX, minY, minZ],
        [minX, minY, minZ],
        [minX, maxY, minZ],
        [maxX, maxY, minZ],
      ]
    default:
      return []
  }
}

const pushTexturedBoxFace = (
  buffers: MeshBuffers,
  x: number,
  y: number,
  z: number,
  faceIndex: number,
  box: {
    minX: number
    minY: number
    minZ: number
    maxX: number
    maxY: number
    maxZ: number
  },
): void => {
  const vertices = getBoxFaceVertices(
    x + box.minX,
    y + box.minY,
    z + box.minZ,
    x + box.maxX,
    y + box.maxY,
    z + box.maxZ,
    faceIndex,
  )
  pushQuad(buffers, vertices, getFaceUvRect(faceIndex))
}

const pushCrossPlane = (buffers: MeshBuffers, x: number, y: number, z: number): void => {
  const uvRect = [0, 1, 1, 1, 1, 0, 0, 0] as const
  const quads = [
    [
      [x + 0.15, y, z + 0.15],
      [x + 0.85, y, z + 0.85],
      [x + 0.85, y + 1, z + 0.85],
      [x + 0.15, y + 1, z + 0.15],
    ],
    [
      [x + 0.85, y, z + 0.15],
      [x + 0.15, y, z + 0.85],
      [x + 0.15, y + 1, z + 0.85],
      [x + 0.85, y + 1, z + 0.15],
    ],
  ] as const

  for (const quad of quads) {
    pushQuad(buffers, quad, uvRect)
  }
}

const pushTorch = (
  buffers: MeshBuffers,
  x: number,
  y: number,
  z: number,
  mount: 'floor' | 'west' | 'east' | 'north' | 'south',
): void => {
  const uvRect = [0, 1, 1, 1, 1, 0, 0, 0] as const
  const inset = 0.18
  const centerX = mount === 'west' ? x + 0.28 : mount === 'east' ? x + 0.72 : x + 0.5
  const centerZ = mount === 'north' ? z + 0.28 : mount === 'south' ? z + 0.72 : z + 0.5
  const minY = mount === 'floor' ? y : y + 0.18
  const maxY = mount === 'floor' ? y + 0.625 : y + 0.82
  const quads = [
    [
      [centerX - inset, minY, centerZ - inset],
      [centerX + inset, minY, centerZ + inset],
      [centerX + inset, maxY, centerZ + inset],
      [centerX - inset, maxY, centerZ - inset],
    ],
    [
      [centerX + inset, minY, centerZ - inset],
      [centerX - inset, minY, centerZ + inset],
      [centerX - inset, maxY, centerZ + inset],
      [centerX + inset, maxY, centerZ - inset],
    ],
  ] as const

  for (const quad of quads) {
    pushQuad(buffers, quad, uvRect)
  }
}

const getFluidFaceVertices = (
  x: number,
  y: number,
  z: number,
  faceIndex: number,
  topHeight: number,
): readonly Vertex[] =>
  faceVertices[faceIndex].map(([vx, vy, vz]) => [
    x + vx,
    y + (vy === 1 ? topHeight : vy),
    z + vz,
  ] as const)

const createMeshFromBuffers = (
  scene: Scene,
  name: string,
  originX: number,
  originZ: number,
  material: StandardMaterial,
  buffers: MeshBuffers,
  renderingGroupId: number,
): Mesh | null => {
  if (buffers.positions.length === 0) {
    return null
  }

  VertexData.ComputeNormals(buffers.positions, buffers.indices, buffers.normals)
  const mesh = new Mesh(name, scene)
  const vertexData = new VertexData()
  vertexData.positions = buffers.positions
  vertexData.indices = buffers.indices
  vertexData.uvs = buffers.uvs
  vertexData.normals = buffers.normals
  vertexData.applyToMesh(mesh)
  mesh.position.set(originX, 0, originZ)
  mesh.material = material
  mesh.renderingGroupId = renderingGroupId
  mesh.freezeWorldMatrix()
  mesh.isPickable = false
  return mesh
}

const getMeshLayer = (block: BlockDefinition): MeshLayer => {
  if (block.fluid) {
    return 'fluid'
  }
  if (block.transparent || block.translucent || block.crossPlane) {
    return 'cutout'
  }
  return 'solid'
}

const getBufferMap = (): Record<MeshLayer, Map<string, MeshBuffers>> => ({
  solid: new Map<string, MeshBuffers>(),
  cutout: new Map<string, MeshBuffers>(),
  fluid: new Map<string, MeshBuffers>(),
})

const getNeighborForBoxFace = (
  block: BlockDefinition,
  box: {
    minX: number
    minY: number
    minZ: number
    maxX: number
    maxY: number
    maxZ: number
  },
  faceIndex: number,
  getBlockAt: GetBlockAt,
  registries: RegistryBundle,
  worldX: number,
  y: number,
  worldZ: number,
): BlockDefinition | undefined => {
  const normal = faceNormals[faceIndex]
  const touchesBoundary =
    (faceIndex === 0 && box.maxX === 1) ||
    (faceIndex === 1 && box.minX === 0) ||
    (faceIndex === 2 && box.maxY === 1) ||
    (faceIndex === 3 && box.minY === 0) ||
    (faceIndex === 4 && box.maxZ === 1) ||
    (faceIndex === 5 && box.minZ === 0)

  if (!touchesBoundary) {
    return undefined
  }

  const neighborCode = getBlockAt(worldX + normal.x, y + normal.y, worldZ + normal.z)
  return neighborCode ? registries.blocksByCode.get(neighborCode) : undefined
}

const getTorchMount = (
  getBlockAt: GetBlockAt,
  registries: RegistryBundle,
  worldX: number,
  y: number,
  worldZ: number,
): 'floor' | 'west' | 'east' | 'north' | 'south' => {
  const west = getBlockAt(worldX - 1, y, worldZ)
  const westBlock = west ? registries.blocksByCode.get(west) : undefined
  if (westBlock && isOpaqueCube(westBlock)) {
    return 'west'
  }
  const east = getBlockAt(worldX + 1, y, worldZ)
  const eastBlock = east ? registries.blocksByCode.get(east) : undefined
  if (eastBlock && isOpaqueCube(eastBlock)) {
    return 'east'
  }
  const north = getBlockAt(worldX, y, worldZ - 1)
  const northBlock = north ? registries.blocksByCode.get(north) : undefined
  if (northBlock && isOpaqueCube(northBlock)) {
    return 'north'
  }
  const south = getBlockAt(worldX, y, worldZ + 1)
  const southBlock = south ? registries.blocksByCode.get(south) : undefined
  if (southBlock && isOpaqueCube(southBlock)) {
    return 'south'
  }
  return 'floor'
}

const encodeMaterialKey = (texture: string, emitsLight: number): string => `${emitsLight}::${texture}`

const decodeMaterialKey = (value: string): { texture: string; emitsLight: number } => {
  const separatorIndex = value.indexOf('::')
  if (separatorIndex === -1) {
    return { texture: value, emitsLight: 0 }
  }
  return {
    emitsLight: Number(value.slice(0, separatorIndex)) || 0,
    texture: value.slice(separatorIndex + 2),
  }
}

const getOrCreateLayerBuffer = (
  bufferMap: Record<MeshLayer, Map<string, MeshBuffers>>,
  layer: MeshLayer,
  key: string,
): MeshBuffers => {
  const existing = bufferMap[layer].get(key)
  if (existing) {
    return existing
  }
  const created = createBuffers()
  bufferMap[layer].set(key, created)
  return created
}

const sanitizeTextureKey = (value: string): string => value.replace(/[^a-z0-9]+/gi, '-')

export const buildChunkMesh = (
  scene: Scene,
  chunk: ChunkData,
  registries: RegistryBundle,
  materials: ChunkMaterialSet,
  getBlockAt: GetBlockAt,
): ChunkMeshHandle => {
  const buffers = getBufferMap()

  const originX = chunk.coord.x * CHUNK_SIZE
  const originZ = chunk.coord.z * CHUNK_SIZE

  for (let y = 0; y < WORLD_HEIGHT; y += 1) {
    for (let z = 0; z < CHUNK_SIZE; z += 1) {
      for (let x = 0; x < CHUNK_SIZE; x += 1) {
        const blockCode = chunk.blocks[getVoxelIndex(x, y, z)]
        if (!blockCode) {
          continue
        }
        const block = registries.blocksByCode.get(blockCode)
        if (!block) {
          continue
        }

        const topNeighborCode = getBlockAt(originX + x, y + 1, originZ + z)
        const topNeighbor = topNeighborCode ? registries.blocksByCode.get(topNeighborCode) : undefined
        const textureBlock =
          block.id === 'ground' && topNeighbor && isOpaqueCube(topNeighbor)
            ? registries.blocks.get('dirt') ?? block
            : block
        const layer = getMeshLayer(block)

        if (block.crossPlane) {
          const texture = getBlockFaceTexture(textureBlock, 4)
          if (texture) {
            pushCrossPlane(
              getOrCreateLayerBuffer(buffers, layer, encodeMaterialKey(texture, textureBlock.emitsLight)),
              x,
              y,
              z,
            )
          }
          continue
        }

        if (block.shape === 'torch') {
          const texture = getBlockFaceTexture(textureBlock, 4)
          if (texture) {
            pushTorch(
              getOrCreateLayerBuffer(buffers, layer, encodeMaterialKey(texture, textureBlock.emitsLight)),
              x,
              y,
              z,
              getTorchMount(getBlockAt, registries, originX + x, y, originZ + z),
            )
          }
          continue
        }

        if (block.shape === 'stairs') {
          const boxBuffers = buffers
          for (const box of getBlockLocalCollisionBoxes(block)) {
            for (let faceIndex = 0; faceIndex < faceNormals.length; faceIndex += 1) {
              const neighbor = getNeighborForBoxFace(
                block,
                box,
                faceIndex,
                getBlockAt,
                registries,
                originX + x,
                y,
                originZ + z,
              )
              if (!shouldRenderFace(block, neighbor)) {
                continue
              }
              const texture = getBlockFaceTexture(textureBlock, faceIndex)
              if (!texture) {
                continue
              }
              pushTexturedBoxFace(
                getOrCreateLayerBuffer(boxBuffers, layer, encodeMaterialKey(texture, textureBlock.emitsLight)),
                x,
                y,
                z,
                faceIndex,
                box,
              )
            }
          }
          continue
        }

        const fluidTopHeight = block.fluid && !topNeighbor?.fluid ? ((block.fluidLevel ?? 8) / 8) * FLUID_SURFACE_HEIGHT : 1

        for (let faceIndex = 0; faceIndex < faceNormals.length; faceIndex += 1) {
          const normal = faceNormals[faceIndex]
          const neighborCode = getBlockAt(originX + x + normal.x, y + normal.y, originZ + z + normal.z)
          const neighbor = neighborCode ? registries.blocksByCode.get(neighborCode) : undefined
          if (!shouldRenderFace(block, neighbor)) {
            continue
          }

          if (block.fluid) {
            pushQuad(
              getOrCreateLayerBuffer(buffers, layer, 'fluid'),
              getFluidFaceVertices(x, y, z, faceIndex, fluidTopHeight),
              getFaceUvRect(faceIndex),
            )
            continue
          }

          const texture = getBlockFaceTexture(textureBlock, faceIndex)
          if (!texture) {
            continue
          }
          pushTexturedFace(
            getOrCreateLayerBuffer(buffers, layer, encodeMaterialKey(texture, textureBlock.emitsLight)),
            x,
            y,
            z,
            faceIndex,
          )
        }
      }
    }
  }

  const solid = Array.from(buffers.solid.entries())
    .map(([materialKey, layerBuffers]) => {
      const { texture, emitsLight } = decodeMaterialKey(materialKey)
      return createMeshFromBuffers(
        scene,
        `chunk-solid-${sanitizeTextureKey(texture)}-${chunk.coord.x}-${chunk.coord.z}`,
        originX,
        originZ,
        materials.solid(texture, emitsLight),
        layerBuffers,
        0,
      )
    })
    .filter((mesh): mesh is Mesh => Boolean(mesh))

  const cutout = Array.from(buffers.cutout.entries())
    .map(([materialKey, layerBuffers]) => {
      const { texture, emitsLight } = decodeMaterialKey(materialKey)
      return createMeshFromBuffers(
        scene,
        `chunk-cutout-${sanitizeTextureKey(texture)}-${chunk.coord.x}-${chunk.coord.z}`,
        originX,
        originZ,
        materials.cutout(texture, emitsLight),
        layerBuffers,
        1,
      )
    })
    .filter((mesh): mesh is Mesh => Boolean(mesh))

  const fluid = Array.from(buffers.fluid.values())
    .map((layerBuffers, index) =>
      createMeshFromBuffers(
        scene,
        `chunk-fluid-${index}-${chunk.coord.x}-${chunk.coord.z}`,
        originX,
        originZ,
        materials.fluid,
        layerBuffers,
        2,
      ),
    )
    .filter((mesh): mesh is Mesh => Boolean(mesh))

  return { solid, cutout, fluid }
}
