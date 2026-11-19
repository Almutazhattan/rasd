import type { Metadata, Viewport } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'RASD | رَصْد — ما وراء البحث',
  description:
    'منصة ذكاء اصطناعي وكيلي للمنافسات الحكومية: اكتشاف، وفهم الوثائق، وتقييم توافق قابل للتفسير، ' +
    'وإعداد مسودات — بقرار بشري في كل خطوة حاسمة.',
  robots: { index: true, follow: true },
};

export const viewport: Viewport = {
  themeColor: '#1E1E1C',
  width: 'device-width',
  initialScale: 1,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ar" dir="rtl">
      <head>
        <link
          rel="preload"
          href="/fonts/thmanyah-sans-Regular.woff2"
          as="font"
          type="font/woff2"
          crossOrigin="anonymous"
        />
      </head>
      <body>{children}</body>
    </html>
  );
}
