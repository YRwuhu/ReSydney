//! 新必应（Sydney）链路：会话创建 + ChatHub WebSocket 流式 + 图片上传/生成/网关。
//! 移植自 src/pages/api/create.ts、sydney.ts、kblob.ts、image.ts、blob.jpg.ts
//! 与 src/lib/bots/bing/{index,utils}.ts。

use crate::headers;
use base64::Engine;
use futures_util::{SinkExt, StreamExt};
use reqwest::header::{HeaderValue, LOCATION};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::HashMap;
use std::time::Duration;

const REC_SEPARATOR: char = '\u{1e}';

/// 会话创建响应（与 ConversationResponse 同构）。
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ConversationResp {
    pub conversation_id: String,
    pub client_id: String,
    pub conversation_signature: String,
    pub encrypted_conversation_signature: Option<String>,
    pub invocation_id: i64,
    pub user_ip_address: Option<String>,
}

fn urlencoding(s: &str) -> String {
    url::form_urlencoded::byte_serialize(s.as_bytes()).collect()
}

fn build_header_map(headers: &HashMap<String, String>) -> reqwest::header::HeaderMap {
    let mut hm = reqwest::header::HeaderMap::new();
    for (k, v) in headers {
        if let Ok(kv) = reqwest::header::HeaderName::from_bytes(k.as_bytes()) {
            if let Ok(val) = HeaderValue::from_str(v) {
                hm.insert(kv, val);
            }
        }
    }
    hm
}

fn parse_conversation(body: &str) -> Result<ConversationResp, String> {
    let json: Value = serde_json::from_str(body).map_err(|e| e.to_string())?;
    let conv_id = json["conversationId"].as_str().unwrap_or_default().to_string();
    let client_id = json["clientId"].as_str().unwrap_or_default().to_string();
    let signature = json["conversationSignature"].as_str().unwrap_or_default().to_string();
    let encrypted = json["encryptedconversationsignature"]
        .as_str()
        .map(|s| s.to_string());
    if conv_id.is_empty() || (signature.is_empty() && encrypted.is_none()) {
        return Err("会话创建失败：缺少 conversationId/签名".into());
    }
    Ok(ConversationResp {
        conversation_id: conv_id,
        client_id,
        conversation_signature: signature,
        encrypted_conversation_signature: encrypted,
        invocation_id: 0,
        user_ip_address: None,
    })
}

/// 创建新必应会话（IP 轮换重试 ≤10 次）。
pub async fn create_conversation(
    bing_header: &HashMap<String, String>,
    cookies: &HashMap<String, String>,
    use_mock: bool,
    conversation_id: Option<&str>,
) -> Result<ConversationResp, String> {
    let client = reqwest::Client::builder().build().map_err(|e| e.to_string())?;
    let mut count = 0;
    loop {
        let headers = headers::create_headers(bing_header, cookies, use_mock);
        let mut url = "https://www.bing.com/turing/conversation/create?bundleVersion=1.1055.8".to_string();
        if let Some(id) = conversation_id {
            if !id.is_empty() {
                url.push_str(&format!("&conversationId={}", urlencoding(id)));
            }
        }
        let ff = headers::random_ip();
        let hm = build_header_map(&headers);
        let resp = client
            .get(&url)
            .headers(hm)
            .header("x-forwarded-for", ff.clone())
            .send()
            .await;
        let body = match resp {
            Ok(r) if r.status().is_success() => r.text().await.unwrap_or_default(),
            _ => {
                count += 1;
                if count >= 10 {
                    return Err("TryLater".into());
                }
                tokio::time::sleep(Duration::from_millis(2000)).await;
                continue;
            }
        };
        match parse_conversation(&body) {
            Ok(mut conv) => {
                conv.user_ip_address = Some(ff);
                return Ok(conv);
            }
            Err(_) => {
                count += 1;
                if count >= 10 {
                    return Err("TryLater".into());
                }
                tokio::time::sleep(Duration::from_millis(2000)).await;
            }
        }
    }
}

