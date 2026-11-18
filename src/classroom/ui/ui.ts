// HUD + menus (plain DOM). The sim's numbers stay hidden: danger is shown as readable cues (the
// teacher's gaze, an edge tint) instead of meters. Relationships live on a notebook page.
import ASSET_CREDITS from '../data/asset-credits.json';
import { CAST, LESSONS, NOTES, PLAYABLE_LESSON_TYPES, TEACHERS } from '../sim/data';
import { gradeAverage, letter, type StudentRecord } from '../sim/record';
import type { CaughtCard } from '../sim/world';
import { PRESET_ORDER, type PresetId, type Settings } from '../quality';
import {
  ACTION_LABELS,
  BINDING_GROUPS,
  type Device,
  HINTS,
  type IdeaSection,
  keyName,
  lessonBlurb,
  type KeyLabels,
  teacherBlurb,
  visibleBindings,
} from './content';
import { NOTES_ENABLED, visibleChallenges } from './flags';
import { CSS } from './style';

export interface HudChip {
  text: string;
  warn?: boolean;
  /** 0..1 progress bar under the text. */
  bar?: number;
}

export interface HudState {
  clock: string;
  lesson: string;
  phase: string;
  /** Game minutes left in the lesson, and 0..1 progress. */
  minutesLeft: number;
  progress: number;
  teacher: string;
  teacherLabel: string;
  prompt: {
    key: string;
    label: string;
    target: string;
    risk?: 'loud' | 'risky';
    more: number;
    nextKey: string;
    ghosts: { name: string; reason: string }[];
  } | null;
  chips: HudChip[];
  charge: number | null;
  showCross: boolean;
  /** Teacher attention as something you could see: 0..1 gaze-on-you, strong = actively watching. */
  gaze: { level: number; strong: boolean; name: string };
  strikes: number;
  keyHints: string;
}

export type Btn = [label: string, fn: () => void, alt?: boolean];

const HINT_KEY = 'modulo-classroom:hints:v1';

function loadSeen(): Set<string> {
  try {
    return new Set(JSON.parse(localStorage.getItem(HINT_KEY) ?? '[]') as string[]);
  } catch {
    return new Set();
  }
}

export class UI {
  readonly root: HTMLDivElement;
  private tl: HTMLDivElement;
  private tr: HTMLDivElement;
  private prompt: HTMLDivElement;
  private subs: HTMLDivElement;
  private toasts: HTMLDivElement;
  private status: HTMLDivElement;
  private cross: HTMLDivElement;
  private banner: HTMLDivElement;
  private chargeEl: HTMLDivElement;
  private gazeEl: HTMLDivElement;
  private vignette: HTMLDivElement;
  private tipEl: HTMLDivElement | null = null;
  private card: HTMLDivElement | null = null;
  private menuEl: HTMLDivElement | null = null;
  private seen = loadSeen();
  private lastHud = '';
  subtitlesOn = true;
  hintsOn = true;
  touch = false;

  constructor() {
    const style = document.createElement('style');
    style.textContent = CSS;
    document.head.appendChild(style);
    this.root = document.createElement('div');
    this.root.className = 'ui';
    const mk = (cls: string) => {
      const d = document.createElement('div');
      d.className = cls;
      this.root.appendChild(d);
      return d;
    };
    this.vignette = mk('vignette');
    this.tl = mk('hud-tl');
    this.tr = mk('hud-tr');
    this.gazeEl = mk('gaze');
    this.cross = mk('cross');
    this.prompt = mk('prompt');
    this.subs = mk('subs');
    this.toasts = mk('toasts');
    this.status = mk('status');
    this.banner = mk('banner');
    this.chargeEl = mk('charge');
    this.chargeEl.innerHTML = '<i></i>';
    this.gazeEl.setAttribute('role', 'status');
    document.body.appendChild(this.root);
  }

  setScale(s: number): void {
    document.documentElement.style.setProperty('--ui', String(s));
  }

  setReducedMotion(on: boolean): void {
    this.root.classList.toggle('rm', on);
  }

  setHudVisible(v: boolean): void {
    for (const el of [
      this.tl,
      this.tr,
      this.prompt,
      this.status,
      this.cross,
      this.chargeEl,
      this.gazeEl,
      this.vignette,
    ])
      el.style.display = v ? '' : 'none';
    if (!v) this.hideTip();
  }

