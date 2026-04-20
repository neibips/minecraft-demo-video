import { clamp } from '../utils/math'

const soundImports = import.meta.glob('../../../assets/sounds/**/*.mp3', {
  eager: true,
  query: '?url',
  import: 'default',
}) as Record<string, string>

export type AmbientKey = 'music' | 'world'
export type SfxKey = 'step' | 'land' | 'swing' | 'chicken' | 'spider' | 'godzilla'

interface SfxConfig {
  pathMatch: string
  volume: number
  maxDistance: number
  minIntervalMs: number
  maxConcurrent: number
  rate?: { min: number; max: number }
}

interface AmbientConfig {
  pathMatch: string
  volume: number
  minSegmentSec: number
  maxSegmentSec: number
  minPauseSec: number
  maxPauseSec: number
  fadeInSec: number
  fadeOutSec: number
  initialDelayMin: number
  initialDelayMax: number
}

interface AmbientRuntime {
  source: AudioBufferSourceNode | null
  gainNode: GainNode | null
  timeoutId: number | null
}

const SFX_CONFIG: Record<SfxKey, SfxConfig> = {
  step: {
    pathMatch: 'player/steps',
    volume: 0.22,
    maxDistance: 2,
    minIntervalMs: 180,
    maxConcurrent: 3,
    rate: { min: 0.94, max: 1.08 },
  },
  land: {
    pathMatch: 'player/landing',
    volume: 0.42,
    maxDistance: 2,
    minIntervalMs: 160,
    maxConcurrent: 1,
  },
  swing: {
    pathMatch: 'player/kick',
    volume: 0.26,
    maxDistance: 2,
    minIntervalMs: 90,
    maxConcurrent: 3,
    rate: { min: 0.92, max: 1.1 },
  },
  chicken: {
    pathMatch: 'chicken/',
    volume: 0.4,
    maxDistance: 26,
    minIntervalMs: 200,
    maxConcurrent: 3,
  },
  spider: {
    pathMatch: 'spider/',
    volume: 0.5,
    maxDistance: 22,
    minIntervalMs: 220,
    maxConcurrent: 3,
  },
  godzilla: {
    pathMatch: 'godzilla/',
    volume: 0.85,
    maxDistance: 70,
    minIntervalMs: 320,
    maxConcurrent: 2,
  },
}

const AMBIENT_CONFIG: Record<AmbientKey, AmbientConfig> = {
  music: {
    pathMatch: 'music/',
    volume: 0.32,
    minSegmentSec: 55,
    maxSegmentSec: 110,
    minPauseSec: 60,
    maxPauseSec: 150,
    fadeInSec: 4,
    fadeOutSec: 5,
    initialDelayMin: 8,
    initialDelayMax: 18,
  },
  world: {
    pathMatch: 'world/',
    volume: 0.38,
    minSegmentSec: 40,
    maxSegmentSec: 100,
    minPauseSec: 25,
    maxPauseSec: 80,
    fadeInSec: 3,
    fadeOutSec: 4,
    initialDelayMin: 1,
    initialDelayMax: 5,
  },
}

export class AudioManager {
  private context: AudioContext | null = null
  private masterGain: GainNode | null = null
  private atmosphereGain: GainNode | null = null
  private effectsGain: GainNode | null = null
  private readonly buffers = new Map<string, AudioBuffer>()
  private readonly ambientRuntime: Record<AmbientKey, AmbientRuntime> = {
    music: { source: null, gainNode: null, timeoutId: null },
    world: { source: null, gainNode: null, timeoutId: null },
  }
  private readonly sfxLastTriggered = new Map<SfxKey, number>()
  private readonly sfxActive = new Map<SfxKey, number>()
  private readonly listenerPos = { x: 0, y: 0, z: 0 }
  private atmosphereVolume = 0.55
  private effectsVolume = 0.75
  private atmosphereRunning = false
  private initializePromise: Promise<void> | null = null

  initialize(): Promise<void> {
    if (this.initializePromise) {
      return this.initializePromise
    }
    this.initializePromise = this.createContextAndLoad()
    return this.initializePromise
  }

