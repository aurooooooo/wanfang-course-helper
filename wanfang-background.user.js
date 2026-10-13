// ==UserScript==
// @name         万方课程后台播放、倍速与自动下一节
// @namespace    local.wanfang.background
// @version      1.6.1
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
  let thresholdPercent = 95;
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
  const coursePatches = new Map();

  const host = document.createElement('div');
  host.id = 'wanfang-course-helper';
  host.style.cssText = 'position:fixed;right:16px;bottom:16px;z-index:2147483647;max-width:calc(100vw - 32px);';
  const panel = host.attachShadow({ mode: 'open' });
  panel.innerHTML = `
    <style>
      :host{font:13px/1.5 system-ui,-apple-system,"Segoe UI",sans-serif;color:#17251f;color-scheme:light}
      *{box-sizing:border-box}
      section{width:300px;max-width:calc(100vw - 32px);max-height:calc(100dvh - 32px);overflow:auto;background:#fff;border:1px solid #d5dfd9;border-radius:14px;box-shadow:0 8px 30px #17251f26}
      header{display:flex;justify-content:space-between;align-items:center;gap:8px;padding:15px 16px;border-bottom:1px solid #e3e9e5;cursor:move;touch-action:none;user-select:none}
      strong{font-size:15px;letter-spacing:.02em}
      #status{color:#146347;background:#e8f4ed;border:1px solid #c9e5d4;border-radius:20px;padding:3px 8px;font-size:11px;font-weight:600;white-space:nowrap}
      #status[data-stopped]{color:#76531c;background:#fcf3df;border-color:#ecd8ae}
      .body{padding:15px 16px 16px}.caption{font-size:11px;color:#52635a;margin:0 0 5px}
      #chapter{font-size:14px;font-weight:600;line-height:1.6;margin:0;overflow-wrap:anywhere;display:-webkit-box;-webkit-box-orient:vertical;-webkit-line-clamp:2;overflow:hidden}
      .metrics{display:flex;align-items:end;justify-content:space-between;gap:10px;margin:16px 0 7px}
      #progress-text{font-size:28px;font-weight:650;line-height:1.1;letter-spacing:-.03em;font-variant-numeric:tabular-nums}
      #detail{color:#43574c;font-size:12px;margin:0;text-align:right}
      progress{display:block;appearance:none;width:100%;height:5px;border:0;border-radius:8px;overflow:hidden;background:#e6ece8;accent-color:#146347}
      progress::-webkit-progress-bar{background:#e6ece8}progress::-webkit-progress-value{background:#146347}progress::-moz-progress-bar{background:#146347}
      select,input[type=number]{font:inherit;min-height:34px;border:1px solid #bbc9c0;border-radius:7px;background:#fff;color:#17251f;padding:5px 8px}
      select{width:84px;cursor:pointer}
      header:focus-visible,select:focus-visible,summary:focus-visible,input:focus-visible{outline:2px solid #146347;outline-offset:3px}
      details{border-top:1px solid #e3e9e5;padding:10px 16px}summary{cursor:pointer;color:#34483d;font-size:12px;font-weight:600}
      pre{max-height:160px;overflow:auto;white-space:pre-wrap;overflow-wrap:anywhere;font:11px/1.7 ui-monospace,monospace;color:#243c2e;background:#f1f5f2;padding:10px;border-radius:7px;margin:10px 0 0}
      .setting{display:flex;justify-content:space-between;align-items:center;gap:12px;margin:12px 0 0;cursor:pointer}.setting input[type=checkbox]{width:17px;height:17px;margin:0;accent-color:#146347;cursor:pointer}
      .percent-input{display:flex;align-items:center;gap:6px;color:#43574c}.percent-input input{width:68px}
      #threshold-error{color:#a32929}#threshold-error:empty{display:none}
      .hint{font-size:11px;color:#52635a;margin:7px 0 2px;line-height:1.6}
    </style>
    <section aria-label="课程脚本控制面板">
      <header id="drag-handle" tabindex="0" role="button" aria-label="移动课程助手面板，可拖动或用方向键移动" title="拖动移动 · 方向键微调"><strong>课程助手</strong><span id="status" role="status">● 运行中</span></header>
      <div class="body">
        <p class="caption">当前课程</p><p id="chapter">进入视频课程后自动识别</p>
        <div class="metrics"><div><p class="caption">播放进度</p><span id="progress-text">—</span></div><p id="detail">等待课程播放器</p></div>
        <progress id="progress-bar" max="100" value="0" aria-label="视频播放进度"></progress>
      </div>
      <details><summary>设置</summary>
        <label class="setting" for="speed"><span>播放倍速</span><select id="speed"></select></label>
        <label class="setting"><span>暂停时自动播放</span><input id="auto-play" type="checkbox"></label>
        <label class="setting"><span>自动跳转下一节</span><input id="auto-next" type="checkbox"></label>
        <label class="setting" for="threshold"><span>跳转进度</span><span class="percent-input"><input id="threshold" type="number" min="1" max="100" step="1" value="95" aria-describedby="threshold-hint threshold-error"><span>%</span></span></label>
        <p id="threshold-hint" class="hint">1–100%，达到后进入下一节。关闭自动跳转后不生效。</p>
        <p id="threshold-error" class="hint" role="alert"></p>
        <p class="hint">首次播放受限时，请手动播放一次。倍速不会增加累计观看时长。</p>
      </details>
      <details><summary id="log-label">日志（0）</summary><pre id="logs" aria-label="脚本运行日志"></pre></details>
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
    panel.getElementById('log-label').textContent = `日志（${logLines.length}）`;
  }
  function showDetail(message, title = '', video = null) {
    panel.getElementById('detail').textContent = message;
    const chapter = panel.getElementById('chapter');
    chapter.textContent = title || '进入视频课程后自动识别';
    chapter.title = title;
    const progress = video ? Math.max(0, Math.min(100, video.currentTime / video.duration * 100)) : null;
    panel.getElementById('progress-text').textContent = progress === null ? '—' : `${progress.toFixed(1)}%`;
    panel.getElementById('progress-bar').value = progress ?? 0;
  }
  function patchCourseTimer(root) {
    if (!root) return null;
    const video = root.querySelector('video');
    const queue = [], seen = new Set();
    for (let element = root; element; element = element.parentElement) {
      if (element.__vue__) queue.push(element.__vue__);
    }
    for (let index = 0; index < queue.length; index++) {
      const course = queue[index];
      if (seen.has(course)) continue;
      seen.add(course);
      if (!course._isDestroyed && course.$el?.contains(video || root) &&
          typeof course.toggleSection === 'function' &&
          typeof course.learnInterval === 'function' && typeof course.playerPlayCb === 'function') {
        if (coursePatches.has(course)) {
          const patch = coursePatches.get(course);
          return course.toggleSection === patch.wrapped ? patch : null;
        }
        const patch = {course, original: course.toggleSection, waiting: null};
        patch.wrapped = function (...args) {
          if (disposed) return patch.original.apply(this, args);
          const oldTimer = this.learnTimer;
          const oldVideo = this.$el.querySelector('video');
          const previous = {video: oldVideo, source: oldVideo?.currentSrc || oldVideo?.src,
            chapter: this.activeList?.listResourceCode};
          const result = patch.original.apply(this, args);
          if (this.contentType === 'video' && ((oldTimer && this.learnTimer === oldTimer) || patch.waiting)) {
            // The site's switch handler clears the interval but leaves its ID behind.
            // Resume through the site's play callback only after the new media plays.
            clearInterval(this.learnTimer);
            this.learnTimer = null;
            this.enterTime = null;
            patch.waiting = previous;
            log('info', '已清理章节切换后失效的学习计时器。');
          }
          return result;
        };
        course.toggleSection = patch.wrapped;
        coursePatches.set(course, patch);
        log('info', '已启用章节切换计时修复。');
        return patch;
      }
      queue.push(...(course.$children || []));
    }
    return null;
  }
  function resumeCourseTimer(patch, video) {
    if (!patch?.waiting || video.paused || video.ended || video.seeking || video.readyState < 2) return;
    const {course, waiting} = patch;
    if (waiting.chapter !== course.activeList?.listResourceCode && video === waiting.video &&
        (video.currentSrc || video.src) === waiting.source) return;
    try {
      if (!course.learnTimer) course.playerPlayCb();
      if (course.learnTimer) {
        patch.waiting = null;
        log('info', '当前章节的学习计时已启动。');
      }
    } catch (error) {
      patch.waiting = null;
      log('warn', '学习计时恢复失败，请刷新课件后再试。');
      window.wanfangAutoNextStop('学习计时异常，自动跳转已关闭。');
    }
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
  const autoNextCheckbox = panel.getElementById('auto-next');
  autoNextCheckbox.checked = running;
  autoNextCheckbox.addEventListener('change', () => {
    if (!autoNextCheckbox.checked) window.wanfangAutoNextStop();
    else {
      running = true;
      switchedKey = '';
      panel.getElementById('status').textContent = '● 运行中';
      panel.getElementById('status').removeAttribute('data-stopped');
      log('info', '已恢复自动切换。');
    }
  });
  const thresholdInput = panel.getElementById('threshold');
  thresholdInput.value = String(thresholdPercent);
  thresholdInput.addEventListener('change', () => {
    const value = Number(thresholdInput.value);
    if (!Number.isInteger(value) || value < 1 || value > 100) {
      thresholdInput.value = String(thresholdPercent);
      panel.getElementById('threshold-error').textContent = '请输入 1–100 的整数，已保留原设置。';
      return;
    }
    panel.getElementById('threshold-error').textContent = '';
    thresholdPercent = value;
    log('info', `跳转进度设置为 ${thresholdPercent}%。`);
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
  patchCourseTimer(document.querySelector('#rightBox'));

  const timer = setInterval(() => {
    const root = document.querySelector('#rightBox');
    const coursePatch = patchCourseTimer(root);
    const title = root?.querySelector('h1')?.textContent.trim() || '';
    if (title.includes('随堂测验')) {
      window.wanfangAutoNextStop('已进入测验。完成后可在设置中重新开启自动跳转。');
      showDetail('请手动完成测验', title);
      return;
    }
    if (pending && Date.now() - pending.at > 20000) {
      window.wanfangAutoNextStop('下一节加载超时，请检查课程后在设置中重新开启自动跳转。');
      return;
    }
    const video = root?.querySelector('video');
    if (!video || !Number.isFinite(video.duration) || video.duration <= 0) {
      showDetail('等待课程播放器', title);
      return;
    }
    applySpeed(video);
    resumeCourseTimer(coursePatch, video);
    showDetail(`${pending ? '切换中' : video.ended ? '已结束' : video.paused ? '已暂停' : '播放中'} · ${video.playbackRate}×`, title, video);
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
        video.currentTime / video.duration < thresholdPercent / 100) return;

    const next = root.querySelector('.progress-count .next');
    if (!next) {
      window.wanfangAutoNextStop('没有可用的下一节按钮，自动切换停止，当前视频可继续播放。');
      return;
    }
    if (!coursePatch) {
      log('warn', '未识别到课程计时组件，请刷新检查；为避免切换后停止计时，已关闭自动跳转。');
      window.wanfangAutoNextStop('课程计时组件未识别，自动跳转已关闭。');
      return;
    }
    switchedKey = key;
    pending = { title, video, source, at: Date.now() };
    log('info', `播放达到 ${thresholdPercent}%，切换到：${next.title || '下一节'}`);
    next.click();
  }, 1000);

  window.wanfangAutoNextStop = (reason = '已手动停止自动切换。') => {
    pending = null;
    if (!running) return;
    running = false;
    const status = panel.getElementById('status');
    status.textContent = '● 跳转关闭';
    status.setAttribute('data-stopped', '');
    autoNextCheckbox.checked = false;
    log('info', reason);
  };
  window.wanfangCourseHelperCleanup = () => {
    clearInterval(timer);
    disposed = true;
    pending = null;
    mountObserver.disconnect();
    for (const {course, original, wrapped} of coursePatches.values()) {
      if (course.toggleSection === wrapped) course.toggleSection = original;
    }
    coursePatches.clear();
    host.remove();
  };
  log('info', `课程助手已启动：${window.wanfangSpeed}×，播放达到 ${thresholdPercent}% 自动跳转；可在设置中调整。`);
  log('info', `暂停时自动播放：${window.wanfangAutoPlay ? '已开启' : '已关闭'}，可在设置中调整。`);
  log('warn', '倍速不会同步增加累计观看时长，提前切换可能无法满足时长要求。');
})();