  update(h: HudState): void {
    // Rebuild only when something visible changed (keeps taps/clicks on the DOM stable).
    const sig = JSON.stringify([
      h.clock,
      h.lesson,
      h.phase,
      Math.round(h.minutesLeft),
      Math.round(h.progress * 100),
      h.teacher,
      h.prompt,
      h.chips,
      h.strikes,
      h.keyHints,
      h.gaze.name,
    ]);
    if (sig !== this.lastHud) {
      this.lastHud = sig;
      const left = Math.max(0, Math.ceil(h.minutesLeft));
      this.tl.innerHTML = `<div class="hud-row"><span class="hud-clock">${esc(h.clock)}</span><span class="hud-left">${left} min left</span></div>
        <div class="hud-lesson">${esc(h.lesson)}</div><div class="hud-phase">${esc(h.phase)}</div>
        <div class="hud-bar"><i style="width:${Math.round(h.progress * 100)}%"></i></div>
        <div class="hud-teacher">Teacher: <b>${esc(h.teacher)}</b>${h.teacherLabel ? ` (${esc(h.teacherLabel)})` : ''}</div>`;
      const pips = [0, 1, 2]
        .map(
          (i) =>
            `<span class="${i < h.strikes ? 'on' : 'off'}">${i < h.strikes ? '●' : '○'}</span>`,
        )
        .join('');
      this.tr.innerHTML = `<div class="hud-chip" title="Strikes on your record. Three means detention.">Strikes <span class="pips">${pips}</span></div>${h.keyHints ? `<div class="keyhints">${h.keyHints}</div>` : ''}`;
      this.prompt.innerHTML = h.prompt ? this.promptHtml(h.prompt) : '';
      this.status.innerHTML = h.chips
        .map(
          (c) =>
            `<div class="chip${c.warn ? ' warn' : ''}">${esc(c.text)}${c.bar !== undefined ? `<div class="bar"><i style="width:${Math.round(c.bar * 100)}%"></i></div>` : ''}</div>`,
        )
        .join('');
    }
    this.cross.style.display = h.showCross ? '' : 'none';
    // Teacher gaze: icon + text + edge tint (never a number).
    const on = h.gaze.level > 0.15;
    this.gazeEl.classList.toggle('on', on);
    this.gazeEl.classList.toggle('strong', h.gaze.strong);
    if (on)
      this.gazeEl.innerHTML = `<span class="eye"></span><span>${esc(h.gaze.name)} ${h.gaze.strong ? 'is watching you' : 'is looking your way'}</span>`;
    this.vignette.classList.toggle('strong', h.gaze.strong);
    this.vignette.style.opacity = on
      ? String(Math.min(1, h.gaze.level * (h.gaze.strong ? 1 : 0.8)))
      : '0';
    this.chargeEl.style.display = h.charge !== null ? '' : 'none';
    if (h.charge !== null)
      (this.chargeEl.firstChild as HTMLElement).style.width = `${Math.round(h.charge * 100)}%`;
  }

  private promptHtml(p: NonNullable<HudState['prompt']>): string {
    const risk =
      p.risk === 'loud'
        ? '<div class="warn loud">Loud: everyone nearby will hear it</div>'
        : p.risk === 'risky'
          ? '<div class="warn">Risky: counts against you if the teacher sees</div>'
          : '';
    const more =
      p.more > 1
        ? `<div class="more">${this.touch ? `Tap <kbd>${esc(p.nextKey)}</kbd>` : `<kbd>${esc(p.nextKey)}</kbd> or wheel`} for ${p.more - 1} more option${p.more > 2 ? 's' : ''}</div>`
        : '';
    const ghosts = p.ghosts
      .map((g) => `<div class="ghost">Not now: ${esc(g.name)} (${esc(g.reason)})</div>`)
      .join('');
    return `<div class="main"><kbd>${esc(p.key)}</kbd><span>${esc(p.label)}</span></div><div class="tname">${esc(p.target)}</div>${risk}${more}${ghosts}`;
  }

  subtitle(speaker: string, text: string, cue = false): void {
    if (cue && !this.subtitlesOn) return;
    const d = document.createElement('div');
    d.className = `sub${cue ? ' cue' : ''}`;
    d.innerHTML = cue ? esc(text) : `<b>${esc(speaker)}:</b> ${esc(text)}`;
    this.subs.appendChild(d);
    while (this.subs.children.length > 4) this.subs.firstChild?.remove();
    setTimeout(() => (d.style.opacity = '0'), 3600);
    setTimeout(() => d.remove(), 4100);
  }

