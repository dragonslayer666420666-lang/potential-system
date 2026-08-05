// WireWise 3D — Three.js version (updated)
// Adds switch open/closed behavior, bloom post-processing, responsive canvas, and quality toggle.

/* global THREE */

const levelName = document.getElementById('levelName');
const resetBtn = document.getElementById('resetBtn');
const hintBtn = document.getElementById('hintBtn');
const nextBtn = document.getElementById('nextBtn');
const message = document.getElementById('message');
const controlsBar = document.getElementById('controls');

let currentLevel = 0;
let components = []; // {id,type,mesh,terminals: [terminalId,...], switchClosed}
let wires = []; // {from,to,mesh,mat}
let terminalMap = {}; // id -> {compId,name,pos:THREE.Vector3,mesh,type}
let pending = null; // {terminalId, pos}

// Three.js scaffolding
let scene, camera, renderer, controls, raycaster, composer, bloomPass, renderPass;
let pointer = new THREE.Vector2();
let tempLine = null; // THREE.Line for preview
const planeZ = new THREE.Plane(new THREE.Vector3(0,0,1), 0);
let bloomEnabled = true;

const levels = [
  {
    name: "Simple LED (series): Battery → Resistor → LED → Battery",
    components: [
      { id: 'bat', type: 'battery', x: 120, y: 200, label: 'Battery' },
      { id: 'res', type: 'resistor', x: 410, y: 220, label: 'Resistor' },
      { id: 'led', type: 'led', x: 700, y: 220, label: 'LED' },
    ],
    terminals: [
      ['bat+','bat','+', 90,20,'pos'],
      ['bat-','bat','-', 90,70,'neg'],
      ['res-a','res','a', 40,20,'both'],
      ['res-b','res','b', 130,20,'both'],
      ['led-an','led','anode', 40,25,'anode'],
      ['led-ca','led','cathode', 130,25,'cathode'],
    ],
    requiredPairs: [ ['bat+','res-a'], ['res-b','led-an'], ['led-ca','bat-'] ],
    hint: "Connect battery + to one end of the resistor, the other resistor end to the LED anode, and LED cathode back to battery -."
  },
  {
    name: "LED with Switch",
    components: [
      { id: 'bat', type: 'battery', x: 120, y: 200, label: 'Battery' },
      { id: 'switch', type: 'switch', x: 430, y: 200, label: 'Switch' },
      { id: 'led', type: 'led', x: 700, y: 220, label: 'LED' },
    ],
    terminals: [
      ['bat+','bat','+', 90,20,'pos'],
      ['bat-','bat','-', 90,70,'neg'],
      ['sw-a','switch','a', 40,25,'both'],
      ['sw-b','switch','b', 130,25,'both'],
      ['led-an','led','anode', 40,25,'anode'],
      ['led-ca','led','cathode', 130,25,'cathode'],
    ],
    requiredPairs: [ ['bat+','sw-a'], ['sw-b','led-an'], ['led-ca','bat-'] ],
    hint: "Place the switch between battery + and the LED anode. The cathode returns to battery -."
  }
];

function mapTo3D(x2d, y2d){
  const sx = (x2d - 500) / 120; // adjust scale for scene
  const sy = (300 - y2d) / 120;
  return new THREE.Vector3(sx, sy, 0);
}

