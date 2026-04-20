import { HOTBAR_SIZE, MAX_HEALTH } from '../config'
import type { ActiveCraftingStation, NullableInventorySlot, SettingsSave } from '../types'

export type SlotSource =
  | 'hotbar'
  | 'inventory'
  | 'inventory-craft'
  | 'inventory-craft-result'
  | 'table-craft'
  | 'table-craft-result'
  | 'furnace-input'
  | 'furnace-fuel'
  | 'furnace-output'

export interface UiRenderState {
  mode: 'menu' | 'loading' | 'playing' | 'paused' | 'inventory' | 'crafting_table' | 'furnace' | 'dead'
  hasSave: boolean
  health: number
  worldName: string
  selectedHotbarIndex: number
  hotbar: NullableInventorySlot[]
  inventory: NullableInventorySlot[]
  inventoryCraft: NullableInventorySlot[]
  inventoryCraftResult: NullableInventorySlot
  tableCraft: NullableInventorySlot[]
  tableCraftResult: NullableInventorySlot
  furnaceInput: NullableInventorySlot
  furnaceFuel: NullableInventorySlot
  furnaceOutput: NullableInventorySlot
  furnaceProgress: number
  heldCursor: NullableInventorySlot
  activeStation: ActiveCraftingStation | null
  settings: SettingsSave
}

interface UiCallbacks {
  createWorld: (seed: string) => void
  loadWorld: () => void
  resume: () => void
  saveWorld: () => void
  respawn: () => void
  closeInventory: () => void
  updateSettings: (settings: SettingsSave) => void
  interactSlot: (source: SlotSource, index: number, button: number) => void
  getItemName: (itemId: string) => string
  getItemTexture: (itemId: string) => string | null
}

const createSlotMarkup = (
  slot: NullableInventorySlot,
  source: SlotSource,
  index: number,
  callbacks: UiCallbacks,
  selected = false,
): string => {
  const texture = slot ? callbacks.getItemTexture(slot.itemId) : null
  const label = slot ? callbacks.getItemName(slot.itemId) : ''
  return `
    <button
      class="slot ${selected ? 'selected' : ''}"
      data-source="${source}"
      data-index="${index}"
      data-label="${label}"
      type="button"
    >
      ${texture ? `<img src="${texture}" alt="${label}" draggable="false" />` : ''}
      ${slot && slot.count > 1 ? `<span class="slot-count">${slot.count}</span>` : ''}
    </button>
  `
}

const renderSlotGrid = (
  slots: NullableInventorySlot[],
  source: SlotSource,
  columns: number,
  callbacks: UiCallbacks,
  selectedIndex = -1,
): string => `
  <div class="slot-grid" style="--slot-columns:${columns}">
    ${slots
      .map((slot, index) => createSlotMarkup(slot, source, index, callbacks, selectedIndex === index))
      .join('')}
  </div>
`

export class GameUiController {
  readonly canvas: HTMLCanvasElement
  private readonly root: HTMLElement
  private readonly callbacks: UiCallbacks
  private readonly tooltip: HTMLDivElement
  private readonly cursor: HTMLDivElement
  private readonly mainMenu: HTMLDivElement
  private readonly loadingScreen: HTMLDivElement
  private readonly pauseScreen: HTMLDivElement
  private readonly deathScreen: HTMLDivElement
  private readonly hud: HTMLDivElement
  private readonly hotbarContainer: HTMLDivElement
  private readonly healthContainer: HTMLDivElement
  private readonly inventoryPanel: HTMLDivElement
  private readonly seedInput: HTMLInputElement
  private readonly renderDistanceInput: HTMLInputElement
  private readonly sensitivityInput: HTMLInputElement
  private readonly atmosphereVolumeInput: HTMLInputElement
  private readonly effectsVolumeInput: HTMLInputElement

