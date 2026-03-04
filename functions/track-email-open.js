// Records proposal email opens via a 1x1 tracking pixel
const { createClient } = require('@supabase/supabase-js');

// 1x1 transparent GIF
const PIXEL = Buffer.from('R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7', 'base64');

exports.handler = async (event) => {
  const id = event.queryStringParameters?.id;

  if (id) {
    try {
      const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
        auth: { autoRefreshToken: false, persistSession: false },
      });
      // Only record the first open
      await sb.from('proposals')
        .update({ email_opened_at: new Date().toISOString() })
        .eq('id', id)
        .is('email_opened_at', null);
    } catch (_) { /* swallow — don't fail the pixel response */ }
  }

  return {
    statusCode: 200,
    headers: {
      'Content-Type': 'image/gif',
      'Cache-Control': 'no-store, no-cache, must-revalidate, max-age=0',
      'Pragma': 'no-cache',
    },
    body: PIXEL.toString('base64'),
    isBase64Encoded: true,
  };
};
