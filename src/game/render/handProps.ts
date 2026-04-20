import {
  Color3,
  Color4,
  DynamicTexture,
  Mesh,
  MeshBuilder,
  ParticleSystem,
  StandardMaterial,
  TransformNode,
  Vector3,
} from '@babylonjs/core'
import type { Scene } from '@babylonjs/core'

const createSoftTexture = (
  scene: Scene,
  name: string,
  r: number,
  g: number,
  b: number,
): DynamicTexture => {
  const size = 64
  const tex = new DynamicTexture(name, { width: size, height: size }, scene, false)
  tex.hasAlpha = true
  const ctx = tex.getContext() as CanvasRenderingContext2D
  ctx.clearRect(0, 0, size, size)
  const grad = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2)
  grad.addColorStop(0, `rgba(${r}, ${g}, ${b}, 1)`)
  grad.addColorStop(0.5, `rgba(${r}, ${g}, ${b}, 0.55)`)
  grad.addColorStop(1, `rgba(${r}, ${g}, ${b}, 0)`)
  ctx.fillStyle = grad
  ctx.fillRect(0, 0, size, size)
  tex.update()
  return tex
}

export interface CigaretteModel {
  root: TransformNode
  ember: Mesh
  emberMaterial: StandardMaterial
  tipAnchor: Mesh
  dispose: () => void
}

export const buildCigaretteModel = (scene: Scene, name = 'held-cigarette'): CigaretteModel => {
  const root = new TransformNode(`${name}-root`, scene)

  const totalLength = 1.0
  const radius = 0.06
  const filterLength = 0.24
  const bodyLength = 0.72
  const emberLength = 0.04

  const bodyMat = new StandardMaterial(`${name}-body-mat`, scene)
  bodyMat.diffuseColor = new Color3(0.97, 0.95, 0.88)
  bodyMat.emissiveColor = new Color3(0.55, 0.55, 0.5)
  bodyMat.specularColor = Color3.Black()

  const filterMat = new StandardMaterial(`${name}-filter-mat`, scene)
  filterMat.diffuseColor = new Color3(0.83, 0.55, 0.22)
  filterMat.emissiveColor = new Color3(0.42, 0.28, 0.12)
  filterMat.specularColor = Color3.Black()

  const stripeMat = new StandardMaterial(`${name}-stripe-mat`, scene)
  stripeMat.diffuseColor = new Color3(0.6, 0.38, 0.15)
  stripeMat.emissiveColor = new Color3(0.28, 0.18, 0.07)
  stripeMat.specularColor = Color3.Black()

  const emberMat = new StandardMaterial(`${name}-ember-mat`, scene)
  emberMat.diffuseColor = new Color3(0.1, 0.08, 0.06)
  emberMat.emissiveColor = new Color3(0.08, 0.06, 0.04)
  emberMat.specularColor = Color3.Black()

  const filter = MeshBuilder.CreateCylinder(
    `${name}-filter`,
    { height: filterLength, diameter: radius * 2.04, tessellation: 18 },
    scene,
  )
  filter.position.y = -totalLength / 2 + filterLength / 2
  filter.material = filterMat

  const filterStripe = MeshBuilder.CreateCylinder(
    `${name}-filter-stripe`,
    { height: 0.022, diameter: radius * 2.08, tessellation: 18 },
    scene,
  )
  filterStripe.position.y = -totalLength / 2 + filterLength - 0.011
  filterStripe.material = stripeMat

  const body = MeshBuilder.CreateCylinder(
    `${name}-body`,
    { height: bodyLength, diameter: radius * 2, tessellation: 18 },
    scene,
  )
  body.position.y = -totalLength / 2 + filterLength + bodyLength / 2
  body.material = bodyMat

  const ember = MeshBuilder.CreateCylinder(
    `${name}-ember`,
    {
      height: emberLength,
      diameterTop: radius * 1.6,
      diameterBottom: radius * 2,
      tessellation: 18,
    },
    scene,
  )
  ember.position.y = totalLength / 2 - emberLength / 2
  ember.material = emberMat

  const tipAnchor = MeshBuilder.CreateBox(`${name}-tip-anchor`, { size: 0.001 }, scene)
  tipAnchor.isVisible = false
  tipAnchor.isPickable = false
  tipAnchor.position.y = totalLength / 2 + 0.02

  const children: Mesh[] = [filter, filterStripe, body, ember, tipAnchor]
  for (const mesh of children) {
    mesh.isPickable = false
    mesh.parent = root
  }

  const materials = [bodyMat, filterMat, stripeMat, emberMat]

  const dispose = (): void => {
    for (const mesh of children) mesh.dispose()
    for (const mat of materials) mat.dispose()
    root.dispose()
  }

  return { root, ember, emberMaterial: emberMat, tipAnchor, dispose }
}

export interface LighterModel {
  root: TransformNode
  flameAnchor: Mesh
  flameMesh: Mesh
  flameMaterial: StandardMaterial
  dispose: () => void
}

