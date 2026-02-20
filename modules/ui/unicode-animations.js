/**
 * Unicode Braille Spinners
 * Extracted from unicode-animations (MIT) by Gunnar Gray
 *
 * Each braille char is a 2-col x 4-row dot grid.
 * Dot numbering & bit values:
 *   Row 0: dot1 (0x01)  dot4 (0x08)
 *   Row 1: dot2 (0x02)  dot5 (0x10)
 *   Row 2: dot3 (0x04)  dot6 (0x20)
 *   Row 3: dot7 (0x40)  dot8 (0x80)
 * Base codepoint: U+2800
 */

const DOT_MAP = [
  [0x01, 0x08],
  [0x02, 0x10],
  [0x04, 0x20],
  [0x40, 0x80],
];

function gridToBraille(grid) {
  const rows = grid.length;
  const cols = grid[0] ? grid[0].length : 0;
  const charCount = Math.ceil(cols / 2);
  let result = '';
  for (let c = 0; c < charCount; c++) {
    let code = 0x2800;
    for (let r = 0; r < 4 && r < rows; r++) {
      for (let d = 0; d < 2; d++) {
        const col = c * 2 + d;
        if (col < cols && grid[r] && grid[r][col]) {
          code |= DOT_MAP[r][d];
        }
      }
    }
    result += String.fromCodePoint(code);
  }
  return result;
}

function makeGrid(rows, cols) {
  if (rows <= 0 || cols <= 0) return [];
  return Array.from({ length: rows }, () => Array(cols).fill(false));
}

// --- Frame generators ---

function genScan() {
  const W = 8, H = 4, frames = [];
  for (let pos = -1; pos < W + 1; pos++) {
    const g = makeGrid(H, W);
    for (let r = 0; r < H; r++) {
      for (let c = 0; c < W; c++) {
        if (c === pos || c === pos - 1) g[r][c] = true;
      }
    }
    frames.push(gridToBraille(g));
  }
  return frames;
}

function genRain() {
  const W = 8, H = 4, totalFrames = 12, frames = [];
  const offsets = [0, 3, 1, 5, 2, 7, 4, 6];
  for (let f = 0; f < totalFrames; f++) {
    const g = makeGrid(H, W);
    for (let c = 0; c < W; c++) {
      const row = (f + offsets[c]) % (H + 2);
      if (row < H) g[row][c] = true;
    }
    frames.push(gridToBraille(g));
  }
  return frames;
}

function genScanLine() {
  const W = 6, H = 4, frames = [];
  const positions = [0, 1, 2, 3, 2, 1];
  for (const row of positions) {
    const g = makeGrid(H, W);
    for (let c = 0; c < W; c++) {
      g[row][c] = true;
      if (row > 0) g[row - 1][c] = (c % 2 === 0);
    }
    frames.push(gridToBraille(g));
  }
  return frames;
}

function genPulse() {
  const W = 6, H = 4, frames = [];
  const cx = W / 2 - 0.5, cy = H / 2 - 0.5;
  const radii = [0.5, 1.2, 2, 3, 3.5];
  for (const r of radii) {
    const g = makeGrid(H, W);
    for (let row = 0; row < H; row++) {
      for (let col = 0; col < W; col++) {
        const dist = Math.sqrt((col - cx) ** 2 + (row - cy) ** 2);
        if (Math.abs(dist - r) < 0.9) g[row][col] = true;
      }
    }
    frames.push(gridToBraille(g));
  }
  return frames;
}

function genSnake() {
  const W = 4, H = 4;
  const path = [];
  for (let r = 0; r < H; r++) {
    if (r % 2 === 0) {
      for (let c = 0; c < W; c++) path.push([r, c]);
    } else {
      for (let c = W - 1; c >= 0; c--) path.push([r, c]);
    }
  }
  const frames = [];
  for (let i = 0; i < path.length; i++) {
    const g = makeGrid(H, W);
    for (let t = 0; t < 4; t++) {
      const idx = (i - t + path.length) % path.length;
      g[path[idx][0]][path[idx][1]] = true;
    }
    frames.push(gridToBraille(g));
  }
  return frames;
}

