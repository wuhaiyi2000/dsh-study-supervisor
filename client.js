/**
 * Study Supervisor — browser half.
 *
 * A focus timer, a today's-task checklist and daily study statistics docked into
 * the shell's full-width bottom row. All state is local to this browser profile
 * (localStorage); the host half of the bundle exists only so the package has a
 * Loader row.
 */
window.__ModuleLoader__.load({
	id: 'dsh-study-supervisor',
	factory(require) {
		const React = require('react');
		const h = React.createElement;
		const { useCallback, useEffect, useRef, useState } = React;

		const NS = 'study.supervisor';
		const STORAGE_KEY = 'dsh-study-supervisor:state:v1';
		const MINUTE = 60000;
		const DAY = 86400000;

		/* ── pure state helpers ─────────────────────────────────────────── */

		const DEFAULTS = {
			focusMinutes: 25,
			breakMinutes: 5,
			dailyGoalMinutes: 120,
			autoBreak: true,
		};

		function emptyDoc() {
			return {
				version: 1,
				settings: { ...DEFAULTS },
				tasks: [],
				sessions: [],
				active: null,
				selectedTaskId: null,
				collapsed: false,
			};
		}

		function finite(value, fallback, min, max) {
			const n = typeof value === 'number' ? value : Number(value);
			if (!Number.isFinite(n)) return fallback;
			return Math.min(max, Math.max(min, n));
		}

		function sanitize(raw) {
			const base = emptyDoc();
			if (raw === null || typeof raw !== 'object') return base;
			const settings = raw.settings !== null && typeof raw.settings === 'object' ? raw.settings : {};
			base.settings = {
				focusMinutes: finite(settings.focusMinutes, DEFAULTS.focusMinutes, 1, 180),
				breakMinutes: finite(settings.breakMinutes, DEFAULTS.breakMinutes, 0, 60),
				dailyGoalMinutes: finite(settings.dailyGoalMinutes, DEFAULTS.dailyGoalMinutes, 0, 960),
				autoBreak: settings.autoBreak !== false,
			};
			if (Array.isArray(raw.tasks)) {
				base.tasks = raw.tasks
					.filter((task) => task !== null && typeof task === 'object' && typeof task.title === 'string')
					.map((task) => ({
						id: typeof task.id === 'string' ? task.id : 't' + Math.random().toString(36).slice(2, 9),
						title: String(task.title).slice(0, 160),
						done: task.done === true,
						createdAt: finite(task.createdAt, Date.now(), 0, 8e15),
						doneAt: task.done === true ? finite(task.doneAt, Date.now(), 0, 8e15) : null,
					}))
					.slice(-300);
			}
			if (Array.isArray(raw.sessions)) {
				base.sessions = raw.sessions
					.filter((session) => session !== null && typeof session === 'object' && Number.isFinite(session.start))
					.map((session) => ({
						id: typeof session.id === 'string' ? session.id : 's' + Math.random().toString(36).slice(2, 9),
						start: session.start,
						end: finite(session.end, session.start, 0, 8e15),
						minutes: finite(session.minutes, 0, 0, 600),
						taskId: typeof session.taskId === 'string' ? session.taskId : null,
						distractions: finite(session.distractions, 0, 0, 999),
					}))
					.slice(-2000);
			}
			const active = raw.active;
			if (active !== null && typeof active === 'object' && (active.phase === 'focus' || active.phase === 'break')) {
				const durationMs = finite(active.durationMs, 0, 0, 12 * 3600000);
				if (durationMs > 0) {
					base.active = {
						id: typeof active.id === 'string' ? active.id : 'a' + Math.random().toString(36).slice(2, 9),
						phase: active.phase,
						durationMs,
						startedAt: finite(active.startedAt, Date.now(), 0, 8e15),
						paused: active.paused === true,
						remainingMs: finite(active.remainingMs, durationMs, 0, durationMs),
						taskId: typeof active.taskId === 'string' ? active.taskId : null,
						distractions: finite(active.distractions, 0, 0, 999),
					};
				}
			}
			base.selectedTaskId = typeof raw.selectedTaskId === 'string' ? raw.selectedTaskId : null;
			base.collapsed = raw.collapsed === true;
			return base;
		}

		function loadDoc() {
			try {
				const text = window.localStorage.getItem(STORAGE_KEY);
				if (text === null) return emptyDoc();
				return sanitize(JSON.parse(text));
			} catch (error) {
				return emptyDoc();
			}
		}

		function saveDoc(doc) {
			try {
				window.localStorage.setItem(STORAGE_KEY, JSON.stringify(doc));
			} catch (error) {
				/* private mode or quota: keep the session usable without persistence */
			}
		}

		function dayKeyOf(ts) {
			const date = new Date(ts);
			const month = String(date.getMonth() + 1).padStart(2, '0');
			const day = String(date.getDate()).padStart(2, '0');
			return date.getFullYear() + '-' + month + '-' + day;
		}

		function remainingOf(active, now) {
			if (active === null || active === undefined) return 0;
			if (active.paused) return Math.max(0, active.remainingMs);
			return Math.max(0, active.durationMs - (now - active.startedAt));
		}

		function newActive(doc, phase, now) {
			const minutes = phase === 'focus' ? doc.settings.focusMinutes : doc.settings.breakMinutes;
			const durationMs = Math.round(minutes * MINUTE);
			if (!(durationMs > 0)) return null;
			return {
				id: 'a' + now.toString(36) + Math.random().toString(36).slice(2, 6),
				phase,
				durationMs,
				startedAt: now,
				paused: false,
				remainingMs: durationMs,
				taskId: phase === 'focus' ? doc.selectedTaskId : null,
				distractions: 0,
			};
		}

		function pruneSessions(sessions) {
			const cutoff = Date.now() - 120 * DAY;
			return sessions.filter((session) => session.start >= cutoff).slice(-1500);
		}

		/** Fold a due timer into a logged session (focus) or a plain reset (break). */
		function completeActive(doc, now) {
			const active = doc.active;
			if (active === null || active === undefined) return { doc, event: null };
			if (active.phase === 'focus') {
				const session = {
					id: active.id,
					start: active.startedAt,
					end: now,
					minutes: Math.round(active.durationMs / MINUTE),
					taskId: active.taskId,
					distractions: active.distractions,
				};
				const withSession = { ...doc, sessions: pruneSessions([...doc.sessions, session]) };
				const autoBreak = withSession.settings.autoBreak && withSession.settings.breakMinutes > 0;
				return {
					doc: { ...withSession, active: autoBreak ? newActive(withSession, 'break', now) : null },
					event: { kind: 'focus', minutes: session.minutes },
				};
			}
			return { doc: { ...doc, active: null }, event: { kind: 'break', minutes: Math.round(active.durationMs / MINUTE) } };
		}

		function minutesOn(doc, key) {
			let total = 0;
			for (const session of doc.sessions) {
				if (dayKeyOf(session.start) === key) total += session.minutes;
			}
			return total;
		}

		function streakDays(doc, now) {
			const days = new Set(doc.sessions.map((session) => dayKeyOf(session.start)));
			const cursor = new Date(now);
			cursor.setHours(12, 0, 0, 0);
			if (!days.has(dayKeyOf(cursor.getTime()))) cursor.setTime(cursor.getTime() - DAY);
			let count = 0;
			while (count < 400 && days.has(dayKeyOf(cursor.getTime()))) {
				count += 1;
				cursor.setTime(cursor.getTime() - DAY);
			}
			return count;
		}

		function clockText(ms) {
			const total = Math.max(0, Math.round(ms / 1000));
			const hours = Math.floor(total / 3600);
			const minutes = Math.floor((total % 3600) / 60);
			const seconds = total % 60;
			const mm = String(minutes).padStart(2, '0');
			const ss = String(seconds).padStart(2, '0');
			return hours > 0 ? hours + ':' + mm + ':' + ss : mm + ':' + ss;
		}

		function beep(kind) {
			try {
				const Ctor = window.AudioContext || window.webkitAudioContext;
				if (Ctor === undefined) return;
				const audio = new Ctor();
				const start = audio.currentTime;
				const play = (frequency, from, length) => {
					const oscillator = audio.createOscillator();
					const gain = audio.createGain();
					oscillator.type = 'sine';
					oscillator.frequency.value = frequency;
					gain.gain.setValueAtTime(0.0001, start + from);
					gain.gain.exponentialRampToValueAtTime(0.12, start + from + 0.02);
					gain.gain.exponentialRampToValueAtTime(0.0001, start + from + length);
					oscillator.connect(gain).connect(audio.destination);
					oscillator.start(start + from);
					oscillator.stop(start + from + length + 0.05);
				};
				if (kind === 'focus') {
					play(660, 0, 0.18);
					play(880, 0.2, 0.22);
				} else {
					play(520, 0, 0.16);
					play(392, 0.18, 0.24);
				}
				window.setTimeout(() => {
					audio.close().catch(() => {});
				}, 1200);
			} catch (error) {
				/* audio is an enhancement only */
			}
		}

		/* ── portability: file export/import and the sync code ─────────── */

		const SYNC_PREFIX = 'SSV1:';

		/** Portable snapshot: the running timer and panel state stay local. */
		function snapshotOf(doc) {
			return {
				app: 'dsh-study-supervisor',
				version: 1,
				exportedAt: Date.now(),
				settings: doc.settings,
				tasks: doc.tasks,
				sessions: doc.sessions,
			};
		}

		function base64Of(text) {
			const bytes = new TextEncoder().encode(text);
			let binary = '';
			for (const byte of bytes) binary += String.fromCharCode(byte);
			return window.btoa(binary);
		}

		function textOfBase64(code) {
			const binary = window.atob(code);
			const bytes = new Uint8Array(binary.length);
			for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
			return new TextDecoder().decode(bytes);
		}

		/** Encode a document as one pasteable line (`SSV1:` + UTF-8 base64 JSON). */
		function encodeSync(doc) {
			return SYNC_PREFIX + base64Of(JSON.stringify(snapshotOf(doc)));
		}

		/** Accept a sync code or a raw exported JSON document; throws when neither. */
		function decodeSync(text) {
			const trimmed = String(text ?? '').trim();
			if (trimmed.length === 0) throw new Error('empty');
			const body = trimmed.startsWith(SYNC_PREFIX) ? trimmed.slice(SYNC_PREFIX.length) : trimmed;
			const json = body.startsWith('{') ? body : textOfBase64(body.replace(/\s+/g, ''));
			const parsed = JSON.parse(json);
			if (parsed === null || typeof parsed !== 'object') throw new Error('not an object');
			return sanitize(parsed);
		}

		/**
		 * Merge an imported snapshot into the local document: tasks and focus
		 * sessions union by id, a task done on either side stays done, and the
		 * local settings and running timer win.
		 */
		function mergeDoc(current, incoming) {
			const tasks = new Map(current.tasks.map((task) => [task.id, task]));
			for (const task of incoming.tasks) {
				const existing = tasks.get(task.id);
				if (existing === undefined) tasks.set(task.id, task);
				else if (!existing.done && task.done) tasks.set(task.id, { ...existing, done: true, doneAt: task.doneAt });
			}
			const sessions = new Map(current.sessions.map((session) => [session.id, session]));
			let added = 0;
			for (const session of incoming.sessions) {
				if (sessions.has(session.id)) continue;
				sessions.set(session.id, session);
				added += 1;
			}
			return {
				next: {
					...current,
					tasks: [...tasks.values()].sort((a, b) => a.createdAt - b.createdAt).slice(-300),
					sessions: pruneSessions([...sessions.values()].sort((a, b) => a.start - b.start)),
				},
				added,
			};
		}

		function downloadSnapshot(doc) {
			const text = JSON.stringify(snapshotOf(doc), null, 2);
			const blob = new window.Blob([text], { type: 'application/json' });
			const url = window.URL.createObjectURL(blob);
			const anchor = window.document.createElement('a');
			anchor.href = url;
			anchor.download = 'study-supervisor-' + dayKeyOf(Date.now()) + '.json';
			window.document.body.appendChild(anchor);
			anchor.click();
			anchor.remove();
			window.setTimeout(() => window.URL.revokeObjectURL(url), 2000);
		}

		/* ── dictionary ─────────────────────────────────────────────────── */

		const zh = {
			title: '学习监督',
			idle: '未开始',
			focusing: '专注中',
			breaking: '休息中',
			paused: '已暂停',
			start: '开始专注',
			pause: '暂停',
			resume: '继续',
			discard: '放弃本轮',
			skipBreak: '结束休息',
			tasks: '任务清单',
			settings: '设置',
			today: '今日',
			collapse: '收起面板',
			expand: '展开面板',
			noTask: '未选择当前任务',
			pickHint: '点击任务行设为当前任务',
			addPlaceholder: '写下今天要完成的事，回车添加',
			add: '添加',
			empty: '还没有任务。先写下今天最重要的一件事。',
			delete: '删除任务',
			markDone: '标记完成',
			focusTime: '专注时长',
			pomodoros: '番茄数',
			tasksDone: '完成任务',
			last7: '近 7 天专注',
			streak: '连续',
			streakUnit: '天',
			focusLen: '专注时长',
			breakLen: '休息时长',
			dailyGoal: '每日目标',
			autoBreak: '专注结束自动休息',
			minutesUnit: '分钟',
			minShort: '分',
			hourShort: '小时',
			distraction: '分心 +1',
			distracted: '分心',
			focusDone: '专注完成，休息一下',
			breakDone: '休息结束，开始下一轮吧',
			goalReached: '今日目标达成',
			remaining: '剩余',
			select: '设定',
			sync: '跨机同步',
			exportFile: '导出文件',
			importFile: '导入文件',
			copyCode: '复制同步码',
			pasteCode: '粘贴同步码',
			syncImport: '合并导入',
			cancel: '取消',
			exported: '已导出到下载文件',
			copied: '同步码已复制',
			imported: '已合并导入',
			importNone: '这份数据没有新内容',
			importFail: '无法识别这份同步数据',
			copyFail: '剪贴板不可用，请改用导出文件',
			codePlaceholder: '把同步码，或导出的 JSON 文件内容，粘贴到这里',
			syncHint: '导入只做合并：任务按条、专注记录按次累加，不会覆盖本机设置和正在进行的计时。',
		};

		const en = {
			title: 'Study Supervisor',
			idle: 'Not started',
			focusing: 'Focusing',
			breaking: 'On break',
			paused: 'Paused',
			start: 'Start focus',
			pause: 'Pause',
			resume: 'Resume',
			discard: 'Discard',
			skipBreak: 'End break',
			tasks: 'Tasks',
			settings: 'Settings',
			today: 'Today',
			collapse: 'Collapse panel',
			expand: 'Expand panel',
			noTask: 'No current task',
			pickHint: 'Click a task to make it current',
			addPlaceholder: 'What will you finish today? Press Enter.',
			add: 'Add',
			empty: 'No tasks yet. Write down the one thing that matters today.',
			delete: 'Delete task',
			markDone: 'Mark done',
			focusTime: 'Focus time',
			pomodoros: 'Sessions',
			tasksDone: 'Tasks done',
			last7: 'Focus, last 7 days',
			streak: 'Streak',
			streakUnit: 'd',
			focusLen: 'Focus length',
			breakLen: 'Break length',
			dailyGoal: 'Daily goal',
			autoBreak: 'Start the break automatically',
			minutesUnit: 'min',
			minShort: 'm',
			hourShort: 'h',
			distraction: 'Distraction +1',
			distracted: 'Distractions',
			focusDone: 'Focus complete — take a break',
			breakDone: 'Break over — ready for the next round',
			goalReached: 'Daily goal reached',
			remaining: 'left',
			select: 'Set',
			sync: 'Move to another machine',
			exportFile: 'Export file',
			importFile: 'Import file',
			copyCode: 'Copy code',
			pasteCode: 'Paste code',
			syncImport: 'Merge',
			cancel: 'Cancel',
			exported: 'Exported to your downloads',
			copied: 'Sync code copied',
			imported: 'Merged',
			importNone: 'Nothing new in that data',
			importFail: 'That is not a recognizable sync code',
			copyFail: 'Clipboard unavailable — export a file instead',
			codePlaceholder: 'Paste the sync code, or the contents of an exported JSON file, here.',
			syncHint: 'Import only merges: tasks and focus sessions add up by identity, while local settings and a running timer stay untouched.',
		};

		/* ── styles (theme tokens only) ─────────────────────────────────── */

		const CSS = `
.ssv-root{position:relative;display:flex;flex-direction:column;background:var(--dsw-alias-bg-layer-1);border-top:1px solid var(--dsw-alias-border-l1);color:var(--dsw-alias-label-primary);font-size:12px;line-height:1.4;flex:none}
.ssv-bar{display:flex;align-items:center;gap:12px;height:46px;padding:0 14px 0 16px;min-width:0}
.ssv-status{display:flex;align-items:center;gap:7px;flex:none}
.ssv-dot{width:7px;height:7px;border-radius:50%;background:var(--dsw-alias-state-idle-primary);flex:none}
.ssv-dot.is-focus{background:var(--dsw-alias-state-business-primary);animation:ssv-pulse 2s ease-in-out infinite}
.ssv-dot.is-break{background:var(--dsw-alias-state-success-primary)}
.ssv-label{font-size:11px;color:var(--dsw-alias-label-tertiary);letter-spacing:.02em}
.ssv-timer{font-family:var(--dsh-font-family-code-default,"SF Mono",monospace);font-variant-numeric:tabular-nums;font-size:18px;font-weight:600;letter-spacing:.02em;flex:none}
.ssv-timer.is-idle,.ssv-timer.is-paused{color:var(--dsw-alias-label-tertiary)}
.ssv-phase{font-size:11px;color:var(--dsw-alias-label-tertiary);flex:none;max-width:220px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.ssv-phase.is-alert{color:var(--dsw-alias-state-success-primary)}
.ssv-goal{display:flex;align-items:center;gap:8px;flex:none}
.ssv-progress{position:relative;width:84px;height:5px;border-radius:999px;background:var(--dsw-alias-bg-mask-2);overflow:hidden}
.ssv-progress>i{position:absolute;top:0;bottom:0;left:0;background:var(--dsw-alias-state-business-primary);border-radius:999px;transition:width .3s ease}
.ssv-progress.is-done>i{background:var(--dsw-alias-state-success-primary)}
.ssv-goaltext{font-size:11px;color:var(--dsw-alias-label-tertiary);white-space:nowrap;font-variant-numeric:tabular-nums}
.ssv-taskchip{display:flex;align-items:center;min-width:0;flex:1;justify-content:center;gap:6px}
.ssv-taskchip button{max-width:100%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;border:none;background:none;color:var(--dsw-alias-label-secondary);font:inherit;cursor:pointer;padding:2px 6px;border-radius:var(--dsw-radius-xs)}
.ssv-taskchip button:hover{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}
.ssv-taskchip .ssv-muted{color:var(--dsw-alias-label-tertiary);cursor:default}
.ssv-taskchip .ssv-muted:hover{background:none;color:var(--dsw-alias-label-tertiary)}
.ssv-chip{display:inline-flex;align-items:center;gap:4px;height:20px;padding:0 8px;border-radius:999px;background:var(--dsw-alias-bg-mask-2);font-size:10px;color:var(--dsw-alias-label-tertiary);font-variant-numeric:tabular-nums;flex:none}
.ssv-actions{display:flex;align-items:center;gap:6px;flex:none}
.ssv-btn{height:26px;padding:0 10px;display:inline-flex;align-items:center;gap:6px;border:1px solid transparent;border-radius:var(--dsw-radius-sm);background:transparent;color:var(--dsw-alias-label-secondary);font:inherit;font-size:12px;cursor:pointer;transition:background .15s ease,color .15s ease}
.ssv-btn:hover{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}
.ssv-btn:focus-visible{outline:2px solid var(--dsw-alias-state-business-primary);outline-offset:1px}
.ssv-btn--primary{background:var(--dsw-alias-button-primary-fill);color:var(--dsw-alias-label-primary-inverted)}
.ssv-btn--primary:hover{background:var(--dsw-alias-button-primary-hover);color:var(--dsw-alias-label-primary-inverted)}
.ssv-btn--ghost{border-color:var(--dsw-alias-border-l1)}
.ssv-btn--icon{width:26px;padding:0;justify-content:center;font-size:13px}
.ssv-panel{display:grid;grid-template-columns:minmax(230px,1.15fr) minmax(200px,1fr) minmax(186px,.85fr);gap:20px;padding:10px 16px 14px;border-top:1px solid var(--dsw-alias-border-l1);max-height:322px}
.ssv-col{display:flex;flex-direction:column;gap:8px;min-width:0;min-height:0;overflow:hidden}
.ssv-h{display:flex;align-items:center;justify-content:space-between;gap:8px;font-size:10px;font-weight:600;letter-spacing:.06em;text-transform:uppercase;color:var(--dsw-alias-label-tertiary)}
.ssv-list{display:flex;flex-direction:column;gap:2px;overflow:auto;min-height:0;flex:1;padding-right:2px}
.ssv-empty{font-size:11px;color:var(--dsw-alias-label-tertiary);padding:4px 0}
.ssv-task{display:flex;align-items:center;gap:8px;border-radius:var(--dsw-radius-sm);padding:3px 4px}
.ssv-task:hover{background:var(--dsw-alias-interactive-bg-hover)}
.ssv-task.is-selected{background:var(--dsw-alias-interactive-bg-hover-accent)}
.ssv-check{width:16px;height:16px;flex:none;display:inline-flex;align-items:center;justify-content:center;border:1px solid var(--dsw-alias-border-l3);border-radius:4px;background:transparent;color:var(--dsw-alias-label-primary-inverted);cursor:pointer;font-size:10px;line-height:1;padding:0}
.ssv-task.is-done .ssv-check{background:var(--dsw-alias-state-success-primary);border-color:var(--dsw-alias-state-success-primary)}
.ssv-tasktitle{flex:1;min-width:0;text-align:left;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;background:none;border:none;padding:0;font:inherit;color:var(--dsw-alias-label-primary);cursor:pointer}
.ssv-task.is-done .ssv-tasktitle{color:var(--dsw-alias-label-tertiary);text-decoration:line-through}
.ssv-x{opacity:0;border:none;background:none;color:var(--dsw-alias-label-tertiary);cursor:pointer;font-size:13px;line-height:1;padding:2px 5px;border-radius:var(--dsw-radius-xs)}
.ssv-task:hover .ssv-x{opacity:1}
.ssv-x:hover{color:var(--dsw-alias-state-error-primary);background:var(--dsw-alias-interactive-bg-hover-danger)}
.ssv-addrow{display:flex;gap:6px}
.ssv-input{flex:1;min-width:0;height:27px;border:1px solid var(--dsw-alias-border-l1);border-radius:var(--dsw-radius-sm);background:var(--dsw-alias-bg-base);color:var(--dsw-alias-label-primary);padding:0 8px;font:inherit;font-size:12px}
.ssv-input::placeholder{color:var(--dsw-alias-label-tertiary)}
.ssv-input:focus{outline:none;border-color:var(--dsw-alias-state-business-primary)}
.ssv-stats{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:8px}
.ssv-stat{background:var(--dsw-alias-bg-layer-2);border-radius:var(--dsw-radius-md);padding:7px 9px;min-width:0}
.ssv-stat b{display:block;font-size:15px;font-weight:600;font-variant-numeric:tabular-nums;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.ssv-stat span{font-size:10px;color:var(--dsw-alias-label-tertiary);white-space:nowrap}
.ssv-week{display:flex;align-items:flex-end;gap:6px;height:70px}
.ssv-day{flex:1;display:flex;flex-direction:column;align-items:center;justify-content:flex-end;gap:4px;min-width:0;height:100%}
.ssv-daybar{width:100%;max-width:24px;border-radius:3px 3px 1px 1px;background:var(--dsw-alias-bg-mask-3);min-height:2px}
.ssv-day.is-today .ssv-daybar{background:var(--dsw-alias-state-business-primary)}
.ssv-daylabel{font-size:9px;color:var(--dsw-alias-label-tertiary);font-variant-numeric:tabular-nums}
.ssv-setrow{display:flex;align-items:center;justify-content:space-between;gap:8px}
.ssv-setrow label{color:var(--dsw-alias-label-secondary);font-size:11px}
.ssv-select{height:24px;border:1px solid var(--dsw-alias-border-l1);border-radius:var(--dsw-radius-xs);background:var(--dsw-alias-bg-base);color:var(--dsw-alias-label-primary);font:inherit;font-size:11px;padding:0 4px}
.ssv-switch{position:relative;width:30px;height:17px;border-radius:999px;border:none;background:var(--dsw-alias-bg-mask-3);cursor:pointer;padding:0;flex:none}
.ssv-switch::after{content:"";position:absolute;top:2px;left:2px;width:13px;height:13px;border-radius:50%;background:var(--dsw-alias-switch-thumb);transition:transform .15s ease}
.ssv-switch.is-on{background:var(--dsw-alias-state-business-primary)}
.ssv-switch.is-on::after{transform:translateX(13px)}
.ssv-syncrow{display:flex;flex-wrap:wrap;gap:6px}
.ssv-syncrow .ssv-btn{height:24px;padding:0 8px;font-size:11px}
.ssv-syncbox{display:flex;flex-direction:column;gap:6px}
.ssv-textarea{width:100%;box-sizing:border-box;min-height:64px;resize:vertical;border:1px solid var(--dsw-alias-border-l1);border-radius:var(--dsw-radius-sm);background:var(--dsw-alias-bg-base);color:var(--dsw-alias-label-primary);padding:6px 8px;font-family:var(--dsh-font-family-code-default,monospace);font-size:10px;line-height:1.35}
.ssv-textarea:focus{outline:none;border-color:var(--dsw-alias-state-business-primary)}
.ssv-syncactions{display:flex;align-items:center;justify-content:space-between;gap:8px}
.ssv-hint{font-size:9px;color:var(--dsw-alias-label-tertiary);line-height:1.35;flex:1}
@keyframes ssv-pulse{0%,100%{opacity:1}50%{opacity:.3}}
`;

		/* ── view ───────────────────────────────────────────────────────── */

		function formatMinutes(minutes, t) {
			const total = Math.max(0, Math.round(minutes));
			const hours = Math.floor(total / 60);
			const rest = total % 60;
			if (hours <= 0) return rest + ' ' + t('minShort');
			return hours + t('hourShort') + ' ' + String(rest).padStart(2, '0') + t('minShort');
		}

		function StudySupervisor(props) {
			const t = props.t;
			const [doc, setDoc] = useState(loadDoc);
			const [now, setNow] = useState(() => Date.now());
			const [draft, setDraft] = useState('');
			const [flash, setFlash] = useState(null);
			const [syncOpen, setSyncOpen] = useState(false);
			const [syncText, setSyncText] = useState('');
			const flashTimer = useRef(0);
			const draftRef = useRef(null);
			const fileRef = useRef(null);

			useEffect(() => {
				saveDoc(doc);
			}, [doc]);

			const active = doc.active;
			const running = active !== null && !active.paused;

			useEffect(() => {
				if (!running) return undefined;
				const handle = window.setInterval(() => setNow(Date.now()), 500);
				return () => window.clearInterval(handle);
			}, [running]);

			useEffect(() => {
				if (active === null || active === undefined) return;
				if (remainingOf(active, now) > 0) return;
				const done = completeActive(doc, now);
				if (done.event === null) return;
				setDoc(done.doc);
				setNow(Date.now());
				beep(done.event.kind);
				const text =
					done.event.kind === 'focus'
						? t('focusDone') + ' · ' + formatMinutes(done.event.minutes, t)
						: t('breakDone');
				setFlash({ text, at: Date.now() });
			}, [now, active, doc, t]);

			useEffect(() => {
				if (flash === null) return undefined;
				window.clearTimeout(flashTimer.current);
				flashTimer.current = window.setTimeout(() => setFlash(null), 7000);
				return () => window.clearTimeout(flashTimer.current);
			}, [flash]);

			const update = useCallback((fold) => {
				setDoc((previous) => fold(previous));
			}, []);

			const startFocus = useCallback(() => {
				const stamp = Date.now();
				setNow(stamp);
				update((previous) => {
					const started = newActive(previous, 'focus', stamp);
					if (started === null) return previous;
					return { ...previous, active: started };
				});
			}, [update]);

			const pause = useCallback(() => {
				update((previous) => {
					if (previous.active === null || previous.active.paused) return previous;
					const left = remainingOf(previous.active, Date.now());
					return { ...previous, active: { ...previous.active, paused: true, remainingMs: left } };
				});
			}, [update]);

			const resume = useCallback(() => {
				const stamp = Date.now();
				setNow(stamp);
				update((previous) => {
					if (previous.active === null || !previous.active.paused) return previous;
					return { ...previous, active: { ...previous.active, paused: false, startedAt: stamp } };
				});
			}, [update]);

			const discard = useCallback(() => {
				update((previous) => (previous.active === null ? previous : { ...previous, active: null }));
			}, [update]);

			const toggleCollapsed = useCallback(() => {
				update((previous) => ({ ...previous, collapsed: !previous.collapsed }));
			}, [update]);

			const addTask = useCallback(
				(event) => {
					if (event !== undefined && event.preventDefault !== undefined) event.preventDefault();
					const title = String(draft).trim().slice(0, 160);
					if (title.length === 0) return;
					const stamp = Date.now();
					update((previous) => {
						const task = {
							id: 't' + stamp.toString(36) + Math.random().toString(36).slice(2, 5),
							title,
							done: false,
							createdAt: stamp,
							doneAt: null,
						};
						return {
							...previous,
							tasks: [...previous.tasks, task].slice(-300),
							selectedTaskId: previous.selectedTaskId === null ? task.id : previous.selectedTaskId,
						};
					});
					setDraft('');
					if (draftRef.current !== null) draftRef.current.focus();
				},
				[draft, update],
			);

			const toggleTask = useCallback(
				(id) => {
					const stamp = Date.now();
					update((previous) => ({
						...previous,
						tasks: previous.tasks.map((task) => {
							if (task.id !== id) return task;
							const done = !task.done;
							return { ...task, done, doneAt: done ? stamp : null };
						}),
					}));
				},
				[update],
			);

			const removeTask = useCallback(
				(id) => {
					update((previous) => ({
						...previous,
						tasks: previous.tasks.filter((task) => task.id !== id),
						selectedTaskId: previous.selectedTaskId === id ? null : previous.selectedTaskId,
					}));
				},
				[update],
			);

			const selectTask = useCallback(
				(id) => {
					update((previous) => ({ ...previous, selectedTaskId: previous.selectedTaskId === id ? null : id }));
				},
				[update],
			);

			const patchSettings = useCallback(
				(patch) => {
					update((previous) => ({ ...previous, settings: { ...previous.settings, ...patch } }));
				},
				[update],
			);

			const distract = useCallback(() => {
				update((previous) => {
					if (previous.active === null || previous.active.phase !== 'focus') return previous;
					return {
						...previous,
						active: { ...previous.active, distractions: previous.active.distractions + 1 },
					};
				});
			}, [update]);

			const notify = useCallback((text) => {
				setFlash({ text, at: Date.now() });
			}, []);

			const exportSnapshot = useCallback(() => {
				try {
					downloadSnapshot(doc);
					notify(t('exported'));
				} catch (error) {
					notify(t('importFail'));
				}
			}, [doc, notify, t]);

			const importSnapshot = useCallback(
				(text) => {
					let incoming = null;
					try {
						incoming = decodeSync(text);
					} catch (error) {
						notify(t('importFail'));
						return;
					}
					const merged = mergeDoc(doc, incoming);
					setDoc(merged.next);
					notify(merged.added > 0 ? t('imported') + ' · ' + merged.added : t('importNone'));
					setSyncOpen(false);
					setSyncText('');
				},
				[doc, notify, t],
			);

			const pickFile = useCallback(() => {
				if (fileRef.current !== null) fileRef.current.click();
			}, []);

			const onFile = useCallback(
				(event) => {
					const file = event.target.files === null ? null : event.target.files[0];
					event.target.value = '';
					if (file === null || file === undefined) return;
					file.text().then(
						(text) => importSnapshot(text),
						() => notify(t('importFail')),
					);
				},
				[importSnapshot, notify, t],
			);

			const copyCode = useCallback(() => {
				const code = encodeSync(doc);
				const clipboard = window.navigator === undefined ? undefined : window.navigator.clipboard;
				try {
					if (clipboard === undefined || typeof clipboard.writeText !== 'function') {
						notify(t('copyFail'));
						return;
					}
					clipboard.writeText(code).then(
						() => notify(t('copied')),
						() => notify(t('copyFail')),
					);
				} catch (error) {
					notify(t('copyFail'));
				}
			}, [doc, notify, t]);

			const openPaste = useCallback(() => {
				setSyncOpen(true);
				const clipboard = window.navigator === undefined ? undefined : window.navigator.clipboard;
				try {
					if (clipboard !== undefined && typeof clipboard.readText === 'function') {
						clipboard.readText().then(
							(text) => {
								if (typeof text === 'string' && text.trim().length > 0) setSyncText(text.trim());
							},
							() => {},
						);
					}
				} catch (error) {
					/* paste-by-hand stays available */
				}
			}, []);

			const todayKey = dayKeyOf(now);
			const minutesToday = minutesOn(doc, todayKey);
			const goal = doc.settings.dailyGoalMinutes;
			const ratio = goal > 0 ? Math.min(1, minutesToday / goal) : 0;
			const todaySessions = doc.sessions.filter((session) => dayKeyOf(session.start) === todayKey);
			const doneToday = doc.tasks.filter((task) => task.done && task.doneAt !== null && dayKeyOf(task.doneAt) === todayKey).length;
			const openCount = doc.tasks.filter((task) => !task.done).length;
			const streak = streakDays(doc, now);
			const selected = doc.tasks.find((task) => task.id === doc.selectedTaskId && !task.done) || null;

			const week = [];
			const cursor = new Date(now);
			cursor.setHours(12, 0, 0, 0);
			cursor.setTime(cursor.getTime() - 6 * DAY);
			for (let index = 0; index < 7; index += 1) {
				const key = dayKeyOf(cursor.getTime());
				week.push({ key, label: String(new Date(cursor.getTime()).getDate()), minutes: minutesOn(doc, key) });
				cursor.setTime(cursor.getTime() + DAY);
			}
			const weekMax = Math.max(60, goal, ...week.map((day) => day.minutes));

			const left = remainingOf(active, now);
			const idle = active === null || active === undefined;
			const displayed = idle ? doc.settings.focusMinutes * MINUTE : left;

			let phaseText = t('idle');
			let dotClass = '';
			if (!idle && active.phase === 'focus') {
				dotClass = 'is-focus';
				phaseText = active.paused ? t('paused') : t('focusing');
			} else if (!idle) {
				dotClass = 'is-break';
				phaseText = t('breaking');
			}

			const primaryLabel = idle ? t('start') : active.phase === 'break' ? t('skipBreak') : active.paused ? t('resume') : t('pause');
			const primaryAction = idle
				? startFocus
				: active.phase === 'break'
					? discard
					: active.paused
						? resume
						: pause;

			const timerClass = idle ? 'is-idle' : active.paused ? 'is-paused' : '';

			return h(
				'div',
				{ className: 'ssv-root', 'data-study-supervisor': 'root' },
				h('style', { key: 'ssv-style' }, CSS),
				h(
					'div',
					{ className: 'ssv-bar' },
					h(
						'div',
						{ className: 'ssv-status' },
						h('span', { className: 'ssv-dot ' + dotClass }),
						h('span', { className: 'ssv-label' }, t('title')),
					),
					h('span', { className: 'ssv-timer ' + timerClass, 'data-study-timer': true }, clockText(displayed)),
					h(
						'span',
						{ className: 'ssv-phase' + (flash !== null ? ' is-alert' : '') },
						flash !== null ? flash.text : phaseText,
					),
					goal > 0
						? h(
								'div',
								{ className: 'ssv-goal' },
								h(
									'div',
									{ className: 'ssv-progress' + (ratio >= 1 ? ' is-done' : '') },
									h('i', { style: { width: Math.round(ratio * 100) + '%' } }),
								),
								h(
									'span',
									{ className: 'ssv-goaltext' },
									formatMinutes(minutesToday, t) + ' / ' + formatMinutes(goal, t),
								),
							)
						: null,
					h(
						'div',
						{ className: 'ssv-taskchip' },
						selected !== null
							? h(
									'button',
									{
										type: 'button',
										title: t('pickHint'),
										onClick: () => selectTask(selected.id),
									},
									'◎ ' + selected.title,
								)
							: h('button', { type: 'button', className: 'ssv-muted', disabled: true }, t('noTask')),
					),
					h(
						'span',
						{ className: 'ssv-chip', title: t('last7') },
						t('streak') + ' ' + streak + t('streakUnit'),
					),
					h(
						'div',
						{ className: 'ssv-actions' },
						!idle && active.phase === 'focus' && !active.paused
							? h(
									'button',
									{ type: 'button', className: 'ssv-btn ssv-btn--ghost', onClick: distract, title: t('distraction') },
									t('distraction'),
									h('span', { className: 'ssv-chip' }, String(active.distractions)),
								)
							: null,
						!idle ? h('button', { type: 'button', className: 'ssv-btn', onClick: discard }, t('discard')) : null,
						h(
							'button',
							{ type: 'button', className: 'ssv-btn ssv-btn--primary', onClick: primaryAction },
							primaryLabel,
						),
						h(
							'button',
							{
								type: 'button',
								className: 'ssv-btn ssv-btn--icon ssv-btn--ghost',
								onClick: toggleCollapsed,
								'aria-label': doc.collapsed ? t('expand') : t('collapse'),
								title: doc.collapsed ? t('expand') : t('collapse'),
							},
							doc.collapsed ? '▴' : '▾',
						),
					),
				),
				doc.collapsed
					? null
					: h(
							'div',
							{ className: 'ssv-panel' },
							h(
								'div',
								{ className: 'ssv-col' },
								h(
									'div',
									{ className: 'ssv-h' },
									h('span', null, t('tasks')),
									h('span', null, openCount + ' / ' + doc.tasks.length),
								),
								h(
									'form',
									{ className: 'ssv-addrow', onSubmit: addTask },
									h('input', {
										className: 'ssv-input',
										ref: draftRef,
										value: draft,
										maxLength: 160,
										placeholder: t('addPlaceholder'),
										onChange: (event) => setDraft(event.target.value),
									}),
									h(
										'button',
										{ type: 'submit', className: 'ssv-btn ssv-btn--ghost', disabled: draft.trim().length === 0 },
										t('add'),
									),
								),
								h(
									'div',
									{ className: 'ssv-list' },
									doc.tasks.length === 0
										? h('div', { className: 'ssv-empty' }, t('empty'))
										: doc.tasks.map((task) =>
												h(
													'div',
													{
														key: task.id,
														className:
															'ssv-task' +
															(task.id === doc.selectedTaskId ? ' is-selected' : '') +
															(task.done ? ' is-done' : ''),
													},
													h(
														'button',
														{
															type: 'button',
															className: 'ssv-check',
															role: 'checkbox',
															'aria-checked': task.done ? 'true' : 'false',
															'aria-label': t('markDone'),
															onClick: () => toggleTask(task.id),
														},
														task.done ? '✓' : '',
													),
													h(
														'button',
														{
															type: 'button',
															className: 'ssv-tasktitle',
															title: t('pickHint'),
															onClick: () => selectTask(task.id),
														},
														task.title,
													),
													h(
														'button',
														{
															type: 'button',
															className: 'ssv-x',
															'aria-label': t('delete'),
															title: t('delete'),
															onClick: () => removeTask(task.id),
														},
														'×',
													),
												),
											),
								),
							),
							h(
								'div',
								{ className: 'ssv-col' },
								h('div', { className: 'ssv-h' }, h('span', null, t('today'))),
								h(
									'div',
									{ className: 'ssv-stats' },
									h(
										'div',
										{ className: 'ssv-stat' },
										h('b', null, formatMinutes(minutesToday, t)),
										h('span', null, t('focusTime')),
									),
									h(
										'div',
										{ className: 'ssv-stat' },
										h('b', null, String(todaySessions.length)),
										h('span', null, t('pomodoros')),
									),
									h(
										'div',
										{ className: 'ssv-stat' },
										h('b', null, String(doneToday)),
										h('span', null, t('tasksDone')),
									),
								),
								h('div', { className: 'ssv-h' }, h('span', null, t('last7'))),
								h(
									'div',
									{ className: 'ssv-week' },
									week.map((day) =>
										h(
											'div',
											{
												key: day.key,
												className: 'ssv-day' + (day.key === todayKey ? ' is-today' : ''),
												title: formatMinutes(day.minutes, t),
											},
											h(
												'div',
												{
													className: 'ssv-daybar',
													style: { height: Math.max(2, Math.round((day.minutes / weekMax) * 100)) + '%' },
												},
											),
											h('div', { className: 'ssv-daylabel' }, day.label),
										),
									),
								),
							),
							h(
								'div',
								{ className: 'ssv-col' },
								h('div', { className: 'ssv-h' }, h('span', null, t('settings'))),
								h(
									'div',
									{ className: 'ssv-setrow' },
									h('label', null, t('focusLen')),
									h(
										'select',
										{
											className: 'ssv-select',
											value: String(doc.settings.focusMinutes),
											onChange: (event) => patchSettings({ focusMinutes: Number(event.target.value) }),
										},
										[15, 20, 25, 30, 45, 50, 60, 90].map((value) =>
											h('option', { key: value, value: String(value) }, value + ' ' + t('minutesUnit')),
										),
									),
								),
								h(
									'div',
									{ className: 'ssv-setrow' },
									h('label', null, t('breakLen')),
									h(
										'select',
										{
											className: 'ssv-select',
											value: String(doc.settings.breakMinutes),
											onChange: (event) => patchSettings({ breakMinutes: Number(event.target.value) }),
										},
										[0, 5, 10, 15, 20].map((value) =>
											h('option', { key: value, value: String(value) }, value + ' ' + t('minutesUnit')),
										),
									),
								),
								h(
									'div',
									{ className: 'ssv-setrow' },
									h('label', null, t('dailyGoal')),
									h(
										'select',
										{
											className: 'ssv-select',
											value: String(doc.settings.dailyGoalMinutes),
											onChange: (event) => patchSettings({ dailyGoalMinutes: Number(event.target.value) }),
										},
										[0, 30, 60, 90, 120, 180, 240, 300].map((value) =>
											h('option', { key: value, value: String(value) }, formatMinutes(value, t)),
										),
									),
								),
								h(
									'div',
									{ className: 'ssv-setrow' },
									h('label', null, t('autoBreak')),
									h('button', {
										type: 'button',
										className: 'ssv-switch' + (doc.settings.autoBreak ? ' is-on' : ''),
										role: 'switch',
										'aria-checked': doc.settings.autoBreak ? 'true' : 'false',
										'aria-label': t('autoBreak'),
										onClick: () => patchSettings({ autoBreak: !doc.settings.autoBreak }),
									}),
								),
								h('div', { className: 'ssv-h' }, h('span', null, t('sync'))),
								h(
									'div',
									{ className: 'ssv-syncrow' },
									h('button', { type: 'button', className: 'ssv-btn ssv-btn--ghost', onClick: exportSnapshot }, t('exportFile')),
									h('button', { type: 'button', className: 'ssv-btn ssv-btn--ghost', onClick: pickFile }, t('importFile')),
									h('button', { type: 'button', className: 'ssv-btn ssv-btn--ghost', onClick: copyCode }, t('copyCode')),
									h(
										'button',
										{
											type: 'button',
											className: 'ssv-btn ssv-btn--ghost',
											onClick: syncOpen ? () => setSyncOpen(false) : openPaste,
										},
										syncOpen ? t('cancel') : t('pasteCode'),
									),
								),
								h('input', {
									ref: fileRef,
									type: 'file',
									accept: 'application/json,.json,.txt',
									style: { display: 'none' },
									onChange: onFile,
								}),
								syncOpen
									? h(
											'div',
											{ className: 'ssv-syncbox' },
											h('textarea', {
												className: 'ssv-textarea',
												rows: 3,
												value: syncText,
												placeholder: t('codePlaceholder'),
												onChange: (event) => setSyncText(event.target.value),
											}),
											h(
												'div',
												{ className: 'ssv-syncactions' },
												h('span', { className: 'ssv-hint' }, t('syncHint')),
												h(
													'button',
													{
														type: 'button',
														className: 'ssv-btn ssv-btn--primary',
														disabled: syncText.trim().length === 0,
														onClick: () => importSnapshot(syncText),
													},
													t('syncImport'),
												),
											),
										)
									: null,
							),
						),
			);
		}

		/* ── plugin ─────────────────────────────────────────────────────── */

		const inject = ['slots', 'locale'];

		function apply(ctx) {
			const listeners = new Set();
			ctx.effect(
				() =>
					ctx.locale.register(NS, {
						zh,
						en,
					}),
				'study-supervisor: dictionary',
			);
			const t = ctx.locale.bind(NS);
			ctx.effect(
				() =>
					ctx.on('locale/change', () => {
						for (const listener of [...listeners]) listener();
					}),
				'study-supervisor: locale relay',
			);

			function View() {
				const [, setRevision] = useState(0);
				useEffect(() => {
					const listener = () => setRevision((value) => value + 1);
					listeners.add(listener);
					return () => {
						listeners.delete(listener);
					};
				}, []);
				return h(StudySupervisor, { t });
			}

			ctx.slots.inject('shell.bottom', () =>
				ctx.slots.register({ name: 'shell.bottom' }, View),
			);
		}

		/* `__test` is inert for Cordis; the headless smoke test exercises the pure helpers. */
		return { inject, apply, __test: { encodeSync, decodeSync, mergeDoc, sanitize, emptyDoc } };
	},
});
