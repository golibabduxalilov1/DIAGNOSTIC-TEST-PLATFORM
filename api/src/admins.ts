import {DatabaseSync} from 'node:sqlite';
import {randomBytes,createHash,scryptSync,timingSafeEqual} from 'node:crypto';
import {HttpException} from '@nestjs/common';
import {normalizePhone} from './phone';
import type {Config} from './domain';

export const PERMISSIONS=['site.questions','site.settings','site.results','bot.users','bot.orders','bot.broadcasts','bot.settings','bot.connection','admins.manage'] as const;
export type Permission=typeof PERMISSIONS[number];
export type Admin={id:string;name:string;phone:string|null;telegramId:number|null;permissions:Permission[];active:boolean;owner:boolean;webAccess:boolean};
type Row={id:string;name:string;phone:string|null;telegram_id:number|null;permissions:string;active:number;owner:number;password:string|null};
export const denied=()=>{throw new HttpException({message:'Bu bo‘lim uchun sizga ruxsat berilmagan.'},403);};
export function requirePermission(admin:Admin,...permissions:Permission[]){if(!permissions.some(p=>admin.permissions.includes(p)))denied();return admin;}
export function requireConfigChange(admin:Admin,old:Config,next:Config){
 const questions=(c:Config)=>JSON.stringify({questions:c.questions,ru:c.locales?.ru?.questions,en:c.locales?.en?.questions});
 const metadata=(c:Config)=>{const {questions,version,locales,...rest}=c;return JSON.stringify({...rest,locales:Object.fromEntries((['ru','en'] as const).map(lang=>[lang,Object.fromEntries((['title','description','finishTitle','finishDescription'] as const).map(key=>[key,locales?.[lang]?.[key]||'']))]))});};
 if(questions(old)!==questions(next))requirePermission(admin,'site.questions');
 if(metadata(old)!==metadata(next))requirePermission(admin,'site.settings');
}
export class AdminService {
 constructor(private db:DatabaseSync,phone:string,password:string){
  db.exec(`CREATE TABLE IF NOT EXISTS admins(id TEXT PRIMARY KEY,name TEXT NOT NULL,phone TEXT UNIQUE,telegram_id INTEGER UNIQUE,password TEXT,permissions TEXT NOT NULL,active INTEGER NOT NULL DEFAULT 1,owner INTEGER NOT NULL DEFAULT 0);
   CREATE TABLE IF NOT EXISTS admin_sessions(token TEXT PRIMARY KEY,admin_id TEXT NOT NULL,expires INTEGER NOT NULL);
   CREATE INDEX IF NOT EXISTS admin_sessions_expires ON admin_sessions(expires);`);
  const existing=db.prepare("SELECT * FROM admins WHERE id='owner'").get() as Row|undefined;
  if(!existing||existing.phone!==normalizePhone(phone)||!this.check(password,existing.password)){
   db.prepare(`INSERT INTO admins(id,name,phone,password,permissions,owner) VALUES('owner',?,?,?,?,1) ON CONFLICT(id) DO UPDATE SET phone=excluded.phone,password=excluded.password,permissions=excluded.permissions,active=1`).run('Asosiy admin',normalizePhone(phone),this.hash(password),JSON.stringify(PERMISSIONS));
   if(existing)db.prepare("DELETE FROM admin_sessions WHERE admin_id='owner'").run();
  }
 }
 private hash(password:string){const salt=randomBytes(16).toString('hex');return salt+':'+scryptSync(password,salt,64).toString('hex');}
 private check(password:unknown,stored:string|null){if(typeof password!=='string'||password.length>500)return false;const [salt,hash]=(stored||'').split(':');const actual=scryptSync(password,salt||'unavailable-admin',64);return !!hash&&hash.length===128&&timingSafeEqual(actual,Buffer.from(hash,'hex'));}
 private view(row:Row):Admin{return {id:row.id,name:row.name,phone:row.phone?'+'+row.phone:null,telegramId:row.telegram_id,permissions:row.owner?[...PERMISSIONS]:JSON.parse(row.permissions),active:!!row.active,owner:!!row.owner,webAccess:!!row.phone&&!!row.password};}
 list(){return (this.db.prepare('SELECT * FROM admins ORDER BY owner DESC,name').all() as Row[]).map(r=>this.view(r));}
 login(phone:unknown,password:unknown){const normalized=normalizePhone(phone),row=this.db.prepare('SELECT * FROM admins WHERE phone=?').get(normalized||'') as Row|undefined;const valid=this.check(password,row?.password||null);if(!row||!row.active||!valid)throw new HttpException({message:'Telefon raqam yoki parol noto‘g‘ri.'},401);const token=randomBytes(32).toString('hex');this.db.prepare('DELETE FROM admin_sessions WHERE expires<?').run(Date.now());this.db.prepare('INSERT INTO admin_sessions VALUES(?,?,?)').run(this.digest(token),row.id,Date.now()+8*3600000);return {token,admin:this.view(row)};}
 private digest(token:string){return createHash('sha256').update(token).digest('hex');}
 authenticate(token:string){const row=this.db.prepare('SELECT a.* FROM admins a JOIN admin_sessions s ON s.admin_id=a.id WHERE s.token=? AND s.expires>? AND a.active=1 AND a.phone IS NOT NULL AND a.password IS NOT NULL').get(this.digest(token),Date.now()) as Row|undefined;if(!row)throw new HttpException({message:'Avval tizimga kiring.'},401);return this.view(row);}
 logout(token:string){this.db.prepare('DELETE FROM admin_sessions WHERE token=?').run(this.digest(token));}
 save(actor:Admin,input:any,id?:string){
  requirePermission(actor,'admins.manage');
  const old=id?this.db.prepare('SELECT * FROM admins WHERE id=?').get(id) as Row|undefined:undefined;
  if(id&&!old)throw Error('Admin topilmadi.');
  if(!input||typeof input.name!=='string'||!input.name.trim()||input.name.length>100||!Array.isArray(input.permissions)||input.permissions.some((p:unknown)=>!PERMISSIONS.includes(p as Permission))||typeof input.active!=='boolean')throw Error('Admin ismi va ruxsatlarini tekshiring.');
  if(old?.owner&&(!input.active||!PERMISSIONS.every(p=>input.permissions.includes(p))))throw Error('Asosiy adminning to‘liq huquqlarini cheklab bo‘lmaydi.');
  const phone=input.phone?normalizePhone(input.phone):null;
  if(input.phone&&!phone)throw Error('Telefon raqam noto‘g‘ri.');
  const telegramId=input.telegramId===''||input.telegramId==null?null:Number(input.telegramId);
  if(telegramId!==null&&(!Number.isSafeInteger(telegramId)||telegramId<=0))throw Error('Telegram ID noto‘g‘ri.');
  if(!phone&&!telegramId)throw Error('Telefon yoki Telegram ID kiriting.');
  if(old?.owner&&phone!==old.phone)throw Error('Asosiy admin telefoni serverdagi ADMIN_PHONE orqali belgilanadi.');
  if(input.password!==undefined&&typeof input.password!=='string')throw Error('Parol noto‘g‘ri.');
  if(input.password&&(input.password.length<12||input.password.length>200))throw Error('Parol 12–200 belgi bo‘lsin.');
  if(old?.owner&&input.password)throw Error('Asosiy admin paroli server sozlamasidan boshqariladi.');
  const password=input.password?this.hash(input.password):old?.password||null;
  if(phone&&!password)throw Error('Saytga kirish uchun kamida 12 belgili parol kiriting.');
  if(old?.id===actor.id&&!input.active)throw Error('O‘z hisobingizni bloklay olmaysiz.');
  const accountId=id||randomBytes(12).toString('hex');
  try{this.db.prepare(`INSERT INTO admins(id,name,phone,telegram_id,password,permissions,active) VALUES(?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET name=excluded.name,phone=excluded.phone,telegram_id=excluded.telegram_id,password=excluded.password,permissions=excluded.permissions,active=excluded.active`).run(accountId,input.name.trim(),phone,telegramId,password,JSON.stringify([...new Set(input.permissions)]),Number(input.active));}catch(e){if((e as Error).message.includes('UNIQUE'))throw Error('Bu telefon yoki Telegram ID boshqa adminga biriktirilgan.');throw e;}
  if(!input.active||input.password||(old&&old.phone!==phone))this.db.prepare('DELETE FROM admin_sessions WHERE admin_id=?').run(accountId);
  return this.list().find(a=>a.id===accountId)!;
 }
 telegramPermissions(id:number):Permission[]{const row=this.db.prepare('SELECT * FROM admins WHERE telegram_id=? AND active=1').get(id) as Row|undefined;return row?this.view(row).permissions:[];}
 telegramIds(){return this.list().filter(a=>a.active&&a.telegramId&&a.permissions.some(p=>p.startsWith('bot.')||p==='admins.manage')).map(a=>a.telegramId!);}
 migrateTelegram(ids:number[]){
  // A dedicated marker avoids regranting removed legacy IDs on subsequent starts.
  this.db.exec('CREATE TABLE IF NOT EXISTS admin_meta(key TEXT PRIMARY KEY,value TEXT)');
  if(this.db.prepare("SELECT value FROM admin_meta WHERE key='telegram_migrated'").get())return;
  for(const id of ids)if(Number.isSafeInteger(id)&&id>0)this.db.prepare('INSERT OR IGNORE INTO admins(id,name,telegram_id,permissions) VALUES(?,?,?,?)').run(randomBytes(12).toString('hex'),'Telegram admin '+id,id,JSON.stringify(PERMISSIONS.filter(p=>p.startsWith('bot.')||p==='admins.manage')));
  this.db.prepare("INSERT INTO admin_meta VALUES('telegram_migrated','1')").run();
 }
 changeTelegramAdmin(actorId:number,target:number,remove:boolean){
  if(!this.telegramPermissions(actorId).includes('admins.manage'))denied();
  const actor=this.list().find(a=>a.telegramId===actorId)!;
  const old=this.list().find(a=>a.telegramId===target);
  if(remove){if(!old)throw Error('Admin topilmadi.');if(old.owner)throw Error('Asosiy adminni olib tashlab bo‘lmaydi.');if(target===actorId)throw Error('O‘z admin huquqingizni olib tashlay olmaysiz.');this.db.prepare('UPDATE admins SET telegram_id=NULL,active=CASE WHEN phone IS NULL THEN 0 ELSE active END WHERE id=?').run(old.id);return;}
  if(old)throw Error('Bu foydalanuvchi allaqachon admin.');
  this.save(actor,{name:'Telegram admin '+target,telegramId:target,permissions:['bot.users','bot.orders'],active:true});
 }
}
