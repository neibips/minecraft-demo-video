import {
  Color3,
  MeshBuilder,
  StandardMaterial,
  TransformNode,
  UniversalCamera,
  Vector3,
} from '@babylonjs/core'
import type { Mesh, ParticleSystem, Scene } from '@babylonjs/core'
import {
  GRAVITY,
  JUMP_VELOCITY,
  MAX_HEALTH,
  PLAYER_EYE_HEIGHT,
  PLAYER_HEIGHT,
  PLAYER_WIDTH,
  SPRINT_SPEED,
  SWIM_SPEED,
  WALK_SPEED,
} from '../config'
import {
  buildExtrudedItemMesh,
  buildHeldBlockMesh,
  createHeldBlockMaterial,
  createHeldItemMaterial,
} from '../render/itemMesh'
import {
  buildCigaretteModel,
  buildLighterModel,
  createLighterFlameParticleSystem,
  createSmokeParticleSystem,
  type CigaretteModel,
  type LighterModel,
} from '../render/handProps'
import type { BlockAtlas, BlockDefinition, ItemDefinition, PlayerSave } from '../types'
import { clamp } from '../utils/math'
import { WorldManager } from '../world/worldManager'

type HeldKind = 'block' | 'tool' | 'sword' | 'gun' | 'item' | 'cigarette'

const CIGARETTE_SCALE = 0.24
const CIGARETTE_BASE_POSITION = new Vector3(-0.18, 0.22, 0.16)
const CIGARETTE_BASE_ROTATION = new Vector3(1.25, 0.3, 0.25)
const CIGARETTE_LIGHTING_POSITION = new Vector3(-0.2, 0.18, 0.17)
const CIGARETTE_LIGHTING_ROTATION = new Vector3(1.35, 0.2, 0.22)
const CIGARETTE_MOUTH_POSITION = new Vector3(-0.18, 0.22, 0.16)
const CIGARETTE_MOUTH_ROTATION = new Vector3(1.0, 0.28, 0.24)

const RIGHT_HAND_BASE_X = 0.38
const RIGHT_HAND_BASE_Y = -0.42
const RIGHT_HAND_BASE_Z = 0.78
const RIGHT_HAND_MOUTH_OFFSET_X = -0.05
const RIGHT_HAND_MOUTH_OFFSET_Y = 0.08
const RIGHT_HAND_MOUTH_OFFSET_Z = -0.16

const LEFT_HAND_BASE_POSITION = new Vector3(-0.38, -0.9, 0.6)
const LEFT_HAND_RAISED_POSITION = new Vector3(-0.05, -0.35, 0.68)
const LEFT_HAND_BASE_ROTATION = new Vector3(0.3, 0.25, 0.2)
const LEFT_HAND_RAISED_ROTATION = new Vector3(0.35, -0.45, -0.55)

const SMOKING_PHASE_LIGHTER_RISE = 0.65
const SMOKING_PHASE_FLAME_START = 0.45
const SMOKING_PHASE_FLAME_END = 1.35
const SMOKING_PHASE_LIGHTER_FALL = 2.0
const SMOKING_PHASE_MOUTH_RAISE_END = 2.75
const SMOKING_PHASE_SMOKE_HOLD_END = 5.4
const SMOKING_PHASE_RETURN_END = 6.3
const SMOKE_PARTICLES_FADE_OUT = 1.1

interface HeldTransform {
  position: Vector3
  rotation: Vector3
  scale: number
}

const NON_BLOCK_HELD_Y_OFFSET = 0.1
const MAX_STEP_HEIGHT = 0.6

const HELD_PRESETS: Record<HeldKind, HeldTransform> = {
  block: {
    position: new Vector3(0.06, 0.06, 0.22),
    rotation: new Vector3(-0.35, 0.55, 0.05),
    scale: 0.36,
  },
  tool: {
    position: new Vector3(0.01, 0.14, 0.2),
    rotation: new Vector3(-0.45, -0.35, 0.95),
    scale: 0.7,
  },
  sword: {
    position: new Vector3(0.08, -0.04 + NON_BLOCK_HELD_Y_OFFSET, 0.22),
    rotation: new Vector3(-0.4, -0.3, 0.9),
    scale: 0.7,
  },
  gun: {
    position: new Vector3(0.04, -0.03 + NON_BLOCK_HELD_Y_OFFSET, 0.28),
    rotation: new Vector3(-0.05, -0.12, 0.1),
    scale: 0.62,
  },
  item: {
    position: new Vector3(0.06, 0.08 + NON_BLOCK_HELD_Y_OFFSET, 0.22),
    rotation: new Vector3(-0.25, 0.35, 0.25),
    scale: 0.5,
  },
  cigarette: {
    position: CIGARETTE_BASE_POSITION.clone(),
    rotation: CIGARETTE_BASE_ROTATION.clone(),
    scale: CIGARETTE_SCALE,
  },
}

