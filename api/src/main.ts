import 'reflect-metadata';
import {config as env} from 'dotenv';
import {Body,Controller,Get,Post,Put,Req,Res,Param,Query,Module,HttpException} from '@nestjs/common';
import {NestFactory} from '@nestjs/core';
import type {Request,Response} from 'express';
import {DatabaseSync} from 'node:sqlite';
import {mkdirSync,readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {randomBytes} from 'node:crypto';
import {Config,validate,calculate,localizeConfig} from './domain';
import {normalizePhone} from './phone';
import {allowedOrigin} from './origin';
import {TelegramService} from './telegram';
import {AdminService,requirePermission,requireConfigChange,Permission} from './admins';
env({path:resolve(__dirname,'../.env')});
const password=process.env.ADMIN_PASSWORD,secret=process.env.SESSION_SECRET;
if(!password||password.length<12||!secret||secret.length<32) throw Error('api/.env: ADMIN_PASSWORD (12+), SESSION_SECRET (32+) kerak.');
const phone=normalizePhone(process.env.ADMIN_PHONE);
if(!phone) throw Error('api/.env: ADMIN_PHONE telefon raqami kerak.');
const dir=resolve(process.env.DATA_DIR||'data');mkdirSync(dir,{recursive:true});
const db=new DatabaseSync(resolve(dir,'stepone.sqlite'));db.exec('PRAGMA journal_mode=WAL; CREATE TABLE IF NOT EXISTS config(id INTEGER PRIMARY KEY CHECK(id=1),json TEXT NOT NULL); CREATE TABLE IF NOT EXISTS results(id TEXT PRIMARY KEY,created TEXT NOT NULL,score INTEGER,category TEXT,version INTEGER);');
if(!db.prepare('SELECT id FROM config').get()) db.prepare('INSERT INTO config VALUES(1,?)').run(readFileSync(resolve(__dirname,'../src/seed.json'),'utf8'));
const seedConfig=JSON.parse(readFileSync(resolve(__dirname,'../src/seed.json'),'utf8')) as Config;
const getConfig=()=>{const c=JSON.parse((db.prepare('SELECT json FROM config WHERE id=1').get() as {json:string}).json) as Config;if(c.locales===undefined&&c.title===seedConfig.title)c.locales=seedConfig.locales;return c;};
const admins=new AdminService(db,phone,password);
const envAdminIds=(process.env.TELEGRAM_ADMIN_IDS||'').split(',').map(Number).filter(n=>Number.isSafeInteger(n)&&n>0);
const oldTelegramIds=db.prepare("SELECT name FROM sqlite_master WHERE name='tg_meta'").get()?(db.prepare("SELECT value FROM tg_meta WHERE key='admin_ids'").get() as any)?.value:undefined;
admins.migrateTelegram(oldTelegramIds?JSON.parse(oldTelegramIds):envAdminIds);
const telegram=new TelegramService(db,process.env.BOT_TOKEN||'',envAdminIds,process.env.PUBLIC_SITE_URL||process.env.APP_ORIGIN||'http://127.0.0.1:3000',undefined,secret,{permissions:id=>admins.telegramPermissions(id),ids:()=>admins.telegramIds(),change:(actor,target,remove)=>admins.changeTelegramAdmin(actor,target,remove)});
const botAction=<T>(action:()=>T):T=>{try{return action();}catch(e){throw new HttpException({message:(e as Error).message},400);}};
const fail=(status:number,message:string):never=>{throw new HttpException({message},status)};
function origin(req:Request){const expected=process.env.APP_ORIGIN||'http://127.0.0.1:3000';if(!allowedOrigin(req.headers.origin,expected,process.env.NODE_ENV==='production'))fail(403,'Ruxsat etilmagan manba.');}
function sessionToken(req:Request){return req.headers.cookie?.split(';').map(s=>s.trim()).find(s=>s.startsWith('session='))?.slice(8)||'';}
function auth(req:Request,...permissions:Permission[]){const admin=admins.authenticate(sessionToken(req));if(permissions.length)requirePermission(admin,...permissions);return admin;}
const attempts=new Map<string,{n:number,until:number}>();
function throttle(req:Request,limit:number,prefix:string){const key=prefix+req.ip;const now=Date.now();let a=attempts.get(key);if(!a||a.until<now){a={n:0,until:now+60000};attempts.set(key,a);}if(++a.n>limit)fail(429,'Biroz kutib qayta urinib ko‘ring.');if(attempts.size>10000)for(const [k,v]of attempts)if(v.until<now)attempts.delete(k);}
@Controller()
class AppController {
 @Get('health') health(){return {ok:true};}
 @Get('admin/telegram') botDashboard(@Req()req:Request){const admin=auth(req,'bot.users','bot.orders','bot.broadcasts','bot.settings','bot.connection');return telegram.dashboard(admin.permissions);}
 @Put('admin/telegram/connection') async botConnection(@Req()req:Request,@Body()body:any){origin(req);auth(req,'bot.connection');throttle(req,6,'bot-connection');try{return await telegram.saveConnection({...body,adminIds:admins.telegramIds()});}catch(e){fail(400,(e as Error).message);}}
 @Put('admin/telegram/settings') botSettings(@Req()req:Request,@Body()body:any){origin(req);auth(req,'bot.settings');return botAction(()=>telegram.saveSettings(body));}
 @Post('admin/telegram/orders/:id/review') botReview(@Req()req:Request,@Param('id')id:string,@Body()body:any){origin(req);auth(req,'bot.orders');if(typeof body?.action!=='string'||(body.note!==undefined&&(typeof body.note!=='string'||body.note.length>1500)))fail(400,'Amal yoki izoh noto‘g‘ri.');return botAction(()=>telegram.review(id,body.action,body.note||''));}
 @Get('admin/telegram/orders/:id/receipt') async botReceipt(@Req()req:Request,@Param('id')id:string,@Res()res:Response){auth(req,'bot.orders');try{const file=await telegram.receipt(id);if(!file.ok)throw Error('Chekni yuklab bo‘lmadi.');res.setHeader('Content-Type',file.headers.get('content-type')||'application/octet-stream');res.setHeader('Content-Disposition','inline');res.send(Buffer.from(await file.arrayBuffer()));}catch{fail(400,'Chekni yuklab bo‘lmadi. Bot ulanishini tekshiring.');}}
 @Post('admin/telegram/broadcasts') botDraft(@Req()req:Request,@Body()body:any){origin(req);auth(req,'bot.broadcasts');return botAction(()=>telegram.createBroadcast(body?.text));}
 @Post('admin/telegram/broadcasts/:id/send') botBroadcast(@Req()req:Request,@Param('id')id:string){origin(req);auth(req,'bot.broadcasts');return botAction(()=>telegram.broadcast(id));}
 @Post('admin/telegram/jobs/:id/retry') botRetry(@Req()req:Request,@Param('id')id:string){origin(req);const admin=auth(req);requirePermission(admin,telegram.jobPermission(Number(id)));return botAction(()=>telegram.retryJob(Number(id)));}
 @Get('quiz') quiz(@Query('lang')lang:string){const c=localizeConfig(getConfig(),lang);const {locales,...publicConfig}=c;return {...publicConfig,questions:c.questions.map(q=>({...q,options:q.options.map(o=>({id:o.id,text:o.text}))}))};}
 @Post('submit') submit(@Req()req:Request,@Body()body:any){origin(req);throttle(req,30,'submit');const c=getConfig();if(body.version!==c.version)fail(409,'Test yangilandi. Sahifani yangilab qayta boshlang.');let result;try{result=calculate(c,body.answers);}catch(e){fail(400,(e as Error).message);}const id=randomBytes(12).toString('hex');db.prepare('INSERT INTO results VALUES(?,?,?,?,?)').run(id,new Date().toISOString(),result!.score,result!.category,c.version);const localized=localizeConfig(c,body.language);return {id,title:localized.finishTitle,description:localized.finishDescription,telegramUrl:(telegram.botUsername()||c.botUsername)?`https://t.me/${telegram.botUsername()||c.botUsername}?start=r_${id}`:null};}
 @Post('admin/login') login(@Req()req:Request,@Res({passthrough:true})res:Response,@Body()body:any){origin(req);throttle(req,6,'login');const session=admins.login(body?.phone,body?.password);res.cookie('session',session.token,{httpOnly:true,sameSite:'strict',secure:process.env.NODE_ENV==='production',maxAge:8*3600000,path:'/'});return {admin:session.admin};}
 @Post('admin/logout') logout(@Req()req:Request,@Res({passthrough:true})res:Response){origin(req);admins.logout(sessionToken(req));res.clearCookie('session',{path:'/'});return {ok:true};}
 @Get('admin/me') me(@Req()req:Request){return {admin:auth(req)};}
 @Get('admin/summary') summary(@Req()req:Request){const actor=auth(req);const can=(p:Permission)=>actor.permissions.includes(p);return {questions:can('site.questions')?getConfig().questions.length:null,results:can('site.results')?(db.prepare('SELECT COUNT(*) n FROM results').get() as any).n:null,pending:can('bot.orders')?(db.prepare("SELECT COUNT(*) n FROM tg_orders WHERE status='pending'").get() as any).n:null,admins:can('admins.manage')?admins.list().length:null};}
 @Get('admin/accounts') accounts(@Req()req:Request){auth(req,'admins.manage');return admins.list();}
 @Post('admin/accounts') createAccount(@Req()req:Request,@Body()body:any){origin(req);const actor=auth(req,'admins.manage');return botAction(()=>admins.save(actor,body));}
 @Put('admin/accounts/:id') editAccount(@Req()req:Request,@Param('id')id:string,@Body()body:any){origin(req);const actor=auth(req,'admins.manage');return botAction(()=>admins.save(actor,body,id));}
 @Get('admin/config') config(@Req()req:Request){auth(req,'site.questions','site.settings');return getConfig();}
 @Put('admin/config') save(@Req()req:Request,@Body()body:Config){origin(req);const actor=auth(req,'site.questions','site.settings');try{validate(body);}catch(e){fail(400,(e as Error).message);}const old=getConfig();requireConfigChange(actor,old,body);if(body.version!==old.version)fail(409,'Boshqa oynada o‘zgarish bor. Sahifani yangilang.');const updated={...body,version:old.version+1};db.prepare('UPDATE config SET json=? WHERE id=1').run(JSON.stringify(updated));return updated;}
 @Get('admin/results') results(@Req()req:Request){auth(req,'site.results');return {total:(db.prepare('SELECT COUNT(*) n FROM results').get() as any).n,items:db.prepare('SELECT r.*,u.name,u.phone,u.id telegram_id FROM results r LEFT JOIN tg_claims c ON c.result_id=r.id LEFT JOIN tg_users u ON u.id=c.user_id ORDER BY r.created DESC LIMIT 100').all()};}
}
@Module({controllers:[AppController]})class AppModule{}
async function main(){const app=await NestFactory.create(AppModule,{bodyParser:true});app.use((req:Request,res:Response,next:()=>void)=>{res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('Cache-Control','no-store');next();});await app.listen(Number(process.env.PORT||4000),'127.0.0.1');telegram.start();}main();
