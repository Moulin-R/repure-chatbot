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
    return res.status(errors.length ? 503 : 200).json({ok:errors.length === 0,errors,loggingEnabled:process.env.NOTION_LOGGING_ENABLED === 'true'});
  } catch {
    return res.status(503).json({ok:false,error:'Notion connection check failed'});
  }
}
