// Input: keyboard + mouse (Pointer Lock on desktop; press-and-drag look where Pointer Lock is
// missing, e.g. iPadOS Safari with a trackpad) and on-screen touch controls. Everything goes
// through the `InputFrame` interface so more controllers can be added later.
import type { Settings } from '../quality';
import { isTouchDevice } from '../quality';

export type Action =
  | 'forward'
  | 'back'
  | 'left'
  | 'right'
  | 'sprint'
  | 'crouch'
  | 'sit'
  | 'interact'
  | 'nextVerb'
  | 'phone'
  | 'laptop'
  | 'switch'
  | 'content'
  | 'earbud'
  | 'leanLeft'
  | 'leanRight'
  | 'throw'
  | 'paper'
  | 'note'
  | 'raiseHand'
  | 'cough'
  | 'drum'
  | 'hum'
  | 'leanBack'
  | 'nap'
  | 'sillyQ'
  | 'cheat'
  | 'notebook'
  | 'work'
  | 'peek'
  | 'pause'
  | 'debug'
  | 'freecam'
  | 'brightUp'
  | 'brightDown'
  | 'plane'
  | 'ideas'
  | 'help';

export interface InputFrame {
  /** Local move: x = strafe right, y = forward. */
  move: { x: number; y: number };
  look: { dx: number; dy: number };
  held: Set<Action>;
  pressed: Set<Action>;
  released: Set<Action>;
}

export interface Controller {
  poll(into: InputFrame): void;
  dispose(): void;
}

const FIXED: Record<string, Action> = {
  Escape: 'pause',
  F3: 'debug',
  Backquote: 'debug',
  F4: 'freecam',
  Period: 'brightUp',
  Comma: 'brightDown',
  KeyH: 'work',
  F1: 'help',
  KeyY: 'peek',
  ArrowUp: 'forward',
  ArrowDown: 'back',
  ArrowLeft: 'left',
  ArrowRight: 'right',
};

const MOUSE_RAD_PER_PX = 0.0022;
const TOUCH_RAD_PER_PX = 0.005;

class KeyboardMouse implements Controller {
  private held = new Set<Action>();
  private pressed = new Set<Action>();
  private released = new Set<Action>();
  private dx = 0;
  private dy = 0;
  private dragging = false;
  private lastX = 0;
  private lastY = 0;
  private keyMap = new Map<string, Action>();
  private el: HTMLElement;
  private settings: Settings;
  locked = false;
  /** Set by the app while a normal menu is open: Tab/Space/Enter keep their browser meaning. */
  nativeKeys = false;
  /** Set by the app: when false, clicks don't grab the pointer (menus open). */
  wantLock = true;
  private readonly lockSupported: boolean;
  private off: (() => void)[] = [];
  onWheel: ((dir: number) => void) | null = null;

