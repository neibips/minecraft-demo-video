import {
  AbstractMesh,
  CascadedShadowGenerator,
  Color3,
  Color4,
  Constants,
  DefaultRenderingPipeline,
  DirectionalLight,
  DynamicTexture,
  HemisphericLight,
  ImageProcessingConfiguration,
  Mesh,
  MeshBuilder,
  Scene,
  ShadowGenerator,
  StandardMaterial,
  Texture,
  TransformNode,
  Vector3,
} from '@babylonjs/core'
import type { Camera, Node } from '@babylonjs/core'
import { SkyMaterial } from '@babylonjs/materials/sky/skyMaterial'

const CELESTIAL_DISTANCE = 360
const SKYBOX_SIZE = 2200
const CLOUD_ALTITUDE = 140
const CLOUD_PLANE_SIZE = 2000
const CLOUD_TEX_SIZE = 128
const CLOUD_TILE_COUNT = 6
const CLOUD_DRIFT_SPEED = 0.008
const SHADOW_MAP_SIZE = 1024
const SHADOW_DISTANCE_SUN = 60
const SHADOW_DISTANCE_DAY = 72
const SHADOW_DISTANCE_NIGHT = 56
const SUN_DISC_SIZE = 150
const MOON_DISC_SIZE = 112

const NOON_LIGHT_COLOR = new Color3(1, 0.965, 0.92)
const SUNRISE_LIGHT_COLOR = new Color3(1, 0.74, 0.5)
const MOON_LIGHT_COLOR = new Color3(0.66, 0.78, 1)

const SKY_DAY_COLOR = new Color3(0.6, 0.82, 0.98)
const SKY_SUNSET_COLOR = new Color3(0.97, 0.58, 0.42)
const SKY_NIGHT_COLOR = new Color3(0.03, 0.05, 0.11)

const HEMI_DAY_COLOR = new Color3(0.7, 0.82, 0.96)
const HEMI_TWILIGHT_COLOR = new Color3(0.84, 0.6, 0.5)
const HEMI_NIGHT_COLOR = new Color3(0.14, 0.19, 0.3)

const AMBIENT_DAY_COLOR = new Color3(0.28, 0.3, 0.33)
const AMBIENT_TWILIGHT_COLOR = new Color3(0.24, 0.2, 0.2)
const AMBIENT_NIGHT_COLOR = new Color3(0.14, 0.17, 0.24)

const clamp01 = (value: number): number => Math.max(0, Math.min(1, value))

const lerpScalar = (start: number, end: number, amount: number): number =>
  start + (end - start) * amount

const smoothstep = (edge0: number, edge1: number, x: number): number => {
  const t = clamp01((x - edge0) / (edge1 - edge0))
  return t * t * (3 - 2 * t)
}

type ShadowSwitchableGenerator = CascadedShadowGenerator & { light: DirectionalLight }

export class LightingManager {
  readonly sunLight: DirectionalLight
  readonly moonLight: DirectionalLight
  readonly hemiLight: HemisphericLight
  readonly shadowGenerator: CascadedShadowGenerator

  private readonly scene: Scene
  private readonly skybox: Mesh
  private readonly skyMaterial: SkyMaterial
  private readonly celestialRoot: TransformNode
  private readonly sunMesh: Mesh
  private readonly sunMaterial: StandardMaterial
  private readonly moonMesh: Mesh
  private readonly moonMaterial: StandardMaterial
  private readonly cloudMesh: Mesh
  private readonly cloudMaterial: StandardMaterial
  private readonly cloudTexture: DynamicTexture
  private readonly shadowCasters = new Set<AbstractMesh>()
  private pipeline: DefaultRenderingPipeline | null = null
  private lastSunY = 1
  private cloudOffset = 0
  private activeShadowLight: DirectionalLight

