import {
  Engine,
  Scene,
  UniversalCamera,
  Vector3,
} from '@babylonjs/core'
import { buildBlockAtlas } from './render/atlas'
import { LightingManager } from './render/lighting'
import { buildRegistries } from './data/registry'
import { WorldDatabase } from './storage/database'
import { AudioManager } from './audio/audio'
import {
  AUTOSAVE_INTERVAL_MS,
  DAY_LENGTH_SECONDS,
  DEFAULT_ATMOSPHERE_VOLUME,
  DEFAULT_EFFECTS_VOLUME,
  DEFAULT_MOUSE_SENSITIVITY,
  DEFAULT_RENDER_DISTANCE,
  FUEL_BURN_TIMES,
  GAME_TITLE,
  HOTBAR_SIZE,
  INVENTORY_CRAFT_SIZE,
  INVENTORY_SIZE,
  MAX_HEALTH,
  PLAYER_WIDTH,
  WORLD_ID,
} from './config'
import type {
  ActiveCraftingStation,
  FurnaceBlockEntity,
  ItemDefinition,
  NullableInventorySlot,
  PlayerSave,
  SettingsSave,
  WorldMetadata,
} from './types'
import { GameUiController, type SlotSource, type UiRenderState } from './ui/ui'
import { addItemToCollection, addItemToSlot, cloneSlot, removeItemCount, splitStack } from './inventory/inventory'
import { EntityManager } from './entities/entities'
import { PlayerController } from './player/controller'
import { WorldManager } from './world/worldManager'
import { findCraftMatch, findSmeltingRecipe, consumeCraftIngredients } from './crafting/crafting'
import { clamp } from './utils/math'
import { getHorizontalFacingFromYaw, resolveStairBlockId } from './world/blockShape'

type GameMode = UiRenderState['mode']

const MACHINE_GUN_AMMO_ITEM_ID = 'iron_nugget'
const MACHINE_GUN_FIRE_INTERVAL = 0.09
const MACHINE_GUN_RANGE = 18
const CIGARETTE_ITEM_ID = 'cigarette'

export class Minecraft2Game {
  private readonly root: HTMLElement
  private readonly database = new WorldDatabase()
  private readonly registries = buildRegistries()
  private readonly ui: GameUiController
  private readonly engine: Engine
  private readonly scene: Scene
  private readonly lighting: LightingManager
  private readonly standbyCamera: UniversalCamera
  private readonly settings: SettingsSave = {
    renderDistance: DEFAULT_RENDER_DISTANCE,
    mouseSensitivity: DEFAULT_MOUSE_SENSITIVITY,
    atmosphereVolume: DEFAULT_ATMOSPHERE_VOLUME,
    effectsVolume: DEFAULT_EFFECTS_VOLUME,
  }
  private readonly audio = new AudioManager()
  private stepAccumulator = 0
  private wasOnGround = true

  private atlas: Awaited<ReturnType<typeof buildBlockAtlas>> | null = null
  private worldMeta: WorldMetadata | null = null
  private worldManager: WorldManager | null = null
  private entityManager: EntityManager | null = null
  private player: PlayerController | null = null
  private hotbar: NullableInventorySlot[] = Array.from({ length: HOTBAR_SIZE }, () => null)
  private inventory: NullableInventorySlot[] = Array.from({ length: INVENTORY_SIZE }, () => null)
  private inventoryCraft: NullableInventorySlot[] = Array.from({ length: INVENTORY_CRAFT_SIZE }, () => null)
  private tableCraft: NullableInventorySlot[] = Array.from({ length: 9 }, () => null)
  private heldCursor: NullableInventorySlot = null
  private selectedHotbarIndex = 0
  private mode: GameMode = 'loading'
  private activeStation: ActiveCraftingStation | null = null
  private hasSave = false
  private worldTime = 0.35
  private autosaveAccumulator = 0
  private uiAccumulator = 0
  private chunkAccumulator = 0
  private uiDirty = true
  private breakTargetKey = ''
  private breakProgress = 0
  private furnaceProgress = 0
  private machineGunCooldown = 0
  private chunkUpdatePromise: Promise<void> | null = null

