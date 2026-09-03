//! 新必应请求头构造：mockUser / createHeaders / 随机 IP（cidr.json）/ cURL 解析。
//! 由 TS 版 src/lib/utils.ts 移植，桌面端无需服务器，直接生成请求头。

use std::collections::HashMap;

pub const DEFAULT_UA: &str = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/117.0.0.0 Safari/537.36 Edg/117.0.0.0";
pub const REFERER: &str = "https://www.bing.com/search?showconv=1&sendquery=1&q=Bing%20AI&form=MY02CJ&OCID=MY02CJ&OCID=MY02CJ&pl=launch";
pub const XMS_UA: &str = "azsdk-js-api-client-factory/1.0.0-beta.1 core-rest-pipeline/1.10.3 OS/Win32";
pub const ACCEPT_ENCODING: &str = "gzip, deflate, br";

static CIDR: once_cell::sync::Lazy<Vec<String>> = once_cell::sync::Lazy::new(|| {
    let raw = include_str!("cidr.json");
    serde_json::from_str(raw).unwrap_or_default()
});

pub fn random_string(len: usize) -> String {
    const CHARS: &[u8] = b"ABCDEFGHJKMNPQRSTWXYZ1234567890";
    (0..len)
        .map(|_| CHARS[(rand::random::<u32>() as usize) % CHARS.len()] as char)
        .collect()
}

/// 从 cidr.json 随机取一条 "/a.b.c.d/prefix"，生成前缀内随机 IP。
pub fn random_ip() -> String {
    if CIDR.is_empty() {
        return format!(
            "104.{}.{}.{}",
            rand::random::<u32>() % 21,
            rand::random::<u32>() % 127,
            1 + rand::random::<u32>() % 254
        );
    }
    let entry = &CIDR[(rand::random::<u32>() as usize) % CIDR.len()];
    let (ip, prefix) = match entry.split_once('/') {
        Some((i, p)) => (i, p.parse::<u32>().unwrap_or(24)),
        None => (entry.as_str(), 24),
    };
    // 仅支持 IPv4，前缀 >=8 才做随机化，否则原样返回保证合法。
    let octets: Vec<u32> = ip
        .split('.')
        .filter_map(|o| o.parse().ok())
        .collect();
    if octets.len() != 4 {
        return ip.to_string();
    }
    let host_bits = 32 - prefix;
    let mut out = octets;
    let mut left = host_bits;
    for i in (0..4).rev() {
        if left <= 0 {
            break;
        }
        let take = left.min(8);
        let mask: u32 = if take >= 8 { 0xFF } else { (1u32 << take) - 1 };
        out[i] = (out[i] & !mask) | (rand::random::<u32>() % (mask + 1));
        left -= take;
    }
    out[3] = out[3].max(1);
    out.iter().map(|o| o.to_string()).collect::<Vec<_>>().join(".")
}

/// 从 cURL 头块文本解析出 header 键值（-H 'k: v'）。
pub fn parse_headers_from_curl(content: &str) -> HashMap<String, String> {
    let mut headers = HashMap::new();
    let re = regex::Regex::new(r#"-H\s+'([^:]+):\s*([^']+|)'"#).unwrap();
    for cap in re.captures_iter(content) {
        let k = cap[1].trim().to_string();
        let v = cap[2].trim().to_string();
        headers.insert(k, v);
    }
    headers
}

fn parse_ua(raw: Option<&str>) -> String {
    match raw {
        Some(u) if u.to_lowercase().contains("edge") => u.to_string(),
        _ => DEFAULT_UA.to_string(),
    }
}

fn cookie_value(cookies: &HashMap<String, String>, name: &str) -> String {
    cookies.get(name).cloned().unwrap_or_default()
}

/// 完整构造新必应请求头。
/// `bing_header_txt` 为前端口令里的 cURL 头；为空或 use_mock 时走 mockUser 合成头。
pub fn create_headers(bing_header: &HashMap<String, String>, cookies: &HashMap<String, String>, use_mock: bool) -> HashMap<String, String> {
    let has_header = !bing_header.is_empty();
    let mock = use_mock || !has_header;
    if mock {
        return mock_user(cookies);
    }
    let mut headers: HashMap<String, String> = bing_header.clone();
    headers.insert("x-forwarded-for".into(), cookie_value(cookies, "BING_IP").pipe_if_empty(|| random_ip()));
    if let Some(ua) = headers.get("user-agent") {
        headers.insert("user-agent".into(), parse_ua(Some(ua)));
    }
    headers.insert("referer".into(), REFERER.to_string());
    headers
        .entry("x-ms-useragent".into())
        .or_insert_with(|| XMS_UA.to_string());
    headers
}

trait PipeIfEmpty {
    fn pipe_if_empty<F: FnOnce() -> String>(self, f: F) -> String;
}
impl PipeIfEmpty for String {
    fn pipe_if_empty<F: FnOnce() -> String>(self, f: F) -> String {
        if self.is_empty() {
            f()
        } else {
            self
        }
    }
}

/// mockUser：合成一组可用请求头（带随机 IP / _U cookie / MUID）。
fn mock_user(cookies: &HashMap<String, String>) -> HashMap<String, String> {
    let _u = cookie_value(cookies, "_U");
    let muid = cookie_value(cookies, "MUID");
    let mut headers = HashMap::new();
    headers.insert(
        "x-forwarded-for".into(),
        cookie_value(cookies, "BING_IP").pipe_if_empty(|| random_ip()),
    );
    headers.insert("Accept-Encoding".into(), ACCEPT_ENCODING.to_string());
    headers.insert(
        "Accept-Language".into(),
        "zh-CN,zh;q=0.9,en;q=0.8,en-GB;q=0.7,en-US;q=0.6".to_string(),
    );
    headers.insert("User-Agent".into(), DEFAULT_UA.to_string());
    headers.insert("x-ms-useragent".into(), XMS_UA.to_string());
    headers.insert("referer".into(), REFERER.to_string());
    let cookie = format!(
        "_U={}; MUID={}",
        if _u.is_empty() { "xxx" } else { _u.as_str() },
        if muid.is_empty() { random_string(32) } else { muid },
    );
    headers.insert("cookie".into(), cookie);
    headers
}