function genSparkle() {
  const patterns = [
    [1,0,0,1,0,0,1,0, 0,0,1,0,0,1,0,0, 0,1,0,0,1,0,0,1, 1,0,0,0,0,1,0,0],
    [0,1,0,0,1,0,0,1, 1,0,0,1,0,0,0,1, 0,0,0,1,0,1,0,0, 0,0,1,0,1,0,1,0],
    [0,0,1,0,0,1,0,0, 0,1,0,0,0,0,1,0, 1,0,1,0,0,0,0,1, 0,1,0,1,0,0,0,1],
    [1,0,0,0,0,0,1,1, 0,0,1,0,1,0,0,0, 0,0,0,0,1,0,1,0, 1,0,0,1,0,0,1,0],
    [0,0,0,1,1,0,0,0, 0,1,0,0,0,1,0,1, 1,0,0,1,0,0,0,0, 0,1,0,0,0,1,0,1],
    [0,1,1,0,0,0,0,1, 0,0,0,1,0,0,1,0, 0,1,0,0,0,1,0,0, 0,0,1,0,1,0,0,0],
  ];
  const W = 8, H = 4, frames = [];
  for (const pat of patterns) {
    const g = makeGrid(H, W);
    for (let r = 0; r < H; r++) {
      for (let c = 0; c < W; c++) {
        g[r][c] = !!pat[r * W + c];
      }
    }
    frames.push(gridToBraille(g));
  }
  return frames;
}

function genCascade() {
  const W = 8, H = 4, frames = [];
  for (let offset = -2; offset < W + H; offset++) {
    const g = makeGrid(H, W);
    for (let r = 0; r < H; r++) {
      for (let c = 0; c < W; c++) {
        const diag = c + r;
        if (diag === offset || diag === offset - 1) g[r][c] = true;
      }
    }
    frames.push(gridToBraille(g));
  }
  return frames;
}

function genColumns() {
  const W = 6, H = 4, frames = [];
  for (let col = 0; col < W; col++) {
    for (let fillTo = H - 1; fillTo >= 0; fillTo--) {
      const g = makeGrid(H, W);
      for (let pc = 0; pc < col; pc++) {
        for (let r = 0; r < H; r++) g[r][pc] = true;
      }
      for (let r = fillTo; r < H; r++) g[r][col] = true;
      frames.push(gridToBraille(g));
    }
  }
  const full = makeGrid(H, W);
  for (let r = 0; r < H; r++) for (let c = 0; c < W; c++) full[r][c] = true;
  frames.push(gridToBraille(full));
  frames.push(gridToBraille(makeGrid(H, W)));
  return frames;
}

function genOrbit() {
  const W = 2, H = 4;
  const path = [
    [0,0], [0,1],
    [1,1], [2,1], [3,1],
    [3,0],
    [2,0], [1,0],
  ];
  const frames = [];
  for (let i = 0; i < path.length; i++) {
    const g = makeGrid(H, W);
    g[path[i][0]][path[i][1]] = true;
    const t1 = (i - 1 + path.length) % path.length;
    g[path[t1][0]][path[t1][1]] = true;
    frames.push(gridToBraille(g));
  }
  return frames;
}

function genBreathe() {
  const stages = [
    [],
    [[1,0]],
    [[0,1],[2,0]],
    [[0,0],[1,1],[3,0]],
    [[0,0],[1,1],[2,0],[3,1]],
    [[0,0],[0,1],[1,1],[2,0],[3,1]],
    [[0,0],[0,1],[1,0],[2,1],[3,0],[3,1]],
    [[0,0],[0,1],[1,0],[1,1],[2,0],[3,0],[3,1]],
    [[0,0],[0,1],[1,0],[1,1],[2,0],[2,1],[3,0],[3,1]],
  ];
  const frames = [];
  const sequence = [...stages, ...stages.slice().reverse().slice(1)];
  for (const dots of sequence) {
    const g = makeGrid(4, 2);
    for (const [r, c] of dots) g[r][c] = true;
    frames.push(gridToBraille(g));
  }
  return frames;
}

