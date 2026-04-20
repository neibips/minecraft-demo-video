import {
  Material,
  MeshBuilder,
  StandardMaterial,
  TransformNode,
  Vector3,
  Color3,
} from '@babylonjs/core'
import type { Scene } from '@babylonjs/core'
import { INTERACTION_RANGE, ITEM_DROP_LIFETIME, ITEM_DROP_PICKUP_RADIUS, MOB_DESPAWN_DISTANCE } from '../config'
import { createDistanceAwareTexture } from '../render/texture'
import { createEntityVisual } from './models'
import type {
  EntityDefinition,
  ItemDropState,
  MobState,
  RegistryBundle,
} from '../types'
import { WorldManager } from '../world/worldManager'
import { LightingManager } from '../render/lighting'

interface MobRuntime {
  state: MobState
  definition: EntityDefinition
  root: TransformNode
  pivots: Map<string, TransformNode>
  soundTimer: number
}

interface ItemDropRuntime {
  state: ItemDropState
  mesh: import('@babylonjs/core').Mesh
}

interface EntityCallbacks {
  giveItem: (itemId: string, count: number) => number
  damagePlayer: (amount: number) => void
  playMobSound?: (entityId: string, x: number, y: number, z: number) => void
}

interface SurfaceNode {
  x: number
  y: number
  z: number
}

const MOB_HIT_REACTION_DURATION = 0.22
const MOB_HIT_KNOCKBACK_SPEED = 3
const MOB_HIT_VERTICAL_BOOST = 1.8
const MOB_KNOCKBACK_DAMPING = 8

const SPIDER_ATTACK_RANGE = 1.35
const SPIDER_ATTACK_VERTICAL_RANGE = 1.3
const SPIDER_ATTACK_WINDUP = 0.15
const SPIDER_ATTACK_STRIKE = 0.1
const SPIDER_ATTACK_RECOVERY = 0.2
const SPIDER_ATTACK_DURATION = SPIDER_ATTACK_WINDUP + SPIDER_ATTACK_STRIKE + SPIDER_ATTACK_RECOVERY
const SPIDER_ATTACK_COOLDOWN = 1.2
const SPIDER_IDLE_MIN = 1
const SPIDER_IDLE_MAX = 3
const SPIDER_WANDER_MIN = 4
const SPIDER_WANDER_MAX = 7
const SPIDER_WANDER_RADIUS_MIN = 8
const SPIDER_WANDER_RADIUS_MAX = 16
const SPIDER_WANDER_REPATH_INTERVAL = 0.8
const SPIDER_CHASE_REPATH_INTERVAL = 0.35
const SPIDER_MAX_STEP_UP = 1.05
const SPIDER_MAX_DROP = 2
const SPIDER_PATH_RADIUS = 20
const SPIDER_WANDER_CHANCE = 0.78
const SPIDER_STEP_CLIMB_BOOST = 0.0
const SPIDER_CHASE_SPEED = 2.25
const SPIDER_WANDER_SPEED_MIN = 1
const SPIDER_WANDER_SPEED_MAX = 1.7
const SPIDER_LEG_BASE_Y = [
  -Math.PI / 4,
  Math.PI / 4,
  -Math.PI / 8,
  Math.PI / 8,
  Math.PI / 8,
  -Math.PI / 8,
  Math.PI / 4,
  -Math.PI / 4,
]
const SPIDER_LEG_BASE_Z = [
  Math.PI / 4,
  -Math.PI / 4,
  0.58119464,
  -0.58119464,
  0.58119464,
  -0.58119464,
  Math.PI / 4,
  -Math.PI / 4,
]
const SPIDER_LEG_NAMES = [
  'right_hind_leg',
  'left_hind_leg',
  'right_middle_hind_leg',
  'left_middle_hind_leg',
  'right_middle_front_leg',
  'left_middle_front_leg',
  'right_front_leg',
  'left_front_leg',
]
const SPIDER_LEG_PHASES = [0, Math.PI, Math.PI / 2, Math.PI * 1.5, Math.PI, 0, Math.PI * 1.5, Math.PI / 2]
const SPIDER_FRONT_LEG_INDICES = [4, 5, 6, 7]

export class EntityManager {
  private readonly scene: Scene
  private readonly registries: RegistryBundle
  private readonly world: WorldManager
  private readonly callbacks: EntityCallbacks
  private readonly lighting: LightingManager
  private readonly mobs = new Map<string, MobRuntime>()
  private readonly itemDrops = new Map<string, ItemDropRuntime>()
  private readonly itemMaterials = new Map<string, StandardMaterial>()
  private nextId = 1

  constructor(
    scene: Scene,
    registries: RegistryBundle,
    world: WorldManager,
    callbacks: EntityCallbacks,
    lighting: LightingManager,
  ) {
    this.scene = scene
    this.registries = registries
    this.world = world
    this.callbacks = callbacks
    this.lighting = lighting
  }

  dispose(): void {
    for (const mob of this.mobs.values()) {
      this.lighting.removeShadowCasterHierarchy(mob.root)
      mob.root.dispose()
    }
    for (const drop of this.itemDrops.values()) {
      this.lighting.removeShadowCaster(drop.mesh)
      drop.mesh.dispose()
    }
    for (const material of this.itemMaterials.values()) {
      material.dispose()
    }
    this.mobs.clear()
    this.itemDrops.clear()
  }

