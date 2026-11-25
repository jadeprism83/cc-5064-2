const test = require('node:test');
const assert = require('node:assert/strict');
const C = require('../js/coverage-core.js');
const A = require('../js/analytic.js');
const DATA = require('../js/reference-data.js');

function flipWindingObjects(objects) {
  return objects.map((o) => ({
    ...o,
    triangles: o.triangles.map((t) => [t[2], t[1], t[0]]),
  }));
}

test('参考数据已生成且包含全部场景', () => {
  assert.ok(DATA.scenarios.length >= 7);
  for (const sc of DATA.scenarios) {
    assert.ok(sc.rasters, sc.id + ' rasters');
    assert.ok(sc.areas.length > 0 || sc.id === 'degenerate');
  }
});

for (const sc of DATA.scenarios) {
  for (const [pid, ref] of Object.entries(sc.rasters)) {
    test(`[${sc.id}/${pid}] 计数与对象编号逐样本匹配独立高精度参考`, () => {
      const pattern = DATA.patterns[pid];
      const r = C.rasterScene(
        { objects: sc.objects },
        { pattern, viewport: sc.viewport, background: [0, 0, 0] }
      );
      assert.equal(r.N, ref.N);
      assert.equal(r.count.length, ref.counts.length);
      assert.equal(r.owner.length, ref.owners.length);
      let mismatches = 0;
      for (let i = 0; i < ref.counts.length; i++) {
        if (r.count[i] !== ref.counts[i] || r.owner[i] !== ref.owners[i]) {
          mismatches++;
          if (mismatches <= 5) {
            assert.fail(
              `idx ${i}: got count=${r.count[i]} owner=${r.owner[i]} ` +
              `ref count=${ref.counts[i]} owner=${ref.owners[i]}`
            );
          }
        }
      }
      assert.equal(mismatches, 0);
    });

    test(`[${sc.id}/${pid}] 翻转全部绕序后结果不变`, () => {
      const pattern = DATA.patterns[pid];
      const a = C.rasterScene({ objects: sc.objects }, { pattern, viewport: sc.viewport });
      const b = C.rasterScene(
        { objects: flipWindingObjects(sc.objects) },
        { pattern, viewport: sc.viewport }
      );
      assert.deepEqual(Array.from(b.count), Array.from(a.count));
      assert.deepEqual(Array.from(b.owner), Array.from(a.owner));
      // 且仍与参考一致
      for (let i = 0; i < ref.counts.length; i++) assert.equal(b.count[i], ref.counts[i]);
    });
  }

  test(`[${sc.id}] 探针（含格点/顶点）归属与参考一致`, () => {
    for (const p of [...(sc.probes || []), ...(sc.lattice || [])]) {
      const got = C.pickPoint(sc.objects, p.x, p.y);
      assert.equal(got.oid, p.oid, `probe ${p.x},${p.y} oid`);
      assert.deepEqual(got.hits, p.hits, `probe ${p.x},${p.y} hits`);
    }
  });

  test(`[${sc.id}] 正确顶左规则下拼接网格零重复命中`, () => {
    for (const pid of Object.keys(sc.rasters)) {
      const r = C.rasterScene(
        { objects: sc.objects },
        { pattern: DATA.patterns[pid], viewport: sc.viewport }
      );
      const multi = C.findMultipleHits(r);
      assert.equal(multi.length, 0, `${pid} 出现重复命中 ${JSON.stringify(multi.slice(0, 3))}`);
    }
  });

  test(`[${sc.id}] 解析面积与 Python Fraction 参考逐项精确一致`, () => {
    for (const e of sc.areas) {
      const tri = sc.objects.find((o) => o.oid === e.oid).triangles[e.tri];
      const f = A.trianglePixelAreaFraction(tri, e.x, e.y);
      assert.equal(f.n.toString(), e.areaFrac[0], `num ${e.oid} t${e.tri} ${e.x},${e.y}`);
      assert.equal(f.d.toString(), e.areaFrac[1], `den ${e.oid} t${e.tri} ${e.x},${e.y}`);
      assert.ok(Math.abs(A.fnum(f) - e.areaFloat) < 1e-15);
      assert.ok(A.fnum(f) >= 0 && A.fnum(f) <= 1 + 1e-12);
    }
  });
}

test('共边拾取分歧：指针子样本=背景，覆盖面积=前景，翻绕序不变', () => {
  const sc = DATA.scenarios.find((s) => s.id === 'shared-edge-pick');
  const probe = sc.focusPixel.probe;
  const pat4 = DATA.patterns['4-grid'];

  const sub = C.pickPoint(sc.objects, probe.x, probe.y);
  assert.equal(sub.oid, 1, '精确共边点必须归背景');
  assert.deepEqual(sub.hits, [1]);

  const px = sc.focusPixel.x;
  const py = sc.focusPixel.y;
  const per = C.objectCoverageInPixel(sc.objects, px, py, pat4, 'top-left');
  assert.equal(per.get(1).samples, 1);
  assert.equal(per.get(2).samples, 3);
  const ranked = C.rankAreaPicks([
    { oid: 1, samples: per.get(1).samples, area: A.objectPixelArea(sc.objects[0], px, py) },
    { oid: 2, samples: per.get(2).samples, area: A.objectPixelArea(sc.objects[1], px, py) },
  ]);
  assert.equal(ranked[0].oid, 2, '面积模式必须选前景');
  assert.ok(Math.abs(ranked.find((e) => e.oid === 1).area - 0.125) < 1e-12);
  assert.ok(Math.abs(ranked.find((e) => e.oid === 2).area - 0.875) < 1e-12);

  const flipped = flipWindingObjects(sc.objects);
  assert.equal(C.pickPoint(flipped, probe.x, probe.y).oid, 1);
  const per2 = C.objectCoverageInPixel(flipped, px, py, pat4, 'top-left');
  assert.equal(per2.get(1).samples, 1);
  assert.equal(per2.get(2).samples, 3);
});

