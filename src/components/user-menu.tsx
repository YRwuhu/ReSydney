'use client'

import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger
} from '@/components/ui/dropdown-menu'
import { IconExternalLink, IconGitHub } from '@/components/ui/icons'
import SettingIcon from '@/assets/images/settings.svg?react'

export function UserMenu() {
  return (
    <div className="flex items-center justify-between">
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button className="pl-0" variant="secondary">
            <div className="flex items-center justify-center text-xs font-medium uppercase rounded-full select-none h-7 w-7 shrink-0 bg-muted/50 text-muted-foreground">
              <SettingIcon width={20} fill="var(--cib-color-foreground-neutral-primary)" />
            </div>
            <span className="ml-2">设置</span>
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent sideOffset={8} align="start" className="w-[180px] bg-background">
          <DropdownMenuItem
            onClick={() =>
              location.href='#dialog="settings"'
            }
            className="cursor-pointer"
          >
            设置用户
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem
            onClick={() =>
              location.href='#dialog="openai"'
            }
            className="cursor-pointer"
          >
            AI 接口设置
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem
            onClick={() =>
              location.href='#dialog="search"'
            }
            className="cursor-pointer"
          >
            搜索设置
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem
            onClick={() =>
              location.href='#dialog="system-prompt"'
            }
            className="cursor-pointer"
          >
            自定义系统提示词
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem
            onClick={() =>
              location.href='#dialog="advanced"'
            }
            className="cursor-pointer"
          >
            高级模型设置
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem
            onClick={() =>
              location.href='#dialog="voice"'
            }
            className="cursor-pointer"
          >
            语音设置
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem
            onClick={() =>
              location.href='#dialog="prompts"'
            }
            className="cursor-pointer"
          >
            提示词管理
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem asChild>
            <a
              href="https://github.com/YRwuhu/ReSydney/"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center justify-between w-full gap-2 cursor-pointer"
            >
              开源地址
              <IconGitHub />
              <IconExternalLink className="w-3 h-3 ml-auto" />
            </a>
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  )
}
