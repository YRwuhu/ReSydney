//! 本地单机存储：rusqlite 保存应用配置 + 会话历史。
//! 桌面版无登录/多用户，配置与历史都直接落到本地库（app_data_dir/chats.db）。

use rusqlite::Connection;
use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use tauri::Manager;

/// 应用配置（与前端 atom 结构保持一致，含高级模型参数）。
#[derive(Debug, Clone, Deserialize, Serialize, Default)]
#[serde(default)]
pub struct AppConfig {
    pub base_url: String,
    pub api_key: String,
    pub model: String,
    pub search_provider: String, // free | serper | tavily
    pub serper_key: String,
    pub tavily_key: String,
    pub use_kimi_search: bool,
    pub use_custom_system_prompt: bool,
    pub custom_system_prompt: String,
    pub use_partial_mode: bool,
    pub partial_prefix: String,
    pub partial_name: String,
    /// 三个样式的模型参数（JSON 字符串存库，取用时反序列化透传给前端）。
    pub advanced: String,
    /// 新必应注入的 cURL 头（前端口令，本地使用）。
    pub bing_header: String,
}

/// 单条会话历史。
#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct ChatSummary {
    pub id: String,
    pub chat_name: String,
    pub tone: String,
    pub messages: String,
    pub conversation: String,
    pub create_time_utc: i64,
    pub update_time_utc: i64,
}

pub struct AppStore;

impl Default for AppStore {
    fn default() -> Self {
        Self
    }
}

impl AppStore {
    /// 打开（或创建）本地数据库，运行幂等建表。
    fn conn(app: &tauri::AppHandle) -> Result<Connection, String> {
        let dir: PathBuf = app
            .path()
            .app_data_dir()
            .map_err(|e| e.to_string())?;
        std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
        let path = dir.join("chats.db");
        let conn = Connection::open(&path).map_err(|e| e.to_string())?;
        Self::migrate(&conn)?;
        Ok(conn)
    }

    fn migrate(conn: &Connection) -> Result<(), String> {
        conn.execute_batch(
            "CREATE TABLE IF NOT EXISTS app_config (
                id INTEGER PRIMARY KEY CHECK (id = 1),
                payload TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS chats (
                id TEXT PRIMARY KEY,
                chat_name TEXT NOT NULL DEFAULT '',
                tone TEXT NOT NULL DEFAULT '',
                messages TEXT NOT NULL DEFAULT '[]',
                conversation TEXT NOT NULL DEFAULT '{}',
                created_at INTEGER NOT NULL,
                updated_at INTEGER NOT NULL
            );
            ",
        )
        .map_err(|e| e.to_string())
    }

    pub fn load_config(app: &tauri::AppHandle) -> Result<AppConfig, String> {
        let conn = Self::conn(app)?;
        let row = conn
            .query_row(
                "SELECT payload FROM app_config WHERE id = 1",
                [],
                |r| r.get::<_, String>(0),
            )
            .ok();
        match row {
            Some(payload) => serde_json::from_str(&payload).map_err(|e| e.to_string()),
            None => Ok(AppConfig::default()),
        }
    }

    pub fn save_config(app: &tauri::AppHandle, config: &AppConfig) -> Result<(), String> {
        let conn = Self::conn(app)?;
        let payload = serde_json::to_string(config).map_err(|e| e.to_string())?;
        conn.execute(
            "INSERT INTO app_config (id, payload) VALUES (1, ?1)
             ON CONFLICT(id) DO UPDATE SET payload = ?1",
            [&payload],
        )
        .map_err(|e| e.to_string())?;
        Ok(())
    }

    pub fn list_chats(app: &tauri::AppHandle) -> Result<Vec<ChatSummary>, String> {
        let conn = Self::conn(app)?;
        let mut stmt = conn
            .prepare(
                "SELECT id, chat_name, tone, messages, conversation, created_at, updated_at
                 FROM chats ORDER BY updated_at DESC",
            )
            .map_err(|e| e.to_string())?;
        let rows = stmt
            .query_map([], |r| {
                Ok(ChatSummary {
                    id: r.get(0)?,
                    chat_name: r.get(1)?,
                    tone: r.get(2)?,
                    messages: r.get(3)?,
                    conversation: r.get(4)?,
                    create_time_utc: r.get(5)?,
                    update_time_utc: r.get(6)?,
                })
            })
            .map_err(|e| e.to_string())?;
        let mut out = Vec::new();
        for r in rows {
            out.push(r.map_err(|e| e.to_string())?);
        }
        Ok(out)
    }

    /// upsert 一条会话。
    pub fn save_chat(app: &tauri::AppHandle, chat: &ChatSummary) -> Result<(), String> {
        let conn = Self::conn(app)?;
        conn.execute(
            "INSERT INTO chats (id, chat_name, tone, messages, conversation, created_at, updated_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)
             ON CONFLICT(id) DO UPDATE SET
                chat_name = ?2, tone = ?3, messages = ?4, conversation = ?5, updated_at = ?7",
            rusqlite::params![
                chat.id,
                chat.chat_name,
                chat.tone,
                chat.messages,
                chat.conversation,
                chat.create_time_utc,
                chat.update_time_utc,
            ],
        )
        .map_err(|e| e.to_string())?;
        Ok(())
    }

    pub fn delete_chat(app: &tauri::AppHandle, id: &str) -> Result<(), String> {
        let conn = Self::conn(app)?;
        conn.execute("DELETE FROM chats WHERE id = ?1", [id])
            .map_err(|e| e.to_string())?;
        Ok(())
    }

    pub fn rename_chat(app: &tauri::AppHandle, id: &str, name: &str) -> Result<(), String> {
        let conn = Self::conn(app)?;
        conn.execute(
            "UPDATE chats SET chat_name = ?2 WHERE id = ?1",
            rusqlite::params![id, name],
        )
        .map_err(|e| e.to_string())?;
        Ok(())
    }
}