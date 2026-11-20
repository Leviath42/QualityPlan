import { TOTP } from 'otpauth';

// MFA : active uniquement si QP_TOTP_SECRET (base32) est fourni (standard modop,
// sans secret de dev : jamais de valeur par defaut connue publiquement).
function makeTotp(): TOTP {
  return new TOTP({
    issuer: 'QualityPlan',
    label: 'admin',
    algorithm: 'SHA1',
    digits: 6,
    period: 30,
    secret: process.env.QP_TOTP_SECRET ?? '',
  });
}

export function isTotpEnabled(): boolean {
  return Boolean(process.env.QP_TOTP_SECRET);
}

export function generateTOTPCode(): string {
  return makeTotp().generate();
}

export function validateTOTPCode(code: string): boolean {
  return makeTotp().validate({ token: code, window: 1 }) !== null;
}