/// 流式调用 ChatHub。on_frame 会收到解析后的单条 JSON 帧（不含 RS）。
pub async fn stream_chathub(
    conversation: &Value,
    headers: HashMap<String, String>,
    bing_source: Option<String>,
    mut on_frame: impl FnMut(&str),
) -> Result<(), String> {
    let enc_sig = conversation
        .get("encryptedconversationsignature")
        .or_else(|| conversation.get("encryptedConversationSignature"))
        .and_then(|v| v.as_str());
    let mut uri = "wss://sydney.bing.com/sydney/ChatHub".to_string();
    if let Some(sig) = enc_sig {
        uri.push_str(&format!("?sec_access_token={}", urlencoding(sig)));
    }

    let tmp_cookie = headers.get("cookie").cloned().unwrap_or_default();
    let tmp_ua = headers
        .get("User-Agent")
        .or_else(|| headers.get("user-agent"))
        .cloned()
        .unwrap_or_else(|| headers::DEFAULT_UA.to_string());
    let tmp_ff = headers
        .get("x-forwarded-for")
        .cloned()
        .unwrap_or_else(headers::random_ip);
    let tmp_acc_lan = headers
        .get("Accept-Language")
        .cloned()
        .unwrap_or_else(|| "zh-CN,zh;q=0.9".to_string());

    let mut req = tokio_tungstenite::tungstenite::client::IntoClientRequest::into_client_request(&uri)
        .map_err(|e| e.to_string())?;
    {
        let hdr = req.headers_mut();
        if !tmp_cookie.is_empty() {
            hdr.insert(
                reqwest::header::COOKIE,
                HeaderValue::from_str(&tmp_cookie).map_err(|e| e.to_string())?,
            );
        }
        hdr.insert(
            reqwest::header::USER_AGENT,
            HeaderValue::from_str(&tmp_ua).map_err(|e| e.to_string())?,
        );
        hdr.insert(
            "x-forwarded-for",
            HeaderValue::from_str(&tmp_ff).map_err(|e| e.to_string())?,
        );
        hdr.insert(
            reqwest::header::ACCEPT_LANGUAGE,
            HeaderValue::from_str(&tmp_acc_lan).map_err(|e| e.to_string())?,
        );
    }

    let (mut ws, _) = tokio_tungstenite::connect_async(req)
        .await
        .map_err(|e| format!("ChatHub 连接失败: {e}"))?;

    // 握手三帧
    ws.send(tungstenite::Message::Text(
        format!("{{\"protocol\":\"json\",\"version\":1}}{REC_SEPARATOR}").into(),
    ))
    .await
    .map_err(|e| e.to_string())?;
    ws.send(tungstenite::Message::Text(
        format!("{{\"type\":6}}{REC_SEPARATOR}").into(),
    ))
    .await
    .map_err(|e| e.to_string())?;
    let chat_request = build_chat_request(conversation, bing_source.as_deref().unwrap_or("cib"));
    ws.send(tungstenite::Message::Text(
        format!(
            "{}{REC_SEPARATOR}",
            serde_json::to_string(&chat_request).map_err(|e| e.to_string())?
        )
        .into(),
    ))
    .await
    .map_err(|e| e.to_string())?;

    let mut last_in = std::time::Instant::now();
    loop {
        tokio::select! {
            msg = ws.next() => {
                match msg {
                    Some(Ok(tungstenite::Message::Text(t))) => {
                        last_in = std::time::Instant::now();
                        for f in t.split(REC_SEPARATOR) {
                            let trimmed = f.trim();
                            if trimmed.is_empty() { continue; }
                            if trimmed.starts_with("{\"type\":3") {
                                on_frame(trimmed);
                                return Ok(());
                            }
                            if trimmed.starts_with("{\"type\":6}") || trimmed.starts_with("{\"type\":7}") {
                                ws.send(tungstenite::Message::Text(format!("{trimmed}{REC_SEPARATOR}").into())).await.ok();
                                continue;
                            }
                            on_frame(trimmed);
                        }
                    }
                    Some(Ok(_)) => {}
                    Some(Err(e)) => return Err(e.to_string()),
                    None => return Err("ChatHub 连接关闭".into()),
                }
            }
            _ = tokio::time::sleep(Duration::from_millis(2000)) => {
                if last_in.elapsed() > Duration::from_secs(3) {
                    ws.send(tungstenite::Message::Text(format!("{{\"type\":6}}{REC_SEPARATOR}").into())).await.ok();
                    last_in = std::time::Instant::now();
                }
            }
        }
    }
}

