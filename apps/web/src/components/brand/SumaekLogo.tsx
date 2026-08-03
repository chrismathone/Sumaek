import Image from "next/image";

type LogoVariant = "header" | "inkWash" | "reverse";

const LOGO_ASSETS = {
  header: {
    src: "/brand/wordmark-header.webp",
    width: 720,
    height: 329,
  },
  inkWash: {
    src: "/brand/logo-inkwash.webp",
    width: 1440,
    height: 572,
  },
  reverse: {
    src: "/brand/wordmark-reverse.png",
    width: 1568,
    height: 717,
  },
} as const satisfies Record<LogoVariant, { src: string; width: number; height: number }>;

interface SumaekLogoProps {
  variant?: LogoVariant;
  className?: string;
  preload?: boolean;
  sizes?: string;
  alt?: string;
}

/**
 * 수맥의 이미지 생성 워드마크를 서비스 전역에서 같은 비율로 사용한다.
 * 원본 비율은 고정하고 Next/Image가 실제 표시 폭에 맞는 파일만 전송한다.
 */
export function SumaekLogo({
  variant = "header",
  className,
  preload = false,
  sizes,
  alt = "수맥",
}: SumaekLogoProps) {
  const asset = LOGO_ASSETS[variant];

  return (
    <Image
      src={asset.src}
      width={asset.width}
      height={asset.height}
      alt={alt}
      className={className}
      preload={preload}
      sizes={sizes}
    />
  );
}
