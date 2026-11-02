import {test} from 'node:test';
import assert from 'node:assert/strict';
import {parseAdminIds,encryptBotToken,decryptBotToken,validSiteUrl} from './bot-credentials';
test('admin IDs parse from the panel without silently accepting malformed entries',()=>{
 assert.deepEqual(parseAdminIds('123456789, 987654321\n123456789'),[123456789,987654321]);
 for(const value of ['-1','abc','1.5','123abc','9007199254740992',{},[0],Array(51).fill(1)])assert.throws(()=>parseAdminIds(value));
});
test('stored bot credentials are encrypted and authenticated',()=>{
 const secret='s'.repeat(32),token='12345:'+'a'.repeat(30),encrypted=encryptBotToken(token,secret);
 assert.ok(!encrypted.includes(token));assert.equal(decryptBotToken(encrypted,secret),token);
 assert.throws(()=>decryptBotToken(encrypted,'x'.repeat(32)));assert.throws(()=>encryptBotToken(token,'short'));
});
test('public site URL rejects credentials and non-web schemes',()=>{
 assert.equal(validSiteUrl('https://example.com/'),'https://example.com');
 for(const url of ['javascript:alert(1)','ftp://example.com','https://user:pass@example.com','https://example.com?token=secret','invalid'])assert.throws(()=>validSiteUrl(url));
});
