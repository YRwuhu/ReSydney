import * as React from 'react'
import { bingSpriteStyle } from '@/lib/sprite'
import { UserMenu } from './user-menu'
import { ThemeToggle } from './theme-toggle'

export function Header() {
  return (
    <header className="sticky top-0 z-50 flex items-center justify-between w-full h-16 px-4 shrink-0 bg-gradient-to-b from-background/10 via-background/50 to-background/80 backdrop-blur-xl">
      <div className="flex items-center gap-2">
        <span className="bing-sprite-icon" style={bingSpriteStyle(28)} aria-hidden="true" />
        <span className="text-sm font-semibold">Bing</span>
      </div>
      <div className="flex items-center justify-end space-x-2 w-full">
        <ThemeToggle />
        <UserMenu />
      </div>
    </header>
  )
}