export const buildLighterModel = (scene: Scene, name = 'held-lighter'): LighterModel => {
  const root = new TransformNode(`${name}-root`, scene)

  const bodyMat = new StandardMaterial(`${name}-body-mat`, scene)
  bodyMat.diffuseColor = new Color3(0.82, 0.13, 0.07)
  bodyMat.emissiveColor = new Color3(0.34, 0.07, 0.04)
  bodyMat.specularColor = new Color3(0.45, 0.45, 0.45)

  const chromeMat = new StandardMaterial(`${name}-chrome-mat`, scene)
  chromeMat.diffuseColor = new Color3(0.78, 0.78, 0.82)
  chromeMat.emissiveColor = new Color3(0.38, 0.38, 0.42)
  chromeMat.specularColor = new Color3(0.9, 0.9, 0.9)

  const sparkMat = new StandardMaterial(`${name}-spark-mat`, scene)
  sparkMat.diffuseColor = new Color3(0.32, 0.32, 0.32)
  sparkMat.emissiveColor = new Color3(0.22, 0.22, 0.24)
  sparkMat.specularColor = Color3.Black()

  const flameMat = new StandardMaterial(`${name}-flame-mat`, scene)
  flameMat.diffuseColor = new Color3(1, 0.65, 0.18)
  flameMat.emissiveColor = new Color3(1, 0.55, 0.15)
  flameMat.specularColor = Color3.Black()
  flameMat.alpha = 0.85

  const body = MeshBuilder.CreateBox(
    `${name}-body`,
    { width: 0.24, height: 0.44, depth: 0.14 },
    scene,
  )
  body.material = bodyMat
  body.position.y = -0.1

  const hood = MeshBuilder.CreateBox(
    `${name}-hood`,
    { width: 0.25, height: 0.1, depth: 0.15 },
    scene,
  )
  hood.material = chromeMat
  hood.position.y = 0.16

  const wheel = MeshBuilder.CreateCylinder(
    `${name}-wheel`,
    { height: 0.1, diameter: 0.07, tessellation: 12 },
    scene,
  )
  wheel.rotation.z = Math.PI / 2
  wheel.position.set(0.0, 0.25, 0)
  wheel.material = sparkMat

  const flameMesh = MeshBuilder.CreateSphere(
    `${name}-flame`,
    { diameterY: 0.26, diameterX: 0.12, diameterZ: 0.12, segments: 10 },
    scene,
  )
  flameMesh.material = flameMat
  flameMesh.position.set(0, 0.36, 0)
  flameMesh.isVisible = false

  const flameAnchor = MeshBuilder.CreateBox(`${name}-flame-anchor`, { size: 0.001 }, scene)
  flameAnchor.isVisible = false
  flameAnchor.isPickable = false
  flameAnchor.position.set(0, 0.4, 0)

  const children: Mesh[] = [body, hood, wheel, flameMesh, flameAnchor]
  for (const mesh of children) {
    mesh.isPickable = false
    mesh.parent = root
  }

  const materials = [bodyMat, chromeMat, sparkMat, flameMat]

  const dispose = (): void => {
    for (const mesh of children) mesh.dispose()
    for (const mat of materials) mat.dispose()
    root.dispose()
  }

  return { root, flameAnchor, flameMesh, flameMaterial: flameMat, dispose }
}

export const createSmokeParticleSystem = (
  scene: Scene,
  emitter: Mesh,
  name = 'cigarette-smoke',
): ParticleSystem => {
  const system = new ParticleSystem(name, 260, scene)
  system.particleTexture = createSoftTexture(scene, `${name}-tex`, 222, 222, 224)
  system.emitter = emitter
  system.minEmitBox = new Vector3(-0.01, 0, -0.01)
  system.maxEmitBox = new Vector3(0.01, 0.015, 0.01)
  system.color1 = new Color4(0.95, 0.95, 0.96, 0.88)
  system.color2 = new Color4(0.76, 0.76, 0.8, 0.68)
  system.colorDead = new Color4(0.6, 0.6, 0.62, 0)
  system.minSize = 0.08
  system.maxSize = 0.34
  system.minLifeTime = 1.4
  system.maxLifeTime = 2.8
  system.emitRate = 46
  system.blendMode = ParticleSystem.BLENDMODE_STANDARD
  system.gravity = new Vector3(0, 0.55, 0)
  system.direction1 = new Vector3(-0.2, 0.8, -0.16)
  system.direction2 = new Vector3(0.2, 1.2, 0.16)
  system.minEmitPower = 0.3
  system.maxEmitPower = 0.85
  system.minAngularSpeed = -1.5
  system.maxAngularSpeed = 1.5
  system.updateSpeed = 0.01
  return system
}

export const createLighterFlameParticleSystem = (
  scene: Scene,
  emitter: Mesh,
  name = 'lighter-flame-particles',
): ParticleSystem => {
  const system = new ParticleSystem(name, 140, scene)
  system.particleTexture = createSoftTexture(scene, `${name}-tex`, 255, 180, 70)
  system.emitter = emitter
  system.minEmitBox = new Vector3(-0.01, 0, -0.01)
  system.maxEmitBox = new Vector3(0.01, 0.02, 0.01)
  system.color1 = new Color4(1, 0.88, 0.35, 1)
  system.color2 = new Color4(1, 0.45, 0.1, 0.9)
  system.colorDead = new Color4(0.5, 0.2, 0.1, 0)
  system.minSize = 0.05
  system.maxSize = 0.16
  system.minLifeTime = 0.14
  system.maxLifeTime = 0.32
  system.emitRate = 180
  system.blendMode = ParticleSystem.BLENDMODE_ADD
  system.gravity = new Vector3(0, 0.9, 0)
  system.direction1 = new Vector3(-0.08, 1, -0.08)
  system.direction2 = new Vector3(0.08, 1.3, 0.08)
  system.minEmitPower = 0.2
  system.maxEmitPower = 0.55
  return system
}
