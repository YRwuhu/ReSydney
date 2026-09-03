mod bing;
mod commands;
mod headers;
mod openai;
mod search;
mod store;

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
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