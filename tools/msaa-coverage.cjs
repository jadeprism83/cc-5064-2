#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const C = require(path.join(__dirname, '..', 'js', 'coverage-core.js'));

function sharedEdgeFixture() {
  const A = { x: 2, y: 0.5 };
  const B = { x: 13, y: 11.5 };
  return {
    viewport: { x0: 0, y0: 0, width: 16, height: 12 },
    focus: { x: 6, y: 5 },
    edgePoint: { x: 6.75, y: 5.25 },
    objects: [
      { oid: 1, name: 'background-owner', color: [74, 144, 255], alpha: 0.5,
        triangles: [[A, B, { x: 14.2, y: 9 }]] },
      { oid: 2, name: 'foreground-majority', color: [255, 176, 32], alpha: 0.55,
        triangles: [[A, B, { x: 2.5, y: 11 }]] },
    ],
  };
}

function buildEvidence() {
  const fixture = sharedEdgeFixture();
  const canonical = C.PATTERNS['4-grid'].samples.map((s) => ({ x: Number(s.x), y: Number(s.y) }));
  const oldToNew = [0, 3, 2, 1];
  const oldPositions = oldToNew.map((j) => canonical[j]);
  const old = C.rasterScene(
    { objects: fixture.objects },
    { pattern: oldPositions, viewport: fixture.viewport, rule: 'top-left' }
  );
  old.samplePositions = oldPositions;
  old.storageVersion = C.LEGACY_SAMPLE_LAYOUT_VERSION;
  old.sampleLayoutVersion = C.LEGACY_SAMPLE_LAYOUT_VERSION;

  const migrated = C.migrateSampleStorage(old, canonical);
  const direct = C.rasterMultisampleCoverage(
    { objects: fixture.objects },
    {
      pattern: canonical,
      viewport: fixture.viewport,
      rule: 'top-left',
      evidencePoints: [fixture.edgePoint],
      canonical: false,
    }
  );
  const p = fixture.focus.y * fixture.viewport.width + fixture.focus.x;
  const evidence = C.coverageEvidenceAt(migrated, fixture.focus.x, fixture.focus.y);
  const edgePick = C.pickStoredSample(migrated, fixture.edgePoint.x, fixture.edgePoint.y);

  const shifted = canonical.map((s, i) => i === 1 ? { ...s, y: 0.3 } : s);
  let noGeometryDecision = 'rejected';
  try {
    C.migrateSampleStorage(old, shifted);
  } catch (err) {
    noGeometryDecision = err.code;
  }
  const rerasterized = C.migrateSampleStorage(old, shifted, {
    objects: fixture.objects,
    viewport: fixture.viewport,
  });

  const checks = {
    version: C.SAMPLE_LAYOUT_VERSION,
    migrationVersion: C.SAMPLE_LAYOUT_MIGRATION_VERSION,
    diagonalGeometryPick: C.pickPoint(fixture.objects, fixture.edgePoint.x, fixture.edgePoint.y).oid,
    diagonalBufferPick: edgePick.oid,
    diagonalSampleIndex: edgePick.k,
    migratedMask: evidence.maskBinary,
    resolvedRGBA: evidence.resolvedRGBA,
    finalColorMatchesDirectDraw: Buffer.from(migrated.pixels).equals(Buffer.from(direct.pixels)),
    ownerMatchesDirectDraw: Buffer.from(migrated.owner).equals(Buffer.from(direct.owner)),
    shiftedWithoutGeometry: noGeometryDecision,
    shiftedRerasterOwnerAtTiedSlot: rerasterized.owner[p * 4 + 1],
    realDraw: direct.evidence.realDraw,
    supersampled: direct.evidence.supersampled,
    hitSamples: direct.stats.hitSamples,
  };
  checks.ok =
    checks.diagonalGeometryPick === 1 &&
    checks.diagonalBufferPick === 1 &&
    checks.diagonalSampleIndex === 1 &&
    checks.finalColorMatchesDirectDraw &&
    checks.ownerMatchesDirectDraw &&
    checks.shiftedWithoutGeometry === 'SAMPLE_LAYOUT_GEOMETRY_REQUIRED' &&
    checks.shiftedRerasterOwnerAtTiedSlot === 2 &&
    checks.realDraw === true &&
    checks.supersampled === false &&
    checks.hitSamples > 0;
  return { checks, evidence: { ...evidence, pickAtPoint: edgePick } };
}

function parseArgs(argv) {
  const args = { _: [] };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) args[a.slice(2)] = argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[++i] : true;
    else args._.push(a);
  }
  return args;
}

function migrateFile(args) {
  if (!args.input || !args.output) throw new Error('--migrate-file 需要 --input old.json --output migrated.json');
  const raw = fs.readFileSync(args.input, 'utf8');
  const storage = C.deserializeSampleStorage(raw);
  const target = args.positions ? C.PATTERNS[args.positions] : undefined;
  const options = {
    strategy: args.preserve ? 'preserve' : undefined,
    oldToNew: args['old-to-new'] ? JSON.parse(args['old-to-new']) : undefined,
  };
  let result;
  try {
    result = C.migrateSampleStorage(storage, target, options);
  } catch (err) {
    if (args.preserve) result = C.migrateSampleStorage(storage, target, { ...options, strategy: 'preserve' });
    else throw err;
  }
  fs.mkdirSync(path.dirname(path.resolve(args.output)), { recursive: true });
  fs.writeFileSync(args.output, C.serializeSampleStorage(result));
  console.log(JSON.stringify({ ok: true, output: args.output, mode: result.mode, decision: result.decision }, null, 2));
}

function main() {
  const args = parseArgs(process.argv);
  if (args['migrate-file'] !== undefined || args.input) return migrateFile(args);
  const result = buildEvidence();
  if (args.json) {
    console.log(JSON.stringify(result, null, 2));
  } else {
    console.log('MSAA coverage auxiliary CLI (GUI is the primary entry)');
    console.log(JSON.stringify(result.checks, null, 2));
  }
  if (args.check !== false && !result.checks.ok) process.exitCode = 1;
}

if (require.main === module) main();

module.exports = { buildEvidence, sharedEdgeFixture };
