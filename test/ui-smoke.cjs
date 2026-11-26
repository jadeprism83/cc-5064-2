/* 可选的 UI 冒烟测试：需要 jsdom（npm install --no-save jsdom）。
 * 运行：node test/ui-smoke.cjs
 */
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const root = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');

const dom = new JSDOM(html, {
  url: 'http://localhost/',
  runScripts: 'outside-only',
  pretendToBeVisual: true,
});
const { window } = dom;

const errors = [];
window.addEventListener('error', (e) => errors.push(e.message));

function makeCtx() {
  return new Proxy({}, {
    get(t, prop) {
      if (prop === 'createImageData') return (w, h) => ({ data: new Uint8ClampedArray(w * h * 4), width: w, height: h });
      if (prop === 'getImageData') return (x, y, w, h) => ({ data: new Uint8ClampedArray(w * h * 4), width: w, height: h });
      if (prop === 'measureText') return () => ({ width: 10 });
      if (prop === 'canvas') return {};
      if (prop in t) return t[prop];
      return typeof prop === 'string' ? () => {} : undefined;
    },
    set(t, prop, value) { t[prop] = value; return true; },
  });
}

window.HTMLCanvasElement.prototype.getContext = function () { return makeCtx(); };
window.HTMLCanvasElement.prototype.getBoundingClientRect = function () {
  return { left: 0, top: 0, right: this.width, bottom: this.height, width: this.width, height: this.height, x: 0, y: 0 };
};
window.Element.prototype.setPointerCapture = () => {};
window.Element.prototype.releasePointerCapture = () => {};
window.Element.prototype.scrollIntoView = () => {};
if (!window.requestAnimationFrame) window.requestAnimationFrame = (cb) => setTimeout(cb, 0);
window.cancelAnimationFrame = (id) => clearTimeout(id);

