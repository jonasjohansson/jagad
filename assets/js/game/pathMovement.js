// Path-based movement — actor path following, node decisions, fugitive AI
// Extracted from main.js

let _settings = null;
let _STATE = null;
let _chasers = null;
let _fugitives = null;
let _getChaserInputDirection = null;

export function initPathMovement(settings, STATE, chasers, fugitives, getChaserInputDirection) {
  _settings = settings;
  _STATE = STATE;
  _chasers = chasers;
  _fugitives = fugitives;
  _getChaserInputDirection = getChaserInputDirection;
}

// Initialize actor on path graph
export function initActorOnPath(actor) {
  const { pathGraph, findNearestEdgePoint, projectYOnRoad } = _STATE;
  if (!pathGraph || pathGraph.edges.length === 0) return;

  const pos = actor.mesh.position;
  const nearest = findNearestEdgePoint(pos.x, pos.z, pathGraph);

  if (nearest.edge) {
    actor.currentEdge = nearest.edge;
    actor.edgeT = nearest.t; // 0-1 position along edge
    actor.edgeDir = 1; // +1 = toward node2, -1 = toward node1

    // Snap to edge
    pos.x = nearest.point.x;
    pos.z = nearest.point.z;
    projectYOnRoad(pos);

    // Set direction based on edge
    const dx = actor.currentEdge.x2 - actor.currentEdge.x1;
    const dz = actor.currentEdge.z2 - actor.currentEdge.z1;
    actor.dirX = Math.sign(dx) || 0;
    actor.dirZ = Math.sign(dz) || 0;
  }
}

// Get position on edge from t value
export function getEdgePosition(edge, t) {
  return {
    x: edge.x1 + (edge.x2 - edge.x1) * t,
    z: edge.z1 + (edge.z2 - edge.z1) * t
  };
}

// Find edge at node going in specified direction (uses dot product for best match)
export function findEdgeInDirection(node, dirX, dirZ, pathGraph, excludeEdge = null) {
  let bestMatch = null;
  let bestDot = -Infinity;

  for (const edgeId of node.edges) {
    if (excludeEdge && edgeId === excludeEdge.id) continue;

    const edge = pathGraph.edges[edgeId];
    let edgeDirX, edgeDirZ;

    if (edge.node1 === node.id) {
      edgeDirX = edge.x2 - edge.x1;
      edgeDirZ = edge.z2 - edge.z1;
    } else {
      edgeDirX = edge.x1 - edge.x2;
      edgeDirZ = edge.z1 - edge.z2;
    }

    // Normalize edge direction
    const len = Math.sqrt(edgeDirX * edgeDirX + edgeDirZ * edgeDirZ);
    if (len < 0.001) continue;
    edgeDirX /= len;
    edgeDirZ /= len;

    // Dot product with requested direction
    const dot = edgeDirX * dirX + edgeDirZ * dirZ;

    // Only consider edges going roughly in the right direction (dot > 0.5 = within ~60 degrees)
    if (dot > 0.5 && dot > bestDot) {
      bestDot = dot;
      bestMatch = { edge, startFromNode1: edge.node1 === node.id };
    }
  }
  return bestMatch;
}

// Get all available directions at a node
export function getAvailableDirectionsAtNode(node, pathGraph) {
  const directions = [];
  for (const edgeId of node.edges) {
    const edge = pathGraph.edges[edgeId];
    let dirX, dirZ, startFromNode1;

    if (edge.node1 === node.id) {
      dirX = edge.x2 - edge.x1;
      dirZ = edge.z2 - edge.z1;
      startFromNode1 = true;
    } else {
      dirX = edge.x1 - edge.x2;
      dirZ = edge.z1 - edge.z2;
      startFromNode1 = false;
    }

    // Normalize direction
    const len = Math.sqrt(dirX * dirX + dirZ * dirZ);
    if (len > 0.001) {
      dirX /= len;
      dirZ /= len;
    }

    directions.push({ edge, dirX, dirZ, startFromNode1 });
  }
  return directions;
}

