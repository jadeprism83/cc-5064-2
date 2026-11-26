/* app.js — 全部 UI 状态与渲染都由 CoverageCore 内核驱动。经典脚本，file:// 也可运行。 */
(function () {
  'use strict';
  const Core = window.CoverageCore;
  const An = window.CoverageAnalytic;
  const REF = window.ReferenceData;

  const W = 460, H = 280;
  const ASIDE_DX = 64, ASIDE_DY = -28;

  // ---------- 颜色 ----------
  const FIXED_COLORS = {
    1: [74, 144, 255],
    2: [255, 176, 32],
    3: [53, 208, 127],
    4: [181, 140, 255],
  };
  function hslRgb(h, s, l) {
    s /= 100; l /= 100;
    const k = (n) => (n + h / 30) % 12;
    const a = s * Math.min(l, 1 - l);
    const f = (n) => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
    return [Math.round(255 * f(0)), Math.round(255 * f(8)), Math.round(255 * f(4))];
  }
  function idColor(oid) {
    if (!oid) return [26, 31, 44];
    if (FIXED_COLORS[oid]) return FIXED_COLORS[oid];
    return hslRgb((oid * 53) % 360, 62, 62);
  }
  const css = (c, a = 1) => `rgba(${c[0]},${c[1]},${c[2]},${a})`;
  const HEAT = {
    0: [29, 34, 48],
    1: [53, 208, 127],
    2: [255, 176, 32],
    3: [255, 77, 94],
  };
  function heatColor(c) { return HEAT[Math.min(3, c)]; }

  // ---------- 主场景几何 ----------
  function baseScene() {
    const A = { x: 30, y: 39.5 }, B = { x: 230, y: 239.5 };
    return [
      {
        oid: 1, name: '蓝底 · 共边背景（顶左归属方）', color: FIXED_COLORS[1], alpha: 0.42, visible: true,
        triangles: [[A, B, { x: 300, y: 180 }]],
      },
      {
        oid: 2, name: '琥珀 · 共边前景（多数样本方）', color: FIXED_COLORS[2], alpha: 0.46, visible: true,
        triangles: [[A, B, { x: 60, y: 230 }]],
      },
      {
        oid: 3, name: '青绿拼接块', color: FIXED_COLORS[3], alpha: 0.4, visible: true,
        triangles: [
          [{ x: 300, y: 44 }, { x: 430, y: 58 }, { x: 418, y: 132 }],
          [{ x: 300, y: 44 }, { x: 418, y: 132 }, { x: 292, y: 116 }],
        ],
      },
      {
        oid: 4, name: '紫晶叠加片（故意重叠，检验绘制顺序）', color: FIXED_COLORS[4], alpha: 0.42, visible: true,
        triangles: [[{ x: 330, y: 158 }, { x: 446, y: 178 }, { x: 356, y: 262 }]],
      },
    ];
  }

  const DEFAULT_PATTERN_FOR_N = { 1: '1-center', 2: '2-diag', 4: '4-grid', 8: '8-rotted', 16: '16-grid' };

  const state = {
    patternId: '4-grid',
    rule: 'top-left',
    arith: 'auto',
    pickMode: 'subsample',
    selectedOid: 1,
    probe: { x: 80.75, y: 90.25 },
    objects: baseScene(),
    order: [1, 2, 3, 4],
    aside: {}, // oid -> 当前平移量
    windingFlipped: false,
    countExcludeSelected: false,
    anomalyOnly: false,
    drag: null,
    lab: {
      mode: 'preset',
      presetId: 'shared-edge',
      scenarioId: null,
      panX: 0, panY: 0,
      presets: buildPresets(),
      vertices: null,
      probe: { x: 6.75, y: 5.25 },
      view: null,
      drag: null,
    },
    testResults: null,
  };
  state.lab.vertices = clonePresetVertices('shared-edge');

  function clone(o) { return JSON.parse(JSON.stringify(o)); }
  function clonePresetVertices(id) {
    return clone(state.lab.presets[id].objects);
  }

  function buildPresets() {
    return {
      'shared-edge': {
        viewport: { x0: 0, y0: 0, width: 16, height: 12 },
        probe: { x: 6.75, y: 5.25 },
        focus: { x: 6, y: 5 },
        objects: [
          { oid: 1, name: '背景（归属方）', color: FIXED_COLORS[1], alpha: 0.5, triangles: [
            [{ x: 2, y: 0.5 }, { x: 13, y: 11.5 }, { x: 14.2, y: 9 }]] },
          { oid: 2, name: '前景（多数方）', color: FIXED_COLORS[2], alpha: 0.55, triangles: [
            [{ x: 2, y: 0.5 }, { x: 13, y: 11.5 }, { x: 2.5, y: 11 }]] },
        ],
      },
      'single-edge': {
        viewport: { x0: 0, y0: 0, width: 16, height: 12 },
        probe: { x: 7.5, y: 6.5 },
        focus: { x: 7, y: 6 },
        objects: [
          { oid: 2, name: '单斜边三角形', color: FIXED_COLORS[2], alpha: 0.65, triangles: [
            [{ x: -2, y: 10.5 }, { x: 17, y: 2.5 }, { x: 17, y: 13 }, { x: -2, y: 13 }].slice(0, 3)] },
        ],
      },
      thin: {
        viewport: { x0: 0, y0: 0, width: 16, height: 12 },
        probe: { x: 8.75, y: 5.01 },
        focus: { x: 8, y: 5 },
        objects: makeThinPreset(),
      },
    };
  }

  function makeThinPreset() {
    const objs = [];
    let oid = 1;
    const x0 = 1, x1 = 15, base = 5.0, h = 0.02;
    for (let k = 0; k < 3; k++) {
      const y0 = base + k * h, y1 = y0 + h;
      objs.push({ oid: oid++, name: '薄条 ' + k, color: idColor(oid), alpha: 0.7, triangles: [
        [{ x: x0, y: y0 }, { x: x1, y: y0 }, { x: x1, y: y1 }],
        [{ x: x0, y: y0 }, { x: x1, y: y1 }, { x: x0, y: y1 }],
      ] });
    }
    objs.push({ oid: oid++, name: '斜针', color: [255, 107, 107], alpha: 0.7, triangles: [
      [{ x: 1.5, y: 9 }, { x: 15, y: 6 }, { x: 1.5, y: 9.03 }]] });
    return objs;
  }

  // ---------- 对象变换 / 顺序 / 绕序 ----------
  function displayObjects(opts = {}) {
    const excludeSelected = opts.excludeSelected || false;
    let list = state.objects.filter((o) => o.visible !== false);
    if (excludeSelected && state.selectedOid) {
      list = list.filter((o) => o.oid !== state.selectedOid);
    }
    const byId = new Map(list.map((o) => [o.oid, o]));
    let ordered = state.order.map((id) => byId.get(id)).filter(Boolean);
    // 若有未在 order 中的新对象，补到末尾
    for (const o of list) if (!ordered.includes(o)) ordered.push(o);

    return ordered.map((o) => {
      const d = state.aside[o.oid];
      let tris = o.triangles;
      if (d) tris = tris.map((t) => t.map((p) => ({ x: p.x + d.x, y: p.y + d.y })));
      if (state.windingFlipped) tris = tris.map((t) => [t[2], t[1], t[0]]);
      return { ...o, triangles: tris };
    });
  }

  function patternRaw() {
    return Core.PATTERNS[state.patternId].samples;
  }

  // ---------- DOM 快捷 ----------
  const $ = (id) => document.getElementById(id);
  const els = {};
  ['sceneCanvas', 'overlayCanvas', 'idCanvas', 'inspectorCanvas', 'countCanvas',
    'labCanvas', 'aliasOne', 'aliasMany'].forEach((id) => { els[id] = $(id); });
  const sctx = els.sceneCanvas.getContext('2d');
  const octx = els.overlayCanvas.getContext('2d');
  const ictx = els.idCanvas.getContext('2d');
  const xctx = els.inspectorCanvas.getContext('2d');
  const cctx = els.countCanvas.getContext('2d');
  const lctx = els.labCanvas.getContext('2d');

  function eventPos(canvas, e) {
    const r = canvas.getBoundingClientRect();
    return {
      x: (e.clientX - r.left) * canvas.width / r.width,
      y: (e.clientY - r.top) * canvas.height / r.height,
    };
  }

  // ---------- 主渲染调度 ----------
  let queued = false;
  function schedule() {
    if (queued) return;
    queued = true;
    requestAnimationFrame(() => { queued = false; renderAll(); });
  }

  let lastSceneRaster = null;
  let lastCountRaster = null;

  function renderAll() {
    const objs = displayObjects();
    lastSceneRaster = Core.rasterScene(
      { objects: objs },
      { pattern: patternRaw(), viewport: { x0: 0, y0: 0, width: W, height: H }, rule: state.rule, arith: state.arith }
    );
    renderScenePixels(lastSceneRaster);
    drawOverlay(objs);
    renderIdBuffer(lastSceneRaster);
    renderInspector(objs);
    renderCount(objs);
    renderLab();
    safeRenderAliasing();
    updateSelectionInfo();
  }

  function renderScenePixels(r) {
    const img = sctx.createImageData(W, H);
    img.data.set(r.pixels);
    sctx.putImageData(img, 0, 0);
  }

  // ---------- 覆盖层：边 / 顶点 / 探针 ----------
  function objectCentroid(o) {
    let x = 0, y = 0, n = 0;
    for (const t of o.triangles) for (const p of t) { x += p.x; y += p.y; n++; }
    return { x: x / n, y: y / n };
  }

  function drawOverlay(objs) {
    octx.clearRect(0, 0, W, H);
    octx.lineJoin = 'round';
    for (const o of objs) {
      const col = idColor(o.oid);
      const selected = o.oid === state.selectedOid;
      octx.strokeStyle = css(col, selected ? 1 : 0.75);
      octx.lineWidth = selected ? 2 : 1.2;
      for (const t of o.triangles) {
        octx.beginPath();
        octx.moveTo(t[0].x, t[0].y);
        for (let i = 1; i < 3; i++) octx.lineTo(t[i].x, t[i].y);
        octx.closePath();
        octx.stroke();
      }
      if (selected) {
        for (const t of o.triangles) for (const p of t) drawHandle(p.x, p.y, col);
      }
      const c = objectCentroid(o);
      const label = '#' + o.oid;
      octx.font = 'bold 11px ui-monospace, monospace';
      octx.lineWidth = 3;
      octx.strokeStyle = 'rgba(8,10,16,.85)';
      octx.strokeText(label, c.x - 7, c.y + 4);
      octx.fillStyle = css(col, 1);
      octx.fillText(label, c.x - 7, c.y + 4);
    }
    // 探针
    if (state.probe) drawProbe(octx, state.probe.x, state.probe.y, '#ffffff');
  }

  function drawHandle(x, y, col) {
    octx.beginPath();
    octx.arc(x, y, 5.5, 0, Math.PI * 2);
    octx.fillStyle = '#0e1320';
    octx.fill();
    octx.lineWidth = 2.5;
    octx.strokeStyle = css(col, 1);
    octx.stroke();
    octx.beginPath();
    octx.arc(x, y, 2, 0, Math.PI * 2);
    octx.fillStyle = '#fff';
    octx.fill();
  }

  function drawProbe(ctx, x, y, color) {
    ctx.save();
    ctx.strokeStyle = color;
    ctx.lineWidth = 1;
    ctx.setLineDash([3, 3]);
    ctx.beginPath(); ctx.moveTo(x - 8, y); ctx.lineTo(x + 8, y); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(x, y - 8); ctx.lineTo(x, y + 8); ctx.stroke();
    ctx.setLineDash([]);
    ctx.beginPath();
    ctx.arc(x, y, 2.4, 0, Math.PI * 2);
    ctx.fillStyle = color;
    ctx.fill();
    ctx.restore();
  }

  // ---------- ID 缓冲（按样本多数解析为像素颜色；点击可吸附样本） ----------
  function renderIdBuffer(r) {
    const img = ictx.createImageData(W, H);
    const N = r.N;
    for (let p = 0; p < W * H; p++) {
      const tally = new Map();
      for (let k = 0; k < N; k++) {
        const oid = r.owner[p * N + k];
        if (oid) tally.set(oid, (tally.get(oid) || 0) + 1);
      }
      let winner = 0, best = 0;
      for (const [oid, n] of tally) if (n > best) { best = n; winner = oid; }
      const c = idColor(winner);
      img.data[p * 4] = c[0]; img.data[p * 4 + 1] = c[1]; img.data[p * 4 + 2] = c[2];
      img.data[p * 4 + 3] = winner ? 235 : 255;
    }
    ictx.putImageData(img, 0, 0);
  }

  // ---------- 覆盖计数图 ----------
  function renderCount(objs) {
    let r = lastSceneRaster;
    if (state.countExcludeSelected && state.selectedOid) {
      r = Core.rasterScene(
        { objects: displayObjects({ excludeSelected: true }) },
        { pattern: patternRaw(), viewport: { x0: 0, y0: 0, width: W, height: H }, rule: state.rule, arith: state.arith }
      );
    }
    lastCountRaster = r;
    const img = cctx.createImageData(W, H);
    const N = r.N;
    let multiSamples = 0, maxC = 0, multiPixels = 0;
    for (let p = 0; p < W * H; p++) {
      let rr = 0, gg = 0, bb = 0;
      let badPixel = false, cov = 0;
      for (let k = 0; k < N; k++) {
        const c = r.count[p * N + k];
        if (c > 0) cov++;
        if (c > 1) { multiSamples++; badPixel = true; }
        if (c > maxC) maxC = c;
        let hc;
        if (state.anomalyOnly) {
          if (c > 1) hc = heatColor(c);
          else if (c === 1) hc = [18, 74, 48];
          else hc = [12, 15, 24];
        } else {
          hc = heatColor(c);
        }
        rr += hc[0]; gg += hc[1]; bb += hc[2];
      }
      if (badPixel) multiPixels++;
      img.data[p * 4] = rr / N;
      img.data[p * 4 + 1] = gg / N;
      img.data[p * 4 + 2] = bb / N;
      img.data[p * 4 + 3] = 255;
    }
    cctx.putImageData(img, 0, 0);
    $('countStats').textContent =
      `样本总数 ${(W * H * N).toLocaleString()} · 重复命中样本 ${multiSamples} · 异常像素 ${multiPixels} · 最大计数 ${maxC}` +
      (state.countExcludeSelected ? ' · 已在计数中排除选中对象' : '');
  }

  // ---------- 取样检查器 ----------
  const INSP = { cols: 9, rows: 8, cell: 38 };
  function inspLayout() {
    const cw = INSP.cols * INSP.cell, ch = INSP.rows * INSP.cell;
    if (els.inspectorCanvas.width !== cw) {
      els.inspectorCanvas.width = cw;
      els.inspectorCanvas.height = ch;
    }
    return { ox: 0, oy: 0, x0: Math.floor(state.probe.x) - Math.floor(INSP.cols / 2) + 1,
             y0: Math.floor(state.probe.y) - Math.floor(INSP.rows / 2) + 1 };
  }

  function renderInspector(objs) {
    const L = inspLayout();
    const { cell, cols, rows } = INSP;
    xctx.clearRect(0, 0, els.inspectorCanvas.width, els.inspectorCanvas.height);
    // 像素底
    for (let j = 0; j < rows; j++) {
      for (let i = 0; i < cols; i++) {
        const px = L.x0 + i, py = L.y0 + j;
        xctx.fillStyle = (i + j) % 2 ? '#10151f' : '#0d121b';
        xctx.fillRect(i * cell, j * cell, cell, cell);
        xctx.strokeStyle = '#232c40';
        xctx.lineWidth = 1;
        xctx.strokeRect(i * cell + .5, j * cell + .5, cell - 1, cell - 1);
        xctx.fillStyle = '#46536e';
        xctx.font = '9px ui-monospace, monospace';
        xctx.fillText(`${px},${py}`, i * cell + 3, j * cell + 10);
      }
    }
    // 边
    xctx.save();
    xctx.beginPath();
    xctx.rect(0, 0, cols * cell, rows * cell);
    xctx.clip();
    for (const o of objs) {
      xctx.strokeStyle = css(idColor(o.oid), .9);
      xctx.lineWidth = 1.6;
      for (const t of o.triangles) {
        xctx.beginPath();
        t.forEach((p, idx) => {
          const X = (p.x - L.x0) * cell, Y = (p.y - L.y0) * cell;
          if (idx === 0) xctx.moveTo(X, Y); else xctx.lineTo(X, Y);
        });
        xctx.closePath();
        xctx.stroke();
      }
    }
    xctx.restore();

    // 样本点（用主光栅的 count/owner）
    const pat = patternRaw();
    const N = pat.length;
    const r = lastSceneRaster;
    for (let j = 0; j < rows; j++) {
      for (let i = 0; i < cols; i++) {
        const px = L.x0 + i, py = L.y0 + j;
        if (px < 0 || py < 0 || px >= W || py >= H) continue;
        for (let k = 0; k < N; k++) {
          const s = pat[k];
          const cx = (i + Number(s.x)) * cell;
          const cy = (j + Number(s.y)) * cell;
          const li = (py * W + px) * N + k;
          const oid = r.owner[li], c = r.count[li];
          xctx.beginPath();
          xctx.arc(cx, cy, Math.max(3.4, cell * .11), 0, Math.PI * 2);
          xctx.fillStyle = oid ? css(idColor(oid), .95) : '#39445c';
          xctx.fill();
          xctx.lineWidth = c > 1 ? 2.4 : 1;
          xctx.strokeStyle = c > 1 ? '#ff4d5e' : 'rgba(0,0,0,.55)';
          xctx.stroke();
        }
      }
    }
    // 探针
    const pr = state.probe;
    if (pr.x >= L.x0 && pr.x <= L.x0 + cols && pr.y >= L.y0 && pr.y <= L.y0 + rows) {
      drawProbe(xctx, (pr.x - L.x0) * cell, (pr.y - L.y0) * cell, '#fff');
    }

    updateInspectorReadout(objs);
  }

  function nearestSampleAt(canvas, pos, layout) {
    const pat = patternRaw();
    if (canvas === els.inspectorCanvas) {
      const { cell } = INSP;
      const L = layout;
      let best = null, bd = 13;
      const px0 = Math.floor(pos.x / cell) + L.x0;
      const py0 = Math.floor(pos.y / cell) + L.y0;
      for (const px of [px0 - 1, px0, px0 + 1]) {
        for (const py of [py0 - 1, py0, py0 + 1]) {
          for (let k = 0; k < pat.length; k++) {
            const sx = (px - L.x0 + Number(pat[k].x)) * cell;
            const sy = (py - L.y0 + Number(pat[k].y)) * cell;
            const d = Math.hypot(sx - pos.x, sy - pos.y);
            if (d < bd) { bd = d; best = { px, py, k }; }
          }
        }
      }
      return best ? { x: best.px + Number(pat[best.k].x), y: best.py + Number(pat[best.k].y), ...best } : null;
    }
    // W×H  backing store 的画布（id/count/scene）
    const px = Math.floor(pos.x), py = Math.floor(pos.y);
    let best = null, bd = 9;
    for (let k = 0; k < pat.length; k++) {
      const sx = px + Number(pat[k].x), sy = py + Number(pat[k].y);
      const d = Math.hypot(sx - pos.x, sy - pos.y);
      if (d < bd) { bd = d; best = { px, py, k, x: sx, y: sy }; }
    }
    return best;
  }

  function updateInspectorReadout(objs) {
    const pr = state.probe;
    $('probeCoords').textContent =
      `探针 P = (${fmt(pr.x)}, ${fmt(pr.y)})  像素 (${Math.floor(pr.x)}, ${Math.floor(pr.y)})  规则=${state.rule}`;

    const sub = Core.pickPoint(objs, pr.x, pr.y, { rule: state.rule });
    const px = Math.floor(pr.x), py = Math.floor(pr.y);
    const per = Core.objectCoverageInPixel(objs, px, py, patternRaw(), state.rule);
    const areaEntries = [];
    for (const o of objs) {
      const info = per.get(o.oid) || { samples: 0, which: [] };
      let area = 0;
      try { area = An.objectPixelArea(o, px, py); } catch (e) { area = 0; }
      areaEntries.push({ oid: o.oid, samples: info.samples, area, which: info.which });
    }
    const ranked = Core.rankAreaPicks(areaEntries.map((e) => ({ ...e })), state.order);
    const areaWinner = ranked.length ? ranked[0].oid : 0;

    const subO = sub.oid ? state.objects.find((o) => o.oid === sub.oid) : null;
    const areaO = areaWinner ? state.objects.find((o) => o.oid === areaWinner) : null;
    $('pickSubResult').className = 'pick-card' + (state.pickMode === 'subsample' ? ' active' : '');
    $('pickAreaResult').className = 'pick-card' + (state.pickMode === 'area' ? ' active' : '');
    $('pickSubResult').innerHTML =
      `<div class="t">按指针子样本（精确点查询）</div>
       <div class="v" style="color:${sub.oid ? css(idColor(sub.oid)) : '#8b97b0'}">` +
      (sub.oid ? `#${sub.oid} ${subO ? shortName(subO.name) : ''}` : '背景 / 无对象') +
      `</div><div class="t">hits=[${sub.hits.join(', ')}]（共边点也只出现归属方）</div>`;
    const top = ranked[0];
    $('pickAreaResult').innerHTML =
      `<div class="t">按覆盖面积（解析面积 / 样本多数）</div>
       <div class="v" style="color:${areaWinner ? css(idColor(areaWinner)) : '#8b97b0'}">` +
      (areaWinner ? `#${areaWinner} ${areaO ? shortName(areaO.name) : ''}` : '无覆盖') +
      `</div><div class="t">` +
      ranked.slice(0, 3).map((e) => `#${e.oid}: ${(e.area * 100).toFixed(1)}% / ${e.samples} 样本`).join('　') +
      `</div>`;

    // 当前模式决定选中对象
    const picked = state.pickMode === 'subsample' ? sub.oid : areaWinner;
    if (picked && picked !== state.selectedOid) {
      state.selectedOid = picked;
    }

    // 样本明细表
    const r = lastSceneRaster;
    const N = r.N;
    let nearestK = -1, nd = 1e9;
    for (let k = 0; k < N; k++) {
      const d = Math.hypot(px + Number(patternRaw()[k].x) - pr.x, py + Number(patternRaw()[k].y) - pr.y);
      if (d < nd) { nd = d; nearestK = k; }
    }
    let html = `<div class="sample-row" style="color:#93a0b8"><span>#</span><span>偏移</span><span>对象</span><span>count</span></div>`;
    for (let k = 0; k < N; k++) {
      const s = patternRaw()[k];
      const li = (py * W + px) * N + k;
      const valid = px >= 0 && py >= 0 && px < W && py < H;
      const oid = valid ? r.owner[li] : 0;
      const c = valid ? r.count[li] : 0;
      html += `<div class="sample-row${k === nearestK && nd < 0.02 ? ' probe' : ''}">
        <span>${k}</span>
        <span>(${s.x},${s.y})</span>
        <span><span class="dot" style="display:inline-block;background:${oid ? css(idColor(oid)) : '#39445c'}"></span>
          ${oid ? '#' + oid : '—'}</span>
        <span style="color:${c > 1 ? '#ff6b78' : c === 1 ? '#57e09a' : '#66728c'}">${c}</span>
      </div>`;
    }
    $('sampleList').innerHTML = html;
  }

  function shortName(n) { return n ? n.split('（')[0] : ''; }
  function fmt(v) { return (Math.round(Number(v) * 1000) / 1000).toString(); }

  function updateSelectionInfo() {
    const o = state.objects.find((x) => x.oid === state.selectedOid);
    if (!o) { $('selectionInfo').textContent = '未选中对象'; }
    else {
      const ax = state.aside[o.oid];
      $('selectionInfo').innerHTML =
        `<span style="color:${css(idColor(o.oid))}">●</span> #${o.oid} ${o.name}` +
        (o.visible === false ? '（已隐藏）' : '') + (ax ? `（已移开 ${ax.x},${ax.y}）` : '');
    }
    $('moveAsideBtn').textContent = state.aside[state.selectedOid] ? '把选中物体移回原位' : '把选中物体移开';
    $('hideSelectedBtn').textContent = o && o.visible === false ? '显示选中对象' : '隐藏选中对象';
    $('drawOrderInfo').textContent = '绘制顺序（后绘制者在 ID 竞争中获胜）: ' + state.order.join(' → ');
    renderLegend();
  }

  function renderLegend() {
    $('sceneLegend').innerHTML = state.objects.map((o) =>
      `<span><i class="sw" style="background:${css(idColor(o.oid))}"></i>#${o.oid} ${shortName(o.name)}</span>`).join('');
    $('idLegend').innerHTML = state.objects.map((o) =>
      `<span><i class="sw" style="background:${css(idColor(o.oid))}"></i>#${o.oid}</span>`).join('');
  }

  // ---------- 主场景指针交互 ----------
  function hitVertex(pos) {
    for (const o of state.objects) {
      if (o.visible === false) continue;
      const ax = state.aside[o.oid]?.x || 0;
      const ay = state.aside[o.oid]?.y || 0;
      for (let ti = 0; ti < o.triangles.length; ti++) {
        const t = o.triangles[ti];
        for (let vi = 0; vi < t.length; vi++) {
          const p = t[vi];
          if (Math.hypot(p.x + ax - pos.x, p.y + ay - pos.y) < 8) {
            return { oid: o.oid, ti, vi };
          }
        }
      }
    }
    return null;
  }

  els.overlayCanvas.addEventListener('pointerdown', (e) => {
    const pos = eventPos(els.overlayCanvas, e);
    els.overlayCanvas.setPointerCapture(e.pointerId);
    const vh = hitVertex(pos);
    if (vh) {
      state.drag = { type: 'vertex', ...vh };
      state.selectedOid = vh.oid;
      return;
    }
    const objs = displayObjects();
    const pick = Core.pickPoint(objs, pos.x, pos.y, { rule: state.rule });
    if (pick.oid) {
      state.selectedOid = pick.oid;
      state.drag = { type: 'object', oid: pick.oid, lastX: pos.x, lastY: pos.y, moved: false, startProbe: { ...state.probe } };
    } else {
      state.drag = { type: 'empty', moved: false };
    }
    schedule();
  });

  els.overlayCanvas.addEventListener('pointermove', (e) => {
    const pos = eventPos(els.overlayCanvas, e);
    const d = state.drag;
    if (!d) {
      els.overlayCanvas.style.cursor = hitVertex(pos) ? 'grab' : 'crosshair';
      return;
    }
    if (d.type === 'vertex') {
      const o = state.objects.find((x) => x.oid === d.oid);
      const p = o.triangles[d.ti][d.vi];
      const ax = state.aside[d.oid];
      p.x = Math.round((pos.x - (ax?.x || 0)) * 1000) / 1000;
      p.y = Math.round((pos.y - (ax?.y || 0)) * 1000) / 1000;
      schedule();
    } else if (d.type === 'object') {
      const dx = pos.x - d.lastX, dy = pos.y - d.lastY;
      if (Math.abs(dx) + Math.abs(dy) > 0.4) d.moved = true;
      if (d.moved) {
        const o = state.objects.find((x) => x.oid === d.oid);
        for (const t of o.triangles) for (const p of t) { p.x += dx; p.y += dy; }
        d.lastX = pos.x; d.lastY = pos.y;
        schedule();
      }
    }
  });

  function endScenePointer(e) {
    const d = state.drag;
    if (!d) return;
    if ((d.type === 'object' || d.type === 'empty') && !d.moved) {
      const pos = eventPos(els.overlayCanvas, e);
      state.probe = { x: Math.round(pos.x * 1000) / 1000, y: Math.round(pos.y * 1000) / 1000 };
      const objs = displayObjects();
      const sub = Core.pickPoint(objs, state.probe.x, state.probe.y, { rule: state.rule });
      if (state.pickMode === 'subsample' && sub.oid) state.selectedOid = sub.oid;
      schedule();
    }
    state.drag = null;
  }
  els.overlayCanvas.addEventListener('pointerup', endScenePointer);
  els.overlayCanvas.addEventListener('pointercancel', () => { state.drag = null; });

  // ID / 计数画布点击：吸附样本并放置探针
  function backingCanvasClick(canvas, e) {
    const pos = eventPos(canvas, e);
    const snap = nearestSampleAt(canvas, pos, null);
    if (snap) state.probe = { x: snap.x, y: snap.y };
    else state.probe = { x: Math.round(pos.x * 100) / 100, y: Math.round(pos.y * 100) / 100 };
    const objs = displayObjects();
    const sub = Core.pickPoint(objs, state.probe.x, state.probe.y, { rule: state.rule });
    if (state.pickMode === 'subsample' && sub.oid) state.selectedOid = sub.oid;
    schedule();
  }
  els.idCanvas.addEventListener('click', (e) => backingCanvasClick(els.idCanvas, e));
  els.countCanvas.addEventListener('click', (e) => backingCanvasClick(els.countCanvas, e));

  els.inspectorCanvas.addEventListener('click', (e) => {
    const pos = eventPos(els.inspectorCanvas, e);
    const L = inspLayout();
    const snap = nearestSampleAt(els.inspectorCanvas, pos, L);
    if (snap) {
      state.probe = { x: snap.x, y: snap.y };
    } else {
      state.probe = {
        x: Math.round((pos.x / INSP.cell + L.x0) * 1000) / 1000,
        y: Math.round((pos.y / INSP.cell + L.y0) * 1000) / 1000,
      };
    }
    schedule();
  });

  // ---------- 控件 ----------
  function initControls() {
    const seg = $('sampleCountButtons');
    for (const n of [1, 2, 4, 8, 16]) {
      const b = document.createElement('button');
      b.textContent = n + '×';
      b.dataset.n = n;
      b.addEventListener('click', () => {
        state.patternId = DEFAULT_PATTERN_FOR_N[n];
        $('patternSelect').value = state.patternId;
        syncSeg();
        schedule();
      });
      seg.appendChild(b);
    }
    const sel = $('patternSelect');
    for (const [id, p] of Object.entries(Core.PATTERNS)) {
      const o = document.createElement('option');
      o.value = id;
      o.textContent = `${p.label}（${p.samples.length} 样本）`;
      sel.appendChild(o);
    }
    sel.value = state.patternId;
    sel.addEventListener('change', () => { state.patternId = sel.value; syncSeg(); schedule(); });
    syncSeg();

    $('ruleSelect').addEventListener('change', (e) => { state.rule = e.target.value; schedule(); });
    $('arithSelect').addEventListener('change', (e) => { state.arith = e.target.value; schedule(); });

    document.querySelectorAll('#pickModeSeg button').forEach((b) => {
      b.addEventListener('click', () => {
        state.pickMode = b.dataset.mode;
        document.querySelectorAll('#pickModeSeg button').forEach((x) => x.classList.toggle('active', x === b));
        // 切换模式立即按该模式决定选中
        const objs = displayObjects();
        if (state.pickMode === 'area') {
          const px = Math.floor(state.probe.x), py = Math.floor(state.probe.y);
          const per = Core.objectCoverageInPixel(objs, px, py, patternRaw(), state.rule);
          const entries = objs.map((o) => ({
            oid: o.oid,
            samples: (per.get(o.oid) || { samples: 0 }).samples,
            area: An.objectPixelArea(o, px, py),
          }));
          const ranked = Core.rankAreaPicks(entries, state.order);
          if (ranked.length) state.selectedOid = ranked[0].oid;
        } else {
          const sub = Core.pickPoint(objs, state.probe.x, state.probe.y, { rule: state.rule });
          if (sub.oid) state.selectedOid = sub.oid;
        }
        schedule();
      });
    });

    $('flipWindingBtn').addEventListener('click', (e) => {
      state.windingFlipped = !state.windingFlipped;
      e.currentTarget.classList.toggle('active', state.windingFlipped);
      schedule();
    });
    $('orderReverseBtn').addEventListener('click', () => { state.order.reverse(); schedule(); });
    $('orderShuffleBtn').addEventListener('click', () => {
      for (let i = state.order.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [state.order[i], state.order[j]] = [state.order[j], state.order[i]];
      }
      schedule();
    });
    $('orderResetBtn').addEventListener('click', () => { state.order = [1, 2, 3, 4]; schedule(); });

    $('moveAsideBtn').addEventListener('click', () => {
      const id = state.selectedOid;
      if (!id) return;
      if (state.aside[id]) delete state.aside[id];
      else state.aside[id] = { x: ASIDE_DX, y: ASIDE_DY };
      schedule();
    });
    $('hideSelectedBtn').addEventListener('click', () => {
      const o = state.objects.find((x) => x.oid === state.selectedOid);
      if (o) o.visible = o.visible === false;
      schedule();
    });
    $('resetSceneBtn').addEventListener('click', () => {
      state.objects = baseScene();
      state.aside = {};
      state.order = [1, 2, 3, 4];
      state.windingFlipped = false;
      $('flipWindingBtn').classList.remove('active');
      state.probe = { x: 80.75, y: 90.25 };
      schedule();
    });
    $('countExcludeSelected').addEventListener('change', (e) => {
      state.countExcludeSelected = e.target.checked; schedule();
    });
    $('anomalyOnly').addEventListener('change', (e) => {
      state.anomalyOnly = e.target.checked; schedule();
    });
    $('locateEdgeProbeBtn').addEventListener('click', () => {
      state.patternId = '4-grid';
      $('patternSelect').value = '4-grid';
      syncSeg();
      state.probe = { x: 80.75, y: 90.25 };
      state.selectedOid = Core.pickPoint(displayObjects(), state.probe.x, state.probe.y, { rule: state.rule }).oid || 1;
      schedule();
    });

    initLabControls();
  }

  function syncSeg() {
    const n = Core.PATTERNS[state.patternId].samples.length;
    document.querySelectorAll('#sampleCountButtons button').forEach((b) => {
      b.classList.toggle('active', Number(b.dataset.n) === n);
    });
  }

  // ---------- 实验室 ----------
  function initLabControls() {
    $('labPresetSelect').addEventListener('change', (e) => {
      const v = e.target.value;
      if (v.startsWith('scenario:')) {
        state.lab.mode = 'scenario';
        state.lab.scenarioId = v.slice('scenario:'.length);
      } else {
        state.lab.mode = 'preset';
        state.lab.presetId = v;
        state.lab.vertices = clonePresetVertices(v);
        state.lab.probe = { ...state.lab.presets[v].probe };
        state.lab.panX = 0; state.lab.panY = 0;
        $('panX').value = 0; $('panY').value = 0;
        $('panXVal').textContent = '0.00'; $('panYVal').textContent = '0.00';
      }
      renderLab();
    });
    $('panX').addEventListener('input', (e) => {
      state.lab.panX = Number(e.target.value);
      $('panXVal').textContent = state.lab.panX.toFixed(2);
      renderLab(); safeRenderAliasing();
    });
    $('panY').addEventListener('input', (e) => {
      state.lab.panY = Number(e.target.value);
      $('panYVal').textContent = state.lab.panY.toFixed(2);
      renderLab(); safeRenderAliasing();
    });
    $('panZeroBtn').addEventListener('click', () => {
      state.lab.panX = 0; state.lab.panY = 0;
      $('panX').value = 0; $('panY').value = 0;
      $('panXVal').textContent = '0.00'; $('panYVal').textContent = '0.00';
      renderLab(); safeRenderAliasing();
    });

    els.labCanvas.addEventListener('pointerdown', (e) => {
      const w = labEventWorld(e);
      if (!w) return;
      if (state.lab.mode === 'preset') {
        const vh = labHitVertex(w);
        if (vh) { state.lab.drag = vh; els.labCanvas.setPointerCapture(e.pointerId); return; }
      }
      state.lab.probe = { x: Math.round(w.x * 1000) / 1000, y: Math.round(w.y * 1000) / 1000 };
      renderLab();
    });
    els.labCanvas.addEventListener('pointermove', (e) => {
      const w = labEventWorld(e);
      if (!w || !state.lab.drag) return;
      const d = state.lab.drag;
      const o = state.lab.vertices.find((x) => x.oid === d.oid);
      // 存储的是未加 pan 的基坐标
      o.triangles[d.ti][d.vi] = {
        x: Math.round((w.x - state.lab.panX) * 1000) / 1000,
        y: Math.round((w.y - state.lab.panY) * 1000) / 1000,
      };
      renderLab();
    });
    const endDrag = () => { state.lab.drag = null; };
    els.labCanvas.addEventListener('pointerup', endDrag);
    els.labCanvas.addEventListener('pointercancel', endDrag);
  }

  function labEventWorld(e) {
    const pos = eventPos(els.labCanvas, e);
    const view = state.lab.view;
    if (!view) return null;
    return { x: (pos.x - view.ox) / view.cell + view.vp.x0, y: (pos.y - view.oy) / view.cell + view.vp.y0 };
  }

  function labHitVertex(w) {
    const objs = state.lab.vertices;
    for (const o of objs) {
      for (let ti = 0; ti < o.triangles.length; ti++) {
        const t = o.triangles[ti];
        for (let vi = 0; vi < t.length; vi++) {
          const p = t[vi];
          if (Math.hypot(p.x + state.lab.panX - w.x, p.y + state.lab.panY - w.y) < 0.28) {
            return { oid: o.oid, ti, vi };
          }
        }
      }
    }
    return null;
  }

  function labObjectsDisplay() {
    if (state.lab.mode === 'scenario') {
      const sc = REF.scenarios.find((s) => s.id === state.lab.scenarioId);
      return { objects: sc.objects, vp: sc.viewport, scenario: sc };
    }
    const objs = state.lab.vertices.map((o) => ({
      ...o,
      triangles: o.triangles.map((t) => t.map((p) => ({ x: p.x + state.lab.panX, y: p.y + state.lab.panY }))),
    }));
    return { objects: objs, vp: state.lab.presets[state.lab.presetId].viewport, scenario: null };
  }

  function reportMsaaError(err) {
    const banner = $('labBanner');
    if (banner) {
      banner.className = 'lab-banner fail';
      banner.textContent = '多采样覆盖界面捕获到执行异常：' + (err && err.message ? err.message : String(err));
    }
    const out = $('labReadout');
    if (out) out.textContent = (err && err.stack) ? err.stack : String(err);
    const evidence = $('msaaEvidence');
    if (evidence) evidence.textContent = 'MSAA evidence unavailable: ' + (err && err.message ? err.message : String(err));
    if (window) window.__msaaCoverageError = err;
  }

  function renderLab() {
    try {
      renderLabContent();
    } catch (err) {
      reportMsaaError(err);
    }
  }

  function safeRenderAliasing() {
    try {
      renderAliasing();
    } catch (err) {
      reportMsaaError(err);
    }
  }

  function renderLabContent() {
    const canvas = els.labCanvas, ctx = lctx;
    const info = labObjectsDisplay();
    const vp = info.vp;
    const pad = 26;
    const cell = state.lab.mode === 'scenario'
      ? Math.min((canvas.width - pad * 2) / vp.width, (canvas.height - pad * 2) / vp.height)
      : 32;
    const ox = (canvas.width - vp.width * cell) / 2 - vp.x0 * cell;
    const oy = (canvas.height - vp.height * cell) / 2 - vp.y0 * cell;
    state.lab.view = { vp, cell, ox, oy };
    const X = (x) => ox + (x - vp.x0) * cell;
    const Y = (y) => oy + (y - vp.y0) * cell;

    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = '#0b0e15';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    const rawPat = patternRaw();
    const rasterOptions = {
      pattern: rawPat,
      viewport: vp,
      rule: state.rule,
      arith: state.arith,
      evidencePoints: [state.lab.probe],
    };
    const lr = typeof Core.rasterMultisampleCoverage === 'function'
      ? Core.rasterMultisampleCoverage({ objects: info.objects }, { ...rasterOptions, canonical: true })
      : Core.rasterScene({ objects: info.objects }, rasterOptions);
    const pat = lr.samplePositions || rawPat;

    // 解析后的像素底图（离屏放大）
    const off = document.createElement('canvas');
    off.width = vp.width; off.height = vp.height;
    const octx2 = off.getContext('2d');
    const img = octx2.createImageData(vp.width, vp.height);
    img.data.set(lr.pixels);
    octx2.putImageData(img, 0, 0);
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(off, X(vp.x0), Y(vp.y0), vp.width * cell, vp.height * cell);

    // 像素网格
    ctx.strokeStyle = 'rgba(120,140,180,.22)';
    ctx.lineWidth = 1;
    for (let i = 0; i <= vp.width; i++) {
      ctx.beginPath(); ctx.moveTo(X(vp.x0 + i), Y(vp.y0)); ctx.lineTo(X(vp.x0 + i), Y(vp.y0 + vp.height)); ctx.stroke();
    }
    for (let j = 0; j <= vp.height; j++) {
      ctx.beginPath(); ctx.moveTo(X(vp.x0), Y(vp.y0 + j)); ctx.lineTo(X(vp.x0 + vp.width), Y(vp.y0 + j)); ctx.stroke();
    }

    // 边
    for (const o of info.objects) {
      ctx.strokeStyle = css(idColor(o.oid), 0.95);
      ctx.lineWidth = 2;
      for (const t of o.triangles) {
        ctx.beginPath();
        t.forEach((p, i) => { if (i === 0) ctx.moveTo(X(p.x), Y(p.y)); else ctx.lineTo(X(p.x), Y(p.y)); });
        ctx.closePath(); ctx.stroke();
      }
    }

    // 样本点
    const N = lr.N;
    const r2 = Math.max(3, cell * 0.11);
    for (let ly = 0; ly < vp.height; ly++) {
      for (let lx = 0; lx < vp.width; lx++) {
        for (let k = 0; k < N; k++) {
          const li = (ly * vp.width + lx) * N + k;
          const c = lr.count[li], oid = lr.owner[li];
          const wx = vp.x0 + lx + Number(pat[k].x);
          const wy = vp.y0 + ly + Number(pat[k].y);
          ctx.beginPath();
          ctx.arc(X(wx), Y(wy), r2, 0, Math.PI * 2);
          ctx.fillStyle = oid ? css(idColor(oid), .98) : 'rgba(70,82,110,.9)';
          ctx.fill();
          if (c > 1) { ctx.lineWidth = 2.6; ctx.strokeStyle = '#ff4d5e'; ctx.stroke(); }
          else { ctx.lineWidth = 1; ctx.strokeStyle = 'rgba(0,0,0,.6)'; ctx.stroke(); }
        }
      }
    }

    // 可编辑顶点
    if (state.lab.mode === 'preset') {
      for (const o of state.lab.vertices) {
        for (const t of o.triangles) for (const p of t) {
          drawLabHandle(X(p.x + state.lab.panX), Y(p.y + state.lab.panY), css(idColor(o.oid)));
        }
      }
    }

    // 探针
    drawProbe(ctx, X(state.lab.probe.x), Y(state.lab.probe.y), '#fff');

    updateLabReadout(lr, info, pat);
  }

  function drawLabHandle(x, y, col) {
    lctx.beginPath(); lctx.arc(x, y, 6, 0, Math.PI * 2);
    lctx.fillStyle = '#0e1320'; lctx.fill();
    lctx.lineWidth = 2.5; lctx.strokeStyle = col; lctx.stroke();
  }

  function updateLabReadout(lr, info, pat) {
    const multi = Core.findMultipleHits(lr);
    const pr = state.lab.probe;
    const px = Math.floor(pr.x), py = Math.floor(pr.y);
    let txt = `模式: ${state.lab.mode === 'scenario' ? '参考用例 ' + state.lab.scenarioId : '可编辑预设 ' + state.lab.presetId}\n`;
    txt += `样本: ${lr.N} (${state.patternId})  规则: ${state.rule}  算术: ${state.arith}\n`;
    txt += `探针: (${fmt(pr.x)}, ${fmt(pr.y)})  像素 (${px},${py})\n`;
    txt += `视口: x[${info.vp.x0}..${info.vp.x0 + info.vp.width}] y[${info.vp.y0}..${info.vp.y0 + info.vp.height}]\n\n`;

    if (px >= info.vp.x0 && px < info.vp.x0 + info.vp.width && py >= info.vp.y0 && py < info.vp.y0 + info.vp.height) {
      for (const o of info.objects) {
        let samples = 0, area = 0;
        for (let k = 0; k < pat.length; k++) {
          const x = px + Number(pat[k].x), y = py + Number(pat[k].y);
          if (o.triangles.some((t) => Core.pointInside(t, x, y, state.rule))) samples++;
        }
        try { area = An.objectPixelArea(o, px, py); } catch (e) { area = NaN; }
        txt += `#${o.oid} ${shortName(o.name || '')}: 样本 ${samples}/${pat.length}  解析面积 ${area.toFixed(4)}\n`;
      }

      if (Core.coverageEvidenceAt) {
        const ev = Core.coverageEvidenceAt(lr, px - info.vp.x0, py - info.vp.y0);
        if (ev) {
          const edgePick = Core.pickStoredSample ? Core.pickStoredSample(lr, pr.x, pr.y) : ev.pick;
          txt += `\n逐样本布局: v${lr.sampleLayoutVersion || Core.SAMPLE_LAYOUT_VERSION} ${lr.sampleOrder || 'provided'}`;
          txt += `\n样本掩码: ${ev.maskBinary} (${ev.maskHex})  覆盖 ${ev.coveredSamples}/${lr.N}`;
          txt += `\n解析颜色: rgba(${ev.resolvedRGBA.join(',')})`;
          txt += `\n拾取缓冲: #${edgePick.oid} @sample ${edgePick.k}（几何位置编号）`;
          state.lab.lastEvidence = { ...ev, pickAtPoint: edgePick };
          const evidenceEl = $('msaaEvidence');
          if (evidenceEl) {
            evidenceEl.textContent =
              `mask=${ev.maskBinary} hex=${ev.maskHex} resolve=rgba(${ev.resolvedRGBA.join(',')}) ` +
              `pick=#${edgePick.oid}:${edgePick.k} layout=v${lr.sampleLayoutVersion}:${lr.sampleOrder}`;
          }
          if (window) window.__msaaCoverageEvidence = state.lab.lastEvidence;
        }
      }
    }
    txt += `\n重复命中样本: ${multi.length}`;
    if (multi.length) txt += `  首例 @(${multi[0].x},${multi[0].y}) k=${multi[0].k} count=${multi[0].count}`;

    // 与参考逐样本比较（scenario 模式且参考含该图案）
    const banner = $('labBanner');
    let refMismatch = null;
    if (info.scenario && info.scenario.rasters[state.patternId] && state.rule === 'top-left') {
      const ref = info.scenario.rasters[state.patternId];
      let oldToNew = null;
      try {
        oldToNew = Core.sampleLayoutMapping(REF.patterns[state.patternId], lr.samplePositions || pat).oldToNew;
      } catch (e) { oldToNew = null; }
      const pixels = ref.counts.length / ref.N;
      let bad = 0, first = null;
      for (let p = 0; p < pixels; p++) {
        for (let oldK = 0; oldK < ref.N; oldK++) {
          const newK = oldToNew ? oldToNew[oldK] : oldK;
          const refIndex = p * ref.N + oldK;
          const gotIndex = p * lr.N + newK;
          if (lr.count[gotIndex] !== ref.counts[refIndex] || lr.owner[gotIndex] !== ref.owners[refIndex]) {
            bad++;
            if (!first) first = gotIndex;
          }
        }
      }
      refMismatch = bad;
      if (bad === 0 && multi.length === 0) {
        banner.className = 'lab-banner ok';
        banner.textContent = `通过：当前视窗 ${state.patternId} 下计数/编号与 Python Fraction 参考逐样本一致，且无共边双计。`;
      } else {
        banner.className = 'lab-banner fail';
        banner.textContent = `失败：${bad} 个样本与参考不一致${multi.length ? `；${multi.length} 个重复命中` : ''}（索引 ${first}）。这正是要反馈回调试视窗的覆盖失败。`;
      }
    } else if (state.rule !== 'top-left') {
      if (multi.length > 0) {
        banner.className = 'lab-banner fail';
        banner.textContent = `规则 ${state.rule} 触发失败：检测到 ${multi.length} 个共边样本被重复计数（红圈）。切回“顶/左归属”即可消除。`;
      } else if (state.rule === 'strict') {
        banner.className = 'lab-banner info';
        banner.textContent = 'strict 规则不会双计，但恰好落在共边上的样本会被两侧同时拒绝（漏边）；用 ④ 计数图或参考比对可发现覆盖缺失。';
      }
    } else {
      banner.className = multi.length ? 'lab-banner fail' : 'lab-banner ok';
      banner.textContent = multi.length
        ? `失败：新逐样本布局路径检测到 ${multi.length} 个重复命中样本。`
        : `通过：光栅调试视窗已调用 MSAA 新实现（布局 v${lr.sampleLayoutVersion || 2}），样本掩码/解析颜色与拾取证据已列出，共边样本恰好归属一次。`;
    }
    $('labReadout').textContent = txt;
    return { multi: multi.length, refMismatch };
  }

  // ---------- 锯齿条 ----------
  function stripObjects() {
    const dx = state.lab.panX, dy = state.lab.panY;
    return [{
      oid: 2, color: [255, 255, 255], alpha: 1,
      triangles: [
        [{ x: -12 + dx, y: 30 + dy }, { x: 108 + dx, y: 8 + dy }, { x: 108 + dx, y: 26 + dy }],
        [{ x: -12 + dx, y: 30 + dy }, { x: 108 + dx, y: 26 + dy }, { x: -12 + dx, y: 26 + dy }],
      ],
    }];
  }
  function renderAliasing() {
    const W2 = 96, H2 = 24;
    for (const [canvas, pattern] of [[els.aliasOne, '1-center'], [els.aliasMany, state.patternId]]) {
      if (canvas.width !== W2) { canvas.width = W2; canvas.height = H2; }
      const rasterMsaa = Core.rasterMultisampleCoverage || Core.rasterScene;
      const r = rasterMsaa(
        { objects: stripObjects(), background: [255, 255, 255] },
        { pattern, viewport: { x0: 0, y0: 0, width: W2, height: H2 }, rule: state.rule, arith: state.arith, canonical: false }
      );
      // 白色背景到深蓝前景，按覆盖率线性混合，直观看锯齿与 MSAA 平滑
      const ctx = canvas.getContext('2d');
      const img = ctx.createImageData(W2, H2);
      for (let p = 0; p < W2 * H2; p++) {
        const cov = r.coverage[p];
        img.data[p * 4] = Math.round(255 * (1 - cov) + 18 * cov);
        img.data[p * 4 + 1] = Math.round(255 * (1 - cov) + 60 * cov);
        img.data[p * 4 + 2] = Math.round(255 * (1 - cov) + 150 * cov);
        img.data[p * 4 + 3] = 255;
      }
      ctx.putImageData(img, 0, 0);
    }
    $('aliasManyLabel').textContent = `${Core.PATTERNS[state.patternId].samples.length}× MSAA 解析（${state.patternId}）`;
  }

  // ---------- 验证面板 ----------
  const cardCanvases = {};
  function buildScenarioCards() {
    const grid = $('scenarioGrid');
    grid.innerHTML = '';
    for (const sc of REF.scenarios) {
      const card = document.createElement('div');
      card.className = 'sc-card';
      card.id = 'card-' + sc.id;
      const vw = sc.viewport.width, vh = sc.viewport.height;
      const cell = Math.max(9, Math.min(20, Math.floor(220 / vw)));
      card.innerHTML = `
        <div class="title">${sc.title}</div>
        <canvas width="${vw * cell}" height="${vh * cell}"></canvas>
        <div class="meta" id="meta-${sc.id}">视口 ${vw}×${vh} · 面积条目 ${sc.areas.length} · 待运行</div>
        <div class="row">
          <button data-act="load">载入调试视窗</button>
        </div>`;
      grid.appendChild(card);
      card.querySelector('[data-act=load]').addEventListener('click', () => loadScenarioInLab(sc.id));
      cardCanvases[sc.id] = { canvas: card.querySelector('canvas'), cell };
      drawCardMap(sc);
    }
  }

  function drawCardMap(sc, result) {
    const { canvas, cell } = cardCanvases[sc.id];
    const ctx = canvas.getContext('2d');
    const r = Core.rasterScene(
      { objects: sc.objects },
      { pattern: '8-grid', viewport: sc.viewport, rule: 'top-left' }
    );
    for (let ly = 0; ly < sc.viewport.height; ly++) {
      for (let lx = 0; lx < sc.viewport.width; lx++) {
        let rr = 0, gg = 0, bb = 0;
        for (let k = 0; k < r.N; k++) {
          const c = r.count[(ly * sc.viewport.width + lx) * r.N + k];
          const hc = HEAT[Math.min(3, c)];
          rr += hc[0]; gg += hc[1]; bb += hc[2];
        }
        ctx.fillStyle = `rgb(${rr / r.N | 0},${gg / r.N | 0},${bb / r.N | 0})`;
        ctx.fillRect(lx * cell, ly * cell, cell, cell);
      }
    }
    if (result) {
      const meta = $('meta-' + sc.id);
      if (result.ok) {
        meta.textContent = `全部通过：${result.rasterChecks} 组图案逐样本 + ${result.probeChecks} 探针 + ${result.areaChecks} 面积`;
        meta.style.color = '#57e09a';
      } else {
        meta.textContent = `失败：${result.rasterFails} 光栅 / ${result.probeFails} 探针 / ${result.areaFails} 面积`;
        meta.style.color = '#ff8b96';
      }
    }
  }

  function loadScenarioInLab(id) {
    $('labPresetSelect').value = 'scenario:' + id;
    state.lab.mode = 'scenario';
    state.lab.scenarioId = id;
    state.lab.panX = 0; state.lab.panY = 0;
    $('panX').value = 0; $('panY').value = 0;
    $('panXVal').textContent = '0.00'; $('panYVal').textContent = '0.00';
    const sc = REF.scenarios.find((s) => s.id === id);
    if (sc.focusPixel) state.lab.probe = { ...sc.focusPixel.probe };
    else state.lab.probe = { x: sc.viewport.x0 + sc.viewport.width / 2, y: sc.viewport.y0 + sc.viewport.height / 2 };
    renderLab();
    document.querySelector('.lab-panel').scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  function runAllTests() {
    const btn = $('runTestsBtn');
    btn.disabled = true;
    $('testSummary').className = 'badge run';
    $('testSummary').textContent = '比对中…';
    setTimeout(() => {
      let totalOk = 0, total = 0;
      let firstFailure = null;
      for (const sc of REF.scenarios) {
        let rasterFails = 0, rasterChecks = 0, probeFails = 0, probeChecks = 0, areaFails = 0, areaChecks = 0;
        for (const [pid, ref] of Object.entries(sc.rasters)) {
          rasterChecks++;
          const r = Core.rasterScene({ objects: sc.objects }, { pattern: REF.patterns[pid], viewport: sc.viewport, rule: 'top-left' });
          for (let i = 0; i < ref.counts.length; i++) {
            total++;
            if (r.count[i] !== ref.counts[i] || r.owner[i] !== ref.owners[i]) {
              rasterFails++;
              if (!firstFailure) firstFailure = { sc: sc.id, kind: 'raster', index: i };
            } else totalOk++;
          }
        }
        for (const p of [...(sc.probes || []), ...(sc.lattice || [])]) {
          probeChecks++; total++;
          const got = Core.pickPoint(sc.objects, p.x, p.y, { rule: 'top-left' });
          if (got.oid !== p.oid || JSON.stringify(got.hits) !== JSON.stringify(p.hits)) {
            probeFails++;
            if (!firstFailure) firstFailure = { sc: sc.id, kind: 'probe', p };
          } else totalOk++;
        }
        for (const e of sc.areas) {
          areaChecks++; total++;
          const tri = sc.objects.find((o) => o.oid === e.oid).triangles[e.tri];
          const f = An.trianglePixelAreaFraction(tri, e.x, e.y);
          if (f.n.toString() !== e.areaFrac[0] || f.d.toString() !== e.areaFrac[1]) {
            areaFails++;
            if (!firstFailure) firstFailure = { sc: sc.id, kind: 'area', e };
          } else totalOk++;
        }
        const ok = rasterFails + probeFails + areaFails === 0;
        const card = $('card-' + sc.id);
        card.classList.toggle('ok', ok);
        card.classList.toggle('fail', !ok);
        drawCardMap(sc, { ok, rasterChecks, probeChecks, areaChecks, rasterFails, probeFails, areaFails });
      }
      state.testResults = { total, totalOk, firstFailure };
      $('testSummary').className = 'badge ' + (totalOk === total ? 'ok' : 'fail');
      $('testSummary').textContent = totalOk === total
        ? `全部通过：${totalOk.toLocaleString()} 项逐样本/探针/面积比对一致`
        : `${total - totalOk} 项失败（${totalOk}/${total}）`;
      const fb = $('loadFirstFailureBtn');
      if (firstFailure) {
        fb.hidden = false;
        fb.textContent = `把首个失败（${firstFailure.sc} · ${firstFailure.kind}）载入调试视窗`;
        fb.onclick = () => loadScenarioInLab(firstFailure.sc);
      } else {
        fb.hidden = true;
      }
      btn.disabled = false;
    }, 30);
  }

  // ---------- 启动 ----------
  function init() {
    if (!Core || !An || !REF) {
      $('kernelBadge').textContent = '内核加载失败';
      $('kernelBadge').className = 'badge fail';
      return;
    }
    initControls();
    buildScenarioCards();
    renderAll();
    $('kernelBadge').textContent = `kernel ready · ${Core.DECIMALS} 位定点 · 规则=顶/左归属`;
    $('kernelBadge').className = 'badge ok';
    $('runTestsBtn').addEventListener('click', runAllTests);
    // 首帧后自动跑一次参考比对
    setTimeout(runAllTests, 120);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