  toast(text: string, ms = 2600): void {
    const d = document.createElement('div');
    d.className = 'toast';
    d.textContent = text;
    this.toasts.appendChild(d);
    while (this.toasts.children.length > 3) this.toasts.firstChild?.remove();
    setTimeout(() => (d.style.opacity = '0'), ms);
    setTimeout(() => d.remove(), ms + 600);
  }

  showBanner(text: string): void {
    this.banner.textContent = text;
    this.banner.style.opacity = '1';
    setTimeout(() => (this.banner.style.opacity = '0'), 2200);
  }

  caught(card: CaughtCard): void {
    this.card?.remove();
    const d = document.createElement('div');
    d.className = 'card';
    d.innerHTML = `<span class="x" role="button" aria-label="Close">✕</span><h3>${esc(card.title)}</h3><ul>${card.lines.map((l) => `<li>${esc(l)}</li>`).join('')}</ul>`;
    d.querySelector('.x')!.addEventListener('click', () => d.remove());
    this.root.appendChild(d);
    this.card = d;
    setTimeout(() => d.remove(), 9000);
  }

  // ------------------------------------------------------------------------------------------
  // First-lesson hints: each shows once, ever (persisted), one at a time.

  /** Shows the hint if it has never been shown and none is on screen. Returns true if shown. */
  tryHint(id: string, k: KeyLabels): boolean {
    const def = HINTS[id];
    if (!def || !this.hintsOn || this.seen.has(id) || this.tipEl || this.menuEl) return false;
    this.seen.add(id);
    this.saveSeen();
    const d = document.createElement('div');
    d.className = 'tip';
    d.setAttribute('role', 'status');
    d.innerHTML = `<b>Tip</b>${esc(def.text(k, this.touch ? 'touch' : 'keyboard'))}<button type="button">Got it</button>`;
    d.querySelector('button')!.addEventListener('click', () => this.hideTip());
    this.root.appendChild(d);
    this.tipEl = d;
    setTimeout(() => {
      if (this.tipEl === d) this.hideTip();
    }, 14000);
    return true;
  }

  hideTip(): void {
    this.tipEl?.remove();
    this.tipEl = null;
  }

  resetHints(): void {
    this.seen.clear();
    this.saveSeen();
  }

  private saveSeen(): void {
    try {
      localStorage.setItem(HINT_KEY, JSON.stringify([...this.seen]));
    } catch {
      /* private mode */
    }
  }

  // ------------------------------------------------------------------------------------------
  // Menus

  get menuOpen(): boolean {
    return this.menuEl !== null;
  }

  closeMenu(): void {
    this.menuEl?.remove();
    this.menuEl = null;
  }

  private open(
    html: string,
    buttons: Btn[] = [],
    opts: { wide?: boolean; column?: boolean; label?: string } = {},
  ): HTMLDivElement {
    this.closeMenu();
    this.hideTip();
    const m = document.createElement('div');
    m.className = 'menu';
    const p = document.createElement('div');
    p.className = `panel${opts.wide ? ' wide' : ''}`;
    p.setAttribute('role', 'dialog');
    p.setAttribute('aria-modal', 'true');
    if (opts.label) p.setAttribute('aria-label', opts.label);
    p.innerHTML = html;
    if (buttons.length) {
      const row = document.createElement('div');
      row.className = `btns${opts.column ? ' col' : ''}`;
      for (const [label, fn, alt] of buttons) {
        const b = document.createElement('button');
        b.type = 'button';
        b.className = `btn${alt ? ' alt' : ''}`;
        b.textContent = label;
        b.addEventListener('click', fn);
        row.appendChild(b);
      }
      p.appendChild(row);
    }
    m.appendChild(p);
    document.body.appendChild(m);
    this.menuEl = m;
    return p;
  }

