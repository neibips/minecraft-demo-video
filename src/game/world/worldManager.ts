import {
  Color3,
  Material,
  MeshBuilder,
  StandardMaterial,
  Texture,
  Vector3,
} from '@babylonjs/core'
import type { Scene } from '@babylonjs/core'
import { CHUNK_SIZE, DEFAULT_RENDER_DISTANCE, INTERACTION_RANGE, WORLD_HEIGHT } from '../config'
import type {
  AtlasRegion,
  BlockEntitySave,
  ChunkCoord,
  ChunkData,
  ChunkMeshHandle,
  ChunkWorkerResponse,
  RegistryBundle,
  SurfaceSpawnHint,
} from '../types'
import { WorldDatabase } from '../storage/database'
import { getChunkCoord, getChunkKey, getHeightIndex, getLocalCoord, getVoxelIndex, packBlockEntityKey } from '../utils/chunk'
import { buildChunkMesh } from './mesher'
import type { WorldWorkerResponse } from './protocol'
import { LightingManager } from '../render/lighting'

interface LoadedChunk {
  data: ChunkData
  meshes: ChunkMeshHandle
}

type SpawnCallback = (chunkKey: string, spawns: SurfaceSpawnHint[]) => void

export interface RaycastHit {
  blockPosition: { x: number; y: number; z: number }
  adjacentPosition: { x: number; y: number; z: number }
  blockCode: number
}

export class WorldManager {
  private readonly scene: Scene
  private readonly registries: RegistryBundle
  private readonly database: WorldDatabase
  private readonly lighting: LightingManager
  private readonly worker = new Worker(new URL('../workers/world.worker.ts', import.meta.url), {
    type: 'module',
  })
  private readonly chunks = new Map<string, LoadedChunk>()
  private readonly pendingChunkResolvers = new Map<string, (response: ChunkWorkerResponse) => void>()
  private readonly seenSpawnKeys = new Set<string>()
  private readonly solidMaterials = new Map<string, StandardMaterial>()
  private readonly cutoutMaterials = new Map<string, StandardMaterial>()
  private readonly waterMaterial: StandardMaterial
  private readonly outlineBlock
  private spawnCallback: SpawnCallback | null = null
  private renderDistance = DEFAULT_RENDER_DISTANCE
  private currentSeed = ''
  private fluidUpdateQueue = new Set<string>()

  constructor(
    scene: Scene,
    registries: RegistryBundle,
    database: WorldDatabase,
    atlasImageUrl: string,
    lighting: LightingManager,
  ) {
    this.scene = scene
    this.registries = registries
    this.database = database
    this.lighting = lighting

    this.waterMaterial = this.createWaterMaterial()

    this.outlineBlock = MeshBuilder.CreateBox('selection-outline', { size: 1.01 }, this.scene)
    const outlineMaterial = new StandardMaterial('outline-material', scene)
    outlineMaterial.emissiveColor = new Color3(0.98, 0.98, 0.98)
    outlineMaterial.alpha = 0.12
    this.outlineBlock.material = outlineMaterial
    this.outlineBlock.renderingGroupId = 3
    this.outlineBlock.isVisible = false
    this.outlineBlock.isPickable = false

    this.worker.onmessage = (event: MessageEvent<WorldWorkerResponse>) => {
      const message = event.data
      if (message.type !== 'chunk-generated') {
        return
      }
      const key = getChunkKey(message.payload.coord.x, message.payload.coord.z)
      const resolver = this.pendingChunkResolvers.get(key)
      if (resolver) {
        this.pendingChunkResolvers.delete(key)
        resolver(message.payload)
      }
    }
  }

  private createBlockMaterial(name: string, textureUrl: string, useAlpha: boolean): StandardMaterial {
    const material = new StandardMaterial(name, this.scene)
    const texture = new Texture(textureUrl, this.scene, true, false, Texture.NEAREST_SAMPLINGMODE)
    texture.hasAlpha = useAlpha
    texture.updateSamplingMode(Texture.NEAREST_SAMPLINGMODE)
    texture.wrapU = Texture.CLAMP_ADDRESSMODE
    texture.wrapV = Texture.CLAMP_ADDRESSMODE
    material.diffuseTexture = texture
    material.diffuseColor = Color3.White()
    material.emissiveColor = Color3.Black()
    material.ambientColor = Color3.White()
    material.specularColor = Color3.Black()
    material.backFaceCulling = false

    if (useAlpha) {
      material.useAlphaFromDiffuseTexture = true
      material.alphaCutOff = 0.5
      material.transparencyMode = Material.MATERIAL_ALPHATEST
    }

    return material
  }

