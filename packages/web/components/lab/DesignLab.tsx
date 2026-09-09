'use client';
// Built-by: @projectx.sui · Co-authored-by: Claude
/**
 * The design lab.
 *
 * # Why this exists
 *
 * Describing a layout in words is the slowest and least reliable channel there is, and it is the
 * only one that has been available: a change gets described, implemented, looked at, and described
 * again. This removes that loop for the part of the work where it costs the most. Open any page of
 * the running application, change it in place — the colours, the text, the size of a thing, the
 * order of the blocks — press Save, and what you did is written into the repository as a file that
 * says exactly what you changed and where. No screenshot, no description, no round trip.
 *
 * Nothing here is a mock of the product. It edits the real page you are looking at, so what you
 * arrange is what exists.
 *
 * # Development only, structurally
 *
 * The component returns `null` unless `NODE_ENV` is `development`, and the route that receives a
 * save refuses outside development as well. Both are needed: the first keeps it off a production
 * page, the second means that even if a build somehow shipped it, there is nothing on the server to
 * write to.
 *
 * # Why this file breaks the house rules on purpose
 *
 * `CLAUDE.md` forbids raw hex and inline styles in application code, because a value written by
 * hand instead of read from a token is how a design drifts. This is not application code — it is a
 * tool for producing tokens, and it has to sit visually OUTSIDE the design it is editing or the
 * panel would recolour itself every time a colour is changed. Its own appearance is therefore
 * deliberately hard-coded and deliberately unlike the product.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { usePathname } from 'next/navigation';

/* ------------------------------------------------------------------------- */
/* What can be changed                                                        */
/* ------------------------------------------------------------------------- */

type TokenKind = 'colour' | 'length' | 'text';

type Token = { name: string; label: string; kind: TokenKind; group: string };

/**
 * The tokens offered, in the order they matter.
 *
 * Not every custom property in the sheet: the fonts and the easing curves are not things anybody
 * adjusts by eye, and a list nobody can scan is a list nobody uses.
 */
const TOKENS: readonly Token[] = [
  { name: '--w-ground', label: 'Page', kind: 'colour', group: 'Surfaces' },
  { name: '--w-raised', label: 'Raised', kind: 'colour', group: 'Surfaces' },
  { name: '--w-panel', label: 'Panel', kind: 'colour', group: 'Surfaces' },
  { name: '--w-line', label: 'Rules', kind: 'text', group: 'Surfaces' },
  { name: '--w-hover', label: 'Hover', kind: 'text', group: 'Surfaces' },

  { name: '--w-ink-10', label: 'Brightest text', kind: 'colour', group: 'Text' },
  { name: '--w-ink-9', label: 'Body text', kind: 'colour', group: 'Text' },
  { name: '--w-ink-7', label: 'Quiet text', kind: 'colour', group: 'Text' },
  { name: '--w-ink-6', label: 'Quietest text', kind: 'colour', group: 'Text' },

  { name: '--w-mint', label: 'Money', kind: 'colour', group: 'Meaning' },
  { name: '--w-mint-dim', label: 'Money, settled', kind: 'colour', group: 'Meaning' },
  { name: '--w-violet', label: 'A machine', kind: 'colour', group: 'Meaning' },
  { name: '--w-rose', label: 'Loss or refusal', kind: 'colour', group: 'Meaning' },

  { name: '--w-rail', label: 'Rail width', kind: 'length', group: 'Layout' },
  { name: '--w-column', label: 'Column width', kind: 'length', group: 'Layout' },
  { name: '--w-aside', label: 'Discovery width', kind: 'length', group: 'Layout' },
  { name: '--w-app', label: 'Whole app width', kind: 'length', group: 'Layout' },

  { name: '--w-r-sm', label: 'Radius, small', kind: 'length', group: 'Corners' },
  { name: '--w-r-md', label: 'Radius, medium', kind: 'length', group: 'Corners' },
  { name: '--w-r-lg', label: 'Radius, large', kind: 'length', group: 'Corners' },
  { name: '--w-r-xl', label: 'Radius, largest', kind: 'length', group: 'Corners' },
];

const GROUPS = ['Surfaces', 'Text', 'Meaning', 'Layout', 'Corners'] as const;

