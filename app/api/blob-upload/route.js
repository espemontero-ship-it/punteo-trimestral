const { issueSignedToken } = require('@vercel/blob');
const { handleUploadPresigned } = require('@vercel/blob/client');

export async function POST(request) {
  const body = await request.json();

  try {
    const jsonResponse = await handleUploadPresigned({
      body,
      request,
      getSignedToken: async pathname => ({
        token: await issueSignedToken({ pathname, operations: ['put'] }),
        urlOptions: {
          allowedContentTypes: ['application/pdf', 'image/jpeg', 'image/png', 'image/webp'],
          addRandomSuffix: true,
          allowOverwrite: false,
        },
      }),
      onUploadCompleted: async () => {},
    });
    return Response.json(jsonResponse);
  } catch (error) {
    return Response.json({ error: error.message }, { status: 400 });
  }
}