  constructor(scene: Scene) {
    this.scene = scene

    scene.ambientColor = AMBIENT_DAY_COLOR.clone()

    this.hemiLight = new HemisphericLight('lighting-hemi', new Vector3(0, 1, 0), scene)
    this.hemiLight.intensity = 0.72
    this.hemiLight.diffuse = HEMI_DAY_COLOR
    this.hemiLight.groundColor = new Color3(0.22, 0.2, 0.18)
    this.hemiLight.specular = Color3.Black()

    this.sunLight = new DirectionalLight('lighting-sun', new Vector3(-0.3, -1, 0.25), scene)
    this.sunLight.position = new Vector3(40, 80, -20)
    this.sunLight.intensity = 2.25
    this.sunLight.diffuse = NOON_LIGHT_COLOR
    this.sunLight.specular = new Color3(0.12, 0.12, 0.12)
    this.sunLight.shadowMinZ = 0.1
    this.sunLight.shadowMaxZ = SHADOW_DISTANCE_DAY
    this.sunLight.autoCalcShadowZBounds = true

    this.moonLight = new DirectionalLight('lighting-moon', new Vector3(0.3, -1, 0.25), scene)
    this.moonLight.position = new Vector3(-40, 80, -20)
    this.moonLight.intensity = 0
    this.moonLight.diffuse = MOON_LIGHT_COLOR
    this.moonLight.specular = new Color3(0.05, 0.06, 0.08)
    this.moonLight.shadowMinZ = 0.1
    this.moonLight.shadowMaxZ = SHADOW_DISTANCE_NIGHT
    this.moonLight.autoCalcShadowZBounds = true

    this.activeShadowLight = this.sunLight
    this.shadowGenerator = new CascadedShadowGenerator(SHADOW_MAP_SIZE, this.activeShadowLight)
    this.shadowGenerator.numCascades = 3
    this.shadowGenerator.lambda = 0.78
    this.shadowGenerator.cascadeBlendPercentage = 0.1
    this.shadowGenerator.stabilizeCascades = true
    // Chunk meshes are one-sided (only outward faces) — forceBackFacesOnly would cull them entirely from the shadow map.
    this.shadowGenerator.forceBackFacesOnly = false
    this.shadowGenerator.depthClamp = true
    this.shadowGenerator.shadowMaxZ = SHADOW_DISTANCE_DAY
    this.shadowGenerator.bias = 0.002
    this.shadowGenerator.normalBias = 0.06
    this.shadowGenerator.usePercentageCloserFiltering = true
    this.shadowGenerator.filteringQuality = ShadowGenerator.QUALITY_MEDIUM
    this.shadowGenerator.frustumEdgeFalloff = 0.08
    this.shadowGenerator.setDarkness(0.32)
    this.shadowGenerator.transparencyShadow = true

    this.skyMaterial = new SkyMaterial('sky-material', scene)
    this.skyMaterial.backFaceCulling = false
    this.skyMaterial.luminance = 0.5
    this.skyMaterial.turbidity = 3.4
    this.skyMaterial.rayleigh = 2.6
    this.skyMaterial.mieCoefficient = 0.0025
    this.skyMaterial.mieDirectionalG = 0.86
    this.skyMaterial.useSunPosition = true
    this.skyMaterial.disableDepthWrite = true

    this.skybox = MeshBuilder.CreateBox('lighting-skybox', { size: SKYBOX_SIZE }, scene)
    this.skybox.material = this.skyMaterial
    this.skybox.infiniteDistance = true
    this.skybox.isPickable = false
    this.skybox.applyFog = false
    this.skybox.renderingGroupId = 0

    this.celestialRoot = new TransformNode('celestial-root', scene)

    this.sunMesh = MeshBuilder.CreatePlane('sun-disc', { size: SUN_DISC_SIZE }, scene)
    this.sunMaterial = new StandardMaterial('sun-material', scene)
    this.sunMaterial.emissiveColor = new Color3(1.45, 1.3, 1.05)
    this.sunMaterial.diffuseColor = Color3.Black()
    this.sunMaterial.specularColor = Color3.Black()
    this.sunMaterial.disableLighting = true
    this.sunMaterial.backFaceCulling = false
    this.sunMaterial.disableDepthWrite = true
    this.sunMaterial.alpha = 0.999
    this.sunMaterial.alphaMode = Constants.ALPHA_ADD
    this.sunMesh.material = this.sunMaterial
    this.sunMesh.isPickable = false
    this.sunMesh.applyFog = false
    this.sunMesh.billboardMode = Mesh.BILLBOARDMODE_ALL
    this.sunMesh.renderingGroupId = 0

    this.moonMesh = MeshBuilder.CreatePlane('moon-disc', { size: MOON_DISC_SIZE }, scene)
    this.moonMaterial = new StandardMaterial('moon-material', scene)
    this.moonMaterial.emissiveColor = new Color3(1.1, 1.16, 1.35)
    this.moonMaterial.diffuseColor = Color3.Black()
    this.moonMaterial.specularColor = Color3.Black()
    this.moonMaterial.disableLighting = true
    this.moonMaterial.backFaceCulling = false
    this.moonMaterial.disableDepthWrite = true
    this.moonMaterial.alpha = 0.999
    this.moonMaterial.alphaMode = Constants.ALPHA_ADD
    this.moonMesh.material = this.moonMaterial
    this.moonMesh.isPickable = false
    this.moonMesh.applyFog = false
    this.moonMesh.billboardMode = Mesh.BILLBOARDMODE_ALL
    this.moonMesh.renderingGroupId = 0

    this.cloudTexture = new DynamicTexture(
      'cloud-texture',
      { width: CLOUD_TEX_SIZE, height: CLOUD_TEX_SIZE },
      scene,
      false,
      Texture.NEAREST_NEAREST,
    )
    this.cloudTexture.hasAlpha = true
    this.cloudTexture.wrapU = Texture.WRAP_ADDRESSMODE
    this.cloudTexture.wrapV = Texture.WRAP_ADDRESSMODE
    this.cloudTexture.uScale = CLOUD_TILE_COUNT
    this.cloudTexture.vScale = CLOUD_TILE_COUNT
    this.paintCloudTexture()

    this.cloudMaterial = new StandardMaterial('cloud-material', scene)
    this.cloudMaterial.diffuseTexture = this.cloudTexture
    this.cloudMaterial.diffuseColor = Color3.White()
    this.cloudMaterial.emissiveColor = new Color3(0.9, 0.92, 0.95)
    this.cloudMaterial.specularColor = Color3.Black()
    this.cloudMaterial.backFaceCulling = false
    this.cloudMaterial.disableLighting = true
    this.cloudMaterial.useAlphaFromDiffuseTexture = true
    this.cloudMaterial.alpha = 0.98

    this.cloudMesh = MeshBuilder.CreatePlane(
      'cloud-layer',
      { size: CLOUD_PLANE_SIZE, sideOrientation: Mesh.DOUBLESIDE },
      scene,
    )
    this.cloudMesh.rotation.x = Math.PI / 2
    this.cloudMesh.position.y = CLOUD_ALTITUDE
    this.cloudMesh.material = this.cloudMaterial
    this.cloudMesh.isPickable = false
    this.cloudMesh.applyFog = true
    this.cloudMesh.renderingGroupId = 0
    this.cloudMesh.alphaIndex = 1
  }