  private createWaterMaterial(): StandardMaterial {
    const material = new StandardMaterial('chunk-water-material', this.scene)
    const waterTextureUrl = this.registries.blocks.get('water')?.textures.all
    if (waterTextureUrl) {
      const texture = new Texture(waterTextureUrl, this.scene, true, false, Texture.NEAREST_SAMPLINGMODE)
      texture.hasAlpha = true
      texture.updateSamplingMode(Texture.NEAREST_SAMPLINGMODE)
      texture.wrapU = Texture.CLAMP_ADDRESSMODE
      texture.wrapV = Texture.CLAMP_ADDRESSMODE
      // water_still.png is a 16x512 (32-frame) vertical animation — sample only the first frame.
      texture.vScale = 1 / 32
      texture.vOffset = 0
      texture.level = 1
      material.diffuseTexture = texture
      material.diffuseColor = new Color3(0.55, 0.82, 0.98)
    } else {
      material.diffuseColor = new Color3(0.44, 0.67, 0.9)
    }
    material.emissiveColor = new Color3(0.02, 0.05, 0.08)
    material.ambientColor = Color3.White()
    material.specularColor = new Color3(0.25, 0.3, 0.36)
    material.alpha = 0.78
    material.backFaceCulling = false
    material.separateCullingPass = true
    material.transparencyMode = Material.MATERIAL_ALPHABLEND
    material.needDepthPrePass = true
    return material
  }

  private getOrCreateSolidMaterial(textureUrl: string): StandardMaterial {
    const existing = this.solidMaterials.get(textureUrl)
    if (existing) {
      return existing
    }

    const material = this.createBlockMaterial(
      `chunk-solid-material-${this.solidMaterials.size}`,
      textureUrl,
      false,
    )
    this.solidMaterials.set(textureUrl, material)
    return material
  }

  private getOrCreateCutoutMaterial(textureUrl: string): StandardMaterial {
    const existing = this.cutoutMaterials.get(textureUrl)
    if (existing) {
      return existing
    }

    const material = this.createBlockMaterial(
      `chunk-cutout-material-${this.cutoutMaterials.size}`,
      textureUrl,
      true,
    )
    this.cutoutMaterials.set(textureUrl, material)
    return material
  }

  private getChunkMaterials() {
    return {
      solid: (textureUrl: string) => this.getOrCreateSolidMaterial(textureUrl),
      cutout: (textureUrl: string) => this.getOrCreateCutoutMaterial(textureUrl),
      fluid: this.waterMaterial,
    }
  }

  private disposeChunkMeshes(meshes: ChunkMeshHandle): void {
    for (const mesh of meshes.solid) {
      this.lighting.removeShadowCaster(mesh)
      mesh.dispose()
    }
    for (const mesh of meshes.cutout) {
      this.lighting.removeShadowCaster(mesh)
      mesh.dispose()
    }
    for (const mesh of meshes.fluid) {
      mesh.dispose()
    }
  }

  private buildChunkMeshes(data: ChunkData): ChunkMeshHandle {
    const handle = buildChunkMesh(
      this.scene,
      data,
      this.registries,
      this.getChunkMaterials(),
      (worldX, y, worldZ) => this.getBlock(worldX, y, worldZ, data),
    )
    for (const mesh of handle.solid) {
      mesh.receiveShadows = true
      this.lighting.addShadowCaster(mesh)
    }
    for (const mesh of handle.cutout) {
      mesh.receiveShadows = true
      this.lighting.addShadowCaster(mesh)
    }
    return handle
  }

  async initialize(seed: string, renderDistance: number, onSpawns: SpawnCallback): Promise<void> {
    this.currentSeed = seed
    this.renderDistance = renderDistance
    this.spawnCallback = onSpawns
    this.worker.postMessage({
      type: 'init',
      payload: {
        seed,
        blockCodes: this.registries.blockCodes,
      },
    })
  }

