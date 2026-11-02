import {test} from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {AdminService,PERMISSIONS,requirePermission,requireConfigChange} from './admins';
import {Config,validate,localizeConfig} from './domain';
const password='test-owner-password';
function setup(){const db=new DatabaseSync(':memory:');const service=new AdminService(db,'+998901234567',password);const owner=service.list()[0];return {db,service,owner};}
const input=(permissions:string[]=[])=>({name:'Operator',phone:'+998909876543',password:'operator-password',telegramId:12345,permissions,active:true});
test('accounts have separate credentials and enforce only assigned permissions',()=>{
 const {service,owner}=setup();service.save(owner,input(['bot.orders']));const session=service.login('+998909876543','operator-password');
 assert.equal(requirePermission(session.admin,'bot.orders').name,'Operator');assert.throws(()=>requirePermission(session.admin,'admins.manage'));assert.throws(()=>requirePermission(session.admin,'bot.connection'));
 assert.throws(()=>service.save(session.admin,input(['admins.manage'])));assert.throws(()=>service.login('+998909876543',password));
 assert.ok(!JSON.stringify(service.list()).includes('operator-password'));assert.ok(!JSON.stringify(service.list()).includes('password'));
});
test('permission revocation and account deactivation apply to existing sessions immediately',()=>{
 const {service,owner}=setup();const account=service.save(owner,input(['bot.orders','bot.users']));const session=service.login(account.phone,'operator-password');
 service.save(owner,{...account,permissions:['bot.users']},account.id);
 assert.throws(()=>requirePermission(service.authenticate(session.token),'bot.orders'));assert.equal(service.authenticate(session.token).permissions[0],'bot.users');
 service.save(owner,{...account,active:false},account.id);assert.throws(()=>service.authenticate(session.token));assert.throws(()=>service.login(account.phone,'operator-password'));
});
test('password changes revoke existing sessions; logout invalidates the server session',()=>{
 const {service,owner}=setup();const account=service.save(owner,input(['site.results']));const old=service.login(account.phone,'operator-password');
 service.save(owner,{...account,password:'changed-password'},account.id);assert.throws(()=>service.authenticate(old.token));assert.throws(()=>service.login(account.phone,'operator-password'));
 const current=service.login(account.phone,'changed-password');service.logout(current.token);assert.throws(()=>service.authenticate(current.token));assert.throws(()=>service.authenticate('forged'));
});
test('removing web login or rotating owner credentials revokes previous sessions',()=>{
 const {db,service,owner}=setup();const account=service.save(owner,input(['bot.orders']));const session=service.login(account.phone,'operator-password');service.save(owner,{...account,phone:''},account.id);assert.throws(()=>service.authenticate(session.token));
 const ownerSession=service.login(owner.phone,password);new AdminService(db,owner.phone!,'new-owner-password');assert.throws(()=>service.authenticate(ownerSession.token));
});
test('owner and unique account identities are protected',()=>{
 const {service,owner}=setup();assert.throws(()=>service.save(owner,{...owner,active:false},owner.id));assert.throws(()=>service.save(owner,{...owner,permissions:[]},owner.id));
 service.save(owner,input());assert.throws(()=>service.save(owner,{...input(),name:'Duplicate'}));assert.throws(()=>service.save(owner,{...input(),phone:'+998900000001',telegramId:12345}));
 assert.throws(()=>service.save(owner,{...input(),permissions:['unknown']}));assert.throws(()=>service.save(owner,{...input(),password:'short'}));
});
test('legacy Telegram accounts migrate once and can be restricted independently from web access',()=>{
 const {service,owner}=setup();service.migrateTelegram([101]);const legacy=service.list().find(a=>a.telegramId===101)!;assert.equal(legacy.webAccess,false);
 service.save(owner,{...legacy,permissions:['bot.users'],active:false},legacy.id);service.migrateTelegram([101,102]);assert.deepEqual(service.telegramPermissions(101),[]);assert.equal(service.list().filter(a=>a.telegramId===102).length,0);
});
test('bot admin delegation requires management permission and grants a limited operator role',()=>{
 const {service,owner}=setup();service.save(owner,{...owner,telegramId:100},owner.id);service.changeTelegramAdmin(100,200,false);
 assert.deepEqual(service.telegramPermissions(200),['bot.users','bot.orders']);assert.throws(()=>service.changeTelegramAdmin(200,300,false));assert.throws(()=>service.changeTelegramAdmin(200,100,true));
 service.changeTelegramAdmin(100,200,true);assert.deepEqual(service.telegramPermissions(200),[]);
});
test('question editors cannot change site metadata; site editors cannot change questions or scores',()=>{
 const {service,owner}=setup();const questionEditor=service.save(owner,input(['site.questions']));const siteEditor={...questionEditor,permissions:['site.settings'] as const};const old=JSON.parse(readFileSync(resolve(__dirname,'../src/seed.json'),'utf8')) as Config;
 const q=structuredClone(old);q.questions[0].text='Edited';assert.doesNotThrow(()=>requireConfigChange(questionEditor,old,q));assert.throws(()=>requireConfigChange({...siteEditor,permissions:[...siteEditor.permissions]},old,q));
 const meta=structuredClone(old);meta.brand='New brand';assert.throws(()=>requireConfigChange(questionEditor,old,meta));
 const translation=structuredClone(old);translation.locales!.en!.questions!['1'].text='Changed translation';assert.doesNotThrow(()=>requireConfigChange(questionEditor,old,translation));
 translation.locales!.en!.title='Changed title';assert.throws(()=>requireConfigChange(questionEditor,old,translation));
});
test('localized public quiz keeps IDs and scores; missing translations use original content',()=>{
 const c=JSON.parse(readFileSync(resolve(__dirname,'../src/seed.json'),'utf8')) as Config;validate(c);const en=localizeConfig(c,'en');assert.notEqual(en.title,c.title);assert.equal(en.questions[0].id,c.questions[0].id);assert.equal(en.questions[0].options[0].score,c.questions[0].options[0].score);
 c.locales!.en!.questions!['1'].text='';assert.equal(localizeConfig(c,'en').questions[0].text,c.questions[0].text);assert.equal(localizeConfig(c,'xx'),c);
 c.locales!.en!.questions!['1'].options={bad:123 as any};assert.throws(()=>validate(c));
});
