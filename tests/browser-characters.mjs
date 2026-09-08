// Inspect the exported bodies and render the real animated characters for visual review.
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { mkdir } from 'node:fs/promises';
await mkdir('/tmp/dumpling-qa', {recursive:true});
const browser=await chromium.launch({headless:true,channel:'chrome'});
try {
  const page=await browser.newPage({viewport:{width:1200,height:800},reducedMotion:'reduce'});
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto(process.env.TEST_URL||'http://127.0.0.1:8080');await page.waitForFunction(()=>dumplingClub.step);
  // Dishes stream in one file each; the portraits need every one of them.
  await page.waitForFunction(()=>dumplingClub.geometries.loaded);
  const report=await page.evaluate(async()=>{
    const a=dumplingClub,T=await import('/lib/three.module.js');
    const {DUMPLING_TYPES}=await import('/js/dumpling-geometry.js');
    const {Dumpling}=await import('/js/dumpling.js');
    const {PERSONALITIES}=await import('/js/config.js');
    const {CHARACTERS,CHARACTER_LINES,TYPE_CHARACTERS,DISH_TASTES}=await import('/js/characters.js');
    const {dishName}=await import('/js/i18n.js');
    a.renderer.setAnimationLoop(null);
    const sizes={};
    for(const type of DUMPLING_TYPES){const g=a.geometries.get(type.id).body;g.computeBoundingBox();const s=g.boundingBox.getSize(new T.Vector3());sizes[type.id]={x:s.x,y:s.y,z:s.z};}
    for(const person of PERSONALITIES){
      if(!CHARACTERS[person.id])throw Error('Missing temperament '+person.id);
      for(const entry of Object.values(CHARACTER_LINES[person.id]))for(const lang of ['vi','en','zh'])if(!entry[lang]?.length)throw Error('Missing voice '+person.id+' '+lang);
    }
    for(const entry of Object.values(DISH_TASTES))for(const lang of ['vi','en','zh'])if(!entry[lang]?.length)throw Error('Missing taste '+lang);
    const actors=PERSONALITIES.map((person,index)=>{const g=a.geometries.get('xiaolongbao');return new Dumpling({personality:person,type:'xiaolongbao',bodyGeometry:g.body,bittenGeometry:g.bitten,index});});
    const reactions={};
    for(const event of ['hover','picking','held','dipped','watch']){actors.forEach(d=>d.reactTo(event));reactions[event]=new Set(actors.map(d=>d.expression)).size;}
    actors.forEach(d=>d.dispose());
    const style=document.createElement('style');style.textContent='body>main>*:not(#scene){display:none!important}body:after{display:none}.portrait-label{position:fixed;transform:translateX(-50%);text-align:center;pointer-events:none;color:#654932;font:400 13px "Be Vietnam Pro",sans-serif}.portrait-label strong{display:block;font-size:20px;margin-bottom:5px}.gallery-heading{position:fixed;top:24px;left:35px;font:600 28px Fraunces,serif;color:#913f29}';document.head.append(style);
    const stage=new T.Scene();stage.background=new T.Color('#f5ebdd');stage.environment=a.scene.environment;
    stage.add(new T.HemisphereLight('#fff3df','#b9916c',2));
    const key=new T.DirectionalLight('#fff2dc',2.4);key.position.set(-3,5,4);stage.add(key);
    const ground=new T.Mesh(new T.PlaneGeometry(20,20),new T.MeshStandardMaterial({color:'#f5ebdd',roughness:1}));ground.rotation.x=-Math.PI/2;ground.position.y=-.006;stage.add(ground);
    const camera=new T.OrthographicCamera(-.6,.6,.64,-.35,.1,10);camera.position.set(.05,.82,2);camera.lookAt(0,.22,0);
    const r=a.renderer;r.setSize(1200,800);r.setScissorTest(true);
    const title=document.createElement('div');title.className='gallery-heading';document.body.append(title);
    a.portraits=[];
    a.renderPortraits=(mode,event='idle')=>{
      a.portraits.forEach(d=>d.dispose());a.portraits=[];document.querySelectorAll('.portrait-label').forEach(n=>n.remove());
      const entries=mode==='dishes'?DUMPLING_TYPES.map(type=>({type,person:PERSONALITIES.find(p=>p.id===TYPE_CHARACTERS[type.id])})):PERSONALITIES.map(person=>({person,type:DUMPLING_TYPES[0]}));
      const columns=mode==='dishes'?3:4,cellW=1200/columns,cellH=350;
      title.textContent=mode==='dishes'?'Sáu món, sáu dáng vẻ':'Tám người bạn trong một xửng';
      r.setScissor(0,0,1200,800);r.setViewport(0,0,1200,800);r.clear();
      entries.forEach(({type,person},i)=>{
        const geo=a.geometries.get(type.id);const d=new Dumpling({personality:person,type,bodyGeometry:geo.body,bittenGeometry:geo.bitten,index:i});
        d.reactTo(event);d.painter.paint({expression:d.expression,blink:0,lookX:.15,lookY:.1});d.body.rotation.y=type.id==='potsticker'?-.1:0;
        stage.add(d.group);a.portraits.push(d);
        const x=(i%columns)*cellW,y=800-90-(Math.floor(i/columns)+1)*cellH;
        r.setViewport(x,y+45,cellW,cellH-45);r.setScissor(x,y,cellW,cellH);r.render(stage,camera);stage.remove(d.group);
        const label=document.createElement('div');label.className='portrait-label';label.style.left=x+cellW/2+'px';label.style.top=800-y-52+'px';
        const name=document.createElement('strong');name.textContent=mode==='dishes'?dishName(type.id):person.name;label.append(name,mode==='dishes'?person.name:({mochi:'Vui vẻ',pip:'Tò mò',dumpy:'Mê ngủ',bao:'Lém lỉnh',pudding:'Nhút nhát',nori:'Khó tính',suki:'Hào hứng',momo:'Tinh nghịch'}[person.id]));document.body.append(label);
      });
    };
    a.renderPortraits('dishes');
    return{source:a.geometries.source,sizes,reactions};
  });
  assert.equal(report.source,'glb');
  assert(report.sizes.potsticker.x/report.sizes.hargow.x>1.4,'potsticker and har gow have visibly different lengths');
  assert(report.sizes.potsticker.y/report.sizes.hargow.y<.8,'potsticker stays low while har gow is a plump shell');
  assert(report.sizes.jiaozi.x/report.sizes.jiaozi.z>1.8,'jiaozi has a broad, slim crescent silhouette');
  for(const [event,count] of Object.entries(report.reactions))assert(count>=5,`${event} keeps at least five distinct temperaments`);
  await page.screenshot({path:'/tmp/dumpling-qa/characters-dishes.png'});
  await page.evaluate(()=>dumplingClub.renderPortraits('personalities'));
  await page.screenshot({path:'/tmp/dumpling-qa/characters-personalities.png'});
  await page.evaluate(()=>dumplingClub.renderPortraits('personalities','dipped'));
  await page.screenshot({path:'/tmp/dumpling-qa/characters-dipped.png'});
  assert.deepEqual(errors,[]);console.log(JSON.stringify({passed:'distinct exported silhouettes, eight temperaments, complete trilingual voices and actual character portraits',...report}));
  await page.close();
} finally {await browser.close();}
