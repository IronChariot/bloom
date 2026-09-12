import { petalGeometry, roundedPetalPath } from './petal-geometry.js';
import { arrangePetals } from './petal-model.js';

const emojis = ['😀','😃','😊','😍','🥰','😎','🤔','🧐','😮','😂','🥳','😴','😬','😢','😡','🤯','👍','👎','❤️','⭐','🔥','💡','🎯','✅','❓','⚠️','🚀','🌱','🎉','💪','👀','🙏'];
const commentIcon = '<path d="M-7-5h14v9H0l-4 4V4h-3z" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/>';
// Action icons use centred SVG geometry rather than font-dependent glyph baselines.
const menuIcons = {
  color: '<circle cx="12" cy="12" r="4.5" fill="currentColor" stroke="none"/>',
  smile: '<circle cx="12" cy="12" r="8"/><path d="M8 14a4.5 4.5 0 0 0 8 0M9 9h.01M15 9h.01"/>',
  edit: '<path d="m4 15 11-11 5 5L9 20H4zM12 7l5 5"/>',
  trash: '<path d="M4 6h16M9 6V3h6v3M6 6l1 15h10l1-15M10 10v7M14 10v7"/>',
  close: '<path d="m6 6 12 12M6 18 18 6"/>',
  back: '<path d="m15 6-6 6 6 6"/>',
};
const mix = (color, amount) => '#' + [1,3,5].map(i => { const c = parseInt(color.slice(i,i+2),16); return Math.round(c + ((amount < 0 ? 0 : 255)-c)*Math.abs(amount)).toString(16).padStart(2,'0'); }).join('');
const ownerId = el => { const owner = el.closest('[data-node], [data-petal-node]'); return owner?.dataset.node || owner?.dataset.petalNode; };
const angleFor = slot => -Math.PI / 4 + slot * Math.PI / 4;
const distance = (a,b) => Math.atan2(Math.sin(a-b),Math.cos(a-b));