  constructor(root: HTMLElement) {
    this.root = root
    this.ui = new GameUiController(root, {
      createWorld: (seed) => void this.createWorld(seed),
      loadWorld: () => void this.loadWorld(),
      resume: () => this.resume(),
      saveWorld: () => void this.saveWorld(),
      respawn: () => this.respawn(),
      closeInventory: () => this.closeInventory(),
      updateSettings: (settings) => {
        this.settings.renderDistance = settings.renderDistance
        this.settings.mouseSensitivity = settings.mouseSensitivity
        this.settings.atmosphereVolume = settings.atmosphereVolume
        this.settings.effectsVolume = settings.effectsVolume
        this.worldManager?.setRenderDistance(settings.renderDistance)
        this.player?.setMouseSensitivity(settings.mouseSensitivity)
        this.audio.setVolumes(settings.atmosphereVolume, settings.effectsVolume)
        this.uiDirty = true
        void this.database.saveSettings(this.settings)
      },
      interactSlot: (source, index, button) => {
        this.interactSlot(source, index, button)
      },
      getItemName: (itemId) => this.registries.items.get(itemId)?.name ?? itemId,
      getItemTexture: (itemId) => this.registries.items.get(itemId)?.texture ?? null,
    })

    this.engine = new Engine(
      this.ui.canvas,
      true,
      {
        preserveDrawingBuffer: true,
        stencil: true,
      },
      true,
    )
    this.scene = new Scene(this.engine)
    this.scene.setRenderingAutoClearDepthStencil(1, false)
    this.scene.setRenderingAutoClearDepthStencil(2, false)
    this.scene.fogMode = Scene.FOGMODE_EXP2
    this.standbyCamera = new UniversalCamera('standby-camera', new Vector3(0, 18, -22), this.scene)
    this.standbyCamera.rotation.set(0.36, 0, 0)
    this.scene.activeCamera = this.standbyCamera

    this.lighting = new LightingManager(this.scene)
    this.lighting.setupPostProcessing(this.standbyCamera)
    this.lighting.update(this.worldTime)

    window.addEventListener('resize', () => this.engine.resize())
    window.addEventListener('keydown', this.handleGlobalKeyDown)
    window.addEventListener('beforeunload', () => {
      void this.saveWorld()
    })
  }

  async initialize(): Promise<void> {
    void this.audio.initialize()
    this.atlas = await buildBlockAtlas(this.registries)
    const snapshot = await this.database.getWorldSnapshot()
    this.worldMeta = snapshot.world
    this.hasSave = Boolean(snapshot.world && snapshot.player)
    if (snapshot.settings) {
      this.settings.renderDistance = snapshot.settings.renderDistance
      this.settings.mouseSensitivity = snapshot.settings.mouseSensitivity
      this.settings.atmosphereVolume = snapshot.settings.atmosphereVolume
      this.settings.effectsVolume = snapshot.settings.effectsVolume
    }
    this.audio.setVolumes(this.settings.atmosphereVolume, this.settings.effectsVolume)
    this.mode = 'menu'
    this.uiDirty = true

    this.engine.runRenderLoop(() => {
      const deltaSeconds = Math.min(0.05, this.engine.getDeltaTime() / 1000)
      void this.update(deltaSeconds)
      this.scene.render()
    })
  }

  private handleGlobalKeyDown = (event: KeyboardEvent): void => {
    if (/^Digit[1-9]$/.test(event.code)) {
      const index = Number(event.code.slice(-1)) - 1
      this.selectedHotbarIndex = clamp(index, 0, HOTBAR_SIZE - 1)
      this.syncHeldItem()
      this.uiDirty = true
    }
  }

  private setMode(mode: GameMode): void {
    this.mode = mode
    this.player?.setUiCapturingInput(mode !== 'playing')
    const inWorld =
      mode === 'playing' ||
      mode === 'paused' ||
      mode === 'inventory' ||
      mode === 'crafting_table' ||
      mode === 'furnace'
    if (inWorld) {
      this.audio.startAtmosphere()
    } else {
      this.audio.stopAtmosphere()
    }
    this.uiDirty = true
  }

  private async createWorld(seedInput: string): Promise<void> {
    void this.audio.resume()
    const seed = seedInput || `seed-${Math.random().toString(36).slice(2, 10)}`
    this.setMode('loading')
    await this.database.clearWorld()
    this.worldMeta = {
      id: WORLD_ID,
      name: GAME_TITLE,
      seed,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    }
    this.hasSave = true
    await this.database.saveWorldMeta(this.worldMeta)
    await this.database.saveSettings(this.settings)
    await this.setupSession(null)
  }

  private async loadWorld(): Promise<void> {
    if (!this.worldMeta) {
      return
    }
    void this.audio.resume()
    this.setMode('loading')
    const playerSave = await this.database.loadPlayerState()
    await this.setupSession(playerSave)
  }

