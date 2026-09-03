type clickHandler = (e: React.MouseEvent<HTMLDivElement>) => void;

interface SVGProps {
  alt?: string;
  width: number;
  height?: number;
  fill?: string;
  /** 接受 SVGR 组件（FC<SVGProps>）或普通图片 URL。 */
  src: React.JSXElementConstructor<{ width: number; height: number, style: React.CSSProperties, className?: string, onClick?: clickHandler }> | string
  style?: React.CSSProperties;
  className?: string;
  onClick?: clickHandler;
}

/** 统一渲染 SVG：组件直接渲染，URL 包一层 img（兼容图片型资源）。 */
export function SVG(props: SVGProps) {
  const {
    fill = 'var(--cib-color-foreground-accent-primary)',
    src,
    width = 20,
    height,
    style,
    className,
    onClick,
    alt,
  } = props

  if (typeof src === 'string') {
    return (
      <img
        src={src}
        alt={alt || ''}
        width={width}
        height={height || width}
        style={{ ...style, fill } as React.CSSProperties}
        className={className}
        onClick={onClick as any}
        draggable={false}
      />
    )
  }

  const Children = src
  return <Children width={width} height={height || width} style={{ ...style, fill }} className={className} onClick={onClick} />
}
