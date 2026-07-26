const { handleUpload } = require('@vercel/blob/client');

// Genera el token de subida para que el navegador suba el archivo directo a
// Vercel Blob, sin pasar por el límite de tamaño de las funciones serverless.
export async function POST(request) {
  const body = await request.json();

  const jsonResponse = await handleUpload({
    body,
    request,
    onBeforeGenerateToken: async () => ({
      allowedContentTypes: ['application/pdf', 'image/jpeg', 'image/png', 'image/webp'],
      addRandomSuffix: true,
    }),
    onUploadCompleted: async () => {},
  });

  return Response.json(jsonResponse);
}