interface PlayerCallbacks {
  onToggleInventory: () => void
  onTogglePause: () => void
}

export class PlayerController {
  readonly camera: UniversalCamera
  readonly position = new Vector3(0, 0, 0)
  readonly velocity = new Vector3(0, 0, 0)
  health = MAX_HEALTH
  yaw = 0
  pitch = 0
  onGround = false

  private readonly canvas: HTMLCanvasElement
  private readonly scene: Scene
  private readonly world: WorldManager
  private readonly callbacks: PlayerCallbacks
  private readonly keys = new Set<string>()
  private readonly handRoot: TransformNode
  private readonly heldMount: TransformNode
  private readonly leftHandRoot: TransformNode
  private readonly leftArmMesh: Mesh
  private readonly armMesh
  private readonly armMaterial: StandardMaterial
  private readonly heldMaterials = new Map<string, StandardMaterial>()
  private readonly heldMeshes = new Map<string, Mesh>()
  private heldVisibleMesh: Mesh | null = null
  private currentHeldKey: string | null = null
  private atlas: BlockAtlas | null = null
  private blockLookup: ((itemId: string) => BlockDefinition | undefined) | null = null
  private itemLookup: ((itemId: string) => ItemDefinition | undefined) | null = null
  private uiCapturingInput = false
  private primaryDown = false
  private primaryPressed = false
  private secondaryQueued = false
  private swingTimer = 0
  private lastGroundY = 0
  private mouseSensitivity = 0.0024
  private currentHeight = PLAYER_HEIGHT
  private cigaretteModel: CigaretteModel | null = null
  private lighterModel: LighterModel | null = null
  private smokeParticles: ParticleSystem | null = null
  private lighterFlameParticles: ParticleSystem | null = null
  private smokingTime = -1
  private cigaretteActive = false
  private smokingMouthRaise = 0

  constructor(
    scene: Scene,
    canvas: HTMLCanvasElement,
    world: WorldManager,
    callbacks: PlayerCallbacks,
  ) {
    this.scene = scene
    this.canvas = canvas
    this.world = world
    this.callbacks = callbacks

    this.camera = new UniversalCamera('player-camera', new Vector3(0, 0, 0), scene)
    this.camera.inputs.clear()
    this.camera.minZ = 0.05
    this.camera.fov = 1.1
    scene.activeCamera = this.camera

    this.armMesh = MeshBuilder.CreateBox(
      'player-arm',
      { width: 0.18, height: 0.5, depth: 0.18 },
      scene,
    )
    this.armMaterial = new StandardMaterial('player-arm-material', scene)
    this.handRoot = new TransformNode('hand-root', scene)
    this.handRoot.parent = this.camera
    this.handRoot.position.set(0.42, -0.44, 0.82)
    this.handRoot.rotation.set(0.18, -0.22, 0)

    this.heldMount = new TransformNode('held-mount', scene)
    this.heldMount.parent = this.handRoot

    this.armMaterial.diffuseColor = new Color3(0.9, 0.75, 0.62)
    this.armMaterial.emissiveColor = new Color3(0.3, 0.22, 0.18)
    this.armMaterial.specularColor = Color3.Black()
    this.armMesh.parent = this.handRoot
    this.armMesh.material = this.armMaterial
    this.armMesh.position.set(-0.08, -0.05, 0.06)
    this.armMesh.rotation.set(0.2, 0.2, 0.2)

    this.leftHandRoot = new TransformNode('left-hand-root', scene)
    this.leftHandRoot.parent = this.camera
    this.leftHandRoot.position.copyFrom(LEFT_HAND_BASE_POSITION)
    this.leftHandRoot.rotation.copyFrom(LEFT_HAND_BASE_ROTATION)
    this.leftHandRoot.setEnabled(false)

    this.leftArmMesh = MeshBuilder.CreateBox(
      'player-left-arm',
      { width: 0.18, height: 0.5, depth: 0.18 },
      scene,
    )
    this.leftArmMesh.parent = this.leftHandRoot
    this.leftArmMesh.material = this.armMaterial
    this.leftArmMesh.position.set(0.08, -0.05, 0.06)
    this.leftArmMesh.rotation.set(0.2, -0.2, -0.2)
    this.leftArmMesh.isPickable = false

    this.registerEvents()
  }

  setResources(
    atlas: BlockAtlas,
    blockLookup: (itemId: string) => BlockDefinition | undefined,
    itemLookup: (itemId: string) => ItemDefinition | undefined,
  ): void {
    this.atlas = atlas
    this.blockLookup = blockLookup
    this.itemLookup = itemLookup
  }