  setRenderDistance(value: number): void {
    this.renderDistance = value
  }

  dispose(): void {
    for (const chunk of this.chunks.values()) {
      this.disposeChunkMeshes(chunk.meshes)
    }
    this.chunks.clear()
    this.worker.terminate()
    for (const material of this.solidMaterials.values()) {
      material.dispose()
    }
    for (const material of this.cutoutMaterials.values()) {
      material.dispose()
    }
    this.solidMaterials.clear()
    this.cutoutMaterials.clear()
    this.waterMaterial.dispose()
    this.outlineBlock.dispose()
  }

  private requestGeneratedChunk(coord: ChunkCoord): Promise<ChunkWorkerResponse> {
    const key = getChunkKey(coord.x, coord.z)
    return new Promise<ChunkWorkerResponse>((resolve) => {
      this.pendingChunkResolvers.set(key, resolve)
      this.worker.postMessage({
        type: 'generate-chunk',
        payload: { coord },
      })
    })
  }

  private async createChunkFromRecord(coord: ChunkCoord): Promise<ChunkData> {
    const key = getChunkKey(coord.x, coord.z)
    const saved = await this.database.loadChunk(key)
    if (saved) {
      return {
        coord,
        blocks: Uint16Array.from(saved.blocks),
        heights: Uint8Array.from(saved.heights),
        biomes: saved.biomes,
        dirty: false,
        blockEntities: saved.blockEntities ?? {},
      }
    }

    const generated = await this.requestGeneratedChunk(coord)
    if (this.spawnCallback && !this.seenSpawnKeys.has(key)) {
      this.seenSpawnKeys.add(key)
      this.spawnCallback(key, generated.spawns)
    }
    return {
      coord,
      blocks: generated.blocks,
      heights: generated.heights,
      biomes: generated.biomes,
      dirty: false,
      blockEntities: {},
    }
  }

  async ensureChunkLoaded(coord: ChunkCoord): Promise<ChunkData> {
    const key = getChunkKey(coord.x, coord.z)
    const existing = this.chunks.get(key)
    if (existing) {
      return existing.data
    }

    const data = await this.createChunkFromRecord(coord)
    const meshes = this.buildChunkMeshes(data)
    this.chunks.set(key, { data, meshes })
    this.rebuildAdjacentLoadedChunks(coord)
    return data
  }

  attachAtlasRegions(_regions: Record<string, AtlasRegion>): void {
    // Chunk meshes now use direct block textures instead of atlas UV regions.
  }

  private rebuildAdjacentLoadedChunks(coord: ChunkCoord): void {
    const neighbors = [
      { x: coord.x - 1, z: coord.z },
      { x: coord.x + 1, z: coord.z },
      { x: coord.x, z: coord.z - 1 },
      { x: coord.x, z: coord.z + 1 },
    ]

    for (const neighbor of neighbors) {
      this.rebuildChunk(neighbor)
    }
  }

  async preloadSpawnArea(centerX = 0, centerZ = 0): Promise<number> {
    const coord = getChunkCoord(centerX, centerZ)
    const chunk = await this.ensureChunkLoaded(coord)
    const localX = getLocalCoord(centerX)
    const localZ = getLocalCoord(centerZ)
    return chunk.heights[getHeightIndex(localX, localZ)] + 2
  }

  async updateAroundPlayer(position: Vector3): Promise<void> {
    const playerChunk = getChunkCoord(position.x, position.z)
    const requiredKeys = new Set<string>()

    const loads: Promise<ChunkData>[] = []
    for (let dz = -this.renderDistance; dz <= this.renderDistance; dz += 1) {
      for (let dx = -this.renderDistance; dx <= this.renderDistance; dx += 1) {
        const coord = { x: playerChunk.x + dx, z: playerChunk.z + dz }
        const key = getChunkKey(coord.x, coord.z)
        requiredKeys.add(key)
        if (!this.chunks.has(key)) {
          loads.push(this.ensureChunkLoaded(coord))
        }
      }
    }

    await Promise.all(loads)

    for (const [key, chunk] of this.chunks.entries()) {
      const distanceX = Math.abs(chunk.data.coord.x - playerChunk.x)
      const distanceZ = Math.abs(chunk.data.coord.z - playerChunk.z)
      if (distanceX > this.renderDistance + 2 || distanceZ > this.renderDistance + 2) {
        this.disposeChunkMeshes(chunk.meshes)
        this.chunks.delete(key)
      }
    }
  }