/// 将收到的事件帧（type1/2/3）解析成前向事件（UPDATE_ANSWER / DONE / ERROR 载荷）。
/// 返回 (event_name, payload_json)。
pub fn parse_events(frame: &str) -> Option<(String, Value)> {
    let v: Value = serde_json::from_str(frame).ok()?;
    let t = v.get("type")?.as_i64()?;
    match t {
        3 => Some(("DONE".into(), serde_json::json!({}))),
        1 => {
            let args = v.get("arguments")?.as_array()?;
            let arg = args.first()?;
            let msg = arg.get("messages")?.as_array()?.first()?.clone();
            let mtype = msg.get("messageType").and_then(|m| m.as_str()).unwrap_or("");
            let text = msg.get("text").and_then(|m| m.as_str()).unwrap_or("").to_string();
            let mut data = serde_json::json!({"text": text});
            if mtype.contains("SearchQuery") || mtype.contains("LoaderMessage") {
                data["progressText"] = Value::from(text);
                data["text"] = Value::from("");
            }
            if let Some(th) = arg.get("throttling") {
                data["throttling"] = th.clone();
            }
            Some(("UPDATE_ANSWER".into(), data))
        }
        2 => {
            let item = v.get("item").cloned().unwrap_or_default();
            let messages = item
                .get("messages")
                .and_then(|m| m.as_array())
                .map(|a| a.to_vec())
                .unwrap_or_default();
            if let Some(res) = item.get("result") {
                let value = res.get("value").and_then(|x| x.as_str()).unwrap_or("");
                if value == "Throttled" || value == "CaptchaChallenge" {
                    return Some(("ERROR".into(), serde_json::json!({"message": value})));
                }
            }
            let limited = messages.iter().any(|m| {
                m.get("contentOrigin").and_then(|x| x.as_str()) == Some("TurnLimiter")
                    || m.get("messageType").and_then(|x| x.as_str()) == Some("Disengaged")
            });
            if limited {
                return Some(("ERROR".into(), serde_json::json!({"message": "conversation limit"})));
            }
            if let Some(last) = messages.last() {
                let text = markdown_from_message(last);
                let mut data = serde_json::json!({"text": text});
                if let Some(th) = item.get("throttling") {
                    data["throttling"] = th.clone();
                }
                if let Some(attr) = last.get("sourceAttributions") {
                    if attr.as_array().map(|a| !a.is_empty()).unwrap_or(false) {
                        data["sourceAttributions"] = attr.clone();
                    }
                }
                if let Some(sugg) = last.get("suggestedResponses") {
                    data["suggestedResponses"] = sugg.clone();
                }
                return Some(("UPDATE_ANSWER".into(), data));
            }
            None
        }
        _ => None,
    }
}

/// 从 ChatResponseMessage 的 adaptiveCards 第一块 TextBlock 提取文本。
fn markdown_from_message(msg: &Value) -> String {
    if let Some(cards) = msg.get("adaptiveCards").and_then(|c| c.as_array()) {
        for card in cards {
            if let Some(body) = card.get("body").and_then(|b| b.as_array()) {
                for block in body {
                    if block.get("type").and_then(|t| t.as_str()) == Some("TextBlock") {
                        return block.get("text").and_then(|x| x.as_str()).unwrap_or("").to_string();
                    }
                }
            }
        }
    }
    msg.get("text").and_then(|x| x.as_str()).unwrap_or("").to_string()
}

fn build_chat_request(conversation: &Value, source: &str) -> Value {
    let tone = conversation
        .get("conversationStyle")
        .or_else(|| conversation.get("tone"))
        .and_then(|v| v.as_str())
        .unwrap_or("Balanced");
    let option_sets: &[&str] = match tone {
        "Creative" => CIB_CREATIVE,
        "Precise" => CIB_PRECISE,
        _ => CIB_BALANCED,
    };
    let invocation_id = conversation
        .get("invocationId")
        .and_then(|v| v.as_i64())
        .unwrap_or(0);
    serde_json::json!({
        "arguments": [{
            "source": source,
            "optionsSets": option_sets,
            "allowedMessageTypes": [
                "ActionRequest","Chat","Context","InternalSearchQuery","InternalSearchResult",
                "Disengaged","InternalLoaderMessage","Progress","RenderCardRequest","SemanticSerp",
                "GenerateContentQuery","SearchQuery"
            ],
            "sliceIds": [
                "gbaa","gba","emovoice","tts3cf","kcinherocf","inochatv2","wrapnoins","mlchatpc9000ns",
                "mlchatpcbase","sydconfigoptt","803iyjbexps0","0529streamws0","178gentechs0","0901utilbal",
                "attr2atral3","821iypapyrust","019hlthgrd","829suggtrim","821fluxv13s0","727nrprdrt3"
            ],
            "isStartOfSession": invocation_id == 0,
            "message": {
                "author": "user",
                "inputMethod": "Keyboard",
                "text": conversation.get("prompt").and_then(|v| v.as_str()).unwrap_or(""),
                "messageType": "Chat",
                "locale": "zh-CN",
                "market": "zh-CN",
                "region": "US",
                "location": "lat:47.639557;long:-122.128159;re=1000m;",
                "timestamp": timestamp_now()
            },
            "conversationId": conversation.get("conversationId").and_then(|v| v.as_str()).unwrap_or(""),
            "conversationSignature": conversation.get("conversationSignature").and_then(|v| v.as_str()).unwrap_or(""),
            "participant": { "id": conversation.get("clientId").and_then(|v| v.as_str()).unwrap_or("") },
            "scenario": "SERP",
            "tone": tone
        }],
        "invocationId": invocation_id.to_string(),
        "target": "chat",
        "type": 4
    })
}