test('错误规则能被计数图抓到：inclusive 双计、strict 漏边', () => {
  const sc = DATA.scenarios.find((s) => s.id === 'shared-edge-pick');
  const vp = sc.viewport;
  const pat = DATA.patterns['4-grid'];

  const inc = C.rasterScene({ objects: sc.objects }, { pattern: pat, viewport: vp, rule: 'inclusive' });
  assert.ok(C.findMultipleHits(inc).length > 0, 'inclusive 必须产生双计样本');

  const strict = C.rasterScene({ objects: sc.objects }, { pattern: pat, viewport: vp, rule: 'strict' });
  // 焦点像素的 k=1 共边样本在 strict 下两个三角形都不认
  const lx = sc.focusPixel.x - vp.x0;
  const ly = sc.focusPixel.y - vp.y0;
  const idx = (ly * vp.width + lx) * 4 + 1;
  assert.equal(strict.count[idx], 0, 'strict 下共边样本必须漏填');

  const correct = C.rasterScene({ objects: sc.objects }, { pattern: pat, viewport: vp });
  assert.equal(correct.count[idx], 1, '正确规则下共边样本恰好一次');
});

test('退化三角形被标记且零覆盖', () => {
  const sc = DATA.scenarios.find((s) => s.id === 'degenerate');
  const r = C.rasterScene({ objects: sc.objects }, { pattern: '4-grid', viewport: sc.viewport });
  assert.ok(r.degenerates.length >= 2);
  // oid 2/3 不出现在 owner 中
  for (const o of r.owner) assert.notEqual(o, 2);
  for (const o of r.owner) assert.notEqual(o, 3);
});

test('大坐标：BigInt 精确边函数与参考一致（含格点探针）', () => {
  const sc = DATA.scenarios.find((s) => s.id === 'large-coords');
  const r = C.rasterScene(
    { objects: sc.objects },
    { pattern: DATA.patterns['16-grid'], viewport: sc.viewport }
  );
  const ref = sc.rasters['16-grid'];
  for (let i = 0; i < ref.counts.length; i++) assert.equal(r.count[i], ref.counts[i]);
  for (const p of sc.probes) assert.equal(C.pickPoint(sc.objects, p.x, p.y).oid, p.oid);
});

test('解析面积 vs 加密采样：随样本密度收敛', () => {
  // 取拼接矩形中若干面积条目，比较 8x8 / 16x16 / 64x64 网格采样误差
  const sc = DATA.scenarios.find((s) => s.id === 'tiled-rects');
  const picked = sc.areas.filter((_, i) => i % 17 === 0).slice(0, 12);
  const errors = { 8: [], 16: [], 64: [] };
  for (const e of picked) {
    const tri = sc.objects.find((o) => o.oid === e.oid).triangles[e.tri];
    const area = e.areaFloat;
    for (const m of [8, 16, 64]) {
      const rt = C.rasterTriangle(tri, {
        pattern: C.denseGrid(m),
        viewport: { x0: e.x, y0: e.y, width: 1, height: 1 },
      });
      let hits = 0;
      for (let i = 0; i < rt.hits.length; i++) hits += rt.hits[i];
      errors[m].push(Math.abs(hits / (m * m) - area));
    }
  }
  const max = (a) => Math.max(...a);
  const mean = (a) => a.reduce((x, y) => x + y, 0) / a.length;
  // 经验/理论：网格加密误差必须显著下降，64 密度最大误差足够小
  assert.ok(mean(errors[16]) < mean(errors[8]), '16 密度平均误差应小于 8');
  assert.ok(mean(errors[64]) < mean(errors[16]), '64 密度平均误差应小于 16');
  assert.ok(max(errors[64]) < 0.05, `64 密度最大误差 ${max(errors[64])} 过大`);
});

test('Number 快速路径与 BigInt 精确路径在全部场景上逐样本一致', () => {
  for (const sc of DATA.scenarios) {
    for (const pid of Object.keys(sc.rasters)) {
      const pattern = DATA.patterns[pid];
      const num = C.rasterScene(
        { objects: sc.objects },
        { pattern, viewport: sc.viewport, arith: 'number' }
      );
      const big = C.rasterScene(
        { objects: sc.objects },
        { pattern, viewport: sc.viewport, arith: 'big' }
      );
      assert.deepEqual(Array.from(num.count), Array.from(big.count), `${sc.id}/${pid} count`);
      assert.deepEqual(Array.from(num.owner), Array.from(big.owner), `${sc.id}/${pid} owner`);
    }
  }
});

test('数值政策：超精度输入 ties-to-even 且可处理字符串坐标', () => {  assert.equal(C.DECIMALS, 6);
  const S6 = 10n ** BigInt(C.DECIMALS);
  // 第 7 位恰为 tie：1.0000005，保留值末位为偶，舍去
  assert.equal(C.parseScaled('1.0000005'), S6);
  // 1.0000015：保留值为奇数，tie 进位到偶数
  assert.equal(C.parseScaled('1.0000015'), S6 + 2n);
  // 第 7 位为 7 正常进位
  assert.equal(C.parseScaled('0.0000007'), 1n);
  assert.throws(() => C.parseScaled('not-a-number'));
  assert.throws(() => C.parseScaled(NaN));
});