  title(opts: {
    record: StudentRecord;
    hasSave: boolean;
    detention: boolean;
    seed: string;
    prefill?: { lesson?: string; teacher?: string };
    controls: [string, string][];
    onStart: (cfg: {
      lesson: string;
      teacher: string;
      seed: string;
      cheatSheet: boolean;
      wishlist: string[];
    }) => void;
    onReset: () => void;
    onSettings: () => void;
    onCredits: () => void;
    onControls: () => void;
  }): void {
    const r = opts.record;
    const lessonOpts = ['random', ...PLAYABLE_LESSON_TYPES]
      .map(
        (t) =>
          `<option value="${t}">${t === 'random' ? 'Surprise me' : esc(LESSONS.types[t]!.label)}</option>`,
      )
      .join('');
    const teacherOpts = ['random', ...TEACHERS.map((t) => t.id)]
      .map((t) => {
        const T = TEACHERS.find((x) => x.id === t);
        return `<option value="${t}">${T ? `${esc(T.label)}: ${esc(T.name)}` : 'Surprise me'}</option>`;
      })
      .join('');
    const avg = gradeAverage(r);
    const active = new Set(r.wishlist.active);
    const wl = visibleChallenges()
      .map(
        (c) =>
          `<button type="button" class="pick${active.has(c.id) ? ' on' : ''}" data-wl="${c.id}" aria-pressed="${active.has(c.id)}">${esc(c.text)}${r.wishlist.done.includes(c.id) ? ' ✓' : ''}</button>`,
      )
      .join('');
    const rec = `Day ${r.day}, lesson ${r.lessonInDay + 1} of ${r.lessonsPerDay} · ${r.strikes === 0 ? 'clean record' : `${r.strikes} strike${r.strikes > 1 ? 's' : ''}`}${r.detentions ? ` · ${r.detentions} detention${r.detentions > 1 ? 's' : ''}` : ''}${r.callsHome ? ` · ${r.callsHome} call${r.callsHome > 1 ? 's' : ''} home` : ''}${avg !== null ? ` · grades ${avg.toFixed(0)}% (${letter(avg)})` : ''}`;
    const p = this.open(
      `
      <h1>Modulo: Classroom</h1>
      <p class="sub2">A sandbox about one classroom. There is no score and no game over: try things and see what happens.</p>
      <div class="cols">
        <div>
          <h2>How to play</h2>
          <div class="how"><ul>
            <li><b>Have fun in class:</b> sneak a game or a video, copy in a test, pull harmless pranks, make friends.</li>
            <li><b>Watch the teacher:</b> when they look your way, a warning appears. Hide your screen or sit still.</li>
            <li><b>Getting noticed costs strikes:</b> warning, written warning, detention, call home. Clean lessons heal them.</li>
          </ul></div>
          <h2>Controls</h2>
          <table class="rep">${opts.controls.map(([a, b]) => `<tr><td><b>${esc(a)}</b></td><td>${esc(b)}</td></tr>`).join('')}</table>
          <p class="sub2"><button type="button" class="btn small alt" id="t-controls">Show all controls</button></p>
        </div>
        <div>
          <h2>Start a lesson</h2>
          <p class="sub2">${esc(rec)}</p>
          ${
            opts.detention
              ? '<p><b>Detention is pending, so this lesson is detention.</b></p>'
              : `
          <div class="field"><label for="t-lesson">Lesson</label><select id="t-lesson">${lessonOpts}</select><div class="hint" id="t-lesson-hint"></div></div>
          <div class="field"><label for="t-teacher">Teacher</label><select id="t-teacher">${teacherOpts}</select><div class="hint" id="t-teacher-hint"></div></div>`
          }
          <div class="field"><label>Your goals (optional, up to 3)</label><div class="grid2">${wl}</div></div>
          <details class="more"><summary>More options</summary>
            <div class="field"><label for="t-seed">Seed (same seed, same lesson)</label><input id="t-seed" type="text" value="${esc(opts.seed)}" size="12"></div>
            <label class="check"><input id="t-cheat" type="checkbox"><span>Pack a cheat sheet. Only useful in tests.</span></label>
          </details>
        </div>
      </div>
    `,
      [
        [
          'Start lesson',
          () => {
            const q = (id: string) =>
              (p.querySelector(id) as HTMLInputElement | HTMLSelectElement | null)?.value ??
              'random';
            const picked = [...p.querySelectorAll('.pick.on')].map(
              (b) => (b as HTMLElement).dataset.wl!,
            );
            opts.onStart({
              lesson: q('#t-lesson'),
              teacher: q('#t-teacher'),
              seed: q('#t-seed'),
              cheatSheet: (p.querySelector('#t-cheat') as HTMLInputElement).checked,
              wishlist: picked,
            });
          },
        ],
        ['Settings', opts.onSettings, true],
        ['Credits', opts.onCredits, true],
        ...(opts.hasSave ? ([['Reset record', opts.onReset, true]] as Btn[]) : []),
      ],
      { wide: true, label: 'Modulo: Classroom' },
    );
    p.querySelector('.btns .btn')?.classList.add('big');
    p.querySelector('#t-controls')?.addEventListener('click', opts.onControls);
    for (const b of p.querySelectorAll('.pick')) {
      b.addEventListener('click', () => {
        const on = p.querySelectorAll('.pick.on').length;
        if (!b.classList.contains('on') && on >= 3) return;
        b.classList.toggle('on');
        b.setAttribute('aria-pressed', String(b.classList.contains('on')));
      });
    }
    const bind = (sel: string, hint: string, fn: (v: string) => string) => {
      const s = p.querySelector(sel) as HTMLSelectElement | null;
      const h = p.querySelector(hint);
      if (!s || !h) return;
      const upd = () => (h.textContent = fn(s.value));
      s.addEventListener('change', upd);
      upd();
    };
    for (const [id, v] of [
      ['#t-lesson', opts.prefill?.lesson],
      ['#t-teacher', opts.prefill?.teacher],
    ] as const) {
      const s = p.querySelector(id) as HTMLSelectElement | null;
      if (s && v && [...s.options].some((o) => o.value === v)) s.value = v;
    }
    bind('#t-lesson', '#t-lesson-hint', lessonBlurb);
    bind('#t-teacher', '#t-teacher-hint', teacherBlurb);
    (p.querySelector('.btns .btn') as HTMLElement | null)?.focus({ preventScroll: true });
  }

