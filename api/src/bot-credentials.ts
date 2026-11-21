import { InputError } from "./security";

export function parseAdminIds(value:unknown):number[]{
 const entries=typeof value==='string'?value.trim()?value.trim().split(/[\s,]+/):[]:value;
 if(!Array.isArray(entries)||entries.length>50||entries.some(id=>!(typeof id==='number'||typeof id==='string')||!/^\d+$/.test(String(id))||!Number.isSafeInteger(Number(id))||Number(id)<=0))throw new InputError('Admin IDlar musbat raqam bo‘lsin. Ko‘pi bilan 50 ta ID kiriting.');
 return [...new Set(entries.map(Number))];
}
export function validSiteUrl(value:unknown):string {
 if(typeof value!=='string'||value.length>2000)throw new InputError('Sayt manzilini kiriting.');
 try{const url=new URL(value);if(!['http:','https:'].includes(url.protocol)||url.username||url.password||url.search||url.hash)throw new InputError();return url.href.replace(/\/$/,'');}catch{throw new InputError('Sayt manzili http:// yoki https:// bilan boshlansin.');}
}
