import type { Metadata } from 'next';
import { JetBrains_Mono, Luckiest_Guy, Nunito } from 'next/font/google';
import './globals.css';

const display = Luckiest_Guy({ variable: '--font-luckiest', subsets: ['latin'], weight: '400' });
const sans = Nunito({ variable: '--font-nunito', subsets: ['latin'] });
const mono = JetBrains_Mono({ variable: '--font-jetbrains', subsets: ['latin'] });

export const metadata: Metadata = {
  title: 'Codebase Tavern',
  description: "Your code, but it talks back. And it's rude.",
};

export default function RootLayout({ children }: LayoutProps<'/'>) {
  return (
    <html lang="en" className={`${display.variable} ${sans.variable} ${mono.variable} h-full antialiased`}>
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
