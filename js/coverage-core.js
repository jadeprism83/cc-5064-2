/*
 * coverage-core.js
 *
 * 三角形覆盖规则验证渲染器的唯一权威内核。
 *
 * 规则要点（详见 README「覆盖规则与数值政策」）：
 *  - 所有坐标先量化为 10^-DECIMALS 像素的十进制定点数（BigInt），
 *    边函数 W = (B-A) x (P-A) 全部为精确整数运算，W===0 判定无浮点误差。
 *  - 输入绕序先规范化为面积二倍 area2 > 0，因此翻转顶点绕序不改变覆盖。
 *  - 共边归属使用反对称的「顶边/左边」谓词：
 *      own(A->B)  <=>  B.y < A.y || (B.y === A.y && B.x < A.x)
 *    交换 A/B 后谓词取反，所以共享边（规范化后两邻三角形方向必相反）
 *    上的采样点恰好归属一个邻图元，不会漏也不会双计。
 *  - 退化三角形（area2 === 0）不产生任何覆盖并被标记。
 *
 * 浏览器中挂到全局 CoverageCore；Node 中 module.exports。
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.CoverageCore = api;
})(typeof globalThis !== 'undefined' ? globalThis : typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const DECIMALS = 6;
  const SCALE = 10n ** BigInt(DECIMALS);

  // ---------- 精确十进制定点 ----------

  function parseScaled(v) {
    if (typeof v === 'bigint') return v;
    if (typeof v === 'number') {
      if (!Number.isFinite(v)) throw new Error('坐标必须有限，收到 ' + String(v));
      if (Object.is(v, -0)) v = 0;
      // toFixed 给出该 float64 值的确定十进制表示，再走精确字符串解析。
      return parseScaledString(v.toFixed(DECIMALS + 3));
    }
    return parseScaledString(String(v).trim());
  }

  function expandExponent(s) {
    const m = /^([+-]?)(\d+(?:\.\d*)?|\.\d+)[eE]([+-]?\d+)$/.exec(s);
    if (!m) return s;
    const sign = m[1] === '-' ? '-' : '';
    const fracDigits = m[2].includes('.') ? m[2].split('.')[1].length : 0;
    const digits = m[2].replace('.', '');
    const pos = digits.length - fracDigits + parseInt(m[3], 10); // 小数点目标位置
    if (pos <= 0) return sign + '0.' + '0'.repeat(-pos) + digits;
    if (pos >= digits.length) return sign + digits + '0'.repeat(pos - digits.length);
    return sign + digits.slice(0, pos) + '.' + digits.slice(pos);
  }

  function parseScaledString(raw) {
    let s = raw;
    if (/[eE]/.test(s)) s = expandExponent(s);
    let neg = false;
    if (s[0] === '-') { neg = true; s = s.slice(1); }
    else if (s[0] === '+') s = s.slice(1);
    if (s === '' || s === '.') throw new Error('无法解析坐标 ' + raw);
    const dot = s.indexOf('.');
    let intPart = dot < 0 ? s : s.slice(0, dot);
    let frac = dot < 0 ? '' : s.slice(dot + 1);
    if (intPart === '') intPart = '0';
    if (!/^\d+$/.test(intPart) || !/^\d*$/.test(frac)) {
      throw new Error('无法解析坐标 ' + raw);
    }
    const kept = (frac + '0'.repeat(DECIMALS)).slice(0, DECIMALS);
    let value = BigInt(intPart) * SCALE + (kept ? BigInt(kept) : 0n);
    if (frac.length > DECIMALS) {
      const extra = frac.slice(DECIMALS);
      const first = extra.charCodeAt(0) - 48;
      const restNonZero = /[1-9]/.test(extra.slice(1));
      // 四舍六入五成双（ties-to-even，作用于绝对值；该规则对负数对称）
      let up = first > 5;
      if (first === 5) up = restNonZero || (value & 1n) === 1n;
      if (up) value += 1n;
    }
    return neg ? -value : value;
  }

  function floorDivPx(a) {
    // floor(a / SCALE)，SCALE > 0
    let q = a / SCALE;
    const r = a % SCALE;
    if (r !== 0n && a < 0n) q -= 1n;
    return q;
  }

  function ceilDivPx(a) {
    let q = a / SCALE;
    const r = a % SCALE;
    if (r !== 0n && a > 0n) q += 1n;
    return q;
  }

  // ---------- 采样图案（偏移单位为像素，相对像素左上角，范围 [0,1)） ----------

  const PATTERNS = {
    '1-center': {
      label: '1× 中心',
      samples: [{ x: '0.5', y: '0.5' }],
    },
    '2-diag': {
      label: '2× 对角',
      samples: [
        { x: '0.25', y: '0.25' },
        { x: '0.75', y: '0.75' },
      ],
    },
    '4-grid': {
      label: '4× 规则网格',
      samples: [
        { x: '0.25', y: '0.25' }, { x: '0.75', y: '0.25' },
        { x: '0.25', y: '0.75' }, { x: '0.75', y: '0.75' },
      ],
    },
    '4-rotated': {
      label: '4× 旋转网格',
      samples: [
        { x: '0.375', y: '0.125' }, { x: '0.875', y: '0.375' },
        { x: '0.125', y: '0.625' }, { x: '0.625', y: '0.875' },
      ],
    },
    '8-grid': {
      label: '8× 双行网格',
      samples: [
        { x: '0.125', y: '0.25' }, { x: '0.375', y: '0.25' },
        { x: '0.625', y: '0.25' }, { x: '0.875', y: '0.25' },
        { x: '0.125', y: '0.75' }, { x: '0.375', y: '0.75' },
        { x: '0.625', y: '0.75' }, { x: '0.875', y: '0.75' },
      ],
    },
    '8-rotted': {
      label: '8× 旋转网格',
      samples: [
        { x: '0.5625', y: '0.0625' }, { x: '0.8125', y: '0.3125' },
        { x: '0.3125', y: '0.1875' }, { x: '0.0625', y: '0.4375' },
        { x: '0.9375', y: '0.5625' }, { x: '0.6875', y: '0.8125' },
        { x: '0.4375', y: '0.6875' }, { x: '0.1875', y: '0.9375' },
      ],
    },
    '16-grid': {
      label: '16× 规则网格',
      samples: makeGrid(4),
    },
    '16-rotted': {
      label: '16× 稀疏旋转',
      samples: makeRotated16(),
    },
  };

  function makeGrid(n) {
    const out = [];
    for (let j = 0; j < n; j++) {
      for (let i = 0; i < n; i++) {
        out.push({ x: (i + 0.5) / n, y: (j + 0.5) / n });
      }
    }
    return out;
  }

  function makeRotated16() {
    // 4x4 旋转晶格的确定性变体，全部为有限小数。
    const out = [];
    for (let j = 0; j < 4; j++) {
      for (let i = 0; i < 4; i++) {
        let x = (i + 0.5) / 4 + (j - 1.5) * 0.125;
        let y = (j + 0.5) / 4;
        x = x - Math.floor(x);
        out.push({ x: Math.round(x * 1e6) / 1e6, y });
      }
    }
    return out;
  }

  function denseGrid(n) {
    return makeGrid(n);
  }

  function normalizePattern(pattern) {
    if (typeof pattern === 'string') {
      const p = PATTERNS[pattern];
      if (!p) throw new Error('未知采样图案 ' + pattern);
      pattern = p.samples;
    }
    if (!Array.isArray(pattern) || pattern.length === 0) throw new Error('采样图案为空');
    return pattern.map((s) => ({
      x: parseScaled(s.x),
      y: parseScaled(s.y),
      raw: s,
    }));
  }

  // ---------- 三角形预处理 ----------

  function prepareTriangle(input, oid = 0, triIndex = 0) {
    const raw = [input[0], input[1], input[2]].map((p) => {
      if (!p || p.x === undefined || p.y === undefined) throw new Error('顶点需要 {x,y}');
      return [parseScaled(p.x), parseScaled(p.y)];
    });
    const abx = raw[1][0] - raw[0][0];
    const aby = raw[1][1] - raw[0][1];
    const acx = raw[2][0] - raw[0][0];
    const acy = raw[2][1] - raw[0][1];
    const area2 = abx * acy - aby * acx;

    const prep = {
      oid,
      triIndex,
      raw: input,
      area2,
      degenerate: area2 === 0n,
      inputWinding: area2 > 0n ? 'positive' : area2 < 0n ? 'negative' : 'degenerate',
      p: null,
      edges: null,
      boundsPx: null,
    };
    if (area2 === 0n) return prep;

    // 规范化：保证 area2 > 0（交换 B/C）。翻转输入绕序后得到完全相同的规范三角形。
    const P = area2 < 0n ? [raw[0], raw[2], raw[1]] : raw;
    prep.p = P;
    prep.edges = [0, 1, 2].map((i) => {
      const A = P[i];
      const B = P[(i + 1) % 3];
      const ex = B[0] - A[0];
      const ey = B[1] - A[1];
      return {
        ax: A[0],
        ay: A[1],
        ex,
        ey,
        // 反对称顶/左归属谓词。
        ownsTie: ey < 0n || (ey === 0n && ex < 0n),
        stepX: -ey * SCALE,
        stepY: ex * SCALE,
      };
    });

    const minX = raw.reduce((m, q) => (q[0] < m ? q[0] : m), raw[0][0]);
    const maxX = raw.reduce((m, q) => (q[0] > m ? q[0] : m), raw[0][0]);
    const minY = raw.reduce((m, q) => (q[1] < m ? q[1] : m), raw[0][1]);
    const maxY = raw.reduce((m, q) => (q[1] > m ? q[1] : m), raw[0][1]);
    prep.boundsPx = {
      x0: Number(floorDivPx(minX)),
      x1: Number(ceilDivPx(maxX)) - 1,
      y0: Number(floorDivPx(minY)),
      y1: Number(ceilDivPx(maxY)) - 1,
    };
    return prep;
  }

  // 直接在任意精确点求边函数值（BigInt，单位 scale^2）。
  function edgeValuesAt(prep, x, y) {
    const X = parseScaled(x);
    const Y = parseScaled(y);
    return prep.edges.map((e) => e.ex * (Y - e.ay) - e.ey * (X - e.ax));
  }

  function insideFromW(w, edges, rule) {
    for (let i = 0; i < 3; i++) {
      const wi = w[i];
      if (wi > 0n) continue;
      if (wi === 0n) {
        if (rule === 'strict') return false;
        if (rule === 'inclusive') continue;
        // top-left-exact
        if (edges[i].ownsTie) continue;
        return false;
      }
      return false;
    }
    return true;
  }

  // 点查询：坐标为视口绝对像素坐标（可为小数/字符串）。
  function pointInside(tri, x, y, rule = 'top-left') {
    const prep = tri && tri.p ? tri : prepareTriangle(tri);
    if (prep.degenerate) return false;
    return insideFromW(edgeValuesAt(prep, x, y), prep.edges, rule);
  }

  function pickPoint(objects, x, y, opts = {}) {
    const rule = opts.rule || 'top-left';
    const drawOrder = opts.drawOrder
      ? objects.slice().sort((a, b) => drawOrder.indexOf(a.oid) - drawOrder.indexOf(b.oid))
      : objects;
    const hits = [];
    for (const obj of drawOrder) {
      if (obj.visible === false) continue;
      let inside = false;
      for (let t = 0; t < obj.triangles.length; t++) {
        const prep = prepareTriangle(obj.triangles[t], obj.oid, t);
        if (!prep.degenerate && pointInside(prep, x, y, rule)) { inside = true; break; }
      }
      if (inside) hits.push(obj.oid);
    }
    return {
      x: String(x), y: String(y), rule,
      hits,
      oid: hits.length ? hits[hits.length - 1] : 0, // 后绘制者获胜
    };
  }

  // ---------- 逐命中迭代（增量边函数；auto 时在安全范围内走 Number 精确整数） ----------

  const SAFE_MAX = BigInt(Number.MAX_SAFE_INTEGER);

  function chooseArithmetic(prep, vp) {
    // 以视口原点为局部基准估计 |W| 的上界；不超过 2^53 时，
    // 所有整数乘积/加减在 float64 下都精确（操作数与精确结果均可精确表示）。
    const b = prep.boundsPx;
    const ox = BigInt(vp.x0) * SCALE;
    const oy = BigInt(vp.y0) * SCALE;
    const xLo = BigInt(b.x0 - vp.x0) * SCALE;
    const xHi = BigInt(b.x1 - vp.x0 + 1) * SCALE;
    const yLo = BigInt(b.y0 - vp.y0) * SCALE;
    const yHi = BigInt(b.y1 - vp.y0 + 1) * SCALE;
    let bound = 0n;
    for (const e of prep.edges) {
      const axL = e.ax - ox;
      const ayL = e.ay - oy;
      const DX = maxAbs(xLo - axL, xHi - axL);
      const DY = maxAbs(yLo - ayL, yHi - ayL);
      const v = absBig(e.ex) * DY + absBig(e.ey) * DX;
      if (v > bound) bound = v;
    }
    // 留 4 倍余量：bound 约束 |W| 与单项乘积，相邻像素差 stepX 至多约 2bound，
    // SAFE/4 可同时保证步长整数与增量加法在 float64 下精确。
    return bound <= SAFE_MAX / 4n ? 'number' : 'bigint';
  }

  function absBig(v) { return v < 0n ? -v : v; }
  function maxAbs(a, b) { const aa = absBig(a), bb = absBig(b); return aa > bb ? aa : bb; }

  function forEachHitBig(prep, patternQ, rule, vp, cb, pxMin, pxMax, pyMin, pyMax) {
    const E = prep.edges;
    const own0 = E[0].ownsTie, own1 = E[1].ownsTie, own2 = E[2].ownsTie;
    const sx0 = E[0].stepX, sx1 = E[1].stepX, sx2 = E[2].stepX;
    const sy0 = E[0].stepY, sy1 = E[1].stepY, sy2 = E[2].stepY;
    let hitCount = 0;

    for (let k = 0; k < patternQ.length; k++) {
      const ox = patternQ[k].x;
      const oy = patternQ[k].y;
      const baseX = BigInt(pxMin) * SCALE + ox;
      const baseY = BigInt(pyMin) * SCALE + oy;
      const wb0 = E[0].ex * (baseY - E[0].ay) - E[0].ey * (baseX - E[0].ax);
      const wb1 = E[1].ex * (baseY - E[1].ay) - E[1].ey * (baseX - E[1].ax);
      const wb2 = E[2].ex * (baseY - E[2].ay) - E[2].ey * (baseX - E[2].ax);

      for (let py = pyMin; py <= pyMax; py++) {
        const row = BigInt(py - pyMin);
        let w0 = wb0 + sy0 * row;
        let w1 = wb1 + sy1 * row;
        let w2 = wb2 + sy2 * row;
        for (let px = pxMin; px <= pxMax; px++) {
          let inside;
          if (rule === 'inclusive') {
            inside = w0 >= 0n && w1 >= 0n && w2 >= 0n;
          } else if (rule === 'strict') {
            inside = w0 > 0n && w1 > 0n && w2 > 0n;
          } else {
            inside =
              (w0 > 0n || (w0 === 0n && own0)) &&
              (w1 > 0n || (w1 === 0n && own1)) &&
              (w2 > 0n || (w2 === 0n && own2));
          }
          if (inside) {
            cb(px - vp.x0, py - vp.y0, k, px, py);
            hitCount++;
          }
          w0 += sx0;
          w1 += sx1;
          w2 += sx2;
        }
      }
    }
    return hitCount;
  }

  function forEachHitNumber(prep, patternQ, rule, vp, cb, pxMin, pxMax, pyMin, pyMax) {
    const originX = BigInt(vp.x0) * SCALE;
    const originY = BigInt(vp.y0) * SCALE;
    const E = prep.edges.map((e) => ({
      // 先在 BigInt 中做局部化，再转 Number，避免巨大绝对坐标转换丢精度。
      ax: Number(e.ax - originX),
      ay: Number(e.ay - originY),
      ex: Number(e.ex),
      ey: Number(e.ey),
      ownsTie: e.ownsTie,
      stepX: Number(e.stepX),
      stepY: Number(e.stepY),
    }));
    const S = Number(SCALE);
    const own0 = E[0].ownsTie, own1 = E[1].ownsTie, own2 = E[2].ownsTie;
    const sx0 = E[0].stepX, sx1 = E[1].stepX, sx2 = E[2].stepX;
    const sy0 = E[0].stepY, sy1 = E[1].stepY, sy2 = E[2].stepY;
    const ax0 = E[0].ax, ax1 = E[1].ax, ax2 = E[2].ax;
    const ay0 = E[0].ay, ay1 = E[1].ay, ay2 = E[2].ay;
    const ex0 = E[0].ex, ex1 = E[1].ex, ex2 = E[2].ex;
    const ey0 = E[0].ey, ey1 = E[1].ey, ey2 = E[2].ey;
    let hitCount = 0;

    for (let k = 0; k < patternQ.length; k++) {
      const X0 = (pxMin - vp.x0) * S + Number(patternQ[k].x);
      const Ybase = (pyMin - vp.y0) * S + Number(patternQ[k].y);
      const wb0 = ex0 * (Ybase - ay0) - ey0 * (X0 - ax0);
      const wb1 = ex1 * (Ybase - ay1) - ey1 * (X0 - ax1);
      const wb2 = ex2 * (Ybase - ay2) - ey2 * (X0 - ax2);

      for (let py = pyMin; py <= pyMax; py++) {
        const row = py - pyMin;
        let w0 = wb0 + sy0 * row;
        let w1 = wb1 + sy1 * row;
        let w2 = wb2 + sy2 * row;
        for (let px = pxMin; px <= pxMax; px++) {
          let inside;
          if (rule === 'inclusive') {
            inside = w0 >= 0 && w1 >= 0 && w2 >= 0;
          } else if (rule === 'strict') {
            inside = w0 > 0 && w1 > 0 && w2 > 0;
          } else {
            inside =
              (w0 > 0 || (w0 === 0 && own0)) &&
              (w1 > 0 || (w1 === 0 && own1)) &&
              (w2 > 0 || (w2 === 0 && own2));
          }
          if (inside) {
            cb(px - vp.x0, py - vp.y0, k, px, py);
            hitCount++;
          }
          w0 += sx0;
          w1 += sx1;
          w2 += sx2;
        }
      }
    }
    return hitCount;
  }

  function forEachHit(prep, patternQ, rule, vp, cb, arith = 'auto') {
    if (prep.degenerate) return 0;
    const b = prep.boundsPx;
    const pxMin = Math.max(vp.x0, b.x0);
    const pxMax = Math.min(vp.x0 + vp.width - 1, b.x1);
    const pyMin = Math.max(vp.y0, b.y0);
    const pyMax = Math.min(vp.y0 + vp.height - 1, b.y1);
    if (pxMin > pxMax || pyMin > pyMax) return 0;

    let mode = arith;
    if (mode === 'auto') mode = chooseArithmetic(prep, vp);
    if (mode === 'number') {
      return forEachHitNumber(prep, patternQ, rule, vp, cb, pxMin, pxMax, pyMin, pyMax);
    }
    return forEachHitBig(prep, patternQ, rule, vp, cb, pxMin, pxMax, pyMin, pyMax);
  }

  // 单三角形光栅化：返回局部视口的逐采样命中数组与逐像素位掩码。
  function rasterTriangle(tri, opts = {}) {
    const rule = opts.rule || 'top-left';
    const patternQ = normalizePattern(opts.pattern || '4-grid');
    const vp = opts.viewport || { x0: 0, y0: 0, width: opts.width || 1, height: opts.height || 1 };
    const N = patternQ.length;
    const hits = new Uint8Array(vp.width * vp.height * N);
    const masks = new Uint32Array(vp.width * vp.height);
    const prep = prepareTriangle(tri);
    forEachHit(prep, patternQ, rule, vp, (lx, ly, k) => {
      hits[(ly * vp.width + lx) * N + k] = 1;
      if (k < 32) masks[ly * vp.width + lx] |= (1 << k) >>> 0;
    }, opts.arith || 'auto');
    return { hits, masks, N, viewport: vp, prep, pattern: patternQ };
  }

  // ---------- 整个场景：ID 缓冲 + 覆盖计数 + 采样级半透明混合 + 解析 ----------

  function rasterScene(scene, opts = {}) {
    const rule = opts.rule || 'top-left';
    const patternQ = normalizePattern(opts.pattern || scene.pattern || '4-grid');
    const N = patternQ.length;
    const vp = opts.viewport || scene.viewport || { x0: 0, y0: 0, width: scene.width, height: scene.height };
    const W = vp.width;
    const H = vp.height;
    const bg = opts.background || scene.background || [28, 30, 40];

    const pixelCount = W * H;
    const owner = new Int32Array(pixelCount * N);
    const count = new Int16Array(pixelCount * N);
    const sampleRGB = new Float32Array(pixelCount * N * 3);
    for (let i = 0; i < pixelCount * N; i++) {
      sampleRGB[i * 3] = bg[0];
      sampleRGB[i * 3 + 1] = bg[1];
      sampleRGB[i * 3 + 2] = bg[2];
    }

    const order = scene.objects
      .map((o, i) => ({ o, i }))
      .filter((e) => e.o.visible !== false)
      .sort((a, b) => {
        const da = a.o.drawOrder === undefined ? a.i : a.o.drawOrder;
        const db = b.o.drawOrder === undefined ? b.i : b.o.drawOrder;
        return da - db || a.i - b.i;
      });

    const degenerates = [];

    for (const { o } of order) {
      const alpha = o.alpha === undefined ? 0.5 : o.alpha;
      const col = o.color || [220, 120, 200];
      const cr = col[0] / 255;
      const cg = col[1] / 255;
      const cb = col[2] / 255;
      for (let t = 0; t < o.triangles.length; t++) {
        const prep = prepareTriangle(o.triangles[t], o.oid, t);
        if (prep.degenerate) { degenerates.push({ oid: o.oid, triIndex: t }); continue; }
        forEachHit(prep, patternQ, rule, vp, (lx, ly, k) => {
          const sIdx = (ly * W + lx) * N + k;
          count[sIdx]++;
          owner[sIdx] = o.oid; // 后绘制者覆盖 ID
          const i3 = sIdx * 3;
          sampleRGB[i3] = sampleRGB[i3] * (1 - alpha) + cr * 255 * alpha;
          sampleRGB[i3 + 1] = sampleRGB[i3 + 1] * (1 - alpha) + cg * 255 * alpha;
          sampleRGB[i3 + 2] = sampleRGB[i3 + 2] * (1 - alpha) + cb * 255 * alpha;
        }, opts.arith || 'auto');
      }
    }

    const pixels = new Uint8ClampedArray(pixelCount * 4);
    const coverage = new Float32Array(pixelCount);
    const coveredSamples = new Uint16Array(pixelCount);
    for (let p = 0; p < pixelCount; p++) {
      let r = 0, g = 0, b = 0, cov = 0;
      for (let k = 0; k < N; k++) {
        const sIdx = p * N + k;
        r += sampleRGB[sIdx * 3];
        g += sampleRGB[sIdx * 3 + 1];
        b += sampleRGB[sIdx * 3 + 2];
        if (count[sIdx] > 0) cov++;
      }
      pixels[p * 4] = r / N;
      pixels[p * 4 + 1] = g / N;
      pixels[p * 4 + 2] = b / N;
      pixels[p * 4 + 3] = 255;
      coverage[p] = cov / N;
      coveredSamples[p] = cov;
    }

    return {
      width: W, height: H, viewport: vp, N, rule,
      pattern: patternQ,
      owner, count, sampleRGB,
      pixels, coverage, coveredSamples,
      degenerates,
    };
  }

  // 取某个局部像素内、按对象去重后的覆盖样本数（面积拾取的样本版本）。
  function objectSampleCountsInPixel(raster, lx, ly, objects) {
    const { width: W, N, owner, count } = raster;
    const perObject = new Map();
    for (let k = 0; k < N; k++) {
      const sIdx = (ly * W + lx) * N + k;
      // count 只给总次数；需要按对象去重时用对象点查询更稳，这里先给 owner 分布。
      const oid = owner[sIdx];
      if (oid) perObject.set(oid, (perObject.get(oid) || 0) + 1);
    }
    void count;
    return perObject;
  }

  // 精确计算某像素内每个对象覆盖的不同样本（对象内部三角形去重）。
  function objectCoverageInPixel(objects, px, py, patternRaw, rule = 'top-left') {
    const result = new Map();
    for (const o of objects) {
      if (o.visible === false) continue;
      let samples = 0;
      const which = [];
      for (let k = 0; k < patternRaw.length; k++) {
        const s = patternRaw[k];
        const x = px + Number(s.x);
        const y = py + Number(s.y);
        let hit = false;
        for (const tri of o.triangles) {
          if (pointInside(tri, x, y, rule)) { hit = true; break; }
        }
        if (hit) { samples++; which.push(k); }
      }
      result.set(o.oid, { oid: o.oid, samples, which });
    }
    return result;
  }

  // 面积模式排序：解析面积优先；面积相同时后绘制顺序优先，再相同取小 oid。
  function rankAreaPicks(areaEntries, drawOrder) {
    const arr = areaEntries.filter((e) => e.area > 0 || e.samples > 0);
    const orderIndex = (oid) => {
      if (!drawOrder) return oid;
      const i = drawOrder.indexOf(oid);
      return i < 0 ? Number.MAX_SAFE_INTEGER : i;
    };
    arr.sort((a, b) => {
      if (b.area !== a.area) return b.area - a.area;
      if (b.samples !== a.samples) return b.samples - a.samples;
      return orderIndex(b.oid) - orderIndex(a.oid) || a.oid - b.oid;
    });
    return arr;
  }

  // 共边精确一次不变量：对一组（最好共边的）三角形，在给定采样点集合上
  // 返回所有 count>1 / count===0-but-should... 这里只报告重复命中。
  function findMultipleHits(raster) {
    const bad = [];
    const { width: W, height: H, N, count, viewport } = raster;
    for (let ly = 0; ly < H; ly++) {
      for (let lx = 0; lx < W; lx++) {
        for (let k = 0; k < N; k++) {
          const c = count[(ly * W + lx) * N + k];
          if (c > 1) {
            bad.push({ x: viewport.x0 + lx, y: viewport.y0 + ly, lx, ly, k, count: c });
          }
        }
      }
    }
    return bad;
  }

  return {
    DECIMALS,
    SCALE,
    PATTERNS,
    parseScaled,
    parseScaledString,
    normalizePattern,
    prepareTriangle,
    edgeValuesAt,
    pointInside,
    pickPoint,
    forEachHit,
    rasterTriangle,
    rasterScene,
    denseGrid,
    floorDivPx,
    ceilDivPx,
    objectSampleCountsInPixel,
    objectCoverageInPixel,
    rankAreaPicks,
    findMultipleHits,
  };
});
