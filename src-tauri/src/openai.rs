//! OpenAI 兼容接口：非流式辅助调用 + 流式主回答（SSE）。
//! 由 TS 版 src/lib/bots/openai/index.ts 移植，逻辑在前端 Command 层复用。

use reqwest::Client;
use serde::{Deserialize, Serialize};
use serde_json::Value;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OpenAIRequest {
    pub base_url: String,
    pub api_key: String,
    pub model: String,
    pub messages: Vec<Value>,
    pub stream: bool,
    /// 当前对话样式（Creative/Balanced/Precise）用于选择模型参数。
    pub tone: String,
    pub style_params: Option<Value>,
    /// Kimi 原生联网搜索工具。
    pub use_kimi_search: bool,
    /// Partial Mode 前缀。
    pub partial_prefix: String,
}

/// 把某样式的参数写入请求体。
pub fn apply_model_params(body: &mut Value, tone: &str, style: Option<&Value>) {
    // 优先使用传入的当前样式参数；辅助请求用 Balanced 默认。
    let s = match style {
        Some(v) => v,
        None => {
            // balanced 默认
            &serde_json::json!({"temperature": 1.0, "enableThinking": false})
        }
    };
    let _ = tone;
    if let Some(t) = s.get("temperature").and_then(|t| t.as_f64()) {
        body["temperature"] = Value::from(t);
    }
    if let Some(v) = s.get("topP").and_then(|v| v.as_f64()) {
        body["top_p"] = Value::from(v);
    }
    if let Some(v) = s.get("maxTokens").and_then(|v| v.as_i64()) {
        body["max_tokens"] = Value::from(v);
    }
    if let Some(v) = s.get("frequencyPenalty").and_then(|v| v.as_f64()) {
        body["frequency_penalty"] = Value::from(v);
    }
    if let Some(v) = s.get("presencePenalty").and_then(|v| v.as_f64()) {
        body["presence_penalty"] = Value::from(v);
    }
    if let Some(v) = s.get("enableThinking").and_then(|v| v.as_bool()) {
        if v {
            body["thinking"] = serde_json::json!({"type": "enabled"});
        } else {
            body["thinking"] = serde_json::json!({"type": "disabled"});
        }
    }
    if let Some(v) = s.get("reasoningEffort").and_then(|v| v.as_str()) {
        body["reasoning_effort"] = Value::from(v);
    }
}

/// 非流式单次调用，返回 content 字符串。
pub async fn complete_once(req: &OpenAIRequest) -> Result<String, String> {
    let client = Client::new();
    let mut body = serde_json::json!({
        "model": req.model,
        "stream": false,
        "messages": req.messages,
    });
    apply_model_params(&mut body, "Balanced", None);
    if req.use_kimi_search {
        body["tools"] = serde_json::json!([{ "type": "builtin_function", "function": { "name": "$web_search" } }]);
    }
    let resp = client
        .post(format!("{}/chat/completions", req.base_url.trim_end_matches('/')))
        .header("Content-Type", "application/json")
        .bearer_auth(&req.api_key)
        .json(&body)
        .send()
        .await
        .map_err(|e| e.to_string())?;
    let status = resp.status();
    if !status.is_success() {
        let detail = resp.text().await.unwrap_or_default();
        return Err(format!("接口请求失败 ({}): {}", status, detail));
    }
    let json: Value = resp.json().await.map_err(|e| e.to_string())?;
    Ok(json
        .pointer("/choices/0/message/content")
        .and_then(|v| v.as_str())
        .unwrap_or_default()
        .to_string())
}

/// 逐帧解析 SSE data 行，回调 (data_text)。
pub async fn stream_sse(
    req: &OpenAIRequest,
    mut on_event: impl FnMut(&str),
) -> Result<(), String> {
    let client = Client::new();
    let mut body = serde_json::json!({
        "model": req.model,
        "stream": true,
        "messages": req.messages,
    });
    // 主回答用当前样式参数（含 enableThinking/showThinking），不要覆盖为 Balanced
    let style = req.style_params.as_ref();
    apply_model_params(&mut body, &req.tone, style);
    if req.use_kimi_search {
        body["tools"] = serde_json::json!([{ "type": "builtin_function", "function": { "name": "$web_search" } }]);
    }
    let resp = client
        .post(format!("{}/chat/completions", req.base_url.trim_end_matches('/')))
        .header("Content-Type", "application/json")
        .bearer_auth(&req.api_key)
        .json(&body)
        .send()
        .await
        .map_err(|e| e.to_string())?;
    let status = resp.status();
    if !status.is_success() {
        let detail = resp.text().await.unwrap_or_default();
        return Err(format!("接口请求失败 ({}): {}", status, detail));
    }
    let bytes = resp
        .bytes()
        .await
        .map_err(|e| e.to_string())?;
    let text = String::from_utf8_lossy(&bytes).to_string();
    // SSE：每行形如 `data: {...}` 或 `data: [DONE]`，逐行解析即可
    // （OpenAI 兼容接口把 content 内的换行内联进单行 JSON，不跨 data 行）。
    for line in text.lines() {
        let trimmed = line.trim();
        if !trimmed.starts_with("data:") {
            continue;
        }
        let data_str = trimmed[5..].trim();
        if data_str.is_empty() || data_str == "[DONE]" {
            continue;
        }
        on_event(data_str);
    }
    Ok(())
}
