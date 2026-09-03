//! Tauri commands：把业务层封装成前端可 invoke 的接口。
//! 非流式返回结果；流式通过 app_handle.emit("chat-event", ...) 推事件。

use crate::bing;
use crate::headers;
use crate::openai;
use crate::search;
use crate::store::{AppConfig, ChatSummary};
use serde::Deserialize;
use serde_json::Value;
use std::collections::HashMap;
use tauri::{AppHandle, Emitter};

/// 解析 cURL 头文本 → header 键值表。
fn parse_bing_header(txt: &str) -> HashMap<String, String> {
    if txt.trim().is_empty() {
        return HashMap::new();
    }
    headers::parse_headers_from_curl(txt)
}

fn cookie_map(cookie: &Option<String>, image_only: bool) -> HashMap<String, String> {
    let mut c = HashMap::new();
    c.insert("IMAGE_ONLY".into(), if image_only { "1" } else { "0" }.into());
    if let Some(cookie) = cookie {
        if !cookie.is_empty() {
            c.insert("cookie".into(), cookie.clone());
        }
    }
    c
}

// ---------------------------------------------------------------------------
// 配置 / 历史
// ---------------------------------------------------------------------------

#[tauri::command]
pub fn load_config(app: AppHandle) -> Result<AppConfig, String> {
    crate::store::AppStore::load_config(&app)
}

#[tauri::command]
pub fn save_config(app: AppHandle, config: AppConfig) -> Result<(), String> {
    crate::store::AppStore::save_config(&app, &config)
}

#[tauri::command]
pub fn list_chats(app: AppHandle) -> Result<Vec<ChatSummary>, String> {
    crate::store::AppStore::list_chats(&app)
}

#[tauri::command]
pub fn save_chat(app: AppHandle, chat: ChatSummary) -> Result<(), String> {
    crate::store::AppStore::save_chat(&app, &chat)
}

#[tauri::command]
pub fn rename_chat(app: AppHandle, id: String, name: String) -> Result<(), String> {
    crate::store::AppStore::rename_chat(&app, &id, &name)
}

#[tauri::command]
pub fn delete_chat(app: AppHandle, id: String) -> Result<(), String> {
    crate::store::AppStore::delete_chat(&app, &id)
}

// ---------------------------------------------------------------------------
// 搜索
// ---------------------------------------------------------------------------

#[tauri::command]
pub async fn search(
    q: String,
    provider: Option<String>,
    serper_api_key: Option<String>,
    tavily_api_key: Option<String>,
) -> Result<Vec<search::SearchResult>, String> {
    search::search(
        &q,
        provider.as_deref().unwrap_or("free"),
        serper_api_key.as_deref().unwrap_or(""),
        tavily_api_key.as_deref().unwrap_or(""),
    )
    .await
}

// ---------------------------------------------------------------------------
// OpenAI
// ---------------------------------------------------------------------------

#[derive(Debug, Deserialize)]
pub struct OpenAIArgs {
    pub base_url: String,
    pub api_key: String,
    pub model: String,
    /// 组装好的 messages（text 数组，或带 image_url 的 content 部件数组）。
    pub messages: Vec<Value>,
    pub tone: String,
    pub style_params: Option<Value>,
    pub use_kimi_search: bool,
    pub partial_prefix: Option<String>,
}

/// 非流式：返回 content 字符串。
#[tauri::command]
pub async fn openai_chat(args: OpenAIArgs) -> Result<String, String> {
    let req = openai::OpenAIRequest {
        base_url: args.base_url,
        api_key: args.api_key,
        model: args.model,
        messages: args.messages,
        stream: false,
        tone: args.tone,
        style_params: args.style_params,
        use_kimi_search: args.use_kimi_search,
        partial_prefix: args.partial_prefix.unwrap_or_default(),
    };
    openai::complete_once(&req).await
}