  dispose(): void {
    window.removeEventListener('keydown', this.handleKeyDown)
    window.removeEventListener('keyup', this.handleKeyUp)
    window.removeEventListener('mousemove', this.handleMouseMove)
    window.removeEventListener('mouseup', this.handleMouseUp)
    this.canvas.removeEventListener('mousedown', this.handleMouseDown)
    this.canvas.removeEventListener('click', this.handleCanvasClick)
    this.canvas.removeEventListener('contextmenu', this.handleContextMenu)
    this.camera.dispose()
    this.armMesh.dispose()
    this.leftArmMesh.dispose()
    for (const mesh of this.heldMeshes.values()) {
      mesh.dispose()
    }
    this.heldMeshes.clear()
    for (const material of this.heldMaterials.values()) {
      material.dispose()
    }
    this.heldMaterials.clear()
    this.smokeParticles?.dispose()
    this.smokeParticles = null
    this.lighterFlameParticles?.dispose()
    this.lighterFlameParticles = null
    this.lighterModel?.dispose()
    this.lighterModel = null
    this.cigaretteModel?.dispose()
    this.cigaretteModel = null
    this.heldMount.dispose()
    this.leftHandRoot.dispose()
    this.handRoot.dispose()
    this.armMaterial.dispose()
  }

  private registerEvents(): void {
    window.addEventListener('keydown', this.handleKeyDown)
    window.addEventListener('keyup', this.handleKeyUp)
    window.addEventListener('mousemove', this.handleMouseMove)
    window.addEventListener('mouseup', this.handleMouseUp)
    this.canvas.addEventListener('mousedown', this.handleMouseDown)
    this.canvas.addEventListener('click', this.handleCanvasClick)
    this.canvas.addEventListener('contextmenu', this.handleContextMenu)
  }

  private handleKeyDown = (event: KeyboardEvent): void => {
    if (event.code === 'KeyE') {
      event.preventDefault()
      this.callbacks.onToggleInventory()
      return
    }
    if (event.code === 'Escape') {
      this.callbacks.onTogglePause()
      return
    }
    this.keys.add(event.code)
  }

  private handleKeyUp = (event: KeyboardEvent): void => {
    this.keys.delete(event.code)
  }

  private handleMouseMove = (event: MouseEvent): void => {
    if (document.pointerLockElement !== this.canvas || this.uiCapturingInput) {
      return
    }
    this.yaw += event.movementX * this.mouseSensitivity
    this.pitch = clamp(
      this.pitch - event.movementY * this.mouseSensitivity,
      -Math.PI / 2 + 0.02,
      Math.PI / 2 - 0.02,
    )
  }

  private handleMouseDown = (event: MouseEvent): void => {
    if (this.uiCapturingInput) {
      return
    }
    if (event.button === 0) {
      this.primaryDown = true
      this.primaryPressed = true
    }
    if (event.button === 2) {
      this.secondaryQueued = true
    }
  }

  private handleMouseUp = (event: MouseEvent): void => {
    if (event.button === 0) {
      this.primaryDown = false
    }
  }

  private handleCanvasClick = (): void => {
    if (this.uiCapturingInput) {
      return
    }
    if (document.pointerLockElement !== this.canvas) {
      void this.canvas.requestPointerLock()
    }
  }

  private handleContextMenu = (event: MouseEvent): void => {
    event.preventDefault()
  }

  setUiCapturingInput(value: boolean): void {
    this.uiCapturingInput = value
    if (value && document.pointerLockElement === this.canvas) {
      document.exitPointerLock()
    }
  }

  setMouseSensitivity(value: number): void {
    this.mouseSensitivity = value
  }

  getCollisionHeight(): number {
    return this.currentHeight
  }

  isPrimaryDown(): boolean {
    return this.primaryDown && !this.uiCapturingInput
  }

  consumePrimaryPress(): boolean {
    const pressed = this.primaryPressed
    this.primaryPressed = false
    return pressed
  }

  consumeSecondaryPress(): boolean {
    const pressed = this.secondaryQueued
    this.secondaryQueued = false
    return pressed
  }

  setPosition(x: number, y: number, z: number): void {
    this.position.set(x, y, z)
    this.syncCamera()
  }

  getLookVector(): Vector3 {
    const direction = new Vector3(
      Math.sin(this.yaw) * Math.cos(this.pitch),
      Math.sin(this.pitch),
      Math.cos(this.yaw) * Math.cos(this.pitch),
    )
    return direction.normalize()
  }

