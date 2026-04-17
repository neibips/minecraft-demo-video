import {
  Material,
  MeshBuilder,
  StandardMaterial,
  Texture,
  TransformNode,
  Vector3,
  Color3,
} from '@babylonjs/core'
import type { Scene } from '@babylonjs/core'
import { INTERACTION_RANGE, ITEM_DROP_LIFETIME, ITEM_DROP_PICKUP_RADIUS, MOB_DESPAWN_DISTANCE } from '../config'
import { createEntityVisual } from './models'
import type {
  EntityDefinition,
  ItemDropState,
  MobState,
  RegistryBundle,
} from '../types'
import { WorldManager } from '../world/worldManager'

interface MobRuntime {
  state: MobState
  definition: EntityDefinition
  root: TransformNode
  pivots: Map<string, TransformNode>
}

interface ItemDropRuntime {
  state: ItemDropState
  mesh: import('@babylonjs/core').Mesh
}

interface EntityCallbacks {
  giveItem: (itemId: string, count: number) => number
  damagePlayer: (amount: number) => void
}

const MOB_HIT_REACTION_DURATION = 0.22
const MOB_HIT_KNOCKBACK_SPEED = 3
const MOB_HIT_VERTICAL_BOOST = 1.8
const MOB_KNOCKBACK_DAMPING = 8

