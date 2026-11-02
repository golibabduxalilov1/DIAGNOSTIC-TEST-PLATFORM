export type Option = { id:string; text:string; score:number; key?:string };
export type Question = { id:string; type:'scored'|'category'; text:string; options:Option[] };
export type Translation={title?:string;description?:string;finishTitle?:string;finishDescription?:string;questions?:Record<string,{text?:string;options?:Record<string,string>}>};
export type Config = { version:number; brand:string; title:string; description:string; minutes:number; botUsername:string; finishTitle:string; finishDescription:string; questions:Question[];locales?:{ru?:Translation;en?:Translation} };
export function validate(c:Config) {
  const str=(v:unknown,max=2000)=>typeof v==='string'&&v.trim().length>0&&v.length<=max;
  if (!c || !Number.isInteger(c.version)|| !['brand','title','description','finishTitle','finishDescription'].every(k=>str(c[k as keyof Config])) || !Number.isInteger(c.minutes)||c.minutes<1||c.minutes>120 || typeof c.botUsername!=='string'|| !/^[A-Za-z0-9_]{0,32}$/.test(c.botUsername) || !Array.isArray(c.questions)||c.questions.length<1||c.questions.length>100) throw Error('Sozlamalar noto‘g‘ri. Matnlar, vaqt va savollarni tekshiring.');
  const ids=new Set<string>(); let categories=0;
  for (const q of c.questions) {
    if (!str(q.id,80)||ids.has(q.id)||!str(q.text)|| !['scored','category'].includes(q.type)||!Array.isArray(q.options)||q.options.length<2||q.options.length>12) throw Error('Savol IDsi, matni yoki variantlari noto‘g‘ri. Har savolda 2–12 variant bo‘lsin.');
    ids.add(q.id); if(q.type==='category') categories++;
    const options=new Set<string>();
    for (const o of q.options) { if(!str(o.id,80)||options.has(o.id)||!str(o.text)||!Number.isInteger(o.score)||o.score<0||o.score>100|| (q.type==='category' && (typeof o.key!=='string'||!/^[A-Za-z0-9]{1,16}$/.test(o.key)))) throw Error('Variant matni, balli (0–100) yoki kategoriya kaliti noto‘g‘ri.'); options.add(o.id); }
  }
  if(categories>1) throw Error('Bitta kategoriya savolidan foydalaning.');
  if(c.locales!==undefined){
    if(!c.locales||typeof c.locales!=='object'||Array.isArray(c.locales)||Object.keys(c.locales).some(k=>!['ru','en'].includes(k)))throw Error('Tarjima tili noto‘g‘ri.');
    const optionalText=(v:unknown)=>typeof v==='string'&&v.length<=2000;
    for(const locale of Object.values(c.locales)){
      if(!locale||typeof locale!=='object'||Array.isArray(locale)||Object.keys(locale).some(k=>!['title','description','finishTitle','finishDescription','questions'].includes(k)))throw Error('Tarjima maydonlari noto‘g‘ri.');
      for(const key of ['title','description','finishTitle','finishDescription'] as const)if(locale[key]!==undefined&&!optionalText(locale[key]))throw Error('Tarjima matni 2000 belgidan oshmasin.');
      if(locale.questions!==undefined){if(!locale.questions||typeof locale.questions!=='object'||Array.isArray(locale.questions)||Object.keys(locale.questions).length>100)throw Error('Savol tarjimalari noto‘g‘ri.');
        for(const question of Object.values(locale.questions)){if(!question||typeof question!=='object'||Object.keys(question).some(k=>!['text','options'].includes(k))||(question.text!==undefined&&!optionalText(question.text)))throw Error('Savol tarjimasi noto‘g‘ri.');if(question.options!==undefined&&(!question.options||typeof question.options!=='object'||Array.isArray(question.options)||Object.keys(question.options).length>12||!Object.values(question.options).every(optionalText)))throw Error('Variant tarjimasi noto‘g‘ri.');}
      }
    }
  }
  return c;
}
export function localizeConfig(c:Config,language:unknown):Config {
 const l=language==='ru'||language==='en'?c.locales?.[language]:undefined;if(!l)return c;
 const text=(translated:string|undefined,original:string)=>translated?.trim()?translated:original;
 return {...c,title:text(l.title,c.title),description:text(l.description,c.description),finishTitle:text(l.finishTitle,c.finishTitle),finishDescription:text(l.finishDescription,c.finishDescription),questions:c.questions.map(q=>({...q,text:text(l.questions?.[q.id]?.text,q.text),options:q.options.map(o=>({...o,text:text(l.questions?.[q.id]?.options?.[o.id],o.text)}))}))};
}
export function calculate(c:Config,answers:Record<string,string>) {
  if(!answers || typeof answers!=='object'||Array.isArray(answers)||Object.keys(answers).length!==c.questions.length) throw Error('Barcha savollarga javob bering.');
  let score=0,category='yoq';
  for(const q of c.questions) { const o=q.options.find(o=>o.id===answers[q.id]); if(!o) throw Error('Javob varianti noto‘g‘ri.'); if(q.type==='scored')score+=o.score;else category=o.key||'yoq'; }
  return {score,category};
}
