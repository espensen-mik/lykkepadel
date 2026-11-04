// Keep native select values for forms; render a consistent, keyboard-friendly picker.
export function enhanceSelects(root=document){
 root.querySelectorAll('select:not([data-styled])').forEach(select=>{
  select.dataset.styled='true';
  const wrapper=document.createElement('div');wrapper.className='select-control';
  const trigger=document.createElement('button');trigger.type='button';trigger.className='select-trigger';
  const list=document.createElement('div');list.className='select-menu';list.id='picker-'+crypto.randomUUID();list.role='listbox';list.hidden=true;
  const label=select.labels?.[0];
  const name=label?Array.from(label.childNodes).filter(n=>n.nodeType===3).map(n=>n.textContent).join(' ').trim():'Vælg';
  trigger.setAttribute('aria-haspopup','listbox');trigger.setAttribute('aria-controls',list.id);trigger.setAttribute('aria-expanded','false');list.setAttribute('aria-label',name);
  select.before(wrapper);wrapper.append(select,trigger,list);select.hidden=true;
  const close=(focus=false)=>{list.hidden=true;trigger.setAttribute('aria-expanded','false');wrapper.classList.remove('open');if(focus)trigger.focus();};
  const choices=()=>Array.from(list.querySelectorAll('[role=option]:not([aria-disabled=true])'));
  const sync=()=>{
   trigger.textContent=select.selectedOptions[0]?.textContent||'Vælg';trigger.setAttribute('aria-label',name+': '+trigger.textContent);trigger.disabled=select.disabled;
   list.replaceChildren();Array.from(select.options).forEach(option=>{
    const item=document.createElement('div');item.role='option';item.tabIndex=-1;item.textContent=option.textContent;item.dataset.value=option.value;
    item.setAttribute('aria-selected',String(option.selected));item.setAttribute('aria-disabled',String(option.disabled));
    item.addEventListener('click',()=>{if(option.disabled)return;select.value=option.value;sync();close(true);select.dispatchEvent(new Event('change',{bubbles:true}));if(!wrapper.isConnected&&select.id)queueMicrotask(()=>document.getElementById(select.id)?.closest('.select-control')?.querySelector('.select-trigger')?.focus());});list.append(item);
   });
  };
  const open=(edge)=>{
   document.querySelectorAll('.select-control.open .select-trigger').forEach(button=>{if(button!==trigger)button.click();});
   list.hidden=false;trigger.setAttribute('aria-expanded','true');wrapper.classList.add('open');
   const items=choices();(edge==='last'?items.at(-1):edge==='first'?items[0]:items.find(i=>i.getAttribute('aria-selected')==='true')||items[0])?.focus();
  };
  trigger.addEventListener('click',()=>list.hidden?open():close());
  trigger.addEventListener('keydown',event=>{if(['ArrowDown','ArrowUp','Home','End'].includes(event.key)){event.preventDefault();open(event.key==='End'?'last':event.key==='Home'?'first':undefined);}});
  list.addEventListener('keydown',event=>{
   const items=choices(),index=items.indexOf(document.activeElement);
   if(['ArrowDown','ArrowUp','Home','End'].includes(event.key)){event.preventDefault();const next=event.key==='Home'?0:event.key==='End'?items.length-1:event.key==='ArrowDown'?Math.min(index+1,items.length-1):Math.max(index-1,0);items[next]?.focus();}
   else if(event.key==='Enter'||event.key===' '){event.preventDefault();document.activeElement.click();}
   else if(event.key==='Escape'){event.preventDefault();event.stopPropagation();close(true);}
   else if(event.key==='Tab')close();
   else if(event.key.length===1){const match=items.find(item=>item.textContent.toLocaleLowerCase('da').startsWith(event.key.toLocaleLowerCase('da')));match?.focus();}
  });
  wrapper.addEventListener('focusout',event=>{if(!wrapper.contains(event.relatedTarget))close();});
  // A containing label should activate the visible trigger, not the hidden field.
  label?.addEventListener('click',event=>{if(event.target===label){event.preventDefault();trigger.focus();}});
  select.addEventListener('change',sync);sync();
 });
}
document.addEventListener('click',event=>{document.querySelectorAll('.select-control.open').forEach(wrapper=>{if(!wrapper.contains(event.target))wrapper.querySelector('.select-trigger').click();});});