export function updateFugitiveMovementPath(actor, dt) {
  const { pathGraph, projectYOnRoad } = _STATE;
  if (!pathGraph || !actor.currentEdge) return;

  const pos = actor.mesh.position;
  const moveDistance = actor.speed * dt;

  // Mid-edge juke: small chance of reversing direction when a chaser is close
  const midEdgeJukeChance = _settings.fugitiveMidEdgeJukeChance || 0.03;
  if (midEdgeJukeChance > 0 && actor.edgeT > 0.1 && actor.edgeT < 0.9) {
    let nearestChaserDist = Infinity;
    for (const c of _chasers) {
      if (!c.active) continue;
      const dx = pos.x - c.mesh.position.x;
      const dz = pos.z - c.mesh.position.z;
      nearestChaserDist = Math.min(nearestChaserDist, Math.sqrt(dx * dx + dz * dz));
    }
    const dangerRadius = _settings.fugitiveDangerRadius || 4;
    if (nearestChaserDist < dangerRadius && Math.random() < midEdgeJukeChance * dt) {
      actor.edgeDir *= -1;
      actor.dirX *= -1;
      actor.dirZ *= -1;
    }
  }

  // Move along current edge
  const edgeLength = actor.currentEdge.length;
  const tDelta = (moveDistance / edgeLength) * actor.edgeDir;
  actor.edgeT += tDelta;

  // Check if reached a node
  if (actor.edgeT >= 1) {
    actor.edgeT = 1;
    const nodeId = actor.currentEdge.node2;
    handleFugitiveAtNode(actor, pathGraph.nodes[nodeId], pathGraph);
  } else if (actor.edgeT <= 0) {
    actor.edgeT = 0;
    const nodeId = actor.currentEdge.node1;
    handleFugitiveAtNode(actor, pathGraph.nodes[nodeId], pathGraph);
  }

  // Update position
  const newPos = getEdgePosition(actor.currentEdge, actor.edgeT);
  pos.x = newPos.x;
  pos.z = newPos.z;
  projectYOnRoad(pos);
}

