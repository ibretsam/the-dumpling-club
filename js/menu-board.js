import * as THREE from 'three';
import { motion } from './motion.js';
import { getType } from './dumpling-geometry.js';
import { damp } from './tween.js';
import { menuNames, menuHeading, t } from './i18n.js';

// The menu is a texture on the actual wooden board. Selection uses the paper's UVs,
// so camera movement, portrait screens and touch all hit exactly what is drawn.
const W = 880, H = 1240, TOP = 194, ROW = 122;
const font = (lang, size, weight = 400, heading = false) => `${weight} ${size}px ${lang === 'zh' ? '"PingFang SC", "Microsoft YaHei", "Noto Sans CJK SC", sans-serif' : heading ? 'Fraunces, Georgia, serif' : '"Be Vietnam Pro", sans-serif'}`;
export class MenuBoard {
  constructor(board, items, geometries, audio) {
    Object.assign(this, { board, items, audio });
    this.canvas = document.createElement('canvas');
    this.canvas.width = W; this.canvas.height = H;
    this.ctx = this.canvas.getContext('2d');
    this.texture = new THREE.CanvasTexture(this.canvas);
    this.texture.colorSpace = THREE.SRGBColorSpace;
    this.texture.anisotropy = 4;
    board.paper.material.map = this.texture;
    board.paper.material.color.set(0xffffff);
    board.paper.material.needsUpdate = true;
    this.ray = new THREE.Raycaster();
    this.hover = -1; this.selected = -1; this.portion = 5;
    this.active = false; this.committing = false;
    this.minis = [];
    items.forEach((item, i) => {
      const types = item.id === 'assorted' ? [items[0].id, items[4].id, items[3].id] : [item.id];
      // The same food geometry as the basket, mounted like little ceramic menu samples.
      const group = new THREE.Group();
      group.position.set(-board.width * .34, this.localY(TOP + i * ROW + 88), .024);
      types.forEach((id, j) => {
        const geo = geometries.get(id).body;
        geo.computeBoundingBox();
        const size = geo.boundingBox.getSize(new THREE.Vector3());
        const mesh = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ color: getType(id).skin.color, vertexColors: !!geo.attributes.color, roughness: .65 }));
        mesh.scale.setScalar((types.length > 1 ? .086 : .17) / Math.max(size.x, size.y));
        mesh.position.x = (j - (types.length - 1) / 2) * .064;
        mesh.rotation.x = .18;
        group.add(mesh);
      });
      board.paper.add(group);
      this.minis.push(group);
    });
    this.draw();
  }
  localY(y) { return (.5 - y / H) * this.board.height; }
  rowPoint(i) { return this.board.paper.localToWorld(new THREE.Vector3(.05, this.localY(TOP + i * ROW + ROW / 2), .003)); }
  portionPoint(n) { return this.board.paper.localToWorld(new THREE.Vector3((([3,5,8].indexOf(n) * 148 + 340) / W - .5) * this.board.width, this.localY(1138), .003)); }
  hit(ndc, camera) {
    this.board.paper.updateWorldMatrix(true, false);
    this.ray.setFromCamera(ndc, camera);
    const hit = this.ray.intersectObject(this.board.paper, false)[0];
    if (!hit) return null;
    const x = hit.uv.x * W, y = (1 - hit.uv.y) * H;
    if (x > 40 && x < 840 && y >= TOP && y < TOP + ROW * this.items.length) return { kind: 'dish', index: Math.floor((y - TOP) / ROW) };
    if (y > 1090 && y < 1185) {
      const i = Math.round((x - 340) / 148);
      if (i >= 0 && i < 3 && Math.abs(x - (340 + 148 * i)) < 64) return { kind: 'portion', value: [3,5,8][i] };
    }
    return { kind: 'paper' };
  }
  setHover(index) {
    if (this.hover === index || this.committing) return;
    this.hover = index;
    if (index >= 0) this.audio.play('ui', { volume: .16, pitch: 1 + index * .035 });
    this.draw();
  }
  setPortion(n) { this.portion = n; this.draw(); }
  select(id) { this.selected = this.items.findIndex(item => item.id === id); this.draw(); }
  draw() {
    const c = this.ctx;
    const headlineSize = innerHeight < 520 && innerWidth > innerHeight ? 52 : 40;
    c.fillStyle = '#fff4de'; c.fillRect(0,0,W,H);
    c.strokeStyle = '#cba579'; c.lineWidth = 2; c.strokeRect(25,25,W-50,H-50);
    c.strokeStyle = '#ae492b'; c.lineWidth = 4; c.strokeRect(37,37,W-74,H-74);
    c.textAlign = 'center'; c.fillStyle = '#99422c';
    const [heading, ...subheads] = menuHeading();
    c.font = font(heading.lang, 54, 600, true); c.fillText(heading.text, W/2, 116);
    c.font = '26px "Be Vietnam Pro", "PingFang SC", "Microsoft YaHei", sans-serif';
    c.fillText(subheads.map(h => h.text).join('  ·  '), W/2, 158);
    this.items.forEach((item, i) => {
      const y = TOP + i * ROW, on = this.active && i === this.hover;
      if (on) { c.fillStyle = '#eddbc0'; c.fillRect(48,y,W-96,ROW-3); }
      c.textAlign = 'left'; c.fillStyle = on ? '#8a351f' : '#49382c';
      const [headline, ...subtitles] = menuNames(item.id);
      c.font = font(headline.lang, headlineSize, 600); c.fillText(headline.text, 238, y+43, 530);
      c.fillStyle = '#886044';
      subtitles.forEach((name, j) => {
        c.font = font(name.lang, 26); c.fillText(name.text, 238, y+76+j*29, 530);
      });
      c.strokeStyle = '#d8bda0'; c.lineWidth = 1; c.beginPath(); c.moveTo(238,y+ROW-1); c.lineTo(800,y+ROW-1); c.stroke();
      if (this.committing && this.selected === i) {
        c.save(); c.translate(770,y+58); c.rotate(-.18); c.strokeStyle = '#a74329'; c.lineWidth=4;
        c.beginPath(); c.arc(0,0,32,0,Math.PI*2); c.stroke();
        c.textAlign='center'; c.fillStyle='#a74329'; c.font='600 33px "Be Vietnam Pro"'; c.fillText('✓',0,12); c.restore();
      }
    });
    c.textAlign='left'; c.fillStyle='#8b6548'; c.font='24px "Be Vietnam Pro", "PingFang SC", "Microsoft YaHei", sans-serif'; c.fillText(t('pieces'),85,1147,185);
    [3,5,8].forEach((n,i)=>{
      const x=340+i*148;
      c.fillStyle=n===this.portion?'#9c442c':'#eddbc0'; c.beginPath(); c.arc(x,1138,42,0,Math.PI*2); c.fill();
      c.fillStyle=n===this.portion?'#fff8e9':'#5c4432'; c.textAlign='center'; c.font='600 35px "Be Vietnam Pro"'; c.fillText(String(n),x,1150);
    });
    this.texture.needsUpdate = true;
  }
  update(dt,time) {
    this.minis.forEach((group,i)=>{
      const on = this.active && this.hover === i;
      group.position.z = damp(group.position.z, on && !motion.reduced ? .095 : .024, 9, dt);
      group.rotation.y = damp(group.rotation.y, on && !motion.reduced ? Math.sin(time*2.4)*.22 : 0, 8, dt);
      const scale = damp(group.scale.x, on ? 1.13 : 1, 9, dt);
      group.scale.setScalar(scale);
    });
  }
}