  spawnMob(entityId: string, x: number, y: number, z: number): void {
    const definition = this.registries.entities.get(entityId)
    if (!definition) {
      return
    }
    const visual = createEntityVisual(this.scene, entityId as 'chicken' | 'spider' | 'godzilla', definition.texture)
    const id = `mob-${this.nextId}`
    this.nextId += 1
    visual.root.position.set(x, y, z)
    this.lighting.addShadowCasterHierarchy(visual.root)
    this.mobs.set(id, {
      state: {
        id,
        entityId,
        position: { x, y, z },
        velocity: { x: 0, y: 0, z: 0 },
        knockback: { x: 0, y: 0, z: 0 },
        health: definition.health,
        yaw: Math.random() * Math.PI * 2,
        state: 'idle',
        wanderTimer: 0.8 + Math.random() * 2.5,
        stateTimer: entityId === 'spider' ? SPIDER_IDLE_MIN + Math.random() * (SPIDER_IDLE_MAX - SPIDER_IDLE_MIN) : 0,
        actionTimer: 0,
        hurtTimer: 0,
        eggTimer: entityId === 'chicken' ? 20 + Math.random() * 18 : undefined,
        attackCooldown: 0,
        attackTimer: 0,
        attackHitDone: false,
        wanderSpeed: 0,
        grounded: false,
        path: [],
        pathIndex: 0,
        repathTimer: 0,
      },
      definition,
      root: visual.root,
      pivots: visual.pivots,
      soundTimer: this.randomMobSoundDelay(entityId, true),
    })
  }

  private randomMobSoundDelay(entityId: string, initial = false): number {
    const ranges: Record<string, [number, number]> = {
      chicken: [6, 16],
      spider: [9, 22],
      godzilla: [12, 28],
    }
    const [min, max] = ranges[entityId] ?? [10, 22]
    const base = min + Math.random() * (max - min)
    return initial ? base + Math.random() * 4 : base
  }

  spawnChunkHints(hints: Array<{ entityId: string; x: number; y: number; z: number }>): void {
    for (const hint of hints) {
      const nearbyCount = Array.from(this.mobs.values()).filter(
        (mob) =>
          mob.definition.id === hint.entityId &&
          Math.hypot(mob.state.position.x - hint.x, mob.state.position.z - hint.z) < 16,
      ).length
      if (nearbyCount < 3) {
        this.spawnMob(hint.entityId, hint.x, hint.y, hint.z)
      }
    }
  }

  private getOrCreateItemMaterial(textureUrl: string): StandardMaterial {
    if (!this.itemMaterials.has(textureUrl)) {
      const material = new StandardMaterial(`item-${textureUrl}`, this.scene)
      const texture = createDistanceAwareTexture(textureUrl, this.scene)
      texture.hasAlpha = true
      material.diffuseTexture = texture
      material.diffuseColor = Color3.White()
      material.emissiveColor = new Color3(0.15, 0.15, 0.15)
      material.ambientColor = Color3.White()
      material.specularColor = Color3.Black()
      material.backFaceCulling = false
      material.useAlphaFromDiffuseTexture = true
      material.transparencyMode = Material.MATERIAL_ALPHATEST
      material.alphaCutOff = 0.5
      this.itemMaterials.set(textureUrl, material)
    }
    return this.itemMaterials.get(textureUrl)!
  }

  spawnItemDrop(itemId: string, count: number, position: Vector3, velocity = new Vector3()): void {
    const item = this.registries.items.get(itemId)
    if (!item) {
      return
    }
    const id = `drop-${this.nextId}`
    this.nextId += 1
    const mesh = MeshBuilder.CreatePlane(id, { size: 0.42 }, this.scene)
    mesh.billboardMode = 7
    mesh.material = this.getOrCreateItemMaterial(item.texture)
    mesh.position.copyFrom(position)
    mesh.isPickable = false
    mesh.renderingGroupId = 0
    this.lighting.addShadowCaster(mesh)
    this.itemDrops.set(id, {
      state: {
        id,
        itemId,
        count,
        position: { x: position.x, y: position.y, z: position.z },
        velocity: { x: velocity.x, y: velocity.y, z: velocity.z },
        life: ITEM_DROP_LIFETIME,
      },
      mesh,
    })
  }

  pickMob(origin: Vector3, direction: Vector3, maxDistance = INTERACTION_RANGE): MobRuntime | null {
    let best: { mob: MobRuntime; distance: number } | null = null
    for (const mob of this.mobs.values()) {
      const center = new Vector3(mob.state.position.x, mob.state.position.y + 0.9, mob.state.position.z)
      const toCenter = center.subtract(origin)
      const projection = Vector3.Dot(toCenter, direction)
      if (projection < 0 || projection > maxDistance) {
        continue
      }
      const closestPoint = origin.add(direction.scale(projection))
      const distance = Vector3.Distance(center, closestPoint)
      const radius = mob.definition.type === 'boss' ? 1.4 : mob.definition.id === 'spider' ? 1.05 : 0.65
      if (distance <= radius && (!best || projection < best.distance)) {
        best = { mob, distance: projection }
      }
    }
    return best?.mob ?? null
  }

