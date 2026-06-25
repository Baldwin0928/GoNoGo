// Split from app.js - layered layout engine and arrange animation
function calculateLayeredLayout(nodes, edges) {
  const startMs = performance.now();
  const metrics = { nodes: nodes.length, edges: edges.length, crossings: 0, layers: 0, maxWidth: 0, longEdges: 0, runtimeMs: 0 };
  
  // 1. Cycle Detection (DFS)
  const adj = new Map(nodes.map(n => [n.id, []]));
  const edgeMap = new Map();
  edges.forEach(e => {
    // Flow is from blocker (childId) to blocked (parentId)
    if (adj.has(e.childId) && adj.has(e.parentId)) {
      adj.get(e.childId).push(e.parentId);
      edgeMap.set(`${e.childId}->${e.parentId}`, e);
    }
  });
  
  const visited = new Set();
  const recStack = new Set();
  const cycles = [];
  const acyclicEdges = [];
  
  function dfs(v, path) {
    visited.add(v);
    recStack.add(v);
    for (const w of adj.get(v)) {
      if (!visited.has(w)) {
        dfs(w, [...path, w]);
        acyclicEdges.push({ source: v, target: w });
      } else if (recStack.has(w)) {
        cycles.push([...path, w]);
      } else {
        acyclicEdges.push({ source: v, target: w });
      }
    }
    recStack.delete(v);
  }
  
  nodes.forEach(n => {
    if (!visited.has(n.id)) dfs(n.id, [n.id]);
  });
  
  // 2. Layer Assignment (Longest Path to Root)
  const inDegree = new Map(nodes.map(n => [n.id, 0]));
  const outAdj = new Map(nodes.map(n => [n.id, []]));
  acyclicEdges.forEach(e => {
    inDegree.set(e.target, inDegree.get(e.target) + 1);
    outAdj.get(e.source).push(e.target);
  });
  
  // Topological sort to find longest path
  let queue = nodes.filter(n => inDegree.get(n.id) === 0).map(n => n.id);
  const topoOrder = [];
  while (queue.length > 0) {
    const u = queue.shift();
    topoOrder.push(u);
    outAdj.get(u).forEach(v => {
      inDegree.set(v, inDegree.get(v) - 1);
      if (inDegree.get(v) === 0) queue.push(v);
    });
  }
  
  const distToRoot = new Map();
  nodes.forEach(n => distToRoot.set(n.id, 0));
  
  // Reverse topological order to compute max distance to the end (root)
  for (let i = topoOrder.length - 1; i >= 0; i--) {
    const u = topoOrder[i];
    let maxDist = 0;
    outAdj.get(u).forEach(v => {
      maxDist = Math.max(maxDist, distToRoot.get(v) + 1);
    });
    distToRoot.set(u, maxDist);
  }
  
  const maxDepth = Math.max(0, ...Array.from(distToRoot.values()));
  const totalLayersCount = isNaN(maxDepth) || maxDepth < 0 ? 1 : maxDepth + 1;
  metrics.layers = totalLayersCount;
  
  // Group nodes by layer
  const layers = Array.from({length: totalLayersCount}, () => []);
  const layerMap = new Map();
  nodes.forEach(n => {
    // Distance to root determines column. Root is at maxDepth (rightmost).
    // Blockers are at lower columns (leftmost).
    let l = maxDepth - (distToRoot.get(n.id) || 0);
    if (isNaN(l) || l < 0) l = 0;
    if (l >= totalLayersCount) l = totalLayersCount - 1;
    layers[l].push(n);
    layerMap.set(n.id, l);
  });
  
  metrics.maxWidth = Math.max(0, ...layers.map(l => l.length));
  
  acyclicEdges.forEach(e => {
    const targetLayer = layerMap.get(e.target);
    const sourceLayer = layerMap.get(e.source);
    if (typeof targetLayer === 'number' && typeof sourceLayer === 'number' && (targetLayer - sourceLayer > 1)) {
      metrics.longEdges++;
    }
  });
  
  // 3. Crossing Reduction (Multiple Sweeps)
  layers.forEach(layer => layer.sort((a, b) => a.id - b.id)); // Deterministic initial sort
  
  function getCrossings(layerConfig) {
    let cross = 0;
    for (let i = 0; i < layerConfig.length - 1; i++) {
      const l1 = layerConfig[i];
      const l2 = layerConfig[i+1];
      const l1Pos = new Map(l1.map((n, idx) => [n.id, idx]));
      const l2Pos = new Map(l2.map((n, idx) => [n.id, idx]));
      const layerEdges = acyclicEdges.filter(e => l1Pos.has(e.source) && l2Pos.has(e.target));
      
      for (let j = 0; j < layerEdges.length; j++) {
        for (let k = j + 1; k < layerEdges.length; k++) {
          const e1 = layerEdges[j];
          const e2 = layerEdges[k];
          const s1 = l1Pos.get(e1.source), t1 = l2Pos.get(e1.target);
          const s2 = l1Pos.get(e2.source), t2 = l2Pos.get(e2.target);
          if ((s1 < s2 && t1 > t2) || (s1 > s2 && t1 < t2)) cross++;
        }
      }
    }
    return cross;
  }
  
  let bestCrossings = getCrossings(layers);
  let bestLayers = layers.map(l => [...l]);
  
  const MAX_SWEEPS = 8;
  for (let sweep = 0; sweep < MAX_SWEEPS; sweep++) {
    // Forward sweep
    for (let i = 1; i < layers.length; i++) {
      const prevPos = new Map(layers[i-1].map((n, idx) => [n.id, idx]));
      layers[i].forEach(n => {
        const parents = acyclicEdges.filter(e => e.target === n.id && prevPos.has(e.source)).map(e => prevPos.get(e.source));
        n._bary = parents.length ? parents.reduce((a,b)=>a+b,0)/parents.length : n.id * 0.0001;
      });
      layers[i].sort((a, b) => a._bary - b._bary);
    }
    
    // Backward sweep
    for (let i = layers.length - 2; i >= 0; i--) {
      const nextPos = new Map(layers[i+1].map((n, idx) => [n.id, idx]));
      layers[i].forEach(n => {
        const children = acyclicEdges.filter(e => e.source === n.id && nextPos.has(e.target)).map(e => nextPos.get(e.target));
        n._bary = children.length ? children.reduce((a,b)=>a+b,0)/children.length : n.id * 0.0001;
      });
      layers[i].sort((a, b) => a._bary - b._bary);
    }
    
    const currentCrossings = getCrossings(layers);
    if (currentCrossings < bestCrossings) {
      bestCrossings = currentCrossings;
      bestLayers = layers.map(l => [...l]);
    }
  }
  metrics.crossings = bestCrossings;
  
  // 4. Coordinate Assignment
  const positions = new Map();
  const centerY = 318;
  
  // Assign initial Y evenly to preserve crossing reduction order
  bestLayers.forEach(layer => {
    layer.forEach((n, idx) => {
      n._idealY = idx * NODE_ROW_GAP;
    });
    const avgY = (layer.length - 1) * NODE_ROW_GAP / 2;
    layer.forEach(n => n._idealY -= avgY);
  });
  
  function applyTargetY(nodes) {
    if (nodes.length === 0) return;
    nodes.forEach(n => n._idealY = n._targetY);
    nodes.sort((a,b) => a._idealY - b._idealY);
    
    // Resolve overlaps
    for (let j = 1; j < nodes.length; j++) {
      if (nodes[j]._idealY < nodes[j-1]._idealY + NODE_ROW_GAP) {
        nodes[j]._idealY = nodes[j-1]._idealY + NODE_ROW_GAP;
      }
    }
    
    // Shift block to maintain its target center of mass
    const currentSum = nodes.reduce((a,b) => a + b._idealY, 0);
    const targetSum = nodes.reduce((a,b) => a + b._targetY, 0);
    const drift = (currentSum - targetSum) / nodes.length;
    nodes.forEach(n => n._idealY -= drift);
  }
  
  // Resolve overlaps & align to parents and children (alternating sweeps)
  // We do backward sweep first so the root node (rightmost) acts as the anchor,
  // and the left nodes branch out from it, creating a perfect tree shape.
  for (let sweep = 0; sweep < 4; sweep++) {
    // Backward sweep (Right to Left)
    for (let i = bestLayers.length - 2; i >= 0; i--) {
      bestLayers[i].forEach(n => {
        const children = acyclicEdges.filter(e => e.source === n.id && bestLayers[i+1].find(c => c.id === e.target))
          .map(e => bestLayers[i+1].find(c => c.id === e.target)._idealY);
        if (children.length) {
          n._targetY = children.reduce((a,b)=>a+b,0)/children.length;
        } else {
          n._targetY = n._idealY;
        }
      });
      applyTargetY(bestLayers[i]);
    }
    
    // Forward sweep (Left to Right)
    for (let i = 1; i < bestLayers.length; i++) {
      bestLayers[i].forEach(n => {
        const parents = acyclicEdges.filter(e => e.target === n.id && bestLayers[i-1].find(p => p.id === e.source))
          .map(e => bestLayers[i-1].find(p => p.id === e.source)._idealY);
        if (parents.length) {
          n._targetY = parents.reduce((a,b)=>a+b,0)/parents.length;
        } else {
          n._targetY = n._idealY;
        }
      });
      applyTargetY(bestLayers[i]);
    }
  }

  // Add a final backward sweep to guarantee the leaf nodes branch out symmetrically from the root
  for (let i = bestLayers.length - 2; i >= 0; i--) {
    bestLayers[i].forEach(n => {
      const children = acyclicEdges.filter(e => e.source === n.id && bestLayers[i+1].find(c => c.id === e.target))
        .map(e => bestLayers[i+1].find(c => c.id === e.target)._idealY);
      if (children.length) {
        n._targetY = children.reduce((a,b)=>a+b,0)/children.length;
      } else {
        n._targetY = n._idealY;
      }
    });
    applyTargetY(bestLayers[i]);
  }
  // Calculate global center of mass of the root layer to avoid global drift
  const rootLayer = bestLayers[bestLayers.length - 1];
  const rootDrift = rootLayer && rootLayer.length ? rootLayer.reduce((a,b)=>a+b._idealY, 0) / rootLayer.length : 0;
  if (rootDrift !== 0) {
    bestLayers.forEach(layer => layer.forEach(n => n._idealY -= rootDrift));
  }
  
  const totalLayers = bestLayers.length;
  bestLayers.forEach((layer, layerIdx) => {
    // We want the highest layer index (roots) on the right
    const colIndex = layerIdx; 
    layer.forEach(n => {
      const x = 32 + colIndex * NODE_COLUMN_GAP;
      const y = centerY + (n._idealY || 0); // fallback to 0 if NaN just in case
      positions.set(n.id, { x, y });
    });
  });

  // Propagate alignment from the campaign side back to the blockers.
  // This is intentionally edge-local: unrelated branches in the same column should
  // not shove each other around. Nodes with the same downstream target set are
  // centered as a group around that target-set centroid.
  const outgoingTargets = acyclicEdges.reduce((groups, edge) => {
    if (!positions.has(edge.source) || !positions.has(edge.target)) return groups;
    const list = groups.get(edge.source) || [];
    list.push(edge.target);
    groups.set(edge.source, list);
    return groups;
  }, new Map());
  const layersByIndex = Array.from({ length: totalLayers }, () => []);
  positions.forEach((pos, id) => {
    const layerIndex = layerMap.get(id);
    if (typeof layerIndex === "number") layersByIndex[layerIndex].push(id);
  });
  for (let layerIndex = totalLayers - 2; layerIndex >= 0; layerIndex--) {
    const groups = new Map();
    layersByIndex[layerIndex].forEach((nodeId) => {
      const targets = Array.from(new Set(outgoingTargets.get(nodeId) || [])).sort((a, b) => a - b);
      if (!targets.length) return;
      const key = targets.join("|");
      const group = groups.get(key) || { targets, nodes: [] };
      group.nodes.push(nodeId);
      groups.set(key, group);
    });
    groups.forEach((group) => {
      const targetPositions = group.targets.map((targetId) => positions.get(targetId)).filter(Boolean);
      if (!targetPositions.length) return;
      const centroidY = targetPositions.reduce((sum, pos) => sum + pos.y + NODE_CENTER_Y, 0) / targetPositions.length - NODE_CENTER_Y;
      group.nodes.sort((a, b) => (positions.get(a)?.y || 0) - (positions.get(b)?.y || 0) || a - b);
      const startY = centroidY - ((group.nodes.length - 1) * NODE_ROW_GAP) / 2;
      group.nodes.forEach((nodeId, index) => {
        const pos = positions.get(nodeId);
        if (!pos) return;
        positions.set(nodeId, { ...pos, y: startY + index * NODE_ROW_GAP });
      });
    });
  }
  
  // Prevent going off top edge
  const yValues = Array.from(positions.values()).map(p => p.y).filter(y => typeof y === 'number' && !isNaN(y));
  if (yValues.length > 0) {
    const minY = Math.min(0, ...yValues);
    if (minY < 28) {
      const offset = 28 - minY;
      positions.forEach(pos => {
        if (pos && typeof pos.y === 'number' && !isNaN(pos.y)) {
          pos.y += offset;
        }
      });
    }
  }
  
  metrics.runtimeMs = performance.now() - startMs;
  return { positions, metrics, cycles };
}

