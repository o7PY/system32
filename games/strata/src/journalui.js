// DOM of the objectives journal and the tutorial mode: the journal screen (J), the tracker on the right edge, one-time tips and act banners.
// It draws what objectives.js says and forwards nothing: the rules live in objectives.js, the wiring in main.js.
import { OBJECTIVES, ACTS } from './config.js';

const $ = (id) => document.getElementById(id);

export class JournalUI {
  constructor() { this.timers = {}; this.openActs = null; }

  /** The journal screen: header "Objectives n/58 · Act k: title", then every act with every objective (optional ones marked), the next one highlighted. */
  render(j, { tutorial = false } = {}) {
    const cur = j.currentAct, act = ACTS.find((a) => a.act === cur);
    $('j-head').textContent = `Objectives ${j.count}/${j.total}${act ? ` · Act ${act.act}: ${act.title}` : ' · All done'}`;
    $('j-tutorial').checked = !!tutorial;
    const next = j.upcoming(1)[0]?.n;
    const host = $('j-list');
    host.textContent = '';
    for (const a of ACTS) {
      const p = j.actProgress(a.act), sec = document.createElement('section');
      sec.className = `jact${a.act === cur ? ' cur' : ''}`;
      const h = document.createElement('h3');
      h.textContent = `Act ${a.act}: ${a.title}`;
      const small = document.createElement('small'); small.textContent = ` ${p.done}/${p.total}`; h.append(small);
      const ol = document.createElement('ol');
      for (const o of OBJECTIVES.filter((x) => x.act === a.act)) {
        const li = document.createElement('li'), done = j.has(o.n);
        li.className = `${done ? 'done' : ''}${o.n === next ? ' next' : ''}`;
        const b = document.createElement('b'); b.textContent = `${done ? '✓' : '○'} ${o.n}. ${o.text}${o.optional ? ' (optional)' : ''}`;
        li.append(b);
        if (o.how) { const s = document.createElement('small'); s.textContent = o.how; li.append(s); }
        ol.append(li);
      }
      sec.append(h, ol); host.append(sec);
    }
    const nx = host.querySelector('li.next');
    if (nx) nx.scrollIntoView?.({ block: 'center' });
  }

  /** The tracker: the first open objective with its how-line, and the next two. */
  tracker(j, on) {
    const el = $('tracker');
    if (!on) { el.hidden = true; return; }
    const list = j.upcoming(3);
    el.hidden = !list.length;
    if (!list.length) return;
    const sig = list.map((o) => o.n).join();
    if (el.dataset.sig === sig) return;
    el.dataset.sig = sig;
    el.textContent = '';
    list.forEach((o, i) => {
      const d = document.createElement('div'); d.className = i ? 'tnext' : 'tcur';
      const b = document.createElement('b'); b.textContent = `${i ? '' : '▶ '}${o.text}`; d.append(b);
      if (!i && o.how) { const s = document.createElement('small'); s.textContent = o.how; d.append(s); }
      el.append(d);
    });
  }

  #flash(id, text, ms) {
    const el = $(id); el.textContent = text; el.hidden = false; el.classList.remove('show'); void el.offsetWidth; el.classList.add('show');
    clearTimeout(this.timers[id]); this.timers[id] = setTimeout(() => { el.hidden = true; el.classList.remove('show'); }, ms);
  }
  /** A tip at the top centre for 6 s. Never pauses the game. */
  tip(text) { this.#flash('tip-panel', text, 6000); }
  banner(text) { this.#flash('act-banner', text, 4500); }
  hideAll() { $('tracker').hidden = true; $('tracker').dataset.sig = ''; for (const id of ['tip-panel', 'act-banner']) { $(id).hidden = true; clearTimeout(this.timers[id]); } }
}
