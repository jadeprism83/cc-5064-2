/*
 * analytic.js
 *
 * 独立的高精度解析覆盖率参考（浏览器 / Node 通用）。
 * 使用 BigInt 精确分数，把三角形裁剪到整数像素矩形，再用鞋带公式求面积。
 * 与 coverage-core.js 的采样路径完全分开，用于交叉验证。
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.CoverageAnalytic = api;
})(typeof globalThis !== 'undefined' ? globalThis : typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  function gcd(a, b) {
    a = a < 0n ? -a : a;
    b = b < 0n ? -b : b;
    while (b) { const t = a % b; a = b; b = t; }
    return a || 1n;
  }

  function F(n, d = 1n) {
    if (typeof n === 'number') n = BigInt(n);
    if (typeof d === 'number') d = BigInt(d);
    if (d === 0n) throw new Error('zero denominator');
    if (d < 0n) { n = -n; d = -d; }
    const g = gcd(n, d);
    return { n: n / g, d: d / g };
  }

  const fadd = (a, b) => F(a.n * b.d + b.n * a.d, a.d * b.d);
  const fsub = (a, b) => F(a.n * b.d - b.n * a.d, a.d * b.d);
  const fmul = (a, b) => F(a.n * b.n, a.d * b.d);
  const fdiv = (a, b) => F(a.n * b.d, a.d * b.n);
  const fneg = (a) => F(-a.n, a.d);
  const fcmp = (a, b) => {
    const v = a.n * b.d - b.n * a.d;
    return v === 0n ? 0 : v < 0n ? -1 : 1;
  };
  const fnum = (a) => Number(a.n) / Number(a.d);

  function fromDecimal(v) {
    if (typeof v === 'number') {
      if (!Number.isFinite(v)) throw new Error('bad number');
      v = Object.is(v, -0) ? '0' : v.toString();
    }
    let s = String(v).trim();
    let neg = false;
    if (s[0] === '-') { neg = true; s = s.slice(1); }
    else if (s[0] === '+') s = s.slice(1);
    if (/[eE]/.test(s)) {
      // 交给 Number 展开（仅用于界面滑块产生的普通数值）
      return fromDecimal(Number(v).toFixed(12));
    }
    const dot = s.indexOf('.');
    const intPart = dot < 0 ? s : s.slice(0, dot);
    const frac = dot < 0 ? '' : s.slice(dot + 1);
    let n = BigInt((intPart || '0') + (frac || ''));
    let d = 10n ** BigInt(frac.length);
    if (neg) n = -n;
    return F(n, d);
  }

  const P = (x, y) => ({ x: fromDecimal(x), y: fromDecimal(y) });

  function clipPolygon(poly, halfplane) {
    // halfplane: {axis:'x'|'y', bound:F, keep:'ge'|'le'}
    const inside = (pt) => {
      const c = halfplane.axis === 'x' ? pt.x : pt.y;
      return halfplane.keep === 'ge' ? fcmp(c, halfplane.bound) >= 0 : fcmp(c, halfplane.bound) <= 0;
    };
    const intersect = (s, e) => {
      const cS = halfplane.axis === 'x' ? s.x : s.y;
      const cE = halfplane.axis === 'x' ? e.x : e.y;
      const t = fdiv(fsub(halfplane.bound, cS), fsub(cE, cS));
      const dx = fmul(t, fsub(e.x, s.x));
      const dy = fmul(t, fsub(e.y, s.y));
      return { x: fadd(s.x, dx), y: fadd(s.y, dy) };
    };

    const out = [];
    if (poly.length === 0) return out;
    let s = poly[poly.length - 1];
    let sIn = inside(s);
    for (const e of poly) {
      const eIn = inside(e);
      if (eIn) {
        if (!sIn) out.push(intersect(s, e));
        out.push(e);
      } else if (sIn) {
        out.push(intersect(s, e));
      }
      s = e;
      sIn = eIn;
    }
    return out;
  }

  function polygonArea2(poly) {
    let sum = F(0n);
    for (let i = 0; i < poly.length; i++) {
      const a = poly[i];
      const b = poly[(i + 1) % poly.length];
      sum = fadd(sum, fsub(fmul(a.x, b.y), fmul(b.x, a.y)));
    }
    return sum; // 二倍有向面积
  }

  // 三角形与整数像素矩形交集的精确面积（Fraction）。
  function trianglePixelAreaFraction(tri, px, py) {
    let poly = [P(tri[0].x, tri[0].y), P(tri[1].x, tri[1].y), P(tri[2].x, tri[2].y)];
    const x0 = F(BigInt(px));
    const y0 = F(BigInt(py));
    const x1 = F(BigInt(px + 1));
    const y1 = F(BigInt(py + 1));
    poly = clipPolygon(poly, { axis: 'x', bound: x0, keep: 'ge' });
    poly = clipPolygon(poly, { axis: 'x', bound: x1, keep: 'le' });
    poly = clipPolygon(poly, { axis: 'y', bound: y0, keep: 'ge' });
    poly = clipPolygon(poly, { axis: 'y', bound: y1, keep: 'le' });
    if (poly.length < 3) return F(0n);
    const a2 = polygonArea2(poly);
    const abs = fcmp(a2, F(0n)) < 0 ? fneg(a2) : a2;
    return F(abs.n, 2n * abs.d);
  }

  function trianglePixelArea(tri, px, py) {
    return fnum(trianglePixelAreaFraction(tri, px, py));
  }

  // 对象在像素内的解析覆盖面积（其内部三角形假定互不重叠）。
  function objectPixelArea(object, px, py) {
    let sum = F(0n);
    for (const tri of object.triangles) {
      sum = fadd(sum, trianglePixelAreaFraction(tri, px, py));
    }
    return fnum(sum);
  }

  return {
    F, fadd, fsub, fmul, fdiv, fcmp, fnum, fromDecimal,
    trianglePixelAreaFraction,
    trianglePixelArea,
    objectPixelArea,
  };
});