  pause(h: {
    summary: string;
    seedLink: string;
    wishlist: string;
    onResume: () => void;
    onIdeas: () => void;
    onNotebook: () => void;
    onSettings: () => void;
    onControls: () => void;
    onCredits: () => void;
    onEnd: () => void;
  }): void {
    let leave: HTMLButtonElement | null = null;
    const p = this.open(
      `<h1>Paused</h1>
      <p class="sub2">${esc(h.summary)}</p>
      ${h.wishlist ? `<h2>Your goals</h2>${h.wishlist}` : ''}
      <details class="more"><summary>Share this lesson</summary>
        <p class="sub2">Same seed, same events:</p>
        <div class="row"><input type="text" readonly value="${esc(h.seedLink)}" style="flex:1;min-width:0" id="seedlink" aria-label="Lesson link"><button type="button" class="btn small alt" id="copy">Copy</button></div>
      </details>`,
      [
        ['Resume', h.onResume],
        ['Ideas: things to try', h.onIdeas, true],
        ['Notebook: who likes you', h.onNotebook, true],
        ['Controls', h.onControls, true],
        ['Settings', h.onSettings, true],
        ['Credits', h.onCredits, true],
        [
          'Leave lesson',
          () => {
            if (leave && leave.dataset.sure !== '1') {
              leave.dataset.sure = '1';
              leave.textContent = 'Really leave? Your record is kept';
              leave.classList.add('danger');
              return;
            }
            h.onEnd();
          },
          true,
        ],
      ],
      { column: true, label: 'Paused' },
    );
    leave = [...p.querySelectorAll<HTMLButtonElement>('.btns .btn')].pop() ?? null;
    p.querySelector('#copy')?.addEventListener('click', () => {
      void navigator.clipboard?.writeText(h.seedLink).catch(() => undefined);
      (p.querySelector('#seedlink') as HTMLInputElement).select();
    });
    (p.querySelector('.btns .btn') as HTMLElement | null)?.focus({ preventScroll: true });
  }