function genWaveRows() {
  const W = 8, H = 4, totalFrames = 16, frames = [];
  for (let f = 0; f < totalFrames; f++) {
    const g = makeGrid(H, W);
    for (let c = 0; c < W; c++) {
      const phase = (f - c * 0.5);
      const row = Math.round((Math.sin(phase * 0.8) + 1) / 2 * (H - 1));
      g[row][c] = true;
      if (row > 0) g[row - 1][c] = (f + c) % 3 === 0;
    }
    frames.push(gridToBraille(g));
  }
  return frames;
}

function genCheckerboard() {
  const W = 6, H = 4, frames = [];
  for (let phase = 0; phase < 4; phase++) {
    const g = makeGrid(H, W);
    for (let r = 0; r < H; r++) {
      for (let c = 0; c < W; c++) {
        if (phase < 2) {
          g[r][c] = (r + c + phase) % 2 === 0;
        } else {
          g[r][c] = (r + c + phase) % 3 === 0;
        }
      }
    }
    frames.push(gridToBraille(g));
  }
  return frames;
}

function genHelix() {
  const W = 8, H = 4, totalFrames = 16, frames = [];
  for (let f = 0; f < totalFrames; f++) {
    const g = makeGrid(H, W);
    for (let c = 0; c < W; c++) {
      const phase = (f + c) * (Math.PI / 4);
      const y1 = Math.round((Math.sin(phase) + 1) / 2 * (H - 1));
      const y2 = Math.round((Math.sin(phase + Math.PI) + 1) / 2 * (H - 1));
      g[y1][c] = true;
      g[y2][c] = true;
    }
    frames.push(gridToBraille(g));
  }
  return frames;
}

function genFillSweep() {
  const W = 4, H = 4, frames = [];
  for (let row = H - 1; row >= 0; row--) {
    const g = makeGrid(H, W);
    for (let r = row; r < H; r++) {
      for (let c = 0; c < W; c++) g[r][c] = true;
    }
    frames.push(gridToBraille(g));
  }
  const full = makeGrid(H, W);
  for (let r = 0; r < H; r++) for (let c = 0; c < W; c++) full[r][c] = true;
  frames.push(gridToBraille(full));
  frames.push(gridToBraille(full));
  for (let row = 0; row < H; row++) {
    const g = makeGrid(H, W);
    for (let r = row + 1; r < H; r++) {
      for (let c = 0; c < W; c++) g[r][c] = true;
    }
    frames.push(gridToBraille(g));
  }
  frames.push(gridToBraille(makeGrid(H, W)));
  return frames;
}

function genDiagonalSwipe() {
  const W = 4, H = 4, frames = [];
  const maxDiag = W + H - 2;
  for (let d = 0; d <= maxDiag; d++) {
    const g = makeGrid(H, W);
    for (let r = 0; r < H; r++) {
      for (let c = 0; c < W; c++) {
        if (r + c <= d) g[r][c] = true;
      }
    }
    frames.push(gridToBraille(g));
  }
  const full = makeGrid(H, W);
  for (let r = 0; r < H; r++) for (let c = 0; c < W; c++) full[r][c] = true;
  frames.push(gridToBraille(full));
  for (let d = 0; d <= maxDiag; d++) {
    const g = makeGrid(H, W);
    for (let r = 0; r < H; r++) {
      for (let c = 0; c < W; c++) {
        if (r + c > d) g[r][c] = true;
      }
    }
    frames.push(gridToBraille(g));
  }
  frames.push(gridToBraille(makeGrid(H, W)));
  return frames;
}

