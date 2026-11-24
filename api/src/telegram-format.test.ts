import {test} from 'node:test';
import assert from 'node:assert/strict';
import {telegramHtmlError,escapeTelegramText} from './telegram-format';
import {defaultResultMessages,resultMessage} from './result-message';
import {validate,Config} from './domain';
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';

test('Telegram formats accept supported formatting, links and dates',()=>{
 for(const text of Object.values(defaultResultMessages))assert.equal(telegramHtmlError(text),null);
 for(const text of ['<b><i>Matn</i></b>','<u>Matn</u><s>Matn</s>','<blockquote>Iqtibos</blockquote>','<code>kod</code>','<tg-spoiler>Sir</tg-spoiler>','<a href="https://example.com/?a=1&amp;b=2">Link</a>','<tg-time unix="1795518000">Sana</tg-time>'])assert.equal(telegramHtmlError(text),null,text);
});

test('invalid or unsafe formats are rejected before saving',()=>{
 for(const text of ['<script>alert(1)</script>','<b>ochiq','<b><i>x</b></i>','<a href="javascript:alert(1)">x</a>','<a href="https://example.com" onclick="x">x</a>','<code><b>x</b></code>','<blockquote><blockquote>x</blockquote></blockquote>','x & bad','x'.repeat(3801)])assert.ok(telegramHtmlError(text),text);
 assert.equal(escapeTelegramText('<x> & "y"'),'&lt;x&gt; &amp; &quot;y&quot;');
});

test('config validates all three result messages and custom text reaches the chosen result',()=>{
 const config=JSON.parse(readFileSync(resolve(__dirname,'../src/seed.json'),'utf8')) as Config;
 config.resultMessages={low:'<b>Past</b>',medium:'<i>O‘rta</i>',good:'<u>Yuqori</u>'};
 validate(config);
 assert.match(resultMessage(100,100,config.resultMessages),/<u>Yuqori<\/u>/);
 assert.match(resultMessage(50,100,config.resultMessages),/<i>O‘rta<\/i>/);
 assert.match(resultMessage(0,100,config.resultMessages),/<b>Past<\/b>/);
 assert.throws(()=>validate({...config,resultMessages:{...config.resultMessages!,low:'<b>ochiq'}}));
 assert.throws(()=>validate({...config,resultMessages:[] as any}));
});
