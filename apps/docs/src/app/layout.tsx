import { Manrope, DM_Sans } from 'next/font/google';
import { Provider } from '@/components/provider';
import './global.css';

const manrope = Manrope({
  subsets: ['latin'],
  variable: '--font-manrope',
});

const dmSans = DM_Sans({
  subsets: ['latin'],
  variable: '--font-dm-sans',
});

export default function Layout({ children }: LayoutProps<'/'>) {
  return (
    <html
      lang="en"
      className={`${manrope.variable} ${dmSans.variable} ${dmSans.className}`}
      suppressHydrationWarning
    >
      <body className="flex flex-col min-h-screen">
        <Provider>{children}</Provider>
      </body>
    </html>
  );
}
