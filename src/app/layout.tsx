import type { Metadata } from 'next';
import { Inter_Tight, JetBrains_Mono, Newsreader } from 'next/font/google';
import './globals.css';

const display = Newsreader({ variable: '--font-newsreader', subsets: ['latin'], style: ['normal', 'italic'] });
const sans = Inter_Tight({ variable: '--font-inter-tight', subsets: ['latin'] });
const mono = JetBrains_Mono({ variable: '--font-jetbrains', subsets: ['latin'] });

export const metadata: Metadata = {
  title: 'Codebase Tavern',
  description: "Every module gets a voice. Most of them have complaints.",
};

export default function RootLayout({ children }: LayoutProps<'/'>) {
  return (
    <html lang="en" className={`${display.variable} ${sans.variable} ${mono.variable} h-full antialiased`}>
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
