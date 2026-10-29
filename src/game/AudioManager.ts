export type AudioTrack = 'menu' | 'gainer' | 'corona'
type AudioPart = 'menu' | 'intro' | 'main' | 'corona'

const TRACK_SOURCES: Record<AudioPart, string> = {
  menu: '/track-menu.mp3',
  intro: '/track-intro.mp3',
  main: '/track-main.mp3',
  corona: '/track-corona.mp3',
}
const MENU_FADE_SECONDS = 0.5

// The supplied MP3s carry iTunSMPB padding. Some decoders already remove it;
// trim only a full padded decode, never an already trimmed AudioBuffer.
const MP3_FRAMES = {
  menu: { valid: 936277, padded: 938880 },
  intro: { valid: 984558, padded: 987264 },
  main: { valid: 4676652, padded: 4679424 },
} as const
const MP3_SAMPLE_RATE = 44100
const MP3_PRIMING_FRAMES = 528

export interface MusicPlayback {
  track: AudioTrack
  part: AudioPart
  /** Seconds within the current part (wraps when a loop repeats). */
  position: number
  playing: boolean
}

interface ActiveMusic {
  track: AudioTrack
  offset: number
  startedAt: number
  sources: AudioBufferSourceNode[]
  envelope: GainNode
}

export class AudioManager {
  private currentTrack: AudioTrack = 'menu'
  private readonly offsets: Record<AudioTrack, number> = { menu: 0, gainer: 0, corona: 0 }
  private readonly buffers = new Map<AudioPart, AudioBuffer>()
  private readonly loading = new Map<AudioPart, Promise<AudioBuffer | null>>()
  private context: AudioContext | null = null
  private master: GainNode | null = null
  private active: ActiveMusic | null = null
  private readonly effects = new Set<{ source: OscillatorNode; gain: GainNode }>()
  private playbackRequested = false
  private generation = 0
  private attempt = 0
  private previousVolume = 65

  isMuted = false
  volume = 65

  get playback(): MusicPlayback {
    const offset = this.currentOffset(this.currentTrack)
    let part: AudioPart = this.currentTrack === 'gainer' ? 'intro' : this.currentTrack
    let position = offset
    if (this.currentTrack === 'gainer') {
      const introDuration = this.buffers.get('intro')?.duration
      if (introDuration !== undefined && offset >= introDuration) {
        part = 'main'
        position -= introDuration
      }
    }
    const duration = this.buffers.get(part)?.duration
    if (duration) position %= duration
    return { track: this.currentTrack, part, position, playing: this.active !== null && this.context?.state === 'running' }
  }

  /** Selection never starts playback; each soundtrack retains its own position. */
  selectTrack(track: AudioTrack): void {
    if (track === this.currentTrack) return
    this.pause()
    this.currentTrack = track
  }

  async play(): Promise<void> {
    if (this.isMuted || this.volume === 0) return
    const context = this.getContext()
    if (!context) return
    if (this.active && context.state === 'running') return

    this.playbackRequested = true
    const generation = this.generation
    const attempt = ++this.attempt
    const track = this.currentTrack
    try {
      // Call resume synchronously on EVERY retry. A blocked autoplay resume may
      // remain pending until a later call made directly inside a user gesture.
      const resumed = context.resume()
      const parts: AudioPart[] = track === 'gainer' ? ['intro', 'main'] : [track]
      const [, loaded] = await Promise.all([resumed, Promise.all(parts.map(part => this.loadBuffer(part, context)))])
      if (!this.playbackRequested || generation !== this.generation || attempt !== this.attempt ||
          track !== this.currentTrack || context.state !== 'running' || this.active || loaded.some(buffer => !buffer)) return
      this.startMusic(track, context)
    } catch { /* Autoplay, missing files and unsupported audio never block gameplay. */ }
  }

  pause(): void {
    this.playbackRequested = false
    this.generation++
    if (this.active) {
      this.offsets[this.active.track] = this.currentOffset(this.active.track)
      for (const source of this.active.sources) {
        try { source.stop() } catch { /* Already stopped. */ }
        source.disconnect()
      }
      this.active.envelope.disconnect()
      this.active = null
    }
    for (const effect of this.effects) {
      try { effect.source.stop() } catch { /* Already stopped. */ }
      effect.source.disconnect()
      effect.gain.disconnect()
    }
    this.effects.clear()
    // No source remains connected. Keeping the context running silently avoids
    // a late suspend() racing the next gesture's resume().
  }

  /** Resetting Gainer discards both the Intro/Main phase and its saved position. */
  resetTrack(track: AudioTrack): void {
    if (track === this.currentTrack) this.pause()
    this.offsets[track] = 0
  }

