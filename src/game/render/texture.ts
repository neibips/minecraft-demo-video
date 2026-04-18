import { Texture } from '@babylonjs/core'
import type { Scene } from '@babylonjs/core'

const DISTANCE_TEXTURE_SAMPLING_MODE = Texture.NEAREST_NEAREST_MIPLINEAR
const MAX_ANISOTROPY_LEVEL = 8

export const createDistanceAwareTexture = (url: string, scene: Scene): Texture => {
  const texture = new Texture(url, scene, false, false, DISTANCE_TEXTURE_SAMPLING_MODE)
  // Keep voxel textures crisp up close while reducing distant shimmer and moire.
  texture.updateSamplingMode(DISTANCE_TEXTURE_SAMPLING_MODE)
  texture.wrapU = Texture.CLAMP_ADDRESSMODE
  texture.wrapV = Texture.CLAMP_ADDRESSMODE
  texture.anisotropicFilteringLevel = Math.min(
    MAX_ANISOTROPY_LEVEL,
    scene.getEngine().getCaps().maxAnisotropy || 1,
  )
  return texture
}