  constructor(el: HTMLElement, settings: Settings) {
    this.el = el;
    this.settings = settings;
    this.lockSupported =
      'requestPointerLock' in el &&
      !/iPad|iPhone/.test(navigator.userAgent) &&
      !(navigator.maxTouchPoints > 1 && /Macintosh/.test(navigator.userAgent));
    this.rebind();
    const on = (
      t: string,
      f: (e: never) => void,
      target: Window | Document | HTMLElement = window,
    ) => {
      target.addEventListener(t, f as EventListener, { passive: false });
      this.off.push(() => target.removeEventListener(t, f as EventListener));
    };
    on('keydown', (e: KeyboardEvent) => {
      const a = this.keyMap.get(e.code) ?? FIXED[e.code];
      if (!a) return;
      if (
        (e.target as HTMLElement)?.tagName === 'INPUT' ||
        (e.target as HTMLElement)?.tagName === 'SELECT'
      )
        return;
      if (!this.nativeKeys || a === 'pause') e.preventDefault();
      if (e.repeat) return;
      if (a === 'paper' && e.shiftKey) this.pressed.add('plane');
      else this.pressed.add(a);
      this.held.add(a);
    });
    on('keyup', (e: KeyboardEvent) => {
      const a = this.keyMap.get(e.code) ?? FIXED[e.code];
      if (!a) return;
      this.held.delete(a);
      this.released.add(a);
    });
    on('blur', () => {
      for (const a of this.held) this.released.add(a);
      this.held.clear();
    });
    on('mousedown', (e: MouseEvent) => {
      if ((e.target as HTMLElement) !== this.el) return;
      if (this.lockSupported && !this.locked && this.wantLock) {
        void (this.el.requestPointerLock as () => Promise<void> | void)?.call(this.el);
        return;
      }
      if (e.button === 0) {
        if (this.locked) this.held.add('work');
        else {
          this.dragging = true;
          this.lastX = e.clientX;
          this.lastY = e.clientY;
        }
      }
      if (e.button === 2) this.held.add('peek');
    });
    on('mouseup', (e: MouseEvent) => {
      if (e.button === 0) {
        this.held.delete('work');
        this.dragging = false;
      }
      if (e.button === 2) this.held.delete('peek');
    });
    on('mousemove', (e: MouseEvent) => {
      if (this.locked) {
        this.dx += e.movementX;
        this.dy += e.movementY;
      } else if (this.dragging) {
        this.dx += e.clientX - this.lastX;
        this.dy += e.clientY - this.lastY;
        this.lastX = e.clientX;
        this.lastY = e.clientY;
      }
    });
    on('contextmenu', (e: Event) => e.preventDefault(), this.el);
    on(
      'wheel',
      (e: WheelEvent) => {
        // Two-finger trackpad scroll on iPad also turns the view when not locked.
        if (!this.locked && Math.abs(e.deltaX) > Math.abs(e.deltaY) * 1.5) {
          this.dx += e.deltaX * 0.6;
          return;
        }
        this.onWheel?.(Math.sign(e.deltaY));
      },
      this.el,
    );
    on(
      'pointerlockchange',
      () => {
        this.locked = document.pointerLockElement === this.el;
      },
      document,
    );
  }

  rebind(): void {
    this.keyMap.clear();
    for (const [a, code] of Object.entries(this.settings.bindings))
      this.keyMap.set(code, a as Action);
  }

  unlock(): void {
    if (this.locked) document.exitPointerLock?.();
  }

  poll(f: InputFrame): void {
    const k = this.held;
    f.move.x += (k.has('right') ? 1 : 0) - (k.has('left') ? 1 : 0);
    f.move.y += (k.has('forward') ? 1 : 0) - (k.has('back') ? 1 : 0);
    f.look.dx += this.dx * MOUSE_RAD_PER_PX;
    f.look.dy += this.dy * MOUSE_RAD_PER_PX;
    this.dx = 0;
    this.dy = 0;
    for (const a of k) f.held.add(a);
    for (const a of this.pressed) f.pressed.add(a);
    for (const a of this.released) f.released.add(a);
    this.pressed.clear();
    this.released.clear();
  }

  dispose(): void {
    this.off.forEach((f) => f());
  }
}

const TOUCH_CSS = `
.tc{position:fixed;inset:0;pointer-events:none;z-index:15;user-select:none;-webkit-user-select:none;touch-action:none;font:calc(13px*var(--ui,1))/1.15 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;color:#fff}
.tc.hidden{display:none}
.tc-left,.tc-right{position:absolute;top:0;bottom:0;pointer-events:auto;touch-action:none}
.tc-left{left:0;width:42%}.tc-right{right:0;width:58%}
.tc-base,.tc-knob{position:fixed;border-radius:50%;pointer-events:none;display:none;transform:translate(-50%,-50%)}
.tc-base{width:130px;height:130px;border:2px solid rgba(255,255,255,.5);background:rgba(255,255,255,.08)}
.tc-knob{width:56px;height:56px;background:rgba(255,255,255,.55)}
.tc-zone{position:absolute;bottom:34%;color:rgba(255,255,255,.65);font-size:.95em;text-align:center;text-shadow:0 1px 3px #000;pointer-events:none;transition:opacity .6s}
.tc-zone.l{left:12%}.tc-zone.r{right:22%;top:46%;bottom:auto}
.tc.used .tc-zone{opacity:0}
.tc-dock{position:absolute;right:calc(env(safe-area-inset-right,0px) + 12px);bottom:calc(env(safe-area-inset-bottom,0px) + 12px);display:flex;flex-direction:column;align-items:flex-end;gap:10px;pointer-events:none;max-width:calc(100vw - 24px)}
.tc-row{display:flex;gap:10px;align-items:flex-end;justify-content:flex-end;flex-wrap:wrap;pointer-events:none}
.tc-tray{display:none;grid-template-columns:repeat(3,minmax(78px,1fr));gap:10px;padding:10px;border-radius:18px;background:rgba(14,16,20,.7);-webkit-backdrop-filter:blur(8px);backdrop-filter:blur(8px);pointer-events:auto}
.tc-tray.open{display:grid}
.tc-top{position:absolute;right:calc(env(safe-area-inset-right,0px) + 12px);top:calc(env(safe-area-inset-top,0px) + 3.2em);display:flex;gap:8px;pointer-events:none}
.tc-b{pointer-events:auto;touch-action:none;min-width:68px;min-height:56px;padding:6px 10px;border-radius:16px;border:1px solid rgba(255,255,255,.6);background:rgba(20,22,26,.68);color:#fff;font:700 1em/1.1 system-ui,-apple-system,sans-serif;display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center;-webkit-backdrop-filter:blur(6px);backdrop-filter:blur(6px);cursor:pointer}
.tc-b small{display:block;font-weight:500;opacity:.8;font-size:.78em;margin-top:2px}
.tc-b.top{min-height:46px;min-width:56px;flex-direction:row;gap:6px;border-radius:23px;padding:6px 14px}
.tc-b.use{min-width:92px;min-height:92px;border-radius:46px;background:rgba(233,196,106,.92);color:#1d1a12;border-color:#fff;font-size:1.25em}
.tc-b.danger{border-color:#ffb86b}
.tc-b.on{background:rgba(255,255,255,.55);color:#111}
.tc-b.hide{display:none}
`;