/// 流式主回答：逐帧 emit "chat-event"（payload 形如 {type, data}）。
#[tauri::command]
pub async fn stream_openai(app: AppHandle, args: OpenAIArgs) -> Result<(), String> {
    let req = openai::OpenAIRequest {
        base_url: args.base_url,
        api_key: args.api_key,
        model: args.model,
        messages: args.messages,
        stream: true,
        tone: args.tone,
        style_params: args.style_params,
        use_kimi_search: args.use_kimi_search,
        partial_prefix: args.partial_prefix.unwrap_or_default(),
    };
    let mut text = req.partial_prefix.clone();
    let mut reasoning_text = String::new();
    let show_thinking = req
        .style_params
        .as_ref()
        .and_then(|s| s.get("showThinking"))
        .and_then(|v| v.as_bool())
        .unwrap_or(false);

    openai::stream_sse(&req, |data| {
        let Ok(json) = serde_json::from_str::<Value>(data) else { return };
        let Some(delta) = json.pointer("/choices/0/delta").cloned() else { return };
        let content = delta.get("content").and_then(|v| v.as_str()).unwrap_or("").to_string();
        let reasoning = delta
            .get("reasoning_content")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .to_string();
        let reasoning_payload = if show_thinking { Value::String(reasoning_text.clone()) } else { Value::Null };
        if !content.is_empty() {
            text.push_str(&content);
            let _ = app.emit(
                "chat-event",
                serde_json::json!({
                    "type": "UPDATE_ANSWER",
                    "data": { "text": text, "reasoning": reasoning_payload }
                }),
            );
        } else if !reasoning.is_empty() {
            reasoning_text.push_str(&reasoning);
            if show_thinking {
                let _ = app.emit(
                    "chat-event",
                    serde_json::json!({
                        "type": "UPDATE_ANSWER",
                        "data": { "text": text, "reasoning": reasoning_text }
                    }),
                );
            }
        }
    })
    .await?;

    // 思考可能无 content 伴随，补发一次
    if show_thinking && !reasoning_text.is_empty() {
        let _ = app.emit(
            "chat-event",
            serde_json::json!({
                "type": "UPDATE_ANSWER",
                "data": { "text": text, "reasoning": reasoning_text }
            }),
        );
    }
    let _ = app.emit("chat-event", serde_json::json!({ "type": "DONE" }));
    Ok(())
}

// ---------------------------------------------------------------------------
// Bing（新必应）
// ---------------------------------------------------------------------------

#[derive(Debug, Deserialize)]
pub struct BingSessionArgs {
    pub bing_header: String,
    pub image_only: Option<bool>,
    pub conversation_id: Option<String>,
    pub cookie: Option<String>,
}

#[tauri::command]
pub async fn bing_create_conversation(
    args: BingSessionArgs,
) -> Result<bing::ConversationResp, String> {
    let bh = parse_bing_header(&args.bing_header);
    let cookies = cookie_map(&args.cookie, args.image_only.unwrap_or(true));
    bing::create_conversation(&bh, &cookies, args.image_only.unwrap_or(true), args.conversation_id.as_deref()).await
}

#[derive(Debug, Deserialize)]
pub struct BingStreamArgs {
    pub bing_header: String,
    pub image_only: Option<bool>,
    /// 会话上下文（含 conversationId / signature / invocationId / prompt 等）。
    pub conversation: Value,
    pub bing_source: Option<String>,
    pub cookie: Option<String>,
}

/// 流式对话：连接 ChatHub，解析事件后 emit "chat-event"。
#[tauri::command]
pub async fn stream_bing(app: AppHandle, args: BingStreamArgs) -> Result<(), String> {
    let bh = parse_bing_header(&args.bing_header);
    let use_m = args.image_only.unwrap_or(true);
    let cookies = cookie_map(&args.cookie, use_m);
    let headers = headers::create_headers(&bh, &cookies, use_m);
    bing::stream_chathub(&args.conversation, headers, args.bing_source, |frame| {
        if let Some((name, payload)) = bing::parse_events(frame) {
            let _ = app.emit("chat-event", serde_json::json!({ "type": name, "data": payload }));
        }
    })
    .await
}

#[derive(Debug, Deserialize)]
pub struct BingUploadArgs {
    pub bing_header: String,
    pub image_only: Option<bool>,
    pub knowledge_request: Value,
    pub image_base64: String,
    pub cookie: Option<String>,
}

#[tauri::command]
pub async fn bing_upload_image(args: BingUploadArgs) -> Result<String, String> {
    let bh = parse_bing_header(&args.bing_header);
    let use_m = args.image_only.unwrap_or(true);
    let cookies = cookie_map(&args.cookie, use_m);
    bing::upload_image(&bh, &cookies, use_m, &args.knowledge_request, &args.image_base64).await
}

#[derive(Debug, Deserialize)]
pub struct BingCreateImageArgs {
    pub bing_header: String,
    pub image_only: Option<bool>,
    pub prompt: String,
    pub id: String,
    pub cookie: Option<String>,
}

#[tauri::command]
pub async fn bing_create_image(args: BingCreateImageArgs) -> Result<String, String> {
    let bh = parse_bing_header(&args.bing_header);
    let use_m = args.image_only.unwrap_or(true);
    let cookies = cookie_map(&args.cookie, use_m);
    bing::create_image(&bh, &cookies, use_m, &args.prompt, &args.id).await
}

#[derive(Debug, Deserialize)]
pub struct BlobGatewayArgs {
    pub bing_header: String,
    pub image_only: Option<bool>,
    pub bcid: String,
    pub cookie: Option<String>,
}

#[tauri::command]
pub async fn blob_gateway(args: BlobGatewayArgs) -> Result<String, String> {
    let bh = parse_bing_header(&args.bing_header);
    let use_m = args.image_only.unwrap_or(true);
    let cookies = cookie_map(&args.cookie, use_m);
    bing::blob_gateway(&bh, &cookies, use_m, &args.bcid).await
}