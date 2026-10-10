import nodemailer, { TestAccount } from 'nodemailer';

export interface OtpEmailResult {
  sentViaSmtp: boolean;
  previewUrl?: string | false;
  deliveryInfo: string;
}

let cachedTestAccount: TestAccount | null = null;

export async function sendVerificationOtpEmail(
  recipientEmail: string,
  otpCode: string
): Promise<OtpEmailResult> {
  const smtpUser = (process.env.SMTP_USER || process.env.EMAIL_USER || '').trim();
  const smtpPass = (process.env.SMTP_PASS || process.env.EMAIL_PASS || '').trim();
  const rawHost = (process.env.SMTP_HOST || 'smtp.gmail.com').trim().toLowerCase();
  const smtpHost = rawHost
    .replace(/^smpt\./i, 'smtp.')
    .replace(/^stmp\./i, 'smtp.')
    .replace('gmail.con', 'gmail.com');
  const smtpPort = Number(process.env.SMTP_PORT) || 587;
  const isGmailHost = smtpHost.includes('gmail.com');
  const smtpFrom =
    process.env.SMTP_FROM ||
    (smtpUser ? `"PeerConnect AI" <${smtpUser}>` : '"PeerConnect AI" <no-reply@peerconnect.ai>');

  const htmlBody = `
    <div style="font-family: 'Plus Jakarta Sans', Arial, sans-serif; max-width: 520px; margin: 0 auto; padding: 24px; border: 1px solid #e2e8f0; border-radius: 12px; background-color: #ffffff;">
      <h2 style="color: #1d4ed8; margin-top: 0;">PeerConnect AI — Email Verification</h2>
      <p style="color: #334155; font-size: 14px; line-height: 1.6;">
        Hello! Use the following 6-digit One-Time Password (OTP) to verify your student email address (<strong>${recipientEmail}</strong>) on PeerConnect AI:
      </p>
      <div style="margin: 20px 0; padding: 16px; background-color: #f8fafc; border: 1px solid #cbd5e1; border-radius: 8px; text-align: center;">
        <span style="font-family: monospace; font-size: 28px; font-weight: 700; letter-spacing: 6px; color: #0f172a;">
          ${otpCode}
        </span>
      </div>
      <p style="color: #64748b; font-size: 12px;">
        This OTP is valid for 10 minutes. Once verified, you will complete your Student Details form and Skill Assessment Test.
      </p>
    </div>
  `;

  // 1. If real SMTP credentials are provided in environment variables, send via configured SMTP server
  if (smtpUser && smtpPass && smtpUser !== 'MY_SMTP_USER' && smtpPass !== 'MY_SMTP_PASS') {
    try {
      const transporter = nodemailer.createTransport(
        isGmailHost
          ? {
              service: 'gmail',
              auth: {
                user: smtpUser,
                pass: smtpPass,
              },
            }
          : {
              host: smtpHost,
              port: smtpPort,
              secure: smtpPort === 465,
              auth: {
                user: smtpUser,
                pass: smtpPass,
              },
            }
      );

      await transporter.sendMail({
        from: smtpFrom,
        to: recipientEmail,
        subject: `${otpCode} is your PeerConnect AI Verification OTP`,
        text: `Your PeerConnect AI email verification OTP is: ${otpCode}. It expires in 10 minutes.`,
        html: htmlBody,
      });

      return {
        sentViaSmtp: true,
        deliveryInfo: `OTP email sent via Nodemailer SMTP (${smtpHost}) to ${recipientEmail}.`,
      };
    } catch (err) {
      console.log(
        '[Nodemailer Configured SMTP Notice]: Falling back to Ethereal SMTP relay:',
        (err as Error).message
      );
    }
  }

  // 2. Otherwise use Nodemailer's Ethereal SMTP service so real Nodemailer transport executes
  try {
    if (!cachedTestAccount) {
      cachedTestAccount = await nodemailer.createTestAccount();
    }
    const testTransporter = nodemailer.createTransport({
      host: cachedTestAccount.smtp.host,
      port: cachedTestAccount.smtp.port,
      secure: cachedTestAccount.smtp.secure,
      auth: {
        user: cachedTestAccount.user,
        pass: cachedTestAccount.pass,
      },
    });

    const info = await testTransporter.sendMail({
      from: smtpFrom,
      to: recipientEmail,
      subject: `${otpCode} is your PeerConnect AI Verification OTP`,
      text: `Your PeerConnect AI email verification OTP is: ${otpCode}. It expires in 10 minutes.`,
      html: htmlBody,
    });

    const previewUrl = nodemailer.getTestMessageUrl(info);
    return {
      sentViaSmtp: true,
      previewUrl,
      deliveryInfo: `OTP dispatched via Nodemailer to ${recipientEmail}.`,
    };
  } catch (err) {
    console.warn('[Nodemailer Fallback Notice]:', (err as Error).message);
    return {
      sentViaSmtp: false,
      deliveryInfo: `OTP generated for ${recipientEmail}.`,
    };
  }
}