function handleFugitiveAtNode(actor, node, pathGraph) {
  const intelligence = _STATE.fugitiveIntelligenceOverride != null ? _STATE.fugitiveIntelligenceOverride : _settings.fugitiveIntelligence;
  const available = getAvailableDirectionsAtNode(node, pathGraph);

  if (available.length === 0) return;

  // Calculate threat direction from chasers
  let threatX = 0, threatZ = 0;
  let closestDist = Infinity;

  for (const c of _chasers) {
    if (!c.active) continue;
    const dx = actor.mesh.position.x - c.mesh.position.x;
    const dz = actor.mesh.position.z - c.mesh.position.z;
    const dist = Math.sqrt(dx * dx + dz * dz);
    if (dist < closestDist) closestDist = dist;
    if (dist > 0.1) {
      const weight = 1 / (dist * dist + 0.1);
      threatX += (dx / dist) * weight;
      threatZ += (dz / dist) * weight;
    }
  }

  // Calculate separation from other fugitives
  let separationX = 0, separationZ = 0;
  const separationRange = 5; // Distance within which fugitives repel each other

  for (const f of _fugitives) {
    if (f === actor) continue;
    const dx = actor.mesh.position.x - f.mesh.position.x;
    const dz = actor.mesh.position.z - f.mesh.position.z;
    const dist = Math.sqrt(dx * dx + dz * dz);
    if (dist > 0.1 && dist < separationRange) {
      // Stronger repulsion when closer
      const weight = 1 / (dist * dist + 0.1);
      separationX += (dx / dist) * weight;
      separationZ += (dz / dist) * weight;
    }
  }

  const threatLen = Math.sqrt(threatX * threatX + threatZ * threatZ);
  const hasThreat = threatLen > 0.01 && closestDist < 30;

  const separationLen = Math.sqrt(separationX * separationX + separationZ * separationZ);
  const hasSeparation = separationLen > 0.01;

  let chosen;

  if (hasThreat && Math.random() < intelligence) {
    // Escape: choose direction most aligned with escape
    threatX /= threatLen;
    threatZ /= threatLen;

    // Blend in separation if fugitives are close
    if (hasSeparation) {
      separationX /= separationLen;
      separationZ /= separationLen;
      // Chasers are more important (0.7) but separation also matters (0.3)
      threatX = threatX * 0.7 + separationX * 0.3;
      threatZ = threatZ * 0.7 + separationZ * 0.3;
      const blendLen = Math.sqrt(threatX * threatX + threatZ * threatZ);
      if (blendLen > 0.01) {
        threatX /= blendLen;
        threatZ /= blendLen;
      }
    }

    let bestScore = -Infinity;
    for (const dir of available) {
      const score = dir.dirX * threatX + dir.dirZ * threatZ;
      if (score > bestScore) {
        bestScore = score;
        chosen = dir;
      }
    }
    // Unpredictable juke: occasionally pick a random non-worst direction
    const jukeChance = _settings.fugitiveJukeChance || 0.15;
    if (available.length > 1 && Math.random() < jukeChance) {
      const scored = available.map(dir => ({
        dir,
        score: dir.dirX * threatX + dir.dirZ * threatZ
      })).sort((a, b) => b.score - a.score);
      const jukeOptions = scored.slice(0, -1);
      chosen = jukeOptions[Math.floor(Math.random() * jukeOptions.length)].dir;
    }
  } else if (hasSeparation && Math.random() < 0.6) {
    // No chaser threat but fugitives nearby: move away from them
    separationX /= separationLen;
    separationZ /= separationLen;

    let bestScore = -Infinity;
    for (const dir of available) {
      const score = dir.dirX * separationX + dir.dirZ * separationZ;
      if (score > bestScore) {
        bestScore = score;
        chosen = dir;
      }
    }
  } else {
    // Random: prefer not reversing
    const currentDirX = actor.dirX;
    const currentDirZ = actor.dirZ;
    const nonReverse = available.filter(d =>
      !(d.dirX === -currentDirX && d.dirZ === -currentDirZ)
    );
    const choices = nonReverse.length > 0 ? nonReverse : available;
    chosen = choices[Math.floor(Math.random() * choices.length)];
  }

  if (chosen) {
    actor.currentEdge = chosen.edge;
    actor.edgeT = chosen.startFromNode1 ? 0 : 1;
    actor.edgeDir = chosen.startFromNode1 ? 1 : -1;
    actor.dirX = chosen.dirX;
    actor.dirZ = chosen.dirZ;
  }
}

