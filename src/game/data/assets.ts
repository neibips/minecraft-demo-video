import blocksRaw from '../../../assets/blocks.txt?raw'
import entitiesData from '../../../assets/entities.json'
import itemsData from '../../../assets/items.json'
import recipesData from '../../../assets/recipes.json'
import chickenModelRaw from '../../../assets/models/ChickenEntityModal.class.txt?raw'
import spiderModelRaw from '../../../assets/models/ModelSpider.txt?raw'

const customTextureImports = import.meta.glob('../../../assets/textures/**/*.{png,jpg,jpeg,webp}', {
  eager: true,
  query: '?url',
  import: 'default',
}) as Record<string, string>

const vanillaWaterTextureImports = import.meta.glob('../../../assets/textures-vanilla/block/water_still.png', {
  eager: true,
  query: '?url',
  import: 'default',
}) as Record<string, string>

const textureImports = {
  ...customTextureImports,
  ...vanillaWaterTextureImports,
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
