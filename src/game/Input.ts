import type { InputAction } from './types'

type ActionHandler = (action: InputAction) => void

const JUMP_KEYS = new Set(['Space', 'ArrowUp', 'KeyW'])

export class InputManager {
  constructor(
    gameArea: HTMLElement,
    private readonly onAction: ActionHandler,
    private readonly canUsePointerJump: () => boolean,
    private readonly ignoreRepeatedJump: () => boolean = () => false,
    private readonly onGesture: () => void = () => {},
  ) {
    window.addEventListener('keydown', this.handleKeyDown)
    window.addEventListener('pointerdown', this.onGesture)
    // Native button activation by assistive technology may emit only click.
    window.addEventListener('click', this.onGesture)
    gameArea.addEventListener('pointerdown', this.handlePointerDown)
  }

  private readonly handleKeyDown = (event: KeyboardEvent): void => {
    if (!event.repeat) this.onGesture()
    if (event.code === 'Escape') {
      event.preventDefault()
      this.onAction('pause')
      return
    }

    if (JUMP_KEYS.has(event.code)) {
      const target = event.target
      if (target instanceof Element && target.closest('button, input, label')) return
      event.preventDefault()
      if (event.repeat && this.ignoreRepeatedJump()) return
      this.onAction('jump')
      return
    }
  }

  private readonly handlePointerDown = (event: PointerEvent): void => {
    const target = event.target
    if (target instanceof Element && target.closest('button, input, label, [data-menu-scroll]')) return

    event.preventDefault()
    if (this.canUsePointerJump()) this.onAction('jump')
  }
}
