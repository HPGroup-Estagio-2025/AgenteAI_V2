import './globals.css';

export const metadata = {
  title: 'Dashboard de Notícias',
  description: 'Dashboard de gestão de notícias',
};

export default function RootLayout({ children }) {
  return (
    <html lang="pt">
      <head>
        <link rel="stylesheet" href="/css/style.css" />
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link
          href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap"
          rel="stylesheet"
        />
      </head>
      <body>{children}</body>
    </html>
  );
}
