import { microsoftSpriteStyle } from '@/lib/sprite'

// 还原自 mscopliot2024.html / chat.html 的 b_footer 结构
export function Footer() {
  return (
    <footer className="b_footer" role="contentinfo" aria-label="Footer">
      <div id="b_footerItems">
        <span className="flex items-center gap-1">
          <span className="b_footerLogo" style={microsoftSpriteStyle(20)} aria-hidden="true" />
          © 2024 Microsoft
        </span>
        <ul>
          <li>
            <a href="https://go.microsoft.com/fwlink/?LinkId=521839" target="_blank" rel="noopener noreferrer">
              隐私和 Cookie
            </a>
          </li>
          <li>
            <a href="https://go.microsoft.com/fwlink/?LinkID=246338" target="_blank" rel="noopener noreferrer">
              法律声明
            </a>
          </li>
          <li>
            <a href="https://go.microsoft.com/fwlink/?linkid=868922" target="_blank" rel="noopener noreferrer">
              广告
            </a>
          </li>
          <li>
            <a href="https://go.microsoft.com/fwlink/?LinkID=286759" target="_blank" rel="noopener noreferrer">
              关于我们的广告
            </a>
          </li>
          <li>
            <a href="https://support.microsoft.com/topic/82d20721-2d6f-4012-a13d-d1910ccf203f" target="_blank" rel="noopener noreferrer">
              帮助
            </a>
          </li>
        </ul>
      </div>
      <div className="b_footerDisclaimer">
        本页面为非官方重制项目，仅供学习与娱乐，与 Microsoft / Bing 无任何关联。
      </div>
    </footer>
  )
}