  private async setupSession(playerSave: PlayerSave | null): Promise<void> {
    if (!this.atlas || !this.worldMeta) {
      return
    }

    this.scene.activeCamera = this.standbyCamera
    this.worldManager?.dispose()
    this.entityManager?.dispose()
    this.player?.dispose()

    this.hotbar = Array.from({ length: HOTBAR_SIZE }, () => null)
    this.inventory = Array.from({ length: INVENTORY_SIZE }, () => null)
    this.inventoryCraft = Array.from({ length: INVENTORY_CRAFT_SIZE }, () => null)
    this.tableCraft = Array.from({ length: 9 }, () => null)
    this.heldCursor = null
    this.selectedHotbarIndex = playerSave?.selectedHotbarIndex ?? 0
    this.worldTime = 0.35
    this.breakTargetKey = ''
    this.breakProgress = 0
    this.furnaceProgress = 0
    this.machineGunCooldown = 0

    this.worldManager = new WorldManager(this.scene, this.registries, this.database, this.atlas.imageUrl, this.lighting)
    this.worldManager.attachAtlasRegions(this.atlas.regions)
    this.entityManager = new EntityManager(
      this.scene,
      this.registries,
      this.worldManager,
      {
        giveItem: (itemId, count) => this.giveItemToPlayer(itemId, count),
        damagePlayer: (amount) => {
          this.player?.damage(amount)
          if ((this.player?.health ?? 1) <= 0) {
            this.setMode('dead')
          }
        },
        playMobSound: (entityId, x, y, z) => {
          if (entityId === 'chicken' || entityId === 'spider' || entityId === 'godzilla') {
            this.audio.playSfx(entityId, { x, y, z })
          }
        },
      },
      this.lighting,
    )
    this.player = new PlayerController(this.scene, this.ui.canvas, this.worldManager, {
      onCigaretteIgnite: () => this.audio.playSfx('lighter'),
      onToggleInventory: () => this.toggleInventory(),
      onTogglePause: () => this.togglePause(),
    })
    this.lighting.setupPostProcessing(this.player.camera)
    this.player.setResources(
      this.atlas,
      (itemId) => {
        const item = this.registries.items.get(itemId)
        const blockId = item?.placeableBlockId
        return blockId ? this.registries.blocks.get(blockId) : undefined
      },
      (itemId) => this.registries.items.get(itemId),
    )
    this.player.setMouseSensitivity(this.settings.mouseSensitivity)

    this.player.camera.inertia = 0

    await this.worldManager.initialize(this.worldMeta.seed, this.settings.renderDistance, (_, spawns) => {
      this.entityManager?.spawnChunkHints(spawns)
    })

    if (playerSave) {
      this.player.loadFromSave(playerSave)
      this.hotbar = playerSave.hotbar.map((slot) => cloneSlot(slot))
      this.inventory = playerSave.inventory.map((slot) => cloneSlot(slot))
    } else {
      const spawnY = await this.worldManager.preloadSpawnArea(0, 0)
      this.player.setPosition(0.5, spawnY + 1, 0.5)
      this.giveItemToPlayer('boards', 8)
      this.giveItemToPlayer('stick', 4)
      this.giveItemToPlayer('wooden_pickaxe', 1)
    }

    this.ensurePlayerInventoryItemCount('iron_ingot', 30)
    this.ensureItemEquipped(CIGARETTE_ITEM_ID)

    await this.worldManager.updateAroundPlayer(this.player.position)
    this.syncHeldItem()
    this.setMode('playing')
  }

  private buildPlayerSave(): PlayerSave | null {
    if (!this.player) {
      return null
    }
    return {
      position: {
        x: this.player.position.x,
        y: this.player.position.y,
        z: this.player.position.z,
      },
      velocity: {
        x: this.player.velocity.x,
        y: this.player.velocity.y,
        z: this.player.velocity.z,
      },
      yaw: this.player.yaw,
      pitch: this.player.pitch,
      health: this.player.health,
      hotbar: this.hotbar.map((slot) => cloneSlot(slot)),
      inventory: this.inventory.map((slot) => cloneSlot(slot)),
      selectedHotbarIndex: this.selectedHotbarIndex,
    }
  }

  private async saveWorld(): Promise<void> {
    if (!this.worldMeta || !this.worldManager) {
      return
    }
    const playerSave = this.buildPlayerSave()
    if (playerSave) {
      await this.database.savePlayerState(playerSave)
    }
    this.worldMeta.updatedAt = Date.now()
    await this.database.saveWorldMeta(this.worldMeta)
    await this.database.saveSettings(this.settings)
    await this.worldManager.saveDirtyChunks()
    this.uiDirty = true
  }

  private giveItemToPlayer(itemId: string, count: number): number {
    const item = this.registries.items.get(itemId)
    if (!item) {
      return count
    }
    let remainder: NullableInventorySlot = { itemId, count }
    if (remainder) {
      remainder = addItemToCollection(this.hotbar, remainder, this.registries.items)
    }
    if (remainder) {
      remainder = addItemToCollection(this.inventory, remainder, this.registries.items)
    }
    this.uiDirty = true
    return remainder?.count ?? 0
  }

  private countPlayerItem(itemId: string): number {
    let total = 0
    for (const slot of [...this.hotbar, ...this.inventory]) {
      if (slot?.itemId === itemId) {
        total += slot.count
      }
    }
    return total
  }

  private ensurePlayerInventoryItemCount(itemId: string, minimumCount: number): void {
    const currentCount = this.countPlayerItem(itemId)
    if (currentCount >= minimumCount) {
      return
    }
    this.giveItemToPlayer(itemId, minimumCount - currentCount)
  }

  private findItemSlotIndex(slots: NullableInventorySlot[], itemId: string): number {
    return slots.findIndex((slot) => slot?.itemId === itemId)
  }