  private rebuildChunk(coord: ChunkCoord): void {
    const key = getChunkKey(coord.x, coord.z)
    const loaded = this.chunks.get(key)
    if (!loaded) {
      return
    }
    this.disposeChunkMeshes(loaded.meshes)
    loaded.meshes = this.buildChunkMeshes(loaded.data)
  }

  private scheduleNeighborRebuilds(worldX: number, worldZ: number): void {
    const base = getChunkCoord(worldX, worldZ)
    const affected = new Set<string>([getChunkKey(base.x, base.z)])
    const localX = getLocalCoord(worldX)
    const localZ = getLocalCoord(worldZ)
    if (localX === 0) {
      affected.add(getChunkKey(base.x - 1, base.z))
    }
    if (localX === CHUNK_SIZE - 1) {
      affected.add(getChunkKey(base.x + 1, base.z))
    }
    if (localZ === 0) {
      affected.add(getChunkKey(base.x, base.z - 1))
    }
    if (localZ === CHUNK_SIZE - 1) {
      affected.add(getChunkKey(base.x, base.z + 1))
    }
    for (const key of affected) {
      const [x, z] = key.split(',').map(Number)
      this.rebuildChunk({ x, z })
    }
  }

  getBlock(worldX: number, y: number, worldZ: number, fallbackChunk?: ChunkData): number {
    if (y < 0) {
      return this.registries.blockCodes.stone ?? 0
    }
    if (y >= WORLD_HEIGHT) {
      return 0
    }
    const coord = getChunkCoord(worldX, worldZ)
    const key = getChunkKey(coord.x, coord.z)
    const localX = getLocalCoord(worldX)
    const localZ = getLocalCoord(worldZ)
    const chunk =
      fallbackChunk && fallbackChunk.coord.x === coord.x && fallbackChunk.coord.z === coord.z
        ? fallbackChunk
        : this.chunks.get(key)?.data
    if (!chunk) {
      return 0
    }
    return chunk.blocks[getVoxelIndex(localX, y, localZ)]
  }

  getBlockDefinition(worldX: number, y: number, worldZ: number) {
    const code = this.getBlock(worldX, y, worldZ)
    return code ? this.registries.blocksByCode.get(code) : undefined
  }

  queueFluidUpdate(worldX: number, y: number, worldZ: number): void {
    const key = `${worldX}:${y}:${worldZ}`
    this.fluidUpdateQueue.add(key)
  }

  async setBlock(worldX: number, y: number, worldZ: number, blockCode: number): Promise<boolean> {
    const coord = getChunkCoord(worldX, worldZ)
    const chunk = await this.ensureChunkLoaded(coord)
    const localX = getLocalCoord(worldX)
    const localZ = getLocalCoord(worldZ)
    const index = getVoxelIndex(localX, y, localZ)
    if (chunk.blocks[index] === blockCode) {
      return false
    }
    chunk.blocks[index] = blockCode
    chunk.dirty = true
    if (blockCode === 0) {
      delete chunk.blockEntities[packBlockEntityKey(localX, y, localZ)]
    }
    this.scheduleNeighborRebuilds(worldX, worldZ)
    
    // Queue fluid updates for this block and neighbors
    this.queueFluidUpdate(worldX, y, worldZ)
    const dirs = [
      [1, 0, 0], [-1, 0, 0],
      [0, 1, 0], [0, -1, 0],
      [0, 0, 1], [0, 0, -1]
    ]
    for (const [dx, dy, dz] of dirs) {
      this.queueFluidUpdate(worldX + dx, y + dy, worldZ + dz)
    }

    await this.saveChunk(coord)
    return true
  }