fn timestamp_now() -> String {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis().to_string())
        .unwrap_or_default()
}

// ---------------------------------------------------------------------------
// 图片链路
// ---------------------------------------------------------------------------

fn build_image_headers(bing_header: &HashMap<String, String>, cookies: &HashMap<String, String>, use_mock: bool) -> HashMap<String, String> {
    let mut h = headers::create_headers(bing_header, cookies, use_mock);
    h.insert("referer".into(), "https://www.bing.com/search?q=Bing+AI&showconv=1".into());
    h
}

/// 上传图片到必应 kblob，返回 blobId。
pub async fn upload_image(
    bing_header: &HashMap<String, String>,
    cookies: &HashMap<String, String>,
    use_mock: bool,
    knowledge_request: &Value,
    image_base64: &str,
) -> Result<String, String> {
    let client = reqwest::Client::builder().build().map_err(|e| e.to_string())?;
    let hdrs = build_image_headers(bing_header, cookies, use_mock);
    let mut form = reqwest::multipart::Form::new();
    form = form.text("knowledgeRequest", serde_json::to_string(knowledge_request).map_err(|e| e.to_string())?);
    if !image_base64.is_empty() {
        form = form.text("imageBase64", image_base64.to_string());
    }
    let mut req = client
        .post("https://www.bing.com/images/kblob")
        .multipart(form);
    for (k, v) in &hdrs {
        if let Ok(kv) = reqwest::header::HeaderName::from_bytes(k.as_bytes()) {
            if let Ok(val) = HeaderValue::from_str(v) {
                req = req.header(kv, val);
            }
        }
    }
    let resp = req.send().await.map_err(|e| format!("图片上传失败: {e}"))?;
    if !resp.status().is_success() {
        return Err(format!("图片上传失败: {}", resp.status()));
    }
    let text = resp.text().await.map_err(|e| e.to_string())?;
    let json: Value = serde_json::from_str(&text).map_err(|e| e.to_string())?;
    json["blobId"]
        .as_str()
        .map(|s| s.to_string())
        .ok_or_else(|| "上传响应缺少 blobId".into())
}