  damageMob(mob: MobRuntime, amount: number, attackDirection?: Vector3): void {
    mob.state.health -= amount
    mob.state.hostile = true
    const pushDirection = attackDirection
      ? attackDirection.clone()
      : new Vector3(mob.state.position.x, 0, mob.state.position.z)
    pushDirection.y = 0
    if (pushDirection.lengthSquared() < 0.0001) {
      pushDirection.set(Math.sin(mob.state.yaw), 0, Math.cos(mob.state.yaw))
    }
    pushDirection.normalize()

    const knockbackStrength = mob.definition.type === 'boss' ? MOB_HIT_KNOCKBACK_SPEED * 0.55 : MOB_HIT_KNOCKBACK_SPEED
    mob.state.knockback.x = pushDirection.x * knockbackStrength
    mob.state.knockback.z = pushDirection.z * knockbackStrength
    mob.state.hurtTimer = MOB_HIT_REACTION_DURATION
    mob.state.velocity.y = Math.max(mob.state.velocity.y, MOB_HIT_VERTICAL_BOOST)

    if (mob.state.health > 0) {
      return
    }
    const position = new Vector3(mob.state.position.x, mob.state.position.y + 0.5, mob.state.position.z)
    for (const loot of mob.definition.loot) {
      this.spawnItemDrop(loot, 1, position, new Vector3((Math.random() - 0.5) * 1.6, 2, (Math.random() - 0.5) * 1.6))
    }
    this.lighting.removeShadowCasterHierarchy(mob.root)
    mob.root.dispose()
    this.mobs.delete(mob.state.id)
  }

  update(deltaSeconds: number, worldTime: number, playerPosition: Vector3): void {
    this.updateDrops(deltaSeconds, playerPosition)
    this.updateMobs(deltaSeconds, worldTime, playerPosition)
  }

  private updateDrops(deltaSeconds: number, playerPosition: Vector3): void {
    for (const [id, drop] of this.itemDrops.entries()) {
      drop.state.life -= deltaSeconds
      if (drop.state.life <= 0) {
        this.lighting.removeShadowCaster(drop.mesh)
        drop.mesh.dispose()
        this.itemDrops.delete(id)
        continue
      }

      drop.state.velocity.y -= 12 * deltaSeconds
      drop.state.position.x += drop.state.velocity.x * deltaSeconds
      drop.state.position.y += drop.state.velocity.y * deltaSeconds
      drop.state.position.z += drop.state.velocity.z * deltaSeconds

      const below = this.world.getBlockDefinition(
        Math.floor(drop.state.position.x),
        Math.floor(drop.state.position.y - 0.3),
        Math.floor(drop.state.position.z),
      )
      if (below?.collidable && drop.state.velocity.y < 0) {
        drop.state.position.y = Math.floor(drop.state.position.y) + 0.18
        drop.state.velocity.y *= -0.2
        drop.state.velocity.x *= 0.8
        drop.state.velocity.z *= 0.8
      }

      drop.mesh.position.set(drop.state.position.x, drop.state.position.y, drop.state.position.z)
      drop.mesh.rotation.z += deltaSeconds * 0.9

      const distance = Math.hypot(
        drop.state.position.x - playerPosition.x,
        drop.state.position.y - playerPosition.y,
        drop.state.position.z - playerPosition.z,
      )
      if (distance <= ITEM_DROP_PICKUP_RADIUS) {
        const remainder = this.callbacks.giveItem(drop.state.itemId, drop.state.count)
        if (remainder <= 0) {
          this.lighting.removeShadowCaster(drop.mesh)
          drop.mesh.dispose()
          this.itemDrops.delete(id)
        } else {
          drop.state.count = remainder
        }
      }
    }
  }

  private getMobDimensions(mob: MobRuntime): { height: number; width: number } {
    if (mob.definition.type === 'boss') {
      return { height: 4, width: 1.5 }
    }
    if (mob.definition.id === 'spider') {
      return { height: 1.1, width: 1.2 }
    }
    return { height: 1.3, width: 0.7 }
  }

  private collidesWithWorld(x: number, y: number, z: number, width: number, height: number): boolean {
    const epsilon = 0.001
    const minX = Math.floor(x - width / 2 + epsilon)
    const maxX = Math.floor(x + width / 2 - epsilon)
    const minY = Math.floor(y + epsilon)
    const maxY = Math.floor(y + height - epsilon)
    const minZ = Math.floor(z - width / 2 + epsilon)
    const maxZ = Math.floor(z + width / 2 - epsilon)

    for (let by = minY; by <= maxY; by += 1) {
      for (let bz = minZ; bz <= maxZ; bz += 1) {
        for (let bx = minX; bx <= maxX; bx += 1) {
          if (this.world.getBlockDefinition(bx, by, bz)?.collidable) {
            return true
          }
        }
      }
    }

    return false
  }

  private hasSupportBelow(x: number, y: number, z: number, width: number): boolean {
    const epsilon = 0.001
    const minX = Math.floor(x - width / 2 + epsilon)
    const maxX = Math.floor(x + width / 2 - epsilon)
    const minZ = Math.floor(z - width / 2 + epsilon)
    const maxZ = Math.floor(z + width / 2 - epsilon)
    const belowY = Math.floor(y - 0.05)

    for (let bz = minZ; bz <= maxZ; bz += 1) {
      for (let bx = minX; bx <= maxX; bx += 1) {
        if (this.world.getBlockDefinition(bx, belowY, bz)?.collidable) {
          return true
        }
      }
    }

    return false
  }

