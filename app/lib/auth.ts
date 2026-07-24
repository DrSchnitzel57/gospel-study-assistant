import { SignJWT, jwtVerify } from 'jose';
import bcrypt from 'bcryptjs';
import pool from '@/lib/db';

const JWT_SECRET = new TextEncoder().encode(
  process.env.JWT_SECRET || 'change-me-to-a-secure-random-string'
);

const TOKEN_EXPIRY = '7d';

export async function createToken(userId: number, username: string, role: string): Promise<string> {
  return new SignJWT({ userId, username, role })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime(TOKEN_EXPIRY)
    .sign(JWT_SECRET);
}

export async function verifyToken(token: string): Promise<{ userId: number; username: string; role: string } | null> {
  try {
    const { payload } = await jwtVerify(token, JWT_SECRET);
    return payload as { userId: number; username: string; role: string };
  } catch {
    return null;
  }
}

export async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, 12);
}

export async function verifyPassword(password: string, hash: string): Promise<boolean> {
  return bcrypt.compare(password, hash);
}

export async function authenticateUser(username: string, password: string) {
  const result = await pool.query(
    'SELECT id, username, password_hash, role FROM users WHERE username = $1',
    [username]
  );

  if (result.rows.length === 0) return null;

  const user = result.rows[0];
  const valid = await verifyPassword(password, user.password_hash);

  if (!valid) return null;

  const token = await createToken(user.id, user.username, user.role);
  return { user: { id: user.id, username: user.username, role: user.role }, token };
}

export async function getSessionFromCookie(cookieHeader: string | null) {
  if (!cookieHeader) return null;

  const match = cookieHeader.match(/token=([^;]+)/);
  if (!match) return null;

  return verifyToken(match[1]);
}

export async function createUser(username: string, password: string, role: 'admin' | 'member' = 'member') {
  const passwordHash = await hashPassword(password);
  const result = await pool.query(
    'INSERT INTO users (username, password_hash, role) VALUES ($1, $2, $3) RETURNING id, username, role',
    [username, passwordHash, role]
  );
  return result.rows[0];
}