  setHeldItem(itemId: string | null): void {
    if (!itemId) {
      this.currentHeldKey = null
      this.deactivateCigarette()
      this.showHeldMesh(null, HELD_PRESETS.item)
      return
    }
    const item = this.itemLookup?.(itemId) ?? null
    if (!item || !item.texture) {
      this.currentHeldKey = null
      this.deactivateCigarette()
      this.showHeldMesh(null, HELD_PRESETS.item)
      return
    }

    const block = item.placeableBlockId ? this.blockLookup?.(item.placeableBlockId) : undefined
    const kind = this.resolveHeldKind(item, block)

    if (kind === 'cigarette') {
      if (this.heldVisibleMesh) {
        this.heldVisibleMesh.isVisible = false
        this.heldVisibleMesh = null
      }
      this.currentHeldKey = `cigarette:${item.id}`
      this.activateCigarette()
      return
    }

    this.deactivateCigarette()

    const cacheKey = kind === 'block' ? `block:${item.placeableBlockId ?? item.id}` : `item:${item.id}`
    if (cacheKey === this.currentHeldKey && this.heldVisibleMesh) {
      return
    }
    this.currentHeldKey = cacheKey

    const preset = HELD_PRESETS[kind]
    const cached = this.heldMeshes.get(cacheKey)
    if (cached) {
      this.showHeldMesh(cached, preset)
      return
    }

    if (kind === 'block' && block && this.atlas) {
      const mesh = buildHeldBlockMesh(this.scene, block, this.atlas, `held-block-${block.id}`)
      mesh.material = this.getOrCreateBlockMaterial()
      mesh.parent = this.heldMount
      mesh.isPickable = false
      mesh.isVisible = false
      this.heldMeshes.set(cacheKey, mesh)
      this.showHeldMesh(mesh, preset)
      return
    }

    const placeholder = MeshBuilder.CreatePlane(
      `held-item-placeholder-${item.id}`,
      { size: 0.4, sideOrientation: 2 },
      this.scene,
    )
    placeholder.material = this.getOrCreateItemMaterial(item.texture)
    placeholder.parent = this.heldMount
    placeholder.isPickable = false
    placeholder.isVisible = false
    this.heldMeshes.set(cacheKey, placeholder)
    this.showHeldMesh(placeholder, preset)

    void buildExtrudedItemMesh(this.scene, item.texture, {
      name: `held-item-${item.id}`,
      thickness: item.id === 'cigarette' ? 1 / 32 : undefined,
    })
      .then((mesh) => {
        if (!this.heldMeshes.has(cacheKey)) {
          mesh.dispose()
          return
        }
        mesh.material = this.getOrCreateItemMaterial(item.texture)
        mesh.parent = this.heldMount
        mesh.isPickable = false
        mesh.isVisible = false
        this.heldMeshes.get(cacheKey)?.dispose()
        this.heldMeshes.set(cacheKey, mesh)
        if (this.currentHeldKey === cacheKey) {
          this.showHeldMesh(mesh, preset)
        }
      })
      .catch(() => {
        // Leave the placeholder plane if image load fails.
      })
  }

  private showHeldMesh(mesh: Mesh | null, preset: HeldTransform): void {
    if (this.heldVisibleMesh && this.heldVisibleMesh !== mesh) {
      this.heldVisibleMesh.isVisible = false
    }
    this.heldVisibleMesh = mesh
    if (!mesh) {
      return
    }
    mesh.position.copyFrom(preset.position)
    mesh.rotation.copyFrom(preset.rotation)
    mesh.scaling.setAll(preset.scale)
    mesh.isVisible = true
  }

  private resolveHeldKind(item: ItemDefinition, block: BlockDefinition | undefined): HeldKind {
    if (item.id === 'cigarette') {
      return 'cigarette'
    }
    if (block && item.placeableBlockId && block.shape === 'cube' && !block.crossPlane) {
      return 'block'
    }
    if (item.category === 'tool') {
      return 'tool'
    }
    if (item.category === 'weapon') {
      if (item.id === 'machine_gun') return 'gun'
      return 'sword'
    }
    return 'item'
  }

  private getOrCreateItemMaterial(textureUrl: string): StandardMaterial {
    const existing = this.heldMaterials.get(textureUrl)
    if (existing) {
      return existing
    }
    const material = createHeldItemMaterial(this.scene, `held-item-mat-${textureUrl}`, textureUrl)
    this.heldMaterials.set(textureUrl, material)
    return material
  }

  private getOrCreateBlockMaterial(): StandardMaterial {
    const key = '__atlas__'
    const existing = this.heldMaterials.get(key)
    if (existing) {
      return existing
    }
    if (!this.atlas) {
      throw new Error('Atlas not set on PlayerController')
    }
    const material = createHeldBlockMaterial(this.scene, 'held-block-atlas', this.atlas.imageUrl)
    this.heldMaterials.set(key, material)
    return material
  }

  triggerSwing(): void {
    this.swingTimer = 0.18
  }

