mod bing;
mod commands;
mod headers;
mod openai;
mod search;
mod store;

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .on_page_load(|window, _payload| {
            // 窗口初始为隐藏（visible: false），页面一开始加载就显示，
            // 启动遮罩（内联在 index.html，无外部请求）随首帧一起出现
            let _ = window.show();
        })
        .invoke_handler(tauri::generate_handler![
            commands::load_config,
            commands::save_config,
            commands::list_chats,
            commands::save_chat,
            commands::rename_chat,
            commands::delete_chat,
            commands::openai_chat,
            commands::stream_openai,
            commands::search,
            commands::bing_create_conversation,
            commands::bing_upload_image,
            commands::bing_create_image,
            commands::blob_gateway,
            commands::stream_bing,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}