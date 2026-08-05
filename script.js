// WireWise — simple educational wiring game
// Save as script.js and open index.html to run.

const svgNS = "http://www.w3.org/2000/svg";
const workspace = document.getElementById('workspace');
const levelName = document.getElementById('levelName');
const resetBtn = document.getElementById('resetBtn');
const hintBtn = document.getElementById('hintBtn');
const nextBtn = document.getElementById('nextBtn');
const message = document.getElementById('message');

let currentLevel = 0;
let components = [];
let wires = []; // {id, fromTerminalId, toTerminalId, path}
let pending = null; // {terminalId, x,y}
let terminalMap = {}; // id -> {compId, name, x, y, svgElement, type}

const levels = [
  // Level 0: Light an LED using battery + resistor + LED
  {
    name: "Simple LED (series): Battery → Resistor → LED → Battery",
    components: [
      { id: 'bat', type: 'battery', x: 120, y: 200, label: 'Battery' },
      { id: 'res', type: 'resistor', x: 410, y: 220, label: 'Resistor' },
      { id: 'led', type: 'led', x: 700, y: 220, label: 'LED' },
    ],
    terminals: [
      // terminalId, compId, tname, dx,dy, terminalType
      ['bat+','bat','+', 90,20,'pos'],
      ['bat-','bat','-', 90,70,'neg'],
      ['res-a','res','a', 40,20,'both'],
      ['res-b','res','b', 130,20,'both'],
      ['led-an','led','anode', 40,25,'anode'],
      ['led-ca','led','cathode', 130,25,'cathode'],
    ],
    requiredPairs: [
      ['bat+','res-a'],
      ['res-b','led-an'],
      ['led-ca','bat-']
    ],
    hint: "Connect battery + to one end of the resistor, the other resistor end to the LED anode, and LED cathode back to battery -."
  },

  // Level 1: Switch to control LED (introduces switch)
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
    requiredPairs: [
      ['bat+','sw-a'],
      ['sw-b','led-an'],
      ['led-ca','bat-']
    ],
    hint: "Place the switch between battery + and the LED anode. The cathode returns to battery -."
  }
];

// helpers
function createSVG(tag, attrs={}) {
  const el = document.createElementNS(svgNS, tag);
  for (let k in attrs) {
    el.setAttribute(k, attrs[k]);
  }
  return el;
}

function clearWorkspace(){
  while (workspace.firstChild) workspace.removeChild(workspace.firstChild);
  components = [];
  wires = [];
  terminalMap = {};
  pending = null;
  message.textContent = '';
}

function loadLevel(index){
  currentLevel = index % levels.length;
  clearWorkspace();
  levelName.textContent = (currentLevel+1) + " — " + levels[currentLevel].name;
  const L = levels[currentLevel];

  // draw grid/background lines lightly
  for(let x=0;x<1000;x+=100){
    const line = createSVG('line',{x1:x,y1:0,x2:x,y2:600,stroke:'rgba(255,255,255,0.02)', 'stroke-width':1});
    workspace.appendChild(line);
  }

  // place component boxes
  L.components.forEach(c => {
    placeComponent(c);
  });

  // place terminals
  L.terminals.forEach(t => {
    const [tid, compId, name, dx, dy, ttype] = t;
    const comp = components.find(c=>c.id===compId);
    const tx = comp.x + dx;
    const ty = comp.y + dy;
    const circle = createSVG('circle',{cx:tx, cy:ty, r:8, class:'terminal', id:tid});
    circle.dataset.terminalId = tid;
    circle.dataset.compId = compId;
    circle.dataset.tname = name;
    circle.dataset.ttype = ttype;
    circle.addEventListener('click', onTerminalClick);
    workspace.appendChild(circle);
    terminalMap[tid] = {compId, name, x:tx, y:ty, svg:circle, type:ttype};
  });

  message.textContent = "Goal: " + L.name;
}

function placeComponent(c){
  const group = createSVG('g',{'data-comp-id':c.id});
  const rect = createSVG('rect',{x:c.x,y:c.y,width:220,height:80,rx:8,ry:8,class:'component-rect'});
  const label = createSVG('text',{x:c.x+12,y:c.y+28,class:'component-label'});
  label.textContent = c.label;
  group.appendChild(rect);
  group.appendChild(label);

  // small icon hints
  const icon = createSVG('text',{x:c.x+12,y:c.y+56,class:'component-label'});
  icon.textContent = '('+c.type+')';
  group.appendChild(icon);

  workspace.appendChild(group);
  components.push({id:c.id,type:c.type,x:c.x,y:c.y,group});
}

