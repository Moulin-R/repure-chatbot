import { checkSchema } from '../notion.mjs';

// Read-only setup check. Never expose tokens or customer records.
export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (process.env.VERCEL_ENV !== 'preview') return res.status(404).json({error:'Not found'});
  if (req.method !== 'GET') return res.status(405).json({error:'Method not allowed'});
  const missing = ['NOTION_TOKEN','NOTION_DATA_SOURCE_ID','NOTION_SCHEMA_MODE','SALON_NAME'].filter(key => !process.env[key]);
  if (missing.length) return res.status(503).json({ok:false,missing});
  try {
    const errors = await checkSchema();
    res.setHeader('Content-Type','text/html; charset=utf-8');
    const escape = value => String(value).replace(/[&<>"']/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
    return res.status(errors.length ? 503 : 200).send('<!doctype html><meta charset="utf-8"><title>Notion接続確認</title><h1>Notion接続確認</h1><p>' + (errors.length ? '項目の修正が必要です' : '接続と項目を確認できました') + '</p><ul>' + errors.map(error => '<li>' + escape(error) + '</li>').join('') + '</ul><p>記録設定：' + (process.env.NOTION_LOGGING_ENABLED === 'true' ? '有効' : '無効') + '</p>');
  } catch {
    res.setHeader('Content-Type','text/html; charset=utf-8');
    return res.status(503).send('<!doctype html><meta charset="utf-8"><h1>Notionへの接続を確認できません</h1><p>トークン・保存先ID・アクセス権限を確認してください。</p>');
  }
}
