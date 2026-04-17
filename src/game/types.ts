export type BlockId = string
export type ItemId = string
export type EntityId = string
export type RecipeId = string
export type BiomeId = 'plains' | 'forest' | 'beach' | 'lake' | 'mountains'

export interface BlockTextureSet {
  all?: string
  top?: string
  bottom?: string
  side?: string
  front?: string
  back?: string
  left?: string
  right?: string
}

export interface BlockDefinition {
  id: BlockId
  code: number
  name: string
  category: 'terrain' | 'ore' | 'wood' | 'plant' | 'decorative' | 'utility' | 'fluid'
  textures: BlockTextureSet
  solid: boolean
  collidable: boolean
  transparent: boolean
  translucent: boolean
  crossPlane: boolean
  fluid: boolean
  breakTime: number
  emitsLight: number
  dropItemId: ItemId
  itemId: ItemId
}

export interface ItemDefinition {
  id: ItemId
  name: string
  description: string
  category: string
  stackSize: number
  durability?: number
  damage?: number
  texture: string
  placeableBlockId?: BlockId
}

export interface EntityDefinition {
  id: EntityId
  name: string
  description: string
  type: 'passive' | 'hostile' | 'boss'
  health: number
  damage: number
  loot: ItemId[]
  texture: string
  model: string
}

export interface RecipeResult {
  item: ItemId
  count: number
}

export interface ShapedRecipeDefinition {
  id: RecipeId
  description: string
  type: 'shaped'
  pattern: (ItemId | null)[][]
  result: RecipeResult
}

export interface ShapelessRecipeDefinition {
  id: RecipeId
  description: string
  type: 'shapeless'
  ingredients: ItemId[]
  result: RecipeResult
}

export interface SmeltingRecipeDefinition {
  id: RecipeId
  description: string
  type: 'smelting'
  input: ItemId
  result: RecipeResult
}

export type RecipeDefinition =
  | ShapedRecipeDefinition
  | ShapelessRecipeDefinition
  | SmeltingRecipeDefinition

export interface RegistryBundle {
  blocks: Map<BlockId, BlockDefinition>
  blocksByCode: Map<number, BlockDefinition>
  items: Map<ItemId, ItemDefinition>
  entities: Map<EntityId, EntityDefinition>
  recipes: Map<RecipeId, RecipeDefinition>
  blocksInCodeOrder: BlockDefinition[]
  itemsInOrder: ItemDefinition[]
  blockCodes: Record<BlockId, number>
}

export interface InventorySlot {
  itemId: ItemId
  count: number
  durability?: number
}

export type NullableInventorySlot = InventorySlot | null

export interface ChunkCoord {
  x: number
  z: number
}

export interface ChunkData {
  coord: ChunkCoord
  blocks: Uint16Array
  heights: Uint8Array
  biomes: BiomeId[]
  dirty: boolean
  blockEntities: Record<string, BlockEntitySave>
}

export interface SurfaceSpawnHint {
  x: number
  y: number
  z: number
  entityId: EntityId
}

export interface ChunkWorkerResponse {
  coord: ChunkCoord
  blocks: Uint16Array
  heights: Uint8Array
  biomes: BiomeId[]
  spawns: SurfaceSpawnHint[]
}

export interface WorldMetadata {
  id: string
  name: string
  seed: string
  createdAt: number
  updatedAt: number
}

export interface PlayerSave {
  position: { x: number; y: number; z: number }
  velocity: { x: number; y: number; z: number }
  yaw: number
  pitch: number
  health: number
  hotbar: NullableInventorySlot[]
  inventory: NullableInventorySlot[]
  selectedHotbarIndex: number
}

export interface SettingsSave {
  renderDistance: number
  mouseSensitivity: number
}

export interface ChunkSaveRecord {
  key: string
  coord: ChunkCoord
  blocks: number[]
  heights: number[]
  biomes: BiomeId[]
  blockEntities: Record<string, BlockEntitySave>
  updatedAt: number
}

export interface FurnaceBlockEntity {
  kind: 'furnace'
  input: NullableInventorySlot
  fuel: NullableInventorySlot
  output: NullableInventorySlot
  burnTime: number
  burnDuration: number
  progress: number
  activeRecipeId?: string
}

export type BlockEntitySave = FurnaceBlockEntity

export interface WorldSaveSnapshot {
  world: WorldMetadata | null
  player: PlayerSave | null
  settings: SettingsSave | null
}

export interface ModelCuboidDefinition {
  name: string
  size: { x: number; y: number; z: number }
  offset: { x: number; y: number; z: number }
  pivot: { x: number; y: number; z: number }
  rotation: { x: number; y: number; z: number }
  textureOffset: { x: number; y: number }
  mirror: boolean
}

export interface ParsedEntityModel {
  width: number
  height: number
  parts: ModelCuboidDefinition[]
}

export interface AtlasRegion {
  u0: number
  v0: number
  u1: number
  v1: number
}

export interface BlockAtlas {
  imageUrl: string
  regions: Record<string, AtlasRegion>
  textureKeys: string[]
}

export interface ChunkMeshHandle {
  solid: import('@babylonjs/core').Mesh[]
  cutout: import('@babylonjs/core').Mesh[]
  fluid: import('@babylonjs/core').Mesh[]
}

export interface ActiveCraftingStation {
  kind: 'inventory' | 'crafting_table' | 'furnace'
  blockPosition?: { x: number; y: number; z: number }
}

export interface HeldCursorItem {
  slot: NullableInventorySlot
}

export interface ItemDropState {
  id: string
  itemId: ItemId
  count: number
  position: { x: number; y: number; z: number }
  velocity: { x: number; y: number; z: number }
  life: number
}

export interface MobState {
  id: string
  entityId: EntityId
  position: { x: number; y: number; z: number }
  velocity: { x: number; y: number; z: number }
  knockback: { x: number; y: number; z: number }
  health: number
  yaw: number
  state: 'idle' | 'wander' | 'chase' | 'attack'
  wanderTimer: number
  actionTimer: number
  hurtTimer: number
  eggTimer?: number
  attackCooldown?: number
  attackAnim?: number
  wanderSpeed?: number
}

export interface UiTooltipState {
  visible: boolean
  text: string
  x: number
  y: number
}

export interface CraftMatch {
  recipe: RecipeDefinition
  result: InventorySlot
}
