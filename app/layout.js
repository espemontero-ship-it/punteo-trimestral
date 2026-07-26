import './globals.css';

export const metadata = {
  title: 'Punteo trimestral',
  description: 'Checklist de facturas por proveedor',
};

export const viewport = {
  width: 'device-width',
  initialScale: 1,
};

export default function RootLayout({ children }) {
  return (
    <html lang="es">
      <body>{children}</body>
    </html>
  );
}