  getBlockEntity(worldX: number, y: number, worldZ: number): BlockEntitySave | null {
    const coord = getChunkCoord(worldX, worldZ)
    const key = getChunkKey(coord.x, coord.z)
    const chunk = this.chunks.get(key)?.data
    if (!chunk) {
      return null
    }
    return chunk.blockEntities[packBlockEntityKey(getLocalCoord(worldX), y, getLocalCoord(worldZ))] ?? null
  }

  async setBlockEntity(worldX: number, y: number, worldZ: number, entity: BlockEntitySave | null): Promise<void> {
    const coord = getChunkCoord(worldX, worldZ)
    const chunk = await this.ensureChunkLoaded(coord)
    const entityKey = packBlockEntityKey(getLocalCoord(worldX), y, getLocalCoord(worldZ))
    if (entity) {
      chunk.blockEntities[entityKey] = entity
    } else {
      delete chunk.blockEntities[entityKey]
    }
    chunk.dirty = true
    await this.saveChunk(coord)
  }

  async saveChunk(coord: ChunkCoord): Promise<void> {
    const key = getChunkKey(coord.x, coord.z)
    const loaded = this.chunks.get(key)
    if (!loaded) {
      return
    }
    const record = this.database.serializeChunk(
      coord,
      key,
      loaded.data.blocks,
      loaded.data.heights,
      loaded.data.biomes,
      loaded.data.blockEntities,
    )
    await this.database.saveChunk(record)
    loaded.data.dirty = false
  }

  async saveDirtyChunks(): Promise<void> {
    const saves: Promise<void>[] = []
    for (const [key, chunk] of this.chunks.entries()) {
      if (!chunk.data.dirty) {
        continue
      }
      const [x, z] = key.split(',').map(Number)
      saves.push(this.saveChunk({ x, z }))
    }
    await Promise.all(saves)
  }

  forEachBlockEntity(
    visitor: (worldX: number, y: number, worldZ: number, entity: BlockEntitySave) => void,
  ): void {
    for (const chunk of this.chunks.values()) {
      for (const [key, entity] of Object.entries(chunk.data.blockEntities)) {
        const [x, y, z] = key.split(':').map(Number)
        visitor(
          chunk.data.coord.x * CHUNK_SIZE + x,
          y,
          chunk.data.coord.z * CHUNK_SIZE + z,
          entity,
        )
      }
    }
  }

  getSurfaceHeight(worldX: number, worldZ: number): number {
    const coord = getChunkCoord(worldX, worldZ)
    const key = getChunkKey(coord.x, coord.z)
    const chunk = this.chunks.get(key)?.data
    if (!chunk) {
      return 0
    }
    return chunk.heights[getHeightIndex(getLocalCoord(worldX), getLocalCoord(worldZ))]
  }

  raycast(origin: Vector3, direction: Vector3, maxDistance = INTERACTION_RANGE, ignoreFluids = true): RaycastHit | null {
    let x = Math.floor(origin.x)
    let y = Math.floor(origin.y)
    let z = Math.floor(origin.z)

    const stepX = Math.sign(direction.x) || 1
    const stepY = Math.sign(direction.y) || 1
    const stepZ = Math.sign(direction.z) || 1

    const tDeltaX = direction.x === 0 ? Number.POSITIVE_INFINITY : Math.abs(1 / direction.x)
    const tDeltaY = direction.y === 0 ? Number.POSITIVE_INFINITY : Math.abs(1 / direction.y)
    const tDeltaZ = direction.z === 0 ? Number.POSITIVE_INFINITY : Math.abs(1 / direction.z)

    const intBound = (s: number, ds: number) => {
      if (ds < 0) {
        return intBound(-s, -ds)
      }
      return (1 - (s - Math.floor(s))) / ds
    }

    let tMaxX = direction.x === 0 ? Number.POSITIVE_INFINITY : intBound(origin.x, direction.x)
    let tMaxY = direction.y === 0 ? Number.POSITIVE_INFINITY : intBound(origin.y, direction.y)
    let tMaxZ = direction.z === 0 ? Number.POSITIVE_INFINITY : intBound(origin.z, direction.z)

    let previous = { x, y, z }

    for (;;) {
      const blockCode = this.getBlock(x, y, z)
      if (blockCode) {
        const blockDef = this.registries.blocksByCode.get(blockCode)
        if (!ignoreFluids || !blockDef?.fluid) {
          return {
            blockPosition: { x, y, z },
            adjacentPosition: previous,
            blockCode,
          }
        }
      }

      if (tMaxX < tMaxY) {
        if (tMaxX < tMaxZ) {
          previous = { x, y, z }
          x += stepX
          if (tMaxX > maxDistance) {
            break
          }
          tMaxX += tDeltaX
        } else {
          previous = { x, y, z }
          z += stepZ
          if (tMaxZ > maxDistance) {
            break
          }
          tMaxZ += tDeltaZ
        }
      } else if (tMaxY < tMaxZ) {
        previous = { x, y, z }
        y += stepY
        if (tMaxY > maxDistance) {
          break
        }
        tMaxY += tDeltaY
      } else {
        previous = { x, y, z }
        z += stepZ
        if (tMaxZ > maxDistance) {
          break
        }
        tMaxZ += tDeltaZ
      }
    }

    return null
  }

