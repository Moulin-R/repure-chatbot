import {checkSchema} from './notion.mjs';
if(!process.env.NOTION_TOKEN||!process.env.NOTION_DATA_SOURCE_ID){console.error('NOTION_TOKEN と NOTION_DATA_SOURCE_ID を環境変数に設定してください。');process.exit(1);}
try{const errors=await checkSchema();if(errors.length){console.error('修正する項目:',errors.join(', '));process.exitCode=1;}else console.log('11項目と選択肢を確認しました。書き込みは行っていません。');}catch {console.error('接続を確認できません。認証・接続先・権限を確認してください。');process.exitCode=1;}
