import { assetData, resolveAssetTexture } from './assets'
import { humanizeId } from '../utils/math'
import type {
  BlockDefinition,
  EntityDefinition,
  ItemDefinition,
  RecipeDefinition,
  RegistryBundle,
} from '../types'

type RawRecord = Record<string, Record<string, unknown>>

const rawBlocks = assetData.blocksRaw
  .split(/\r?\n/)
  .map((line) => line.trim())
  .filter(Boolean)

const inferBlockDefinition = (
  id: string,
  code: number,
  itemName?: string,
): BlockDefinition => {
  const block: BlockDefinition = {
    id,
    code,
    name: itemName ?? humanizeId(id),
    category: 'terrain',
    textures: { all: `textures/block/${id}.png` },
    solid: true,
    collidable: true,
    transparent: false,
    translucent: false,
    crossPlane: false,
    fluid: false,
    breakTime: 0.45,
    emitsLight: 0,
    dropItemId: id,
    itemId: id,
  }

  if (id === 'ground') {
    block.textures = {
      top: 'textures/block/ground_top.png',
      side: 'textures/block/ground_side.png',
      bottom: 'textures/block/ground_bottom.png',
    }
    block.category = 'terrain'
    block.breakTime = 0.25
  } else if (id === 'dirt') {
    block.textures = { all: 'textures/block/ground_bottom.png' }
    block.category = 'terrain'
    block.breakTime = 0.22
  } else if (id === 'wood') {
    block.textures = {
      top: 'textures/block/wood_top.png',
      bottom: 'textures/block/wood_top.png',
      side: 'textures/block/wood_side.png',
    }
    block.category = 'wood'
    block.breakTime = 0.6
  } else if (id === 'boards') {
    block.category = 'wood'
    block.breakTime = 0.35
  } else if (id === 'leaves') {
    block.category = 'plant'
    block.transparent = true
    block.translucent = true
    block.breakTime = 0.2
  } else if (id === 'glass') {
    block.category = 'decorative'
    block.transparent = true
    block.translucent = true
    block.breakTime = 0.2
  } else if (id === 'sand') {
    block.category = 'terrain'
    block.breakTime = 0.24
  } else if (id === 'flower') {
    block.category = 'plant'
    block.transparent = true
    block.translucent = true
    block.collidable = false
    block.solid = false
    block.crossPlane = true
    block.breakTime = 0.1
  } else if (id === 'clay' || id === 'brick') {
    block.category = 'decorative'
  } else if (id.endsWith('_ore')) {
    block.category = 'ore'
    block.breakTime = 0.7
  } else if (id === 'glowing_ore') {
    block.category = 'ore'
    block.breakTime = 0.7
    block.emitsLight = 10
  } else if (id === 'crafting_table') {
    block.category = 'utility'
    block.textures = {
      front: 'textures/block/crafting_table_front.png',
      back: 'textures/block/crafting_table_side.png',
      left: 'textures/block/crafting_table_side.png',
      right: 'textures/block/crafting_table_side.png',
      side: 'textures/block/crafting_table_side.png',
      top: 'textures/block/crafting_table_top.png',
      bottom: 'textures/block/boards.png',
    }
    block.breakTime = 0.5
  } else if (id === 'furnace') {
    block.category = 'utility'
    block.textures = {
      front: 'textures/block/furnace_front.png',
      back: 'textures/block/furnace_side.png',
      left: 'textures/block/furnace_side.png',
      right: 'textures/block/furnace_side.png',
      side: 'textures/block/furnace_side.png',
      top: 'textures/block/furnace_top.png',
      bottom: 'textures/block/furnace_top.png',
    }
    block.breakTime = 0.9
  } else if (id.startsWith('water')) {
    block.category = 'fluid'
    block.textures = { all: 'textures-vanilla/block/water_still.png' }
    block.transparent = true
    block.translucent = true
    block.collidable = false
    block.solid = false
    block.fluid = true
    block.fluidLevel = id === 'water' ? 8 : parseInt(id.replace('water_', ''), 10)
    block.breakTime = 0
  }

  return block
}

const parseItems = (input: RawRecord): Map<string, ItemDefinition> => {
  const items = new Map<string, ItemDefinition>()
  for (const [id, raw] of Object.entries(input)) {
    items.set(id, {
      id,
      name: String(raw.name ?? humanizeId(id)),
      description: String(raw.description ?? ''),
      category: String(raw.category ?? 'material'),
      stackSize: Number(raw.stackSize ?? 64),
      durability: raw.durability === undefined ? undefined : Number(raw.durability),
      damage: raw.damage === undefined ? undefined : Number(raw.damage),
      texture: String(raw.texture ?? ''),
      placeableBlockId: String(raw.category) === 'block' ? id : undefined,
    })
  }
  return items
}

const parseEntities = (input: RawRecord): Map<string, EntityDefinition> => {
  const entities = new Map<string, EntityDefinition>()
  for (const [id, raw] of Object.entries(input)) {
    entities.set(id, {
      id,
      name: String(raw.name ?? humanizeId(id)),
      description: String(raw.description ?? ''),
      type: String(raw.type ?? 'passive') as EntityDefinition['type'],
      health: Number(raw.health ?? 4),
      damage: Number(raw.damage ?? 0),
      loot: Array.isArray(raw.loot) ? raw.loot.map((entry) => String(entry)) : [],
      texture: String(raw.texture ?? ''),
      model: String(raw.model ?? ''),
    })
  }
  return entities
}

