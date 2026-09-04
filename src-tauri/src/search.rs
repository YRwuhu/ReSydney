//! 网络搜索：free（抓取必应结果页）/ Serper / Tavily，附正文提取。
//! 由 TS 版 src/pages/api/search.ts 移植。

use reqwest::header::{HeaderMap, HeaderValue, CONTENT_TYPE, USER_AGENT};
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct SearchResult {
    pub title: String,
    pub url: String,
    pub snippet: String,
    pub content: Option<String>,
}

const UA: &str = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36 Edg/120.0.0.0";
// 移动版 UA：请求 cn.bing.com 移动布局，结果直接携带真实链接，
// 避免桌面版把所有结果包成 bing.com/ck/a JS 混淆跳转导致解析失败、全部被过滤。
const MOBILE_UA: &str = "Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.0 Mobile/15E148 Safari/604.1";
const READ_TIMEOUT_MS: u64 = 8000;
const CONTENT_MAX: usize = 3000;

pub fn normalize_url(raw: &str) -> String {
    raw.replace("&amp;", "&")
}

fn strip_html(html: &str) -> String {
    let re_script = regex::Regex::new(r"(?is)<script[\s\S]*?</script>|<style[\s\S]*?</style>|<noscript[\s\S]*?</noscript>").unwrap();
    let re_tag = regex::Regex::new(r"(?s)<[^>]*>").unwrap();
    let re_space = regex::Regex::new(r"\s+").unwrap();
    let no_scripts = re_script.replace_all(html, "");
    let text = re_tag.replace_all(&no_scripts, " ");
    re_space.replace_all(&text, " ").trim().to_string()
}

/// 免费模式：抓取必应搜索结果页（移动版布局，结果含真实链接）并解析条目。
async fn fetch_bing(client: &reqwest::Client, q: &str) -> Result<Vec<SearchResult>, String> {
    let url = format!("https://cn.bing.com/search?q={}&mkt=zh-CN&setlang=zh-CN", urlencoding(q));
    let resp = client
        .get(&url)
        .header(USER_AGENT, MOBILE_UA)
        .header("Accept-Language", "zh-CN,zh;q=0.9")
        .header("Accept", "text/html,*/*")
        .send()
        .await
        .map_err(|e| e.to_string())?;

    let text = resp.text().await.unwrap_or_default();
    Ok(parse_bing_results(&text))
}

fn urlencoding(s: &str) -> String {
    url::form_urlencoded::byte_serialize(s.as_bytes()).collect()
}