/// 必应文生图：HEAD 拿 id → 轮询 async/results 抓图，返回 markdown 串。
pub async fn create_image(
    bing_header: &HashMap<String, String>,
    cookies: &HashMap<String, String>,
    use_mock: bool,
    prompt: &str,
    id: &str,
) -> Result<String, String> {
    let client = reqwest::Client::builder()
        .redirect(reqwest::redirect::Policy::none())
        .build()
        .map_err(|e| e.to_string())?;
    let hdrs = build_image_headers(bing_header, cookies, use_mock);

    let head_url = format!(
        "https://www.bing.com/images/create?partner=sydney&showselective=1&sude=1&kseed=8500&SFX=4&q={}&iframeid={}",
        urlencoding(prompt),
        id
    );
    let mut head_req = client.head(&head_url);
    for (k, v) in &hdrs {
        if let Ok(kv) = reqwest::header::HeaderName::from_bytes(k.as_bytes()) {
            if let Ok(val) = HeaderValue::from_str(v) {
                head_req = head_req.header(kv, val);
            }
        }
    }
    let head_resp = head_req.send().await.map_err(|e| e.to_string())?;
    let location = head_resp
        .headers()
        .get(LOCATION)
        .and_then(|v| v.to_str().ok())
        .unwrap_or_default()
        .to_string();
    let result_id = regex::Regex::new(r"&id=([^&]+)$")
        .unwrap()
        .captures(&location)
        .map(|c| c[1].to_string())
        .ok_or_else(|| "没有登录或登录已过期".to_string())?;

    let poll_url = format!(
        "https://www.bing.com/images/create/async/results/{result_id}?q={}&partner=sydney&showselective=1&IID=images.as",
        urlencoding(prompt)
    );
    for _ in 0..10 {
        tokio::time::sleep(Duration::from_millis(3000)).await;
        let mut poll_req = client.get(&poll_url);
        for (k, v) in &hdrs {
            if let Ok(kv) = reqwest::header::HeaderName::from_bytes(k.as_bytes()) {
                if let Ok(val) = HeaderValue::from_str(v) {
                    poll_req = poll_req.header(kv, val);
                }
            }
        }
        let Ok(resp) = poll_req.send().await else { continue };
        let content_length = resp
            .headers()
            .get(reqwest::header::CONTENT_LENGTH)
            .and_then(|v| v.to_str().ok())
            .and_then(|s| s.parse::<u64>().ok())
            .unwrap_or(0);
        if content_length <= 1 {
            continue;
        }
        let text = resp.text().await.unwrap_or_default();
        let re = regex::Regex::new(r#"(?is)<img class="mimg"[^>]*src="([^"]+)"#).unwrap();
        let imgs: Vec<String> = re
            .captures_iter(&text)
            .filter_map(|c| c.get(1).map(|m| m.as_str().replace("&amp;", "&")))
            .collect();
        if !imgs.is_empty() {
            return Ok(imgs
                .into_iter()
                .map(|u| format!("![{prompt}]({u})"))
                .collect::<Vec<_>>()
                .join(" "));
        }
    }
    Err("图片生成超时".into())
}

/// blob 网关：GET bing 图片 blob，返回 base64（前端拼 data URL 显示）。
pub async fn blob_gateway(
    bing_header: &HashMap<String, String>,
    cookies: &HashMap<String, String>,
    use_mock: bool,
    bcid: &str,
) -> Result<String, String> {
    let client = reqwest::Client::builder().build().map_err(|e| e.to_string())?;
    let hdrs = build_image_headers(bing_header, cookies, use_mock);
    let url = format!("https://www.bing.com/images/blob?bcid={}", urlencoding(bcid));
    let mut req = client.get(&url);
    for (k, v) in &hdrs {
        if let Ok(kv) = reqwest::header::HeaderName::from_bytes(k.as_bytes()) {
            if let Ok(val) = HeaderValue::from_str(v) {
                req = req.header(kv, val);
            }
        }
    }
    let resp = req.send().await.map_err(|e| e.to_string())?;
    if !resp.status().is_success() {
        return Err(format!("blob 获取失败: {}", resp.status()));
    }
    let bytes = resp.bytes().await.map_err(|e| e.to_string())?;
    Ok(base64::engine::general_purpose::STANDARD.encode(bytes))
}

const CIB_BALANCED: &[&str] = &[
    "nlu_direct_response_filter", "deepleo", "disable_emoji_spoken_text", "responsible_ai_policy_235",
    "enablemm", "dv3sugg", "machine_affinity", "autosave", "iyxapbing", "iycapbing", "galileo", "saharagenconv5",
    "uquopt", "gcccomp", "utildv3tosah", "cpcandi", "cpcatral3", "cpcatro50", "cpcfmql", "cpcgnddi", "cpcmattr2",
    "cpcmcit1", "e2ecacheread", "nocitpass", "iypapyrus", "hlthcndans", "dv3suggtrim", "eredirecturl",
];
const CIB_CREATIVE: &[&str] = &[
    "nlu_direct_response_filter", "deepleo", "disable_emoji_spoken_text", "responsible_ai_policy_235",
    "enablemm", "dv3sugg", "machine_affinity", "autosave", "iyxapbing", "iycapbing", "h3imaginative", "uquopt",
    "gcccomp", "utildv3tosah", "cpcandi", "cpcatral3", "cpcatro50", "cpcfmql", "cpcgnddi", "cpcmattr2", "cpcmcit1",
    "e2ecacheread", "nocitpass", "iypapyrus", "hlthcndans", "dv3suggtrim", "eredirecturl", "clgalileo", "gencontentv3",
];
const CIB_PRECISE: &[&str] = &[
    "nlu_direct_response_filter", "deepleo", "disable_emoji_spoken_text", "responsible_ai_policy_235",
    "enablemm", "dv3sugg", "machine_affinity", "autosave", "iyxapbing", "iycapbing", "h3precise", "clgalileo",
    "gencontentv3", "uquopt", "gcccomp", "utildv3tosah", "cpcandi", "cpcatral3", "cpcatro50", "cpcfmql", "cpcgnddi",
    "cpcmattr2", "cpcmcit1", "e2ecacheread", "nocitpass", "iypapyrus", "hlthcndans", "dv3suggtrim", "eredirecturl",
];