// 按顺序执行经典脚本
for (const f of ['js/coverage-core.js', 'js/analytic.js', 'js/reference-data.js', 'js/app.js']) {
  const code = fs.readFileSync(path.join(root, f), 'utf8');
  try {
    window.eval(code);
  } catch (e) {
    console.error('脚本执行错误', f, e);
    process.exit(1);
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const $ = (id) => window.document.getElementById(id);

function assert(cond, msg) {
  if (!cond) { console.error('FAIL:', msg); process.exitCode = 1; }
  else console.log('ok -', msg);
}

(async () => {
  await sleep(400); // 等首帧 + 自动测试（120+30ms）
  assert(errors.length === 0, '页面无 window error' + (errors.length ? '：' + errors.join('; ') : ''));
  assert(/ready/.test($('kernelBadge').textContent), '内核徽标就绪：' + $('kernelBadge').textContent);
  assert(/全部通过/.test($('testSummary').textContent), '浏览器内参考比对全部通过：' + $('testSummary').textContent);
  const cards = [...window.document.querySelectorAll('.sc-card')];
  assert(cards.length >= 7, '渲染了场景卡片：' + cards.length);
  assert(cards.every((c) => c.classList.contains('ok')), '所有场景卡片为 ok');

  // 默认 4-grid 子样本模式：探针在共边点 -> 选中背景 #1
  assert(/#1/.test($('selectionInfo').textContent), '默认子样本拾取选中背景 #1：' + $('selectionInfo').textContent);
  assert(/按指针子样本/.test($('pickSubResult').textContent), '子样本卡片有内容');
  assert(/87\.5%|0\.875|87/.test($('pickAreaResult').textContent), '面积卡片显示前景 87.5%：' + $('pickAreaResult').textContent.replace(/\s+/g, ' '));

  // 切到面积模式 -> 选中前景 #2
  const areaBtn = window.document.querySelector('#pickModeSeg button[data-mode=area]');
  areaBtn.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
  await sleep(60);
  assert(areaBtn.classList.contains('active'), '面积模式按钮激活');
  assert(/#2/.test($('selectionInfo').textContent), '面积模式选中前景 #2：' + $('selectionInfo').textContent);

  // 切回子样本
  window.document.querySelector('#pickModeSeg button[data-mode=subsample]')
    .dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
  await sleep(60);
  assert(/#1/.test($('selectionInfo').textContent), '切回子样本重新选中 #1');

  // inclusive 规则 -> 实验室失败横幅
  const rule = $('ruleSelect');
  rule.value = 'inclusive';
  rule.dispatchEvent(new window.Event('change', { bubbles: true }));
  await sleep(80);
  assert(/fail/.test($('labBanner').className), 'inclusive 下实验室横幅为 fail');
  assert(/重复|不一致/.test($('labBanner').textContent), '横幅报告重复命中：' + $('labBanner').textContent.slice(0, 80));

  // 回到正确规则
  rule.value = 'top-left';
  rule.dispatchEvent(new window.Event('change', { bubbles: true }));
  await sleep(80);
  assert(/ok/.test($('labBanner').className), 'top-left 下横幅恢复 ok：' + $('labBanner').textContent.slice(0, 60));

  // 采样数 8x 按钮
  const b8 = [...window.document.querySelectorAll('#sampleCountButtons button')].find((b) => b.dataset.n === '8');
  b8.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
  await sleep(80);
  assert(b8.classList.contains('active'), '8x 按钮激活');
  assert(/8/.test($('aliasManyLabel').textContent), '锯齿标签更新为 8×：' + $('aliasManyLabel').textContent);
  assert(/mask=[01]+/.test($('msaaEvidence').textContent), 'MSAA 证据显示真实样本掩码：' + $('msaaEvidence').textContent);
  assert(/resolve=rgba\(/.test($('msaaEvidence').textContent), 'MSAA 证据显示解析颜色');
  assert(/pick=#\d+:\d+/.test($('msaaEvidence').textContent), 'MSAA 证据显示拾取缓冲样本');
  assert(/layout=v2:geometric-yx-v2/.test($('msaaEvidence').textContent), 'MSAA 证据标注几何布局 v2');
  assert(window.__msaaCoverageEvidence && Array.isArray(window.__msaaCoverageEvidence.resolvedRGBA),
    'window 暴露可执行的 MSAA 覆盖证据');

  const evidenceBeforePan = $('msaaEvidence').textContent;
  const panX = $('panX');
  panX.value = '0.35';
  panX.dispatchEvent(new window.Event('input', { bubbles: true }));
  await sleep(80);
  assert($('panXVal').textContent === '0.35', '边缘平移 X 控件更新：' + $('panXVal').textContent);
  assert(/mask=[01]+/.test($('msaaEvidence').textContent), '平移边缘后 MSAA 覆盖证据仍更新');
  assert($('msaaEvidence').textContent !== evidenceBeforePan, '平移边缘后样本掩码/解析/拾取证据发生变化');
  assert(/8× MSAA 解析/.test($('aliasManyLabel').textContent), '平移边缘后锯齿对比仍按当前采样数运算');
  $('panZeroBtn').dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
  await sleep(80);
  assert($('panXVal').textContent === '0.00', '平移归零恢复控件状态');

  const originalMsaaRaster = window.CoverageCore.rasterMultisampleCoverage;
  window.CoverageCore.rasterMultisampleCoverage = () => { throw new Error('注入 MSAA 异常'); };
  panX.value = '0.41';
  panX.dispatchEvent(new window.Event('input', { bubbles: true }));
  await sleep(80);
  assert(/注入 MSAA 异常/.test($('labBanner').textContent), 'MSAA 计算异常显示在多采样覆盖界面');
  assert(/MSAA evidence unavailable/.test($('msaaEvidence').textContent), 'MSAA 证据区同步提示异常');
  assert(window.__msaaCoverageError && /注入 MSAA 异常/.test(window.__msaaCoverageError.message),
    'MSAA 异常被记录到界面状态');
  window.CoverageCore.rasterMultisampleCoverage = originalMsaaRaster;
  $('panZeroBtn').dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
  await sleep(80);
  assert(/ok/.test($('labBanner').className), '移除故障后 MSAA 视窗可恢复正常');

  // 移开按钮
  $('moveAsideBtn').dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
  await sleep(80);
  assert(/移回/.test($('moveAsideBtn').textContent), '移开后按钮变移回：' + $('moveAsideBtn').textContent);
  $('moveAsideBtn').dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
  await sleep(40);

  // 翻转绕序不报错且徽标/统计仍在
  $('flipWindingBtn').dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
  await sleep(80);
  assert(/样本总数/.test($('countStats').textContent), '翻转绕序后计数图仍渲染');
  $('flipWindingBtn').dispatchEvent(new window.MouseEvent('click', { bubbles: true }));

  // 场景指针：在 overlay 上 pointerdown/up（空白处）放置探针
  const ov = $('overlayCanvas');
  function pointer(type, x, y) {
    const ev = new window.MouseEvent(type, { bubbles: true, clientX: x, clientY: y, pointerId: 1 });
    ov.dispatchEvent(ev);
  }
  pointer('pointerdown', 400, 260);
  pointer('pointerup', 400, 260);
  await sleep(80);
  assert(/400|260/.test($('probeCoords').textContent), '场景点击更新探针坐标：' + $('probeCoords').textContent);

  // 实验室切到参考场景
  const lp = $('labPresetSelect');
  lp.value = 'scenario:fan-grid';
  lp.dispatchEvent(new window.Event('change', { bubbles: true }));
  await sleep(80);
  assert(/fan-grid/.test($('labReadout').textContent), '实验室载入扇形参考用例');
  assert(/通过/.test($('labBanner').textContent), '扇形用例在调试视窗中通过参考比对');

  // 载入失败按钮默认隐藏（全部通过）
  assert($('loadFirstFailureBtn').hidden === true, '无失败时不显示失败载入按钮');

  assert(errors.length === 0, '全部交互后仍无 window error' + (errors.length ? '：' + errors.join('; ') : ''));
  console.log(process.exitCode ? '\nSMOKE FAILED' : '\nSMOKE PASSED');
})();