  notebook(r: StudentRecord, debug: boolean, onClose: () => void): void {
    const mood = (a: number) =>
      a >= 50
        ? 'friend ♥'
        : a >= 20
          ? 'likes you'
          : a >= -10
            ? 'neutral'
            : a >= -40
              ? 'annoyed'
              : 'can’t stand you';
    const colors = ['#fff59d', '#ffcc80', '#b2ebf2', '#c5e1a5', '#f8bbd0'];
    const notes = CAST.students
      .map((s, i) => {
        const a = r.affinity[s.id] ?? s.affinity;
        const mem = r.memories
          .filter((m) => m.who === s.id)
          .slice(-2)
          .map((m) => `<div class="mem">${m.delta > 0 ? '+' : '–'} ${esc(m.text)}</div>`)
          .join('');
        const friends = CAST.students
          .filter((o) => o.id !== s.id && (r.npcAffinity[`${s.id}>${o.id}`] ?? 0) > 25)
          .map((o) => o.name);
        return `<div class="sticky" style="background:${colors[i % colors.length]};--r:${((i * 37) % 7) - 3}deg"><span class="face" style="background:${s.color}"></span><b>${esc(s.name)}</b>${mood(a)}${debug ? ` <small>(${a.toFixed(0)})</small>` : ''}${friends.length ? `<div class="mem">hangs out with ${friends.join(', ')}</div>` : ''}${mem}</div>`;
      })
      .join('');
    this.open(
      `<h1>Notebook</h1><p class="sub2">How classmates feel about you. Chat, share a laugh, or sit in someone’s chair and it changes.</p><div class="nb">${notes}</div><p class="sub2">Each note also shows who they hang out with and their latest memory of you.</p>`,
      [['Close', onClose]],
      { wide: true, label: 'Notebook' },
    );
  }

  /** Optional note composer. Only reachable when NOTES_ENABLED. */
  noteComposer(
    students: { id: string; name: string }[],
    onSend: (tpl: string, to: string) => void,
    onClose: () => void,
  ): void {
    if (!NOTES_ENABLED) return onClose();
    const tpl = NOTES.map(
      (n, i) =>
        `<button type="button" class="pick${i === 0 ? ' on' : ''}" data-t="${n.id}">${esc(n.text)}</button>`,
    ).join('');
    const to = students
      .map(
        (s, i) =>
          `<button type="button" class="pick${i === 0 ? ' on' : ''}" data-s="${s.id}">${esc(s.name)}</button>`,
      )
      .join('');
    const p = this.open(
      `<h1>Pass a note</h1><p class="sub2">It travels hand to hand. Every link can pass it on, read it, refuse it… or hand it to the teacher.</p><h2>Write</h2><div class="grid2">${tpl}</div><h2>To</h2><div class="grid2">${to}</div>`,
      [
        [
          'Send',
          () => {
            const t = (p.querySelector('[data-t].on') as HTMLElement)?.dataset.t;
            const s = (p.querySelector('[data-s].on') as HTMLElement)?.dataset.s;
            if (t && s) onSend(t, s);
          },
        ],
        ['Cancel', onClose, true],
      ],
    );
    for (const attr of ['t', 's'])
      for (const b of p.querySelectorAll(`[data-${attr}]`))
        b.addEventListener('click', () => {
          p.querySelectorAll(`[data-${attr}]`).forEach((x) => x.classList.remove('on'));
          b.classList.add('on');
        });
  }