  private canStandAt(x: number, y: number, z: number, width: number, height: number): boolean {
    return !this.collidesWithWorld(x, y, z, width, height) && this.hasSupportBelow(x, y, z, width)
  }

  private toNodeKey(node: SurfaceNode): string {
    return `${node.x}:${Math.floor(node.y)}:${node.z}`
  }

  private resolveSurfaceNode(
    cellX: number,
    cellZ: number,
    preferredY: number,
    width: number,
    height: number,
  ): SurfaceNode | null {
    const baseY = Math.floor(preferredY + 0.01)
    const candidates = [baseY + 1, baseY, baseY - 1, baseY - 2]

    for (const feetY of candidates) {
      if (feetY < 1) {
        continue
      }
      if (feetY - baseY > 1 || baseY - feetY > SPIDER_MAX_DROP) {
        continue
      }

      const standY = feetY + 0.02
      const worldX = cellX + 0.5
      const worldZ = cellZ + 0.5
      if (this.canStandAt(worldX, standY, worldZ, width, height)) {
        return { x: cellX, y: standY, z: cellZ }
      }
    }

    return null
  }

  private reconstructSurfacePath(
    endKey: string,
    cameFrom: Map<string, string>,
    nodes: Map<string, SurfaceNode>,
  ): SurfaceNode[] {
    const path: SurfaceNode[] = []
    let currentKey = endKey
    while (cameFrom.has(currentKey)) {
      const current = nodes.get(currentKey)
      if (!current) {
        break
      }
      path.unshift(current)
      currentKey = cameFrom.get(currentKey)!
    }
    return path
  }

  private findSurfacePath(
    start: SurfaceNode,
    goal: SurfaceNode,
    width: number,
    height: number,
    maxRadius = SPIDER_PATH_RADIUS,
  ): SurfaceNode[] | null {
    const startKey = this.toNodeKey(start)
    const goalKey = this.toNodeKey(goal)
    const open = new Set<string>([startKey])
    const cameFrom = new Map<string, string>()
    const nodes = new Map<string, SurfaceNode>([
      [startKey, start],
      [goalKey, goal],
    ])
    const gScore = new Map<string, number>([[startKey, 0]])
    const fScore = new Map<string, number>([
      [
        startKey,
        Math.hypot(goal.x - start.x, goal.z - start.z) + Math.abs(goal.y - start.y) * 0.35,
      ],
    ])
    const directions = [
      { x: 1, z: 0 },
      { x: -1, z: 0 },
      { x: 0, z: 1 },
      { x: 0, z: -1 },
    ]

    let explored = 0
    while (open.size > 0 && explored < 1200) {
      explored += 1

      let currentKey: string | null = null
      let currentScore = Number.POSITIVE_INFINITY
      for (const key of open) {
        const score = fScore.get(key) ?? Number.POSITIVE_INFINITY
        if (score < currentScore) {
          currentScore = score
          currentKey = key
        }
      }

      if (!currentKey) {
        break
      }

      const current = nodes.get(currentKey)
      if (!current) {
        open.delete(currentKey)
        continue
      }

      if (current.x === goal.x && current.z === goal.z) {
        return this.reconstructSurfacePath(currentKey, cameFrom, nodes)
      }

      open.delete(currentKey)

      for (const direction of directions) {
        const nextX = current.x + direction.x
        const nextZ = current.z + direction.z
        if (Math.abs(nextX - start.x) > maxRadius || Math.abs(nextZ - start.z) > maxRadius) {
          continue
        }

        const neighbor = this.resolveSurfaceNode(nextX, nextZ, current.y, width, height)
        if (!neighbor || Math.abs(neighbor.y - current.y) > 1.05) {
          continue
        }

        const neighborKey = this.toNodeKey(neighbor)
        nodes.set(neighborKey, neighbor)

        const tentative =
          (gScore.get(currentKey) ?? Number.POSITIVE_INFINITY) + 1 + Math.abs(neighbor.y - current.y) * 0.35
        if (tentative >= (gScore.get(neighborKey) ?? Number.POSITIVE_INFINITY)) {
          continue
        }

        cameFrom.set(neighborKey, currentKey)
        gScore.set(neighborKey, tentative)
        fScore.set(
          neighborKey,
          tentative + Math.hypot(goal.x - neighbor.x, goal.z - neighbor.z) + Math.abs(goal.y - neighbor.y) * 0.35,
        )
        open.add(neighborKey)
      }
    }

    return null
  }

  private clearNavigation(mob: MobRuntime): void {
    mob.state.navTarget = undefined
    mob.state.path = []
    mob.state.pathIndex = 0
  }

  private setNavigationPath(mob: MobRuntime, path: SurfaceNode[]): void {
    if (path.length === 0) {
      this.clearNavigation(mob)
      return
    }

    mob.state.path = path
    mob.state.pathIndex = 0
    const last = path[path.length - 1]
    mob.state.navTarget = { x: last.x + 0.5, y: last.y, z: last.z + 0.5 }
  }

