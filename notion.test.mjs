import test from 'node:test';
import assert from 'node:assert/strict';
import {richText,properties,checkSchema,SCHEMA,CATEGORIES} from './notion.mjs';
import handler from './api/chat.js';
const turn={question:'髪の相談',answer:'ご案内します',sessionId:'session_1234567890',date:'2026-09-14T00:00:00.000Z'};
test('長文・絵文字の原文を壊さず保存形式に分割',()=>{const text='髪😊'.repeat(3500);const a=richText(text);assert.equal(a.map(x=>x.text.content).join(''),text);assert.ok(a.every(x=>x.text.content.length<=2000));});
test('11項目、未確認、空メモ、分析失敗を明記',()=>{const p=properties(turn);assert.deepEqual(Object.keys(p).sort(),Object.keys(SCHEMA).sort());assert.equal(p['対応状況'].status.name,'未確認');assert.deepEqual(p['スタッフの気づき'].rich_text,[]);assert.match(p['経営改善のヒント'].rich_text[0].text.content,/要確認/);});
test('AI障害・Notion障害でも回答を返し、書き込みを待つ',async(t)=>{
 process.env.NOTION_LOGGING_ENABLED='true';process.env.NOTION_TOKEN='test';process.env.NOTION_DATA_SOURCE_ID='test';
 t.after(()=>{delete process.env.NOTION_LOGGING_ENABLED;delete process.env.NOTION_TOKEN;delete process.env.NOTION_DATA_SOURCE_ID;});
 let calls=[];t.mock.method(globalThis,'fetch',async(url,opts)=>{calls.push([url,JSON.parse(opts.body)]);if(calls.length===1)return {ok:true,json:async()=>({content:[{type:'text',text:'回答'}]})};return {ok:false,status:503};});
 const res={status(n){this.code=n;return this},json(x){this.body=x;return this}};
 await handler({method:'POST',body:{model:'test',messages:[{role:'user',content:'質問'}],session_id:turn.sessionId}},res);
 assert.equal(res.code,200);assert.equal(res.body.content[0].text,'回答');assert.equal(res.body.session_id,turn.sessionId);assert.equal(calls.length,3);assert.equal(calls[2][0],'https://api.notion.com/v1/pages');
});
test('正常時の保存先はサーバー設定、スタッフ行への更新なし',async(t)=>{
 process.env.NOTION_LOGGING_ENABLED='true';process.env.NOTION_TOKEN='test';process.env.NOTION_DATA_SOURCE_ID='hq';
 t.after(()=>{delete process.env.NOTION_LOGGING_ENABLED;delete process.env.NOTION_TOKEN;delete process.env.NOTION_DATA_SOURCE_ID;});
 const calls=[];t.mock.method(globalThis,'fetch',async(url,opts)=>{calls.push({url,opts});return {ok:true,json:async()=>calls.length===1?{content:[{type:'text',text:'回答'}]}:calls.length===2?{content:[{type:'text',text:JSON.stringify({summary:'相談',category:'その他',need:'',hint:'説明を検討',idea:''})}]}:{id:'saved'}}});
 const res={status(n){this.code=n;return this},json(x){this.body=x;return this}};
 await handler({method:'POST',body:{model:'test',messages:[{role:'user',content:'質問'}],data_source_id:'attacker'}},res);
 assert.equal(res.code,200);assert.equal(JSON.parse(calls[2].opts.body).parent.data_source_id,'hq');assert.ok(calls.every(c=>c.opts.method==='POST'));
});
test('上流エラーを成功扱いせずNotionも呼ばない',async(t)=>{let calls=0;t.mock.method(globalThis,'fetch',async()=>{calls++;return {ok:false,json:async()=>({error:'secret'})}});const res={status(n){this.code=n;return this},json(x){this.body=x;return this}};await handler({method:'POST',body:{messages:[{role:'user',content:'質問'}]}},res);assert.equal(res.code,502);assert.equal(calls,1);assert.ok(!JSON.stringify(res.body).includes('secret'));});
test('項目の型・カテゴリー・未確認を事前チェック',async(t)=>{t.mock.method(globalThis,'fetch',async()=>({ok:true,json:async()=>({properties:{}})}));assert.ok((await checkSchema({NOTION_TOKEN:'test',NOTION_DATA_SOURCE_ID:'hq'})).length>=11);});

test('本部用の既存名称・店舗名に対応しAI要約欄へ書き込まない',async()=>{const {hqProperties,HQ_SCHEMA}=await import('./notion.mjs');const p=hqProperties(turn,'美容室レプレ');assert.deepEqual(Object.keys(p).sort(),Object.keys(HQ_SCHEMA).sort());assert.equal(p['店舗名'].rich_text[0].text.content,'美容室レプレ');assert.equal(p['相談内容'].rich_text[0].text.content,turn.question);assert.ok(!('要約' in p));assert.throws(()=>hqProperties(turn,''));});