function initThree(){
  const wrap = document.getElementById('workspaceWrap');
  renderer = new THREE.WebGLRenderer({antialias:true});
  renderer.setSize(Math.min(1000, wrap.clientWidth), 600);
  renderer.setPixelRatio(window.devicePixelRatio || 1);
  wrap.innerHTML = '';
  renderer.domElement.id = 'threeCanvas';
  renderer.domElement.style.width = '100%';
  renderer.domElement.style.height = '600px';
  wrap.appendChild(renderer.domElement);

  scene = new THREE.Scene();
  scene.background = new THREE.Color(0x071c22);

  camera = new THREE.PerspectiveCamera(50, renderer.domElement.clientWidth / renderer.domElement.clientHeight, 0.1, 100);
  camera.position.set(0,0,6);

  const hemi = new THREE.HemisphereLight(0xffffff, 0x444444, 0.6);
  scene.add(hemi);
  const dir = new THREE.DirectionalLight(0xffffff, 0.6);
  dir.position.set(5,10,7);
  scene.add(dir);
  scene.add(new THREE.AmbientLight(0x222222));

  controls = new THREE.OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.target.set(0,0,0);

  raycaster = new THREE.Raycaster();

  // postprocessing composer & bloom
  try{
    composer = new THREE.EffectComposer(renderer);
    renderPass = new THREE.RenderPass(scene, camera);
    composer.addPass(renderPass);
    bloomPass = new THREE.UnrealBloomPass(new THREE.Vector2(renderer.domElement.width, renderer.domElement.height), 0.9, 0.4, 0.8);
    bloomPass.threshold = 0.2;
    bloomPass.strength = 0.9;
    bloomPass.radius = 0.4;
    composer.addPass(bloomPass);
    bloomEnabled = true;
  } catch(err){
    console.warn('Postprocessing not available:', err);
    composer = null; bloomPass = null; bloomEnabled = false;
  }

  window.addEventListener('resize', onWindowResize);
  renderer.domElement.addEventListener('pointerdown', onPointerDown);
  renderer.domElement.addEventListener('pointermove', onPointerMove);
  renderer.domElement.addEventListener('pointerup', onPointerUp);

  // add quality selector UI
  addQualitySelector();

  animate();
}

function addQualitySelector(){
  const sel = document.createElement('select');
  sel.id = 'qualitySelect';
  ['High','Medium','Low'].forEach(opt => { const o = document.createElement('option'); o.value = opt.toLowerCase(); o.textContent = opt; sel.appendChild(o); });
  sel.value = 'high';
  sel.addEventListener('change',(e)=>{
    const q = e.target.value;
    if(q==='high'){ renderer.setPixelRatio(Math.min(2, window.devicePixelRatio||1)); bloomEnabled = true; }
    if(q==='medium'){ renderer.setPixelRatio(1); bloomEnabled = true; bloomPass.strength = 0.6; }
    if(q==='low'){ renderer.setPixelRatio(0.75); bloomEnabled = false; }
    onWindowResize();
  });
  const label = document.createElement('label'); label.textContent = 'Visual Quality: '; label.style.color = 'var(--muted)'; label.style.marginLeft = '8px';
  label.appendChild(sel);
  controlsBar.appendChild(label);
}

function onWindowResize(){
  const wrap = document.getElementById('workspaceWrap');
  const w = Math.max(400, Math.min(1200, wrap.clientWidth));
  const h = 600;
  renderer.setSize(w,h);
  if(composer) composer.setSize(w,h);
  camera.aspect = w/h;
  camera.updateProjectionMatrix();
}

