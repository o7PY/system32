// Dialog = small non-resizable Window with an icon, message and 1-2 buttons.
import { Window } from './WindowManager.js';
import { esc, icon } from './ui.js';
import { play } from './sound.js';

const ART = { info: 'a-dlg-info', warning: 'a-dlg-warning', error: 'a-dlg-error' };

export class Dialog extends Window {
  /**
   * @param {{title?:string, message:string|Node, kind?:'info'|'warning'|'error', buttons?:{label:string,value?:any,primary?:boolean}[],
   *          parent?:Window|null, width?:number, html?:boolean}} o
   * `message` is plain text unless it is a Node. Pass `html: true` only for trusted markup.
   */
  constructor({ title = 'System32', message, kind = 'info', buttons = [{ label: 'OK', primary: true }], parent = null, width = 400, html = false } = {}) {
    super({
      title, icon: ART[kind] ?? ART.info, width, height: 'auto',
      resizable: false, minimizable: false, maximizable: false, skipTaskbar: true,
      content: () => this.#build(message, kind, buttons, html),
    });
    this.kind = kind;
    this.parentWin = parent && !parent.closed ? parent : null;
    this._value = null;
    this.result = new Promise((resolve) => { this._resolve = resolve; });
  }

  get isDialog() { return true; }

  #build(message, kind, buttons, html) {
    const root = document.createElement('div');
    root.className = 'dlg';
    const main = document.createElement('div');
    main.className = 'dlg-main';
    main.innerHTML = icon(ART[kind] ?? ART.info, 36);
    const msg = document.createElement('div');
    msg.className = 'dlg-msg';
    if (message instanceof Node) msg.append(message);
    else if (html) msg.innerHTML = message;
    else msg.innerHTML = esc(message).replace(/\n/g, '<br>');
    main.append(msg);

    const row = document.createElement('div');
    row.className = 'dlg-buttons';
    for (const b of buttons) {
      const btn = document.createElement('button');
      btn.className = `btn${b.primary ? ' primary' : ''}`;
      btn.textContent = b.label;
      btn.addEventListener('click', () => { this._value = b.value ?? b.label; this.close(); });
      row.append(btn);
    }
    root.append(main, row);
    return root;
  }

  open() {
    const parent = this.parentWin;
    if (parent) {
      // Centre on the parent and dim only the parent.
      this.x = Math.round(parent.x + (parent.w - this.reqW) / 2);
      this.y = Math.round(parent.y + parent.h / 3 - 40);
      parent.modalChild = this;
      parent.el.classList.add('has-modal');
    }
    super.open();
    if (this.kind !== 'info') play('error');
    this.el.addEventListener('keydown', (e) => { if (e.key === 'Escape') this.close(); });
    (this.el.querySelector('.btn.primary') ?? this.el.querySelector('.btn'))?.focus();
    return this;
  }

  close() {
    if (this.closed) return;
    const parent = this.parentWin;
    super.close();
    this._resolve(this._value);
    if (parent && parent.modalChild === this) {
      parent.modalChild = null;
      parent.el?.classList.remove('has-modal');
      if (!parent.closed && !parent.minimized) parent.focus();
    }
  }
}

/** Open a dialog; returns the Dialog (await `.result` for the clicked button's value, or null if dismissed). */
export function showDialog(opts) {
  return new Dialog(opts).open();
}

/** Yes/No confirmation -> Promise<boolean>. */
export async function confirmDialog(message, { title = 'System32', kind = 'warning', yes = 'Yes', no = 'No', parent = null } = {}) {
  const dlg = showDialog({
    title, message, kind, parent,
    buttons: [{ label: yes, value: true, primary: true }, { label: no, value: false }],
  });
  return (await dlg.result) === true;
}

