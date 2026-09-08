import { t, dishName, getLanguage } from './i18n.js';

// The board and food own the interaction; small language and round controls complement it.
// Semantic menu controls and announcements provide equivalent screen-reader access.
export class UI {
  constructor(handlers) {
    this.h = handlers;
    this.el = Object.fromEntries(['scene','scene-guide','loader','title-screen','play-button','menu-access','announcer','toast','record-dot','bubbles','reaction','scene-hint','next-round','another-round','language-switch'].map(id=>[id,document.getElementById(id)]));
    this.menuPortion = 5;
    this.bubbles = [];
    this.reactionAge = 0;
    this.el['play-button'].addEventListener('click',()=>this.h.onPlay());
    this.el['another-round'].addEventListener('click',()=>this.h.onMenu());
    this.el['language-switch'].querySelectorAll('[data-language]').forEach(button => {
      button.addEventListener('click', () => this.h.onLanguage(button.dataset.language));
    });
    this.localize();
  }
  localize() {
    const language = getLanguage();
    document.documentElement.lang = language === 'zh' ? 'zh-Hans' : language;
    this.el['play-button'].firstChild.textContent = t('play') + ' ';
    this.el['another-round'].firstChild.textContent = t('anotherRound') + ' ';
    this.el['scene-guide'].textContent = t('sceneGuide');
    this.el.scene.setAttribute('aria-label', t('sceneLabel'));
    this.el.loader.querySelector('.sr-only').textContent = t('loading');
    this.el['menu-access'].setAttribute('aria-label', t('menu'));
    this.el['language-switch'].setAttribute('aria-label', t('language'));
    this.el['language-switch'].querySelectorAll('[data-language]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.language === language)));
    this.el['menu-access'].querySelectorAll('[data-dish]').forEach(b => b.textContent = dishName(b.dataset.dish));
    this.el['menu-access'].querySelectorAll('[data-portion]').forEach(b => b.textContent = t('portion', {n: b.dataset.portion}));
    this.el.toast.hidden = true;
    this.lastHint = '';
  }
  hideLoader() { this.el.loader.classList.add('is-hidden'); }
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
  setCinematic(on) { this.el.scene.setAttribute('aria-busy',String(on)); }
  sync(state) { this.el.scene.dataset.sound=state.sound?'on':'off'; }
  showNextRound(show) { if (this.el['next-round'].hidden === show) this.el['next-round'].hidden = !show; }
  setGuide(text, scene) {
    const el = this.el['scene-hint'];
    if (el.dataset.scene !== scene) el.dataset.scene = scene;
    if (el.textContent !== text) el.textContent = text;
    el.hidden = !text;
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
    const bubble = { div, getScreen, life, age: 0, owner };
    this.bubbles.push(bubble);
    this.positionBubble(bubble);
  }
  removeBubble(bubble) {
    bubble.div.remove();
    this.bubbles.splice(this.bubbles.indexOf(bubble), 1);
  }
  positionBubble(bubble, occupied = []) {
    const p = bubble.getScreen();
    bubble.div.hidden = !p?.visible;
    if (!p?.visible) return;
    const width = bubble.div.offsetWidth, height = bubble.div.offsetHeight;
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
    bubble.div.style.left = x + 'px';
    bubble.div.style.top = y + 'px';
    return { left: x-width/2, right: x+width/2, top: y-height, bottom: y };
  }
  updateReactions(dt) {
    const occupied = [];
    for (const bubble of [...this.bubbles]) {
      bubble.age += dt;
      if (bubble.age > bubble.life + .25) { this.removeBubble(bubble); continue; }
      bubble.div.classList.toggle('is-leaving', bubble.age > bubble.life);
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
  setCursor(kind) { this.el.scene.classList.toggle('is-pointer',kind==='pointer'); this.el.scene.classList.toggle('is-grab',kind==='grab'); this.el.scene.classList.toggle('is-grabbing',kind==='grabbing'); }
}
