import { Body, Controller, Get, HttpCode, Post, UseGuards } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { z } from 'zod';
import { ZodPipe } from '../common/zod.pipe';
import { AuthGuard, CurrentUser, type AuthUser } from './auth.guards';
import { AuthService } from './auth.service';

const credentials = z.object({
  email: z.string().email().max(200),
  password: z.string().min(10).max(200),
});
type Credentials = z.infer<typeof credentials>;

@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Post('guest')
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  guest() {
    return this.auth.guest();
  }

  @Post('register')
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  register(@Body(new ZodPipe(credentials)) body: Credentials) {
    return this.auth.register(body.email, body.password);
  }

  @Post('login')
  @HttpCode(200)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  login(@Body(new ZodPipe(credentials.extend({ password: z.string().min(1).max(200) }))) body: Credentials) {
    return this.auth.login(body.email, body.password);
  }

  @Get('me')
  @UseGuards(AuthGuard)
  me(@CurrentUser() user: AuthUser) {
    return this.auth.me(user);
  }
}