  update(deltaSeconds: number, movementEnabled: boolean): void {
    const eyeHeight = PLAYER_EYE_HEIGHT
    this.currentHeight = PLAYER_HEIGHT

    const inFluid = this.world.getBlockDefinition(
      Math.floor(this.position.x),
      Math.floor(this.position.y + 0.1),
      Math.floor(this.position.z),
    )?.fluid

    if (movementEnabled) {
      const forward = new Vector3(Math.sin(this.yaw), 0, Math.cos(this.yaw)).normalize()
      const right = new Vector3(forward.z, 0, -forward.x)
      const move = new Vector3(0, 0, 0)

      if (this.keys.has('KeyW')) {
        move.addInPlace(forward)
      }
      if (this.keys.has('KeyS')) {
        move.subtractInPlace(forward)
      }
      if (this.keys.has('KeyA')) {
        move.subtractInPlace(right)
      }
      if (this.keys.has('KeyD')) {
        move.addInPlace(right)
      }

      if (move.lengthSquared() > 0) {
        move.normalize()
      }

      const isSprinting =
        this.keys.has('ShiftLeft') ||
        this.keys.has('ShiftRight') ||
        this.keys.has('ControlLeft') ||
        this.keys.has('ControlRight')
      const speed = inFluid
        ? SWIM_SPEED
        : isSprinting
          ? SPRINT_SPEED
          : WALK_SPEED

      this.velocity.x = move.x * speed
      this.velocity.z = move.z * speed

      if (this.keys.has('Space')) {
        if (inFluid) {
          this.velocity.y = 4
        } else if (this.onGround) {
          this.velocity.y = JUMP_VELOCITY
          this.onGround = false
        }
      }
    } else {
      this.velocity.x = 0
      this.velocity.z = 0
    }

    this.velocity.y -= (inFluid ? GRAVITY * 0.35 : GRAVITY) * deltaSeconds
    if (inFluid) {
      this.velocity.y = Math.max(this.velocity.y, -2)
    }

    const previousY = this.position.y
    this.moveWithCollisions(deltaSeconds, PLAYER_HEIGHT)
    if (!this.onGround && this.position.y < previousY) {
      this.lastGroundY = previousY
    }

    this.syncCamera(eyeHeight)
    this.updateHandAnimation(deltaSeconds, movementEnabled)
  }

  private updateHandAnimation(deltaSeconds: number, movementEnabled: boolean): void {
    if (this.swingTimer > 0) {
      this.swingTimer = Math.max(0, this.swingTimer - deltaSeconds)
    }
    const swingPhase = this.swingTimer > 0 ? 1 - this.swingTimer / 0.18 : 0
    const walkBob = movementEnabled && (Math.abs(this.velocity.x) > 0.1 || Math.abs(this.velocity.z) > 0.1)
      ? Math.sin(performance.now() * 0.008) * 0.02
      : 0

    if (this.smokingTime >= 0) {
      this.updateSmokingAnimation(deltaSeconds)
    } else {
      this.smokingMouthRaise = 0
    }

    const raise = this.smokingMouthRaise
    const raiseEase = raise * raise * (3 - 2 * raise)

    this.handRoot.position.set(
      RIGHT_HAND_BASE_X + walkBob * (1 - raiseEase) + RIGHT_HAND_MOUTH_OFFSET_X * raiseEase,
      RIGHT_HAND_BASE_Y - Math.sin(swingPhase * Math.PI) * 0.12 + RIGHT_HAND_MOUTH_OFFSET_Y * raiseEase,
      RIGHT_HAND_BASE_Z - Math.sin(swingPhase * Math.PI) * 0.18 + RIGHT_HAND_MOUTH_OFFSET_Z * raiseEase,
    )
    this.handRoot.rotation.set(
      0.2 + Math.sin(swingPhase * Math.PI) * 0.8 - 0.25 * raiseEase,
      -0.2 - Math.sin(swingPhase * Math.PI) * 0.2 + 0.1 * raiseEase,
      -Math.sin(swingPhase * Math.PI) * 0.35 - 0.1 * raiseEase,
    )
  }

  isSmoking(): boolean {
    return this.smokingTime >= 0
  }

  tryStartSmoking(): boolean {
    if (!this.cigaretteActive) return false
    if (this.smokingTime >= 0) return false
    this.ensureSmokingProps()
    this.smokingTime = 0
    this.leftHandRoot.setEnabled(true)
    this.leftHandRoot.position.copyFrom(LEFT_HAND_BASE_POSITION)
    this.leftHandRoot.rotation.copyFrom(LEFT_HAND_BASE_ROTATION)
    if (this.lighterModel) {
      this.lighterModel.flameMesh.isVisible = false
      this.lighterModel.flameMesh.scaling.set(1, 1, 1)
    }
    return true
  }

  private ensureCigaretteModel(): CigaretteModel {
    if (this.cigaretteModel) return this.cigaretteModel
    const model = buildCigaretteModel(this.scene, 'held-cigarette')
    model.root.parent = this.heldMount
    model.root.position.copyFrom(CIGARETTE_BASE_POSITION)
    model.root.rotation.copyFrom(CIGARETTE_BASE_ROTATION)
    model.root.scaling.setAll(CIGARETTE_SCALE)
    model.root.setEnabled(false)
    this.cigaretteModel = model
    return model
  }

