'use client';
import {useEffect,useRef,useState} from 'react';
import {usePreferences} from '../preferences';
type Options={title?:string;confirmText?:string;danger?:boolean};
type Request=Options&{message:string;resolve:(ok:boolean)=>void};
let show:((r:Request)=>void)|null=null;
export function ask(message:string,options:Options={}){return new Promise<boolean>(resolve=>show?show({...options,message,resolve}):resolve(false));}
export function ConfirmHost(){
 const [request,setRequest]=useState<Request|null>(null),{t}=usePreferences(),current=useRef<Request|null>(null),cancelRef=useRef<HTMLButtonElement>(null),confirmRef=useRef<HTMLButtonElement>(null),returnFocus=useRef<HTMLElement|null>(null);
 function close(ok:boolean){current.current?.resolve(ok);current.current=null;setRequest(null);returnFocus.current?.focus();}
 useEffect(()=>{show=r=>{current.current?.resolve(false);if(!current.current)returnFocus.current=document.activeElement as HTMLElement|null;current.current=r;setRequest(r);};return()=>{show=null;current.current?.resolve(false);};},[]);
 useEffect(()=>{if(!request)return;cancelRef.current?.focus();const overflow=document.body.style.overflow;document.body.style.overflow='hidden';const key=(e:KeyboardEvent)=>{if(e.key==='Escape'){e.preventDefault();close(false);}else if(e.key==='Tab'){e.preventDefault();(document.activeElement===cancelRef.current?confirmRef.current:cancelRef.current)?.focus();}};document.addEventListener('keydown',key);return()=>{document.removeEventListener('keydown',key);document.body.style.overflow=overflow;};},[request]);
 if(!request)return null;
 return <div className="confirm-backdrop" onMouseDown={e=>{if(e.target===e.currentTarget)close(false);}}><div className={'confirm-dialog'+(request.danger?' danger-dialog':'')} role="alertdialog" aria-modal="true" aria-labelledby="confirm-title" aria-describedby="confirm-message"><span className="confirm-icon" aria-hidden="true">{request.danger?'!':'?'}</span><h2 id="confirm-title">{t(request.title||'Tasdiqlang')}</h2><p id="confirm-message">{t(request.message)}</p><div className="confirm-actions"><button ref={cancelRef} className="secondary-button" onClick={()=>close(false)}>{t('Bekor qilish')}</button><button ref={confirmRef} className={request.danger?'confirm-danger':'confirm-primary'} onClick={()=>close(true)}>{t(request.confirmText||'Tasdiqlash')}</button></div></div></div>;
}