  private paintCloudTexture(): void {
    const ctx = this.cloudTexture.getContext() as CanvasRenderingContext2D
    const image = ctx.createImageData(CLOUD_TEX_SIZE, CLOUD_TEX_SIZE)
    const hash = (ix: number, iy: number): number => {
      const s = Math.sin(ix * 127.1 + iy * 311.7) * 43758.5453
      return s - Math.floor(s)
    }
    const smooth = (x: number, y: number): number => {
      const ix = Math.floor(x)
      const iy = Math.floor(y)
      const fx = x - ix
      const fy = y - iy
      const ux = fx * fx * (3 - 2 * fx)
      const uy = fy * fy * (3 - 2 * fy)
      const a = hash(ix, iy)
      const b = hash(ix + 1, iy)
      const c = hash(ix, iy + 1)
      const d = hash(ix + 1, iy + 1)
      return a * (1 - ux) * (1 - uy) + b * ux * (1 - uy) + c * (1 - ux) * uy + d * ux * uy
    }
    for (let y = 0; y < CLOUD_TEX_SIZE; y += 1) {
      for (let x = 0; x < CLOUD_TEX_SIZE; x += 1) {
        const nx = (x / CLOUD_TEX_SIZE) * 4
        const ny = (y / CLOUD_TEX_SIZE) * 4
        const value =
          smooth(nx, ny) * 0.55 +
          smooth(nx * 2.1, ny * 2.1) * 0.3 +
          smooth(nx * 4.3, ny * 4.3) * 0.15
        // Blocky voxel-cloud feel: threshold into solid / soft-edge / empty.
        let alpha = 0
        if (value > 0.62) {
          alpha = 235
        } else if (value > 0.55) {
          alpha = 150
        }
        const idx = (y * CLOUD_TEX_SIZE + x) * 4
        image.data[idx] = 255
        image.data[idx + 1] = 255
        image.data[idx + 2] = 255
        image.data[idx + 3] = alpha
      }
    }
    ctx.putImageData(image, 0, 0)
    this.cloudTexture.update()
  }

