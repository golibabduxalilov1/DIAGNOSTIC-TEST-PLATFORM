import {test} from 'node:test';
import assert from 'node:assert/strict';
import {calculate,validate,Config} from './domain';
import {readFileSync} from 'node:fs';
const seed=()=>JSON.parse(readFileSync(require('node:path').resolve(__dirname,'../src/seed.json'),'utf8')) as Config;
test('11 scored questions yield 55; category is excluded',()=>{const c=seed();validate(c);const a=Object.fromEntries(c.questions.map(q=>[q.id,q.options[0].id]));assert.deepEqual(calculate(c,a),{score:55,category:'vaqt'});});
test('missing or forged answers rejected',()=>{const c=seed();assert.throws(()=>calculate(c,{}));const a=Object.fromEntries(c.questions.map(q=>[q.id,'forged']));assert.throws(()=>calculate(c,a));});
test('invalid scores, duplicate ids and malformed category keys rejected',()=>{let c=seed();c.questions[0].options[0].score=-1;assert.throws(()=>validate(c));c=seed();c.questions[1].id=c.questions[0].id;assert.throws(()=>validate(c));c=seed();c.questions[8].options[0].key='bad_payload';assert.throws(()=>validate(c));});
test('multiple category questions rejected',()=>{const c=seed();c.questions[0].type='category';assert.throws(()=>validate(c));});

test('unknown fields, reserved IDs and malformed nested objects are rejected',()=>{
 const original=seed();
 assert.throws(()=>validate({...original,secret:'private'} as Config));
 for(const bad of [null,[],{...original.questions[0],extra:'private'},{...original.questions[0],id:'__proto__'}]){
  const c=seed();c.questions[0]=bad as any;assert.throws(()=>validate(c));
 }
 for(const bad of [null,[],{...original.questions[0].options[0],extra:'private'},{...original.questions[0].options[0],id:'constructor'}]){
  const c=seed();c.questions[0].options[0]=bad as any;assert.throws(()=>validate(c));
 }
});

test('answers inherited from a prototype cannot replace missing own answers',()=>{
 const c=seed();const a=Object.fromEntries(c.questions.map(q=>[q.id,q.options[0].id]));
 const first=c.questions[0].id;const inherited=Object.create({[first]:a[first]});
 Object.assign(inherited,a);delete inherited[first];inherited.extra='padding';
 assert.throws(()=>calculate(c,inherited));
});

test('site appearance and branding accept existing configs and reject malformed settings',()=>{
 const c=seed();validate(c);
 c.brand='Yangi brend';c.brandTagline='';c.footerText='Yangi matn';
 c.appearance={theme:'light',compact:true,largeText:false};validate(c);
 for(const appearance of [null,[],{theme:'invalid',compact:false,largeText:false},{theme:'dark',compact:'yes',largeText:false},{theme:'dark',compact:false,largeText:false,extra:true}])assert.throws(()=>validate({...c,appearance} as Config));
 assert.throws(()=>validate({...c,brandTagline:'x'.repeat(201)}));
});