const SPIDER_ATTACK_RANGE = 1.35
const SPIDER_ATTACK_VERTICAL_RANGE = 1.3
const SPIDER_ATTACK_DURATION = 0.55
const SPIDER_ATTACK_COOLDOWN = 1.2
const SPIDER_LEG_BASE_Y = [
  Math.PI / 4,
  -Math.PI / 4,
  Math.PI / 8,
  -Math.PI / 8,
  -Math.PI / 8,
  Math.PI / 8,
  -Math.PI / 4,
  Math.PI / 4,
]
const SPIDER_LEG_BASE_Z = [
  -Math.PI / 4,
  Math.PI / 4,
  -0.58119464,
  0.58119464,
  -0.58119464,
  0.58119464,
  -Math.PI / 4,
  Math.PI / 4,
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

export class EntityManager {
  private readonly scene: Scene
  private readonly registries: RegistryBundle
  private readonly world: WorldManager
  private readonly callbacks: EntityCallbacks
  private readonly mobs = new Map<string, MobRuntime>()
  private readonly itemDrops = new Map<string, ItemDropRuntime>()
  private readonly itemMaterials = new Map<string, StandardMaterial>()
  private nextId = 1

  constructor(scene: Scene, registries: RegistryBundle, world: WorldManager, callbacks: EntityCallbacks) {
    this.scene = scene
    this.registries = registries
    this.world = world
    this.callbacks = callbacks
  }

  dispose(): void {
    for (const mob of this.mobs.values()) {
      mob.root.dispose()
    }
    for (const drop of this.itemDrops.values()) {
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
        actionTimer: 0,
        hurtTimer: 0,
        eggTimer: entityId === 'chicken' ? 20 + Math.random() * 18 : undefined,
        attackCooldown: 0,
        attackAnim: 0,
        wanderSpeed: 0,
      },
      definition,
      root: visual.root,
      pivots: visual.pivots,
    })
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
      const texture = new Texture(textureUrl, this.scene, true, false, Texture.NEAREST_SAMPLINGMODE)
      texture.hasAlpha = true
      texture.updateSamplingMode(Texture.NEAREST_SAMPLINGMODE)
      texture.wrapU = Texture.CLAMP_ADDRESSMODE
      texture.wrapV = Texture.CLAMP_ADDRESSMODE
      material.diffuseTexture = texture
      material.emissiveColor = Color3.White()
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
          drop.mesh.dispose()
          this.itemDrops.delete(id)
        } else {
          drop.state.count = remainder
        }
      }
    }
  }

  private updateMobs(deltaSeconds: number, worldTime: number, playerPosition: Vector3): void {
    const isNight = (worldTime % 1) > 0.73 || (worldTime % 1) < 0.22

    for (const [id, mob] of this.mobs.entries()) {
      const dx = mob.state.position.x - playerPosition.x
      const dz = mob.state.position.z - playerPosition.z
      const distanceXZ = Math.hypot(dx, dz)
      const verticalDiff = Math.abs(mob.state.position.y + 0.5 - playerPosition.y)

      if (distanceXZ > MOB_DESPAWN_DISTANCE && mob.definition.type !== 'boss') {
        mob.root.dispose()
        this.mobs.delete(id)
        continue
      }

      mob.state.actionTimer += deltaSeconds
      mob.state.wanderTimer -= deltaSeconds
      mob.state.hurtTimer = Math.max(0, mob.state.hurtTimer - deltaSeconds)
      mob.state.attackCooldown = Math.max(0, (mob.state.attackCooldown ?? 0) - deltaSeconds)
      mob.state.attackAnim = Math.max(0, (mob.state.attackAnim ?? 0) - deltaSeconds)

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
      let targetSpeed = 0

      if (isSpider) {
        const canSeePlayer = isNight && distanceXZ < 14 && verticalDiff < 5
        if (canSeePlayer) {
          if (distanceXZ < SPIDER_ATTACK_RANGE && verticalDiff < SPIDER_ATTACK_VERTICAL_RANGE) {
            mob.state.state = 'attack'
          } else {
            mob.state.state = 'chase'
          }
        } else if (mob.state.wanderTimer <= 0) {
          if (mob.state.state === 'wander') {
            mob.state.state = 'idle'
            mob.state.wanderTimer = 1.2 + Math.random() * 2.6
            mob.state.wanderSpeed = 0
          } else {
            mob.state.state = 'wander'
            mob.state.wanderTimer = 1.5 + Math.random() * 3
            mob.state.yaw = Math.random() * Math.PI * 2
            mob.state.wanderSpeed = 0.7 + Math.random() * 1.3
          }
        }
      } else if (mob.definition.type === 'hostile' && isNight && distanceXZ < 14) {
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

      if (mob.state.state === 'chase' || mob.state.state === 'attack') {
        mob.state.yaw = Math.atan2(playerPosition.x - mob.state.position.x, playerPosition.z - mob.state.position.z)
        if (isSpider) {
          targetSpeed = mob.state.state === 'attack' ? 0.6 : 2.2
        } else if (isBoss) {
          targetSpeed = 2.8
        } else {
          targetSpeed = 1.75
        }
      } else if (mob.state.state === 'wander') {
        if (isSpider) {
          targetSpeed = mob.state.wanderSpeed ?? 1
        } else {
          targetSpeed = isBoss ? 1.7 : 0.9
        }
      }

      if (mob.state.state === 'attack' && (mob.state.attackCooldown ?? 0) <= 0) {
        if (isSpider) {
          if (distanceXZ < SPIDER_ATTACK_RANGE && verticalDiff < SPIDER_ATTACK_VERTICAL_RANGE) {
            this.callbacks.damagePlayer(mob.definition.damage)
            mob.state.attackCooldown = SPIDER_ATTACK_COOLDOWN
            mob.state.attackAnim = SPIDER_ATTACK_DURATION
          }
        } else if (mob.state.actionTimer > 1.2) {
          this.callbacks.damagePlayer(mob.definition.damage)
          mob.state.actionTimer = 0
        }
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

  private moveMob(mob: MobRuntime, deltaSeconds: number): void {
    const height = mob.definition.type === 'boss' ? 4 : mob.definition.id === 'spider' ? 1.1 : 1.3
    const width = mob.definition.type === 'boss' ? 1.5 : mob.definition.id === 'spider' ? 1.2 : 0.7
    const nextX = mob.state.position.x + mob.state.velocity.x * deltaSeconds
    const nextZ = mob.state.position.z + mob.state.velocity.z * deltaSeconds
    const nextY = mob.state.position.y + mob.state.velocity.y * deltaSeconds

    const collides = (x: number, y: number, z: number): boolean => {
      const minX = Math.floor(x - width / 2)
      const maxX = Math.floor(x + width / 2)
      const minY = Math.floor(y)
      const maxY = Math.floor(y + height)
      const minZ = Math.floor(z - width / 2)
      const maxZ = Math.floor(z + width / 2)
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

    if (!collides(nextX, mob.state.position.y, mob.state.position.z)) {
      mob.state.position.x = nextX
    } else {
      mob.state.velocity.x = 0
    }
    if (!collides(mob.state.position.x, mob.state.position.y, nextZ)) {
      mob.state.position.z = nextZ
    } else {
      mob.state.velocity.z = 0
    }
    if (!collides(mob.state.position.x, nextY, mob.state.position.z)) {
      mob.state.position.y = nextY
    } else {
      if (mob.state.velocity.y < 0) {
        mob.state.position.y = Math.floor(mob.state.position.y) + 0.01
      }
      mob.state.velocity.y = 0
    }
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
      const attackT = (mob.state.attackAnim ?? 0) / SPIDER_ATTACK_DURATION
      const lunge = attackT > 0 ? Math.sin(attackT * Math.PI) * 0.55 : 0
      mob.pivots.get('head')?.rotation.set(-lunge, 0, 0)
      mob.pivots.get('body0')?.rotation.set(-lunge * 0.35, 0, 0)
    } else if (mob.definition.id === 'godzilla') {
      mob.pivots.get('arm_left')?.rotation.set(walk * 0.4, 0, 0)
      mob.pivots.get('arm_right')?.rotation.set(-walk * 0.4, 0, 0)
      mob.pivots.get('leg_left')?.rotation.set(-walk * 0.35, 0, 0)
      mob.pivots.get('leg_right')?.rotation.set(walk * 0.35, 0, 0)
      mob.pivots.get('tail')?.rotation.set(0, Math.sin(mob.state.actionTimer * 2) * 0.25, 0)
    }
  }
}
