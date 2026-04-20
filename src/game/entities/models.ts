import {
  Color3,
  Material,
  MeshBuilder,
  StandardMaterial,
  TransformNode,
  Vector3,
  Vector4,
} from '@babylonjs/core'
import type { Scene } from '@babylonjs/core'
import { assetData } from '../data/assets'
import { createDistanceAwareTexture } from '../render/texture'
import type { ParsedEntityModel } from '../types'

interface EntityVisual {
  root: TransformNode
  pivots: Map<string, TransformNode>
}

const parseFloatLiteral = (value: string): number => Number(value.replace(/F$/, ''))

export const parseJavaEntityModel = (raw: string): ParsedEntityModel => {
  const dimensionsMatch = raw.match(/return\s+fyq\.a\(\$\$0,\s*(\d+),\s*(\d+)\);/)
  const width = dimensionsMatch ? Number(dimensionsMatch[1]) : 64
  const height = dimensionsMatch ? Number(dimensionsMatch[2]) : 32
  const parts: ParsedEntityModel['parts'] = []
  const shapes = new Map<
    string,
    {
      offset: { x: number; y: number; z: number }
      size: { x: number; y: number; z: number }
      textureOffset: { x: number; y: number }
      mirror: boolean
    }
  >()

  const shapeRegex =
    /fyp\s+(\$\$\d+)\s*=\s*fyp\.c\(\)\.a\((\d+),\s*(\d+)\)((?:\.a\(\))?)\.a\(([-\d.]+)F?,\s*([-\d.]+)F?,\s*([-\d.]+)F?,\s*([-\d.]+)F?,\s*([-\d.]+)F?,\s*([-\d.]+)F?\);/g
  let shapeMatch: RegExpExecArray | null
  while ((shapeMatch = shapeRegex.exec(raw))) {
    shapes.set(shapeMatch[1], {
      textureOffset: {
        x: Number(shapeMatch[2]),
        y: Number(shapeMatch[3]),
      },
      mirror: shapeMatch[4] === '.a()',
      offset: {
        x: parseFloatLiteral(shapeMatch[5]),
        y: parseFloatLiteral(shapeMatch[6]),
        z: parseFloatLiteral(shapeMatch[7]),
      },
      size: {
        x: parseFloatLiteral(shapeMatch[8]),
        y: parseFloatLiteral(shapeMatch[9]),
        z: parseFloatLiteral(shapeMatch[10]),
      },
    })
  }

  const inlineRegex =
    /a\("([^"]+)",\s*fyp\.c\(\)((?:\.a\(\))?)\s*\.a\((\d+),\s*(\d+)\)\.a\(([-\d.]+)F?,\s*([-\d.]+)F?,\s*([-\d.]+)F?,\s*([-\d.]+)F?,\s*([-\d.]+)F?,\s*([-\d.]+)F?\),\s*fym\.a\(([-\d.]+)F?,\s*([-\d.]+)F?,\s*([-\d.]+)F?(?:,\s*([-\d.]+)F?,\s*([-\d.]+)F?,\s*([-\d.]+)F?)?\)\);/gs
  let inlineMatch: RegExpExecArray | null
  while ((inlineMatch = inlineRegex.exec(raw))) {
    parts.push({
      name: inlineMatch[1],
      textureOffset: {
        x: Number(inlineMatch[3]),
        y: Number(inlineMatch[4]),
      },
      mirror: inlineMatch[2] === '.a()',
      offset: {
        x: parseFloatLiteral(inlineMatch[5]),
        y: parseFloatLiteral(inlineMatch[6]),
        z: parseFloatLiteral(inlineMatch[7]),
      },
      size: {
        x: parseFloatLiteral(inlineMatch[8]),
        y: parseFloatLiteral(inlineMatch[9]),
        z: parseFloatLiteral(inlineMatch[10]),
      },
      pivot: {
        x: parseFloatLiteral(inlineMatch[11]),
        y: parseFloatLiteral(inlineMatch[12]),
        z: parseFloatLiteral(inlineMatch[13]),
      },
      rotation: {
        x: inlineMatch[14] ? parseFloatLiteral(inlineMatch[14]) : 0,
        y: inlineMatch[15] ? parseFloatLiteral(inlineMatch[15]) : 0,
        z: inlineMatch[16] ? parseFloatLiteral(inlineMatch[16]) : 0,
      },
    })
  }

  const referenceRegex =
    /a\("([^"]+)",\s*(\$\$\d+),\s*fym\.a\(([-\d.]+)F?,\s*([-\d.]+)F?,\s*([-\d.]+)F?(?:,\s*[-\d.]+F?,\s*[-\d.]+F?,\s*[-\d.]+F?)?\)\);/g
  let referenceMatch: RegExpExecArray | null
  while ((referenceMatch = referenceRegex.exec(raw))) {
    const shape = shapes.get(referenceMatch[2])
    if (!shape) {
      continue
    }
    parts.push({
      name: referenceMatch[1],
      offset: { ...shape.offset },
      size: { ...shape.size },
      textureOffset: { ...shape.textureOffset },
      mirror: shape.mirror,
      pivot: {
        x: parseFloatLiteral(referenceMatch[3]),
        y: parseFloatLiteral(referenceMatch[4]),
        z: parseFloatLiteral(referenceMatch[5]),
      },
      rotation: {
        x: 0,
        y: 0,
        z: 0,
      },
    })
  }

  return { width, height, parts }
}