export function createPetals({ board, getState, nodeById, getPhysical, radius, clientToWorld, apply, esc, colors, prepare, toast }) {
  let menu, tooltip, context, dragging, pending, boardKey;
  const motion = new Map();
  const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const petalById = (nodeId,id) => nodeById(nodeId)?.petals?.find(p => p.id === id);
  function close() { menu?.remove(); menu = null; context = null; hideTip(); }
  function hideTip() { tooltip?.remove(); tooltip = null; }
  function open(nodeId, x, y, petalId) {
    prepare(nodeId); close(); context = { nodeId, petalId, x, y };
    if (!petalId && (nodeById(nodeId)?.petals?.length || 0) >= 8) { toast('This blob already has eight petals. Select a petal to edit or remove it.'); return; }
    choices();
  }
  function panel(size, label) {
    menu?.remove(); hideTip();
    menu = document.createElement('div'); menu.className = 'petal-menu'; menu.setAttribute('role','dialog'); menu.setAttribute('aria-label',label);
    menu.style.width = menu.style.height = `${size}px`;
    const half = size/2;
    menu.style.left = `${Math.max(half+8, Math.min(innerWidth-half-8,context.x))}px`;
    menu.style.top = `${Math.max(half+84, Math.min(innerHeight-half-8,context.y))}px`;
    menu.addEventListener('pointerdown', e => e.stopPropagation());
    menu.addEventListener('keydown', e => { e.stopPropagation(); if(e.key==='Escape')close(); });
    document.body.append(menu); return menu;
  }
  function radialButton(label, content, angle, radius, action, color) {
    const button = document.createElement('button'); button.type='button'; button.className='petal-choice'; button.setAttribute('aria-label',label); button.title=label;
    button.style.left=`calc(50% + ${Math.cos(angle)*radius}px)`; button.style.top=`calc(50% + ${Math.sin(angle)*radius}px)`;
    if(color) { button.style.background=color; button.classList.add('petal-color-choice'); }
    if(menuIcons[content])button.innerHTML=`<svg viewBox="0 0 24 24" aria-hidden="true">${menuIcons[content]}</svg>`;
    else button.textContent=content;
    if(label==='Comment petal')button.innerHTML=`<svg viewBox="-12 -12 24 24" aria-hidden="true">${commentIcon}</svg>`;
    if(label==='Blank petal')button.innerHTML='<svg viewBox="-20 -20 40 40" aria-hidden="true"><ellipse rx="17" ry="16" fill="white"/></svg>';
    button.addEventListener('click',action); menu.append(button); return button;
  }
  function back() { radialButton('Back','back',0,0,choices); }
  function choices() {
    if(!context)return;
    const petal=context.petalId && petalById(context.nodeId,context.petalId);
    panel(petal?210:190,petal?'Edit petal':'Add petal');
    const actions = petal ? [
      ['Change petal colour','color',colorMenu],
      ...(petal.kind !== 'comment' ? [['Choose emoticon','smile',emojiMenu]] : []),
      ...(petal.kind !== 'emoji' ? [[petal.kind==='comment'?'Edit comment':'Add comment','edit',commentMenu]] : []),
      ['Delete petal','trash',() => save({type:'deletePetal'})]
    ] : [['Blank petal','●',colorMenu],['Emoticon petal','smile',emojiMenu],['Comment petal','✎',commentMenu]];
    actions.forEach(([label,glyph,action],i)=>radialButton(label,glyph,-Math.PI/2+i*Math.PI*2/actions.length,64,action));
    radialButton('Close petal menu','close',0,0,close).classList.add('petal-menu-close');
    menu.querySelector('button').focus({preventScroll:true});
  }
  function colorMenu() {
    panel(374,'Petal colours');
    [-.5,-.15,.25,.65].forEach((amount,ring)=>colors.forEach((color,i)=> {
      const shade=mix(color,amount);
      radialButton(`Petal colour ${shade}`, '', -Math.PI/2+i*Math.PI*2/colors.length,50+ring*39,()=>save({color:shade,kind:context.petalId?undefined:'color'}),shade);
    })); back();
  }
  function emojiMenu() {
    panel(326,'Petal emoticons');
    emojis.forEach((emoji,i)=> { const ring=i<12?0:1, j=ring?i-12:i, count=ring?20:12; radialButton(`Emoticon ${emoji}`,emoji,-Math.PI/2+j*Math.PI*2/count,ring?137:78,()=>save({kind:'emoji',emoji,...(!context.petalId?{color:'#ffffff'}:{})})); }); back();
  }
  function commentMenu() {
    const current=context.petalId && petalById(context.nodeId,context.petalId);
    panel(300,'Petal comment'); menu.classList.add('petal-comment-form'); menu.style.height='auto';
    // Anchor the form immediately below the cursor when space allows.
    menu.style.top=`${Math.min(innerHeight-230,Math.max(84,context.y+12))}px`;
    menu.innerHTML='<label for="petal-comment-input">Enter your comment</label><textarea id="petal-comment-input" maxlength="4000" rows="4"></textarea><div class="petal-comment-actions"><button type="button" class="confirm-comment" aria-label="Confirm comment" disabled>✓</button><button type="button" class="cancel-comment" aria-label="Cancel comment">×</button></div>';
    const input=menu.querySelector('textarea'), confirm=menu.querySelector('.confirm-comment'); input.value=current?.comment || '';
    const validate=()=>{confirm.disabled=!input.value.trim();}; validate(); input.addEventListener('input',validate);
    const submit=()=> { if(input.value.trim())save({kind:'comment',comment:input.value.trim(),...(current?.kind==='comment'?{beforeComment:current.comment}:{}),...(!context.petalId?{color:'#ffffff'}:{})}); };
    confirm.addEventListener('click',submit); menu.querySelector('.cancel-comment').addEventListener('click',close);
    input.addEventListener('keydown',e=> { if(e.key==='Enter'&&!e.shiftKey){e.preventDefault();submit();} }); input.focus();
  }
  function save(fields) {
    const {nodeId,petalId}=context;
    const op={type:petalId?'updatePetal':'addPetal',nodeId,...(petalId?{id:petalId}:{}),...fields};
    close(); apply([op]);
  }
  function showTip(nodeId,id,element) {
    const petal=petalById(nodeId,id); if(petal?.kind!=='comment'||dragging)return;
    hideTip(); tooltip=document.createElement('div'); tooltip.className='petal-tooltip'; tooltip.setAttribute('role','tooltip');
    const who=document.createElement('strong'); who.textContent=petal.author||'Unknown author';
    const time=document.createElement('time'); time.textContent=petal.createdAt ? new Date(petal.createdAt).toLocaleString() : 'Unknown date';
    const body=document.createElement('div'); body.textContent=petal.comment;
    tooltip.append(who,time,body); tooltip.addEventListener('pointerleave',hideTip);
    if(petal.updatedAt){const edited=document.createElement('small');edited.textContent=`Edited by ${petal.updatedBy} · ${new Date(petal.updatedAt).toLocaleString()}`;tooltip.append(edited);}
    document.body.append(tooltip); const box=element.getBoundingClientRect(), bounds=tooltip.getBoundingClientRect();
    tooltip.style.left=`${Math.max(8,Math.min(innerWidth-bounds.width-8,box.right+10))}px`;
    tooltip.style.top=`${Math.max(84,Math.min(innerHeight-bounds.height-8,box.top))}px`;
  }
  board.addEventListener('contextmenu',e=> {
    const nodeId=ownerId(e.target); if(!nodeId)return;
    e.preventDefault();e.stopPropagation();open(nodeId,e.clientX,e.clientY,e.target.closest('[data-petal]')?.dataset.petal);
  });
  board.addEventListener('dblclick',e=> {if(e.target.closest('[data-petal]')){e.stopImmediatePropagation();e.preventDefault();}},true);
  board.addEventListener('pointerdown',e=> {
    const element=e.target.closest('[data-petal]');if(!element||e.button!==0)return;
    e.stopImmediatePropagation();e.preventDefault();close();
    const nodeId=ownerId(element),id=element.dataset.petal,petal=petalById(nodeId,id);
    dragging={nodeId,id,x:e.clientX,y:e.clientY,moved:false,slot:petal.slot,angle:angleFor(petal.slot)};
    board.setPointerCapture(e.pointerId);
  },true);
  document.addEventListener('pointermove',e=> {
    if(!dragging)return; e.stopImmediatePropagation();
    const d=dragging,node=nodeById(d.nodeId),p=getPhysical().get(d.nodeId);if(!node||!p){dragging=null;return;}
    if(!d.moved&&Math.hypot(e.clientX-d.x,e.clientY-d.y)<4)return; d.moved=true;
    const hit=clientToWorld(e.clientX,e.clientY),r=radius(node);
    d.angle=Math.atan2(hit.y-p.y,hit.x-p.x);
    d.slot=((Math.round((d.angle+Math.PI/4)/(Math.PI/4))%8)+8)%8;
    d.petals=arrangePetals(node.petals,d.id,d.slot);
  },true);
  document.addEventListener('pointerup',e=> {
    if(!dragging)return;e.stopImmediatePropagation();e.preventDefault();
    const d=dragging;dragging=null;
    if(!d.moved){open(d.nodeId,e.clientX,e.clientY,d.id);return;}
    if(!petalById(d.nodeId,d.id))return;
    pending={nodeId:d.nodeId,petals:d.petals}; const own=pending;
    apply([{type:'movePetal',nodeId:d.nodeId,id:d.id,slot:d.slot}]).finally(()=>{if(pending===own)pending=null;});
  },true);
  board.addEventListener('pointerover',e=> {const el=e.target.closest('[data-petal]');if(el&&!el.contains(e.relatedTarget))showTip(ownerId(el),el.dataset.petal,el);});
  board.addEventListener('pointerout',e=> {const el=e.target.closest('[data-petal]');if(el&&!el.contains(e.relatedTarget)&&!tooltip?.contains(e.relatedTarget))hideTip();});
  board.addEventListener('focusin',e=> {const el=e.target.closest('[data-petal]');if(el)showTip(ownerId(el),el.dataset.petal,el);});
  board.addEventListener('focusout',hideTip);
  board.addEventListener('keydown',e=> {const el=e.target.closest('[data-petal]');if(el&&['Enter',' '].includes(e.key)){e.preventDefault();e.stopImmediatePropagation();const b=el.getBoundingClientRect();open(ownerId(el),b.x+b.width/2,b.y+b.height/2,el.dataset.petal);}},true);
  document.addEventListener('pointerdown',e=>{if(menu&&!menu.contains(e.target))close();});
  document.addEventListener('keydown',e=>{if(e.key==='Escape'){close();dragging=null;}});
  window.addEventListener('blur',()=>{close();dragging=null;});
  document.addEventListener('pointercancel',()=>{dragging=null;});
  window.addEventListener('resize',close);
  return {
    render(node) {
      return (node.petals||[]).map(p=>`<g class="petal" data-petal="${esc(p.id)}" tabindex="0" role="button" aria-label="${esc(p.kind==='comment'?'Comment petal':p.kind==='emoji'?`Emoticon petal ${p.emoji}`:'Colour petal')}"><path class="petal-shape" d="${roundedPetalPath}" vector-effect="non-scaling-stroke" fill="${p.color}"/><g class="petal-content">${p.kind==='emoji'?`<text class="petal-emoji" text-anchor="middle" dominant-baseline="central">${esc(p.emoji)}</text>`:p.kind==='comment'?`<g class="petal-comment-icon">${commentIcon}</g>`:''}</g></g>`).join('');
    },
    reconcile() {
      const key=getState()?.boardId||getState()?.graph?.nodes[0]?.id;
      if(key!==boardKey){close();dragging=null;pending=null;motion.clear();boardKey=key;}
      if(context&&(!nodeById(context.nodeId)||(context.petalId&&!petalById(context.nodeId,context.petalId))))close();
      if(dragging&&!petalById(dragging.nodeId,dragging.id))dragging=null;
      const live=new Set((getState()?.graph?.nodes||[]).flatMap(n=>(n.petals||[]).map(p=>n.id+':'+p.id)));
      for(const key of motion.keys())if(!live.has(key))motion.delete(key);
    },
    frame(node,element,dt) {
      const petals=dragging?.nodeId===node.id&&dragging.petals?dragging.petals:pending?.nodeId===node.id?pending.petals:node.petals||[];
      const r=radius(node);
      for(const petal of petals){
        const el=element.querySelector(`[data-petal="${CSS.escape(petal.id)}"]`);if(!el)continue;
        const key=node.id+':'+petal.id,target=angleFor(petal.slot);
        if(!motion.has(key))motion.set(key,{angle:target,scale:reduced?1:.1});
        const m=motion.get(key),held=dragging?.nodeId===node.id&&dragging.id===petal.id&&dragging.moved;
        m.angle=held?dragging.angle:reduced?target:m.angle+distance(target,m.angle)*(1-Math.exp(-dt*.2));
        m.scale=reduced?1:m.scale+(1-m.scale)*(1-Math.exp(-dt*.22));
        const g=petalGeometry(r.rx,r.ry,m.angle);
        el.setAttribute('transform',`translate(${g.x},${g.y}) scale(${m.scale})`);
        el.querySelector('.petal-shape').setAttribute('transform',`rotate(${m.angle*180/Math.PI}) scale(${g.radial},${g.tangent})`);
        el.querySelector('.petal-content').setAttribute('transform',`translate(${Math.cos(m.angle)*g.iconOffset},${Math.sin(m.angle)*g.iconOffset})`);
        const emoji=el.querySelector('.petal-emoji'), comment=el.querySelector('.petal-comment-icon');
        if(emoji)emoji.style.fontSize=`${g.iconSize}px`;
        if(comment)comment.setAttribute('transform',`scale(${g.iconSize/16})`);
        el.classList.toggle('petal-dragging',!!held);
      }
    }
  };
}