  constructor(root: HTMLElement, callbacks: UiCallbacks) {
    this.root = root
    this.callbacks = callbacks

    root.innerHTML = `
      <div class="game-shell">
        <canvas class="game-canvas"></canvas>
        <div class="hud">
          <div class="crosshair"></div>
          <div class="health-bar"></div>
          <div class="hotbar-bar"></div>
        </div>
        <div class="inventory-panel hidden"></div>
        <div class="screen main-menu">
          <div class="panel">
            <p class="eyebrow">Voxel Survival Sandbox</p>
            <h1>Minecraft 2</h1>
            <p class="lede">Data-driven chunks, Babylon.js rendering, IndexedDB saves, crafting, mobs and survival systems running directly in the browser.</p>
            <label class="field">
              <span>World Seed</span>
              <input class="seed-input" type="text" placeholder="Enter a seed or leave blank for random" />
            </label>
            <div class="settings-grid">
              <label class="field">
                <span>Render Distance</span>
                <input class="render-distance-input" type="range" min="2" max="6" step="1" />
              </label>
              <label class="field">
                <span>Mouse Sensitivity</span>
                <input class="sensitivity-input" type="range" min="0.0012" max="0.0045" step="0.0001" />
              </label>
              <label class="field">
                <span>Atmosphere Volume</span>
                <input class="atmosphere-volume-input" type="range" min="0" max="1" step="0.01" />
              </label>
              <label class="field">
                <span>Effects Volume</span>
                <input class="effects-volume-input" type="range" min="0" max="1" step="0.01" />
              </label>
            </div>
            <div class="menu-actions">
              <button class="primary-action create-world" type="button">Create World</button>
              <button class="secondary-action load-world" type="button">Load Save</button>
            </div>
          </div>
        </div>
        <div class="screen loading-screen hidden">
          <div class="panel loading-panel">
            <p class="eyebrow">Streaming Chunks</p>
            <h2>Generating World</h2>
            <p>Preparing the seed, registries, worker jobs, save data and nearby chunks.</p>
          </div>
        </div>
        <div class="screen pause-screen hidden">
          <div class="panel">
            <p class="eyebrow">Pause Menu</p>
            <h2>World Paused</h2>
            <div class="menu-actions column">
              <button class="primary-action resume-world" type="button">Resume</button>
              <button class="secondary-action save-world" type="button">Save Game</button>
            </div>
          </div>
        </div>
        <div class="screen death-screen hidden">
          <div class="panel death-panel">
            <p class="eyebrow">Hard Landing</p>
            <h2>You Died</h2>
            <button class="primary-action respawn-world" type="button">Respawn</button>
          </div>
        </div>
        <div class="tooltip hidden"></div>
        <div class="cursor-stack hidden"></div>
      </div>
    `

    this.canvas = root.querySelector('.game-canvas') as HTMLCanvasElement
    this.tooltip = root.querySelector('.tooltip') as HTMLDivElement
    this.cursor = root.querySelector('.cursor-stack') as HTMLDivElement
    this.mainMenu = root.querySelector('.main-menu') as HTMLDivElement
    this.loadingScreen = root.querySelector('.loading-screen') as HTMLDivElement
    this.pauseScreen = root.querySelector('.pause-screen') as HTMLDivElement
    this.deathScreen = root.querySelector('.death-screen') as HTMLDivElement
    this.hud = root.querySelector('.hud') as HTMLDivElement
    this.hotbarContainer = root.querySelector('.hotbar-bar') as HTMLDivElement
    this.healthContainer = root.querySelector('.health-bar') as HTMLDivElement
    this.inventoryPanel = root.querySelector('.inventory-panel') as HTMLDivElement
    this.seedInput = root.querySelector('.seed-input') as HTMLInputElement
    this.renderDistanceInput = root.querySelector('.render-distance-input') as HTMLInputElement
    this.sensitivityInput = root.querySelector('.sensitivity-input') as HTMLInputElement
    this.atmosphereVolumeInput = root.querySelector('.atmosphere-volume-input') as HTMLInputElement
    this.effectsVolumeInput = root.querySelector('.effects-volume-input') as HTMLInputElement

    root.querySelector('.create-world')?.addEventListener('click', () => {
      callbacks.createWorld(this.seedInput.value.trim())
    })
    root.querySelector('.load-world')?.addEventListener('click', () => callbacks.loadWorld())
    root.querySelector('.resume-world')?.addEventListener('click', () => callbacks.resume())
    root.querySelector('.save-world')?.addEventListener('click', () => callbacks.saveWorld())
    root.querySelector('.respawn-world')?.addEventListener('click', () => callbacks.respawn())

    const emitSettings = (): void => {
      callbacks.updateSettings({
        renderDistance: Number(this.renderDistanceInput.value),
        mouseSensitivity: Number(this.sensitivityInput.value),
        atmosphereVolume: Number(this.atmosphereVolumeInput.value),
        effectsVolume: Number(this.effectsVolumeInput.value),
      })
    }
    this.renderDistanceInput.addEventListener('input', emitSettings)
    this.sensitivityInput.addEventListener('input', emitSettings)
    this.atmosphereVolumeInput.addEventListener('input', emitSettings)
    this.effectsVolumeInput.addEventListener('input', emitSettings)

    root.addEventListener('mousemove', this.handlePointerMove)
    root.addEventListener('mouseover', this.handlePointerOver)
    root.addEventListener('mouseout', this.handlePointerOut)
    root.addEventListener('mousedown', this.handleSlotPointer)
    root.addEventListener('contextmenu', this.handleSlotContextMenu)
  }

