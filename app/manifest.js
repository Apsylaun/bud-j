export default function manifest() {
  return {
    name: 'Bud-J',
    short_name: 'Bud-J',
    start_url: '/',
    display: 'standalone',
    background_color: '#FFFFFF',
    theme_color: '#37352F',
    icons: [
      { src: '/icon-192.png', sizes: '192x192', type: 'image/png' },
      { src: '/icon-512.png', sizes: '512x512', type: 'image/png' },
    ],
  };
}
