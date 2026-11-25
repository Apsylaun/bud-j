import './globals.css';
import Shell from '../components/Shell.js';

export const metadata = { title: 'Bud-J', description: 'Budget, pots et patrimoine' };
export const viewport = { width: 'device-width', initialScale: 1, themeColor: '#6B8F71' };

export default function RootLayout({ children }) {
  return (
    <html lang="fr">
      <body>
        <Shell>{children}</Shell>
      </body>
    </html>
  );
}
