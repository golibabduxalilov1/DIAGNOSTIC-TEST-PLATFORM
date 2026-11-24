'use client';
import {useEffect,useRef,useState} from 'react';
import {escapeTelegramText,telegramHtmlError} from '../../../api/src/telegram-format';

function serialize(node:Node):string {
 if(node.nodeType===Node.TEXT_NODE)return escapeTelegramText(node.textContent||'');
 if(!(node instanceof HTMLElement))return '';
 const inner=Array.from(node.childNodes).map(serialize).join('');
 const tag=node.tagName.toLowerCase();
 if(tag==='br')return '\n';
 if(tag==='div'||tag==='p')return inner+'\n';
 if(node.dataset.spoiler)return `<tg-spoiler>${inner}</tg-spoiler>`;
 if(node.dataset.time)return `<tg-time unix="${node.dataset.time}">${inner}</tg-time>`;
 if(tag==='a')return `<a href="${escapeTelegramText(node.getAttribute('href')||'')}">${inner}</a>`;
 const mapped=({strong:'b',em:'i',strike:'s',del:'s',font:'',span:''} as Record<string,string>)[tag]??tag;
 return ['b','i','u','s','blockquote','code','pre'].includes(mapped)?`<${mapped}>${inner}</${mapped}>`:inner;
}
function editorHtml(value:string){
 return value.replace(/\n/g,'<br>').replace(/<tg-spoiler>/g,'<span data-spoiler="true">').replace(/<\/tg-spoiler>/g,'</span>')
 .replace(/<tg-time unix="(\d+)">/g,'<span data-time="$1">').replace(/<\/tg-time>/g,'</span>');
}
export default function TelegramEditor({label,value,onChange,limit=3800,disabled=false}:{label:string;value:string;onChange:(value:string)=>void;limit?:number;disabled?:boolean}){
 const editor=useRef<HTMLDivElement>(null),range=useRef<Range|null>(null);
 const [dialog,Dialog]=useState<'link'|'date'|null>(null),[input,Input]=useState(''),[localError,SetError]=useState('');
 const error=value?telegramHtmlError(value,limit):null;
 useEffect(()=>{if(editor.current&&document.activeElement!==editor.current){editor.current.innerHTML=telegramHtmlError(value,limit)?escapeTelegramText(value):editorHtml(value);}},[value,limit]);
 function remember(){const selection=window.getSelection();if(selection?.rangeCount&&editor.current?.contains(selection.anchorNode))range.current=selection.getRangeAt(0).cloneRange();}
 function restore(){editor.current?.focus();if(range.current){const selection=window.getSelection();selection?.removeAllRanges();selection?.addRange(range.current);}}
 function changed(){if(editor.current)onChange(Array.from(editor.current.childNodes).map(serialize).join(''));remember();}
 function insert(html:string){restore();document.execCommand('insertHTML',false,html);changed();}
 function format(tag:string){
  restore();const selection=window.getSelection();const text=selection?.toString();
  if(!text){SetError('Avval matnni belgilang.');return;}SetError('');
  if(tag==='plain'){document.execCommand('removeFormat');changed();return;}
  const fragment=selection!.getRangeAt(0).cloneContents();
  const html=Array.from(fragment.childNodes).map(serialize).join('');
  const content=tag==='code'?escapeTelegramText(text):html;
  const open=tag.startsWith('span ')?'<tg-spoiler>':`<${tag}>`;
  const close=tag.startsWith('span ')?'</tg-spoiler>':`</${tag}>`;
  const candidate=open+content+close;
  const error=telegramHtmlError(candidate,limit);if(error){SetError(error);return;}
  insert(editorHtml(candidate));
 }
 function apply(){
  if(dialog==='link'){
   try{const url=new URL(input);if(!['https:','http:'].includes(url.protocol)||url.username||url.password)throw new Error();}catch{SetError('To‘g‘ri http:// yoki https:// havola kiriting.');return;}
   restore();const text=window.getSelection()?.toString()||input;insert(`<a href="${escapeTelegramText(input)}">${escapeTelegramText(text)}</a>`);
  }else{
   // The dashboard uses the project's Asia/Tashkent timezone for entered dates.
   const unix=Math.floor(Date.parse(input+':00+05:00')/1000);if(!Number.isFinite(unix)){SetError('Sana va vaqtni kiriting.');return;}
   insert(`<span data-time="${unix}">${escapeTelegramText(input.replace('T',' '))}</span>`);
  }
  Dialog(null);Input('');SetError('');
 }
 return <div className="telegram-editor"><span className="field-label">{label}</span><div className="format-toolbar" role="toolbar" aria-label={`${label}: formatlar`}>
 {([['b','Qalin','Ctrl+B'],['i','Kursiv','Ctrl+I'],['u','Tagiga chizish','Ctrl+U'],['s','Ustidan chizish','Ctrl+Shift+X'],['blockquote','Iqtibos','Ctrl+Shift+.'],['code','Monospace','Ctrl+Shift+M'],['span data-spoiler="true"','Spoiler','Ctrl+Shift+P'],['plain','Formatni tozalash','']] as const).map(([tag,title,key])=><button key={tag} type="button" disabled={disabled} title={`${title} ${key}`} onMouseDown={e=>e.preventDefault()} onClick={()=>format(tag)}>{title}</button>)}
 <button type="button" disabled={disabled} onMouseDown={e=>e.preventDefault()} onClick={()=>{remember();Dialog('link');Input('');SetError('');}}>Havola</button><button type="button" disabled={disabled} onMouseDown={e=>e.preventDefault()} onClick={()=>{remember();Dialog('date');Input('');SetError('');}}>Sana</button></div>
 {dialog&&<div className="format-dialog"><label>{dialog==='link'?'Havola manzili':'Sana va vaqt (Toshkent)'}<input type={dialog==='link'?'url':'datetime-local'} value={input} onChange={e=>Input(e.target.value)}/></label><button type="button" onClick={apply}>Qo‘shish</button><button type="button" onClick={()=>Dialog(null)}>Bekor qilish</button></div>}
 <div ref={editor} className="telegram-editable" role="textbox" aria-label={label} aria-multiline="true" aria-invalid={!!error} contentEditable={!disabled} suppressContentEditableWarning onInput={changed} onMouseUp={remember} onKeyUp={remember} onPaste={e=>{e.preventDefault();insert(escapeTelegramText(e.clipboardData.getData('text/plain')).replace(/\n/g,'<br>'));}} onKeyDown={e=>{if(!(e.ctrlKey||e.metaKey))return;const key=e.key.toLowerCase();if(key==='k'&&!e.shiftKey){e.preventDefault();remember();Dialog('link');Input('');return;}if(key==='d'&&e.shiftKey){e.preventDefault();remember();Dialog('date');Input('');return;}const tag=e.shiftKey?({x:'s',m:'code',p:'span data-spoiler="true"','.':'blockquote'} as Record<string,string>)[key]:({b:'b',i:'i',u:'u'} as Record<string,string>)[key];if(tag){e.preventDefault();format(tag);}}}/>
 <p className="hint">Matnni belgilang va formatni tanlang. {value.length}/{limit}</p>{(localError||error)&&<p className="error" role="alert">{localError||error}</p>}
 </div>;
}