  private handlePointerMove = (event: MouseEvent): void => {
    this.tooltip.style.left = `${event.clientX + 14}px`
    this.tooltip.style.top = `${event.clientY + 14}px`
    this.cursor.style.left = `${event.clientX + 14}px`
    this.cursor.style.top = `${event.clientY + 14}px`
  }

  private handlePointerOver = (event: MouseEvent): void => {
    const target = event.target as HTMLElement | null
    const label = target?.closest('.slot')?.getAttribute('data-label')
    if (!label) {
      return
    }
    this.tooltip.textContent = label
    this.tooltip.classList.remove('hidden')
  }

  private handlePointerOut = (event: MouseEvent): void => {
    const target = event.target as HTMLElement | null
    if (target?.closest('.slot')) {
      this.tooltip.classList.add('hidden')
    }
  }

  private handleSlotPointer = (event: MouseEvent): void => {
    const target = event.target as HTMLElement | null
    const slot = target?.closest('.slot') as HTMLElement | null
    if (!slot) {
      return
    }
    event.preventDefault()
    const source = slot.dataset.source as SlotSource | undefined
    const index = Number(slot.dataset.index)
    if (!source || Number.isNaN(index)) {
      return
    }
    this.callbacks.interactSlot(source, index, event.button)
  }

  private handleSlotContextMenu = (event: MouseEvent): void => {
    const target = event.target as HTMLElement | null
    if (target?.closest('.slot')) {
      event.preventDefault()
    }
  }