// --- Additional generators ---

function genPingPong() {
  const W = 8, H = 4, frames = [];
  for (let c = 0; c < W; c++) { const g = makeGrid(H, W); g[1][c] = true; g[2][c] = true; frames.push(gridToBraille(g)); }
  for (let c = W - 2; c > 0; c--) { const g = makeGrid(H, W); g[1][c] = true; g[2][c] = true; frames.push(gridToBraille(g)); }
  return frames;
}

function genSineWave() {
  const W = 12, H = 4, frames = [];
  for (let f = 0; f < 10; f++) {
    const g = makeGrid(H, W);
    for (let c = 0; c < W; c++) {
      const r = Math.round(1.5 + 1.5 * Math.sin((c * 0.5) - (f * 0.6)));
      if (r >= 0 && r < H) g[r][c] = true;
    }
    frames.push(gridToBraille(g));
  }
  return frames;
}

function genLoadingBar() {
  const W = 10, H = 4, frames = [];
  for (let f = 0; f <= W; f++) {
    const g = makeGrid(H, W);
    for (let c = 0; c < f; c++) { g[1][c] = true; g[2][c] = true; }
    frames.push(gridToBraille(g));
  }
  for (let i = 0; i < 3; i++) frames.push(frames[frames.length - 1]);
  return frames;
}

function genWindmill() {
  const W = 6, H = 4, frames = [];
  const cx = 2.5, cy = 1.5;
  for (let a = 0; a < Math.PI; a += Math.PI / 4) {
    const g = makeGrid(H, W);
    for (let d = -3; d <= 3; d += 0.5) {
      const px = Math.round(cx + Math.cos(a) * d);
      const py = Math.round(cy + Math.sin(a) * d);
      if (px >= 0 && px < W && py >= 0 && py < H) g[py][px] = true;
    }
    frames.push(gridToBraille(g));
  }
  return frames;
}

function genStatic() {
  const W = 8, H = 4, frames = [];
  // Use seeded-ish values for deterministic frames
  const seeds = [0.1, 0.4, 0.7, 0.2, 0.9, 0.3, 0.6, 0.8, 0.5, 0.15];
  for (let f = 0; f < 10; f++) {
    const g = makeGrid(H, W);
    let v = seeds[f];
    for (let r = 0; r < H; r++) {
      for (let c = 0; c < W; c++) {
        v = (v * 9301 + 49297) % 233280;
        g[r][c] = (v / 233280) > 0.6;
      }
    }
    frames.push(gridToBraille(g));
  }
  return frames;
}

function genZipper() {
  const W = 10, H = 4, frames = [];
  for (let f = 0; f < W + 2; f++) {
    const g = makeGrid(H, W);
    for (let c = 0; c < W; c++) {
      if (c <= f) { g[1][c] = true; g[2][c] = true; }
      else { if (c % 2 === 0) g[1][c] = true; else g[2][c] = true; }
    }
    frames.push(gridToBraille(g));
  }
  return frames;
}

function genHeartbeat() {
  const W = 12, H = 4, frames = [];
  const blip = [2, 1, 0, 3, 2, 2];
  for (let f = 0; f < W + blip.length; f++) {
    const g = makeGrid(H, W);
    for (let c = 0; c < W; c++) {
      const pos = f - c;
      let r = 2;
      if (pos >= 0 && pos < blip.length) r = blip[pos];
      g[r][c] = true;
    }
    frames.push(gridToBraille(g));
  }
  return frames;
}

function genCross() {
  const W = 6, H = 4, frames = [];
  const cx = 2.5, cy = 1.5;
  for (let radius = 0; radius < 4; radius++) {
    const g = makeGrid(H, W);
    for (let row = 0; row < H; row++) {
      for (let col = 0; col < W; col++) {
        if (Math.abs(row - cy) <= radius && Math.abs(col - cx) <= 0.5) g[row][col] = true;
        if (Math.abs(col - cx) <= radius && Math.abs(row - cy) <= 0.5) g[row][col] = true;
      }
    }
    frames.push(gridToBraille(g));
  }
  return frames.concat(frames.slice().reverse().slice(1));
}

