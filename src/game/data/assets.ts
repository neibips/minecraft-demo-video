import blocksRaw from '../../../assets/blocks.txt?raw'
import entitiesData from '../../../assets/entities.json'
import itemsData from '../../../assets/items.json'
import recipesData from '../../../assets/recipes.json'
import chickenModelRaw from '../../../assets/models/ChickenEntityModal.class.txt?raw'
import spiderModelRaw from '../../../assets/models/ModelSpider.txt?raw'
import vanillaBookshelfTexture from '../../../assets/textures-vanilla/block/bookshelf.png?url'
import vanillaCobblestoneTexture from '../../../assets/textures-vanilla/block/cobblestone.png?url'
import vanillaDarkOakPlanksTexture from '../../../assets/textures-vanilla/block/dark_oak_planks.png?url'
import vanillaMossyCobblestoneTexture from '../../../assets/textures-vanilla/block/mossy_cobblestone.png?url'
import vanillaOakDoorBottomTexture from '../../../assets/textures-vanilla/block/oak_door_bottom.png?url'
import vanillaOakDoorTopTexture from '../../../assets/textures-vanilla/block/oak_door_top.png?url'
import vanillaOakPlanksTexture from '../../../assets/textures-vanilla/block/oak_planks.png?url'
import vanillaStoneBricksTexture from '../../../assets/textures-vanilla/block/stone_bricks.png?url'
import vanillaTorchTexture from '../../../assets/textures-vanilla/block/torch.png?url'
import vanillaWaterTexture from '../../../assets/textures-vanilla/block/water_still.png?url'

const customTextureImports = import.meta.glob('../../../assets/textures/**/*.{png,jpg,jpeg,webp}', {
  eager: true,
  query: '?url',
  import: 'default',
}) as Record<string, string>

const vanillaStructureTextureImports: Record<string, string> = {
  '../../../assets/textures-vanilla/block/bookshelf.png': vanillaBookshelfTexture,
  '../../../assets/textures-vanilla/block/cobblestone.png': vanillaCobblestoneTexture,
  '../../../assets/textures-vanilla/block/dark_oak_planks.png': vanillaDarkOakPlanksTexture,
  '../../../assets/textures-vanilla/block/mossy_cobblestone.png': vanillaMossyCobblestoneTexture,
  '../../../assets/textures-vanilla/block/oak_door_bottom.png': vanillaOakDoorBottomTexture,
  '../../../assets/textures-vanilla/block/oak_door_top.png': vanillaOakDoorTopTexture,
  '../../../assets/textures-vanilla/block/oak_planks.png': vanillaOakPlanksTexture,
  '../../../assets/textures-vanilla/block/stone_bricks.png': vanillaStoneBricksTexture,
  '../../../assets/textures-vanilla/block/torch.png': vanillaTorchTexture,
  '../../../assets/textures-vanilla/block/water_still.png': vanillaWaterTexture,
}

const textureImports = {
  ...customTextureImports,
  ...vanillaStructureTextureImports,
}

export const assetData = {
  blocksRaw,
  itemsData: itemsData as Record<string, Record<string, unknown>>,
  entitiesData: entitiesData as Record<string, Record<string, unknown>>,
  recipesData: recipesData as Record<string, Record<string, unknown>>,
  entityModels: {
    chicken: chickenModelRaw,
    spider: spiderModelRaw,
  },
  textureImports,
}

export const normalizeAssetPath = (value: string): string =>
  value.replace(/^\//, '').replace(/^assets\//, '')

export const resolveAssetTexture = (value: string): string | undefined => {
  const normalized = normalizeAssetPath(value)
  const exactMatch = Object.entries(textureImports).find(([path]) => path.endsWith(normalized))
  return exactMatch?.[1]
}
