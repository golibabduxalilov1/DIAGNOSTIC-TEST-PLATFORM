'use client';
import {useEffect,useRef} from 'react';

function localDigits(value:string){const digits=value.replace(/\D/g,'');return ((value.trim().startsWith('+998')||(digits.length>9&&digits.startsWith('998')))?digits.slice(3):digits).slice(0,9);}
export function formatPhone(value:string){
 const d=localDigits(value);if(!d)return '';
 let text='+998 ('+d.slice(0,2)+')';
 if(d.length>2)text+=' '+d.slice(2,5);
 if(d.length>5)text+=' '+d.slice(5,7);
 if(d.length>7)text+=' '+d.slice(7,9);
 return text;
}
type Props={value:string;onChange:(value:string)=>void;disabled?:boolean;required?:boolean;autoComplete?:string};
export default function PhoneInput({value,onChange,...props}:Props){
 const input=useRef<HTMLInputElement>(null);
 const display=formatPhone(value)||'+998 ()';
 useEffect(()=>{input.current?.setCustomValidity(props.required&&!localDigits(value)?'Telefon raqamini to‘liq kiriting.':'');},[value,props.required]);
 function update(digits:string,count:number){
  const formatted=formatPhone(digits);onChange(formatted);
  requestAnimationFrame(()=>{const positions=[...formatted.matchAll(/\d/g)].slice(3).map(m=>m.index!);const caret=count<positions.length?positions[Math.max(0,count)]:formatted.length;input.current?.setSelectionRange(caret,caret);});
 }
 return <input {...props} ref={input} type="tel" inputMode="tel" placeholder="+998 (__) ___ __ __" value={display} pattern={localDigits(value)||props.required?'\\+998 \\([0-9]{2}\\) [0-9]{3} [0-9]{2} [0-9]{2}':undefined} onFocus={e=>{if(!localDigits(value))e.currentTarget.setSelectionRange(6,6);}} onChange={e=>{
  const raw=e.target.value,caret=e.target.selectionStart??raw.length;
  const digits=localDigits(raw),prefix=raw.replace(/\D/g,'').startsWith('998')?3:0;
  update(digits,Math.max(0,raw.slice(0,caret).replace(/\D/g,'').length-prefix));
 }} onPaste={e=>{
  const raw=e.clipboardData.getData('text');const digits=raw.replace(/\D/g,'');
  if(digits.length===9||(digits.startsWith('998')&&digits.length===12)){e.preventDefault();const local=localDigits(raw);update(local,local.length);}
 }} onKeyDown={e=>{
  if(e.key!=='Backspace'&&e.key!=='Delete')return;
  const start=e.currentTarget.selectionStart??0,end=e.currentTarget.selectionEnd??start;
  const positions=[...display.matchAll(/\d/g)].slice(3).map(m=>m.index!);
  let from:number,to:number;
  if(start!==end){from=positions.filter(p=>p<start).length;to=positions.filter(p=>p<end).length;}
  else if(e.key==='Backspace'){from=positions.filter(p=>p<start).length-1;to=from+1;}
  else{from=positions.filter(p=>p<start).length;to=from+1;}
  e.preventDefault();if(from<0)return;
  const digits=localDigits(display);update(digits.slice(0,from)+digits.slice(to),from);
 }}/>;
}
