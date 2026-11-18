// Player-facing copy that is derived from data where possible: lesson/teacher blurbs, key
// labels, the controls table and the "Ideas" model. Prank names, targets and requirements come
// straight from data/pranks.json so new pranks appear automatically.
import { LESSONS, PRANKS, TEACHERS, type PrankDef } from '../sim/data';
import type { World } from '../sim/world';
import { bindingVisible, NOTES_ENABLED } from './flags';

export type Device = 'keyboard' | 'touch';

// ------------------------------------------------------------------------------------------
// Blurbs

const LESSON_BLURB: Record<string, string> = {
  lecture: 'The teacher talks at the board, then walks the room. Easy to hide in, easy to doze in.',
  worksheet: 'Silent work. Every sound carries; the teacher patrols.',
  group: 'Talking is allowed, so whispering is safe. The room is loud, cover is plentiful.',
  test: 'Eyes on your own paper. Peeking and cheat sheets are possible, and risky.',
  presentations: 'Classmates present at the front. Everyone is looking forward, mostly.',
  film: 'Lights dim and the projector runs. Screens glow, so be careful.',
  study: 'Free study. The teacher is relaxed, but a surprise test is possible.',
};

export function lessonBlurb(id: string): string {
  if (id === 'random') return 'Surprise me: the seed picks the lesson.';
  const t = LESSONS.types[id];
  return LESSON_BLURB[id] ?? (t ? `${t.phases.map((p) => p.label).join(', ')}.` : '');
}

const TEACHER_BLURB: Record<string, string> = {
  strict: 'Watches the room a lot and writes things down. Fair, but rarely lets things go.',
  lazy: 'Often busy with the laptop. Hears a lot, sees less.',
  distracted: 'Drifts off mid-sentence. Predictable gaps, odd timing.',
  hawk: 'Patrols constantly and checks desks. Hard mode.',
  substitute: 'Does not know the class yet. Cautious, unpredictable.',
};

export function teacherBlurb(id: string): string {
  if (id === 'random') return 'Surprise me: the seed picks who is teaching.';
  const t = TEACHERS.find((x) => x.id === id);
  return TEACHER_BLURB[id] ?? (t ? `${t.label} teacher.` : '');
}

// ------------------------------------------------------------------------------------------
// Keys

const KEY_NAMES: Record<string, string> = {
  ShiftLeft: 'Shift',
  ShiftRight: 'Shift',
  ControlLeft: 'Ctrl',
  Space: 'Space',
  Tab: 'Tab',
  Slash: '?',
  Escape: 'Esc',
  Comma: ',',
  Period: '.',
  Backquote: '`',
};

export function keyName(code: string): string {
  return KEY_NAMES[code] ?? code.replace(/^Key|^Digit/, '');
}

export const ACTION_LABELS: Record<string, string> = {
  forward: 'Walk forward',
  back: 'Walk back',
  left: 'Walk left',
  right: 'Walk right',
  sprint: 'Sprint (loud)',
  crouch: 'Crouch (quiet)',
  sit: 'Sit / stand',
  interact: 'Use highlighted thing',
  nextVerb: 'Next option',
  phone: 'Take out phone',
  laptop: 'Open laptop',
  switch: 'Quick-switch screen',
  content: 'Game / video',
  earbud: 'Earbud',
  leanLeft: 'Lean left',
  leanRight: 'Lean right',
  throw: 'Throw (hold)',
  paper: 'Make paper ball',
  note: 'Pass a note',
  raiseHand: 'Raise hand',
  cheat: 'Cheat sheet (hold)',
  notebook: 'Notebook',
  ideas: 'Ideas panel',
  help: 'Controls help',
};

/** Groups for the key binding list in Settings. */
export const BINDING_GROUPS: [string, string[]][] = [
  ['Move', ['forward', 'back', 'left', 'right', 'sprint', 'crouch', 'leanLeft', 'leanRight']],
  ['Interact', ['interact', 'nextVerb', 'sit', 'paper', 'throw', 'raiseHand', 'cheat']],
  ['Devices', ['phone', 'laptop', 'switch', 'content', 'earbud']],
  ['Menus', ['ideas', 'help', 'notebook', ...(NOTES_ENABLED ? ['note'] : [])]],
];

export function visibleBindings(bindings: Record<string, string>): string[] {
  return Object.keys(bindings).filter(bindingVisible);
}

