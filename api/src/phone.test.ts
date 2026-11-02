import {test} from 'node:test';
import assert from 'node:assert/strict';
import {normalizePhone} from './phone';
test('phone formatting preserves the same login identity',()=>{
 for(const phone of ['+9930717225','9930717225','+993 (07) 17-225'])assert.equal(normalizePhone(phone),'9930717225');
});
test('missing, malformed and oversized phone numbers are rejected',()=>{
 for(const phone of [undefined,null,9930717225,'','123','+000000000','+993abc0717225','++9930717225','1'.repeat(33)])assert.equal(normalizePhone(phone),null);
 assert.notEqual(normalizePhone('+9930717226'),normalizePhone('+9930717225'));
});