function genClock() {
  const W = 6, H = 4, frames = [];
  const cx = 2.5, cy = 1.5;
  for (let angle = 0; angle < Math.PI * 2; angle += Math.PI / 6) {
    const g = makeGrid(H, W);
    g[1][2] = true; g[1][3] = true; g[2][2] = true; g[2][3] = true;
    for (let d = 0; d <= 2.5; d += 0.5) {
      const px = Math.round(cx + Math.cos(angle) * d);
      const py = Math.round(cy + Math.sin(angle) * d);
      if (px >= 0 && px < W && py >= 0 && py < H) g[py][px] = true;
    }
    frames.push(gridToBraille(g));
  }
  return frames;
}

function genArrows() {
  const W = 10, H = 4, frames = [];
  for (let f = 0; f < W; f++) {
    const g = makeGrid(H, W);
    for (let r = 0; r < H; r++) {
      for (let c = 0; c < W; c++) {
        if (c === (f + r) % W || c === (f + 3 - r) % W) g[r][c] = true;
      }
    }
    frames.push(gridToBraille(g));
  }
  return frames;
}

function genBlockBounce() {
  const W = 8, H = 4, frames = [];
  let r = 0, c = 0, dr = 1, dc = 1;
  for (let f = 0; f < 14; f++) {
    const g = makeGrid(H, W);
    g[r][c] = true; g[r + 1][c] = true; g[r][c + 1] = true; g[r + 1][c + 1] = true;
    frames.push(gridToBraille(g));
    if (r + dr < 0 || r + 1 + dr >= H) dr = -dr;
    if (c + dc < 0 || c + 1 + dc >= W) dc = -dc;
    r += dr; c += dc;
  }
  return frames;
}

function genEdgeCrawler() {
  const W = 8, H = 4, frames = [];
  const path = [];
  for (let c = 0; c < W; c++) path.push([0, c]);
  for (let r = 1; r < H; r++) path.push([r, W - 1]);
  for (let c = W - 2; c >= 0; c--) path.push([H - 1, c]);
  for (let r = H - 2; r > 0; r--) path.push([r, 0]);
  for (let i = 0; i < path.length; i++) {
    const g = makeGrid(H, W);
    for (let t = 0; t < 4; t++) {
      const pt = path[(i - t + path.length) % path.length];
      g[pt[0]][pt[1]] = true;
    }
    frames.push(gridToBraille(g));
  }
  return frames;
}

function genWiper() {
  const W = 10, H = 4, frames = [];
  for (let c = 0; c < W; c++) {
    const g = makeGrid(H, W);
    for (let r = 0; r < H; r++) g[r][c] = true;
    frames.push(gridToBraille(g));
  }
  for (let c = W - 2; c > 0; c--) {
    const g = makeGrid(H, W);
    for (let r = 0; r < H; r++) g[r][c] = true;
    frames.push(gridToBraille(g));
  }
  return frames;
}

function genRadar() {
  const W = 6, H = 4, frames = [];
  const cx = 2.5, cy = 1.5;
  for (let a = 0; a < Math.PI * 2; a += Math.PI / 6) {
    const g = makeGrid(H, W);
    for (let d = 0; d <= 3; d += 0.5) {
      const px = Math.round(cx + Math.cos(a) * d);
      const py = Math.round(cy + Math.sin(a) * (d * 0.7));
      if (px >= 0 && px < W && py >= 0 && py < H) g[py][px] = true;
    }
    frames.push(gridToBraille(g));
  }
  return frames;
}

