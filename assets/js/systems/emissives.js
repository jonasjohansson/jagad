// Emissive systems — lamps, cars audio-reactive, text BPM pulse, global emissive update
// Extracted from main.js

import * as THREE from "../lib/three/three.module.js";
import { getAudioFrequency, isAnalyserReady } from "./audio.js";

export function updateLamps(settings, STATE) {
  if (!STATE.lampMeshes || STATE.lampMeshes.length === 0) return;

  // Get audio frequency if audio-reactive is enabled
  let audioBoost = 0;
  if (settings.lampAudioReactive && isAnalyserReady()) {
    // Use low-mid frequencies for lamp pulsing
    const bass = getAudioFrequency(0, 8);
    const mid = getAudioFrequency(2, 8);
    audioBoost = (bass * 0.6 + mid * 0.4) * settings.lampAudioSensitivity;
  }

  const globalMult = settings.globalEmissiveMultiplier || 1.0;
  const baseIntensity = (settings.lampEmissiveIntensity || 2.0) * globalMult;
  const finalIntensity = baseIntensity + audioBoost;

  for (const mesh of STATE.lampMeshes) {
    if (mesh.material && mesh.material.emissiveIntensity !== undefined) {
      mesh.material.emissiveIntensity = finalIntensity;
    }
  }
}

export function updateCarsAudio(settings, chasers) {
  if (!chasers || chasers.length === 0) return;
  if (!settings.carAudioReactive) return;

  // BPM-based pulsing
  const bpm = settings.carAudioBPM || 95;
  const beatInterval = 60000 / bpm; // ms per beat
  const now = performance.now();
  const beatPhase = (now % beatInterval) / beatInterval; // 0 to 1

  // Create a pulse that peaks at the beat and fades
  // Using a sharp attack and smooth decay
  const pulse = Math.pow(1 - beatPhase, 3); // Exponential decay from beat
  const audioBoost = pulse * (settings.carAudioIntensity || 0.5);

  const chaserColors = [settings.chaser1Color, settings.chaser2Color, settings.chaser3Color, settings.chaser4Color];

  for (let i = 0; i < chasers.length; i++) {
    const chaser = chasers[i];
    if (chaser.isCarModel && chaser.cachedMaterials) {
      const chaserColor = chaserColors[i] || "#ffffff";
      const isSelected = chaser.ready || chaser.active;
      const baseEmissive = isSelected ? 0.3 : 0.05;
      // Only selected/ready chasers pulsate to the beat
      const intensity = isSelected ? baseEmissive + audioBoost : baseEmissive;

      for (const mat of chaser.cachedMaterials) {
        // Initialize emissive color once
        if (!mat._emissiveInitialized) {
          if (!mat.emissive) {
            mat.emissive = new THREE.Color(chaserColor);
          } else {
            mat.emissive.set(chaserColor);
          }
          mat._emissiveInitialized = true;
        }
        mat.emissiveIntensity = intensity;
      }
    }
  }
}

export function updateTextBPMPulse(settings, glassMaterials) {
  if (!settings.textBPMPulse || glassMaterials.length === 0) return;

  // BPM-based pulsing (same timing as cars)
  const bpm = settings.carAudioBPM || 95;
  const beatInterval = 60000 / bpm; // ms per beat
  const now = performance.now();
  const beatPhase = (now % beatInterval) / beatInterval; // 0 to 1

  // Create a pulse that peaks at the beat and fades
  const pulse = Math.pow(1 - beatPhase, 3); // Exponential decay from beat
  const pulseBoost = pulse * (settings.textBPMIntensity || 0.5);

  const baseBrightness = settings.glassTextBrightness || 1;
  const finalBrightness = baseBrightness + pulseBoost * baseBrightness;

  for (const mat of glassMaterials) {
    mat.color.setRGB(finalBrightness, finalBrightness, finalBrightness);
  }
}

export function updateAllEmissives(settings, STATE) {
  const globalMult = settings.globalEmissiveMultiplier || 1.0;

  // Update windows
  if (STATE.windowMeshes) {
    const intensity = (settings.windowEmissiveIntensity || 2.0) * globalMult;
    for (const mesh of STATE.windowMeshes) {
      if (mesh.material && mesh.material.emissiveIntensity !== undefined) {
        mesh.material.emissiveIntensity = intensity;
      }
    }
  }

  // Update lamps
  if (STATE.lampMeshes) {
    const intensity = (settings.lampEmissiveIntensity || 2.0) * globalMult;
    for (const mesh of STATE.lampMeshes) {
      if (mesh.material && mesh.material.emissiveIntensity !== undefined) {
        mesh.material.emissiveIntensity = intensity;
      }
    }
  }

  // Update roads
  if (STATE.roadMeshes) {
    const intensity = (settings.roadEmissiveIntensity || 1.0) * globalMult;
    for (const mesh of STATE.roadMeshes) {
      if (mesh.material && mesh.material.emissiveIntensity !== undefined) {
        mesh.material.emissiveIntensity = intensity;
      }
    }
  }

  // Update paths
  if (STATE.pathMeshes) {
    const intensity = (settings.pathEmissiveIntensity || 1.0) * globalMult;
    for (const mesh of STATE.pathMeshes) {
      if (mesh.material && mesh.material.emissiveIntensity !== undefined) {
        mesh.material.emissiveIntensity = intensity;
      }
    }
  }

  // Update other emissive meshes
  if (STATE.otherEmissiveMeshes) {
    const intensity = (settings.otherEmissiveIntensity || 1.0) * globalMult;
    for (const mesh of STATE.otherEmissiveMeshes) {
      if (mesh.material && mesh.material.emissiveIntensity !== undefined) {
        mesh.material.emissiveIntensity = intensity;
      }
    }
  }
}