fn parse_bing_results(html: &str) -> Vec<SearchResult> {
    let mut out = Vec::new();
    let re = regex::Regex::new(r#"(?is)<li class="b_algo"[\s\S]*?</li>"#).unwrap();
    // 移动版标题：<div class="b_algoheader"><a href="真实URL" ...><h2>标题</h2></a></div>
    let re_mobile = regex::Regex::new(r#"(?is)<div class="b_algoheader"[^>]*>\s*<a[^>]*href="([^"]+)"[^>]*>[\s\S]*?<h2[^>]*>([\s\S]*?)</h2>"#).unwrap();
    // 桌面版标题：<h2><a href="真实URL" ...>标题</a></h2>
    let re_desktop = regex::Regex::new(r#"(?is)<h2[^>]*><a[^>]*href="([^"]+)"[^>]*>([\s\S]*?)</a>"#).unwrap();
    // 摘要：移动版 <div class="b_caption"><p>…</p></div>，桌面版 <p class="b_caption">…</p>
    let re_caption = regex::Regex::new(r#"(?is)<(?:p|div) class="b_caption"[^>]*>([\s\S]*?)</(?:p|div)>"#).unwrap();
    for cap in re.captures_iter(html) {
        let block = &cap[0];
        let (raw_href, title_html) = if let Some(m) = re_mobile.captures(block) {
            (m[1].to_string(), m[2].to_string())
        } else if let Some(m) = re_desktop.captures(block) {
            (m[1].to_string(), m[2].to_string())
        } else {
            continue;
        };
        // 跳过必应站内图片等非结果链接
        if raw_href.contains("bing.com/images") {
            continue;
        }
        let title = strip_html(&title_html);
        let snippet = re_caption
            .captures(block)
            .map(|c| strip_html(&c[1]))
            .unwrap_or_default();
        let href = normalize_url(&raw_href);
        if href.is_empty() || title.is_empty() {
            continue;
        }
        if out.len() >= 6 {
            break;
        }
        out.push(SearchResult {
            title,
            url: href,
            snippet,
            content: None,
        });
    }
    out
}

async fn fetch_page_content(client: &reqwest::Client, url: &str) -> Option<String> {
    let resp = client
        .get(url)
        .header(USER_AGENT, UA)
        .timeout(std::time::Duration::from_millis(READ_TIMEOUT_MS))
        .send()
        .await
        .ok()?;
    let content_type = resp
        .headers()
        .get(CONTENT_TYPE)
        .and_then(|v| v.to_str().ok())
        .unwrap_or_default()
        .to_string();
    if !content_type.starts_with("text/html") {
        return None;
    }
    let body = resp.text().await.ok()?;
    let text = strip_html(&body);
    if text.trim().len() < 60 {
        return None;
    }
    Some(text.chars().take(CONTENT_MAX).collect())
}

/// 各搜索引擎返回的原始结果（Serper/Tavily），后续统一取前 6 条。
#[derive(Debug, Deserialize)]
struct SerperResp {
    #[serde(default)]
    organic: Vec<SerperItem>,
}
#[derive(Debug, Deserialize)]
struct SerperItem {
    title: String,
    link: String,
    snippet: Option<String>,
}

#[derive(Debug, Deserialize)]
struct TavilyResp {
    #[serde(default)]
    results: Vec<TavilyItem>,
}
#[derive(Debug, Deserialize)]
struct TavilyItem {
    title: String,
    url: String,
    snippet: Option<String>,
    content: Option<String>,
}

/// 对外主入口。
pub async fn search(
    query: &str,
    provider: &str,
    serper_key: &str,
    tavily_key: &str,
) -> Result<Vec<SearchResult>, String> {
    let client = reqwest::Client::builder()
        .build()
        .map_err(|e| e.to_string())?;
    let raw: Vec<SearchResult> = match provider {
        "serper" => {
            let mut hm = HeaderMap::new();
            hm.insert("X-API-KEY", HeaderValue::from_str(serper_key).map_err(|e| e.to_string())?);
            hm.insert(CONTENT_TYPE, HeaderValue::from_static("application/json"));
            let resp = client
                .post("https://google.serper.dev/search")
                .headers(hm)
                .json(&serde_json::json!({ "q": query, "gl": "cn", "hl": "zh-cn", "num": 8 }))
                .send()
                .await
                .map_err(|e| e.to_string())?;
            if !resp.status().is_success() {
                return Err(format!("serper error {}", resp.status()));
            }
            let data: SerperResp = resp.json().await.map_err(|e| e.to_string())?;
            data.organic
                .into_iter()
                .map(|i| SearchResult {
                    title: i.title,
                    url: i.link,
                    snippet: i.snippet.unwrap_or_default(),
                    content: None,
                })
                .collect()
        }
        "tavily" => {
            let resp = client
                .post("https://api.tavily.com/search")
                .header(CONTENT_TYPE, HeaderValue::from_static("application/json"))
                .json(&serde_json::json!({
                    "api_key": tavily_key,
                    "query": query,
                    "max_results": 6,
                    "search_depth": "basic"
                }))
                .send()
                .await
                .map_err(|e| e.to_string())?;
            if !resp.status().is_success() {
                return Err(format!("tavily error {}", resp.status()));
            }
            let data: TavilyResp = resp.json().await.map_err(|e| e.to_string())?;
            data.results
                .into_iter()
                .map(|i| SearchResult {
                    title: i.title,
                    url: i.url,
                    snippet: i.content.or(i.snippet).unwrap_or_default(),
                    content: None,
                })
                .collect()
        }
        _ => {
            // 移动版必应结果已携带真实链接（无 ck/a 混淆），直接取前 6 条
            let results = fetch_bing(&client, query).await?;
            results.into_iter().take(6).collect()
        }
    };

    let top: Vec<SearchResult> = raw.into_iter().take(6).collect();
    // 并行抓取正文
    let mut with_content = Vec::new();
    for r in top {
        let content = fetch_page_content(&client, &r.url).await;
        with_content.push(SearchResult {
            content,
            ..r
        });
    }
    Ok(with_content)
}