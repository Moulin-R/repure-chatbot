import { randomUUID } from 'node:crypto';
import { analyze, saveTurn } from '../notion.mjs';
export default async function handler(req,res) {
  if(req.method!=='POST')return res.status(405).json({error:'Method not allowed'});
  const {model,max_tokens,system,messages,session_id}=req.body || {};
  if(!Array.isArray(messages)||!messages.length||messages.length>60||messages.some(m=>!['user','assistant'].includes(m.role)||typeof m.content!=='string'||m.content.length>20000)||messages.at(-1).role!=='user')return res.status(400).json({error:'Invalid messages'});
  const sessionId=typeof session_id==='string'&&/^[a-zA-Z0-9_-]{16,100}$/.test(session_id)?session_id:randomUUID();
  const date=new Date().toISOString();
  try {
    const response=await fetch('https://api.anthropic.com/v1/messages',{
      method:'POST',signal:AbortSignal.timeout(30000),headers:{'Content-Type':'application/json','x-api-key':process.env.ANTHROPIC_API_KEY,'anthropic-version':'2023-06-01'},
      body:JSON.stringify({model,max_tokens,system,messages})
    });
    const data=await response.json();
    if(!response.ok)return res.status(502).json({error:'AI service unavailable'});
    const answer=data.content?.filter(x=>x.type==='text').map(x=>x.text).join('\n');
    if(!answer)return res.status(502).json({error:'Empty AI response'});
    if(process.env.NOTION_LOGGING_ENABLED==='true') {
      if(!process.env.NOTION_TOKEN||!process.env.NOTION_DATA_SOURCE_ID) {
        console.error('rena_notion_configuration_missing');
      } else {
        const question=messages.at(-1).content;
        let insights;
        try {insights=await analyze(question,answer,process.env.NOTION_ANALYSIS_MODEL||model);}catch {console.error('rena_notion_analysis_failed');}
        // Await persistence before returning: serverless execution can stop after res.json.
        // Create only; never overwrite a previous row's staff memo or status.
        try {await saveTurn({question,answer,sessionId,date,insights});}catch {console.error('rena_notion_save_failed');}
      }
    }
    return res.status(200).json({...data,session_id:sessionId});
  } catch {return res.status(502).json({error:'AI service unavailable'});}
}
