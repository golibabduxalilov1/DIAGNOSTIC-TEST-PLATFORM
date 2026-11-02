import {test} from 'node:test';
import assert from 'node:assert/strict';
import {allowedOrigin} from './origin';
test('development accepts localhost and IPv4 loopback on the configured port',()=>{
 assert.equal(allowedOrigin('http://localhost:3000','http://127.0.0.1:3000',false),true);
 assert.equal(allowedOrigin('http://127.0.0.1:3000','http://localhost:3000',false),true);
});
test('origin protection rejects unrelated hosts, ports, protocols and missing origins',()=>{
 for(const origin of [undefined,'null','http://evil.example:3000','http://localhost:3001','https://localhost:3000','http://localhost:3000/','http://localhost.evil.example:3000'])assert.equal(allowedOrigin(origin,'http://127.0.0.1:3000',false),false);
 assert.equal(allowedOrigin('http://localhost:3000','https://example.com',false),false);
});
test('production requires the exact configured origin',()=>{
 assert.equal(allowedOrigin('http://localhost:3000','http://127.0.0.1:3000',true),false);
 assert.equal(allowedOrigin('https://example.com','https://example.com',true),true);
});