export interface TouchContext {
  deviceOut: boolean;
  holding: boolean;
  moreVerbs: boolean;
  sitting: boolean;
}

class Touch implements Controller {
  private root: HTMLDivElement;
  private held = new Set<Action>();
  private pressed = new Set<Action>();
  private released = new Set<Action>();
  private joy: { id: number; x: number; y: number; dx: number; dy: number } | null = null;
  private look: { id: number; x: number; y: number } | null = null;
  private dx = 0;
  private dy = 0;
  private base: HTMLDivElement;
  private knob: HTMLDivElement;
  private btns = new Map<Action, HTMLButtonElement>();
  private tray: HTMLDivElement;
  private toolsBtn: HTMLButtonElement;
  private sitLabel: HTMLElement | null = null;

  constructor() {
    const style = document.createElement('style');
    style.textContent = TOUCH_CSS;
    document.head.appendChild(style);
    this.root = document.createElement('div');
    this.root.className = 'tc';
    const left = document.createElement('div');
    left.className = 'tc-left';
    const right = document.createElement('div');
    right.className = 'tc-right';
    this.base = document.createElement('div');
    this.base.className = 'tc-base';
    this.knob = document.createElement('div');
    this.knob.className = 'tc-knob';
    const zl = document.createElement('div');
    zl.className = 'tc-zone l';
    zl.textContent = 'Drag here to walk';
    const zr = document.createElement('div');
    zr.className = 'tc-zone r';
    zr.textContent = 'Drag here to look';
    this.root.append(left, right, this.base, this.knob, zl, zr);

    const dock = document.createElement('div');
    dock.className = 'tc-dock';
    this.tray = document.createElement('div');
    this.tray.className = 'tc-tray';
    const ctxRow = document.createElement('div');
    ctxRow.className = 'tc-row';
    const mainRow = document.createElement('div');
    mainRow.className = 'tc-row';
    const top = document.createElement('div');
    top.className = 'tc-top';

    const mk = (
      parent: HTMLElement,
      a: Action,
      label: string,
      opts: { hold?: boolean; cls?: string; sub?: string } = {},
    ) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = `tc-b ${opts.cls ?? ''}`;
      b.innerHTML = `<span>${label}</span>${opts.sub ? `<small>${opts.sub}</small>` : opts.hold ? '<small>hold</small>' : ''}`;
      b.setAttribute('aria-label', `${label.replace(/<[^>]+>/g, '')}${opts.hold ? ' (hold)' : ''}`);
      b.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        e.stopPropagation();
        this.pressed.add(a);
        this.held.add(a);
        b.classList.add('on');
        if (!opts.hold) setTimeout(() => b.classList.remove('on'), 120);
      });
      const up = (e: Event) => {
        e.preventDefault();
        if (this.held.delete(a)) this.released.add(a);
        b.classList.remove('on');
      };
      b.addEventListener('pointerup', up);
      b.addEventListener('pointercancel', up);
      b.addEventListener('pointerleave', up);
      parent.appendChild(b);
      this.btns.set(a, b);
      return b;
    };
    mk(top, 'pause', '☰ Menu', { cls: 'top' });
    mk(top, 'ideas', '💡 Ideas', { cls: 'top' });
    mk(top, 'notebook', '📓 Notebook', { cls: 'top' });
    mk(top, 'help', '? Help', { cls: 'top' });
    // Tools tray (everything that is not needed every second).
    mk(this.tray, 'phone', '📱 Phone');
    mk(this.tray, 'laptop', '💻 Laptop');
    mk(this.tray, 'earbud', '🎧 Earbud');
    mk(this.tray, 'paper', 'Paper ball');
    mk(this.tray, 'plane', 'Paper plane');
    mk(this.tray, 'crouch', 'Crouch', { sub: 'quiet' });
    mk(this.tray, 'peek', 'Peek', { hold: true });
    mk(this.tray, 'cheat', 'Cheat sheet', { hold: true });
    mk(this.tray, 'raiseHand', '✋ Hand', { sub: 'raise' });
    mk(this.tray, 'sillyQ', '🤪 Silly Q', { sub: 'raise' });
    mk(this.tray, 'cough', '🤧 Cough', { sub: 'chain' });
    mk(this.tray, 'drum', '🥁 Drum', { sub: 'table' });
    mk(this.tray, 'hum', '🎵 Hum');
    mk(this.tray, 'leanBack', '🪑 Lean back');
    mk(this.tray, 'nap', '😴 Nap');
    // Context row: only when relevant.
    mk(ctxRow, 'switch', 'Hide screen', { cls: 'danger', sub: 'decoy notes' });
    mk(ctxRow, 'content', 'Game / Video');
    mk(ctxRow, 'throw', 'Throw', { hold: true });
    mk(ctxRow, 'nextVerb', 'Next', { sub: 'option' });
    // Main row.
    this.toolsBtn = document.createElement('button');
    this.toolsBtn.type = 'button';
    this.toolsBtn.className = 'tc-b';
    this.toolsBtn.innerHTML = '<span>Tools ▴</span>';
    this.toolsBtn.setAttribute('aria-expanded', 'false');
    this.toolsBtn.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      e.stopPropagation();
      const open = this.tray.classList.toggle('open');
      this.toolsBtn.setAttribute('aria-expanded', String(open));
      this.toolsBtn.firstElementChild!.textContent = open ? 'Tools ▾' : 'Tools ▴';
    });
    mainRow.appendChild(this.toolsBtn);
    mk(mainRow, 'work', 'Work', { hold: true });
    const sit = mk(mainRow, 'sit', 'Sit', { sub: 'your seat' });
    this.sitLabel = sit.firstElementChild as HTMLElement;
    mk(mainRow, 'interact', 'Use', { cls: 'use' });
    dock.append(this.tray, ctxRow, mainRow);
    this.root.append(dock, top);
    document.body.appendChild(this.root);
    for (const a of ['switch', 'content', 'throw', 'nextVerb'] as Action[])
      this.btns.get(a)?.classList.add('hide');

    left.addEventListener('pointerdown', (e) => {
      if (this.joy) return;
      left.setPointerCapture(e.pointerId);
      this.joy = { id: e.pointerId, x: e.clientX, y: e.clientY, dx: 0, dy: 0 };
      this.base.style.display = this.knob.style.display = 'block';
      this.base.style.left = this.knob.style.left = `${e.clientX}px`;
      this.base.style.top = this.knob.style.top = `${e.clientY}px`;
      this.root.classList.add('used');
    });
    left.addEventListener('pointermove', (e) => {
      if (!this.joy || e.pointerId !== this.joy.id) return;
      let dx = e.clientX - this.joy.x;
      let dy = e.clientY - this.joy.y;
      const d = Math.hypot(dx, dy);
      if (d > 60) {
        dx = (dx / d) * 60;
        dy = (dy / d) * 60;
      }
      this.joy.dx = dx / 60;
      this.joy.dy = dy / 60;
      this.knob.style.left = `${this.joy.x + dx}px`;
      this.knob.style.top = `${this.joy.y + dy}px`;
    });
    const endJoy = (e: PointerEvent) => {
      if (this.joy && e.pointerId === this.joy.id) {
        this.joy = null;
        this.base.style.display = this.knob.style.display = 'none';
      }
    };
    left.addEventListener('pointerup', endJoy);
    left.addEventListener('pointercancel', endJoy);
    right.addEventListener('pointerdown', (e) => {
      if (this.look) return;
      right.setPointerCapture(e.pointerId);
      this.look = { id: e.pointerId, x: e.clientX, y: e.clientY };
      this.root.classList.add('used');
    });
    right.addEventListener('pointermove', (e) => {
      if (!this.look || e.pointerId !== this.look.id) return;
      this.dx += e.clientX - this.look.x;
      this.dy += e.clientY - this.look.y;
      this.look.x = e.clientX;
      this.look.y = e.clientY;
    });
    const endLook = (e: PointerEvent) => {
      if (this.look && e.pointerId === this.look.id) this.look = null;
    };
    right.addEventListener('pointerup', endLook);
    right.addEventListener('pointercancel', endLook);
  }

  setVisible(v: boolean): void {
    this.root.classList.toggle('hidden', !v);
  }

  setContext(c: TouchContext): void {
    const show = (a: Action, on: boolean) => this.btns.get(a)?.classList.toggle('hide', !on);
    show('switch', c.deviceOut);
    show('content', c.deviceOut);
    show('throw', c.holding);
    show('nextVerb', c.moreVerbs);
    if (this.sitLabel) this.sitLabel.textContent = c.sitting ? 'Stand' : 'Sit';
  }

  poll(f: InputFrame): void {
    if (this.joy) {
      f.move.x += this.joy.dx;
      f.move.y += -this.joy.dy;
      if (Math.hypot(this.joy.dx, this.joy.dy) > 0.95) f.held.add('sprint');
    }
    f.look.dx += this.dx * TOUCH_RAD_PER_PX;
    f.look.dy += this.dy * TOUCH_RAD_PER_PX;
    this.dx = this.dy = 0;
    for (const a of this.held) f.held.add(a);
    for (const a of this.pressed) f.pressed.add(a);
    for (const a of this.released) f.released.add(a);
    this.pressed.clear();
    this.released.clear();
  }

  dispose(): void {
    this.root.remove();
  }
}