/** Resolves an action to what the player presses: a key (keyboard) or a button name (touch). */
export type KeyLabels = (action: string) => string;

const TOUCH_NAMES: Record<string, string> = {
  interact: 'Use',
  nextVerb: 'Next',
  sit: 'Sit / Stand',
  phone: 'Phone',
  laptop: 'Laptop',
  switch: 'Hide screen',
  content: 'Game / Video',
  earbud: 'Earbud',
  paper: 'Paper',
  throw: 'Throw',
  raiseHand: 'Hand',
  cheat: 'Cheat sheet',
  notebook: 'Notebook',
  ideas: 'Ideas',
  help: 'Help',
  work: 'Work',
  peek: 'Peek',
  crouch: 'Crouch',
};

export function makeKeyLabels(bindings: Record<string, string>, device: Device): KeyLabels {
  if (device === 'touch') return (a) => TOUCH_NAMES[a] ?? a;
  const fixed: Record<string, string> = { work: 'H', peek: 'Y' };
  return (a) => (bindings[a] ? keyName(bindings[a]) : (fixed[a] ?? a));
}

export function controlRows(device: Device, k: KeyLabels): [string, string][] {
  if (device === 'touch')
    return [
      ['Left thumb: drag', 'Walk (push to the edge to sprint, which is loud)'],
      ['Right side: drag', 'Look around'],
      ['Use', 'Do the highlighted action. “Next” changes the option.'],
      ['Sit / Stand', 'Take or leave your seat'],
      ['Work (hold)', 'Do real work: lowers suspicion, earns grades'],
      ['Hide screen', 'Quick-switch to the decoy notes (do it when the teacher looks your way)'],
      ['Tools', 'Phone, laptop, earbud, paper, peek, crouch, raise hand, cheat sheet'],
      ['Ideas · Help · Menu', 'Things to try, this list, pause and settings'],
    ];
  return [
    [`${k('forward')}${k('left')}${k('back')}${k('right')} / arrows`, 'Walk'],
    [`${k('sprint')} · ${k('crouch')}`, 'Sprint (loud) · crouch (quiet)'],
    [k('sit'), 'Sit down / stand up'],
    [`${k('interact')} · ${k('nextVerb')} / wheel`, 'Use the highlighted thing · next option'],
    ['Mouse (click to capture)', 'Look. Hold left button (or H) to do real work'],
    [`${k('phone')} · ${k('laptop')}`, 'Phone (in your lap) · laptop (on the table)'],
    [k('switch'), 'Quick-switch to the decoy notes (fumbling while watched is worse)'],
    [`${k('content')} · ${k('earbud')} · , .`, 'Game / video · earbud · screen brightness'],
    ['A / D while gaming', 'Move the Block Drop paddle'],
    [`${k('paper')} · Shift+${k('paper')} · hold ${k('throw')}`, 'Paper ball · plane · throw'],
    [`${k('raiseHand')} · ${k('notebook')}`, 'Raise hand · notebook'],
    ['Hold right button (or Y)', 'Peek at a neighbour’s test'],
    [`hold ${k('cheat')}`, 'Use your cheat sheet (pack one on the title screen)'],
    [`${k('leanLeft')} / ${k('leanRight')}`, 'Lean left / right'],
    [`${k('ideas')} · ${k('help')} · Esc`, 'Ideas · this list · pause'],
  ];
}

// ------------------------------------------------------------------------------------------
// Prompts

export function riskText(risk: 'loud' | 'risky' | undefined): string {
  if (risk === 'loud') return 'Loud: classmates and teacher will hear it';
  if (risk === 'risky') return 'Risky if the teacher is looking';
  return '';
}

const TARGET_NAMES: Record<string, string> = {
  marker: 'the board marker',
  'projector-remote': 'the projector remote',
  'window-a': 'the window',
  seat: 'a classmate’s chair',
  clock: 'the wall clock',
  'poster-1': 'the posters',
  'teacher-desk': 'the teacher’s desk',
  board: 'the whiteboard',
  radiator: 'the radiator',
  'doc-camera': 'the document camera',
};

export function targetName(id: string): string {
  return TARGET_NAMES[id] ?? `the ${id.replace(/[-_]+/g, ' ')}`;
}

const REQUIRES_NOW: Record<string, string> = {
  break: 'only during the break',
  plane: 'fold a paper plane first',
  'carry-free': 'empty your hands first',
};

