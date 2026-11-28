import './globals.css';
import { Roboto } from 'next/font/google';
import Shell from '../components/Shell.js';

const roboto = Roboto({ subsets: ['latin'], weight: ['400', '500', '700'], variable: '--font-roboto', display: 'swap' });

export const metadata = { title: 'Bud-J', description: 'Budget, pots et patrimoine' };
export const viewport = { width: 'device-width', initialScale: 1, themeColor: '#ffffff' };

export default function RootLayout({ children }) {
  return (
    <html lang="fr" className={roboto.variable}>
      <body>
        <Shell>{children}</Shell>
      </body>
    </html>
  );
}
