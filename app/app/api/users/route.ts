import { NextRequest, NextResponse } from 'next/server';
import pool from '@/lib/db';

export async function POST(req: NextRequest) {
  try {
    const { username, password, role } = await req.json();

    if (!username || !password) {
      return NextResponse.json(
        { error: 'Username and password required' },
        { status: 400 }
      );
    }

    const bcrypt = await import('bcryptjs');
    const passwordHash = await bcrypt.hash(password, 12);

    const result = await pool.query(
      'INSERT INTO users (username, password_hash, role) VALUES ($1, $2, $3) RETURNING id, username, role',
      [username, passwordHash, role || 'member']
    );

    return NextResponse.json({ success: true, user: result.rows[0] }, { status: 201 });
  } catch (error: any) {
    if (error.code === '23505') {
      return NextResponse.json(
        { error: 'Username already exists' },
        { status: 409 }
      );
    }
    console.error('Create user error:', error);
    return NextResponse.json(
      { error: 'Failed to create user' },
      { status: 500 }
    );
  }
}

export async function GET() {
  try {
    const result = await pool.query('SELECT id, username, role, created_at FROM users ORDER BY created_at DESC');
    return NextResponse.json({ users: result.rows });
  } catch (error) {
    console.error('List users error:', error);
    return NextResponse.json(
      { error: 'Failed to list users' },
      { status: 500 }
    );
  }
}
