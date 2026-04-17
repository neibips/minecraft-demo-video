import './styles.css'
import { Minecraft2Game } from './game/game'

const root = document.getElementById('app')

if (!root) {
  throw new Error('App root not found')
}

const game = new Minecraft2Game(root)
void game.initialize()