  setupPostProcessing(camera: Camera): void {
    this.pipeline?.dispose()
    this.pipeline = new DefaultRenderingPipeline('lighting-pipeline', false, this.scene, [camera])
    this.pipeline.samples = Math.min(4, this.scene.getEngine().getCaps().maxMSAASamples || 1)
    this.pipeline.fxaaEnabled = false
    this.pipeline.bloomEnabled = true
    this.pipeline.bloomThreshold = 1.05
    this.pipeline.bloomWeight = 0.08
    this.pipeline.bloomKernel = 32
    this.pipeline.bloomScale = 0.5
    this.pipeline.imageProcessingEnabled = true
    this.pipeline.imageProcessing.toneMappingEnabled = true
    this.pipeline.imageProcessing.toneMappingType = ImageProcessingConfiguration.TONEMAPPING_STANDARD
    this.pipeline.imageProcessing.exposure = 1.24
    this.pipeline.imageProcessing.contrast = 1.04
    this.pipeline.imageProcessing.vignetteEnabled = true
    this.pipeline.imageProcessing.vignetteWeight = 0.18
    this.pipeline.imageProcessing.vignetteStretch = 0.2
    this.pipeline.imageProcessing.vignetteColor = new Color4(0.01, 0.02, 0.03, 0)
  }

  addShadowCaster(mesh: AbstractMesh): void {
    if (this.shadowCasters.has(mesh)) {
      return
    }
    this.shadowCasters.add(mesh)
    this.shadowGenerator.addShadowCaster(mesh, false)
  }

  removeShadowCaster(mesh: AbstractMesh): void {
    if (!this.shadowCasters.has(mesh)) {
      return
    }
    this.shadowCasters.delete(mesh)
    this.shadowGenerator.removeShadowCaster(mesh, false)
  }

  addShadowCasterHierarchy(root: Node): void {
    if (root instanceof AbstractMesh && root.getTotalVertices() > 0) {
      this.addShadowCaster(root)
    }
    for (const mesh of root.getChildMeshes(false)) {
      if (mesh.getTotalVertices() > 0) {
        this.addShadowCaster(mesh)
      }
    }
  }

  removeShadowCasterHierarchy(root: Node): void {
    if (root instanceof AbstractMesh) {
      this.removeShadowCaster(root)
    }
    for (const mesh of root.getChildMeshes(false)) {
      this.removeShadowCaster(mesh)
    }
  }

  enableShadowReceiver(mesh: AbstractMesh): void {
    mesh.receiveShadows = true
  }

  private switchShadowLight(nextLight: DirectionalLight): void {
    if (this.activeShadowLight === nextLight) {
      return
    }

    ;(this.shadowGenerator as ShadowSwitchableGenerator).light = nextLight
    this.activeShadowLight = nextLight

    for (const mesh of this.shadowCasters) {
      this.shadowGenerator.addShadowCaster(mesh, false)
    }
  }

  private updatePostProcessing(dayFactor: number, twilightFactor: number, nightFactor: number): void {
    if (!this.pipeline) {
      return
    }

    this.pipeline.imageProcessing.exposure = lerpScalar(
      0.98 + twilightFactor * 0.05,
      1.27 + twilightFactor * 0.04,
      dayFactor,
    )
    this.pipeline.imageProcessing.contrast = lerpScalar(1.01, 1.05, dayFactor)
    this.pipeline.imageProcessing.vignetteWeight = lerpScalar(0.12, 0.2, nightFactor)
  }

