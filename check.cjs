const assert = require('node:assert/strict');
const fs = require('node:fs'), vm = require('node:vm'), path = require('node:path');
const source = fs.readFileSync(path.join(__dirname, 'wanfang-background.user.js'), 'utf8');
const flush = () => new Promise(resolve => setImmediate(resolve));
function setup(pathname = '/e-training/quality/courselearn') {
  const state = {title: '1.1 video one', clicks: 0, plays: 0, now: 0, logs: [], next: true, rootPresent: true};
  const timers = new Map(); let id = 0;
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
  const root = {querySelector(selector) {
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
    location: {hostname: 'cx.wanfangdata.com.cn', pathname, href: 'course'},
    Date: class extends Date {static now() {return state.now;}},
    setInterval(fn) {timers.set(++id, fn); return id;},
    clearInterval(key) {timers.delete(key);},
    MutationObserver: class {
      constructor(callback) {this.callback = callback; this.active = false; observers.push(this);}
      observe() {this.active = true;}
      disconnect() {this.active = false;}
    },
    console: Object.fromEntries(['info', 'warn', 'error'].map(k => [k, (...v) => state.logs.push(v)]))});
  return {state, video, document, window, timers, hosts, observers, context,
    control: id => hosts[0].shadow.getElementById(id),
    run: () => vm.runInContext(source, context),
    tick: async () => { [...timers.values()].forEach(fn => fn()); await flush(); }};
}
async function main() {
  const e = setup(); e.video.paused = true; e.run(); await e.tick();
  assert.equal(e.document.visibilityState, 'visible');
  assert.equal(e.state.plays, 1); assert.equal(e.video.playbackRate, 1);
  assert.equal(e.control('chapter').textContent, e.state.title);
  assert.equal(e.control('progress-text').textContent, '35.0%');
  assert.equal(e.control('progress-bar').value, 35);
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
  console.log('PASS: training scope and SPA navigation, mount recovery, autoplay on/off/retry, ended handling, draggable bounds/keyboard, auto-next on/off, custom threshold and validation, 100% switch, speed, delayed source, panel deduplication, log limit, quiz, timeout, invalid duration, cleanup. Real course E2E untested.');
}
main().catch(error => {console.error(error); process.exitCode = 1;});
