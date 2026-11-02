import {test} from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {TelegramService} from './telegram';
import {AdminService} from './admins';

function setup(){
 const db=new DatabaseSync(':memory:');
 db.exec('CREATE TABLE results(id TEXT PRIMARY KEY,created TEXT,score INTEGER,category TEXT,version INTEGER)');
 const sent:{method:string,payload:any}[]=[];
 const bot=new TelegramService(db,'test-token',[1],'https://stepone.example',async(method,payload)=>{sent.push({method,payload});return {};});
 let next=1;
 const message=(id:number,body:any)=>bot.handleUpdate({update_id:next++,message:{message_id:next,chat:{type:'private',id},from:{id,first_name:'User '+id},...body}});
 const register=(id:number)=>{message(id,{text:'/start'});message(id,{contact:{user_id:id,phone_number:'+998901234567'}});};
 const configure=()=>{bot.saveSettings({pdfPrice:25000,physicalPrice:120000,paymentDetails:'Test payment',deliveryInfo:'Courier included',support:'@help'});register(1);message(1,{text:'/pdf'});message(1,{document:{mime_type:'application/pdf',file_id:'diary-pdf'}});};
 const order=(id:number,kind='pdf')=>{message(id,{text:kind==='pdf'?'📄 PDF kundalik':'📔 Bosma kundalik'});return db.prepare('SELECT * FROM tg_orders WHERE user_id=? ORDER BY rowid DESC LIMIT 1').get(id) as any;};
 return {db,bot,sent,message,register,configure,order};
}
test('contact gate rejects someone else’s contact and links a real server result only after sharing own phone',()=>{
 const {db,bot,message}=setup();const result='a'.repeat(24);
 db.prepare('INSERT INTO results VALUES(?,?,?,?,?)').run(result,new Date().toISOString(),55,'vaqt',1);
 message(2,{text:'/start r_'+result});message(2,{text:'📄 PDF kundalik'});
 assert.equal((db.prepare('SELECT COUNT(*) n FROM tg_orders').get() as any).n,0);
 message(2,{contact:{user_id:3,phone_number:'+998901234567'}});
 assert.equal((bot.dashboard().users[0] as any).phone,null);
 assert.equal((db.prepare('SELECT COUNT(*) n FROM tg_claims').get() as any).n,0);
 message(2,{contact:{user_id:2,phone_number:'+998901234567'}});
 assert.equal((bot.dashboard().users[0] as any).score,55);
 message(3,{text:'/start r_'+result});message(3,{contact:{user_id:3,phone_number:'+998909999999'}});
 assert.equal((db.prepare('SELECT user_id FROM tg_claims WHERE result_id=?').get(result) as any).user_id,2);
});
test('tampered score links cannot create or claim a result',()=>{
 const {db,message,register}=setup();register(2);message(2,{text:'/start t_999999_vaqt'});message(2,{text:'/start r_'+'b'.repeat(24)});
 assert.equal((db.prepare('SELECT COUNT(*) n FROM tg_claims').get() as any).n,0);
});
test('PDF delivery requires a receipt and admin approval; approval is atomic and cannot be repeated',async()=>{
 const {db,bot,message,register,configure,order,sent}=setup();configure();register(2);const o=order(2);
 assert.throws(()=>bot.review(o.id,'approve',''));
 message(2,{text:'paid'});assert.equal((db.prepare('SELECT status FROM tg_orders WHERE id=?').get(o.id) as any).status,'awaiting_receipt');
 message(2,{photo:[{file_id:'receipt'}]});
 assert.equal((db.prepare("SELECT COUNT(*) n FROM tg_outbox WHERE method='sendDocument'").get() as any).n,0);
 bot.review(o.id,'approve','');assert.throws(()=>bot.review(o.id,'approve',''));
 assert.equal((db.prepare("SELECT COUNT(*) n FROM tg_outbox WHERE method='sendDocument'").get() as any).n,1);
 while(await bot.deliverOne()){}
 assert.equal(sent.filter(s=>s.method==='sendDocument'&&s.payload.document==='diary-pdf').length,1);
 assert.equal((bot.dashboard().orders[0] as any).delivery_status,'sent');
});
test('physical orders retain address, reject early shipment and send shipment details after approval',()=>{
 const {db,bot,message,register,configure,order}=setup();configure();register(2);const o=order(2,'physical');
 assert.equal(o.status,'address');assert.throws(()=>bot.review(o.id,'ship','tracking'));
 message(2,{text:'Toshkent, Test street 10. User Two'});message(2,{document:{mime_type:'application/pdf',file_id:'payment-pdf'}});
 bot.review(o.id,'approve','');assert.throws(()=>bot.review(o.id,'ship',''));
 bot.review(o.id,'ship','Courier: AB123');
 const saved=db.prepare('SELECT * FROM tg_orders WHERE id=?').get(o.id) as any;
 assert.equal(saved.status,'shipped');assert.equal(saved.tracking,'Courier: AB123');assert.match(saved.address,/Toshkent/);
 assert.throws(()=>bot.review(o.id,'ship','duplicate'));
});
test('open orders can be resumed or cancelled, and rejected receipts never deliver a PDF',()=>{
 const {db,bot,message,register,configure,order}=setup();configure();register(2);const first=order(2);
 assert.equal(order(2).id,first.id);message(2,{text:'/cancel'});
 assert.equal((db.prepare('SELECT status FROM tg_orders WHERE id=?').get(first.id) as any).status,'cancelled');
 const second=order(2);assert.notEqual(second.id,first.id);message(2,{photo:[{file_id:'bad-receipt'}]});bot.review(second.id,'reject','Wrong amount');
 assert.equal((db.prepare("SELECT COUNT(*) n FROM tg_outbox WHERE method='sendDocument'").get() as any).n,0);
});
test('only Telegram admins can upload PDF or stage a media broadcast; drafts never send until confirmed',()=>{
 const {db,bot,message,register,configure}=setup();configure();register(2);message(3,{text:'/start'});
 message(2,{text:'/broadcast'});message(2,{video:{file_id:'not-admin'}});
 assert.equal(bot.dashboard().broadcasts.length,0);
 message(1,{text:'/broadcast'});message(1,{video:{file_id:'video'},caption:'Announcement'});
 const draft=bot.dashboard().broadcasts[0] as any;
 assert.equal(draft.status,'draft');assert.equal(draft.total,0);assert.equal(draft.kind,'video');
 assert.equal(bot.broadcast(draft.id).total,2);
 assert.throws(()=>bot.broadcast(draft.id));
 assert.equal((db.prepare('SELECT COUNT(*) n FROM tg_outbox WHERE broadcast_id=?').get(draft.id) as any).n,2);
});
test('duplicate Telegram updates are ignored across restarts',()=>{
 const {db,bot}=setup();const update={update_id:123,message:{message_id:1,chat:{type:'private',id:2},from:{id:2,first_name:'Test'},text:'/start'}};
 bot.handleUpdate(update);const count=(db.prepare('SELECT COUNT(*) n FROM tg_outbox').get() as any).n;
 bot.handleUpdate(update);new TelegramService(db,'',[1],'https://example.com').handleUpdate(update);
 assert.equal((db.prepare('SELECT COUNT(*) n FROM tg_outbox').get() as any).n,count);
});
test('outbox retries network failures without losing queued messages',async()=>{
 const {db,bot,message}=setup();message(2,{text:'/start'});
 const failing=new TelegramService(db,'test',[1],'https://example.com',async()=>{throw Error('Network failure with sensitive details');});
 await failing.deliverOne();let job=db.prepare('SELECT * FROM tg_outbox ORDER BY id LIMIT 1').get() as any;
 assert.equal(job.status,'pending');assert.equal(job.attempts,1);assert.ok(job.next_at>Date.now());assert.doesNotMatch(job.error,/sensitive/);
 db.prepare('UPDATE tg_outbox SET next_at=0').run();await bot.deliverOne();job=db.prepare('SELECT * FROM tg_outbox ORDER BY id LIMIT 1').get() as any;assert.equal(job.status,'sent');
});

