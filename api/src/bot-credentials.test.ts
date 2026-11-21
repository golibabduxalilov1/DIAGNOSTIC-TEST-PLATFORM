import {test} from 'node:test';
import assert from 'node:assert/strict';
import {parseAdminIds,validSiteUrl} from './bot-credentials';
test('admin IDs parse from the panel without silently accepting malformed entries',()=>{
 assert.deepEqual(parseAdminIds('123456789, 987654321\n123456789'),[123456789,987654321]);
 for(const value of ['-1','abc','1.5','123abc','9007199254740992',{},[0],Array(51).fill(1)])assert.throws(()=>parseAdminIds(value));
});
test('public site URL rejects credentials and non-web schemes',()=>{
 assert.equal(validSiteUrl('https://example.com/'),'https://example.com');
 for(const url of ['javascript:alert(1)','ftp://example.com','https://user:pass@example.com','https://example.com?token=secret','invalid'])assert.throws(()=>validSiteUrl(url));
});