  playPickup(): void {
    const context = this.context
    if (!context || !this.master || context.state !== 'running' || !this.playbackRequested ||
        this.isMuted || this.volume === 0 || this.currentTrack !== 'gainer') return
    try {
      const source = context.createOscillator()
      const gain = context.createGain()
      const effect = { source, gain }
      const now = context.currentTime
      source.frequency.setValueAtTime(880, now)
      source.frequency.exponentialRampToValueAtTime(1320, now + 0.07)
      gain.gain.setValueAtTime(0.045, now)
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.12)
      source.connect(gain).connect(this.master)
      source.onended = () => { source.disconnect(); gain.disconnect(); this.effects.delete(effect) }
      this.effects.add(effect)
      source.start(now)
      source.stop(now + 0.12)
    } catch { /* Optional pickup feedback must never affect collection. */ }
  }

  toggleMute(): void {
    if (this.isMuted || this.volume === 0) {
      if (this.volume === 0) this.volume = this.previousVolume
      this.isMuted = false
    } else {
      this.isMuted = true
      this.previousVolume = this.volume
    }
    this.syncVolume()
  }

  setVolume(value: number): void {
    const nextVolume = Number.isFinite(value) ? Math.max(0, Math.min(100, value)) : 0
    if (nextVolume > 0) {
      this.previousVolume = nextVolume
      this.isMuted = false
    } else this.isMuted = true
    this.volume = nextVolume
    this.syncVolume()
  }

  private currentOffset(track: AudioTrack): number {
    if (this.active?.track !== track || !this.context) return this.offsets[track]
    return this.active.offset + Math.max(0, this.context.currentTime - this.active.startedAt)
  }

  private getContext(): AudioContext | null {
    if (this.context) return this.context
    if (typeof AudioContext === 'undefined') return null
    try {
      const context = new AudioContext()
      const master = context.createGain()
      master.connect(context.destination)
      this.context = context
      this.master = master
      this.syncVolume()
      return context
    } catch { return null }
  }

  private syncVolume(): void {
    if (!this.master || !this.context) return
    this.master.gain.setValueAtTime(this.isMuted ? 0 : this.volume / 100, this.context.currentTime)
  }

  private loadBuffer(part: AudioPart, context: AudioContext): Promise<AudioBuffer | null> {
    const buffer = this.buffers.get(part)
    if (buffer) return Promise.resolve(buffer)
    const pending = this.loading.get(part)
    if (pending) return pending
    const loading = (async () => {
      try {
        const response = await fetch(TRACK_SOURCES[part])
        if (!response.ok) return null
        const decoded = await context.decodeAudioData(await response.arrayBuffer())
        if (!Number.isFinite(decoded.duration) || decoded.duration <= 0) return null
        const result = this.trimPadding(part, decoded, context)
        this.buffers.set(part, result)
        return result
      } catch { return null }
      finally { this.loading.delete(part) }
    })()
    this.loading.set(part, loading)
    return loading
  }

  private trimPadding(part: AudioPart, buffer: AudioBuffer, context: AudioContext): AudioBuffer {
    if (part === 'corona') return buffer
    const frames = MP3_FRAMES[part]
    const fullDuration = frames.padded / MP3_SAMPLE_RATE
    if (Math.abs(buffer.duration - fullDuration) > 1 / buffer.sampleRate) return buffer
    const start = Math.round(MP3_PRIMING_FRAMES / MP3_SAMPLE_RATE * buffer.sampleRate)
    const length = Math.round(frames.valid / MP3_SAMPLE_RATE * buffer.sampleRate)
    const trimmed = context.createBuffer(buffer.numberOfChannels, length, buffer.sampleRate)
    for (let channel = 0; channel < buffer.numberOfChannels; channel++) {
      trimmed.copyToChannel(buffer.getChannelData(channel).subarray(start, start + length), channel)
    }
    return trimmed
  }

  private startMusic(track: AudioTrack, context: AudioContext): void {
    if (!this.master) return
    const now = context.currentTime
    const offset = this.offsets[track]
    const envelope = context.createGain()
    envelope.connect(this.master)
    const sources: AudioBufferSourceNode[] = []
    const schedule = (part: AudioPart, when: number, position: number, loop: boolean) => {
      const source = context.createBufferSource()
      sources.push(source)
      source.buffer = this.buffers.get(part)!
      source.loop = loop
      source.connect(envelope)
      source.start(when, position)
    }
    try {
      if (track === 'menu') {
        const progress = Math.min(1, offset / MENU_FADE_SECONDS)
        envelope.gain.setValueAtTime(progress, now)
        if (progress < 1) envelope.gain.linearRampToValueAtTime(1, now + MENU_FADE_SECONDS - offset)
      } else envelope.gain.setValueAtTime(1, now)

      if (track === 'gainer') {
        const intro = this.buffers.get('intro')!
        const main = this.buffers.get('main')!
        if (offset < intro.duration) {
          schedule('intro', now, offset, false)
          // Both starts share the audio clock; no ended callback or timer gap.
          schedule('main', now + intro.duration - offset, 0, true)
        } else schedule('main', now, (offset - intro.duration) % main.duration, true)
      } else {
        schedule(track, now, offset % this.buffers.get(track)!.duration, true)
      }
      this.active = { track, offset, startedAt: now, sources, envelope }
    } catch {
      for (const source of sources) {
        try { source.stop() } catch { /* It may not have started. */ }
        source.disconnect()
      }
      envelope.disconnect()
    }
  }
}
