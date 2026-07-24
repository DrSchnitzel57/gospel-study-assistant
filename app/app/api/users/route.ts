import { NextRequest, NextResponse } from 'next/server';
import { getSessionFromCookie, createUser } from '@/lib/auth';
import pool from '@/lib/db';

export async function POST(req: NextRequest) {
  const session = await getSessionFromCookie(req.headers.get('cookie'));

  if (!session || session.role !== 'admin') {
    return NextResponse.json(
      { error: 'Admin access required' },
      { status: 403 }
    );
  }

  try {
    const { username, password, role } = await req.json();

    if (!username || !password) {
      return NextResponse.json(
        { error: 'Username and password required' },
        { status: 400 }
      );
    }

    const user = await createUser(username, password, role || 'member');
    return NextResponse.json({ success: true, user }, { status: 201 });
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

export async function GET(req: NextRequest) {
  const session = await getSessionFromCookie(req.headers.get('cookie'));

  if (!session || session.role !== 'admin') {
    return NextResponse.json(
      { error: 'Admin access required' },
      { status: 403 }
    );
  }

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