  private getNavigationTarget(mob: MobRuntime): Vector3 | null {
    const path = mob.state.path ?? []
    let pathIndex = mob.state.pathIndex ?? 0

    while (pathIndex < path.length) {
      const node = path[pathIndex]
      const target = new Vector3(node.x + 0.5, node.y, node.z + 0.5)
      const distanceXZ = Math.hypot(target.x - mob.state.position.x, target.z - mob.state.position.z)
      const verticalDiff = Math.abs(target.y - mob.state.position.y)
      if (distanceXZ < 0.45 && verticalDiff < 0.75) {
        pathIndex += 1
        continue
      }
      mob.state.pathIndex = pathIndex
      return target
    }

    mob.state.pathIndex = path.length
    const navTarget = mob.state.navTarget
    if (!navTarget) {
      return null
    }

    const finalDistance = Math.hypot(navTarget.x - mob.state.position.x, navTarget.z - mob.state.position.z)
    const finalVerticalDiff = Math.abs(navTarget.y - mob.state.position.y)
    if (finalDistance < 0.55 && finalVerticalDiff < 0.8) {
      this.clearNavigation(mob)
      return null
    }

    return new Vector3(navTarget.x, navTarget.y, navTarget.z)
  }

  private repathSpiderToTarget(mob: MobRuntime, target: Vector3): boolean {
    const { width, height } = this.getMobDimensions(mob)
    const start = this.resolveSurfaceNode(
      Math.floor(mob.state.position.x),
      Math.floor(mob.state.position.z),
      mob.state.position.y,
      width,
      height,
    )
    const goal = this.resolveSurfaceNode(Math.floor(target.x), Math.floor(target.z), target.y, width, height)
    if (!start || !goal) {
      this.clearNavigation(mob)
      return false
    }

    const path = this.findSurfacePath(start, goal, width, height)
    if (!path || path.length === 0) {
      this.clearNavigation(mob)
      return false
    }

    this.setNavigationPath(mob, path)
    return true
  }

  private pickSpiderWanderPath(mob: MobRuntime): SurfaceNode[] | null {
    const { width, height } = this.getMobDimensions(mob)
    const start = this.resolveSurfaceNode(
      Math.floor(mob.state.position.x),
      Math.floor(mob.state.position.z),
      mob.state.position.y,
      width,
      height,
    )
    if (!start) {
      return null
    }

    let bestPath: SurfaceNode[] | null = null
    for (let attempt = 0; attempt < 14; attempt += 1) {
      const angle = Math.random() * Math.PI * 2
      const radius =
        SPIDER_WANDER_RADIUS_MIN + Math.random() * (SPIDER_WANDER_RADIUS_MAX - SPIDER_WANDER_RADIUS_MIN)
      const targetX = Math.round(mob.state.position.x + Math.sin(angle) * radius)
      const targetZ = Math.round(mob.state.position.z + Math.cos(angle) * radius)
      const goal = this.resolveSurfaceNode(targetX, targetZ, start.y, width, height)
      if (!goal) {
        continue
      }

      const path = this.findSurfacePath(start, goal, width, height)
      if (!path || path.length === 0) {
        continue
      }

      if (!bestPath || path.length > bestPath.length) {
        bestPath = path
      }
      if (path.length >= 6) {
        return path
      }
    }

    return bestPath
  }

  private enterSpiderIdle(mob: MobRuntime, duration?: number): void {
    mob.state.state = 'idle'
    mob.state.stateTimer =
      duration ?? SPIDER_IDLE_MIN + Math.random() * (SPIDER_IDLE_MAX - SPIDER_IDLE_MIN)
    mob.state.wanderSpeed = 0
    mob.state.repathTimer = 0
    this.clearNavigation(mob)
  }

  private enterSpiderWander(mob: MobRuntime): void {
    const path = this.pickSpiderWanderPath(mob)
    if (!path) {
      this.enterSpiderIdle(mob, 0.8 + Math.random() * 1.2)
      return
    }

    mob.state.state = 'wander'
    mob.state.stateTimer = SPIDER_WANDER_MIN + Math.random() * (SPIDER_WANDER_MAX - SPIDER_WANDER_MIN)
    mob.state.wanderSpeed =
      SPIDER_WANDER_SPEED_MIN + Math.random() * (SPIDER_WANDER_SPEED_MAX - SPIDER_WANDER_SPEED_MIN)
    mob.state.repathTimer = SPIDER_WANDER_REPATH_INTERVAL
    this.setNavigationPath(mob, path)
  }

  private startSpiderAttack(mob: MobRuntime): void {
    mob.state.state = 'attack'
    mob.state.stateTimer = SPIDER_ATTACK_DURATION
    mob.state.attackTimer = SPIDER_ATTACK_DURATION
    mob.state.attackCooldown = SPIDER_ATTACK_COOLDOWN
    mob.state.attackHitDone = false
    this.clearNavigation(mob)
  }

  private updateSpiderAttack(mob: MobRuntime, playerPosition: Vector3): void {
    const attackRemaining = mob.state.attackTimer ?? 0
    if (attackRemaining <= 0) {
      return
    }

    const elapsed = SPIDER_ATTACK_DURATION - attackRemaining
    if (mob.state.attackHitDone || elapsed < SPIDER_ATTACK_WINDUP + SPIDER_ATTACK_STRIKE * 0.5) {
      return
    }

    const distanceXZ = Math.hypot(playerPosition.x - mob.state.position.x, playerPosition.z - mob.state.position.z)
    const verticalDiff = Math.abs(mob.state.position.y + 0.5 - playerPosition.y)
    if (distanceXZ <= SPIDER_ATTACK_RANGE + 0.35 && verticalDiff <= SPIDER_ATTACK_VERTICAL_RANGE + 0.35) {
      this.callbacks.damagePlayer(mob.definition.damage)
    }
    mob.state.attackHitDone = true
  }