function genSqueeze() {
  const W = 10, H = 4, frames = [];
  for (let w = 0; w <= W / 2; w++) {
    const g = makeGrid(H, W);
    for (let r = 0; r < H; r++) { g[r][w] = true; g[r][W - 1 - w] = true; }
    frames.push(gridToBraille(g));
  }
  return frames.concat(frames.slice().reverse().slice(1));
}

function genVortex() {
  const W = 8, H = 4, frames = [];
  const rings = [
    [[0,0],[0,1],[0,2],[0,3],[0,4],[0,5],[0,6],[0,7],[1,7],[2,7],[3,7],[3,6],[3,5],[3,4],[3,3],[3,2],[3,1],[3,0],[2,0],[1,0]],
    [[1,1],[1,2],[1,3],[1,4],[1,5],[1,6],[2,6],[2,5],[2,4],[2,3],[2,2],[2,1]]
  ];
  for (let f = 0; f < 20; f++) {
    const g = makeGrid(H, W);
    const p1 = rings[0][f % rings[0].length];
    const p2 = rings[1][(f * 2) % rings[1].length];
    g[p1[0]][p1[1]] = true;
    g[p2[0]][p2[1]] = true;
    frames.push(gridToBraille(g));
  }
  return frames;
}

function genBoxFill() {
  const W = 8, H = 4, frames = [];
  const path = [];
  for (let r = 0; r < H; r++) for (let c = 0; c < W; c++) path.push([r, c]);
  path.sort((a, b) => (Math.abs(a[0] - 1.5) + Math.abs(a[1] - 3.5)) - (Math.abs(b[0] - 1.5) + Math.abs(b[1] - 3.5)));
  const currentGrid = makeGrid(H, W);
  for (let i = 0; i < path.length; i += 2) {
    currentGrid[path[i][0]][path[i][1]] = true;
    if (i + 1 < path.length) currentGrid[path[i + 1][0]][path[i + 1][1]] = true;
    frames.push(gridToBraille(currentGrid));
  }
  for (let i = 0; i < 3; i++) frames.push(frames[frames.length - 1]);
  frames.push(gridToBraille(makeGrid(H, W)));
  return frames;
}

function genTypewriter() {
  const W = 8, H = 4, frames = [];
  const g = makeGrid(H, W);
  for (let c = 0; c < W; c++) {
    for (let r = 0; r < H; r++) {
      g[r][c] = true;
      if (r % 2 === 0) frames.push(gridToBraille(g));
    }
  }
  frames.push(gridToBraille(g));
  frames.push(gridToBraille(makeGrid(H, W)));
  return frames;
}

function genBarcode() {
  const W = 10, H = 4, frames = [];
  const pattern = [1, 0, 1, 1, 0, 0, 1, 0, 1, 1, 0, 1, 0, 0];
  for (let offset = 0; offset < pattern.length; offset++) {
    const g = makeGrid(H, W);
    for (let c = 0; c < W; c++) {
      if (pattern[(c + offset) % pattern.length]) {
        for (let r = 0; r < H; r++) g[r][c] = true;
      }
    }
    frames.push(gridToBraille(g));
  }
  return frames;
}

function genSnowfall() {
  const W = 12, H = 4, frames = [];
  const flakes = [[0,1],[1,4],[2,7],[3,10],[0,8],[2,0]];
  for (let f = 0; f < 12; f++) {
    const g = makeGrid(H, W);
    for (let i = 0; i < flakes.length; i++) {
      g[flakes[i][0]][flakes[i][1]] = true;
      if (f % 2 === 0) {
        flakes[i][0]++;
        if (flakes[i][0] >= H) {
          flakes[i][0] = 0;
          flakes[i][1] = (flakes[i][1] + 3) % W;
        }
      }
    }
    frames.push(gridToBraille(g));
  }
  return frames;
}

// --- Spinner registry ---