/** What a selected element can be pushed around with, without leaving the panel. */
const NUDGES: readonly { css: string; label: string; unit: string; step: number; min: number; max: number }[] = [
  { css: 'fontSize', label: 'Text size', unit: 'px', step: 1, min: 8, max: 96 },
  { css: 'fontWeight', label: 'Weight', unit: '', step: 100, min: 100, max: 900 },
  { css: 'lineHeight', label: 'Line height', unit: '', step: 0.05, min: 0.9, max: 2.4 },
  { css: 'letterSpacing', label: 'Letter spacing', unit: 'em', step: 0.005, min: -0.06, max: 0.2 },
  { css: 'paddingTop', label: 'Space above, inside', unit: 'px', step: 1, min: 0, max: 96 },
  { css: 'paddingBottom', label: 'Space below, inside', unit: 'px', step: 1, min: 0, max: 96 },
  { css: 'paddingLeft', label: 'Space left, inside', unit: 'px', step: 1, min: 0, max: 96 },
  { css: 'paddingRight', label: 'Space right, inside', unit: 'px', step: 1, min: 0, max: 96 },
  { css: 'marginTop', label: 'Space above, outside', unit: 'px', step: 1, min: -40, max: 96 },
  { css: 'marginBottom', label: 'Space below, outside', unit: 'px', step: 1, min: -40, max: 96 },
  { css: 'borderRadius', label: 'Corner', unit: 'px', step: 1, min: 0, max: 999 },
];

/* ------------------------------------------------------------------------- */
/* Naming a thing on the page, so a change can be written down                */
/* ------------------------------------------------------------------------- */

/**
 * A path back to this element, readable by a person.
 *
 * Not a selector to be executed — a description to be read: `main.w-column > article.w-post (3rd)
 * > h2`. Every attempt to make these robust enough to re-run turns them into
 * `div>div>div:nth-child(4)`, which nobody can act on. What is needed at the other end is "which
 * thing did he mean", and a tag, its classes and its position answer that.
 */
function describe(el: Element): string {
  const parts: string[] = [];
  let node: Element | null = el;
  let depth = 0;
  while (node !== null && depth < 5 && node.tagName !== 'BODY') {
    const tag = node.tagName.toLowerCase();
    const classes = [...node.classList].filter((c) => !c.startsWith('lab-')).slice(0, 2);
    const siblings = node.parentElement === null ? [] : [...node.parentElement.children].filter((s) => s.tagName === node?.tagName);
    const index = siblings.indexOf(node);
    const position = siblings.length > 1 ? ` (${index + 1} of ${siblings.length})` : '';
    parts.unshift(`${tag}${classes.map((c) => `.${c}`).join('')}${position}`);
    node = node.parentElement;
    depth += 1;
  }
  return parts.join(' > ');
}

/** The first line of what an element says, for a person reading the report later. */
function snippet(el: Element): string {
  const text = (el.textContent ?? '').replace(/\s+/g, ' ').trim();
  return text.length > 90 ? `${text.slice(0, 90)}…` : text;
}

/* ------------------------------------------------------------------------- */
/* State that survives a reload                                               */
/* ------------------------------------------------------------------------- */

type Nudge = { path: string; snippet: string; css: Record<string, string> };
type TextEdit = { path: string; before: string; after: string };

type LabState = {
  tokens: Record<string, string>;
  nudges: Nudge[];
  texts: TextEdit[];
  hidden: string[];
  notes: string;
};

const EMPTY: LabState = { tokens: {}, nudges: [], texts: [], hidden: [], notes: '' };
const STORE_KEY = 'weir.designlab';

function load(): LabState {
  try {
    const raw = window.localStorage?.getItem(STORE_KEY);
    if (raw === null || raw === undefined) return EMPTY;
    return { ...EMPTY, ...(JSON.parse(raw) as Partial<LabState>) };
  } catch {
    return EMPTY;
  }
}

function save(state: LabState): void {
  try {
    window.localStorage?.setItem(STORE_KEY, JSON.stringify(state));
  } catch {
    // A browser refusing storage costs the reload-safety and nothing else.
  }
}

/* ------------------------------------------------------------------------- */

type Mode = 'off' | 'pick' | 'text';

