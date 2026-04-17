import { Mesh, VertexData } from '@babylonjs/core'
import type { Scene, StandardMaterial } from '@babylonjs/core'
import { CHUNK_SIZE, WORLD_HEIGHT } from '../config'
import type { BlockDefinition, ChunkData, ChunkMeshHandle, RegistryBundle } from '../types'
import { getVoxelIndex } from '../utils/chunk'

type GetBlockAt = (x: number, y: number, z: number) => number

interface ChunkMaterialSet {
  solid: (textureUrl: string) => StandardMaterial
  cutout: (textureUrl: string) => StandardMaterial
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

const isOpaqueCube = (block: BlockDefinition): boolean =>
  block.collidable && !block.fluid && !block.crossPlane && !block.transparent && !block.translucent

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
    startIndex + 1,
    startIndex + 2,
    startIndex,
    startIndex + 2,
    startIndex + 3,
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
            pushCrossPlane(getOrCreateLayerBuffer(buffers, layer, texture), x, y, z)
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
          pushTexturedFace(getOrCreateLayerBuffer(buffers, layer, texture), x, y, z, faceIndex)
        }
      }
    }
  }

  const solid = Array.from(buffers.solid.entries())
    .map(([texture, layerBuffers]) =>
      createMeshFromBuffers(
        scene,
        `chunk-solid-${sanitizeTextureKey(texture)}-${chunk.coord.x}-${chunk.coord.z}`,
        originX,
        originZ,
        materials.solid(texture),
        layerBuffers,
        0,
      ),
    )
    .filter((mesh): mesh is Mesh => Boolean(mesh))

  const cutout = Array.from(buffers.cutout.entries())
    .map(([texture, layerBuffers]) =>
      createMeshFromBuffers(
        scene,
        `chunk-cutout-${sanitizeTextureKey(texture)}-${chunk.coord.x}-${chunk.coord.z}`,
        originX,
        originZ,
        materials.cutout(texture),
        layerBuffers,
        1,
      ),
    )
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