  private ensureSmokingProps(): void {
    const cig = this.ensureCigaretteModel()
    if (!this.lighterModel) {
      const lighter = buildLighterModel(this.scene, 'held-lighter')
      lighter.root.parent = this.leftHandRoot
      lighter.root.position.set(-0.02, -0.08, 0.06)
      lighter.root.rotation.set(-0.35, 0.1, -0.15)
      lighter.root.scaling.setAll(0.46)
      this.lighterModel = lighter
    }
    if (!this.smokeParticles) {
      this.smokeParticles = createSmokeParticleSystem(this.scene, cig.tipAnchor)
    }
    if (!this.lighterFlameParticles && this.lighterModel) {
      this.lighterFlameParticles = createLighterFlameParticleSystem(
        this.scene,
        this.lighterModel.flameAnchor,
      )
    }
  }

  private activateCigarette(): void {
    const cig = this.ensureCigaretteModel()
    this.cigaretteActive = true
    cig.root.setEnabled(true)
    if (this.smokingTime < 0) {
      cig.root.position.copyFrom(CIGARETTE_BASE_POSITION)
      cig.root.rotation.copyFrom(CIGARETTE_BASE_ROTATION)
      cig.root.scaling.setAll(CIGARETTE_SCALE)
      cig.emberMaterial.emissiveColor.set(0.08, 0.06, 0.04)
      cig.emberMaterial.diffuseColor.set(0.1, 0.08, 0.06)
    }
  }

  private deactivateCigarette(): void {
    if (!this.cigaretteActive) return
    this.cigaretteActive = false
    this.stopSmoking()
    this.cigaretteModel?.root.setEnabled(false)
  }

  private stopSmoking(): void {
    if (this.smokingTime < 0) return
    this.smokingTime = -1
    this.smokingMouthRaise = 0
    this.leftHandRoot.setEnabled(false)
    this.leftHandRoot.position.copyFrom(LEFT_HAND_BASE_POSITION)
    this.leftHandRoot.rotation.copyFrom(LEFT_HAND_BASE_ROTATION)
    if (this.lighterModel) {
      this.lighterModel.flameMesh.isVisible = false
    }
    this.smokeParticles?.stop()
    this.lighterFlameParticles?.stop()
    if (this.cigaretteModel) {
      this.cigaretteModel.root.position.copyFrom(CIGARETTE_BASE_POSITION)
      this.cigaretteModel.root.rotation.copyFrom(CIGARETTE_BASE_ROTATION)
      this.cigaretteModel.emberMaterial.emissiveColor.set(0.08, 0.06, 0.04)
      this.cigaretteModel.emberMaterial.diffuseColor.set(0.1, 0.08, 0.06)
    }
  }

  private smoothstep(a: number, b: number, x: number): number {
    if (b <= a) return x < a ? 0 : 1
    const t = clamp((x - a) / (b - a), 0, 1)
    return t * t * (3 - 2 * t)
  }

