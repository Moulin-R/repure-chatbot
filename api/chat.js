// api/chat.js  (Vercel)
// お客様の質問をAnthropic APIに中継して、Renaの返答を返す。
//
// 【Ver.6の変更点】
//  ・使うモデルを claude-haiku-5-5 に変更(コスト削減。料金が約1/10になる)
//  ・モデル・最大トークン数・考える深さ(effort)は、画面側(index.html)から受け取らず、
//    このファイルで固定する。設定ミスや不正利用を防げて、今後のモデル変更もこのファイルだけで済む。
//  ・Haiku 5.5は「考える機能(思考)」が初期状態でオンのため、返答の先頭に思考ブロックが
//    入ることがある。画面側は content[0].text を読む作りなので、文章ブロックだけを返して互換を保つ。
//
// 元に戻したいとき: GitHubでこのファイルの「History」から、Ver.5以前の版を復元する。

const MODEL = "claude-haiku-5-5";
const MAX_TOKENS = 1500; // 思考の分も含めた上限。通常の返答は3〜5文なので、実際にはもっと短く終わる
const EFFORT = "low";    // 接客チャットは軽い思考で十分。高くするほど遅く・高くなる

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }
  try {
    const { system, messages } = req.body;
    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": process.env.ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: MAX_TOKENS,
        output_config: { effort: EFFORT },
        system,
        messages,
      }),
    });
    const data = await response.json();
    // 思考ブロックなどを除き、文章だけを返す(画面側が content[0].text を読むため)
    if (Array.isArray(data.content)) {
      data.content = data.content.filter((b) => b.type === "text");
    }
    res.status(200).json(data);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
}
