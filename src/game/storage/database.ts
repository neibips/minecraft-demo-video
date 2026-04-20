import {
  DEFAULT_ATMOSPHERE_VOLUME,
  DEFAULT_EFFECTS_VOLUME,
  DEFAULT_MOUSE_SENSITIVITY,
  DEFAULT_RENDER_DISTANCE,
  WORLD_ID,
} from '../config'
import type {
  ChunkCoord,
  ChunkSaveRecord,
  PlayerSave,
  SettingsSave,
  WorldMetadata,
  WorldSaveSnapshot,
} from '../types'

const DB_NAME = 'minecraft2-db'
const DB_VERSION = 1
const META_STORE = 'meta'
const PLAYER_STORE = 'player'
const CHUNKS_STORE = 'chunks'
const SETTINGS_STORE = 'settings'

const promisifyRequest = <T>(request: IDBRequest<T>): Promise<T> =>
  new Promise<T>((resolve, reject) => {
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })

const waitForTransaction = (transaction: IDBTransaction): Promise<void> =>
  new Promise<void>((resolve, reject) => {
    transaction.oncomplete = () => resolve()
    transaction.onerror = () => reject(transaction.error)
    transaction.onabort = () => reject(transaction.error)
  })

export class WorldDatabase {
  private dbPromise: Promise<IDBDatabase> | null = null

  private async getDb(): Promise<IDBDatabase> {
    if (!this.dbPromise) {
      this.dbPromise = new Promise<IDBDatabase>((resolve, reject) => {
        const request = indexedDB.open(DB_NAME, DB_VERSION)
        request.onupgradeneeded = () => {
          const database = request.result
          if (!database.objectStoreNames.contains(META_STORE)) {
            database.createObjectStore(META_STORE)
          }
          if (!database.objectStoreNames.contains(PLAYER_STORE)) {
            database.createObjectStore(PLAYER_STORE)
          }
          if (!database.objectStoreNames.contains(CHUNKS_STORE)) {
            database.createObjectStore(CHUNKS_STORE, { keyPath: 'key' })
          }
          if (!database.objectStoreNames.contains(SETTINGS_STORE)) {
            database.createObjectStore(SETTINGS_STORE)
          }
        }
        request.onsuccess = () => resolve(request.result)
        request.onerror = () => reject(request.error)
      })
    }
    return this.dbPromise
  }

  async getWorldSnapshot(): Promise<WorldSaveSnapshot> {
    const [world, player, settings] = await Promise.all([
      this.loadWorldMeta(),
      this.loadPlayerState(),
      this.loadSettings(),
    ])
    return { world, player, settings }
  }

  async loadWorldMeta(): Promise<WorldMetadata | null> {
    const db = await this.getDb()
    const transaction = db.transaction(META_STORE, 'readonly')
    const store = transaction.objectStore(META_STORE)
    const result = await promisifyRequest(store.get(WORLD_ID))
    return (result as WorldMetadata | undefined) ?? null
  }

  async saveWorldMeta(world: WorldMetadata): Promise<void> {
    const db = await this.getDb()
    const transaction = db.transaction(META_STORE, 'readwrite')
    transaction.objectStore(META_STORE).put(world, WORLD_ID)
    await waitForTransaction(transaction)
  }

  async clearWorld(): Promise<void> {
    const db = await this.getDb()
    const transaction = db.transaction([META_STORE, PLAYER_STORE, CHUNKS_STORE], 'readwrite')
    transaction.objectStore(META_STORE).delete(WORLD_ID)
    transaction.objectStore(PLAYER_STORE).delete(WORLD_ID)
    transaction.objectStore(CHUNKS_STORE).clear()
    await waitForTransaction(transaction)
  }

  async loadPlayerState(): Promise<PlayerSave | null> {
    const db = await this.getDb()
    const transaction = db.transaction(PLAYER_STORE, 'readonly')
    const store = transaction.objectStore(PLAYER_STORE)
    const result = await promisifyRequest(store.get(WORLD_ID))
    return (result as PlayerSave | undefined) ?? null
  }

  async savePlayerState(player: PlayerSave): Promise<void> {
    const db = await this.getDb()
    const transaction = db.transaction(PLAYER_STORE, 'readwrite')
    transaction.objectStore(PLAYER_STORE).put(player, WORLD_ID)
    await waitForTransaction(transaction)
  }

  async loadSettings(): Promise<SettingsSave> {
    const db = await this.getDb()
    const transaction = db.transaction(SETTINGS_STORE, 'readonly')
    const store = transaction.objectStore(SETTINGS_STORE)
    const result = await promisifyRequest(store.get('settings'))
    const parsed = (result as Partial<SettingsSave> | undefined) ?? null
    return {
      renderDistance: parsed?.renderDistance ?? DEFAULT_RENDER_DISTANCE,
      mouseSensitivity: parsed?.mouseSensitivity ?? DEFAULT_MOUSE_SENSITIVITY,
      atmosphereVolume: parsed?.atmosphereVolume ?? DEFAULT_ATMOSPHERE_VOLUME,
      effectsVolume: parsed?.effectsVolume ?? DEFAULT_EFFECTS_VOLUME,
    }
  }

  async saveSettings(settings: SettingsSave): Promise<void> {
    const db = await this.getDb()
    const transaction = db.transaction(SETTINGS_STORE, 'readwrite')
    transaction.objectStore(SETTINGS_STORE).put(settings, 'settings')
    await waitForTransaction(transaction)
  }

  async loadChunk(key: string): Promise<ChunkSaveRecord | null> {
    const db = await this.getDb()
    const transaction = db.transaction(CHUNKS_STORE, 'readonly')
    const record = await promisifyRequest(transaction.objectStore(CHUNKS_STORE).get(key))
    return (record as ChunkSaveRecord | undefined) ?? null
  }

  async saveChunk(record: ChunkSaveRecord): Promise<void> {
    const db = await this.getDb()
    const transaction = db.transaction(CHUNKS_STORE, 'readwrite')
    transaction.objectStore(CHUNKS_STORE).put(record)
    await waitForTransaction(transaction)
  }

  async deleteChunk(key: string): Promise<void> {
    const db = await this.getDb()
    const transaction = db.transaction(CHUNKS_STORE, 'readwrite')
    transaction.objectStore(CHUNKS_STORE).delete(key)
    await waitForTransaction(transaction)
  }

  serializeChunk(
    coord: ChunkCoord,
    key: string,
    blocks: Uint16Array,
    heights: Uint8Array,
    biomes: ChunkSaveRecord['biomes'],
    blockEntities: ChunkSaveRecord['blockEntities'],
    structures: ChunkSaveRecord['structures'],
  ): ChunkSaveRecord {
    return {
      key,
      coord,
      blocks: Array.from(blocks),
      heights: Array.from(heights),
      biomes,
      blockEntities,
      structures,
      updatedAt: Date.now(),
    }
  }
}
