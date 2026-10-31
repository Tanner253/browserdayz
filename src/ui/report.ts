// The death screen's Report (src/sim/reports.ts has why): a button, or R, opens a reason and a message; Send gives them
// to the server, which keeps them with how the death went for the admins (server/reports.ts). One report a death.

import { REPORT } from '../sim/reports';

export class ReportForm {
  readonly root = document.createElement('div');
  private button = document.createElement('button');
  private form = document.createElement('div');
  private reason = document.createElement('select');
  private text = document.createElement('textarea');
  /** sent for this death already */
  private sent = false;

  constructor(private send: (reason: string, text: string) => boolean) {
    this.root.className = 'dead-report';
    this.button.className = 'dead-report-btn';
    this.button.innerHTML = 'Report <small>R</small>';
    this.button.onclick = () => this.open();
    this.form.className = 'dead-report-form';
    this.form.hidden = true;
    this.reason.innerHTML = REPORT.reasons.map((r) => `<option value="${r}">${r}</option>`).join('');
    this.text.maxLength = REPORT.text;
    this.text.placeholder = 'What happened? (optional)';
    const ok = document.createElement('button'), no = document.createElement('button');
    ok.textContent = 'Send';
    no.textContent = 'Cancel';
    ok.onclick = () => {
      if (!this.send(this.reason.value, this.text.value)) return;
      this.sent = true;
      this.close();
    };
    no.onclick = () => this.close();
    // (typed here, nothing reaches the game: Space is not Respawn, R not a reload)
    this.form.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.code === 'Escape') this.close();
    });
    const row = document.createElement('div');
    row.append(ok, no);
    this.form.append(this.reason, this.text, row);
    this.root.append(this.button, this.form);
  }

  get isOpen() {
    return !this.form.hidden;
  }

  /** the form up, for this death (not twice) */
  open() {
    if (this.sent) return;
    this.form.hidden = false;
    this.button.hidden = true;
    this.text.focus();
  }

  close() {
    this.form.hidden = true;
    this.button.hidden = this.sent;
  }

  /** a new death: one more report may be made */
  reset() {
    this.sent = false;
    this.text.value = '';
    this.reason.selectedIndex = 0;
    this.close();
  }
}
