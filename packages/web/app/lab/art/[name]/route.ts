// Built-by: @projectx.sui · Co-authored-by: Claude
/**
 * Serves one artboard, with an editing bar attached.
 *
 * The artboards are plain HTML with inline styles and no script of their own, which is what makes
 * them readable and what makes this possible: the file is read, a small bar is appended, and the
 * result is served. The file on disk is never modified — a save writes a *report* of what changed
 * alongside the others in `docs/app-production/lab/`, so the drawing stays the drawing.
 *
 * Development only, and the name is validated rather than trusted: only `[A-Za-z0-9-]`, resolved
 * against the artboards folder and given the `.dc.html` suffix here. A request cannot name a path.
 */

import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * The bar, as plain script.
 *
 * Everything is editable the moment it loads, because that is the only thing anybody opens an
 * artboard to do. Save posts to the same endpoint the application's panel uses, so a change made
 * here and a change made there arrive in the same place in the same shape.
 */
const BAR = `
<style>
  .lab-bar{position:fixed;left:0;right:0;bottom:0;z-index:2147483000;display:flex;align-items:center;gap:10px;
    padding:10px 14px;background:#0e1017;border-top:1px solid #2a2f3d;color:#e8ecf6;
    font:400 12.5px/1.4 ui-sans-serif,system-ui,sans-serif}
  .lab-bar b{font-size:12.5px}
  .lab-bar input{flex:1;padding:7px 9px;border:1px solid #2a2f3d;border-radius:6px;background:#151824;
    color:#e8ecf6;font:inherit}
  .lab-bar button{padding:8px 13px;border-radius:7px;border:0;background:#2b6cf6;color:#fff;
    font:700 12px/1 inherit;cursor:pointer}
  .lab-bar span{color:#7c869c;font-size:11.5px}
  body{padding-bottom:60px}
  [contenteditable]:focus{outline:2px solid #7ee2b0;outline-offset:2px}
</style>
<div class="lab-bar">
  <b>Click anything and type.</b>
  <input id="lab-note" placeholder="Anything you cannot type into the page — say it here" />
  <button id="lab-save" type="button">Save what I changed</button>
  <span id="lab-said"></span>
</div>
<script>
(function () {
  var root = document.body;
  var before = new Map();
  var leaves = root.querySelectorAll('h1,h2,h3,h4,p,span,a,button,li,td,th,label,strong,em,div');
  for (var i = 0; i < leaves.length; i++) {
    var el = leaves[i];
    if (el.closest('.lab-bar')) continue;
    if (el.children.length === 0) before.set(el, (el.textContent || '').trim());
  }
  root.setAttribute('contenteditable', 'true');
  root.setAttribute('spellcheck', 'false');
  document.querySelector('.lab-bar').setAttribute('contenteditable', 'false');

  function path(el) {
    var parts = [], node = el, depth = 0;
    while (node && depth < 5 && node.tagName !== 'BODY') {
      var cls = [].slice.call(node.classList).slice(0, 2).map(function (c) { return '.' + c; }).join('');
      parts.unshift(node.tagName.toLowerCase() + cls);
      node = node.parentElement; depth++;
    }
    return parts.join(' > ');
  }

  document.getElementById('lab-save').addEventListener('click', function () {
    var texts = [];
    before.forEach(function (was, el) {
      var now = (el.textContent || '').trim();
      if (now !== was) texts.push({ path: path(el), before: was, after: now });
    });
    var said = document.getElementById('lab-said');
    said.textContent = 'Saving…';
    fetch('/api/lab', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        page: 'artboard ' + document.title,
        at: new Date().toISOString(),
        viewport: { width: window.innerWidth, height: window.innerHeight },
        texts: texts,
        notes: document.getElementById('lab-note').value,
        html: document.documentElement.outerHTML.slice(0, 400000)
      })
    }).then(function (r) { return r.json(); }).then(function (b) {
      said.textContent = b.folder ? ('Written to ' + b.folder) : 'Saved';
    }).catch(function () { said.textContent = 'Could not write it.'; });
  });
})();
</script>
`;

export async function GET(_request: Request, context: { params: Promise<{ name: string }> }) {
  if (process.env.NODE_ENV !== 'development') {
    return new Response('Not found', { status: 404 });
  }

  const { name } = await context.params;
  if (!/^[A-Za-z0-9-]{1,60}$/.test(name)) {
    return new Response('Not found', { status: 404 });
  }

  const file = join(process.cwd(), '..', '..', 'docs', 'app-production', 'artboards', `${name}.dc.html`);
  let html: string;
  try {
    html = await readFile(file, 'utf8');
  } catch {
    return new Response('Not found', { status: 404 });
  }

  const withBar = html.includes('</body>') ? html.replace('</body>', `${BAR}</body>`) : `${html}${BAR}`;
  return new Response(withBar, {
    headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' },
  });
}