export function requirementText(req: string | undefined): string {
  return req ? (REQUIRES_NOW[req] ?? req.replace(/[-_]+/g, ' ')) : '';
}

function requirementMet(w: World, req: string | undefined): boolean {
  if (!req) return true;
  if (req === 'break') return !!w.rules().break;
  if (req === 'plane')
    return w.items.find((i) => i.id === w.player.holding)?.kind === 'paper-plane';
  if (req === 'carry-free') return !w.player.holding;
  return true;
}

/** Why a prank on this target cannot be started right now (null if it can). */
export function prankBlockReason(w: World, def: PrankDef): string | null {
  if (w.pranks.some((p) => p.id === def.id)) return 'already done this lesson';
  if (!requirementMet(w, def.requires)) return requirementText(def.requires);
  return null;
}

/** Pranks aimed at an interactable the player is looking at but not currently offered. */
export function ghostPranks(
  w: World,
  it: { id: string; kind: string; verbs: { verb: string }[] },
): { name: string; reason: string }[] {
  const out: { name: string; reason: string }[] = [];
  for (const def of PRANKS) {
    if (def.target !== it.id && !(def.target === 'seat' && it.kind === 'seat')) continue;
    if (it.verbs.some((v) => v.verb === `prank:${def.id}`)) continue;
    const why = prankBlockReason(w, def);
    if (why) out.push({ name: def.name, reason: why });
  }
  return out;
}

// ------------------------------------------------------------------------------------------
// Ideas panel model

export interface IdeaItem {
  title: string;
  detail: string;
  keys?: string;
  status?: 'now' | 'later' | 'done';
  statusText?: string;
}

export interface IdeaSection {
  title: string;
  blurb?: string;
  items: IdeaItem[];
}

