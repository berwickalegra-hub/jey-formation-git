import { describe, it, expect } from 'vitest';
import { verificationEmail, resetPasswordEmail } from './email-templates';

describe('verificationEmail', () => {
  it('returns { subject, html, text } all non-empty', () => {
    const t = verificationEmail({ code: 'ABCD2345', email: 'a@b.com' });
    expect(t.subject).toBeTruthy();
    expect(t.html).toBeTruthy();
    expect(t.text).toBeTruthy();
  });

  it('embeds the code in both html and text', () => {
    const t = verificationEmail({ code: 'ABCD2345', email: 'a@b.com' });
    expect(t.html).toContain('ABCD2345');
    expect(t.text).toContain('ABCD2345');
  });

  it('subject matches expected', () => {
    const t = verificationEmail({ code: 'XYZ12345', email: 'x@y.com' });
    expect(t.subject).toBe('Verify your email');
  });
});

describe('resetPasswordEmail', () => {
  it('returns { subject, html, text } all non-empty', () => {
    const t = resetPasswordEmail({ code: 'WXYZ9876', email: 'a@b.com' });
    expect(t.subject).toBeTruthy();
    expect(t.html).toBeTruthy();
    expect(t.text).toBeTruthy();
  });

  it('embeds the code in both html and text', () => {
    const t = resetPasswordEmail({ code: 'WXYZ9876', email: 'a@b.com' });
    expect(t.html).toContain('WXYZ9876');
    expect(t.text).toContain('WXYZ9876');
  });

  it('subject matches expected', () => {
    const t = resetPasswordEmail({ code: 'ABCD2345', email: 'a@b.com' });
    expect(t.subject).toBe('Reset your password');
  });
});