  private ensureItemEquipped(itemId: string): void {
    this.ensurePlayerInventoryItemCount(itemId, 1)

    const hotbarIndex = this.findItemSlotIndex(this.hotbar, itemId)
    if (hotbarIndex >= 0) {
      this.selectedHotbarIndex = hotbarIndex
      this.syncHeldItem()
      this.uiDirty = true
      return
    }

    const inventoryIndex = this.findItemSlotIndex(this.inventory, itemId)
    if (inventoryIndex < 0) {
      this.syncHeldItem()
      return
    }

    const emptyHotbarIndex = this.hotbar.findIndex((slot) => !slot)
    const targetHotbarIndex =
      emptyHotbarIndex >= 0 ? emptyHotbarIndex : clamp(this.selectedHotbarIndex, 0, HOTBAR_SIZE - 1)
    const displacedSlot = this.hotbar[targetHotbarIndex]
    this.hotbar[targetHotbarIndex] = this.inventory[inventoryIndex]
    this.inventory[inventoryIndex] = displacedSlot
    this.selectedHotbarIndex = targetHotbarIndex
    this.syncHeldItem()
    this.uiDirty = true
  }

  private consumePlayerItem(itemId: string, count: number): boolean {
    if (this.countPlayerItem(itemId) < count) {
      return false
    }

    let remaining = count
    remaining -= removeItemCount(this.hotbar, itemId, remaining)
    if (remaining > 0) {
      remaining -= removeItemCount(this.inventory, itemId, remaining)
    }

    this.syncHeldItem()
    this.uiDirty = true
    return remaining === 0
  }

  private fireMachineGun(origin: Vector3, direction: Vector3): boolean {
    if (!this.consumePlayerItem(MACHINE_GUN_AMMO_ITEM_ID, 1)) {
      return false
    }

    const mob = this.entityManager?.pickMob(origin, direction, MACHINE_GUN_RANGE) ?? null
    if (!mob) {
      return true
    }

    const blockHit = this.worldManager?.raycast(origin, direction, MACHINE_GUN_RANGE) ?? null
    if (blockHit) {
      const mobDistance = Vector3.Distance(
        origin,
        new Vector3(mob.state.position.x, mob.state.position.y + 0.9, mob.state.position.z),
      )
      const blockDistance = Vector3.Distance(
        origin,
        new Vector3(
          blockHit.blockPosition.x + 0.5,
          blockHit.blockPosition.y + 0.5,
          blockHit.blockPosition.z + 0.5,
        ),
      )
      if (blockDistance < mobDistance) {
        return true
      }
    }

    const damage = this.registries.items.get('machine_gun')?.damage ?? 1
    this.entityManager?.damageMob(mob, damage, direction)
    return true
  }

  private getSelectedHotbarSlot(): NullableInventorySlot {
    return this.hotbar[this.selectedHotbarIndex]
  }

  private syncHeldItem(): void {
    const itemId = this.getSelectedHotbarSlot()?.itemId ?? null
    this.player?.setHeldItem(itemId)
  }

  private getCurrentCraftMatch(grid: NullableInventorySlot[], width: number, height: number): NullableInventorySlot {
    const match = findCraftMatch(this.registries.recipes.values(), grid, width, height)
    return match ? { itemId: match.result.itemId, count: match.result.count } : null
  }

  private getFurnaceState(): FurnaceBlockEntity | null {
    if (!this.worldManager || this.activeStation?.kind !== 'furnace' || !this.activeStation.blockPosition) {
      return null
    }
    const { x, y, z } = this.activeStation.blockPosition
    return this.worldManager.getBlockEntity(x, y, z) as FurnaceBlockEntity | null
  }

  private ensureFurnaceState(position: { x: number; y: number; z: number }): Promise<FurnaceBlockEntity> {
    const existing = this.worldManager?.getBlockEntity(position.x, position.y, position.z) as FurnaceBlockEntity | null
    if (existing) {
      return Promise.resolve(existing)
    }
    const created: FurnaceBlockEntity = {
      kind: 'furnace',
      input: null,
      fuel: null,
      output: null,
      burnTime: 0,
      burnDuration: 0,
      progress: 0,
    }
    return this.worldManager!.setBlockEntity(position.x, position.y, position.z, created).then(() => created)
  }

  private togglePause(): void {
    if (!this.player || this.mode === 'menu' || this.mode === 'loading' || this.mode === 'dead') {
      return
    }
    if (this.mode === 'inventory' || this.mode === 'crafting_table' || this.mode === 'furnace') {
      this.closeInventory()
      return
    }
    this.setMode(this.mode === 'paused' ? 'playing' : 'paused')
  }

  private resume(): void {
    if (this.mode === 'paused') {
      this.setMode('playing')
    }
  }

  private toggleInventory(): void {
    if (!this.player || !this.worldManager || this.mode === 'menu' || this.mode === 'loading' || this.mode === 'dead') {
      return
    }
    if (this.mode === 'playing') {
      this.activeStation = { kind: 'inventory' }
      this.setMode('inventory')
      return
    }
    if (this.mode === 'inventory' || this.mode === 'crafting_table' || this.mode === 'furnace') {
      this.closeInventory()
    }
  }