const toFaceUv = (
  textureX: number,
  textureY: number,
  width: number,
  height: number,
  atlasWidth: number,
  atlasHeight: number,
): Vector4 =>
  new Vector4(
    textureX / atlasWidth,
    textureY / atlasHeight,
    (textureX + width) / atlasWidth,
    (textureY + height) / atlasHeight,
  )

const flipFaceUvX = (uv: Vector4): Vector4 => new Vector4(uv.z, uv.y, uv.x, uv.w)

const createCuboidFaceUvs = (model: ParsedEntityModel, part: ParsedEntityModel['parts'][number]): Vector4[] => {
  const width = part.size.x
  const height = part.size.y
  const depth = part.size.z
  const u = part.textureOffset.x
  const v = part.textureOffset.y

  const front = toFaceUv(u + depth, v + depth, width, height, model.width, model.height)
  const back = toFaceUv(u + depth + width + depth, v + depth, width, height, model.width, model.height)
  const right = toFaceUv(u + depth + width, v + depth, depth, height, model.width, model.height)
  const left = toFaceUv(u, v + depth, depth, height, model.width, model.height)
  const top = toFaceUv(u + depth, v, width, depth, model.width, model.height)
  const bottom = toFaceUv(u + depth + width, v, width, depth, model.width, model.height)

  if (!part.mirror) {
    return [front, back, right, left, top, bottom]
  }

  return [
    flipFaceUvX(front),
    flipFaceUvX(back),
    flipFaceUvX(left),
    flipFaceUvX(right),
    flipFaceUvX(top),
    flipFaceUvX(bottom),
  ]
}

const createSpiderCuboidFaceUvs = (
  textureX: number,
  textureY: number,
  width: number,
  height: number,
  depth: number,
  mirror: boolean,
): Vector4[] => {
  const front = toFaceUv(textureX + depth, textureY + depth, width, height, 64, 32)
  const back = toFaceUv(textureX + depth + width + depth, textureY + depth, width, height, 64, 32)
  const right = toFaceUv(textureX + depth + width, textureY + depth, depth, height, 64, 32)
  const left = toFaceUv(textureX, textureY + depth, depth, height, 64, 32)
  const top = toFaceUv(textureX + depth, textureY, width, depth, 64, 32)
  const bottom = toFaceUv(textureX + depth + width, textureY, width, depth, 64, 32)

  if (!mirror) {
    // Babylon boxes expose faces in the order +Z, -Z, +X, -X, +Y, -Y.
    // Minecraft entity cuboids define front as -Z and right as -X.
    return [back, front, left, right, top, bottom]
  }

  return [
    flipFaceUvX(back),
    flipFaceUvX(front),
    flipFaceUvX(right),
    flipFaceUvX(left),
    flipFaceUvX(top),
    flipFaceUvX(bottom),
  ]
}

