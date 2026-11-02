const assert=require('node:assert/strict');
const {spawn}=require('node:child_process');
const {mkdtempSync,rmSync}=require('node:fs');
const {tmpdir}=require('node:os');
const {join,dirname,resolve}=require('node:path');
const {DatabaseSync}=require('node:sqlite');
const {createServer}=require('node:net');
const {once}=require('node:events');

(async()=>{
 const temporary=mkdtempSync(join(tmpdir(),'stepone-access-'));
 const probe=createServer();probe.listen(0,'127.0.0.1');await once(probe,'listening');const port=probe.address().port;await new Promise(r=>probe.close(r));
 const base='http://127.0.0.1:'+port,origin='http://localhost:3000';
 const server=spawn(process.execPath,['dist/main.js'],{cwd:resolve(__dirname,'..'),env:{...process.env,PORT:String(port),DATA_DIR:temporary,ADMIN_PHONE:'+998901234567',ADMIN_PASSWORD:'test-owner-password',SESSION_SECRET:'isolated-test-secret-'.repeat(3),BOT_TOKEN:'',TELEGRAM_ADMIN_IDS:'',APP_ORIGIN:origin,NODE_ENV:'test'},stdio:'ignore'});
 let database;
 async function request(path,cookie,method='GET',body){const response=await fetch(base+path,{method,headers:{Origin:origin,'Content-Type':'application/json',...(cookie?{Cookie:cookie}:{})},...(body===undefined?{}:{body:JSON.stringify(body)})});return {status:response.status,body:await response.json(),cookie:response.headers.get('set-cookie')?.split(';')[0]};}
 async function login(phone,password){const r=await request('/admin/login',null,'POST',{phone,password});assert.equal(r.status,201);return r.cookie;}
 try{
  for(let n=0;n<80;n++){try{if((await fetch(base+'/health')).ok)break;}catch{}if(n===79)throw Error('Test server did not start');await new Promise(r=>setTimeout(r,100));}
  assert.equal((await request('/admin/accounts')).status,401);
  const owner=await login('+998901234567','test-owner-password');
  const operator=(await request('/admin/accounts',owner,'POST',{name:'Receipt operator',phone:'+998909876543',password:'operator-password',telegramId:12345,active:true,permissions:['bot.orders']})).body;
  const op=await login('+998909876543','operator-password');
  for(const path of ['/admin/config','/admin/results','/admin/accounts'])assert.equal((await request(path,op)).status,403,path);
  for(const [path,method] of [['/admin/telegram/connection','PUT'],['/admin/telegram/settings','PUT'],['/admin/telegram/broadcasts','POST'],['/admin/accounts','POST']])assert.equal((await request(path,op,method,{})).status,403,path);
  database=new DatabaseSync(join(temporary,'stepone.sqlite'));
  database.prepare('INSERT INTO tg_users(id,name,phone,created) VALUES(?,?,?,?)').run(999,'Private customer','+998900001111',new Date().toISOString());
  database.prepare('INSERT INTO tg_orders(id,user_id,kind,amount,status,created) VALUES(?,?,?,?,?,?)').run('test-order',999,'physical',100000,'pending',new Date().toISOString());
  const dashboard=await request('/admin/telegram',op);assert.equal(dashboard.status,200);assert.equal(dashboard.body.orders.length,1);assert.deepEqual(dashboard.body.users,[]);assert.equal(dashboard.body.settings.paymentDetails,'');assert.deepEqual(dashboard.body.connection.adminIds,[]);
  const quiz=(await request('/quiz?lang=en')).body;assert.match(quiz.title,/charge/);assert.ok(!('locales' in quiz));assert.ok(!('score' in quiz.questions[0].options[0]));
  const submitted=await request('/submit',null,'POST',{version:quiz.version,language:'ru',answers:Object.fromEntries(quiz.questions.map(q=>[q.id,q.options[0].id]))});assert.equal(submitted.status,201);assert.match(submitted.body.title,/результат/);
  for(const [index,permissions] of [['1',['site.questions']],['2',['site.settings']]]){
   const account=(await request('/admin/accounts',owner,'POST',{name:'Editor '+index,phone:'+99890123456'+index,password:'editor-password',permissions,active:true})).body;
   const cookie=await login(account.phone,'editor-password');const config=(await request('/admin/config',cookie)).body;
   if(index==='1')config.brand='Unauthorized brand';else config.questions[0].options[0].score=99;
   assert.equal((await request('/admin/config',cookie,'PUT',config)).status,403);
  }
  assert.equal((await request('/admin/accounts/'+operator.id,owner,'PUT',{...operator,permissions:[]})).status,200);
  assert.equal((await request('/admin/telegram',op)).status,403);
  await request('/admin/accounts/'+operator.id,owner,'PUT',{...operator,active:false});assert.equal((await request('/admin/me',op)).status,401);
  await request('/admin/logout',owner,'POST');assert.equal((await request('/admin/me',owner)).status,401);
  console.log('HTTP access checks passed: scoped accounts, private data filtering, immediate revocation, localized quiz, and session logout.');
 }finally{
  if(database)database.close();
  const exited=once(server,'exit');server.kill();await exited;
  if(dirname(resolve(temporary)).toLowerCase()!==resolve(tmpdir()).toLowerCase()||!resolve(temporary).includes('stepone-access-'))throw Error('Unexpected temporary directory');
  rmSync(temporary,{recursive:true,force:true});
 }
})().catch(error=>{console.error(error.message);process.exitCode=1;});