  private returnItemToPlayerStorage(slot: NullableInventorySlot): void {
    if (!slot) {
      return
    }

    let remainder = cloneSlot(slot)
    if (remainder) {
      remainder = addItemToCollection(this.inventory, remainder, this.registries.items)
    }
    if (remainder) {
      remainder = addItemToCollection(this.hotbar, remainder, this.registries.items)
    }

    if (remainder && this.entityManager && this.player) {
      this.entityManager.spawnItemDrop(
        remainder.itemId,
        remainder.count,
        this.player.position.add(new Vector3(0, Math.max(0.8, this.player.getCollisionHeight() * 0.6), 0)),
        new Vector3((Math.random() - 0.5) * 1.2, 1.4, (Math.random() - 0.5) * 1.2),
      )
    }
  }

  private clearCraftingSlots(slots: NullableInventorySlot[]): void {
    for (let index = 0; index < slots.length; index += 1) {
      const slot = slots[index]
      if (!slot) {
        continue
      }
      this.returnItemToPlayerStorage(slot)
      slots[index] = null
    }
  }

  private clearOpenCraftingState(): void {
    this.clearCraftingSlots(this.inventoryCraft)
    this.clearCraftingSlots(this.tableCraft)

    if (this.heldCursor) {
      this.returnItemToPlayerStorage(this.heldCursor)
      this.heldCursor = null
    }
  }

  private closeInventory(): void {
    if (this.mode === 'inventory' || this.mode === 'crafting_table' || this.mode === 'furnace') {
      this.clearOpenCraftingState()
      this.activeStation = null
      this.syncHeldItem()
      this.setMode('playing')
    }
  }

  private async respawn(): Promise<void> {
    if (!this.player || !this.worldManager) {
      return
    }
    const spawnY = await this.worldManager.preloadSpawnArea(0, 0)
    this.player.setPosition(0.5, spawnY + 1, 0.5)
    this.player.health = MAX_HEALTH
    this.machineGunCooldown = 0
    this.setMode('playing')
  }

  private setUtilityMode(mode: 'crafting_table' | 'furnace', position: { x: number; y: number; z: number }): void {
    this.activeStation = { kind: mode, blockPosition: position }
    this.setMode(mode)
  }

  private getSlotReference(
    source: SlotSource,
    index: number,
  ): { slots: NullableInventorySlot[]; index: number; single?: boolean } | null {
    switch (source) {
      case 'hotbar':
        return { slots: this.hotbar, index }
      case 'inventory':
        return { slots: this.inventory, index }
      case 'inventory-craft':
        return { slots: this.inventoryCraft, index }
      case 'table-craft':
        return { slots: this.tableCraft, index }
      case 'furnace-input': {
        const furnace = this.getFurnaceState()
        return furnace ? { slots: [furnace.input], index: 0, single: true } : null
      }
      case 'furnace-fuel': {
        const furnace = this.getFurnaceState()
        return furnace ? { slots: [furnace.fuel], index: 0, single: true } : null
      }
      case 'furnace-output': {
        const furnace = this.getFurnaceState()
        return furnace ? { slots: [furnace.output], index: 0, single: true } : null
      }
      default:
        return null
    }
  }

  private updateSingleSlotReference(source: SlotSource, value: NullableInventorySlot): void {
    const furnace = this.getFurnaceState()
    if (!furnace || !this.activeStation?.blockPosition || !this.worldManager) {
      return
    }
    if (source === 'furnace-input') {
      furnace.input = value
    } else if (source === 'furnace-fuel') {
      furnace.fuel = value
    } else if (source === 'furnace-output') {
      furnace.output = value
    }
    void this.worldManager.setBlockEntity(
      this.activeStation.blockPosition.x,
      this.activeStation.blockPosition.y,
      this.activeStation.blockPosition.z,
      { ...furnace },
    )
  }

  private intersectsPlayerBounds(worldX: number, worldY: number, worldZ: number, blockCode: number): boolean {
    if (!this.player || !this.worldManager) {
      return false
    }

    const halfWidth = PLAYER_WIDTH / 2
    const playerMinX = this.player.position.x - halfWidth
    const playerMaxX = this.player.position.x + halfWidth
    const playerMinY = this.player.position.y
    const playerMaxY = this.player.position.y + this.player.getCollisionHeight()
    const playerMinZ = this.player.position.z - halfWidth
    const playerMaxZ = this.player.position.z + halfWidth

    return this.worldManager.getCollisionBoxes(worldX, worldY, worldZ, blockCode).some((box) =>
      box.maxX > playerMinX &&
      box.minX < playerMaxX &&
      box.maxY > playerMinY &&
      box.minY < playerMaxY &&
      box.maxZ > playerMinZ &&
      box.minZ < playerMaxZ,
    )
  }

  private resolvePlacementBlockId(item: ItemDefinition): string | null {
    if (item.id === 'wood_stairs' || item.id === 'cobblestone_stairs') {
      return resolveStairBlockId(item.id, getHorizontalFacingFromYaw(this.player?.yaw ?? 0))
    }
    return item.placeableBlockId ?? null
  }

