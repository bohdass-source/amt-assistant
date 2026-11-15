import { ConflictException, Injectable, Logger, OnApplicationBootstrap, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import bcrypt from 'bcryptjs';
import { env } from '../config/env';
import { DbService } from '../db/db.service';
import type { AuthUser, Role } from './auth.guards';

interface UserRow {
  id: string;
  email: string | null;
  password_hash: string | null;
  role: Role;
  is_guest: boolean;
}

export interface SessionResponse {
  token: string;
  user: { id: string; email: string | null; role: Role; guest: boolean };
}

@Injectable()
export class AuthService implements OnApplicationBootstrap {
  private readonly log = new Logger(AuthService.name);

  constructor(
    private readonly db: DbService,
    private readonly jwt: JwtService,
  ) {}

  /** The admin is created from ADMIN_EMAIL / ADMIN_PASSWORD; changing the password in env updates the hash. */
  async onApplicationBootstrap() {
    const { ADMIN_EMAIL, ADMIN_PASSWORD } = env();
    if (!ADMIN_PASSWORD) {
      this.log.warn('ADMIN_PASSWORD is not set — admin account is not created');
      return;
    }
    const hash = await bcrypt.hash(ADMIN_PASSWORD, 12);
    await this.db.query(
      `INSERT INTO users (email, password_hash, role) VALUES ($1, $2, 'admin')
       ON CONFLICT (email) DO UPDATE SET password_hash = EXCLUDED.password_hash, role = 'admin'`,
      [ADMIN_EMAIL.toLowerCase(), hash],
    );
  }

  /** Public site: a visitor gets an anonymous guest account so that history and ratings work. */
  async guest(): Promise<SessionResponse> {
    const row = await this.db.one<UserRow>(`INSERT INTO users (is_guest) VALUES (true) RETURNING *`);
    return this.session(row!);
  }

  async register(email: string, password: string): Promise<SessionResponse> {
    const hash = await bcrypt.hash(password, 12);
    try {
      const row = await this.db.one<UserRow>(
        `INSERT INTO users (email, password_hash, role) VALUES ($1, $2, 'user') RETURNING *`,
        [email.toLowerCase(), hash],
      );
      return this.session(row!);
    } catch (err) {
      if ((err as { code?: string }).code === '23505') throw new ConflictException('Email already registered');
      throw err;
    }
  }

  async login(email: string, password: string): Promise<SessionResponse> {
    const row = await this.db.one<UserRow>(`SELECT * FROM users WHERE email = $1`, [email.toLowerCase()]);
    if (!row?.password_hash || !(await bcrypt.compare(password, row.password_hash))) {
      throw new UnauthorizedException('Wrong email or password');
    }
    return this.session(row);
  }

  async me(user: AuthUser) {
    const row = await this.db.one<UserRow>(`SELECT * FROM users WHERE id = $1`, [user.id]);
    if (!row) throw new UnauthorizedException();
    return { id: row.id, email: row.email, role: row.role, guest: row.is_guest };
  }

  private async session(row: UserRow): Promise<SessionResponse> {
    const token = await this.jwt.signAsync(
      { sub: row.id, role: row.role, guest: row.is_guest },
      { expiresIn: row.is_guest ? '90d' : '7d' },
    );
    return { token, user: { id: row.id, email: row.email, role: row.role, guest: row.is_guest } };
  }
}