function placeComponent3D(c){
  const group = new THREE.Group(); group.name = c.id;
  let body;
  if(c.type === 'battery'){
    const geom = new THREE.CylinderGeometry(0.45, 0.45, 1.2, 20);
    body = new THREE.Mesh(geom, new THREE.MeshStandardMaterial({color:0x4444aa, metalness:0.3, roughness:0.6}));
    body.rotation.x = Math.PI/2;
  } else if(c.type === 'resistor'){
    const geom = new THREE.BoxGeometry(1.6,0.5,0.5);
    body = new THREE.Mesh(geom, new THREE.MeshStandardMaterial({color:0xaa5533, metalness:0.2, roughness:0.7}));
  } else if(c.type === 'led'){
    const geom = new THREE.CylinderGeometry(0.25,0.25,0.8,20);
    body = new THREE.Mesh(geom, new THREE.MeshStandardMaterial({color:0x666666, metalness:0.2, roughness:0.5}));
    body.rotation.x = Math.PI/2;
  } else if(c.type === 'switch'){
    const geom = new THREE.BoxGeometry(1.3,0.6,0.4);
    body = new THREE.Mesh(geom, new THREE.MeshStandardMaterial({color:0x2b2b2b, metalness:0.2, roughness:0.6}));
  } else {
    const geom = new THREE.BoxGeometry(1.2,0.6,0.4);
    body = new THREE.Mesh(geom, new THREE.MeshStandardMaterial({color:0x666666}));
  }
  group.add(body);

  // if switch, add a lever object and state
  let lever = null;
  if(c.type === 'switch'){
    const leverGeom = new THREE.BoxGeometry(0.7,0.12,0.12);
    lever = new THREE.Mesh(leverGeom, new THREE.MeshStandardMaterial({color:0x999999, metalness:0.6, roughness:0.3}));
    lever.position.set(0,0.22,0);
    lever.rotation.z = -0.4;
    group.add(lever);
  }

  let bulb = null;
  if(c.type === 'led'){
    const bulbGeom = new THREE.SphereGeometry(0.28, 12, 8);
    const bulbMat = new THREE.MeshStandardMaterial({color:0xffcc66, emissive:0x000000, emissiveIntensity:0, metalness:0.1, roughness:0.2});
    bulb = new THREE.Mesh(bulbGeom, bulbMat);
    bulb.position.set(0.6,0,0);
    group.add(bulb);
  }

  // label sprite
  const canvas = document.createElement('canvas'); canvas.width = 256; canvas.height = 64;
  const ctx = canvas.getContext('2d'); ctx.fillStyle = 'rgba(230,238,248,1)'; ctx.font = '20px sans-serif'; ctx.fillText(c.label || c.type, 10, 36);
  const tex = new THREE.CanvasTexture(canvas); const spriteMat = new THREE.SpriteMaterial({map:tex}); const sprite = new THREE.Sprite(spriteMat);
  sprite.scale.set(2.4,0.6,1); sprite.position.set(0,-0.9,0); group.add(sprite);

  const pos = mapTo3D(c.x, c.y);
  group.position.copy(pos);
  scene.add(group);

  const compObj = {id:c.id, type:c.type, mesh:group, bulb, switchClosed: c.type === 'switch' ? false : undefined, lever};
  components.push(compObj);
}

function createTerminalSphere(tid, compId, name, x2d, y2d, ttype){
  const pos = mapTo3D(x2d, y2d);
  const geom = new THREE.SphereGeometry(0.12, 12, 8);
  const mat = new THREE.MeshStandardMaterial({color:0x222222, metalness:0.6, roughness:0.3});
  const sph = new THREE.Mesh(geom, mat);
  sph.position.copy(pos);
  sph.userData = { terminalId: tid };
  scene.add(sph);
  terminalMap[tid] = { compId, name, pos, mesh:sph, type:ttype };
  const ringGeom = new THREE.RingGeometry(0.15,0.22,32);
  const ringMat = new THREE.MeshBasicMaterial({color:0xffffff, opacity:0.06, transparent:true});
  const ring = new THREE.Mesh(ringGeom, ringMat);
  ring.rotation.x = Math.PI/2; ring.position.copy(pos); ring.position.z -= 0.01; scene.add(ring);
  return sph;
}

function clearScene(){
  components.forEach(c=>{ scene.remove(c.mesh); }); components = [];
  for(let id in terminalMap){ scene.remove(terminalMap[id].mesh); }
  terminalMap = {};
  wires.forEach(w => scene.remove(w.mesh)); wires = [];
  pending = null; if(tempLine){ scene.remove(tempLine); tempLine = null; }
}

function loadLevel(index){
  currentLevel = index % levels.length;
  levelName.textContent = (currentLevel+1) + ' — ' + levels[currentLevel].name;
  const L = levels[currentLevel];
  clearScene();
  L.components.forEach(c=> placeComponent3D(c));
  L.terminals.forEach(t => { const [tid, compId, name, dx, dy, ttype] = t; const comp = L.components.find(cc => cc.id === compId); const x = comp.x + dx; const y = comp.y + dy; createTerminalSphere(tid, compId, name, x, y, ttype); });
  message.textContent = 'Goal: ' + L.name;
}