export const spinners = {
  // Classic
  braille:      { frames: ['\u280B', '\u2819', '\u2839', '\u2838', '\u283C', '\u2834', '\u2826', '\u2827', '\u2807', '\u280F'], interval: 80 },
  equalizer:    { frames: ['\u28C0', '\u28E4', '\u28F6', '\u28FF', '\u28F6', '\u28E4', '\u28C0'], interval: 100 },
  braillewave:  { frames: ['\u2801\u2802\u2804\u2840', '\u2802\u2804\u2840\u2880', '\u2804\u2840\u2880\u2820', '\u2840\u2880\u2820\u2810', '\u2880\u2820\u2810\u2808', '\u2820\u2810\u2808\u2801', '\u2810\u2808\u2801\u2802', '\u2808\u2801\u2802\u2804'], interval: 100 },
  dna:          { frames: ['\u280B\u2809\u2819\u281A', '\u2809\u2819\u281A\u2812', '\u2819\u281A\u2812\u2802', '\u281A\u2812\u2802\u2802', '\u2812\u2802\u2802\u2812', '\u2802\u2802\u2812\u2832', '\u2802\u2812\u2832\u2834', '\u2812\u2832\u2834\u2824', '\u2832\u2834\u2824\u2804', '\u2834\u2824\u2804\u280B', '\u2824\u2804\u280B\u2809', '\u2804\u280B\u2809\u2819'], interval: 80 },
  circle:       { frames: ['◐', '◓', '◑', '◒'], interval: 150 },
  // Grid generators (original)
  scan:         { frames: genScan(),           interval: 70 },
  rain:         { frames: genRain(),           interval: 100 },
  pulse:        { frames: genPulse(),          interval: 180 },
  snake:        { frames: genSnake(),          interval: 80 },
  sparkle:      { frames: genSparkle(),        interval: 150 },
  cascade:      { frames: genCascade(),        interval: 60 },
  columns:      { frames: genColumns(),        interval: 60 },
  orbit:        { frames: genOrbit(),          interval: 100 },
  breathe:      { frames: genBreathe(),        interval: 100 },
  waverows:     { frames: genWaveRows(),       interval: 90 },
  checkerboard: { frames: genCheckerboard(),   interval: 250 },
  helix:        { frames: genHelix(),          interval: 80 },
  fillsweep:    { frames: genFillSweep(),      interval: 100 },
  diagswipe:    { frames: genDiagonalSwipe(),  interval: 60 },
  // Grid generators (extended)
  pingpong:     { frames: genPingPong(),       interval: 80 },
  sinewave:     { frames: genSineWave(),       interval: 90 },
  loadingbar:   { frames: genLoadingBar(),     interval: 80 },
  windmill:     { frames: genWindmill(),       interval: 100 },
  static:       { frames: genStatic(),         interval: 100 },
  zipper:       { frames: genZipper(),         interval: 70 },
  heartbeat:    { frames: genHeartbeat(),      interval: 80 },
  cross:        { frames: genCross(),          interval: 120 },
  clock:        { frames: genClock(),          interval: 100 },
  arrows:       { frames: genArrows(),         interval: 80 },
  blockbounce:  { frames: genBlockBounce(),    interval: 100 },
  edgecrawler:  { frames: genEdgeCrawler(),    interval: 70 },
  wiper:        { frames: genWiper(),          interval: 60 },
  radar:        { frames: genRadar(),          interval: 100 },
  squeeze:      { frames: genSqueeze(),        interval: 80 },
  vortex:       { frames: genVortex(),         interval: 80 },
  boxfill:      { frames: genBoxFill(),        interval: 80 },
  typewriter:   { frames: genTypewriter(),     interval: 60 },
  barcode:      { frames: genBarcode(),        interval: 80 },
  snowfall:     { frames: genSnowfall(),       interval: 100 },
};

/** All available spinner names */
export const spinnerNames = Object.keys(spinners);

/** Pick a random spinner */
export function getRandomSpinner() {
  const name = spinnerNames[Math.floor(Math.random() * spinnerNames.length)];
  return spinners[name];
}

export default spinners;
