/**
 * Username and password rules shared by every endpoint that accepts new
 * credentials (registration and first-run setup). Keep the web forms in
 * sync with these values.
 */
export const USERNAME_MIN_LENGTH = 2;
export const USERNAME_MAX_LENGTH = 32;
/**
 * The pattern itself is a literal in each DTO: the Swagger plugin only
 * publishes `pattern` for a literal regex.
 */
export const USERNAME_PATTERN_MESSAGE =
  'Username can only contain letters, numbers, underscores, and hyphens';

export const PASSWORD_MIN_LENGTH = 8;
export const PASSWORD_MAX_LENGTH = 128;

export const USERNAME_MIN_LENGTH_MESSAGE = `Username must be at least ${USERNAME_MIN_LENGTH} characters`;
export const USERNAME_MAX_LENGTH_MESSAGE = `Username must be at most ${USERNAME_MAX_LENGTH} characters`;
export const PASSWORD_MIN_LENGTH_MESSAGE = `Password must be at least ${PASSWORD_MIN_LENGTH} characters`;
export const PASSWORD_MAX_LENGTH_MESSAGE = `Password must be at most ${PASSWORD_MAX_LENGTH} characters`;
