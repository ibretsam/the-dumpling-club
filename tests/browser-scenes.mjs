// Camera transitions must carry responsive framing throughout the flight, without an arrival pop.
import assert from 'node:assert/strict';
import {chromium} from 'playwright';
import {mkdir} from 'node:fs/promises';
await mkdir('/tmp/dumpling-qa',{recursive:true});
const browser=await chromium.launch({headless:true,channel:'chrome'});
try {
  for(const [width,height] of [[1440,1000],[390,844],[320,568],[844,390]]) {
    const page=await browser.newPage({viewport:{width,height}});
    const errors=[]; page.on('pageerror',e=>errors.push(e.message));
    await page.addInitScript(() => localStorage.setItem('dumpling-club.language','en'));
    await page.goto(process.env.TEST_URL || 'http://127.0.0.1:8080');await page.waitForFunction(()=>dumplingClub.step);
    await page.waitForFunction(()=>getComputedStyle(document.querySelector('#loader')).visibility==='hidden');
    if(width===1440) await page.screenshot({path:'/tmp/dumpling-qa/title.png'});
    await page.evaluate(()=>{
      const a=dumplingClub;a.renderer.setAnimationLoop(null);
      a.renderOnce=a.renderer.render.bind(a.renderer);a.renderer.render=()=>{};
      a.samples=[];const step=a.step;
      a.step=(...args)=>{step(...args);a.samples.push({fov:a.camera.fov,scene:a.state.scene,x:a.camera.position.x,y:a.camera.position.y,z:a.camera.position.z});};
    });
    await page.getByRole('button',{name:'Play'}).click();
    await page.evaluate(async()=>{await dumplingClub.run(150);dumplingClub.renderOnce(dumplingClub.scene,dumplingClub.camera);});
    assert.equal(await page.evaluate(()=>dumplingClub.state.scene),'menu');
    if(width===390) await page.screenshot({path:'/tmp/dumpling-qa/mobile-menu.png'});
    if(width===844) await page.screenshot({path:'/tmp/dumpling-qa/landscape-menu.png'});
    if(width===1440) await page.screenshot({path:'/tmp/dumpling-qa/menu.png'});
    const point=await page.evaluate(()=>{const a=dumplingClub,p=a.menuBoard.rowPoint(6).project(a.camera);return{x:(p.x+1)*innerWidth/2,y:(1-p.y)*innerHeight/2};});
    await page.mouse.click(point.x,point.y);
    const report=await page.evaluate(async()=>{
      const a=dumplingClub;await a.run(220);a.renderOnce(a.scene,a.camera);
      let maxFov=0, arrivalMove=0;
      for(let i=1;i<a.samples.length;i++){
        const p=a.samples[i-1],q=a.samples[i];maxFov=Math.max(maxFov,Math.abs(q.fov-p.fov));
        if(q.scene!==p.scene) arrivalMove=Math.max(arrivalMove,Math.hypot(q.x-p.x,q.y-p.y,q.z-p.z));
      }
      const count=a.interaction.seated.length;
      return{maxFov,arrivalMove,count,scene:a.state.scene,frameError:a.frameError?.message};
    });
    assert.equal(report.scene,'table');assert.equal(report.count,5);assert(!report.frameError);
    assert(report.maxFov<1.2,`FOV jump: ${JSON.stringify(report)}`);
    assert(report.arrivalMove<.06,`arrival jump: ${JSON.stringify(report)}`);
    if(width===390) await page.screenshot({path:'/tmp/dumpling-qa/mobile-390.png'});
    if(width===1440) await page.screenshot({path:'/tmp/dumpling-qa/table.png'});
    assert.deepEqual(errors,[]);console.log(JSON.stringify({width,height,...report}));await page.close();
  }
}finally{await browser.close();}
