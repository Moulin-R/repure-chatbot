// api/log.js  (Vercel, CommonJS)
//
// 書き込み先は2つ、それぞれ列の構成が違う点に注意:
//
//  ① 本部の「Rena管理用データベース」(14項目・複数サロンをまとめて管理する用)
//     相談タイトル(title) / 店舗名 / 相談日時 / 相談カテゴリー /
//     お客様の悩み / お客様の要望 / 相談内容 / AI回答 / 要約 /
//     対応状況 / 経営改善のヒント / 資料・発信への活用案 / スタッフの気づき / セッションID
//
//  ② レブレさんの「Rena相談記録」(マニュアル通りの11項目・レブレさん単独用)
//     相談の要約(title) / 相談日時 / お客様の質問 / Renaの回答 / 相談カテゴリー /
//     お客様の悩み・要望 / 経営改善のヒント / 資料・発信への活用案 / 対応状況 / スタッフの気づき / セッションID
//
// 必要な環境変数（Vercelに設定後、必ずRedeployすること）:
//   ANTHROPIC_API_KEY           - 要約・分類などのAI生成に使う鍵
//   NOTION_API_KEY              - 本部のNotion統合キー
//   NOTION_DATABASE_ID          - 本部の「Rena管理用データベース」のID
//   NOTION_API_KEY_PARTNER      - レブレさんのNotion統合キー
//   NOTION_DATABASE_ID_PARTNER  - レブレさんの「Rena相談記録」のID
//   SALON_NAME                  - このチャットbotがどのサロン用かを表す文字列（未設定なら"レブレ"）
//
// 片方の環境変数が未設定・書き込み失敗でも、もう片方の保存は独立して継続する。

const NOTION_VERSION = "2022-06-28";
const ANTHROPIC_VERSION = "2023-06-01";
const ANTHROPIC_MODEL = "claude-haiku-4-5-20251001"; // 短い分類・要約タスクなので高速・低コストなHaikuを使用

const CATEGORY_OPTIONS = [
  "ヘアケア・髪の悩み",
  "メニュー・施術",
  "料金",
  "予約・来店",
  "商品・店販",
  "その他",
];

function chunkText(text, size = 1900) {
  const str = String(text ?? "");
  const chunks = [];
  for (let i = 0; i < str.length; i += size) chunks.push(str.slice(i, i + size));
  return chunks.length > 0 ? chunks : [""];
}

function toRichText(text) {
  return chunkText(text).map((chunk) => ({ type: "text", text: { content: chunk } }));
}

// ---- 1. 会話からAIで各項目を生成 ----
async function generateInsights(userMessage, assistantMessage) {
  const fallback = {
    title: userMessage.slice(0, 20) || "ご相談",
    summary: userMessage.slice(0, 60) || "",
    category: "その他",
    needs: "",
    wants: "",
    improvementHint: "",
    contentIdea: "",
  };

  if (!process.env.ANTHROPIC_API_KEY) return fallback;

  const prompt = `以下はサロンのチャットボット「Rena」とお客様の会話です。この内容を読んで、指定した項目をJSON形式のみで出力してください。説明文やコードブロックの記号は一切付けないでください。

【お客様の質問】
${userMessage}

【Renaの回答】
${assistantMessage}

出力するJSONのキーと内容:
- title: 相談内容を20文字以内で表した短い見出し
- summary: 相談内容を1〜2文で説明した少し詳しめの要約
- category: 次の6つの中から最も近いものを1つだけ選ぶ（この文字列と完全に一致させる）: ${CATEGORY_OPTIONS.join(" / ")}
- needs: お客様が抱えている悩みを1文で
- wants: お客様がしてほしいこと・要望を1文で
- improvementHint: サロンの経営改善に活かせるヒントを1〜2文で
- contentIdea: 資料作りや発信に活用できるアイデアを1〜2文で`;

  try {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": process.env.ANTHROPIC_API_KEY,
        "anthropic-version": ANTHROPIC_VERSION,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: ANTHROPIC_MODEL,
        max_tokens: 600,
        messages: [{ role: "user", content: prompt }],
      }),
    });
    const data = await res.json();
    const text = (data?.content || [])
      .filter((b) => b.type === "text")
      .map((b) => b.text)
      .join("")
      .trim()
      .replace(/^```json/i, "")
      .replace(/```$/, "")
      .trim();

    const parsed = JSON.parse(text);
    const category = CATEGORY_OPTIONS.includes(parsed.category) ? parsed.category : "その他";

    return {
      title: String(parsed.title || fallback.title).slice(0, 60),
      summary: String(parsed.summary || fallback.summary),
      category,
      needs: String(parsed.needs || ""),
      wants: String(parsed.wants || ""),
      improvementHint: String(parsed.improvementHint || ""),
      contentIdea: String(parsed.contentIdea || ""),
    };
  } catch (err) {
    console.error("generateInsights error:", err);
    return fallback;
  }
}

