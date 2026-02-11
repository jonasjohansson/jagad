// Boost system — per-player momentary speed boost

export function createBoostState(chaserCount, settings) {
  const maxCount = (settings && settings.boostMaxCount) || 1;
  return Array.from({ length: chaserCount }, () => ({
    remaining: maxCount,
    active: false,
    timer: 0,
  }));
}

export function triggerBoost(boostStates, playerIndex, settings) {
  const state = boostStates[playerIndex];
  if (!state || state.remaining <= 0 || state.active) return false;
  state.remaining--;
  state.active = true;
  state.timer = settings.boostDuration;
  return true;
}

export function updateBoosts(boostStates, dt) {
  for (const state of boostStates) {
    if (!state.active) continue;
    state.timer -= dt;
    if (state.timer <= 0) {
      state.timer = 0;
      state.active = false;
    }
  }
}

export function getBoostMultiplier(boostStates, playerIndex, settings) {
  const state = boostStates[playerIndex];
  if (state && state.active) return settings.boostMultiplier;
  return 1;
}

export function resetBoosts(boostStates, settings) {
  for (const state of boostStates) {
    state.remaining = settings.boostMaxCount;
    state.active = false;
    state.timer = 0;
  }
}

export function addBoostGUI(gui, settings) {
  const folder = gui.addFolder("Boost");
  folder.add(settings, "boostMultiplier", 1, 5, 0.1).name("Multiplier");
  folder.add(settings, "boostDuration", 0.5, 5, 0.1).name("Duration (s)");
  folder.add(settings, "boostMaxCount", 1, 10, 1).name("Max Per Player");
  folder.close();
}
