import {createCipheriv,createDecipheriv,createHash,randomBytes} from 'node:crypto';

export function parseAdminIds(value:unknown):number[]{
 const entries=typeof value==='string'?value.trim()?value.trim().split(/[\s,]+/):[]:value;
 if(!Array.isArray(entries)||entries.length>50||entries.some(id=>!(typeof id==='number'||typeof id==='string')||!/^\d+$/.test(String(id))||!Number.isSafeInteger(Number(id))||Number(id)<=0))throw Error('Admin IDlar musbat raqam bo‘lsin. Ko‘pi bilan 50 ta ID kiriting.');
 return [...new Set(entries.map(Number))];
}
export function encryptBotToken(token:string,secret:string):string {
 if(secret.length<32)throw Error('Tokenni saqlash uchun SESSION_SECRET sozlanishi kerak.');
 const iv=randomBytes(12),cipher=createCipheriv('aes-256-gcm',createHash('sha256').update(secret).digest(),iv);
 const encrypted=Buffer.concat([cipher.update(token,'utf8'),cipher.final()]);
 return [iv,cipher.getAuthTag(),encrypted].map(b=>b.toString('base64url')).join('.');
}
export function decryptBotToken(value:string,secret:string):string {
 const [iv,tag,encrypted]=value.split('.').map(s=>Buffer.from(s,'base64url'));
 const decipher=createDecipheriv('aes-256-gcm',createHash('sha256').update(secret).digest(),iv);decipher.setAuthTag(tag);
 return Buffer.concat([decipher.update(encrypted),decipher.final()]).toString('utf8');
}
export function validSiteUrl(value:unknown):string {
 if(typeof value!=='string'||value.length>2000)throw Error('Sayt manzilini kiriting.');
 try{const url=new URL(value);if(!['http:','https:'].includes(url.protocol)||url.username||url.password||url.search||url.hash)throw Error();return url.href.replace(/\/$/,'');}catch{throw Error('Sayt manzili http:// yoki https:// bilan boshlansin.');}
}