  private updateSmokingAnimation(deltaSeconds: number): void {
    if (!this.cigaretteModel) return
    this.smokingTime += deltaSeconds
    const t = this.smokingTime

    // Right-hand raise factor: stays 0 until the lighter withdraws, ramps to 1 as
    // the cigarette is brought to the mouth, held during the smoke phase, then
    // eases back to 0 during return.
    if (t < SMOKING_PHASE_LIGHTER_FALL) {
      this.smokingMouthRaise = 0
    } else if (t < SMOKING_PHASE_MOUTH_RAISE_END) {
      this.smokingMouthRaise = this.smoothstep(
        SMOKING_PHASE_LIGHTER_FALL,
        SMOKING_PHASE_MOUTH_RAISE_END,
        t,
      )
    } else if (t < SMOKING_PHASE_SMOKE_HOLD_END) {
      this.smokingMouthRaise = 1
    } else if (t < SMOKING_PHASE_RETURN_END) {
      this.smokingMouthRaise =
        1 - this.smoothstep(SMOKING_PHASE_SMOKE_HOLD_END, SMOKING_PHASE_RETURN_END, t)
    } else {
      this.smokingMouthRaise = 0
    }

    // Left hand / lighter trajectory.
    let leftPhase = 0
    if (t < SMOKING_PHASE_LIGHTER_RISE) {
      leftPhase = this.smoothstep(0, SMOKING_PHASE_LIGHTER_RISE, t)
    } else if (t < SMOKING_PHASE_LIGHTER_FALL) {
      leftPhase = 1
    } else if (t < SMOKING_PHASE_MOUTH_RAISE_END) {
      leftPhase = 1 - this.smoothstep(SMOKING_PHASE_LIGHTER_FALL, SMOKING_PHASE_MOUTH_RAISE_END, t)
    } else {
      leftPhase = 0
    }
    Vector3.LerpToRef(
      LEFT_HAND_BASE_POSITION,
      LEFT_HAND_RAISED_POSITION,
      leftPhase,
      this.leftHandRoot.position,
    )
    Vector3.LerpToRef(
      LEFT_HAND_BASE_ROTATION,
      LEFT_HAND_RAISED_ROTATION,
      leftPhase,
      this.leftHandRoot.rotation,
    )

    // Cigarette trajectory: base -> lighting -> mouth -> base.
    const cigRoot = this.cigaretteModel.root
    if (t < SMOKING_PHASE_LIGHTER_RISE) {
      const f = this.smoothstep(0, SMOKING_PHASE_LIGHTER_RISE, t)
      Vector3.LerpToRef(CIGARETTE_BASE_POSITION, CIGARETTE_LIGHTING_POSITION, f, cigRoot.position)
      Vector3.LerpToRef(CIGARETTE_BASE_ROTATION, CIGARETTE_LIGHTING_ROTATION, f, cigRoot.rotation)
    } else if (t < SMOKING_PHASE_LIGHTER_FALL) {
      cigRoot.position.copyFrom(CIGARETTE_LIGHTING_POSITION)
      cigRoot.rotation.copyFrom(CIGARETTE_LIGHTING_ROTATION)
    } else if (t < SMOKING_PHASE_MOUTH_RAISE_END) {
      const f = this.smoothstep(SMOKING_PHASE_LIGHTER_FALL, SMOKING_PHASE_MOUTH_RAISE_END, t)
      Vector3.LerpToRef(
        CIGARETTE_LIGHTING_POSITION,
        CIGARETTE_MOUTH_POSITION,
        f,
        cigRoot.position,
      )
      Vector3.LerpToRef(
        CIGARETTE_LIGHTING_ROTATION,
        CIGARETTE_MOUTH_ROTATION,
        f,
        cigRoot.rotation,
      )
    } else if (t < SMOKING_PHASE_SMOKE_HOLD_END) {
      cigRoot.position.copyFrom(CIGARETTE_MOUTH_POSITION)
      cigRoot.position.y += Math.sin(t * 2.4) * 0.006
      cigRoot.rotation.copyFrom(CIGARETTE_MOUTH_ROTATION)
    } else if (t < SMOKING_PHASE_RETURN_END) {
      const f = this.smoothstep(SMOKING_PHASE_SMOKE_HOLD_END, SMOKING_PHASE_RETURN_END, t)
      Vector3.LerpToRef(CIGARETTE_MOUTH_POSITION, CIGARETTE_BASE_POSITION, f, cigRoot.position)
      Vector3.LerpToRef(CIGARETTE_MOUTH_ROTATION, CIGARETTE_BASE_ROTATION, f, cigRoot.rotation)
    } else {
      this.stopSmoking()
      return
    }

    // Lighter flame visibility and particles.
    if (this.lighterModel) {
      const flameActive = t >= SMOKING_PHASE_FLAME_START && t < SMOKING_PHASE_FLAME_END
      this.lighterModel.flameMesh.isVisible = flameActive
      if (flameActive) {
        const flicker = 0.8 + Math.sin(t * 45) * 0.12 + Math.random() * 0.12
        this.lighterModel.flameMesh.scaling.set(1, flicker, 1)
        if (this.lighterFlameParticles && !this.lighterFlameParticles.isStarted()) {
          this.lighterFlameParticles.start()
        }
      } else if (this.lighterFlameParticles?.isStarted()) {
        this.lighterFlameParticles.stop()
      }
    }

    // Ember glow.
    const emberMat = this.cigaretteModel.emberMaterial
    let emberIntensity = 0
    if (t < SMOKING_PHASE_FLAME_START) {
      emberIntensity = 0
    } else if (t < SMOKING_PHASE_FLAME_END) {
      emberIntensity = this.smoothstep(SMOKING_PHASE_FLAME_START, SMOKING_PHASE_FLAME_END, t)
    } else if (t < SMOKING_PHASE_RETURN_END - 0.2) {
      emberIntensity = 0.85 + Math.sin(t * 3) * 0.12 + Math.random() * 0.06
    } else {
      const f = this.smoothstep(SMOKING_PHASE_RETURN_END - 0.2, SMOKING_PHASE_RETURN_END, t)
      emberIntensity = (0.85 + Math.sin(t * 3) * 0.1) * (1 - f)
    }
    emberIntensity = Math.max(0, emberIntensity)
    emberMat.emissiveColor.set(
      Math.min(2, 1.6 * emberIntensity),
      Math.min(1, 0.4 * emberIntensity),
      Math.min(0.6, 0.1 * emberIntensity),
    )
    emberMat.diffuseColor.set(
      Math.min(0.7, 0.5 * emberIntensity + 0.08),
      Math.min(0.3, 0.2 * emberIntensity + 0.06),
      Math.min(0.15, 0.05 * emberIntensity + 0.04),
    )

    // Smoke emission after ignition.
    if (this.smokeParticles) {
      const smokeStart = SMOKING_PHASE_FLAME_END - 0.2
      const smokeStop = SMOKING_PHASE_RETURN_END - 0.1
      if (t >= smokeStart && t < smokeStop) {
        if (!this.smokeParticles.isStarted()) this.smokeParticles.start()
        const puff = (t - smokeStart) % 1.2
        this.smokeParticles.emitRate = puff < 0.3 ? 90 : 42
      } else if (t >= smokeStop && this.smokeParticles.isStarted()) {
        this.smokeParticles.stop()
      }
      if (t >= SMOKING_PHASE_RETURN_END + SMOKE_PARTICLES_FADE_OUT) {
        this.smokeParticles.stop()
      }
    }
  }