  private async createContextAndLoad(): Promise<void> {
    const AudioCtor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
    if (!AudioCtor) {
      return
    }
    const context = new AudioCtor()
    this.context = context
    this.masterGain = context.createGain()
    this.atmosphereGain = context.createGain()
    this.effectsGain = context.createGain()
    this.atmosphereGain.connect(this.masterGain)
    this.effectsGain.connect(this.masterGain)
    this.masterGain.connect(context.destination)
    this.applyVolumes()

    const entries = Object.entries(soundImports)
    await Promise.all(
      entries.map(async ([path, url]) => {
        try {
          const response = await fetch(url)
          const arrayBuffer = await response.arrayBuffer()
          const buffer = await context.decodeAudioData(arrayBuffer)
          this.buffers.set(path, buffer)
        } catch {
          /* ignore decode failures on unsupported formats */
        }
      }),
    )
  }

  async resume(): Promise<void> {
    if (!this.context) {
      return
    }
    if (this.context.state === 'suspended') {
      try {
        await this.context.resume()
      } catch {
        /* ignore */
      }
    }
  }

  setVolumes(atmosphere: number, effects: number): void {
    this.atmosphereVolume = clamp(atmosphere, 0, 1)
    this.effectsVolume = clamp(effects, 0, 1)
    this.applyVolumes()
  }

  private applyVolumes(): void {
    if (!this.context || !this.atmosphereGain || !this.effectsGain) {
      return
    }
    const now = this.context.currentTime
    this.atmosphereGain.gain.cancelScheduledValues(now)
    this.atmosphereGain.gain.linearRampToValueAtTime(this.atmosphereVolume, now + 0.1)
    this.effectsGain.gain.cancelScheduledValues(now)
    this.effectsGain.gain.linearRampToValueAtTime(this.effectsVolume, now + 0.1)
  }

  setListenerPosition(x: number, y: number, z: number): void {
    this.listenerPos.x = x
    this.listenerPos.y = y
    this.listenerPos.z = z
  }

  startAtmosphere(): void {
    if (this.atmosphereRunning) {
      return
    }
    this.atmosphereRunning = true
    void this.initialize().then(() => {
      if (!this.atmosphereRunning) {
        return
      }
      this.scheduleAmbient('music')
      this.scheduleAmbient('world')
    })
  }

  stopAtmosphere(): void {
    this.atmosphereRunning = false
    this.stopAmbientChannel('music')
    this.stopAmbientChannel('world')
  }

  playSfx(key: SfxKey, options?: { x?: number; y?: number; z?: number; volume?: number }): void {
    if (!this.context || !this.effectsGain) {
      return
    }
    const config = SFX_CONFIG[key]
    const buffer = this.findBuffer(config.pathMatch)
    if (!buffer) {
      return
    }
    const nowMs = performance.now()
    const last = this.sfxLastTriggered.get(key) ?? -Infinity
    if (nowMs - last < config.minIntervalMs) {
      return
    }
    const active = this.sfxActive.get(key) ?? 0
    if (active >= config.maxConcurrent) {
      return
    }

    const hasPosition = options?.x !== undefined && options?.z !== undefined
    let attenuation = 1
    if (hasPosition) {
      const dx = (options!.x ?? 0) - this.listenerPos.x
      const dy = (options!.y ?? this.listenerPos.y) - this.listenerPos.y
      const dz = (options!.z ?? 0) - this.listenerPos.z
      const distance = Math.hypot(dx, dy, dz)
      if (distance > config.maxDistance) {
        return
      }
      attenuation = Math.pow(1 - clamp(distance / config.maxDistance, 0, 1), 1.6)
      if (attenuation <= 0.005) {
        return
      }
    }

    this.sfxLastTriggered.set(key, nowMs)
    this.sfxActive.set(key, active + 1)

    const source = this.context.createBufferSource()
    source.buffer = buffer
    if (config.rate) {
      source.playbackRate.value = config.rate.min + Math.random() * (config.rate.max - config.rate.min)
    }
    const gainNode = this.context.createGain()
    gainNode.gain.value = config.volume * (options?.volume ?? 1) * attenuation
    source.connect(gainNode)
    gainNode.connect(this.effectsGain)
    const cleanup = (): void => {
      this.sfxActive.set(key, Math.max(0, (this.sfxActive.get(key) ?? 1) - 1))
      try {
        source.disconnect()
      } catch {
        /* ignore */
      }
      try {
        gainNode.disconnect()
      } catch {
        /* ignore */
      }
    }
    source.onended = cleanup
    try {
      source.start()
    } catch {
      cleanup()
    }
  }

