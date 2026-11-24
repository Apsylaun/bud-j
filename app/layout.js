import './globals.css';
import { IBM_Plex_Sans } from 'next/font/google';
import Shell from '../components/Shell.js';

const font = IBM_Plex_Sans({ subsets: ['latin'], weight: ['400', '500', '600'], display: 'swap' });

export const metadata = { title: 'Comptes', description: 'Suivi des dépenses, pots et placements' };
export const viewport = { width: 'device-width', initialScale: 1, themeColor: '#1F5C4D' };

export default function RootLayout({ children }) {
  return (
    <html lang="fr">
      <body className={font.className}>
        <Shell>{children}</Shell>
      </body>
    </html>
  );
}
