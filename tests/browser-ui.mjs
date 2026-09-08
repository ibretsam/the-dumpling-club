// Real pointer/touch hit tests against the physical menu and props, plus keyboard access.
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import AxeBuilder from '@axe-core/playwright';
import fs from 'node:fs/promises';
const browser = await chromium.launch({ headless: true, channel: 'chrome' });
const url = process.env.TEST_URL || 'http://127.0.0.1:8080';
const errors = [], results = [];
const touchWidth = Number(process.env.TEST_TOUCH_WIDTH || 0);
await fs.mkdir('/tmp/dumpling-qa', { recursive: true });
const track = page => page.on('pageerror', e => errors.push(e.message));
const state = (page, scene) => page.waitForFunction(s => dumplingClub.state.scene === s, scene);
async function ready(page) {
  track(page); await page.addInitScript(() => localStorage.setItem('dumpling-club.language','en'));
    await page.goto(url); await page.waitForFunction(() => dumplingClub.step);
  await page.waitForFunction(() => getComputedStyle(document.querySelector('#loader')).visibility === 'hidden');
}
async function point(page, target, value = 0) {
  return page.evaluate(async ({target,value}) => {
    const a=dumplingClub, T=await import('/lib/three.module.js'); let p;
    if(target==='row') p=a.menuBoard.rowPoint(value);
    else if(target==='portion') p=a.menuBoard.portionPoint(value);
    else if(target==='dumpling') {const d=a.interaction.seated[value];p=d.body.localToWorld(new T.Vector3(0,d.type.metrics.height*.5,0));}
    else if(target==='chopsticks') p=a.chopsticks.leftStick.localToWorld(new T.Vector3());
    else if(target==='rest') p=a.rest.group.localToWorld(new T.Vector3(0,.05,0));
    else if(target==='bowl') p=a.bowl.group.position.clone().add(new T.Vector3(0,.12,0));
    else if(target==='steamer') p=new T.Vector3(0,.2,.94); // exposed front bamboo rim
    else if(target==='menu') p=a.menuBoard.rowPoint(6);
    p.project(a.camera);
    return {x:(p.x+1)*innerWidth/2,y:(1-p.y)*innerHeight/2+(target==='chopsticks'?value:0)};
  }, {target,value});
}
async function click(page,target,value=0,touch=false) {
  const p=await point(page,target,value);
  const size=page.viewportSize(); assert(p.x>0 && p.x<size.width && p.y>0 && p.y<size.height, `${target} is on screen: ${JSON.stringify(p)}`);
  if(touch) await page.touchscreen.tap(p.x,p.y); else await page.mouse.click(p.x,p.y);
}
async function play(page) {await page.getByRole('button',{name:'Play'}).click();await state(page,'menu');await page.waitForTimeout(650);}
async function tableReady(page,count) {await state(page,'table');await page.waitForFunction(n=>dumplingClub.interaction.seated.length===n,count);await page.waitForTimeout(350);}
async function carrying(page) {await page.waitForFunction(()=>dumplingClub.interaction.phase==='carrying');}
async function settled(page) {await page.waitForFunction(()=>!dumplingClub.interaction.busy);}
async function noChrome(page, expected = []) {
  const visible = await page.evaluate(()=>[...document.querySelectorAll('button,dialog,#hint,#brand,#table-toolbar')].filter(e=>{
    const r=e.getBoundingClientRect(),s=getComputedStyle(e);
    return r.width>2 && r.height>2 && s.visibility!=='hidden' && s.display!=='none' && !e.closest('.sr-only,[inert],#language-switch');
  }).map(e=>e.textContent));
  assert.deepEqual(visible,expected,'only the expected scene controls are visible');
}
try {
  if (!touchWidth) {
  const context=await browser.newContext({viewport:{width:1440,height:1000}});
  const page=await context.newPage();await ready(page);
  await page.screenshot({path:'/tmp/dumpling-qa/title.png'});
  await play(page);await noChrome(page);
  assert.equal(await page.evaluate(()=>dumplingClub.audio.enabled && dumplingClub.audio.context.state==='running'),true,'sound unlocked by Play');
  assert.equal(await page.locator('dialog').count(),0);
  const hover=await point(page,'row',4);await page.mouse.move(hover.x,hover.y);await page.waitForTimeout(500);
  assert.equal(await page.evaluate(()=>dumplingClub.menuBoard.hover),4);
  assert(await page.evaluate(()=>dumplingClub.menuBoard.minis[4].position.z>.07),'food sample lifts on hover');
  await click(page,'portion',8);
  assert.equal(await page.evaluate(()=>dumplingClub.menuBoard.portion),8);
  await page.screenshot({path:'/tmp/dumpling-qa/menu.png'});
  await click(page,'row',6);await tableReady(page,8);
  assert.equal(await page.evaluate(()=>dumplingClub.state.menu),'assorted');
  await noChrome(page);await page.mouse.move(1400,900);await page.waitForTimeout(450);
  await page.screenshot({path:'/tmp/dumpling-qa/table.png'});
  await click(page,'dumpling',0);
  assert.equal(await page.evaluate(()=>dumplingClub.interaction.phase),'idle','food selection waits for chopstick pickup');
  await click(page,'chopsticks'); await settled(page);
  assert.equal(await page.evaluate(()=>dumplingClub.interaction.phase),'holding');
  await click(page,'rest'); await settled(page);
  assert.equal(await page.evaluate(()=>dumplingClub.interaction.phase),'idle','empty chopsticks return to their holder');
  await click(page,'chopsticks'); await settled(page);
  await click(page,'dumpling',0);await carrying(page);
  await click(page,'bowl');await page.waitForFunction(()=>dumplingClub.interaction.phase==='dipping');await carrying(page);
  assert.equal(await page.evaluate(()=>dumplingClub.interaction.dipped),true);
  await page.screenshot({path:'/tmp/dumpling-qa/dip.png'});
  const held=await page.evaluate(()=>dumplingClub.interaction.held.personality.name);
  await click(page,'steamer');await settled(page);
  assert.equal(await page.evaluate(()=>dumplingClub.interaction.held),null);
  assert.equal(await page.evaluate(()=>dumplingClub.interaction.seated.length),8);
  assert(await page.evaluate(name=>dumplingClub.interaction.seated.find(d=>d.personality.name===name).dipLevel>0,held),'return retains sauce');
  await click(page,'dumpling',1);await carrying(page);
  await click(page,'rest');await settled(page);
  assert.equal(await page.evaluate(()=>dumplingClub.interaction.phase),'idle','holder returns both the dumpling and chopsticks');
  assert.equal(await page.evaluate(()=>dumplingClub.interaction.seated.length),8,'holder never eats the held dumpling');
  assert.equal(await page.evaluate(()=>dumplingClub.chop.isResting),true);
  await click(page,'chopsticks');await settled(page);
  await click(page,'dumpling',1);await carrying(page);await page.mouse.click(80,900);
  await page.waitForFunction(()=>dumplingClub.interaction.phase==='biting');await settled(page);
  assert.equal(await page.evaluate(()=>dumplingClub.interaction.seated.length),7);
  await click(page,'menu');await state(page,'menu');await page.waitForTimeout(500);
  await page.keyboard.press('ArrowDown');await page.keyboard.press('3');await page.keyboard.press('Enter');await tableReady(page,3);
  // Keyboard interaction remains available without a visible toolbar.
  await page.keyboard.press('Enter');await page.waitForFunction(()=>dumplingClub.interaction.phase==='holding');
  await page.keyboard.press('ArrowRight');await page.keyboard.press('Enter');await carrying(page);
  await page.keyboard.press('d');await carrying(page);await page.keyboard.press('Escape');await settled(page);
  await page.keyboard.press('m');assert.equal(await page.evaluate(()=>dumplingClub.audio.enabled),false);
  await page.keyboard.press('m');assert.equal(await page.evaluate(()=>dumplingClub.audio.enabled),true);
  // Empty the basket through the complete animation, then refill by tapping its actual mesh.
  for(let i=0;i<3;i++) {await click(page,'dumpling');await carrying(page);await page.mouse.click(80,900);await settled(page);}
  assert.equal(await page.evaluate(()=>dumplingClub.interaction.seated.length),0);
  await page.waitForTimeout(1200);await noChrome(page,['Another round ↗']);await click(page,'steamer');await tableReady(page,3);
  const a11y=await new AxeBuilder({page}).withTags(['wcag2a','wcag2aa','wcag21aa']).analyze();
  assert.deepEqual(a11y.violations.map(v=>v.id),[]);
  results.push('Desktop: physical menu hover/portion/order, chopstick pickup/rest, pick/dip/return/eat, reopen, keyboard, empty steamer refill, sound, axe');
  await page.close();
  }
  for(const [width,height] of [[390,844],[320,568],[844,390]]) {
    if(touchWidth && width !== touchWidth) continue;
    const p=await browser.newPage({viewport:{width,height},hasTouch:true,isMobile:true,deviceScaleFactor:1});await ready(p);await play(p);
    // Every row and every portion is inside the viewport at phone sizes.
    for(let i=0;i<7;i++){const hit=await point(p,'row',i);assert(hit.y>0&&hit.y<height&&hit.x>0&&hit.x<width);}
    await click(p,'portion',3,true);await click(p,'row',4,true);await tableReady(p,3);
    if(width===390) await p.screenshot({path:'/tmp/dumpling-qa/mobile-390.png'});
    await click(p,'dumpling',0,true);
    assert.equal(await p.evaluate(()=>dumplingClub.interaction.phase),'idle');
    // Tap just outside the thin mesh: screen-space padding keeps this usable on phones.
    await click(p,'chopsticks',12,true);await settled(p);
    assert.equal(await p.evaluate(()=>dumplingClub.interaction.phase),'holding');
    await click(p,'rest',0,true);await settled(p);
    assert.equal(await p.evaluate(()=>dumplingClub.interaction.phase),'idle');
    await click(p,'chopsticks',0,true);await settled(p);
    await click(p,'dumpling',0,true);await carrying(p);await click(p,'bowl',0,true);await carrying(p);
    assert.equal(await p.evaluate(()=>dumplingClub.interaction.dipped),true);
    await click(p,'rest',0,true);await settled(p);
    assert.equal(await p.evaluate(()=>dumplingClub.interaction.phase),'idle');
    assert.equal(await p.evaluate(()=>dumplingClub.interaction.seated.length),3);
    await click(p,'chopsticks',0,true);await settled(p);
    await click(p,'dumpling',0,true);await carrying(p);
    await click(p,'steamer',0,true);await settled(p);assert.equal(await p.evaluate(()=>dumplingClub.interaction.held),null);
    await click(p,'dumpling',1,true);await carrying(p);await p.touchscreen.tap(width*.85,height*.93);await settled(p);
    assert.equal(await p.evaluate(()=>dumplingClub.interaction.seated.length),2);
    await click(p,'menu',0,true);await state(p,'menu');await p.waitForTimeout(500);
    if(width===390) await p.screenshot({path:'/tmp/dumpling-qa/mobile-menu.png'});
    await noChrome(p);
    results.push(`Touch ${width}×${height}: physical menu and complete chopstick pickup/rest and pick/dip/put-back/eat loop`);await p.close();
  }
  if (!touchWidth) {
  const reduced=await browser.newPage({viewport:{width:390,height:844},reducedMotion:'reduce'});await ready(reduced);await play(reduced);
  const hp=await point(reduced,'row',1);await reduced.mouse.move(hp.x,hp.y);await reduced.waitForTimeout(350);
  assert.equal(await reduced.evaluate(()=>dumplingClub.menuBoard.minis[1].position.z),.024);
  await reduced.keyboard.press('Enter');await tableReady(reduced,5);
  assert.equal(await reduced.evaluate(()=>dumplingClub.state.reducedMotionPref),true);
  results.push('Reduced motion: static food samples, playable menu and table');
  await reduced.close();
  }
  assert.deepEqual(errors,[]);
  console.log(JSON.stringify({passed:results,errors},null,2));
} catch(error) { for(const context of browser.contexts()) for(const page of context.pages()) { await page.screenshot({path:'/tmp/dumpling-qa/failure.png'}); console.log(await page.evaluate(()=>({state:dumplingClub.state,phase:dumplingClub.interaction.phase,error:dumplingClub.frameError?.message}))); } throw error; } finally {await browser.close();}
