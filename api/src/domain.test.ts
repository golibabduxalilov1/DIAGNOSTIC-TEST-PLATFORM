import {test} from 'node:test';
import assert from 'node:assert/strict';
import {calculate,validate,Config} from './domain';
import {readFileSync} from 'node:fs';
const seed=()=>JSON.parse(readFileSync(require('node:path').resolve(__dirname,'../src/seed.json'),'utf8')) as Config;
test('11 scored questions yield 55; category is excluded',()=>{const c=seed();validate(c);const a=Object.fromEntries(c.questions.map(q=>[q.id,q.options[0].id]));assert.deepEqual(calculate(c,a),{score:55,category:'vaqt'});});
test('missing or forged answers rejected',()=>{const c=seed();assert.throws(()=>calculate(c,{}));const a=Object.fromEntries(c.questions.map(q=>[q.id,'forged']));assert.throws(()=>calculate(c,a));});
test('invalid scores, duplicate ids and malformed category keys rejected',()=>{let c=seed();c.questions[0].options[0].score=-1;assert.throws(()=>validate(c));c=seed();c.questions[1].id=c.questions[0].id;assert.throws(()=>validate(c));c=seed();c.questions[8].options[0].key='bad_payload';assert.throws(()=>validate(c));});
test('multiple category questions rejected',()=>{const c=seed();c.questions[0].type='category';assert.throws(()=>validate(c));});

