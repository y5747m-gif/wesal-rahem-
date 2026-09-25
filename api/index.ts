export default function handler(_request: unknown, response: any): void {
  response.setHeader('Cache-Control', 'no-store, max-age=0');
  response.setHeader('Content-Type', 'application/json; charset=utf-8');
  response.status(200).json({
    ok: true,
    service: 'wesal',
    routes: {
      home: '/',
      health: '/api/health',
    },
  });
}
