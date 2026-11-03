/**
 * Headless smoke test: evaluate the client bundle in a VM with a minimal React
 * shim and a fake Cordis context, then render one frame of the panel and assert
 * the important numbers. Run with `node test/smoke.mjs` from the plugin dir.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const here = dirname(fileURLToPath(import.meta.url));
const source = readFileSync(join(here, '..', 'client.js'), 'utf8');

const elements = [];
function createElement(tag, props, ...children) {
	const flat = [];
	const push = (child) => {
		if (child === null || child === undefined || child === false || child === true) return;
		if (Array.isArray(child)) child.forEach(push);
		else flat.push(child);
	};
	children.forEach(push);
	const element = { tag, props: props ?? {}, children: flat };
	elements.push(element);
	return element;
}

const React = {
	createElement,
	useState: (initial) => [typeof initial === 'function' ? initial() : initial, () => {}],
	useEffect: () => {},
	useCallback: (fn) => fn,
	useRef: (initial) => ({ current: initial }),
	useMemo: (fn) => fn(),
};

const store = new Map();
const window = {
	localStorage: {
		getItem: (key) => (store.has(key) ? store.get(key) : null),
		setItem: (key, value) => store.set(key, String(value)),
	},
	btoa: (binary) => Buffer.from(binary, 'binary').toString('base64'),
	atob: (code) => Buffer.from(code, 'base64').toString('binary'),
	setInterval: () => 0,
	clearInterval: () => {},
	setTimeout: () => 0,
	clearTimeout: () => {},
};

let factory = null;
window.__ModuleLoader__ = {
	load: (record) => {
		factory = record.factory;
	},
};

const sandbox = {
	window,
	console,
	Date,
	Math,
	JSON,
	Number,
	String,
	Array,
	Object,
	Set,
	Map,
	Promise,
	Error,
	TextEncoder,
	TextDecoder,
	Uint8Array,
};
sandbox.window = Object.assign(window, { AudioContext: undefined });
vm.createContext(sandbox);
vm.runInContext(source, sandbox, { filename: 'client.js' });

if (factory === null) throw new Error('bundle did not register a factory');
const plugin = factory((specifier) => {
	if (specifier === 'react') return React;
	throw new Error('unexpected require: ' + specifier);
});

if (!Array.isArray(plugin.inject) || !plugin.inject.includes('slots')) throw new Error('missing inject contract');
if (typeof plugin.apply !== 'function') throw new Error('missing apply');

const registrations = [];
const effects = [];
const localeCalls = [];
const ctx = {
	effect: (fn, label) => {
		effects.push(label);
		return fn();
	},
	on: () => () => {},
	locale: {
		register: (ns, dictionaries) => {
			localeCalls.push(ns);
			if (!dictionaries.zh || !dictionaries.en) throw new Error('dictionary missing a locale');
			for (const key of Object.keys(dictionaries.en)) {
				if (typeof dictionaries.zh[key] !== 'string') throw new Error('zh dictionary missing key: ' + key);
			}
			return () => {};
		},
		bind: (ns) => (key) => {
			if (!(key in { dummy: 1 }) && typeof key === 'string' && key.length > 0) return 'zh:' + key;
			return key;
		},
	},
	slots: {
		inject: (name, callback) => {
			if (name !== 'shell.bottom') throw new Error('unexpected slot: ' + name);
			return callback();
		},
		register: (options, component) => {
			registrations.push({ options, component });
			return () => {};
		},
	},
};

plugin.apply(ctx);

if (localeCalls[0] !== 'study.supervisor') throw new Error('dictionary namespace not registered');
if (registrations.length !== 1) throw new Error('expected exactly one slot registration');
if (registrations[0].options.name !== 'shell.bottom') throw new Error('registered into the wrong slot');

// Render one frame through the registered view component.
function renderFrame() {
	let root = null;
	const expand = (node) => {
		if (node === null || node === undefined || node === false || node === true) return null;
		if (typeof node.tag === 'function') {
			const child = expand(node.tag(node.props));
			if (child !== null && child.props && child.props['data-study-supervisor'] === 'root') root = child;
			return child;
		}
		return node;
	};
	const tree = expand(registrations[0].component({}));
	if (root === null) throw new Error('panel root not rendered');
	const text = [];
	const walk = (node) => {
		if (node === null || node === undefined) return;
		if (typeof node === 'string' || typeof node === 'number') {
			text.push(String(node));
			return;
		}
		if (Array.isArray(node)) {
			node.forEach(walk);
			return;
		}
		if (typeof node.tag === 'function') {
			walk(node.tag(node.props));
			return;
		}
		if (node.tag === 'style') return;
		(node.children ?? []).forEach(walk);
	};
	walk(tree);
	return { joined: text.join('|'), tree };
}

const idleFrame = renderFrame().joined;
for (const expected of ['25:00', 'zh:title', 'zh:start', 'zh:idle', 'zh:tasks']) {
	if (!idleFrame.includes(expected)) throw new Error('idle frame is missing ' + expected + ' -> ' + idleFrame);
}
if (idleFrame.includes('zh:discard')) throw new Error('idle frame must not offer discard');
for (const action of ['zh:exportFile', 'zh:importFile', 'zh:copyCode', 'zh:pasteCode']) {
	if (!idleFrame.includes(action)) throw new Error('sync action missing: ' + action);
}

// Empty state copy and the add-task affordance.
if (!idleFrame.includes('zh:empty')) throw new Error('empty task list copy missing: ' + idleFrame);

// Sanitizer: 999 focus minutes clamps to 180, a zero-length active row is dropped.
store.set(
	'dsh-study-supervisor:state:v1',
	JSON.stringify({ settings: { focusMinutes: 999, breakMinutes: -4 }, tasks: 'nope', active: { phase: 'focus', durationMs: 0 } }),
);
const clamped = renderFrame().joined;
if (!clamped.includes('3:00:00')) throw new Error('sanitizer did not clamp focus minutes to 180: ' + clamped);

// Running focus session with a task list: timer counts down, phase, stats and task rows render.
const now = Date.now();
store.set(
	'dsh-study-supervisor:state:v1',
	JSON.stringify({
		settings: { focusMinutes: 25, breakMinutes: 5, dailyGoalMinutes: 120, autoBreak: true },
		selectedTaskId: 't1',
		tasks: [
			{ id: 't1', title: '线性代数第三章', done: false, createdAt: now - 1000, doneAt: null },
			{ id: 't2', title: '英语听力', done: true, createdAt: now - 2000, doneAt: now - 500 },
		],
		sessions: [{ id: 's1', start: now - 3 * 3600000, end: now - 2 * 3600000, minutes: 25, taskId: null, distractions: 1 }],
		active: { id: 'a1', phase: 'focus', durationMs: 25 * 60000, startedAt: now - 100000, paused: false, remainingMs: 0, taskId: 't1', distractions: 2 },
	}),
);
const running = renderFrame().joined;
if (!/2[34]:\d\d/.test(running)) throw new Error('running timer did not count down: ' + running);
if (!running.includes('zh:focusing')) throw new Error('running frame shows the wrong phase: ' + running);
if (!running.includes('线性代数第三章')) throw new Error('selected task title missing: ' + running);
if (!running.includes('zh:discard')) throw new Error('running frame must offer discard');
if (!running.includes('zh:distraction')) throw new Error('running frame must offer the distraction counter');
if (!running.includes('25 zh:minShort')) throw new Error('daily focus total missing: ' + running);
// Portability: sync code round trip, raw-JSON acceptance, and merge semantics.
const T = plugin.__test;
if (typeof T?.encodeSync !== 'function') throw new Error('__test helpers missing');

const base = T.emptyDoc();
base.tasks = [{ id: 't1', title: '任务一', done: false, createdAt: 1000, doneAt: null }];
const T0 = Date.now() - 3600000;
base.sessions = [{ id: 's1', start: T0, end: T0 + 1500000, minutes: 25, taskId: null, distractions: 0 }];

const code = T.encodeSync(base);
if (!code.startsWith('SSV1:')) throw new Error('sync code has no prefix: ' + code.slice(0, 12));
const back = T.decodeSync(code);
if (back.tasks.length !== 1 || back.sessions.length !== 1) throw new Error('sync code lost records');
if (back.tasks[0].title !== '任务一') throw new Error('sync code mangled UTF-8: ' + back.tasks[0].title);

const raw = T.decodeSync(JSON.stringify({ tasks: [{ id: 't2', title: '任务二', done: true, createdAt: 4000, doneAt: 5000 }], sessions: [] }));
if (raw.tasks[0].id !== 't2' || raw.tasks[0].done !== true) throw new Error('raw JSON import failed');

let rejected = false;
try {
	T.decodeSync('definitely not a sync code');
} catch (error) {
	rejected = true;
}
if (!rejected) throw new Error('garbage sync code was accepted');

const other = T.emptyDoc();
other.settings = { ...other.settings, focusMinutes: 45 };
other.tasks = [
	{ id: 't1', title: '任务一', done: true, createdAt: 1000, doneAt: 9000 },
	{ id: 't3', title: '任务三', done: false, createdAt: 6000, doneAt: null },
];
other.sessions = [
	{ id: 's1', start: T0, end: T0 + 1500000, minutes: 25, taskId: null, distractions: 0 },
	{ id: 's2', start: T0 + 86400000, end: T0 + 87900000, minutes: 25, taskId: null, distractions: 0 },
];
const merged = T.mergeDoc(base, other);
if (merged.added !== 1) throw new Error('merge should add exactly one session, added=' + merged.added);
if (merged.next.sessions.length !== 2) throw new Error('merge duplicated sessions: ' + merged.next.sessions.length);
if (merged.next.tasks.length !== 2) throw new Error('merge duplicated tasks: ' + merged.next.tasks.length);
if (merged.next.tasks.find((task) => task.id === 't1').done !== true) throw new Error('merge lost the done state');
if (merged.next.settings.focusMinutes !== base.settings.focusMinutes) throw new Error('merge overwrote local settings');

console.log('smoke ok: namespace=%s slot=%s effects=%s', localeCalls[0], registrations[0].options.name, effects.join(' | '));
console.log('  idle    ', idleFrame.slice(0, 120));
console.log('  running ', running.slice(0, 200));
