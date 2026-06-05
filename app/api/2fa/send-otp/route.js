import { NextResponse } from 'next/server';
import nodemailer from 'nodemailer';
import { SignJWT } from 'jose';

const SECRET = new TextEncoder().encode(process.env.JWT_SECRET || 'publixy-secret-key');

function generateOtp() {
  return String(Math.floor(100000 + Math.random() * 900000));
}

async function signOtpToken(otp) {
  return new SignJWT({ otp })
    .setProtectedHeader({ alg: 'HS256' })
    .setExpirationTime('5m')
    .sign(SECRET);
}

async function sendOtpEmail(otp) {
  const port = parseInt(process.env.SMTP_PORT || '465');
  const transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST || 'mail.hp-group.org',
    port,
    secure: port === 465,
    auth: {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASS,
    },
    tls: {
      rejectUnauthorized: false, // cPanel usa certificados auto-assinados
    },
  });

  await transporter.sendMail({
    from: `"Publixy" <${process.env.SMTP_FROM}>`,
    to: process.env.OTP_EMAIL_TO,
    subject: `${otp} — Código de acesso Publixy`,
    html: `
      <div style="font-family:Inter,sans-serif;max-width:420px;margin:0 auto;padding:32px 24px;background:#fff;border-radius:12px;border:1px solid #E2E8F0">
        <div style="text-align:center;margin-bottom:24px">
          <div style="font-size:1.4rem;font-weight:800;background:linear-gradient(135deg,#7C3AED,#4F46E5);-webkit-background-clip:text;-webkit-text-fill-color:transparent">Publixy</div>
        </div>
        <p style="color:#334155;font-size:.9375rem;margin-bottom:8px">O teu código de acesso é:</p>
        <div style="text-align:center;margin:20px 0">
          <span style="font-size:2.5rem;font-weight:800;letter-spacing:.3em;color:#1E293B;background:#F5F3FF;padding:16px 28px;border-radius:12px;display:inline-block">${otp}</span>
        </div>
        <p style="color:#94A3B8;font-size:.8rem;text-align:center;margin-top:16px">Este código expira em <strong>5 minutos</strong>.</p>
        <p style="color:#94A3B8;font-size:.75rem;text-align:center;margin-top:8px">Se não foste tu a iniciar sessão, ignora este email.</p>
      </div>
    `,
  });
}

export async function POST() {
  if (!process.env.SMTP_USER || !process.env.SMTP_PASS) {
    return NextResponse.json({ error: 'SMTP não configurado' }, { status: 500 });
  }

  const otp = generateOtp();

  try {
    await sendOtpEmail(otp);
  } catch (err) {
    console.error('[2fa] Erro SMTP:', err.message, '| code:', err.code, '| host:', process.env.SMTP_HOST, '| port:', process.env.SMTP_PORT);
    return NextResponse.json({ error: `Erro SMTP: ${err.message}` }, { status: 500 });
  }

  const otpToken = await signOtpToken(otp);
  return NextResponse.json({ otpToken });
}
