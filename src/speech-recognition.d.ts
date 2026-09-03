// 语音识别 API 的类型声明（TS DOM 库未包含 SpeechRecognition）。
// 仅用于满足 sr.ts 的类型检查，不影响运行时。
declare interface SpeechRecognitionEvent {
  resultIndex: number
  results: SpeechRecognitionResultList
}