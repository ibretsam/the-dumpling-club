// Full animation regression against the loaded GLB meshes in a real WebGL browser.
// Start npm start first. npm install, then npm run test:browser.
import { chromium } from 'playwright';
const browser=await chromium.launch({headless:true,channel:'chrome'});
const page=await browser.newPage({viewport:{width:1200,height:900}});
const errors=[];
page.on('pageerror',e=>errors.push(e.message));
await page.addInitScript(() => localStorage.setItem('dumpling-club.language','en'));
    await page.goto(process.env.TEST_URL || 'http://127.0.0.1:8080'); await page.waitForFunction(()=>window.dumplingClub?.step);
await page.getByRole('button',{name:'Play'}).click();
await page.waitForFunction(()=>dumplingClub.state.scene==='menu');
await page.keyboard.press('Enter');
await page.waitForFunction(()=>dumplingClub.state.scene==='table' && dumplingClub.interaction.seated.length===5);
const result=await page.evaluate(async()=>{
 const T=await import('/lib/three.module.js');
 const {DUMPLING_TYPES}=await import('/js/dumpling-geometry.js');

 const app=dumplingClub,it=app.interaction;
 app.renderer.setAnimationLoop(null); const render=app.renderer.render;app.renderer.render=()=>{};
 const tick=async(n=1)=>{for(let i=0;i<n;i++){app.step(1/60); await Promise.resolve();}};
 const run=async(p)=>{let done=false,ok;p.then(v=>{done=true;ok=v});for(let i=0;i<800&&!done;i++)await tick();if(!done||!ok)throw Error('sequence failed '+it.phase);};
 let results=[],failures=[];
 const v=new T.Vector3(),q=new T.Vector3();
 for(const type of DUMPLING_TYPES){
  for(const portion of [3,8]){
   app.ui.h.onOrder(type.id,portion); await tick(90);
   it.autopilot=true;it.pointer.has=false;
   await run(it.liftChopsticks()); await run(it.pick(it.seated[0]));
   let maxPenetration=0,minY=Infinity,maxDrift=0;
   let deepest=Infinity,deepMatrix=new T.Matrix4();
   const dip=it.dip();let done=false;dip.then(()=>done=true);
   for(let i=0;i<450&&!done;i++){
    await tick(); const d=it.held; d.mesh.updateWorldMatrix(true,false);
    const pos=d.mesh.geometry.attributes.position;
    if(d.group.getWorldPosition(v).y<deepest){deepest=v.y;deepMatrix.copy(d.mesh.matrixWorld);}
    for(let j=0;j<pos.count;j+=8){
     v.fromBufferAttribute(pos,j).applyMatrix4(d.mesh.matrixWorld);
     const r=Math.hypot(v.x-app.bowl.group.position.x,v.z-app.bowl.group.position.z);
     if(r<.15) {minY=Math.min(minY,v.y);maxPenetration=Math.max(maxPenetration,.06-v.y);}
    }
    q.set(0,type.metrics.gripHeight,0);d.group.localToWorld(q);
    maxDrift=Math.max(maxDrift,q.distanceTo(app.chop.gripWorldPosition(v)));
   }
   if(!done) throw Error('dip timed out');
   // Check the low pose against the actual porcelain mesh, independently of contact.js.
   const floorRay = new T.Raycaster();
   const bowlMesh = app.bowl.group.getObjectByName('Bowl');
   const bodyPositions = it.held.mesh.geometry.attributes.position;
   for (let j=0; j<bodyPositions.count; j+=19) {
     v.fromBufferAttribute(bodyPositions,j).applyMatrix4(deepMatrix);
     if(v.y>.25) continue;
     floorRay.set(new T.Vector3(v.x,1,v.z),new T.Vector3(0,-1,0));
     const hit=floorRay.intersectObject(bowlMesh,false)[0];
     if(hit && hit.point.y > v.y+.002) { failures.push(type.id+' intersects porcelain'); break; }
   }
   // Independently raycast the real dumpling mesh along shaft cross-sections. A shaft centre
   // between the first and last surface crossing would be visibly inside the food.
   const ray=new T.Raycaster(),origin=new T.Vector3(),direction=new T.Vector3(1,0,0).applyQuaternion(app.chop.group.quaternion);
   dcheck: for(const pivot of [app.chopsticks.left,app.chopsticks.right]){
    pivot.updateWorldMatrix(true,true);
    const sign=pivot===app.chopsticks.left?-1:1;
    for(let j=0;j<=70;j++){
     v.set(sign*.025,-2.2+j*.009,0);pivot.localToWorld(v);
     origin.copy(v).addScaledVector(direction,-1);ray.set(origin,direction);
     // Double-sided ray cast is needed for both entry and exit surfaces.
     const side=it.held.mesh.material.side;it.held.mesh.material.side=T.DoubleSide;
     const both=ray.intersectObject(it.held.mesh,false);it.held.mesh.material.side=side;
     if(both.length>=2&&both[0].distance<.997&&both.at(-1).distance>1.003){failures.push(type.id+' shaft penetration');break dcheck;}
    }
   }
   if(it.held.dipLevel<=0)failures.push(type.id+' made no sauce contact');
   if(maxPenetration>.001||maxDrift>.001)failures.push(type.id+' clearance/drift '+maxPenetration+'/'+maxDrift);
   results.push({type:type.id,portion,dip:+it.held.dipLevel.toFixed(3),drift:+maxDrift.toFixed(6),floorPenetration:maxPenetration});
   await run(it.putBack());
   if(it.seated.length!==portion)failures.push('putback count');
   const returned=it.seated[0];
   if(Math.abs(returned.group.rotation.x)>.001||Math.abs(returned.group.rotation.z)>.001)failures.push('returned tilted');
   await run(it.pick(it.seated[0])); await run(it.bite());
   if(it.seated.length!==portion-1)failures.push('bite count');
  }
 }
 app.renderer.render=render;
 return {results,failures,error:String(app.frameError||'')};
});
console.log(JSON.stringify(result,null,2));
await page.close();await browser.close();process.exit(result.failures.length||result.error||errors.length?1:0);