  private takeCraftResult(kind: 'inventory' | 'table'): void {
    const grid = kind === 'inventory' ? this.inventoryCraft : this.tableCraft
    const width = kind === 'inventory' ? 2 : 3
    const height = width
    const match = findCraftMatch(this.registries.recipes.values(), grid, width, height)
    if (!match) {
      return
    }

    const result = { itemId: match.result.itemId, count: match.result.count }
    if (!this.heldCursor) {
      this.heldCursor = { ...result }
    } else {
      const merged = addItemToSlot(this.heldCursor, result, this.registries.items)
      if (merged.remainder) {
        return
      }
      this.heldCursor = merged.slot
    }

    consumeCraftIngredients(match.recipe, grid)
    this.uiDirty = true
  }

  private interactSlot(source: SlotSource, index: number, button: number): void {
    if (source === 'inventory-craft-result') {
      this.takeCraftResult('inventory')
      return
    }
    if (source === 'table-craft-result') {
      this.takeCraftResult('table')
      return
    }

    const reference = this.getSlotReference(source, index)
    if (!reference) {
      return
    }

    const slots = reference.slots
    const current = cloneSlot(slots[reference.index])
    if (button === 2) {
      if (!this.heldCursor && current) {
        const split = splitStack(current)
        slots[reference.index] = split.left
        this.heldCursor = split.right
      } else if (this.heldCursor) {
        if (!current) {
          slots[reference.index] = { ...this.heldCursor, count: 1 }
          this.heldCursor.count -= 1
          if (this.heldCursor.count <= 0) {
            this.heldCursor = null
          }
        } else if (current.itemId === this.heldCursor.itemId) {
          const capacity = this.registries.items.get(current.itemId)?.stackSize ?? 64
          if (current.count < capacity) {
            current.count += 1
            slots[reference.index] = current
            this.heldCursor.count -= 1
            if (this.heldCursor.count <= 0) {
              this.heldCursor = null
            }
          }
        }
      }
    } else if (!this.heldCursor) {
      this.heldCursor = current
      slots[reference.index] = null
    } else if (!current) {
      slots[reference.index] = this.heldCursor
      this.heldCursor = null
    } else {
      const merged = addItemToSlot(current, this.heldCursor, this.registries.items)
      if (!merged.remainder) {
        slots[reference.index] = merged.slot
        this.heldCursor = null
      } else if (merged.slot?.itemId === current.itemId && merged.slot.count !== current.count) {
        slots[reference.index] = merged.slot
        this.heldCursor = merged.remainder
      } else {
        slots[reference.index] = this.heldCursor
        this.heldCursor = current
      }
    }

    if (reference.single) {
      this.updateSingleSlotReference(source, slots[0] ?? null)
    }
    this.syncHeldItem()
    this.uiDirty = true
  }

