const test = require('node:test');
const assert = require('node:assert/strict');
const C = require('../js/coverage-core.js');

const vp = { x0: 0, y0: 0, width: 16, height: 12 };
const focus = { x: 6, y: 5 };
const p = focus.y * vp.width + focus.x;
const edgePoint = { x: 6.75, y: 5.25 };

function sharedEdgeObjects() {
  const A = { x: 2, y: 0.5 };
  const B = { x: 13, y: 11.5 };
  return [
    {
      oid: 1, color: [74, 144, 255], alpha: 0.5,
      triangles: [[A, B, { x: 14.2, y: 9 }]],
    },
    {
      oid: 2, color: [255, 176, 32], alpha: 0.55,
      triangles: [[A, B, { x: 2.5, y: 11 }]],
    },
  ];
}

function positions4() {
  return C.PATTERNS['4-grid'].samples.map((s) => ({ x: Number(s.x), y: Number(s.y) }));
}

function legacyReorderedStorage(objects = sharedEdgeObjects()) {
  const canonical = positions4();
  // Legacy device order places canonical sample 1 at device slot 3 and vice versa.
  const oldToNew = [0, 3, 2, 1];
  const oldPositions = oldToNew.map((canonicalIndex) => canonical[canonicalIndex]);
  const storage = C.rasterScene(
    { objects },
    { pattern: oldPositions, viewport: vp, rule: 'top-left' }
  );
  storage.samplePositions = oldPositions;
  storage.storageVersion = 1;
  storage.sampleLayoutVersion = 1;
  for (let k = 0; k < 4; k++) {
    for (let pixel = 0; pixel < vp.width * vp.height; pixel++) {
      storage.depth[pixel * 4 + k] = 0.2 + k * 0.013;
    }
  }
  return { storage, canonical, oldToNew, oldPositions };
}

test('sample layout exposes explicit geometric migration version', () => {
  assert.equal(C.SAMPLE_LAYOUT_VERSION, 2);
  assert.match(C.SAMPLE_LAYOUT_MIGRATION_VERSION, /v2/);
  const layout = C.canonicalSampleLayout('8-rotted');
  const ys = layout.positions.map((s) => s.y);
  assert.deepEqual(ys, [...ys].sort((a, b) => a - b));
  assert.equal(layout.sampleCount, 8);
  assert.equal(layout.order, C.CANONICAL_SAMPLE_ORDER);
});

test('reorder migration permutes owner, depth and mask while color resolve stays same', () => {
  const { storage: old, canonical, oldToNew } = legacyReorderedStorage();
  const fresh = C.rasterScene(
    { objects: sharedEdgeObjects() },
    { pattern: canonical, viewport: vp, rule: 'top-left' }
  );

  assert.equal(old.masks[p], 15);
  const migrated = C.migrateSampleStorage(old, canonical);
  assert.equal(migrated.mode, 'reorder');
  assert.deepEqual(migrated.oldToNew, oldToNew);
  assert.equal(migrated.sampleLayoutVersion, C.SAMPLE_LAYOUT_VERSION);

  assert.deepEqual(Array.from(migrated.owner), Array.from(fresh.owner));
  assert.deepEqual(Array.from(migrated.count), Array.from(fresh.count));
  assert.deepEqual(Array.from(migrated.masks), Array.from(fresh.masks));
  assert.equal(migrated.pickBuffer, migrated.owner);
  assert.equal(migrated.depthBuffer, migrated.depth);
  assert.equal(migrated.coverageCache, migrated.count);
  assert.equal(migrated.sampleMasks, migrated.masks);
  assert.deepEqual(Array.from(migrated.pixels), Array.from(old.pixels));

  for (let k = 0; k < 4; k++) {
    const j = oldToNew[k];
    assert.equal(
      migrated.depth[p * 4 + j],
      old.depth[p * 4 + k],
      `depth old ${k} -> new ${j}`
    );
  }

  // The diagonal exactly crosses the non-center 0.75,0.25 sample. Top/left
  // ownership makes the tie sample belong to exactly one triangle (#1).
  const edgeInOne = C.pointInside(sharedEdgeObjects()[0].triangles[0], edgePoint.x, edgePoint.y);
  const edgeInTwo = C.pointInside(sharedEdgeObjects()[1].triangles[0], edgePoint.x, edgePoint.y);
  assert.equal(edgeInOne, true);
  assert.equal(edgeInTwo, false);
  assert.notEqual(edgeInOne, edgeInTwo);
  assert.equal(C.pickPoint(sharedEdgeObjects(), edgePoint.x, edgePoint.y).oid, 1);

  const picked = C.pickStoredSample(migrated, edgePoint.x, edgePoint.y);
  assert.equal(picked.k, 1);
  assert.equal(picked.oid, 1);

  // Reading the old device slot with a geometric index is the false migration:
  // geometric sample 1 reads device slot 1, which before permutation owns #2.
  assert.equal(old.owner[p * 4 + 1], 2);
  const naiveWrongPick = C.pickStoredSample(old, edgePoint.x, edgePoint.y, {
    positions: canonical,
  });
  assert.equal(naiveWrongPick.k, 1);
  assert.equal(naiveWrongPick.oid, 2);

  const evidence = C.coverageEvidenceAt(migrated, focus.x, focus.y);
  assert.equal(evidence.mask, 15);
  assert.deepEqual(evidence.resolvedRGBA, Array.from(migrated.pixels.slice(p * 4, p * 4 + 4)));
});