  render(state: UiRenderState): void {
    const showGameplayHud =
      state.mode === 'playing' ||
      state.mode === 'inventory' ||
      state.mode === 'crafting_table' ||
      state.mode === 'furnace'

    this.mainMenu.classList.toggle('hidden', state.mode !== 'menu')
    this.loadingScreen.classList.toggle('hidden', state.mode !== 'loading')
    this.pauseScreen.classList.toggle('hidden', state.mode !== 'paused')
    this.deathScreen.classList.toggle('hidden', state.mode !== 'dead')
    this.hud.classList.toggle('hidden', !showGameplayHud)

    const loadButton = this.root.querySelector('.load-world') as HTMLButtonElement | null
    if (loadButton) {
      loadButton.disabled = !state.hasSave
    }

    this.renderDistanceInput.value = String(state.settings.renderDistance)
    this.sensitivityInput.value = String(state.settings.mouseSensitivity)
    this.atmosphereVolumeInput.value = String(state.settings.atmosphereVolume)
    this.effectsVolumeInput.value = String(state.settings.effectsVolume)

    this.renderHealth(state.health)
    this.hotbarContainer.innerHTML = renderSlotGrid(
      state.hotbar,
      'hotbar',
      HOTBAR_SIZE,
      this.callbacks,
      state.selectedHotbarIndex,
    )

    const showInventory =
      state.mode === 'inventory' || state.mode === 'crafting_table' || state.mode === 'furnace'
    this.inventoryPanel.classList.toggle('hidden', !showInventory)
    if (!showInventory) {
      this.cursor.classList.add('hidden')
      return
    }

    const inventoryStationTitle =
      state.mode === 'crafting_table'
        ? 'Crafting Table 3x3'
        : state.mode === 'furnace'
          ? 'Furnace'
          : 'Inventory Crafting 2x2'

    this.inventoryPanel.innerHTML = `
      <div class="panel inventory-shell">
        <div class="inventory-header">
          <div>
            <p class="eyebrow">World: ${state.worldName}</p>
            <h3>${inventoryStationTitle}</h3>
          </div>
          <button class="secondary-action close-inventory" type="button">Close</button>
        </div>
        <div class="inventory-layout">
          <section class="inventory-main">
            <h4>Inventory</h4>
            ${renderSlotGrid(state.inventory, 'inventory', 9, this.callbacks)}
            <h4>Hotbar</h4>
            ${renderSlotGrid(state.hotbar, 'hotbar', 9, this.callbacks, state.selectedHotbarIndex)}
          </section>
          <section class="inventory-crafting">
            <h4>2x2 Crafting</h4>
            ${renderSlotGrid(state.inventoryCraft, 'inventory-craft', 2, this.callbacks)}
            <div class="craft-result">
              <span>Result</span>
              ${renderSlotGrid([state.inventoryCraftResult], 'inventory-craft-result', 1, this.callbacks)}
            </div>
          </section>
          ${
            state.mode === 'crafting_table'
              ? `
                <section class="inventory-crafting station-panel">
                  <h4>3x3 Crafting Table</h4>
                  ${renderSlotGrid(state.tableCraft, 'table-craft', 3, this.callbacks)}
                  <div class="craft-result">
                    <span>Result</span>
                    ${renderSlotGrid([state.tableCraftResult], 'table-craft-result', 1, this.callbacks)}
                  </div>
                </section>
              `
              : ''
          }
          ${
            state.mode === 'furnace'
              ? `
                <section class="inventory-crafting station-panel furnace-panel">
                  <h4>Furnace</h4>
                  <div class="furnace-grid">
                    ${renderSlotGrid([state.furnaceInput], 'furnace-input', 1, this.callbacks)}
                    ${renderSlotGrid([state.furnaceFuel], 'furnace-fuel', 1, this.callbacks)}
                    ${renderSlotGrid([state.furnaceOutput], 'furnace-output', 1, this.callbacks)}
                  </div>
                  <div class="progress-meter">
                    <div class="progress-fill" style="width:${Math.round(state.furnaceProgress * 100)}%"></div>
                  </div>
                </section>
              `
              : ''
          }
        </div>
      </div>
    `

    this.inventoryPanel.querySelector('.close-inventory')?.addEventListener('click', () => {
      this.callbacks.closeInventory()
    })

    if (state.heldCursor) {
      const texture = this.callbacks.getItemTexture(state.heldCursor.itemId)
      const label = this.callbacks.getItemName(state.heldCursor.itemId)
      this.cursor.classList.remove('hidden')
      this.cursor.innerHTML = `
        <div class="cursor-slot">
          ${texture ? `<img src="${texture}" alt="${label}" draggable="false" />` : ''}
          ${state.heldCursor.count > 1 ? `<span class="slot-count">${state.heldCursor.count}</span>` : ''}
        </div>
      `
    } else {
      this.cursor.classList.add('hidden')
    }
  }

  private renderHealth(health: number): void {
    const hearts = Math.ceil(MAX_HEALTH / 2)
    const filled = Math.ceil(health / 2)
    this.healthContainer.innerHTML = `
      <div class="health-hearts">
        ${new Array(hearts)
          .fill(null)
          .map(
            (_, index) => `
              <span class="heart ${index < filled ? 'filled' : ''}">${index < filled ? '♥' : '♡'}</span>
            `,
          )
          .join('')}
      </div>
    `
  }
}