  private async handleWorldInput(deltaSeconds: number): Promise<void> {
    if (!this.player || !this.worldManager || !this.entityManager || this.mode !== 'playing') {
      this.worldManager?.setSelection(null)
      return
    }

    const origin = this.player.camera.position.clone()
    const direction = this.player.getLookVector()
    const hit = this.worldManager.raycast(origin, direction)
    this.worldManager.setSelection(hit)
    this.machineGunCooldown = Math.max(0, this.machineGunCooldown - deltaSeconds)

    const held = this.getSelectedHotbarSlot()
    if (held?.itemId === 'machine_gun' && this.player.isPrimaryDown()) {
      this.breakProgress = 0
      this.breakTargetKey = ''
      if (this.machineGunCooldown > 0) {
        return
      }
      if (!this.fireMachineGun(origin, direction)) {
        return
      }
      this.machineGunCooldown = MACHINE_GUN_FIRE_INTERVAL
      this.player.triggerSwing()
      this.audio.playSfx('swing')
      this.uiDirty = true
      return
    }

    if (this.player.consumePrimaryPress()) {
      const mob = this.entityManager.pickMob(origin, direction)
      if (mob) {
        const damage = held ? this.registries.items.get(held.itemId)?.damage ?? 1 : 1
        this.entityManager.damageMob(mob, damage, direction)
        this.player.triggerSwing()
        this.audio.playSfx('swing')
        this.uiDirty = true
        return
      }
    }

    if (this.player.isPrimaryDown() && hit) {
      const key = `${hit.blockPosition.x}:${hit.blockPosition.y}:${hit.blockPosition.z}`
      const block = this.registries.blocksByCode.get(hit.blockCode)
      if (block && !block.fluid) {
        if (key !== this.breakTargetKey) {
          this.breakTargetKey = key
          this.breakProgress = 0
        }
        const held = this.getSelectedHotbarSlot()
        const heldItem = held ? this.registries.items.get(held.itemId) : null
        const toolBonus = heldItem?.category === 'tool' ? 2.2 : 1
        this.breakProgress += deltaSeconds * toolBonus
        if (this.breakProgress >= Math.max(0.12, block.breakTime)) {
          await this.worldManager.setBlock(hit.blockPosition.x, hit.blockPosition.y, hit.blockPosition.z, 0)
          this.entityManager.spawnItemDrop(
            block.dropItemId,
            1,
            new Vector3(hit.blockPosition.x + 0.5, hit.blockPosition.y + 0.65, hit.blockPosition.z + 0.5),
            direction.scale(2),
          )
          this.player.triggerSwing()
          this.audio.playSfx('swing')
          this.breakProgress = 0
          this.breakTargetKey = ''
        }
      }
    } else {
      this.breakProgress = 0
      this.breakTargetKey = ''
    }

    if (this.player.consumeSecondaryPress()) {
      const heldSlot = this.getSelectedHotbarSlot()
      if (heldSlot?.itemId === CIGARETTE_ITEM_ID) {
        this.player.tryStartSmoking()
        return
      }
      if (!hit) {
        return
      }
      const block = this.registries.blocksByCode.get(hit.blockCode)
      if (!block) {
        return
      }

      if (block.id === 'crafting_table') {
        this.setUtilityMode('crafting_table', hit.blockPosition)
        return
      }
      if (block.id === 'furnace') {
        await this.ensureFurnaceState(hit.blockPosition)
        this.setUtilityMode('furnace', hit.blockPosition)
        return
      }

      const selected = this.getSelectedHotbarSlot()
      if (!selected) {
        return
      }
      const item = this.registries.items.get(selected.itemId)
      if (!item) {
        return
      }

      if (item.category === 'spawn_egg') {
        this.entityManager.spawnMob('godzilla', hit.adjacentPosition.x + 0.5, hit.adjacentPosition.y, hit.adjacentPosition.z + 0.5)
        selected.count -= 1
        if (selected.count <= 0) {
          this.hotbar[this.selectedHotbarIndex] = null
        }
        this.syncHeldItem()
        this.uiDirty = true
        return
      }

      const placeableBlockId = this.resolvePlacementBlockId(item)
      if (!placeableBlockId) {
        return
      }

      const targetBlock = this.worldManager.getBlock(hit.adjacentPosition.x, hit.adjacentPosition.y, hit.adjacentPosition.z)
      if (targetBlock) {
        return
      }
      const placeableBlockCode = this.registries.blockCodes[placeableBlockId]
      if (!placeableBlockCode) {
        return
      }
      if (placeableBlockId === 'torch') {
        const supports = [
          this.worldManager.getBlockDefinition(
            hit.adjacentPosition.x,
            hit.adjacentPosition.y - 1,
            hit.adjacentPosition.z,
          ),
          this.worldManager.getBlockDefinition(
            hit.adjacentPosition.x - 1,
            hit.adjacentPosition.y,
            hit.adjacentPosition.z,
          ),
          this.worldManager.getBlockDefinition(
            hit.adjacentPosition.x + 1,
            hit.adjacentPosition.y,
            hit.adjacentPosition.z,
          ),
          this.worldManager.getBlockDefinition(
            hit.adjacentPosition.x,
            hit.adjacentPosition.y,
            hit.adjacentPosition.z - 1,
          ),
          this.worldManager.getBlockDefinition(
            hit.adjacentPosition.x,
            hit.adjacentPosition.y,
            hit.adjacentPosition.z + 1,
          ),
        ]
        if (!supports.some((support) => support?.collidable && !support.fluid)) {
          return
        }
      }
      if (this.intersectsPlayerBounds(
        hit.adjacentPosition.x,
        hit.adjacentPosition.y,
        hit.adjacentPosition.z,
        placeableBlockCode,
      )) {
        return
      }
      await this.worldManager.setBlock(
        hit.adjacentPosition.x,
        hit.adjacentPosition.y,
        hit.adjacentPosition.z,
        placeableBlockCode,
      )
      selected.count -= 1
      if (selected.count <= 0) {
        this.hotbar[this.selectedHotbarIndex] = null
      }
      this.syncHeldItem()
      this.player.triggerSwing()
      this.audio.playSfx('swing')
      this.uiDirty = true
    }
  }

