export async function onRequest(context) {
  const envToken = context?.env?.POLLI_TOKEN ?? context?.env?.VITE_POLLI_TOKEN;
  const token = envToken ?? process.env.VITE_POLLI_TOKEN ?? process.env.POLLI_TOKEN ?? '';
  if (!token) {
    return new Response(JSON.stringify({ error: 'Token not configured' }), {
      status: 404,
      headers: { 'Content-Type': 'application/json' },
    });
  }
  return new Response(JSON.stringify({ token }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}
