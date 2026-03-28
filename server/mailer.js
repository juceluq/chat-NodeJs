import nodemailer from 'nodemailer';

export const isMailConfigured = !!(
  process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS
);

let transporter = null;

if (isMailConfigured) {
  const port = parseInt(process.env.SMTP_PORT ?? '465', 10);
  transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port,
    secure: process.env.SMTP_SECURE ? process.env.SMTP_SECURE === 'true' : port === 465,
    auth: {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASS
    },
    connectionTimeout: 8000,
    greetingTimeout: 8000,
    socketTimeout: 10000
  });
}

export async function sendVerificationEmail (to, username, token) {
  if (!transporter) return;
  const base = process.env.APP_URL ?? 'http://localhost:3000';
  const link = `${base}/verify-email?token=${encodeURIComponent(token)}`;
  await transporter.sendMail({
    from: process.env.SMTP_FROM ?? process.env.SMTP_USER,
    to,
    subject: 'Verifica tu cuenta — ChatApp',
    html: `
      <div style="font-family:sans-serif;max-width:480px;margin:auto;padding:24px;background:#18181b;color:#e4e4e7;border-radius:12px">
        <h2 style="color:#6366f1;margin-top:0">ChatApp</h2>
        <p>Hola <b>${username}</b>,</p>
        <p>Haz clic en el botón de abajo para verificar tu cuenta:</p>
        <a href="${link}" style="display:inline-block;margin:16px 0;padding:10px 24px;background:#6366f1;color:#fff;text-decoration:none;border-radius:8px;font-weight:600">Verificar email</a>
        <p style="color:#71717a;font-size:12px">Si no creaste esta cuenta, ignora este mensaje. El enlace caduca en 24 horas.</p>
      </div>`
  });
}