const tokenA='12345:'+'a'.repeat(30),tokenB='12345:'+'b'.repeat(30),secret='secret'.repeat(8);
function connectionSetup(){
 const {db}=setup();let valid=true,next=1;
 const bot=new TelegramService(db,'',[1],'https://example.com',async(method)=>{if(method==='getMe'){if(!valid)throw Error('Rejected '+tokenB);return {id:12345,is_bot:true,username:'stepone_test_bot'};}return {};},secret);
 const message=(id:number,body:any)=>bot.handleUpdate({update_id:next++,message:{message_id:next,chat:{type:'private',id},from:{id,first_name:'User'},...body}});
 const register=(id:number)=>message(id,{contact:{user_id:id,phone_number:'+998901234567'}});
 const save=(token=tokenA,adminIds:any=[1])=>bot.saveConnection({token,adminIds,siteUrl:'https://example.com'},false);
 return {db,bot,message,register,save,setValid:(v:boolean)=>{valid=v;}};
}
test('panel connection verifies token, persists encrypted settings, and never exposes credentials',async()=>{
 const {db,bot,save}=connectionSetup();await save(tokenA,'1, 2\n1');
 assert.deepEqual(bot.connection().adminIds,[1,2]);assert.equal(bot.botUsername(),'stepone_test_bot');
 assert.ok(!JSON.stringify(bot.dashboard()).includes(tokenA));
 assert.ok(!(db.prepare('SELECT value FROM tg_meta WHERE key=?').get('bot_token') as any).value.includes(tokenA));
 const restarted=new TelegramService(db,'',[99],'https://old.example',undefined,secret);
 assert.deepEqual(restarted.connection(),{adminIds:[1,2],siteUrl:'https://example.com',tokenConfigured:true});
 await save('');assert.equal(bot.connection().tokenConfigured,true);
});
test('first connection can start without admins so the owner can obtain their Telegram ID',async()=>{
 const {db}=setup();const bot=new TelegramService(db,'',[],'https://example.com',async()=>({id:12345,is_bot:true,username:'stepone_test_bot'}),secret);
 await bot.saveConnection({token:tokenA,adminIds:'',siteUrl:'https://example.com'},false);
 assert.deepEqual(bot.connection().adminIds,[]);
 await bot.saveConnection({token:'',adminIds:'123456789',siteUrl:'https://example.com'},false);
 assert.deepEqual(bot.connection().adminIds,[123456789]);
 await assert.rejects(bot.saveConnection({token:'',adminIds:[],siteUrl:'https://example.com'},false));
});
test('invalid token and empty admin list leave the working connection intact',async()=>{
 const {bot,save,setValid}=connectionSetup();await save();setValid(false);
 await assert.rejects(save(tokenB,[9]),e=>e instanceof Error&&!e.message.includes(tokenB));
 assert.deepEqual(bot.connection().adminIds,[1]);
 await assert.rejects(save(tokenB,[]));await assert.rejects(save('malformed',[2]));
 assert.equal(bot.botUsername(),'stepone_test_bot');
});
test('Telegram admin management requires an existing admin and persists removals',async()=>{
 const {db,bot,message,register,save}=connectionSetup();await save();register(1);register(2);
 message(2,{text:'/admin_add 2'});assert.deepEqual(bot.connection().adminIds,[1]);
 message(1,{text:'/admin_add 2'});assert.deepEqual(bot.connection().adminIds,[1,2]);
 message(2,{text:'/admin_remove 1'});assert.deepEqual(bot.connection().adminIds,[2]);
 message(1,{text:'/admin_add 1'});assert.deepEqual(bot.connection().adminIds,[2]);
 message(2,{text:'/admin_remove 2'});assert.deepEqual(bot.connection().adminIds,[2]);
 const restarted=new TelegramService(db,'',[1],'https://example.com',undefined,secret);
 assert.deepEqual(restarted.connection().adminIds,[2]);
});
test('bot token entry is encrypted, admin-only, and applied through validation',async()=>{
 const {db,bot,message,register,save}=connectionSetup();await save();register(1);register(2);
 message(2,{text:'/token'});message(2,{text:tokenB});
 assert.equal(db.prepare('SELECT value FROM tg_meta WHERE key=?').get('pending_connection'),undefined);
 message(1,{text:'/token'});message(1,{text:tokenB});
 const raw=(db.prepare('SELECT value FROM tg_meta WHERE key=?').get('pending_connection') as any).value;
 assert.ok(!raw.includes(tokenB));assert.ok(!JSON.stringify(db.prepare('SELECT * FROM tg_outbox').all()).includes(tokenB));
 await bot.applyPendingConnection(false);
 assert.equal(db.prepare('SELECT value FROM tg_meta WHERE key=?').get('pending_connection'),undefined);
 assert.equal(bot.connection().tokenConfigured,true);
 assert.ok((db.prepare("SELECT COUNT(*) n FROM tg_outbox WHERE method='deleteMessage'").get() as any).n>0);
});
test('live token rotation waits for old polling to finish before starting another poller',async()=>{
 const {db}=setup();let active=0,maxActive=0;
 const bot=new TelegramService(db,'',[1],'https://example.com',async method=>{
  if(method==='getMe')return {id:12345,is_bot:true,username:'stepone_test_bot'};
  if(method==='getUpdates'){active++;maxActive=Math.max(maxActive,active);await new Promise(r=>setTimeout(r,10));active--;return [];}
  return {};
 },secret);
 try{
  await bot.saveConnection({token:tokenA,adminIds:[1],siteUrl:'https://example.com'});
  await new Promise(r=>setTimeout(r,5));
  await bot.saveConnection({token:tokenB,adminIds:[1],siteUrl:'https://example.com'});
 }finally{await bot.stop();}
 assert.equal(maxActive,1);assert.equal(active,0);assert.equal(bot.dashboard().status.running,false);
});
test('worker applies a token submitted inside the bot and resumes without duplicate pollers',async()=>{
 const {db}=setup();let active=0,maxActive=0;
 const bot=new TelegramService(db,tokenA,[1],'https://example.com',async method=>{
  if(method==='getMe')return {id:12345,is_bot:true,username:'stepone_test_bot'};
  if(method==='getUpdates'){active++;maxActive=Math.max(maxActive,active);await new Promise(r=>setTimeout(r,5));active--;return [];}
  return {};
 },secret);
 let updateId=1;const message=(body:any)=>bot.handleUpdate({update_id:updateId++,message:{message_id:updateId,chat:{type:'private',id:1},from:{id:1,first_name:'Admin'},...body}});
 message({contact:{user_id:1,phone_number:'+998901234567'}});message({text:'/token'});message({text:tokenB});
 bot.start();
 try{
  const deadline=Date.now()+1500;
  while(db.prepare('SELECT value FROM tg_meta WHERE key=?').get('pending_connection')&&Date.now()<deadline)await new Promise(r=>setTimeout(r,10));
  assert.equal(db.prepare('SELECT value FROM tg_meta WHERE key=?').get('pending_connection'),undefined);
  assert.ok(db.prepare('SELECT value FROM tg_meta WHERE key=?').get('bot_token'));assert.equal(bot.dashboard().status.running,true);
 }finally{await bot.stop();}
 assert.equal(maxActive,1);assert.equal(active,0);
});
test('unified account permissions restrict bot commands and redact dashboard sections',()=>{
 const {db}=setup();const accounts=new AdminService(db,'+998901234567','owner-test-password');let owner=accounts.list()[0];owner=accounts.save(owner,{...owner,telegramId:1},owner.id);accounts.save(owner,{name:'Orders only',telegramId:2,active:true,permissions:['bot.orders']});
 const bot=new TelegramService(db,tokenA,[],'https://example.com',async()=>({}),secret,{ids:()=>accounts.telegramIds(),permissions:id=>accounts.telegramPermissions(id),change:(actor,target,remove)=>accounts.changeTelegramAdmin(actor,target,remove)});
 let update=1;const message=(id:number,body:any)=>bot.handleUpdate({update_id:update++,message:{message_id:update,chat:{type:'private',id},from:{id,first_name:'Test'},...body}});
 message(2,{contact:{user_id:2,phone_number:'+998901234567'}});
 message(2,{text:'/admin_add 3'});assert.deepEqual(accounts.telegramPermissions(3),[]);
 message(2,{text:'/users'});assert.match(JSON.parse((db.prepare('SELECT payload FROM tg_outbox ORDER BY id DESC LIMIT 1').get() as any).payload).text,/ruxsat/);
 message(2,{text:'/orders'});assert.match(JSON.parse((db.prepare('SELECT payload FROM tg_outbox ORDER BY id DESC LIMIT 1').get() as any).payload).text,/buyurtmalar/);
 message(2,{text:'/token'});message(2,{text:tokenB});assert.equal(db.prepare("SELECT value FROM tg_meta WHERE key='pending_connection'").get(),undefined);
 message(2,{text:'/pdf'});message(2,{document:{mime_type:'application/pdf',file_id:'forbidden-pdf'}});assert.equal(bot.settings().pdfFileId,'');
 message(2,{text:'/broadcast'});message(2,{text:'Forbidden broadcast'});assert.equal(bot.dashboard().broadcasts.length,0);
 assert.equal(bot.dashboard(['bot.orders']).users.length,0);assert.deepEqual(bot.dashboard(['bot.orders']).connection.adminIds,[]);
 assert.equal(bot.dashboard(['bot.users']).users.length,1);
});
