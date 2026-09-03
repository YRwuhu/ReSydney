import { BingReturnType } from '@/lib/hooks/use-bing'

const exampleMessages = [
  {
    category: 'que',
    heading: '🧐 提出复杂问题',
    message: '我可以为我挑剔的只吃橙色食物的孩子做什么饭?'
  },
  {
    category: 'ans',
    heading: '🙌 获取更好的答案',
    message: '销量最高的 3 种宠物吸尘器有哪些优点和缺点?'
  },
  {
    category: 'image',
    heading: '🎨 获得创意灵感',
    message: '以海盗的口吻写一首关于外太空鳄鱼的俳句'
  }
]

export function WelcomeScreen({ setInput }: Pick<BingReturnType, 'setInput'>) {
  return (
    <div className="b_wlcmTileCont">
      {exampleMessages.map(example => (
        <div key={example.heading} className="b_wlcmTileWrap">
          <button className={`b_wlcmTile ${example.category}`} type="button" onClick={() => setInput(example.message)}>
            <h1>{example.heading}</h1>
            <p>{example.message}</p>
          </button>
        </div>
      ))}
    </div>
  )
}