const createGeneratedGodzillaTexture = (): string => {
  const canvas = document.createElement('canvas')
  canvas.width = 64
  canvas.height = 64
  const context = canvas.getContext('2d')
  if (!context) {
    throw new Error('Unable to create Godzilla texture')
  }
  context.fillStyle = '#204730'
  context.fillRect(0, 0, 64, 64)
  context.fillStyle = '#3e7b49'
  for (let y = 0; y < 64; y += 8) {
    for (let x = (y / 8) % 2 === 0 ? 0 : 4; x < 64; x += 8) {
      context.fillRect(x, y, 4, 4)
    }
  }
  context.fillStyle = '#d8ddb8'
  context.fillRect(24, 8, 16, 10)
  context.fillStyle = '#f08e55'
  context.fillRect(22, 16, 20, 4)
  return canvas.toDataURL('image/png')
}

const createTextureMaterial = (scene: Scene, name: string, textureUrl: string): StandardMaterial => {
  const material = new StandardMaterial(name, scene)
  const texture = createDistanceAwareTexture(textureUrl, scene)
  texture.hasAlpha = true
  material.diffuseTexture = texture
  material.diffuseColor = Color3.White()
  material.emissiveColor = Color3.Black()
  material.ambientColor = Color3.White()
  material.specularColor = Color3.Black()
  material.backFaceCulling = false
  material.useAlphaFromDiffuseTexture = true
  material.transparencyMode = Material.MATERIAL_ALPHATEST
  material.alphaCutOff = 0.5
  return material
}

const buildVisualFromModel = (
  scene: Scene,
  model: ParsedEntityModel,
  textureUrl: string,
  rootName: string,
): EntityVisual => {
  const root = new TransformNode(rootName, scene)
  const material = createTextureMaterial(scene, `${rootName}-material`, textureUrl)
  const pivots = new Map<string, TransformNode>()

  for (const part of model.parts) {
    const pivot = new TransformNode(`${rootName}-${part.name}`, scene)
    pivot.parent = root
    pivot.position.set(part.pivot.x / 16, (24 - part.pivot.y) / 16, part.pivot.z / 16)
    pivot.rotation.set(part.rotation.x, part.rotation.y, part.rotation.z)

    const mesh = MeshBuilder.CreateBox(
      `${rootName}-${part.name}-mesh`,
      {
        width: part.size.x / 16,
        height: part.size.y / 16,
        depth: part.size.z / 16,
        faceUV: createCuboidFaceUvs(model, part),
      },
      scene,
    )
    mesh.parent = pivot
    mesh.material = material
    mesh.isPickable = false
    mesh.renderingGroupId = 0
    mesh.position.set(
      (part.offset.x + part.size.x / 2) / 16,
      -(part.offset.y + part.size.y / 2) / 16,
      (part.offset.z + part.size.z / 2) / 16,
    )
    pivots.set(part.name, pivot)
  }

  return { root, pivots }
}

const buildSpiderVisual = (scene: Scene, textureUrl: string): EntityVisual => {
  const S = 1 / 16
  const root = new TransformNode('spider', scene)
  const modelRoot = new TransformNode('spider-model', scene)
  modelRoot.parent = root
  modelRoot.rotation.y = Math.PI
  const material = createTextureMaterial(scene, 'spider-material', textureUrl)
  const pivots = new Map<string, TransformNode>()

  const buildBox = (
    name: string,
    width: number,
    height: number,
    depth: number,
    textureX: number,
    textureY: number,
    mirror: boolean,
  ) => {
    const faceUV = createSpiderCuboidFaceUvs(textureX, textureY, width, height, depth, mirror)
    return MeshBuilder.CreateBox(
      `spider-${name}-mesh`,
      { width: width * S, height: height * S, depth: depth * S, faceUV },
      scene,
    )
  }

  const part = (
    name: string,
    textureX: number,
    textureY: number,
    offsetX: number,
    offsetY: number,
    offsetZ: number,
    sizeX: number,
    sizeY: number,
    sizeZ: number,
    pivotX: number,
    pivotY: number,
    pivotZ: number,
    rotationX = 0,
    rotationY = 0,
    rotationZ = 0,
    mirror = false,
  ) => {
    const pivot = new TransformNode(`spider-${name}`, scene)
    pivot.parent = modelRoot
    pivot.position.set(pivotX * S, (24 - pivotY) * S, pivotZ * S)
    pivot.rotation.set(rotationX, rotationY, rotationZ)

    const mesh = buildBox(name, sizeX, sizeY, sizeZ, textureX, textureY, mirror)
    mesh.parent = pivot
    mesh.material = material
    mesh.isPickable = false
    mesh.renderingGroupId = 0
    mesh.position.set(
      (offsetX + sizeX / 2) * S,
      -(offsetY + sizeY / 2) * S,
      (offsetZ + sizeZ / 2) * S,
    )
    pivots.set(name, pivot)
  }

  const PI4 = Math.PI / 4
  const A = 0.58119464
  const PI8 = Math.PI / 8

  part('head', 32, 4, -4, -4, -8, 8, 8, 8, 0, 15, -3)
  part('body0', 0, 0, -3, -3, -3, 6, 6, 6, 0, 15, 0)
  part('body1', 0, 12, -5, -4, -6, 10, 8, 12, 0, 15, 9)

  part('right_hind_leg', 18, 0, -15, -1, -1, 16, 2, 2, -4, 15, 2, 0, PI4, PI4)
  part('left_hind_leg', 18, 0, -1, -1, -1, 16, 2, 2, 4, 15, 2, 0, -PI4, -PI4, true)
  part('right_middle_hind_leg', 18, 0, -15, -1, -1, 16, 2, 2, -4, 15, 1, 0, PI8, A)
  part('left_middle_hind_leg', 18, 0, -1, -1, -1, 16, 2, 2, 4, 15, 1, 0, -PI8, -A, true)
  part('right_middle_front_leg', 18, 0, -15, -1, -1, 16, 2, 2, -4, 15, 0, 0, -PI8, A)
  part('left_middle_front_leg', 18, 0, -1, -1, -1, 16, 2, 2, 4, 15, 0, 0, PI8, -A, true)
  part('right_front_leg', 18, 0, -15, -1, -1, 16, 2, 2, -4, 15, -1, 0, -PI4, PI4)
  part('left_front_leg', 18, 0, -1, -1, -1, 16, 2, 2, 4, 15, -1, 0, PI4, -PI4, true)

  return { root, pivots }
}

