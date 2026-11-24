export default function manifest() {
  return {
    name: 'Comptes',
    short_name: 'Comptes',
    start_url: '/',
    display: 'standalone',
    background_color: '#F2F4F3',
    theme_color: '#1F5C4D',
    icons: [
      { src: '/icon-192.png', sizes: '192x192', type: 'image/png' },
      { src: '/icon-512.png', sizes: '512x512', type: 'image/png' },
    ],
  };
}
