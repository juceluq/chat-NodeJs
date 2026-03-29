import { Resend } from 'resend';

export const isMailConfigured = !!(process.env.SMTP_PASS);

const resend = isMailConfigured ? new Resend(process.env.SMTP_PASS) : null;

export async function sendVerificationEmail (to, username, token) {
  if (!resend) return;
  const base = (process.env.APP_URL ?? 'http://localhost:3000').replace(/\/$/, '');
  const link = `${base}/verify-email?token=${encodeURIComponent(token)}`;
  const from = process.env.SMTP_FROM ?? 'ChatApp <onboarding@resend.dev>';
  const { error } = await resend.emails.send({
    from,
    to,
    subject: '✉️ Verifica tu cuenta en ChatApp',
    html: `<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width,initial-scale=1" />
  <meta name="color-scheme" content="light dark" />
  <meta name="supported-color-schemes" content="light dark" />
  <style>
    :root { color-scheme: light dark; }

    body {
      margin: 0; padding: 0;
      background-color: #f4f4f5;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
    }
    .wrapper {
      background-color: #f4f4f5;
      padding: 40px 16px;
    }
    .card {
      max-width: 480px;
      margin: 0 auto;
      background-color: #ffffff;
      border-radius: 16px;
      overflow: hidden;
      box-shadow: 0 4px 24px rgba(0,0,0,0.08);
    }
    .header {
      background: linear-gradient(135deg, #6366f1 0%, #8b5cf6 100%);
      padding: 32px 40px 28px;
      text-align: center;
    }
    .header-logo {
      font-size: 28px;
      font-weight: 800;
      color: #ffffff;
      letter-spacing: -0.5px;
    }
    .header-tagline {
      font-size: 13px;
      color: rgba(255,255,255,0.75);
      margin-top: 4px;
    }
    .body {
      padding: 36px 40px 32px;
      color: #3f3f46;
    }
    .greeting {
      font-size: 20px;
      font-weight: 700;
      color: #18181b;
      margin: 0 0 12px;
    }
    .text {
      font-size: 15px;
      line-height: 1.6;
      color: #52525b;
      margin: 0 0 28px;
    }
    .btn-wrap { text-align: center; margin-bottom: 28px; }
    .btn {
      display: inline-block;
      padding: 14px 36px;
      background: linear-gradient(135deg, #6366f1 0%, #8b5cf6 100%);
      color: #ffffff !important;
      text-decoration: none;
      border-radius: 10px;
      font-size: 15px;
      font-weight: 700;
      letter-spacing: 0.2px;
    }
    .link-fallback {
      font-size: 12px;
      color: #a1a1aa;
      line-height: 1.6;
      margin: 0 0 8px;
      word-break: break-all;
    }
    .link-fallback a { color: #6366f1; }
    .divider {
      border: none;
      border-top: 1px solid #e4e4e7;
      margin: 24px 0;
    }
    .footer {
      font-size: 12px;
      color: #a1a1aa;
      line-height: 1.6;
      margin: 0;
    }

    /* ── Dark mode ── */
    @media (prefers-color-scheme: dark) {
      body, .wrapper { background-color: #09090b !important; }
      .card { background-color: #18181b !important; box-shadow: 0 4px 24px rgba(0,0,0,0.5) !important; }
      .greeting { color: #fafafa !important; }
      .text { color: #a1a1aa !important; }
      .divider { border-color: #27272a !important; }
      .footer { color: #52525b !important; }
      .link-fallback { color: #52525b !important; }
      .link-fallback a { color: #818cf8 !important; }
    }
  </style>
</head>
<body>
  <div class="wrapper">
    <div class="card">

      <!-- Header -->
      <div class="header">
        <div class="header-logo">💬 ChatApp</div>
        <div class="header-tagline">Mensajería en tiempo real</div>
      </div>

      <!-- Body -->
      <div class="body">
        <p class="greeting">Hola, ${username} 👋</p>
        <p class="text">
          Gracias por registrarte en <strong>ChatApp</strong>. Para completar tu registro y activar tu cuenta,
          confirma tu dirección de correo electrónico haciendo clic en el botón de abajo.
        </p>

        <div class="btn-wrap">
          <a href="${link}" class="btn">Verificar mi cuenta</a>
        </div>

        <p class="link-fallback">
          Si el botón no funciona, copia y pega este enlace en tu navegador:<br />
          <a href="${link}">${link}</a>
        </p>

        <hr class="divider" />

        <p class="footer">
          Este enlace caduca en <strong>24 horas</strong>. Si no creaste una cuenta en ChatApp, puedes ignorar este mensaje con total seguridad.<br /><br />
          — El equipo de ChatApp
        </p>
      </div>

    </div>
  </div>
</body>
</html>`
  });
  if (error) throw new Error(error.message || 'Error al enviar el email de verificación.');
}