export const createEntityVisual = (
  scene: Scene,
  entityId: 'chicken' | 'spider' | 'godzilla',
  textureUrl?: string,
): EntityVisual => {
  if (entityId === 'spider') {
    return buildSpiderVisual(scene, textureUrl ?? '')
  }
  if (entityId === 'godzilla') {
    const godzillaTexture = createGeneratedGodzillaTexture()
    const material = createTextureMaterial(scene, 'godzilla-material', godzillaTexture)
    const root = new TransformNode('godzilla-root', scene)
    const pivots = new Map<string, TransformNode>()
    const parts = [
      { name: 'body', size: new Vector3(1.4, 1.8, 0.9), pos: new Vector3(0, 1.7, 0) },
      { name: 'head', size: new Vector3(0.9, 0.8, 1), pos: new Vector3(0, 3.1, 0.25) },
      { name: 'arm_left', size: new Vector3(0.35, 1.1, 0.35), pos: new Vector3(0.95, 2.1, 0.1) },
      { name: 'arm_right', size: new Vector3(0.35, 1.1, 0.35), pos: new Vector3(-0.95, 2.1, 0.1) },
      { name: 'leg_left', size: new Vector3(0.45, 1.4, 0.45), pos: new Vector3(0.35, 0.7, 0.05) },
      { name: 'leg_right', size: new Vector3(0.45, 1.4, 0.45), pos: new Vector3(-0.35, 0.7, 0.05) },
      {
        name: 'tail',
        size: new Vector3(0.55, 0.55, 2.8),
        pos: new Vector3(0, 1.8, 0.35),
        meshOffset: new Vector3(0, 0, 1.4),
      },
    ]
    for (const part of parts) {
      const pivot = new TransformNode(`godzilla-${part.name}`, scene)
      pivot.parent = root
      pivot.position.copyFrom(part.pos)
      const mesh = MeshBuilder.CreateBox(
        `godzilla-${part.name}-mesh`,
        { width: part.size.x, height: part.size.y, depth: part.size.z },
        scene,
      )
      mesh.parent = pivot
      if ('meshOffset' in part && part.meshOffset) {
        mesh.position.copyFrom(part.meshOffset)
      }
      mesh.material = material
      mesh.renderingGroupId = 0
      pivots.set(part.name, pivot)
    }
    return { root, pivots }
  }

  const modelRaw = entityId === 'chicken' ? assetData.entityModels.chicken : assetData.entityModels.spider
  const parsed = parseJavaEntityModel(modelRaw)
  return buildVisualFromModel(scene, parsed, textureUrl ?? '', entityId)
}