const parseRecipes = (input: RawRecord): Map<string, RecipeDefinition> => {
  const recipes = new Map<string, RecipeDefinition>()
  for (const [id, raw] of Object.entries(input)) {
    const type = String(raw.type)
    if (type === 'shaped') {
      recipes.set(id, {
        id,
        description: String(raw.description ?? ''),
        type,
        pattern: Array.isArray(raw.pattern)
          ? raw.pattern.map((row) =>
              Array.isArray(row) ? row.map((entry) => (entry == null ? null : String(entry))) : [],
            )
          : [],
        result: {
          item: String((raw.result as Record<string, unknown>)?.item ?? ''),
          count: Number((raw.result as Record<string, unknown>)?.count ?? 1),
        },
      })
    } else if (type === 'shapeless') {
      recipes.set(id, {
        id,
        description: String(raw.description ?? ''),
        type,
        ingredients: Array.isArray(raw.ingredients)
          ? raw.ingredients.map((entry) => String(entry))
          : [],
        result: {
          item: String((raw.result as Record<string, unknown>)?.item ?? ''),
          count: Number((raw.result as Record<string, unknown>)?.count ?? 1),
        },
      })
    } else if (type === 'smelting') {
      recipes.set(id, {
        id,
        description: String(raw.description ?? ''),
        type,
        input: String(raw.input ?? ''),
        result: {
          item: String((raw.result as Record<string, unknown>)?.item ?? ''),
          count: Number((raw.result as Record<string, unknown>)?.count ?? 1),
        },
      })
    }
  }
  return recipes
}

export const buildRegistries = (): RegistryBundle => {
  const items = parseItems(assetData.itemsData)
  const entities = parseEntities(assetData.entitiesData)
  const recipes = parseRecipes(assetData.recipesData)

  const blockIds = new Set<string>(rawBlocks)
  for (const item of items.values()) {
    if (item.placeableBlockId) {
      blockIds.add(item.placeableBlockId)
    }
  }
  blockIds.add('water')
  for (let i = 1; i <= 7; i++) {
    blockIds.add(`water_${i}`)
  }
  blockIds.add('dirt')

  const blocks = new Map<string, BlockDefinition>()
  const blocksByCode = new Map<number, BlockDefinition>()
  const blocksInCodeOrder: BlockDefinition[] = []
  const blockCodes: Record<string, number> = {}

  let nextCode = 1
  for (const blockId of Array.from(blockIds)) {
    const code = nextCode
    nextCode += 1
    const block = inferBlockDefinition(blockId, code, items.get(blockId)?.name)
    blocks.set(blockId, block)
    blocksByCode.set(code, block)
    blocksInCodeOrder.push(block)
    blockCodes[blockId] = code
  }

  for (const block of blocks.values()) {
    if (!items.has(block.itemId)) {
      const texturePath =
        block.textures.all ??
        block.textures.front ??
        block.textures.right ??
        block.textures.left ??
        block.textures.back ??
        block.textures.side ??
        block.textures.top ??
        'textures/block/stone.png'
      items.set(block.itemId, {
        id: block.itemId,
        name: block.name,
        description: `${block.name} block`,
        category: 'block',
        stackSize: 64,
        texture: `/${texturePath}`,
        placeableBlockId: block.id,
      })
    }
  }

  const syntheticItems: Array<[string, ItemDefinition]> = [
    [
      'string',
      {
        id: 'string',
        name: 'Нить',
        description: 'Добывается из пауков.',
        category: 'material',
        stackSize: 64,
        texture: '/textures/item/string.png',
      },
    ],
    [
      'spider_eye',
      {
        id: 'spider_eye',
        name: 'Паучий глаз',
        description: 'Редкий дроп с пауков.',
        category: 'material',
        stackSize: 64,
        texture: '/textures/item/spider_eye.png',
      },
    ],
  ]

  for (const [id, item] of syntheticItems) {
    if (!items.has(id)) {
      items.set(id, item)
    }
  }

  for (const item of items.values()) {
    const directTexture = resolveAssetTexture(item.texture)
    if (directTexture) {
      item.texture = directTexture
    }
    if (item.placeableBlockId) {
      const block = blocks.get(item.placeableBlockId)
      if (block) {
        block.name = item.name
      }
    }
  }

  for (const entity of entities.values()) {
    if (entity.texture !== '-') {
      const resolved = resolveAssetTexture(entity.texture)
      if (resolved) {
        entity.texture = resolved
      }
    }
  }

  for (const block of blocks.values()) {
    const candidateTextures = [
      block.textures.all,
      block.textures.top,
      block.textures.bottom,
      block.textures.side,
      block.textures.front,
      block.textures.back,
      block.textures.left,
      block.textures.right,
    ]
    for (const candidate of candidateTextures) {
      if (!candidate) {
        continue
      }
      const resolved = resolveAssetTexture(candidate)
      if (!resolved) {
        continue
      }
      for (const [key, value] of Object.entries(block.textures)) {
        if (value === candidate) {
          block.textures[key as keyof typeof block.textures] = resolved
        }
      }
    }
  }

  const itemsInOrder = Array.from(items.values()).sort((left, right) => left.name.localeCompare(right.name))

  return {
    blocks,
    blocksByCode,
    items,
    entities,
    recipes,
    blocksInCodeOrder,
    itemsInOrder,
    blockCodes,
  }
}
