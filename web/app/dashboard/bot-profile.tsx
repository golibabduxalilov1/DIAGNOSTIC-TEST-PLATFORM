'use client';
import {useEffect,useRef,useState} from 'react';
import {ask} from './confirm';

type Profile={name:string;description:string;shortDescription:string};
const fields=[['name','Bot nomi',64],['description','Boshlash oynasidagi tavsif',512],['shortDescription','Profil haqida qisqa matn',120]] as const;
async function request(path='',method='GET',body?:unknown){
 const response=await fetch('/api/admin/telegram/profile'+path,{method,...(body instanceof FormData?{body}:{headers:{'Content-Type':'application/json'},...(body===undefined?{}:{body:JSON.stringify(body)})})});
 const data=await response.json().catch(()=>({message:'So‘rov bajarilmadi. Fayl hajmi yoki ulanishni tekshiring.'}));
 if(!response.ok)throw Error(data.message||'So‘rov bajarilmadi.');return data;
}
export default function BotProfile({configured}:{configured:boolean}){
 const [profile,setProfile]=useState<Profile|null>(null),[busy,setBusy]=useState(false),[error,setError]=useState(''),[message,setMessage]=useState(''),[photo,setPhoto]=useState<File|null>(null),[preview,setPreview]=useState('');
 const input=useRef<HTMLInputElement>(null);
 useEffect(()=>{if(!photo){setPreview('');return;}const url=URL.createObjectURL(photo);setPreview(url);return()=>URL.revokeObjectURL(url);},[photo]);
 async function act(action:()=>Promise<unknown>,success:string){setBusy(true);setError('');setMessage('');try{await action();setMessage(success);}catch(e){setError((e as Error).message);}finally{setBusy(false);}}
 function clearPhoto(){setPhoto(null);if(input.current)input.current.value='';}
 return <section className="panel settings"><h2>Bot profili va rasmi</h2><p className="hint">O‘zgarishlar Telegram bot profiliga qo‘llanadi. Har bir matnni alohida saqlang.</p>
 {!configured?<p>Avval botni serverda ulang.</p>:<>
 <button className="add-option" disabled={busy} onClick={()=>act(async()=>setProfile(await request()),'Profil ma’lumotlari olindi.')}>{profile?'Telegram profilini yangilash':'Telegram profilini yuklash'}</button>
 {profile&&fields.map(([field,label,max])=><form key={field} onSubmit={e=>{e.preventDefault();act(()=>request('','PUT',{field,value:profile[field]}),label+' saqlandi.');}}><label>{label}<textarea disabled={busy} rows={field==='description'?4:2} maxLength={max} required={field==='name'} value={profile[field]} onChange={e=>setProfile({...profile,[field]:e.target.value})}/></label><p className="hint">{profile[field].length} / {max}</p><button className="save-button" disabled={busy}>{label}ni saqlash</button></form>)}
 <label>Yangi profil rasmi (JPG, 10 MB gacha)<input ref={input} type="file" accept="image/jpeg" disabled={busy} onChange={e=>{const file=e.target.files?.[0];setError('');if(file&&(file.type!=='image/jpeg'||file.size>10*1024*1024)){setError('JPG rasm tanlang (10 MB gacha).');clearPhoto();return;}setPhoto(file||null);}}/></label>
 {preview&&<div className="broadcast-preview"><img src={preview} alt="Yangi bot profil rasmi"/></div>}
 <div className="bot-actions"><button className="save-button" disabled={busy||!photo} onClick={()=>act(async()=>{const body=new FormData();body.append('photo',photo!);await request('/photo','POST',body);clearPhoto();},'Bot profil rasmi o‘zgartirildi.')}>Rasmni o‘zgartirish</button><button className="bot-reject" disabled={busy} onClick={async()=>{if(await ask('Botning joriy profil rasmi olib tashlansinmi?',{confirmText:'Rasmni olib tashlash',danger:true}))act(()=>request('/photo/remove','POST'),'Bot profil rasmi olib tashlandi.');}}>Joriy rasmni olib tashlash</button></div>
 <p className="hint">Bot username va egaligi @BotFather orqali boshqariladi. Admin huquqlari “Adminlar” bo‘limida belgilanadi.</p>
 </>}{error&&<p className="error" role="alert">{error}</p>}{message&&<p className="success" role="status">{message}</p>}</section>;
}
