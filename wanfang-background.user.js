// ==UserScript==
// @name         万方课程后台播放、倍速与自动下一节
// @namespace    local.wanfang.background
// @version      1.4.1
// @author       aurooooooo
// @license      MIT
// @homepageURL  https://github.com/aurooooooo/wanfang-course-helper
// @supportURL   https://github.com/aurooooooo/wanfang-course-helper/issues
// @downloadURL  https://raw.githubusercontent.com/aurooooooo/wanfang-course-helper/main/wanfang-background.user.js
// @updateURL    https://raw.githubusercontent.com/aurooooooo/wanfang-course-helper/main/wanfang-background.user.js
// @description  培训站点悬浮面板、课程后台播放、倍速、可关闭的自动播放和自动切换
// @match        https://cx.wanfangdata.com.cn/e-training
// @match        https://cx.wanfangdata.com.cn/e-training/*
// @run-at       document-end
// @grant        none
// ==/UserScript==

// 可直接粘贴到课程页面控制台；临时运行时，刷新即可撤销。
(() => {
  if (location.hostname !== 'cx.wanfangdata.com.cn' ||
      !/^\/e-training(?:\/|$)/.test(location.pathname)) {
    console.warn('请在万方培训站点运行。');
    return;
  }
  try {
    Object.defineProperty(document, 'visibilityState', {
      configurable: true,
      get: () => 'visible',
    });
  } catch (error) {
    console.error('无法启用后台播放补丁。', error);
    return;
  }
  const threshold = 0.95;
  // 可在控制台输入 window.wanfangSpeed = 3（或4、1）改变倍速。
  window.wanfangSpeed ??= 1;
  window.wanfangAutoPlay ??= true;
  if (window.wanfangCourseHelperCleanup) window.wanfangCourseHelperCleanup();
  else window.wanfangAutoNextStop?.();
  document.getElementById('wanfang-course-helper')?.remove();
  let switchedKey = '';
  let pending = null;
  let rejectedSpeed = null;
  let running = true;
  let disposed = false;
  const playAttempts = new WeakMap();

  const host = document.createElement('div');
  host.id = 'wanfang-course-helper';
  host.style.cssText = 'position:fixed;right:16px;bottom:16px;z-index:2147483647;max-width:calc(100vw - 32px);';
  const panel = host.attachShadow({ mode: 'open' });
  panel.innerHTML = `
    <style>
      :host{font:13px/1.5 system-ui,sans-serif;color:#20302c}
      *{box-sizing:border-box}
      section{width:300px;max-width:calc(100vw - 32px);padding:14px;background:#fff;border:1px solid #cbd9d2;border-radius:12px;box-shadow:0 4px 22px #0002}
      header{display:flex;justify-content:space-between;align-items:center;gap:8px;cursor:move;touch-action:none;user-select:none}
      header:focus-visible{outline:2px solid #16724e;outline-offset:4px;border-radius:4px}
      strong{font-size:14px}#status{color:#16724e;font-size:12px}#status[data-stopped]{color:#8b571a}
      #detail{margin:9px 0;color:#53645c;overflow-wrap:anywhere;white-space:pre-line}
      .controls{display:flex;gap:8px;align-items:center;flex-wrap:wrap}
      select,button{font:inherit;min-height:32px;border:1px solid #cbd9d2;border-radius:6px;background:#fff;color:#20302c;padding:4px 8px}
      select:focus-visible,button:focus-visible,summary:focus-visible{outline:2px solid #16724e;outline-offset:2px}
      button{margin-left:auto;cursor:pointer}button:disabled{cursor:default;opacity:.5}
      details{margin-top:12px;border-top:1px solid #e5ebe7;padding-top:9px}summary{cursor:pointer;color:#16724e}
      pre{max-height:190px;overflow:auto;white-space:pre-wrap;overflow-wrap:anywhere;font:11px/1.6 ui-monospace,monospace;background:#f4f7f5;padding:8px;border-radius:6px;margin:8px 0 0}
      .setting{display:flex;align-items:center;gap:6px;margin-top:8px;cursor:pointer}.hint{font-size:12px;color:#53645c;margin:5px 0 0}
    </style>
    <section aria-label="课程脚本控制面板">
      <header id="drag-handle" tabindex="0" role="button" aria-label="移动课程助手面板，可拖动或用方向键移动" title="拖动标题栏移动；聚焦后可用方向键移动"><strong>课程助手</strong><span id="status" role="status">● 运行中</span></header>
      <p id="detail">等待课程播放器，进入视频课程后自动处理…</p>
      <div class="controls"><label for="speed">倍速</label><select id="speed"></select><button id="stop" type="button">停止自动切换</button></div>
      <details><summary>设置</summary><label class="setting"><input id="auto-play" type="checkbox">暂停时自动播放</label><p class="hint">默认开启；关闭后保留暂停状态。浏览器可能要求先手动播放一次。</p></details>
      <details><summary id="log-label">运行日志（0）</summary><pre id="logs" aria-label="脚本运行日志"></pre></details>
    </section>`;
  const speedSelect = panel.getElementById('speed');
  const speeds = [...new Set([1, 1.5, 2, 3, 4, 8, Number(window.wanfangSpeed)])];
  for (const speed of speeds.filter(value => Number.isFinite(value) && value > 0)) {
    const option = document.createElement('option');
    option.value = String(speed);
    option.textContent = `${speed}×`;
    speedSelect.append(option);
  }
  speedSelect.value = String(window.wanfangSpeed);
  const logLines = [];
  function log(level, message) {
    console[level](message);
    logLines.push(`[${new Date().toLocaleTimeString()}] ${level === 'warn' ? '提示：' : ''}${message}`);
    if (logLines.length > 60) logLines.shift();
    const logs = panel.getElementById('logs');
    logs.textContent = logLines.join('\n');
    logs.scrollTop = logs.scrollHeight;
    panel.getElementById('log-label').textContent = `运行日志（${logLines.length}）`;
  }
  function showDetail(message) {
    panel.getElementById('detail').textContent = message;
  }
  function tryAutoPlay(video) {
    if (!window.wanfangAutoPlay || !video?.paused || video.ended || video.readyState < 2) return;
    const source = video.currentSrc || video.src;
    let attempt = playAttempts.get(video);
    if (!attempt || attempt.source !== source) {
      attempt = {source, pending: false, retryAt: 0, warned: false};
      playAttempts.set(video, attempt);
    }
    if (attempt.pending || Date.now() < attempt.retryAt) return;
    attempt.pending = true;
    Promise.resolve().then(() => {
      if (disposed || !window.wanfangAutoPlay) return;
      return video.play();
    }).then(() => {
      if (disposed || !window.wanfangAutoPlay || video.paused) return;
      attempt.warned = false;
      attempt.retryAt = 0;
      log('info', '已自动恢复视频播放。');
    }).catch(() => {
      attempt.retryAt = Date.now() + 5000;
      if (!disposed && !attempt.warned) log('warn', '自动播放未成功，请先手动点击播放；脚本会间隔重试。');
      attempt.warned = true;
    }).finally(() => { attempt.pending = false; });
  }
  function applySpeed(video) {
    const speed = Number(window.wanfangSpeed);
    if (!video || !Number.isFinite(speed) || speed <= 0 ||
        video.playbackRate === speed || speed === rejectedSpeed) return;
    try {
      video.playbackRate = speed;
      rejectedSpeed = null;
      log('info', `已设置 ${video.playbackRate}× 倍速。`);
    } catch (error) {
      rejectedSpeed = speed;
      log('warn', `浏览器不接受 ${speed}× 倍速，请选择较低倍速。`);
    }
  }
  speedSelect.addEventListener('change', () => {
    window.wanfangSpeed = Number(speedSelect.value);
    rejectedSpeed = null;
    const video = document.querySelector('#rightBox video');
    applySpeed(video);
    log('info', `倍速设置为 ${window.wanfangSpeed}×${video ? '' : '，等待视频加载'}。`);
  });
  const autoPlayCheckbox = panel.getElementById('auto-play');
  autoPlayCheckbox.checked = Boolean(window.wanfangAutoPlay);
  autoPlayCheckbox.addEventListener('change', () => {
    window.wanfangAutoPlay = autoPlayCheckbox.checked;
    log('info', `暂停时自动播放：${window.wanfangAutoPlay ? '已开启' : '已关闭'}。`);
    if (window.wanfangAutoPlay && !pending) tryAutoPlay(document.querySelector('#rightBox video'));
  });
  panel.getElementById('stop').addEventListener('click', () => {
    if (running) window.wanfangAutoNextStop();
    else {
      running = true;
      switchedKey = '';
      panel.getElementById('status').textContent = '● 运行中';
      panel.getElementById('status').removeAttribute('data-stopped');
      panel.getElementById('stop').textContent = '停止自动切换';
      log('info', '已恢复自动切换。');
    }
  });
  const dragHandle = panel.getElementById('drag-handle');
  let drag = null;
  function movePanel(left, top) {
    const rect = host.getBoundingClientRect();
    host.style.left = `${Math.max(0, Math.min(left, window.innerWidth - rect.width))}px`;
    host.style.top = `${Math.max(0, Math.min(top, window.innerHeight - rect.height))}px`;
    host.style.right = 'auto';
    host.style.bottom = 'auto';
  }
  dragHandle.addEventListener('pointerdown', event => {
    if (event.button !== 0) return;
    const rect = host.getBoundingClientRect();
    drag = {id: event.pointerId, x: event.clientX, y: event.clientY, left: rect.left, top: rect.top};
    dragHandle.setPointerCapture(event.pointerId);
    event.preventDefault();
  });
  dragHandle.addEventListener('pointermove', event => {
    if (!drag || drag.id !== event.pointerId) return;
    movePanel(drag.left + event.clientX - drag.x, drag.top + event.clientY - drag.y);
  });
  dragHandle.addEventListener('lostpointercapture', () => { drag = null; });
  dragHandle.addEventListener('keydown', event => {
    const steps = {ArrowLeft: [-10, 0], ArrowRight: [10, 0], ArrowUp: [0, -10], ArrowDown: [0, 10]};
    if (!steps[event.key]) return;
    const rect = host.getBoundingClientRect();
    movePanel(rect.left + steps[event.key][0], rect.top + steps[event.key][1]);
    event.preventDefault();
  });
  function mountPanel() {
    const parent = document.body || document.documentElement;
    if (!disposed && parent && !host.isConnected) parent.append(host);
  }
  const mountObserver = new MutationObserver(mountPanel);
  mountObserver.observe(document.documentElement, {childList: true, subtree: true});
  mountPanel();

  const timer = setInterval(() => {
    const root = document.querySelector('#rightBox');
    const title = root?.querySelector('h1')?.textContent.trim() || '';
    if (title.includes('随堂测验')) {
      window.wanfangAutoNextStop('已进入测验，自动切换停止。完成后请重新运行脚本。');
      showDetail('当前是测验，请手动完成。');
      return;
    }
    if (pending && Date.now() - pending.at > 20000) {
      window.wanfangAutoNextStop('下一节未在20秒内加载，请手动检查并重新运行脚本。');
      return;
    }
    const video = root?.querySelector('video');
    if (!video || !Number.isFinite(video.duration) || video.duration <= 0) {
      showDetail('等待课程播放器，进入视频课程后自动处理…');
      return;
    }
    applySpeed(video);
    const progress = Math.min(100, video.currentTime / video.duration * 100).toFixed(1);
    showDetail(`${pending ? '正在切换下一节' : video.paused ? '视频已暂停' : '正在播放'} · ${video.playbackRate}× · ${progress}%\n${title}`);
    const source = video.currentSrc || video.src;
    const key = `${location.href}|${title}|${source}`;

    if (pending) {
      // 等待新视频加载，避免标题已切换但视频仍是上一节时连续跳过。
      if (title === pending.title ||
          (video === pending.video && source === pending.source) ||
          video.readyState < 2) return;
      pending = null;
      tryAutoPlay(video);
      log('info', `下一节已加载：${title}`);
      return;
    }
    tryAutoPlay(video);
    if (!running) return;
    if (key === switchedKey || video.seeking ||
        (video.paused && !video.ended) ||
        video.currentTime / video.duration < threshold) return;

    const next = root.querySelector('.progress-count .next');
    if (!next) {
      window.wanfangAutoNextStop('没有可用的下一节按钮，自动切换停止，当前视频可继续播放。');
      return;
    }
    switchedKey = key;
    pending = { title, video, source, at: Date.now() };
    log('info', `播放达到95%，切换到：${next.title || '下一节'}`);
    next.click();
  }, 1000);

  window.wanfangAutoNextStop = (reason = '已手动停止自动切换。') => {
    pending = null;
    if (!running) return;
    running = false;
    const status = panel.getElementById('status');
    status.textContent = '● 运行中 · 切换关闭';
    status.setAttribute('data-stopped', '');
    panel.getElementById('stop').textContent = '恢复自动切换';
    log('info', reason);
  };
  window.wanfangCourseHelperCleanup = () => {
    clearInterval(timer);
    disposed = true;
    pending = null;
    mountObserver.disconnect();
    host.remove();
  };
  log('info', '课程助手已启动：后台播放、倍速调节和95%自动下一节；拖动标题栏可移动面板。');
  log('info', `暂停时自动播放：${window.wanfangAutoPlay ? '已开启' : '已关闭'}，可在设置中调整。`);
  log('warn', '倍速不会同步增加累计观看时长，提前切换可能无法满足时长要求。');
})();