export function buildIdeas(w: World, k: KeyLabels): IdeaSection[] {
  const r = w.rules();
  const ps = w.ps;
  const sections: IdeaSection[] = [];

  // Situation: what this phase allows.
  const now: IdeaItem[] = [];
  if (r.break)
    now.push({
      title: 'Break time',
      detail: 'Seats are free, so you can walk, chat and prank without standing out.',
      status: 'now',
    });
  if (r.test)
    now.push({
      title: 'Test in progress',
      detail: 'Answer questions by working, or peek at a neighbour. Copying is the risky part.',
      status: 'now',
    });
  if (r.dim)
    now.push({
      title: 'Lights are dim',
      detail: 'Harder to see you, but your screen glows. Lower the brightness.',
      status: 'now',
    });
  if (r.talkOk && !r.break)
    now.push({
      title: 'Talking is allowed',
      detail: 'Whispering to classmates is not suspicious right now.',
      status: 'now',
    });
  if ((r.quiet ?? 1) >= 1.4)
    now.push({
      title: 'Silent work',
      detail: 'Every sound carries. Crouch-walk and keep still.',
      status: 'now',
    });
  if (!now.length)
    now.push({
      title: 'Ordinary lesson',
      detail: 'Stay in your seat unless you have a reason to leave it (see Errands).',
      status: 'now',
    });
  sections.push({ title: 'Right now', items: now });

  sections.push({
    title: 'Screens',
    blurb: 'Your phone sits in your lap, your laptop on the table. Both can be seen.',
    items: [
      {
        title: 'Play Block Drop',
        detail: 'Catch green blocks, dodge red ones. Steer with left / right.',
        keys: `${k('phone')} phone · ${k('laptop')} laptop`,
        status: ps.device.kind && ps.device.mode === 'game' ? 'now' : undefined,
        statusText: 'playing',
      },
      {
        title: 'Watch a video',
        detail: 'Switch between game and video. An earbud keeps it quiet, but you hear less.',
        keys: `${k('content')} switch · ${k('earbud')} earbud`,
        status: ps.device.kind && ps.device.mode === 'video' ? 'now' : undefined,
        statusText: 'watching',
      },
      {
        title: 'Quick-switch to the notes',
        detail: 'Flips to a boring decoy screen. Doing it while the teacher watches looks worse.',
        keys: k('switch'),
      },
    ],
  });

  sections.push({
    title: 'Work and tests',
    items: [
      {
        title: 'Do real work',
        detail: 'Hold to work. It lowers suspicion and earns a participation grade.',
        keys: `hold ${k('work')}`,
        status: ps.working ? 'now' : undefined,
        statusText: 'working',
      },
      {
        title: 'Peek at a neighbour’s test',
        detail: 'Only during tests. Friends may let you, others may tell.',
        keys: `hold ${k('peek')}`,
        status: r.test ? 'now' : 'later',
        statusText: r.test ? 'test is on' : 'tests only',
      },
      {
        title: 'Use a cheat sheet',
        detail: ps.hasCheatSheet
          ? 'You packed one. Hold to use it; keep it under the table.'
          : 'Pack one on the title screen before the lesson.',
        keys: `hold ${k('cheat')}`,
        status: ps.hasCheatSheet && r.test ? 'now' : 'later',
        statusText: ps.hasCheatSheet ? (r.test ? 'ready' : 'tests only') : 'not packed',
      },
      {
        title: 'Raise your hand',
        detail: 'Answers a pop question and looks keen.',
        keys: k('raiseHand'),
      },
    ],
  });

  sections.push({
    title: 'Pranks',
    blurb:
      'Harmless. Walk up, stand near it and press Use. Each once per lesson; witnesses may tell.',
    items: PRANKS.map((def) => {
      const why = prankBlockReason(w, def);
      const done = w.pranks.some((p) => p.id === def.id);
      const where = `At ${targetName(def.target)}`;
      const needs = def.requires ? ` Needs: ${requirementText(def.requires)}.` : '';
      const effort = def.setup >= 2 ? 'Takes a while to set up.' : 'Quick to set up.';
      return {
        title: def.name,
        detail: `${where}.${needs} ${effort}`,
        keys: k('interact'),
        status: done ? 'done' : why ? 'later' : 'now',
        statusText: done ? 'done' : (why ?? 'available'),
      };
    }),
  });

  sections.push({
    title: 'Paper',
    items: [
      {
        title: 'Fold and throw',
        detail: 'Make a ball or a plane, then hold Throw to charge. A plane makes a prank.',
        keys: `${k('paper')} ball · Shift+${k('paper')} plane · hold ${k('throw')}`,
      },
    ],
  });

  sections.push({
    title: 'Errands (good cover)',
    blurb: 'Being out of your seat is suspicious unless you have a reason.',
    items: [
      { title: 'Sharpen a pencil', detail: 'At the sharpener on the wall.', keys: k('interact') },
      { title: 'Use the bin', detail: 'Throws away what you are holding.', keys: k('interact') },
      {
        title: 'Hand in papers',
        detail: 'At the teacher’s desk.',
        keys: k('interact'),
      },
      {
        title: 'Pick up something dropped',
        detail: 'Paper on the floor near your seat counts too.',
        keys: k('interact'),
      },
    ],
  });

  sections.push({
    title: 'People',
    items: [
      {
        title: 'Chat with a classmate',
        detail:
          r.talkOk || r.break ? 'Allowed right now.' : 'Whispering is risky during silent work.',
        keys: k('interact'),
      },
      {
        title: 'Check the notebook',
        detail: 'Shows who likes you, who they hang out with, and recent memories.',
        keys: k('notebook'),
      },
    ],
  });
  return sections;
}

// ------------------------------------------------------------------------------------------
// First-lesson hints

export interface HintDef {
  id: string;
  text: (k: KeyLabels, device: Device) => string;
}

export const HINTS: Record<string, HintDef> = {
  look: {
    id: 'look',
    text: (_k, d) =>
      d === 'touch'
        ? 'Drag on the right side to look, on the left to walk. There is no score. Poke around.'
        : 'Move the mouse to look around (click once to capture it). There is no score. Poke around.',
  },
  prompt: {
    id: 'prompt',
    text: (k) =>
      `The line under the crosshair says what “${k('interact')}” will do. If it shows “more”, ${k('nextVerb')} or the wheel changes the option. Orange means risky.`,
  },
  device: {
    id: 'device',
    text: (k) =>
      `Screens get you noticed. When the eye icon shows up, press ${k('switch')} to flip to the decoy notes.`,
  },
  gaze: {
    id: 'gaze',
    text: () =>
      'The teacher is looking your way. Sit still, put the screen away, or look busy until they turn.',
  },
  ideas: {
    id: 'ideas',
    text: (k) =>
      `Stuck for things to try? Press ${k('ideas')} for ideas. ${k('help')} shows all controls.`,
  },
};