function getLayoutPositions(uniqueNodes, edges, useSaved = true) {
  // If the user's saved layout was poisoned with NaN by the old buggy algorithm, force recalculate
  const hasPoisonedData = uniqueNodes.some(n => {
    const pos = state.layout?.[n.id];
    return pos && (isNaN(pos.x) || isNaN(pos.y));
  });
  
  const missing = uniqueNodes.some(n => !state.layout?.[n.id]);
  
  if (!useSaved || missing || hasPoisonedData) {
    const layoutResult = calculateLayeredLayout(uniqueNodes, edges);
    state.layout = state.layout || {};
    layoutResult.positions.forEach((pos, id) => {
      if (!useSaved || !state.layout[id]) {
        state.layout[id] = pos;
      }
    });
    
    const warningsDiv = document.getElementById("layoutWarnings");
    if (warningsDiv && layoutResult.cycles.length > 0) {
      const cycleStr = layoutResult.cycles[0].map(id => byId(id)?.name || id).join(" -> ");
      warningsDiv.textContent = `Warning: Cycle detected (${cycleStr})`;
      warningsDiv.classList.remove("is-hidden");
    } else if (warningsDiv) {
      warningsDiv.classList.add("is-hidden");
    }
  }
  const positions = new Map();
  uniqueNodes.forEach(n => positions.set(n.id, state.layout[n.id]));
  return positions;
}

