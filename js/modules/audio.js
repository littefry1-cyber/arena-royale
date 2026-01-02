/**
 * Arena Royale - Audio Module
 * Sound effects and audio management
 */

let audioCtx = null;

// Play a tone with given frequency and duration
function playTone(freq, dur) {
  if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  const osc = audioCtx.createOscillator();
  const gain = audioCtx.createGain();
  osc.connect(gain);
  gain.connect(audioCtx.destination);
  osc.frequency.value = freq;
  gain.gain.value = 0.1;
  osc.start();
  osc.stop(audioCtx.currentTime + dur / 1000);
}

// Sound effect definitions
const SOUNDS = {
  click: () => playTone(800, 50),
  deploy: () => playTone(400, 100),
  damage: () => playTone(200, 80),
  win: () => {
    playTone(523, 150);
    setTimeout(() => playTone(659, 150), 150);
    setTimeout(() => playTone(784, 200), 300);
  },
  lose: () => {
    playTone(392, 200);
    setTimeout(() => playTone(330, 200), 200);
    setTimeout(() => playTone(262, 300), 400);
  },
  upgrade: () => {
    playTone(600, 100);
    setTimeout(() => playTone(800, 100), 100);
    setTimeout(() => playTone(1000, 150), 200);
  },
  chest: () => {
    playTone(500, 100);
    setTimeout(() => playTone(700, 100), 150);
    setTimeout(() => playTone(900, 150), 300);
  },
  error: () => playTone(150, 200),
  success: () => {
    playTone(700, 100);
    setTimeout(() => playTone(900, 150), 100);
  },
  spawn: () => playTone(500, 80),
  hit: () => playTone(250, 50),
  explosion: () => {
    playTone(100, 150);
    setTimeout(() => playTone(80, 100), 50);
  },
  levelUp: () => {
    playTone(400, 100);
    setTimeout(() => playTone(600, 100), 100);
    setTimeout(() => playTone(800, 100), 200);
    setTimeout(() => playTone(1000, 200), 300);
  },
  notification: () => playTone(600, 100),
  coin: () => playTone(1200, 50),
  gem: () => {
    playTone(1000, 80);
    setTimeout(() => playTone(1200, 80), 50);
  }
};

// Play a named sound effect
function playSound(name) {
  if (SOUNDS[name]) {
    try {
      SOUNDS[name]();
    } catch (e) {
      // Audio might not be available
    }
  }
}

// Resume audio context (required after user interaction)
function resumeAudio() {
  if (audioCtx && audioCtx.state === 'suspended') {
    audioCtx.resume();
  }
}

// Export to global scope
window.GameAudio = {
  playTone,
  playSound,
  resumeAudio,
  SOUNDS
};

// Also export playSound and playTone directly for backward compatibility
window.playSound = playSound;
window.playTone = playTone;