  update(worldTime: number, focus?: Vector3): void {
    const sunAngle = (worldTime - 0.25) * Math.PI * 2
    const sunY = Math.sin(sunAngle)
    const sunX = Math.cos(sunAngle)
    const tiltZ = 0.32

    const sunDir = new Vector3(-sunX, -sunY, -tiltZ * Math.cos(sunAngle - 0.18)).normalize()

    const follow = focus ?? Vector3.ZeroReadOnly
    this.sunLight.direction.copyFrom(sunDir)
    this.sunLight.position.set(
      follow.x - sunDir.x * 240,
      follow.y - sunDir.y * 240,
      follow.z - sunDir.z * 240,
    )
    this.moonLight.direction.set(-sunDir.x, -sunDir.y, -sunDir.z)
    this.moonLight.position.set(
      follow.x + sunDir.x * 240,
      follow.y + sunDir.y * 240,
      follow.z + sunDir.z * 240,
    )

    const dayFactor = smoothstep(-0.12, 0.16, sunY)
    const nightFactor = smoothstep(-0.14, 0.14, -sunY)
    const twilightFactor = 1 - smoothstep(0.06, 0.4, Math.abs(sunY))
    const lowSunFactor = 1 - smoothstep(0.18, 0.6, Math.max(0, sunY))

    const sunColor = Color3.Lerp(
      SUNRISE_LIGHT_COLOR,
      NOON_LIGHT_COLOR,
      clamp01(Math.pow(dayFactor, 0.65) + (1 - twilightFactor) * 0.18),
    )
    this.sunLight.diffuse = sunColor
    this.sunLight.specular = new Color3(
      lerpScalar(0.08, 0.14, dayFactor),
      lerpScalar(0.07, 0.12, dayFactor),
      lerpScalar(0.05, 0.1, dayFactor),
    )
    this.sunLight.intensity = dayFactor * 2.35 + twilightFactor * 0.55

    this.moonLight.diffuse = MOON_LIGHT_COLOR
    this.moonLight.specular = new Color3(0.04, 0.05, 0.07)
    this.moonLight.intensity = nightFactor * 0.7 + twilightFactor * 0.12

    const hemiColor = Color3.Lerp(
      Color3.Lerp(HEMI_NIGHT_COLOR, HEMI_TWILIGHT_COLOR, twilightFactor),
      HEMI_DAY_COLOR,
      dayFactor,
    )
    this.hemiLight.diffuse = hemiColor
    this.hemiLight.groundColor = Color3.Lerp(
      new Color3(0.07, 0.08, 0.11),
      new Color3(0.24, 0.21, 0.18),
      dayFactor * 0.7 + twilightFactor * 0.25,
    )
    this.hemiLight.intensity = lerpScalar(0.5, 0.82, dayFactor) + twilightFactor * 0.08

    this.scene.ambientColor = Color3.Lerp(
      Color3.Lerp(AMBIENT_NIGHT_COLOR, AMBIENT_TWILIGHT_COLOR, twilightFactor),
      AMBIENT_DAY_COLOR,
      dayFactor,
    )

    const skyColor = Color3.Lerp(
      Color3.Lerp(SKY_NIGHT_COLOR, SKY_SUNSET_COLOR, twilightFactor),
      SKY_DAY_COLOR,
      dayFactor,
    )
    this.scene.fogColor = skyColor
    this.scene.clearColor = new Color4(skyColor.r, skyColor.g, skyColor.b, 1)
    this.scene.fogDensity = lerpScalar(
      0.0064 - twilightFactor * 0.0005,
      0.0048 + twilightFactor * 0.0006,
      dayFactor,
    )

    this.skyMaterial.sunPosition = new Vector3(-sunDir.x, -sunDir.y, -sunDir.z)
    this.skyMaterial.luminance = lerpScalar(0.18 + twilightFactor * 0.14, 0.55, dayFactor)
    this.skyMaterial.turbidity = lerpScalar(6.5, 3.2, dayFactor)
    this.skyMaterial.rayleigh = lerpScalar(0.6, 2.8, dayFactor) + twilightFactor * 0.6
    this.skyMaterial.mieCoefficient = lerpScalar(0.007, 0.0028, dayFactor)
    this.skyMaterial.mieDirectionalG = lerpScalar(0.92, 0.86, dayFactor)

    const shadowLight =
      this.activeShadowLight === this.sunLight
        ? sunY < -0.08
          ? this.moonLight
          : this.sunLight
        : sunY > 0.08
          ? this.sunLight
          : this.moonLight
    this.switchShadowLight(shadowLight)

    if (shadowLight === this.sunLight) {
      const sunShadowDistance = lerpScalar(
        SHADOW_DISTANCE_NIGHT,
        SHADOW_DISTANCE_SUN,
        clamp01(dayFactor + twilightFactor * 0.2),
      )
      this.shadowGenerator.shadowMaxZ = sunShadowDistance
      this.shadowGenerator.lambda = lerpScalar(0.64, 0.8, lowSunFactor)
      // Large bias values erase thin voxel casters like trunks and leaf blocks in daylight.
      this.shadowGenerator.bias = lerpScalar(0.0007, 0.0016, lowSunFactor)
      this.shadowGenerator.normalBias = lerpScalar(0.01, 0.024, lowSunFactor)
      this.shadowGenerator.setDarkness(lerpScalar(0.2, 0.28, lowSunFactor))
    } else {
      const shadowDistance = lerpScalar(
        SHADOW_DISTANCE_NIGHT,
        SHADOW_DISTANCE_DAY,
        clamp01(dayFactor + twilightFactor * 0.35),
      )
      this.shadowGenerator.shadowMaxZ = shadowDistance
      this.shadowGenerator.lambda = lerpScalar(0.72, 0.86, lowSunFactor)
      this.shadowGenerator.bias = lerpScalar(0.0018, 0.004, lowSunFactor)
      this.shadowGenerator.normalBias = lerpScalar(0.055, 0.09, lowSunFactor)
      this.shadowGenerator.setDarkness(lerpScalar(0.32, 0.42, nightFactor))
    }

    this.sunMaterial.emissiveColor = Color3.Lerp(
      new Color3(1.7, 0.96, 0.54),
      new Color3(1.55, 1.44, 1.18),
      clamp01(dayFactor + 0.2),
    )
    this.moonMaterial.emissiveColor = new Color3(
      1.02 + twilightFactor * 0.12,
      1.1 + twilightFactor * 0.1,
      1.26 + nightFactor * 0.12,
    )

    this.skybox.position.copyFrom(follow)
    this.celestialRoot.position.copyFrom(follow)
    this.sunMesh.position.set(
      follow.x - sunDir.x * CELESTIAL_DISTANCE,
      follow.y - sunDir.y * CELESTIAL_DISTANCE,
      follow.z - sunDir.z * CELESTIAL_DISTANCE,
    )
    this.moonMesh.position.set(
      follow.x + sunDir.x * CELESTIAL_DISTANCE,
      follow.y + sunDir.y * CELESTIAL_DISTANCE,
      follow.z + sunDir.z * CELESTIAL_DISTANCE,
    )
    this.sunMesh.isVisible = sunY > -0.18
    this.moonMesh.isVisible = sunY < 0.18

    const frameDelta = Math.min(0.1, this.scene.getEngine().getDeltaTime() / 1000)
    this.cloudOffset = (this.cloudOffset + frameDelta * CLOUD_DRIFT_SPEED) % 1
    this.cloudTexture.uOffset = this.cloudOffset
    this.cloudTexture.vOffset = this.cloudOffset * 0.35
    this.cloudMesh.position.x = follow.x
    this.cloudMesh.position.z = follow.z
    const cloudBrightness = lerpScalar(0.18, 0.95, dayFactor) + twilightFactor * 0.2
    this.cloudMaterial.emissiveColor.set(
      cloudBrightness,
      cloudBrightness * (0.95 + twilightFactor * 0.05),
      cloudBrightness * (0.96 - twilightFactor * 0.15),
    )
    this.cloudMaterial.alpha = lerpScalar(0.72, 0.95, dayFactor)

    this.updatePostProcessing(dayFactor, twilightFactor, nightFactor)
    this.lastSunY = sunY
  }

  isNight(): boolean {
    return this.lastSunY < 0
  }

  dispose(): void {
    this.pipeline?.dispose()
    this.pipeline = null
    this.shadowGenerator.dispose()
    this.sunLight.dispose()
    this.moonLight.dispose()
    this.hemiLight.dispose()
    this.sunMesh.dispose()
    this.moonMesh.dispose()
    this.sunMaterial.dispose()
    this.moonMaterial.dispose()
    this.cloudMesh.dispose()
    this.cloudMaterial.dispose()
    this.cloudTexture.dispose()
    this.skybox.dispose()
    this.skyMaterial.dispose()
    this.celestialRoot.dispose()
    this.shadowCasters.clear()
  }
}