  settings(
    s: Settings,
    onChange: (s: Settings) => void,
    onClose: () => void,
    extra: { onResetHints: () => void } = { onResetHints: () => undefined },
  ): void {
    const presets = [...PRESET_ORDER, 'custom']
      .map(
        (p) =>
          `<option value="${p}"${p === s.preset ? ' selected' : ''}>${p === 'battery' ? 'Battery Saver' : p[0]!.toUpperCase() + p.slice(1)}</option>`,
      )
      .join('');
    const range = (
      id: string,
      label: string,
      min: number,
      max: number,
      step: number,
      v: number,
      unit: string,
    ) =>
      `<div class="row"><label for="${id}">${label}</label><input id="${id}" type="range" min="${min}" max="${max}" step="${step}" value="${v}" data-unit="${unit}"><output for="${id}">${fmtRange(v, unit)}</output></div>`;
    const check = (id: string, on: boolean, text: string) =>
      `<label class="check"><input id="${id}" type="checkbox"${on ? ' checked' : ''}><span>${text}</span></label>`;
    const keys = BINDING_GROUPS.map(([group, actions]) => {
      const present = actions.filter((a) => visibleBindings(s.bindings).includes(a));
      return `<h3>${group}</h3><div class="keylist">${present
        .map(
          (a) =>
            `<button type="button" class="pick" data-a="${a}">${esc(ACTION_LABELS[a] ?? a)}: <kbd>${esc(keyName(s.bindings[a]!))}</kbd></button>`,
        )
        .join('')}</div>`;
    }).join('');
    const p = this.open(
      `<h1>Settings</h1>
      <section class="grp"><h2>Graphics</h2>
        <div class="row"><label for="s-preset">Quality</label><select id="s-preset">${presets}</select></div>
        ${range('s-fov', 'Field of view', 55, 100, 1, s.fov, '°')}
        ${check('s-wd', s.watchdog, 'Lower quality automatically if frames are slow')}
      </section>
      <section class="grp"><h2>Controls</h2>
        ${range('s-sens', 'Look sensitivity', 0.3, 2.5, 0.1, s.sensitivity, '×')}
        ${check('s-inv', s.invertY, 'Invert look up/down')}
        <div class="row"><label for="s-touch">Touch controls</label><select id="s-touch">${(['auto', 'on', 'off'] as const).map((x) => `<option value="${x}"${x === s.touchControls ? ' selected' : ''}>${{ auto: 'Automatic (on touch screens)', on: 'Always on', off: 'Off' }[x]}</option>`).join('')}</select></div>
        <h3>Keys</h3><p class="sub2">Click one, then press the new key. Esc cancels.</p>${keys}
      </section>
      <section class="grp"><h2>Audio</h2>
        ${range('s-vol', 'Volume', 0, 1, 0.05, s.volume, '%')}
      </section>
      <section class="grp"><h2>Accessibility</h2>
        ${range('s-ui', 'Text and UI size', 0.8, 1.6, 0.05, s.uiScale, '×')}
        ${check('s-subs', s.subtitles, 'Captions for sound cues (“footsteps approaching”)')}
        ${check('s-rm', s.reducedMotion, 'Reduce motion: no head bob, no camera roll, no fades')}
        ${check('s-hints', s.showHints, 'Show first-lesson tips')}
        <div class="row"><button type="button" class="btn small alt" id="s-hints-reset">Show all tips again</button></div>
      </section>
      <section class="grp"><h2>Player</h2>
        <div class="row"><label for="s-name">Your name</label><input id="s-name" type="text" value="${esc(s.playerName)}" maxlength="16"></div>
      </section>`,
      [['Done', onClose]],
      { label: 'Settings' },
    );
    const get = <T extends HTMLElement>(id: string) => p.querySelector(id) as T;
    const apply = () => {
      const n: Settings = {
        ...s,
        preset: get<HTMLSelectElement>('#s-preset').value as PresetId,
        fov: Number(get<HTMLInputElement>('#s-fov').value),
        sensitivity: Number(get<HTMLInputElement>('#s-sens').value),
        volume: Number(get<HTMLInputElement>('#s-vol').value),
        uiScale: Number(get<HTMLInputElement>('#s-ui').value),
        playerName: get<HTMLInputElement>('#s-name').value.trim() || 'Alex',
        touchControls: get<HTMLSelectElement>('#s-touch').value as Settings['touchControls'],
        invertY: get<HTMLInputElement>('#s-inv').checked,
        subtitles: get<HTMLInputElement>('#s-subs').checked,
        reducedMotion: get<HTMLInputElement>('#s-rm').checked,
        watchdog: get<HTMLInputElement>('#s-wd').checked,
        showHints: get<HTMLInputElement>('#s-hints').checked,
      };
      Object.assign(s, n);
      onChange(s);
    };
    for (const r of p.querySelectorAll<HTMLInputElement>('input[type=range]')) {
      r.addEventListener('input', () => {
        const o = p.querySelector(`output[for="${r.id}"]`);
        if (o) o.textContent = fmtRange(Number(r.value), r.dataset.unit ?? '');
        apply();
      });
    }
    p.querySelectorAll('input:not([type=range]),select').forEach((el) =>
      el.addEventListener('change', apply),
    );
    p.querySelector('#s-hints-reset')?.addEventListener('click', (e) => {
      extra.onResetHints();
      (e.target as HTMLElement).textContent = 'Tips will show again';
    });
    for (const b of p.querySelectorAll<HTMLElement>('[data-a]')) {
      b.addEventListener('click', () => {
        const label = ACTION_LABELS[b.dataset.a!] ?? b.dataset.a!;
        b.innerHTML = `${esc(label)}: <kbd>…</kbd>`;
        const h = (e: KeyboardEvent) => {
          e.preventDefault();
          e.stopPropagation();
          if (e.code !== 'Escape') s.bindings[b.dataset.a!] = e.code;
          b.innerHTML = `${esc(label)}: <kbd>${esc(keyName(s.bindings[b.dataset.a!]!))}</kbd>`;
          window.removeEventListener('keydown', h, true);
          onChange(s);
        };
        window.addEventListener('keydown', h, true);
      });
    }
  }

