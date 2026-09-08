import { t, dishName, getLanguage } from './i18n.js';

// The board and food own the interaction; the DOM adds only what the scene cannot: a loader with
// download progress, the Play / Another round buttons, a sound toggle and the language choice,
// a quiet hint line, character bubbles and the tasting reaction. Semantic menu controls and
// announcements provide equivalent screen-reader access.
export class UI {
  constructor(handlers) {
    this.h = handlers;
    this.el = Object.fromEntries(['scene','scene-guide','loader','loader-label','loader-percent','loader-fill','title-screen','title-eyebrow','title-tagline','play-button','sound-toggle','menu-access','announcer','toast','record-dot','bubbles','reaction','scene-hint','next-round','another-round','language-switch'].map(id=>[id,document.getElementById(id)]));
    this.menuPortion = 5;
    this.bubbles = [];
    this.reactionAge = 0;
    this.guideText = '';
    this.guideScene = '';
    this.progress = 0;
    this.el['play-button'].addEventListener('click',()=>this.h.onPlay());
    this.el['another-round'].addEventListener('click',()=>this.h.onMenu());
    this.el['sound-toggle'].addEventListener('click',()=>this.h.onSound?.());
    this.el['language-switch'].querySelectorAll('[data-language]').forEach(button => {
      button.addEventListener('click', () => this.h.onLanguage(button.dataset.language));
    });
    this.localize();
  }
  localize() {
    const language = getLanguage();
    document.documentElement.lang = language === 'zh' ? 'zh-Hans' : language;
    this.el['play-button'].firstChild.textContent = t('play');
    this.el['another-round'].firstChild.textContent = t('anotherRound');
    this.el['scene-guide'].textContent = t('sceneGuide');
    this.el.scene.setAttribute('aria-label', t('sceneLabel'));
    this.el['loader-label'].textContent = t('loading');
    this.el['title-eyebrow'].textContent = t('eyebrow');
    this.el['title-tagline'].textContent = t('tagline');
    this.el['sound-toggle'].setAttribute('aria-label', t('sound'));
    this.el['menu-access'].setAttribute('aria-label', t('menu'));
    this.el['language-switch'].setAttribute('aria-label', t('language'));
    this.el['language-switch'].querySelectorAll('[data-language]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.language === language)));
    this.el['menu-access'].querySelectorAll('[data-dish]').forEach(b => b.textContent = dishName(b.dataset.dish));
    this.el['menu-access'].querySelectorAll('[data-portion]').forEach(b => b.textContent = t('portion', {n: b.dataset.portion}));
    this.el.toast.hidden = true;
    this.lastHint = '';
  }
  /** Download progress of the dish the table is waiting for (0..1). */
  setProgress(fraction) {
    const f = Math.max(0, Math.min(1, +fraction || 0));
    if (Math.abs(f - this.progress) < 0.005 && f < 1) return;
    this.progress = f;
    this.el['loader-fill'].style.width = (f * 100).toFixed(0) + '%';
    this.el['loader-percent'].textContent = f > 0 ? (f * 100).toFixed(0) + '%' : '';
  }
  hideLoader() { this.setProgress(1); this.el.loader.classList.add('is-hidden'); }
  showTitle(show) {
    this.el['title-screen'].classList.toggle('is-hidden',!show);
    this.el['title-screen'].inert = !show;
    this.el.scene.inert = show;
    if(show) this.el['play-button'].focus({preventScroll:true});
  }
  setMenu(items,current) {
    const nodes = items.map((item,i)=>{
      const b=document.createElement('button'); b.type='button'; b.textContent=dishName(item.id);
      b.dataset.dish=item.id;
      b.addEventListener('focus',()=>this.h.onMenuFocus(i));
      b.addEventListener('click',()=>this.h.onMenuSelect(i));
      return b;
    });
    [3,5,8].forEach(n=>{
      const b=document.createElement('button'); b.type='button'; b.textContent=t('portion', {n}); b.dataset.portion=n;
      b.addEventListener('click',()=>this.h.onMenuPortion(n)); nodes.push(b);
    });
    this.el['menu-access'].replaceChildren(...nodes); this.markCurrent(current);
  }
  markCurrent(id) { this.el['menu-access'].querySelectorAll('[data-dish]').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.dish===id))); }
  setMenuPortion(n) {
    this.menuPortion=n;
    this.el['menu-access'].querySelectorAll('[data-portion]').forEach(b=>b.setAttribute('aria-pressed',String(+b.dataset.portion===n)));
  }
  showMenu(show) { this.el['menu-access'].hidden=!show; }
  setCinematic(on) {
    this.el.scene.setAttribute('aria-busy',String(on));
    document.body.classList.toggle('is-cinematic', !!on);
  }
  sync(state) {
    this.el.scene.dataset.sound=state.sound?'on':'off';
    this.el['sound-toggle'].setAttribute('aria-pressed', String(!!state.sound));
  }
  showNextRound(show) { if (this.el['next-round'].hidden === show) this.el['next-round'].hidden = !show; }
  setGuide(text, scene) {
    const el = this.el['scene-hint'];
    if (this.guideScene !== scene) { this.guideScene = scene; el.dataset.scene = scene; }
    if (this.guideText !== text) {
      this.guideText = text;
      el.textContent = text;
      // Restart the small entrance so a changed hint is noticed without being loud.
      el.classList.remove('is-refreshed');
      void el.offsetWidth;
      el.classList.add('is-refreshed');
    }
    if (el.hidden !== !text) el.hidden = !text;
  }
  setHint(text) { if(text && text!==this.lastHint) this.announce(text); this.lastHint=text; }
  showReaction(text) {
    const el = this.el.reaction;
    el.textContent = text;
    el.hidden = false;
    el.classList.remove('is-showing');
    void el.offsetWidth;
    el.classList.add('is-showing');
    this.reactionAge = 2;
    // Bubbles steer around the reaction while it is up (measured once, here).
    const r = el.getBoundingClientRect();
    this.reactionRect = { left: r.left, right: r.right, top: r.top, bottom: r.bottom };
    this.announce(text);
  }
  bubble(text, name, getScreen, life = 2, owner = name) {
    // One voice per dumpling, at most two on screen at once.
    for (const bubble of this.bubbles.filter(b => b.owner === owner)) this.removeBubble(bubble);
    while (this.bubbles.length >= 2) this.removeBubble(this.bubbles[0]);
    const div = document.createElement('div');
    div.className = 'bubble';
    div.textContent = text;
    if (name) { const label = document.createElement('small'); label.textContent = name; div.appendChild(label); }
    this.el.bubbles.append(div);
    // Measure once and freeze the width: the per-frame positioning below never reads layout again.
    // offsetWidth rounds to whole pixels; one extra pixel guarantees the text never re-wraps.
    const width = div.offsetWidth + 1;
    div.style.width = width + 'px';
    const height = div.offsetHeight;
    const bubble = { div, getScreen, life, age: 0, owner, width, height, x: NaN, y: NaN, hidden: false };
    this.bubbles.push(bubble);
    this.positionBubble(bubble);
  }
  removeBubble(bubble) {
    bubble.div.remove();
    this.bubbles.splice(this.bubbles.indexOf(bubble), 1);
  }
  positionBubble(bubble, occupied = []) {
    const p = bubble.getScreen();
    const hidden = !p?.visible;
    if (hidden !== bubble.hidden) { bubble.hidden = hidden; bubble.div.hidden = hidden; }
    if (hidden) return;
    const width = bubble.width, height = bubble.height;
    const half = width / 2 + 10;
    let x = Math.max(half, Math.min(innerWidth - half, p.x));
    let y = Math.max(height + 12, Math.min(innerHeight - 12, p.y - 10));
    for (const r of occupied) {
      if (x + width/2 <= r.left - 8 || x - width/2 >= r.right + 8 || y <= r.top - 8 || y - height >= r.bottom + 8) continue;
      const options = [r.left - 10 - width/2, r.right + 10 + width/2]
        .filter(next => next >= half && next <= innerWidth - half)
        .sort((a,b) => Math.abs(a-x) - Math.abs(b-x));
      if (options.length) x = options[0];
      else y = r.top - 8 >= height + 12 ? r.top - 8 : Math.min(innerHeight - 12,r.bottom + height + 8);
    }
    // Sub-pixel jitter from the projection is not worth a style write.
    x = Math.round(x); y = Math.round(y);
    if (x !== bubble.x) { bubble.x = x; bubble.div.style.left = x + 'px'; }
    if (y !== bubble.y) { bubble.y = y; bubble.div.style.top = y + 'px'; }
    return { left: x-width/2, right: x+width/2, top: y-height, bottom: y };
  }
  updateReactions(dt) {
    const occupied = [];
    if (this.reactionAge > 0 && this.reactionRect) occupied.push(this.reactionRect);
    for (const bubble of [...this.bubbles]) {
      bubble.age += dt;
      if (bubble.age > bubble.life + .25) { this.removeBubble(bubble); continue; }
      const leaving = bubble.age > bubble.life;
      if (leaving !== bubble.leaving) { bubble.leaving = leaving; bubble.div.classList.toggle('is-leaving', leaving); }
      const rect = this.positionBubble(bubble, occupied);
      if (rect) occupied.push(rect);
    }
    if (this.reactionAge > 0) {
      this.reactionAge -= dt;
      if (this.reactionAge <= 0) this.el.reaction.hidden = true;
    }
  }
  clearReactions() {
    for (const bubble of [...this.bubbles]) this.removeBubble(bubble);
    this.reactionAge = 0;
    this.el.reaction.hidden = true;
  }
  setRecording(on,status=t('recording')) { this.el['record-dot'].hidden=!on; this.announce(on?status:t('recorded')); }
  setRecordTime(seconds,status) { if(status) this.announce(status); }
  setRecordNote(text) { this.el['record-dot'].setAttribute('aria-label',text); }
  toast(html,ms=4000) {
    this.el.toast.innerHTML=html; this.el.toast.hidden=false;
    clearTimeout(this.toastTimer); this.toastTimer=setTimeout(()=>{this.el.toast.hidden=true;},ms);
  }
  announce(text) { this.el.announcer.textContent=text; }
  setCursor(kind) {
    if (this.cursor === kind) return;
    this.cursor = kind;
    this.el.scene.classList.toggle('is-pointer',kind==='pointer'); this.el.scene.classList.toggle('is-grab',kind==='grab'); this.el.scene.classList.toggle('is-grabbing',kind==='grabbing');
  }
}