async function createNotionPage(apiKey, databaseId, properties) {
  if (!apiKey || !databaseId) return { ok: false, reason: "not_configured" };
  try {
    const res = await fetch("https://api.notion.com/v1/pages", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Notion-Version": NOTION_VERSION,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        parent: { type: "database_id", database_id: databaseId },
        properties,
      }),
    });
    const data = await res.json();
    if (!res.ok) {
      console.error("Notion create page error:", data);
      return { ok: false, reason: "notion_error", detail: data };
    }
    return { ok: true, pageId: data.id };
  } catch (err) {
    console.error("createNotionPage error:", err);
    return { ok: false, reason: "exception", detail: String(err) };
  }
}

// ---- ① 本部「Rena管理用データベース」向け(14項目・店舗名あり) ----
function buildHqProperties({ salonName, sessionId, userMessage, assistantMessage, insights }) {
  return {
    相談タイトル: { title: [{ type: "text", text: { content: insights.title || "ご相談" } }] },
    店舗名: { rich_text: toRichText(salonName) },
    相談日時: { date: { start: new Date().toISOString() } },
    相談カテゴリー: { select: { name: insights.category } },
    "お客様の悩み": { rich_text: toRichText(insights.needs) },
    "お客様の要望": { rich_text: toRichText(insights.wants) },
    相談内容: { rich_text: toRichText(userMessage) },
    AI回答: { rich_text: toRichText(assistantMessage) },
    要約: { rich_text: toRichText(insights.summary) },
    対応状況: { status: { name: "未確認" } },
    経営改善のヒント: { rich_text: toRichText(insights.improvementHint) },
    "資料・発信への活用案": { rich_text: toRichText(insights.contentIdea) },
    // スタッフの気づき は空欄のまま(スタッフが手入力する欄)
    セッションID: { rich_text: toRichText(sessionId) },
  };
}

// ---- ② レブレさん「Rena相談記録」向け(マニュアル通り11項目・店舗名なし) ----
function buildSalonProperties({ sessionId, userMessage, assistantMessage, insights }) {
  return {
    相談の要約: { title: [{ type: "text", text: { content: insights.title || "ご相談" } }] },
    相談日時: { date: { start: new Date().toISOString() } },
    "お客様の質問": { rich_text: toRichText(userMessage) },
    Renaの回答: { rich_text: toRichText(assistantMessage) },
    相談カテゴリー: { select: { name: insights.category } },
    "お客様の悩み・要望": {
      rich_text: toRichText(
        [insights.needs, insights.wants].filter(Boolean).join(" / ")
      ),
    },
    経営改善のヒント: { rich_text: toRichText(insights.improvementHint) },
    "資料・発信への活用案": { rich_text: toRichText(insights.contentIdea) },
    // スタッフの気づき は空欄のまま
    対応状況: { status: { name: "未確認" } },
    セッションID: { rich_text: toRichText(sessionId) },
  };
}

module.exports = async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const { sessionId, userMessage, assistantMessage } = req.body || {};
  if (!sessionId || !userMessage || !assistantMessage) {
    return res.status(400).json({ error: "sessionId, userMessage, assistantMessage は必須です" });
  }

  const salonName = process.env.SALON_NAME || "レブレ";

  // AI項目は1回だけ生成し、本部・レブレ両方の書き込みで使い回す
  const insights = await generateInsights(userMessage, assistantMessage);

  const [hqResult, salonResult] = await Promise.all([
    createNotionPage(
      process.env.NOTION_API_KEY,
      process.env.NOTION_DATABASE_ID,
      buildHqProperties({ salonName, sessionId, userMessage, assistantMessage, insights })
    ),
    createNotionPage(
      process.env.NOTION_API_KEY_PARTNER,
      process.env.NOTION_DATABASE_ID_PARTNER,
      buildSalonProperties({ sessionId, userMessage, assistantMessage, insights })
    ),
  ]);

  // ロギングの失敗でチャットUIを止めないよう、常に200を返す
  return res.status(200).json({
    ok: hqResult.ok || salonResult.ok,
    hq: hqResult,
    salon: salonResult,
  });
};