  private updateSpiderAI(
    mob: MobRuntime,
    deltaSeconds: number,
    playerPosition: Vector3,
    isNight: boolean,
  ): { moveTarget: Vector3 | null; targetSpeed: number } {
    const dx = playerPosition.x - mob.state.position.x
    const dz = playerPosition.z - mob.state.position.z
    const distanceXZ = Math.hypot(dx, dz)
    const verticalDiff = Math.abs(mob.state.position.y + 0.5 - playerPosition.y)
    const canSensePlayer = (isNight || mob.state.hostile) && distanceXZ < 16 && verticalDiff < 5
    const attackRemaining = mob.state.attackTimer ?? 0

    if (attackRemaining > 0) {
      mob.state.state = 'attack'
      mob.state.stateTimer = attackRemaining
      mob.state.yaw = Math.atan2(dx, dz)
      this.updateSpiderAttack(mob, playerPosition)
      return {
        moveTarget: playerPosition.clone(),
        targetSpeed: attackRemaining > SPIDER_ATTACK_RECOVERY ? 0.45 : 0.15,
      }
    }

    if (canSensePlayer) {
      mob.state.yaw = Math.atan2(dx, dz)
      if (distanceXZ <= SPIDER_ATTACK_RANGE && verticalDiff <= SPIDER_ATTACK_VERTICAL_RANGE) {
        if ((mob.state.attackCooldown ?? 0) <= 0) {
          this.startSpiderAttack(mob)
          return { moveTarget: playerPosition.clone(), targetSpeed: 0.2 }
        }
        mob.state.state = 'chase'
        mob.state.stateTimer = 0.15
        return { moveTarget: playerPosition.clone(), targetSpeed: 0.35 }
      }

      mob.state.state = 'chase'
      mob.state.stateTimer = 0.25
      mob.state.repathTimer = Math.max(0, (mob.state.repathTimer ?? 0) - deltaSeconds)
      if ((mob.state.repathTimer ?? 0) <= 0) {
        this.repathSpiderToTarget(mob, playerPosition)
        mob.state.repathTimer = SPIDER_CHASE_REPATH_INTERVAL
      }

      const chaseTarget = this.getNavigationTarget(mob) ?? playerPosition.clone()
      return { moveTarget: chaseTarget, targetSpeed: SPIDER_CHASE_SPEED }
    }

    if (mob.state.state === 'chase' || mob.state.state === 'attack') {
      this.enterSpiderIdle(mob)
    }

    if (mob.state.state !== 'idle' && mob.state.state !== 'wander') {
      this.enterSpiderIdle(mob)
    }

    if (mob.state.state === 'wander') {
      const wanderTarget = this.getNavigationTarget(mob)
      if (!wanderTarget || (mob.state.stateTimer ?? 0) <= 0) {
        if (Math.random() < SPIDER_WANDER_CHANCE) {
          this.enterSpiderWander(mob)
        } else {
          this.enterSpiderIdle(mob)
        }
      }
    } else if ((mob.state.stateTimer ?? 0) <= 0) {
      if (Math.random() < SPIDER_WANDER_CHANCE) {
        this.enterSpiderWander(mob)
      } else {
        this.enterSpiderIdle(mob)
      }
    }

    const moveTarget = this.getNavigationTarget(mob)
    if (mob.state.state === 'wander' && moveTarget) {
      return {
        moveTarget,
        targetSpeed: mob.state.wanderSpeed ?? SPIDER_WANDER_SPEED_MIN,
      }
    }

    return { moveTarget: null, targetSpeed: 0 }
  }

