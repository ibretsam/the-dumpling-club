// Real menu drawing, language switching during play, and a complete next-round journey.
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import AxeBuilder from '@axe-core/playwright';
import { mkdir } from 'node:fs/promises';
await mkdir('/tmp/dumpling-qa', { recursive: true });
const browser = await chromium.launch({ headless: true, channel: 'chrome' });
const url = process.env.TEST_URL || 'http://127.0.0.1:8080';
const locales = ['vi', 'en', 'zh'];
async function advance(page, frames = 180) {
  await page.evaluate(async n => { const a = dumplingClub; await a.run(n); a.draw(a.scene,a.camera); }, frames);
}
async function point(page, kind, value) {
  return page.evaluate(async ({kind,value}) => {
    const a=dumplingClub,T=await import('/lib/three.module.js');let p;
    if(kind==='row') p=a.menuBoard.rowPoint(value);
    else if(kind==='portion') p=a.menuBoard.portionPoint(value);
    else {const d=a.interaction.seated[0];p=d.body.localToWorld(new T.Vector3(0,d.type.metrics.height*.6,0));}
    p.project(a.camera);return{x:(p.x+1)*innerWidth/2,y:(1-p.y)*innerHeight/2};
  }, {kind,value});
}
async function tap(page, kind, value, touch) {
  const p=await point(page,kind,value);
  if(touch) await page.touchscreen.tap(p.x,p.y);else await page.mouse.click(p.x,p.y);
}
async function locale(page, language) {
  await page.locator(`[data-language="${language}"]`).click();
  assert.equal(await page.locator('html').getAttribute('lang'),language==='zh'?'zh-Hans':language);
  assert.equal(await page.locator('[data-language][aria-pressed="true"]').getAttribute('data-language'),language);
  await advance(page,1);
}
async function complete(page, operation) {
  await page.evaluate(async operation => {
    const a=dumplingClub,it=a.interaction;let done=false,ok;
    const p=operation==='pick'?it.pick(it.seated[0]):operation==='lift'?it.liftChopsticks():it.bite();
    p.then(v=>{done=true;ok=v});
    for(let i=0;i<1000&&!done;i++){a.step(1/60);await Promise.resolve();}
    if(!done||!ok)throw Error('sequence failed '+operation+': '+it.phase);
    a.step(1/60);a.draw(a.scene,a.camera);
  }, operation);
}
try {
  for(const [width,height,touch,reduced] of [[1440,1000,false,false],[390,844,true,false],[320,568,true,true],[844,390,true,false]]) {
    const context=await browser.newContext({viewport:{width,height},hasTouch:touch,reducedMotion:reduced?'reduce':'no-preference'});
    const page=await context.newPage();
    const errors=[];page.on('pageerror',e=>errors.push(e.message));
    await page.goto(url);await page.waitForFunction(()=>dumplingClub.step);
    assert.equal(await page.evaluate(()=>dumplingClub.state.language),'vi','fresh visit defaults to Vietnamese');
    await page.evaluate(async()=>{
      const i=await import('/js/i18n.js');
      for(const entries of [i.COPY,i.DISH_NAMES,i.VOICES]) for(const [key,entry] of Object.entries(entries)) {
        if(i.LANGUAGES.some(lang=>!entry[lang]?.length)) throw Error('Missing translation: '+key);
      }
      const a=dumplingClub;a.renderer.setAnimationLoop(null);a.draw=a.renderer.render.bind(a.renderer);a.renderer.render=()=>{};
      a.menuText=[];const c=a.menuBoard.ctx,drawText=c.fillText.bind(c);
      c.fillText=(text,x,y,...rest)=>{a.menuText.push({text,font:c.font,x,y});drawText(text,x,y,...rest);};
    });
    await page.getByRole('button',{name:'Bắt đầu'}).click();await advance(page);
    assert.equal(await page.evaluate(()=>dumplingClub.state.scene),'menu');
    for(const language of locales) {
      await locale(page,language);
      const report=await page.evaluate(async()=>{
        const a=dumplingClub,i=await import('/js/i18n.js');a.menuText=[];a.menuBoard.draw();a.draw(a.scene,a.camera);
        return{language:i.getLanguage(),items:a.menuBoard.items.map((item,index)=>({names:i.menuNames(item.id),rows:a.menuText.filter(r=>r.x===238&&r.y>=194+index*122&&r.y<194+(index+1)*122)})),hint:i.t('guideMenu')};
      });
      for(const item of report.items) {
        assert.equal(item.rows.length,3,'all three names stay on the physical menu at every size');
        assert.equal(item.names[0].lang,language);
        assert.deepEqual(item.rows.map(r=>r.text),item.names.map(n=>n.text));
        assert(item.rows[0].font.includes(`600 ${height<520&&width>height?52:40}px`));assert(item.rows.slice(1).every(r=>r.font.includes('26px')));
      }
      assert.equal(await page.locator('#scene-hint').innerText(),report.hint);
      const bounds=await page.locator('#language-switch button').evaluateAll(nodes=>nodes.map(n=>{const r=n.getBoundingClientRect();return {w:r.width,h:r.height,x:r.x,right:r.right};}));
      assert(bounds.every(r=>r.w>=44&&r.h>=44&&r.x>=0&&r.right<=width));
      await page.waitForTimeout(220);
      await page.screenshot({path:`/tmp/dumpling-qa/menu-${language}-${width}.png`});
    }
    await locale(page,'vi');
    await tap(page,'portion',3,touch);await tap(page,'row',6,touch);await advance(page,220);
    assert.equal(await page.evaluate(()=>dumplingClub.interaction.seated.length),3);
    const hover=await point(page,'food');await page.mouse.move(hover.x,hover.y);await advance(page,1);
    assert.equal(await page.evaluate(()=>dumplingClub.interaction.phase),'idle','hover does not skip chopstick pickup');
    const hoverLocalized=await page.evaluate(async()=>{
      const {CHARACTER_LINES}=await import('/js/characters.js');return [...document.querySelectorAll('.bubble')].some(n=>Object.values(CHARACTER_LINES).some(c=>c.hover.vi.includes(n.firstChild.textContent)));
    });
    assert(hoverLocalized,'Vietnamese hover reaction');
    await complete(page,'lift');await complete(page,'pick');
    const snapshot=()=>page.evaluate(()=>{const a=dumplingClub;return{held:a.interaction.held?.group.uuid,phase:a.interaction.phase,round:a.state.round,menu:a.state.menu,portion:a.state.portion,food:a.interaction.getDumplings().length,scene:a.state.scene};});
    const before=await snapshot();
    for(const language of locales) {
      await locale(page,language);assert.deepEqual(await snapshot(),before,'locale changes preserve held food and round');
      assert.equal(await page.locator('#scene-hint').innerText(),await page.evaluate(async()=> (await import('/js/i18n.js')).t('guideCarry')));
      const shown=await page.evaluate(async()=>{
        const a=dumplingClub,i=await import('/js/i18n.js');a.crowd.react('picked',a.interaction.held);a.step(1/60);a.draw(a.scene,a.camera);
        const {CHARACTER_LINES}=await import('/js/characters.js');return CHARACTER_LINES[a.interaction.held.personality.id].lifted[i.getLanguage()].includes(a.ui.bubbles.find(b=>b.owner===a.interaction.held)?.div.firstChild.textContent);
      });
      assert(shown,'pickup reaction uses current locale');
      await page.waitForTimeout(250);await advance(page,1);
      const hint=await page.locator('#scene-hint').boundingBox();
      assert(hint.x>=0&&hint.y>=0&&hint.x+hint.width<=width&&hint.y+hint.height<=height, 'hint stays inside the viewport: '+JSON.stringify(hint));
      const bubbles=await page.locator('.bubble:not([hidden])').evaluateAll(nodes=>nodes.map(n=>{const r=n.getBoundingClientRect();return {x:r.x,y:r.y,right:r.right,bottom:r.bottom};}));
      assert(bubbles.every(r=>r.x>=0&&r.y>=0&&r.right<=width&&r.bottom<=height),'bubbles stay inside viewport');
      if(bubbles.length===2){const[a,b]=bubbles;assert(a.right<=b.x||b.right<=a.x||a.bottom<=b.y||b.bottom<=a.y,'bubbles do not overlap');}
      await page.screenshot({path:`/tmp/dumpling-qa/pick-${language}-${width}.png`});
    }
    // An actual bite produces a localized taste reaction; capture it before it fades.
    await page.evaluate(()=>{dumplingClub.interaction.autopilot=true;dumplingClub.pendingBite=dumplingClub.interaction.bite();});
    const bite=await page.evaluate(async()=>{
      const a=dumplingClub,i=await import('/js/i18n.js');let text='';
      for(let f=0;f<600;f++){a.step(1/60);await Promise.resolve();const el=document.querySelector('#reaction');if(!el.hidden){text=el.textContent;break;}}
      const {DISH_TASTES}=await import('/js/characters.js');a.draw(a.scene,a.camera);return {text,valid:DISH_TASTES[a.interaction.held.type.id].zh.includes(text),hintHidden:document.querySelector('#scene-hint').hidden};
    });
    assert(bite.valid,'eating reaction is Chinese');assert(bite.hintHidden);
    await page.waitForTimeout(350);
    await page.screenshot({path:`/tmp/dumpling-qa/eat-zh-${width}.png`});
    await advance(page,400);
    for(let n=0;n<2;n++){await complete(page,'pick');await complete(page,'bite');}
    await page.evaluate(()=>{dumplingClub.interaction.autopilot=false;dumplingClub.step();});
    for(const language of locales) {
      await locale(page,language);
      assert(await page.locator('#another-round').isVisible());
      const label=await page.evaluate(async()=> (await import('/js/i18n.js')).t('anotherRound'));
      assert((await page.locator('#another-round').innerText()).startsWith(label));
    }
    await page.screenshot({path:`/tmp/dumpling-qa/round-zh-${width}.png`});
    if(width===1440){const a11y=await new AxeBuilder({page}).withTags(['wcag2a','wcag2aa','wcag21aa']).analyze();assert.deepEqual(a11y.violations.map(v=>({id:v.id,nodes:v.nodes.map(n=>n.target)})),[]);}
    if(touch)await page.locator('#another-round').tap();else await page.locator('#another-round').click();
    assert.equal(await page.evaluate(()=>dumplingClub.state.scene),'toMenu');await advance(page);
    assert.equal(await page.evaluate(()=>dumplingClub.state.scene),'menu');assert.equal(await page.locator('#another-round').isVisible(),false);
    assert.equal(await page.locator('.bubble').count(),0);
    await tap(page,'row',0,touch);await advance(page,220);
    assert.equal(await page.evaluate(()=>dumplingClub.interaction.seated.length),3,'new round orders correctly after a language switch');
    await page.reload();await page.waitForFunction(()=>dumplingClub.step);
    assert.equal(await page.evaluate(()=>dumplingClub.state.language),'zh','choice survives reload');
    assert(await page.getByRole('button',{name:'开始'}).isVisible());
    if(width===1440) {
      const storage=await page.evaluate(async()=>{
        localStorage.setItem('dumpling-club.language','invalid-locale');
        const invalid=await import('/js/i18n.js?invalid');
        const invalidFallback=invalid.getLanguage();
        Object.defineProperty(window,'localStorage',{get(){throw new Error('Storage disabled');},configurable:true});
        const blocked=await import('/js/i18n.js?blocked');
        const blockedFallback=blocked.getLanguage();blocked.setLanguage('en');
        return {invalidFallback,blockedFallback,changed:blocked.getLanguage()};
      });
      assert.deepEqual(storage,{invalidFallback:'vi',blockedFallback:'vi',changed:'en'});
    }
    assert.deepEqual(errors,[]);
    console.log(JSON.stringify({width,height,touch,reduced,passed:'three-language menu, default/persistence, live switch preserves food, voices, full round and menu return'}));
    await context.close();
  }
} finally { await browser.close(); }
