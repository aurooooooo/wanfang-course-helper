const assert = require('node:assert/strict');
const fs = require('node:fs'), vm = require('node:vm'), path = require('node:path');
const source = fs.readFileSync(path.join(__dirname, 'wanfang-background.user.js'), 'utf8');
const flush = () => new Promise(resolve => setImmediate(resolve));
function setup(pathname = '/e-training/quality/courselearn', storage = new Map()) {
  const state = {title: '1.1 video one', chapter: 'one', contentType: 'video', learnedSeconds: 0,
    learnDuration: 20, taskDuration: 100, taskDurationText: '00:01:40',
    records: [], reloads: [], clicks: 0, plays: 0, now: 0, logs: [], next: true, rootPresent: true};
  const timers = new Map(), learningTimers = new Map(); let id = 0;
  const video = {duration: 100, currentTime: 35, currentSrc: 'one', readyState: 4,
    paused: false, ended: false, seeking: false, playbackRate: 1,
    play() {
      state.plays++;
      if (state.playError) return Promise.reject(Error('blocked'));
      this.paused = false;
      return Promise.resolve();
    }};
  state.video = video;
  const hosts = [], observers = [];
  class Element {
    constructor() {this.style = {}; this.children = []; this.events = {}; this.nodes = {};}
    append(element) {this.children.push(element);}
    attachShadow() {this.shadow = new Element(); return this.shadow;}
    getElementById(id) {return this.nodes[id] ??= new Element();}
    addEventListener(name, fn) {this.events[name] = fn;}
    setAttribute(name, value) {this[name] = value;}
    removeAttribute(name) {delete this[name];}
    setPointerCapture(id) {this.captureId = id;}
    get isConnected() {return hosts.includes(this);}
    getBoundingClientRect() {return {left: parseFloat(this.style.left ?? 708), top: parseFloat(this.style.top ?? 472), width: 300, height: 280};}
    remove() {const index = hosts.indexOf(this); if (index >= 0) hosts.splice(index, 1);}
  }
  const root = {contains: node => node === state.video || node === root, querySelector(selector) {
    if (selector === 'h1') return {textContent: state.title};
    if (selector === 'video') return state.video;
    if (selector === '.progress-count .next' && state.next)
      return {title: 'video two', click() {state.clicks++;}};
    return null;
  }};
  const document = Object.create({visibilityState: 'hidden'});
  document.querySelector = selector => !state.rootPresent ? null : selector === '#rightBox' ? root : selector === '#rightBox video' ? state.video : null;
  document.getElementById = id => hosts.find(host => host.id === id);
  document.createElement = () => new Element();
  document.documentElement = {append: host => hosts.push(host)};
  document.body = document.documentElement;
  const window = {innerWidth: 1024, innerHeight: 768};
  const context = vm.createContext({window, document,
    URL,
    sessionStorage: {getItem: key => storage.get(key) ?? null, setItem: (key, value) => storage.set(key, value),
      removeItem: key => storage.delete(key)},
    location: {hostname: 'cx.wanfangdata.com.cn', pathname,
      href: `https://cx.wanfangdata.com.cn${pathname}?courseId=test`,
      reload() {state.reloads.push(this.href);}, replace(url) {state.reloads.push(url);}},
    Date: class extends Date {
      constructor(...args) {super(...(args.length ? args : [state.now]));}
      static now() {return state.now;}
    },
    setInterval(fn, delay) {(delay === 60000 ? learningTimers : timers).set(++id, fn); return id;},
    clearInterval(key) {timers.delete(key); learningTimers.delete(key);},
    MutationObserver: class {
      constructor(callback) {this.callback = callback; this.active = false; observers.push(this);}
      observe() {this.active = true;}
      disconnect() {this.active = false;}
    },
    console: Object.fromEntries(['info', 'warn', 'error'].map(k => [k, (...v) => state.logs.push(v)]))});
  const course = {
    $el: root, learnTimer: null, enterTime: null,
    get activeList() {return {listResourceCode: state.chapter, courseListId: `list-${state.chapter}`,
      courseWareId: `ware-${state.chapter}`, durationSec: state.taskDuration, duration: state.taskDurationText,
      isLearned: {learnDuration: state.learnDuration}};},
    get contentType() {return state.contentType;},
    insertrecord() {state.records.push({chapter: state.chapter, start: this.enterTime?.getTime() ?? null, end: state.now});},
    updateProgress() {if (this.enterTime) {
      const elapsed = (state.now - this.enterTime.getTime()) / 1000;
      state.learnedSeconds += elapsed; state.learnDuration += elapsed;
    }},
    learnInterval() {
      if (this.learnTimer) return;
      this.learnTimer = context.setInterval(() => {
        this.insertrecord(); this.updateProgress(); this.enterTime = new context.Date();
      }, 60000);
    },
    playerPlayCb() {this.enterTime = new context.Date(); this.learnInterval();},
    playerPauseCb() {
      context.clearInterval(this.learnTimer); this.learnTimer = null;
      this.insertrecord(); this.updateProgress();
    },
    toggleSection(chapter) {
      // Deliberately reproduce the site's cleared interval with a retained ID.
      context.clearInterval(this.learnTimer); this.insertrecord(); this.learnInterval();
      state.chapter = chapter; state.learnDuration = 0;
      return 'switched';
    },
  };
  root.__vue__ = course;
  return {state, video, document, window, timers, learningTimers, course, root, hosts, observers, context, storage,
    learningTick: () => [...learningTimers.values()].forEach(fn => fn()),
    control: id => hosts[0].shadow.getElementById(id),
    run: () => vm.runInContext(source, context),
    tick: async () => { [...timers.values()].forEach(fn => fn()); await flush(); }};
}
async function main() {
  const e = setup(); e.video.paused = true; e.run(); await e.tick();
  assert.equal(e.document.visibilityState, 'visible');
  assert.equal(e.state.plays, 1); assert.equal(e.video.playbackRate, 1);
  assert.equal(e.control('chapter').textContent, e.state.title);
  assert.equal(e.control('progress-text').textContent, '20.0%');
  assert.equal(e.control('progress-bar').value, 20);
  assert.equal(e.control('task-time').textContent, '累计观看 00:20 / 01:40');
  e.video.paused = true; await e.tick(); assert.equal(e.state.plays, 2);
  const checkbox = e.control('auto-play'); checkbox.checked = false; checkbox.events.change();
  e.video.paused = true; e.video.currentTime = 95; await e.tick();
  assert.equal(e.state.plays, 2); assert.equal(e.state.clicks, 0);
  checkbox.checked = true; checkbox.events.change(); await flush();
  assert.equal(e.state.plays, 3);
  await e.tick(); await e.tick(); assert.equal(e.state.clicks, 1);
  e.video.paused = true; e.state.title = '1.2 video two'; await e.tick();
  assert.equal(e.state.clicks, 1); assert.equal(e.state.plays, 3); // New title but stale video: do not replay or skip.
  e.video.currentSrc = 'two'; e.video.currentTime = 0; await e.tick();
  assert.equal(e.state.plays, 4);
  const select = e.control('speed'); select.value = '4'; select.events.change();
  assert.equal(e.window.wanfangSpeed, 4); assert.equal(e.video.playbackRate, 4);
  e.control('auto-next').checked = false; e.control('auto-next').events.change();
  assert.equal(e.timers.size, 1); assert.equal(e.control('auto-next').checked, false);
  assert.equal(e.control('status').textContent, '● 跳转关闭');
  e.video.paused = true; await e.tick(); assert.equal(e.state.plays, 5); // Stop-next leaves autoplay enabled.
  e.video.currentTime = 96; await e.tick(); assert.equal(e.state.clicks, 1);
  e.control('auto-next').checked = true; e.control('auto-next').events.change(); await e.tick(); assert.equal(e.state.clicks, 2);
  assert.equal(e.control('status').textContent, '● 运行中');
  e.run(); assert.equal(e.timers.size, 1); assert.equal(e.hosts.length, 1);
  assert.equal(e.window.wanfangSpeed, 4);
  e.video.currentTime = 0;
  for (let i = 0; i < 80; i++) {e.window.wanfangSpeed = i % 2 ? 2 : 3; await e.tick();}
  assert.equal(e.control('logs').textContent.split('\n').length, 60);

  const handle = e.control('drag-handle'), host = e.hosts[0];
  handle.events.pointerdown({button: 0, pointerId: 7, clientX: 728, clientY: 492, preventDefault() {}});
  handle.events.pointermove({pointerId: 8, clientX: 2000, clientY: 2000}); assert.equal(host.style.left, undefined);
  handle.events.pointermove({pointerId: 7, clientX: 2000, clientY: 2000});
  assert.equal(host.style.left, '724px'); assert.equal(host.style.top, '488px');
  handle.events.lostpointercapture();
  handle.events.pointermove({pointerId: 7, clientX: -900, clientY: -900}); assert.equal(host.style.left, '724px');
  handle.events.pointerdown({button: 0, pointerId: 9, clientX: 724, clientY: 488, preventDefault() {}});
  handle.events.pointermove({pointerId: 9, clientX: -900, clientY: -900});
  assert.equal(host.style.left, '0px'); assert.equal(host.style.top, '0px');
  handle.events.lostpointercapture(); handle.events.keydown({key: 'ArrowRight', preventDefault() {}});
  assert.equal(host.style.left, '10px');
  host.remove(); assert.equal(e.hosts.length, 0);
  e.observers.find(observer => observer.active).callback();
  assert.equal(e.hosts.length, 1); assert.equal(e.hosts[0], host); // Reattach after app redraw.

  e.state.title = '随堂测验'; const clicks = e.state.clicks; await e.tick();
  assert.equal(e.control('auto-next').checked, false); assert.equal(e.state.clicks, clicks);
  const last = setup(); last.run(); last.state.next = false; last.video.currentTime = 100;
  last.video.ended = true; last.video.paused = true; await last.tick(); await last.tick();
  assert.equal(last.state.plays, 0); assert.equal(last.control('auto-next').checked, false);
  const timeout = setup(); timeout.run(); timeout.video.currentTime = 95; await timeout.tick();
  timeout.state.now = 20001; await timeout.tick(); assert.equal(timeout.control('auto-next').checked, false);
  assert.equal(timeout.state.clicks, 1);
  const custom = setup(); custom.run();
  const threshold = custom.control('threshold');
  assert.equal(threshold.value, '95');
  for (const value of ['', '0', '101', '50.5', 'abc']) {
    threshold.value = value; threshold.events.change();
    assert.equal(threshold.value, '95');
    assert.ok(custom.control('threshold-error').textContent.includes('保留原设置'));
  }
  threshold.value = '80'; threshold.events.change();
  assert.equal(custom.control('threshold-error').textContent, '');
  custom.video.currentTime = 79.9; await custom.tick(); assert.equal(custom.state.clicks, 0);
  custom.video.currentTime = 80; await custom.tick(); await custom.tick(); assert.equal(custom.state.clicks, 1);
  assert.ok(custom.state.logs.some(v => String(v[0]).includes('播放达到 80%')));
  custom.state.title = 'video two'; custom.video.currentSrc = 'two'; custom.video.currentTime = 0;
  await custom.tick(); custom.video.currentTime = 80; await custom.tick(); assert.equal(custom.state.clicks, 2);
  const full = setup(); full.run(); full.control('threshold').value = '100'; full.control('threshold').events.change();
  full.video.currentTime = 99.9; await full.tick(); assert.equal(full.state.clicks, 0);
  full.video.currentTime = 100; full.video.paused = true; full.video.ended = true;
  await full.tick(); assert.equal(full.state.clicks, 1); assert.equal(full.state.plays, 0);
  const off = setup(); off.run(); off.control('auto-next').checked = false; off.control('auto-next').events.change();
  off.control('threshold').value = '1'; off.control('threshold').events.change();
  off.video.currentTime = 100; await off.tick(); assert.equal(off.state.clicks, 0);
  off.control('auto-next').checked = true; off.control('auto-next').events.change();
  await off.tick(); assert.equal(off.state.clicks, 1);
  const raised = setup(); raised.run(); raised.video.currentTime = 96;
  raised.control('threshold').value = '100'; raised.control('threshold').events.change();
  await raised.tick(); assert.equal(raised.state.clicks, 0);
  raised.control('threshold').value = '90'; raised.control('threshold').events.change();
  await raised.tick(); assert.equal(raised.state.clicks, 1);
  const invalid = setup(); invalid.run(); invalid.video.duration = NaN; invalid.video.paused = true; await invalid.tick();
  assert.equal(invalid.state.clicks, 0); assert.equal(invalid.state.plays, 0);
  assert.equal(invalid.control('progress-text').textContent, '—');
  assert.equal(invalid.control('progress-bar').value, 0);
  const blocked = setup(); blocked.run(); blocked.video.paused = true; blocked.state.playError = true;
  await blocked.tick(); await blocked.tick(); assert.equal(blocked.state.plays, 1);
  blocked.state.now = 4999; await blocked.tick(); assert.equal(blocked.state.plays, 1);
  blocked.state.now = 5000; await blocked.tick(); assert.equal(blocked.state.plays, 2);
  assert.equal(blocked.state.logs.filter(v => String(v[0]).includes('自动播放未成功')).length, 1);
  blocked.state.playError = false; blocked.state.now = 10000; await blocked.tick();
  assert.equal(blocked.video.paused, false);
  const badSpeed = setup(); badSpeed.run(); badSpeed.window.wanfangSpeed = 99;
  Object.defineProperty(badSpeed.video, 'playbackRate', {get: () => 1, set() {throw Error('unsupported');}});
  await badSpeed.tick(); await badSpeed.tick();
  assert.equal(badSpeed.state.logs.filter(v => String(v[0]).includes('99')).length, 1);
  const native = setup(); native.course.playerPlayCb();
  const originalToggle = native.course.toggleSection;
  native.run(); native.state.now = 60000; native.learningTick();
  assert.equal(native.state.records.length, 1); assert.equal(native.state.learnedSeconds, 60);
  native.state.now = 95000;
  assert.equal(native.course.toggleSection('two'), 'switched');
  assert.equal(native.course.learnTimer, null); assert.equal(native.course.enterTime, null);
  assert.equal(native.learningTimers.size, 0);
  await native.tick(); // New chapter, but still the old media: do not start counting.
  assert.equal(native.learningTimers.size, 0);
  native.video.currentSrc = 'two'; native.video.currentTime = 0; native.video.paused = true;
  native.state.title = 'video two'; native.state.now = 100000;
  await native.tick(); await native.tick();
  assert.equal(native.learningTimers.size, 1); assert.equal(native.course.enterTime.getTime(), 100000);
  assert.equal(native.state.records.length, 2); // No synthetic record during recovery.
  native.state.now = 160000; native.learningTick();
  assert.deepEqual(native.state.records.at(-1), {chapter: 'two', start: 100000, end: 160000});
  assert.equal(native.state.learnedSeconds, 120); // Loading time was not added.
  native.course.toggleSection('three'); native.video.currentSrc = 'three';
  native.state.title = 'video three'; await native.tick();
  assert.equal(native.learningTimers.size, 1);
  native.run(); assert.equal(native.learningTimers.size, 1); // Re-execution cannot duplicate native timers.
  native.window.wanfangCourseHelperCleanup();
  assert.equal(native.course.toggleSection, originalToggle); assert.equal(native.learningTimers.size, 1);
  const paused = setup(); paused.course.playerPlayCb(); paused.run();
  paused.control('auto-play').checked = false; paused.control('auto-play').events.change();
  paused.course.toggleSection('two'); paused.video.currentSrc = 'two'; paused.video.paused = true;
  paused.state.now = 120000; await paused.tick(); await paused.tick();
  assert.equal(paused.learningTimers.size, 0); assert.equal(paused.state.learnedSeconds, 0);
  paused.video.paused = false; paused.course.playerPlayCb(); await paused.tick();
  assert.equal(paused.learningTimers.size, 1); assert.equal(paused.course.enterTime.getTime(), 120000);
  const rapid = setup(); rapid.course.playerPlayCb(); rapid.run();
  rapid.control('auto-play').checked = false; rapid.control('auto-play').events.change();
  rapid.course.toggleSection('two'); rapid.video.currentSrc = 'two'; rapid.video.paused = true;
  rapid.course.toggleSection('three'); rapid.video.currentSrc = 'three'; rapid.state.now = 180000;
  await rapid.tick(); assert.equal(rapid.learningTimers.size, 0); assert.equal(rapid.course.enterTime, null);
  rapid.video.paused = false; await rapid.tick();
  assert.equal(rapid.learningTimers.size, 1); assert.equal(rapid.course.enterTime.getTime(), 180000);
  const healthy = setup(); healthy.course.playerPlayCb();
  healthy.course.toggleSection = function (chapter) {
    this.playerPauseCb(); healthy.state.chapter = chapter; healthy.video.currentSrc = chapter; this.playerPlayCb();
  };
  healthy.run(); healthy.course.toggleSection('two');
  const healthyTimer = healthy.course.learnTimer;
  await healthy.tick(); assert.equal(healthy.course.learnTimer, healthyTimer); assert.equal(healthy.learningTimers.size, 1);
  const automatic = setup(); automatic.course.playerPlayCb(); automatic.run();
  automatic.root.querySelector = selector => selector === 'h1' ? {textContent: automatic.state.title}
    : selector === 'video' ? automatic.video : selector === '.progress-count .next' ? {title: 'two', click() {
      automatic.state.clicks++; automatic.course.toggleSection('two'); automatic.state.title = 'video two';
      automatic.video.currentSrc = 'two'; automatic.video.currentTime = 0; automatic.video.paused = true;
    }} : null;
  automatic.video.currentTime = 95; await automatic.tick(); await automatic.tick(); await automatic.tick();
  await automatic.tick(); assert.equal(automatic.state.clicks, 1); assert.equal(automatic.learningTimers.size, 1);
  const unavailable = setup(); delete unavailable.root.__vue__; unavailable.run(); unavailable.video.currentTime = 95;
  await unavailable.tick(); assert.equal(unavailable.state.clicks, 0); assert.equal(unavailable.control('auto-next').checked, false);
  const broken = setup(); broken.course.playerPlayCb(); broken.run(); broken.course.toggleSection('two');
  broken.video.currentSrc = 'two'; broken.course.playerPlayCb = () => {throw Error('native callback failed');};
  await broken.tick(); await broken.tick(); assert.equal(broken.control('auto-next').checked, false);
  assert.equal(broken.learningTimers.size, 0);
  const nested = setup(); nested.root.__vue__ = {$children: [nested.course]};
  const nestedOriginal = nested.course.toggleSection; nested.run();
  assert.notEqual(nested.course.toggleSection, nestedOriginal);
  const ancestor = setup(); delete ancestor.root.__vue__; ancestor.root.parentElement = {__vue__: ancestor.course};
  const ancestorOriginal = ancestor.course.toggleSection; ancestor.run();
  assert.notEqual(ancestor.course.toggleSection, ancestorOriginal);
  const replaced = setup(); replaced.run(); const otherHandler = () => {};
  replaced.course.toggleSection = otherHandler; replaced.video.currentTime = 95;
  await replaced.tick(); assert.equal(replaced.state.clicks, 0);
  replaced.window.wanfangCourseHelperCleanup(); assert.equal(replaced.course.toggleSection, otherHandler);
  function progressFixture() {
    const fixture = setup(); fixture.video.duration = 1000; fixture.state.taskDuration = 1000;
    fixture.state.taskDurationText = '00:16:40'; fixture.run(); return fixture;
  }
  const stall = progressFixture(); await stall.tick();
  stall.control('speed').value = '3'; stall.control('speed').events.change();
  stall.control('auto-play').checked = false; stall.control('auto-play').events.change();
  stall.control('auto-next').checked = false; stall.control('auto-next').events.change();
  stall.control('threshold').value = '80'; stall.control('threshold').events.change();
  stall.state.now = 119999; await stall.tick(); assert.equal(stall.state.reloads.length, 0);
  stall.state.now = 120000; await stall.tick(); assert.equal(stall.state.reloads.length, 1);
  assert.equal(new URL(stall.state.reloads[0]).searchParams.get('courseWareId'), 'list-one');
  assert.equal(new URL(stall.state.reloads[0]).searchParams.get('courseId'), 'test');
  stall.state.now = 240000; await stall.tick(); assert.equal(stall.state.reloads.length, 1);
  const restored = setup('/e-training/quality/courselearn', stall.storage);
  restored.context.location.href = stall.state.reloads[0]; restored.state.now = 120000;
  restored.video.duration = 1000; restored.state.taskDuration = 1000; restored.run(); await restored.tick();
  assert.equal(restored.window.wanfangSpeed, 3); assert.equal(restored.window.wanfangAutoPlay, false);
  assert.equal(restored.control('auto-next').checked, false); assert.equal(restored.control('threshold').value, '80');
  assert.equal(restored.control('status').textContent, '● 跳转关闭'); assert.equal(restored.storage.size, 0);
  restored.state.now = 240000; await restored.tick();
  assert.equal(restored.state.reloads.length, 0); assert.equal(restored.control('auto-refresh').checked, false);
  const healthyProgress = progressFixture(); await healthyProgress.tick();
  for (const time of [60000, 120000, 180000, 240000]) {
    healthyProgress.state.now = time; healthyProgress.state.learnDuration += 60; await healthyProgress.tick();
  }
  assert.equal(healthyProgress.state.reloads.length, 0);
  const rounded = progressFixture(); rounded.state.taskDuration = 1000000; await rounded.tick();
  assert.equal(rounded.control('progress-text').textContent, '0.0%');
  rounded.state.now = 60000; rounded.state.learnDuration += 1; await rounded.tick();
  assert.equal(rounded.control('progress-text').textContent, '0.0%');
  rounded.state.now = 120000; await rounded.tick(); assert.equal(rounded.state.reloads.length, 0);
  rounded.state.now = 180000; await rounded.tick(); assert.equal(rounded.state.reloads.length, 1);
  for (const mode of ['paused', 'loading', 'seeking', 'ended', 'disabled', 'complete', 'unknown', 'quiz']) {
    const fixture = progressFixture(); await fixture.tick();
    if (mode === 'paused') {fixture.window.wanfangAutoPlay = false; fixture.video.paused = true;}
    if (mode === 'loading') fixture.video.readyState = 2;
    if (mode === 'seeking') fixture.video.seeking = true;
    if (mode === 'ended') fixture.video.ended = true;
    if (mode === 'disabled') {fixture.control('auto-refresh').checked = false; fixture.control('auto-refresh').events.change();}
    if (mode === 'complete') fixture.state.learnDuration = fixture.state.taskDuration;
    if (mode === 'unknown') fixture.state.learnDuration = null;
    if (mode === 'quiz') fixture.state.title = '随堂测验';
    fixture.state.now = 120000; await fixture.tick(); fixture.state.now = 240000; await fixture.tick();
    assert.equal(fixture.state.reloads.length, 0, mode);
  }
  const interrupted = progressFixture(); interrupted.window.wanfangAutoPlay = false; await interrupted.tick();
  interrupted.state.now = 60000; interrupted.video.paused = true; await interrupted.tick();
  interrupted.state.now = 180000; interrupted.video.paused = false; await interrupted.tick();
  interrupted.state.now = 299999; await interrupted.tick(); assert.equal(interrupted.state.reloads.length, 0);
  interrupted.state.now = 300000; await interrupted.tick(); assert.equal(interrupted.state.reloads.length, 1);
  const changedTask = progressFixture(); await changedTask.tick();
  changedTask.state.now = 119999; changedTask.state.chapter = 'two'; changedTask.state.learnDuration = 0;
  changedTask.video.currentSrc = 'two'; await changedTask.tick();
  changedTask.state.now = 239998; await changedTask.tick(); assert.equal(changedTask.state.reloads.length, 0);
  changedTask.state.now = 239999; await changedTask.tick(); assert.equal(changedTask.state.reloads.length, 1);
  const timedText = progressFixture(); timedText.state.taskDuration = undefined;
  timedText.state.taskDurationText = '01:00:00'; timedText.state.learnDuration = 900; await timedText.tick();
  assert.equal(timedText.control('progress-text').textContent, '25.0%');
  assert.equal(timedText.control('task-time').textContent, '累计观看 15:00 / 1:00:00');
  timedText.state.taskDurationText = 'bad'; await timedText.tick(); assert.equal(timedText.control('progress-text').textContent, '—');
  const blockedStorage = progressFixture(); blockedStorage.context.sessionStorage.setItem = () => {throw Error('storage blocked');};
  await blockedStorage.tick(); blockedStorage.state.now = 120000; await blockedStorage.tick();
  assert.equal(blockedStorage.state.reloads.length, 0); assert.equal(blockedStorage.window.wanfangAutoRefresh, false);
  const legacyId = progressFixture();
  Object.defineProperty(legacyId.course, 'activeList', {get() {return {listResourceCode: 'one', courseWareId: 'ware-one',
    durationSec: 1000, isLearned: {learnDuration: 20}};}});
  await legacyId.tick(); legacyId.state.now = 120000; await legacyId.tick();
  assert.equal(new URL(legacyId.state.reloads[0]).searchParams.get('courseListId'), 'ware-one');
  assert.equal(new URL(legacyId.state.reloads[0]).searchParams.has('courseWareId'), false);
  const malformed = setup(); malformed.storage.set('wanfang-course-helper:auto-refresh', '{bad json');
  malformed.run(); await malformed.tick(); assert.equal(malformed.window.wanfangSpeed, 1);
  for (const route of ['/e-training', '/e-training/', '/e-training/lecture/courselearn', '/e-training/quality/courselearn', '/e-training/activity']) {
    const page = setup(route); page.state.rootPresent = false; page.run(); await page.tick();
    assert.equal(page.hosts.length, 1, route); assert.equal(page.state.plays, 0);
    assert.ok(page.control('detail').textContent.includes('等待课程播放器'));
    page.window.wanfangCourseHelperCleanup(); assert.equal(page.timers.size, 0); assert.equal(page.hosts.length, 0);
    assert.equal(page.observers.some(observer => observer.active), false);
    page.observers[0].callback(); assert.equal(page.hosts.length, 0); // Cleanup cannot resurrect the panel.
  }
  const lecture = setup('/e-training/lecture/courselearn'); lecture.video.paused = true; lecture.run(); await lecture.tick();
  assert.equal(lecture.state.plays, 1);
  const spa = setup('/e-training'); spa.state.rootPresent = false; spa.run(); await spa.tick();
  spa.context.location.pathname = '/e-training/lecture/courselearn'; spa.context.location.href = 'lecture';
  spa.state.rootPresent = true; spa.video.paused = true; await spa.tick();
  assert.equal(spa.state.plays, 1); assert.equal(spa.hosts.length, 1); // No reload/reinjection required.
  for (const route of ['/auth/login', '/e-training-other']) {
    const other = setup(route); other.run(); assert.equal(other.timers.size, 0);
    assert.equal(Object.hasOwn(other.document, 'visibilityState'), false);
  }
  console.log('PASS: task duration display, raw-second stall detection at 120s, growth/reset/exclusion cases, current-chapter refresh and settings recovery, repeat-refresh prevention, storage failure; native timing recovery and prior playback/settings checks. Real course E2E untested.');
}
main().catch(error => {console.error(error); process.exitCode = 1;});
