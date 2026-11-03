// Shared password rules for sign-up and password reset.
// Supabase's own Auth settings must enforce the same rules server-side
// (Authentication > Sign In / Providers > Email), since client checks can be bypassed.

export const PASSWORD_MIN_LENGTH = 10;

const COMMON = new Set([
  "password", "password1", "password123", "1234567890", "qwertyuiop",
  "iloveyou12", "welcome123", "admin12345", "letmein123", "golden123",
]);

/** Returns an error message, or null when the password is acceptable. */
export function validatePassword(password: string): string | null {
  if (password.length < PASSWORD_MIN_LENGTH) {
    return `Password must be at least ${PASSWORD_MIN_LENGTH} characters.`;
  }
  if (!/[a-z]/.test(password) || !/[A-Z]/.test(password) || !/[0-9]/.test(password)) {
    return "Password must include uppercase and lowercase letters and a number.";
  }
  if (COMMON.has(password.toLowerCase())) {
    return "That password is too common. Choose something harder to guess.";
  }
  return null;
}
