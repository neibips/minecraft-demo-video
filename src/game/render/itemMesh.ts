import {
  Color3,
  Material,
  Mesh,
  MeshBuilder,
  StandardMaterial,
  Texture,
  Vector4,
  VertexData,
} from '@babylonjs/core'
import type { Scene } from '@babylonjs/core'
import type { BlockAtlas, BlockDefinition } from '../types'

const DEFAULT_THICKNESS = 1 / 16

const loadImage = (url: string): Promise<HTMLImageElement> =>
  new Promise((resolve, reject) => {
    const image = new Image()
    image.crossOrigin = 'anonymous'
    image.onload = () => resolve(image)
    image.onerror = () => reject(new Error(`Failed to load texture ${url}`))
    image.src = url
  })

const readImagePixels = (image: HTMLImageElement): Uint8ClampedArray => {
  const canvas = document.createElement('canvas')
  canvas.width = image.naturalWidth
  canvas.height = image.naturalHeight
  const context = canvas.getContext('2d', { willReadFrequently: true })
  if (!context) {
    throw new Error('Unable to read item texture pixels')
  }
  context.imageSmoothingEnabled = false
  context.drawImage(image, 0, 0)
  return context.getImageData(0, 0, canvas.width, canvas.height).data
}

export const createHeldItemMaterial = (scene: Scene, name: string, textureUrl: string): StandardMaterial => {
  const material = new StandardMaterial(name, scene)
  const texture = new Texture(textureUrl, scene, true, false, Texture.NEAREST_SAMPLINGMODE)
  texture.hasAlpha = true
  texture.updateSamplingMode(Texture.NEAREST_SAMPLINGMODE)
  texture.wrapU = Texture.CLAMP_ADDRESSMODE
  texture.wrapV = Texture.CLAMP_ADDRESSMODE
  material.diffuseTexture = texture
  material.emissiveColor = new Color3(0.9, 0.9, 0.9)
  material.specularColor = Color3.Black()
  material.disableLighting = false
  material.backFaceCulling = false
  material.useAlphaFromDiffuseTexture = true
  material.transparencyMode = Material.MATERIAL_ALPHATEST
  material.alphaCutOff = 0.5
  material.disableColorWrite = false
  return material
}

export const createHeldBlockMaterial = (scene: Scene, name: string, atlasUrl: string): StandardMaterial => {
  const material = new StandardMaterial(name, scene)
  const texture = new Texture(atlasUrl, scene, true, false, Texture.NEAREST_SAMPLINGMODE)
  material.diffuseTexture = texture
  material.emissiveColor = new Color3(0.8, 0.8, 0.8)
  material.specularColor = Color3.Black()
  material.backFaceCulling = true
  return material
}

const pickBlockFace = (block: BlockDefinition, face: keyof BlockDefinition['textures']): string | undefined => {
  const tx = block.textures
  return (
    tx[face] ??
    tx.side ??
    tx.all ??
    tx.front ??
    tx.top ??
    tx.bottom ??
    tx.left ??
    tx.right ??
    tx.back
  )
}

export const buildHeldBlockMesh = (
  scene: Scene,
  block: BlockDefinition,
  atlas: BlockAtlas,
  name = 'held-block',
): Mesh => {
  const fallback = new Vector4(0, 0, 1, 1)
  const faceOrder: Array<keyof BlockDefinition['textures']> = [
    'front',
    'back',
    'right',
    'left',
    'top',
    'bottom',
  ]
  const faceUV = faceOrder.map((face) => {
    const key = pickBlockFace(block, face)
    if (!key) return fallback
    const region = atlas.regions[key]
    if (!region) return fallback
    return new Vector4(region.u0, region.v0, region.u1, region.v1)
  })
  return MeshBuilder.CreateBox(name, { size: 1, faceUV, wrap: true }, scene)
}

export interface ExtrudedItemMeshOptions {
  thickness?: number
  name?: string
}