  private syncCamera(eyeHeight = PLAYER_EYE_HEIGHT): void {
    this.camera.position.set(this.position.x, this.position.y + eyeHeight, this.position.z)
    this.camera.rotation.set(-this.pitch, this.yaw, 0)
  }

  private collides(position: Vector3, height: number): boolean {
    const epsilon = 0.001
    const minX = Math.floor(position.x - PLAYER_WIDTH / 2 + epsilon)
    const maxX = Math.floor(position.x + PLAYER_WIDTH / 2 - epsilon)
    const minY = Math.floor(position.y + epsilon)
    const maxY = Math.floor(position.y + height - epsilon)
    const minZ = Math.floor(position.z - PLAYER_WIDTH / 2 + epsilon)
    const maxZ = Math.floor(position.z + PLAYER_WIDTH / 2 - epsilon)

    const playerMinX = position.x - PLAYER_WIDTH / 2
    const playerMaxX = position.x + PLAYER_WIDTH / 2
    const playerMinY = position.y
    const playerMaxY = position.y + height
    const playerMinZ = position.z - PLAYER_WIDTH / 2
    const playerMaxZ = position.z + PLAYER_WIDTH / 2

    for (let y = minY; y <= maxY; y += 1) {
      for (let z = minZ; z <= maxZ; z += 1) {
        for (let x = minX; x <= maxX; x += 1) {
          for (const box of this.world.getCollisionBoxes(x, y, z)) {
            if (
              box.maxX > playerMinX &&
              box.minX < playerMaxX &&
              box.maxY > playerMinY &&
              box.minY < playerMaxY &&
              box.maxZ > playerMinZ &&
              box.minZ < playerMaxZ
            ) {
              return true
            }
          }
        }
      }
    }

    return false
  }

  private moveWithCollisions(deltaSeconds: number, height: number): void {
    const axes: Array<'x' | 'y' | 'z'> = ['x', 'y', 'z']
    const movement = this.velocity.scale(deltaSeconds)
    const startedOnGround = this.onGround
    this.onGround = false

    for (const axis of axes) {
      const next = this.position.clone()
      next[axis] += movement[axis]
      if (!this.collides(next, height)) {
        this.position.copyFrom(next)
        continue
      }

      if (axis === 'y') {
        if (movement.y < 0) {
          this.onGround = true
          const fallDistance = this.lastGroundY - this.position.y
          if (fallDistance > 5) {
            this.health = Math.max(0, this.health - Math.floor(fallDistance - 4))
          }
          this.lastGroundY = this.position.y
        }
        this.velocity.y = 0
      } else {
        if (startedOnGround && movement[axis] !== 0) {
          const stepped = next.clone()
          stepped.y += MAX_STEP_HEIGHT
          if (!this.collides(stepped, height)) {
            while (stepped.y > this.position.y) {
              const lowered = stepped.clone()
              lowered.y = Math.max(this.position.y, stepped.y - 0.05)
              if (this.collides(lowered, height)) {
                break
              }
              stepped.copyFrom(lowered)
              if (lowered.y === this.position.y) {
                break
              }
            }
            this.position.copyFrom(stepped)
            this.onGround = true
            continue
          }
        }
        this.velocity[axis] = 0
      }
    }
  }

  damage(amount: number): void {
    this.health = Math.max(0, this.health - amount)
  }

  heal(amount: number): void {
    this.health = Math.min(MAX_HEALTH, this.health + amount)
  }

  toSave(): PlayerSave {
    return {
      position: { x: this.position.x, y: this.position.y, z: this.position.z },
      velocity: { x: this.velocity.x, y: this.velocity.y, z: this.velocity.z },
      yaw: this.yaw,
      pitch: this.pitch,
      health: this.health,
      hotbar: [],
      inventory: [],
      selectedHotbarIndex: 0,
    }
  }

  loadFromSave(save: PlayerSave): void {
    this.position.set(save.position.x, save.position.y, save.position.z)
    this.velocity.set(save.velocity.x, save.velocity.y, save.velocity.z)
    this.yaw = save.yaw
    this.pitch = save.pitch
    this.health = save.health
    this.syncCamera()
  }
}