export class InputManager {
  readonly km: KeyboardMouse;
  private touch: Touch | null = null;
  private settings: Settings;
  private frame: InputFrame = {
    move: { x: 0, y: 0 },
    look: { dx: 0, dy: 0 },
    held: new Set(),
    pressed: new Set(),
    released: new Set(),
  };

  constructor(el: HTMLElement, settings: Settings) {
    this.settings = settings;
    this.km = new KeyboardMouse(el, settings);
    this.applySettings(settings);
  }

  applySettings(s: Settings): void {
    this.settings = s;
    this.km.rebind();
    const want = s.touchControls === 'on' || (s.touchControls === 'auto' && isTouchDevice());
    if (want && !this.touch) this.touch = new Touch();
    this.touch?.setVisible(want);
  }

  /** True when the on-screen touch controls are in use (drives device-specific copy). */
  get touchActive(): boolean {
    return (
      this.settings.touchControls === 'on' ||
      (this.settings.touchControls === 'auto' && isTouchDevice())
    );
  }

  setTouchContext(c: TouchContext): void {
    this.touch?.setContext(c);
  }

  setTouchVisible(v: boolean): void {
    this.touch?.setVisible(v && this.touchActive);
  }

  poll(): InputFrame {
    const f = this.frame;
    f.move.x = 0;
    f.move.y = 0;
    f.look.dx = 0;
    f.look.dy = 0;
    f.held.clear();
    f.pressed.clear();
    f.released.clear();
    this.km.poll(f);
    this.touch?.poll(f);
    const s = this.settings.sensitivity;
    f.look.dx *= s;
    f.look.dy *= s * (this.settings.invertY ? -1 : 1);
    const m = Math.hypot(f.move.x, f.move.y);
    if (m > 1) {
      f.move.x /= m;
      f.move.y /= m;
    }
    return f;
  }

  dispose(): void {
    this.km.dispose();
    this.touch?.dispose();
  }
}