function getIntersections(event){
  const rect = renderer.domElement.getBoundingClientRect();
  pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
  pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
  raycaster.setFromCamera(pointer, camera);
  const objs = Object.values(terminalMap).map(t => t.mesh);
  return raycaster.intersectObjects(objs, false);
}

function getComponentIntersections(event){
  const rect = renderer.domElement.getBoundingClientRect();
  pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
  pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
  raycaster.setFromCamera(pointer, camera);
  const objs = components.map(c => c.mesh);
  return raycaster.intersectObjects(objs, true);
}

function getPointer3DOnPlane(event){
  const rect = renderer.domElement.getBoundingClientRect();
  pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
  pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
  raycaster.setFromCamera(pointer, camera);
  const pos = new THREE.Vector3();
  raycaster.ray.intersectPlane(planeZ, pos);
  return pos;
}

function onPointerDown(e){
  // first check components (for switch toggles)
  const compHits = getComponentIntersections(e);
  if(compHits.length>0){
    const mesh = compHits[0].object;
    const comp = components.find(c => c.mesh === mesh || c.mesh.children.includes(mesh) || c.mesh.getObjectById(mesh.id));
    if(comp && comp.type === 'switch'){
      toggleSwitch(comp.id);
      return;
    }
  }

  const hits = getIntersections(e);
  if(hits.length>0){
    const hit = hits[0].object; const tid = hit.userData.terminalId;
    if(!pending){
      pending = { terminalId: tid, pos: terminalMap[tid].pos.clone() };
      highlightTerminal3D(tid, true);
      const material = new THREE.LineBasicMaterial({color:0xffcc00, linewidth:4});
      const geometry = new THREE.BufferGeometry().setFromPoints([pending.pos, pending.pos.clone()]);
      tempLine = new THREE.Line(geometry, material);
      scene.add(tempLine);
      message.textContent = 'Selected ' + tid + '. Click another terminal to connect.';
    } else {
      const a = pending.terminalId; const b = tid;
      if(a === b){ cleanupPending3D(); message.textContent = 'Cancelled.'; return; }
      if(wires.some(w => (w.from===a && w.to===b) || (w.from===b && w.to===a))){ message.textContent = 'Those terminals are already connected.'; cleanupPending3D(); return; }
      createWire3D(a,b); cleanupPending3D(); validateLevel();
    }
  } else {
    if(pending){ cleanupPending3D(); message.textContent = 'Cancelled.'; }
  }
}

function onPointerMove(e){ if(!pending) return; const pos = getPointer3DOnPlane(e); if(!pos) return; if(tempLine){ const pts = [pending.pos, pos.clone()]; tempLine.geometry.setFromPoints(pts); } }
function onPointerUp(e){}

function cleanupPending3D(){ if(pending){ highlightTerminal3D(pending.terminalId, false); pending = null; } if(tempLine){ scene.remove(tempLine); tempLine.geometry.dispose(); tempLine.material.dispose(); tempLine = null; } }

function highlightTerminal3D(tid, on=true){ const t = terminalMap[tid]; if(!t) return; t.mesh.material.color.set(on ? 0x00aaff : 0x222222); }

function createWire3D(a,b){ const A = terminalMap[a]; const B = terminalMap[b]; const mid = new THREE.Vector3().addVectors(A.pos, B.pos).multiplyScalar(0.5); mid.z += 0.6; const curve = new THREE.CatmullRomCurve3([A.pos.clone(), mid, B.pos.clone()]); const tubeGeom = new THREE.TubeGeometry(curve, 48, 0.06, 8, false); const mat = new THREE.MeshStandardMaterial({color:0xffd166, metalness:0.3, roughness:0.4, emissive:0x000000, emissiveIntensity:0}); const mesh = new THREE.Mesh(tubeGeom, mat); scene.add(mesh); wires.push({from:a,to:b,mesh,mat}); }