function animateLayout(newPositions) {
  const duration = 400;
  const startTime = performance.now();
  const oldPositions = new Map();
  
  document.querySelectorAll('.graph-node').forEach(el => {
    const id = Number(el.dataset.nodeId);
    const transform = el.getAttribute('transform');
    if (transform) {
      const match = transform.match(/translate\(([\d.-]+),\s*([\d.-]+)\)/);
      if (match) {
        const x = Number(match[1]);
        const y = Number(match[2]);
        if (!isNaN(x) && !isNaN(y)) {
          oldPositions.set(id, { x, y });
        }
      }
    }
  });

  function step(now) {
    const progress = Math.min(1, (now - startTime) / duration);
    const ease = 1 - Math.pow(1 - progress, 3); // easeOutCubic
    
    newPositions.forEach((targetPos, id) => {
      const oldPos = oldPositions.get(id) || targetPos;
      
      // Safety check to absolutely prevent NaN from entering the state cache
      const newX = oldPos.x + (targetPos.x - oldPos.x) * ease;
      const newY = oldPos.y + (targetPos.y - oldPos.y) * ease;
      
      if (!isNaN(newX) && !isNaN(newY)) {
        state.layout[id] = { x: newX, y: newY };
      }
    });
    
    renderAll();
    
    if (progress < 1) {
      requestAnimationFrame(step);
    } else {
      newPositions.forEach((pos, id) => {
        if (!isNaN(pos.x) && !isNaN(pos.y)) {
          state.layout[id] = { x: pos.x, y: pos.y };
        }
      });
      saveState();
      renderAll();
    }
  }
  requestAnimationFrame(step);
}
