import './globals.css';
import ToastHost from './components/ToastHost';

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
      <body>
        <ToastHost />
        {children}
      </body>
    </html>
  );
}
