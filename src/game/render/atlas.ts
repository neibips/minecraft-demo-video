import type { BlockAtlas, RegistryBundle } from '../types'

const loadImage = (url: string): Promise<HTMLImageElement> =>
  new Promise((resolve, reject) => {
    const image = new Image()
    image.onload = () => resolve(image)
    image.onerror = () => reject(new Error(`Failed to load texture ${url}`))
    image.src = url
  })

const nextPowerOfTwo = (value: number): number => {
  let result = 1
  while (result < value) {
    result *= 2
  }
  return result
}

export const buildBlockAtlas = async (registries: RegistryBundle): Promise<BlockAtlas> => {
  const textureKeys = new Set<string>()
  for (const block of registries.blocks.values()) {
    if (block.fluid) {
      continue
    }
    for (const texture of Object.values(block.textures)) {
      if (texture) {
        textureKeys.add(texture)
      }
    }
  }

  const textures = Array.from(textureKeys)
  const images = await Promise.all(textures.map((url) => loadImage(url)))
  const cellSize = Math.max(...images.map((image) => Math.max(image.naturalWidth, image.naturalHeight)))
  const columns = Math.max(1, Math.ceil(Math.sqrt(textures.length)))
  const rows = Math.max(1, Math.ceil(textures.length / columns))
  const width = nextPowerOfTwo(columns * cellSize)
  const height = nextPowerOfTwo(rows * cellSize)
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const context = canvas.getContext('2d')
  if (!context) {
    throw new Error('Unable to create atlas canvas context')
  }
  context.imageSmoothingEnabled = false

  const regions: BlockAtlas['regions'] = {}
  textures.forEach((texture, index) => {
    const column = index % columns
    const row = Math.floor(index / columns)
    const x = column * cellSize
    const y = row * cellSize
    context.drawImage(images[index], x, y, cellSize, cellSize)
    regions[texture] = {
      u0: x / width,
      v0: y / height,
      u1: (x + cellSize) / width,
      v1: (y + cellSize) / height,
    }
  })

  return {
    imageUrl: canvas.toDataURL('image/png'),
    regions,
    textureKeys: textures,
  }
}