export const buildExtrudedItemMesh = async (
  scene: Scene,
  textureUrl: string,
  options: ExtrudedItemMeshOptions = {},
): Promise<Mesh> => {
  const image = await loadImage(textureUrl)
  const pixels = readImagePixels(image)
  const width = image.naturalWidth
  const height = image.naturalHeight
  const thickness = options.thickness ?? DEFAULT_THICKNESS
  const cell = 1 / Math.max(width, height)
  const halfT = thickness / 2

  const positions: number[] = []
  const indices: number[] = []
  const normals: number[] = []
  const uvs: number[] = []

  const isOpaque = (x: number, y: number): boolean => {
    if (x < 0 || x >= width || y < 0 || y >= height) return false
    return pixels[(y * width + x) * 4 + 3] >= 128
  }

  const originX = (-width * cell) / 2
  const originY = (-height * cell) / 2

  const pushQuad = (
    verts: number[],
    normal: [number, number, number],
    uvQuad: number[],
  ): void => {
    const baseIndex = positions.length / 3
    for (let i = 0; i < 12; i += 1) positions.push(verts[i])
    for (let i = 0; i < 4; i += 1) {
      normals.push(normal[0], normal[1], normal[2])
    }
    for (let i = 0; i < 8; i += 1) uvs.push(uvQuad[i])
    indices.push(baseIndex, baseIndex + 1, baseIndex + 2, baseIndex, baseIndex + 2, baseIndex + 3)
  }

  for (let py = 0; py < height; py += 1) {
    for (let px = 0; px < width; px += 1) {
      if (!isOpaque(px, py)) continue

      const x0 = originX + px * cell
      const x1 = x0 + cell
      const y1 = originY + (height - py) * cell
      const y0 = y1 - cell
      const z0 = -halfT
      const z1 = halfT

      const u0 = px / width
      const u1 = (px + 1) / width
      const v0 = py / height
      const v1 = (py + 1) / height
      const uc = (px + 0.5) / width
      const vc = (py + 0.5) / height

      pushQuad(
        [x0, y0, z1, x1, y0, z1, x1, y1, z1, x0, y1, z1],
        [0, 0, 1],
        [u0, v1, u1, v1, u1, v0, u0, v0],
      )

      pushQuad(
        [x1, y0, z0, x0, y0, z0, x0, y1, z0, x1, y1, z0],
        [0, 0, -1],
        [u1, v1, u0, v1, u0, v0, u1, v0],
      )

      if (!isOpaque(px - 1, py)) {
        pushQuad(
          [x0, y0, z0, x0, y0, z1, x0, y1, z1, x0, y1, z0],
          [-1, 0, 0],
          [uc, vc, uc, vc, uc, vc, uc, vc],
        )
      }
      if (!isOpaque(px + 1, py)) {
        pushQuad(
          [x1, y0, z1, x1, y0, z0, x1, y1, z0, x1, y1, z1],
          [1, 0, 0],
          [uc, vc, uc, vc, uc, vc, uc, vc],
        )
      }
      if (!isOpaque(px, py - 1)) {
        pushQuad(
          [x0, y1, z1, x1, y1, z1, x1, y1, z0, x0, y1, z0],
          [0, 1, 0],
          [uc, vc, uc, vc, uc, vc, uc, vc],
        )
      }
      if (!isOpaque(px, py + 1)) {
        pushQuad(
          [x0, y0, z0, x1, y0, z0, x1, y0, z1, x0, y0, z1],
          [0, -1, 0],
          [uc, vc, uc, vc, uc, vc, uc, vc],
        )
      }
    }
  }

  const mesh = new Mesh(options.name ?? 'extruded-item', scene)
  const vertexData = new VertexData()
  vertexData.positions = positions
  vertexData.indices = indices
  vertexData.normals = normals
  vertexData.uvs = uvs
  vertexData.applyToMesh(mesh)
  mesh.isPickable = false
  return mesh
}