function getConnectionGroups(){ const parents = {}; function find(x){ if(parents[x]===undefined) parents[x]=x; if(parents[x]===x) return x; parents[x]=find(parents[x]); return parents[x]; } function union(a,b){ const ra=find(a), rb=find(b); if(ra!==rb) parents[rb]=ra; } for(let id in terminalMap) parents[id]=id; wires.forEach(w => union(w.from,w.to)); // if switches are closed, union their terminals
  components.filter(c=>c.type==='switch' && c.switchClosed).forEach(sw=>{
    const tIds = Object.keys(terminalMap).filter(k=>terminalMap[k].compId===sw.id);
    if(tIds.length>=2) union(tIds[0], tIds[1]);
  });
  const groups = {}; for(let id in terminalMap){ const r=find(id); groups[r]=groups[r]||[]; groups[r].push(id); } return groups; }

function connected(a,b){ const groups=getConnectionGroups(); for(let k in groups){ const g=groups[k]; if(g.includes(a) && g.includes(b)) return true; } return false; }

function validateLevel(){ const L = levels[currentLevel]; const missing = []; L.requiredPairs.forEach(p => { if(!connected(p[0],p[1])) missing.push(p); }); if(missing.length===0){ markWiresStatus3D(true); message.innerHTML = '<span class="success">Well done! Level complete.</span>'; } else { markWiresStatus3D(false); message.innerHTML = 'Missing connections: ' + missing.map(m=>m[0]+'→'+m[1]).join(', '); } }

function markWiresStatus3D(valid){
  wires.forEach(w => {
    if(valid){ w.mat.emissive.setHex(0x33ff33); w.mat.emissiveIntensity = 0.6; w.mat.color.setHex(0x88ff88); } else { w.mat.emissive.setHex(0x000000); w.mat.emissiveIntensity = 0; w.mat.color.setHex(0xffd166); }
  });

  // LED glow: set led bulb emissive based on connectivity (respecting switches)
  components.forEach(c => {
    if(c.type === 'led' && c.bulb){
      const an = Object.keys(terminalMap).find(k=>terminalMap[k].compId===c.id && terminalMap[k].name && terminalMap[k].name.toLowerCase().includes('an'));
      const ca = Object.keys(terminalMap).find(k=>terminalMap[k].compId===c.id && terminalMap[k].name && terminalMap[k].name.toLowerCase().includes('ca'));
      const batPos = Object.keys(terminalMap).find(k=>terminalMap[k].compId==='bat' && terminalMap[k].name==='+' );
      const batNeg = Object.keys(terminalMap).find(k=>terminalMap[k].compId==='bat' && terminalMap[k].name==='-' );
      if(an && ca && batPos && batNeg){
        const ok = connected(batPos, an) && connected(an, ca) && connected(ca, batNeg);
        if(ok){ c.bulb.material.emissive.setHex(0xffaa33); c.bulb.material.emissiveIntensity = 1.2; }
        else { c.bulb.material.emissive.setHex(0x000000); c.bulb.material.emissiveIntensity = 0; }
      }
    }
  });
}

// Toggle switch state and animate lever
function toggleSwitch(switchId){
  const comp = components.find(c=>c.id===switchId);
  if(!comp) return;
  comp.switchClosed = !comp.switchClosed;
  // animate lever rotation/position
  if(comp.lever){
    const to = comp.switchClosed ? 0.4 : -0.4;
    comp.lever.rotation.z = to;
  }
  message.textContent = 'Switch ' + switchId + ' is now ' + (comp.switchClosed ? 'CLOSED' : 'OPEN');
  validateLevel();
}

resetBtn.addEventListener('click', ()=> loadLevel(currentLevel));
hintBtn.addEventListener('click', ()=>{ message.innerHTML = '<span class="hint">' + levels[currentLevel].hint + '</span>'; });
nextBtn.addEventListener('click', ()=> loadLevel((currentLevel+1) % levels.length));

// Init and start
initThree(); loadLevel(0);

function animate(){ requestAnimationFrame(animate); controls.update(); if(bloomEnabled && composer){ composer.render(); } else { renderer.render(scene, camera); } }

window.addEventListener('keydown', (e)=>{ if(e.key==='r') loadLevel(currentLevel); if(e.key==='n') loadLevel((currentLevel+1)%levels.length); });