  private updateMobs(deltaSeconds: number, worldTime: number, playerPosition: Vector3): void {
    const isNight = (worldTime % 1) > 0.73 || (worldTime % 1) < 0.22

    for (const [id, mob] of this.mobs.entries()) {
      const dx = mob.state.position.x - playerPosition.x
      const dz = mob.state.position.z - playerPosition.z
      const distanceXZ = Math.hypot(dx, dz)
      const verticalDiff = Math.abs(mob.state.position.y + 0.5 - playerPosition.y)

      if (distanceXZ > MOB_DESPAWN_DISTANCE && mob.definition.type !== 'boss') {
        this.lighting.removeShadowCasterHierarchy(mob.root)
        mob.root.dispose()
        this.mobs.delete(id)
        continue
      }

      mob.state.actionTimer += deltaSeconds
      mob.state.wanderTimer -= deltaSeconds
      mob.state.stateTimer = Math.max(0, (mob.state.stateTimer ?? 0) - deltaSeconds)
      mob.state.hurtTimer = Math.max(0, mob.state.hurtTimer - deltaSeconds)
      mob.state.attackCooldown = Math.max(0, (mob.state.attackCooldown ?? 0) - deltaSeconds)
      mob.state.attackTimer = Math.max(0, (mob.state.attackTimer ?? 0) - deltaSeconds)

      mob.soundTimer -= deltaSeconds
      if (mob.soundTimer <= 0) {
        this.callbacks.playMobSound?.(
          mob.definition.id,
          mob.state.position.x,
          mob.state.position.y + 0.6,
          mob.state.position.z,
        )
        mob.soundTimer = this.randomMobSoundDelay(mob.definition.id)
      }

      if (mob.definition.id === 'chicken' && mob.state.eggTimer !== undefined) {
        mob.state.eggTimer -= deltaSeconds
        if (mob.state.eggTimer <= 0) {
          this.spawnItemDrop(
            'egg',
            1,
            new Vector3(mob.state.position.x, mob.state.position.y + 0.5, mob.state.position.z),
          )
          mob.state.eggTimer = 20 + Math.random() * 18
        }
      }

      const isSpider = mob.definition.id === 'spider'
      const isBoss = mob.definition.type === 'boss'
      let moveTarget: Vector3 | null = null
      let targetSpeed = 0

      if (isSpider) {
        const spiderIntent = this.updateSpiderAI(mob, deltaSeconds, playerPosition, isNight)
        moveTarget = spiderIntent.moveTarget
        targetSpeed = spiderIntent.targetSpeed
      } else if (mob.definition.type === 'hostile' && (isNight || mob.state.hostile) && distanceXZ < 14) {
        mob.state.state = distanceXZ < 2.25 && verticalDiff < 1.5 ? 'attack' : 'chase'
      } else if (isBoss && distanceXZ < 26) {
        mob.state.state = distanceXZ < 3 && verticalDiff < 3 ? 'attack' : 'chase'
      } else if (mob.state.wanderTimer <= 0) {
        if (mob.state.state === 'wander') {
          mob.state.state = 'idle'
          mob.state.wanderTimer = 1 + Math.random() * 3
        } else {
          mob.state.state = 'wander'
          mob.state.wanderTimer = 2 + Math.random() * 3
          mob.state.yaw = Math.random() * Math.PI * 2
        }
      }

      if (!isSpider && (mob.state.state === 'chase' || mob.state.state === 'attack')) {
        mob.state.yaw = Math.atan2(playerPosition.x - mob.state.position.x, playerPosition.z - mob.state.position.z)
        if (isBoss) {
          targetSpeed = 2.8
        } else {
          targetSpeed = 1.75
        }
      } else if (!isSpider && mob.state.state === 'wander') {
        targetSpeed = isBoss ? 1.7 : 0.9
      }

      if (mob.state.state === 'attack' && (mob.state.attackCooldown ?? 0) <= 0) {
        if (!isSpider && mob.state.actionTimer > 1.2) {
          this.callbacks.damagePlayer(mob.definition.damage)
          mob.state.actionTimer = 0
        }
      }

      if (moveTarget) {
        mob.state.yaw = Math.atan2(moveTarget.x - mob.state.position.x, moveTarget.z - mob.state.position.z)
      }

      mob.state.velocity.x = Math.sin(mob.state.yaw) * targetSpeed + mob.state.knockback.x
      mob.state.velocity.z = Math.cos(mob.state.yaw) * targetSpeed + mob.state.knockback.z
      mob.state.velocity.y -= 16 * deltaSeconds

      this.moveMob(mob, deltaSeconds)
      const knockbackDecay = Math.max(0, 1 - deltaSeconds * MOB_KNOCKBACK_DAMPING)
      mob.state.knockback.x *= knockbackDecay
      mob.state.knockback.z *= knockbackDecay
      mob.root.position.set(mob.state.position.x, mob.state.position.y, mob.state.position.z)
      const hitProgress =
        mob.state.hurtTimer > 0 ? Math.sin((mob.state.hurtTimer / MOB_HIT_REACTION_DURATION) * Math.PI) : 0
      mob.root.position.y += hitProgress * 0.05
      mob.root.rotation.set(-hitProgress * 0.12, mob.state.yaw, hitProgress * 0.1)
      this.animateMob(mob)
    }
  }

  private trySpiderStepUp(
    targetX: number,
    currentY: number,
    targetZ: number,
    width: number,
    height: number,
  ): number | null {
    const steppedY = Math.floor(currentY + 0.05) + 1.02
    if (steppedY - currentY > SPIDER_MAX_STEP_UP + 0.05) {
      return null
    }
    if (!this.canStandAt(targetX, steppedY, targetZ, width, height)) {
      return null
    }
    return steppedY
  }

  private moveMobAxis(
    mob: MobRuntime,
    axis: 'x' | 'z',
    delta: number,
    width: number,
    height: number,
    canStep: boolean,
  ): void {
    if (Math.abs(delta) < 0.0001) {
      return
    }

    const targetX = axis === 'x' ? mob.state.position.x + delta : mob.state.position.x
    const targetZ = axis === 'z' ? mob.state.position.z + delta : mob.state.position.z
    if (!this.collidesWithWorld(targetX, mob.state.position.y, targetZ, width, height)) {
      mob.state.position.x = targetX
      mob.state.position.z = targetZ
      return
    }

    if (canStep) {
      const steppedY = this.trySpiderStepUp(targetX, mob.state.position.y, targetZ, width, height)
      if (steppedY !== null) {
        mob.state.position.x = targetX
        mob.state.position.z = targetZ
        mob.state.position.y = steppedY
        mob.state.velocity.y = Math.max(mob.state.velocity.y, SPIDER_STEP_CLIMB_BOOST)
        mob.state.grounded = false
        return
      }
    }

    mob.state.velocity[axis] = 0
  }