  controls(onClose: () => void, rows: (d: Device) => [string, string][], initial: Device): void {
    const render = (d: Device) =>
      `<table class="rep">${rows(d)
        .map(([k, v]) => `<tr><td><b>${esc(k)}</b></td><td>${esc(v)}</td></tr>`)
        .join('')}</table>`;
    const p = this.open(
      `<h1>Controls</h1>
      <div class="seg" role="group" aria-label="Device"><button type="button" data-d="keyboard">Keyboard and mouse</button><button type="button" data-d="touch">Touch</button></div>
      <div id="c-rows"></div>
      <p class="sub2">Being out of your seat during a lesson is suspicious unless you have a reason: sharpener, bin, handing in papers, picking up something you dropped. During a break it is fine.</p>`,
      [['Back', onClose]],
      { label: 'Controls' },
    );
    const show = (d: Device) => {
      p.querySelector('#c-rows')!.innerHTML = render(d);
      p.querySelectorAll<HTMLElement>('[data-d]').forEach((b) =>
        b.classList.toggle('on', b.dataset.d === d),
      );
    };
    p.querySelectorAll<HTMLElement>('[data-d]').forEach((b) =>
      b.addEventListener('click', () => show(b.dataset.d as Device)),
    );
    show(initial);
  }

  ideas(sections: IdeaSection[], onClose: () => void): void {
    const html = sections
      .map(
        (s) =>
          `<section class="idea-sec"><h2>${esc(s.title)}</h2>${s.blurb ? `<p class="sub2">${esc(s.blurb)}</p>` : ''}<div class="ideas">${s.items
            .map(
              (i) =>
                `<div class="idea ${i.status ?? ''}"><h4><span>${esc(i.title)}</span>${i.statusText || i.status === 'now' ? `<span class="pill ${i.status ?? ''}">${esc(i.statusText ?? 'now')}</span>` : ''}</h4><p>${esc(i.detail)}</p>${i.keys ? `<p class="k">${esc(i.keys)}</p>` : ''}</div>`,
            )
            .join('')}</div></section>`,
      )
      .join('');
    this.open(
      `<h1>Ideas</h1><p class="sub2">Things to try in this lesson. The game is paused while this is open.</p>${html}`,
      [['Back to class', onClose]],
      { wide: true, label: 'Ideas' },
    );
  }

  credits(onClose: () => void): void {
    const assets = ASSET_CREDITS.map(
      (c) =>
        `<li><a href="${esc(c.url)}" target="_blank" rel="noopener">${esc(c.name)}</a> — ${esc(c.by)} · ${esc(c.license)} <span class="sub2">(${esc(c.use)})</span></li>`,
    ).join('');
    this.open(
      `<h1>Credits</h1>
      <p>Modulo: Classroom. Design, code, characters and placeholder content are original to this project. All characters are fictional.</p>
      <h2>Assets</h2>
      ${assets ? `<ul class="credits">${assets}</ul>` : '<p class="sub2">No third-party assets loaded.</p>'}
      <p class="sub2">Materials, models and sky light from Poly Haven and ambientCG (CC0, thank you!). Full list with sources: assets/LICENSES.json.</p>
      <p class="sub2">Sounds are synthesized in the browser; the in-class "videos" are procedural. Built with three.js (MIT). Research credits: docs/classroom/RESEARCH.md.</p>`,
      [['Back', onClose]],
      { label: 'Credits' },
    );
  }

  summary(html: string, buttons: Btn[]): void {
    const p = this.open(html, buttons, { label: 'Summary' });
    (p.querySelector('.btns .btn') as HTMLElement | null)?.focus({ preventScroll: true });
  }

  splash(text: string, sub: string, onGo: () => void): void {
    this.open(`<h1>${esc(text)}</h1><p class="sub2">${esc(sub)}</p>`, [
      ['Tap / click to enter class', onGo],
    ]);
  }
}

function fmtRange(v: number, unit: string): string {
  if (unit === '%') return `${Math.round(v * 100)}%`;
  if (unit === '×') return `${v.toFixed(2).replace(/\.?0+$/, '')}×`;
  return `${v}${unit}`;
}

export function esc(s: string): string {
  return s.replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!,
  );
}
