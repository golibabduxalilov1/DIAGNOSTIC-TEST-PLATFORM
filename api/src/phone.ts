export function normalizePhone(value:unknown):string|null {
 if(typeof value!=='string'||value.length>32||!/^\+?[\d\s()-]+$/.test(value.trim()))return null;
 const digits=value.replace(/\D/g,'');
 return /^[1-9]\d{7,14}$/.test(digits)?digits:null;
}
