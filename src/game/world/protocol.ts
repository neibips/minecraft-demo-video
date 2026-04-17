import type { ChunkCoord, ChunkWorkerResponse } from '../types'

export interface InitWorkerMessage {
  type: 'init'
  payload: {
    seed: string
    blockCodes: Record<string, number>
  }
}

export interface GenerateChunkMessage {
  type: 'generate-chunk'
  payload: {
    coord: ChunkCoord
  }
}

export interface ChunkGeneratedMessage {
  type: 'chunk-generated'
  payload: ChunkWorkerResponse
}

export type WorldWorkerMessage = InitWorkerMessage | GenerateChunkMessage
export type WorldWorkerResponse = ChunkGeneratedMessage
