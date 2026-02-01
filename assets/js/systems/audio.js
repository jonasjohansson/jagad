// Audio system module
// Handles background music playback and control

import { PATHS } from "../game/constants.js";

let audioElement = null;
let audioInitialized = false;

export function initAudio(settings) {
  if (audioInitialized) return;

  audioElement = new Audio();
  audioElement.loop = true;
  audioElement.volume = settings.audioVolume;

  const trackPath = PATHS.audio[settings.audioTrack];
  if (trackPath) {
    audioElement.src = trackPath;
  }

  audioInitialized = true;
}

export function playAudio() {
  if (audioElement && audioElement.paused) {
    audioElement.play().catch(() => {
      // Autoplay blocked - will play on user interaction
    });
  }
}

export function pauseAudio() {
  if (audioElement && !audioElement.paused) {
    audioElement.pause();
  }
}

export function setAudioVolume(volume) {
  if (audioElement) {
    audioElement.volume = volume;
  }
}

export function setAudioTrack(trackName) {
  const trackPath = PATHS.audio[trackName];
  if (trackPath && audioElement) {
    const wasPlaying = !audioElement.paused;
    audioElement.src = trackPath;
    if (wasPlaying) {
      audioElement.play().catch(() => {});
    }
  }
}

export function getAudioElement() {
  return audioElement;
}

export function isAudioPlaying() {
  return audioElement && !audioElement.paused;
}
