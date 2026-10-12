const assert = require('node:assert/strict');
const fs = require('node:fs'), vm = require('node:vm'), path = require('node:path');
const source = fs.readFileSync(path.join(__dirname, 'wanfang-background.user.js'), 'utf8');
// Minimal reproduction of the visibility handler observed on 2026-10-12.
// This suite does not download or include the platform's application bundle.
function handler(event) {
  if (event.target.visibilityState === 'hidden') this.$refs.player.inPlayer.pause();
}
function setup(pathname = '/e-training/quality/courselearn') {
  const state = {title: '1.1 video one', clicks: 0, plays: 0, now: 0, logs: [], next: true};
  const timers = new Map(); let id = 0;
  const video = {duration: 100, currentTime: 94.9, currentSrc: 'one', readyState: 4,
    paused: false, ended: false, seeking: false, playbackRate: 1,
    play() {state.plays++; this.paused = false; return Promise.resolve();}};
  state.video = video;
  const hosts = [];
  class Element {
    constructor() {this.style = {}; this.children = []; this.events = {}; this.nodes = {};}
    append(element) {this.children.push(element);}
    attachShadow() {this.shadow = new Element(); return this.shadow;}
    getElementById(id) {return this.nodes[id] ??= new Element();}
    addEventListener(name, fn) {this.events[name] = fn;}
    setAttribute(name, value) {this[name] = value;}
    remove() {hosts.splice(hosts.indexOf(this), 1);}
  }
  const root = {querySelector(selector) {
    if (selector === 'h1') return {textContent: state.title};
    if (selector === 'video') return state.video;
    if (selector === '.progress-count .next' && state.next)
      return {title: 'video two', click() {state.clicks++;}};
    return null;
  }};
  const document = Object.create({visibilityState: 'hidden'});
  document.querySelector = selector => selector === '#rightBox' ? root : selector === '#rightBox video' ? state.video : null;
  document.getElementById = id => hosts.find(host => host.id === id);
  document.createElement = () => new Element();
  document.documentElement = {append: host => hosts.push(host)};
  const window = {};
  const context = vm.createContext({window, document,
    location: {hostname: 'cx.wanfangdata.com.cn', pathname, href: 'course'},
    Date: class extends Date {static now() {return state.now;}},
    setInterval(fn) {timers.set(++id, fn); return id;},
    clearInterval(key) {timers.delete(key);},
    console: Object.fromEntries(['info', 'warn', 'error'].map(k => [k, (...v) => state.logs.push(v)]))});
  return {state, video, document, window, timers, hosts,
    run: () => vm.runInContext(source, context),
    tick: () => [...timers.values()].forEach(fn => fn())};
}
const e = setup(); let pauses = 0;
const player = {pause() {pauses++;}}, component = {$refs: {player: {inPlayer: player}}};
handler.call(component, {target: e.document}); assert.equal(pauses, 1);
e.run(); handler.call(component, {target: e.document}); assert.equal(pauses, 1);
player.pause(); assert.equal(pauses, 2);
e.tick(); assert.equal(e.video.playbackRate, 2); assert.equal(e.state.clicks, 0);
e.video.currentTime = 95; e.video.paused = true; e.tick(); assert.equal(e.state.clicks, 0);
e.video.paused = false; e.tick(); e.tick(); assert.equal(e.state.clicks, 1);
e.state.title = '1.2 video two'; e.tick(); assert.equal(e.state.clicks, 1);
e.video.currentSrc = 'two'; e.video.currentTime = 0; e.video.paused = true; e.tick();
assert.equal(e.state.plays, 1);
const select = e.hosts[0].shadow.getElementById('speed');
select.value = '4'; select.events.change();
assert.equal(e.window.wanfangSpeed, 4); assert.equal(e.video.playbackRate, 4);
e.video.paused = true; e.tick(); assert.equal(e.state.plays, 1);
e.run(); assert.equal(e.timers.size, 1); assert.equal(e.window.wanfangSpeed, 4);
assert.equal(e.hosts.length, 1);
for (let i = 0; i < 80; i++) {e.window.wanfangSpeed = i % 2 ? 2 : 3; e.tick();}
assert.equal(e.hosts[0].shadow.getElementById('logs').textContent.split('\n').length, 60);
e.state.title = '随堂测验'; e.tick(); assert.equal(e.timers.size, 0);
assert.ok(e.hosts[0].shadow.getElementById('status').textContent.includes('已停止'));
const stop = setup(); stop.run(); stop.hosts[0].shadow.getElementById('stop').events.click();
assert.equal(stop.timers.size, 0); assert.equal(stop.video.paused, false);
const stoppedSpeed = stop.hosts[0].shadow.getElementById('speed');
stoppedSpeed.value = '3'; stoppedSpeed.events.change(); assert.equal(stop.video.playbackRate, 3);
const last = setup(); last.run(); last.state.next = false; last.video.currentTime = 99; last.tick();
assert.equal(last.timers.size, 0); assert.equal(last.video.paused, false);
const timeout = setup(); timeout.run(); timeout.video.currentTime = 95; timeout.tick();
timeout.state.now = 20001; timeout.tick(); assert.equal(timeout.timers.size, 0);
assert.equal(timeout.state.clicks, 1);
const invalid = setup(); invalid.run(); invalid.video.duration = NaN; invalid.tick();
assert.equal(invalid.state.clicks, 0);
const badSpeed = setup(); badSpeed.run(); badSpeed.window.wanfangSpeed = 99;
Object.defineProperty(badSpeed.video, 'playbackRate', {get: () => 1, set() {throw Error('unsupported');}});
badSpeed.tick(); badSpeed.tick();
assert.equal(badSpeed.state.logs.filter(v => String(v[0]).includes('99')).length, 1);
const other = setup('/auth/login'); other.run(); assert.equal(other.timers.size, 0);
assert.equal(Object.hasOwn(other.document, 'visibilityState'), false);
console.log('PASS: reproduced visibility handler, 95% switch, speed control, panel deduplication, 60-line log limit, stop status, manual pause, delayed load, quiz, last chapter, timeout, invalid duration, unsupported speed, route guard. Live switching untested.');
