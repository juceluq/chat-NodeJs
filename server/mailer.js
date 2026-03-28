import { Resend } from 'resend';

export const isMailConfigured = !!(process.env.SMTP_PASS);

const resend = isMailConfigured ? new Resend(process.env.SMTP_PASS) : null;

export async function sendVerificationEmail (to, username, token) {
  if (!resend) return;
  const base = process.env.APP_URL ?? 'http://localhost:3000';
  const link = `${base}/verify-email?token=${encodeURIComponent(token)}`;
  const from = process.env.SMTP_FROM ?? 'ChatApp <onboarding@resend.dev>';
  await resend.emails.send({
    from,
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
