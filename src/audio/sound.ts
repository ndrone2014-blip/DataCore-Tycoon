// Procedural sound effects and ambient music with the Web Audio API (no files).

let ac: AudioContext | null = null;
let sfxGain: GainNode | null = null;
let musicGain: GainNode | null = null;
let musicTimer: number | null = null;
let settings = { sfx: 0.6, music: 0.25, muted: false };

function ctx(): AudioContext | null {
  if (!ac) {
    try {
      ac = new (window.AudioContext || (window as any).webkitAudioContext)();
      sfxGain = ac.createGain();
      musicGain = ac.createGain();
      sfxGain.connect(ac.destination);
      musicGain.connect(ac.destination);
      applyVolumes();
    } catch {
      return null;
    }
  }
  if (ac.state === 'suspended') void ac.resume();
  return ac;
}

function applyVolumes() {
  if (!ac || !sfxGain || !musicGain) return;
  sfxGain.gain.value = settings.muted ? 0 : settings.sfx * 0.5;
  musicGain.gain.setTargetAtTime(settings.muted ? 0 : settings.music * 0.18, ac.currentTime, 0.4);
}

export function setAudioSettings(sfx: number, music: number, muted: boolean) {
  settings = { sfx, music, muted };
  applyVolumes();
  if (ac && !muted && music > 0) startMusic();
}

function tone(freq: number, dur: number, type: OscillatorType = 'sine', vol = 0.3, delay = 0, slide?: number) {
  const a = ctx();
  if (!a || !sfxGain) return;
  const t = a.currentTime + delay;
  const o = a.createOscillator();
  const g = a.createGain();
  o.type = type;
  o.frequency.setValueAtTime(freq, t);
  if (slide) o.frequency.exponentialRampToValueAtTime(slide, t + dur);
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(vol, t + 0.01);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(g).connect(sfxGain);
  o.start(t);
  o.stop(t + dur + 0.05);
}

function noise(dur: number, vol = 0.3, filterFreq = 800, delay = 0) {
  const a = ctx();
  if (!a || !sfxGain) return;
  const t = a.currentTime + delay;
  const buf = a.createBuffer(1, Math.floor(a.sampleRate * dur), a.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / d.length, 2);
  const src = a.createBufferSource();
  src.buffer = buf;
  const f = a.createBiquadFilter();
  f.type = 'lowpass';
  f.frequency.value = filterFreq;
  const g = a.createGain();
  g.gain.value = vol;
  src.connect(f).connect(g).connect(sfxGain);
  src.start(t);
}

export function playSfx(name: string) {
  if (settings.muted || settings.sfx <= 0) return;
  switch (name) {
    case 'click': tone(900, 0.05, 'triangle', 0.12); break;
    case 'nav': tone(620, 0.06, 'sine', 0.1); break;
    case 'buy': tone(660, 0.08, 'triangle', 0.25); tone(990, 0.14, 'triangle', 0.22, 0.07); break;
    case 'cash': tone(1320, 0.07, 'square', 0.08); tone(1760, 0.12, 'square', 0.08, 0.06); break;
    case 'demolish': noise(1.2, 0.5, 400); tone(80, 0.8, 'sawtooth', 0.2, 0, 40); break;
    case 'build': noise(0.15, 0.25, 2000); tone(220, 0.15, 'square', 0.1, 0.12); tone(220, 0.15, 'square', 0.1, 0.3); break;
    case 'speed': tone(400, 0.25, 'sawtooth', 0.12, 0, 1200); break;
    case 'install': tone(500, 0.05, 'square', 0.1); tone(750, 0.05, 'square', 0.1, 0.06); tone(1000, 0.08, 'square', 0.1, 0.12); break;
    case 'complete': [523, 659, 784, 1046].forEach((f, i) => tone(f, 0.25, 'triangle', 0.2, i * 0.09)); break;
    case 'contract': tone(587, 0.1, 'sine', 0.2); tone(880, 0.2, 'sine', 0.2, 0.08); break;
    case 'hire': tone(700, 0.1, 'sine', 0.18); tone(840, 0.15, 'sine', 0.16, 0.08); break;
    case 'research': tone(300, 0.4, 'sine', 0.15, 0, 900); break;
    case 'unlock': [440, 554, 659, 880].forEach((f, i) => tone(f, 0.3, 'sine', 0.18, i * 0.07)); break;
    case 'levelup': [523, 659, 784, 1046, 1318].forEach((f, i) => tone(f, 0.35, 'triangle', 0.22, i * 0.1)); break;
    case 'achievement': [784, 988, 1175, 1568].forEach((f, i) => tone(f, 0.4, 'sine', 0.2, i * 0.08)); break;
    case 'reward': tone(880, 0.1, 'triangle', 0.2); tone(1320, 0.25, 'triangle', 0.2, 0.08); break;
    case 'error': tone(200, 0.18, 'square', 0.12); tone(150, 0.2, 'square', 0.12, 0.12); break;
    case 'event_good': tone(660, 0.2, 'sine', 0.15); tone(990, 0.3, 'sine', 0.15, 0.15); break;
    case 'event_bad': tone(330, 0.3, 'sawtooth', 0.12); tone(247, 0.4, 'sawtooth', 0.12, 0.2); break;
  }
}

// Ambient generative music: slow evolving pad chords.
const CHORDS = [[220, 277.2, 329.6, 415.3], [196, 246.9, 293.7, 370], [174.6, 220, 261.6, 329.6], [196, 246.9, 311.1, 392]];
let chordIdx = 0;
export function startMusic() {
  const a = ctx();
  if (!a || !musicGain || musicTimer !== null) return;
  const play = () => {
    if (!ac || !musicGain) return;
    const t = ac.currentTime;
    const chord = CHORDS[chordIdx++ % CHORDS.length];
    for (const f of chord) {
      for (const det of [-4, 4]) {
        const o = ac.createOscillator();
        const g = ac.createGain();
        const flt = ac.createBiquadFilter();
        o.type = 'sawtooth';
        o.frequency.value = f / 2;
        o.detune.value = det;
        flt.type = 'lowpass';
        flt.frequency.setValueAtTime(400, t);
        flt.frequency.linearRampToValueAtTime(900, t + 4);
        flt.frequency.linearRampToValueAtTime(350, t + 8);
        g.gain.setValueAtTime(0.0001, t);
        g.gain.linearRampToValueAtTime(0.05, t + 2.5);
        g.gain.linearRampToValueAtTime(0.0001, t + 8.5);
        o.connect(flt).connect(g).connect(musicGain);
        o.start(t);
        o.stop(t + 9);
      }
    }
    // sparse arpeggio
    for (let i = 0; i < 4; i++) {
      if (Math.random() < 0.5) continue;
      const o = ac.createOscillator();
      const g = ac.createGain();
      o.type = 'sine';
      o.frequency.value = chord[Math.floor(Math.random() * 4)] * 2;
      const st = t + 1 + i * 1.6;
      g.gain.setValueAtTime(0.0001, st);
      g.gain.linearRampToValueAtTime(0.035, st + 0.05);
      g.gain.exponentialRampToValueAtTime(0.0001, st + 1.4);
      o.connect(g).connect(musicGain);
      o.start(st);
      o.stop(st + 1.5);
    }
  };
  play();
  musicTimer = window.setInterval(play, 8000);
}

export function unlockAudio() {
  ctx();
  if (settings.music > 0 && !settings.muted) startMusic();
}