  private findBuffer(pathMatch: string): AudioBuffer | null {
    for (const [path, buffer] of this.buffers) {
      if (path.includes(pathMatch)) {
        return buffer
      }
    }
    return null
  }

  private scheduleAmbient(key: AmbientKey, delayOverrideSec?: number): void {
    const runtime = this.ambientRuntime[key]
    const config = AMBIENT_CONFIG[key]
    if (runtime.timeoutId !== null) {
      clearTimeout(runtime.timeoutId)
      runtime.timeoutId = null
    }
    const delaySec =
      delayOverrideSec ??
      config.initialDelayMin + Math.random() * (config.initialDelayMax - config.initialDelayMin)
    runtime.timeoutId = window.setTimeout(() => {
      runtime.timeoutId = null
      if (!this.atmosphereRunning) {
        return
      }
      this.playAmbientSegment(key)
    }, delaySec * 1000)
  }

  private playAmbientSegment(key: AmbientKey): void {
    if (!this.context || !this.atmosphereGain || !this.atmosphereRunning) {
      return
    }
    const config = AMBIENT_CONFIG[key]
    const buffer = this.findBuffer(config.pathMatch)
    if (!buffer) {
      return
    }
    const runtime = this.ambientRuntime[key]
    this.stopAmbientChannel(key)

    const source = this.context.createBufferSource()
    source.buffer = buffer
    source.loop = true
    const gainNode = this.context.createGain()
    source.connect(gainNode)
    gainNode.connect(this.atmosphereGain)

    const segmentSec =
      config.minSegmentSec + Math.random() * (config.maxSegmentSec - config.minSegmentSec)
    const fadeIn = Math.min(config.fadeInSec, segmentSec * 0.4)
    const fadeOut = Math.min(config.fadeOutSec, segmentSec * 0.4)
    const now = this.context.currentTime
    gainNode.gain.setValueAtTime(0.0001, now)
    gainNode.gain.linearRampToValueAtTime(config.volume, now + fadeIn)
    gainNode.gain.setValueAtTime(config.volume, now + segmentSec - fadeOut)
    gainNode.gain.linearRampToValueAtTime(0.0001, now + segmentSec)

    runtime.source = source
    runtime.gainNode = gainNode
    try {
      source.start(now)
      source.stop(now + segmentSec + 0.1)
    } catch {
      /* ignore */
    }

    const pauseSec =
      config.minPauseSec + Math.random() * (config.maxPauseSec - config.minPauseSec)
    runtime.timeoutId = window.setTimeout(() => {
      runtime.timeoutId = null
      runtime.source = null
      runtime.gainNode = null
      if (!this.atmosphereRunning) {
        return
      }
      this.scheduleAmbient(key, 0)
    }, (segmentSec + pauseSec) * 1000)
  }

  private stopAmbientChannel(key: AmbientKey): void {
    const runtime = this.ambientRuntime[key]
    if (runtime.timeoutId !== null) {
      clearTimeout(runtime.timeoutId)
      runtime.timeoutId = null
    }
    if (runtime.source && this.context && runtime.gainNode) {
      const now = this.context.currentTime
      try {
        runtime.gainNode.gain.cancelScheduledValues(now)
        runtime.gainNode.gain.setValueAtTime(runtime.gainNode.gain.value, now)
        runtime.gainNode.gain.linearRampToValueAtTime(0.0001, now + 0.45)
        runtime.source.stop(now + 0.5)
      } catch {
        /* ignore */
      }
    }
    runtime.source = null
    runtime.gainNode = null
  }
}