test('shared diagonal mask identity moves with the tied sample bit', () => {
  const canonical = positions4();
  const oldToNew = [0, 3, 2, 1];
  const oldPositions = oldToNew.map((j) => canonical[j]);
  const [one, two] = sharedEdgeObjects();

  const canonicalOne = C.rasterScene({ objects: [one] }, { pattern: canonical, viewport: vp });
  const canonicalTwo = C.rasterScene({ objects: [two] }, { pattern: canonical, viewport: vp });
  assert.equal(canonicalOne.masks[p], 0b0010);
  assert.equal(canonicalTwo.masks[p], 0b1101);

  const oldOne = C.rasterScene({ objects: [one] }, { pattern: oldPositions, viewport: vp });
  const oldTwo = C.rasterScene({ objects: [two] }, { pattern: oldPositions, viewport: vp });
  assert.equal(oldOne.masks[p], 0b1000);
  assert.equal(oldTwo.masks[p], 0b0111);

  const migratedOne = C.migrateSampleStorage(oldOne, canonical);
  const migratedTwo = C.migrateSampleStorage(oldTwo, canonical);
  assert.equal(migratedOne.masks[p], canonicalOne.masks[p]);
  assert.equal(migratedTwo.masks[p], canonicalTwo.masks[p]);
});

test('shifted samples require geometry; without it callers preserve legacy or reject', () => {
  const { storage: old, canonical } = legacyReorderedStorage();
  const shifted = canonical.map((s, i) => i === 1 ? { ...s, y: 0.3 } : s);

  const decision = C.canMigrateSampleStorage(old, shifted);
  assert.equal(decision.canPermute, false);
  assert.equal(decision.requiresRasterization, true);
  assert.equal(decision.hasGeometry, false);

  assert.throws(
    () => C.migrateSampleStorage(old, shifted),
    (err) => err.code === 'SAMPLE_LAYOUT_GEOMETRY_REQUIRED'
  );

  const preserved = C.migrateSampleStorage(old, shifted, { strategy: 'preserve' });
  assert.equal(preserved.decision, 'preserve');
  assert.equal(preserved.preservedLegacy, true);
  assert.equal(preserved.sampleLayoutVersion, 1);
  assert.equal(C.pickStoredSample(preserved, edgePoint.x, edgePoint.y).oid, 1);

  // Same pixel, immediately above/below the mathematical diagonal.
  assert.equal(C.pickPoint(sharedEdgeObjects(), 6.75, 5.249999).oid, 1);
  assert.equal(C.pickPoint(sharedEdgeObjects(), 6.75, 5.250001).oid, 2);
});