  setSelection(hit: RaycastHit | null): void {
    if (!hit) {
      this.outlineBlock.isVisible = false
      return
    }
    this.outlineBlock.position.set(
      hit.blockPosition.x + 0.5,
      hit.blockPosition.y + 0.5,
      hit.blockPosition.z + 0.5,
    )
    this.outlineBlock.isVisible = true
  }

  private calculateExpectedFluidLevel(x: number, y: number, z: number): string | null {
    const currentCode = this.getBlock(x, y, z)
    if (currentCode === undefined) return null // Out of bounds
    const currentDef = this.registries.blocksByCode.get(currentCode)
    
    if (currentDef && currentDef.solid) {
      return currentDef.id
    }
    if (currentDef?.id === 'water') {
      return 'water'
    }

    const aboveCode = this.getBlock(x, y + 1, z)
    const aboveDef = aboveCode ? this.registries.blocksByCode.get(aboveCode) : null
    const falling = aboveDef?.fluid

    let sourceNeighbors = 0
    let maxFlow = 0

    const neighbors = [
      { nx: x + 1, nz: z },
      { nx: x - 1, nz: z },
      { nx: x, nz: z + 1 },
      { nx: x, nz: z - 1 },
    ]

    for (const { nx, nz } of neighbors) {
      const nCode = this.getBlock(nx, y, nz)
      const nDef = nCode ? this.registries.blocksByCode.get(nCode) : null
      if (nDef?.fluid) {
        if (nDef.id === 'water') {
          sourceNeighbors++
        }
        const belowNCode = this.getBlock(nx, y - 1, nz)
        const belowNDef = belowNCode ? this.registries.blocksByCode.get(belowNCode) : null
        const canSpreadSideways = belowNDef?.solid || belowNDef?.id === 'water'
        
        if (canSpreadSideways) {
          maxFlow = Math.max(maxFlow, nDef.fluidLevel ?? 8)
        }
      }
    }

    const belowCode = this.getBlock(x, y - 1, z)
    const belowDef = belowCode ? this.registries.blocksByCode.get(belowCode) : null
    const canFormSource = sourceNeighbors >= 2 && (belowDef?.solid || belowDef?.id === 'water')

    if (canFormSource) return 'water'
    if (falling) return 'water_7'
    if (maxFlow > 1) return `water_${maxFlow - 1}`
    return 'air'
  }

  async tickFluids(maxUpdates = 50): Promise<void> {
    const updates = Array.from(this.fluidUpdateQueue).slice(0, maxUpdates)
    for (const key of updates) {
      this.fluidUpdateQueue.delete(key)
      const [x, y, z] = key.split(':').map(Number)
      
      const currentCode = this.getBlock(x, y, z)
      if (currentCode === undefined) continue

      const expectedId = this.calculateExpectedFluidLevel(x, y, z)
      if (expectedId === null) continue

      const expectedCode = expectedId === 'air' ? 0 : this.registries.blockCodes[expectedId]
      if (expectedCode === undefined) continue

      if (currentCode !== expectedCode) {
        await this.setBlock(x, y, z, expectedCode)
      }
    }
  }
}
