import {DatabaseSync} from 'node:sqlite';
import {randomBytes} from 'node:crypto';
import {normalizePhone} from './phone';
import {parseAdminIds,encryptBotToken,decryptBotToken,validSiteUrl} from './bot-credentials';
import type {Permission} from './admins';
type AccessBridge={permissions:(id:number)=>Permission[];ids:()=>number[];change:(actor:number,target:number,remove:boolean)=>void};

export type BotSettings={pdfPrice:number;physicalPrice:number;paymentDetails:string;deliveryInfo:string;support:string;pdfFileId:string};
const defaults:BotSettings={pdfPrice:0,physicalPrice:0,paymentDetails:'',deliveryInfo:'',support:'',pdfFileId:''};
type User={id:number;name:string;phone:string|null;state:string;pending_result:string|null;active:number};
type Order={id:string;user_id:number;kind:string;amount:number;status:string;address:string;receipt_file:string|null;receipt_kind:string|null;tracking:string};
type Job={id:number;chat_id:number;method:string;payload:string;attempts:number;broadcast_id:string|null;order_id:string|null};
type Transport=(method:string,payload:Record<string,unknown>)=>Promise<any>;
class TelegramError extends Error {constructor(public code:number,public retryAfter:number,message:string){super(message);}}

export class TelegramService {
 private running=false;
 private lastError='';
 private username='';
 private controller:AbortController|null=null;
 private tasks:Promise<void>[]=[];
 private configuring=false;
 private pendingTask:Promise<void>|null=null;
 botUsername(){return this.username;}
 private transport:Transport;
 constructor(private db:DatabaseSync,private token:string,private adminIds:number[],private siteUrl:string,private injectedTransport?:Transport,private storageSecret='',private access?:AccessBridge){
  this.transport=injectedTransport||this.request.bind(this);
  db.exec(`CREATE TABLE IF NOT EXISTS tg_meta(key TEXT PRIMARY KEY,value TEXT NOT NULL);
   CREATE TABLE IF NOT EXISTS tg_users(id INTEGER PRIMARY KEY,name TEXT NOT NULL,username TEXT NOT NULL DEFAULT '',phone TEXT,state TEXT NOT NULL DEFAULT '',pending_result TEXT,active INTEGER NOT NULL DEFAULT 1,created TEXT NOT NULL);
   CREATE TABLE IF NOT EXISTS tg_claims(result_id TEXT PRIMARY KEY,user_id INTEGER NOT NULL);
   CREATE TABLE IF NOT EXISTS tg_orders(id TEXT PRIMARY KEY,user_id INTEGER NOT NULL,kind TEXT NOT NULL,amount INTEGER NOT NULL,status TEXT NOT NULL,address TEXT NOT NULL DEFAULT '',receipt_file TEXT,receipt_kind TEXT,tracking TEXT NOT NULL DEFAULT '',created TEXT NOT NULL,reviewed TEXT);
   CREATE TABLE IF NOT EXISTS tg_broadcasts(id TEXT PRIMARY KEY,text TEXT NOT NULL,source_chat INTEGER,source_message INTEGER,kind TEXT NOT NULL,status TEXT NOT NULL DEFAULT 'draft',created TEXT NOT NULL);
   CREATE TABLE IF NOT EXISTS tg_outbox(id INTEGER PRIMARY KEY AUTOINCREMENT,chat_id INTEGER NOT NULL,method TEXT NOT NULL,payload TEXT NOT NULL,status TEXT NOT NULL DEFAULT 'pending',attempts INTEGER NOT NULL DEFAULT 0,next_at INTEGER NOT NULL DEFAULT 0,error TEXT NOT NULL DEFAULT '',broadcast_id TEXT,order_id TEXT);
   CREATE INDEX IF NOT EXISTS tg_outbox_pending ON tg_outbox(status,next_at);
   CREATE INDEX IF NOT EXISTS tg_orders_user ON tg_orders(user_id,created);
   CREATE INDEX IF NOT EXISTS tg_claims_user ON tg_claims(user_id);`);
  const storedToken=this.meta('bot_token');
  if(storedToken){try{this.token=decryptBotToken(storedToken,storageSecret);}catch{this.token='';this.lastError='Saqlangan tokenni ochib bo‘lmadi. Paneldan tokenni qayta kiriting.';}}
  if(this.meta('admin_ids')!==undefined)this.adminIds=parseAdminIds(JSON.parse(this.meta('admin_ids')));
  this.siteUrl=this.meta('site_url')||siteUrl;
  this.username=this.meta('bot_username')||'';
 }
 private meta(key:string){return (this.db.prepare('SELECT value FROM tg_meta WHERE key=?').get(key) as any)?.value;}
 private setMeta(key:string,value:string){this.db.prepare('INSERT INTO tg_meta VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').run(key,value);}
 private ids(){return this.access?this.access.ids():this.adminIds;}
 private can(id:number,permission:Permission){return this.access?this.access.permissions(id).includes(permission):this.adminIds.includes(id);}
 private isAdmin(id:number){return this.access?this.access.permissions(id).some(p=>p.startsWith('bot.')||p==='admins.manage'):this.adminIds.includes(id);}
 connection(){return {adminIds:[...this.ids()],siteUrl:this.siteUrl,tokenConfigured:!!this.token};}
 async saveConnection(input:any,startRuntime=true,actor?:number){
  if(this.configuring)throw Error('Bot sozlamalari saqlanmoqda. Biroz kuting.');
  let admins=parseAdminIds(input?.adminIds);const siteUrl=validSiteUrl(input?.siteUrl);
  if(!admins.length&&this.ids().length)throw Error('Oxirgi Telegram adminni olib tashlab bo‘lmaydi. Kamida bitta ID qoldiring.');
  if(typeof input?.token!=='string'||input.token.length>200)throw Error('Bot tokeni noto‘g‘ri.');
  const candidate=input.token.trim();
  if(candidate&&!/^\d{5,20}:[A-Za-z0-9_-]{20,150}$/.test(candidate))throw Error('BotFather bergan to‘liq tokenni kiriting.');
  if(!candidate&&!this.token)throw Error('Bot tokenini kiriting.');
  this.configuring=true;
  try{
   let username=this.username,botId=this.meta('bot_id');
   if(candidate){
    let me;try{me=await this.requestWithToken(candidate,'getMe',{});}catch{throw Error('Token tekshirilmadi. BotFather tokeni va internetni tekshiring.');}
    if(!me?.is_bot||!Number.isSafeInteger(me.id)||!me.username)throw Error('Token Telegram botiga tegishli emas.');
    const oldId=botId||this.token.split(':')[0];
    if(oldId&&oldId!==String(me.id)&&((this.db.prepare('SELECT COUNT(*) n FROM tg_users').get() as any).n>0||this.settings().pdfFileId))throw Error('Mavjud foydalanuvchilar uchun shu botning yangi tokenini kiriting. Boshqa botni alohida loyiha sifatida ulang.');
    username=me.username;botId=String(me.id);
   }
   if(actor!==undefined){if(!this.can(actor,'bot.connection'))throw Error('Admin huquqi olib tashlangan.');admins=[...this.ids()];}
   const encrypted=candidate?encryptBotToken(candidate,this.storageSecret):null;
   if(candidate)await this.stop();
   this.atomic(()=>{
    if(encrypted)this.setMeta('bot_token',encrypted);
    if(botId)this.setMeta('bot_id',botId);
    this.setMeta('bot_username',username);this.setMeta('admin_ids',JSON.stringify(admins));this.setMeta('site_url',siteUrl);
   });
   if(candidate)this.token=candidate;
   this.adminIds=admins;this.siteUrl=siteUrl;this.username=username;this.lastError='';
   if(startRuntime)this.start();
   return this.connection();
  }finally{this.configuring=false;}
 }
 private changeAdmin(actor:number,target:unknown,remove:boolean){
  if(this.access){const [id]=parseAdminIds([target]);this.access.change(actor,id,remove);return id;}
  if(!this.adminIds.includes(actor))throw Error('Bu amal faqat mavjud adminlar uchun.');
  const [id]=parseAdminIds([target]);
  const updated=remove?this.adminIds.filter(n=>n!==id):parseAdminIds([...this.adminIds,id]);
  if(!updated.length)throw Error('Oxirgi adminni olib tashlab bo‘lmaydi.');
  this.setMeta('admin_ids',JSON.stringify(updated));this.adminIds=updated;
  return id;
 }
 settings():BotSettings{return {...defaults,...JSON.parse(this.meta('settings')||'{}')};}
 saveSettings(input:any){
  if(!input||!['pdfPrice','physicalPrice'].every(k=>Number.isSafeInteger(input[k])&&input[k]>=0&&input[k]<=1e9)||!['paymentDetails','deliveryInfo','support'].every(k=>typeof input[k]==='string'&&input[k].length<=1500))throw Error('Narxlar va bot sozlamalarini tekshiring.');
  const settings={...this.settings(),pdfPrice:input.pdfPrice,physicalPrice:input.physicalPrice,paymentDetails:input.paymentDetails.trim(),deliveryInfo:input.deliveryInfo.trim(),support:input.support.trim()};
  this.setMeta('settings',JSON.stringify(settings));return settings;
 }
 private atomic<T>(fn:()=>T):T{this.db.exec('BEGIN IMMEDIATE');try{const result=fn();this.db.exec('COMMIT');return result;}catch(e){this.db.exec('ROLLBACK');throw e;}}
 private queue(chatId:number,method:string,payload:Record<string,unknown>,broadcastId:string|null=null,orderId:string|null=null){this.db.prepare('INSERT INTO tg_outbox(chat_id,method,payload,broadcast_id,order_id) VALUES(?,?,?,?,?)').run(chatId,method,JSON.stringify({...payload,chat_id:chatId}),broadcastId,orderId);}
 private say(id:number,text:string,reply_markup?:unknown){this.queue(id,'sendMessage',{text,...(reply_markup?{reply_markup}:{})});}
 private menu(id:number,text='Bo‘limni tanlang:'){
  this.say(id,text,{keyboard:[[{text:'📊 Natijam'},{text:'📝 Test topshirish'}],[{text:'📄 PDF kundalik'},{text:'📔 Bosma kundalik'}],[{text:'📦 Buyurtmalarim'},{text:'💬 Yordam'}],...(this.isAdmin(id)?[[{text:'⚙️ Admin boshqaruvi'}]]:[])],resize_keyboard:true});
 }
 private requirePhone(id:number){this.say(id,'Davom etish uchun pastdagi tugma orqali o‘zingizning telefon raqamingizni ulashing. Raqamingiz, test balingiz va buyurtmalaringiz administratorga ko‘rinadi.',{keyboard:[[{text:'📱 Telefon raqamni ulashish',request_contact:true}]],resize_keyboard:true,one_time_keyboard:true});}
 private state(id:number,value:string){this.db.prepare('UPDATE tg_users SET state=? WHERE id=?').run(value,id);}
 private claim(user:User){
  if(!user.pending_result)return;
  const id=user.pending_result;
  const result=this.db.prepare('SELECT * FROM results WHERE id=?').get(id) as any;
  const owner=this.db.prepare('SELECT user_id FROM tg_claims WHERE result_id=?').get(id) as any;
  if(!result||(owner&&owner.user_id!==user.id))this.say(user.id,'Natija topilmadi yoki boshqa foydalanuvchiga biriktirilgan. Testni qayta topshiring.');
  else {this.db.prepare('INSERT OR IGNORE INTO tg_claims VALUES(?,?)').run(id,user.id);this.say(user.id,`Test natijangiz: ${result.score} ball.\nYo‘nalish: ${result.category}`);}
  this.db.prepare('UPDATE tg_users SET pending_result=NULL WHERE id=?').run(user.id);
 }
 handleUpdate(update:any){
  if(!Number.isSafeInteger(update?.update_id))return;
  this.atomic(()=>{
   if(update.update_id<=Number(this.meta('offset')||0)-1)return;
   const m=update.message;
   if(m?.chat?.type==='private'&&m.from&&!m.from.is_bot&&Number.isSafeInteger(m.from.id))this.message(m);
   this.setMeta('offset',String(update.update_id+1));
  });
 }
 private message(m:any){
  const id=m.from.id;const text=typeof m.text==='string'?m.text.trim():'';
  this.db.prepare(`INSERT INTO tg_users(id,name,username,created) VALUES(?,?,?,?) ON CONFLICT(id) DO UPDATE SET name=excluded.name,username=excluded.username,active=1`).run(id,[m.from.first_name,m.from.last_name].filter(Boolean).join(' '),m.from.username||'',new Date().toISOString());
  const user=this.db.prepare('SELECT * FROM tg_users WHERE id=?').get(id) as unknown as User;
  if(text==='/id'){this.say(id,`Telegram ID: ${id}`);return;}
  if(text.startsWith('/start')){
   const payload=text.split(/\s+/)[1]||'';
   this.state(id,'');
   if(/^r_[a-f0-9]{24}$/.test(payload)){user.pending_result=payload.slice(2);this.db.prepare('UPDATE tg_users SET pending_result=? WHERE id=?').run(user.pending_result,id);}
   if(!user.phone){this.requirePhone(id);return;}
   this.claim(user);this.menu(id,'Xush kelibsiz! Bo‘limni tanlang:');return;
  }
  if(m.contact){
   const phone=normalizePhone(m.contact.phone_number);
   if(m.contact.user_id!==id||!phone){this.say(id,'Faqat o‘zingizning raqamingizni tugma orqali ulashing.');this.requirePhone(id);return;}
   this.db.prepare('UPDATE tg_users SET phone=? WHERE id=?').run('+'+phone,id);this.claim(user);this.menu(id,'Telefon raqamingiz saqlandi.');return;
  }
  if(!user.phone){this.requirePhone(id);return;}
  if(text==='/cancel'||text==='🏠 Menyu'){
   if(text==='/cancel'&&(user.state.startsWith('address:')||user.state.startsWith('receipt:')))this.db.prepare("UPDATE tg_orders SET status='cancelled' WHERE user_id=? AND id=? AND status IN ('address','awaiting_receipt')").run(id,user.state.split(':')[1]);
   this.state(id,'');this.menu(id,text==='/cancel'?'Jarayon bekor qilindi. Bo‘limni tanlang:':undefined);return;
  }
  if(this.isAdmin(id)){
   if(text==='/admin'||text==='/admins'||text==='⚙️ Admin boshqaruvi'){
    this.state(id,'');const commands=['/id — o‘z IDingiz','/cancel — bekor qilish'];
    if(this.can(id,'admins.manage'))commands.unshift(`Telegram adminlar: ${this.ids().join(', ')}`,'/admin_add ID — cheklangan operator qo‘shish','/admin_remove ID — Telegram kirishini olib tashlash');
    if(this.can(id,'bot.connection'))commands.push('/token — bot tokenini almashtirish');
    if(this.can(id,'bot.settings'))commands.push('/pdf — PDF yuklash');
    if(this.can(id,'bot.broadcasts'))commands.push('/broadcast — xabar qoralamasi');
    if(this.can(id,'bot.users'))commands.push('/users — oxirgi mijozlar va ballar');
    if(this.can(id,'bot.orders'))commands.push('/orders — buyurtmalar va cheklar');
    this.say(id,commands.join('\n'));return;
   }
   if(text==='/users'){
    if(!this.can(id,'bot.users')){this.say(id,'Bu bo‘lim uchun ruxsat yo‘q.');return;}
    const users=this.db.prepare('SELECT u.name,u.phone,(SELECT r.score FROM results r JOIN tg_claims c ON c.result_id=r.id WHERE c.user_id=u.id ORDER BY r.created DESC LIMIT 1) score FROM tg_users u ORDER BY u.created DESC LIMIT 10').all() as any[];
    this.say(id,users.length?users.map(u=>`${u.name.slice(0,60)} · ${u.phone||'Telefon ulashmagan'} · ${u.score??'—'} ball`).join('\n'):'Hozircha mijozlar yo‘q.');return;
   }
   if(text==='/orders'){
    if(!this.can(id,'bot.orders')){this.say(id,'Bu bo‘lim uchun ruxsat yo‘q.');return;}
    const orders=this.db.prepare("SELECT o.*,u.name,u.phone FROM tg_orders o JOIN tg_users u ON u.id=o.user_id ORDER BY CASE WHEN o.status='pending' THEN 0 ELSE 1 END,o.created DESC LIMIT 10").all() as any[];
    this.say(id,orders.length?orders.map(o=>`#${o.id} · ${o.kind==='pdf'?'PDF':'Bosma'} · ${o.amount} so‘m\n${o.name.slice(0,60)} · ${o.phone||'—'} · ${o.status}`).join('\n\n'):'Hozircha buyurtmalar yo‘q.');return;
   }
   if(/^\/admin_(add|remove)(?:\s|$)/.test(text)){
    const [command,target,...extra]=text.split(/\s+/);
    try{if(extra.length||!target)throw Error('Masalan: /admin_add 123456789 yoki /admin_remove 123456789');const changed=this.changeAdmin(id,target,command==='/admin_remove');this.say(id,`${changed} ${command==='/admin_remove'?'adminlikdan olindi':'admin sifatida qo‘shildi'}.`);}catch(e){this.say(id,(e as Error).message);}return;
   }
   if(text==='/token'){if(!this.can(id,'bot.connection')){this.say(id,'Bu bo‘lim uchun ruxsat yo‘q.');return;}this.state(id,'admin:token');this.say(id,'BotFather bergan shu botning yangi tokenini keyingi xabarda yuboring. Token tekshiriladi va shifrlanib saqlanadi. Token yozilgan xabar avtomatik o‘chiriladi. Bekor qilish: /cancel');return;}
   if(user.state==='admin:token'){if(!this.can(id,'bot.connection')){this.state(id,'');this.say(id,'Bu bo‘lim uchun ruxsat yo‘q.');return;}
    this.queue(id,'deleteMessage',{message_id:m.message_id});
    if(!/^\d{5,20}:[A-Za-z0-9_-]{20,150}$/.test(text)){this.say(id,'Token formati noto‘g‘ri. To‘liq BotFather tokenini yuboring yoki /cancel bosing.');return;}
    if(this.meta('pending_connection')||this.configuring){this.say(id,'Avvalgi token tekshirilmoqda. Biroz kuting.');return;}
    try{this.setMeta('pending_connection',JSON.stringify({actor:id,encrypted:encryptBotToken(text,this.storageSecret)}));this.state(id,'');this.say(id,'Token tekshiruvga olindi. Natijasi haqida xabar beramiz.');}catch{this.say(id,'Tokenni saqlab bo‘lmadi. Sayt admin panelidan kiriting.');}return;
   }
   if(text==='/pdf'){if(!this.can(id,'bot.settings')){this.say(id,'Bu bo‘lim uchun ruxsat yo‘q.');return;}this.state(id,'admin:pdf');this.say(id,'Kundalik PDF faylini document sifatida yuboring. Bekor qilish: /cancel');return;}
   if(text==='/broadcast'){if(!this.can(id,'bot.broadcasts')){this.say(id,'Bu bo‘lim uchun ruxsat yo‘q.');return;}this.state(id,'admin:broadcast');this.say(id,'Tarqatish uchun bitta matn, post, rasm yoki video yuboring. Admin panelda ko‘rib tasdiqlaganingizdan keyin hammaga yuboriladi. Bekor qilish: /cancel');return;}
   if(user.state==='admin:pdf'){if(!this.can(id,'bot.settings')){this.state(id,'');return;}
    if(!m.document||m.document.mime_type!=='application/pdf'){this.say(id,'PDF fayl yuboring yoki /cancel bosing.');return;}
    this.setMeta('settings',JSON.stringify({...this.settings(),pdfFileId:m.document.file_id}));this.state(id,'');this.menu(id,'PDF kundalik saqlandi. Tasdiqlangan yangi PDF buyurtmalariga shu fayl yuboriladi.');return;
   }
   if(user.state==='admin:broadcast'){if(!this.can(id,'bot.broadcasts')){this.state(id,'');return;}
    if(!(m.text||m.video||m.photo||m.document)||m.has_protected_content){this.say(id,'Oddiy matn, rasm yoki video yuboring. Himoyalangan postni ko‘chirib bo‘lmaydi.');return;}
    const bid=randomBytes(12).toString('hex');
    this.db.prepare('INSERT INTO tg_broadcasts(id,text,source_chat,source_message,kind,created) VALUES(?,?,?,?,?,?)').run(bid,(m.text||m.caption||'').slice(0,4000),id,m.message_id,m.video?'video':m.photo?'photo':m.document?'document':'text',new Date().toISOString());this.state(id,'');this.menu(id,'Xabar qoralama sifatida saqlandi. Admin panel → Telegram → Xabarlar bo‘limida tasdiqlang.');return;
   }
  }
  if(text==='📊 Natijam'){
   const rows=this.db.prepare('SELECT r.* FROM results r JOIN tg_claims c ON c.result_id=r.id WHERE c.user_id=? ORDER BY r.created DESC LIMIT 5').all(id) as any[];
   this.say(id,rows.length?rows.map(r=>`${new Date(r.created).toLocaleDateString('uz-UZ',{timeZone:'Asia/Tashkent'})}: ${r.score} ball — ${r.category}`).join('\n'):'Hali natija yo‘q. Saytda testni tugatib, “Natijani Telegram’da olish” tugmasini bosing.');return;
  }
  if(text==='📝 Test topshirish'){this.say(id,`Testni shu manzilda topshiring: ${this.siteUrl}\nYakunida “Natijani Telegram’da olish” tugmasini bosing.`);return;}
  if(text==='💬 Yordam'){this.say(id,this.settings().support||'Yordam ma’lumoti hali sozlanmagan.');return;}
  if(text==='📦 Buyurtmalarim'){
   const orders=this.db.prepare('SELECT * FROM tg_orders WHERE user_id=? ORDER BY created DESC LIMIT 10').all(id) as any[];
   const labels:Record<string,string>={address:'Manzil kutilmoqda',awaiting_receipt:'Chek kutilmoqda',pending:'Tekshirilmoqda',approved:'Tasdiqlangan',rejected:'Rad etilgan',shipped:'Jo‘natilgan',cancelled:'Bekor qilingan'};
   this.say(id,orders.length?orders.map(o=>`#${o.id} · ${o.kind==='pdf'?'PDF':'Bosma'} · ${o.amount.toLocaleString('uz-UZ')} so‘m\n${labels[o.status]||o.status}${o.tracking?'\nYetkazish: '+o.tracking:''}`).join('\n\n'):'Hali buyurtma yo‘q.');return;
  }
  if(text==='📄 PDF kundalik'||text==='📔 Bosma kundalik'){this.newOrder(user,text==='📄 PDF kundalik'?'pdf':'physical');return;}
  if(user.state.startsWith('address:')){
   const oid=user.state.slice(8);
   if(text.length<10||text.length>1000){this.say(id,'Ism-familiya va to‘liq yetkazish manzilini matn bilan kiriting (10–1000 belgi).');return;}
   this.db.prepare("UPDATE tg_orders SET address=?,status='awaiting_receipt' WHERE id=? AND user_id=? AND status='address'").run(text,oid,id);this.state(id,'receipt:'+oid);this.payment(id,oid);return;
  }
  if(user.state.startsWith('receipt:')){
   const oid=user.state.slice(8);const photo=m.photo?.at(-1);const doc=m.document;
   if(!photo&&!(doc&&['application/pdf','image/jpeg','image/png'].includes(doc.mime_type))){this.say(id,'To‘lov chekini rasm yoki PDF sifatida yuboring. Bekor qilish: /cancel');return;}
   const changed=this.db.prepare("UPDATE tg_orders SET receipt_file=?,receipt_kind=?,status='pending' WHERE id=? AND user_id=? AND status='awaiting_receipt'").run(photo?.file_id||doc.file_id,photo?'photo':'document',oid,id);
   this.state(id,'');
   if(changed.changes){this.menu(id,'Chek qabul qilindi. Administrator tekshirib tasdiqlagach sizga xabar beramiz.');for(const admin of this.ids().filter(n=>this.can(n,'bot.orders'))){this.say(admin,`Yangi to‘lov cheki: #${oid}\n${user.name} · ${user.phone}\nAdmin paneldan tekshiring.`);this.queue(admin,'copyMessage',{from_chat_id:id,message_id:m.message_id});}}
   return;
  }
  this.menu(id);
 }
 private newOrder(user:User,kind:'pdf'|'physical'){
  const s=this.settings();const amount=kind==='pdf'?s.pdfPrice:s.physicalPrice;
  if(!amount||!s.paymentDetails||(kind==='pdf'&&!s.pdfFileId)){this.say(user.id,'Bu mahsulot hozircha sotuvga tayyor emas. Keyinroq urinib ko‘ring.');return;}
  const open=this.db.prepare("SELECT * FROM tg_orders WHERE user_id=? AND status IN ('address','awaiting_receipt','pending') ORDER BY created DESC LIMIT 1").get(user.id) as any;
  if(open){
   if(open.status==='pending'){this.say(user.id,`#${open.id} buyurtmangiz tekshirilmoqda. Natijani kuting.`);return;}
   this.state(user.id,(open.status==='address'?'address:':'receipt:')+open.id);
   if(open.status==='address')this.say(user.id,'Avval ochilgan buyurtma uchun ism-familiya, viloyat, tuman va to‘liq manzilni yuboring.');else this.payment(user.id,open.id);return;
  }
  const id=randomBytes(5).toString('hex');
  this.db.prepare('INSERT INTO tg_orders(id,user_id,kind,amount,status,created) VALUES(?,?,?,?,?,?)').run(id,user.id,kind,amount,kind==='physical'?'address':'awaiting_receipt',new Date().toISOString());
  this.state(user.id,(kind==='physical'?'address:':'receipt:')+id);
  if(kind==='physical')this.say(user.id,`Bosma kundalik: ${amount.toLocaleString('uz-UZ')} so‘m.\n${s.deliveryInfo}\n\nIsm-familiya, viloyat, tuman va to‘liq yetkazish manzilini yuboring.\nBekor qilish: /cancel`);else this.payment(user.id,id);
 }
 private payment(userId:number,id:string){const o=this.db.prepare('SELECT * FROM tg_orders WHERE id=?').get(id) as any;this.say(userId,`Buyurtma #${id}\n${o.kind==='pdf'?'PDF':'Bosma'} kundalik: ${o.amount.toLocaleString('uz-UZ')} so‘m\n\n${this.settings().paymentDetails}\n\nTo‘lovdan keyin chekni rasm yoki PDF sifatida shu yerga yuboring. Chek administrator tomonidan tekshiriladi.\nBekor qilish: /cancel`);}
 review(id:string,action:string,note:string){return this.atomic(()=>{
  const o=this.db.prepare('SELECT * FROM tg_orders WHERE id=?').get(id) as unknown as Order|undefined;
  if(!o)throw Error('Buyurtma topilmadi.');
  if(!['approve','reject','ship','cancel'].includes(action))throw Error('Amal noto‘g‘ri.');
  if(action==='cancel'){
   if(!['address','awaiting_receipt'].includes(o.status))throw Error('Faqat to‘lovsiz ochiq buyurtmani bekor qilish mumkin.');
   this.db.prepare("UPDATE tg_orders SET status='cancelled' WHERE id=?").run(id);this.db.prepare("UPDATE tg_users SET state='' WHERE id=? AND state IN (?,?)").run(o.user_id,'address:'+id,'receipt:'+id);this.say(o.user_id,`#${id} buyurtma bekor qilindi.`);return {ok:true};
  }
  if(action==='ship'){
   if(o.status!=='approved'||o.kind!=='physical'||!note.trim())throw Error('Faqat tasdiqlangan bosma buyurtma uchun yetkazish ma’lumotini kiriting.');
   this.db.prepare("UPDATE tg_orders SET status='shipped',tracking=? WHERE id=?").run(note,id);this.say(o.user_id,`#${id} kundaligingiz jo‘natildi.\n${note}`);return {ok:true};
  }
  if(o.status!=='pending'||!o.receipt_file)throw Error('Buyurtma tekshiruvda emas.');
  if(action==='approve'&&o.kind==='pdf'&&!this.settings().pdfFileId)throw Error('Avval PDF faylini botga /pdf orqali yuklang.');
  this.db.prepare('UPDATE tg_orders SET status=?,reviewed=? WHERE id=?').run(action==='approve'?'approved':'rejected',new Date().toISOString(),id);
  if(action==='reject'){this.say(o.user_id,`#${id} to‘lov cheki tasdiqlanmadi.\n${note||'Iltimos, yordam bo‘limi orqali bog‘laning yoki yangi buyurtma bering.'}`);}
  else if(o.kind==='pdf')this.queue(o.user_id,'sendDocument',{document:this.settings().pdfFileId,caption:`#${id} to‘lov tasdiqlandi. PDF kundaligingiz!`},null,id);
  else this.say(o.user_id,`#${id} to‘lov tasdiqlandi. Bosma kundaligingiz tayyorlanadi. Jo‘natilganda xabar beramiz.`);
  return {ok:true};
 });}
 createBroadcast(text:string){if(typeof text!=='string'||!text.trim()||text.length>4000)throw Error('Xabar 1–4000 belgi bo‘lsin.');const id=randomBytes(12).toString('hex');this.db.prepare('INSERT INTO tg_broadcasts(id,text,kind,created) VALUES(?,?,?,?)').run(id,text.trim(),'text',new Date().toISOString());return {id};}
 broadcast(id:string){
  if(!this.token)throw Error('Bot tokeni sozlanmagan.');
  return this.atomic(()=>{const b=this.db.prepare('SELECT * FROM tg_broadcasts WHERE id=?').get(id) as any;if(!b||b.status!=='draft')throw Error('Xabar qoralama emas yoki allaqachon yuborilgan.');
   const users=this.db.prepare('SELECT id FROM tg_users WHERE phone IS NOT NULL AND active=1').all() as any[];
   if(!users.length)throw Error('Hozircha telefon ulashgan faol foydalanuvchi yo‘q.');
   for(const u of users)this.queue(u.id,b.source_chat?'copyMessage':'sendMessage',b.source_chat?{from_chat_id:b.source_chat,message_id:b.source_message}:{text:b.text},id);
   this.db.prepare("UPDATE tg_broadcasts SET status='queued' WHERE id=?").run(id);return {total:users.length};});
 }
 dashboard(permissions?:Permission[]){const data={
  status:{configured:!!this.token,running:this.running,username:this.username,adminCount:this.ids().length,lastError:this.lastError},connection:this.connection(),settings:this.settings(),
  users:this.db.prepare(`SELECT u.id,u.name,u.username,u.phone,u.active,u.created,(SELECT r.score FROM results r JOIN tg_claims c ON c.result_id=r.id WHERE c.user_id=u.id ORDER BY r.created DESC LIMIT 1) score,(SELECT r.category FROM results r JOIN tg_claims c ON c.result_id=r.id WHERE c.user_id=u.id ORDER BY r.created DESC LIMIT 1) category FROM tg_users u ORDER BY u.created DESC LIMIT 300`).all(),
  orders:this.db.prepare(`SELECT o.*,u.name,u.phone,(SELECT status FROM tg_outbox q WHERE q.order_id=o.id ORDER BY q.id DESC LIMIT 1) delivery_status FROM tg_orders o JOIN tg_users u ON u.id=o.user_id ORDER BY o.created DESC LIMIT 300`).all(),
  broadcasts:this.db.prepare(`SELECT b.*,(SELECT COUNT(*) FROM tg_outbox q WHERE q.broadcast_id=b.id) total,(SELECT COUNT(*) FROM tg_outbox q WHERE q.broadcast_id=b.id AND q.status='sent') sent,(SELECT COUNT(*) FROM tg_outbox q WHERE q.broadcast_id=b.id AND q.status='failed') failed FROM tg_broadcasts b ORDER BY b.created DESC LIMIT 50`).all(),
  jobs:this.db.prepare("SELECT id,chat_id,method,status,attempts,error,order_id FROM tg_outbox WHERE status='failed' ORDER BY id DESC LIMIT 50").all(),
  totals:{users:(this.db.prepare('SELECT COUNT(*) n FROM tg_users').get() as any).n,orders:(this.db.prepare('SELECT COUNT(*) n FROM tg_orders').get() as any).n}
 };if(!permissions)return data;
 const can=(p:Permission)=>permissions.includes(p);
 return {...data,connection:can('bot.connection')?data.connection:{adminIds:[],siteUrl:'',tokenConfigured:data.status.configured},settings:can('bot.settings')?data.settings:{...defaults},users:can('bot.users')?data.users:[],orders:can('bot.orders')?data.orders:[],broadcasts:can('bot.broadcasts')?data.broadcasts:[],jobs:data.jobs.filter(j=>can(this.jobPermission(Number(j.id)))),totals:{users:can('bot.users')?data.totals.users:0,orders:can('bot.orders')?data.totals.orders:0}};
 }
 jobPermission(id:number):Permission{const job=this.db.prepare('SELECT broadcast_id,order_id FROM tg_outbox WHERE id=?').get(id) as any;return job?.broadcast_id?'bot.broadcasts':job?.order_id?'bot.orders':'bot.connection';}
 retryJob(id:number){const changed=this.db.prepare("UPDATE tg_outbox SET status='pending',attempts=0,next_at=0,error='' WHERE id=? AND status='failed'").run(id);if(!changed.changes)throw Error('Qayta yuboriladigan xabar topilmadi.');return {ok:true};}
 async receipt(id:string){const order=this.db.prepare('SELECT receipt_file FROM tg_orders WHERE id=?').get(id) as any;if(!order?.receipt_file)throw Error('Chek topilmadi.');const file=await this.transport('getFile',{file_id:order.receipt_file});if(!file.file_path)throw Error('Fayl hozircha mavjud emas.');return fetch(`https://api.telegram.org/file/bot${this.token}/${file.file_path}`,{signal:AbortSignal.timeout(30000)});}
 private async request(method:string,payload:Record<string,unknown>){return this.requestWithToken(this.token,method,payload,this.controller?.signal);}
 private async requestWithToken(token:string,method:string,payload:Record<string,unknown>,signal?:AbortSignal){
  if(this.injectedTransport)return this.injectedTransport(method,payload);
  const timeout=AbortSignal.timeout(method==='getUpdates'?40000:30000);
  const response=await fetch(`https://api.telegram.org/bot${token}/${method}`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload),signal:signal?AbortSignal.any([signal,timeout]):timeout});
  const data=await response.json() as any;
  if(!data.ok)throw new TelegramError(data.error_code||response.status,data.parameters?.retry_after||0,String(data.description||'Telegram so‘rovi bajarilmadi.').split(token).join('[token]'));
  return data.result;
 }
 async applyPendingConnection(startRuntime=true){
  const raw=this.meta('pending_connection');if(!raw)return;
  const pending=JSON.parse(raw);
  try{
   if(!this.can(pending.actor,'bot.connection'))throw Error('Admin huquqi olib tashlangan.');
   await this.saveConnection({token:decryptBotToken(pending.encrypted,this.storageSecret),adminIds:this.ids(),siteUrl:this.siteUrl},startRuntime,pending.actor);
   this.say(pending.actor,'Bot tokeni yangilandi. Yangi token bilan xizmat davom etadi.');
  }catch{this.say(pending.actor,'Token almashtirilmadi. Token va internetni tekshiring yoki sayt admin panelidan qayta kiriting.');}
  finally{this.db.prepare('DELETE FROM tg_meta WHERE key=? AND value=?').run('pending_connection',raw);}
 }
 async deliverOne(){
  const job=this.db.prepare("SELECT * FROM tg_outbox WHERE status='pending' AND next_at<=? ORDER BY CASE WHEN method='deleteMessage' THEN 0 ELSE 1 END,id LIMIT 1").get(Date.now()) as unknown as Job|undefined;
  if(!job)return false;
  try{await this.transport(job.method,JSON.parse(job.payload));this.db.prepare("UPDATE tg_outbox SET status='sent',error='' WHERE id=?").run(job.id);}
  catch(e){const err=e as TelegramError;const attempts=job.attempts+1;const permanent=err.code===400||err.code===403||attempts>=6;
   this.db.prepare('UPDATE tg_outbox SET status=?,attempts=?,next_at=?,error=? WHERE id=?').run(permanent?'failed':'pending',attempts,Date.now()+Math.max(err.retryAfter*1000||0,Math.min(300000,1000*2**attempts)),err instanceof TelegramError?err.message:'Telegram bilan ulanishda xato.',job.id);
   if(err.code===429)this.db.prepare("UPDATE tg_outbox SET next_at=MAX(next_at,?) WHERE status='pending'").run(Date.now()+Math.max(1000,err.retryAfter*1000));
   if(err.code===403)this.db.prepare('UPDATE tg_users SET active=0 WHERE id=?').run(job.chat_id);
  }return true;
 }
 start(){if(!this.token||this.running)return;this.running=true;this.controller=new AbortController();const signal=this.controller.signal;this.tasks=[this.poll(signal),this.worker(signal)];}
 async stop(){this.running=false;this.controller?.abort();await Promise.allSettled(this.tasks);this.tasks=[];}
 private delay(ms:number,signal:AbortSignal){return new Promise<void>(resolve=>{if(signal.aborted){resolve();return;}const done=()=>{clearTimeout(timer);signal.removeEventListener('abort',done);resolve();};const timer=setTimeout(done,ms);timer.unref();signal.addEventListener('abort',done,{once:true});});}
 private async poll(signal:AbortSignal){
  try{const me=await this.transport('getMe',{});if(!signal.aborted)this.username=me.username||'';}
  catch{if(!signal.aborted)this.lastError='Botga ulanib bo‘lmadi. Token va internetni tekshiring.';}
  while(this.running&&!signal.aborted){try{const updates=await this.transport('getUpdates',{offset:Number(this.meta('offset')||0),timeout:25,allowed_updates:['message']});if(signal.aborted)break;for(const update of updates)this.handleUpdate(update);this.lastError='';}catch{if(!signal.aborted)this.lastError='Telegram yangilanishlarini olib bo‘lmadi. Token, internet va botning faqat bitta nusxasi ishlayotganini tekshiring.';await this.delay(5000,signal);}}
 }
 private async worker(signal:AbortSignal){while(this.running&&!signal.aborted){
  if(!this.pendingTask&&this.meta('pending_connection'))this.pendingTask=this.applyPendingConnection().finally(()=>{this.pendingTask=null;});
  try{await this.deliverOne();}catch{if(!signal.aborted)this.lastError='Xabar navbatida xato. Backend jurnalini va bazani tekshiring.';}
  await this.delay(80,signal);
 }}
}
