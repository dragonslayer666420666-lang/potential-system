// WireWise 3D — Three.js version
// Replaces SVG workspace with a Three.js canvas, 3D components, spherical terminals,
// raycast-based wiring, tube wires, and LED glow when circuit closed.

/* eslint-disable no-undef */

// Keep original levels & UI elements — we'll map 2D coords into 3D positions
const levelName = document.getElementById('levelName');
const resetBtn = document.getElementById('resetBtn');
const hintBtn = document.getElementById('hintBtn');
const nextBtn = document.getElementById('nextBtn');
const message = document.getElementById('message');

let currentLevel = 0;
let components = []; // {id,type,mesh,terminals: [terminalId,...]}
let wires = []; // {from,to,mesh}
let terminalMap = {}; // id -> {compId,name,pos:THREE.Vector3,mesh,type}
let pending = null; // {terminalId, pos}

// Three.js scaffolding
let scene, camera, renderer, controls, raycaster;
let pointer = new THREE.Vector2();
let tempLine = null; // THREE.Line for preview
const planeZ = new THREE.Plane(new THREE.Vector3(0,0,1), 0);

const levels = [
  // same levels as before
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

// Map 2D level coords (0..1000, 0..600) into 3D positions on plane z=0
function mapTo3D(x2d, y2d){
  // center and scale down
  const sx = (x2d - 500) / 120; // adjust scale for scene
  const sy = (300 - y2d) / 120;
  return new THREE.Vector3(sx, sy, 0);
}

function initThree(){
  const wrap = document.getElementById('workspaceWrap');
  // create and attach renderer
  renderer = new THREE.WebGLRenderer({antialias:true});
  renderer.setSize(Math.min(1000, wrap.clientWidth), 600);
  renderer.setPixelRatio(window.devicePixelRatio || 1);
  wrap.innerHTML = '';
  renderer.domElement.id = 'threeCanvas';
  wrap.appendChild(renderer.domElement);

  // scene & camera
  scene = new THREE.Scene();
  scene.background = new THREE.Color(0x071c22);
  camera = new THREE.PerspectiveCamera(50, renderer.domElement.clientWidth / renderer.domElement.clientHeight, 0.1, 100);
  camera.position.set(0,0,6);

  // lights
  const hemi = new THREE.HemisphereLight(0xffffff, 0x444444, 0.6);
  scene.add(hemi);
  const dir = new THREE.DirectionalLight(0xffffff, 0.6);
  dir.position.set(5,10,7);
  scene.add(dir);

  // small ambient
  scene.add(new THREE.AmbientLight(0x222222));

  // controls
  controls = new THREE.OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.target.set(0,0,0);

  raycaster = new THREE.Raycaster();

  window.addEventListener('resize', onWindowResize);
  renderer.domElement.addEventListener('pointerdown', onPointerDown);
  renderer.domElement.addEventListener('pointermove', onPointerMove);
  renderer.domElement.addEventListener('pointerup', onPointerUp);

  animate();
}

function onWindowResize(){
  const wrap = document.getElementById('workspaceWrap');
  const w = Math.min(1000, wrap.clientWidth);
  const h = 600;
  renderer.setSize(w,h);
  camera.aspect = w/h;
  camera.updateProjectionMatrix();
}

// create simple component primitives
function placeComponent3D(c){
  const group = new THREE.Group();
  group.name = c.id;

  // base body
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

  // LED bulb (emissive mesh) for leds
  let bulb = null;
  if(c.type === 'led'){
    const bulbGeom = new THREE.SphereGeometry(0.28, 12, 8);
    const bulbMat = new THREE.MeshStandardMaterial({color:0xffcc66, emissive:0x000000, emissiveIntensity:0, metalness:0.1, roughness:0.2});
    bulb = new THREE.Mesh(bulbGeom, bulbMat);
    bulb.position.set(0.6,0,0); // front of LED body
    group.add(bulb);
  }

  // label as simple sprite (optional)
  const canvas = document.createElement('canvas');
  canvas.width = 256; canvas.height = 64;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = 'rgba(230,238,248,1)'; ctx.font = '20px sans-serif'; ctx.fillText(c.label || c.type, 10, 36);
  const tex = new THREE.CanvasTexture(canvas);
  const spriteMat = new THREE.SpriteMaterial({map:tex});
  const sprite = new THREE.Sprite(spriteMat);
  sprite.scale.set(2.4,0.6,1);
  sprite.position.set(0,-0.9,0);
  group.add(sprite);

  // position group
  const pos = mapTo3D(c.x, c.y);
  group.position.copy(pos);
  scene.add(group);

  // register component
  components.push({id:c.id, type:c.type, mesh:group, bulb});
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
  // add small highlight ring
  const ringGeom = new THREE.RingGeometry(0.15,0.22,32);
  const ringMat = new THREE.MeshBasicMaterial({color:0xffffff, opacity:0.06, transparent:true});
  const ring = new THREE.Mesh(ringGeom, ringMat);
  ring.rotation.x = Math.PI/2;
  ring.position.copy(pos);
  ring.position.z -= 0.01;
  scene.add(ring);
  return sph;
}

function clearScene(){
  // remove components, terminals, wires
  components.forEach(c=>{ scene.remove(c.mesh); if(c.bulb) scene.remove(c.bulb); });
  components = [];
  for(let id in terminalMap){ scene.remove(terminalMap[id].mesh); }
  terminalMap = {};
  wires.forEach(w => scene.remove(w.mesh));
  wires = [];
  pending = null;
  if(tempLine){ scene.remove(tempLine); tempLine = null; }
}

function loadLevel(index){
  currentLevel = index % levels.length;
  levelName.textContent = (currentLevel+1) + ' — ' + levels[currentLevel].name;
  const L = levels[currentLevel];
  clearScene();

  // place components
  L.components.forEach(c=> placeComponent3D(c));

  // place terminals using terminal offsets
  L.terminals.forEach(t => {
    const [tid, compId, name, dx, dy, ttype] = t;
    // find comp base position
    const comp = L.components.find(cc => cc.id === compId);
    const x = comp.x + dx;
    const y = comp.y + dy;
    createTerminalSphere(tid, compId, name, x, y, ttype);
  });

  message.textContent = 'Goal: ' + L.name;
}

// Raycast helpers
function getIntersections(event){
  const rect = renderer.domElement.getBoundingClientRect();
  pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
  pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
  raycaster.setFromCamera(pointer, camera);
  const objs = Object.values(terminalMap).map(t => t.mesh);
  return raycaster.intersectObjects(objs, false);
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
  const hits = getIntersections(e);
  if(hits.length>0){
    const hit = hits[0].object;
    const tid = hit.userData.terminalId;
    if(!pending){
      pending = { terminalId: tid, pos: terminalMap[tid].pos.clone() };
      highlightTerminal3D(tid, true);
      // create temp line
      const material = new THREE.LineBasicMaterial({color:0xffcc00, linewidth:4});
      const geometry = new THREE.BufferGeometry().setFromPoints([pending.pos, pending.pos.clone()]);
      tempLine = new THREE.Line(geometry, material);
      scene.add(tempLine);
      message.textContent = 'Selected ' + tid + '. Click another terminal to connect.';
    } else {
      // completing a connection
      const a = pending.terminalId;
      const b = tid;
      if(a === b){ cleanupPending3D(); message.textContent = 'Cancelled.'; return; }
      if(wires.some(w => (w.from===a && w.to===b) || (w.from===b && w.to===a))){ message.textContent = 'Those terminals are already connected.'; cleanupPending3D(); return; }
      createWire3D(a,b);
      cleanupPending3D();
      validateLevel();
    }
  } else {
    // clicked empty space -> cancel
    if(pending){ cleanupPending3D(); message.textContent = 'Cancelled.'; }
  }
}

function onPointerMove(e){
  if(!pending) return;
  const pos = getPointer3DOnPlane(e);
  if(!pos) return;
  // update temp line geometry
  if(tempLine){
    const pts = [pending.pos, pos.clone()];
    tempLine.geometry.setFromPoints(pts);
  }
}

function onPointerUp(e){ /* no-op for now */ }

function cleanupPending3D(){
  if(pending){ highlightTerminal3D(pending.terminalId, false); pending = null; }
  if(tempLine){ scene.remove(tempLine); tempLine.geometry.dispose(); tempLine.material.dispose(); tempLine = null; }
}

function highlightTerminal3D(tid, on=true){
  const t = terminalMap[tid];
  if(!t) return;
  t.mesh.material.color.set(on ? 0x00aaff : 0x222222);
}

function createWire3D(a,b){
  const A = terminalMap[a];
  const B = terminalMap[b];
  // build smooth curve: A -> mid (raised) -> B
  const mid = new THREE.Vector3().addVectors(A.pos, B.pos).multiplyScalar(0.5);
  mid.z += 0.6; // lift for curve
  const curve = new THREE.CatmullRomCurve3([A.pos.clone(), mid, B.pos.clone()]);
  const tubeGeom = new THREE.TubeGeometry(curve, 48, 0.06, 8, false);
  const mat = new THREE.MeshStandardMaterial({color:0xffd166, metalness:0.3, roughness:0.4, emissive:0x000000, emissiveIntensity:0});
  const mesh = new THREE.Mesh(tubeGeom, mat);
  scene.add(mesh);
  wires.push({from:a,to:b,mesh,mat});
}

// Validation (reuse union-find logic using terminalMap and wires)
function getConnectionGroups(){
  const parents = {};
  function find(x){ if(parents[x]===undefined) parents[x]=x; if(parents[x]===x) return x; parents[x]=find(parents[x]); return parents[x]; }
  function union(a,b){ const ra=find(a), rb=find(b); if(ra!==rb) parents[rb]=ra; }
  for(let id in terminalMap) parents[id]=id;
  wires.forEach(w => union(w.from,w.to));
  const groups = {};
  for(let id in terminalMap){ const r=find(id); groups[r]=groups[r]||[]; groups[r].push(id); }
  return groups;
}

function connected(a,b){ const groups=getConnectionGroups(); for(let k in groups){ const g=groups[k]; if(g.includes(a) && g.includes(b)) return true; } return false; }

function validateLevel(){
  const L = levels[currentLevel];
  const missing = [];
  L.requiredPairs.forEach(p => { if(!connected(p[0],p[1])) missing.push(p); });
  if(missing.length===0){
    markWiresStatus3D(true);
    message.innerHTML = '<span class="success">Well done! Level complete.</span>';
  } else {
    markWiresStatus3D(false);
    message.innerHTML = 'Missing connections: ' + missing.map(m=>m[0]+'→'+m[1]).join(', ');
  }
}

function markWiresStatus3D(valid){
  wires.forEach(w => {
    if(valid){
      w.mat.emissive.setHex(0x33ff33);
      w.mat.emissiveIntensity = 0.6;
      w.mat.color.setHex(0x88ff88);
    } else {
      w.mat.emissive.setHex(0x000000);
      w.mat.emissiveIntensity = 0;
      // highlight invalid wires red if they are in the set
      w.mat.color.setHex(0xffd166);
    }
  });

  // LED glow: if completed, set led bulb emissive
  const L = levels[currentLevel];
  const allGood = Object.keys(L.requiredPairs || {}).length === 0 ? false : true; // placeholder
  // better: light any LED that's connected from battery+ to battery-
  components.forEach(c => {
    if(c.type === 'led' && c.bulb){
      // find any terminal on this LED: anode led-an and cathode led-ca
      const an = Object.keys(terminalMap).find(k=>terminalMap[k].compId===c.id && terminalMap[k].name && terminalMap[k].name.toLowerCase().includes('an'));
      const ca = Object.keys(terminalMap).find(k=>terminalMap[k].compId===c.id && terminalMap[k].name && terminalMap[k].name.toLowerCase().includes('ca'));
      // if both exist and connected from bat+ to bat-
      const batPos = Object.keys(terminalMap).find(k=>terminalMap[k].compId==='bat' && terminalMap[k].name==='+' );
      const batNeg = Object.keys(terminalMap).find(k=>terminalMap[k].compId==='bat' && terminalMap[k].name==='-' );
      if(an && ca && batPos && batNeg){
        // check if path from bat+ to an, an to ca, ca to bat- exists transitively
        const ok = connected(batPos, an) && connected(an, ca) && connected(ca, batNeg);
        if(ok){ c.bulb.material.emissive.setHex(0xffaa33); c.bulb.material.emissiveIntensity = 1.2; } else { c.bulb.material.emissive.setHex(0x000000); c.bulb.material.emissiveIntensity = 0; }
      }
    }
  });
}

// UI wiring
resetBtn.addEventListener('click', ()=> loadLevel(currentLevel));
hintBtn.addEventListener('click', ()=>{ message.innerHTML = '<span class="hint">' + levels[currentLevel].hint + '</span>'; });
nextBtn.addEventListener('click', ()=> loadLevel((currentLevel+1) % levels.length));

// Init and start
initThree();
loadLevel(0);

function animate(){
  requestAnimationFrame(animate);
  controls.update();
  renderer.render(scene, camera);
}

// Optional: keyboard shortcuts
window.addEventListener('keydown', (e)=>{
  if(e.key==='r') loadLevel(currentLevel);
  if(e.key==='n') loadLevel((currentLevel+1)%levels.length);
});
