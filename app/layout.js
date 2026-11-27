import './globals.css';
import { Dancing_Script } from 'next/font/google';
import Shell from '../components/Shell.js';

const script = Dancing_Script({ subsets: ['latin'], weight: ['600', '700'], variable: '--font-script', display: 'swap' });

export const metadata = { title: 'Bud-J', description: 'Budget, pots et patrimoine' };
export const viewport = { width: 'device-width', initialScale: 1, themeColor: '#ffffff' };

export default function RootLayout({ children }) {
  return (
    <html lang="fr" className={script.variable}>
      <body>
        <Shell>{children}</Shell>
      </body>
    </html>
  );
}