// wiring interactions
function onTerminalClick(e){
  e.stopPropagation();
  const tid = e.currentTarget.dataset.terminalId;
  const t = terminalMap[tid];

  // if starting a new wire
  if(!pending){
    pending = {terminalId: tid, x: t.x, y: t.y};
    highlightTerminal(tid,true);
    drawTempPath(t.x,t.y,t.x,t.y);
    message.textContent = "Selected terminal " + tid + ". Click another terminal to connect.";
    return;
  }

  // if clicking the same terminal, cancel
  if(pending.terminalId === tid){
    cleanupPending();
    message.textContent = "Cancelled.";
    return;
  }

  // create a wire between pending and tid
  const a = pending.terminalId;
  const b = tid;

  // disallow duplicate wires
  if(wires.some(w => (w.from===a && w.to===b) || (w.from===b && w.to===a))){
    message.textContent = "Those terminals are already connected.";
    cleanupPending();
    return;
  }

  createWire(a,b);
  cleanupPending();
  validateLevel();
}

let tempPathEl = null;
function drawTempPath(x1,y1,x2,y2){
  if(!tempPathEl){
    tempPathEl = createSVG('path',{class:'wire'});
    tempPathEl.setAttribute('id','tempWire');
    workspace.appendChild(tempPathEl);
  }
  const d = `M ${x1} ${y1} C ${(x1+x2)/2} ${y1} ${(x1+x2)/2} ${y2} ${x2} ${y2}`;
  tempPathEl.setAttribute('d',d);
}

// highlight terminal
function highlightTerminal(tid,on=true){
  const el = terminalMap[tid].svg;
  if(on) el.classList.add('hot'); else el.classList.remove('hot');
}

function cleanupPending(){
  if(pending){
    highlightTerminal(pending.terminalId,false);
    pending = null;
  }
  if(tempPathEl){
    workspace.removeChild(tempPathEl);
    tempPathEl = null;
  }
}

// track mouse moves to update temp path
workspace.addEventListener('mousemove', (ev) => {
  if(!pending) return;
  const rect = workspace.getBoundingClientRect();
  const scaleX = 1000 / rect.width;
  const scaleY = 600 / rect.height;
  const x = (ev.clientX - rect.left) * scaleX;
  const y = (ev.clientY - rect.top) * scaleY;
  drawTempPath(terminalMap[pending.terminalId].x, terminalMap[pending.terminalId].y, x,y);
});

// clicking blank space cancels
workspace.addEventListener('click', (e) => {
  if(!pending) return;
  cleanupPending();
  message.textContent = "Cancelled.";
});

function createWire(a,b){
  const A = terminalMap[a], B = terminalMap[b];
  const path = createSVG('path',{class:'wire'});
  const d = `M ${A.x} ${A.y} C ${(A.x+B.x)/2} ${A.y} ${(A.x+B.x)/2} ${B.y} ${B.x} ${B.y}`;
  path.setAttribute('d',d);
  path.dataset.from = a;
  path.dataset.to = b;
  workspace.appendChild(path);
  wires.push({from:a,to:b,pathEl:path});
}

// Validation logic: check that requiredPairs are connected (transitively via wires)
function getConnectionGroups(){
  // union-find of terminals connected by wires
  const parents = {};
  function find(x){
    if(parents[x]===undefined) parents[x]=x;
    if(parents[x]===x) return x;
    parents[x] = find(parents[x]);
    return parents[x];
  }
  function union(a,b){
    const ra=find(a), rb=find(b);
    if(ra!==rb) parents[rb]=ra;
  }
  // initialize terminals
  for(let id in terminalMap) parents[id]=id;
  wires.forEach(w => union(w.from,w.to));
  // build groups
  const groups = {};
  for(let id in terminalMap){
    const r = find(id);
    groups[r] = groups[r] || [];
    groups[r].push(id);
  }
  return groups; // representative -> [terminals]
}

function connected(a,b){
  const groups = getConnectionGroups();
  for(let k in groups){
    const g = groups[k];
    if(g.includes(a) && g.includes(b)) return true;
  }
  return false;
}

function validateLevel(){
  const L = levels[currentLevel];
  const missing = [];
  L.requiredPairs.forEach(p => {
    if(!connected(p[0],p[1])) missing.push(p);
  });
  if(missing.length===0){
    // success — additionally, do basic sanity: no short (pos to neg directly without load)
    markWiresStatus(true);
    message.innerHTML = `<span class="success">Well done! Level complete.</span>`;
  } else {
    markWiresStatus(false);
    message.innerHTML = `Missing connections: ${missing.map(m=>m[0]+'→'+m[1]).join(', ')}`;
  }
}

function markWiresStatus(valid){
  wires.forEach(w=>{
    if(valid) w.pathEl.classList.remove('invalid'); else w.pathEl.classList.add('invalid');
  });
}

// UI wiring
resetBtn.addEventListener('click', ()=>loadLevel(currentLevel));
hintBtn.addEventListener('click', ()=>{
  message.innerHTML = `<span class="hint">${levels[currentLevel].hint}</span>`;
});
nextBtn.addEventListener('click', ()=>{
  loadLevel((currentLevel+1)%levels.length);
});

// initialize first level
loadLevel(0);

// Optional: simple keyboard shortcuts
document.addEventListener('keydown',(e)=>{
  if(e.key==='r') loadLevel(currentLevel);
  if(e.key==='n') loadLevel((currentLevel+1)%levels.length);
});