  private tickFurnaces(deltaSeconds: number): void {
    if (!this.worldManager) {
      return
    }
    this.worldManager.forEachBlockEntity((x, y, z, entity) => {
      if (entity.kind !== 'furnace') {
        return
      }
      let changed = false

      if (entity.burnTime > 0) {
        entity.burnTime = Math.max(0, entity.burnTime - deltaSeconds)
        changed = true
      }

      const recipe = entity.input ? findSmeltingRecipe(this.registries.recipes.values(), entity.input.itemId) : null
      const fuelId = entity.fuel?.itemId
      const canOutput =
        recipe &&
        (!entity.output ||
          (entity.output.itemId === recipe.result.item &&
            entity.output.count < (this.registries.items.get(recipe.result.item)?.stackSize ?? 64)))

      if (canOutput && entity.burnTime <= 0 && fuelId && FUEL_BURN_TIMES[fuelId]) {
        entity.burnTime = FUEL_BURN_TIMES[fuelId]
        entity.burnDuration = FUEL_BURN_TIMES[fuelId]
        entity.fuel!.count -= 1
        if (entity.fuel!.count <= 0) {
          entity.fuel = null
        }
        changed = true
      }

      if (canOutput && entity.burnTime > 0) {
        entity.progress += deltaSeconds / 4
        if (entity.progress >= 1) {
          entity.progress = 0
          entity.input!.count -= 1
          if (entity.input!.count <= 0) {
            entity.input = null
          }
          if (!entity.output) {
            entity.output = { itemId: recipe!.result.item, count: recipe!.result.count }
          } else {
            entity.output.count += recipe!.result.count
          }
          changed = true
        }
      } else if (entity.progress !== 0) {
        entity.progress = 0
        changed = true
      }

      if (
        this.activeStation?.kind === 'furnace' &&
        this.activeStation.blockPosition?.x === x &&
        this.activeStation.blockPosition.y === y &&
        this.activeStation.blockPosition.z === z
      ) {
        this.furnaceProgress = entity.progress
        this.uiDirty = true
      }

      if (changed) {
        void this.worldManager!.setBlockEntity(x, y, z, { ...entity })
      }
    })
  }

  private updateEnvironment(): void {
    this.lighting.update(this.worldTime, this.player?.position)
  }

  private updatePlayerSounds(deltaSeconds: number): void {
    if (!this.player) {
      return
    }
    const horizontalSpeed = Math.hypot(this.player.velocity.x, this.player.velocity.z)
    const walking = this.player.onGround && horizontalSpeed > 0.6 && this.mode === 'playing'
    if (walking) {
      this.stepAccumulator += deltaSeconds
      const stepInterval = horizontalSpeed > 6 ? 0.3 : 0.44
      if (this.stepAccumulator >= stepInterval) {
        this.stepAccumulator = 0
        this.audio.playSfx('step')
      }
    } else {
      this.stepAccumulator = Math.min(this.stepAccumulator, 0.3)
    }
    this.wasOnGround = this.player.onGround
  }

  private async update(deltaSeconds: number): Promise<void> {
    if (!this.atlas) {
      return
    }

    if (this.player && (this.mode === 'playing' || this.mode === 'inventory' || this.mode === 'crafting_table' || this.mode === 'furnace')) {
      this.worldTime = (this.worldTime + deltaSeconds / DAY_LENGTH_SECONDS) % 1
      this.updateEnvironment()
      this.player.update(deltaSeconds, this.mode === 'playing')
      this.audio.setListenerPosition(
        this.player.position.x,
        this.player.position.y,
        this.player.position.z,
      )
      this.updatePlayerSounds(deltaSeconds)
      this.entityManager?.update(deltaSeconds, this.worldTime, this.player.position)
      this.tickFurnaces(deltaSeconds)
      if (this.worldManager) {
        await this.worldManager.tickFluids(50)
      }
      await this.handleWorldInput(deltaSeconds)

      if (this.player.health <= 0) {
        this.setMode('dead')
      }

      this.chunkAccumulator += deltaSeconds
      if (this.chunkAccumulator > 0.35 && this.worldManager && !this.chunkUpdatePromise) {
        this.chunkAccumulator = 0
        this.chunkUpdatePromise = this.worldManager.updateAroundPlayer(this.player.position).finally(() => {
          this.chunkUpdatePromise = null
        })
      }

      this.autosaveAccumulator += deltaSeconds * 1000
      if (this.autosaveAccumulator >= AUTOSAVE_INTERVAL_MS) {
        this.autosaveAccumulator = 0
        void this.saveWorld()
      }
    }

    this.uiAccumulator += deltaSeconds
    if (this.uiDirty || this.uiAccumulator >= 0.12) {
      this.uiAccumulator = 0
      this.ui.render(this.buildUiState())
      this.uiDirty = false
    }
  }

  private buildUiState(): UiRenderState {
    const furnace = this.getFurnaceState()
    return {
      mode: this.mode,
      hasSave: this.hasSave,
      health: this.player?.health ?? MAX_HEALTH,
      worldName: this.worldMeta?.name ?? GAME_TITLE,
      selectedHotbarIndex: this.selectedHotbarIndex,
      hotbar: this.hotbar.map((slot) => cloneSlot(slot)),
      inventory: this.inventory.map((slot) => cloneSlot(slot)),
      inventoryCraft: this.inventoryCraft.map((slot) => cloneSlot(slot)),
      inventoryCraftResult: this.getCurrentCraftMatch(this.inventoryCraft, 2, 2),
      tableCraft: this.tableCraft.map((slot) => cloneSlot(slot)),
      tableCraftResult: this.getCurrentCraftMatch(this.tableCraft, 3, 3),
      furnaceInput: cloneSlot(furnace?.input ?? null),
      furnaceFuel: cloneSlot(furnace?.fuel ?? null),
      furnaceOutput: cloneSlot(furnace?.output ?? null),
      furnaceProgress: this.furnaceProgress,
      heldCursor: cloneSlot(this.heldCursor),
      activeStation: this.activeStation,
      settings: { ...this.settings },
    }
  }
}