export function updateChaserMovementPath(actor, dt, chaserIndex) {
  const { pathGraph, projectYOnRoad } = _STATE;
  if (!pathGraph || !actor.currentEdge || !actor.active) {
    return;
  }

  const pos = actor.mesh.position;
  const moveDistance = actor.speed * dt;

  // Move along current edge
  const edgeLength = actor.currentEdge.length;
  const tDelta = (moveDistance / edgeLength) * actor.edgeDir;
  actor.edgeT += tDelta;

  // Check if reached a node
  if (actor.edgeT >= 1) {
    const overshoot = actor.edgeT - 1;
    actor.edgeT = 1;
    const nodeId = actor.currentEdge.node2;
    handleChaserAtNode(actor, pathGraph.nodes[nodeId], pathGraph, chaserIndex);
    // Apply overshoot to new edge
    if (actor.edgeT === 0) actor.edgeT = overshoot * (edgeLength / actor.currentEdge.length);
  } else if (actor.edgeT <= 0) {
    const overshoot = -actor.edgeT;
    actor.edgeT = 0;
    const nodeId = actor.currentEdge.node1;
    handleChaserAtNode(actor, pathGraph.nodes[nodeId], pathGraph, chaserIndex);
    // Apply overshoot to new edge
    if (actor.edgeT === 1) actor.edgeT = 1 - overshoot * (edgeLength / actor.currentEdge.length);
  }

  // Update position
  const newPos = getEdgePosition(actor.currentEdge, actor.edgeT);
  pos.x = newPos.x;
  pos.z = newPos.z;
  projectYOnRoad(pos);
  // Apply chaser height offset
  pos.y += _settings.chaserHeightOffset;

  // Rotate to face movement direction (headlight rotates with car automatically)
  const edge = actor.currentEdge;
  const travelDirX = (edge.x2 - edge.x1) * actor.edgeDir;
  const travelDirZ = (edge.z2 - edge.z1) * actor.edgeDir;
  if (Math.abs(travelDirX) > 0.01 || Math.abs(travelDirZ) > 0.01) {
    const targetRotation = Math.atan2(travelDirX, travelDirZ) + Math.PI;
    // Smooth rotation interpolation
    let currentRotation = actor.mesh.rotation.y;
    let diff = targetRotation - currentRotation;
    // Handle angle wrapping (-PI to PI)
    while (diff > Math.PI) diff -= Math.PI * 2;
    while (diff < -Math.PI) diff += Math.PI * 2;
    // Lerp towards target (adjust speed with multiplier)
    const rotationSpeed = 10;
    actor.mesh.rotation.y += diff * Math.min(1, rotationSpeed * dt);
  }
}

function handleChaserAtNode(actor, node, pathGraph, chaserIndex) {
  if (!node) return;

  // Get current cardinal direction (edges are strictly H or V)
  const curEdge = actor.currentEdge;
  const travelDirX = Math.sign(curEdge.x2 - curEdge.x1) * actor.edgeDir;
  const travelDirZ = Math.sign(curEdge.z2 - curEdge.z1) * actor.edgeDir;

  // Collect available edges with their cardinal directions
  const options = [];
  for (const edgeId of node.edges) {
    if (edgeId === actor.currentEdge.id) continue;

    const edge = pathGraph.edges[edgeId];
    const startFromNode1 = edge.node1 === node.id;
    const dirX = startFromNode1 ? edge.dirX : -edge.dirX;
    const dirZ = startFromNode1 ? edge.dirZ : -edge.dirZ;

    options.push({ edge, startFromNode1, dirX, dirZ });
  }

  // Dead end - stop moving
  if (options.length === 0) {
    actor.isMoving = false;
    return;
  }

  // Priority 1: Match queued input exactly (cardinal)
  if (actor.queuedDirX !== 0 || actor.queuedDirZ !== 0) {
    const match = options.find(o => o.dirX === actor.queuedDirX && o.dirZ === actor.queuedDirZ);
    if (match) {
      actor.currentEdge = match.edge;
      actor.edgeT = match.startFromNode1 ? 0 : 1;
      actor.edgeDir = match.startFromNode1 ? 1 : -1;
      actor.queuedDirX = 0;
      actor.queuedDirZ = 0;
      return;
    }
  }

  // Priority 2: Continue straight if possible
  const straight = options.find(o => o.dirX === travelDirX && o.dirZ === travelDirZ);
  if (straight) {
    actor.currentEdge = straight.edge;
    actor.edgeT = straight.startFromNode1 ? 0 : 1;
    actor.edgeDir = straight.startFromNode1 ? 1 : -1;
    return;
  }

  // No straight path and no queued turn — check live input as fallback
  const liveInput = _getChaserInputDirection(chaserIndex);
  if (liveInput.hasInput) {
    const liveMatch = options.find(o => o.dirX === liveInput.x && o.dirZ === liveInput.z);
    if (liveMatch) {
      actor.currentEdge = liveMatch.edge;
      actor.edgeT = liveMatch.startFromNode1 ? 0 : 1;
      actor.edgeDir = liveMatch.startFromNode1 ? 1 : -1;
      return;
    }
  }

  // No valid direction — stop at intersection
  actor.isMoving = false;
}