test('geometry rerasterization resolves a truly shifted sample to the other triangle', () => {
  const { storage: old, canonical } = legacyReorderedStorage();
  const shifted = canonical.map((s, i) => i === 1 ? { ...s, y: 0.3 } : s);
  const objects = sharedEdgeObjects();

  const migrated = C.migrateSampleStorage(old, shifted, {
    objects,
    viewport: vp,
    evidencePoints: [{ x: 6.75, y: 5.3 }],
  });
  assert.equal(migrated.mode, 'rerasterize');
  assert.equal(migrated.decision, 'rerasterize');
  assert.equal(migrated.owner[p * 4 + 1], 2);
  assert.equal(C.pickStoredSample(migrated, 6.75, 5.3).oid, 2);

  assert.equal(migrated.evidence.realDraw, true);
  assert.equal(migrated.evidence.supersampled, false);
  assert.ok(migrated.evidence.stats.hitSamples > 0);
  assert.equal(migrated.evidence.points[0].pickAtPoint.oid, 2);
});

test('declared resolve rule survives config migration without supersampling replacement', () => {
  const config = {
    sampleCount: 4,
    resolveRule: 'sample-mask-and-alpha-average',
    deviceOrder: true,
  };
  const migrated = C.migrateSampleConfig(config, positions4());
  assert.equal(migrated.resolveRule, 'sample-mask-and-alpha-average');
  assert.equal(migrated.declaredResolveRule, 'sample-mask-and-alpha-average');
  assert.equal(migrated.supersample, false);
  assert.equal(migrated.oversizedTextureReplacement, false);
  assert.equal(migrated.samplePositions.length, 4);
});

test('new sample-position backend accepts positions and rasterizes through MSAA path', () => {
  const backend = C.createSamplePositionBackend({ pattern: '4-grid' });
  const next = C.canonicalSampleLayout('2-diag').positions;
  const change = backend.setSamplePositions(next);
  assert.equal(change.sampleCount, 2);
  const result = backend.rasterScene({ objects: sharedEdgeObjects() }, { viewport: vp });
  assert.equal(result.N, 2);
  assert.equal(result.newPath, true);
  assert.ok(result.stats.hitSamples > 0);
});

test('migration does not mutate source masks and accepts options-object target', () => {
  const { storage: old, canonical } = legacyReorderedStorage();
  const sourceMasks = Uint32Array.from(old.masks);
  const decision = C.canMigrateSampleStorage(old, { target: canonical });
  assert.equal(decision.canPermute, true);

  C.migrateSampleStorage(old, { to: canonical });
  assert.deepEqual(Array.from(old.masks), Array.from(sourceMasks));

  const revived = C.deserializeSampleStorage(C.serializeSampleStorage(old));
  const migratedFromJson = C.migrateSampleStorage(revived, { target: canonical });
  assert.equal(migratedFromJson.mode, 'reorder');
  assert.equal(migratedFromJson.sampleLayoutVersion, 2);
});

test('depth compare controls owner when fragments have explicit depth', () => {
  const tri = [[{ x: 0, y: 0 }, { x: 2, y: 0 }, { x: 0, y: 2 }]];
  const objects = [
    { oid: 1, depth: 0.2, alpha: 1, triangles: tri },
    { oid: 2, depth: 0.8, alpha: 1, triangles: tri },
  ];
  const less = C.rasterScene(
    { objects },
    { pattern: '4-grid', viewport: { x0: 0, y0: 0, width: 1, height: 1 }, depthTest: true, depthFunc: 'less' }
  );
  for (let k = 0; k < 4; k++) assert.equal(less.owner[k], 1);
  assert.ok(less.depth[0] < 0.3);

  const always = C.rasterScene(
    { objects },
    { pattern: '4-grid', viewport: { x0: 0, y0: 0, width: 1, height: 1 } }
  );
  for (let k = 0; k < 4; k++) assert.equal(always.owner[k], 2);
});