  private moveMob(mob: MobRuntime, deltaSeconds: number): void {
    const { height, width } = this.getMobDimensions(mob)
    const canStep = mob.definition.id === 'spider'
    const moveX = mob.state.velocity.x * deltaSeconds
    const moveZ = mob.state.velocity.z * deltaSeconds

    mob.state.grounded = this.hasSupportBelow(mob.state.position.x, mob.state.position.y, mob.state.position.z, width)

    this.moveMobAxis(mob, 'x', moveX, width, height, canStep)
    this.moveMobAxis(mob, 'z', moveZ, width, height, canStep)

    const nextY = mob.state.position.y + mob.state.velocity.y * deltaSeconds

    if (!this.collidesWithWorld(mob.state.position.x, nextY, mob.state.position.z, width, height)) {
      mob.state.position.y = nextY
      mob.state.grounded = false
      return
    }

    if (mob.state.velocity.y < 0) {
      mob.state.position.y = Math.round(mob.state.position.y) + 0.02
      mob.state.grounded = true
    }
    mob.state.velocity.y = 0
  }

  private animateMob(mob: MobRuntime): void {
    const walk = Math.sin(mob.state.actionTimer * 6) * 0.6
    if (mob.definition.id === 'chicken') {
      mob.pivots.get('right_leg')?.rotation.set(walk, 0, 0)
      mob.pivots.get('left_leg')?.rotation.set(-walk, 0, 0)
      mob.pivots.get('right_wing')?.rotation.set(0, 0, walk * 0.5)
      mob.pivots.get('left_wing')?.rotation.set(0, 0, -walk * 0.5)
    } else if (mob.definition.id === 'spider') {
      const moving =
        mob.state.state === 'wander' || mob.state.state === 'chase' || mob.state.state === 'attack'
      const intensity = moving ? Math.min(1, Math.hypot(mob.state.velocity.x, mob.state.velocity.z) / 1.8) : 0
      const t = mob.state.actionTimer * 8
      const attackRemaining = mob.state.attackTimer ?? 0
      const attackElapsed = attackRemaining > 0 ? SPIDER_ATTACK_DURATION - attackRemaining : 0
      let windup = 0
      let strike = 0
      let recovery = 0
      if (attackRemaining > 0) {
        if (attackElapsed < SPIDER_ATTACK_WINDUP) {
          windup = attackElapsed / SPIDER_ATTACK_WINDUP
        } else if (attackElapsed < SPIDER_ATTACK_WINDUP + SPIDER_ATTACK_STRIKE) {
          const phase = (attackElapsed - SPIDER_ATTACK_WINDUP) / SPIDER_ATTACK_STRIKE
          windup = 1 - phase
          strike = phase
        } else {
          const phase =
            (attackElapsed - SPIDER_ATTACK_WINDUP - SPIDER_ATTACK_STRIKE) / SPIDER_ATTACK_RECOVERY
          strike = 1 - phase
          recovery = phase
        }
      }

      for (let i = 0; i < SPIDER_LEG_NAMES.length; i += 1) {
        const pivot = mob.pivots.get(SPIDER_LEG_NAMES[i])
        if (!pivot) {
          continue
        }
        const phase = SPIDER_LEG_PHASES[i]
        const swingY = Math.sin(t + phase) * 0.45 * intensity
        const lift = Math.abs(Math.cos(t + phase)) * 0.35 * intensity
        const sign = i % 2 === 0 ? 1 : -1
        pivot.rotation.y = SPIDER_LEG_BASE_Y[i] + swingY
        pivot.rotation.z = SPIDER_LEG_BASE_Z[i] + lift * sign
      }

      for (const legIndex of SPIDER_FRONT_LEG_INDICES) {
        const pivot = mob.pivots.get(SPIDER_LEG_NAMES[legIndex])
        if (!pivot) {
          continue
        }
        const sign = legIndex % 2 === 0 ? 1 : -1
        const pairStrength = legIndex >= 6 ? 1.1 : 0.8
        pivot.rotation.y += sign * (strike * 0.95 - windup * 0.5) * pairStrength
        pivot.rotation.z += sign * (windup * 0.16 - strike * 0.22) * pairStrength
      }

      const lunge = strike * 0.28 + recovery * 0.1
      mob.root.position.x += Math.sin(mob.state.yaw) * lunge
      mob.root.position.z += Math.cos(mob.state.yaw) * lunge
      mob.root.position.y += -windup * 0.04 + strike * 0.02

      const head = mob.pivots.get('head')
      if (head) {
        head.rotation.set(-windup * 0.22 - strike * 0.38 + recovery * 0.12, 0, 0)
      }
      const body0 = mob.pivots.get('body0')
      if (body0) {
        body0.rotation.set(windup * 0.08 - strike * 0.18 + recovery * 0.05, 0, 0)
      }
      const body1 = mob.pivots.get('body1')
      if (body1) {
        body1.rotation.set(windup * 0.06 - strike * 0.12 + recovery * 0.04, 0, 0)
      }
    } else if (mob.definition.id === 'godzilla') {
      mob.pivots.get('arm_left')?.rotation.set(walk * 0.4, 0, 0)
      mob.pivots.get('arm_right')?.rotation.set(-walk * 0.4, 0, 0)
      mob.pivots.get('leg_left')?.rotation.set(-walk * 0.35, 0, 0)
      mob.pivots.get('leg_right')?.rotation.set(walk * 0.35, 0, 0)
      mob.pivots.get('tail')?.rotation.set(0, Math.sin(mob.state.actionTimer * 2) * 0.25, 0)
    }
  }
}