export function DesignLab() {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<'look' | 'thing' | 'notes'>('look');
  const [mode, setMode] = useState<Mode>('off');
  const [state, setState] = useState<LabState>(EMPTY);
  const [selected, setSelected] = useState<HTMLElement | null>(null);
  const [saving, setSaving] = useState<'idle' | 'saving' | 'saved' | 'failed'>('idle');
  const [savedTo, setSavedTo] = useState<string | null>(null);
  const originalText = useRef(new Map<HTMLElement, string>());

  /* Read back what the sheet actually declares, so a slider starts where the design is. */
  const defaults = useMemo(() => {
    if (typeof window === 'undefined') return {} as Record<string, string>;
    const computed = getComputedStyle(document.documentElement);
    const out: Record<string, string> = {};
    for (const token of TOKENS) out[token.name] = computed.getPropertyValue(token.name).trim();
    return out;
  }, []);

  useEffect(() => {
    const restored = load();
    setState(restored);
    for (const [name, value] of Object.entries(restored.tokens)) {
      document.documentElement.style.setProperty(name, value);
    }
  }, []);

  useEffect(() => {
    save(state);
  }, [state]);

  /* ---- picking ---------------------------------------------------------- */

  const inPanel = useCallback((node: EventTarget | null): boolean => {
    return node instanceof Node && document.getElementById('lab-panel')?.contains(node) === true;
  }, []);

  useEffect(() => {
    if (mode !== 'pick') return;

    function onOver(event: MouseEvent) {
      if (inPanel(event.target)) return;
      const el = event.target as HTMLElement | null;
      if (el === null) return;
      el.setAttribute('data-lab-hover', '');
    }
    function onOut(event: MouseEvent) {
      (event.target as HTMLElement | null)?.removeAttribute('data-lab-hover');
    }
    function onClick(event: MouseEvent) {
      if (inPanel(event.target)) return;
      event.preventDefault();
      event.stopPropagation();
      const el = event.target as HTMLElement | null;
      if (el === null) return;
      setSelected(el);
      setTab('thing');
    }

    document.addEventListener('mouseover', onOver, true);
    document.addEventListener('mouseout', onOut, true);
    document.addEventListener('click', onClick, true);
    return () => {
      document.removeEventListener('mouseover', onOver, true);
      document.removeEventListener('mouseout', onOut, true);
      document.removeEventListener('click', onClick, true);
      document.querySelectorAll('[data-lab-hover]').forEach((el) => el.removeAttribute('data-lab-hover'));
    };
  }, [mode, inPanel]);

  useEffect(() => {
    document.querySelectorAll('[data-lab-selected]').forEach((el) => el.removeAttribute('data-lab-selected'));
    selected?.setAttribute('data-lab-selected', '');
  }, [selected]);

  /* ---- editing text ------------------------------------------------------ */

  useEffect(() => {
    const app = document.querySelector('.w-app') ?? document.body;
    if (mode !== 'text') {
      (app as HTMLElement).removeAttribute('contenteditable');
      return;
    }
    (app as HTMLElement).setAttribute('contenteditable', 'true');
    (app as HTMLElement).setAttribute('spellcheck', 'false');

    /* Remember what every leaf said before it was touched, so a save can report both sides. */
    for (const el of app.querySelectorAll<HTMLElement>('h1,h2,h3,h4,p,span,a,button,li,td,th,label,strong,em')) {
      if (el.children.length === 0 && !originalText.current.has(el)) {
        originalText.current.set(el, (el.textContent ?? '').trim());
      }
    }
    return () => (app as HTMLElement).removeAttribute('contenteditable');
  }, [mode]);

  const collectText = useCallback((): TextEdit[] => {
    const edits: TextEdit[] = [];
    for (const [el, before] of originalText.current) {
      if (!el.isConnected) continue;
      const after = (el.textContent ?? '').trim();
      if (after !== before) edits.push({ path: describe(el), before, after });
    }
    return edits;
  }, []);

  /* ---- changing things --------------------------------------------------- */

  function setToken(name: string, value: string) {
    document.documentElement.style.setProperty(name, value);
    setState((s) => ({ ...s, tokens: { ...s.tokens, [name]: value } }));
  }

  function resetToken(name: string) {
    document.documentElement.style.removeProperty(name);
    setState((s) => {
      const tokens = { ...s.tokens };
      delete tokens[name];
      return { ...s, tokens };
    });
  }

  function nudge(css: string, value: string) {
    if (selected === null) return;
    selected.style.setProperty(
      css.replace(/[A-Z]/g, (m) => `-${m.toLowerCase()}`),
      value,
    );
    const path = describe(selected);
    setState((s) => {
      const rest = s.nudges.filter((n) => n.path !== path);
      const existing = s.nudges.find((n) => n.path === path);
      return {
        ...s,
        nudges: [...rest, { path, snippet: snippet(selected), css: { ...(existing?.css ?? {}), [css]: value } }],
      };
    });
  }

  function move(direction: -1 | 1) {
    if (selected === null) return;
    const parent = selected.parentElement;
    if (parent === null) return;
    const sibling = direction === -1 ? selected.previousElementSibling : selected.nextElementSibling;
    if (sibling === null) return;
    if (direction === -1) parent.insertBefore(selected, sibling);
    else parent.insertBefore(sibling, selected);
    setState((s) => ({
      ...s,
      notes: `${s.notes}${s.notes === '' ? '' : '\n'}Moved ${direction === -1 ? 'up' : 'down'}: ${describe(selected)} — "${snippet(selected)}"`,
    }));
  }

  function hide() {
    if (selected === null) return;
    selected.style.display = 'none';
    setState((s) => ({ ...s, hidden: [...s.hidden, `${describe(selected)} — "${snippet(selected)}"`] }));
    setSelected(null);
  }

  /* ---- saving ------------------------------------------------------------ */

  async function commit() {
    setSaving('saving');
    const texts = collectText();
    const payload = {
      page: `${pathname ?? ''}${window.location.search}`,
      viewport: { width: window.innerWidth, height: window.innerHeight },
      at: new Date().toISOString(),
      tokens: state.tokens,
      defaults,
      nudges: state.nudges,
      texts,
      hidden: state.hidden,
      notes: state.notes,
      html: (document.querySelector('.w-app') ?? document.body).outerHTML.slice(0, 400_000),
    };
    try {
      const response = await fetch('/api/lab', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (!response.ok) {
        setSaving('failed');
        return;
      }
      const body = (await response.json()) as { folder?: string };
      setSavedTo(body.folder ?? null);
      setSaving('saved');
    } catch {
      setSaving('failed');
    }
  }

  function clearAll() {
    for (const name of Object.keys(state.tokens)) document.documentElement.style.removeProperty(name);
    setState(EMPTY);
    setSelected(null);
    setSaving('idle');
    window.location.reload();
  }

  if (process.env.NODE_ENV === 'production') return null;
  /* The lab does not appear on its own index — the tool must not sit inside the thing it edits. */
  if (pathname !== null && (pathname === '/lab' || pathname.startsWith('/lab/'))) return null;

  const changeCount =
    Object.keys(state.tokens).length + state.nudges.length + state.hidden.length + (state.notes === '' ? 0 : 1);

  return (
    <>
      <style>{CSS}</style>

      {!open && (
        <button type="button" className="lab-fab" onClick={() => setOpen(true)}>
          Design lab{changeCount > 0 ? ` · ${changeCount}` : ''}
        </button>
      )}

      {open && (
        <div id="lab-panel" className="lab">
          <div className="lab-top">
            <strong>Design lab</strong>
            <span className="lab-dim">{pathname}</span>
            <button type="button" className="lab-x" onClick={() => setOpen(false)} aria-label="Close">
              ✕
            </button>
          </div>

          <div className="lab-modes">
            <button type="button" data-on={mode === 'off'} onClick={() => setMode('off')}>
              Browse
            </button>
            <button type="button" data-on={mode === 'pick'} onClick={() => setMode('pick')}>
              Point at a thing
            </button>
            <button type="button" data-on={mode === 'text'} onClick={() => setMode('text')}>
              Rewrite the words
            </button>
          </div>
          <p className="lab-help">
            {mode === 'off' && 'Click through the app as normal. Switch mode when you want to change something.'}
            {mode === 'pick' && 'Click anything on the page. Its size, spacing and position appear under “This thing”.'}
            {mode === 'text' && 'Click into any text and type. Both versions are recorded when you save.'}
          </p>

          <div className="lab-tabs">
            <button type="button" data-on={tab === 'look'} onClick={() => setTab('look')}>
              Look
            </button>
            <button type="button" data-on={tab === 'thing'} onClick={() => setTab('thing')}>
              This thing
            </button>
            <button type="button" data-on={tab === 'notes'} onClick={() => setTab('notes')}>
              Say it
            </button>
          </div>

          <div className="lab-body">
            {tab === 'look' && (
              <>
                {GROUPS.map((group) => (
                  <section key={group}>
                    <h4>{group}</h4>
                    {TOKENS.filter((t) => t.group === group).map((token) => {
                      const current = state.tokens[token.name] ?? defaults[token.name] ?? '';
                      const changed = state.tokens[token.name] !== undefined;
                      return (
                        <label key={token.name} className="lab-row">
                          <span className={changed ? 'lab-name lab-changed' : 'lab-name'}>{token.label}</span>
                          {token.kind === 'colour' && (
                            <input
                              type="color"
                              value={/^#[0-9a-f]{6}$/i.test(current) ? current : '#000000'}
                              onChange={(e) => setToken(token.name, e.target.value)}
                            />
                          )}
                          {token.kind === 'length' && (
                            <input
                              type="number"
                              value={Number.parseFloat(current) || 0}
                              onChange={(e) => setToken(token.name, `${e.target.value}px`)}
                            />
                          )}
                          {token.kind === 'text' && (
                            <input type="text" value={current} onChange={(e) => setToken(token.name, e.target.value)} />
                          )}
                          {changed && (
                            <button type="button" className="lab-undo" onClick={() => resetToken(token.name)}>
                              undo
                            </button>
                          )}
                        </label>
                      );
                    })}
                  </section>
                ))}
              </>
            )}

            {tab === 'thing' && (
              <>
                {selected === null ? (
                  <p className="lab-help">
                    Nothing picked. Switch to <b>Point at a thing</b> and click something on the page.
                  </p>
                ) : (
                  <>
                    <p className="lab-path">{describe(selected)}</p>
                    <p className="lab-snip">“{snippet(selected)}”</p>
                    <div className="lab-actions">
                      <button type="button" onClick={() => move(-1)}>
                        Move up
                      </button>
                      <button type="button" onClick={() => move(1)}>
                        Move down
                      </button>
                      <button type="button" onClick={hide}>
                        Take it out
                      </button>
                      <button type="button" onClick={() => setSelected(selected.parentElement)}>
                        Pick its container
                      </button>
                    </div>
                    {NUDGES.map((n) => {
                      const live = getComputedStyle(selected)[n.css as 'fontSize'];
                      const value = Number.parseFloat(live) || 0;
                      return (
                        <label key={n.css} className="lab-row">
                          <span className="lab-name">{n.label}</span>
                          <input
                            type="range"
                            min={n.min}
                            max={n.max}
                            step={n.step}
                            value={value}
                            onChange={(e) => nudge(n.css, `${e.target.value}${n.unit}`)}
                          />
                          <span className="lab-num">{live}</span>
                        </label>
                      );
                    })}
                  </>
                )}
              </>
            )}

            {tab === 'notes' && (
              <>
                <p className="lab-help">
                  Anything you cannot do with the controls. Write it however you like — it is read by
                  a person, not parsed.
                </p>
                <textarea
                  className="lab-notes"
                  value={state.notes}
                  placeholder={'e.g. "the posts should be wider and the rail narrower"\n"this heading is shouting"\n"put the money figure where the date is"'}
                  onChange={(e) => setState((s) => ({ ...s, notes: e.target.value }))}
                />
                {state.hidden.length > 0 && (
                  <>
                    <h4>Taken out</h4>
                    <ul className="lab-list">
                      {state.hidden.map((h) => (
                        <li key={h}>{h}</li>
                      ))}
                    </ul>
                  </>
                )}
              </>
            )}
          </div>

          <div className="lab-foot">
            <button type="button" className="lab-save" onClick={() => void commit()} disabled={saving === 'saving'}>
              {saving === 'saving' ? 'Saving…' : 'Save what I changed'}
            </button>
            <button type="button" className="lab-clear" onClick={clearAll}>
              Start over
            </button>
          </div>
          {saving === 'saved' && (
            <p className="lab-ok">
              Written to <code>{savedTo}</code>. Tell Claude it is there.
            </p>
          )}
          {saving === 'failed' && <p className="lab-bad">Could not write it. Is the dev server still running?</p>}
        </div>
      )}
    </>
  );
}

/*
  The panel's own appearance.

  Hard-coded, and it has to be: this sits on top of the design it edits, so a panel built from the
  same tokens would recolour itself the moment a colour is changed and become unreadable exactly
  when it is being used. `all: revert` on the root stops the application's cascade reaching in.
*/
const CSS = `
.lab-fab{position:fixed;right:16px;bottom:16px;z-index:2147483000;font:600 12px/1 ui-sans-serif,system-ui,sans-serif;
  padding:10px 14px;border-radius:999px;border:1px solid #3a3f52;background:#14161f;color:#e8ecf6;cursor:pointer}
.lab-fab:hover{background:#1c1f2b}
.lab{position:fixed;right:0;top:0;bottom:0;width:352px;z-index:2147483000;display:flex;flex-direction:column;
  background:#0e1017;border-left:1px solid #2a2f3d;color:#e8ecf6;
  font:400 12.5px/1.5 ui-sans-serif,system-ui,sans-serif;box-shadow:-18px 0 40px rgba(0,0,0,.45)}
.lab *{box-sizing:border-box}
.lab-top{display:flex;align-items:center;gap:8px;padding:12px 14px;border-bottom:1px solid #2a2f3d}
.lab-top strong{font-size:13px}
.lab-dim{color:#7c869c;font-family:ui-monospace,monospace;font-size:11px;flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.lab-x{background:none;border:0;color:#7c869c;cursor:pointer;font-size:14px}
.lab-modes,.lab-tabs{display:flex;gap:4px;padding:10px 14px 0}
.lab-modes button,.lab-tabs button{flex:1;padding:7px 6px;border-radius:7px;border:1px solid #2a2f3d;background:#151824;
  color:#a8b1c6;font:600 11.5px/1.2 inherit;cursor:pointer}
.lab-modes button[data-on=true],.lab-tabs button[data-on=true]{background:#2b6cf6;border-color:#2b6cf6;color:#fff}
.lab-help{margin:8px 14px 0;color:#7c869c;font-size:11.5px}
.lab-body{flex:1;overflow:auto;padding:6px 14px 14px}
.lab-body h4{margin:16px 0 6px;font-size:10.5px;letter-spacing:.09em;text-transform:uppercase;color:#6d7689}
.lab-row{display:flex;align-items:center;gap:8px;padding:4px 0}
.lab-name{flex:1;color:#c3cbdb}
.lab-changed{color:#7ee2b0;font-weight:600}
.lab-row input[type=color]{width:34px;height:24px;padding:0;border:1px solid #2a2f3d;border-radius:5px;background:none}
.lab-row input[type=number],.lab-row input[type=text]{width:104px;padding:4px 6px;border:1px solid #2a2f3d;border-radius:5px;
  background:#151824;color:#e8ecf6;font:400 11.5px/1.3 ui-monospace,monospace}
.lab-row input[type=range]{width:120px}
.lab-num{width:52px;text-align:right;color:#7c869c;font:400 11px/1 ui-monospace,monospace}
.lab-undo{background:none;border:0;color:#7c869c;cursor:pointer;font-size:10.5px;text-decoration:underline}
.lab-path{margin:10px 0 2px;font:400 11px/1.45 ui-monospace,monospace;color:#7ee2b0;word-break:break-all}
.lab-snip{margin:0 0 10px;color:#a8b1c6}
.lab-actions{display:flex;flex-wrap:wrap;gap:6px;margin-bottom:10px}
.lab-actions button{padding:6px 9px;border-radius:6px;border:1px solid #2a2f3d;background:#151824;color:#c3cbdb;
  font:600 11px/1 inherit;cursor:pointer}
.lab-notes{width:100%;height:190px;margin-top:8px;padding:9px;border:1px solid #2a2f3d;border-radius:7px;
  background:#151824;color:#e8ecf6;font:400 12px/1.55 inherit;resize:vertical}
.lab-list{margin:6px 0 0;padding-left:16px;color:#a8b1c6;font-size:11px}
.lab-foot{display:flex;gap:8px;padding:12px 14px;border-top:1px solid #2a2f3d}
.lab-save{flex:1;padding:10px;border-radius:8px;border:0;background:#2b6cf6;color:#fff;font:700 12.5px/1 inherit;cursor:pointer}
.lab-save:disabled{opacity:.6}
.lab-clear{padding:10px 12px;border-radius:8px;border:1px solid #2a2f3d;background:none;color:#7c869c;
  font:600 12px/1 inherit;cursor:pointer}
.lab-ok{margin:0;padding:0 14px 14px;color:#7ee2b0;font-size:11.5px}
.lab-ok code{font-family:ui-monospace,monospace}
.lab-bad{margin:0;padding:0 14px 14px;color:#ff8aa0;font-size:11.5px}
[data-lab-hover]{outline:1px dashed #2b6cf6 !important;outline-offset:1px}
[data-lab-selected]{outline:2px solid #7ee2b0 !important;outline-offset:1px}
`;
